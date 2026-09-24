#!/usr/bin/env node
/**
 * 生产构建脚本（跨平台）。
 *
 * 修复 AUDIT.md ENG-02：此前的 `scripts/build.sh` 依赖 bash、rsync、find、
 * cp -R，在 win32 + PowerShell 下完全无法执行，导致「本地跑不了 build、
 * 只能手敲 npx vite build」的偏差。这里用 Node 标准库等价实现同一套产物布局。
 *
 * 产物布局（与平台约定一致）：
 *   dist/output/            HTML + public/ 静态资源
 *   dist/output_resource/   assets（JS/CSS/字体，上传 CDN）
 *   dist/output_static/     shared/static 私有静态资源（排除代码文件）
 *   dist/output_capabilities/  shared/capabilities 能力声明
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
process.chdir(ROOT);

const DIST = path.join(ROOT, 'dist');
const CLIENT_DIR = path.join(DIST, 'client');
const OUTPUT = path.join(DIST, 'output');
const OUTPUT_RESOURCE = path.join(DIST, 'output_resource');
const OUTPUT_STATIC = path.join(DIST, 'output_static');
const OUTPUT_CAPABILITIES = path.join(DIST, 'output_capabilities');

// 平台环境变量映射（与 miaoda-cli 的构建约定保持一致）
const env = {
  ...process.env,
  CLIENT_BASE_PATH: process.env.MIAODA_APP_ID ? `/app/${process.env.MIAODA_APP_ID}` : '',
  ASSETS_CDN_PATH: process.env.MIAODA_RESOURCE_CDN_PREFIX || '/',
  STATIC_ASSETS_BASE_URL: process.env.MIAODA_STATIC_CDN_PREFIX || '',
  NODE_ENV: process.env.NODE_ENV || 'production',
};

function log(msg) {
  process.stdout.write(`[build] ${msg}\n`);
}

function rm(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function copy(from, to, options) {
  if (!fs.existsSync(from)) return false;
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.cpSync(from, to, { recursive: true, ...options });
  return true;
}

// ── 1. 清理 ────────────────────────────────────────────────────
rm(DIST);

// ── 2. Vite 构建 ───────────────────────────────────────────────
log('vite build ...');
execSync(`npx vite build --outDir "${CLIENT_DIR}" --emptyOutDir`, {
  stdio: 'inherit',
  cwd: ROOT,
  env,
});

// ── 3. public/ + HTML/routes.json → dist/output/ ────────────────
fs.mkdirSync(OUTPUT, { recursive: true });
// 先拷 public（模型 B：public = 应用根目录），再拷构建出的 HTML，保证 HTML 覆盖同名文件
copy(path.join(ROOT, 'public'), OUTPUT);
if (fs.existsSync(CLIENT_DIR)) {
  for (const entry of fs.readdirSync(CLIENT_DIR, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (entry.name === 'routes.json' || entry.name.endsWith('.html')) {
      fs.copyFileSync(
        path.join(CLIENT_DIR, entry.name),
        path.join(OUTPUT, entry.name),
      );
    }
  }
}

// ── 4. assets/ → dist/output_resource/ ─────────────────────────
const clientAssets = path.join(CLIENT_DIR, 'assets');
if (copy(clientAssets, path.join(OUTPUT_RESOURCE, 'assets'))) {
  log('assets → dist/output_resource/assets');
}

// ── 5. shared/static → dist/output_static/（排除代码文件）──────
const sharedStatic = path.join(ROOT, 'shared', 'static');
if (fs.existsSync(sharedStatic)) {
  fs.mkdirSync(OUTPUT_STATIC, { recursive: true });
  fs.cpSync(sharedStatic, OUTPUT_STATIC, {
    recursive: true,
    filter: (src) => !/\.(ts|tsx|js|jsx)$/.test(src),
  });
  log('shared/static → dist/output_static');
}

// ── 6. shared/capabilities → dist/output_capabilities/ ─────────
if (copy(path.join(ROOT, 'shared', 'capabilities'), OUTPUT_CAPABILITIES)) {
  log('shared/capabilities → dist/output_capabilities');
}

// ── 7. 清理中间产物 ───────────────────────────────────────────
rm(CLIENT_DIR);

log('Build complete');
log('  HTML         → dist/output/');
if (fs.existsSync(OUTPUT_RESOURCE)) log('  Resource     → dist/output_resource/');
if (fs.existsSync(OUTPUT_STATIC)) log('  Static       → dist/output_static/');
if (fs.existsSync(OUTPUT_CAPABILITIES)) log('  Capabilities → dist/output_capabilities/');
