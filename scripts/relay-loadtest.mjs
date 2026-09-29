#!/usr/bin/env node
/**
 * 中继负载基线测量：验证并对比「presence 心跳扇出」与「仅保活 ping」两种客户端行为。
 *
 * 用法：
 *   node scripts/relay-loadtest.mjs [both|legacy|new] [连接数...]
 *   node scripts/relay-loadtest.mjs both 25 50 100
 *
 * 前置：本地中继已启动（npm run relay:dev，默认 http://127.0.0.1:8787）
 *
 * 两种流量模式（对应用户端改造前后）：
 *   legacy —— N 个客户端各发 1 条加密 presence 心跳（改造前的行为）。
 *             中继侧 `broadcast` 会遍历全部连接，因此收帧数预期 N×N → 平方增长。
 *   new    —— N 个客户端各发 1 条保活 ping（改造后的行为：中继通路不再广播 presence）。
 *             服务端只单播 pong，收帧数预期 N → 线性且总量极小。
 *
 * 另外验证 `peer-left`：关闭一个连接后，其余连接应收到离开事件
 * （改造后客户端不再靠心跳维持在线名册，这是它判定离开的唯一依据）。
 *
 * 说明：只做协议层连接与收发，不涉及任何加密；房间地址用随机命名空间，
 * 不写入任何固定地址，也不打印房间地址。
 */

const RELAY_HTTP = process.env.RELAY_HTTP || 'http://127.0.0.1:8787';
const RELAY_WS = RELAY_HTTP.replace(/^http/, 'ws');
const ALL_CHANNELS = ['messages', 'presence', 'meta', 'typing', 'receipts'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 与真实加密信封同量级的密文占位（体积影响带宽，内容无意义） */
function fakeEnv(tag) {
  return JSON.stringify({ v: 2, iv: 'F'.repeat(16), data: String(tag).padEnd(160, 'A') });
}

async function waitForHealth(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${RELAY_HTTP}/health`)).ok) return true;
    } catch {
      /* 未就绪 */
    }
    await sleep(500);
  }
  return false;
}

async function waitUntil(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await sleep(5);
  }
  return false;
}

function createClient(idx, baseUrl, cid) {
  // 与真实客户端一致地携带 cid 查询参数：中继用它作为不透明连接标识来广播 peer-left
  const ws = new WebSocket(`${baseUrl}?cid=${encodeURIComponent(cid)}`);
  const c = { idx, ws, received: 0, byType: {} };

  ws.addEventListener('message', (ev) => {
    c.received += 1;
    try {
      const t = JSON.parse(typeof ev.data === 'string' ? ev.data : '').t;
      if (t) c.byType[t] = (c.byType[t] ?? 0) + 1;
    } catch {
      /* 忽略不可解析帧 */
    }
  });

  return new Promise((resolve, reject) => {
    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ t: 'hello', channels: ALL_CHANNELS }));
      resolve(c);
    });
    ws.addEventListener('error', () => reject(new Error(`client ${idx} 连接失败`)));
  });
}

const send = (c, frame) => {
  if (c.ws.readyState === 1) c.ws.send(JSON.stringify(frame));
};
const totalReceived = (clients) => clients.reduce((s, c) => s + c.received, 0);

async function runOnce(mode, n) {
  const roomId = `load${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
  const namespace = `${Math.random().toString(36).slice(2, 12)}${Math.random().toString(36).slice(2, 12)}`;
  const baseUrl = `${RELAY_WS}/room/${roomId}/${namespace}`;

  const clients = [];
  for (let i = 0; i < n; i += 1) {
    clients.push(await createClient(i, baseUrl, `lt-${i}`));
  }
  await sleep(600); // 等 hello 与 ready 处理完

  const baseline = totalReceived(clients);
  const t0 = Date.now();

  if (mode === 'legacy') {
    for (const c of clients) send(c, { t: 'pub', channel: 'presence', env: fakeEnv(`hb${c.idx}`) });
  } else {
    for (const c of clients) send(c, { t: 'ping' });
  }

  // legacy 期望 N×N（扇出含发送者自身）；new 期望 N（仅 pong 单播）
  const expected = mode === 'legacy' ? n * n : n;
  const settled = await waitUntil(() => totalReceived(clients) - baseline >= expected, 30000);
  const settleMs = Date.now() - t0;
  const frames = totalReceived(clients) - baseline;

  // 队头阻塞探测：1 条 messages 消息的端到端延迟
  const probeBase = clients[1].received;
  const probeStart = Date.now();
  send(clients[0], { t: 'pub', channel: 'messages', env: fakeEnv('probe') });
  await waitUntil(() => clients[1].received > probeBase, 15000);
  const probeRttMs = Date.now() - probeStart;

  // 离开事件验证：关闭一个连接，其余连接应收到 peer-left
  const watcher = clients[1];
  const leftBefore = watcher.byType['peer-left'] ?? 0;
  clients[0].ws.close();
  const peerLeftOk = await waitUntil(
    () => (watcher.byType['peer-left'] ?? 0) > leftBefore,
    8000,
  );

  for (const c of clients) c.ws.close();
  await sleep(200);

  return {
    mode,
    n,
    settleMs,
    settled,
    frames,
    expected,
    framesPerSec: Math.round((frames / Math.max(settleMs, 1)) * 1000),
    probeRttMs,
    peerLeftOk,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const modeArg = args.find((a) => ['both', 'legacy', 'new'].includes(a)) ?? 'both';
  const modes = modeArg === 'both' ? ['legacy', 'new'] : [modeArg];
  const sizes = args.map(Number).filter((x) => x > 0);
  const ns = sizes.length ? sizes : [25, 50, 100];

  if (!(await waitForHealth())) {
    console.error(`中继未就绪：${RELAY_HTTP} 无 /health 响应。请先运行 npm run relay:dev`);
    process.exit(1);
  }

  console.log(`中继：${RELAY_HTTP}`);
  console.log('');
  console.log('  模式   |   N | 收敛耗时 | 期望帧数 | 实收帧数 |   帧/秒 | 消息RTT | peer-left');
  console.log('  -------+-----+----------+----------+----------+---------+---------+----------');

  const rows = [];
  for (const mode of modes) {
    for (const n of ns) {
      try {
        const r = await runOnce(mode, n);
        rows.push(r);
        console.log(
          `  ${r.mode.padEnd(6)} | ${String(r.n).padStart(3)} | ` +
            `${((r.settled ? '' : '超时') + `${r.settleMs}ms`).padStart(8)} | ` +
            `${String(r.expected).padStart(8)} | ${String(r.frames).padStart(8)} | ` +
            `${String(r.framesPerSec).padStart(7)} | ${`${r.probeRttMs}ms`.padStart(7)} | ` +
            `${r.peerLeftOk ? '✅ 收到' : '❌ 未收到'}`,
        );
      } catch (err) {
        console.log(`  ${mode.padEnd(6)} | ${String(n).padStart(3)} | 失败: ${err.message}`);
      }
      await sleep(400);
    }
  }

  const legacy = rows.filter((r) => r.mode === 'legacy');
  const next = rows.filter((r) => r.mode === 'new');
  if (legacy.length && next.length) {
    console.log('');
    console.log('改造前后对比（同 N）：');
    for (const l of legacy) {
      const t = next.find((r) => r.n === l.n);
      if (!t) continue;
      const drop = l.frames ? (1 - t.frames / l.frames) * 100 : 0;
      console.log(
        `  N=${String(l.n).padStart(3)}：收帧 ${String(l.frames).padStart(6)} → ${String(t.frames).padStart(5)}（降 ${drop.toFixed(1)}%）` +
          `；消息RTT ${l.probeRttMs}ms → ${t.probeRttMs}ms`,
      );
    }
    console.log('');
    console.log('增长阶（每翻倍人数的收敛耗时倍数，线性≈2×、平方≈4×）：');
    for (const set of [legacy, next]) {
      for (let i = 1; i < set.length; i += 1) {
        const a = set[i - 1];
        const b = set[i];
        if (b.n !== a.n * 2) continue;
        console.log(
          `  ${a.mode.padEnd(6)} N=${a.n} → ${b.n}：${a.settleMs}ms → ${b.settleMs}ms = ${(b.settleMs / Math.max(a.settleMs, 1)).toFixed(2)}×`,
        );
      }
    }
  }
}

main().catch((err) => {
  console.error('压测异常:', err.message);
  process.exit(1);
});
