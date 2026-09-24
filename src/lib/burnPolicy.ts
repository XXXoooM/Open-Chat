// EXPORTS: BurnModeOption, IBurnModeOption, BURN_MODE_OPTIONS, BURN_TTL_OPTIONS,
//          DEFAULT_BURN_TTL_MS_OPTION, BURN_FADE_MS, toBurnPolicy, formatBurnTtl,
//          formatBurnCountdown, burnBadgeLabel, BURN_BOUNDARY_HINT, BURN_UNAVAILABLE_HINT

import type { IBurnPolicy } from '@shared/relay/protocol';

/** 发送时的焚毁模式（与中继协议的 BurnMode 同名，'off' 表示不启用） */
export type BurnModeOption = 'off' | 'time' | 'read';

/** 可选时长，均落在中继侧允许区间（5s ~ 24h）内 */
export const BURN_TTL_OPTIONS = [30_000, 60_000, 300_000] as const;
export const DEFAULT_BURN_TTL_MS_OPTION = 60_000;

/** 焚毁后的淡出时长：给界面一次「确认已销毁」的视觉反馈 */
export const BURN_FADE_MS = 800;

export interface IBurnModeOption {
  value: BurnModeOption;
  label: string;
  hint: string;
}

export const BURN_MODE_OPTIONS: IBurnModeOption[] = [
  { value: 'off', label: '关闭', hint: '消息按普通消息处理' },
  { value: 'time', label: '定时', hint: '到点自动销毁' },
  { value: 'read', label: '读后', hint: '对方看过即销毁' },
];

export function toBurnPolicy(mode: BurnModeOption, ttlMs: number): IBurnPolicy | undefined {
  if (mode === 'off') return undefined;
  if (mode === 'read') return { mode: 'read' };
  return { mode: 'time', ttlMs };
}

export function formatBurnTtl(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)} 秒`;
  return `${Math.round(ms / 60_000)} 分钟`;
}

/** 倒计时文案：刻意保持极短，避免在消息角落的小徽标里换行 */
export function formatBurnCountdown(remainingMs: number): string {
  const total = Math.max(0, Math.ceil(remainingMs / 1000));
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return seconds === 0 ? `${minutes}m` : `${minutes}m${String(seconds).padStart(2, '0')}s`;
}

export function burnBadgeLabel(burn: IBurnPolicy | undefined, burned: boolean): string {
  if (burned) return '已焚毁';
  if (!burn) return '';
  return burn.mode === 'read' ? '待读' : '定时';
}

/**
 * 能力边界（必须如实呈现，不得承诺做不到的事）。
 * 中继能保证：销毁后不再向任何人投递、自身不保留密文、发送方获得已读确认。
 * 无法保证：阻止截屏拍屏；强制被修改过的客户端删除本地明文。
 */
export const BURN_BOUNDARY_HINT =
  '焚毁由服务端仲裁：销毁后不再向任何人投递，中继也不保留密文副本。但无法阻止截屏或拍屏，也无法强制被改过的客户端删除本地明文。';

/** MQTT 通路下的能力降级说明（状态透明：不伪装成服务端权威） */
export const BURN_UNAVAILABLE_HINT =
  '当前为 MQTT 通路：「读后」焚毁与已读回执不可用，「定时」焚毁仅为本地销毁。配置 VITE_RELAY_URL 后启用服务端仲裁。';
