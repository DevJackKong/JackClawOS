/**
 * 通义千问 (Qwen) provider — Alibaba Cloud
 *
 * Models: qwen-max, qwen-plus, qwen-turbo, qwen-long
 * API: https://dashscope.aliyuncs.com/compatible-mode/v1
 * (OpenAI-compatible endpoint)
 */
import { OpenAICompatibleProvider } from './openai-compatible.js'
import type { ProviderConfig } from '../types.js'

export class QwenProvider extends OpenAICompatibleProvider {
  constructor(config: ProviderConfig) {
    super({
      ...config,
      provider: 'qwen',
      baseUrl: config.baseUrl ?? 'https://dashscope.aliyuncs.com/compatible-mode',
      defaultModel: config.defaultModel ?? 'qwen-max',
    })
    this.name = 'qwen'
    this.models = ['qwen-max', 'qwen-plus', 'qwen-turbo', 'qwen-long', 'qwen-max-longcontext']
  }
}
