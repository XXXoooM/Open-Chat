// EXPORTS: ChatEventKind, CHAT_EVENT_LABEL, IChatEventPayload, DIVE_THRESHOLD_MS,
//          DIVE_SCAN_INTERVAL_MS, formatClockTime, formatSilentDuration, describeDiveBaseline

/** 聊天室动态事件的三种类型 */
export type ChatEventKind = 'join' | 'leave' | 'dive';

export interface IChatEventPayload {
  kind: ChatEventKind;
  /**
   * 事件发生时间。
   * 潜水事件取「跨过未发言阈值」的那一刻（baseline + 阈值），而不是扫描发现它的时刻 ——
   * 扫描有间隔，若用扫描时间，「进入潜水状态的时间」会有最多一个扫描周期的误差。
   */
  at: number;
  userId: string;
  /** 仅潜水事件：该用户最后一次发言的时间；从未发言时为空 */
  baselineAt?: number;
  /**
   * 仅离开事件：true 表示「心跳超时被判为离线」而不是主动离开。
   * 两者在时间线上语义不同（主动离开 vs 失联），分开呈现才不会误导。
   */
  timedOut?: boolean;
}

export const CHAT_EVENT_LABEL: Record<ChatEventKind, string> = {
  join: '进入了房间',
  leave: '离开了房间',
  dive: '开始潜水',
};

/** 事件动作文案：离开事件需要区分主动离开与失联 */
export function describeEventAction(payload: IChatEventPayload): string {
  if (payload.kind === 'leave' && payload.timedOut) return '失去连接（长时间无响应）';
  return CHAT_EVENT_LABEL[payload.kind];
}

/**
 * 「长时间未发言」的阈值。
 * 当前 5 分钟：更短会让安静房间被潜水通知刷屏，更长则失去提醒意义。
 * 想快速验证效果，可临时改成 60_000（1 分钟）。
 */
export const DIVE_THRESHOLD_MS = 5 * 60 * 1000;

/** 潜水状态扫描间隔：越短越及时，但会产生更多无谓的重渲染 */
export const DIVE_SCAN_INTERVAL_MS = 15 * 1000;

/** 与消息时间戳一致的展示格式：当天 HH:MM，其它日期 MM-DD HH:MM */
export function formatClockTime(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  if (date.toDateString() === now.toDateString()) return `${hours}:${minutes}`;
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  return `${month}-${day} ${hours}:${minutes}`;
}

/** 把「未发言时长」转成简短文案：90 秒 → 2 分钟 */
export function formatSilentDuration(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60000));
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest > 0 ? `${hours} 小时 ${rest} 分` : `${hours} 小时`;
}

/** 潜水事件的补充说明：沉默是从什么时候开始的 */
export function describeDiveBaseline(payload: IChatEventPayload, now = Date.now()): string {
  if (payload.kind !== 'dive') return '';
  if (typeof payload.baselineAt === 'number') {
    return `已 ${formatSilentDuration(now - payload.baselineAt)}未发言（最后发言 ${formatClockTime(payload.baselineAt)}）`;
  }
  return '进入房间后一直未发言';
}
