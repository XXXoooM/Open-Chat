// EXPORTS: NICKNAME_KEY, ROOM_ID_KEY, readStoredNickname, readStoredRoomId,
//          writeStoredChatIdentity, readSessionPassword, writeSessionPassword, clearSessionPassword

import { scopedStorage } from '@lark-apaas/client-toolkit-lite';

/**
 * 聊天室本地存储的单一事实来源。
 *
 * 修复 AUDIT.md `ENG-01`：此前 NICKNAME_KEY / ROOM_ID_KEY 在
 * `ChatPage.tsx` 与 `NicknameInputSection.tsx` 中各定义一份，改名时容易只改一侧。
 *
 * 密码单独处理（`FUNC-06`）：
 * - 昵称/房间号属于低敏信息，放入平台 scopedStorage 长期保留，便于下次自动回填
 * - 密码只写入 sessionStorage：刷新页面可恢复连接，关闭标签页即失效，
 *   既不进入长期存储，也不随构建产物分发（不会硬编码在源码里）
 */

export const NICKNAME_KEY = '__global_chat_nickname';
export const ROOM_ID_KEY = '__global_chat_room_id';
export const PRIVACY_SETTINGS_KEY = '__global_privacy_settings';
const PASSWORD_KEY = '__global_chat_password';

export function readStoredNickname(): string {
  return scopedStorage.getItem(NICKNAME_KEY) ?? '';
}

export function readStoredRoomId(): string {
  return scopedStorage.getItem(ROOM_ID_KEY) ?? '';
}

export function writeStoredChatIdentity(roomId: string, nickname: string): void {
  scopedStorage.setItem(ROOM_ID_KEY, roomId);
  scopedStorage.setItem(NICKNAME_KEY, nickname);
}

export function readSessionPassword(): string {
  try {
    return sessionStorage.getItem(PASSWORD_KEY) ?? '';
  } catch {
    return '';
  }
}

export function writeSessionPassword(password: string): void {
  try {
    if (password) sessionStorage.setItem(PASSWORD_KEY, password);
    else sessionStorage.removeItem(PASSWORD_KEY);
  } catch {
    // 隐私模式等场景下 sessionStorage 不可用，静默降级为「不记忆密码」
  }
}

export function clearSessionPassword(): void {
  writeSessionPassword('');
}

/**
 * 隐私开关的原始读写。
 * 这里刻意只做「字符串 ↔ 普通对象」的搬运，不含默认值与字段语义 ——
 * 那些属于 `privacySettings.ts` 的职责，避免两个模块互相依赖。
 * 解析失败一律返回 null，由上层回落到默认值。
 */
export function readStoredPrivacySettings(): Record<string, unknown> | null {
  const raw = scopedStorage.getItem(PRIVACY_SETTINGS_KEY);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function writeStoredPrivacySettings(settings: Record<string, unknown>): void {
  try {
    scopedStorage.setItem(PRIVACY_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // 存储不可用时静默降级为「本次会话内有效」
  }
}
