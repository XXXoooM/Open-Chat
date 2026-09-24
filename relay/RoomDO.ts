// RoomDO —— 房间中继（Cloudflare Durable Object）
//
// 职责：频道扇出、房间状态权威裁决、焚毁仲裁、已读回执、Alarm 清扫。
//
// 隐私不变量（严禁违反）：
// 1. `env` 是不透明密文信封，中继不得解析、解密或落盘其内容
// 2. 不记录房间地址明文：本类拿不到 roomId（DO 名由 Worker 从密码派生命名空间计算）
// 3. 只持久化必要元数据：房间寿命、最近一条 meta 密文、焚毁标记、已读计数
//
// 计费考量：使用 WebSocket Hibernation（acceptWebSocket + 回调），
// 空闲房间不驻留内存；定时开销统一走 Alarm，为 O(房间数) 而非 O(连接数)。

import type { DurableObjectState } from '@cloudflare/workers-types';
import {
  READ_BURN_FALLBACK_MS,
  RELAY_MAX_BURN_MARKS,
  RELAY_MAX_FRAME_BYTES,
  RELAY_SWEEP_INTERVAL_MS,
  RELAY_SOCKET_TIMEOUT_MS,
  clampDestroyAt,
  computeBurnAt,
  encodeFrame,
  parseClientFrame,
  type IPubFrame,
  type IRoomRecord,
  type RelayChannel,
  type ServerFrame,
} from '../shared/relay/protocol';

/** 每个连接随附的元数据：休眠重启后由 attachment 恢复，故不可只放内存 */
interface IAttachment {
  clientId: string;
  channels: RelayChannel[];
  lastSeen: number;
  /** 已上报过已读的消息 id（去重，写回时轮转淘汰） */
  readIds: string[];
}

interface IRoomStorage {
  room: IRoomRecord | null;
  meta: { env: string; at: number } | null;
  /** 已焚毁的消息 id：永久不再投递（后来者不可见），有界保留 */
  burned: string[];
  /** 定时焚毁：id → 焚毁时间戳 */
  pending: Record<string, number>;
  /** 读后焚毁：id → 发布时间（用于兜底上限判定） */
  awaitingRead: Record<string, number>;
  /** 已读计数：id → 人数（身份不落盘，避免泄露谁读了什么） */
  reads: Record<string, number>;
  /** 应读人数：id → 目标值 */
  targets: Record<string, number>;
}

const STORAGE_KEY = 'state';
const READ_ID_MEMORY = 500;

function emptyStorage(): IRoomStorage {
  return {
    room: null,
    meta: null,
    burned: [],
    pending: {},
    awaitingRead: {},
    reads: {},
    targets: {},
  };
}

export class RoomDO {
  private readonly state: DurableObjectState;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  // ── 存储 ──────────────────────────────────────────────────────

  private async load(): Promise<IRoomStorage> {
    const stored = await this.state.storage.get<IRoomStorage>(STORAGE_KEY);
    if (!stored) return emptyStorage();
    return { ...emptyStorage(), ...stored };
  }

  private async save(store: IRoomStorage): Promise<void> {
    await this.state.storage.put(STORAGE_KEY, store);
  }

  private attachmentOf(ws: WebSocket): IAttachment {
    const raw = ws.deserializeAttachment() as IAttachment | null;
    if (raw && typeof raw.clientId === 'string') return raw;
    return { clientId: '', channels: [], lastSeen: Date.now(), readIds: [] };
  }

  private persistAttachment(ws: WebSocket, att: IAttachment): void {
    if (att.readIds.length > READ_ID_MEMORY) {
      att.readIds.splice(0, att.readIds.length - READ_ID_MEMORY);
    }
    ws.serializeAttachment(att);
  }

  // ── 发送 ──────────────────────────────────────────────────────

  private send(ws: WebSocket, frame: ServerFrame): void {
    if (ws.readyState !== 1) return;
    ws.send(encodeFrame(frame));
  }

  private broadcast(channel: RelayChannel, frame: ServerFrame, skip?: WebSocket): void {
    for (const ws of this.state.getWebSockets()) {
      if (ws === skip) continue;
      const att = this.attachmentOf(ws);
      if (!att.channels.includes(channel)) continue;
      this.send(ws, frame);
    }
  }

  private broadcastAll(frame: ServerFrame, skip?: WebSocket): void {
    for (const ws of this.state.getWebSockets()) {
      if (ws === skip) continue;
      this.send(ws, frame);
    }
  }

  private subscriberCount(channel: RelayChannel): number {
    let count = 0;
    for (const ws of this.state.getWebSockets()) {
      if (this.attachmentOf(ws).channels.includes(channel)) count += 1;
    }
    return count;
  }

  private reject(ws: WebSocket, code: string, message: string): void {
    this.send(ws, { t: 'error', code, message });
  }

  // ── 连接 ──────────────────────────────────────────────────────

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected WebSocket upgrade', { status: 426 });
    }

    const url = new URL(request.url);
    const now = Date.now();
    const pair = new WebSocketPair();
    const clientSocket = pair[0];
    const serverSocket = pair[1];

    const att: IAttachment = {
      clientId: url.searchParams.get('cid') ?? '',
      channels: [],
      lastSeen: now,
      readIds: [],
    };
    serverSocket.serializeAttachment(att);
    this.state.acceptWebSocket(serverSocket);

    const store = await this.load();

    if (store.room && store.room.destroyAt <= now) {
      this.send(serverSocket, { t: 'closed' });
      return new Response(null, { status: 101, webSocket: clientSocket });
    }

    this.send(serverSocket, { t: 'ready' });
    // 权威状态回放（等价 MQTT retained meta）：仅回放，不接受客户端清空
    if (store.meta) {
      this.send(serverSocket, {
        t: 'msg',
        channel: 'meta',
        env: store.meta.env,
        retained: true,
      });
    }
    await this.scheduleAlarm(store);
    return new Response(null, { status: 101, webSocket: clientSocket });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const att = this.attachmentOf(ws);
    att.lastSeen = Date.now();

    if (typeof message !== 'string') {
      this.persistAttachment(ws, att);
      this.reject(ws, 'binary-unsupported', '中继仅接受文本帧');
      return;
    }
    if (message.length > RELAY_MAX_FRAME_BYTES) {
      this.persistAttachment(ws, att);
      this.reject(ws, 'too-large', '单帧超出上限');
      return;
    }

    const frame = parseClientFrame(message);
    if (!frame) {
      this.persistAttachment(ws, att);
      this.reject(ws, 'bad-frame', '无法解析的帧');
      return;
    }

    if (frame.t === 'ping') {
      this.persistAttachment(ws, att);
      this.send(ws, { t: 'pong' });
      return;
    }
    if (frame.t === 'hello') {
      att.channels = frame.channels;
      this.persistAttachment(ws, att);
      return;
    }
    if (frame.t === 'read') {
      this.persistAttachment(ws, att);
      await this.handleRead(att, frame.id);
      return;
    }

    this.persistAttachment(ws, att);
    await this.handlePub(ws, att, frame);
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const att = this.attachmentOf(ws);
    // 以 socket 关闭取代 MQTT 明文遗嘱：无需泄露任何标识即可判定离开
    if (att.clientId) this.broadcastAll({ t: 'peer-left', id: att.clientId }, ws);
    ws.close(1000, 'closed');
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    ws.close(1011, 'error');
  }

  // ── 发布与焚毁仲裁 ────────────────────────────────────────────

  private async handlePub(ws: WebSocket, att: IAttachment, frame: IPubFrame): Promise<void> {
    const now = Date.now();
    const store = await this.load();

    if (store.room && store.room.destroyAt <= now) {
      this.send(ws, { t: 'closed' });
      return;
    }
    if (!att.channels.includes(frame.channel)) {
      this.reject(ws, 'not-subscribed', '未订阅该频道');
      return;
    }

    if (frame.channel === 'meta') {
      // 权威裁决：拒绝清空（SEC-06 在该通路上不再成立）
      if (!frame.env) {
        this.reject(ws, 'meta-clear-rejected', '房间状态不允许被清空');
        return;
      }
      store.meta = { env: frame.env, at: now };
      if (frame.room) {
        store.room = {
          createdAt: frame.room.createdAt,
          destroyAt: clampDestroyAt(frame.room.destroyAt, now),
        };
      }
      await this.save(store);
      await this.scheduleAlarm(store);
      this.broadcast('meta', { t: 'msg', channel: 'meta', env: frame.env });
      return;
    }

    if (frame.id && store.burned.includes(frame.id)) {
      // 已焚毁：不再向任何人投递（后来者不可见）
      this.reject(ws, 'burned', '该消息已焚毁');
      return;
    }

    if (frame.id && frame.burn) {
      const target = Math.max(1, this.subscriberCount('messages') - 1);
      if (frame.burn.mode === 'read') {
        store.awaitingRead[frame.id] = now;
        store.reads[frame.id] = 0;
        store.targets[frame.id] = target;
      } else {
        const burnAt = computeBurnAt(frame.burn, now);
        if (burnAt !== null) store.pending[frame.id] = burnAt;
      }
      await this.save(store);
      await this.scheduleAlarm(store);
    }

    // 与 MQTT 一致地把报文回显给发送者：前端依赖回显把「发送中」推进为「已发送」
    this.broadcast(frame.channel, {
      t: 'msg',
      channel: frame.channel,
      env: frame.env,
      id: frame.id,
      burn: frame.burn,
    });
  }

  private async handleRead(att: IAttachment, id: string): Promise<void> {
    if (att.readIds.includes(id)) return;
    att.readIds.push(id);

    const store = await this.load();
    if (store.burned.includes(id)) return;

    const awaiting = store.awaitingRead[id];
    const timed = store.pending[id];
    if (awaiting === undefined && timed === undefined) return;

    const total = store.targets[id] ?? Math.max(1, this.subscriberCount('messages') - 1);
    const readBy = Math.min((store.reads[id] ?? 0) + 1, total);
    store.reads[id] = readBy;
    store.targets[id] = total;

    // 必须先回报进度再判断焚毁：否则「首次读即满足目标」的场景下
    // 发送方会直接收到焚毁而看不到任何已读信息。
    this.broadcastAll({ t: 'receipt', id, readBy, total });

    // 读后焚毁：全员已读即焚毁；定时焚毁由 Alarm 到点触发
    if (awaiting !== undefined && readBy >= total) {
      await this.markBurned(store, id);
      return;
    }

    await this.save(store);
  }

  /** 标记焚毁：广播焚毁指令、清理中间态、登记有界标记 */
  private async markBurned(store: IRoomStorage, id: string): Promise<void> {
    delete store.pending[id];
    delete store.awaitingRead[id];
    delete store.reads[id];
    delete store.targets[id];
    if (!store.burned.includes(id)) {
      store.burned.push(id);
      if (store.burned.length > RELAY_MAX_BURN_MARKS) {
        store.burned.splice(0, store.burned.length - RELAY_MAX_BURN_MARKS);
      }
    }
    await this.save(store);
    this.broadcastAll({ t: 'burn', id });
  }

  // ── Alarm：房间到期与清扫 ─────────────────────────────────────

  async alarm(): Promise<void> {
    const now = Date.now();
    const store = await this.load();

    if (store.room && store.room.destroyAt <= now) {
      this.broadcastAll({ t: 'closed' });
      for (const ws of this.state.getWebSockets()) ws.close(1000, 'room-closed');
      await this.state.storage.deleteAll();
      return;
    }

    for (const [id, at] of Object.entries(store.pending)) {
      if (at <= now) await this.markBurned(store, id);
    }
    // 读后焚毁兜底：有人始终未读时也要给出确定结果，避免中间态永久挂起
    for (const [id, publishedAt] of Object.entries(store.awaitingRead)) {
      if (now - publishedAt >= READ_BURN_FALLBACK_MS) await this.markBurned(store, id);
    }

    // 半开连接不会触发 close 事件，需主动清扫，否则成员表会持续虚高
    for (const ws of this.state.getWebSockets()) {
      const att = this.attachmentOf(ws);
      if (now - att.lastSeen < RELAY_SOCKET_TIMEOUT_MS) continue;
      this.send(ws, { t: 'error', code: 'timeout', message: '连接超时' });
      ws.close(1000, 'timeout');
    }

    await this.scheduleAlarm(await this.load());
  }

  /** 只允许把 Alarm 提前，不允许推迟，避免高频取消/重设造成额外唤醒 */
  private async scheduleAlarm(store: IRoomStorage): Promise<void> {
    const now = Date.now();
    const candidates: number[] = [now + RELAY_SWEEP_INTERVAL_MS];
    if (store.room) candidates.push(store.room.destroyAt);
    for (const at of Object.values(store.pending)) candidates.push(at);
    for (const publishedAt of Object.values(store.awaitingRead)) {
      candidates.push(publishedAt + READ_BURN_FALLBACK_MS);
    }
    const next = Math.min(...candidates.filter((at) => at > now));
    const current = await this.state.storage.getAlarm();
    if (current === null || next < current) {
      await this.state.storage.setAlarm(next);
    }
  }
}
