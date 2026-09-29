// EXPORTS: BurnMode, IBurnPolicy, RelayChannel, IRoomRecord, ClientFrame, ServerFrame,
//          RELAY_CHANNELS, RELAY_MAX_FRAME_BYTES, RELAY_MAX_BURN_MARKS, RELAY_SWEEP_INTERVAL_MS,
//          RELAY_SOCKET_TIMEOUT_MS, RELAY_MAX_ROOM_MS, MIN_BURN_TTL_MS, MAX_BURN_TTL_MS,
//          DEFAULT_BURN_TTL_MS, READ_BURN_FALLBACK_MS, isRelayChannel, parseClientFrame,
//          parseServerFrame, encodeFrame, normalizeBurnPolicy, computeBurnAt, clampDestroyAt

/**
 * 中继帧协议（前后端共享的单一事实来源）。
 *
 * 隐私边界（不可越过）：`env` 字段是客户端已完成端到端加密的密文信封，
 * 中继只做不透明转发，**不得**尝试解析、解密或落盘其内容。
 *
 * 中继可见的明文元数据被刻意压到最小：消息 id、焚毁策略、房间销毁时间。
 * 发送者身份由中继从连接本身获知，不需要额外的明文字段。
 */

export type BurnMode = 'off' | 'time' | 'read';

export interface IBurnPolicy {
  mode: BurnMode;
  /** 仅 mode === 'time' 有效 */
  ttlMs?: number;
}

/** 中继频道，与前端传输层的 ChannelName 一一对应 */
export type RelayChannel = 'messages' | 'presence' | 'meta' | 'typing' | 'receipts';

export const RELAY_CHANNELS: readonly RelayChannel[] = [
  'messages',
  'presence',
  'meta',
  'typing',
  'receipts',
];

/** 房间寿命记录（中继用于权威裁决到期与 Alarm 调度） */
export interface IRoomRecord {
  createdAt: number;
  destroyAt: number;
}

// ── 客户端 → 中继 ──────────────────────────────────────────────

export interface IHelloFrame {
  t: 'hello';
  channels: RelayChannel[];
}

export interface IPubFrame {
  t: 'pub';
  channel: RelayChannel;
  /** 密文信封（JSON 字符串），中继不可解读 */
  env: string;
  /** 具备焚毁语义的消息必须有 id，中继据此登记焚毁标记 */
  id?: string;
  burn?: IBurnPolicy;
  /** meta 频道为「权威保留状态」，中继会为后来者回放最近一条 */
  retain?: boolean;
  /** 仅 meta 频道：房间寿命记录 */
  room?: IRoomRecord;
}

export interface IReadFrame {
  t: 'read';
  id: string;
}

export interface IPingFrame {
  t: 'ping';
}

export type ClientFrame = IHelloFrame | IPubFrame | IReadFrame | IPingFrame;

// ── 中继 → 客户端 ──────────────────────────────────────────────

export interface IReadyFrame {
  t: 'ready';
}

export interface IMsgFrame {
  t: 'msg';
  channel: RelayChannel;
  env: string;
  id?: string;
  burn?: IBurnPolicy;
  /** 是否为权威状态回放（等价 MQTT retained） */
  retained?: boolean;
}

export interface IReceiptFrame {
  t: 'receipt';
  id: string;
  /** 已读人数与应读人数：只广播计数，不广播身份 */
  readBy: number;
  total: number;
}

export interface IBurnFrame {
  t: 'burn';
  id: string;
}

export interface IPeerLeftFrame {
  t: 'peer-left';
  id: string;
}

export interface IClosedFrame {
  t: 'closed';
}

export interface IPongFrame {
  t: 'pong';
}

export interface IErrorFrame {
  t: 'error';
  code: string;
  message: string;
}

export type ServerFrame =
  | IReadyFrame
  | IMsgFrame
  | IReceiptFrame
  | IBurnFrame
  | IPeerLeftFrame
  | IClosedFrame
  | IPongFrame
  | IErrorFrame;

// ── 限额与节奏 ────────────────────────────────────────────────

/** 单帧上限，与前端 MAX_PAYLOAD_BYTES 同量级，留出协议开销 */
export const RELAY_MAX_FRAME_BYTES = 1024 * 1024;
/** 焚毁标记保留条数上限：有界避免无限增长 */
export const RELAY_MAX_BURN_MARKS = 2000;
/** 统一清扫间隔（失活连接、到期焚毁） */
export const RELAY_SWEEP_INTERVAL_MS = 60000;
/**
 * 连接失活阈值：超过即视为半开连接并主动关闭。
 *
 * **必须覆盖浏览器对隐藏标签页的定时器节流**：Chrome 对隐藏标签页的定时器最慢
 * 可降到约 1 次/分钟，此时客户端 20 秒的保活 ping 实际会变成约 60 秒一次。
 * 阈值若取 45 秒，健康的后台连接会被周期性误杀 —— 客户端随即重连，形成
 * 「每分钟重连一次」的循环，每次都要付一次 Worker fetch + DO 唤醒 + 附件写 + Alarm 重排。
 *
 * 取 120 秒 = 节流后保活间隔的 2 倍，并与客户端本地兜底超时保持一致
 * （客户端该兜底直接引用本常量，避免两处数值漂移）。
 */
export const RELAY_SOCKET_TIMEOUT_MS = 120000;
/** 房间寿命上限，防止异常的 destroyAt 把房间锁死 */
export const RELAY_MAX_ROOM_MS = 24 * 60 * 60 * 1000;

export const MIN_BURN_TTL_MS = 5000;
export const MAX_BURN_TTL_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_BURN_TTL_MS = 60000;

/**
 * 读后焚毁的兜底上限。
 * 若房间内始终有人未读，读后焚毁会永不触发：发送方永远等不到确认，
 * 且「待全员已读」的中间态会一直占用存储。到点即按焚毁处理，语义上更确定。
 */
export const READ_BURN_FALLBACK_MS = 30 * 60 * 1000;

export function isRelayChannel(value: unknown): value is RelayChannel {
  return typeof value === 'string' && RELAY_CHANNELS.includes(value as RelayChannel);
}

/**
 * 解析入站帧。
 * 只做结构性校验：中继无法校验密文内容，也不应尝试。
 */
export function parseClientFrame(raw: string): ClientFrame | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;

  const frame = parsed as Record<string, unknown>;
  if (frame.t === 'ping') return { t: 'ping' };
  if (frame.t === 'read') {
    if (typeof frame.id !== 'string' || !frame.id) return null;
    return { t: 'read', id: frame.id };
  }
  if (frame.t === 'hello') {
    const channels = Array.isArray(frame.channels)
      ? frame.channels.filter(isRelayChannel)
      : [];
    return { t: 'hello', channels };
  }
  if (frame.t === 'pub') {
    if (!isRelayChannel(frame.channel)) return null;
    if (typeof frame.env !== 'string') return null;
    const out: IPubFrame = { t: 'pub', channel: frame.channel, env: frame.env };
    if (typeof frame.id === 'string' && frame.id) out.id = frame.id;
    if (frame.retain === true) out.retain = true;
    const burn = normalizeBurnPolicy(frame.burn);
    if (burn) out.burn = burn;
    const room = normalizeRoomRecord(frame.room);
    if (room) out.room = room;
    return out;
  }
  return null;
}

export function encodeFrame(frame: ServerFrame): string {
  return JSON.stringify(frame);
}

/**
 * 解析中继下发的帧（客户端侧）。
 * 与 parseClientFrame 对称：只做结构性校验，未知帧一律忽略，
 * 使服务端将来新增帧类型时旧客户端不会崩。
 */
export function parseServerFrame(raw: string): ServerFrame | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;

  const frame = parsed as Record<string, unknown>;
  if (frame.t === 'ready') return { t: 'ready' };
  if (frame.t === 'pong') return { t: 'pong' };
  if (frame.t === 'closed') return { t: 'closed' };
  if (frame.t === 'msg') {
    if (!isRelayChannel(frame.channel) || typeof frame.env !== 'string') return null;
    const out: IMsgFrame = { t: 'msg', channel: frame.channel, env: frame.env };
    if (typeof frame.id === 'string' && frame.id) out.id = frame.id;
    if (frame.retained === true) out.retained = true;
    const burn = normalizeBurnPolicy(frame.burn);
    if (burn) out.burn = burn;
    return out;
  }
  if (frame.t === 'receipt') {
    if (typeof frame.id !== 'string') return null;
    return {
      t: 'receipt',
      id: frame.id,
      readBy: typeof frame.readBy === 'number' ? frame.readBy : 0,
      total: typeof frame.total === 'number' ? frame.total : 0,
    };
  }
  if (frame.t === 'burn') {
    if (typeof frame.id !== 'string') return null;
    return { t: 'burn', id: frame.id };
  }
  if (frame.t === 'peer-left') {
    if (typeof frame.id !== 'string') return null;
    return { t: 'peer-left', id: frame.id };
  }
  if (frame.t === 'error') {
    return {
      t: 'error',
      code: typeof frame.code === 'string' ? frame.code : 'unknown',
      message: typeof frame.message === 'string' ? frame.message : '',
    };
  }
  return null;
}

export function normalizeBurnPolicy(value: unknown): IBurnPolicy | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  if (raw.mode === 'read') return { mode: 'read' };
  if (raw.mode === 'time') {
    const ttl = typeof raw.ttlMs === 'number' ? raw.ttlMs : DEFAULT_BURN_TTL_MS;
    return { mode: 'time', ttlMs: Math.min(Math.max(ttl, MIN_BURN_TTL_MS), MAX_BURN_TTL_MS) };
  }
  if (raw.mode === 'off') return { mode: 'off' };
  return undefined;
}

function normalizeRoomRecord(value: unknown): IRoomRecord | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  if (typeof raw.destroyAt !== 'number' || !Number.isFinite(raw.destroyAt)) return undefined;
  const createdAt = typeof raw.createdAt === 'number' ? raw.createdAt : Date.now();
  return { createdAt, destroyAt: raw.destroyAt };
}

/**
 * 定时焚毁时刻计算。
 * 只有 mode === 'time' 会得到具体时刻；'off' 与 'read' 都返回 null ——
 * 读后焚毁不是时间点，而由中继以「待全员已读」独立跟踪（并受 READ_BURN_FALLBACK_MS 兜底）。
 */
export function computeBurnAt(policy: IBurnPolicy, now: number): number | null {
  if (policy.mode !== 'time') return null;
  const ttl = Math.min(Math.max(policy.ttlMs ?? DEFAULT_BURN_TTL_MS, MIN_BURN_TTL_MS), MAX_BURN_TTL_MS);
  return now + ttl;
}

/** 约束房间销毁时间：不允许过短（立即销毁）或超过上限 */
export function clampDestroyAt(destroyAt: number, now: number): number {
  const upper = now + RELAY_MAX_ROOM_MS;
  return Math.min(Math.max(destroyAt, now + 1000), upper);
}
