# 快速开始

本文基于仓库中的 `README.md` 与 `QUICKSTART.md` 整理。

## 1. 环境要求

- Node.js `>= 20`
- npm `>= 10`

## 2. 安装依赖并构建

```bash
git clone https://github.com/DevJackKong/JackClawOS.git
cd JackClawOS
npm install
npm run build
```

## 3. 运行 Demo

最快方式：

```bash
npx jackclaw demo
```

仓库内开发方式：

```bash
npm install
npm run build
npx jackclaw demo
```

Demo 会自动启动：

- 1 个 Hub
- 3 个 AI Node
- Dashboard
- ClawChat / 任务分发 / 汇报链路

默认端口：

- Hub: `3100`
- Node: `19000+`

## 4. 手动启动

### 启动 Hub

```bash
HUB_PORT=3100 JWT_SECRET=my-secret node packages/hub/dist/index.js
```

### 启动 Node

```bash
JACKCLAW_HUB_URL=http://localhost:3100 node packages/node/dist/index.js
```

### 开发模式

```bash
npm run dev
```

## 5. 访问 Dashboard

```text
http://localhost:3100
http://localhost:3100/app/
http://localhost:3100/health
```

## 6. 使用 CLI

### 启动服务

```bash
jackclaw start --role hub
jackclaw start --role node --name "engineer-alex"
```

### 发消息

```bash
jackclaw chat --to alice --hub http://localhost:3100
jackclaw chat @alice 你好
```

### 提交任务

```bash
jackclaw ask "总结今天的工作"
jackclaw task run "帮我写一个登录页" --type code
```

## 7. 接入 OpenClaw

将插件写入 `~/.openclaw/openclaw.yaml`：

```yaml
plugins:
  entries:
    jackclaw:
      path: "@jackclaw/openclaw-plugin"
      config:
        hubUrl: "http://localhost:3100"
      notifyTo: "your-open-id"
      notifyChannel: "feishu"
```

然后重启：

```bash
openclaw gateway restart
```

## 8. 常用环境变量

| 变量 | 说明 | 默认值 |
| --- | --- | --- |
| `HUB_PORT` | Hub 监听端口 | `3100` |
| `PORT` | 云平台端口，优先于 `HUB_PORT` | - |
| `JWT_SECRET` | JWT 签名密钥 | 自动生成或 `jackclaw-secret` |
| `HUB_URL` | Hub 对外 URL | `http://localhost:3100` |
| `JACKCLAW_HUB_URL` | Node 连接的 Hub 地址 | `https://hub.jackclaw.ai` |
| `JACKCLAW_CEO_TOKEN` | CEO token | - |
| `JACKCLAW_NODE_ID` | 当前节点 ID | `openclaw-user` |

## 9. 本地运行文档站

```bash
npm run docs:dev
```

构建静态站：

```bash
npm run docs:build
```
