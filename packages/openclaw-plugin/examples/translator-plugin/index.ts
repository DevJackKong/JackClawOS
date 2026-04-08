import { definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry'
import type {
  OpenClawPluginCommandDefinition,
  PluginCommandContext,
} from 'openclaw/plugin-sdk/plugin-entry'

function reply(text: string) {
  return { text }
}

function buildPrompt(text: string, targetLanguage?: string): string {
  if (targetLanguage === 'zh') {
    return `把下面内容翻译成中文，只返回译文：\n\n${text}`
  }
  if (targetLanguage === 'en') {
    return `Translate the following text into English. Return the translation only:\n\n${text}`
  }
  return `你是一个中英翻译助手。自动判断输入语言，并在中文和英文之间互译。只返回译文，不要解释：\n\n${text}`
}

function parseArgs(raw: string): { targetLanguage?: 'zh' | 'en'; text: string } {
  const trimmed = raw.trim()
  if (!trimmed) return { text: '' }

  const explicit = trimmed.match(/^--to\s+(zh|en)\s+([\s\S]+)$/i)
  if (explicit) {
    return {
      targetLanguage: explicit[1].toLowerCase() as 'zh' | 'en',
      text: explicit[2].trim(),
    }
  }

  return { text: trimmed }
}

async function callGateway(prompt: string, api: { config?: unknown }): Promise<string> {
  const config = (api.config ?? {}) as Record<string, unknown>
  const plugins = (config.plugins ?? {}) as Record<string, unknown>
  const entries = (plugins.entries ?? {}) as Record<string, unknown>
  const section = (entries['translator-example'] ?? plugins['translator-example'] ?? {}) as Record<string, unknown>
  const pluginConfig = (section.config ?? {}) as Record<string, unknown>

  const gatewayUrl = (pluginConfig.gatewayUrl as string | undefined)
    ?? process.env.OPENCLAW_GATEWAY_URL
    ?? 'http://localhost:5337'
  const model = (pluginConfig.model as string | undefined)
    ?? process.env.OPENCLAW_GATEWAY_MODEL
    ?? 'gpt-4o-mini'
  const apiKey = (pluginConfig.apiKey as string | undefined)
    ?? process.env.OPENCLAW_GATEWAY_API_KEY

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`

  const res = await fetch(`${gatewayUrl.replace(/\/+$/, '')}/v1/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'system',
          content: 'You are a precise Chinese-English translator.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.2,
    }),
    signal: AbortSignal.timeout(30_000),
  })

  if (!res.ok) {
    throw new Error(`Gateway error ${res.status}`)
  }

  const data = await res.json() as {
    choices?: Array<{ message?: { content?: string } }>
  }

  return data.choices?.[0]?.message?.content?.trim() || '（无译文）'
}

async function handleTranslate(ctx: PluginCommandContext) {
  const { targetLanguage, text } = parseArgs(ctx.args ?? '')
  if (!text) {
    return reply('用法：/translate 你好 world\n或：/translate --to en 你好\n或：/translate --to zh hello')
  }

  try {
    const translated = await callGateway(buildPrompt(text, targetLanguage), ctx)
    return reply(`🌐 翻译结果\n${translated}`)
  } catch (error) {
    return reply(`❌ 翻译失败：${(error as Error).message}`)
  }
}

const translateCommand: OpenClawPluginCommandDefinition = {
  name: 'translate',
  description: '中英互译。用法：/translate --to en 你好',
  acceptsArgs: true,
  requireAuth: false,
  handler: handleTranslate,
}

export default definePluginEntry({
  id: 'example-translator-plugin',
  name: 'Translator Plugin Example',
  description: '示例翻译插件：注册 /translate，调用 Hub 的 LLM Gateway。',
  register(api) {
    api.registerCommand(translateCommand)
    api.logger.info('[example-translator-plugin] registered /translate')
  },
})
