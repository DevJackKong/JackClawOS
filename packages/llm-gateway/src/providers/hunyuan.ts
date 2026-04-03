/**
 * 混元 (Hunyuan) provider — Tencent Cloud
 *
 * Models: hunyuan-pro, hunyuan-standard, hunyuan-lite, hunyuan-turbo
 * API: https://api.hunyuan.cloud.tencent.com/v1 (OpenAI-compatible)
 */
import { OpenAICompatibleProvider } from './openai-compatible.js'
import type { ProviderConfig } from '../types.js'

export class HunyuanProvider extends OpenAICompatibleProvider {
  constructor(config: ProviderConfig) {
    super({
      ...config,
      provider: 'hunyuan',
      baseUrl: config.baseUrl ?? 'https://api.hunyuan.cloud.tencent.com/v1',
      defaultModel: config.defaultModel ?? 'hunyuan-pro',
    })
    this.name = 'hunyuan'
    this.models = ['hunyuan-pro', 'hunyuan-turbo', 'hunyuan-standard', 'hunyuan-lite', 'hunyuan-vision']
  }
}
