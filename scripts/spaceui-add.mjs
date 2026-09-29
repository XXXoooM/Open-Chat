#!/usr/bin/env node
/**
 * SpaceUI 受控落盘脚本（controlled vendoring）
 *
 * 为什么不用官方 CLI：上游 546 个 registry:ui 条目中有 60 个会把文件写到 components/ui/*，
 * 与本项目 55 个既有界面组件同名冲突；且 registryDependencies 会反向牵出 primitives-avatar /
 * primitives-tooltip / primitives-button（分别指向已定制的 avatar.tsx / tooltip.tsx / button.tsx）。
 * 详见 SPACEUI_INTEGRATION.md。
 *
 * 用法：
 *   node scripts/spaceui-add.mjs <item...> [--apply] [--force] [--allow-pro]
 *
 * 默认是 --dry-run（只出清单、不写盘）。必须显式 --apply 才会落盘。
 *   --apply      真正写入文件
 *   --force      允许覆盖「已存在且内容不同」的文件（默认拒绝）
 *   --allow-pro  允许引入标记为 PRO（付费）的条目（默认拒绝）
 *
 * 产出契约：
 *   { mode, items, deps: { need, present, blocked },
 *     writes: [{ from, to, item, rewrites, bytes, exists }],
 *     skipped: [{ path, reason }], conflicts, unresolvedImports }
 */

import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REGISTRY_BASE = 'https://www.spaceui.one/r';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 白名单：这些既有文件绝不允许被写入（改道后理论上不会命中，作为纵深防御） */
const PROTECTED_PREFIXES = [
  'src/components/ui/',
  'src/lib/utils.ts',
  'components.json',
  'tsconfig.json',
  'tsconfig.app.json',
  'tsconfig.node.json',
  'vite.config.ts',
  'src/index.css',
  'src/tailwind-theme.css',
  'src/styles/vendor/',
];

/** 条目级阻断：绝不安装，理由会写入 skipped */
const ITEM_BLOCKLIST = new Map([
  ['lib-utils', '会覆盖 src/lib/utils.ts，并把 cn 换成第三方 cn 包；本项目已有等价实现（clsx + tailwind-merge）'],
  ['lib-style', '平台样式预设，会注入上游主题变量与 HSL 调色板，破坏本项目主题层'],
  ['lib-colors-neutral', '平台主题条目，理由同上'],
]);

/** 依赖包阻断：实测不可用、或与本项目既有实现冲突、或本轮不纳入 */
const DEP_BLOCKLIST = new Map([
  ['@space-ui-components/react', '实测 HTTP 404，包不存在'],
  ['zod-v4', '0.0.1 占位包，非 Zod'],
  ['cn', '第三方无关包；本项目已有 cn（clsx + tailwind-merge）'],
  [
    '@usespaceui/squircle',
    '不引入：上游用它以 Houdini paint worklet 提供 .squircle，本项目改用原生 CSS corner-shape 实现（见 src/styles/spaceui/tokens.css），少一个 0.1.x 依赖且无需 JS',
  ],
  ['@usespaceui/gradients', '本轮不纳入（按需再评估）'],
  ['@usespaceui/sounds', '本轮不纳入（按需再评估）'],
  ['@usespaceui/squishmoji', '本轮不纳入（按需再评估）'],
  ['@usespaceui/emoji', '本轮不纳入（按需再评估）'],
  ['@usespaceui/avatars', '本轮不纳入（按需再评估）'],
  ['@keyline-icons/react', '本轮不纳入（按需再评估）'],
  ['reicon-react', '来源未确认，暂不引入'],
]);

/** import 重写规则：把上游期望的路径改到本项目隔离命名空间 */
const IMPORT_REWRITES = [
  { from: /@\/components\/ui\//g, to: '@/components/spaceui/ui/', why: '原语改道，避免覆盖 src/components/ui/' },
  { from: /@\/hooks\//g, to: '@/hooks/spaceui/', why: 'hooks 改道到独立目录' },
];

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const itemNames = args.filter((a) => !a.startsWith('--'));
const APPLY = flags.has('--apply');
const FORCE = flags.has('--force');
const ALLOW_PRO = flags.has('--allow-pro');

if (!itemNames.length) {
  console.error('用法: node scripts/spaceui-add.mjs <item...> [--apply] [--force] [--allow-pro]');
  process.exit(1);
}

/** 从注册表条目名或 URL 中取出条目名 */
function itemNameOf(ref) {
  const s = String(ref).trim();
  if (!s) return '';
  if (s.startsWith('http')) {
    const base = s.split('/').pop() || '';
    return base.replace(/\.json$/, '');
  }
  return s;
}

async function fetchItem(name) {
  const url = `${REGISTRY_BASE}/${name}.json`;
  const res = await fetch(url, { headers: { 'user-agent': 'spaceui-add/1.0' } });
  if (!res.ok) throw new Error(`拉取 ${url} 失败：HTTP ${res.status}`);
  return res.json();
}

/**
 * 目标路径映射。返回 { dest, rewrote } 或 { skipReason }
 * 规则来自 SPACEUI_INTEGRATION.md §2 的路径映射表。
 */
function resolveDestination(file) {
  const rawTarget = (file.target || '').replace(/^\.?\//, '');
  // 无 target 时从源路径推导（去掉上游 src/registry/ 前缀）
  const fallback = (file.path || '').replace(/^src\/registry\//, '');
  const t = rawTarget || fallback;

  if (!t) return { skipReason: '条目的 files[] 既无 target 也无法从 path 推导落点' };

  if (t.startsWith('components/ui/')) {
    return { dest: `src/components/spaceui/ui/${t.slice('components/ui/'.length)}`, rewrote: true };
  }
  if (t.startsWith('components/')) return { dest: `src/${t}`, rewrote: false };
  if (t.startsWith('hooks/')) return { dest: `src/hooks/spaceui/${t.slice('hooks/'.length)}`, rewrote: true };
  if (t.startsWith('lib/')) return { skipReason: `lib/* 条目统一跳过（避免覆盖既有工具函数）：${t}` };
  if (t.startsWith('styles/') || t.endsWith('.css')) {
    return { skipReason: `样式类条目不入库，改由自持 token 文件提供：${t}` };
  }
  return { dest: `src/${t}`, rewrote: false };
}

function isProtected(dest) {
  return PROTECTED_PREFIXES.some((p) => dest === p || dest.startsWith(p));
}

/** 按固定顺序改写 import，并统计改写处数 */
function rewriteImports(content) {
  let out = content;
  let rewrites = 0;
  for (const rule of IMPORT_REWRITES) {
    const hits = out.match(rule.from);
    if (hits && hits.length) {
      out = out.replace(rule.from, rule.to);
      rewrites += hits.length;
    }
  }
  return { content: out, rewrites };
}

/**
 * 找出改写后仍未解析的 @/ 导入，供人工确认。
 * resolveSet 必须同时包含「本次将落盘的文件」与「仓库既有文件」，
 * 否则会把 @/lib/utils 这类已存在的路径误报为未解析。
 */
function findUnresolvedImports(content, resolveSet) {
  const found = new Set();
  const re = /from\s+['"](@\/[^'"]+)['"]/g;
  let m;
  while ((m = re.exec(content))) {
    const spec = m[1];
    const bare = spec.slice(2);
    const candidates = [
      `src/${bare}.tsx`,
      `src/${bare}.ts`,
      `src/${bare}/index.tsx`,
      `src/${bare}/index.ts`,
    ];
    if (!candidates.some((c) => resolveSet.has(c))) found.add(spec);
  }
  return [...found].sort();
}

async function readRepoFile(rel) {
  try {
    const buf = await readFile(path.join(ROOT, rel));
    return { exists: true, content: buf.toString('utf8') };
  } catch {
    return { exists: false, content: null };
  }
}

/** 递归列出仓库 src/ 下所有源码文件（相对路径），用于导入解析判定 */
async function listSourceFiles() {
  const out = new Set();
  async function walk(relDir) {
    let entries;
    try {
      entries = await readdir(path.join(ROOT, relDir), { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const rel = relDir ? `${relDir}/${e.name}` : e.name;
      if (e.isDirectory()) await walk(rel);
      else if (/\.(tsx?|css)$/.test(e.name)) out.add(rel);
    }
  }
  await walk('src');
  return out;
}

async function main() {
  // ── 1. 递归收集条目（含 registryDependencies） ────────────────────────────
  const items = new Map();
  const skipped = [];
  const queue = itemNames.map((n) => ({ name: itemNameOf(n), via: 'cli' }));
  const seen = new Set();

  while (queue.length) {
    const { name, via } = queue.shift();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const blocked = ITEM_BLOCKLIST.get(name);
    if (blocked) {
      skipped.push({ path: `item:${name}`, reason: `${blocked}（来源：${via}）` });
      continue;
    }
    const item = await fetchItem(name);
    items.set(name, item);
    if (item.isPro && !ALLOW_PRO) {
      skipped.push({ path: `item:${name}`, reason: '标记为 PRO（付费）条目，需单独确认许可后加 --allow-pro' });
    }
    for (const dep of item.registryDependencies || []) {
      queue.push({ name: itemNameOf(dep), via: name });
    }
  }

  // ── 2. 计算落点与内容 ────────────────────────────────────────────────────
  const writes = new Map(); // dest -> { from, content, rewrites, item }
  for (const [name, item] of items) {
    if (item.isPro && !ALLOW_PRO) continue;
    for (const file of item.files || []) {
      const { dest, skipReason } = resolveDestination(file);
      const from = file.path || '(无 path)';
      if (skipReason) {
        skipped.push({ path: from, reason: skipReason });
        continue;
      }
      if (isProtected(dest)) {
        skipped.push({ path: from, reason: `落点命中白名单，拒绝写入：${dest}` });
        continue;
      }
      if (!file.content) {
        skipped.push({ path: from, reason: '条目未内联 content（需人工取源文件）' });
        continue;
      }
      const { content, rewrites } = rewriteImports(file.content);
      const prev = writes.get(dest);
      if (prev && prev.content !== content) {
        skipped.push({ path: from, reason: `同一落点出现不同内容，需人工裁决：${dest}` });
        continue;
      }
      writes.set(dest, { from, content, rewrites, item: name });
    }
  }

  // ── 3. 依赖清单（与本项目 package.json 比对） ─────────────────────────────
  const pkg = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'));
  const declared = new Set([...Object.keys(pkg.dependencies || {}), ...Object.keys(pkg.devDependencies || {})]);
  const needed = new Set();
  const blockedDeps = new Map();
  for (const [name, item] of items) {
    if (item.isPro && !ALLOW_PRO) continue;
    for (const dep of item.dependencies || []) {
      const reason = DEP_BLOCKLIST.get(dep);
      if (reason) blockedDeps.set(dep, reason);
      else if (!declared.has(dep)) needed.add(dep);
    }
  }

  // ── 4. 预检：目标文件是否已存在且内容不同（先全量校验，再统一写入） ───────
  const existingDests = new Set();
  const conflicts = [];
  const unchanged = [];
  for (const [dest, w] of writes) {
    const { exists, content } = await readRepoFile(dest);
    if (!exists) continue;
    existingDests.add(dest);
    if (content === w.content) unchanged.push(dest);
    else if (!FORCE) conflicts.push(dest);
  }

  // ── 5. 未解析导入报告（同时考虑本次落盘文件与仓库既存文件） ──────────────
  const resolveSet = new Set([...writes.keys(), ...(await listSourceFiles())]);
  const unresolved = new Map();
  for (const [dest, w] of writes) {
    const list = findUnresolvedImports(w.content, resolveSet);
    if (list.length) unresolved.set(dest, list);
  }

  // ── 5b. 硬校验：被阻断的依赖是否真的被落盘代码 import ─────────────────────
  // 例：liquid-sortable-list 会 `import … from '@usespaceui/avatars'`。若放过，落盘后就是
  // 一个无法解析的引用。宁可中止，也不要落下半成品。
  const escRe = (s) => s.replace(/[/\\^$*+?.()|[\]{}]/g, '\\$&');
  for (const [dest, w] of writes) {
    for (const dep of blockedDeps.keys()) {
      if (new RegExp(`from\\s+['"]${escRe(dep)}(/[^'"]*)?['"]`).test(w.content)) {
        throw new Error(
          `条目 ${w.item} 的 ${dest} 依赖了被阻断的包 ${dep}（${blockedDeps.get(dep)}）。` +
            `请先决定是否引入该包，或不要落盘该条目。`,
        );
      }
    }
  }

  // ── 6. 输出契约 ──────────────────────────────────────────────────────────
  const report = {
    mode: APPLY ? 'apply' : 'dry-run',
    items: [...items.keys()],
    deps: {
      need: [...needed].sort(),
      present: [...declared].filter((d) => !needed.has(d)).length,
      blocked: [...blockedDeps].map(([name, reason]) => ({ name, reason })),
    },
    writes: [...writes].map(([to, w]) => ({
      from: w.from,
      to,
      item: w.item,
      rewrites: w.rewrites,
      bytes: w.content.length,
      exists: existingDests.has(to),
    })),
    skipped: [...skipped, ...unchanged.map((d) => ({ path: d, reason: '内容一致，无需写入（幂等）' }))],
    conflicts,
    unresolvedImports: [...unresolved].map(([file, imports]) => ({ file, imports })),
  };

  console.log(`\n模式：${report.mode}${FORCE ? '（--force 允许覆盖）' : ''}${ALLOW_PRO ? '（--allow-pro）' : ''}`);
  console.log(`\n条目（${items.size}）：${[...items.keys()].join(', ') || '（无）'}`);
  console.log(`\n需安装的依赖（${report.deps.need.length}）：${report.deps.need.join(', ') || '（无）'}`);
  if (report.deps.blocked.length) {
    console.log(`被阻断的依赖（${report.deps.blocked.length}）：`);
    for (const b of report.deps.blocked) console.log(`  - ${b.name}：${b.reason}`);
  }

  const fresh = report.writes.filter((w) => !w.exists);
  const mods = report.writes.filter((w) => w.exists);
  console.log(`\n落盘清单（新增 ${fresh.length} / 改写 ${mods.length}）：`);
  for (const w of report.writes) {
    const rw = w.rewrites ? `，import 改写 ${w.rewrites} 处` : '';
    console.log(`  [${w.exists ? '改写' : '新增'}] ${w.to}  <- ${w.from}  (${w.bytes} 字节${rw}) [${w.item}]`);
  }

  if (report.skipped.length) {
    console.log(`\n跳过（${report.skipped.length}）：`);
    for (const s of report.skipped) console.log(`  - ${s.path}：${s.reason}`);
  }
  if (report.conflicts.length) {
    console.log(`\n⚠️ 目标已存在且内容不同，默认拒绝写入（${report.conflicts.length}）：`);
    for (const c of report.conflicts) console.log(`  - ${c}`);
    console.log('  确认无误后加 --force 覆盖。');
  }
  if (report.unresolvedImports.length) {
    console.log('\n⚠️ 改写后仍未解析的导入（需人工确认）：');
    for (const u of report.unresolvedImports) console.log(`  - ${u.file}: ${u.imports.join(', ')}`);
  } else {
    console.log('\n导入解析检查：全部可解析 ✓');
  }

  // ── 7. 写入 ──────────────────────────────────────────────────────────────
  if (!APPLY) {
    console.log('\n（dry-run：未写入任何文件。加 --apply 执行落盘）');
    return;
  }
  if (report.conflicts.length) {
    console.log('\n存在冲突文件，已中止写入（未落任何半成品）。');
    process.exitCode = 2;
    return;
  }

  let written = 0;
  for (const [dest, w] of writes) {
    if (unchanged.includes(dest)) continue;
    const abs = path.join(ROOT, dest);
    await mkdir(path.dirname(abs), { recursive: true });
    const tmp = `${abs}.tmp-${process.pid}`;
    await writeFile(tmp, w.content, 'utf8');
    await rename(tmp, abs); // 原子替换，避免半成品
    written += 1;
  }
  console.log(`\n已写入 ${written} 个文件。`);
  console.log('下一步：npm run typecheck && npm run lint:eslint && npm run build');
  console.log('并确认 git diff --stat 对白名单路径为空（见 SPACEUI_INTEGRATION.md §5）。');
}

main().catch((err) => {
  console.error(`\n失败：${err.message}`);
  console.error('未写入任何文件（所有拉取与预检均先于写入完成）。');
  process.exitCode = 1;
});
