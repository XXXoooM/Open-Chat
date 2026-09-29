// EXPORTS: default
import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Users } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { StatusBadge } from '@/components/spaceui/status-badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { playSound } from '@/lib/sound/map';
import { useIsMobile } from '@/hooks/use-mobile';
import { formatClockTime } from '@/lib/chatEvents';
import type { IOnlineUser } from '@/hooks/useMqttChat';

interface OnlineUsersSectionProps {
  users: IOnlineUser[];
  /**
   * 当前用户的连接 id。
   * 修复 AUDIT.md FUNC-16：用昵称判定「我」在重名时会同时高亮，
   * 与消息侧保持一致，改用 id 比对。
   */
  currentUserId: string;
}

/**
 * 头像首字：中日韩取 1 个字，拉丁字母取前 2 位并大写。
 * 此前统一 `slice(0, 2)`，中文昵称会被塞成两个字挤在 28px 的圆里，可读性差。
 */
function initialOf(nickname: string): string {
  const trimmed = nickname.trim();
  if (!trimmed) return '?';
  const first = trimmed.slice(0, 1);
  const isCJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/.test(first);
  return isCJK ? first : trimmed.slice(0, 2).toUpperCase();
}

function avatarTone(isMe: boolean): string {
  return isMe ? 'bg-primary/15 text-primary' : 'bg-accent text-accent-foreground';
}

export default function OnlineUsersSection({ users, currentUserId }: OnlineUsersSectionProps) {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);

  const sorted = useMemo(() => {
    return [...users].sort((a, b) => {
      if (a.id === currentUserId) return -1;
      if (b.id === currentUserId) return 1;
      // 潜水中的成员排在后面，活跃成员优先
      if (!!a.diving !== !!b.diving) return a.diving ? 1 : -1;
      return a.nickname.localeCompare(b.nickname, 'zh-Hans-CN');
    });
  }, [users, currentUserId]);

  // 名单清空时若浮层还开着，Radix 的定位锚点会被移除，这里主动收起
  useEffect(() => {
    if (sorted.length === 0) setOpen(false);
  }, [sorted.length]);

  // 移动端可用宽度更小，减少同行头像数量，其余折叠为 +N
  const maxVisible = isMobile ? 3 : 5;
  const visible = sorted.slice(0, maxVisible);
  const overflow = sorted.length - visible.length;
  const divingCount = sorted.filter((user) => user.diving).length;

  if (sorted.length === 0) return null;

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        playSound(next ? 'ui:open' : 'ui:close');
        setOpen(next);
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          onPointerEnter={() => playSound('ui:hover')}
          className="group flex shrink-0 items-center rounded-full p-1 transition-colors hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          aria-label={`在线成员 ${sorted.length} 人，其中 ${divingCount} 人潜水中，点击查看完整名单`}
        >
          {/* 重叠头像组：外层不设 overflow-hidden，在线点与描边才不会被裁切 */}
          <span className="flex items-center">
            {visible.map((user, i) => {
              const isMe = user.id === currentUserId;
              const isDiving = user.diving === true;
              return (
                <motion.span
                  key={user.id}
                  initial={{ opacity: 0, scale: 0.7 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.22, delay: i * 0.04, ease: [0.16, 1, 0.3, 1] }}
                  // 左侧头像压住右侧头像，形成叠层
                  style={{ zIndex: visible.length - i }}
                  className="relative inline-flex -ml-2 first:ml-0"
                  title={`${isMe ? `${user.nickname}（我）` : user.nickname}${
                    isDiving ? ' · 潜水中' : ''
                  }`}
                >
                  <Avatar
                    className={`size-7 ring-2 transition-transform duration-200 group-hover:-translate-y-px ${
                      isMe ? 'ring-primary/45' : 'ring-background'
                    } ${isDiving ? 'opacity-70' : ''}`}
                  >
                    <AvatarFallback className={`text-[10px] font-semibold ${avatarTone(isMe)}`}>
                      {initialOf(user.nickname)}
                    </AvatarFallback>
                  </Avatar>
                  {/* 状态点：在线绿 / 潜水琥珀 */}
                  <span
                    className={`absolute -bottom-0.5 -right-0.5 size-2 rounded-full ring-2 ring-background ${
                      isDiving ? 'bg-warning' : 'bg-success'
                    }`}
                  />
                </motion.span>
              );
            })}

            {overflow > 0 && (
              <span className="-ml-2 inline-flex size-7 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground ring-2 ring-background">
                +{overflow}
              </span>
            )}
          </span>
        </button>
      </PopoverTrigger>

      <PopoverContent align="end" sideOffset={8} className="w-64 p-2">
        <div className="flex items-center gap-1.5 px-2 pb-1.5 pt-0.5 text-xs font-medium text-muted-foreground">
          <Users className="size-3.5" />
          在线成员 · {sorted.length}
          {divingCount > 0 && (
            <StatusBadge
              status="away"
              size="xs"
              animated={false}
              showIndicator={false}
              primaryText={`${divingCount} 人潜水中`}
            />
          )}
        </div>
        <ul className="max-h-64 space-y-0.5 overflow-y-auto">
          {sorted.map((user) => {
            const isMe = user.id === currentUserId;
            const isDiving = user.diving === true;
            return (
              <li
                key={user.id}
                className="flex items-start gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-muted/60"
              >
                <span className="relative mt-0.5 inline-flex shrink-0">
                  <Avatar className={`size-6 ${isDiving ? 'opacity-70' : ''}`}>
                    <AvatarFallback className={`text-[10px] font-semibold ${avatarTone(isMe)}`}>
                      {initialOf(user.nickname)}
                    </AvatarFallback>
                  </Avatar>
                  <span
                    className={`absolute -bottom-0 -right-0 size-2 rounded-full ring-2 ring-popover ${
                      isDiving ? 'bg-warning' : 'bg-success'
                    }`}
                  />
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-sm text-foreground">{user.nickname}</span>
                    {isMe && (
                      <span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                        我
                      </span>
                    )}
                  </div>
                  {/* 潜水状态 + 进入潜水的时间 */}
                  {isDiving && (
                    <StatusBadge
                      status="away"
                      size="xs"
                      animated={false}
                      className="mt-1"
                      primaryText={`潜水中${
                        typeof user.divedAt === 'number' ? ` · 自 ${formatClockTime(user.divedAt)} 起` : ''
                      }`}
                    />
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
