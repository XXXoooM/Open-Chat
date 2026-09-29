// EXPORTS: EmojiImage

import { useEffect, useState } from 'react';
import { emojiImageUrl, logEmojiFallback, type EmojiVariantName } from '@/lib/emoji/url';

/**
 * 图片加载阶段，按顺序推进：
 * `animated`（Fluent 动图）→ `static`（Fluent 3D 静帧）→ `native`（系统字形）
 *
 * 为什么第二级是「静态」而不是镜像域名：上游虽然声明了两个镜像，但实测均不可用
 * （见 `lib/emoji/url.ts` 的说明）。而静态 3D 图对全部 3391 个表情都存在，是真正
 * 兜得住的一级 —— 个别动画文件缺失或损坏时，用户看到的仍是同一套设计语言的表情。
 */
type ImageStage = 'animated' | 'static' | 'native';

interface IEmojiImageProps {
  /** 表情字符 */
  char: string;
  /** 方块尺寸（px）。用于网格等固定尺寸场景 */
  size?: number;
  /** 与文字同行排版：按 `em` 缩放，随字号变化（消息气泡内使用） */
  inline?: boolean;
  /**
   * 行内尺寸（单位 `em`）。默认 1.15em。
   * 消息气泡会按「整条消息的表情数量」传入不同档位（见 `lib/emoji/segments.ts`）。
   */
  sizeEm?: number;
  /** 是否渲染为动画（默认 false —— 调用方按用户偏好显式传入） */
  animated?: boolean;
  /** 鼠标悬停提示与替代文本（一般传英文名称） */
  title?: string;
  className?: string;
}

/**
 * 表情图片：支持动画/静态两种变体，并带两级回退（静态 3D → 系统字形）。
 *
 * ## 为什么自持 `<img>` 而不是用上游的 `<Emoji />`
 *
 * 1. **体积**：上游 `/react` 入口会拖入 2.54 MB 的预打包 chunk（无法 tree-shake），
 *    而消息渲染在首屏，绝不能引入；
 * 2. **回退可控**：上游 `fallback` 默认为 `false`（资源缺失时渲染 `null`，页面上就是
 *    一块空白），且其 `<img>` 属性是否透传未文档化。
 *
 * ## 关于动画的体积代价（实测，值得知情）
 *
 * 同一表情的动画文件比静态大 **45～58 倍**（🔥 4 KB → 185 KB，👨‍👩‍👧 10 KB → 557 KB）；
 * 按键类与旗帜没有动画版本（与静态同文件）。代价可控的两个理由：浏览器会缓存同一
 * 表情，且 `loading="lazy"` 只为进入视口的消息发请求。更在意流量与流畅度时，
 * 用户可在设置里关闭「表情动画」立即退回静态图（两者覆盖面相同）。
 */
export function EmojiImage({
  char,
  size = 24,
  inline = false,
  sizeEm = 1.15,
  animated = false,
  title,
  className,
}: IEmojiImageProps) {
  const [stage, setStage] = useState<ImageStage>(animated ? 'animated' : 'static');

  /**
   * 审计修复：`animated` 是用户可随时切换的偏好，而 `useState` 的初值只取一次 ——
   * 若不在这里同步，已挂载的表情会停留在旧变体上（关掉「表情动画」后，历史消息里的
   * 动图仍在动），与设置项显示的状态不一致。切换时回到该变体的起始阶段，重新走回退链。
   */
  useEffect(() => {
    setStage(animated ? 'animated' : 'static');
  }, [animated]);

  if (stage === 'native') {
    // 原生字形：不请求任何外部资源。行内场景用字号跟随正文
    return (
      <span
        className={inline ? 'leading-none' : 'flex items-center justify-center leading-none'}
        style={inline ? undefined : { width: size, height: size, fontSize: size * 0.86 }}
        title={title}
      >
        {char}
      </span>
    );
  }

  const variant: EmojiVariantName = stage === 'static' ? 'static' : 'animated';
  /**
   * 放大后的表情若沿用 `-0.2em` 基线偏移，会在行盒下方留出大片空隙；
   * 因此尺寸超过 1.5em 时改用 `middle`（图片中线对齐 x-height 中线），
   * 这也是大号表情在行内的通用处理方式。
   */
  const style = inline
    ? {
        width: `${sizeEm}em`,
        height: `${sizeEm}em`,
        verticalAlign: sizeEm > 1.5 ? 'middle' : '-0.2em',
      }
    : { width: size, height: size };

  return (
    <img
      src={emojiImageUrl(char, { variant })}
      alt={title ?? char}
      title={title}
      style={style}
      loading="lazy"
      decoding="async"
      draggable={false}
      className={inline ? `inline-block ${className ?? ''}` : className}
      onError={() => {
        if (stage === 'animated') {
          logEmojiFallback(char, '动画加载失败，退回静态 3D');
          setStage('static');
          return;
        }
        logEmojiFallback(char, '静态图亦失败，回退原生字形');
        setStage('native');
      }}
    />
  );
}
