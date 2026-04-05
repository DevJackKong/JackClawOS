# 快速开始

## 系统要求

| 依赖 | 最低版本 | 说明 |
|------|----------|------|
| Node.js | v20.0.0 | 推荐 v20 LTS 或 v22 |
| npm | v10.0.0 | 或 pnpm v9+ |
| 操作系统 | macOS / Linux / Windows WSL2 | |

---

## 三种安装方式

### 方式一：全局 CLI（推荐，最快上手）

```bash
# 全局安装
npm install -g jackclaw

# 验证安装
jackclaw --version

# 启动完整演示环境
jackclaw demo
```

安装后所有命令全局可用：`jackclaw start`、`jackclaw status`、`jackclaw demo` 等。

---

### 方式二：克隆仓库（适合开发者 / 二次开发）

```bash
# 克隆主仓库
git clone https://github.com/jackclaw/jackclaw.git
cd jackclaw

# 安装所有工作区依赖
npm install

# 编译所有包（首次约 30–60 秒）
npm run build

# 启动开发模式（Hub + 2 个 Node，热重载）
npm run dev
```

> **提示**：克隆方式可直接修改源码，适合需要定制 Hub 或 Node 行为的场景。

---

### 方式三：OpenClaw 插件（已有 Claude Code 环境）

如果你已在使用 Claude Code，可以通过 OpenClaw 插件零配置集成：

```bash
# 安装 OpenClaw 插件
claude plugins install openclaw

# 验证插件已激活
claude plugins list | grep openclaw
```

插件安装后：
- JackClaw Hub 自动嵌入当前 Claude Code 会话
- `claude hub start` 命令可用
- Dashboard 在 `http://localhost:3100` 自动打开
- 无需额外配置 API Key（继承 Claude Code 的认证）

若需要独立 Hub URL（对外暴露），在插件配置中指定：

```json
// ~/.claude/settings.json（OpenClaw 插件配置部分）
{
  "openclaw": {
    "hub": {
      "port": 3100,
      "publicUrl": "https://your-hub.example.com"
    }
  }
}
```

---

## `jackclaw demo` 完整输出说明

运行 `jackclaw demo` 后，终端将依次显示以下阶段：

```
jackclaw demo

╔════════════════════════════════════════╗
║        JackClaw Demo Environment       ║
╚════════════════════════════════════════╝

[1/4] 检查依赖...
  ✓ Node.js v20.11.0
  ✓ 端口 3000 可用

[2/4] 启动 Hub...
  ✓ Hub 已启动 → http://localhost:3000
  ✓ WebSocket  → ws://localhost:3000/ws
  ✓ REST API   → http://localhost:3000/api

[3/4] 注册演示 Node（×2）...
  ✓ node-alpha  已连接 [worker]
  ✓ node-beta   已连接 [worker]

[4/4] 提交演示任务...
  → 任务已广播：「分析 README 并生成摘要」
  ✓ node-alpha 认领任务 (task-001)
  ✓ 任务完成：耗时 4.2s

──────────────────────────────────────────
Dashboard  → http://localhost:3000
API Docs   → http://localhost:3000/api-docs
按 Ctrl+C  停止所有进程
──────────────────────────────────────────
```

### 各端点说明

| 端点 | 用途 |
|------|------|
| `http://localhost:3000` | Dashboard — 任务看板 & 实时日志 |
| `http://localhost:3000/api` | REST API 根路径 |
| `http://localhost:3000/api-docs` | Swagger UI 接口文档 |
| `ws://localhost:3000/ws` | WebSocket 实时事件流 |

### 命令参数

```bash
jackclaw demo [options]

  --hub-port <port>   Hub 监听端口（默认：3000）
  --nodes <n>         自动启动的 Node 数量（默认：2）
  --no-open           不自动打开浏览器
  --verbose           显示详细日志
  -h, --help          显示帮助
```

---

## 首次配置指南

### 1. 创建配置文件

在项目根目录创建 `jackclaw.config.js`：

```js
// jackclaw.config.js
export default {
  hub: {
    port: 3000,
    // 生产环境必须设置，用于 Node 注册认证
    secret: process.env.JWT_SECRET,
    // 对外暴露的公网地址（Node 从外部连接时使用）
    publicUrl: process.env.HUB_PUBLIC_URL || 'http://localhost:3000',
  },
  nodes: {
    maxConcurrent: 5,    // 每个 Node 最大并发任务
    timeout: 30_000,     // 任务超时（毫秒）
    heartbeat: 10_000,   // 心跳间隔（毫秒）
  },
  llm: {
    provider: 'anthropic',
    model: 'claude-opus-4-6',
    apiKey: process.env.ANTHROPIC_API_KEY,
    // 可选：配置代理或聚合 API
    baseURL: process.env.ANTHROPIC_BASE_URL,
  },
  plugins: [
    '@jackclaw/memory',    // 持久化记忆
    '@jackclaw/watchdog',  // 健康监控
  ],
}
```

### 2. 配置环境变量

创建 `.env` 文件（永远不要提交到版本控制）：

```bash
# .env

# Anthropic API（必填）
ANTHROPIC_API_KEY=sk-ant-api03-...
# 可选：使用代理或聚合 API
ANTHROPIC_BASE_URL=https://api.anthropic.com

# Hub 认证密钥（生产环境必填，建议 32 字节以上随机字符串）
JWT_SECRET=your-very-long-random-secret-here

# Hub 公网地址（如果 Node 需要从外部连接到 Hub）
HUB_PUBLIC_URL=https://hub.yourdomain.com

# 可选：覆盖默认端口
HUB_PORT=3000
```

生成安全的 `JWT_SECRET`：

```bash
# 方法一：openssl
openssl rand -hex 32

# 方法二：Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 3. 设置 Hub URL

Hub URL 决定了 Node 如何找到并连接到 Hub。三种典型场景：

**本地开发**（默认，无需额外配置）：
```bash
HUB_PUBLIC_URL=http://localhost:3000
```

**局域网多机部署**：
```bash
# Hub 在 192.168.1.100 上运行
HUB_PUBLIC_URL=http://192.168.1.100:3000
```

**公网部署**（生产环境，搭配 TLS）：
```bash
# 反向代理（Nginx/Caddy）处理 TLS 终止
HUB_PUBLIC_URL=https://hub.yourdomain.com
```

Node 注册时会自动使用 `HUB_PUBLIC_URL` 连接，无需手动指定。

---

## 常见问题 FAQ

### Q: 端口 3000 已被占用，怎么办？

```bash
# 查看占用端口的进程
lsof -i :3000          # macOS / Linux
netstat -ano | findstr :3000   # Windows

# 方案一：临时更换端口
jackclaw demo --hub-port 3100

# 方案二：修改配置文件
# jackclaw.config.js → hub.port: 3100
```

---

### Q: Node.js 版本不符合要求怎么办？

JackClaw 需要 Node.js v20+。推荐使用 `nvm` 管理多版本：

```bash
# 安装 nvm（macOS / Linux）
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash

# 安装并切换到 Node.js 20 LTS
nvm install 20
nvm use 20
node --version   # 应显示 v20.x.x
```

---

### Q: `jackclaw demo` 启动后 Dashboard 打不开？

1. 确认终端显示 `✓ Hub 已启动`
2. 尝试 `http://127.0.0.1:3000`（替代 `localhost`）
3. 检查浏览器是否拦截本地端口
4. 确认防火墙未阻止 3000 端口

---

### Q: Node 无法连接到 Hub？

```bash
# 检查 Hub 是否在线
curl http://localhost:3000/api/health
# 预期：{"status":"ok","nodes":2}
```

常见原因：
- Hub 尚未启动或已崩溃（查看终端日志）
- Hub 与 Node 使用了不同的 `JWT_SECRET`
- 防火墙阻止端口（多机部署时）
- `HUB_PUBLIC_URL` 地址填写错误

---

### Q: LLM 调用报 `401 Unauthorized`？

```bash
# 验证 API Key 是否有效
curl https://api.anthropic.com/v1/messages \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "content-type: application/json" \
  -d '{"model":"claude-haiku-4-5-20251001","max_tokens":10,"messages":[{"role":"user","content":"hi"}]}'
```

如使用代理：确保 `ANTHROPIC_BASE_URL` 指向正确的代理地址，且代理支持 Anthropic API 格式。

---

### Q: `npm run build` 失败？

```bash
# 清理缓存后重试
npm run clean
npm install
npm run build
```

如果某个包单独报错，可以定位到具体包单独编译调试：

```bash
cd packages/hub
npm run build
```

常见原因：TypeScript 编译错误（检查对应包的 `tsconfig.json`）。

---

## 下一步

- [架构总览](/guide/architecture) — 理解 Hub/Node/CEO 三角协作模型
- [ClawChat 使用指南](/guide/clawchat) — WebSocket 实时通信
- [安全指南](/guide/security) — 生产环境安全配置
- [API 协议参考](/api/protocol) — 接入自定义 Node 或第三方系统
