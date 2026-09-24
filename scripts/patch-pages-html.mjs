#!/usr/bin/env node
/**
 * Pages 专用产物后处理：填实平台注入的 HTML 占位符。
 *
 * 背景（实测结论）：
 * 平台的 Vite 预设会在**构建期**把 index.html 转换为带 `{{appId}}` / `{{basename}}`
 * 这类占位符的模板外壳，原值由平台托管服务在服务时替换。直接部署到 Cloudflare Pages
 * 时没有人做替换，于是 `window.__BASENAME__` 等变量是字面量 `{{basename}}`，
 * 应用虽无任何报错（实测 0 异常 / 0 失败请求），但 React 渲染结果为空 —— 表现为白屏。
 *
 * 开发模式不做该转换，因此本地一切正常；这也是「本地好、线上白」的原因。
 *
 * 本脚本只影响 Pages 产物（dist/pages），平台构建（scripts/build.mjs）不受影响。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const TARGET = path.join(ROOT, 'dist', 'pages', 'index.html');

/**
 * 占位符取值。
 * 平台侧会按登录态动态下发身份类字段；独立部署没有这些上下文，
 * 因此置空（等价于开发模式下的 undefined，已被验证可用），只把
 * 影响渲染与路由的字段填成有效值。
 */
const TOKENS = {
  appId: '',
  userId: '',
  tenantId: '',
  userName: '',
  csrfToken: '',
  environment: 'production',
  // 路由基准路径必须是 / —— 部署在域名根路径
  basename: '/',
  appName: 'Open Chat',
  appDescription: '基于房间号与密码的端到端加密实时聊天室，支持文字、图片与文件传输、阅后即焚与已读回执。',
  appAvatar: '/favicon.svg',
};

function log(msg) {
  process.stdout.write(`[patch-pages-html] ${msg}\n`);
}

if (!fs.existsSync(TARGET)) {
  log(`未找到 ${TARGET}，请先执行 vite build（build:pages）`);
  process.exit(1);
}

const original = fs.readFileSync(TARGET, 'utf8');
let html = original;
const applied = [];

// 三花括号形式（如 `avatar: "{{{appAvatar}}}"`）必须先处理，否则会残留一层花括号
for (const [key, value] of Object.entries(TOKENS)) {
  const triple = new RegExp(`\\{\\{\\{${key}\\}\\}\\}`, 'g');
  const double = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
  if (triple.test(html)) {
    html = html.replace(triple, value);
    applied.push(`{{{${key}}}`);
  }
  if (double.test(html)) {
    html = html.replace(double, value);
    applied.push(`{{${key}}}`);
  }
}

// 兜底：清理未知占位符，避免继续把 `{{xxx}}` 当成真实值使用
const leftovers = [...new Set(html.match(/\{\{\{?[\w.]+\}?\}\}/g) ?? [])];
if (leftovers.length > 0) {
  html = html.replace(/\{\{\{?[\w.]+\}?\}\}/g, '');
  log(`警告：清理了 ${leftovers.length} 个未登记的占位符 -> ${leftovers.join(', ')}`);
}

if (html === original) {
  log('没有需要替换的占位符（可能已是纯静态 HTML）');
  process.exit(0);
}

fs.writeFileSync(TARGET, html, 'utf8');
log(`已替换 ${applied.length} 处占位符：${applied.join(', ')}`);
