// EXPORTS: createRelayTransport

import { logger } from '@lark-apaas/client-toolkit-lite';
import { RELAY_URL } from '@/lib/relayConfig';
import { parseServerFrame } from '@shared/relay/protocol';
import type {
  ChannelName,
  IPublishOptions,
  ITransport,
  ITransportConfig,
  ITransportMessage,
  ITransportStatusEvent,
  TransportControl,
} from './types';

/** 订阅的频道集合（与中继侧 RELAY_CHANNELS 对应） */
const CHANNELS: ChannelName[] = ['messages', 'presence', 'meta', 'typing', 'receipts'];

const PING_INTERVAL_MS = 20000;
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 10000;
/** 「刚连上就被断开」连续达到该次数，判定为不会自行恢复，停止重连 */
const FAIL_FAST_THRESHOLD = 5;
const FAIL_FAST_LIFETIME_MS = 3000;

/**
 * 中继传输实现（WebSocket）。
 *
 * 与 MQTT 通路的两点语义差异，均已在实现中显式处理：
 * 1. **准入靠地址而非凭据**：地址含密码派生命名空间，服务端无法校验签名也不需要校验
 * 2. **没有逐条确认**：中继不通告 PUBACK，`ack` 选项被忽略；
 *    发送是否成功以服务端**回显**为准（回显到达即推进为「已发送」），
 *    需要强语义的场景由 receipt / burn 控制帧闭环
 */
export function createRelayTransport(config: ITransportConfig): ITransport {
  const namespace = config.namespace ?? '';
  const url =
    `${RELAY_URL}/room/${encodeURIComponent(config.roomId)}/${encodeURIComponent(namespace)}` +
    `?cid=${encodeURIComponent(config.clientId)}`;

  let socket: WebSocket | null = null;
  /** 服务端已确认订阅：此前的发布会被中继拒绝，故作为发布门槛 */
  let ready = false;
  let closed = false;
  let attempts = 0;
  let pingTimer: ReturnType<typeof setInterval> | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  const messageHandlers = new Set<(msg: ITransportMessage) => void>();
  const controlHandlers = new Set<(evt: TransportControl) => void>();
  const statusHandlers = new Set<(evt: ITransportStatusEvent) => void>();

  function emitStatus(evt: ITransportStatusEvent) {
    statusHandlers.forEach((handler) => handler(evt));
  }

  function emitControl(evt: TransportControl) {
    controlHandlers.forEach((handler) => handler(evt));
  }

  function send(raw: string): boolean {
    if (socket?.readyState !== 1) return false;
    socket.send(raw);
    return true;
  }

  function stopPing() {
    if (!pingTimer) return;
    clearInterval(pingTimer);
    pingTimer = null;
  }

  function scheduleReconnect() {
    if (closed || reconnectTimer) return;
    const delay = Math.min(RECONNECT_BASE_MS * 2 ** attempts, RECONNECT_MAX_MS);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  }

  function handleFrame(raw: string) {
    const frame = parseServerFrame(raw);
    if (!frame) return;

    if (frame.t === 'ready') {
      ready = true;
      attempts = 0;
      emitStatus({ status: 'connected', ready: true });
      return;
    }
    if (frame.t === 'msg') {
      const msg: ITransportMessage = {
        channel: frame.channel,
        payload: frame.env,
        retained: !!frame.retained,
      };
      messageHandlers.forEach((handler) => handler(msg));
      return;
    }
    if (frame.t === 'receipt') {
      emitControl({ kind: 'receipt', id: frame.id, readBy: frame.readBy, total: frame.total });
      return;
    }
    if (frame.t === 'burn') {
      emitControl({ kind: 'burn', id: frame.id });
      return;
    }
    if (frame.t === 'peer-left') {
      emitControl({ kind: 'peer-left', id: frame.id });
      return;
    }
    if (frame.t === 'closed') {
      emitControl({ kind: 'room-closed' });
      return;
    }
    if (frame.t === 'error') {
      logger.error('中继返回错误:', `${frame.code} ${frame.message}`);
      emitControl({ kind: 'error', code: frame.code, message: frame.message });
      return;
    }
    // pong：仅用于确认链路存活，无需向上暴露
  }

  function connect() {
    if (closed || socket) return;
    emitStatus({ status: 'connecting', ready: false });

    const startedAt = Date.now();
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch (err) {
      // 地址非法时构造会抛错，此时重连也没有意义
      logger.error('中继地址无法使用:', String(err));
      emitStatus({ status: 'auth-error', ready: false, detail: '中继地址无效' });
      return;
    }
    socket = ws;

    ws.onopen = () => {
      if (closed) {
        ws.close(1000, 'closed');
        return;
      }
      send(JSON.stringify({ t: 'hello', channels: CHANNELS }));
      emitStatus({ status: 'connected', ready: false });
      stopPing();
      pingTimer = setInterval(() => send(JSON.stringify({ t: 'ping' })), PING_INTERVAL_MS);
    };

    ws.onmessage = (ev) => {
      if (typeof ev.data === 'string') handleFrame(ev.data);
    };

    ws.onerror = () => {
      // 浏览器安全限制下无法读取失败原因，统一交由 onclose 处理
    };

    ws.onclose = () => {
      stopPing();
      if (socket === ws) {
        socket = null;
        ready = false;
      }
      if (closed) return;

      const lifetime = Date.now() - startedAt;
      attempts = lifetime < FAIL_FAST_LIFETIME_MS ? attempts + 1 : 0;

      if (attempts >= FAIL_FAST_THRESHOLD) {
        logger.error('中继连续拒绝连接：请检查 VITE_RELAY_URL 与 Worker 的来源白名单');
        emitStatus({ status: 'auth-error', ready: false, detail: '中继连续拒绝连接' });
        return;
      }

      emitStatus({ status: 'disconnected', ready: false });
      scheduleReconnect();
    };
  }

  return {
    kind: 'relay',

    connect() {
      closed = false;
      connect();
    },

    close() {
      closed = true;
      ready = false;
      stopPing();
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      const ws = socket;
      socket = null;
      ws?.close(1000, 'client-close');
    },

    isConnected() {
      return ready && socket?.readyState === 1;
    },

    onMessage(handler) {
      messageHandlers.add(handler);
      return () => {
        messageHandlers.delete(handler);
      };
    },

    onControl(handler) {
      controlHandlers.add(handler);
      return () => {
        controlHandlers.delete(handler);
      };
    },

    onStatusChange(handler) {
      statusHandlers.add(handler);
      return () => {
        statusHandlers.delete(handler);
      };
    },

    publish(channel, payload, opts?: IPublishOptions): Promise<boolean> {
      if (!ready || socket?.readyState !== 1) return Promise.resolve(false);

      const frame: Record<string, unknown> = { t: 'pub', channel, env: payload };
      if (opts?.id) frame.id = opts.id;
      if (opts?.burn) frame.burn = opts.burn;
      if (opts?.retain) frame.retain = true;

      // 中继无逐条确认：返回「是否已交给链路」，强语义由控制帧闭环
      return Promise.resolve(send(JSON.stringify(frame)));
    },

    markRead(id) {
      // 由中继统计并只回传计数；同一连接内的重复上报由中继去重
      send(JSON.stringify({ t: 'read', id }));
    },
  };
}
