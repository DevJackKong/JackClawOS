# 安全指南

JackClaw 采用多层纵深防御架构，将 AI 的自主执行能力约束在安全边界内。

---

## 加密原理

### 传输层加密

所有 Hub ↔ Node 通信均通过 TLS 1.3 加密：

```
Node                     Hub
 │   TLS 1.3 Handshake   │
 │──────────────────────>│
 │   Certificate         │
 │<──────────────────────│
 │   Encrypted Channel   │
 │<═════════════════════>│
```

**生产环境 TLS 配置**（推荐 Nginx 反向代理）：

```nginx
# /etc/nginx/sites-available/jackclaw-hub
server {
    listen 443 ssl http2;
    server_name hub.yourdomain.com;

    ssl_certificate     /etc/letsencrypt/live/hub.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/hub.yourdomain.com/privkey.pem;
    ssl_protocols       TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }
}
```

### 消息完整性

所有 WebSocket 消息携带 HMAC-SHA256 签名，防止中间人篡改：

```typescript
import { createHmac } from 'crypto'

function signMessage(payload: object, secret: string): string {
  const body = JSON.stringify(payload)
  return createHmac('sha256', secret).update(body).digest('hex')
}

// 消息结构
const msg = {
  type: 'task.complete',
  payload: { task_id: 'abc', result: '...' },
  sig: signMessage(payload, JWT_SECRET)  // Hub 验签
}
```

### payment-vault 凭证隔离

支付凭证（API Key、银行账户等）运行在独立进程中，AI Agent 无法直接访问：

```
┌─────────────────────────────────────────────┐
│  Node 进程（AI 执行环境）                    │
│                                             │
│  ❌ process.env.PAYMENT_API_KEY  → 不可见   │
│  ❌ 文件系统读取 vault 目录      → 权限拒绝  │
│                                             │
│  ✅ vault.request('pay', { amount: 100 })  │
│     ↓ IPC（UNIX Socket）                   │
└──────────────────────┬──────────────────────┘
                       │ 仅允许声明式请求
                       ▼
┌─────────────────────────────────────────────┐
│  payment-vault 进程（独立隔离）              │
│                                             │
│  • 持有真实凭证                              │
│  • 记录所有请求日志                          │
│  • 超过金额阈值 → 自动触发 HITL             │
│  • 独立审计日志（不可篡改）                  │
└─────────────────────────────────────────────┘
```

---

## JWT 认证

### Token 结构

JackClaw 使用 HS256（HMAC-SHA256）签名的 JWT：

```json
{
  "header": {
    "alg": "HS256",
    "typ": "JWT"
  },
  "payload": {
    "sub": "node-abc123",       // Node ID
    "role": "worker",           // 角色：worker / coordinator / admin
    "groups": ["frontend"],     // 所属群组
    "iat": 1712345600,          // 签发时间
    "exp": 1712432000,          // 过期时间（默认 24h）
    "jti": "uuid-v4"            // 唯一 ID（防重放）
  }
}
```

### 生成 Token

```bash
# 命令行（推荐用于生产环境）
jackclaw token generate \
  --node-id my-node \
  --role worker \
  --ttl 24h \
  --secret $JWT_SECRET

# Node.js SDK
import { signToken } from '@jackclaw/protocol'

const token = signToken({
  nodeId: 'my-node',
  role: 'worker',
  groups: ['backend'],
}, process.env.JWT_SECRET!, { expiresIn: '24h' })
```

### 生成安全的 JWT_SECRET

```bash
# 推荐：32 字节（256 位）随机字符串
openssl rand -hex 32

# 或 Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# 输出示例（请勿使用此示例值）
# a3f8c2e1d4b7a9f0e2c5b8d1a4f7e0c3b6a9d2f5e8c1b4a7f0e3c6b9a2d5f8
```

**安全要求**：
- 最短 32 字节（256 位）
- 使用加密安全的随机源生成
- 永远不要提交到版本控制
- 生产环境通过密钥管理服务（KMS/Vault）注入

### Token 轮换

```bash
# 轮换 JWT_SECRET（零停机）
# 1. 更新 Hub 配置，添加新 secret 到接受列表
JWT_SECRET=new-secret
JWT_SECRET_LEGACY=old-secret  # 过渡期保留

# 2. 所有 Node 重新生成 Token（使用新 secret）
jackclaw token generate --secret $JWT_SECRET ...

# 3. 确认所有 Node 已重连后，移除 JWT_SECRET_LEGACY
```

---

## Human-in-Loop（HITL）

### 工作原理

HITL 是 JackClaw 最重要的安全机制：AI 在执行高风险操作前自动暂停，等待人类确认。

```
CEO (harness)
    │
    │ 检测到高风险操作
    ▼
┌──────────────────────────────────────────┐
│  HITL 请求                               │
│                                          │
│  操作：删除 `src/auth/` 目录             │
│  风险：不可逆，影响 23 个文件            │
│                                          │
│  [✅ 批准]  [✏️ 修改]  [❌ 拒绝]         │
└──────────────────────────────────────────┘
    │
    ▼ 用户选择
Hub 收到 hitl.response
    │
    ├─ approve → 继续执行
    ├─ modify  → CEO 重新规划
    └─ reject  → 任务标记为 cancelled
```

### 触发条件配置

```typescript
// jackclaw.config.js
export default {
  hitl: {
    // 启用 HITL（生产环境强烈建议 true）
    enabled: true,

    // 触发规则（任一匹配即触发）
    triggers: {
      // 文件系统
      fs: {
        delete: true,           // 任何删除操作
        overwrite_core: true,   // 覆盖核心配置文件
        size_threshold: 10_000, // 单次写入超过 10KB
      },
      // 网络 / 外部
      network: {
        public_write: true,     // 推送到 GitHub、发布 npm
        email_send: true,       // 发送邮件
        webhook_post: true,     // 调用外部 Webhook
      },
      // 资金
      payment: {
        any: true,              // 任何支付操作
        threshold: 0,           // 金额阈值（0 = 始终触发）
      },
      // 系统
      system: {
        sudo: true,             // sudo 命令
        env_modify: true,       // 修改环境变量
        process_kill: true,     // 杀死其他进程
      },
      // 数据库
      database: {
        drop: true,             // DROP TABLE / DATABASE
        bulk_delete: 100,       // 批量删除超过 100 行
      },
    },

    // 审批通知渠道
    notify: {
      terminal: true,           // 终端交互式确认
      slack_webhook: process.env.SLACK_HITL_WEBHOOK,
      email: process.env.HITL_EMAIL,
    },

    // 等待超时（超时自动拒绝）
    timeout: 300_000,  // 5 分钟
  }
}
```

### 在代码中声明 HITL 点

自定义 Node 可以主动声明 HITL 等待点：

```typescript
import { requestHITL } from '@jackclaw/harness'

async function dangerousOperation() {
  const approval = await requestHITL({
    action: '清空生产数据库',
    risk: 'critical',
    details: '将删除 orders 表全部 50,000 条记录',
    reversible: false,
  })

  if (!approval.approved) {
    throw new Error('操作已被用户拒绝')
  }

  // 执行实际操作
  await db.query('DELETE FROM orders')
}
```

---

## Watchdog 监控

Watchdog 是 JackClaw 的健康守护进程，负责异常检测、自动恢复和告警推送。

### 监控指标

| 指标 | 阈值（默认）| 触发动作 |
|------|-------------|---------|
| Node 心跳缺失 | > 30s | 标记为离线，重广播其任务 |
| 任务执行超时 | > 配置值 | 标记 failed，可选重试 |
| Hub 内存使用 | > 80% | 告警推送 |
| Hub CPU | > 90%（持续 60s）| 告警推送 |
| 错误率 | > 10%（滑动窗口）| 熔断 + 告警 |
| JWT 验证失败 | > 5 次/分钟 | 封禁来源 IP（10 分钟）|

### 配置 Watchdog

```typescript
// jackclaw.config.js
export default {
  plugins: ['@jackclaw/watchdog'],

  watchdog: {
    // 心跳超时
    heartbeat_timeout: 30_000,

    // 自动重启异常退出的 Node
    auto_restart: {
      enabled: true,
      max_attempts: 3,
      backoff: 'exponential',
    },

    // 告警通知
    alerts: {
      slack: process.env.SLACK_ALERT_WEBHOOK,
      // PagerDuty（可选）
      pagerduty: process.env.PD_INTEGRATION_KEY,
    },

    // 健康检查端点
    health_endpoint: '/api/health',
    // 指标端点（Prometheus 格式）
    metrics_endpoint: '/api/metrics',
  }
}
```

### 健康检查端点

```bash
# 简单健康检查
curl http://localhost:3000/api/health
# 响应：
# { "status": "ok", "nodes": 3, "tasks_pending": 2, "uptime": 86400 }

# 详细指标（Prometheus 格式）
curl http://localhost:3000/api/metrics
# jackclaw_nodes_online 3
# jackclaw_tasks_pending 2
# jackclaw_tasks_completed_total 1523
# jackclaw_tasks_failed_total 12
# jackclaw_hub_memory_bytes 45678912
```

### 自动熔断

当某个 Node 连续失败超过阈值，Watchdog 自动触发熔断：

```
Node-X 连续失败 5 次
    │
    ▼
Watchdog 熔断 Node-X
    ├─ 停止向 Node-X 广播新任务
    ├─ 重广播 Node-X 持有的任务
    ├─ 推送告警
    └─ 30s 后尝试半开（探测恢复）
```

---

## 安全最佳实践检查清单

**部署前请确认：**

- [ ] `JWT_SECRET` 使用 32 字节以上随机值
- [ ] `.env` 已加入 `.gitignore`
- [ ] 生产环境启用 TLS（`HUB_PUBLIC_URL` 使用 `https://`）
- [ ] `hitl.enabled = true`（生产环境）
- [ ] `payment-vault` 独立进程已启动
- [ ] `watchdog` 插件已启用
- [ ] 告警通知渠道已配置（Slack / PagerDuty）
- [ ] Node 使用最小权限运行（非 root）
- [ ] 定期轮换 `JWT_SECRET`（建议 90 天）
- [ ] 审计日志已持久化到不可篡改存储

---

## 下一步

- [架构总览](/guide/architecture) — 分层安全模型详解
- [ClawChat 使用指南](/guide/clawchat) — WebSocket 认证流程
- [API 协议参考](/api/protocol) — 消息签名规范
