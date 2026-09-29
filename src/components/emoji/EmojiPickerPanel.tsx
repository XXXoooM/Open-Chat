// EXPORTS: default

import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { EmojiImage } from '@/components/emoji/EmojiImage';
import { Input } from '@/components/ui/input';
import { useEmojiAnimated } from '@/hooks/useUiPreferences';
import {
  EMOJI_CATEGORIES,
  filterEmojiByCategory,
  getEmojiName,
  loadEmojiCatalog,
  searchEmoji,
  type EmojiCategoryId,
  type IEmojiCatalogItem,
} from '@/lib/emoji/data';
import { logger } from '@/lib/logger';

interface IEmojiPickerPanelProps {
  /** 选中一个表情（父层负责插入输入框与记录「最近使用」） */
  onPick: (char: string) => void;
  /** 最近使用的表情字符，最近的在前 */
  recent: string[];
}

/** 网格每批渲染的数量：一次渲染几千个图片节点会明显卡顿，滚动到底再补一批 */
const BATCH_SIZE = 120;

/**
 * 表情面板（**默认导出，供 `React.lazy` 懒加载**）。
 *
 * 由三部分构成（自上而下）：搜索框 → 分类横排 → 最近使用 → 等距网格。
 *
 * ## 性能取舍
 *
 * - **数据动态导入**：目录数据约 1.5 MB，只在首次打开面板时加载一次并缓存；
 * - **搜索不防抖、用 `useDeferredValue`**：过滤是本地同步计算（3391 条，毫秒级），
 *   防抖反而会让输入「顿」一下；`useDeferredValue` 让输入框立即响应，网格延后一帧更新；
 * - **分批渲染 + IntersectionObserver**：滚动到哨兵才追加下一批，避免一次性创建
 *   数千个 `<img>`；
 * - **懒加载图片**：`EmojiImage` 内部用 `loading="lazy"`，仅为进入视口的项发请求。
 */
export default function EmojiPickerPanel({ onPick, recent }: IEmojiPickerPanelProps) {
  const [items, setItems] = useState<IEmojiCatalogItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<EmojiCategoryId>('faces');
  const [visibleCount, setVisibleCount] = useState(BATCH_SIZE);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const deferredQuery = useDeferredValue(query);
  const emojiAnimated = useEmojiAnimated();

  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    loadEmojiCatalog()
      .then((catalog) => {
        if (!cancelled) setItems(catalog);
      })
      .catch((error) => {
        if (cancelled) return;
        logger.error('表情目录加载失败', error);
        setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  /** 最近使用：把字符还原成目录项（不在目录中的历史记录直接跳过） */
  const recentItems = useMemo(() => {
    if (!items || recent.length === 0) return [];
    const byChar = new Map(items.map((item) => [item.char, item]));
    const result: IEmojiCatalogItem[] = [];
    for (const char of recent) {
      const found = byChar.get(char);
      if (found) result.push(found);
    }
    return result;
  }, [items, recent]);

  const list = useMemo(() => {
    if (!items) return [];
    if (deferredQuery.trim()) return searchEmoji(items, deferredQuery);
    return filterEmojiByCategory(items, category);
  }, [items, deferredQuery, category]);

  // 切换分类 / 关键词时把可视数量重置，否则会带着上一次的「加载更多」状态
  useEffect(() => {
    setVisibleCount(BATCH_SIZE);
    scrollRef.current?.scrollTo({ top: 0 });
  }, [deferredQuery, category]);

  // 滚动到底部哨兵时追加下一批
  useEffect(() => {
    const sentinel = sentinelRef.current;
    const root = scrollRef.current;
    if (!sentinel || !root || list.length <= visibleCount) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisibleCount((current) => current + BATCH_SIZE);
        }
      },
      { root, rootMargin: '120px' },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [list.length, visibleCount]);

  const visible = list.slice(0, visibleCount);
  const showRecentRow = !deferredQuery.trim() && recentItems.length > 0;

  return (
    <div className="w-[19rem] max-w-[calc(100vw-1.5rem)]">
      <Input
        autoFocus
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="搜索表情名称，如 rocket"
        aria-label="搜索表情"
        className="h-9 rounded-lg text-sm"
      />

      {/* 分类横排：可横向滚动，窄屏不换行 */}
      <div className="mt-2 flex gap-1 overflow-x-auto pb-1" role="tablist" aria-label="表情分类">
        {EMOJI_CATEGORIES.map((item) => {
          const active = item.id === category && !deferredQuery.trim();
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => {
                setCategory(item.id);
                setQuery('');
              }}
              className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
                active
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground'
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </div>

      {failed ? (
        <div className="flex h-40 flex-col items-center justify-center gap-2 text-xs text-muted-foreground">
          <span>表情数据加载失败</span>
          <button
            type="button"
            onClick={() => setReloadToken((token) => token + 1)}
            className="rounded-md px-2 py-1 text-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            重试
          </button>
        </div>
      ) : (
        <div ref={scrollRef} className="mt-1.5 h-56 overflow-y-auto">
          {showRecentRow && (
            <div className="mb-2">
              <p className="mb-1 px-0.5 text-[11px] text-muted-foreground">最近使用</p>
              <div className="flex flex-wrap gap-0.5">
                {recentItems.map((item) => (
                  <button
                    key={`recent-${item.hex}`}
                    type="button"
                    title={getEmojiName(item)}
                    aria-label={getEmojiName(item)}
                    onClick={() => onPick(item.char)}
                    className="flex size-7 items-center justify-center rounded-md transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                  >
                    {/* 最近使用数量少（上限 24），可以放心用动画 */}
                    <EmojiImage char={item.char} size={22} animated={emojiAnimated} />
                  </button>
                ))}
              </div>
            </div>
          )}

          {!items ? (
            <p className="flex h-40 items-center justify-center text-xs text-muted-foreground">
              正在加载表情…
            </p>
          ) : visible.length === 0 ? (
            <p className="flex h-40 items-center justify-center text-xs text-muted-foreground">
              没有匹配的表情
            </p>
          ) : (
            <div className="grid grid-cols-8 gap-0.5">
              {visible.map((item) => {
                const label = getEmojiName(item);
                return (
                  <button
                    key={item.hex}
                    type="button"
                    title={label}
                    aria-label={label}
                    onClick={() => onPick(item.char)}
                    className="flex size-7 items-center justify-center rounded-md transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                  >
                    {/* 网格刻意用静态图：一屏可达上百个 22px 动图同时解码，
                        会明显吃 CPU/电量；挑选时不需要动效，插入到消息后才是动画 */}
                    <EmojiImage char={item.char} size={22} />
                  </button>
                );
              })}
            </div>
          )}
          <div ref={sentinelRef} className="h-1" />
        </div>
      )}
    </div>
  );
}
