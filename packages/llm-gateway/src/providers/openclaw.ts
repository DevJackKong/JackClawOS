/**
 * OpenClaw Gateway Provider
 *
 * 通过 OpenClaw 的 /v1/chat/completions 端点调用模型。
 * OpenClaw 用户已经配好了多个 provider，JackClaw 直接复用。
 *
 * 配置：
 * const gw = createGateway({
 *   openclaw: {
 *     baseUrl: "http://localhost:5337",  // OpenClaw Gateway 默认端口
 *     apiKey: "optional-token"
 *   }
 * })
 *
 * 自动检测：如果未显式配置，createGateway 会探测
 * http://localhost:5337/health，检测到则自动注册。
 */
import http from 'http'
import { OpenAICompatibleProvider } from './openai-compatible.js'
import type { ProviderConfig } from '../types.js'

const DEFAULT_BASE_URL = 'http://localhost:5337'
const HEALTH_TIMEOUT_MS = 2000

export class OpenClawProvider extends OpenAICompatibleProvider {
  constructor(config: ProviderConfig) {
    super({
      ...config,
      provider: 'openclaw',
      baseUrl: config.baseUrl ?? DEFAULT_BASE_URL,
      defaultModel: config.defaultModel ?? 'gpt-4o',
    })
    this.name = 'openclaw'
    this.type = 'local'
    // Model list will be populated by getModels() at runtime
    if (!this.models.length) {
      this.models = ['gpt-4o', 'gpt-4o-mini', 'claude-sonnet-4-6']
    }
  }

  /** Check /health — lightweight, no token cost. */
  override async ping(): Promise<boolean> {
    return probeHealth(this.baseUrl)
  }

  override async isAvailable(): Promise<boolean> {
    return this.ping()
  }

  /** Fetch live model list from OpenClaw Gateway /v1/models. */
  override async getModels(): Promise<string[]> {
    try {
      const data = await this.get('/v1/models')
      const names: string[] = (data.data ?? []).map((m: any) => m.id as string)
      if (names.length) {
        this.models = names
        return names
      }
    } catch {
      // fall through — return static list
    }
    return this.models
  }
}

/**
 * Probe whether an OpenClaw Gateway is listening at baseUrl.
 * Hits /health with a short timeout; returns true on any 2xx response.
 */
export function probeHealth(baseUrl: string, timeoutMs = HEALTH_TIMEOUT_MS): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const url = new URL(baseUrl.replace(/\/+$/, '') + '/health')
      const req = http.get(url, { timeout: timeoutMs }, (res) => {
        resolve((res.statusCode ?? 0) < 400)
        res.resume()
      })
      req.on('error', () => resolve(false))
      req.on('timeout', () => { req.destroy(); resolve(false) })
    } catch {
      resolve(false)
    }
  })
}
