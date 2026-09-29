// EXPORTS: EmojiText

import { EmojiImage } from '@/components/emoji/EmojiImage';
import { useEmojiAnimated, useEmojiImageEnabled } from '@/hooks/useUiPreferences';
import { getEmojiSizeEm, segmentEmojiText, summarizeEmojiSegments } from '@/lib/emoji/segments';

interface IEmojiTextProps {
  /** 消息原文 */
  text: string;
}

/**
 * 消息文本渲染：把其中的表情画成统一风格的图片，其余部分原样输出。
 *
 * ## 设计要点
 *
 * 1. **不解构消息、不改内容**：发送的始终是 Unicode 字符，这里只在渲染时替换。
 *    因此对方即使没打开这个功能（甚至用的是旧版本），收到的消息依然完整可读 —— 
 *    表情的「协议」永远只是文本。
 * 2. **订阅的是派生布尔值**：`useEmojiImageEnabled` 只在该开关翻转时触发重渲染；
 *    拖动音量滑块不会让消息列表重渲染（`useSyncExternalStore` 按 `Object.is` 比较快照）。
 * 3. **关闭开关即零外部请求**：开关关闭时直接输出纯文本，不解析、不加载任何图片，
 *    这对隐私敏感场景（不希望消息内容触发任何外部请求）是明确承诺。
 * 4. **切分结果缓存**：同一段文本只切分一次，滚动与重渲染都不重复计算。
 * 5. **动画由用户决定**：默认与官网一致用 Fluent 动图（`anim` 变体）；在设置里关掉
 *    「表情动画」即改用静态 3D 图 —— 两者覆盖面实测相同，切换不丢表情。
 */
export function EmojiText({ text }: IEmojiTextProps) {
  const emojiImageEnabled = useEmojiImageEnabled();
  const emojiAnimated = useEmojiAnimated();

  if (!emojiImageEnabled) return <>{text}</>;

  const segments = segmentEmojiText(text);
  // 纯文字消息（含绝大多数情况）直接返回文本，少一层节点
  if (segments.length === 1 && segments[0].type === 'text') return <>{text}</>;

  const layout = summarizeEmojiSegments(segments);
  const sizeEm = getEmojiSizeEm(layout);
  // 放大档位需要收紧行高：否则气泡的 leading-relaxed 会让单个大表情上下留出大块空白
  const enlarged = layout.emojiOnly && layout.emojiCount <= 6;

  const content = segments.map((segment, index) =>
    segment.type === 'emoji' ? (
      <EmojiImage
        key={`e-${index}`}
        char={segment.value}
        inline
        sizeEm={sizeEm}
        animated={emojiAnimated}
      />
    ) : (
      <span key={`t-${index}`}>{segment.value}</span>
    ),
  );

  if (enlarged) return <span className="leading-none">{content}</span>;
  return <>{content}</>;
}
