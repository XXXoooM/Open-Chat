import { useState, useEffect, useRef, useCallback, memo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import {
  ArrowDown,
  File as FileIcon,
  Download,
  X,
  Clock,
  AlertCircle,
  Flame,
} from 'lucide-react';
import { Image } from '@/components/ui/image';
import { formatFileSize } from '@/lib/media';
import {
  describeDiveBaseline,
  describeEventAction,
  formatClockTime,
  formatSilentDuration,
  type IChatEventPayload,
} from '@/lib/chatEvents';
import { formatBurnCountdown, formatBurnTtl } from '@/lib/burnPolicy';
import type { IBurnPolicy } from '@shared/relay/protocol';
import type { MessageStatus } from '@/hooks/useMqttChat';

export interface IMessage {
  id: string;
  nickname: string;
  content: string;
  timestamp: number;
  isMine: boolean;
  /** 发送者连接 id（按身份而非昵称统计状态，重名不串） */
  senderId?: string;
  msgType?: 'text' | 'image' | 'file' | 'system' | 'event';
  /** 发送状态：仅自己的消息会有 sending / failed（FUNC-09） */
  status?: MessageStatus;
  /** msgType === 'event' 时的动态事件负载（进入 / 离开 / 潜水） */
  event?: IChatEventPayload;
  /** 焚毁策略；未启用时为空 */
  burn?: IBurnPolicy;
  /** 定时焚毁到期时刻（倒计时依据） */
  burnAt?: number;
  /** 已被焚毁：先呈现为销毁标记，淡出后由上层移除 */
  burned?: boolean;
  /** 已读人数 / 应读人数（数值来自服务端回执，客户端不推算） */
  readBy?: number;
  readTotal?: number;
  imageData?: string; // base64 图片数据（解密后）
  imageName?: string;
  imageWidth?: number;
  imageHeight?: number;
  imageMime?: string;
  fileName?: string;
  fileSize?: number;
  fileData?: Uint8Array; // 解密后的文件二进制
  fileType?: string;
}

interface MessageListSectionProps {
  messages: IMessage[];
  onFileDownload?: (msg: IMessage) => void;
  /** 重试发送失败的文字消息（FUNC-09） */
  onRetryMessage?: (msg: IMessage) => void;
}

const MessageListSection = memo(function MessageListSection({
  messages,
  onFileDownload,
  onRetryMessage,
}: MessageListSectionProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const lastMessageIdRef = useRef<string | null>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [hasNewMessage, setHasNewMessage] = useState(false);
  const [previewImage, setPreviewImage] = useState<{ src: string; name?: string } | null>(null);

  /**
   * 焚毁倒计时的本地时钟。
   * 只在确实存在待倒计时的消息时才启动，避免整页每秒重渲染。
   */
  const hasCountdown = messages.some((m) => m.burnAt != null && !m.burned);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!hasCountdown) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [hasCountdown]);

  const scrollToBottom = useCallback((smooth = true) => {
    // 修复 AUDIT.md FUNC-10：此前两个分支都写成 'auto'，平滑滚动实际从未生效
    bottomRef.current?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto' });
    setHasNewMessage(false);
    setIsAtBottom(true);
  }, []);

  const handleScroll = useCallback(() => {
    const container = scrollRef.current;
    if (!container) return;
    const threshold = 80;
    const atBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight < threshold;
    setIsAtBottom(atBottom);
    if (atBottom) setHasNewMessage(false);
  }, []);

  /**
   * 新消息处理（修复 AUDIT.md FUNC-11）。
   * 此前只看消息条数变化，导致自己发送的消息在向上翻阅时也会弹出「新消息」。
   * 现在按「最后一条消息的 id 是否变化」判断，并区分是否为自己发送：
   * - 自己的消息：强制滚到底部
   * - 他人的消息：不在底部时才提示
   * 依赖 messages（而非 length），状态从 sending → sent 变化不会误报。
   */
  useEffect(() => {
    const last = messages.length > 0 ? messages[messages.length - 1] : undefined;
    if (!last) {
      lastMessageIdRef.current = null;
      return;
    }
    const isNewMessage = lastMessageIdRef.current !== last.id;
    lastMessageIdRef.current = last.id;
    if (!isNewMessage) return;

    if (last.isMine || isAtBottom) {
      scrollToBottom(false);
      setHasNewMessage(false);
    } else {
      setHasNewMessage(true);
    }
  }, [messages, isAtBottom, scrollToBottom]);

  useEffect(() => {
    scrollToBottom(false);
  }, [scrollToBottom]);

  // ESC 关闭预览
  useEffect(() => {
    if (!previewImage) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPreviewImage(null);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [previewImage]);

  if (messages.length === 0) {
    // 空态不再使用大卡片提示（用户反馈：过重）。房间建立后立刻会出现系统提示，
    // 这里的空白只是极短暂的过渡态，上下文由顶部状态栏承担。
    return <div className="flex-1" />;
  }

  return (
    <div className="relative flex-1 min-h-0">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="h-full overflow-y-auto px-4 py-4 space-y-3"
      >
        <AnimatePresence initial={false}>
          {messages.map((msg) => {
            const isSending = msg.status === 'sending';
            const isFailed = msg.status === 'failed';
            const burned = !!msg.burned;

            // ── 聊天室动态（进入 / 离开 / 潜水）──────────────────
            // 与聊天消息共用同一条时间线，因此直接按时间戳插在消息流中。
            // 呈现方式与系统提示完全一致（居中胶囊），全界面只保留一种提示样式；
            // 沉默时长等细节放进 title，悬停可看，不占用视觉空间。
            if (msg.msgType === 'event' && msg.event) {
              const event = msg.event;
              const diveNote =
                event.kind === 'dive' && typeof event.baselineAt === 'number'
                  ? `（已 ${formatSilentDuration(Date.now() - event.baselineAt)}未发言）`
                  : '';

              return (
                <motion.div
                  key={msg.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                  className="flex justify-center"
                >
                  <span
                    title={describeDiveBaseline(event)}
                    className="max-w-[92%] rounded-full bg-muted/60 px-3 py-1 text-center text-xs text-muted-foreground"
                  >
                    <span className="font-medium">{msg.isMine ? '我' : msg.nickname}</span>{' '}
                    {describeEventAction(event)}
                    {diveNote}
                    <span className="ml-2 text-[10px] tabular-nums">
                      {formatClockTime(event.at)}
                    </span>
                  </span>
                </motion.div>
              );
            }

            // 系统消息居中显示
            if (msg.msgType === 'system') {
              return (
                <motion.div
                  key={msg.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                  className="flex justify-center"
                >
                  <span
                    className={`text-xs text-muted-foreground bg-muted/60 px-3 py-1 rounded-full ${
                      isSending ? 'animate-pulse' : ''
                    }`}
                  >
                    {msg.content}
                  </span>
                </motion.div>
              );
            }

            const bubbleStateClass = isSending
              ? 'opacity-60'
              : isFailed
                ? 'opacity-90 ring-1 ring-destructive/50'
                : '';

            return (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, y: 12, scale: 0.96 }}
                animate={{ opacity: burned ? 0 : 1, y: 0, scale: 1 }}
                transition={
                  burned
                    ? { duration: 0.5, ease: 'easeOut' }
                    : { duration: 0.25, ease: [0.16, 1, 0.3, 1] }
                }
                className={`flex flex-col ${msg.isMine ? 'items-end' : 'items-start'}`}
              >
                <span className="text-xs text-muted-foreground mb-1 px-1">
                  {msg.isMine ? '我' : msg.nickname}
                </span>

                {/* 文字消息（已焚毁时改用销毁标记，避免内容在淡出期间仍可被读取） */}
                {msg.msgType === 'text' && !burned && (
                  <div
                    className={`max-w-[75%] md:max-w-[60%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed break-words ${
                      msg.isMine
                        ? 'bg-primary text-primary-foreground rounded-br-md'
                        : 'bg-muted text-foreground rounded-bl-md'
                    } ${bubbleStateClass}`}
                  >
                    {msg.content}
                  </div>
                )}
                {burned && (
                  <span className="flex items-center gap-1 rounded-full bg-muted/60 px-3 py-1 text-[11px] text-muted-foreground">
                    <Flame className="size-3" />
                    该消息已焚毁
                  </span>
                )}

                {/* 图片消息 */}
                {msg.msgType === 'image' && msg.imageData && (
                  <button
                    onClick={() =>
                      setPreviewImage({ src: msg.imageData!, name: msg.imageName })
                    }
                    className={`max-w-[70%] md:max-w-[55%] overflow-hidden rounded-2xl ${
                      msg.isMine ? 'rounded-br-md' : 'rounded-bl-md'
                    } hover:opacity-90 transition-opacity ${bubbleStateClass}`}
                  >
                    <Image
                      src={msg.imageData}
                      alt={msg.imageName || '图片'}
                      className="w-full h-auto block"
                      width={msg.imageWidth || 400}
                      height={msg.imageHeight || 300}
                    />
                  </button>
                )}

                {/* 文件消息 */}
                {msg.msgType === 'file' && (
                  <button
                    onClick={() => onFileDownload?.(msg)}
                    className={`max-w-[80%] md:max-w-[60%] flex items-center gap-3 px-4 py-3 rounded-2xl ${
                      msg.isMine
                        ? 'bg-primary text-primary-foreground rounded-br-md'
                        : 'bg-muted text-foreground rounded-bl-md'
                    } hover:opacity-90 transition-opacity text-left ${bubbleStateClass}`}
                  >
                    <div
                      className={`size-10 rounded-lg flex items-center justify-center shrink-0 ${
                        msg.isMine ? 'bg-primary-foreground/20' : 'bg-background'
                      }`}
                    >
                      <FileIcon className="size-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">
                        {msg.fileName || '文件'}
                      </div>
                      <div
                        className={`text-xs ${
                          msg.isMine ? 'text-primary-foreground/70' : 'text-muted-foreground'
                        }`}
                      >
                        {msg.fileSize != null ? formatFileSize(msg.fileSize) : ''}
                      </div>
                    </div>
                    <Download className="size-4 shrink-0" />
                  </button>
                )}

                {/* 失败重试（FUNC-09） */}
                {isFailed && (
                  <button
                    type="button"
                    onClick={() => onRetryMessage?.(msg)}
                    className="mt-1 px-1 text-[10px] text-destructive flex items-center gap-1 hover:underline focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none rounded"
                  >
                    <AlertCircle className="size-3" />
                    发送失败，点击重试
                  </button>
                )}

                <span className="text-[10px] text-muted-foreground mt-0.5 px-1 flex items-center gap-1.5">
                  {isSending && <Clock className="size-3" />}
                  {formatClockTime(msg.timestamp)}

                  {/* 焚毁状态与倒计时（已焚毁时不再展示） */}
                  {msg.burn && !burned && (
                    <span className="flex items-center gap-0.5 text-primary/80">
                      <Flame className="size-3" />
                      {msg.burn.mode === 'read'
                        ? '待读'
                        : msg.burnAt != null
                          ? formatBurnCountdown(msg.burnAt - now)
                          : formatBurnTtl(msg.burn.ttlMs ?? 0)}
                    </span>
                  )}

                  {/* 已读回执：仅自己发出的消息，数值一律来自服务端 */}
                  {msg.isMine && msg.readBy != null && msg.readTotal != null && (
                    <span
                      className={`flex items-center gap-1 ${
                        msg.readBy >= msg.readTotal ? 'text-success' : ''
                      }`}
                    >
                      <span
                        className={`size-1.5 rounded-full ${
                          msg.readBy >= msg.readTotal ? 'bg-success' : 'bg-muted-foreground/50'
                        }`}
                      />
                      已读 {msg.readBy}/{msg.readTotal}
                    </span>
                  )}
                </span>
              </motion.div>
            );
          })}
        </AnimatePresence>
        <div ref={bottomRef} />
      </div>

      <AnimatePresence>
        {hasNewMessage && !isAtBottom && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10"
          >
            <Button
              size="sm"
              variant="secondary"
              className="rounded-full shadow-md gap-1.5"
              onClick={() => scrollToBottom(true)}
            >
              <ArrowDown className="size-3.5" />
              新消息
            </Button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 图片预览遮罩 */}
      <AnimatePresence>
        {previewImage && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
            onClick={() => setPreviewImage(null)}
          >
            <Button
              variant="ghost"
              size="icon"
              className="absolute top-4 right-4 text-white hover:bg-white/10 h-10 w-10 rounded-full"
              onClick={() => setPreviewImage(null)}
              aria-label="关闭"
            >
              <X className="size-5" />
            </Button>
            <Image
              src={previewImage.src}
              alt={previewImage.name || '预览'}
              className="max-w-full max-h-[85vh] object-contain"
              width={1280}
              height={960}
              onClick={(e) => e.stopPropagation()}
            />
            {previewImage.name && (
              <div className="absolute bottom-6 left-1/2 -translate-x-1/2 text-white/80 text-sm">
                {previewImage.name}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});

export default MessageListSection;
