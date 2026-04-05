# Changelog

## [0.2.0] - 2026-04-05

### 🚀 Features
- ClawChat 实时通信系统（WebSocket + REST）
- Dashboard Chat UI（Markdown 渲染 + 图片附件）
- OpenClaw 插件一行接入
- 群组聊天（创建/加入/发送）
- 用户发现（在线列表 + 搜索）
- 自动注册 + JWT 认证
- 断线自动重连 + 离线消息补发
- 移动端响应式 CSS（3 断点 + 底部 Tab）
- LLM Gateway 统一模型网关（8+ 厂商）
- VitePress 文档站

### 🔒 Security
- 端到端加密（RSA-2048 + AES-256-GCM）
- JWT 算法锁定（HS256）
- 密码哈希（crypto.scrypt + 随机 salt）
- 分级限流（登录/注册/消息）
- Watchdog 安全监控 + 审计日志

### 🏗 Architecture
- 15 个独立包，39,000+ 行 TypeScript
- Hub-Spoke + P2P 混合架构
- TaskBundle 强弱束协议
- Human-in-the-Loop 审批（7 种触发器）
- Federation 联邦协议
- PaymentVault 支付保险柜

### ✅ Testing
- 286 项 E2E 测试全通
- Core E2E: 153 项
- Auth E2E: 38 项
- Social E2E: 95 项
- 断线重连 E2E

### 📦 Packages

| Package | Version |
|---------|---------|
| `@jackclaw/cli` | 0.2.0 |
| `@jackclaw/create` | 0.2.0 |
| `@jackclaw/dashboard` | 0.2.0 |
| `@jackclaw/harness` | 0.2.0 |
| `@jackclaw/hub` | 0.2.0 |
| `@jackclaw/sdk` | 0.2.0 |
| `@jackclaw/llm-gateway` | 0.2.0 |
| `@jackclaw/memory` | 0.2.0 |
| `@jackclaw/node` | 0.2.0 |
| `@jackclaw/openclaw-plugin` | 0.2.0 |
| `@jackclaw/payment-vault` | 0.2.0 |
| `@jackclaw/protocol` | 0.2.0 |
| `@jackclaw/tunnel` | 0.2.0 |
| `@jackclaw/watchdog` | 0.2.0 |
| `pwa` | 0.2.0 |

---

## [0.1.0] - 2026-03-31

Initial release with 14 packages:
- Protocol (RSA-4096 + AES-256 encryption)
- Hub (REST + WebSocket orchestrator)
- Node (AI agent worker)
- CLI, LLM Gateway, Memory, SDK, Dashboard, Watchdog
- Payment Vault, Harness, Tunnel, OpenClaw Plugin, create-jackclaw
