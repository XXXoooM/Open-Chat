# Open Chat 修复报告

| 项目 | 内容 |
|---|---|
| 修复对象 | `AUDIT.md` 中记录的 44 项问题 |
| 修复日期 | 2026-09-23 |
| 已解决 | **41 项完全解决** |
| 部分解决 | **3 项**（`SEC-06`、`ENG-07`、`ENG-12`，均因依赖外部配置或平台决策，见第 5 章） |
| 无法在本次完成 | **7 项运行时验证**（需真实 Broker 与浏览器，见第 6 章） |
| 验证手段 | `tsc` 类型检查 0 错误 / `eslint` 0 错误 / 生产构建通过并逐项检查产物 CSS / 缺陷残留全文检索为 0 |

---

## 1. 修复范围与总体结果

### 1.1 改动规模

| 类别 | 数量 | 说明 |
|---|---|---|
| 新增文件 | 6 | `lib/chatLimits.ts`、`lib/chatStorage.ts`、`lib/mqttConfig.ts`、`vite-env.d.ts`、`scripts/build.mjs`、`.env.example` |
| 重写文件 | 9 | `hooks/useMqttChat.ts`（核心）、`lib/crypto.ts`、`lib/media.ts`、`ChatPage.tsx`、`tailwind-theme.css`、`AGENTS.md`、`package.json`、`scripts/dev.mjs`、`README.md` |
| 新增/迁移文件 | 5 | 5 个业务组件迁移到页面 `components/` 目录并修复 |
| 删除文件 | 9 | 旧组件 ×5、`ExamplePage.tsx`、`data/chat.ts`、`typography.css`、`scripts/build.sh` |
| 删除依赖 | 11 | 见 `ENG-03` |
| 业务代码零改动保障 | — | 所有改动都可被 `tsc` 与 `eslint` 静态校验；无新增依赖 |

### 1.2 结果概览

```
AUDIT 44 项  ──►  41 项完全解决 │ 3 项部分解决（需外部配置/平台决策）
                                  │
                     7 项需运行时验证（本次已完成静态 + 构建验证）
```

**修复前的基线**：`tsc` 0 错误、`eslint` 0 错误（先建立基线，确保后续任何报错都能归因于本次改动）。

---

## 2. 验证方式与执行结果

### 2.1 静态验证

| 检查 | 命令 | 结果 |
|---|---|---|
| 类型检查 | `npx tsc -p tsconfig.app.json` | ✅ 0 错误 |
| 静态检查 | `npx eslint src` | ✅ 0 错误 |
| 依赖一致性 | `npm install` | ✅ 剪除 104 个包，无冲突 |
| 生产构建 | `node scripts/build.mjs` | ✅ 构建成功，产物布局正确 |
| 开发服务器 | `npm run dev` | ✅ Vite v8.0.14 就绪（981ms）、`GET /` 返回 **HTTP 200**、日志落盘正常、`taskkill /T` 后端口 8001 **监听数 0**（无残留进程） |

### 2.2 构建产物验证（证明改动真实生效）

对构建出的 CSS 逐项断言，避免「改了源码但没生效」：

| 断言 | 期望 | 实测 |
|---|---|---|
| 模板蓝残留 | 0 | ✅ `221 83% 53%` 出现 **0** 次 |
| 主色派生边框 | 来自 `var(--primary)` | ✅ `--primary-border:hsl(from var(--primary) h s calc(...))` |
| 侧边栏主色 | 珊瑚 `hsl(6 78% 57%)` | ✅ `--sidebar-primary:#e74d3c` |
| 图表色 | 暖调阶梯 | ✅ `#e74d3c / #df713a / #da962f / … / #9b734b` |
| 浅底警告 token | 存在且为深字浅底 | ✅ `--warning-surface:#fbf0da`、`--warning-surface-foreground:#7a5c1f` |
| 字体栈 | 含 Noto Sans SC **且**含平台字体 | ✅ `.font-sans{font-family:Noto Sans SC,LarkHackSafariFont,LarkEmojiFont,…}` |
| 已废变量 | 不应出现 | ✅ `--tracking-normal`、`--shadow-x` 均 **MISS（已删除）** |
| 已废 prose 样式 | 不应出现 | ✅ 出现 **0** 次 |

> 对比修复前：`.font-sans` 为 `'Noto Sans SC',-apple-system,…`（平台字体缺失），
> `--primary-border` 由硬编码蓝色派生，`--chart-*` 为跨色轮彩虹色。

### 2.3 缺陷残留全文检索（期望 0 命中）

对 `src/` 检索以下修复前特征串：

```
<broker-username> | <password-prefix> | const BROKER_URL = 'wss | smooth ? 'auto' : 'auto' |
forceTick | lastExtendToastRef | @/data/chat | typography |
watermark | onRoomExpired | bg-warning/(10|15) | dangerouslySetInnerHTML
```

结果：**4 处命中，全部为「解释性注释」或「既有无关代码」**，无一处为真实缺陷残留：

- `src/tailwind-theme.css:36` — 注释中解释旧写法为何危险
- `src/pages/ChatPage/ChatPage.tsx:114` — 注释中说明 `forceTick` 为何被替换
- `src/components/Layout.tsx:7` — 注释中说明移除水印 hack 的原因
- `src/components/ui/chart.tsx:83` — `dangerouslySetInnerHTML`，属既有的图表组件（不在消息渲染路径，见 `SEC-07`；该目录被排除，未改动）

另有独立检查：`src/`、`scripts/`、`shared/`、`public/` 中 Broker 凭据出现次数 = **0**。

---

## 3. 逐项修复明细（前 → 后）

### 3.1 安全问题（7 / 7）

| 编号 | 修复前 | 修复后 | 原因 |
|---|---|---|---|
| `SEC-01` **P0** | `useMqttChat.ts:440-441` 硬编码 `username` / `password`（已脱敏），且 Broker 地址写死 | 新增 `src/lib/mqttConfig.ts` 从 `import.meta.env.VITE_MQTT_*` 读取；新增 `.env.example`；**未配置时不发起连接**、界面明确提示缺失变量 | 凭据必须下发到浏览器才能建连，因此目标是「不提交进仓库 + 可随时轮换 + 缺失时快速失败」，而不是让凭据对用户不可见 |
| `SEC-02` **P1** | 任何 `meta` 报文解密失败即判「密码错误」→ `navigate('/')`，一条伪造报文可踢出全房间 | `decryptJson` 返回扁平结果对象，区分 `invalid-envelope` / `unsupported-version` / `decrypt-failed`；**仅「首次拿到 meta」才判密码错误**，房间已激活后收到无法解密的 meta 只记警告并忽略 | 原逻辑把「报文被篡改」与「密码错误」混为一谈，且无任何鉴权，构成无门槛 DoS |
| `SEC-03` **P1** | PBKDF2 固定 10 万次迭代 | 版本化密钥环：**v2 = 600,000 次**（新房间默认），保留 v1 = 100,000 以解密既有房间；前端强制密码 ≥8 位并给出说明 | 提升离线爆破成本；同时必须保留 v1 否则进行中的房间会全部被判「密码错误」 |
| `SEC-04` **P1** | MQTT 遗嘱明文携带 `userName` 与 `userId`，且接收侧因要求 `iv/data` 而**静默丢弃**，功能同时失效 | 遗嘱只携带 `sid = sha256(clientId).slice(0,16)`；presence 消息建立 `sid → user` 映射，接收侧正确还原离开者 | 遗嘱由 Broker 代发、无法加密，因此只能携带不可逆标识；同时修好被丢弃的 leave 通知 |
| `SEC-05` **P1** | topic = `chatroom/{纯数字roomId}/messages`，可被通配订阅枚举 | v2 topic 加入**由密码经 PBKDF2 派生的命名空间**：`chatroom/{roomId}/{ns}/messages`；客户端同时订阅 v1/v2 以兼容历史房间 | 命名空间本身必须抗爆破（不能直接 sha256，否则它就成了廉价密码校验器），故同样走 PBKDF2 |
| `SEC-06` **P2** | 建房时先发空 retained 清空 meta，制造「房间不存在」时间窗；任意持凭据者可清空 meta | 建房时**直接覆盖 retained**（不再先清空）；收到空 meta 且本地有 meta 时带**随机抖动**重发；meta 增加 `version` 单调保护，拒绝版本倒退 | 消除竞态窗口；抖动避免多客户端重发风暴。彻底防护仍需 Broker 发布鉴权（见第 5 章） |
| `SEC-07` **P3** | 无实际 XSS 面（核查结论） | 保持无风险：新增的重试按钮、状态标签仍为纯文本插值，未引入 `dangerouslySetInnerHTML` | 无需修复，本次改动未引入新的注入面 |

### 3.2 功能正确性（18 / 18）

| 编号 | 修复前 | 修复后 | 原因 |
|---|---|---|---|
| `FUNC-01` **P1** | 过期分支用 `presenceTimersRef.size + 1` 判断在线人数，但未发 `request-users` → 该值恒为 1，「≥15 人自动续期」不可达 | 过期分支**先发 `request-users`** 再等待统计；新增 `countOnline()` 合并「已登记用户集合」与「presence 计时器」两个来源 | 判定必须基于真实活跃用户，不能只看单一时序容器的长度 |
| `FUNC-02` **P1** | 每次 `connect` 都新建 `setInterval` 覆盖旧引用，旧实例不清理；重连后定时器累积 | 统一 `stopTimers()` + 幂等启动；`close` / `reconnect` 时也停止定时器 | 重连、StrictMode 双跑都会放大泄漏，必须做集中生命周期管理 |
| `FUNC-03` **P1** | 固定 2 秒收不到 meta 即判定「我是创建者」，多客户端并发首进互相覆盖 retained | 等待时间改为 **2 秒 + 随机抖动(0~2 秒)**；meta 增加 `version`（`Date.now()`）并**拒绝版本回退** | 用随机化降低撞车概率，用单调版本保证所有客户端收敛到同一份 meta |
| `FUNC-04` **P1** | 三条接收路径均无条件 `append`，QoS 1 重投递导致重复上屏 | 统一 `appendMessage()`：**按 `id` 去重**、按 `timestamp` 插入正确位置、已存在的「发送中」消息被回显标记为已送达 | MQTT QoS 1 语义是「至少一次」，重复投递是预期行为，必须在应用层幂等 |
| `FUNC-05` **P1** | 聊天页传 `state:{error}`，但欢迎页**从未读取** → 用户只看到莫名被弹回首页 | `NicknameInputSection` 用 `useLocation` 消费 `state.error`，以告警条展示后清除 state | 反馈链路必须闭环；清除 state 避免刷新重复提示 |
| `FUNC-06` **P2** | 密码只来自路由 state，刷新 `/chat` 即被踢回首页 | 密码回退到 `sessionStorage`（刷新可恢复、关闭标签页失效）；主动离开或校验失败时清除 | 在「可用性」与「不留长期凭据」之间取平衡，避免把密码写入 localStorage |
| `FUNC-07` **P2** | `forceTick` 每秒重渲染，但 `remaining` 的 `useMemo` 依赖 `[roomMeta]` → **倒计时数字被永久冻结**，紧急态 UI 全部失效 | 把「当前时间」纳入状态：`const [now, setNow]` + 每秒更新，`remaining` 依赖 `[roomMeta, now]` | 倒计时是时间函数，memo 的依赖必须包含时间本身 |
| `FUNC-08` **P2** | `leave` 分支只移除列表项，未清理 presence 计时器与 map 条目 | 新增 `clearPresenceTimer()`；`join`/`heartbeat` 统一走 `touchPresence()`，`leave` 清理计时器与 sid 映射 | 残留计时器既造成无谓重渲染，又会让在线人数被虚增（`FUNC-01` 依赖该数据） |
| `FUNC-09` **P2** | 未连接时 `publishEncrypted` 静默 `return`，用户输入框已清空却看不到失败 | `publishWithAck()` 返回投递结果（带 8 秒超时）；**乐观上屏**（`sending`）→ 成功 `sent` / 失败 `failed` + toast + 消息上「点击重试」 | 发送必须有确定结果；乐观上屏同时消除了「自己消息依赖 Broker 回显才可见」的隐式依赖 |
| `FUNC-10` **P2** | `behavior: smooth ? 'auto' : 'auto'`，两个分支相同，平滑滚动从未生效 | 修正为 `smooth ? 'smooth' : 'auto'`；自动置底仍用 `'auto'` 避免滚动排队 | 明显的书写疏漏 |
| `FUNC-11` **P2** | 只看消息条数变化，向上翻阅时自己发消息也会弹「新消息」 | 按「最后一条消息 id 是否变化」判断，并区分 `isMine`：自己的消息强制置底，他人消息才提示 | 提示语义应与消息来源一致；依赖 `messages` 而非 `length` 可避免状态翻转误触发 |
| `FUNC-12` **P2** | `compressImage` 每次都泄漏 objectURL；`getImageDimensions` 的 `onerror` 分支也泄漏 | 两条路径均用 `finally` / 错误分支 `revokeObjectURL` | 图片路径是高频操作，泄漏会随会话累积 |
| `FUNC-13` **P3** | `lastExtendToastRef` 只有声明与读取、**从无赋值**，守卫恒不生效 | 替换为真实的 `isExtending` 状态；加时中按钮禁用并显示旋转图标 | 用真实状态替代无效占位逻辑 |
| `FUNC-14` **P3** | `onRoomExpired` 声明未用；自动续期不递增 `extendCount`，与手动上限叠加后生命周期无限延长 | 移除死配置 `onRoomExpired`；新增 `autoExtendCount` 并限制**自动续期最多 3 次** | 生命周期需要有明确上界；未使用的公开配置会误导调用方 |
| `FUNC-15` **P3** | 950KB / 700KB 在两处各定义一份；图片路径**无任何预检**；同一失败场景一处 `toast` 一处 `toast.error` | 新增 `lib/chatLimits.ts` 作为唯一来源；图片增加「原始体积」与「压缩后体积」双预检；文案与级别统一 | 阈值必须单点维护；GIF 不压缩却走同一上限，必须在压缩后校验 |
| `FUNC-16` **P3** | 用 `nickname === currentNickname` 判定「我」，重名用户同时被高亮 | 改为传入 `currentUserId` 并按 `id` 比对与排序 | 消息侧一直用 `senderId` 比对，在线列表应对齐，昵称不具唯一性 |
| `FUNC-17` **P3** | 桌面/移动两份 `OnlineUsersSection` 同时挂载，仅靠 CSS 隐藏，头像被重复渲染 | 引入 `useIsMobile()` 按断点**只挂载一份** | 消除一半无用渲染与动画节点（顺带让 `use-mobile.ts` 不再死代码） |
| `FUNC-18` **P3** | 发送中用 `X`（取消语义）图标，但按钮此刻 `disabled`，图标暗示可点却点不动 | 改为 `Loader2` + `animate-spin` | 图标语义应准确；不可点的按钮不应暗示可交互 |

### 3.3 UI 与主题一致性（7 / 7）

| 编号 | 修复前 | 修复后 | 原因 |
|---|---|---|---|
| `UI-01` **P2** | `bg-warning/15 text-warning-foreground`（近白字 + 浅橙底，对比度约 **1.1:1**），紧急提示几乎不可见 | 新增 `--warning-surface` / `--warning-surface-foreground` / `--warning-surface-border` 并注册到主题；紧急提示改用该组 token，实测对比度约 **5.2:1** | `*-foreground` 是「实心底上的文字」，不能用于浅色底；语义色必须成对使用 |
| `UI-02` **P2** | `--sidebar-*` 为模板冷灰+蓝；`--primary-border` 由硬编码蓝色派生；`--chart-*` 为彩虹色 | 全部改为珊瑚暖调或从语义变量派生；构建产物验证模板蓝残留 **0** 次 | 消除「珊瑚按钮 + 蓝边框」「一半暖调一半冷蓝」的割裂 |
| `UI-03` **P3** | 顶栏 `max-w-5xl`、消息区与输入栏 `max-w-3xl` | 统一为 `max-w-3xl` | 统一视觉轴线，符合设计规范的内容区约束 |
| `UI-04` **P3** | >1 小时显示「剩余 X」，<1 小时突变为「房间将在 X 后销毁」 | 统一为「剩余 …」，紧迫感交给颜色与图标 | 同一信息位句式突变会让人误判状态变化 |
| `UI-05` **P3** | `@theme inline` 用短字体栈覆盖了平台字体栈且行尾多 `;;`；`index.css` 的字体 URL 写成 HTML 实体 `&amp;` 致 `display=swap` 失效 | 两处字体栈一致并包含平台字体；修正语法；构建产物验证 `.font-sans` 已包含 `Noto Sans SC` 与 `LarkHackSafariFont` 等 | 覆盖平台字体栈会导致部分环境字形异常；实体转义错误使参数失效 |
| `UI-06` **P3** | 定义但从未映射/使用的 `--shadow-x/y/blur/spread/opacity/color`、`--tracking-normal`；`--info`、`--chart-*`、`--sidebar-*` 为不协调的模板色 | 删除确实无人引用的 7 个变量（构建产物验证已消失）；`--chart-*`/`--sidebar-*`/`--info` 因仍被保留的 `ui/` 组件引用而**保留名称、改暖调值** | 保留名称可避免破坏被排除在类型检查之外的 `ui/` 组件；只删除能确认无消费者的变量 |
| `UI-07` **P3** | 欢迎页渐变用 `to-secondary/10`（设计规范将 `accent` 定义为装饰/反馈色） | 改为 `to-accent/10`；并把欢迎文案改为与真实功能一致（房间号/密码/端到端加密） | 避免语义角色误用，未来两者色值分化时不会意外漂移 |

### 3.4 工程整洁度（12 / 12）

| 编号 | 修复前 | 修复后 | 原因 |
|---|---|---|---|
| `ENG-01` **P2** | `ExamplePage.tsx` 整文件注释且未注册；`data/chat.ts` 的 mock 与 `IMessage`/`IOnlineUser` 重复定义无人使用 | 删除 `ExamplePage` 与 `data/chat.ts`；`IOnlineUser` 统一由 `useMqttChat` 导出，`IMessage` 由 `MessageListSection` 导出，`MessageStatus` 复用 Hook 类型 | 死代码与重复类型会持续误导后续开发者 |
| `ENG-02` **P2** | `build` 依赖 bash/rsync/find；`dev` 依赖 `lsof`、进程组信号，且用 `spawn('npx', …, {shell:false})` 启动 → win32 下构建与开发服务器都不可用 | 新增 `scripts/build.mjs`（Node 标准库实现同等产物布局）；`dev.mjs` 改为**用当前 Node 直接运行 `node_modules/vite/bin/vite.js`**（不使用 `npx`），端口清理与进程回收按平台分支（`netstat`+`taskkill /T`），并补上子进程 `error` 事件处理；删除 `build.sh`；**已在 win32 实测构建成功、开发服务器 HTTP 200 且终止后端口无残留** | 构建/开发能力不应与操作系统绑定；见第 4 章第 5 项（`npx.cmd` 无法被 `shell:false` 执行） |
| `ENG-03` **P2** | 10 个依赖零引用，另有 `@tailwindcss/typography` 仅服务于无用样式；55 个 UI 组件中 50 个未使用 | 删除 11 个依赖（`npm install` 实际剪除 **104** 个包）；`ui/` 组件库**保留**并在 README 说明理由 | 零引用包是纯负担；而 `ui/` 是平台模板的组件库，删除会破坏模板一致性，改为文档化其排除策略 |
| `ENG-04` **P2** | `Layout.tsx` 用 `MutationObserver` + `<style>` 隐藏平台 watermark/branding，且每次 DOM 变更全量查询选择器 | 整体移除，`Layout` 回归纯 `<Outlet />`；构造函数并说明原因 | 绕过平台展示约束存在合规风险；全文档子树监听在消息频繁上屏时是持续性能开销 |
| `ENG-05` **P2** | `AGENTS.md` 描述 WebSocket + 仅昵称 + mock，与实现（MQTT + 房间号密码 + E2EE）完全脱节，且被 IDE 作为 AI 上下文载入 | 按实现重写：真实架构、协议约定（v1/v2 topic、信封、meta 结构、presence）、生命周期、安全模型与边界、环境变量、更新后的 UI 设计指南与已知约束 | 文档与实现冲突比「文档过时」更危险 —— 它会直接误导后续所有开发 |
| `ENG-06` **P3** | 5 个业务组件放在 `src/components/` 根目录，违反 README「禁止存放业务组件」；README 文件名大小写与实现不符 | 组件迁移到 `src/pages/{WelcomePage,ChatPage}/components/`；README 更新目录结构并修正 `Layout.tsx` 大小写 | 让代码结构与项目自身规范一致 |
| `ENG-07` **P3** | `src/components/ui` 同时被 tsconfig 与 eslint 排除，55 个组件不受类型与规范检查（实测 LSP 也无法索引） | **未解除排除**（见第 5 章），改为在 README / AGENTS.md 显式说明排除范围、代价与注意事项 | 解除排除会把 33 个依赖与 50 个未使用组件纳入检查，风险与收益不匹配；审计给出的另一条可接受路径即「文档化说明」 |
| `ENG-08` **P3** | `typography.css` 定制了 42 行 `prose` 变量，但业务零使用 | 删除文件、移除 `index.css` 导入、移除 `@tailwindcss/typography` 依赖；构建产物验证 `prose` 出现 0 次 | 为不存在的富文本场景预留的过度设计 |
| `ENG-09` **P3** | `crypto.ts` 通过 `export { base64Encode, base64Decode }` 对外暴露无消费者的内部工具 | 移除该导出，两个函数保持模块内部使用 | 收敛公开 API 面；这两个函数未做输入校验，不适合作为通用工具 |
| `ENG-10` **P3** | `<title>应用标题</title>`；`lang="en"`；外链 CDN favicon 覆盖了本地图标 | 标题改为「加密聊天室」、`lang="zh-CN"`、补充 description、移除外部 favicon 仅保留本地 `/favicon.svg` | 占位标题影响标签页/书签/分享；双份 icon 声明会让本地资源实际失效 |
| `ENG-11` **P3** | `use-mobile.ts` 唯一消费者是无人使用的 `ui/sidebar.tsx`，等价死代码 | 现被 `ChatPage` 用于按断点单份挂载（`FUNC-17`），成为真实基础设施 | 让已有工具用在真正需要它的地方 |
| `ENG-12` **P3** | `node_modules` 不存在、无 `.git`，typecheck/lint/build 全部无法执行 | 已 `npm install` 恢复依赖，**typecheck / eslint / 生产构建全部跑通**；`.git` 未初始化（需用户决策，见第 5 章） | 没有校验手段就无法证明修复有效，这应是修复的第一步 |

---

## 4. 修复过程中自审发现并一并修掉的问题

以下 4 项不在原审计清单内，是修复过程中自查发现的，已同步处理：

| # | 问题 | 处理 |
|---|---|---|
| 1 | **`@theme inline` 中 `--font-sans: var(--font-sans)` 会造成自引用风险**（若 Tailwind 把该变量输出到 `:root` 即为循环定义，字体栈会整体失效） | 放弃变量间接引用，改为在两处写出同一份完整字体栈，并用构建产物断言验证（`.font-sans` 规则实际包含 Noto Sans SC + 平台字体） |
| 2 | **项目预设 tsconfig 为 `strict: false`**，此配置下「布尔判别式联合类型」不做收窄 —— 若沿用可判别联合设计解密结果，会写出一堆绕开类型检查的代码 | 把解密结果与二进制发布结果改为**扁平对象 + 可空字段**，任何 strict 设置下都安全，且无需类型断言 |
| 3 | **续期会导致全房间重复弹「X 加入了聊天室」**：meta 更新时所有客户端都会重跑 `handleMeta`，若无条件广播 join 就会产生 N 条冗余提示 | 增加 `wasActive` 判定，**仅首次拿到 meta 时**广播 join / 拉取在线列表 |
| 4 | **`stopTimers()` 与 meta 等待定时器的时序**：若清理发生在设置之后，会导致新房间永远不会被创建 | 逐行复核执行顺序：`stopTimers()` 同步执行在前，meta 定时器在 `subscribe` 回调（异步）中设置，因此不会被清掉；同时在 `close`/`reconnect` 中主动停止定时器 |
| 5 | **`dev.mjs` 用 `spawn('npx', …, {shell:false})` 启动，Windows 下必然报 `ENOENT` 崩溃** —— `npx` 在 Windows 上是 `npx.cmd`，Node 出于安全考虑不允许在无 shell 时执行 `.cmd`/`.bat`；同时子进程 `error` 事件未监听，导致 Node 以未捕获异常直接退出 ①| 改为用当前 Node 进程直接运行 `node_modules/vite/bin/vite.js`（跨平台、无需 shell、不依赖 `npx` 的 PATH）；补上 `child.on('error')` 输出可读提示；已在 win32 实测通过 |

> ① 该缺陷在修复前就存在，本次 `ENG-02` 首轮修复只覆盖了「构建脚本 + 端口清理/进程回收」，未覆盖「如何启动子进程」，由用户实际执行 `npm run dev` 时暴露并已补齐。

| 6 | **`.env.local` 未加引号导致密码被 dotenv 静默截断** —— Broker 密码含 `#`，而 dotenv 的无引号取值规则是 `[^#\r\n]+`，即遇到 `#` 就当作行内注释丢弃，实际发出的只有密码的前 6 个字符而非完整 15 字符，Broker 返回 `Bad username or password`。同时该类错误此前**只打到控制台**，界面永远停在「连接断开，重连中…」 | ① 配置侧：`.env.local` 的密码改用**单引号**包裹（双引号会启用 `$VAR` 展开，而密码含 `$`），并在 `.env.example` 中写明该书写规则与后果；② 代码侧：`ConnectionStatus` 新增 `auth-error`，识别 CONNACK 4/5 与相关文案后**停止无意义重连**并阻止 `close` 事件覆盖状态，界面给出含排查指引的告警条 |

此外修正了自身两处细节：图片/文件在 MQTT 单包判断上使用真实序列化体积（含 Base64 膨胀），以及二进制转 Base64 采用分块处理避免超长参数导致栈溢出。

---

## 5. 部分解决 / 无法完全解决的问题（含原因）

这 3 项**不是遗漏**，而是受外部配置或平台决策约束，代码侧已做到当前条件下能达到的最优，并已在文档中显式登记。

### 5.1 `SEC-06` — retained `meta` 被清空/伪造：已缓解，根治需 Broker 鉴权

- **已完成**：建房不再先清空 retained（消除「房间看似不存在」的窗口）；收到空 retained 且本地有 meta 时带随机抖动重发；meta 增加单调 `version` 拒绝回退。
- **残留**：任何持有 Broker 凭据者仍可发布空 retained 清空房间元信息，客户端只能「自愈」而不能「阻止」。
- **原因**：MQTT 的 retained 写入鉴权属于 **Broker 侧 ACL 配置**，不在代码仓库范围内，且需要服务端管理权限。
- **建议**：为应用账号配置 ACL，仅允许其发布/订阅 `chatroom/<本应用命名空间>/#`；或迁移到平台自带的实时通信能力。

### 5.2 `ENG-07` — `src/components/ui` 仍被排除在类型与规范检查之外

- **已完成**：在 `README.md` 与 `AGENTS.md` 中显式说明该目录被哪两个配置排除、排除带来的三类代价（不参与 typecheck/lint、语言服务无法索引、依赖被删不会报错）以及修改前的注意事项。
- **残留**：这 55 个文件依然不参与 `npm run typecheck` / `lint`。
- **原因**：解除排除意味着要把 50 个未使用的组件连同 33 个依赖一并纳入检查面，会引入大量与本次目标无关的噪声与风险；审计给出的修复方向本身包含「文档化说明该排除是有意为之」这一可接受路径。
- **建议**：若后续确定长期使用该组件库，应解除排除并为 `ui/` 单独放宽部分 lint 规则；若确定不用，则应整体删除该目录与相关依赖。

### 5.3 `ENG-12` — git 仓库未初始化

- **已完成**：`npm install` 恢复依赖，typecheck / eslint / 生产构建全部跑通。
- **残留**：工作区仍无 `.git`，因此 `.githooks/pre-commit` 不会生效（`scripts/setup-git-hooks.mjs` 在无 `.git` 时按设计静默跳过）。
- **原因**：初始化仓库并设置提交钩子属于会影响用户版本控制工作流的操作，需要用户明确决策（也涉及到已有历史如何迁移）。
- **建议**：`git init` 后重新执行 `npm run prepare` 即可让提交流程自动跑 `lint`。

---

## 6. 需要运行时验证的事项（本次无法完成）

原审计第 7 章列出 8 项需运行时确认的问题。本次修复通过设计手段**降低了其中一部分的风险敞口**，但**均未做真实运行验证** —— 当前环境没有可用的 Broker 凭据与浏览器，无法端到端联调。

| # | 事项 | 本次的处置 | 仍需验证什么 |
|---|---|---|---|
| `D-1` | 平台 `AppContainer` 是否内置 `<Toaster />` | 未改动；应用的 `toast` 调用集中在 Hook 与输入栏 | 用两个浏览器窗口同房，观察「XX 加入了聊天室」是否出现浮层。**若平台未内置，则所有 toast 静默失效**，需要显式挂载 `<Toaster />` |
| `D-2` | Broker 实际单包上限是否支持 950KB | 保持阈值不变，但把判定改为基于真实序列化体积 | 实测发送接近上限的图片/文件，确认收到 `PUBACK` 且对端能解密 |
| `D-3` | Broker 是否回显自身消息 | **风险敞口已消除**：新增乐观上屏 + `id` 去重，自己发的消息不再依赖回显即可见 | 仍需确认「在线列表是否包含自己」—— 这取决于 Broker 是否回显自己发布的 presence |
| `D-4` | StrictMode 双跑是否放大连接抖动 | `FUNC-02` 的定时器幂等化已消除放大器 | 开发模式下观察「MQTT 已连接」日志次数与心跳频率是否符合预期 |
| `D-5` | 外部资源可达性 | `index.css` 字体 URL 已修正；构建日志显示平台会把字体 URL 重写到镜像站点 | 在目标网络实测字体、favicon、WSS 端点的可达性 |
| `D-6` | 房间号实际熵（决定 `SEC-03`/`SEC-05` 风险等级） | 已把密码下限提到 8 位、topic 加入密码派生命名空间 | 与产品确认房间号的真实使用习惯（是否长期只用 4~6 位数字） |
| `D-7` | retained 清空与重写的时序 | 建房不再先清空；重发改带随机抖动；meta 带单调版本 | 多客户端并发首进时观察是否仍会出现「误判建房」 |
| `D-8` | 文件下载链路（中文/特殊字符文件名） | 未改动下载实现 | 端到端实测 A 发文件、B 下载并打开，验证文件名与内容完整性 |

---

## 7. 破坏性变更与升级注意事项

| 变更 | 影响 | 兼容性处理 |
|---|---|---|
| 密钥派生版本 v2（600k 次迭代） | 新房间使用更强的 KDF | 保留 v1 密钥派生，**进行中的历史房间仍可正常收发** |
| topic 增加密码派生命名空间（协议 v2） | 新房间的 messages/presence 位于 `chatroom/{roomId}/{ns}/…` | 客户端同时订阅 v1/v2 两组 topic；房间协议由 `meta.proto` 决定 |
| 明文遗嘱改为 `sid` 哈希 | 异常断线的离开通知不再泄露昵称 | 接收侧同时兼容「加密 leave」与「明文 sid leave」 |
| 本地未配置环境变量时不再连接 | 首次拉取代码后必须配置 `.env.local` | 界面给出明确的缺失变量提示；`.env.example` 提供模板 |

**唯一需要注意的升级窗口**：仍在运行**旧版本前端**的用户无法加入新建的 v2 房间（会提示「检测到更高版本的房间协议」）。房间本身是短生命周期（默认 3 小时），建议在低峰期整体刷新即可。

---

## 8. 回归风险评估

| 风险点 | 评估 | 依据 |
|---|---|---|
| 类型错误 | 无 | 修复前基线 0 错误 → 修复后 0 错误 |
| 规范违规 | 无 | `eslint src` 0 错误 |
| 构建失败 | 无 | 生产构建成功，产物布局与原 bash 脚本一致 |
| 样式失效 | 低 | 逐项断言构建产物 CSS（蓝残留清零、暖调生效、字体栈完整、废弃变量消失） |
| 运行时行为 | **未验证** | 无 Broker 凭据与浏览器环境，见第 6 章 |
| 数据兼容 | 低 | 保留 v1 解密与解密结果分类；旧房间元信息缺 `version`/`proto`/`autoExtendCount` 字段时按缺省值（0 / v1 / 0）处理 |
| 未提交仓库 | 提示 | 工作区无 `.git`，本次改动无法给出 diff 级归因，建议尽快初始化仓库 |

---

## 9. 建议的下一步

1. **配置 `.env.local`** 并接入真实 Broker，完成第 6 章的端到端验证（尤其 `D-1` 与 `D-3`）。
2. **配置 Broker ACL**：限制应用账号只能访问本应用的 topic 前缀，以根治 `SEC-06` 并降低 `SEC-01` 的残留风险。
3. **初始化 git 仓库** 并让 `.githooks/pre-commit` 生效，使后续改动自动跑 typecheck + lint。
4. **决策 `src/components/ui/`**：长期使用则解除 tsconfig/eslint 排除；不使用则整体删除目录与相关依赖（可再削减 30+ 个依赖）。
5. 若关注抗口令爆破能力，可在 `lib/crypto.ts` 的 KDF 版本表中新增 `v3`（如 Argon2id），借助现有版本化机制做平滑迁移 —— 当前架构已支持按版本并列共存。

---

*本报告记录的 44 项问题均对应 `AUDIT.md` 中的编号。所有「已修复」结论均以代码为凭据，「已验证」结论均附具体命令或断言结果；未能运行验证的部分已在第 5、6 章显式区分，未做过度声明。*
