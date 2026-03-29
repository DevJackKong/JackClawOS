# BossAssistant Demo 任务清单 v2

状态: 进行中  
日期: 2026-03-29  
负责人: BossAssistant

## 1. 使用说明

- 任务编号采用连续编号，从 `T01` 开始持续往后追加
- 每个任务都应尽量足够小，方便单独检查
- 每完成一个任务，都要写入开发日志
- “已经实现”和“已经验证通过”是两件不同的事

开发日志：

- [bossassistant-development-log.md](/Users/james007/Documents/BossAssistant/docs/logs/bossassistant-development-log.md)

状态说明：

- `completed`：任务产物已经在仓库中存在
- `in_progress`：任务已经开始，但尚未关闭
- `pending`：任务尚未开始，或还不足以标记为完成
- `blocked`：任务因为依赖或决策问题暂时无法继续

## 2. 今晚 Demo 目标

今晚的目标是做出一个可运行的 MVP，至少要体现：

1. 一句话输入
2. 自动识别 workflow
3. 可见的风险和审批提示
4. workflow 形态的计划草案
5. 输出为决策面板，而不是聊天记录

## 3. 任务列表

### 阶段 A：仓库与工程基础

| ID | 任务 | 状态 | 说明 |
| --- | --- | --- | --- |
| `T01` | 创建工作区目录：`apps/web`、`apps/api`、`packages/contracts` | `completed` | 基础目录已经建立 |
| `T02` | 添加根目录工作区 `package.json` | `completed` | 已包含 workspace 和顶层脚本 |
| `T03` | 添加根目录 TypeScript 基础配置 | `completed` | `tsconfig.base.json` 已存在 |
| `T04` | 添加根目录 `.gitignore` | `completed` | 已加入最小忽略规则 |
| `T05` | 初始化 `packages/contracts` 的 package 配置与 tsconfig | `completed` | 共享 contract 包基础已建立 |
| `T06` | 初始化 `apps/api` 的 package 配置与 tsconfig | `completed` | API 包骨架已存在 |
| `T07` | 初始化 `apps/web` 的 package 配置、tsconfig 和 Vite 配置 | `completed` | Web 包骨架已存在 |

### 阶段 B：产品与 Contract 基线

| ID | 任务 | 状态 | 说明 |
| --- | --- | --- | --- |
| `T08` | 编写今晚 demo 范围与验收标准文档 | `completed` | 已写入 roadmap 文档 |
| `T09` | 编写 `Intent Router Contract v1` 文档 | `completed` | 核心字段定义已完成 |
| `T10` | 将任务板改写为连续编号的执行清单 | `completed` | 当前文件即为新版 |
| `T11` | 在 contracts 中定义共享 workflow 与 policy 枚举 | `completed` | 已实现于 `packages/contracts/src/router.ts` |
| `T12` | 在 contracts 中定义 router 输入输出 Zod schema | `completed` | 已实现于 `packages/contracts/src/router.ts` |
| `T13` | 定义 demo run 响应 contract 与 plan schema | `completed` | 已实现于 `packages/contracts/src/demo-run.ts` |
| `T14` | 添加 `meeting`、`deal`、`content`、`unknown`、`unsupported` 示例 fixtures | `completed` | 已创建于 `packages/contracts/fixtures/intent-router/` |

### 阶段 C：API Demo 主链路

| ID | 任务 | 状态 | 说明 |
| --- | --- | --- | --- |
| `T15` | 搭建最小可用的 Express API 入口 | `completed` | `apps/api/src/index.ts` 已存在 |
| `T16` | 添加 `GET /api/health` 健康检查接口 | `completed` | 已实现健康检查 |
| `T17` | 添加 `POST /api/console/submit` 请求校验 | `completed` | 已使用共享 request schema |
| `T18` | 实现 `meeting`、`deal`、`content` 的确定性路由评分逻辑 | `completed` | 已完成关键词评分 |
| `T19` | 实现 `riskLevel`、`urgency`、`approvalHint` 推断逻辑 | `completed` | 已写入 router 逻辑 |
| `T20` | 实现 `unknown` 与 `unsupported` 的 fallback 策略 | `completed` | 已支持澄清、阻断、人工审阅 |
| `T21` | 为每个支持的 workflow 实现 planner stub 步骤 | `completed` | `apps/api/src/planner.ts` 已存在 |
| `T22` | 组装统一的 demo run 响应 payload | `completed` | 响应已包含 route、plan、decision summary |
| `T23` | 添加非法请求的基础错误返回结构 | `completed` | 已返回 `400` 和 issues |

### 阶段 D：Web Demo 主链路

| ID | 任务 | 状态 | 说明 |
| --- | --- | --- | --- |
| `T24` | 搭建 React 入口与应用挂载 | `completed` | `apps/web/src/main.tsx` 已存在 |
| `T25` | 搭建董事长风格首页壳层 | `completed` | 已有 Hero 和 dashboard 壳层 |
| `T26` | 实现 Command Console 表单与 policy mode 选择器 | `completed` | 输入区和模式选择已存在 |
| `T27` | 展示 workflow、confidence、risk、urgency 的结果卡片 | `completed` | 指标卡片已实现 |
| `T28` | 展示 approval、fallback、plan 三个面板 | `completed` | 页面已包含相关面板 |
| `T29` | 添加预设样例命令，方便快速演示 | `completed` | 已有 sample command chips |

### 阶段 E：验证与交接

| ID | 任务 | 状态 | 说明 |
| --- | --- | --- | --- |
| `T30` | 建立并持续维护开发日志与 bug 记录 | `completed` | MVP 阶段日志与 bug 记录机制已建立并持续更新 |

### 阶段 F：运行持久化与历史回看

| ID | 任务 | 状态 | 说明 |
| --- | --- | --- | --- |
| `T31` | 在 contracts 中定义 run history list schema | `completed` | 已补充 run history entry 与 list response schema |
| `T32` | 为 API 添加 SQLite `task_runs` 持久化层 | `completed` | 已新增 `apps/api/src/run-store.ts` 并落 SQLite 文件存储 |
| `T33` | 添加 `GET /api/runs` 与 `GET /api/runs/:runId` 接口 | `completed` | 已支持最近 run 列表与单条 run 回查 |
| `T34` | 为 Web 添加 run history panel 与历史 run 回看交互 | `completed` | 已支持最近 run 列表展示与点选回看 |
| `T35` | 扩展 smoke/e2e 覆盖 SQLite 持久化与历史回看链路 | `completed` | `verify:smoke` 与 Playwright 已覆盖 run persistence / history path |

## 4. Demo 可信之前必须补的事项

当前这一版实现之后，最关键的后续检查是：

1. 使用 `T14` 的可复用路由 fixtures 覆盖 `meeting`、`deal`、`content`、`unknown`、`unsupported`
2. 安装依赖并执行本地 build 与 typecheck
3. 同时启动 `api` 和 `web`，检查端到端链路
4. 分别验证 `meeting`、`deal`、`content`、`unknown`、`unsupported`
5. 把 bug 与修复过程写进开发日志

## 5. 审阅清单

你可以按这几个点来审：

1. 任务粒度是否足够细
2. 连续编号是否更直观
3. 状态标记是否和当前仓库真实情况一致
4. 后续是否按 `T14 -> 验证` 这个顺序继续推进
