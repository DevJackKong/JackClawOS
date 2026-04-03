/**
 * 文心一言 (ERNIE) provider — Baidu
 *
 * Models: ernie-4.5-turbo, ernie-4.0, ernie-speed, ernie-lite
 * API: https://aip.baidubce.com (OpenAI-compatible mode)
 *
 * Note: Baidu has an OpenAI-compatible endpoint via Qianfan platform.
 */
import { OpenAICompatibleProvider } from './openai-compatible.js'
import type { ProviderConfig } from '../types.js'

export class ErnieProvider extends OpenAICompatibleProvider {
  constructor(config: ProviderConfig) {
    super({
      ...config,
      provider: 'ernie',
      baseUrl: config.baseUrl ?? 'https://qianfan.baidubce.com/v2',
      defaultModel: config.defaultModel ?? 'ernie-4.5-turbo',
    })
    this.name = 'ernie'
    this.models = ['ernie-4.5-turbo', 'ernie-4.0', 'ernie-3.5', 'ernie-speed', 'ernie-lite']
  }
}
