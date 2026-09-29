// EXPORTS: SoundTrigger, initSoundEngine, applySoundPreferences, primeSoundOnFirstGesture, triggerSound, watchSoundSettings

import {
  bind,
  getSettings,
  play,
  setEnabled,
  setRespectReducedMotion,
  setVolume,
  subscribe,
  type PlayOptions,
  type SpaceSoundName,
} from '@usespaceui/sounds';
import { logger } from '@/lib/logger';

/**
 * 音效接入层 —— `@usespaceui/sounds` 的薄封装。
 *
 * ## 为什么需要这一层
 *
 * 1. **它是装饰，不是功能**：音效失败绝不允许影响聊天。库内所有触发函数都是
 *    fire-and-forget（返回 void），但**未初始化的音频上下文可能抛错**，因此这里
 *    统一包一层 `safeCall`，失败只记一次告警。
 * 2. **官方没有 Provider**：上游只演示「自己写一个组件调一次 `bind()`」。这里把
 *    绑定、解锁、偏好下发集中到一处，`SoundProvider` 只负责生命周期。
 * 3. **音效 ID 必须以包内类型为准**：官网 matrix 文档页写的 `openOverlay` /
 *    `chimeTone` / `loadingStatus` 等**是展示名，代码里不存在**。本层的参数类型
 *    直接取 `SpaceSoundName`（包内字面量联合），写错名字在编译期就会失败。
 *
 * ## 浏览器自动播放策略（上游文档完全未提，这里显式兜住）
 *
 * 浏览器要求音频上下文在**用户手势**中创建或恢复，否则后续播放会被静默阻止。
 * 做法：首屏挂载时先 `bind()` 注册委托监听（无声音、SSR 安全），首个用户手势
 * （pointerdown / click / keydown）时用**一次 0 音量播放**完成解锁 —— 用户听不到
 * 任何声音，但此后所有音效可正常发声。
 */

/** 应当由调用方传入的音效名（等价于包内 `SpaceSoundName`） */
export type SoundTrigger = SpaceSoundName;

/** 委托监听是否已绑定 */
let bound = false;
/** 是否已完成「静音解锁」 */
let primed = false;
/** 已告警过的调用名：同名只记一次，避免异常时刷满控制台 */
const reported = new Set<string>();

/**
 * 统一的安全调用包装。
 *
 * 关键点：告警按**调用名**去重。音效在滚动、悬停等高频路径上被调用，一旦底层
 * 持续抛错，逐次打印会把控制台淹没，反而掩盖真正的错误。
 */
function safeCall(label: string, task: () => void): void {
  try {
    task();
  } catch (error) {
    if (reported.has(label)) return;
    reported.add(label);
    logger.warn(`音效调用失败，已跳过（同类失败不再重复提示）：${label}`, error);
  }
}

function readSettingsSafely(): unknown {
  try {
    return getSettings();
  } catch {
    return null;
  }
}

/**
 * 初始化引擎：绑定委托监听 + 固定「减少动效即静音」的行为。
 * 幂等，可在多处调用；不产生任何声音。
 */
export function initSoundEngine(): void {
  if (bound) return;
  bound = true;
  safeCall('bind', () => bind(document));
  // 库默认为 true；显式再写一次，避免上游默认值变化后「减少动效」用户被突然出声
  safeCall('setRespectReducedMotion', () => setRespectReducedMotion(true));
  logger.debug('音效引擎已初始化', readSettingsSafely());
}

/**
 * 下发用户偏好。
 *
 * **偏好唯一来源是项目的 `src/lib/storage.ts`**，不使用库内可能存在的持久化：
 * 库内的 `hydrate()` / `getSettings()` 是否落盘在上游文档中未定义，若两边都写会
 * 产生「刷新后状态互相覆盖」的诡异表现。这里始终以本项目存储为准覆盖库内状态。
 */
export function applySoundPreferences(preferences: { enabled: boolean; volume: number }): void {
  initSoundEngine();
  safeCall('setEnabled', () => setEnabled(preferences.enabled));
  safeCall('setVolume', () => setVolume(preferences.volume));
}

/**
 * 首个用户手势时调用一次：用 0 音量播放解锁音频上下文。
 * 重复调用无副作用；解锁失败也不影响界面（后续播放会被浏览器静默忽略）。
 */
export function primeSoundOnFirstGesture(): void {
  if (primed) return;
  primed = true;
  initSoundEngine();
  safeCall('prime', () => play('tap', { volume: 0 }));
}

/**
 * 触发一个音效。
 *
 * @param name 包内音效名（方向性音效用连字符形式，如 `'slide-in'`、`'toggle-on'`）
 * @param options 可传 `volume` / `spatial`（HRTF 空间声像）/ `profile`
 *
 * 页面处于隐藏状态时不发声：用户看不到界面，声音只会变成打扰。
 */
export function triggerSound(name: SoundTrigger, options?: PlayOptions): void {
  let hidden = false;
  try {
    hidden = document.visibilityState === 'hidden';
  } catch {
    hidden = false;
  }
  if (hidden) return;
  safeCall(name, () => play(name, options));
}

/**
 * 订阅库内设置变化，仅用于诊断日志。
 * 返回取消订阅函数；调用方须在卸载时调用。
 */
export function watchSoundSettings(): () => void {
  let unsubscribe: (() => void) | null = null;
  safeCall('subscribe', () => {
    unsubscribe = subscribe(() => {
      logger.debug('音效引擎设置变化', readSettingsSafely());
    });
  });
  return () => {
    if (!unsubscribe) return;
    safeCall('unsubscribe', () => unsubscribe?.());
    unsubscribe = null;
  };
}
