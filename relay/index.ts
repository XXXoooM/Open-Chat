// Worker 入口：把 WebSocket 升级请求路由到对应房间的 Durable Object。
//
// 准入模型（关键设计）：Durable Object 名称由「房间号 + 密码派生命名空间」构成。
// 命名空间由客户端用 PBKDF2 从房间密码派生，服务端不持有密码，
// 因此**只有知道密码的人才能算出这个地址** —— 与现有 MQTT 通路同强度，
// 且不需要（也不可能）让服务端验证签名，从而不削弱端到端加密。
//
// 由此产生两条硬性约束：
// 1. 严禁把房间地址写入日志；确需记录时只记哈希前缀
// 2. 不得引入「全局共享准入密钥」这类弱化手段

import { RoomDO } from './RoomDO';

export { RoomDO };

export interface Env {
  ROOM: DurableObjectNamespace;
  /** 可选：允许的来源白名单（逗号分隔）。留空表示不限制来源 */
  ALLOWED_ORIGINS?: string;
}

/** 房间地址：/room/{roomId}/{namespace} */
const ROUTE = /^\/room\/([^/]+)\/([^/]+)$/;

function isOriginAllowed(request: Request, allowList: string | undefined): boolean {
  if (!allowList) return true;
  const origin = request.headers.get('Origin');
  if (!origin) return true;
  return allowList
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .includes(origin);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // 健康检查：不暴露任何房间信息
    if (url.pathname === '/health') {
      return new Response('ok', { status: 200 });
    }

    const match = ROUTE.exec(url.pathname);
    if (!match) return new Response('Not found', { status: 404 });

    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected WebSocket upgrade', { status: 426 });
    }

    if (!isOriginAllowed(request, env.ALLOWED_ORIGINS)) {
      return new Response('Forbidden origin', { status: 403 });
    }

    const [, roomId, namespace] = match;
    const id = env.ROOM.idFromName(`${roomId}:${namespace}`);
    const stub = env.ROOM.get(id);
    return stub.fetch(request);
  },
};
