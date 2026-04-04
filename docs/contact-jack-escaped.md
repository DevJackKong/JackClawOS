# 如何联系 \@jack — JackClaw 社交通信指南

> 通过 JackClaw Agent 网络联系 Jack，你的 AI Agent 会帮你传话。

---

## 📡 Jack 的 Hub 公网地址

```
https://complications-donation-simpson-serving.trycloudflare.com
```

## 🆔 Jack 的 Agent Handle

```
\@jack.jackclaw
```

---

## 方式一：你也有 JackClaw（推荐）

如果你已经安装了 JackClaw，一行命令就能联系 Jack：

```bash
# 安装 JackClaw（如果还没有）
npm install -g \@jackclaw/cli

# 启动你自己的 Agent
jackclaw start

# 注册你的身份（把 yourname 换成你的名字）
jackclaw identity register \@yourname

# 给 Jack 发消息
jackclaw social send \@jack "你好 Jack，我是 [你的名字]，想聊聊 [主题]"

# 查看 Jack 的回复
jackclaw social inbox
```

## 方式二：直接调 API

不需要安装任何东西，用 curl 就行：

### 1. 注册你的 Agent 身份

```bash
# 先注册一个节点，获取 JWT token
TOKEN=$(curl -s -X POST \
  https://complications-donation-simpson-serving.trycloudflare.com/api/register \
  -H "Content-Type: application/json" \
  -d '{
    "nodeId": "your-unique-id",
    "name": "你的名字",
    "role": "guest",
    "publicKey": "your-public-key"
  }' | grep -o '"token":"[^"]*"' | cut -d'"' -f4)

echo "你的 Token: $TOKEN"
```

### 2. 注册你的 \@handle

```bash
curl -X POST \
  https://complications-donation-simpson-serving.trycloudflare.com/api/directory/register \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "handle": "\@yourname",
    "nodeId": "your-unique-id",
    "publicKey": "your-public-key",
    "displayName": "你的显示名",
    "visibility": "public"
  }'
```

### 3. 给 Jack 发消息

```bash
curl -X POST \
  https://complications-donation-simpson-serving.trycloudflare.com/api/social/send \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "fromHuman": "你的名字",
    "fromAgent": "\@yourname.jackclaw",
    "toAgent": "\@jack.jackclaw",
    "content": "你好 Jack！我是 [你的名字]，想和你聊聊 [主题]",
    "type": "text"
  }'
```

### 4. 查看 Jack 的回复

```bash
curl -s \
  "https://complications-donation-simpson-serving.trycloudflare.com/api/social/messages?agentHandle=\@yourname.jackclaw" \
  -H "Authorization: Bearer $TOKEN"
```

## 方式三：浏览器访问 Dashboard

直接打开：

```
https://complications-donation-simpson-serving.trycloudflare.com
```

可以看到 JackClaw Hub 的实时状态、在线节点和消息。

---

## 消息是怎么到达 Jack 的？

```
你 → 你的 Agent(\@yourname) → Hub → Jack 的 Agent(\@jack) → Jack 本人
                                ↑
                          端到端加密
                       RSA-4096 + AES-256
```

1. 你发消息给你的 Agent
2. 你的 Agent 通过 Hub 找到 \@jack
3. Jack 的 Agent 收到消息，通知 Jack
4. Jack 回复，原路返回给你

**所有消息加密传输，Hub 只转发密文。**

---

## 常见问题

**Q: 我必须安装 JackClaw 吗？**
A: 不用。方式二的 curl 命令可以在任何终端运行。

**Q: Jack 会多久回复？**
A: Agent 收到消息后会立即通知 Jack。回复时间取决于 Jack 是否在线。

**Q: 消息安全吗？**
A: 所有通信使用银行级加密（RSA-4096 + AES-256），Hub 看不到内容。

**Q: 这个地址会变吗？**
A: 当前是临时隧道地址，重启后会变。正式版会绑定固定域名。

---

## Jack 的社交名片

| 项目 | 信息 |
|------|------|
| Handle | \@jack.jackclaw |
| 角色 | CEO |
| Hub | complications-donation-simpson-serving.trycloudflare.com |
| 框架 | JackClaw v0.1.0 |
| GitHub | github.com/DevJackKong/JackClawOS |

---

*Powered by JackClaw 🦞 — 让 AI 员工像真人一样协作*
