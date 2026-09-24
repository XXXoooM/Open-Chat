// EXPORTS: IPrivacySettings, DEFAULT_PRIVACY_SETTINGS, readPrivacySettings, writePrivacySettings

import { readStoredPrivacySettings, writeStoredPrivacySettings } from '@/lib/chatStorage';
import { DEFAULT_BURN_TTL_MS_OPTION, type BurnModeOption } from '@/lib/burnPolicy';

/**
 * 隐私开关（单一事实来源）。
 *
 * 默认值刻意采用「隐私优先」：
 * - 输入指示默认关闭：暴露的是「意图」，比在线状态更敏感，应由用户主动开启
 * - 失焦模糊默认开启：不涉及他人，纯本地行为，默认保护更合理
 * - 焚毁默认关闭：发送行为应显式选择，避免误以为消息会自动消失
 */
export interface IPrivacySettings {
  /** 向他人显示「正在输入」 */
  typingIndicator: boolean;
  /** 窗口失焦 / 切换标签页时模糊会话内容 */
  blurOnBlur: boolean;
  /** 发送时默认采用的焚毁模式 */
  burnMode: BurnModeOption;
  /** 定时焚毁的默认时长 */
  burnTtlMs: number;
}

export const DEFAULT_PRIVACY_SETTINGS: IPrivacySettings = {
  typingIndicator: false,
  blurOnBlur: true,
  burnMode: 'off',
  burnTtlMs: DEFAULT_BURN_TTL_MS_OPTION,
};

function isBurnModeOption(value: unknown): value is BurnModeOption {
  return value === 'off' || value === 'time' || value === 'read';
}

/**
 * 读取隐私开关。
 * 逐字段校验而不是整体信任存储内容：存档可能来自旧版本或被手工改过，
 * 单个字段非法时只回落该字段，不影响其余设置。
 */
export function readPrivacySettings(): IPrivacySettings {
  const stored = readStoredPrivacySettings();
  if (!stored) return { ...DEFAULT_PRIVACY_SETTINGS };

  const next: IPrivacySettings = { ...DEFAULT_PRIVACY_SETTINGS };
  if (typeof stored.typingIndicator === 'boolean') next.typingIndicator = stored.typingIndicator;
  if (typeof stored.blurOnBlur === 'boolean') next.blurOnBlur = stored.blurOnBlur;
  if (isBurnModeOption(stored.burnMode)) next.burnMode = stored.burnMode;
  if (typeof stored.burnTtlMs === 'number' && Number.isFinite(stored.burnTtlMs)) {
    next.burnTtlMs = stored.burnTtlMs;
  }
  return next;
}

export function writePrivacySettings(settings: IPrivacySettings): void {
  writeStoredPrivacySettings({ ...settings });
}
