import { useEffect, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ArrowRight, Hash, Lock, Eye, EyeOff, Info, AlertTriangle, ShieldAlert } from 'lucide-react';
import {
  readStoredNickname,
  readStoredRoomId,
  writeStoredChatIdentity,
  writeSessionPassword,
} from '@/lib/chatStorage';
import { getTransportReadiness } from '@/lib/transport';

/** 密码强度下限（SEC-03）：房间密码直接决定聊天内容的加密强度 */
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 64;
const MAX_NICKNAME_LENGTH = 20;
const MAX_ROOM_ID_LENGTH = 10;

export default function NicknameInputSection() {
  const navigate = useNavigate();
  const location = useLocation();

  const [roomId, setRoomId] = useState(() => readStoredRoomId());
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [nickname, setNickname] = useState(() => readStoredNickname());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // 修复 AUDIT.md FUNC-05：消费 ChatPage 通过路由 state 传来的失败原因。
  // 此前发送方会传 '密码错误' / '房间已销毁'，但欢迎页从未读取，导致静默跳转。
  useEffect(() => {
    const state = location.state as { error?: string } | null;
    if (!state?.error) return;
    setErrorMessage(state.error);
    // 清空路由 state，避免刷新后重复弹出同一个提示
    navigate(location.pathname, { replace: true, state: null });
  }, [location.state, location.pathname, navigate]);

  const trimmedRoomId = roomId.trim();
  const trimmedNickname = nickname.trim();
  const passwordTooShort = password.length > 0 && password.length < MIN_PASSWORD_LENGTH;

  // 传输层可用性：中继优先，其次 MQTT。判定集中在 transport 模块，此处不感知具体通路。
  const readiness = getTransportReadiness();

  const isValid =
    trimmedRoomId !== '' &&
    password.length >= MIN_PASSWORD_LENGTH &&
    trimmedNickname !== '' &&
    readiness.ready;

  const handleSubmit = (e?: FormEvent) => {
    e?.preventDefault();
    if (!isValid || isSubmitting) return;

    setIsSubmitting(true);
    writeStoredChatIdentity(trimmedRoomId, trimmedNickname);
    // 密码仅写入 sessionStorage：刷新可恢复，关闭标签页即失效（FUNC-06）
    writeSessionPassword(password);
    setErrorMessage(null);

    navigate('/chat', {
      state: { roomId: trimmedRoomId, password, nickname: trimmedNickname },
    });
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-md mx-auto">
      <div className="rounded-2xl bg-card border border-border/50 shadow-sm p-6 space-y-4">
        {/* 连接配置缺失提示（SEC-01） */}
        {!readiness.ready && (
          <div className="flex items-start gap-2 rounded-xl border border-warning-surface-border bg-warning-surface px-3 py-2.5 text-xs text-warning-surface-foreground">
            <ShieldAlert className="size-4 shrink-0 mt-0.5" />
            <span>{readiness.hint}</span>
          </div>
        )}

        {/* 上一轮失败原因（FUNC-05） */}
        {errorMessage && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-xs text-destructive"
          >
            <AlertTriangle className="size-4 shrink-0 mt-0.5" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* 聊天室 ID */}
        <div className="space-y-1.5">
          <label
            htmlFor="room-id-input"
            className="text-sm font-medium text-foreground flex items-center gap-1.5"
          >
            <Hash className="size-3.5 text-primary" />
            聊天室 ID
          </label>
          <p className="text-xs text-muted-foreground">
            输入数字 ID，相同 ID 且相同密码的用户将在同一房间聊天
          </p>
          <Input
            id="room-id-input"
            type="text"
            inputMode="numeric"
            value={roomId}
            onChange={(e) => setRoomId(e.target.value.replace(/\D/g, ''))}
            onKeyDown={handleKeyDown}
            placeholder="请输入聊天室 ID（数字）..."
            maxLength={MAX_ROOM_ID_LENGTH}
            autoFocus
            className="h-11 rounded-xl"
            disabled={isSubmitting}
          />
        </div>

        {/* 分隔 */}
        <div className="border-t border-border/40" />

        {/* 房间密码 */}
        <div className="space-y-1.5">
          <label
            htmlFor="room-password-input"
            className="text-sm font-medium text-foreground flex items-center gap-1.5"
          >
            <Lock className="size-3.5 text-primary" />
            房间密码
          </label>
          <p className="text-xs text-muted-foreground flex items-start gap-1.5">
            <Info className="size-3 shrink-0 mt-0.5" />
            创建房间后，请通过私下渠道将房间号和密码告知好友。密码是聊天内容的唯一密钥，
            建议至少 {MIN_PASSWORD_LENGTH} 位并混合字母与数字
          </p>
        </div>
        <div className="relative">
          <Input
            id="room-password-input"
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`请输入房间密码（至少 ${MIN_PASSWORD_LENGTH} 位）...`}
            maxLength={MAX_PASSWORD_LENGTH}
            aria-invalid={passwordTooShort}
            className="h-11 rounded-xl pr-11"
            disabled={isSubmitting}
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-muted-foreground hover:text-foreground rounded-md focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none"
            aria-label={showPassword ? '隐藏密码' : '显示密码'}
          >
            {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
        {passwordTooShort && (
          <p className="text-xs text-warning-surface-foreground">
            密码长度至少 {MIN_PASSWORD_LENGTH} 位（当前 {password.length} 位），
            过短的密码会显著降低加密强度
          </p>
        )}

        {/* 分隔 */}
        <div className="border-t border-border/40" />

        {/* 昵称 */}
        <div className="space-y-1.5">
          <label
            htmlFor="nickname-input"
            className="text-sm font-medium text-foreground"
          >
            你的昵称
          </label>
          <p className="text-xs text-muted-foreground">
            输入一个昵称，加入聊天室与大家交流
          </p>
        </div>

        <div className="flex gap-2">
          <Input
            id="nickname-input"
            type="text"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="请输入昵称..."
            maxLength={MAX_NICKNAME_LENGTH}
            className="flex-1 h-11 rounded-xl"
            disabled={isSubmitting}
          />
          <Button
            type="submit"
            size="default"
            disabled={!isValid || isSubmitting}
            className="h-11 px-5 rounded-xl shrink-0"
          >
            <span className="hidden sm:inline">进入聊天室</span>
            <ArrowRight className="size-4 sm:ml-1.5" />
          </Button>
        </div>
      </div>
    </form>
  );
}
