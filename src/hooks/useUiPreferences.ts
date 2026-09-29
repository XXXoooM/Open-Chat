// EXPORTS: IUiPreferences, DEFAULT_UI_PREFERENCES, UI_PREFERENCES_KEY, MAX_RECENT_EMOJI,
//          getUiPreferences, subscribeUiPreferences, updateUiPreferences, pushRecentEmoji, useUiPreferences

import { useSyncExternalStore } from 'react';
import { logger } from '@/lib/logger';
import { applySoundPreferences } from '@/lib/sound/engine';
import { storage } from '@/lib/storage';

/**
 * 界面偏好（音效 / 表情图片渲染 / 最近使用表情）的单一事实来源。
 *
 * ## 为什么是模块级 store + useSyncExternalStore，而不是 Context
 *
 * 这些偏好被三处消费：顶栏设置菜单、输入区表情面板、消息列表的表情渲染。
 * 若用 Context 广播，任何一次音量拖动都会让整棵树（含长消息列表）重渲染。
 * 模块级 store 只让**真正读取该值的组件**更新，消息列表在开关未变时不受影响。
 *
 * ## 为什么只用一个存储键
 *
 * 四项偏好聚合成一个 JSON 存在 `__global_ui_preferences`（延续项目既有
 * `__global_*` 键约定）。单键的好处是**读写原子**：不会出现「音效开关写了、
 * 音量没写」的半更新状态；同时带 `v` 版本号，将来改结构时可按版本迁移。
 *
 * ## 为什么音效偏好由本项目权威持有
 *
 * `@usespaceui/sounds` 的 `hydrate()/getSettings()` 在上游文档中**未定义是否落盘**，
 * 且源码中未发现任何 `localStorage` 痕迹。若两边都写，会出现「刷新后状态互相覆盖」。
 * 因此：本项目存储为准，每次变更都显式下发 `setEnabled/setVolume` 覆盖库内状态。
 */

/** 存储键（延续项目既有 `__global_*` 约定） */
export const UI_PREFERENCES_KEY = '__global_ui_preferences';

/** 最近使用表情的条数上限 */
export const MAX_RECENT_EMOJI = 24;

/** 音效默认音量：0.7 在笔记本扬声器上清晰可辨，又不至于盖过语音 */
const DEFAULT_SOUND_VOLUME = 0.7;

export interface IUiPreferences {
  /** 音效总开关 */
  soundEnabled: boolean;
  /** 音效音量（0~1） */
  soundVolume: number;
  /** 消息中的表情是否渲染为图片；关闭后完全不加载表情相关代码与 CDN 资源 */
  emojiImageEnabled: boolean;
  /**
   * 表情是否渲染为**动画**（Fluent 动图）。
   * 关闭后改用静态 3D 图：观感恒定，且不持续占用解码与合成资源（省电、低端设备更稳）。
   */
  emojiAnimated: boolean;
  /** 最近使用的表情字符（最近的在前） */
  recentEmoji: string[];
}

export const DEFAULT_UI_PREFERENCES: IUiPreferences = {
  soundEnabled: true,
  soundVolume: DEFAULT_SOUND_VOLUME,
  emojiImageEnabled: true,
  emojiAnimated: true,
  recentEmoji: [],
};

/** 存档结构版本号：字段增删时据此迁移，而不是静默丢失用户设置 */
const SCHEMA_VERSION = 1;

let state: IUiPreferences | null = null;
const listeners = new Set<() => void>();

function clampVolume(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_SOUND_VOLUME;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function readFromStorage(): IUiPreferences {
  const next: IUiPreferences = { ...DEFAULT_UI_PREFERENCES };
  const raw = storage.getItem(UI_PREFERENCES_KEY);
  if (!raw) return next;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return next;
    const record = parsed as Record<string, unknown>;

    // 逐字段校验：存档可能来自旧版本或被手工改过，单字段非法只回落该字段
    if (typeof record.soundEnabled === 'boolean') next.soundEnabled = record.soundEnabled;
    if (typeof record.emojiImageEnabled === 'boolean') {
      next.emojiImageEnabled = record.emojiImageEnabled;
    }
    // 旧存档没有该字段时保持默认（开），不会把用户设置静默降级为静态
    if (typeof record.emojiAnimated === 'boolean') next.emojiAnimated = record.emojiAnimated;
    next.soundVolume = clampVolume(record.soundVolume);
    if (Array.isArray(record.recentEmoji)) {
      next.recentEmoji = record.recentEmoji
        .filter((item): item is string => typeof item === 'string' && item.length > 0)
        .slice(0, MAX_RECENT_EMOJI);
    }
  } catch (error) {
    logger.warn('界面偏好存档解析失败，已回落默认值', error);
  }
  return next;
}

function persist(next: IUiPreferences): void {
  try {
    storage.setItem(
      UI_PREFERENCES_KEY,
      JSON.stringify({
        v: SCHEMA_VERSION,
        soundEnabled: next.soundEnabled,
        soundVolume: next.soundVolume,
        emojiImageEnabled: next.emojiImageEnabled,
        emojiAnimated: next.emojiAnimated,
        recentEmoji: next.recentEmoji,
      }),
    );
  } catch (error) {
    // storage 内部已 try/catch，这里只兜住 JSON 序列化异常
    logger.warn('界面偏好写入失败，本次会话内仍生效', error);
  }
}

function emit(): void {
  listeners.forEach((listener) => listener());
}

/**
 * 读取当前偏好。
 * 首次调用时从存储惰性加载（不在模块初始化期读盘，避免导入即产生副作用）。
 */
export function getUiPreferences(): IUiPreferences {
  if (!state) state = readFromStorage();
  return state;
}

export function subscribeUiPreferences(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function isSamePreferences(a: IUiPreferences, b: IUiPreferences): boolean {
  return (
    a.soundEnabled === b.soundEnabled &&
    a.soundVolume === b.soundVolume &&
    a.emojiImageEnabled === b.emojiImageEnabled &&
    a.emojiAnimated === b.emojiAnimated &&
    a.recentEmoji.length === b.recentEmoji.length &&
    a.recentEmoji.every((char, index) => char === b.recentEmoji[index])
  );
}

/**
 * 更新偏好。值未发生变化时不写盘、不通知 —— 滑块拖动会高频触发，
 * 无变化时提前返回可避免无意义的存储写入与重渲染。
 */
export function updateUiPreferences(patch: Partial<IUiPreferences>): void {
  const previous = getUiPreferences();
  const next: IUiPreferences = { ...previous, ...patch };
  if (patch.soundVolume !== undefined) next.soundVolume = clampVolume(patch.soundVolume);
  if (patch.recentEmoji) next.recentEmoji = patch.recentEmoji.slice(0, MAX_RECENT_EMOJI);

  if (isSamePreferences(previous, next)) return;
  state = next;
  persist(next);

  if (patch.soundEnabled !== undefined || patch.soundVolume !== undefined) {
    applySoundPreferences({ enabled: next.soundEnabled, volume: next.soundVolume });
  }
  emit();
}

/** 记录一次表情使用：去重后置顶，超出上限截断。 */
export function pushRecentEmoji(char: string): void {
  if (!char) return;
  const previous = getUiPreferences().recentEmoji;
  const next = [char, ...previous.filter((item) => item !== char)].slice(0, MAX_RECENT_EMOJI);
  updateUiPreferences({ recentEmoji: next });
}

/** 订阅界面偏好。组件只在偏好变化时重渲染。 */
export function useUiPreferences(): IUiPreferences {
  return useSyncExternalStore(subscribeUiPreferences, getUiPreferences, getUiPreferences);
}

/**
 * 只订阅「表情是否图片化」这一个派生布尔值。
 *
 * `useSyncExternalStore` 用 `Object.is` 比较快照：音量变化时这里拿到的仍是同一个
 * `true`/`false`，因此**消息列表不会因为拖动音量而重渲染**。若直接订阅整个偏好对象，
 * 消息列表会在音量滑块的每一次变化上跟着重渲染，属于典型的无谓开销。
 */
export function useEmojiImageEnabled(): boolean {
  return useSyncExternalStore(
    subscribeUiPreferences,
    () => getUiPreferences().emojiImageEnabled,
    () => DEFAULT_UI_PREFERENCES.emojiImageEnabled,
  );
}

/**
 * 只订阅「表情是否播放动画」这一派生布尔值。
 * 与 `useEmojiImageEnabled` 同理：关闭动画开关只让消息列表重渲染一次，
 * 拖动音量不会牵连。
 */
export function useEmojiAnimated(): boolean {
  return useSyncExternalStore(
    subscribeUiPreferences,
    () => getUiPreferences().emojiAnimated,
    () => DEFAULT_UI_PREFERENCES.emojiAnimated,
  );
}

/** 只订阅「最近使用表情」数组（引用仅在内容变化时改变）。 */
export function useRecentEmoji(): string[] {
  return useSyncExternalStore(
    subscribeUiPreferences,
    () => getUiPreferences().recentEmoji,
    () => DEFAULT_UI_PREFERENCES.recentEmoji,
  );
}
