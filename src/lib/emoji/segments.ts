// EXPORTS: IEmojiSegment, IEmojiLayout, EMOJI_MAX_PER_MESSAGE, EMOJI_SIZE_EM,
//          segmentEmojiText, isEmojiGrapheme, summarizeEmojiSegments, getEmojiSizeEm

/**
 * 文本切分：把一段消息拆成「文字」与「表情」两类片段，供渲染层决定哪些部分画成图片。
 *
 * ## 为什么用 `Intl.Segmenter` 而不是正则
 *
 * 表情的长度是不确定的：`😀` 是 1 个码点，`👨‍👩‍👧` 是多个码点 + ZWJ 连接，`👍🏽` 带肤色
 * 修饰符，`🇨🇳` 是两个区域指示符。按码元或码点切都会切坏表情（出现「半个」图片）。
 * `Intl.Segmenter` 的 `grapheme` 粒度按用户感知的字符切分，是浏览器内置的正确做法。
 *
 * ## 为什么需要每消息上限
 *
 * 一条消息里塞 200 个表情 = 200 次图片请求。这里限制**图片化的表情数量**，超出部分
 * 按原文渲染（系统字形同样能正常显示），避免个别消息拖垮整屏。
 */

export interface IEmojiSegment {
  type: 'text' | 'emoji';
  value: string;
}

/** 单条消息中最多渲染为图片的表情数量 */
export const EMOJI_MAX_PER_MESSAGE = 24;

/** 切分结果缓存上限：聊天记录以短文本为主，200 条足以覆盖可视范围 */
const CACHE_LIMIT = 200;
const cache = new Map<string, IEmojiSegment[]>();

let segmenter: Intl.Segmenter | null = null;

function getSegmenter(): Intl.Segmenter | null {
  if (segmenter) return segmenter;
  if (typeof Intl === 'undefined' || typeof Intl.Segmenter !== 'function') return null;
  segmenter = new Intl.Segmenter('zh', { granularity: 'grapheme' });
  return segmenter;
}

/**
 * 判断一个字素簇是否为「应当图片化」的表情。
 *
 * 三点覆盖：
 * - `Extended_Pictographic`：绝大多数表情（含 ZWJ 组合与肤色修饰符）；
 * - `Regional_Indicator`：国旗由两个区域指示符组成；
 * - `\u20E3`：按键类（`#️⃣`/`1️⃣`）由数字或符号 + 变体选择符 + 组合用键帽组成，
 *   其中 `#`/`*`/数字本身不是表情，必须靠这个组合标记识别。
 */
const EMOJI_GRAPHEME_PATTERN = /[\p{Extended_Pictographic}\p{Regional_Indicator}\u20E3]/u;

export function isEmojiGrapheme(grapheme: string): boolean {
  return EMOJI_GRAPHEME_PATTERN.test(grapheme);
}

/**
 * 切分文本。相邻的文字片段会合并，减少 DOM 节点数量。
 * 结果按原文缓存（同一消息在滚动、重渲染时不会重复计算）。
 */
export function segmentEmojiText(text: string): IEmojiSegment[] {
  const cached = cache.get(text);
  if (cached) return cached;

  const segmenterInstance = getSegmenter();
  const segments: IEmojiSegment[] = [];
  let emojiCount = 0;

  const pushText = (value: string) => {
    const last = segments[segments.length - 1];
    if (last && last.type === 'text') {
      last.value += value;
      return;
    }
    segments.push({ type: 'text', value });
  };

  if (segmenterInstance) {
    for (const part of segmenterInstance.segment(text)) {
      const grapheme = part.segment;
      const isEmoji = isEmojiGrapheme(grapheme) && emojiCount < EMOJI_MAX_PER_MESSAGE;
      if (isEmoji) {
        emojiCount += 1;
        segments.push({ type: 'emoji', value: grapheme });
      } else {
        pushText(grapheme);
      }
    }
  } else {
    // 环境无 Intl.Segmenter（极旧浏览器）：整段按文字渲染，功能降级但不错乱
    pushText(text);
  }

  // 简单的容量控制：超限时丢弃最早的一条，避免长会话无限增长
  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(text, segments);
  return segments;
}

/** 消息中表情的布局信息 */
export interface IEmojiLayout {
  /** 被图片化的表情数量（已受每消息上限约束） */
  emojiCount: number;
  /** 是否「整条消息只有表情」（允许夹杂空格与换行） */
  emojiOnly: boolean;
}

/**
 * 判断消息的展示形态。
 *
 * 为什么要区分「纯表情」与「文字混排」：把句子中间的表情放大到几十像素会把整段
 * 文本的排版撑坏；而整条消息只有表情时（用户的意图就是「发表情」），放大才符合
 * 直觉 —— 这也是主流聊天应用一致的做法。空格与换行不破坏「纯表情」判定。
 */
export function summarizeEmojiSegments(segments: IEmojiSegment[]): IEmojiLayout {
  let emojiCount = 0;
  let hasVisibleText = false;
  for (const segment of segments) {
    if (segment.type === 'emoji') {
      emojiCount += 1;
      continue;
    }
    if (segment.value.trim().length > 0) hasVisibleText = true;
  }
  return { emojiCount, emojiOnly: emojiCount > 0 && !hasVisibleText };
}

/**
 * 三档尺寸（单位 `em`，相对气泡内字号，因此会随字号与缩放一起变）。
 *
 * - `large`：单个表情，接近「贴纸」的观感；
 * - `medium`：2~6 个表情，成组但仍有存在感；
 * - `normal`：7 个以上，或与文字混排时 —— **仍比正文略大**（1.35em），
 *   既让表情在句子里看得清，又不会跳动排版。
 */
export const EMOJI_SIZE_EM = { large: 3.2, medium: 1.9, normal: 1.35 } as const;

/** 按表情数量选择尺寸档位 */
export function getEmojiSizeEm(layout: IEmojiLayout): number {
  if (!layout.emojiOnly) return EMOJI_SIZE_EM.normal;
  if (layout.emojiCount === 1) return EMOJI_SIZE_EM.large;
  if (layout.emojiCount <= 6) return EMOJI_SIZE_EM.medium;
  return EMOJI_SIZE_EM.normal;
}
