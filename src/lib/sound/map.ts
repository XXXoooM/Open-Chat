// EXPORTS: SOUND_MAP, SoundAction, playSound, playIncomingMessageSound, SPATIAL_SIDE

import type { PlayOptions, SpatialPosition } from '@usespaceui/sounds';
import { triggerSound, type SoundTrigger } from '@/lib/sound/engine';

/**
 * 「交互 → 音效」映射表。
 *
 * 为什么用动作名而不是直接写音效名：
 * - 动作名表达**语义**（`chat:send-ok`），音效名是**实现**（`confirm`）。将来换音色
 *   只改这一张表，调用点不动。
 * - 音效资源有限（23 个基础 + 4 个方向），多个动作可以共用同一个音效，语义仍清晰。
 *
 * 取值全部是包内 `SpaceSoundName` 的字面量；方向性触发一律用连字符形式
 * （`slide-in` / `toggle-on` / `turn-back` / `nudge-up`），这是包内字符串式调用的要求。
 */
export const SOUND_MAP = {
  /** 通用点击：按钮、菜单项 */
  'ui:click': 'tap',
  /** 开关打开 */
  'ui:toggle-on': 'toggle-on',
  /** 开关关闭 */
  'ui:toggle-off': 'toggle-off',
  /** 浮层展开（表情面板、设置菜单、下拉菜单） */
  'ui:open': 'open',
  /** 浮层收起 */
  'ui:close': 'close',
  /** 悬停提示音：只挂在明确目标上，不铺满全站 */
  'ui:hover': 'tick',
  /** 滑入 / 滑出（抽屉、面板进出场） */
  'ui:slide-in': 'slide-in',
  'ui:slide-out': 'slide-out',
  /** 消息发送成功 */
  'chat:send-ok': 'confirm',
  /** 收到消息（默认方位，具体左右由 playIncomingMessageSound 决定） */
  'chat:receive': 'chime',
  /** 复制到剪贴板 */
  'chat:copy': 'copy',
  /** 从剪贴板粘贴（文本、Markdown 或图片） */
  'chat:paste': 'paste',
  /** 操作被拒绝 / 出错 */
  'chat:error': 'deny',
  /** 条目被移除（附件删除、清空输入） */
  'chat:remove': 'remove',
  /** 图片 / 文件发送前的加载态 */
  'chat:loading': 'loading',
  /** 连接就绪 */
  'conn:ready': 'ready',
  /** 正在连接 */
  'conn:loading': 'loading',
  /** 前进 / 后退（路由或分页） */
  'nav:forward': 'turn-forward',
  'nav:back': 'turn-back',
  /** 翻页 */
  'nav:page': 'page',
} as const satisfies Record<string, SoundTrigger>;

export type SoundAction = keyof typeof SOUND_MAP;

/**
 * 空间声像常量：HRTF 双耳声像的左右取值区间为 -1（左）~ +1（右）。
 * 取 0.6 而非 1：完全贴耳的单侧定位在长时间使用中容易造成偏头感，
 * 0.6 能听出方位又不至于失衡。
 */
export const SPATIAL_SIDE: Record<'incoming' | 'outgoing' | 'center', SpatialPosition> = {
  incoming: { x: -0.6 },
  outgoing: { x: 0.6 },
  center: { x: 0 },
};

/**
 * 收到消息的音效节流窗口（毫秒）。
 *
 * 刷屏式连续来消息时（例如对方粘贴十几条），逐条播放会连成刺耳噪音。
 * 窗口内只播放第一次，既保留「有新消息」的知觉，又不制造噪音。
 */
const RECEIVE_MIN_INTERVAL_MS = 900;
let lastReceiveAt = 0;

/**
 * 悬停音的节流窗口（毫秒）。
 *
 * 鼠标划过列表时会连续进入多个元素，若不节流会变成一串「哒哒哒」。
 * 上游的 `data-space-hover` 自带防抖，但本项目统一走显式调用（便于与偏好联动），
 * 因此在这里补上同样的保护。
 */
const HOVER_MIN_INTERVAL_MS = 500;
let lastHoverAt = 0;

/** 播放一个动作对应的音效。页面隐藏时由 engine 统一静默。 */
export function playSound(action: SoundAction, options?: PlayOptions): void {
  const now = Date.now();

  if (action === 'chat:receive') {
    if (now - lastReceiveAt < RECEIVE_MIN_INTERVAL_MS) return;
    lastReceiveAt = now;
  }

  if (action === 'ui:hover') {
    if (now - lastHoverAt < HOVER_MIN_INTERVAL_MS) return;
    lastHoverAt = now;
  }

  triggerSound(SOUND_MAP[action], options);
}

/**
 * 收到他人消息：对方气泡在左侧 → 声像偏左。
 *
 * 这是「按气泡左右做空间声像」规则的落地：对方消息一律渲染在左侧，因此收到消息的
 * 提示音偏左；自己发送的反馈音偏右（见 `playOutgoingMessageSound`）。用户不看屏幕
 * 也能分辨消息来自哪一侧 —— 这是本方案里空间声像的实际用途，其余触发保持居中。
 */
export function playIncomingMessageSound(): void {
  playSound('chat:receive', { spatial: SPATIAL_SIDE.incoming });
}

/** 自己发送成功：气泡在右侧 → 声像偏右 */
export function playOutgoingMessageSound(): void {
  playSound('chat:send-ok', { spatial: SPATIAL_SIDE.outgoing });
}
