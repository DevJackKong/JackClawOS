# LLM 接入指南

本文档说明如何为 JackClaw 配置 LLM 提供商，包括免费/低价入门推荐、key 申请步骤和代码调用示例。

---

## 推荐入门方案

| 提供商 | 模型 | 价格 | 适合场景 |
|--------|------|------|----------|
| **智谱 GLM** | `glm-4-flash` | **免费** | 入门体验、开发调试 |
| **DeepSeek** | `deepseek-chat` | ~¥1/百万 token | 生产环境低成本首选 |
| **通义千问** | `qwen-turbo` | ~¥0.3/百万 token | 中文任务，阿里云生态 |
| Anthropic Claude | `claude-haiku-4-5` | $0.80/M | 英文任务，质量最优 |
| Ollama（本地） | `llama3` / `qwen2` | **完全免费** | 离线、隐私敏感场景 |

**新手建议：先用 GLM-4-Flash（免费）跑通流程，再根据需求切换。**

---

## 第一步：申请 API Key

### GLM-4-Flash（免费，推荐新手）

1. 访问 [open.bigmodel.cn](https://open.bigmodel.cn) 注册账号
2. 进入「API Keys」页面，点击「创建 API Key」
3. 复制生成的 key（格式：`xxxxxxxx.xxxxxxxxxx`）

**免费额度**：GLM-4-Flash 完全免费，无需充值。

---

### DeepSeek（低价，推荐生产）

1. 访问 [platform.deepseek.com](https://platform.deepseek.com) 注册
2. 充值最低 ¥10，进入「API Keys」创建 key
3. 复制 key（格式：`sk-xxxxxxxxxxxxxxxx`）

**参考价格**：`deepseek-chat` 输入 ¥1/百万 token，输出 ¥2/百万 token（2024年价格）。

---

### 其他提供商快速入口

| 提供商 | 注册地址 | key 前缀 |
|--------|---------|----------|
| Anthropic Claude | [console.anthropic.com](https://console.anthropic.com) | `sk-ant-` |
| OpenAI | [platform.openai.com](https://platform.openai.com) | `sk-` |
| Google Gemini | [aistudio.google.com](https://aistudio.google.com) | `AIza` |
| 通义千问 | [dashscope.console.aliyun.com](https://dashscope.console.aliyun.com) | `sk-` |
| Moonshot Kimi | [platform.moonshot.cn](https://platform.moonshot.cn) | `sk-` |
| 百川 AI | [platform.baichuan-ai.com](https://platform.baichuan-ai.com) | `sk-` |

---

## 第二步：写入 .env

```bash
# 复制模板
cp .env.example .env
```

编辑 `.env`，填入你的 key：

```env
# ── 免费入门（GLM-4-Flash）────────────────────────────
ZHIPU_API_KEY=your_zhipu_key_here

# ── 低价生产（DeepSeek）──────────────────────────────
DEEPSEEK_API_KEY=sk-your_deepseek_key_here

# ── 按需选填 ─────────────────────────────────────────
ANTHROPIC_API_KEY=sk-ant-your_key_here
OPENAI_API_KEY=sk-your_key_here
GOOGLE_API_KEY=AIza-your_key_here
QWEN_API_KEY=sk-your_qwen_key_here

# ── 本地模型（无需 key）──────────────────────────────
OLLAMA_BASE_URL=http://localhost:11434
```

---

## 第三步：验证配置

```bash
# 启动服务
npm run dev

# 测试 LLM 连通性（新建 test.js 运行）
node -e "
const { createGateway } = require('./packages/llm-gateway/src');
const gw = createGateway({ zhipu: { apiKey: process.env.ZHIPU_API_KEY } });
gw.fast('你好，用一句话介绍自己').then(console.log).catch(console.error);
"
```

预期输出：模型返回的文本回复，无报错即配置成功。

---

## 代码调用示例

### 基础用法：createGateway + chat

```typescript
import { createGateway } from '@jackclaw/llm-gateway'

const gw = createGateway({
  // 只填你有 key 的提供商即可
  zhipu:    { apiKey: process.env.ZHIPU_API_KEY },
  deepseek: { apiKey: process.env.DEEPSEEK_API_KEY },
  anthropic: { apiKey: process.env.ANTHROPIC_API_KEY },
  openai:   { apiKey: process.env.OPENAI_API_KEY },
  ollama:   { baseUrl: process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434' },
})

// 完整调用（指定模型，自动路由到对应提供商）
const response = await gw.chat({
  model: 'glm-4-flash',          // 或 'deepseek-chat', 'gpt-4o-mini', 'claude-haiku-4-5'
  messages: [
    { role: 'system', content: '你是一名专业的代码审查工程师。' },
    { role: 'user',   content: '帮我审查这段代码的安全性...' },
  ],
  temperature: 0.7,
  max_tokens: 1024,
})

console.log(response.choices[0].message.content)
console.log(`耗时: ${response.latencyMs}ms | 花费: $${response.usage.totalTokens}`)
```

### 快捷方法

```typescript
// fast() — 使用最快/最便宜的可用模型
const summary = await gw.fast('用三句话总结以下内容：...')

// smart() — 使用最高质量的可用模型
const analysis = await gw.smart('深度分析这段代码的架构问题...')

// local() — 使用本地 Ollama（免费，无网络请求）
const result = await gw.local('解释什么是递归', 'qwen2')
```

### 流式输出

```typescript
const stream = gw.chatStream({
  model: 'glm-4-flash',
  messages: [{ role: 'user', content: '写一首关于编程的诗' }],
  stream: true,
})

for await (const delta of stream) {
  process.stdout.write(delta.choices[0]?.delta?.content ?? '')
}
```

### 查看费用统计

```typescript
const stats = gw.getStats()
console.log(`总请求数: ${stats.totalRequests}`)
console.log(`总 token 数: ${stats.totalTokens}`)
console.log(`总费用: $${stats.totalCostUsd.toFixed(6)}`)
console.log('各提供商明细:', stats.byProvider)
```

### 估算费用

```typescript
// 在发送请求前估算成本
const cost = gw.estimateCost('gpt-4o', 1000, 500)
console.log(`预计费用: $${cost.toFixed(6)}`)
```

---

## 模型选择参考

| 任务类型 | 推荐模型 | 原因 |
|----------|---------|------|
| 开发调试 | `glm-4-flash` | 免费，速度快 |
| 中文对话 | `deepseek-chat` / `qwen-turbo` | 中文优化，低价 |
| 代码生成 | `deepseek-chat` / `claude-haiku-4-5` | 代码能力强 |
| 复杂推理 | `claude-sonnet-4-6` / `gpt-4o` | 最高质量 |
| 本地/离线 | `llama3` (Ollama) | 完全免费，隐私安全 |
| 长文本 | `moonshot-v1-128k` | 128K 上下文 |

---

## 常见问题

**Q: 填了 key 但提示 401 Unauthorized？**
A: 检查 key 是否包含多余空格，确认 `.env` 已保存并重启服务。

**Q: 想同时配置多个提供商做备用？**
A: `createGateway` 支持传入多个提供商配置，当主提供商失败时自动 fallback。

**Q: 如何查看当前配置了哪些提供商？**
```typescript
console.log(gw.listProviders())  // ['zhipu', 'deepseek', 'ollama']
```

**Q: 如何测试所有提供商的连通性？**
```typescript
const results = await gw.pingAll()
console.log(results)  // { zhipu: true, deepseek: true, ollama: false }
```
