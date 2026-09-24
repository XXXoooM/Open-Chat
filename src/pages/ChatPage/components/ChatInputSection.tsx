// EXPORTS: default
import { useState, useRef, type FormEvent, type KeyboardEvent, type ChangeEvent } from 'react';
import {
  Send,
  Plus,
  Image as ImageIcon,
  File as FileIcon,
  Loader2,
  Flame,
  Check,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { formatFileSize } from '@/lib/media';
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
  onSend: (content: string) => void | Promise<unknown>;
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

  const trimmed = value.trim();
  const canSend = trimmed.length > 0 && !disabled && !sending;
  const burnActive = burnMode !== 'off';

  /** 输入区常驻可见的当前策略文案 */
  const burnLabel = !burnActive
    ? '焚毁'
    : burnMode === 'read'
      ? '读后焚毁'
      : `${formatBurnTtl(burnTtlMs)}焚毁`;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSend) return;
    onSend(trimmed);
    setValue('');
    inputRef.current?.focus();
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!canSend) return;
      onSend(trimmed);
      setValue('');
    }
  }

  async function handleImageChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || disabled || sending) return;

    if (!file.type.startsWith('image/')) return;

    // 修复 AUDIT.md FUNC-15：图片路径此前完全没有预检，超大文件会先进入
    // 「处理中…」再失败；这里与文件路径对齐做原始体积预检。
    if (file.size > MAX_UPLOAD_PRECHECK) {
      toast.error(`图片原始体积过大（上限 ${formatFileSize(MAX_UPLOAD_PRECHECK)}）`);
      return;
    }

    setSending(true);
    try {
      await onSendImage(file);
    } finally {
      setSending(false);
    }
  }

  async function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || disabled || sending) return;

    if (file.size > MAX_UPLOAD_PRECHECK) {
      toast.error(`文件原始体积过大（上限 ${formatFileSize(MAX_UPLOAD_PRECHECK)}）`);
      return;
    }
    if (file.size > MAX_FILE_PRECHECK) {
      toast.error(`文件过大，无法发送（上限 ${formatFileSize(MAX_FILE_PRECHECK)}）`);
      return;
    }

    setSending(true);
    try {
      await onSendFile(file);
    } finally {
      setSending(false);
    }
  }

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
          <DropdownMenu>
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

          {/* 焚毁模式入口：未启用为中性态，启用后转为珊瑚描边并常驻显示策略 */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant={burnActive ? 'outline' : 'ghost'}
                size="sm"
                disabled={disabled}
                aria-label="阅后即焚设置"
                className={`h-10 shrink-0 gap-1.5 rounded-full px-3 text-xs transition-colors ${
                  burnActive
                    ? 'border-primary/40 bg-primary/5 text-primary hover:bg-primary/10'
                    : 'text-muted-foreground'
                }`}
              >
                <Flame className="size-4" />
                <span className="hidden sm:inline">{burnLabel}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-64">
              <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                阅后即焚
              </DropdownMenuLabel>
              {BURN_MODE_OPTIONS.map((option) => {
                const unavailable = option.value === 'read' && !burnEnforced;
                return (
                  <DropdownMenuItem
                    key={option.value}
                    disabled={unavailable}
                    onClick={() => onBurnModeChange(option.value)}
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
                      onClick={() => onBurnTtlChange(ttl)}
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

          <Input
            ref={inputRef}
            type="text"
            value={value}
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
