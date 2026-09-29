// EXPORTS: EmojiTrigger

import { Suspense, lazy, useState } from 'react';
import { Smile } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useUiPreferences } from '@/hooks/useUiPreferences';
import { playSound } from '@/lib/sound/map';

const LazyEmojiPickerPanel = lazy(() => import('@/components/emoji/EmojiPickerPanel'));

interface IEmojiTriggerProps {
  /** 选中表情后的回调（在光标处插入） */
  onPick: (char: string) => void;
  disabled?: boolean;
}

/**
 * 输入区表情按钮：按钮 + 浮层 + **按需加载**的面板。
 *
 * 三个关键点：
 * 1. **面板代码不进首屏**：`React.lazy` + 打开时才挂载，配合 `onPointerEnter` 预热
 *    （`bundle-preload`）——鼠标移到按钮上就开始下载，点开时通常已就绪；
 * 2. **面板数据也不进首屏**：目录数据由面板自己 `import()`（见 `lib/emoji/data.ts`）；
 * 3. **选中后面板保持打开**：方便连续挑选多个表情；输入框是受控组件，插入不需要
 *    抢焦点，因此不会出现「选完一个就被关掉」的中断感。
 */
export function EmojiTrigger({ onPick, disabled = false }: IEmojiTriggerProps) {
  const [open, setOpen] = useState(false);
  const { recentEmoji } = useUiPreferences();

  /**
   * 预热面板代码：只是把 chunk 拉到本地缓存，失败也不影响功能。
   * 指针悬停与键盘聚焦都要触发 —— 否则键盘用户点开面板时会先看到骨架态。
   */
  function preloadPanel() {
    void import('@/components/emoji/EmojiPickerPanel');
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        // 面板自下向上滑出：用方向性音效与动势对齐（而不是普通浮层开合音）
        playSound(next ? 'ui:slide-in' : 'ui:slide-out');
        setOpen(next);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={disabled}
          aria-label="表情"
          className="h-10 w-10 shrink-0 rounded-full"
          onPointerEnter={preloadPanel}
          onFocus={preloadPanel}
        >
          <Smile className={`size-4 ${open ? 'text-primary' : ''}`} />
        </Button>
      </PopoverTrigger>

      {/* 面板向上弹出：输入区位于页面底部，向下开会被视口裁掉 */}
      <PopoverContent align="start" side="top" sideOffset={8} className="w-auto p-2">
        <Suspense
          fallback={
            <p className="flex h-40 w-[19rem] items-center justify-center text-xs text-muted-foreground">
              正在加载表情…
            </p>
          }
        >
          {open ? <LazyEmojiPickerPanel onPick={onPick} recent={recentEmoji} /> : null}
        </Suspense>
      </PopoverContent>
    </Popover>
  );
}
