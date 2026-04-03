/**
 * Kimi (Moonshot AI) provider
 *
 * Models: moonshot-v1-8k, moonshot-v1-32k, moonshot-v1-128k
 * API: https://api.moonshot.cn/v1 (OpenAI-compatible)
 */
import { OpenAICompatibleProvider } from './openai-compatible.js'
import type { ProviderConfig } from '../types.js'

export class KimiProvider extends OpenAICompatibleProvider {
  constructor(config: ProviderConfig) {
    super({
      ...config,
      provider: 'kimi',
      baseUrl: config.baseUrl ?? 'https://api.moonshot.cn/v1',
      defaultModel: config.defaultModel ?? 'moonshot-v1-32k',
    })
    this.name = 'kimi'
    this.models = ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k']
  }
}
