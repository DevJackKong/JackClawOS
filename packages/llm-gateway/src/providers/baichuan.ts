/**
 * 百川 (Baichuan AI) provider
 *
 * Models: Baichuan4, Baichuan3-Turbo, Baichuan2-Turbo
 * API: https://api.baichuan-ai.com/v1 (OpenAI-compatible)
 */
import { OpenAICompatibleProvider } from './openai-compatible.js'
import type { ProviderConfig } from '../types.js'

export class BaichuanProvider extends OpenAICompatibleProvider {
  constructor(config: ProviderConfig) {
    super({
      ...config,
      provider: 'baichuan',
      baseUrl: config.baseUrl ?? 'https://api.baichuan-ai.com/v1',
      defaultModel: config.defaultModel ?? 'Baichuan4',
    })
    this.name = 'baichuan'
    this.models = ['Baichuan4', 'Baichuan3-Turbo', 'Baichuan3-Turbo-128k', 'Baichuan2-Turbo']
  }
}
