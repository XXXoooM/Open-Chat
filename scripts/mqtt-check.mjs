#!/usr/bin/env node
/**
 * MQTT 连接自检（针对 EMQX Cloud / 任意 WebSocket Broker）。
 *
 * 为什么需要它：前端连不上时，界面只能告诉你「未连接」，无法区分是
 * 「地址写错」「凭据被拒」「端口/路径不对」还是「网络不可达」。
 * 这个脚本用**与前端传输层完全相同的连接参数**跑一次最小往返，把结论直接说出来。
 *
 * 用法：
 *   node scripts/mqtt-check.mjs                       # 读取 .env.local 里的 VITE_MQTT_*
 *   node scripts/mqtt-check.mjs wss://host:8084/mqtt  # 临时指定地址（仍需 .env.local 的凭据）
 *   node scripts/mqtt-check.mjs wss://broker.emqx.io:8084/mqtt --no-auth   # 公共测试服，免凭据
 *
 * 检查项：DNS/TLS 可达 → CONNACK → 订阅 → 发布往返 → 保留消息是否受支持。
 * 退出码：0 全部通过；1 有失败项。
 */

import fs from 'node:fs';
import path from 'node:path';
import mqtt from 'mqtt';

const args = process.argv.slice(2);
const urlArg = args.find((arg) => arg.startsWith('ws'));
const noAuth = args.includes('--no-auth');

/**
 * `--sizes=64,260,900` 可覆盖大报文档位（单位 KB）。
 * 对公共测试服建议只跑小档，对自己部署则应当跑满 —— 附件依赖 900 KB 那一档。
 */
const sizesArg = args.find((arg) => arg.startsWith('--sizes='));

/**
 * 大报文探测档位（字节）。
 *
 * 为什么必须验：本项目的图片/文件是**以密文经 Broker 转发**的单帧消息，客户端上限
 * 950 KiB。MQTT Broker 有自己的最大报文长度，超出会被断开或拒绝 —— 而「能连上、
 * 能收发小消息」并不能证明附件可用。这里从 64 KB 起逐档加大，把「到哪一档为止可用」
 * 直接测出来（公网测试服可能拒收大报文，务必对自己的部署跑一遍）。
 */
const PAYLOAD_PROBES = [64 * 1024, 260 * 1024, 900 * 1024];

/** 极简 .env.local 解析：与 Vite 的取值规则一致（支持单/双引号包裹） */
function readEnvLocal() {
  const file = path.join(process.cwd(), '.env.local');
  if (!fs.existsSync(file)) return {};
  const env = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    const quoted = /^(['"])(.*)\1$/.exec(value);
    if (quoted) value = quoted[2];
    env[key] = value;
  }
  return env;
}

const fileEnv = readEnvLocal();
const url = (urlArg || fileEnv.VITE_MQTT_URL || '').trim();
const username = noAuth ? '' : fileEnv.VITE_MQTT_USERNAME ?? '';
const password = noAuth ? '' : fileEnv.VITE_MQTT_PASSWORD ?? '';

const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

console.log('=== MQTT 连接自检 ===');
console.log(`  地址来源: ${urlArg ? '命令行参数' : fileEnv.VITE_MQTT_URL ? '.env.local' : '（缺失）'}`);
console.log(`  地址    : ${url || '（空）'}`);
console.log(`  凭据    : ${noAuth ? '不使用（--no-auth）' : username ? `用户名 ${username}，密码 ${password ? '已设置' : '为空'}` : '（缺失）'}`);

if (!url) {
  console.log('\n  未提供地址：请先在 .env.local 设置 VITE_MQTT_URL，或用命令行参数指定。');
  process.exit(1);
}
if (!/^wss?:\/\//i.test(url)) {
  console.log('\n  FAIL  地址协议不合法 — 浏览器端 mqtt.js 只支持 ws:// 或 wss://；');
  console.log('       EMQX Cloud 请使用「WebSocket over TLS/SSL」端口 8084（8883 是原生 MQTT，浏览器用不了）。');
  process.exit(1);
}
if (!noAuth && (!username || !password)) {
  console.log('\n  提示：缺少 VITE_MQTT_USERNAME / VITE_MQTT_PASSWORD。');
  console.log('       EMQX Cloud Serverless 需先在「访问控制 → 客户端认证」创建用户名与密码，');
  console.log('       部署概览页的 API Key 不能用于 MQTT 连接。');
  process.exit(1);
}

const topicBase = `chatroom/__mqtt-check__${Math.random().toString(16).slice(2, 8)}`;
const roundTripTopic = `${topicBase}/messages`;
const retainedTopic = `${topicBase}/meta`;
const payload = `check-${Date.now()}`;

/**
 * 大报文探测刻意复用 `messages` 频道，而不是自造一个探测主题：
 * 托管服务的 ACL 往往只放行应用实际使用的主题，自造主题会被拒绝，
 * 那样测出来的是 ACL 而不是报文长度上限。
 */
let pendingProbe = null;
let payloadIndex = 0;

/** 生效的档位：命令行未指定时用默认全档（含 900 KB，对应附件上限） */
const activePayloadProbes = sizesArg
  ? sizesArg
      .slice('--sizes='.length)
      .split(',')
      .map((value) => Number.parseInt(value.trim(), 10))
      .filter((kb) => Number.isFinite(kb) && kb > 0)
      .map((kb) => kb * 1024)
  : PAYLOAD_PROBES;

const client = mqtt.connect(url, {
  // 与 src/lib/transport/mqttTransport.ts 保持一致的参数形状
  clientId: `mqtt_check_${Math.random().toString(16).slice(2, 10)}`,
  clean: true,
  connectTimeout: 10000,
  // 自检是一次性的：不自动重连，避免失败后脚本挂住
  reconnectPeriod: 0,
  username: username || undefined,
  password: password || undefined,
  will: {
    topic: `${topicBase}/presence`,
    payload: JSON.stringify({ kind: 'leave', sid: 'check' }),
    qos: 1,
    retain: false,
  },
});

let settled = false;
function finish(code) {
  if (settled) return;
  settled = true;
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n=== 结论：${failed === 0 ? '全部通过' : `${failed} 项失败`} ===`);
  try {
    client.end(true);
  } catch {
    /* 忽略 */
  }
  setTimeout(() => process.exit(code), 150);
}

/**
 * 整体超时 = 60 秒固定余量 + 各档位的等待预算之和。
 *
 * 900 KB 档要完成「上传 + 回投」两个方向，慢链路上耗时是十秒级乃至分钟级；
 * 用固定上限会把「慢」判成「不支持」，所以这里按档位动态计算。
 */
const probeBudgetMs = activePayloadProbes.reduce(
  (sum, size) => sum + Math.max(15000, Math.round(size / 1024) * 200),
  0,
);
const overallBudgetMs = 60000 + probeBudgetMs;
const timer = setTimeout(() => {
  record(
    '整体超时',
    false,
    `${Math.round(overallBudgetMs / 1000)} 秒内未完成，请检查地址、端口与网络`,
  );
  finish(1);
}, overallBudgetMs);

/**
 * 保留消息探测。
 *
 * 关键顺序：**先发布保留消息，再订阅该主题** —— 只有「订阅时从保留存储回放」的
 * 报文才会带 retain 标记；订阅在前的话，收到的是普通发布（retain=false），
 * 无法区分「Broker 支持保留」与「只是收到了自己刚发的消息」。
 */
function startRetainProbe() {
  client.publish(retainedTopic, `retained-${payload}`, { qos: 1, retain: true }, (retainErr) => {
    if (retainErr) {
      record('发布保留消息', false, String(retainErr));
      clearTimeout(timer);
      finish(1);
      return;
    }
    record('发布保留消息', true);
    // 让 Broker 完成保留存储后再订阅，避免竞态
    setTimeout(() => {
      client.subscribe(retainedTopic, { qos: 1 }, (subErr) => {
        if (subErr) {
          record('订阅保留主题', false, String(subErr));
          clearTimeout(timer);
          finish(1);
        }
      });
    }, 300);
  });
}

/** 逐档发送大报文；每档都要求「发布被确认 + 能回投收到」，两者缺一都不算通过 */
function runNextPayloadProbe() {
  const size = activePayloadProbes[payloadIndex];
  const marker = `probe:${size}:`;
  const body = marker + 'x'.repeat(Math.max(0, size - marker.length));
  const startedAt = Date.now();

  client.publish(roundTripTopic, body, { qos: 1 }, (err) => {
    if (err) {
      record(`${Math.round(size / 1024)} KB 大报文`, false, `发布被拒绝：${String(err)}`);
      advancePayloadProbe();
      return;
    }
    pendingProbe = { size, marker, startedAt };
    /**
     * 等待时长必须按报文大小给足。
     *
     * 这里踩过一次坑：初版用固定 10 秒，结果 64 KB 档实测往返就要 7.4 秒（公网链路），
     * 于是 260 KB 档被「超时」判成失败 —— 但那其实只是慢。用固定值会把「慢」误判为
     * 「Broker 不支持该报文长度」，结论会完全错。改为约 200 ms/KB、下限 15 秒。
     */
    const waitMs = Math.max(15000, Math.round(size / 1024) * 200);
    setTimeout(() => {
      if (!pendingProbe || pendingProbe.size !== size) return;
      record(
        `${Math.round(size / 1024)} KB 大报文`,
        false,
        `发布已确认但 ${Math.round(waitMs / 1000)} 秒内未收到回投（可能超出 Broker 最大报文长度，或流量被限制）`,
      );
      pendingProbe = null;
      advancePayloadProbe();
    }, waitMs);
  });
}

function advancePayloadProbe() {
  payloadIndex += 1;
  if (payloadIndex >= activePayloadProbes.length) {
    clearTimeout(timer);
    finish(0);
    return;
  }
  setTimeout(runNextPayloadProbe, 200);
}

function startPayloadProbes() {
  if (activePayloadProbes.length === 0) {
    clearTimeout(timer);
    finish(0);
    return;
  }
  runNextPayloadProbe();
}

client.on('connect', () => {
  record('建立连接（CONNACK）', true);
  client.subscribe(roundTripTopic, { qos: 1 }, (err) => {
    if (err) {
      record('订阅主题', false, String(err));
      clearTimeout(timer);
      finish(1);
      return;
    }
    record('订阅主题', true, roundTripTopic);

    // 往返：发布到已订阅的主题，EMQX 默认回投给同一客户端
    client.publish(roundTripTopic, payload, { qos: 1 }, (pubErr) => {
      if (pubErr) {
        record('发布消息（QoS1 确认）', false, String(pubErr));
        clearTimeout(timer);
        finish(1);
      } else {
        record('发布消息（QoS1 确认）', true);
      }
    });
  });
});

const seen = new Set();
client.on('message', (topic, message, packet) => {
  const text = message.toString();

  // 大报文回投：按报文长度与标记双重比对，避免不同档位互相误判
  if (pendingProbe && topic === roundTripTopic && message.length === pendingProbe.size) {
    if (text.startsWith(pendingProbe.marker)) {
      const elapsed = Date.now() - pendingProbe.startedAt;
      const size = pendingProbe.size;
      pendingProbe = null;
      record(`${Math.round(size / 1024)} KB 大报文`, true, `往返 ${elapsed} ms`);
      advancePayloadProbe();
      return;
    }
  }

  if (topic === roundTripTopic && text === payload && !seen.has('round')) {
    seen.add('round');
    record('消息往返（发布 → 收到）', true);
    startRetainProbe();
  }
  if (topic === retainedTopic && packet?.retain && !seen.has('retain')) {
    seen.add('retain');
    record('保留消息回放（订阅即收到 retain 标记）', true);
    // 保留能力验证完毕后，再逐档验证大报文 —— 附件能否工作取决于这一步
    startPayloadProbes();
  }
});

client.on('error', (err) => {
  clearTimeout(timer);
  const code = err?.code;
  const message = err?.message ?? String(err);
  if (code === 4 || code === 5 || /bad username or password|not authorized|unauthorized/i.test(message)) {
    record('认证', false, '用户名或密码被拒绝。若密码含 # / $ 等字符，.env.local 中必须用单引号包裹');
  } else if (/ENOTFOUND|EAI_AGAIN/i.test(message)) {
    record('域名解析', false, `无法解析主机名（${message}）`);
  } else if (/ECONNREFUSED|ETIMEDOUT|timeout/i.test(message)) {
    record('网络可达性', false, `端口不可达或超时（${message}）`);
  } else if (/certificate|TLS|SSL/i.test(message)) {
    record('TLS 握手', false, `证书校验失败（${message}）`);
  } else {
    record('连接', false, message);
  }
  finish(1);
});

client.on('close', () => {
  if (!settled && results.length > 0) {
    clearTimeout(timer);
    record('连接被关闭', false, '未完成全部检查');
    finish(1);
  }
});
