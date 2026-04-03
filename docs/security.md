# JackClaw 安全模型

## 设计原则

1. **最小披露**：节点只向 Hub 发送必要的摘要，不发送原始上下文
2. **零信任节点**：Hub 不信任任何未认证的节点请求
3. **本地数据主权**：原始数据永远不离开节点本机
4. **可审计**：所有跨节点通信都有签名和日志

---

## 认证机制

### JWT 认证流程

```
Node 启动时：
  1. 读取 NODE_ID（或自动生成）
  2. 向 Hub POST /api/auth/register { nodeId, publicKey }
  3. Hub 返回 accessToken（JWT, RS256, 有效期 24h）
  4. Node 后续所有请求携带 Authorization: Bearer <token>

Token 刷新：
  - 到期前 1h 自动刷新（/api/auth/refresh）
  - 刷新失败则节点进入离线模式，本地功能不受影响
```

### JWT Payload 结构

```json
{
  "sub": "node-id-abc123",
  "name": "alice-macbook",
  "role": "member",
  "iat": 1700000000,
  "exp": 1700086400,
  "iss": "jackclaw-hub"
}
```

### 密钥管理

- Hub 使用 `HUB_JWT_SECRET` 签名（HS256，简单部署）
- 生产建议：切换到 RSA 密钥对（RS256），Hub 持有私钥，公钥对外可查
- 节点密钥存储在 `~/.jackclaw/node/keys/`，不随代码提交

---

## 数据分级

| 级别 | `REPORT_VISIBILITY` | 发送内容 |
|------|---------------------|----------|
| 私有 | `private` | 不发送任何内容 |
| 摘要 | `summary_only` | 任务标题、状态、完成数 |
| 完整 | `full` | 完整任务描述、输出（需明确开启）|

默认值：`summary_only`。切换为 `full` 需要节点本地明确配置，Hub 无法远程更改。

---

## 传输安全

### 生产部署要求

```nginx
# Nginx 反代示例
server {
    listen 443 ssl http2;
    server_name hub.yourdomain.com;

    ssl_certificate     /etc/ssl/certs/hub.crt;
    ssl_certificate_key /etc/ssl/private/hub.key;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;

    location / {
        proxy_pass http://localhost:19001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }
}
```

- 节点 `HUB_URL` 必须使用 `https://`
- 开发模式下可用 `http://localhost:19001`，但会打印安全警告

---

## 访问控制

### 角色定义

| 角色 | 权限 |
|------|------|
| `owner` | 查看所有节点报告，分发任务，管理节点 |
| `member` | 查看自己的报告，接收任务，查看团队摘要 |
| `guest` | 只能查看公开摘要，不能接收任务 |

### Hub API 权限矩阵

| Endpoint | owner | member | guest |
|----------|-------|--------|-------|
| GET /api/reports | ✅ 全部 | ✅ 自己 | ❌ |
| POST /api/tasks | ✅ | ❌ | ❌ |
| GET /api/nodes | ✅ | ✅ 列表 | ❌ |
| DELETE /api/nodes/:id | ✅ | ❌ | ❌ |

---

## 威胁模型

### 已覆盖威胁

| 威胁 | 缓解措施 |
|------|----------|
| 未授权节点接入 | JWT 认证，注册需要 Hub 审批 |
| 中间人攻击 | 生产强制 TLS，证书固定可选 |
| Hub 数据泄露 | Hub 只存摘要，无原始上下文 |
| 令牌泄露 | 短有效期（24h）+ 刷新机制 |
| 恶意任务注入 | 节点本地执行沙箱，危险操作需二次确认 |

### 已知局限

- Hub 是中心化组件，需要自行保证 Hub 服务器安全
- WebSocket 长连接在网络中断时有重连窗口
- 汇报内容加密（端对端）暂未实现（路线图中）

---

## 安全建议

```bash
# 生成强 JWT Secret
openssl rand -base64 48

# 生产部署前检查清单
[ ] HUB_JWT_SECRET 已替换默认值
[ ] Hub 已配置 TLS
[ ] NODE_ROLE 已正确设置
[ ] Hub 服务器防火墙只开放 443/19001
[ ] ~/.jackclaw/ 目录权限为 700
[ ] 定期轮换 JWT Secret（建议每 90 天）
```
