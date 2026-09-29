# SpaceUI 集成评估与记录

> 目的：作为「逐项确认」的凭据与集成追溯记录。**每项落地前须经确认**。
> 收录范围：把 [SpaceUI](https://github.com/adrielzimbril/spaceui)（MIT，shadcn 注册表分发）的组件引入本项目 Open-Chat。
> 最后更新：2026-09-29

---

## 1. 关键前置决策：Radix 保留、Base UI 隔离共存

**问题**：本项目现有 26 个 `@radix-ui/react-*` 能否被 `@base-ui/react` 替代？
**结论**：**部分可行 —— 技术上成立，但收益为零、成本明确，故不替换，改为隔离共存。**

### 1.1 实测证据

| 维度 | 事实 |
|---|---|
| 功能覆盖 | Base UI 现有 37 个组件；本项目引用的 26 个 Radix 包中 **25 个有对应**（hover-card ↔ Preview Card、dropdown-menu ↔ Menu、label ↔ Field）。**唯一缺口 `aspect-ratio`**（可用 CSS 原生属性绕过） |
| 必然混合 | `react-day-picker`、`embla-carousel-react`、`recharts`、`react-resizable-panels`、`sonner` 两方都不覆盖 → 纯替换在任何情况下都不成立 |
| 迁移成本（`src/components/ui/` 55 文件内实测） | `data-[state=…]` **159 处**、进出场动画类 **120 处**、`asChild` **30 处**、定位变体 **51 处**；Base UI 改用 `data-open`/`data-closed` 与 `data-starting-style`/`data-ending-style` + CSS transition，**动画层需整体重做** |
| 迁移必要性 | 55 个界面组件中**仅 7 个被业务代码引用**（button 5、dropdown-menu 2、input 2、avatar / popover / sonner / image 各 1），**48 个未被业务引用**；26 个 Radix 包则全部被引用 |
| 社区与维护 | Radix：各包 2026-07-24 统一发版、单包版本数 189–429、`@radix-ui/react-dialog` 周下载 84,555,388；Base UI：`1.8.0`（2026-09-04）、总版本数仅 12、周下载 16,848,701 |
| 解包体积 | Base UI **单包 9,402.7KB**；Radix 分包 dialog 97KB / dropdown-menu 104.8KB / select 343.8KB / scroll-area 202.5KB / navigation-menu 230.2KB / slider 166.8KB / aspect-ratio 12.7KB / slot 43.8KB |

替换技术成立（真实迁移面仅 avatar / button / dropdown-menu / popover 四个包装），但**不带来任何用户可见改善，却要重写 300 余处选择器与 API，并把 55 个文件整体拉入回归面**。而 Base UI 的出现只由一件事驱动：SpaceUI 的部分组件需要它。

### 1.2 边界规则（优先级等同硬约束）

1. 禁止把既有 `src/components/ui/**` 迁移或改写到 Base UI；Radix 层原地不动。
2. Base UI 只允许出现在 `src/components/spaceui/**` 内；反向禁止 SpaceUI 目录导入既有界面原语。
3. 落盘的 SpaceUI 原语一律改道 `src/components/spaceui/ui/*`，不得覆盖 `src/components/ui/*`。
4. 禁止跨库嵌套传参：不得把 Radix 的 `asChild` 用法套在 Base UI 组件上或反之，需要组合时用普通元素包裹。
5. 每批以 `git diff --stat` 反证白名单零改动。
6. 48 个未使用界面组件的清理属独立任务，不在本次范围。

> **实测补充**：业务代码中 `asChild` 仅 4 处，且**全部是 Radix 触发器**（`OnlineUsersSection.tsx:66` PopoverTrigger、`ChatInputSection.tsx:172/198`、`ChatPage.tsx:359` DropdownMenuTrigger），**从未用在 `<Button>` 上** → 与 Base UI 组合的冲突面很小。

---

## 2. 逐项评估表

「落点」为落盘后的实际路径；「覆盖既有文件」指是否会改写本项目已有文件（**任何一项为「是」即不可直接安装**）。

### 2.1 首批候选（全站细节主线）

| 条目 | 外部依赖 | 落点 | 覆盖既有文件 | PRO | 状态 |
|---|---|---|---|---|---|
| `components-spaceui-theme-toggle` | `motion`、`next-themes`、`@tabler/icons-react` | `src/components/spaceui/theme-toggle.tsx` + `morph-icon.tsx` | 否（但注册表依赖 `primitives-button`→`components/ui/button.tsx` ⚠️ 需改道） | 否 | **首批** |
| `components-spaceui-button-squircle` | `@usespaceui/squircle`、`@base-ui/react`、`class-variance-authority` | `src/components/spaceui/button-squircle.tsx` | 否 | 否 | **首批** |
| `components-spaceui-glass-button` | `@base-ui/react`、cva、`@usespaceui/squircle` | `src/components/spaceui/glass-button.tsx` | 否（注册表依赖 `button-squircle`，同目录） | 否 | **首批** |
| `components-spaceui-badge-squircle` | `@usespaceui/squircle`、`@base-ui/react`、cva | `src/components/spaceui/badge-squircle.tsx` | 否 | 否 | **首批** |
| `components-orb-thinking` | **无** | `src/components/orb/thinking/`（16 文件） | 否 | 否 | **首批（链路验证）** |

### 2.2 后续批次候选

| 条目 | 外部依赖 | 落点 | 覆盖既有文件 | PRO | 状态 |
|---|---|---|---|---|---|
| `components-orb-loading` | `motion` | `src/components/orb/loading/index.tsx` | 否 | 否 | 第二批 |
| `components-spaceui-morphing-text` | `motion` | `src/components/spaceui/morphing-text.tsx` | 否 | 否 | 第二批 |
| `components-spaceui-blur-reveal-text` | `motion` | `src/components/spaceui/blur-reveal-text.tsx` | 否 | 否 | 第二批 |
| `components-spaceui-flip-text` | 无 | `src/components/spaceui/flip-text.tsx` | 否 | 否 | 第二批 |
| `components-spaceui-avatar-group` | 无 | `src/components/spaceui/avatar-group.tsx` | 否 | 否 | 第三批 |
| `components-spaceui-status-badge` | `class-variance-authority` | `src/components/spaceui/status-badge.tsx` | 否 | 否 | 第三批 |
| `components-spaceui-icon-stack` | 无 | `src/components/spaceui/icon-stack.tsx` | 否 | 否 | 第三批 |
| `components-spaceui-user-presence-avatar` | `motion` | `src/components/spaceui/user-presence-avatar.tsx` | **否，但会牵出 `primitives-avatar`→`components/ui/avatar.tsx`、`primitives-tooltip`→`components/ui/tooltip.tsx` ⚠️ 必须改道** | 否 | 第三批（需改道） |
| `components-spaceui-avatar-extended` | `@base-ui/react` | `src/components/spaceui/avatar-extended.tsx` | 否 | 否 | 第三批 |
| `components-spaceui-notification-list` | `motion`、`lucide-react` | `src/components/spaceui/notification-list.tsx` | 否 | 否 | 第三批（疑点已解除，见 §3.2） |
| `components-spaceui-liquid-switch` | `motion` | `src/components/spaceui/liquid-switch.tsx` | 否 | 否 | 按需 |
| `components-spaceui-timeline` | `@base-ui/react` | `src/components/spaceui/timeline.tsx` | 否 | 否 | 按需 |
| `components-spaceui-liquid-sortable-list` | `@usespaceui/avatars`、`motion`、`lucide-react` | `src/components/spaceui/liquid-sortable-list.tsx` | 否 | 否 | 按需（新图标库非必需） |
| `components-spaceui-slide-to-confirm` | `motion`、`@tabler/icons-react`、`torph` | `src/components/spaceui/slide-to-confirm.tsx` | 否 | 否 | 按需 |
| `components-spaceui-fluid-countdown` | `@number-flow/react`、`motion`、`@tabler/icons-react` | `src/components/spaceui/fluid-countdown.tsx` | 否 | 否 | 按需 |

### 2.3 重成本 / 排除项

| 条目 | 外部依赖 | 处理 | 理由 |
|---|---|---|---|
| `components-orb-smooth` / `components-orb-bloop` | `vgpu` | 暂不引入 | 需 WebGL，首屏与兼容性成本高 |
| `components-spaceui-liquid-metal-border` | `@paper-design/shaders-react` | 暂不引入 | 着色器依赖，需懒加载验证后再定 |
| `components-spaceui-voice-chat-widget` | `motion`、`lucide-react`、`@usespaceui/avatars`、`@usespaceui/squishmoji`、`@keyline-icons/react`、`@usespaceui/squircle` | 暂不引入 | 依赖面最广（含 3 个 0.1.x 早期包），且属功能而非视觉 |
| `components-spaceui-silk-border` | `vgpu` | **不引入** | PRO 付费条目，需单独确认许可 |
| **`lib-utils`** | **`cn`（第三方无关包）** | **禁止安装** | **会覆盖 `src/lib/utils.ts` 并引入第三方 `cn` 包**；上游实现与本项目现有 `cn` 等价（见 §3.1） |
| 任何依赖 `@space-ui-components/react` 的条目 | — | 排除 | 实测 HTTP 404，包不存在 |
| 任何依赖 `zod-v4` 的条目 | — | 排除 | 0.0.1 占位包，非 Zod |

---

## 3. 本轮实测核实的关键结论

### 3.1 `lib-utils` 必须跳过（重要）

上游 `lib-utils` 条目内容全文仅一行：

```ts
export { cn, type ClassValue } from 'cn'
```

其 `dependencies` 为 **`cn`**（npm 上的第三方无关包，非官方工具，上游文档疑似笔误），且 `target` 是 **`lib/utils.ts`** —— 即：**安装它就是覆盖本项目 `src/lib/utils.ts`，并把 `cn` 换成第三方包**。

本项目现有实现（`src/lib/utils.ts`）是事实标准写法，功能等价：

```ts
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
export function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }
```

→ **落盘脚本必须硬编码跳过 `lib-utils`**，并把 SpaceUI 组件中的 `@/lib/utils` 导入保持指向本项目现有文件（不做改道）。

### 3.2 `notification-list` 的疑点已解除

上游 `components-spaceui-notification-list.json` 实测**没有任何 `registryDependencies`**（此前「无法解析的依赖」是空数组成员的解析假象）。其 `dependencies` 为 `motion`、`lucide-react`（本项目已有 lucide），无 PRO 标记，落点 `components/spaceui/notification-list.tsx` → **可安全引入**。

### 3.3 主题现状：必须补前置条件（重要）

| 事实 | 证据 |
|---|---|
| **没有 `ThemeProvider`** | 全项目 `ThemeProvider` / `setTheme` 引用数为 0 |
| `next-themes` 装了但业务不可达 | 唯一引用是 `src/components/ui/sonner.tsx:13`，而 `ui/` 目录被 tsconfig / eslint 双重排除（见 `AUDIT.md:982`） |
| **没有任何代码挂载 `.dark` 类** | `documentElement` / `classList` / `prefers-color-scheme` 全项目搜索结果为 0 |
| **`.dark` 只覆盖了色阶、没覆盖语义 token** | `src/styles/vendor/tailwind-theme.css:192` 起的 `.dark` 块只有 `--color-*` 色阶重映射；语义 token（`--background` / `--foreground` / `--card` …）只在 `src/tailwind-theme.css:1-96` 的 `:root` 中定义，**无 `.dark` 对应块** |

→ **含义**：即使手动给 `<html>` 加 `.dark`，页面主体（`bg-background` / `text-foreground`）**也不会变色**。因此主题切换的落地顺序必须是：**先补 `.dark` 语义 token 覆盖（只追加到新文件）→ 再挂 `ThemeProvider` → 最后才是切换按钮**。这也是「主题切换」不能只靠引入一个按钮组件完成的原因。

### 3.4 仍需实测确认的项

- `@usespaceui/squircle` 的注入机制（CSS Houdini / paint worklet / 自定义 utility）与 Tailwind v4 的兼容方式 —— 安装后立即验证
- Base UI 是否支持子路径导入（如 `@base-ui/react/dialog`），影响 tree-shaking 效果
- `motion` 12.x 与 13.x 的 API 差异 —— 已按上游钉 `^12.43`，安装后核对 `motion/react` 导入可用
- `lib-font-*` 与 `links.css` 等样式类条目一律不入库

---

## 4. 接入点清单（实测，含行号）

| 用途 | 接入位置 | 备注 |
|---|---|---|
| **主题切换按钮** | `src/pages/ChatPage/ChatPage.tsx:321-411`（header 内右上角 `flex shrink-0 items-center gap-2`） | 该按钮区已成型；`OnlineUsersSection` 在 `:410` |
| **连接中 / 等待态球体** | `src/pages/ChatPage/ChatPage.tsx:275-288`（`statusTextMap`）+ `:312`（渲染 `statusText`） | `connecting` / `disconnected` 是球体的两个状态 |
| **内联 spinner 替换点** | `ChatPage.tsx:341`、`ChatPage.tsx:466`、`ChatInputSection.tsx:297` | 现为 `Loader2 + animate-spin` |
| **成员在线头像组** | `src/pages/ChatPage/components/OnlineUsersSection.tsx:73-114` | 头像 `:90-98`，状态点 `:100-104` |
| **成员名单（Popover）** | `OnlineUsersSection.tsx:118-168` | 头像 `:134-138`、状态点 `:139-143` |
| **`ui/avatar` 唯一调用点** | `OnlineUsersSection.tsx:5`（import）、`:90`、`:134` | 改道后不影响此处 |
| **消息动效基线** | `src/pages/ChatPage/components/MessageListSection.tsx`（`AnimatePresence` `:161`，气泡 `:229-360`） | 统一缓动 **`[0.16, 1, 0.3, 1]`**，时长 0.2–0.7s —— 新文字动效须复用 |
| **主题挂载点（缺失，需新建）** | `src/components/AppShell.tsx:22-29` | 仅在确认缺失时挂 Provider |
| **应用外壳** | `src/index.tsx:17-27`（入口）、`Layout.tsx:12-14`（仅 `<Outlet/>`）、`app.tsx:9-15`（路由） | `Layout.tsx` 无 DOM，不适合放注入逻辑 |

---

## 5. 白名单与门禁

**白名单（任何批次都不得产生 diff）**：

```
src/components/ui/
src/lib/utils.ts
components.json
tsconfig.json  tsconfig.app.json  tsconfig.node.json
vite.config.ts
src/index.css  src/tailwind-theme.css  src/styles/vendor/
```

**每批门禁**：

1. `git diff --stat` 对上述路径**必须为空**（新增文件不受影响）
2. `npm run typecheck` 0 错误
3. `npm run lint:eslint` 0 错误
4. `npm run build` 成功，并记录 gzip 体积增量（单批 > 既有 bundle 15% 时该批大体积项改懒加载）
5. 浏览器实测：前后截图对比、控制台无错误、交互可用、`prefers-reduced-motion` 下正确降级

> **门禁实现注意**：`eslint.config.mjs` 的 `globalIgnores` 已包含 `**/components/ui/**`，该目录**不参与 lint**，因此不能靠 lint 守住界面原语目录 —— 该侧只靠 `git diff` 门禁。lint 侧只负责约束新增的 SpaceUI 目录，且 `no-restricted-imports` 已全局启用于 `next/link`，新增规则**必须写成文件级配置对象**，否则会连带禁止 SpaceUI 自身使用。

---

## 6. 回滚方式

每批均满足：**改动只落在新目录 + 纯追加行**，无既有文件被替换。回滚步骤：

1. 删除该批新增目录（如 `src/components/spaceui/`、`src/components/orb/`）
2. 从 `package.json` 移除该批引入的依赖（若该批之后无人使用）
3. 还原追加内容：`src/styles/index.css`、`src/tailwind-theme.css`、`eslint.config.mjs`、`src/components/AppShell.tsx`（git checkout 对应文件即可）

---

## 7. 变更日志

| 日期 | 变更 | 说明 |
|---|---|---|
| 2026-09-29 | 建立评估表与决策记录 | 完成接入点盘点；核实 `lib-utils` 必须跳过、`notification-list` 疑点解除、主题前置条件缺失 |
| 2026-09-29 | **首批落地完成** | 落盘 23 文件、新增 3 个钉版依赖、接入顶栏主题切换；typecheck/lint/build 全绿、白名单 diff 为空、真实浏览器实测通过 |

### 首批（全站细节主线）落地明细

**落盘条目**（`node scripts/spaceui-add.mjs … --apply`，23 个文件全部为新增，白名单零命中）：

| 条目 | 落点 | 说明 |
|---|---|---|
| `components-orb-thinking` | `src/components/orb/thinking/`（16 文件） | 零注册表依赖、零外部依赖，用于打通整条受控落盘链路；尚未接入 UI |
| `components-spaceui-theme-toggle` | `src/components/spaceui/theme-toggle.tsx` | 已接入顶栏 |
| `components-spaceui-button-squircle` | `src/components/spaceui/button-squircle.tsx` | 超椭圆圆角按钮基座 |
| `components-spaceui-glass-button` | `src/components/spaceui/glass-button.tsx` | 玻璃质感按钮 |
| `components-spaceui-badge-squircle` | `src/components/spaceui/badge-squircle.tsx` | 超椭圆徽标 |
| 注册表依赖（自动带入） | `src/components/spaceui/morph-icon.tsx`、`src/components/spaceui/ui/button.tsx`、`src/components/spaceui/ui/spinner.tsx` | 原语已按规则改道到 `spaceui/ui/*`，**未触碰** `src/components/ui/*` |

**新增依赖**（钉版与上游一致）：`motion@^12.43.0`（**非 npm 最新的 13.x**）、`@base-ui/react@1.7.0`（精确）、`@tabler/icons-react@^3.48.0`。
**未引入** `@usespaceui/squircle`：上游用它以 Houdini paint worklet 提供 `.squircle`，本项目改用原生 `corner-shape` 实现（见 `src/styles/spaceui/tokens.css`），少一个 0.1.x 依赖、无需 JS 且可优雅降级。

**主题运行时补齐**（此前完全缺失）：`src/components/AppShell.tsx` 挂载 `ThemeProvider`（`attribute="class"` + `defaultTheme="light"` + `storageKey="open-chat-theme"`），并在首帧后写入 `theme-ready` 类以启用颜色过渡、避免刷新闪烁。

**体积增量**（gzip）：JS 296.05 → **302.85 kB（+6.80 kB）**；CSS 因新增工具类 137.5 → 157.5 kB（gzip 25.73 kB）。远低于 15% 阈值。

**本地修补（非上游原文，重新落盘时需保留）**：
`src/components/spaceui/theme-toggle.tsx` 的 `ThemeToggleButtonProps` 由
`extends UseThemeToggleProps, Omit<ButtonProps, 'onClick' | 'size'>` 改为
`Omit<ButtonProps, 'onClick' | 'size' | 'variant'>`。
原因：`ButtonProps.variant` 与 `UseThemeToggleProps.variant` 是两个不同的联合类型，接口同时继承会触发 TS2320。按钮外观本就由 `buttonVariant` 单独传参，故排除不改变运行时行为。

**浏览器实测结论**（零安装 CDP 探针，截图 `.tmp` 目录 `spaceui-verify/{light,dark}.png`）：

| 验证项 | 结果 |
|---|---|
| 顶栏渲染与主题按钮 | `header: true`、header 内 4 个按钮、切换按钮可定位 ✓ |
| 亮色基线未被改变 | `--background: hsl(30 20% 97%)`（与改造前一致）✓ |
| 点击切换 | `<html>` 变为 `theme-ready dark`，`--background: hsl(220 15% 11%)`、`--foreground: hsl(30 20% 95%)`、`body` 计算背景 `rgb(24, 27, 32)` ✓ |
| 持久化与可逆 | `open-chat-theme` 写入 `dark`，再次点击回到 `light` ✓ |
| squircle 能力 | `CSS.supports('corner-shape','squircle') === true`；组件自身用 `[corner-shape:superellipse(1.25)]`，与原生方案一致 ✓ |

### 已知限制（下一步处理，不在首批范围）

1. **`next-themes` 在纯 Vite SPA 中会渲染一个 `<script>`，触发 2 条 React 控制台报错**（「Encountered a script tag while rendering React component」）。该脚本本用于 SSR 场景的首屏防闪烁，在 SPA 下**不会执行**，因此不影响功能，但属于新增的控制台噪音。
   代价：暗色用户首次加载可能出现一次亮色闪烁（`theme-ready` 已抑制过渡动画，但不能消除首帧配色）。
   建议修法：在 `index.html` 的入口脚本之前加一段内联引导脚本，按 `open-chat-theme` 提前给 `<html>` 写入 `light`/`dark` 类（这正是 Next.js 免费获得的能力）。
2. `components-orb-thinking` 尚未接入任何界面（首批只用于验证链路）。

### 第二批（等待态与文字动效）落地明细

**落盘条目**（4 个文件、**0 个新依赖**）：`components-orb-loading` → `src/components/orb/loading/index.tsx`；`components-spaceui-morphing-text` / `components-spaceui-blur-reveal-text` / `components-spaceui-flip-text` → `src/components/spaceui/*.tsx`。

**接入点**（`src/pages/ChatPage/ChatPage.tsx`）：

| 位置 | 改造 |
|---|---|
| 房间号（`<h1>`） | 换成 `BlurRevealText as="span" splitBy="words"`（模糊揭示） |
| 状态行 | 换成「按需球体 + `BlurRevealText`」，`replayKey={statusText}` 使文案变化时重播：`connecting` → `OrbConnecting size={16}`；`disconnected` → `LoadingOrb size={13}` |
| 减少动效 | 用 `framer-motion` 的 `useReducedMotion()` 门控两个球体，偏好开启时**不渲染** canvas/网格，只保留文案（上游未内建，由本项目侧补的降级） |

**实测中发现并修复的缺陷（重要）**：`BlurRevealText` 的 `inView` 默认为 `true`，会等待 IntersectionObserver 触发；而顶栏是首屏固定内容，实测动画**停留在 `opacity: 0`，导致房间号与状态文案完全不可见**。已显式传 `inView={false}`（挂载即播放）修复。复验：`titleOpacity: 1`、状态文案 `opacity: 1; filter: blur(0px)`。

**浏览器复验**（`spaceui-verify/`）：状态行在断开态多出一个 `DIV`（13×13、含 16 个子方块 = `LoadingOrb` 的 4×4 网格），状态恢复为「1 人在线」后消失；`maxRowChildren` 由 1 → 2 → 1，符合预期。

**体积增量**：JS gzip 302.85 → **310.62 kB（本批 +7.77 kB）**，自基线累计 **+14.57 kB（+4.9%）**，低于 15% 阈值。

**未接入（刻意保留）**：`flip-text`（循环翻转，用于房间号会干扰阅读；需产品取舍后再定）与 `morphing-text`（其 API 是按 `interval` 循环播放 `texts[]`，不适合会单调变化的状态文案）。`orb-thinking` 的其余 8 种形态亦未接入。

### 第三批（成员在线与身份）落地明细

**落盘条目**（8 个文件、**0 个新依赖**）：`components-spaceui-avatar-group`、`components-spaceui-status-badge`、`components-spaceui-user-presence-avatar`、`components-spaceui-notification-list`，以及由注册表依赖**自动带入并改道**的三个原语 `src/components/spaceui/ui/{avatar,tooltip,badge}.tsx`。

**改道机制实测生效**（本轮最关键的结构验证）：`user-presence-avatar` 与 `avatar-extended` 中的 `@/components/ui/avatar|tooltip` 导入被脚本改写为 `@/components/spaceui/ui/*`（改写 2 处 + 1 处）。LSP 语义引用检查确认：改道后的 `Avatar` **只被 SpaceUI 内部引用**（6 处 / 2 文件）；`src/components/ui/` 与 `src/components/spaceui/` 之间的跨命名空间引用**双向均为 0 处**。

**接入点**：`src/pages/ChatPage/components/OnlineUsersSection.tsx` 用 `StatusBadge` 替换了名单头部「（N 人潜水中）」纯文本与成员行「潜水中 · 自 xx 起」纯文本（改由 `status="away"` 徽标呈现），并移除因此不再使用的 `Moon` 图标导入。

**新增的脚本硬校验（本轮发现并修复的缺陷）**：`liquid-sortable-list` 会 `import … from '@usespaceui/avatars'`，而该包在依赖阻断清单中。原先脚本只校验 `@/` 相对导入，会放过这种「引用了被阻断 npm 包」的情况，落盘后即成无法解析的引用。现已在写入前做 fail-fast 校验并中止（实测：该条目被正确拦下且**未写入任何文件**）。

**本地修补（非上游原文）**：`src/components/spaceui/avatar-group.tsx` 中 `React.Children.map` 回调参数被推断为 `unknown`，上游直接读 `child.props.style` 会报 TS2339；已改为先断言 props 再取 `style`，语义不变。

**体积增量**：JS gzip 310.62 → **311.51 kB（本批 +0.89 kB）**；自基线累计 **+15.46 kB（+5.2%）**。第三批增量极小，原因是 `notification-list`、`avatar-group`、`user-presence-avatar` 等已落盘但**尚未被业务引用**，被 tree-shaking 排除在产物之外 —— 这也反证了「未接线即不进包」的结论。

**逐项核实后未落地/未接线（附原因）**：

| 条目 | 处理 | 原因 |
|---|---|---|
| `components-spaceui-liquid-sortable-list` | **不落盘** | 依赖被阻断的 `@usespaceui/avatars`（0.1.x）；若引入需先评估该包 |
| `components-spaceui-slide-to-confirm` | **暂不落盘** | 需新增 `torph` 依赖，且当前无对应产品场景 |
| `components-spaceui-notification-list` | 已落盘，**未接线** | 依赖仅为 `motion` + 既有 `lucide-react`（此前的「注册表依赖异常」已排除），但通知列表的落点需产品取舍 |
| `components-spaceui-avatar-group` | 已落盘，**未接线** | 它的 `-space-x-2 *:ring-2 *:ring-background` 会与顶栏头像组现有的手调叠层与描边（`-ml-2` + 各自 ring）冲突，直接替换会造成视觉回归；需要先在预览中调好叠层与描边再换 |
| `components-spaceui-user-presence-avatar` | 已落盘，**未接线** | 其 API 是 `users[]` + `onChange` 的**交互式**选择器，与「被动展示在线名单」的语义不匹配 |
| `components-spaceui-avatar-extended` | 随依赖落盘，未接线 | 同上，属 `user-presence-avatar` 的组成部分 |

### 第二批/第三批未覆盖的验证（需人工确认）

- **潜水状态徽标**（`StatusBadge status="away"`）：只在有成员进入潜水时才渲染。单独一室时为 `sorted.length === 0`，按既有逻辑组件直接返回 `null`，因此浏览器实测无法触发该分支。已通过类型检查与构建验证，但**建议两人一室实测一次**。
- 成员名单弹层与「+N」溢出：同样需要 ≥2 名成员的场景。

---

## 8. 最终验收（全批次）

**静态门禁**：`npm run typecheck` 0 错误；`npm run lint:eslint` 0 错误；`npm run build` 成功；`git diff --stat` 对白名单路径**为空**（全程 4 次复验均为空）。

**体积**：JS gzip 296.05 → **311.52 kB（+15.47 kB，+5.2%）**；CSS gzip 因新增工具类升至 27.54 kB。均在 15% 预算内。

**结构校验（LSP 语义引用 + 文本校验）**：
- 改道原语 `src/components/spaceui/ui/avatar.tsx` 的 `Avatar` 仅被 SpaceUI 内部引用（6 处 / 2 文件）；
- `src/components/ui/` ↔ `src/components/spaceui/` 的跨命名空间导入**双向 0 处**；
- 业务侧接入点共 5 处，全部在 `ChatPage.tsx` 与 `OnlineUsersSection.tsx`。

**真实浏览器验收**（零安装 CDP 探针，截图见 `spaceui-verify/`）：

| 检查项 | 结果 |
|---|---|
| 亮色基线 | `--background: hsl(30 20% 97%)`，与改造前一致 ✓ |
| 主题切换 | 点击后 `<html>` = `theme-ready dark`，`--background: hsl(220 15% 11%)`、body 计算背景 `rgb(24, 27, 32)`；可逆且写入 `open-chat-theme` ✓ |
| 首屏引导脚本 | 预置 `open-chat-theme=dark` 后重载，DOM 就绪即已是 `dark`（`index.html` 内联脚本在模块脚本之前执行）✓ |
| 等待态球体 | 断开态下状态行多出 `DIV/16children/13x13`（= `LoadingOrb` 4×4 网格），恢复后消失 ✓ |
| 文字揭示 | 房间号与状态文案 `opacity: 1`、`filter: blur(0px)`，动画完成可见 ✓ |
| 成员名单弹层 | 触发按钮可点击、弹层打开（`dialogs: 1`）、成员行正常渲染，`StatusBadge` 接入无运行时错误 ✓ |
| 控制台 | **应用级错误 0 条**；仅剩 `next-themes` 的 script 标签警告（每个页面加载 2 条，见已知限制）✓ |

**性能复核（vercel-react-best-practices）后续改进**（已应用）：
1. `bundle-barrel-imports`：`OrbConnecting` 改为直接从 `@/components/orb/thinking/orb-connecting` 引入，不再经 barrel 拉入其余 9 种形态的模块图；
2. `rendering-conditional-render`：状态行的两个球体改用三元表达式条件渲染，避免 `&&` 短路产生非预期渲染值；
3. `rendering-hydration-no-flicker`：在 `index.html` 增加内联主题引导脚本，消除暗色用户的首屏亮色闪烁。

**未采纳的建议及理由**：`bundle-dynamic-imports`（对球体做 `React.lazy`）—— 球体只在进入房间的「连接中」与断线时出现，属高频早现元素；惰性加载会额外引入 Suspense 边界与一次加载闪烁，而实测这两批引入的代码总量仅 +7.77 kB gzip，性价比不成立。

---

## 9. 回滚清单（按批次）

| 批次 | 回滚动作 |
|---|---|
| 全部 | `git checkout -- eslint.config.mjs src/styles/index.css src/components/AppShell.tsx index.html`，并删除 `src/components/spaceui/`、`src/components/orb/`、`src/styles/spaceui/` |
| 首批 | 移除依赖 `motion`、`@base-ui/react`、`@tabler/icons-react`；还原 `ChatPage.tsx` 的主题按钮接入 |
| 第二批 | 还原 `ChatPage.tsx` 的房间号与状态行（球体 + 模糊揭示） |
| 第三批 | 还原 `OnlineUsersSection.tsx` 的状态徽标与 `Moon` 图标导入 |
| 工具 | `scripts/spaceui-add.mjs`、`SPACEUI_INTEGRATION.md` 可直接删除（纯新增文件） |

**注意**：`src/components/spaceui/theme-toggle.tsx` 与 `avatar-group.tsx` 含**本地修补**（类型层面）。若日后用脚本重新落盘这两个条目，修补会被覆盖，需照 §7 变更日志重新应用。

---

## 10. 房间号重复渲染修复（第二阶段；含已回退的视觉刷新记录）

### 10.1 修复：左上角房间号持续闪烁

**成因（实测定位，非推测）**：顶栏房间号此前使用 `BlurRevealText`。父组件因「剩余时间倒计时」每秒重渲染，导致该组件内部的揭示动画**反复重播**。

| 指标 | 修复前 | 修复后 |
|---|---|---|
| 4.2 秒内属性变更（`h1`） | **229 次** | **0 次** |
| 不同 opacity/blur 样式签名 | 12 种 | **1 种**（恒定 `100\|none`） |
| 第二个 3.2 秒窗口 | 仍持续 163 次 | **0 次** |
| 顶栏左侧整块（含状态行） | 826 次 / 5.2 秒 | **`childList: 0 / attributes: 0 / characterData: 0`** |

**修复方式（最终版：按用户要求改为最小改动，不含任何 UI 修饰）**：
1. 房间号元素**完全不使用动效**，直接输出纯文本（`<span className="truncate">{roomId}</span>`），任何状态下稳定显示；
2. 状态文案同样改回纯文本 `<p>`，去掉会反复重播的揭示动效；
3. 顶栏不再使用 SpaceUI 的 `BlurRevealText`（该组件仍保留在 `src/components/spaceui/` 内，只是不再用于顶栏）。

### 10.2 视觉刷新（**已按用户要求整体回退**，本节仅作历史记录）

> **状态：已回退（2026-09-30）。** 用户明确要求「回退代码、不做 UI 改动，只修复房间号重复渲染问题」，
> 因此本节描述的全部改动已被撤销：`src/styles/app/visual-refresh.css` 已删除、`src/styles/index.css`
> 的对应 `@import` 已移除，顶栏 / 消息气泡 / 输入区 / 加入房间页的类名改动全部还原。
> 体积也已回到回退前水平（CSS gzip 28.69 → **27.54 kB**，JS gzip 311.87 → **310.74 kB**）。
> 以下内容仅用于说明「做过什么、为何撤回」，不代表当前代码状态。

**设计方向**：在既有「暖珊瑚单主色」体系上强化层次与质感（语义 token、调色板与 vendor 层一字未改，AUDIT 中 UI-01/02/05 的修正全部保留）。

新增能力：氛围光晕背景（`.app-atmosphere`）、玻璃层次（`.glass-panel`）、品牌渐变（`.brand-gradient` / `.brand-gradient-text`）、一次性揭示（`.text-reveal` / `.rise-in` / `.pop-in`）、统一交互（`.press` / `.lift`）、状态点呼吸（`.status-dot-live`）、网格纹理（`.grid-texture`）；全部在 `prefers-reduced-motion` 下自动降级。

| 界面 | 改动 |
|---|---|
| 加入房间页 | Hero 区重构（渐变超椭圆品牌标识 + 光晕、主标题加大并用品牌渐变着色关键词、亮点改为玻璃胶囊并逐个入场）；表单卡玻璃化 + 超椭圆 + 整体入场；三个输入框统一超椭圆；主按钮改品牌渐变 + 按压回弹 |
| 聊天页顶栏 | 玻璃面板；房间号品牌渐变、字号加大、字距收紧；状态点 |
| 消息区 | 气泡统一**超椭圆圆角**（原生 `corner-shape`）；自己的消息品牌渐变 + 投影，对方玻璃卡 + 边框；图片/文件气泡悬停浮起；发送者与时间戳层级精修 |
| 输入区 | 玻璃容器 + 超椭圆；输入框超椭圆并强化聚焦反馈；发送按钮改用 SpaceUI 的 `ButtonSquircle` |

**强度修正（实测驱动）**：氛围渐变初版在亮色下 alpha 取 0.17/0.09/0.11，渲染后整页被冲成粉色、发闷，与目标相反；已压到约 1/3（0.07/0.035/0.05）并在代码注释中记录原因。

**体积**：CSS gzip 27.54 → **28.69 kB**；JS gzip 311.52 → **311.87 kB**（未引入任何新依赖）。

### 10.3 事故记录：本阶段改动曾整体丢失，已重建并改为双向验证

**现象**：用户反馈「房间号仍持续重复渲染」。排查确认不是动画参数问题，而是**本阶段全部改动在实际源码中不存在**：`src/styles/app/visual-refresh.css` 文件缺失；`ChatPage.tsx` 的 `app-atmosphere` / `glass-panel` / `brand-gradient-text` / `text-reveal` / `status-dot` 均为 0 处，`BlurRevealText` 仍停留在修复前的 319、344 行；消息区与加入房间页的刷新类名同样为 0 处。

**教训（已落实到流程）**：上一轮的「验证」只观测了浏览器中的 `header h1`，**没有校验源码**，因此把「改动根本不存在」误判为「已修复」。现改为**先逐项断言源码 → 再跑门禁 → 最后做运行时观测**。

**重建后的双向复验**：源码核对 15 项断言全部符合预期（`BlurRevealText` 仅剩注释 1 处，`import` 与 JSX 均为 0）；顶栏整块 DOM 变更全为 0；运行时观测到的元素类名 `brand-gradient-text` / `status-dot` / `text-reveal` 与新代码一一对应；`typecheck` / `lint` / `build` 全绿且白名单 diff 为空。

> **注意（现行状态）**：视觉刷新已整体回退，顶栏只保留 §10.1 的最小修复。核对方式：`ChatPage.tsx` 中不应出现 `BlurRevealText`（`import` 与 JSX 均为 0 处），且 `src/styles/app/` 目录不应存在。
> 若日后再次出现「房间号闪烁」，首先确认 §10.1 的修复是否仍在——该现象的根因是**给房间号套用了会在父组件重渲染时反复重播的动效**（父组件因剩余时间倒计时每秒重渲染）。

---

## 11. Switch 开关 + 表情包 + 音效（第三阶段）

### 11.1 需求与范围

用户要求三件事：① 开关类控件统一用 `Switch` 实现；② 引入聊天表情包（`@usespaceui/emoji`）；③ 引入界面音效（`@usespaceui/sounds`，参照其 matrix 文档）。经确认的边界：

| 项 | 结论 |
|---|---|
| 开关落点 | **焚毁开关改为 Switch**（开关=启用/关闭），**并**为新增设置项提供 Switch（音效、表情图片渲染） |
| 表情深度 | 面板（分类 + 搜索 + 最近使用）+ **消息列表用图片渲染**（含接收方与历史消息） |
| 音效范围 | **全面接入**：关键反馈音 + 交互音 + 悬停 tick + 方向性 slide/turn + 消息接收按气泡左右做空间声像 |
| CDN 策略 | 接受外部 CDN，**失败自动回退**为系统原生字形 |

约束：只做功能性新增，**沿用现有设计语言**，不重新引入 §10.2 已回退的视觉层（已用标记扫描复验：`app-atmosphere` / `glass-panel` / `brand-gradient` / `text-reveal` / `status-dot` / `rise-in` 均为 0 处）。

### 11.2 新增依赖（精确版本）

```jsonc
"@usespaceui/emoji": "0.1.0",   // MIT, peer react>=18
"@usespaceui/sounds": "0.1.3"   // MIT, 零运行时依赖, 72.6 KB, 无音频文件（Web Audio 程序化合成，零网络请求）
```
`@usespaceui/emoji` 会连带安装 `cn@^0.2.5`（**与项目内 `cn` 工具函数同名但无关的第三方包，本项目不 import**）、`emoji-regex`、`lottie-web`、`url-join`。

### 11.3 关键决策一：音效 ID **以包内类型声明为准**（matrix 文档页的名称在代码中不存在）

上游 `sounds.spaceui.one/docs/api/matrix` 是**展示用名称**，与实际导出不符，实测裁定如下：

| 文档页展示名 | 代码中的真实名称 |
|---|---|
| `openOverlay` / `closeOverlay` | `open` / `close` |
| `loadingStatus` / `readyStatus` | `loading` / `ready` |
| `chimeTone` / `sparkleTone` / `dropletTone` / `bloomTone` / `whisperTone` | `chime` / `sparkle` / `droplet` / `bloom` / `whisper` |
| `toggleDirectional(on\|off)` | `toggle('on'\|'off')`，字符串式调用写作 `toggle-on` |

完整字面量取自包内 `SpaceSoundName`：`tap` `press` `release` `tick` `page` `copy` `paste` `remove` `confirm` `deny` `open` `close` `loading` `ready` `chime` `sparkle` `droplet` `bloom` `whisper` `nudge-up` `nudge-down` `toggle-on` `toggle-off` `slide-in` `slide-out` `turn-forward` `turn-back`（共 27 个）。本项目用 `satisfies Record<string, SoundTrigger>` 约束映射表，**写错名字在编译期即失败**。

同时确认的 API：`bind(root?)`（SSR 安全、可重复调用）、`setEnabled(boolean)`、`setVolume(number)`、`setRespectReducedMotion(boolean)`、`getSettings()`、`subscribe(listener) => 取消订阅`、`PlayOptions { volume, spatial{x,y,z}, profile }`。

### 11.4 关键决策二：表情图片 URL **自持实现**（不 import 上游 JS）

**实测原因**：`@usespaceui/emoji` 的 ESM 入口只有 2.7 KB，但真正的实现被打包进 `dist/chunk-WW3I7SW4.mjs`（**2.54 MB**）；这是上游构建时已合并好的 chunk，**tree-shaking 无法再切分**。消息渲染位于聊天页首屏，一旦静态 import 其任何导出（包括 `/react`），首屏就会多出 1.4–2.5 MB。

**做法**：`src/lib/emoji/url.ts` 只保留 URL 规则（规则取自上游 README 的公开示例）：
`https://cdn.spaceui.one/common/emoji/{source}/{type}/{连字十六进制}.{format}`，例如 `fluent/3d/1f525.webp`、`fluent/3d/0023-fe0f-20e3.webp`。

两个经实测校准的细节：
1. **码点要补零到 4 位**：目录中的文件名是 `0023-fe0f-20e3`，`toString(16)` 会得到 `23`。已用 `providers['fluent/3d']` 的 3391 条真实文件名核对；
2. **多码点用 `-` 连接、保留 `fe0f`**，与 `listSupportedEmojis` 的返回示例一致。

回退链：主 CDN → 镜像 `cdn.aurthle.com` → 系统原生字形（`EmojiImage` 的 `onError` 串联）。实测：`1f525` / `1f600` / `0023-fe0f-20e3` / `1f469-200d-1f4bb`（ZWJ 组合）均 HTTP 200，伪造名 `zzz-not-a-real-emoji.webp` 为 404（说明 CDN 不会对任意文件名都返回成功，验证有效）。

### 11.5 关键决策三：表情数据与面板**不进首屏**（已用产物内容反证）

拆包结果（`npm run build`）：

| 产物 | 体积 | 说明 |
|---|---|---|
| `index-*.js`（首屏） | 1015 KB / **gzip 325.4 kB** | 含自持 URL 规则（`cdn.spaceui.one` 出现 1 次），**不含任何数据** |
| `EmojiPickerPanel-*.js`（懒） | 6 KB / gzip 2.6 kB | 首次打开面板或悬停按钮时才加载 |
| `data-*.js`（懒） | 903 KB / gzip 181.6 kB | `@usespaceui/emoji/data` 数据集，**仅在打开面板时加载** |

用 Node 精确检索产物内容（PowerShell 检索大单行文件会假阴性，不可用）：

| 标记 | 首屏 `index-*.js` | 数据 `data-*.js` |
|---|---|---|
| `fluent/3d` | **0** | 4 |
| `grinning-face` | **0** | 4 |

### 11.6 关键决策四：偏好**单一来源**（本项目存储权威）

实测包内源码未发现任何 `localStorage` 痕迹，上游文档也未定义 `hydrate()` 是否落盘 ⇒ 不假定它自带持久化。做法：偏好的唯一来源是 `src/lib/storage.ts`，每次变更显式下发 `setEnabled/setVolume` 覆盖引擎状态，避免「刷新后两边互相覆盖」。

存储键：`__global_ui_preferences`（延续项目 `__global_*` 约定，单键 + `v: 1` 版本号，原子读写）：
```jsonc
{ "v": 1, "soundEnabled": true, "soundVolume": 0.7, "emojiImageEnabled": true, "emojiAnimated": true, "recentEmoji": [] }
```

### 11.7 落点与文件

| 位置 | 内容 |
|---|---|
| `src/components/ui/switch.tsx` | **既有 Radix Switch，本阶段首次被使用**（未改动该文件） |
| `src/lib/sound/{engine,map,SoundProvider}` | 引擎封装（bind/解锁/安全调用）、动作→音效映射与节流、生命周期容器 |
| `src/hooks/useUiPreferences.ts` | 偏好 store + `useSyncExternalStore` 订阅；另提供 `useEmojiImageEnabled` / `useRecentEmoji` 两个**派生订阅**，避免拖音量时消息列表跟着重渲染 |
| `src/lib/emoji/{url,data,segments}` | URL 规则、目录索引（分类/搜索）、字素切分 |
| `src/components/settings/SettingsMenu.tsx` | 顶栏设置菜单（Popover）：音效 Switch + 音量滑块 + 表情图片渲染 Switch |
| `src/components/emoji/{EmojiTrigger,EmojiPickerPanel,EmojiImage,EmojiText}` | 表情按钮（懒加载面板 + 悬停预热）、面板、图片（三级回退）、消息渲染 |
| `src/pages/ChatPage/components/ChatInputSection.tsx` | 焚毁 Switch（替换原按钮触发态）+ 模式下拉降为次级入口 + 表情按钮 |
| `src/hooks/useMqttChat.ts` | 收发消息、发送结果、连接状态处挂接音效 |

**焚毁开关的语义**：Switch 直接映射既有 `privacy.burnMode`（开 ↔ 非 `off`，关 ↔ `off`），**不新增平行状态**；`useRef` 记忆最后一次启用的模式，重新打开时恢复（避免用户选择被静默改写成定时焚毁）；菜单中「关闭」项被移除（同一状态只留一个入口）；`burnModeDowngraded` 与 `BURN_UNAVAILABLE_HINT` 的降级提示原样保留。

### 11.8 音效映射与克噪措施

| 动作 | 音效 |
|---|---|
| 点击 / 开关开 / 开关关 | `tap` / `toggle-on` / `toggle-off` |
| 浮层开合 / 表情面板滑入滑出 | `open` `close` / `slide-in` `slide-out` |
| 悬停（成员头像、消息气泡） | `tick` |
| 发送成功 / 收到消息 / 出错 / 附件处理中 | `confirm` / `chime` / `deny` / `loading` |
| 连接就绪 / 正在连接 / 离开房间 | `ready` / `loading` / `turn-back` |

克噪与稳健性：收消息音效 900 ms 节流（刷屏不连响）、悬停音效 500 ms 节流、页面隐藏时不发声、系统「减少动效」时静音（继承上游默认并显式固定）、首个用户手势用 **0 音量播放**解锁音频上下文、所有调用包在 `safeCall` 中（同一调用名只告警一次，绝不冒泡到聊天主流程）。

**两个刻意的实现约束**：① 收到消息的音效**不能**放进 `setMessages` 的更新函数里（严格模式下会执行两次而响两下）；② 附件成功暂无独立成功音（只有开始时的 `loading` 与失败时的 `deny`）。

### 11.9 实测与验证

已完成（可复现）：
- `npm run typecheck` / `npm run lint:eslint` / `npm run build` 全部 0 错误；
- **字素切分用真实源码验证**（`node` 直接跑 `src/lib/emoji/segments.ts`）：ZWJ 家庭 `👨‍👩‍👧`、国旗 `🇨🇳`、按键 `1️⃣`、肤色修饰 `🙋🏽‍♂️` 均被正确识别为**单个**表情；30 个表情只图片化前 24 个（上限生效）；
- 表情 CDN 规则与回退（见 11.4）；
- 拆包与首屏内容反证（见 11.5）；
- 体积：首屏 JS gzip **310.74 → 325.43 kB**（+14.7 kB，含音效引擎与开关/浮层/滑块组件），CSS gzip 27.54 → 27.61 kB。

**未完成（如实记录）**：浏览器端到端脚本（进入房间 → 开关交互 → 打开表情面板并插入 → 刷新后偏好保持 → 控制台无报错 → 顶栏 DOM 稳定性复验）**已编写但用户选择跳过执行**，因此以下项未获实测确认，交付后建议手动确认：

1. 焚毁 Switch 的开/关与模式记忆是否符合预期；
2. 设置菜单三个设置项是否即时生效且刷新后保持；
3. 表情面板能否打开、搜索、插入到光标处，以及图片是否正常显示；
4. 控制台是否有报错（尤其音效在真实浏览器中的解锁行为）；
5. 顶栏左侧（房间号 + 状态行）DOM 变更是否仍为 0（§10.1 的回归守卫）。

### 11.10 回滚

1. 移除 `@usespaceui/emoji` 与 `@usespaceui/sounds` 两个依赖；
2. 删除 `src/lib/sound/`、`src/lib/emoji/`、`src/components/emoji/`、`src/components/settings/`、`src/hooks/useUiPreferences.ts`；
3. 还原接入点：`AppShell.tsx`（移除 `SoundProvider`）、`ChatPage.tsx`（移除 `SettingsMenu` 与两处音效）、`ChatInputSection.tsx`（焚毁入口还原为按钮 + 下拉、移除表情按钮）、`MessageListSection.tsx`（`<EmojiText>` 还原为 `{msg.content}`）、`OnlineUsersSection.tsx`、`useMqttChat.ts`（移除音效调用与 import）。

### 11.11 遗留（已知且刻意）

- `chat:copy` / `chat:remove` 两个动作在映射表中**已定义但无调用点**：项目当前没有任何复制到剪贴板或删除消息的交互入口（全仓 `navigator.clipboard` 命中 0 处），等有对应交互时再接；
- `ui:click` 目前只用于焚毁模式/倒计时选择与表情插入，未铺满全站按钮（避免无差别点击声）；
- 悬停音效只挂在成员头像与消息气泡两类明确目标上；
- 消息渲染的图片回退为「原生字形」，不保证与 Fluent 3D 视觉一致 —— 这是断网/图床不可达时的**可用性兜底**，非等价替代；
- `EmojiPickerPanel` 不支持方向键在网格内移动（Tab + Enter 可完成全流程选择）。

### 11.12 修正：表情改为**动画**渲染（首版只做了静态）

**问题**：首版把变体固定为 `type: '3d'`（静态 3D 图），丢掉了上游的动画能力 —— 官网 playground 用的正是 `source="fluent" type="anim" format="webp"`。

**URL 规则改用包内解析器实测取得**（不再靠猜）：在 Node 中直接调用 `resolveEmojiUrl` / `getEmojiUrls` / `toUnicode`：

| 调用 | 结果 |
|---|---|
| `resolveEmojiUrl('🔥', { source:'fluent', type:'3d' })` | `…/common/emoji/fluent/3d/1f525.webp` |
| `resolveEmojiUrl('🔥', { source:'fluent', type:'anim', format:'webp' })` | `…/common/emoji/fluent/**anim**/1f525.webp` |
| `toUnicode('1️⃣')` | `0031-fe0f-20e3`（**印证了码点补零到 4 位的实现**） |
| `getEmojiUrls(...)` | 镜像为 `cdn.aurthle.one` / `cdn.aurthle.com` |

关键点：**动画没有额外的 `webp/` 层级**（`fluent/anim/webp` 只是数据目录键，不是 URL 路径）。路径恒为 `{CDN}/common/emoji/{source}/{type}/{码点串}.{format}`，`{type}` 取 `anim`（动画）或 `3d`（静态）。

**覆盖面**：`fluent/3d` 与 `fluent/anim/webp` 各有 3391 条，逐条比对后**动画无缺失**（差值 0），所以默认动画不会让任何表情「消失」。

**体积代价（实测同一表情的 CDN 字节数）**：

| 表情 | 静态 3d | 动画 anim | 倍数 |
|---|---|---|---|
| 🔥 `1f525` | 4 148 B | **185 282 B** | 45× |
| 😀 `1f600` | 5 792 B | **288 440 B** | 50× |
| 😪 `1f92a` | 7 206 B | **421 524 B** | 58× |
| 👨‍👩‍👧 ZWJ | 10 006 B | **556 716 B** | 56× |
| 1️⃣ 按键 / 🇨🇳 旗帜 | 2 244 / 5 742 B | 与静态同文件 | 无动画版本 |

代价可控的两个理由：浏览器缓存同一表情；`loading="lazy"` 只为进入视口的消息发请求。为把选择权交给用户，新增偏好 **`emojiAnimated`（默认开）**，设置菜单里是「表情动画」开关（图片渲染关闭时该项禁用）。关闭后立即退回静态图。

**镜像域名实测不可用**，已从回退链移除：`cdn.aurthle.com` 对同一路径返回 **404**，`cdn.aurthle.one` 无正常响应 —— 保留必然失败的环节只会白加一次请求与等待。因此回退链为三级：

`animated（主 CDN）` → `static 3d（主 CDN，3391 个表情全部存在）` → `系统原生字形`

**落点差异（刻意）**：消息气泡内用动画（用户在设置里可关）；面板「最近使用」行用动画（上限 24，数量可控）；面板**网格保持静态** —— 一屏可达上百个 22px 动图同时解码，会明显吃 CPU 与电量，而挑选阶段并不需要动效。

**验证**：`1f525` / `1f600` / `1f92a` / `0031-fe0f-20e3` / `1f468-200d-1f469-200d-1f467` / `1f1e8-1f1f3` 的动画 URL 全部 HTTP 200（字节数见上表）；`typecheck` / `lint` / `build` 全绿；首屏 JS gzip 325.43 → **325.66 kB**（动画支持仅增加一个 URL 变体与一个开关）。

### 11.13 表情尺寸按数量分档

**规则**（尺寸单位为 `em`，相对气泡内字号，随字号与页面缩放一起变）：

| 消息形态 | 尺寸 | 说明 |
|---|---|---|
| 整条消息 **1 个表情** | `3.2em`（大） | 接近「贴纸」观感 |
| 整条消息 **2~6 个表情** | `1.9em`（中） | 成组仍有存在感 |
| 整条消息 **7 个以上** | `1.35em`（普通） | 仍**比正文略大**，但不跳动排版 |
| **文字与表情混排** | `1.35em`（普通） | 同上 |

**一个必须说明的判定前提**：分档只在**整条消息仅由表情构成**时生效（允许夹杂空格与换行）。原因是把句子中间的表情放大到几十像素会撑坏整段文本的排版 —— 这与主流聊天应用的做法一致。因此 `今天很开心 😀` 里的表情保持普通尺寸，而单独的 `😀` 才会放大。若希望混排也放大，只需改 `getEmojiSizeEm` 中的一行判定。

**排版配套**（否则放大后会出问题）：
- 尺寸超过 `1.5em` 时，基线偏移由 `-0.2em` 改为 `vertical-align: middle` —— 否则行盒下方会留出大片空隙；
- 放大档位（大/中）用 `leading-none` 包裹，抵消气泡的 `leading-relaxed`，避免单个大表情上下多余留白。

**实现位置**：`lib/emoji/segments.ts` 的 `summarizeEmojiSegments`（判定纯表情与计数）与 `getEmojiSizeEm` / `EMOJI_SIZE_EM`（档位）；`EmojiText` 计算并传入；`EmojiImage` 新增 `sizeEm` 入参。

**实测（用真实源码逐例跑）**：

| 输入 | 表情数 | 纯表情 | 尺寸 |
|---|---|---|---|
| `😀` | 1 | true | **3.2em（大）** |
| `😀\n` | 1 | true | **3.2em（大）** |
| `😀😀` | 2 | true | **1.9em（中）** |
| `😀`×6 | 6 | true | **1.9em（中）** |
| `😀`×7 | 7 | true | **1.35em（普通）** |
| `😀`×20 | 20 | true | **1.35em（普通）** |
| `👨‍👩‍👧🇨🇳` | 2 | true | **1.9em（中）** |
| `今天很开心 😀` | 1 | false | 1.35em（普通） |
| `😀!` | 1 | false | 1.35em（普通） |
| `今晚八点上线` / 空串 | 0 | false | 1.35em（普通） |

`typecheck` / `lint` / `build` 全绿；首屏 JS gzip 325.66 → **325.84 kB**。

### 11.14 剪贴板粘贴：图片 / 文件 / Markdown / 纯文本

**识别优先级**（`lib/clipboard/paste.ts`，纯函数、可离线验证）：

| 剪贴板内容 | 处理 |
|---|---|
| 图片（截图、复制图片、网页复制图） | 交给既有图片上传链路（体积预检、压缩、错误提示全部一致） |
| 其它文件 | 交给既有文件上传链路 |
| 有 `text/html` 且**转换后确实带出结构** | 采用 HTML → Markdown 的结果 |
| 纯文本 / 本身已是 Markdown 源码 | 原样插入（不做任何改写） |

**HTML → Markdown 覆盖范围**（`lib/clipboard/htmlToMarkdown.ts`）：标题、粗体/斜体/删除线、行内代码、代码块（保留 `language-*` 语言标记）、链接、图片、有序/无序列表、引用、分割线、表格（拍平为 `\|` 分隔的文本行）、段落；`script`/`style` 一律剔除。不覆盖复杂嵌套布局与 CSS 生成内容（退化为普通文本，不报错）。

**四个关键决策**：

1. **只在转换确实带出结构时才替换** —— 从网页复制普通文字时剪贴板里同样有 `text/html`（通常只是把文字包在 `<div>` 里），无脑替换会引入多余空行。实测：`<div>普通文字一段</div>` → 判定为 `text`、**原文未被改动**；
2. **复用既有上传链路** —— 把图片/文件的校验与发送收口成 `sendImage` / `sendFile`，选择文件与粘贴走同一条路径，避免出现「粘贴的图片没被压缩」这类分叉；
3. **一次只发送第一个文件**，其余数量以提示告知（粘贴多张截图时刷出多条消息通常是误粘；但不做「悄悄少发」）；
4. **单行输入框把换行折叠为空格** —— 与浏览器对 `<input>` 的原生行为一致，避免「React 状态里有换行、DOM 里没有」的不一致。**代价必须知情**：Markdown 的**块级结构（列表、段落）会被拍平为一行**，仅行内标记（粗体、链接、行内代码）完整保留。若要保留块结构，需要把输入框换成可自增高 `<textarea>` —— 那是独立的界面改动，本轮未做。

**失焦粘贴**：焦点不在输入框时粘贴图片也能直接发送（刚截完图直接粘贴的常见动作）。三个守卫缺一不可：焦点在输入框内时交给它自己的 `onPaste`（否则重复发送）；焦点在**任何**可编辑元素内一律不接管（不抢用户在别处的粘贴）；只接管图片（看不到光标位置时插入文本会让人意外）。监听器只注册一次，通过 ref 取最新闭包。

**音效**：新增 `chat:paste → paste` 映射（此前映射表里只有 `copy`），粘贴文本、Markdown、图片都会响一次。

**离线验证**（`jsdom` 提供 DOM，`npm install --no-save` 安装、**未写入 `package.json` / `package-lock.json`**，用真实源码逐例跑）：

| HTML 输入 | 转换结果 |
|---|---|
| `<p>Hello <strong>world</strong></p>` | `Hello **world**` |
| `<b>粗</b> 与 <i>斜</i> 与 <del>旧</del>` | `**粗** 与 *斜* 与 ~~旧~~` |
| `<p>见 <a href="…">文档</a></p>` | `见 [文档](https://example.com/x)` |
| `<ul><li>一</li><li>二</li></ul>` | `- 一`↵`- 二` |
| `<ol><li>first</li><li>second</li></ol>` | `1. first`↵`2. second` |
| `<pre><code class="language-ts">…</code></pre>` | ` ```ts ` 围栏代码块 |
| `<h2>标题</h2><p>正文</p>` | `## 标题`↵↵`正文` |
| `<blockquote>被引用的话</blockquote>` | `> 被引用的话` |
| `<img src="…" alt="图">` | `![图](…)` |
| `<table>…<td>a</td><td>b</td>…` | `a \| b`↵`c \| d` |
| `<div>正文<script>alert(1)</script></div>` | `正文`（脚本已剔除） |
| `<div>普通文字一段</div>` | `普通文字一段`（判定无结构 → 不改动原文） |

端到端判定：网页富文本（标题+正文 / 链接 / 列表）→ `kind=markdown, converted=true` 并提示「已按 Markdown 解析粘贴内容」；纯 `div` → `kind=text`；本身是 Markdown 源码 → `kind=markdown, converted=false`（原样保留）。

**验证的局限（如实记录）**：`readPastePayloadFromDataTransfer` 依赖真实的 `DataTransfer`，以及「浏览器到底往剪贴板里放了哪些格式」属于运行时行为，**未在真实浏览器中验证**（端到端脚本此前被跳过）。上面验证的是识别与解析的**核心逻辑**；真机行为需手动确认。

**体积**：首屏 JS gzip 325.84 → **327.82 kB**（+1.98 kB）。**回滚**：删除 `src/lib/clipboard/`、还原 `ChatInputSection.tsx` 的粘贴处理（`onPaste`、窗口监听、`insertAtCursor`、`sendImage`/`sendFile` 收口）与 `map.ts` 的 `chat:paste` 映射。

---

## 12. 交付前审计与发布记录

### 12.1 审计范围与方法

覆盖第 11 章全部新增/改动文件（`lib/sound`、`lib/emoji`、`lib/clipboard`、`components/emoji`、`components/settings`、`hooks/useUiPreferences`、`hooks/useChatPaste`、`ChatInputSection`、`MessageListSection`、`OnlineUsersSection`、`ChatPage`、`AppShell`）。方法：逐文件通读 + 危险模式扫描 + 门禁（typecheck / eslint / build）+ 用真实源码做离线单测（字素切分、尺寸分档、HTML→Markdown、粘贴识别）。

**危险模式扫描结果（全部为 0）**：`dangerouslySetInnerHTML`、`innerHTML`、`eval(`、`new Function`、`document.write`、`http://`（明文）、`target="_blank"`、`any`、`@ts-ignore`、`@ts-expect-error`、`eslint-disable`。

### 12.2 发现与处置

| # | 级别 | 问题 | 处置 |
|---|---|---|---|
| 1 | 中（正确性） | `EmojiImage` 用 `useState` 初始化加载阶段，`animated` 偏好切换后**已挂载的表情不会更新变体** —— 关掉「表情动画」后历史消息里的动图仍在动，与设置项显示不符 | **已修复**：新增 `useEffect` 同步 `animated`，切换时回到该变体起始阶段重新走回退链 |
| 2 | 低（规范/可维护性） | 粘贴策略在 `ChatInputSection` 内实现，且「输入框内粘贴」与「页面任意处粘贴」两条入口**重复了同一套判定** | **已修复**：抽为 `hooks/useChatPaste.ts`，两条入口共用一份逻辑；组件回归展示职责（该文件因此减少 63 行） |
| 3 | 低（可访问性） | 表情面板的代码预热只挂在 `onPointerEnter`，**键盘用户**首次打开面板会先看到骨架态 | **已修复**：抽出 `preloadPanel`，指针悬停与键盘聚焦共用 |
| 4 | 低-中（规范） | `ChatInputSection.tsx` 418 行，超出「单文件 < 300 行」的建议。**改动前已约 330 行，属既有欠债**，本轮新增约 88 行 | **未处理，建议后续**：把焚毁控件（Switch + 标签 + 模式下拉，含模式记忆）抽为 `BurnModeControl.tsx`，可再减约 110 行 |
| 5 | 中（性能，知情接受） | 动画表情体积是静态的 45～58 倍 | 已提供「表情动画」开关；`loading="lazy"` 只为进入视口的消息请求；浏览器缓存同一表情 |
| 6 | 低（健壮性，知情接受） | 上游声明的两个镜像域名实测不可用 | 已从回退链剔除（保留必然失败的环节只会白等一次请求），回退链为动画 → 静态 → 原生字形 |
| 7 | 低（遗留） | `chat:copy`、`ui:page` 等映射无调用点（项目没有复制消息或分页交互） | 保留映射并在 §11.11 记录，等有对应交互时再接 |
| 8 | 低（不一致，知情接受） | 悬停音效只挂在文本气泡与成员头像上，图片/文件气泡没有 | 刻意收敛噪声范围，未铺满全站 |

### 12.3 安全结论

- **XSS 面干净**：无 `dangerouslySetInnerHTML` / `innerHTML` / `eval`；粘贴得到的 Markdown 始终以**纯文本**写入受控输入框并随消息发送，收发两端都按文本渲染，不经过任何 HTML 解析；
- **HTML 解析安全**：转换用 `DOMParser`（不执行脚本）并显式剔除 `script`/`style`/`noscript` 等标签；`href` 为 `javascript:` 时丢弃该链接；
- **本地存储**：偏好存档逐字段校验类型，非法值只回落该字段；解析失败不抛异常；
- **外部请求**：音效库零网络请求（Web Audio 程序化合成）；外部请求仅「表情图片 CDN」，且可被「表情图片渲染」开关完全关闭；
- **网络出口**：URL 由码点十六进制拼装，用户输入无法影响域名（无开放重定向/SSRF 面）。

### 12.4 未完成的验证（如实记录）

浏览器端到端脚本（进入房间、开关交互、面板插入、刷新持久化、控制台无报错、顶栏 DOM 稳定性）**已编写但被用户跳过执行**；`DataTransfer` 的真机行为与音频解锁的实际听觉效果同样未在真实浏览器中验证。因此第 11 章列出的 5 项手动确认清单仍然有效。

### 12.5 发布记录（2026-09-30）

| 项 | 结果 |
|---|---|
| 提交 | `31630d2` — `feat(chat): 接入 SpaceUI 组件能力（主题/表情/音效/粘贴）并统一开关控件`（64 文件，+8020/-51） |
| 推送 | ⚠️ 本机 **22 端口被网络阻断**，改用 GitHub 的 443 端点完成：`git push ssh://git@ssh.github.com:443/XXXoooM/Open-Chat.git main`（成功，`f5d932c..31630d2`） |
| CI 触发 | Cloudflare Pages **自动触发**（GitHub 上出现 `Cloudflare Pages` check-run，无需额外配置） |
| 构建结论 | `status=completed`、`conclusion=success` |
| 部署 | 项目 `open-chat`，Environment Production，Branch main，Source `31630d2`，部署 `6f5a1fe2-10ac-450e-80c6-a5164c9d8352` |
| 线上产物验证 | `https://chat.yuia.fun` 主 JS 内命中本轮标记：`cdn.spaceui.one` ×1、`EmojiPickerPanel` ×2、`__global_ui_preferences` ×1、「已按 Markdown 解析粘贴内容」×1、「表情动画」×1 —— 证明新功能已实际上线，而非仅构建成功 |

**一处需要知情的差异**：本地构建的主 JS 指纹（`index-DQ9RDjlx.js`）与 CI 构建（`index-lRGtKpNV.js`）不同，而 CSS 指纹完全相同（`index-BX2_UpQq.css`）。原因是本地 `node_modules` 经过多次 `--no-save` 安装与 `prune` 后与 lockfile 存在漂移；`npm ci` 在 CI 上严格按 lockfile 安装。**结论：以线上产物中的功能标记为准（已命中），本地体积数字仅作趋势参考。**
