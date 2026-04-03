# JackClaw OS — Demo Runbook Tonight v1

状态: 可执行  
日期: 2026-03-29  
负责人: JackClaw OS

## 1. 目标

今晚 demo 的目标不是展示完整自治，而是稳定展示这一条主链路：

1. 一句话输入
2. 自动识别 workflow
3. 显示风险和审批姿态
4. 生成 workflow plan
5. 以 decision panel 形式输出

## 2. 本地启动顺序

推荐演示前先执行：

```bash
npm run verify:smoke
```

如果 smoke 通过，再分别启动：

```bash
npm run dev:api
npm run dev:web -- --host 127.0.0.1 --port 4173
```

演示地址：

- Web: `http://127.0.0.1:4173`
- API health: `http://127.0.0.1:8787/api/health`

语言建议：

- 默认切到中文演示，更符合当前使用场景
- 如果需要给英文受众展示，可在前端顶部切换到 `English`

## 3. 推荐演示顺序

### 3.1 Meeting

命令：

`Prepare me for tomorrow's board meeting with ByteDance`

你要讲的点：

- 系统先做 workflow route，不直接开始聊天
- `meeting` 被识别为主 workflow
- 风险和 urgency 会先被显式拉出来
- plan 是 meeting brief，不是泛泛回复

预期画面：

- workflow: `meeting`
- route status: `routed`
- urgency: `high`
- next action: 进入 planner

### 3.2 Deal

命令：

`Assess whether we should proceed with this AI tooling acquisition`

你要讲的点：

- 这是高风险决策型 workflow
- 系统可以给出 decision-ready 结构，但不绕过审批
- approval stage 会高于 meeting/content

预期画面：

- workflow: `deal`
- risk: `high`
- approval: `before_artifact_release`
- plan: strategy fit / diligence / recommendation

### 3.3 Content

命令：

`Draft a LinkedIn post about our new strategy and check publication risk`

你要讲的点：

- 这是 content，不是普通文案聊天
- 对外发布会自动提升审批和 reputational posture
- 既能 draft，也能显示 publishability 风险

预期画面：

- workflow: `content`
- risk: `high`
- approval stage: `before_external_action`

### 3.4 Unknown

命令：

`Analyze this and tell me what to do next`

你要讲的点：

- JackClaw OS 不会假装自己知道
- 不确定时先 clarification，再决定 workflow
- 这体现 human-gated 和 transparent-by-default

预期画面：

- workflow: `unknown`
- route status: `needs_clarification`
- fallback: `clarify_and_retry`
- required inputs 明确可见

### 3.5 Unsupported

命令：

`Build me a PowerPoint roadmap for our competitor intelligence report`

你要讲的点：

- demo scope 只支持 `meeting/deal/content`
- 超出边界时系统会显式阻断，而不是 silent fail
- 这体现 workflow-first，不是什么都硬接

预期画面：

- workflow: `unsupported`
- route status: `blocked`
- next action: `block_run`

## 4. 现场讲述话术

可以按这个节奏讲：

1. “这不是一个 chat-first 助手，而是 workflow-first 的董事长决策操作系统。”
2. “用户只输入一句话，系统先做路由，再做 plan，再决定审批姿态。”
3. “高风险任务不会直接自治执行，人始终保留最后审批权。”
4. “如果意图模糊或超出范围，系统会明确告诉你，而不是编一个看起来合理的答案。”

## 5. 现场兜底策略

如果联网页面临时不稳定：

- 先跑 `npm run verify:smoke`
- 用 runbook 里的 5 条命令重新打
- 优先演示 `meeting -> deal -> unknown`

如果有人追问“为什么不直接执行”：

- 回答重点放在 `approval-first`
- 解释当前 demo 展示的是 decision-ready artifact，不是全自动代执行

## 6. 演示前检查清单

- `npm run verify:smoke` 通过
- Web 首页可打开
- API health 返回正常
- 中文/English 切换可用
- 至少手动跑过 `meeting`、`deal`、`unknown`
- 不临时改 schema、不临时重构
