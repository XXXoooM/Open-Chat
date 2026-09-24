// EXPORTS: ChannelName, ProtocolVersion, TransportStatus, TransportKind, TransportControl,
//          ITransportConfig, ITransportMessage, ITransportStatusEvent, IPublishOptions,
//          ITransport, ITransportReadiness

import type { IBurnPolicy } from '@shared/relay/protocol';

/**
 * 传输层接口（单一事实来源）。
 *
 * 抽象目的：把具体传输收敛到统一契约，使业务逻辑不依赖 mqtt.js 或中继任一方，
 * 从而做到「一条环境变量切换通路」且业务代码零改动。
 *
 * 迁移自原有实现的关键语义，必须保持：
 * - 发布带确认：`ack` 为 true（默认）时等待传输层确认，超时视为失败（原 FUNC-09）
 * - 频道是业务语义，协议版本决定落地到哪一组地址（v1 历史 / v2 带密码派生命名空间）
 */

/** 业务频道。typing / receipts 是本次新增能力 */
export type ChannelName = 'messages' | 'presence' | 'meta' | 'typing' | 'receipts';

/** 协议版本：决定落地地址，与密钥派生版本（KDF）是两个独立维度 */
export type ProtocolVersion = 1 | 2;

export type TransportKind = 'mqtt' | 'relay';

export type TransportStatus =
  | 'connecting'
  | 'connected'
  | 'disconnected'
  /** 重连不会自行恢复（凭据被拒 / 中继连续拒绝连接），需修正配置 */
  | 'auth-error';

/**
 * 传输层控制事件（与「频道报文」分离的一类信令）。
 *
 * 只有具备服务端仲裁能力的通路才会产生控制事件：
 * - 中继通路：由 Durable Object 下发离职、房间关闭、已读与焚毁指令
 * - MQTT 通路：不产生控制事件（离职以遗嘱报文出现在 presence 频道，
 *   房间关闭以空 retained meta 表达），因此注册后不会收到任何回调
 */
export type TransportControl =
  | { kind: 'peer-left'; id: string }
  | { kind: 'room-closed' }
  | { kind: 'receipt'; id: string; readBy: number; total: number }
  | { kind: 'burn'; id: string }
  | { kind: 'error'; code: string; message: string };

export interface ITransportConfig {
  roomId: string;
  /** 密码派生命名空间；为 null 时退化为不含命名空间的 v1 地址（仅 MQTT 通路可用） */
  namespace: string | null;
  clientId: string;
  /** 会话标识哈希：MQTT 遗嘱用它识别离开者 */
  sid: string;
}

export interface ITransportMessage {
  channel: ChannelName;
  /** 原始报文文本（密文信封 JSON，或带内标识的最小控制帧） */
  payload: string;
  /** 是否为服务端补发（MQTT retained / 中继的权威状态回放） */
  retained: boolean;
}

export interface ITransportStatusEvent {
  status: TransportStatus;
  /**
   * 订阅是否就绪。
   * 仅 `status === 'connected'` 时可能为 true：MQTT 指 SUBACK 成功，
   * 中继指服务端已确认频道订阅（此前发布会被拒绝）。
   */
  ready: boolean;
  /** 已脱敏的诊断信息，仅供日志使用 */
  detail?: string;
}

export interface IPublishOptions {
  qos?: 0 | 1 | 2;
  retain?: boolean;
  /** 是否等待确认；false 用于高频低价值报文（如输入指示），发即忘 */
  ack?: boolean;
  /** 协议版本：决定发往 v1 还是 v2 地址；缺省按 v2 */
  proto?: ProtocolVersion;
  /**
   * 焚毁语义的最小元数据（仅中继通路消费；MQTT 通路忽略）。
   * 注意：MQTT 通路下焚毁退化为「仅本地定时清除」，中继通路才是服务端权威。
   */
  id?: string;
  burn?: IBurnPolicy;
}

export interface ITransport {
  readonly kind: TransportKind;
  connect(): void;
  close(): void;
  isConnected(): boolean;
  /** 注册入站频道报文处理器，返回取消注册函数 */
  onMessage(handler: (msg: ITransportMessage) => void): () => void;
  /** 注册控制事件处理器，返回取消注册函数 */
  onControl(handler: (evt: TransportControl) => void): () => void;
  /** 注册连接状态变化处理器，返回取消注册函数 */
  onStatusChange(handler: (evt: ITransportStatusEvent) => void): () => void;
  publish(channel: ChannelName, payload: string, opts?: IPublishOptions): Promise<boolean>;
  /**
   * 上报「已读」。
   * 仅中继通路有服务端可接收该信号（用于权威焚毁与回执计数）；
   * MQTT 通路为无操作 —— 此时焚毁退化为本地定时清除，界面会显式标注这一差异。
   */
  markRead(id: string): void;
}

/**
 * 传输层可用性。
 * 业务侧据此在界面上显式说明「缺少哪些配置」，而不是静默地连不上。
 */
export interface ITransportReadiness {
  ready: boolean;
  hint: string;
}
