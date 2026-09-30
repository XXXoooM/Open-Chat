// EXPORTS: VeiledMessageView

import type { ReactNode } from 'react';
import { Eye, Flame, Timer } from 'lucide-react';

interface IVeiledMessageViewProps {
  /** 消息原文（用于分档与揭示后展示） */
  text: string;
  /** 是否处于「已揭示」状态（由消息列表统一持有） */
  revealed: boolean;
  /** 本次揭示的总时长（毫秒） */
  durationMs: number;
  /** 剩余查看时长（毫秒，由消息列表按本地时钟计算） */
  remainingMs: number;
  /** 是否为「阅后自焚」：超时后删除而非重新模糊 */
  ephemeral: boolean;
  /** 请求揭示 */
  onReveal: () => void;
  /** 揭示后展示的真实内容（复用气泡既有渲染，避免样式分叉） */
  children: ReactNode;
}

/**
 * 模糊消息视图。
 *
 * ## 它保护什么、不保护什么（必须说清楚）
 *
 * 这是**防肩窥的视觉遮挡**，与 `usePrivacyBlur` 同一定位：内容在揭示前不会被渲染成
 * 可读文本，但**它已经在客户端内存里**（消息本来就是端到端解密后渲染的）。
 * 因此要如实理解为「避免被身边人一眼看到 / 避免误展示」，**不是**密码学保护 ——
 * 打开开发者工具或读取内存仍可取得内容。真正的「服务端也看不到」由既有 E2EE 承担。
 *
 * ## 为什么遮罩上直接渲染真实内容（加 blur 滤镜）而不是占位符
 *
 * 需求是「初始状态为模糊内容」，所以屏幕上呈现的是这篇文章本身的模糊影像，
 * 长度与形状与原文一致，用户能据此判断是否值得查看。为避免遮罩被「选中复制」或
 * 被指针穿透，遮罩层拦截了指针事件，内容层同时禁用文本选择。
 *
 * ## 交互与可访问性
 *
 * 遮罩是一个真正的 `<button>`：鼠标点击、键盘 Enter / Space 都能揭示，
 * 带 `aria-label` 说明；揭示后倒计时以文本 + 进度条呈现，秒数以整秒显示，
 * 不做逐帧动画（避免无谓的重绘）。
 */
export function VeiledMessageView({
  text,
  revealed,
  durationMs,
  remainingMs,
  ephemeral,
  onReveal,
  children,
}: IVeiledMessageViewProps) {
  if (!revealed) {
    return (
      <button
        type="button"
        onClick={onReveal}
        aria-label={ephemeral ? '点击查看模糊消息（阅后自焚）' : '点击查看模糊消息'}
        className="group relative block w-full cursor-pointer text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded-lg"
      >
        {/* 模糊影像：形状与原文一致，但不可选、不可点穿 */}
        <span aria-hidden="true" className="block select-none blur-[5px] opacity-70">
          {text}
        </span>
        <span className="absolute inset-0 flex items-center justify-center gap-1.5 rounded-lg bg-background/35 px-2 text-[11px] font-medium text-foreground">
          {ephemeral ? <Flame className="size-3.5" /> : <Eye className="size-3.5" />}
          <span className="whitespace-nowrap">点击查看{ephemeral ? '（阅后自焚）' : ''}</span>
        </span>
      </button>
    );
  }

  const totalMs = durationMs > 0 ? durationMs : 1;
  const percent = Math.max(0, Math.min(100, (remainingMs / totalMs) * 100));
  const seconds = Math.max(0, Math.ceil(remainingMs / 1000));

  return (
    <span className="block">
      <span className="block">{children}</span>
      {/*
        倒计时条：秒数为整秒文本；进度条宽度每秒变化一次（transition 平滑），
        不做逐帧动画。自焚消息额外标注「阅后自焚」，让用户明白超时后是消失而不是重新模糊。
      */}
      <span className="mt-1.5 flex items-center gap-2">
        <span className="relative h-0.5 flex-1 overflow-hidden rounded-full bg-foreground/20">
          <span
            className={`absolute inset-y-0 left-0 rounded-full transition-[width] duration-1000 ease-linear ${
              ephemeral ? 'bg-destructive' : 'bg-primary'
            }`}
            style={{ width: `${percent}%` }}
          />
        </span>
        <span
          className={`inline-flex shrink-0 items-center gap-1 text-[10px] tabular-nums ${
            ephemeral ? 'text-destructive' : 'text-foreground/70'
          }`}
        >
          {ephemeral ? <Flame className="size-3" /> : <Timer className="size-3" />}
          {seconds}s
        </span>
      </span>
    </span>
  );
}
