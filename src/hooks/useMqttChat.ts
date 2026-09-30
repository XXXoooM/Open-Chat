import { useState, useRef, useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import {
  playIncomingMessageSound,
  playOutgoingMessageSound,
  playSound,
} from '@/lib/sound/map';
import { logger } from '@/lib/logger';
import {
  CURRENT_KDF_VERSION,
  createKeyRing,
  resolveKey,
  encryptJson,
  decryptJson,
  encryptBinary,
  decryptBinary,
  deriveTopicNamespace,
  sha256Hex,
  type IKeyRing,
  type IEnvelope,
} from '@/lib/crypto';
import { compressImage, getImageDimensions, formatFileSize } from '@/lib/media';
import {
  MAX_PAYLOAD_BYTES,
  MAX_FILE_PRECHECK,
  MAX_IMAGE_PRECHECK,
  MAX_UPLOAD_PRECHECK,
} from '@/lib/chatLimits';
import {
  createTransport,
  getTransportReadiness,
  type ChannelName,
  type ITransport,
  type ITransportMessage,
} from '@/lib/transport';
import {
  CHAT_EVENT_LABEL,
  DIVE_SCAN_INTERVAL_MS,
  DIVE_THRESHOLD_MS,
  type IChatEventPayload,
} from '@/lib/chatEvents';
import { BURN_FADE_MS } from '@/lib/burnPolicy';
import { useTypingIndicator } from '@/hooks/useTypingIndicator';
import { RELAY_SOCKET_TIMEOUT_MS } from '@shared/relay/protocol';
import type { IBurnPolicy } from '@shared/relay/protocol';

export type MessageType = 'text' | 'image' | 'file' | 'system' | 'event';

/** 发送状态（修复 AUDIT.md FUNC-04 / FUNC-09：乐观上屏 + 失败可见 + 可重试） */
export type MessageStatus = 'sending' | 'sent' | 'failed';

export interface IChatMessage {
  id: string;
  nickname: string;
  content: string;
  timestamp: number;
  isMine: boolean;
  /**
   * 发送者连接 id。
   * 用于按「身份」而不是「昵称」统计发言时间与在线状态，重名用户不会互相串状态。
   */
  senderId?: string;
  msgType: MessageType;
  status?: MessageStatus;
  /** msgType === 'event' 时的结构化事件负载（进入 / 离开 / 潜水） */
  event?: IChatEventPayload;
  /** 焚毁策略；未启用时为空 */
  burn?: IBurnPolicy;
  /** 定时焚毁的到期时刻（倒计时依据） */
  burnAt?: number;
  /** 已被焚毁：先呈现为「已销毁」，淡出后再从列表移除 */
  burned?: boolean;
  /**
   * 模糊消息：接收方看到的是模糊影像，需主动点击（或键盘）揭示，
   * 查看时长按字数分档（见 `lib/veilPolicy.ts`）。
   *
   * 与「焚毁」是**两套独立语义**：焚毁由定时或服务端仲裁，模糊与揭示则完全是
   * **接收端本地行为** —— 发送方无法得知谁看过、看了多久，界面也不应暗示相反的信息。
   */
  veil?: boolean;
  /**
   * 阅后自焚：揭示后倒计时结束、或窗口失焦时，即从列表移除。
   * 语义上**依赖 `veil`**：必须先主动打开才开始计时，否则消息会在被读到之前就消失。
   */
  ephemeral?: boolean;
  /**
   * 已读人数 / 应读人数。
   * 仅对自己发出的、启用焚毁的消息，且仅在服务端权威通路下会被填入 ——
   * 数值一律来自中继回执，客户端不自行推算，避免显示看似正常却无依据的进度。
   */
  readBy?: number;
  readTotal?: number;
  imageData?: string;
  imageName?: string;
  imageWidth?: number;
  imageHeight?: number;
  imageMime?: string;
  fileName?: string;
  fileSize?: number;
  fileData?: Uint8Array;
  fileType?: string;
}

export interface IOnlineUser {
  id: string;
  nickname: string;
  /** 首次观察到该用户的时间（即进入房间时间） */
  joinedAt?: number;
  /** 最后一次发言时间；从未发言时为空 */
  lastSpokeAt?: number;
  /** 是否处于「潜水中」状态（长时间未发言） */
  diving?: boolean;
  /** 进入潜水状态的时间 */
  divedAt?: number;
}

export type ConnectionStatus =
  | 'connecting'
  | 'connected'
  | 'disconnected'
  /** 缺少 Broker 环境变量配置（SEC-01），此时不会发起连接 */
  | 'misconfigured'
  /** Broker 拒绝凭据（用户名/密码错误或未授权），重连也不会恢复，需要修正配置 */
  | 'auth-error';

export interface IRoomMeta {
  createdAt: number;
  destroyAt: number;
  /** 手动续期次数（上限 MANUAL_EXTEND_MAX） */
  extendCount: number;
  creatorId: string;
  creatorName: string;
  /** 元信息版本：后写覆盖前写时的收敛依据（FUNC-03） */
  version?: number;
  /** 自动续期次数（上限 AUTO_EXTEND_MAX，FUNC-14） */
  autoExtendCount?: number;
  /** 该房间使用的密钥派生版本（SEC-03） */
  kdf?: number;
  /** 协议版本：1 = 历史扁平 topic；2 = 带密码派生命名空间的 topic（SEC-05） */
  proto?: number;
}

export type RoomStatus =
  | 'connecting'
  | 'password-error'
  | 'expired-creating-new'
  | 'active';

// ── 协议与常量 ────────────────────────────────────────────────
const PROTO_V1 = 1;
const PROTO_V2 = 2;

const HEARTBEAT_INTERVAL = 15000;
const PRESENCE_TIMEOUT = 30000;
/**
 * 中继通路下的成员存活兜底时长（120 秒）。
 *
 * 中继通路**不再依赖心跳到达**维持在线名册：Durable Object 直接以 socket 关闭
 * （或 45 秒失活清扫）广播 `peer-left` 来判定离开 —— 比心跳超时更及时，
 * 且不产生任何扇出。这里的长超时仅作为 `peer-left` 丢失时的兜底，
 * 避免成员记录永久滞留。
 */
const RELAY_PRESENCE_TIMEOUT = RELAY_SOCKET_TIMEOUT_MS + 30000;
const META_WAIT_MS = 2000;
/** 建房间前的随机抖动，避免多客户端同时判定「我是创建者」（FUNC-03） */
const META_WAIT_JITTER_MS = 2000;
/** retained meta 被清空后的重发抖动，避免多客户端同时重发（SEC-06） */
const META_REPUBLISH_MAX_JITTER_MS = 1500;
/** 过期房间的在线人数统计窗口 */
const EXTEND_DECISION_WAIT_MS = 3000;
const AUTO_EXTEND_THRESHOLD = 15;
const AUTO_EXTEND_MAX = 3;
const MANUAL_EXTEND_MAX = 3;
const AUTO_EXTEND_DURATION_MS = 3 * 60 * 60 * 1000;
const LIFECYCLE_CHECK_INTERVAL_MIN = 20000;
const LIFECYCLE_CHECK_INTERVAL_MAX = 30000;

let msgIdCounter = 0;

function nextMsgId(prefix = 'msg') {
  return `${prefix}_${++msgIdCounter}_${Date.now()}`;
}

/** 二进制转 Base64（分块避免超长参数） */
function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/**
 * 可重试的消息（结构类型）。
 * 组件层持有的是 IMessage（msgType 可选），这里用最小字段集合，
 * 避免 ChatPage 为了类型匹配再做一次无意义的字段拷贝。
 */
type RetryableMessage = Pick<IChatMessage, 'id' | 'content' | 'timestamp'> & {
  msgType?: MessageType;
  status?: MessageStatus;
  /** 重试必须保留焚毁策略，否则「读后焚毁」会在重试后静默退化为普通消息 */
  burn?: IBurnPolicy;
  /** 同理：重试必须保留隐私标记，否则「模糊/自焚」会在重试后静默失效 */
  veil?: boolean;
  ephemeral?: boolean;
};

/** 逐条消息的隐私选项（发送时选择，随密文一起送达） */
export interface IMessagePrivacyOptions {
  /** 模糊消息：接收方需主动揭示，查看时长按字数分档 */
  veil?: boolean;
  /** 阅后自焚：揭示后超时即删除；语义上依赖 veil */
  ephemeral?: boolean;
}

interface IPresencePayload {
  kind: 'join' | 'leave' | 'heartbeat' | 'request-users';
  userId: string;
  userName: string;
  sid?: string;
  ts?: number;
}

/**
 * 输入指示负载。
 * 刻意不复用 IPresencePayload：两者字段相近，但「正在输入」是意图元数据，
 * 与在线状态属不同敏感级别，混用会让「通道隔离」在类型层就先失效。
 */
interface ITypingPayload {
  kind?: string;
  userId: string;
  userName: string;
  sid?: string;
  ts?: number;
}

interface ITextPayload {
  kind?: string;
  id: string;
  senderId: string;
  sender: string;
  content: string;
  timestamp: number;
  /**
   * 焚毁策略随密文一起传递。
   * 这样 MQTT 通路也能正确呈现（退化为本地定时销毁），
   * 而中继通路额外通过明文元数据获得权威仲裁能力。
   */
  burn?: IBurnPolicy;
  /**
   * 模糊消息标记：放在**密文内**传递。
   *
   * 为什么不像 burn 那样走明文元数据：模糊与揭示是纯接收端行为，中继无需参与仲裁，
   * 因此没有必要把「这条消息是私密消息」暴露给中继 —— 少一项明文元数据就少一分信息面。
   */
  veil?: boolean;
  /** 阅后自焚标记（依赖 veil，与 veil 一同位于密文内） */
  ephemeral?: boolean;
}

interface IBinaryMetaPayload {
  kind?: string;
  msgType: 'image' | 'file';
  id: string;
  senderId: string;
  sender: string;
  timestamp: number;
  imageName?: string;
  imageWidth?: number;
  imageHeight?: number;
  imageMime?: string;
  fileName?: string;
  fileSize?: number;
  fileType?: string;
}

type BinaryPublishFailureReason = 'not-ready' | 'too-large' | 'publish-failed';

/** 扁平结构：预设 tsconfig 为 `strict: false`，此处不依赖联合类型的判别式收窄 */
interface IBinaryPublishResult {
  ok: boolean;
  reason: BinaryPublishFailureReason | null;
  size: number;
}

interface UseMqttChatOptions {
  roomId: string;
  password: string;
  nickname: string;
  onPasswordError?: () => void;
  onRoomDestroyed?: () => void;
  /**
   * 输入指示开关（默认关闭，隐私优先）。
   * 一个开关同时控制「是否上报」与「是否显示」：关闭后既不广播自己的意图，
   * 也不渲染他人的意图，避免出现单向暴露。
   */
  typingEnabled?: boolean;
}

export function useMqttChat({
  roomId,
  password,
  nickname,
  onPasswordError,
  onRoomDestroyed,
  typingEnabled = false,
}: UseMqttChatOptions) {
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [messages, setMessages] = useState<IChatMessage[]>([]);
  const [onlineUsers, setOnlineUsers] = useState<IOnlineUser[]>([]);
  const [roomMeta, setRoomMeta] = useState<IRoomMeta | null>(null);
  const [roomStatus, setRoomStatus] = useState<RoomStatus>('connecting');

  // ── refs ─────────────────────────────────────────────────────
  const transportRef = useRef<ITransport | null>(null);
  const ringRef = useRef<IKeyRing | null>(null);
  const protoRef = useRef<number>(PROTO_V2);
  const sidRef = useRef<string>('');
  const sidToUserRef = useRef<Map<string, IOnlineUser>>(new Map());

  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lifecycleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const metaTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const diveScanTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const presenceTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  /**
   * 成员登记表：userId → 进入时间。
   * `onlineUsers` 是渲染用的 state（异步更新），事件去重必须依赖同步的 ref，
   * 否则同一次心跳/重复广播会重复记录「进入」事件。
   */
  const joinedRef = useRef<Map<string, number>>(new Map());

  const clientIdRef = useRef(`user_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
  const metaReceivedRef = useRef(false);
  const metaRef = useRef<IRoomMeta | null>(null);
  const destroyedRef = useRef(false);

  /** 焚毁计时器（本地到点销毁 + 淡出移除），key 为消息 id；与中继下发的 burn 幂等 */
  const burnTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  /** 已上报过已读的消息 id，避免重复上报 */
  const readAckedRef = useRef<Set<string>>(new Set());

  const onlineUsersRef = useRef<IOnlineUser[]>([]);
  const nicknameRef = useRef(nickname);
  const roomStatusRef = useRef<RoomStatus>('connecting');

  useEffect(() => {
    onlineUsersRef.current = onlineUsers;
  }, [onlineUsers]);

  useEffect(() => {
    nicknameRef.current = nickname;
  }, [nickname]);

  useEffect(() => {
    roomStatusRef.current = roomStatus;
  }, [roomStatus]);

  // ── 消息列表操作 ──────────────────────────────────────────────
  const addSystemMessage = useCallback((text: string) => {
    const id = nextMsgId('sys');
    setMessages((prev) => [
      ...prev,
      {
        id,
        nickname: '系统',
        content: text,
        timestamp: Date.now(),
        isMine: false,
        msgType: 'system' as const,
        status: 'sent' as const,
      },
    ]);
  }, []);

  /**
   * 追加消息（修复 AUDIT.md FUNC-04）。
   * - 以 id 去重：QoS 1 重投递不会再重复上屏
   * - 按时间戳插入：重连补投的历史消息落到正确位置
   * - 已存在的「发送中」乐观消息会被回显标记为已送达
   */
  const appendMessage = useCallback((msg: IChatMessage) => {
    /**
     * 收到他人消息的提示音。
     *
     * 刻意放在 `setMessages` 之外：状态更新函数必须是纯的（严格模式下会被调用两次），
     * 音效写进去会响两下。自己的消息（`isMine`）不在这里响 —— 它们的反馈音是发送处的
     * `confirm`，避免同一条消息两种声音。
     */
    if (!msg.isMine && (msg.msgType === 'text' || msg.msgType === 'image' || msg.msgType === 'file')) {
      playIncomingMessageSound();
    }

    // 记录发言时间（「潜水」判定的基准）：系统消息与动态事件都不算发言。
    // 放在去重判断之前，保证「乐观消息 + 回显」只记一次也不会漏记。
    if (msg.senderId && msg.msgType !== 'system' && msg.msgType !== 'event') {
      const speakerId = msg.senderId;
      const spokeAt = msg.timestamp;
      setOnlineUsers((prev) =>
        prev.map((u) =>
          u.id === speakerId
            ? { ...u, lastSpokeAt: spokeAt, diving: false, divedAt: undefined }
            : u,
        ),
      );
    }

    setMessages((prev) => {
      const existing = prev.find((m) => m.id === msg.id);
      if (existing) {
        if (existing.status === 'sent') return prev;
        return prev.map((m) => (m.id === msg.id ? { ...m, ...msg, status: 'sent' as const } : m));
      }

      const next = prev.slice();
      let i = next.length;
      while (i > 0 && next[i - 1]!.timestamp > msg.timestamp) i--;
      next.splice(i, 0, msg);
      return next;
    });
  }, []);

  /**
   * 追加一条聊天室动态事件（进入 / 离开 / 潜水）。
   * 事件与聊天消息共用同一条时间线，因此直接复用 appendMessage ——
   * 排序（按时间插入）与去重（同 kind + 同用户 + 同时间只记一次）都自动获得。
   */
  const appendEvent = useCallback(
    (payload: IChatEventPayload, subjectNickname: string, isMine: boolean) => {
      appendMessage({
        id: `evt_${payload.kind}_${payload.userId}_${payload.at}`,
        nickname: subjectNickname,
        content: CHAT_EVENT_LABEL[payload.kind],
        timestamp: payload.at,
        isMine,
        msgType: 'event',
        status: 'sent',
        event: payload,
      });
    },
    [appendMessage],
  );

  const markMessageStatus = useCallback((id: string, status: MessageStatus) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, status } : m)));
  }, []);

  // ── 焚毁 ─────────────────────────────────────────────────────
  /**
   * 标记消息已焚毁。
   * 先呈现为「已销毁」再淡出移除：直接删除会让用户无法确认消息确实消失了。
   * 幂等：同一 id 重复触发不会重复排期。
   */
  const markMessageBurned = useCallback((id: string) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, burned: true } : m)));
    if (burnTimersRef.current.has(id)) return;
    const timer = setTimeout(() => {
      burnTimersRef.current.delete(id);
      setMessages((prev) => prev.filter((m) => m.id !== id));
    }, BURN_FADE_MS);
    burnTimersRef.current.set(id, timer);
  }, []);

  /**
   * 定时焚毁的本地兜底。
   * 中继通路会同时下发 burn 指令，二者幂等；MQTT 通路下这是唯一的销毁执行者，
   * 因此界面对该通路会显式标注「仅本地销毁」。
   */
  const scheduleBurn = useCallback(
    (id: string, burnAt: number) => {
      if (burnTimersRef.current.has(id)) return;
      const timer = setTimeout(
        () => {
          burnTimersRef.current.delete(id);
          markMessageBurned(id);
        },
        Math.max(0, burnAt - Date.now()),
      );
      burnTimersRef.current.set(id, timer);
    },
    [markMessageBurned],
  );

  // ── 发布 ─────────────────────────────────────────────────────
  const publishEncrypted = useCallback(
    async (
      target: ChannelName,
      payload: unknown,
      opts?: {
        qos?: 0 | 1 | 2;
        retain?: boolean;
        version?: number;
        /** false = 发即忘（用于输入指示这类高频易失信号） */
        ack?: boolean;
        /** 焚毁语义所需的最小元数据（仅中继通路消费） */
        id?: string;
        burn?: IBurnPolicy;
      },
    ): Promise<boolean> => {
      const ring = ringRef.current;
      const transport = transportRef.current;
      if (!ring || !transport?.isConnected()) return false;

      // 房间的加密版本由协议版本决定：v1 房间必须继续用 v1 密钥，
      // 否则仍在线的旧客户端无法解密我们发出的报文。
      const version = opts?.version ?? protoRef.current;
      const key = await resolveKey(ring, version);
      if (!key) return false;

      const envelope = await encryptJson(key, payload, version);
      return transport.publish(target, JSON.stringify(envelope), {
        qos: opts?.qos ?? 1,
        retain: opts?.retain ?? false,
        ack: opts?.ack,
        proto: protoRef.current === PROTO_V1 ? PROTO_V1 : PROTO_V2,
        id: opts?.id,
        burn: opts?.burn,
      });
    },
    [],
  );

  const publishPresence = useCallback(
    async (kind: IPresencePayload['kind']): Promise<boolean> => {
      return publishEncrypted('presence', {
        kind,
        userId: clientIdRef.current,
        userName: nicknameRef.current,
        sid: sidRef.current,
        ts: Date.now(),
      } satisfies IPresencePayload);
    },
    [publishEncrypted],
  );

  // ── 输入指示 ─────────────────────────────────────────────────
  const typing = useTypingIndicator(typingEnabled);

  /**
   * 上报「本端正在输入」。
   * 走低开销通道：QoS 0 / 发即忘，不落盘也不重投 ——
   * 输入指示属易失信号，丢一条没有影响；反之代价是每次节流窗口都产生确认往返。
   */
  const notifyTyping = useCallback(() => {
    if (!typingEnabled) return;
    if (!typing.shouldNotify()) return;
    void publishEncrypted(
      'typing',
      {
        kind: 'typing',
        userId: clientIdRef.current,
        userName: nicknameRef.current,
        sid: sidRef.current,
        ts: Date.now(),
      } satisfies ITypingPayload,
      { qos: 0, ack: false },
    );
  }, [typingEnabled, typing, publishEncrypted]);

  const publishBinaryMessage = useCallback(
    async (metaObj: IBinaryMetaPayload, binaryData: Uint8Array): Promise<IBinaryPublishResult> => {
      const ring = ringRef.current;
      const transport = transportRef.current;
      if (!ring || !transport?.isConnected()) {
        return { ok: false, reason: 'not-ready', size: 0 };
      }

      const version = protoRef.current;
      const key = await resolveKey(ring, version);
      if (!key) return { ok: false, reason: 'not-ready', size: 0 };

      const metaEnvelope = await encryptJson(key, metaObj, version);
      const dataEnvelope = await encryptBinary(key, binaryData, version);

      const fullPayload = { meta: metaEnvelope, data: dataEnvelope };
      const serialized = JSON.stringify(fullPayload);
      const size = new Blob([serialized]).size;
      if (size > MAX_PAYLOAD_BYTES) return { ok: false, reason: 'too-large', size };

      const ok = await transport.publish('messages', serialized, {
        qos: 1,
        retain: false,
        proto: protoRef.current === PROTO_V1 ? PROTO_V1 : PROTO_V2,
      });
      return ok
        ? { ok: true, reason: null, size }
        : { ok: false, reason: 'publish-failed', size };
    },
    [],
  );

  // ── 在线状态 ─────────────────────────────────────────────────
  const clearPresenceTimer = useCallback((userId: string) => {
    const timer = presenceTimersRef.current.get(userId);
    if (timer) {
      clearTimeout(timer);
      presenceTimersRef.current.delete(userId);
    }
  }, []);

  /** 登记/刷新某用户的存活计时器（FUNC-08：删除用户时必须同步清理计时器） */
  const touchPresence = useCallback(
    (user: IOnlineUser, at?: number) => {
      clearPresenceTimer(user.id);
      setOnlineUsers((prev) => {
        const existing = prev.find((u) => u.id === user.id);
        if (existing) {
          // 只同步昵称：joinedAt / lastSpokeAt / diving 必须保留，
          // 否则每一次心跳都会把「潜水中」状态重置掉。
          if (existing.nickname === user.nickname) return prev;
          return prev.map((u) => (u.id === user.id ? { ...u, nickname: user.nickname } : u));
        }
        // 首次见到该用户：进入时间优先取对方上报的时间戳
        return [...prev, { id: user.id, nickname: user.nickname, joinedAt: at ?? Date.now() }];
      });
      presenceTimersRef.current.set(
        user.id,
        setTimeout(() => {
          presenceTimersRef.current.delete(user.id);
          setOnlineUsers((prev) => prev.filter((u) => u.id !== user.id));
          // 心跳超时 = 失联，与「主动离开」在时间线上分开记录
          if (joinedRef.current.has(user.id)) {
            joinedRef.current.delete(user.id);
            appendEvent(
              { kind: 'leave', at: Date.now(), userId: user.id, timedOut: true },
              user.nickname,
              user.id === clientIdRef.current,
            );
          }
        },
          // 中继通路以 peer-left 判定离开，故本地超时只作兜底并显著放宽
          transportRef.current?.kind === 'relay' ? RELAY_PRESENCE_TIMEOUT : PRESENCE_TIMEOUT,
        ),
      );
    },
    [clearPresenceTimer, appendEvent],
  );

  /**
   * 处理在线状态。
   *
   * 事件记录规则（对应本次需求）：
   * - `join`：只在「首次见到该用户」时记录「进入房间 + 时间」
   * - `leave`：只在「该用户先前已被登记」时记录「离开房间 + 时间」，
   *   并区分主动离开与心跳超时失联
   * - `heartbeat`：仅存活信号。首次见到的用户说明他比我先在房间里，
   *   此时只静默登记，不产生「进入」事件（否则会伪造出一条从未发生的事件）
   */
  const handlePresence = useCallback(
    (user: IOnlineUser, kind: string, at?: number) => {
      const eventAt = at ?? Date.now();

      switch (kind) {
        case 'join': {
          touchPresence(user, eventAt);
          if (!joinedRef.current.has(user.id)) {
            joinedRef.current.set(user.id, eventAt);
            appendEvent(
              { kind: 'join', at: eventAt, userId: user.id },
              user.nickname,
              user.id === clientIdRef.current,
            );
          }
          break;
        }

        case 'heartbeat':
          if (!joinedRef.current.has(user.id)) joinedRef.current.set(user.id, eventAt);
          touchPresence(user, eventAt);
          break;

        case 'leave': {
          clearPresenceTimer(user.id);
          setOnlineUsers((prev) => prev.filter((u) => u.id !== user.id));
          sidToUserRef.current.forEach((value, key) => {
            if (value.id === user.id) sidToUserRef.current.delete(key);
          });
          if (joinedRef.current.has(user.id)) {
            joinedRef.current.delete(user.id);
            appendEvent(
              { kind: 'leave', at: eventAt, userId: user.id },
              user.nickname,
              user.id === clientIdRef.current,
            );
          }
          break;
        }

        default:
          break;
      }
    },
    [touchPresence, clearPresenceTimer, appendEvent],
  );

  /** 在线人数（含自己）：合并「收到心跳的用户」与「已登记的计时器」两个来源，
   *  修复 AUDIT.md FUNC-01 —— 单看计时器会恒为 1。 */
  const countOnline = useCallback(() => {
    const ids = new Set(onlineUsersRef.current.map((u) => u.id));
    ids.add(clientIdRef.current);
    return Math.max(ids.size, presenceTimersRef.current.size + 1);
  }, []);

  // ── 定时器统一管理（FUNC-02：幂等启动，杜绝重连累积）──────────
  const stopTimers = useCallback(() => {
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
    if (lifecycleTimerRef.current) {
      clearTimeout(lifecycleTimerRef.current);
      lifecycleTimerRef.current = null;
    }
    if (metaTimerRef.current) {
      clearTimeout(metaTimerRef.current);
      metaTimerRef.current = null;
    }
    if (diveScanTimerRef.current) {
      clearTimeout(diveScanTimerRef.current);
      diveScanTimerRef.current = null;
    }
  }, []);

  // ── 潜水状态扫描（长时间未发言）────────────────────────────────
  /**
   * 判定基准：`最后一次发言时间`，从未发言则取`进入房间时间`。
   * 事件时间取 `基准 + 阈值` 而不是扫描时刻 —— 扫描有间隔，
   * 用扫描时刻会让「进入潜水状态的时间」最多偏差一个扫描周期。
   * 每个潜水周期只记一条：说话会把状态复位，之后再次沉默才会产生新事件。
   */
  const scheduleDiveScan = useCallback(() => {
    if (diveScanTimerRef.current) {
      clearTimeout(diveScanTimerRef.current);
      diveScanTimerRef.current = null;
    }

    diveScanTimerRef.current = setTimeout(() => {
      diveScanTimerRef.current = null;
      const now = Date.now();

      for (const user of onlineUsersRef.current) {
        // 自己的状态不需要被通知（你当然知道自己没在说话）
        if (user.id === clientIdRef.current || user.diving) continue;

        const baseline = user.lastSpokeAt ?? user.joinedAt ?? now;
        const divedAt = baseline + DIVE_THRESHOLD_MS;
        if (now < divedAt) continue;

        setOnlineUsers((prev) =>
          prev.map((u) => (u.id === user.id ? { ...u, diving: true, divedAt } : u)),
        );
        appendEvent(
          { kind: 'dive', at: divedAt, userId: user.id, baselineAt: user.lastSpokeAt },
          user.nickname,
          false,
        );
      }

      scheduleDiveScan();
    }, DIVE_SCAN_INTERVAL_MS);
  }, [appendEvent]);

  // ── 生命周期检查 ──────────────────────────────────────────────
  const scheduleLifecycleCheck = useCallback(() => {
    if (lifecycleTimerRef.current) {
      clearTimeout(lifecycleTimerRef.current);
      lifecycleTimerRef.current = null;
    }

    const delay =
      LIFECYCLE_CHECK_INTERVAL_MIN +
      Math.random() * (LIFECYCLE_CHECK_INTERVAL_MAX - LIFECYCLE_CHECK_INTERVAL_MIN);

    lifecycleTimerRef.current = setTimeout(() => {
      lifecycleTimerRef.current = null;
      const meta = metaRef.current;
      if (!meta || destroyedRef.current) return;

      const now = Date.now();
      if (now >= meta.destroyAt) {
        const currentOnline = countOnline();
        const autoCount = meta.autoExtendCount ?? 0;

        if (currentOnline >= AUTO_EXTEND_THRESHOLD && autoCount < AUTO_EXTEND_MAX) {
          const newMeta: IRoomMeta = {
            ...meta,
            destroyAt: now + AUTO_EXTEND_DURATION_MS,
            autoExtendCount: autoCount + 1,
            version: now,
          };
          metaRef.current = newMeta;
          setRoomMeta(newMeta);
          publishEncrypted('meta', newMeta, { qos: 1, retain: true });
          addSystemMessage(
            `当前在线人数 ≥ ${AUTO_EXTEND_THRESHOLD}，房间已自动延长 3 小时（第 ${autoCount + 1}/${AUTO_EXTEND_MAX} 次）`,
          );
        } else {
          destroyedRef.current = true;
          addSystemMessage('房间已销毁');
          transportRef.current?.publish('meta', '', { qos: 1, retain: true, ack: false });
          onRoomDestroyed?.();
          return;
        }
      }

      scheduleLifecycleCheck();
    }, delay);
  }, [countOnline, publishEncrypted, addSystemMessage, onRoomDestroyed]);

  // ── 创建新房间 ────────────────────────────────────────────────
  const createNewRoom = useCallback(
    (reason: 'empty' | 'expired') => {
      const now = Date.now();
      const newMeta: IRoomMeta = {
        createdAt: now,
        destroyAt: now + AUTO_EXTEND_DURATION_MS,
        extendCount: 0,
        autoExtendCount: 0,
        creatorId: clientIdRef.current,
        creatorName: nicknameRef.current,
        version: now,
        kdf: CURRENT_KDF_VERSION,
        proto: PROTO_V2,
      };

      protoRef.current = PROTO_V2;
      metaRef.current = newMeta;
      metaReceivedRef.current = true;
      setRoomMeta(newMeta);
      setRoomStatus('active');

      // 直接覆盖 retained meta（不再先发空消息清空）：
      // 清空会制造一个「房间看似不存在」的时间窗，其它客户端可能因此重复建房（FUNC-03/SEC-06）。
      publishEncrypted('meta', newMeta, { qos: 1, retain: true, version: CURRENT_KDF_VERSION });
      addSystemMessage(reason === 'empty' ? '已创建新房间' : '原房间已过期，已为你创建新房间');
      publishPresence('join');
      publishPresence('request-users');
    },
    [publishEncrypted, publishPresence, addSystemMessage],
  );

  // ── 处理 meta（SEC-02 / SEC-03 / SEC-06）──────────────────────
  const handleMeta = useCallback(
    async (envelope: unknown, isEmpty: boolean) => {
      const ring = ringRef.current;
      if (!ring) return;

      if (isEmpty) {
        // retained 被清空：本地有 meta 说明是恶意清除，带随机抖动重发（避免重发风暴）
        const local = metaRef.current;
        if (local && !destroyedRef.current) {
          logger.info('meta retained 丢失，重新发布');
          const local_ = local;
          setTimeout(() => {
            if (destroyedRef.current) return;
            publishEncrypted('meta', local_, { qos: 1, retain: true });
          }, Math.random() * META_REPUBLISH_MAX_JITTER_MS);
        }
        return;
      }

      const result = await decryptJson<IRoomMeta>(ring, envelope);

      if (result.reason) {
        if (!result.versionSupported) {
          // 客户端版本落后，绝不能当作密码错误把人踢出去
          logger.warn(`收到不支持的 meta 版本: v${result.version}`);
          addSystemMessage('检测到更高版本的房间协议，请刷新页面后重试');
          return;
        }
        if (result.reason === 'invalid-envelope') return;

        // 解密失败：仅在「首次拿到 meta」时才判定为密码错误
        if (!metaReceivedRef.current && !destroyedRef.current) {
          setRoomStatus('password-error');
          setStatus('disconnected');
          onPasswordError?.();
          return;
        }
        // 房间已激活后收到无法解密的 meta → 伪造/损坏报文，忽略而不是踢人（SEC-02）
        logger.warn('忽略无法解密的 meta 报文（可能是伪造报文）');
        return;
      }

      const meta = result.value;
      if (!meta) return;

      // 版本回退保护（FUNC-03）：只接受不早于本地的 meta
      const incomingVersion = typeof meta.version === 'number' ? meta.version : 0;
      const localVersion = metaRef.current?.version ?? -1;
      if (metaReceivedRef.current && incomingVersion < localVersion) {
        logger.info('忽略过期的 meta（版本回退）');
        return;
      }

      // 协议版本：meta.proto 显式声明；历史 meta 没有该字段 → v1
      const proto = result.version >= 2 && meta.proto === PROTO_V2 ? PROTO_V2 : PROTO_V1;
      protoRef.current = proto;

      const wasActive = metaReceivedRef.current;
      metaReceivedRef.current = true;
      metaRef.current = meta;
      setRoomMeta(meta);

      const now = Date.now();

      if (meta.destroyAt > now) {
        setRoomStatus('active');
        // 仅在「首次拿到 meta」时广播加入并拉取在线列表。
        // 续期等 meta 更新会让所有客户端重跑本函数，若无条件广播，
        // 每次加时都会让全房间弹出 N 条「X 加入了聊天室」。
        if (!wasActive) {
          publishPresence('join');
          publishPresence('request-users');
        }
        return;
      }

      // ── 房间已过期 ──
      setRoomStatus('expired-creating-new');
      // 修复 FUNC-01：必须先请求在线列表，否则 3 秒内收集不到任何人
      publishPresence('request-users');

      setTimeout(() => {
        if (destroyedRef.current) return;
        const currentOnline = countOnline();
        const autoCount = meta.autoExtendCount ?? 0;

        if (currentOnline >= AUTO_EXTEND_THRESHOLD && autoCount < AUTO_EXTEND_MAX) {
          const newMeta: IRoomMeta = {
            ...meta,
            destroyAt: Date.now() + AUTO_EXTEND_DURATION_MS,
            autoExtendCount: autoCount + 1,
            version: Date.now(),
          };
          metaRef.current = newMeta;
          setRoomMeta(newMeta);
          setRoomStatus('active');
          publishEncrypted('meta', newMeta, { qos: 1, retain: true });
          addSystemMessage(
            `当前在线人数 ≥ ${AUTO_EXTEND_THRESHOLD}，房间已自动延长 3 小时（第 ${autoCount + 1}/${AUTO_EXTEND_MAX} 次）`,
          );
          publishPresence('join');
          publishPresence('request-users');
        } else {
          createNewRoom('expired');
        }
      }, EXTEND_DECISION_WAIT_MS);
    },
    [
      publishEncrypted,
      publishPresence,
      addSystemMessage,
      createNewRoom,
      countOnline,
      onPasswordError,
    ],
  );

  // ── 申请加时 ──────────────────────────────────────────────────
  const extendRoom = useCallback(async (): Promise<boolean> => {
    const meta = metaRef.current;
    if (!meta) return false;

    const manualCount = meta.extendCount ?? 0;
    if (manualCount >= MANUAL_EXTEND_MAX) return false;

    const durations = [
      24 * 60 * 60 * 1000, // 第 1 次 +24 小时
      3 * 24 * 60 * 60 * 1000, // 第 2 次 +3 天
      7 * 24 * 60 * 60 * 1000, // 第 3 次 +7 天
    ];
    const labels = ['24 小时', '3 天', '7 天'];

    const addMs = durations[manualCount];
    if (!addMs) return false;

    const newMeta: IRoomMeta = {
      ...meta,
      destroyAt: meta.destroyAt + addMs,
      extendCount: manualCount + 1,
      version: Date.now(),
    };
    metaRef.current = newMeta;
    setRoomMeta(newMeta);

    const ok = await publishEncrypted('meta', newMeta, { qos: 1, retain: true });
    if (!ok) {
      toast.error('房间加时失败，请检查网络后重试');
      return false;
    }
    addSystemMessage(`房间已延长 ${labels[manualCount]}`);
    return true;
  }, [publishEncrypted, addSystemMessage]);

  // ── 主连接 Effect ─────────────────────────────────────────────
  useEffect(() => {
    if (!nickname || !roomId || !password) return;

    const readiness = getTransportReadiness();
    if (!readiness.ready) {
      setStatus('misconfigured');
      logger.error(readiness.hint);
      return;
    }

    let cancelled = false;

    async function init() {
      const ring = createKeyRing(password, roomId);
      ringRef.current = ring;

      // topic 命名空间与遗嘱标识（均为密码/ID 派生，不含明文身份）
      let namespace: string;
      let sid: string;
      try {
        [namespace, sid] = await Promise.all([
          deriveTopicNamespace(password, roomId),
          sha256Hex(clientIdRef.current),
        ]);
      } catch (err) {
        logger.error('初始化加密参数失败:', String(err));
        return;
      }
      if (cancelled) return;

      sidRef.current = sid;
      protoRef.current = PROTO_V2;

      setStatus('connecting');
      setMessages([]);
      setOnlineUsers([]);
      setRoomMeta(null);
      setRoomStatus('connecting');
      metaReceivedRef.current = false;
      destroyedRef.current = false;
      metaRef.current = null;
      sidToUserRef.current.clear();
      // 成员登记表必须随连接一起重置：否则换房间时旧成员会残留，
      // 导致新房间里的「进入」事件被误判为重复而静默丢弃。
      joinedRef.current.clear();

      const transport = createTransport({
        roomId,
        namespace,
        clientId: clientIdRef.current,
        sid,
      });
      transportRef.current = transport;

      transport.onStatusChange((evt) => {
        if (cancelled) return;

        if (evt.status === 'auth-error') {
          setStatus('auth-error');
          stopTimers();
          transport.close();
          return;
        }
        if (evt.status === 'connecting') {
          setStatus('connecting');
          playSound('conn:loading');
          stopTimers();
          return;
        }
        if (evt.status === 'disconnected') {
          setStatus('disconnected');
          stopTimers();
          return;
        }

        setStatus('connected');
        playSound('conn:ready');

        // 连接已建立但订阅尚未就绪：先起心跳与周期检查
        if (!evt.ready) {
          // 定时器统一由 stopTimers 清理后再启动，重连不会累积（FUNC-02）
          stopTimers();
          if (transport.kind === 'relay') {
            // 中继通路**不启动**周期性心跳：存活由连接层承担 —— DO 每次收到帧
            // （含 20 秒保活 ping）都会刷新 lastSeen，socket 关闭或失活清扫时广播 peer-left。
            // 周期性 presence 心跳在中继侧会对全房间扇出（实测 N=100 时为 10000 帧/周期、
            // 消息 RTT 劣化至 467ms），而它携带的信息（「我还活着」）中继本就掌握。
            logger.info('中继通路：跳过周期性心跳，存活以连接状态与 peer-left 为准');
          } else {
            heartbeatRef.current = setInterval(() => {
              if (transport.isConnected() && metaReceivedRef.current && !destroyedRef.current) {
                publishPresence('heartbeat');
              }
            }, HEARTBEAT_INTERVAL);
          }
          scheduleLifecycleCheck();
          scheduleDiveScan();
          return;
        }

        // 订阅就绪：等待 retained meta；随机抖动避免多客户端同时判定「我是创建者」（FUNC-03）
        const wait = META_WAIT_MS + Math.random() * META_WAIT_JITTER_MS;
        metaTimerRef.current = setTimeout(() => {
          metaTimerRef.current = null;
          if (!metaReceivedRef.current && !destroyedRef.current) {
            createNewRoom('empty');
          }
        }, wait);
      });

      transport.onMessage((msg) => {
        void handleIncoming(msg);
      });

      transport.onControl((evt) => {
        if (cancelled) return;

        if (evt.kind === 'peer-left') {
          // 中继以 socket 关闭判定离开：比 MQTT 遗嘱更及时，且不携带任何可识别标识
          const known = onlineUsersRef.current.find((user) => user.id === evt.id);
          if (known) handlePresence(known, 'leave');
          return;
        }
        if (evt.kind === 'room-closed') {
          if (destroyedRef.current) return;
          destroyedRef.current = true;
          addSystemMessage('房间已销毁');
          onRoomDestroyed?.();
          return;
        }
        if (evt.kind === 'error') {
          logger.error('中继控制错误:', `${evt.code} ${evt.message}`);
          return;
        }
        if (evt.kind === 'receipt') {
          // 回执只携带计数：数值一律来自服务端，客户端不自行推算
          setMessages((prev) =>
            prev.map((m) =>
              m.id === evt.id ? { ...m, readBy: evt.readBy, readTotal: evt.total } : m,
            ),
          );
          return;
        }
        if (evt.kind === 'burn') {
          // 服务端权威焚毁指令：与本地定时计幂等
          markMessageBurned(evt.id);
        }
      });

      transport.connect();

      /** 入站报文分发：频道已由传输层归一化，业务侧不感知具体地址与协议差异 */
      async function handleIncoming(msg: ITransportMessage) {
        if (cancelled || destroyedRef.current) return;
        const currentRing = ringRef.current;
        if (!currentRing) return;

        const payloadStr = msg.payload;

        // ── meta ──
        if (msg.channel === 'meta') {
          if (!payloadStr) {
            handleMeta(null, true);
            return;
          }
          try {
            await handleMeta(JSON.parse(payloadStr), false);
          } catch (err) {
            logger.error('MQTT meta 解析失败:', String(err));
          }
          return;
        }

        // ── presence ──
        if (msg.channel === 'presence') {
          let data: unknown;
          try {
            data = JSON.parse(payloadStr);
          } catch {
            return;
          }
          if (!data || typeof data !== 'object') return;

          const raw = data as Record<string, unknown>;

          // 明文遗嘱（Broker 代发，无 iv/data）：只携带 sid 哈希
          if (!('iv' in raw) && !('data' in raw)) {
            if (raw.kind === 'leave' && typeof raw.sid === 'string') {
              const known = sidToUserRef.current.get(raw.sid);
              if (known) handlePresence(known, 'leave');
            }
            return;
          }

          const presenceResult = await decryptJson<IPresencePayload>(currentRing, data);
          if (presenceResult.reason || !presenceResult.value) return; // 无法解密者一律忽略
          const presence = presenceResult.value;

          if (presence.sid && presence.userId) {
            sidToUserRef.current.set(presence.sid, {
              id: presence.userId,
              nickname: presence.userName,
            });
          }

          if (presence.kind === 'request-users') {
            if (presence.userId !== clientIdRef.current && transport.isConnected()) {
              publishPresence('heartbeat');
            }
          } else {
            handlePresence(
              { id: presence.userId, nickname: presence.userName },
              presence.kind,
              presence.ts,
            );
          }
          return;
        }

        // ── typing（与在线成员表严格隔离，不参与任何人数统计）──
        if (msg.channel === 'typing') {
          let typingData: Record<string, unknown>;
          try {
            typingData = JSON.parse(payloadStr) as Record<string, unknown>;
          } catch {
            return;
          }
          if (!('iv' in typingData) || !('data' in typingData)) return;

          const typingResult = await decryptJson<ITypingPayload>(currentRing, typingData);
          if (typingResult.reason || !typingResult.value) return;
          const signal = typingResult.value;
          if (!signal.userId || signal.userId === clientIdRef.current) return;
          typing.registerRemote(signal.userId, signal.userName);
          return;
        }

        // ── messages ──
        if (msg.channel === 'messages') {
          let data: Record<string, unknown>;
          try {
            data = JSON.parse(payloadStr) as Record<string, unknown>;
          } catch (err) {
            logger.error('MQTT 消息解析失败:', String(err));
            return;
          }

          try {
            if (data.meta && data.data) {
              // 带二进制：图片 / 文件
              const metaResult = await decryptJson<IBinaryMetaPayload>(currentRing, data.meta);
              if (metaResult.reason || !metaResult.value) return;
              const binaryResult = await decryptBinary(currentRing, data.data);
              if (binaryResult.reason || !binaryResult.value) return;

              const meta = metaResult.value;
              const isMine = meta.senderId === clientIdRef.current;
              const base = {
                id: meta.id,
                nickname: meta.sender,
                content: '',
                timestamp: meta.timestamp,
                isMine,
                senderId: meta.senderId,
                status: 'sent' as const,
              };

              if (meta.msgType === 'image') {
                const mime = meta.imageMime || 'image/jpeg';
                appendMessage({
                  ...base,
                  msgType: 'image',
                  imageData: `data:${mime};base64,${bytesToBase64(binaryResult.value)}`,
                  imageName: meta.imageName,
                  imageWidth: meta.imageWidth,
                  imageHeight: meta.imageHeight,
                  imageMime: mime,
                });
              } else if (meta.msgType === 'file') {
                appendMessage({
                  ...base,
                  msgType: 'file',
                  fileName: meta.fileName,
                  fileSize: meta.fileSize,
                  fileType: meta.fileType,
                  fileData: binaryResult.value,
                });
              }
              return;
            }

            if (data.iv && data.data) {
              const textResult = await decryptJson<ITextPayload>(currentRing, data);
              if (textResult.reason || !textResult.value) return;
              const chat = textResult.value;
              const mine = chat.senderId === clientIdRef.current;
              const burnAt =
                chat.burn?.mode === 'time' ? chat.timestamp + (chat.burn.ttlMs ?? 0) : undefined;

              appendMessage({
                id: chat.id,
                nickname: chat.sender,
                content: chat.content,
                timestamp: chat.timestamp,
                isMine: mine,
                senderId: chat.senderId,
                msgType: 'text',
                status: 'sent',
                burn: chat.burn,
                burnAt,
                veil: chat.veil === true,
                // 与发送侧同一套归一化：自焚必须以模糊为前提
                ephemeral: chat.veil === true && chat.ephemeral === true,
              });
              if (burnAt) scheduleBurn(chat.id, burnAt);

              // 读后焚毁需要接收方上报已读；每连接只上报一次，计数由中继汇总后回传
              if (!mine && chat.burn?.mode === 'read' && !readAckedRef.current.has(chat.id)) {
                readAckedRef.current.add(chat.id);
                transport.markRead(chat.id);
              }
            }
          } catch (err) {
            logger.error('MQTT 消息处理失败:', String(err));
          }
        }
      }
    }

    init();

    return () => {
      cancelled = true;

      stopTimers();

      presenceTimersRef.current.forEach((timer) => clearTimeout(timer));
      presenceTimersRef.current.clear();

      burnTimersRef.current.forEach((timer) => clearTimeout(timer));
      burnTimersRef.current.clear();
      readAckedRef.current.clear();

      const transport = transportRef.current;
      if (transport?.isConnected()) {
        // 发送加密 leave 后再断开
        publishPresence('leave')
          .catch(() => false)
          .finally(() => {
            transport.close();
          });
      } else {
        transport?.close();
      }

      transportRef.current = null;
      ringRef.current = null;
      sidToUserRef.current.clear();
    };
  }, [
    roomId,
    password,
    nickname,
    stopTimers,
    handlePresence,
    handleMeta,
    createNewRoom,
    publishEncrypted,
    publishPresence,
    scheduleLifecycleCheck,
    scheduleDiveScan,
    scheduleBurn,
    markMessageBurned,
  ]);

  // ── 发送文字消息（乐观上屏 + 失败可重试，FUNC-04 / FUNC-09）────
  const sendMessage = useCallback(
    async (
      content: string,
      burn?: IBurnPolicy,
      privacy?: IMessagePrivacyOptions,
    ): Promise<boolean> => {
      const trimmed = content.trim();
      if (!trimmed) return false;

      /**
       * 归一化隐私选项：`ephemeral` 必须以 `veil` 为前提。
       * 在这里收口一次，避免「自焚但初始可见」这种会让消息无从读起的组合流到下游。
       */
      const veil = privacy?.veil === true;
      const ephemeral = veil && privacy?.ephemeral === true;

      if (!transportRef.current?.isConnected() || !ringRef.current) {
        toast.error('尚未连接聊天服务，消息未发送');
        return false;
      }
      if (roomStatusRef.current !== 'active') {
        toast.error('房间尚未就绪，消息未发送');
        return false;
      }

      const msgId = nextMsgId();
      const timestamp = Date.now();
      /** 定时焚毁的到期时刻：发出即开始计时，避免接收方延迟导致计时不一致 */
      const burnAt = burn?.mode === 'time' ? timestamp + (burn.ttlMs ?? 0) : undefined;

      appendMessage({
        id: msgId,
        nickname: nicknameRef.current,
        content: trimmed,
        timestamp,
        isMine: true,
        senderId: clientIdRef.current,
        msgType: 'text',
        status: 'sending',
        burn,
        burnAt,
        veil,
        ephemeral,
      });
      if (burnAt) scheduleBurn(msgId, burnAt);

      const ok = await publishEncrypted(
        'messages',
        {
          kind: 'chat',
          msgType: 'text',
          id: msgId,
          senderId: clientIdRef.current,
          sender: nicknameRef.current,
          content: trimmed,
          timestamp,
          burn,
          veil: veil || undefined,
          ephemeral: ephemeral || undefined,
        } satisfies ITextPayload & { msgType: string },
        // id / burn 是交给中继的最小明文元数据，用于权威焚毁与回执仲裁
        { id: burn ? msgId : undefined, burn },
      );

      markMessageStatus(msgId, ok ? 'sent' : 'failed');
      if (ok) playOutgoingMessageSound();
      else playSound('chat:error');
      if (!ok) toast.error('消息发送失败，点击该消息可重试');
      return ok;
    },
    [appendMessage, markMessageStatus, publishEncrypted, scheduleBurn],
  );

  // ── 重试发送失败的文字消息 ────────────────────────────────────
  const retryMessage = useCallback(
    async (message: RetryableMessage): Promise<boolean> => {
      if (message.msgType !== 'text' || message.status !== 'failed') return false;
      if (!transportRef.current?.isConnected()) {
        toast.error('尚未连接聊天服务，无法重试');
        return false;
      }

      markMessageStatus(message.id, 'sending');
      // 重试沿用原消息的焚毁策略与已排期的计时，不重新计时
      const ok = await publishEncrypted(
        'messages',
        {
          kind: 'chat',
          msgType: 'text',
          id: message.id,
          senderId: clientIdRef.current,
          sender: nicknameRef.current,
          content: message.content,
          timestamp: message.timestamp,
          burn: message.burn,
          veil: message.veil || undefined,
          ephemeral: message.ephemeral || undefined,
        } satisfies ITextPayload & { msgType: string },
        { id: message.burn ? message.id : undefined, burn: message.burn },
      );

      markMessageStatus(message.id, ok ? 'sent' : 'failed');
      if (!ok) toast.error('重试失败，请检查网络');
      return ok;
    },
    [markMessageStatus, publishEncrypted],
  );

  // ── 发送图片消息 ──────────────────────────────────────────────
  const sendImage = useCallback(
    async (file: File): Promise<boolean> => {
      if (!transportRef.current?.isConnected() || !ringRef.current) {
        toast.error('尚未连接聊天服务，图片未发送');
        return false;
      }
      if (roomStatusRef.current !== 'active') {
        toast.error('房间尚未就绪，图片未发送');
        return false;
      }
      // 原始文件预检：避免解码超大文件把页面卡死
      if (file.size > MAX_UPLOAD_PRECHECK) {
        toast.error(`图片原始体积过大（上限 ${formatFileSize(MAX_UPLOAD_PRECHECK)}）`);
        return false;
      }

      const tempId = nextMsgId('temp_img');
      appendMessage({
        id: tempId,
        nickname: nicknameRef.current,
        content: '图片处理中…',
        timestamp: Date.now(),
        isMine: true,
        msgType: 'system',
        status: 'sending',
      });

      try {
        const [compressed, dims] = await Promise.all([
          compressImage(file),
          getImageDimensions(file),
        ]);

        // 压缩后仍需预检：GIF 不压缩，直接原样发送
        if (compressed.byteLength > MAX_IMAGE_PRECHECK) {
          setMessages((prev) => prev.filter((m) => m.id !== tempId));
          toast.error(
            file.type === 'image/gif'
              ? `动图不支持压缩，请控制在 ${formatFileSize(MAX_IMAGE_PRECHECK)} 以内`
              : `图片压缩后仍超过 ${formatFileSize(MAX_IMAGE_PRECHECK)}，请换一张更小的图片`,
          );
          return false;
        }

        const msgId = nextMsgId();
        const timestamp = Date.now();
        const mime = file.type === 'image/gif' ? 'image/gif' : 'image/jpeg';

        const result = await publishBinaryMessage(
          {
            kind: 'chat',
            msgType: 'image',
            id: msgId,
            senderId: clientIdRef.current,
            sender: nicknameRef.current,
            timestamp,
            imageName: file.name,
            imageWidth: dims.width,
            imageHeight: dims.height,
            imageMime: mime,
          },
          compressed,
        );

        setMessages((prev) => prev.filter((m) => m.id !== tempId));

        if (!result.ok) {
          playSound('chat:error');
          toast.error(
            result.reason === 'too-large'
              ? `图片过大，无法发送（上限 ${formatFileSize(MAX_IMAGE_PRECHECK)}）`
              : '图片发送失败，请检查网络后重试',
          );
          return false;
        }

        // 乐观上屏：不依赖 Broker 回显
        appendMessage({
          id: msgId,
          nickname: nicknameRef.current,
          content: '',
          timestamp,
          isMine: true,
          senderId: clientIdRef.current,
          msgType: 'image',
          status: 'sent',
          imageData: `data:${mime};base64,${bytesToBase64(compressed)}`,
          imageName: file.name,
          imageWidth: dims.width,
          imageHeight: dims.height,
          imageMime: mime,
        });
        return true;
      } catch (err) {
        setMessages((prev) => prev.filter((m) => m.id !== tempId));
        toast.error('图片处理失败');
        logger.error('发送图片失败:', String(err));
        return false;
      }
    },
    [appendMessage, publishBinaryMessage],
  );

  // ── 发送文件消息 ──────────────────────────────────────────────
  const sendFile = useCallback(
    async (file: File): Promise<boolean> => {
      if (!transportRef.current?.isConnected() || !ringRef.current) {
        toast.error('尚未连接聊天服务，文件未发送');
        return false;
      }
      if (roomStatusRef.current !== 'active') {
        toast.error('房间尚未就绪，文件未发送');
        return false;
      }
      if (file.size > MAX_UPLOAD_PRECHECK) {
        toast.error(`文件原始体积过大（上限 ${formatFileSize(MAX_UPLOAD_PRECHECK)}）`);
        return false;
      }
      if (file.size > MAX_FILE_PRECHECK) {
        toast.error(`文件过大，无法发送（上限 ${formatFileSize(MAX_FILE_PRECHECK)}）`);
        return false;
      }

      const tempId = nextMsgId('temp_file');
      appendMessage({
        id: tempId,
        nickname: nicknameRef.current,
        content: '文件处理中…',
        timestamp: Date.now(),
        isMine: true,
        msgType: 'system',
        status: 'sending',
      });

      try {
        const fileData = new Uint8Array(await file.arrayBuffer());
        const msgId = nextMsgId();
        const timestamp = Date.now();
        const ext = file.name.split('.').pop() || '';

        const result = await publishBinaryMessage(
          {
            kind: 'chat',
            msgType: 'file',
            id: msgId,
            senderId: clientIdRef.current,
            sender: nicknameRef.current,
            timestamp,
            fileName: file.name,
            fileSize: file.size,
            fileType: ext,
          },
          fileData,
        );

        setMessages((prev) => prev.filter((m) => m.id !== tempId));

        if (!result.ok) {
          playSound('chat:error');
          toast.error(
            result.reason === 'too-large'
              ? `文件过大，无法发送（上限 ${formatFileSize(MAX_FILE_PRECHECK)}）`
              : '文件发送失败，请检查网络后重试',
          );
          return false;
        }

        // 乐观上屏：本地已有完整数据，无需等待回显
        appendMessage({
          id: msgId,
          nickname: nicknameRef.current,
          content: '',
          timestamp,
          isMine: true,
          senderId: clientIdRef.current,
          msgType: 'file',
          status: 'sent',
          fileName: file.name,
          fileSize: file.size,
          fileType: ext,
          fileData,
        });
        return true;
      } catch (err) {
        setMessages((prev) => prev.filter((m) => m.id !== tempId));
        toast.error('文件处理失败');
        logger.error('发送文件失败:', String(err));
        return false;
      }
    },
    [appendMessage, publishBinaryMessage],
  );

  return {
    status,
    messages,
    onlineUsers,
    roomMeta,
    roomStatus,
    clientId: clientIdRef.current,
    sendMessage,
    sendImage,
    sendFile,
    retryMessage,
    extendRoom,
    /**
     * 移除一条消息（阅后自焚超时、或窗口失焦时由界面调用）。
     * 复用焚毁的移除链路：先呈现「已销毁」，淡出后再从列表移除。
     */
    consumeMessage: markMessageBurned,
    /** 正在输入的其他人（开关关闭时恒为空数组） */
    typers: typing.typers,
    /** 由输入框在内容变化时调用，内部完成节流与上报 */
    notifyTyping,
  };
}
