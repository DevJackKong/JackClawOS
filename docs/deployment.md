# 部署指南

本文档说明如何通过 Docker 或 Linux systemd 部署 JackClaw。

---

## 方案一：Docker 部署（推荐）

### 前置条件

- Docker 20.10+
- Docker Compose v2+

```bash
docker --version    # Docker version 20.10+
docker compose version  # Docker Compose version v2+
```

### 快速启动

```bash
# 1. 克隆项目
git clone https://github.com/DevJackKong/JackClawOS.git
cd JackClawOS

# 2. 复制并编辑环境变量
cp .env.example .env
# 填入你的 LLM API Key（至少填一个）
nano .env

# 3. 创建数据目录
mkdir -p ~/.jackclaw/hub ~/.jackclaw/node

# 4. 启动全栈
docker compose -f docker/docker-compose.yml up -d

# 5. 查看运行状态
docker compose -f docker/docker-compose.yml ps
```

服务启动后：
- Hub：`http://localhost:3100`
- Node：`http://localhost:19000`
- Dashboard：`http://localhost:3100`

### 查看日志

```bash
# 所有服务日志
docker compose -f docker/docker-compose.yml logs -f

# 单个服务
docker compose -f docker/docker-compose.yml logs -f jackclaw-hub
docker compose -f docker/docker-compose.yml logs -f jackclaw-node
```

### 停止 / 重启

```bash
# 停止（保留数据）
docker compose -f docker/docker-compose.yml down

# 重启单个服务
docker compose -f docker/docker-compose.yml restart jackclaw-hub

# 完全清理（删除容器和 volume）
docker compose -f docker/docker-compose.yml down -v
```

### 生产环境注意事项

1. **修改默认密钥**：编辑 `.env`，设置强密码：
   ```env
   HUB_JWT_SECRET=your-very-long-random-secret-here
   JACKCLAW_SYNC_SECRET=another-long-random-secret
   ```

2. **关闭 hot-reload**：生产环境去掉 `docker-compose.yml` 中的 `src:/app/src:ro` 挂载

3. **配置反向代理**：在 Hub 前放 Nginx，启用 HTTPS

4. **限制端口暴露**：生产环境不建议直接暴露 Node 端口（19000），通过 Hub 路由

---

## 方案二：Linux systemd 服务

适合直接在服务器上运行（无 Docker），使用 `pm2` 或原生 systemd。

### 前置条件

```bash
# Node.js 20+
node --version  # v20.x.x

# 编译项目
git clone https://github.com/DevJackKong/JackClawOS.git /opt/jackclaw
cd /opt/jackclaw
npm install
npm run build
cp .env.example .env
# 编辑 .env 填入 key
```

### Hub 服务（systemd unit）

创建 `/etc/systemd/system/jackclaw-hub.service`：

```ini
[Unit]
Description=JackClaw Hub — 中央协调服务
After=network.target
Wants=network-online.target

[Service]
Type=simple
User=jackclaw
WorkingDirectory=/opt/jackclaw
EnvironmentFile=/opt/jackclaw/.env
ExecStart=/usr/bin/node packages/hub/dist/index.js
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

# 资源限制（可选）
LimitNOFILE=65535
MemoryMax=512M

[Install]
WantedBy=multi-user.target
```

### Node 服务（systemd unit）

创建 `/etc/systemd/system/jackclaw-node.service`：

```ini
[Unit]
Description=JackClaw Node — AI 工作节点
After=network.target jackclaw-hub.service
Wants=jackclaw-hub.service

[Service]
Type=simple
User=jackclaw
WorkingDirectory=/opt/jackclaw
EnvironmentFile=/opt/jackclaw/.env
Environment=NODE_NAME=prod-node
Environment=JACKCLAW_HUB_URL=http://localhost:3100
ExecStart=/usr/bin/node packages/node/dist/index.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

LimitNOFILE=65535
MemoryMax=1G

[Install]
WantedBy=multi-user.target
```

### 启动 systemd 服务

```bash
# 创建专用用户（可选，推荐）
sudo useradd -r -s /bin/false jackclaw
sudo chown -R jackclaw:jackclaw /opt/jackclaw

# 重载 systemd
sudo systemctl daemon-reload

# 启用开机自启
sudo systemctl enable jackclaw-hub jackclaw-node

# 启动服务
sudo systemctl start jackclaw-hub
sleep 3
sudo systemctl start jackclaw-node

# 查看状态
sudo systemctl status jackclaw-hub
sudo systemctl status jackclaw-node
```

### 查看日志（journalctl）

```bash
# 实时日志
sudo journalctl -u jackclaw-hub -f
sudo journalctl -u jackclaw-node -f

# 最近 100 行
sudo journalctl -u jackclaw-hub -n 100

# 今日日志
sudo journalctl -u jackclaw-hub --since today
```

---

## 环境变量完整参考

部署时 `.env` 的关键配置：

```env
# ── 网络 ────────────────────────────────────────────
HUB_PORT=3100
NODE_PORT=19000
JACKCLAW_HUB_URL=http://localhost:3100

# ── 安全（生产环境务必修改）────────────────────────
HUB_JWT_SECRET=change-this-to-a-random-64-char-string
JACKCLAW_SYNC_SECRET=change-this-too

# ── Node 标识 ─────────────────────────────────────
JACKCLAW_NODE_ID=prod-node-1
NODE_NAME=生产节点

# ── LLM（至少配置一个）────────────────────────────
ZHIPU_API_KEY=your_key          # 免费，推荐入门
DEEPSEEK_API_KEY=sk-your_key    # 低价，推荐生产
ANTHROPIC_API_KEY=sk-ant-...    # 最高质量

# ── 存储 ─────────────────────────────────────────
JACKCLAW_DB_PATH=/var/data/jackclaw/memory.db
JACKCLAW_MEMORY_DIR=/var/data/jackclaw/memory

# ── 日志 ─────────────────────────────────────────
LOG_LEVEL=info   # debug | info | warn | error
```

---

## 健康检查

```bash
# Hub 健康端点
curl http://localhost:3100/health

# Node 健康端点
curl http://localhost:19000/health

# Docker 容器健康状态
docker inspect jackclaw-hub --format='{{.State.Health.Status}}'
```

---

## 升级

```bash
# Docker 部署升级
git pull
docker compose -f docker/docker-compose.yml build
docker compose -f docker/docker-compose.yml up -d

# systemd 部署升级
git pull
npm install
npm run build
sudo systemctl restart jackclaw-hub jackclaw-node
```
