// EXPORTS: TYPING_TTL_MS, TYPING_THROTTLE_MS, ITypingUser, formatTypingText, useTypingIndicator

import { useCallback, useEffect, useRef, useState } from 'react';

/** 输入指示的存活时长：停止输入 5 秒后消失（需求指定） */
export const TYPING_TTL_MS = 5000;

/**
 * 发送侧前缘节流。
 * 打字是高频事件，若每次按键都发报文会显著放大流量，
 * 并频繁唤醒休眠中的中继实例（直接体现在计费上）。
 */
export const TYPING_THROTTLE_MS = 2500;

export interface ITypingUser {
  id: string;
  nickname: string;
  /** 最近一次输入事件的时间 */
  at: number;
}

export interface IUseTypingIndicator {
  /** 正在输入的其他人 */
  typers: ITypingUser[];
  /** 收到他人的输入事件（与在线成员表完全隔离） */
  registerRemote: (id: string, nickname: string) => void;
  /** 本端是否应发出输入事件（前缘节流判定） */
  shouldNotify: () => boolean;
  /** 清空状态（离开房间或关闭开关时调用） */
  reset: () => void;
}

/** 聚合文案：单人显示昵称，多人显示「首个昵称 等 N 人」 */
export function formatTypingText(typers: ITypingUser[]): string {
  if (typers.length === 0) return '';
  if (typers.length === 1) return `${typers[0].nickname} 正在输入…`;
  return `${typers[0].nickname} 等 ${typers.length} 人正在输入…`;
}

/**
 * 输入指示状态机。
 *
 * 刻意与「在线成员表」保持完全独立：房间自动续期判定依赖在线人数，
 * 若打字事件混入成员表，单个用户频繁打字就能影响房间寿命。
 * 这里用独立通道（typing）、独立状态与独立计时器，从结构上杜绝该污染。
 */
export function useTypingIndicator(enabled: boolean): IUseTypingIndicator {
  const [typers, setTypers] = useState<ITypingUser[]>([]);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const lastSentRef = useRef(0);

  const clearTimers = useCallback(() => {
    timersRef.current.forEach((timer) => clearTimeout(timer));
    timersRef.current.clear();
  }, []);

  const reset = useCallback(() => {
    clearTimers();
    lastSentRef.current = 0;
    setTypers([]);
  }, [clearTimers]);

  const registerRemote = useCallback((id: string, nickname: string) => {
    setTypers((prev) => [...prev.filter((user) => user.id !== id), { id, nickname, at: Date.now() }]);

    const existing = timersRef.current.get(id);
    if (existing) clearTimeout(existing);
    timersRef.current.set(
      id,
      setTimeout(() => {
        timersRef.current.delete(id);
        setTypers((prev) => prev.filter((user) => user.id !== id));
      }, TYPING_TTL_MS),
    );
  }, []);

  const shouldNotify = useCallback(() => {
    const now = Date.now();
    if (now - lastSentRef.current < TYPING_THROTTLE_MS) return false;
    lastSentRef.current = now;
    return true;
  }, []);

  // 关闭开关时立即清空：避免界面继续暗示「有人正在输入」
  useEffect(() => {
    if (!enabled) reset();
  }, [enabled, reset]);

  useEffect(() => clearTimers, [clearTimers]);

  return { typers, registerRemote, shouldNotify, reset };
}
