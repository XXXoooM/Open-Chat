// EXPORTS: createMqttTransport

import mqtt, { type MqttClient } from 'mqtt';
import { logger } from '@lark-apaas/client-toolkit-lite';
import { BROKER_PASSWORD, BROKER_URL, BROKER_USERNAME } from '@/lib/mqttConfig';
import type {
  ChannelName,
  IPublishOptions,
  ITransport,
  ITransportConfig,
  ITransportMessage,
  ITransportStatusEvent,
  ProtocolVersion,
} from './types';

/** QoS 1 发布确认超时：避免「发送中」永久悬挂（原 FUNC-09） */
const PUBLISH_ACK_TIMEOUT_MS = 8000;

interface ITopicSet {
  messages: string;
  presence: string;
  meta: string;
  typing: string;
  receipts: string;
}

/**
 * 地址构造。
 * - v1（历史）：chatroom/{roomId}/messages
 * - v2（当前）：chatroom/{roomId}/{密码派生命名空间}/messages，使无密码者无法穷举订阅
 * - meta 始终位于与密码无关的地址上，否则「密码错误」将无法被检测出来
 */
function buildTopics(roomId: string, namespace: string | null): ITopicSet {
  const base = namespace ? `chatroom/${roomId}/${namespace}` : `chatroom/${roomId}`;
  return {
    messages: `${base}/messages`,
    presence: `${base}/presence`,
    typing: `${base}/typing`,
    receipts: `${base}/receipts`,
    meta: `chatroom/${roomId}/meta`,
  };
}

/**
 * MQTT 传输实现。行为与原 useMqttChat 内联实现一致：
 * - 连接成功即进入 connected（ready=false），SUBACK 成功后再发 ready=true
 * - 认证失败（code 4/5 或文案匹配）终止重连并上报 auth-error，此后不再上报状态
 * - 非认证错误仅记录日志，不改变状态（避免界面被无关错误干扰）
 */
export function createMqttTransport(config: ITransportConfig): ITransport {
  const topicsV1 = buildTopics(config.roomId, null);
  const topicsV2 = buildTopics(config.roomId, config.namespace);

  let client: MqttClient | null = null;
  let closed = false;
  /** Broker 拒绝凭据后置为 true：抑制后续 close/reconnect 覆盖状态 */
  let authFailed = false;

  const messageHandlers = new Set<(msg: ITransportMessage) => void>();
  const statusHandlers = new Set<(evt: ITransportStatusEvent) => void>();

  function emitStatus(evt: ITransportStatusEvent) {
    statusHandlers.forEach((handler) => handler(evt));
  }

  function topicOf(channel: ChannelName, proto: ProtocolVersion): string {
    // meta 与协议版本无关：它必须留在无命名空间地址上，否则密码错误无法被检测
    if (channel === 'meta') return topicsV1.meta;
    const set = proto === 1 ? topicsV1 : topicsV2;
    if (channel === 'receipts') return set.receipts;
    if (channel === 'typing') return set.typing;
    if (channel === 'presence') return set.presence;
    return set.messages;
  }

  function channelOf(topic: string): ChannelName | null {
    if (topic === topicsV1.meta) return 'meta';
    for (const set of [topicsV2, topicsV1]) {
      if (topic === set.messages) return 'messages';
      if (topic === set.presence) return 'presence';
      if (topic === set.typing) return 'typing';
      if (topic === set.receipts) return 'receipts';
    }
    return null;
  }

  /** 待确认发布：以 QoS 确认回调为准，超时或抛错均视为失败 */
  function publishWithAck(
    active: MqttClient,
    topic: string,
    message: string,
    opts: { qos: 0 | 1 | 2; retain: boolean },
  ): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        resolve(false);
      }, PUBLISH_ACK_TIMEOUT_MS);

      try {
        active.publish(topic, message, opts, (err) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(!err);
        });
      } catch {
        clearTimeout(timer);
        resolve(false);
      }
    });
  }

  function publish(
    channel: ChannelName,
    payload: string,
    opts?: IPublishOptions,
  ): Promise<boolean> {
    const active = client;
    if (!active?.connected) return Promise.resolve(false);

    const topic = topicOf(channel, opts?.proto ?? 2);
    const qos = opts?.qos ?? 1;
    const retain = opts?.retain ?? false;

    // 低开销路径：发即忘，不建立确认等待（用于高频低价值报文）
    if (opts?.ack === false) {
      try {
        active.publish(topic, payload, { qos, retain });
        return Promise.resolve(true);
      } catch (err) {
        logger.error('MQTT 发即忘发布失败:', String(err));
        return Promise.resolve(false);
      }
    }

    return publishWithAck(active, topic, payload, { qos, retain });
  }

  return {
    kind: 'mqtt',

    connect() {
      if (client) return;
      closed = false;
      authFailed = false;

      const active = mqtt.connect(BROKER_URL, {
        clientId: config.clientId,
        clean: true,
        connectTimeout: 10000,
        reconnectPeriod: 3000,
        username: BROKER_USERNAME,
        password: BROKER_PASSWORD,
        will: {
          // 遗嘱由 Broker 代发、无法加密，因此只携带不可逆哈希（SEC-04）
          topic: topicsV2.presence,
          payload: JSON.stringify({ kind: 'leave', sid: config.sid }),
          qos: 1,
          retain: false,
        },
      });
      client = active;

      active.on('connect', () => {
        if (closed) return;
        logger.info('MQTT 已连接');
        emitStatus({ status: 'connected', ready: false });

        // 同时订阅 v1/v2：既能加入新建的 v2 房间，也兼容仍在进行中的历史 v1 房间。
        // typing / receipts 为新增能力，同样需要显式订阅。
        const subscribeTopics = Array.from(
          new Set([
            topicsV1.messages,
            topicsV1.presence,
            topicsV2.messages,
            topicsV2.presence,
            topicsV1.meta,
            topicsV1.typing,
            topicsV2.typing,
            topicsV2.receipts,
          ]),
        );

        active.subscribe(subscribeTopics, { qos: 1 }, (err) => {
          if (closed) return;
          if (err) {
            logger.error('MQTT 订阅失败:', String(err));
            return;
          }
          emitStatus({ status: 'connected', ready: true });
        });
      });

      active.on('message', (topic, payload, packet) => {
        if (closed) return;
        const channel = channelOf(topic);
        if (!channel) return;
        const msg: ITransportMessage = {
          channel,
          payload: payload.toString(),
          retained: !!packet?.retain,
        };
        messageHandlers.forEach((handler) => handler(msg));
      });

      active.on('reconnect', () => {
        if (closed || authFailed) return;
        logger.info('MQTT 重连中...');
        emitStatus({ status: 'connecting', ready: false });
      });

      active.on('close', () => {
        if (closed || authFailed) return;
        logger.info('MQTT 已断开');
        emitStatus({ status: 'disconnected', ready: false });
      });

      active.on('error', (err) => {
        // 认证失败不会自行恢复：停止无意义的重连，并把原因显式暴露给界面。
        // 典型诱因：.env.local 中未用引号包裹含 # / $ 的密码，dotenv 会在 # 处截断取值。
        const code = (err as { code?: unknown }).code;
        const message = err?.message ?? '';
        const isAuthError =
          code === 4 ||
          code === 5 ||
          /bad username or password|not authorized|unauthorized/i.test(message);

        if (isAuthError) {
          logger.error(
            'MQTT 认证失败（请检查 .env.local 的 VITE_MQTT_USERNAME / VITE_MQTT_PASSWORD；含 #、$ 的密码必须用单引号包裹）:',
            message,
          );
          authFailed = true;
          emitStatus({ status: 'auth-error', ready: false, detail: message });
          active.end(true);
          return;
        }

        logger.error('MQTT 错误:', message);
      });
    },

    close() {
      closed = true;
      const active = client;
      client = null;
      active?.end(true);
    },

    isConnected() {
      return !!client?.connected;
    },

    onMessage(handler) {
      messageHandlers.add(handler);
      return () => {
        messageHandlers.delete(handler);
      };
    },

    onControl() {
      // MQTT 通路没有服务端仲裁能力，因此不产生控制事件：
      // 离职以遗嘱报文出现在 presence 频道，房间关闭以空 retained meta 表达。
      // 返回空取消函数以保持接口一致。
      return () => undefined;
    },

    onStatusChange(handler) {
      statusHandlers.add(handler);
      return () => {
        statusHandlers.delete(handler);
      };
    },

    publish,

    markRead() {
      // MQTT 通路没有服务端仲裁：已读状态无处上报。
      // 焚毁与回执在该通路上退化为本地行为，界面会显式标注。
    },
  };
}
