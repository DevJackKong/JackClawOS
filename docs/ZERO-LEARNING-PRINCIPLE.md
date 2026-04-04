# OpenClaw 用户零学习迁移原则

> 核心：用户不需要知道 JackClaw 存在，就已经在用它了。

## 一、硬指标

| # | 指标 | 验收标准 |
|---|------|----------|
| 1 | **命令名看着就懂** | send / ask / status / who / inbox，不发明新词 |
| 2 | **默认输出是人话** | 不丢协议细节，只说结果 |
| 3 | **5 分钟首次联通** | 安装 → 起 Hub → 连 Node → 发第一条消息 |
| 4 | **不用先理解架构** | 边用边懂，不是先上课再用 |

## 二、命令映射

### 2.1 CLI 命令 — 沿用 OpenClaw 心智模型

```bash
# OpenClaw 用户已经会的        # JackClaw 对应命令（一样的词）
openclaw status               jackclaw status
openclaw agent                jackclaw agent
openclaw node                 jackclaw node

# 消息
jackclaw send @bob "你好"      # 不叫 dispatch / emit / transmit
jackclaw ask @bob "明天有空吗"  # 像 openclaw 的 ask，只是目标是别人的 Agent
jackclaw inbox                 # 查看未读消息

# 身份
jackclaw who                   # 查看我是谁
jackclaw who @bob              # 查看 bob 的信息
jackclaw contacts              # 查看联系人列表

# 状态
jackclaw status                # 我的 Hub / Node / 在线状态
jackclaw status @bob           # bob 是否在线

# 记忆
jackclaw memory                # 沿用 openclaw memory 概念
```

### 2.2 绝不出现的命令

```bash
# ❌ 不要这样
jackclaw federation:handshake --peer https://hub2.example.com
jackclaw protocol:ack --message-id xxx --level delivery
jackclaw queue:drain --target @bob
jackclaw presence:set --status online --channels ws,http

# ✅ 要这样
jackclaw connect hub2.example.com    # 连接另一个 Hub（底层做联邦握手）
jackclaw send @bob "你好"             # 底层自动处理 ACK/重试/路由
```

## 三、输出文案规范

### 3.1 消息发送状态 — 人话版

```bash
$ jackclaw send @bob "明天开会"

# ✅ 正常
✓ 已发送，对方已确认收到

# ✅ 对方离线
✓ 已发送，对方当前不在线，上线后自动送达

# ✅ 失败
✗ 发送失败：找不到 @bob，请检查名称是否正确
✗ 发送失败：对方不可达，已加入重试队列（下次尝试：30秒后）
✗ 发送失败：你还没有连接到任何 Hub，请先运行 jackclaw start
```

### 3.2 绝不出现的输出

```bash
# ❌ 
status=failed reason=DELIVERY_ACK_TIMEOUT attempts=3 
  route=presence_fallback pending_requeue=true
  lastAttempt=1712345600120 nextRetry=1712345630120

# ❌
Error: FederationHandshakeError: RSA signature verification 
  failed for hub peer https://hub2.example.com
  at FederationManager.verifyHandshake (federation.ts:142)
```

### 3.3 详细信息用 verbose 模式

```bash
# 默认：人话
$ jackclaw send @bob "你好"
✓ 已发送，对方已确认收到

# 加 -v：才显示技术细节
$ jackclaw send @bob "你好" -v
✓ 已发送，对方已确认收到
  消息ID: msg_abc123
  路由: @jack → hub.jackclaw.ai → @bob
  状态: accepted(0ms) → sent(12ms) → delivered(85ms) → acked(120ms)
  加密: RSA-4096 + AES-256-GCM
```

## 四、默认行为设计

### 4.1 本地优先，开箱即用

```bash
# 安装
npm install -g jackclaw

# 启动（自动做所有初始化）
jackclaw start
# → 自动起 Hub（本地）
# → 自动注册本地 Node
# → 自动发现本地模型（Ollama）
# → 自动生成身份（@jack.local）
# → 自动开启 Dashboard

# 第一条消息
jackclaw send @jack "测试"     # 给自己发
# ✓ 已发送，已确认收到（本地回环）

# 完成。5分钟内。
```

### 4.2 渐进式复杂度

```
Level 0: jackclaw start → jackclaw send → 能用了
  用户需要知道的概念：0 个

Level 1: 连接远程 Hub → 给别人发消息
  用户需要知道的概念：1 个（Hub 地址）

Level 2: 自定义 handle → 管理联系人 → 群聊
  用户需要知道的概念：2 个（handle, 联系人）

Level 3: 联邦 → 跨 Hub → 自定义 Plugin
  用户需要知道的概念：按需了解
```

### 4.3 智能默认值

```ts
// 用户不需要配置这些（系统自动处理）
const SMART_DEFAULTS = {
  // 身份：自动用系统用户名
  handle: `@${os.userInfo().username}.local`,
  
  // Hub：默认本地
  hubUrl: 'http://localhost:3100',
  
  // 模型：自动发现 Ollama → 回退到配置的 API
  llm: 'auto',
  
  // 加密：默认开启
  encryption: true,
  
  // 重试：默认开启，用户不需要知道
  retry: true,
  
  // 离线队列：默认开启
  offlineQueue: true,
  
  // ACK：默认开启
  ack: true,
  
  // 所有这些用户看不到，只看到"消息发了，收到了"
}
```

## 五、兼容 OpenClaw 生态

### 5.1 模型兼容

```bash
# OpenClaw 用户已经配置好的模型，JackClaw 直接用
# 不要求重新配置

# 支持 OpenAI-compatible API（Ollama, vLLM, LiteLLM...）
# 支持 Anthropic API
# 支持 OpenClaw 的 model alias 体系
```

### 5.2 身份兼容

```bash
# 可以用 nodeId 发（OpenClaw 风格）
jackclaw send node-abc123 "你好"

# 也可以用 @handle 发（JackClaw 风格）
jackclaw send @bob "你好"

# 系统自动识别，不报错
```

### 5.3 配置兼容

```yaml
# JackClaw 的配置文件格式尽量贴近 OpenClaw
# ~/.jackclaw/config.yaml

hub:
  port: 3100
  
node:
  name: "我的节点"
  
models:
  default: "ollama/llama3"
  
# 而不是发明全新的配置结构
```

### 5.4 Skill 兼容

```bash
# OpenClaw Skill 在 JackClaw 环境下直接可用
# 不需要改写、不需要适配
# SKILL.md 格式一样
```

## 六、概念映射表

让 OpenClaw 用户一眼看懂 JackClaw 每个概念：

| OpenClaw 概念 | JackClaw 对应 | 说明 |
|---------------|--------------|------|
| Gateway | Hub | "你的 Agent 的家" |
| Node | Node | 一样 |
| Channel | Channel | 一样，飞书/Discord/TG |
| Agent | Agent | 一样 |
| Session | Thread | 对话线程 |
| Skill | Skill | 一样 |
| Memory | Memory | 一样 |
| SubAgent | Collaborator | "帮手"（其他人的 Agent） |
| — | Handle | "你的 AI 名片" |
| — | Hub | "Agent 的联网中心" |

只有 2 个新概念：**Handle**（名片）和 **Hub**（联网中心）。其他全是 OpenClaw 用户已经知道的词。

## 七、5 分钟联通剧本

```
0:00  npm install -g jackclaw
0:30  jackclaw start
        → ✓ Hub 已启动 (localhost:3100)
        → ✓ 本地 Node 已连接
        → ✓ 你的身份: @jack.local
        → ✓ Dashboard: http://localhost:3100
1:00  jackclaw send @jack "Hello"
        → ✓ 已发送，已确认收到
1:30  jackclaw status
        → Hub: 在线 (localhost:3100)
        → Node: 在线 (1 个)
        → 消息: 今日 1 条
        → 模型: ollama/llama3 (自动发现)
2:00  （可选）连接远程
      jackclaw connect hub.example.com
        → ✓ 已连接 hub.example.com
      jackclaw send @bob "你好"
        → ✓ 已发送，对方已确认收到
```

## 八、渐进式揭示原则

```
用户问"怎么发消息"    → jackclaw send @bob "内容"
用户问"消息到了吗"    → 自动显示状态图标
用户问"为什么失败"    → 显示人话原因
用户问"重试机制"      → jackclaw send -v ... 看详情
用户问"底层协议"      → 读文档 docs/protocol/

从上到下，99% 的用户停在前两层就够了。
```

## 九、文案风格指南

### 做

- ✓ 已发送
- ✓ 对方已确认收到
- ✓ 对方不在线，上线后自动送达
- ✓ 发送失败：找不到这个人
- ✓ Hub 已启动
- ✓ 已连接

### 不做

- ✗ ACK received from node-abc123
- ✗ Message enqueued to offline_queue with TTL=604800000ms
- ✗ FederationHandshake completed with peer
- ✗ RSA-4096 signature verified
- ✗ WebSocket connection established on /chat/ws
- ✗ Delivery status: DELIVERY_ACK_TIMEOUT after 3000ms

### 错误信息

```
✗ 发送失败：找不到 @bob
  → 确认名称是否正确，或让对方先加你

✗ 发送失败：无法连接到 Hub
  → 检查网络，或运行 jackclaw status 查看状态

✗ 发送失败：对方不可达
  → 消息已保存，对方上线后自动送达
```

## 十、一句话

> **最好的基础设施是用户感知不到的。用户只知道"消息发了，收到了，没收到会告诉我为什么"。至于 ACK、重试、联邦、加密——那是我们的事，不是用户的事。**
