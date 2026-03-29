# JackClaw OS

JackClaw OS 是一个本地运行的 AI 情报与执行工作台。

当前版本已经包含：

- 对话式 chatbot 界面
- 香港 / AI 热点播报
- GitHub 热门项目、科研成果、AI 融资跟踪
- 任务清单
- 社交管理
- 市场脉搏
- 灵感手账

它适合被部署成一个本地网页应用，打开浏览器即可开始使用。

## 适合谁

- 想把 AI、财经、项目动态和日常执行放在一个面板里的人
- 想让 OpenClaw / Codex 这类编码 agent 帮自己一键部署本地工具的人
- 想把网页应用直接拉到本地机器上跑起来的人

## 当前运行方式

当前项目的运行方式是：

- 前端：React + Vite
- 后端：Express + TypeScript
- 聊天运行时：支持 `OpenClaw runtime` 或 `Anthropic 兼容接口`
- 本地数据：SQLite

推荐默认方式：

- 用 OpenClaw 帮用户克隆、安装、启动、验证
- 网页里的 chatbot 也直接走 `openclaw agent`

也就是说：

- 现在已经适合“OpenClaw 读取仓库链接后，帮用户一键部署并打开网页”
- 也支持“网页里的对话本身直接走 OpenClaw runtime”

## 本地启动

### 1. 准备环境

建议环境：

- Node.js 20+
- npm 10+

### 2. 克隆仓库

```bash
git clone <YOUR_GITHUB_REPO_URL>
cd BossAssistant
```

### 3. 配置环境变量

复制示例文件：

```bash
cp .env.example .env.local
```

如果你要走 OpenClaw runtime，推荐填成这样：

```bash
BOSSASSISTANT_CHAT_RUNTIME=openclaw
OPENCLAW_BIN=openclaw
OPENCLAW_AGENT_ID=
OPENCLAW_SESSION_PREFIX=jackclaw-os
OPENCLAW_TIMEOUT_MS=120000
```

如果你暂时想保留 Anthropic 兼容接口，也可以继续填写：

```bash
ANTHROPIC_BASE_URL=https://your-compatible-endpoint
ANTHROPIC_AUTH_TOKEN=your-token
ANTHROPIC_MODEL=claude-opus-4-6
BOSSASSISTANT_ENABLE_AI=1
```

## OpenClaw Runtime 前提

如果你想让网页里的聊天直接走 OpenClaw runtime，需要先确认这台机器满足这两件事：

- 已安装 `openclaw`
- 命令行里直接运行 `openclaw --help` 不报错

如果你还希望指定某个 agent 来承接网页聊天，可以在 `.env.local` 里加：

```bash
OPENCLAW_AGENT_ID=your-agent-id
```

如果不填，就使用 OpenClaw 默认 agent。

### 4. 安装依赖

```bash
npm install
```

### 5. 启动应用

```bash
npm run dev
```

默认情况下：

- API 会运行在 `http://127.0.0.1:8787`
- Web 会运行在 `http://127.0.0.1:5173`

打开浏览器访问：

```text
http://127.0.0.1:5173
```

## 生产构建

```bash
npm run build
```

如果你只想做检查：

```bash
npm run typecheck
```

## 给 OpenClaw 的一键部署 Prompt

如果你想让别人明天直接把这个仓库链接丢给 OpenClaw，然后在他们电脑上自动部署，可以把下面这段 prompt 放进 README。

### 简洁版

```text
请帮我克隆这个仓库，安装依赖，复制 .env.example 为 .env.local，把 BOSSASSISTANT_CHAT_RUNTIME 设为 openclaw，检查本机 openclaw 是否可用，然后启动本地服务，并验证 http://127.0.0.1:5173 和 http://127.0.0.1:8787/api/health 都能正常打开。最后告诉我下次重新启动的准确命令。
```

### 完整版

```text
我要把 JackClaw OS 部署到本地电脑上日常使用。请你完成这些事：
1. 克隆这个 GitHub 仓库
2. 检查 Node.js、npm 和 openclaw 是否可用
3. 复制 .env.example 为 .env.local，并把 BOSSASSISTANT_CHAT_RUNTIME 设为 openclaw
4. 如果需要，帮我填写 OPENCLAW_AGENT_ID
5. 安装依赖
6. 启动项目
7. 验证 http://127.0.0.1:5173 页面可打开，且 http://127.0.0.1:8787/api/health 返回正常
8. 告诉我运行数据写到哪里
9. 告诉我下次重新启动的准确命令
```

### 如果你已经有公开仓库链接

把上面的 prompt 换成带仓库地址的版本，例如：

```text
请帮我部署 JackClaw OS。克隆 https://github.com/<your-name>/<your-repo>.git，检查 Node.js、npm 和 openclaw 是否可用，复制 .env.example 为 .env.local，把 BOSSASSISTANT_CHAT_RUNTIME 设为 openclaw，必要时填写 OPENCLAW_AGENT_ID，安装依赖，启动本地服务，验证 http://127.0.0.1:5173 和 http://127.0.0.1:8787/api/health 都能正常访问，并告诉我下次重新启动的准确命令。
```

## 运行数据写到哪里

这些内容不会提交到仓库：

- `.env.local`
- `data/`
- `node_modules/`
- `dist/`
- `test-results/`

其中 SQLite 默认写在：

```text
data/bossassistant.sqlite
```

## 项目结构

```text
apps/
  api/        Express API
  web/        React Web UI
packages/
  contracts/  前后端共享类型
```

## 明天给别人用的最短说明

如果你只是想让别人明天快速开始：

1. 把这个仓库上传到 GitHub
2. 让对方把仓库链接发给 OpenClaw
3. 让对方使用 README 里的“一键部署 Prompt”
4. 对方本地填写 `.env.local`
5. 对方打开 `http://127.0.0.1:5173`

## 推送到 GitHub

如果你准备让我直接推送，只需要先在 Codex 的设置里放好 GitHub token，然后把目标仓库地址给我。

推荐流程：

1. 在 GitHub 先创建一个空仓库
2. 在 Codex 设置里配置 token
3. 把仓库地址发给我，例如 `https://github.com/<your-name>/<your-repo>.git`
4. 我来继续执行 `git add`、`git commit`、`git remote add origin`、`git push -u origin main`

如果你想自己手动推，可以用这组命令：

```bash
git config user.name "Your Name"
git config user.email "you@example.com"
git add .
git commit -m "Initial JackClaw OS"
git remote add origin https://github.com/<your-name>/<your-repo>.git
git push -u origin main
```

如果你用的是 token HTTPS 推送，常见做法是：

```text
Username: 你的 GitHub 用户名
Password: 你的 GitHub token
```

## 后续可选增强

如果你下一步想更进一步，我建议继续做这两件事：

1. 增加 `Docker / docker-compose`
说明：让别人即使不用 OpenClaw，也能一条命令起服务

2. 增加 `OpenClaw session / memory` 可视化
说明：把 OpenClaw session id、最近一轮调用和失败原因直接展示到网页里，方便排查
