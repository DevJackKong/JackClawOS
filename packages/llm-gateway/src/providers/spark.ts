/**
 * 讯飞星火 (Spark) provider — iFlytek
 *
 * Models: generalv3.5 (Spark Max), generalv3 (Spark Pro), lite
 * API: https://spark-api-open.xf-yun.com/v1 (OpenAI-compatible)
 */
import { OpenAICompatibleProvider } from './openai-compatible.js'
import type { ProviderConfig } from '../types.js'

export class SparkProvider extends OpenAICompatibleProvider {
  constructor(config: ProviderConfig) {
    super({
      ...config,
      provider: 'spark',
      baseUrl: config.baseUrl ?? 'https://spark-api-open.xf-yun.com/v1',
      defaultModel: config.defaultModel ?? 'generalv3.5',
    })
    this.name = 'spark'
    this.models = ['generalv3.5', 'generalv3', 'generalv2', 'lite', 'pro-128k', 'max-32k']
  }
}
