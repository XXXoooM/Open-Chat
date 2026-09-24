# Open Chat

端到端加密的私密聊天室。仓库：https://github.com/XXXoooM/Open-Chat

## 技术栈

- 前端: React 19 + TypeScript + Vite
- 样式: Tailwind CSS v4
- UI 组件: shadcn/ui `import { Button } from "@/components/ui/button";`
- 图标: lucide-react `import { SearchIcon } from "lucide-react";`
- 动画: framer-motion `import { motion } from "framer-motion";`
- 路由: react-router-dom `import { Link, useNavigate } from "react-router-dom";`
- 实时传输: `mqtt`（回落通路）+ Cloudflare Durable Objects 中继（权威通路），经 `src/lib/transport/` 统一抽象
- 服务端运行时: Cloudflare Workers + Durable Objects（`relay/`，与前端分开部署）

---

## 目录结构

```
src/
├── index.tsx            # 入口（勿修改）
├── app.tsx              # 路由配置（仅在 <Routes> 内增删 <Route>）
├── index.css            # 全局样式 + 主题变量
├── components/          # 基础 UI 组件（禁止存放业务组件）
│   ├── layout.tsx       # 全局布局容器（含 <Outlet />）
│   └── ui/              # shadcn/ui 内置组件（勿修改）
├── pages/               # 页面模块（每个页面一个目录）
│   ├── <PageName>/      # 页面目录示例
│   │   ├── PageName.tsx        # 页面入口文件与目录同名
│   │   └── components/         # 页面专属组件
│   └── NotFoundPage/
│       └── NotFoundPage.tsx
├── hooks/               # 自定义 Hooks
└── lib/                 # 工具函数（cn() 等）

shared/
└── static/              # 静态资源
    ├── data/            # 数据文件（JSON）
    └── images/          # 图片资源
```

---

## 模板初始状态

- `app.tsx` 首页路由指向平台内置的 `<Welcome />` 组件
- 开发时需将 `index` 路由替换为业务首页，并在 `pages/` 下创建对应页面目录
- `layout.tsx` 为空壳容器（仅 `<Outlet />`），需根据需求实现导航和布局

---

## 禁止修改的文件

| 文件 | 原因 |
|------|------|
| `src/index.tsx` | Provider 层级 + 样式引入，由模板管理 |
| `src/components/ui/*` | shadcn/ui 内置组件，版本锁定 |

---

## 文件放置规则

| 内容类型 | 放置位置 |
|---------|---------|
| 新页面 | `src/pages/<PageName>/PageName.tsx` |
| 页面专属组件 | `src/pages/<PageName>/components/` |
| 自定义 Hooks | `src/hooks/` |
| 工具函数 | `src/lib/` |
| 静态数据文件 | `shared/static/data/` |
| 静态图片 | `shared/static/images/` |

---

## 导入路径

```typescript
// @/ 别名 → src/
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";

// @shared/ 别名 → shared/
import heroImage from "@shared/static/images/hero.png";
import configData from "@shared/static/config.json";
```

---

## 路由配置

- 新增页面需在 `src/app.tsx` 的 `<Routes>` 内注册 `<Route>`
- `BrowserRouter` 已在 `index.tsx` 中配置，`app.tsx` 中**禁止**再包裹 Router

---

## 主题变量

主题色定义在 `src/index.css`，通过 `:root` CSS 变量 + `@theme inline` 注册到 Tailwind。

| 用途 | Tailwind 类 | CSS 变量 |
|------|------------|----------|
| 页面背景 | `bg-background` | `--background` |
| 主文本 | `text-foreground` | `--foreground` |
| 卡片背景 | `bg-card` | `--card` |
| 次要文本 | `text-muted-foreground` | `--muted-foreground` |
| 主色 | `bg-primary` / `text-primary` | `--primary` |
| 强调色 | `bg-accent` | `--accent` |
| 边框 | `border-border` | `--border` |
| 危险色 | `text-destructive` | `--destructive` |
| 图表色 | `bg-chart-1` ~ `bg-chart-5` | `--chart-1` ~ `--chart-5` |

HSL 格式使用**空格分隔**：`--primary: hsl(150 60% 40%);`

---

## 本项目实际形态：加密私密聊天室

房间号 + 房间密码 + 昵称进入，消息在浏览器内用 PBKDF2 派生密钥 + AES-GCM 端到端加密。
支持文字 / 图片 / 文件、在线成员、聊天室动态（进入 / 离开 / 潜水）、房间 3 小时寿命与加时。

### 双通路与回滚

| 通路 | 触发条件 | 能力 |
|------|---------|------|
| 中继（Cloudflare Workers + Durable Objects） | 配置了 `VITE_RELAY_URL` | 服务端权威的焚毁、已读回执、离职即时判定 |
| MQTT（外部 Broker） | 未配置中继地址 | 原有全部能力；焚毁退化为本地定时销毁，无已读回执 |

**回滚方式：清空 `VITE_RELAY_URL` 即可回到 MQTT 通路，无需改代码。**

传输统一由 `src/lib/transport/` 提供（`ITransport`）：业务逻辑只认「频道语义」，
不感知具体传输。中继与前端共享帧协议定义在 `shared/relay/protocol.ts`。

### 隐私能力与边界

| 能力 | 默认 | 边界（不得超出文案承诺） |
|------|------|------------------------|
| 阅后即焚（定时 / 读后） | 关闭 | 中继保证：销毁后不再投递、自身不保留密文、发送方获得已读确认。**无法**阻止截屏拍屏，也**无法**强制被改过的客户端删除本地明文 |
| 已读回执 | 随焚毁 | 只广播计数，不广播身份；数值来自服务端，客户端不推算 |
| 输入指示（正在输入…） | **关闭** | 会暴露「意图」元数据，比在线状态更敏感，故默认关闭；一个开关同时控制上报与显示 |
| 失焦自动模糊 | 开启 | 纯视觉遮挡（防肩窥），**不是** DRM：内容仍在 DOM 与内存中 |

隐私开关集中在 `src/lib/privacySettings.ts`，经 `chatStorage`（平台 scopedStorage）持久化，仅存本机。

### 本地开发

```bash
npm run dev          # 同时启动 Vite（:8001）与 wrangler dev（:8787，供中继使用）
npm run typecheck    # 前端类型检查
npm run typecheck:relay   # 中继（Worker/DO）类型检查
npm run lint         # typecheck + eslint
npm run relay:check  # 中继干跑打包（不部署）
```

本地把 `VITE_RELAY_URL=/relay` 写在 `.env.local`，Vite 会代理到 `wrangler dev`（见 `vite.config.ts`）。
未安装 wrangler 时 `npm run dev` 只启动前端，并把行为回落为 MQTT 通路。

### 部署

**前端**：静态托管（目标 Cloudflare Pages）。
- `public/_redirects` 提供 SPA 回退，修复 `/chat` 深链接刷新 404
- `public/_headers` 提供安全响应头；CSP 默认注释，启用前必须按文件内说明填好真实来源并实测
- 构建期环境变量：`VITE_MQTT_URL` / `VITE_MQTT_USERNAME` / `VITE_MQTT_PASSWORD` / `VITE_RELAY_URL`

**中继**：
```bash
npm run relay:deploy   # 需要自己的 Cloudflare 账号（wrangler login）
```
可选：在 `wrangler.jsonc` 配置 `ALLOWED_ORIGINS`（逗号分隔）限制可连接来源。

### 已知未闭合风险（务必知悉）

1. **MQTT 凭据进入前端产物**：`.env.local` 的 `VITE_*` 变量会被打进 JS，
   部署到公网后任何访客都能读出。**必须**为该应用申请独立 Broker 账号并配置 topic 级 ACL；
   中继通路不受此影响（其准入靠「房间号 + 密码派生命名空间」构成的不可猜地址）。
2. **中继准入是「地址不可猜」而非服务端签名**：服务端不持有密码派生密钥，
   因此也无法验证任何签名。这保证了端到端加密不被削弱，代价是不存在服务端侧的身份校验。
   中继侧**不得**记录房间地址明文（需要时只记哈希前缀）。
3. **中继可见的最小明文元数据**：消息 id、焚毁策略、房间销毁时间。
   这是实现「不再向后来者投递」所必需的取舍，已压到最小。

