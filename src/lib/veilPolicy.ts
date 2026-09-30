// EXPORTS: VEIL_TIERS, VEIL_MIN_MS, IVeilTier, resolveVeilDurationMs, countVisibleChars, describeVeil

/**
 * 「模糊消息」的查看时长规则（单一事实来源）。
 *
 * ## 规则（按可见字数分档）
 *
 * | 可见字数 | 查看时长 |
 * |---|---|
 * | 少于 15 字 | 10 秒 |
 * | 15 ~ 30 字（含两端） | 20 秒 |
 * | 超过 30 字 | 30 秒 |
 *
 * ## 为什么用「可见字数」而不是 `String.length`
 *
 * `String.length` 数的是 UTF-16 码元：一个 emoji（如 🙂）算 2，组合表情（如 👨‍👩‍👧）算 5，
 * 而用户看到的是「1 个字」。用 `Array.from` 按**码点**计数，中文、英文、emoji 的口径才一致。
 *
 * ## 为什么分档而不是线性增长
 *
 * 分档的意图是「让长消息有更充裕的阅读时间」，同时避免出现「看一条长消息要等 3 分钟」
 * 这种不可用的极端值。三档上限 30 秒是刻意的天花板。
 */

export interface IVeilTier {
  /** 分档标识，便于界面与日志引用 */
  id: 'short' | 'medium' | 'long';
  /** 该档位的查看时长（毫秒） */
  durationMs: number;
  /** 该档位的字数下界（含） */
  minChars: number;
  /** 该档位的字数上界（含）；`null` 表示无上界 */
  maxChars: number | null;
  /** 中文说明，用于界面提示与文档 */
  label: string;
}

/** 三档规则表（顺序即匹配顺序） */
export const VEIL_TIERS: readonly IVeilTier[] = [
  { id: 'short', durationMs: 10_000, minChars: 0, maxChars: 14, label: '少于 15 字：10 秒' },
  { id: 'medium', durationMs: 20_000, minChars: 15, maxChars: 30, label: '15 ~ 30 字：20 秒' },
  { id: 'long', durationMs: 30_000, minChars: 31, maxChars: null, label: '超过 30 字：30 秒' },
] as const;

/** 最短查看时长（当前等于短消息档，导出便于测试与界面复用） */
export const VEIL_MIN_MS = 10_000;

let graphemeSegmenter: Intl.Segmenter | null = null;

/**
 * 统计「可见字数」：按**字素簇**计数，忽略首尾空白。
 *
 * 三层次的区别必须分清（这也是第一版实现写错、被离线用例抓出来的地方）：
 * - `String.length` 数的是 UTF-16 码元：`🙂` 算 2、`👨‍👩‍👧` 算 8；
 * - 按码点数：`🙂` 算 1（对了），但 `👨‍👩‍👧` 算 5（错，用户看到的是 1 个表情）；
 * - 按字素簇（本实现）：与「用户看到几个字」一致 —— 中文 1 字算 1，家庭表情算 1。
 *
 * 因此用 `Intl.Segmenter`（与 `lib/emoji/segments.ts` 同一套依据）；环境不支持时
 * 退回按码点计数 —— 精度略降，但绝不会把 emoji 算成两个字符。
 */
export function countVisibleChars(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;

  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
    graphemeSegmenter ??= new Intl.Segmenter('zh', { granularity: 'grapheme' });
    let count = 0;
    for (const _ of graphemeSegmenter.segment(trimmed)) count += 1;
    return count;
  }
  return Array.from(trimmed).length;
}

/** 按字数解析查看时长（毫秒） */
export function resolveVeilDurationMs(text: string): number {
  const chars = countVisibleChars(text);
  for (const tier of VEIL_TIERS) {
    if (chars < tier.minChars) continue;
    if (tier.maxChars === null || chars <= tier.maxChars) return tier.durationMs;
  }
  // 规则表覆盖了全部非负整数，这里只是穷尽性兜底
  return VEIL_MIN_MS;
}

/** 按字数解析命中的档位（界面用于展示「为什么是这个时长」） */
export function resolveVeilTier(text: string): IVeilTier {
  const chars = countVisibleChars(text);
  for (const tier of VEIL_TIERS) {
    if (chars < tier.minChars) continue;
    if (tier.maxChars === null || chars <= tier.maxChars) return tier;
  }
  return VEIL_TIERS[0];
}

/** 生成一句人话说明，例如「32 字，可查看 30 秒」 */
export function describeVeil(text: string): string {
  const chars = countVisibleChars(text);
  const durationMs = resolveVeilDurationMs(text);
  return `${chars} 字，可查看 ${Math.round(durationMs / 1000)} 秒`;
}
