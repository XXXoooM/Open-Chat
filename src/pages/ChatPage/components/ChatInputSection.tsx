// EXPORTS: default
import { useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from 'react';
import { Send, Plus, Image as ImageIcon, File as FileIcon, Loader2, Flame, Check, Lock } from 'lucide-react';
import { EmojiTrigger } from '@/components/emoji/EmojiTrigger';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useChatPaste } from '@/hooks/useChatPaste';
import type { IMessagePrivacyOptions } from '@/hooks/useMqttChat';
import { pushRecentEmoji } from '@/hooks/useUiPreferences';
import { formatFileSize } from '@/lib/media';
import { resolveVeilDurationMs } from '@/lib/veilPolicy';
import { playSound } from '@/lib/sound/map';
import { MAX_FILE_PRECHECK, MAX_UPLOAD_PRECHECK } from '@/lib/chatLimits';
import {
  BURN_MODE_OPTIONS,
  BURN_TTL_OPTIONS,
  BURN_UNAVAILABLE_HINT,
  formatBurnTtl,
  type BurnModeOption,
} from '@/lib/burnPolicy';
import { toast } from 'sonner';

interface ChatInputSectionProps {
  /** 逐条消息的隐私选项（模糊 / 阅后自焚）由此传入，缺省即普通消息 */
  onSend: (content: string, privacy?: IMessagePrivacyOptions) => void | Promise<unknown>;
  onSendImage: (file: File) => void | Promise<unknown>;
  onSendFile: (file: File) => void | Promise<unknown>;
  /** 内容变化时通知父层（父层完成节流与上报，输入框不关心传输细节） */
  onTyping?: () => void;
  burnMode: BurnModeOption;
  burnTtlMs: number;
  onBurnModeChange: (mode: BurnModeOption) => void;
  onBurnTtlChange: (ttlMs: number) => void;
  /** 服务端仲裁是否可用：不可用时「读后」不可选，且会说明原因 */
  burnEnforced: boolean;
  disabled?: boolean;
}

export default function ChatInputSection({
  onSend,
  onSendImage,
  onSendFile,
  onTyping,
  burnMode,
  burnTtlMs,
  onBurnModeChange,
  onBurnTtlChange,
  burnEnforced,
  disabled = false,
}: ChatInputSectionProps) {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [sending, setSending] = useState(false);

  /**
   * 逐条消息的隐私选项。
   *
   * 关键取舍：**发送后自动复位为关闭**。隐私选项与「焚毁模式」不同 —— 后者是房间级的
   * 长期偏好，而这些是「这一条要不要更私密」的临时决定。若保持开启，用户下一次随手
   * 发送时会不经意地发出私密消息（或反之以为没开），因此默认按「每条都要重新选择」处理。
   */
  const [veilSend, setVeilSend] = useState(false);
  const [ephemeralSend, setEphemeralSend] = useState(false);
  const [privacyOpen, setPrivacyOpen] = useState(false);

  /** 当前输入的查看时长预览（字数 → 10/20/30 秒），让规则在发送前可见 */
  const veilPreviewSeconds = Math.round(resolveVeilDurationMs(value) / 1000);

  /** 组装本次发送的隐私选项（自焚以模糊为前提；关闭时返回 undefined） */
  function currentPrivacy(): IMessagePrivacyOptions | undefined {
    if (!veilSend) return undefined;
    return { veil: true, ephemeral: ephemeralSend };
  }

  /** 发送后复位，见上方说明 */
  function resetPrivacy() {
    setVeilSend(false);
    setEphemeralSend(false);
  }

  const trimmed = value.trim();
  const canSend = trimmed.length > 0 && !disabled && !sending;
  const burnActive = burnMode !== 'off';

  /** 输入区常驻可见的当前策略文案（关闭时用「阅后即焚」，与菜单标题口径一致） */
  const burnLabel = !burnActive
    ? '阅后即焚'
    : burnMode === 'read'
      ? '读后焚毁'
      : `${formatBurnTtl(burnTtlMs)}焚毁`;

  /**
   * 记住最后一次启用的焚毁模式。
   *
   * Switch 是二元的（开/关），而焚毁策略有三态（关闭/读后/定时）。关闭时若不记下
   * 上次选择，重新打开就会丢失用户意图（例如被强制回落为定时焚毁）。初值直接取当前
   * 存档模式：用户上次存的是 'read'，首次打开开关即恢复「读后焚毁」。
   */
  const rememberedBurnModeRef = useRef<BurnModeOption>(burnMode === 'off' ? 'time' : burnMode);

  /** 切换焚毁模式：同步记忆最后一次启用值，供 Switch 再次打开时恢复 */
  function selectBurnMode(mode: BurnModeOption) {
    if (mode !== 'off') rememberedBurnModeRef.current = mode;
    onBurnModeChange(mode);
  }

  /**
   * Switch 开关：开 → 恢复上次模式；关 → 'off'。
   * 音效在这里触发（开关的状态切换是明确的用户动作），模式选择在菜单里触发。
   */
  function handleBurnToggle(next: boolean) {
    playSound(next ? 'ui:toggle-on' : 'ui:toggle-off');
    selectBurnMode(next ? rememberedBurnModeRef.current : 'off');
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSend) return;
    onSend(trimmed, currentPrivacy());
    resetPrivacy();
    setValue('');
    inputRef.current?.focus();
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!canSend) return;
      onSend(trimmed, currentPrivacy());
      resetPrivacy();
      setValue('');
    }
  }

  /**
   * 在**光标处**插入文本（而非总是追加到末尾），并把光标移到插入内容之后。
   *
   * 输入框是受控组件，插入不依赖焦点：无论光标来自表情面板还是粘贴动作，都能正确
   * 改写文本。`setSelectionRange` 在未聚焦时同样会记录位置，用户回到输入框时光标即在预期处。
   */
  function insertAtCursor(text: string) {
    if (!text) return;
    const input = inputRef.current;
    const start = input?.selectionStart ?? value.length;
    const end = input?.selectionEnd ?? value.length;
    setValue(`${value.slice(0, start)}${text}${value.slice(end)}`);
    onTyping?.();

    const caret = start + text.length;
    requestAnimationFrame(() => {
      inputRef.current?.setSelectionRange(caret, caret);
    });
  }

  /** 表情插入：额外记录「最近使用」 */
  function handleEmojiPick(char: string) {
    playSound('ui:click');
    pushRecentEmoji(char);
    insertAtCursor(char);
  }

  /**
   * 图片发送**收口**（选择文件与剪贴板粘贴共用）。
   *
   * 刻意把校验与发送放在一处：粘贴与点按钮走完全相同的路径 —— 体积预检、压缩、
   * 失败提示都一致，不会出现「粘贴的图片没被压缩」这类分叉。
   * 体积预检来自 AUDIT.md FUNC-15：超大文件此前会先进入「处理中…」再失败。
   */
  async function sendImage(file: File) {
    if (disabled || sending) return;
    if (!file.type.startsWith('image/')) return;
    if (file.size > MAX_UPLOAD_PRECHECK) {
      toast.error(`图片原始体积过大（上限 ${formatFileSize(MAX_UPLOAD_PRECHECK)}）`);
      return;
    }

    setSending(true);
    playSound('chat:loading');
    try {
      await onSendImage(file);
    } finally {
      setSending(false);
    }
  }

  /** 文件发送收口（选择文件与剪贴板粘贴共用） */
  async function sendFile(file: File) {
    if (disabled || sending) return;
    if (file.size > MAX_UPLOAD_PRECHECK) {
      toast.error(`文件原始体积过大（上限 ${formatFileSize(MAX_UPLOAD_PRECHECK)}）`);
      return;
    }
    if (file.size > MAX_FILE_PRECHECK) {
      toast.error(`文件过大，无法发送（上限 ${formatFileSize(MAX_FILE_PRECHECK)}）`);
      return;
    }

    setSending(true);
    playSound('chat:loading');
    try {
      await onSendFile(file);
    } finally {
      setSending(false);
    }
  }

  async function handleImageChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    await sendImage(file);
  }

  async function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    await sendFile(file);
  }

  /**
   * 粘贴策略（输入框内粘贴 + 页面任意处粘贴图片）全部在 `useChatPaste` 内。
   *
   * 组件只提供三样东西：输入框引用（判断焦点归属）、当前状态、以及上传收口 ——
   * 两条入口因此共用同一份判定逻辑，不会出现「一处改了另一处忘了改」。
   * 上传收口传入的是本组件的 `sendImage` / `sendFile`，保证粘贴与「点按钮选文件」
   * 走完全相同的体积预检、压缩与错误提示。
   */
  const { handlePaste } = useChatPaste({
    inputRef,
    disabled,
    sending,
    onSendImage: sendImage,
    onSendFile: sendFile,
    onInsertText: insertAtCursor,
  });

  return (
    <form
      onSubmit={handleSubmit}
      className="sticky bottom-0 z-10 w-full border-t border-border/60 bg-background/95 backdrop-blur-md px-4 py-3"
    >
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        onChange={handleImageChange}
        className="hidden"
      />
      <input
        ref={fileInputRef}
        type="file"
        onChange={handleFileChange}
        className="hidden"
      />

      <div className="mx-auto max-w-3xl">
        {/* 窄屏下入口收为纯图标，策略文案改为在输入框上方补一行（避免撑破一行布局） */}
        {burnActive && (
          <div className="sm:hidden mb-1.5 flex items-center gap-1.5 px-1 text-[11px] text-primary/90">
            <Flame className="size-3" />
            <span>
              {burnMode === 'read'
                ? '本条消息将在对方读过且服务端确认后焚毁'
                : `本条消息将在 ${formatBurnTtl(burnTtlMs)} 后焚毁`}
            </span>
          </div>
        )}

        <div className="flex items-center gap-2">
          <DropdownMenu onOpenChange={(open) => playSound(open ? 'ui:open' : 'ui:close')}>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-10 w-10 shrink-0 rounded-full"
                disabled={disabled || sending}
                aria-label="更多"
              >
                <Plus className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-40">
              <DropdownMenuItem onClick={() => imageInputRef.current?.click()}>
                <ImageIcon className="size-4 mr-2" />
                图片
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => fileInputRef.current?.click()}>
                <FileIcon className="size-4 mr-2" />
                文件
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* 焚毁开关：Switch 直接映射既有 burnMode（开 ↔ 非 off，关 ↔ off），不新增平行状态。
              窄屏隐藏文案（保持原布局宽度），可访问名称由 aria-labelledby 关联到该文案 */}
          <Switch
            checked={burnActive}
            disabled={disabled}
            onCheckedChange={handleBurnToggle}
            aria-labelledby="burn-switch-label"
            className="shrink-0"
          />
          <span
            id="burn-switch-label"
            className={`hidden select-none whitespace-nowrap text-xs transition-colors sm:inline ${
              burnActive ? 'text-primary' : 'text-muted-foreground'
            }`}
          >
            {burnLabel}
          </span>

          {/* 模式与倒计时入口：原下拉保留为次级入口；「关闭」已由 Switch 承担，此处不再出现 */}
          <DropdownMenu onOpenChange={(open) => playSound(open ? 'ui:open' : 'ui:close')}>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={disabled || !burnActive}
                aria-label="焚毁模式与倒计时"
                className="h-10 w-10 shrink-0 rounded-full"
              >
                <Flame className={`size-4 ${burnActive ? 'text-primary' : ''}`} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-64">
              <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                阅后即焚
              </DropdownMenuLabel>
              {/* 「关闭」已由 Switch 承担：菜单只保留两种启用态，避免同一状态出现两处入口 */}
              {BURN_MODE_OPTIONS.filter((option) => option.value !== 'off').map((option) => {
                const unavailable = option.value === 'read' && !burnEnforced;
                return (
                  <DropdownMenuItem
                    key={option.value}
                    disabled={unavailable}
                    onClick={() => {
                      playSound('ui:click');
                      selectBurnMode(option.value);
                    }}
                    className="items-start gap-2"
                  >
                    <div className="flex min-w-0 flex-col">
                      <span className="text-sm">{option.label}</span>
                      <span className="text-[10px] text-muted-foreground">
                        {unavailable ? '需要服务端仲裁，当前连接方式不可用' : option.hint}
                      </span>
                    </div>
                    {burnMode === option.value && (
                      <Check className="ml-auto mt-0.5 size-3.5 shrink-0 text-primary" />
                    )}
                  </DropdownMenuItem>
                );
              })}

              {burnMode === 'time' && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                    销毁倒计时
                  </DropdownMenuLabel>
                  {BURN_TTL_OPTIONS.map((ttl) => (
                    <DropdownMenuItem
                      key={ttl}
                      onClick={() => {
                        playSound('ui:click');
                        onBurnTtlChange(ttl);
                      }}
                      className="gap-2"
                    >
                      <span className="text-sm">{formatBurnTtl(ttl)}后销毁</span>
                      {burnTtlMs === ttl && (
                        <Check className="ml-auto size-3.5 shrink-0 text-primary" />
                      )}
                    </DropdownMenuItem>
                  ))}
                </>
              )}

              {!burnEnforced && (
                <>
                  <DropdownMenuSeparator />
                  <p className="mx-1 mb-1 rounded-sm bg-warning-surface px-2 py-1.5 text-[10px] leading-relaxed text-warning-surface-foreground">
                    {BURN_UNAVAILABLE_HINT}
                  </p>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* 私密消息选项：模糊（需主动揭示）与阅后自焚（揭示后超时即删除） */}
          <Popover
            open={privacyOpen}
            onOpenChange={(open) => {
              playSound(open ? 'ui:open' : 'ui:close');
              setPrivacyOpen(open);
            }}
          >
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={disabled}
                aria-label="私密消息选项"
                className={`h-10 w-10 shrink-0 rounded-full ${veilSend ? 'text-primary' : ''}`}
              >
                <Lock className="size-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" side="top" sideOffset={8} className="w-64 p-3">
              <p className="mb-2 text-xs font-medium text-muted-foreground">下一条消息</p>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <span id="privacy-veil-label" className="text-sm text-foreground">
                    模糊消息
                  </span>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                    对方需点击才能查看。按字数决定可看时长：少于 15 字 10 秒、15~30 字 20 秒、超过 30 字 30 秒；
                    超时后重新模糊。
                  </p>
                </div>
                <Switch
                  checked={veilSend}
                  aria-labelledby="privacy-veil-label"
                  onCheckedChange={(next) => {
                    playSound(next ? 'ui:toggle-on' : 'ui:toggle-off');
                    setVeilSend(next);
                    if (!next) setEphemeralSend(false);
                  }}
                />
              </div>
              <div className="mt-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <span id="privacy-ephemeral-label" className="text-sm text-foreground">
                    阅后自焚
                  </span>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                    在模糊消息基础上：倒计时结束或窗口失焦即删除，不再重新模糊。
                  </p>
                </div>
                <Switch
                  checked={ephemeralSend}
                  disabled={!veilSend}
                  aria-labelledby="privacy-ephemeral-label"
                  onCheckedChange={(next) => {
                    playSound(next ? 'ui:toggle-on' : 'ui:toggle-off');
                    setEphemeralSend(next);
                  }}
                />
              </div>
              <p className="mt-2 border-t border-border/50 pt-2 text-[11px] text-muted-foreground">
                当前输入 {veilPreviewSeconds ? `可查看 ${veilPreviewSeconds} 秒` : '为空'}；发送后选项自动复位。
              </p>
            </PopoverContent>
          </Popover>

          {/* 表情入口：位于输入框左侧 */}
          <EmojiTrigger onPick={handleEmojiPick} disabled={disabled} />

          <Input
            ref={inputRef}
            type="text"
            value={value}
            onPaste={handlePaste}
            onChange={(e) => {
              setValue(e.target.value);
              // 清空输入时不产生输入事件（避免上报一个「正在输入」却什么都没打）
              if (e.target.value.trim()) onTyping?.();
            }}
            onKeyDown={handleKeyDown}
            placeholder="输入消息，按 Enter 发送..."
            disabled={disabled || sending}
            autoComplete="off"
            className="flex-1 rounded-full bg-muted/60 px-5 py-2.5 text-sm placeholder:text-muted-foreground/60 focus-visible:ring-1 focus-visible:ring-primary/40"
          />
          <Button
            type="submit"
            size="icon"
            disabled={!canSend}
            className="h-10 w-10 shrink-0 rounded-full shadow-sm"
            aria-label="发送消息"
          >
            {/* 修复 AUDIT.md FUNC-18：此前用 X（取消）图标表示发送中，语义错误且按钮不可点 */}
            {sending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>
    </form>
  );
}
