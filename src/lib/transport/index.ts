// EXPORTS: createTransport, getTransportReadiness, getTransportKind

import { BROKER_CONFIG_HINT, HAS_BROKER_CONFIG } from '@/lib/mqttConfig';
import { HAS_RELAY_CONFIG } from '@/lib/relayConfig';
import { createMqttTransport } from './mqttTransport';
import { createRelayTransport } from './relayTransport';
import type {
  ITransport,
  ITransportConfig,
  ITransportReadiness,
  TransportKind,
} from './types';

export type {
  ChannelName,
  IPublishOptions,
  ITransport,
  ITransportConfig,
  ITransportMessage,
  ITransportReadiness,
  ITransportStatusEvent,
  ProtocolVersion,
  TransportControl,
  TransportKind,
  TransportStatus,
} from './types';

/**
 * 传输层可用性检查（唯一判定点）。
 * 中继优先：只要配置了 VITE_RELAY_URL 即认为该通路可用 ——
 * 中继的准入由「房间地址 = 房间号 + 密码派生命名空间」承担，不需要额外凭据。
 */
export function getTransportReadiness(): ITransportReadiness {
  if (HAS_RELAY_CONFIG) return { ready: true, hint: '' };
  return { ready: HAS_BROKER_CONFIG, hint: BROKER_CONFIG_HINT };
}

/** 当前实际使用的通路，用于界面标注「该能力在当前连接方式下不可用」 */
export function getTransportKind(): TransportKind {
  return HAS_RELAY_CONFIG ? 'relay' : 'mqtt';
}

/**
 * 创建传输实例。
 *
 * - 配置了 VITE_RELAY_URL → 中继通路（服务端权威焚毁与已读回执可用）
 * - 未配置 → MQTT 通路（原有行为完全不变，作为回滚路径）
 *
 * 中继必须用密码派生命名空间定位房间；缺失命名空间时回落到 MQTT，
 * 绝不把裸房间号交给中继（否则房间变得可枚举，属安全回退）。
 */
export function createTransport(config: ITransportConfig): ITransport {
  if (HAS_RELAY_CONFIG && config.namespace) return createRelayTransport(config);
  return createMqttTransport(config);
}
