import { useEffect, useMemo, useState, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Hash,
  Clock,
  PlusCircle,
  AlertTriangle,
  ShieldAlert,
  Loader2,
  Flame,
  EyeOff,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SettingsMenu } from '@/components/settings/SettingsMenu';
import { ThemeToggleButton } from '@/components/spaceui/theme-toggle';
// 直接引用具体模块，避免经 barrel（@/components/orb/thinking）引入其余 9 种形态的依赖
import { OrbConnecting } from '@/components/orb/thinking/orb-connecting';
import LoadingOrb from '@/components/orb/loading';
import { useReducedMotion } from 'framer-motion';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import OnlineUsersSection from './components/OnlineUsersSection';
import MessageListSection, { type IMessage } from './components/MessageListSection';
import ChatInputSection from './components/ChatInputSection';
import {
  useMqttChat,
  type ConnectionStatus,
  type IChatMessage,
  type IMessagePrivacyOptions,
} from '@/hooks/useMqttChat';
import { formatTypingText } from '@/hooks/useTypingIndicator';
import { usePrivacyBlur } from '@/hooks/usePrivacyBlur';
import {
  readStoredNickname,
  readStoredRoomId,
  readSessionPassword,
  clearSessionPassword,
} from '@/lib/chatStorage';
import { getTransportKind, getTransportReadiness } from '@/lib/transport';
import {
  readPrivacySettings,
  writePrivacySettings,
  type IPrivacySettings,
} from '@/lib/privacySettings';
import { BURN_UNAVAILABLE_HINT, toBurnPolicy, type BurnModeOption } from '@/lib/burnPolicy';
import { playSound } from '@/lib/sound/map';
import type { IBurnPolicy } from '@shared/relay/protocol';

/** 传输层可用性：中继优先，其次 MQTT（判定逻辑集中在 transport 模块） */
const TRANSPORT_READINESS = getTransportReadiness();

/** 紧急提示阈值：剩余不足 15 分钟时高亮 */
const URGENT_THRESHOLD_MS = 15 * 60 * 1000;

/**
 * 修复 AUDIT.md UI-04：此前 >1 小时用「剩余 X」，<1 小时改用
 * 「房间将在 X 后销毁」，同一位置句式突变会让人误以为状态变了。
 * 现在统一为「剩余 …」，紧迫感交给颜色与图标表达。
 */
function formatRemaining(ms: number): { text: string; isUrgent: boolean } {
  if (ms <= 0) return { text: '已过期', isUrgent: true };

  const totalSec = Math.floor(ms / 1000);
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  const isUrgent = ms < URGENT_THRESHOLD_MS;

  if (hours > 0) {
    return { text: `剩余 ${hours} 小时 ${minutes.toString().padStart(2, '0')} 分`, isUrgent };
  }
  if (minutes > 0) {
    return {
      text: `剩余 ${minutes} 分 ${seconds.toString().padStart(2, '0')} 秒`,
      isUrgent: true,
    };
  }
  return { text: `剩余 ${seconds} 秒`, isUrgent: true };
}

export default function ChatPage() {
  const location = useLocation();
  const navigate = useNavigate();

  const state = location.state as {
    roomId?: string;
    password?: string;
    nickname?: string;
  } | null;

  // 修复 AUDIT.md FUNC-06：密码此前只来自路由 state，刷新页面即被强制踢回首页。
  // 现在回退到 sessionStorage（仅当前标签页有效，关闭即失效）。
  const roomId = state?.roomId || readStoredRoomId();
  /** 系统「减少动效」偏好：canvas 球体等重动效据此降级为纯文案（见状态行） */
  const reduceMotion = useReducedMotion();

  const nickname = state?.nickname || readStoredNickname();
  const password = state?.password || readSessionPassword();

  const [now, setNow] = useState(() => Date.now());
  const [isExtending, setIsExtending] = useState(false);
  const [privacy, setPrivacy] = useState<IPrivacySettings>(() => readPrivacySettings());

  // 只有中继通路具备服务端仲裁：读后焚毁与已读回执依赖它
  const burnEnforced = getTransportKind() === 'relay';
  /**
   * 存档里的策略可能是在「曾配置中继」时设为 read 的。
   * 此时显式降级为定时焚毁并给出提示，而不是静默地什么都不做。
   */
  const burnModeDowngraded = !burnEnforced && privacy.burnMode === 'read';
  const effectiveBurnMode: BurnModeOption = burnModeDowngraded ? 'time' : privacy.burnMode;

  /** 窗口失焦时遮挡对话内容（纯本地行为，不影响正在输入的草稿） */
  const isBlurred = usePrivacyBlur(privacy.blurOnBlur);

  /** 隐私开关统一写入口：界面状态与本地存储始终同步 */
  const updatePrivacy = useCallback((patch: Partial<IPrivacySettings>) => {
    setPrivacy((prev) => {
      const next = { ...prev, ...patch };
      writePrivacySettings(next);
      return next;
    });
  }, []);

  useEffect(() => {
    if (!nickname || !roomId || !password) {
      navigate('/', { replace: true });
    }
  }, [nickname, roomId, password, navigate]);

  const handlePasswordError = useCallback(() => {
    clearSessionPassword();
    navigate('/', { replace: true, state: { error: '密码错误，请确认房间号与密码是否一致' } });
  }, [navigate]);

  const handleRoomDestroyed = useCallback(() => {
    clearSessionPassword();
    setTimeout(() => {
      navigate('/', { replace: true, state: { error: '房间已销毁' } });
    }, 2000);
  }, [navigate]);

  const {
    status,
    messages,
    onlineUsers,
    roomMeta,
    roomStatus,
    clientId,
    sendMessage,
    sendImage,
    sendFile,
    retryMessage,
    extendRoom,
    typers,
    notifyTyping,
    consumeMessage,
  } = useMqttChat({
    roomId,
    password,
    nickname,
    onPasswordError: handlePasswordError,
    onRoomDestroyed: handleRoomDestroyed,
    typingEnabled: privacy.typingIndicator,
  });

  // 剩余时间每秒刷新
  // 修复 AUDIT.md FUNC-07：此前用 forceTick 触发重渲染，但 remaining 的
  // useMemo 依赖 [roomMeta]，倒计时数字被永久冻结。现在把「当前时间」纳入状态。
  useEffect(() => {
    if (!roomMeta) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [roomMeta]);

  const remaining = useMemo(() => {
    if (!roomMeta) return null;
    return roomMeta.destroyAt - now;
  }, [roomMeta, now]);

  const remainingInfo = remaining != null ? formatRemaining(remaining) : null;

  const canExtend =
    roomMeta != null &&
    (roomMeta.extendCount ?? 0) < 3 &&
    remaining != null &&
    remaining > 0;

  // 修复 AUDIT.md FUNC-13：此前用恒为 false 的 ref 做防重守卫（等价 no-op），
  // 现在改为真实的请求中状态。
  const handleExtend = useCallback(async () => {
    if (!canExtend || isExtending) return;
    setIsExtending(true);
    try {
      await extendRoom();
    } finally {
      setIsExtending(false);
    }
  }, [canExtend, isExtending, extendRoom]);

  const handleLeave = useCallback(() => {
    // 主动离开房间时清除会话内的密码，避免残留
    clearSessionPassword();
    navigate('/', { replace: true });
  }, [navigate]);

  // 转换消息格式给 MessageListSection
  const listMessages: IMessage[] = useMemo(() => {
    return messages.map((m: IChatMessage) => ({
      id: m.id,
      nickname: m.nickname,
      content: m.content,
      timestamp: m.timestamp,
      isMine: m.isMine,
      senderId: m.senderId,
      msgType: m.msgType,
      status: m.status,
      event: m.event,
      burn: m.burn,
      burnAt: m.burnAt,
      burned: m.burned,
      veil: m.veil,
      ephemeral: m.ephemeral,
      readBy: m.readBy,
      readTotal: m.readTotal,
      imageData: m.imageData,
      imageName: m.imageName,
      imageWidth: m.imageWidth,
      imageHeight: m.imageHeight,
      imageMime: m.imageMime,
      fileName: m.fileName,
      fileSize: m.fileSize,
      fileData: m.fileData,
      fileType: m.fileType,
    }));
  }, [messages]);

  /** 发送时把当前焚毁策略转换为协议对象（'off' → 不携带焚毁元数据） */
  const handleSend = useCallback(
    (content: string, privacyOptions?: IMessagePrivacyOptions) => {
      const burn: IBurnPolicy | undefined = toBurnPolicy(effectiveBurnMode, privacy.burnTtlMs);
      // 逐条隐私选项（模糊 / 阅后自焚）随消息密文一起送出，中继无需参与
      return sendMessage(content, burn, privacyOptions);
    },
    [sendMessage, effectiveBurnMode, privacy.burnTtlMs],
  );

  const handleSendImage = useCallback(
    async (file: File) => {
      await sendImage(file);
    },
    [sendImage],
  );

  const handleSendFile = useCallback(
    async (file: File) => {
      await sendFile(file);
    },
    [sendFile],
  );

  const handleRetryMessage = useCallback(
    (msg: IMessage) => {
      retryMessage(msg);
    },
    [retryMessage],
  );

  const handleFileDownload = useCallback((msg: IMessage) => {
    if (!msg.fileData || !msg.fileName) return;
    const ab = msg.fileData.buffer.slice(
      msg.fileData.byteOffset,
      msg.fileData.byteOffset + msg.fileData.byteLength,
    ) as ArrayBuffer;
    const blob = new Blob([ab]);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = msg.fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, []);

  const statusTextMap: Record<ConnectionStatus, string> = {
    connecting: '连接中…',
    connected: `${onlineUsers.length} 人在线`,
    disconnected: '连接断开，重连中…',
    misconfigured: '未配置服务连接信息',
    'auth-error': '认证失败，请检查服务凭据',
  };

  const statusText =
    roomStatus === 'password-error'
      ? '密码错误'
      : roomStatus === 'expired-creating-new'
        ? '房间已过期，创建新房间中…'
        : statusTextMap[status];

  if (!nickname || !roomId || !password) return null;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* ── 顶部栏 ─────────────────────────────────── */}
      <header className="sticky top-0 z-30 w-full bg-background/80 backdrop-blur-md border-b border-border/30">
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 shrink-0 rounded-full"
            onClick={() => {
              playSound('nav:back');
              handleLeave();
            }}
            aria-label="返回"
          >
            <ArrowLeft className="size-4" />
          </Button>

          <div className="flex-1 min-w-0">
            {/*
              房间号：**刻意不使用任何循环/重播动效**。
              此前用 BlurRevealText 时，父组件（剩余时间倒计时每秒重渲染）会让揭示动画反复
              重播 —— 实测 4 秒内产生 229 次样式变更、第二个观察窗口仍持续 163 次，这正是
              「左上角房间号持续闪烁」的成因。现改为纯文本，任何状态下都稳定显示。
            */}
            <h1 className="text-sm font-semibold text-foreground truncate flex items-center gap-1.5">
              <Hash className="size-3.5 text-primary shrink-0" />
              <span className="truncate">{roomId}</span>
            </h1>
            {/*
              状态行：文案改为纯文本（此前同样使用会反复重播的揭示动效，一并去除）。
              等待态仍叠加 SpaceUI 球体；系统「减少动效」时不渲染球体。
            */}
            <div className="flex items-center gap-1.5 min-w-0">
              {!reduceMotion && status === 'connecting' ? (
                <OrbConnecting size={16} speed={1.4} className="shrink-0" />
              ) : null}
              {!reduceMotion && status === 'disconnected' ? (
                <LoadingOrb size={13} speed={420} radius={1.5} gap={1.5} className="shrink-0" />
              ) : null}
              <p className="text-xs text-muted-foreground truncate">{statusText}</p>
            </div>
          </div>

          {/*
            右侧统一成一个 shrink-0 操作组。
            此前在线头像被放在 `min-w-0 overflow-x-auto` 容器里，窄屏时该容器
            可以被压缩到 0 宽，头像会被裁掉一半（用户实际截图即为此问题）。
            现在由标题列负责收缩与截断，右侧元素保持完整。
          */}
          <div className="flex shrink-0 items-center gap-2">
            {remainingInfo && roomStatus === 'active' && (
              <div
                className={`hidden sm:flex items-center gap-2 text-xs px-3 py-1.5 rounded-full border ${
                  remainingInfo.isUrgent
                    ? 'bg-warning-surface text-warning-surface-foreground border-warning-surface-border'
                    : 'bg-muted/60 text-muted-foreground border-transparent'
                }`}
              >
                <Clock className="size-3.5 shrink-0" />
                <span className="whitespace-nowrap">{remainingInfo.text}</span>
                {canExtend && remainingInfo.isUrgent && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleExtend}
                    disabled={isExtending}
                    className="h-6 px-2 text-xs ml-1 -my-1"
                  >
                    {isExtending ? (
                      <Loader2 className="size-3 mr-1 animate-spin" />
                    ) : (
                      <PlusCircle className="size-3 mr-1" />
                    )}
                    加时
                  </Button>
                )}
              </div>
            )}

            {!TRANSPORT_READINESS.ready && (
              <span className="hidden sm:flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border bg-warning-surface text-warning-surface-foreground border-warning-surface-border">
                <ShieldAlert className="size-3.5 shrink-0" />
                未配置服务
              </span>
            )}

            <DropdownMenu onOpenChange={(open) => playSound(open ? 'ui:open' : 'ui:close')}>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 shrink-0 rounded-full"
                  aria-label="隐私设置"
                >
                  <EyeOff className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                  隐私
                </DropdownMenuLabel>
                <DropdownMenuCheckboxItem
                  checked={privacy.typingIndicator}
                  onCheckedChange={(checked) =>
                    updatePrivacy({ typingIndicator: checked === true })
                  }
                  className="items-start"
                >
                  <div className="flex flex-col">
                    <span className="text-sm">显示「正在输入」</span>
                    <span className="text-[10px] text-muted-foreground">
                      {privacy.typingIndicator
                        ? '会显示他人输入状态，也会向他人显示你的'
                        : '默认关闭：不显示他人，也不上报自己'}
                    </span>
                  </div>
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem
                  checked={privacy.blurOnBlur}
                  onCheckedChange={(checked) => updatePrivacy({ blurOnBlur: checked === true })}
                  className="items-start"
                >
                  <div className="flex flex-col">
                    <span className="text-sm">失焦时模糊内容</span>
                    <span className="text-[10px] text-muted-foreground">
                      {privacy.blurOnBlur
                        ? '切换标签页或窗口失焦时遮挡对话内容'
                        : '关闭后窗口失焦时内容保持可见'}
                    </span>
                  </div>
                </DropdownMenuCheckboxItem>
                <DropdownMenuSeparator />
                <p className="px-2 py-1 text-[10px] leading-relaxed text-muted-foreground">
                  隐私设置仅保存在本机。模糊只能遮挡视觉，无法阻止截屏或拍屏。
                </p>
              </DropdownMenuContent>
            </DropdownMenu>

            {/*
              主题切换（SpaceUI 引入首批）：动效形态用默认的 circle（触发点居中），
              按钮外观沿用顶栏图标按钮的样式（ghost + icon 尺寸），与左侧隐私设置按钮一致。
              依赖 `AppShell` 中的 ThemeProvider 提供 next-themes 上下文。
            */}
            <SettingsMenu />
          <ThemeToggleButton size="icon" buttonVariant="ghost" title="切换主题" />

            <OnlineUsersSection users={onlineUsers} currentUserId={clientId} />
          </div>
        </div>

        {/* 认证失败提示：此前只打到控制台，界面永远停在「连接断开，重连中…」 */}
        {status === 'auth-error' && (
          <div
            role="alert"
            className="border-t border-destructive/30 bg-destructive/10 px-4 py-1.5 flex items-center gap-1.5 text-xs text-destructive"
          >
            <ShieldAlert className="size-3.5 shrink-0" />
            <span>
              服务认证失败：请检查 .env.local 中的 VITE_MQTT_USERNAME / VITE_MQTT_PASSWORD
              （含 #、$ 等字符的密码必须用单引号包裹），修改后重启开发服务器
            </span>
          </div>
        )}

        {/* 配置缺失提示（SEC-01） */}
        {!TRANSPORT_READINESS.ready && (
          <div
            role="alert"
            className="border-t border-warning-surface-border bg-warning-surface px-4 py-1.5 flex items-center gap-1.5 text-xs text-warning-surface-foreground"
          >
            <ShieldAlert className="size-3.5 shrink-0" />
            <span>{TRANSPORT_READINESS.hint}</span>
          </div>
        )}

        {/* 焚毁能力降级提示：显式说明，不伪装成服务端权威（状态透明） */}
        {burnModeDowngraded && (
          <div
            role="status"
            className="border-t border-warning-surface-border bg-warning-surface px-4 py-1.5 flex items-center gap-1.5 text-xs text-warning-surface-foreground"
          >
            <Flame className="size-3.5 shrink-0" />
            <span>{BURN_UNAVAILABLE_HINT}</span>
          </div>
        )}

        {/* 移动端剩余时间条 */}
        {remainingInfo && roomStatus === 'active' && remainingInfo.isUrgent && (
          <div className="sm:hidden border-t border-warning-surface-border bg-warning-surface px-4 py-1.5 flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs text-warning-surface-foreground">
              <AlertTriangle className="size-3.5" />
              <span>{remainingInfo.text}</span>
            </div>
            {canExtend && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleExtend}
                disabled={isExtending}
                className="h-6 px-2 text-xs text-warning-surface-foreground hover:bg-warning-surface-border/40"
              >
                {isExtending ? (
                  <Loader2 className="size-3 mr-1 animate-spin" />
                ) : (
                  <PlusCircle className="size-3 mr-1" />
                )}
                加时
              </Button>
            )}
          </div>
        )}
      </header>

      {/* ── 消息列表 ────────────────────────────────── */}
      {/*
        在线成员改为「顶栏头像组 + 点击展开名单浮层」，因此不再需要移动端
        单独挂载一条横条 —— 顺带彻底消除了 AUDIT.md FUNC-17 的重复挂载问题
        （此前桌面/移动两份实例始终同时存在，仅靠 CSS 隐藏）。
      */}
      <div className="relative flex-1 overflow-hidden">
        <div
          className={`max-w-3xl mx-auto h-full transition-[filter,opacity] duration-200 ${
            isBlurred ? 'blur-md opacity-40 select-none' : ''
          }`}
        >
          <MessageListSection
            messages={listMessages}
            onFileDownload={handleFileDownload}
            onRetryMessage={handleRetryMessage}
            onConsume={consumeMessage}
          />
        </div>

        {/* 失焦遮罩：只遮挡对话内容，输入框仍在下方可编辑，草稿不受影响 */}
        {isBlurred && (
          <div
            role="status"
            aria-live="polite"
            className="absolute inset-0 z-20 flex items-center justify-center bg-background/60 backdrop-blur-sm"
          >
            <span className="flex items-center gap-1.5 rounded-full border border-border/60 bg-card/90 px-3 py-1.5 text-xs text-muted-foreground shadow-sm">
              <EyeOff className="size-3.5 shrink-0" />
              <span className="hidden sm:inline">内容已隐藏（窗口失焦）</span>
              <span className="sm:hidden">内容已隐藏</span>
            </span>
          </div>
        )}
      </div>

      {/* ── 输入指示（消息列表底部，与「新消息」提示同一区域）──── */}
      {typers.length > 0 && (
        <div
          className={`mx-auto w-full max-w-3xl px-4 pb-1.5 transition-[filter,opacity] duration-200 ${
            isBlurred ? 'blur-sm opacity-40 select-none' : ''
          }`}
        >
          <div
            role="status"
            aria-live="polite"
            className="flex items-center gap-1.5 text-[11px] text-muted-foreground"
          >
            {/* 减弱动态偏好下自动停用跳动动画（motion-safe） */}
            <span className="flex items-end gap-0.5" aria-hidden="true">
              <span className="size-1 rounded-full bg-muted-foreground/70 motion-safe:animate-bounce [animation-delay:-0.3s]" />
              <span className="size-1 rounded-full bg-muted-foreground/70 motion-safe:animate-bounce [animation-delay:-0.15s]" />
              <span className="size-1 rounded-full bg-muted-foreground/70 motion-safe:animate-bounce" />
            </span>
            <span className="truncate">{formatTypingText(typers)}</span>
          </div>
        </div>
      )}

      {/* ── 底部输入栏 ──────────────────────────────── */}
      <ChatInputSection
        onSend={handleSend}
        onSendImage={handleSendImage}
        onSendFile={handleSendFile}
        onTyping={notifyTyping}
        burnMode={effectiveBurnMode}
        burnTtlMs={privacy.burnTtlMs}
        onBurnModeChange={(mode) => updatePrivacy({ burnMode: mode })}
        onBurnTtlChange={(ttlMs) => updatePrivacy({ burnTtlMs: ttlMs })}
        burnEnforced={burnEnforced}
        disabled={status !== 'connected' || roomStatus !== 'active'}
      />
    </div>
  );
}
