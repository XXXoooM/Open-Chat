#!/usr/bin/env node
/**
 * Dev launcher: 启动 vite dev server，把 stdout/stderr 加时间戳前缀
 * 写到 logs/<name>.std.log + 当前 stdout；负责子进程组管理与端口孤儿清理。
 *
 * 跨平台说明（ENG-02）：
 * - 端口清理：Unix 用 lsof，Windows 用 netstat + taskkill
 * - 进程终止：Windows 用 taskkill /T 结束进程树，Unix 用进程组信号
 * - 启动 Vite：不使用 `npx`。Windows 上 `npx` 实际是 `npx.cmd`，Node 在
 *   `shell: false` 时无法执行 .cmd/.bat（会抛 ENOENT），而 `shell: true`
 *   又会引入参数转义风险。因此直接用当前 Node 运行本地 Vite CLI。
 */

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { spawn, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
process.chdir(ROOT);

const IS_WINDOWS = process.platform === 'win32';
const LOG_DIR = process.env.LOG_DIR || 'logs';
const CLIENT_DEV_PORT = process.env.CLIENT_DEV_PORT || '8001';
const RELAY_DEV_PORT = process.env.RELAY_DEV_PORT || '8787';

fs.mkdirSync(LOG_DIR, { recursive: true });

function timestamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ` +
    `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
  );
}

function log(msg) {
  const line = `[${timestamp()}] [dev] ${msg}\n`;
  try { process.stdout.write(line); } catch {}
}

/** 读取占用指定端口的 PID 列表（跨平台） */
function listPidsByPort(port) {
  try {
    if (IS_WINDOWS) {
      // netstat -ano 最后一段是 PID；LISTENING 行才代表端口被占用
      const out = execSync('netstat -ano -p tcp', {
        stdio: ['ignore', 'pipe', 'ignore'],
      }).toString();
      return [
        ...new Set(
          out
            .split(/\r?\n/)
            .filter((line) => line.includes('LISTENING') && line.includes(`:${port}`))
            .map((line) => line.trim().split(/\s+/).pop())
            .filter((pid) => pid && /^\d+$/.test(pid) && pid !== '0'),
        ),
      ];
    }
    const out = execSync(`lsof -ti:${port}`, { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
    return out ? out.split('\n').filter(Boolean) : [];
  } catch {
    return [];
  }
}

/** 终止单个进程（含子进程树） */
function killPid(pid) {
  try {
    if (IS_WINDOWS) {
      execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' });
      return true;
    }
    process.kill(Number(pid), 'SIGKILL');
    return true;
  } catch {
    return false;
  }
}

/** 清理端口占用 */
function killOrphansByPort(port) {
  const pids = listPidsByPort(port);
  for (const pid of pids) {
    if (killPid(pid)) log(`killed orphan pid=${pid} on :${port}`);
  }
  return pids;
}

/** 解析本地 Vite CLI 入口 */
function resolveViteCli() {
  const candidate = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
  return fs.existsSync(candidate) ? candidate : null;
}

/** 解析本地 wrangler CLI 入口（同样用 Node 直接执行，避开 npx 的 .cmd 问题） */
function resolveWranglerCli() {
  const candidate = path.join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
  return fs.existsSync(candidate) ? candidate : null;
}

const managed = [];

function startProcess({ name, command, args, logFileName }) {
  const logFd = logFileName
    ? fs.openSync(path.join(LOG_DIR, logFileName), 'a')
    : null;

  const child = spawn(command, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
    cwd: ROOT,
    env: process.env,
    detached: !IS_WINDOWS,
  });

  // 启动失败（如可执行文件不存在）不会抛异常，而是发出 'error' 事件；
  // 若不监听，Node 会以未捕获错误直接退出并打印难以理解的调用栈。
  child.on('error', (err) => {
    log(`启动 ${name} 失败: ${err.message}`);
    if (err.code === 'ENOENT') {
      log(
        `提示：无法执行 "${command}"。若依赖未安装请先运行 npm install；` +
          `Windows 下不要用 shell:false 直接 spawn .cmd/.bat 文件。`,
      );
    }
  });

  const pipeLines = (stream) => {
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    rl.on('line', (line) => {
      const msg = `[${timestamp()}] [${name}] ${line}\n`;
      try { process.stdout.write(msg); } catch {}
      if (logFd != null) {
        try { fs.writeSync(logFd, msg); } catch {}
      }
    });
  };
  pipeLines(child.stdout);
  pipeLines(child.stderr);

  managed.push({ name, child });
  return child;
}

const viteCli = resolveViteCli();
if (!viteCli) {
  log('未找到 node_modules/vite/bin/vite.js，请先执行 npm install');
  process.exit(1);
}

killOrphansByPort(CLIENT_DEV_PORT);
killOrphansByPort(RELAY_DEV_PORT);

startProcess({
  name: 'client',
  command: process.execPath,
  args: [viteCli, '--port', CLIENT_DEV_PORT, '--host', '0.0.0.0'],
  logFileName: 'client.std.log',
});

// 中继（Cloudflare Workers 本地运行时）。
// 未安装 wrangler 时不阻塞前端启动：此时把 VITE_RELAY_URL 留空即回落到 MQTT 通路。
const wranglerCli = resolveWranglerCli();
if (wranglerCli) {
  startProcess({
    name: 'relay',
    command: process.execPath,
    args: [wranglerCli, 'dev', '--port', RELAY_DEV_PORT],
    logFileName: 'relay.std.log',
  });
} else {
  log('未找到 node_modules/wrangler，跳过中继本地服务（前端将回落到 MQTT 通路）');
}

let stopping = false;
function cleanup(signal) {
  if (stopping) return;
  stopping = true;
  log(`cleanup triggered by ${signal}`);

  for (const { child } of managed) {
    if (!child.pid) continue;
    if (IS_WINDOWS) {
      // Windows 不支持 process.kill(-pid) 的进程组语义，用 taskkill /T 结束进程树
      killPid(child.pid);
    } else {
      try { process.kill(-child.pid, signal || 'SIGTERM'); } catch {}
    }
  }
  setTimeout(() => {
    for (const { child } of managed) {
      if (!child.pid) continue;
      if (!IS_WINDOWS) {
        try { process.kill(-child.pid, 'SIGKILL'); } catch {}
      }
    }
    killOrphansByPort(CLIENT_DEV_PORT);
    killOrphansByPort(RELAY_DEV_PORT);
    process.exit(0);
  }, 2000);
}

process.on('SIGINT', () => cleanup('SIGTERM'));
process.on('SIGTERM', () => cleanup('SIGTERM'));
// pkill 杀父 npm 后会收 SIGHUP（controlling tty 关闭）；
// Node 默认直接退出不跑 handler，注册 handler 触发 cleanup
process.on('SIGHUP', () => cleanup('SIGTERM'));

Promise.race(
  managed.map(({ child }) => new Promise((r) => child.on('exit', r))),
).then(() => cleanup('SIGTERM'));
