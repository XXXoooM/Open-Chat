// EXPORTS: SoundProvider

import { useEffect, type ReactNode } from 'react';
import { getUiPreferences, useUiPreferences } from '@/hooks/useUiPreferences';
import {
  applySoundPreferences,
  initSoundEngine,
  primeSoundOnFirstGesture,
  watchSoundSettings,
} from '@/lib/sound/engine';

interface ISoundProviderProps {
  children: ReactNode;
}

/**
 * 音效生命周期容器（渲染层）。
 *
 * 上游 `@usespaceui/sounds` **没有官方 Provider**，只在 README 里演示「自己写一个
 * 组件调一次 `bind()`」。本项目在此集中处理四件事：
 *
 * 1. **挂载即绑定**：`bind(document)` 注册委托监听（不发声、SSR 安全、可重复调用）；
 * 2. **下发用户偏好**：把 `useUiPreferences` 的权威值同步到引擎（`setEnabled/setVolume`）；
 * 3. **首个手势解锁**：浏览器要求音频上下文在用户手势中创建/恢复，因此监听
 *    pointerdown / keydown / click 各一次，触发后立即摘除监听，避免长期挂着；
 * 4. **诊断订阅**：库内设置变化只记 debug 日志，不参与界面状态（避免双源）。
 *
 * 该组件**不提供 Context**：音效状态由 `useUiPreferences` 的模块级 store 承载，
 * 组件按需订阅，避免每次音量变化都重渲染整棵树。
 */
export function SoundProvider({ children }: ISoundProviderProps) {
  const { soundEnabled, soundVolume } = useUiPreferences();

  // 提前读取一次偏好，让「用户已关闭音效」在首个手势解锁前就生效
  useEffect(() => {
    initSoundEngine();
    const current = getUiPreferences();
    applySoundPreferences({ enabled: current.soundEnabled, volume: current.soundVolume });
  }, []);

  useEffect(() => {
    applySoundPreferences({ enabled: soundEnabled, volume: soundVolume });
  }, [soundEnabled, soundVolume]);

  useEffect(() => watchSoundSettings(), []);

  useEffect(() => {
    const unlock = () => {
      primeSoundOnFirstGesture();
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      window.removeEventListener('click', unlock);
    };
    window.addEventListener('pointerdown', unlock, { once: true, passive: true });
    window.addEventListener('keydown', unlock, { once: true, passive: true });
    window.addEventListener('click', unlock, { once: true, passive: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      window.removeEventListener('click', unlock);
    };
  }, []);

  return <>{children}</>;
}
