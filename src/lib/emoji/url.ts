// EXPORTS: EMOJI_SOURCES, EmojiVariantName, EMOJI_VARIANTS, toEmojiHex, emojiImageUrl, logEmojiFallback

import { logger } from '@/lib/logger';

/**
 * 表情图片 URL 规则（自持实现，**刻意不 import `@usespaceui/emoji` 的 JS**）。
 *
 * ## 为什么不用包里的 `resolveEmojiUrl`
 *
 * 实测：`@usespaceui/emoji` 的 ESM 入口只有 2.7 KB，但真正的实现被打包进
 * `dist/chunk-WW3I7SW4.mjs`（**2.54 MB**）。这是上游构建时就已经合并好的 chunk，
 * **tree-shaking 无法再切分** —— 只要在消息渲染路径上静态 import 它的任何导出，
 * 首屏 bundle 就会多出 2.5 MB。消息渲染位于聊天页首屏，因此这里只保留 URL 规则。
 *
 * ## 规则来源：**用包内解析器实测得到**（不是推测）
 *
 * 在 Node 中直接调用 `resolveEmojiUrl` / `getEmojiUrls` / `toUnicode` 取回真实结果：
 *
 * | 输入 | 解析结果 |
 * |---|---|
 * | `resolveEmojiUrl('🔥', { source:'fluent', type:'3d' })` | `https://cdn.spaceui.one/common/emoji/fluent/3d/1f525.webp` |
 * | `resolveEmojiUrl('🔥', { source:'fluent', type:'anim', format:'webp' })` | `https://cdn.spaceui.one/common/emoji/fluent/anim/1f525.webp` |
 * | `resolveEmojiUrl('👨‍👩‍👧', …)` | `…/fluent/anim/1f468-200d-1f469-200d-1f467.webp` |
 * | `toUnicode('1️⃣')` | `0031-fe0f-20e3`（**码点补零到 4 位**） |
 * | `getEmojiUrls('🔥', …)` | 镜像为 `cdn.aurthle.one` 与 `cdn.aurthle.com` |
 *
 * 因此路径恒为 `{base}/common/emoji/{source}/{type}/{码点串}.{format}` ——
 * 注意**动画没有额外的 `webp/` 层级**（`fluent/anim/webp` 只是数据目录键，不是 URL）。
 *
 * ## 动画与静态
 *
 * 实测 `fluent/3d` 与 `fluent/anim/webp` 的条目数相同（各 3391，动画无缺失），
 * 因此「动画优先」在覆盖面上没有损失；万一某个动画文件缺失或损坏，回退链会依次
 * 尝试镜像域名、静态 3D、最后落到系统原生字形。
 */

/** 支持的图集来源 */
export const EMOJI_SOURCES = ['fluent', 'apple', 'telegram', 'noto', 'twemoji', 'blobmoji'] as const;
export type EmojiSourceName = (typeof EMOJI_SOURCES)[number];

/**
 * 视觉变体：
 * - `animated`：Fluent 动画（WebP 动图）—— 默认，与官网 playground 一致；
 * - `static`：Fluent 3D 静帧（WebP）。
 */
export type EmojiVariantName = 'animated' | 'static';

export const EMOJI_VARIANTS: Record<EmojiVariantName, { type: string; format: string }> = {
  animated: { type: 'anim', format: 'webp' },
  static: { type: '3d', format: 'webp' },
};

/**
 * 主 CDN。
 *
 * 上游 `getEmojiUrls` 还声明了两个镜像域名，但**实测均不可用**：`cdn.aurthle.com`
 * 对同一路径返回 404，`cdn.aurthle.one` 无正常响应。因此不把它们放进回退链 ——
 * 保留一个必然失败的环节只会白白多一次请求与等待。
 */
const CDN_PRIMARY = 'https://cdn.spaceui.one';

export interface IEmojiImageOptions {
  variant?: EmojiVariantName;
  source?: EmojiSourceName;
}

/**
 * 表情字符 → 码点串（小写十六进制，多码点用 `-` 连接）。
 *
 * 两个容易踩的细节，均已按上游解析器与目录实测校准：
 * 1. **按码点而非码元遍历**：表情常由多个 UTF-16 码元组成（代理对、ZWJ 组合、肤色
 *    修饰符），用 `split('')` 会得到错误的十六进制；
 * 2. **每个码点补齐到 4 位**：`toUnicode('1️⃣')` 的真实结果是 `0031-fe0f-20e3`，
 *    而 `toString(16)` 会给出 `31-fe0f-20e3`。不补零会 404。
 */
export function toEmojiHex(emoji: string): string {
  const parts: string[] = [];
  for (const symbol of emoji) {
    const codePoint = symbol.codePointAt(0);
    if (codePoint === undefined) continue;
    parts.push(codePoint.toString(16).padStart(4, '0'));
  }
  return parts.join('-');
}

function buildUrl(base: string, hex: string, options: IEmojiImageOptions): string {
  const variant = EMOJI_VARIANTS[options.variant ?? 'animated'];
  const source = options.source ?? 'fluent';
  return `${base}/common/emoji/${source}/${variant.type}/${hex}.${variant.format}`;
}

/** 主 CDN 地址 */
export function emojiImageUrl(emoji: string, options: IEmojiImageOptions = {}): string {
  return buildUrl(CDN_PRIMARY, toEmojiHex(emoji), options);
}

/** 诊断用：记录一次回退（只输出码点与原因，不涉及消息内容） */
export function logEmojiFallback(emoji: string, reason: string): void {
  logger.debug('表情图片回退', { hex: toEmojiHex(emoji), reason });
}
