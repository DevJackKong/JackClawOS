/**
 * 智谱 GLM (Zhipu AI) provider
 *
 * Models: glm-4, glm-4-plus, glm-4-flash (free!), glm-4-air
 * API: https://open.bigmodel.cn/api/paas/v4 (OpenAI-compatible)
 */
import { OpenAICompatibleProvider } from './openai-compatible.js'
import type { ProviderConfig } from '../types.js'

export class ZhipuProvider extends OpenAICompatibleProvider {
  constructor(config: ProviderConfig) {
    super({
      ...config,
      provider: 'zhipu',
      baseUrl: config.baseUrl ?? 'https://open.bigmodel.cn/api/paas/v4',
      defaultModel: config.defaultModel ?? 'glm-4-flash',
    })
    this.name = 'zhipu'
    this.models = ['glm-4', 'glm-4-plus', 'glm-4-flash', 'glm-4-air', 'glm-4-airx', 'glm-4-long', 'glm-4v']
  }
}
