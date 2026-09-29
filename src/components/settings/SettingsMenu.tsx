// EXPORTS: SettingsMenu

import { Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { useUiPreferences, updateUiPreferences } from '@/hooks/useUiPreferences';
import { playSound } from '@/lib/sound/map';

/**
 * 顶栏设置菜单（音效 / 音量 / 表情图片渲染）。
 *
 * ## 为什么用 Popover 而不是 DropdownMenu
 *
 * 菜单里含**开关与滑块**这类需要持续交互的控件：DropdownMenu 的项是
 * 「点击即关闭」语义，滑块拖动会被反复关闭；Popover 不拦截内部交互，适合承载设置表单。
 *
 * ## 为什么开关用 `aria-labelledby` 而不是包 `<label>`
 *
 * Radix 的 Switch 渲染的是 `<button role="switch">`，而 `<label>` 的内容模型不允许
 * 嵌套交互元素。这里改为可见文案带 `id`、开关通过 `aria-labelledby` 关联，
 * 既保证可访问名称正确，又不产生非法嵌套。
 *
 * ## 为什么这里不写任何内联动画/样式
 *
 * 该组件挂在**顶栏**内。顶栏此前出现过「房间号反复重渲染」的闪烁回归（因每秒重渲染
 * 的父组件反复重播子元素动画）。因此菜单与开关只用静态类名，不引入每帧变化的内联
 * style、也不使用会重播的动效。
 */
export function SettingsMenu() {
  const { soundEnabled, soundVolume, emojiImageEnabled, emojiAnimated } = useUiPreferences();

  return (
    <Popover onOpenChange={(open) => playSound(open ? 'ui:open' : 'ui:close')}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="设置"
          className="h-9 w-9 shrink-0 rounded-full"
        >
          <Settings className="size-4" />
        </Button>
      </PopoverTrigger>

      {/* sideOffset 与顶栏高度配合，避免浮层贴住按钮；宽度固定，窄屏不超出视口 */}
      <PopoverContent align="end" sideOffset={8} className="w-[17rem] max-w-[calc(100vw-1.5rem)] p-3">
        <p className="mb-2 text-xs font-medium text-muted-foreground">界面设置</p>

        <div className="space-y-3">
          {/* 音效开关 */}
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <span id="setting-sound-label" className="text-sm text-foreground">
                音效
              </span>
              <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                界面与消息提示音。系统开启「减少动效」时自动静音，页面hidden时不发声。
              </p>
            </div>
            <Switch
              checked={soundEnabled}
              aria-labelledby="setting-sound-label"
              onCheckedChange={(next) => {
                playSound(next ? 'ui:toggle-on' : 'ui:toggle-off');
                updateUiPreferences({ soundEnabled: next });
              }}
            />
          </div>

          {/* 音量：音效关闭时禁用，避免出现「可调但无声」的困惑 */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-sm text-foreground">音量</span>
              <span className="text-[11px] tabular-nums text-muted-foreground">
                {Math.round(soundVolume * 100)}%
              </span>
            </div>
            <Slider
              value={[Math.round(soundVolume * 100)]}
              min={0}
              max={100}
              step={5}
              disabled={!soundEnabled}
              aria-label="音效音量"
              onValueChange={([next]) => updateUiPreferences({ soundVolume: next / 100 })}
            />
          </div>

          {/* 表情图片渲染开关 */}
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <span id="setting-emoji-label" className="text-sm text-foreground">
                表情图片渲染
              </span>
              <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                消息中的表情以统一风格的图片呈现。关闭后改用系统自带字形，且不再请求外部图床。
              </p>
            </div>
            <Switch
              checked={emojiImageEnabled}
              aria-labelledby="setting-emoji-label"
              onCheckedChange={(next) => {
                playSound(next ? 'ui:toggle-on' : 'ui:toggle-off');
                updateUiPreferences({ emojiImageEnabled: next });
              }}
            />
          </div>

          {/* 表情动画：与官方的 anim 变体对应；图片渲染关闭时该项无意义，故禁用 */}
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <span id="setting-emoji-anim-label" className="text-sm text-foreground">
                表情动画
              </span>
              <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                表情以动图呈现。关闭后改用静态图，省电，低端设备更流畅。
              </p>
            </div>
            <Switch
              checked={emojiAnimated}
              disabled={!emojiImageEnabled}
              aria-labelledby="setting-emoji-anim-label"
              onCheckedChange={(next) => {
                playSound(next ? 'ui:toggle-on' : 'ui:toggle-off');
                updateUiPreferences({ emojiAnimated: next });
              }}
            />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
