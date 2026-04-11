export type FallbackMode = 'retry' | 'switch-agent' | 'degrade' | 'escalate' | 'fail-fast'

export interface FallbackConfig {
  maxRetries: number
  retryDelayMs: number
  fallbackAgentId?: string
  degradedMode?: string
  escalateToHuman?: boolean
}

export interface FallbackResult {
  mode: FallbackMode
  shouldRetry: boolean
  delayMs?: number
  newAgentId?: string
  humanReviewRequired?: boolean
  message: string
}

const DEFAULT_CONFIG: FallbackConfig = {
  maxRetries: 3,
  retryDelayMs: 1000,
}

export class FallbackStrategy {
  private readonly config: FallbackConfig

  constructor(config: Partial<FallbackConfig> = {}) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
    }
  }

  decide(
    error: Error,
    attempt: number,
    config: Partial<FallbackConfig> = {},
  ): FallbackResult {
    const mergedConfig: FallbackConfig = {
      ...this.config,
      ...config,
    }

    const mode = this.selectMode(error, attempt, mergedConfig)

    switch (mode) {
      case 'retry': {
        const delayMs = this.calcDelay(attempt, mergedConfig.retryDelayMs)
        return {
          mode,
          shouldRetry: true,
          delayMs,
          message: `Transient error detected. Retrying attempt ${attempt + 1} in ${delayMs}ms.`,
        }
      }
      case 'switch-agent':
        return {
          mode,
          shouldRetry: true,
          newAgentId: mergedConfig.fallbackAgentId,
          message: mergedConfig.fallbackAgentId
            ? `Switching execution to fallback agent ${mergedConfig.fallbackAgentId}.`
            : 'Fallback agent requested, but no fallbackAgentId configured. Retrying with current agent.',
        }
      case 'degrade':
        return {
          mode,
          shouldRetry: false,
          message: mergedConfig.degradedMode
            ? `Entering degraded mode: ${mergedConfig.degradedMode}.`
            : 'Entering degraded mode with reduced capabilities.',
        }
      case 'escalate':
        return {
          mode,
          shouldRetry: false,
          humanReviewRequired: mergedConfig.escalateToHuman ?? true,
          message: 'Escalating to human review due to persistent or sensitive failure.',
        }
      case 'fail-fast':
      default:
        return {
          mode: 'fail-fast',
          shouldRetry: false,
          message: `Failing fast: ${error.message}`,
        }
    }
  }

  private calcDelay(attempt: number, baseMs: number): number {
    const safeAttempt = Math.max(0, attempt)
    return baseMs * Math.pow(2, safeAttempt)
  }

  private selectMode(
    error: Error,
    attempt: number,
    config: FallbackConfig,
  ): FallbackMode {
    const message = error.message.toLowerCase()
    const name = error.name.toLowerCase()

    const isRateLimit =
      name.includes('rate') ||
      message.includes('rate limit') ||
      message.includes('too many requests') ||
      message.includes('429')

    const isTimeout =
      name.includes('timeout') ||
      message.includes('timeout') ||
      message.includes('timed out') ||
      message.includes('network') ||
      message.includes('temporarily unavailable')

    const isAuth =
      name.includes('auth') ||
      message.includes('unauthorized') ||
      message.includes('forbidden') ||
      message.includes('permission denied') ||
      message.includes('401') ||
      message.includes('403')

    const isValidation =
      name.includes('validation') ||
      message.includes('invalid input') ||
      message.includes('bad request') ||
      message.includes('malformed') ||
      message.includes('400')

    const isCapacity =
      message.includes('overloaded') ||
      message.includes('capacity') ||
      message.includes('unavailable model') ||
      message.includes('service unavailable') ||
      message.includes('503')

    if ((isRateLimit || isTimeout) && attempt < config.maxRetries) {
      return 'retry'
    }

    if (isCapacity && config.fallbackAgentId) {
      return 'switch-agent'
    }

    if (isAuth && (config.escalateToHuman ?? false)) {
      return 'escalate'
    }

    if (isValidation && config.degradedMode) {
      return 'degrade'
    }

    if (attempt >= config.maxRetries) {
      if (config.fallbackAgentId) return 'switch-agent'
      if (config.degradedMode) return 'degrade'
      if (config.escalateToHuman) return 'escalate'
    }

    if (config.degradedMode && (message.includes('unsupported') || message.includes('not implemented'))) {
      return 'degrade'
    }

    return 'fail-fast'
  }
}
