export type TaskResult = 'success' | 'failure' | 'partial'
export type MemoryType = 'failure' | 'success_pattern' | 'sop' | 'preference'

export interface TaskMeta {
  taskId: string
  taskType: string
  agentId: string
  startedAt: number
  endedAt: number
}

export interface TaskReflection {
  taskId: string
  timestamp: number
  taskType: string
  result: TaskResult
  cause?: string
  fix?: string
  reusableRule?: string
  confidence: number
  shouldMemorize: boolean
  memoryType: MemoryType
}

type PatternRule = {
  test: RegExp
  type: MemoryType
  confidence: number
}

const FAILURE_PATTERNS: RegExp[] = [
  /\b(error|failed|failure|exception|timeout|timed out|crash|fatal|rejected|denied)\b/i,
  /(报错|失败|异常|超时|崩溃|拒绝|中断|回滚)/i,
]

const PARTIAL_PATTERNS: RegExp[] = [
  /\b(partial|partially|incomplete|unfinished|todo|blocked)\b/i,
  /(部分完成|未完成|待办|阻塞|卡住)/i,
]

const SUCCESS_PATTERNS: RegExp[] = [
  /\b(success|successful|completed|done|fixed|resolved|passed)\b/i,
  /(成功|完成|已修复|已解决|通过)/i,
]

const MEMORY_RULES: PatternRule[] = [
  { test: /\b(prefer|preference|preferably|user prefers|习惯|偏好|喜欢|不要|避免)\b/i, type: 'preference', confidence: 0.85 },
  { test: /\b(step|steps|procedure|process|runbook|checklist|sop|首先|然后|最后|步骤|流程|规范)\b/i, type: 'sop', confidence: 0.82 },
  { test: /\b(pattern|best practice|worked well|reusable|template|最佳实践|复用|模式|经验)\b/i, type: 'success_pattern', confidence: 0.8 },
  { test: /\b(root cause|cause|why|because|issue|problem|原因|问题|根因)\b/i, type: 'failure', confidence: 0.78 },
]

const CAUSE_MARKERS = ['root cause', 'cause', 'because', 'due to', 'reason', '原因', '根因', '因为', '由于']
const FIX_MARKERS = ['fix', 'solution', 'resolved by', 'next time', 'mitigation', 'repair', '修复', '解决', '下次', '改进']
const RULE_MARKERS = ['rule', 'always', 'never', 'should', 'best practice', 'checklist', 'remember', '规则', '应该', '必须', '记住', '优先']

function normalizeLog(taskLog: string): string {
  return taskLog
    .replace(/\r\n/g, '\n')
    .replace(/\t/g, ' ')
    .replace(/[ ]{2,}/g, ' ')
    .trim()
}

function splitSentences(taskLog: string): string[] {
  return normalizeLog(taskLog)
    .split(/(?<=[。！？.!?\n])\s+/)
    .map((line) => line.trim())
    .filter(Boolean)
}

function hasAnyPattern(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text))
}

function firstMatchingSentence(sentences: string[], markers: string[]): string | undefined {
  const loweredMarkers = markers.map((marker) => marker.toLowerCase())

  for (const sentence of sentences) {
    const loweredSentence = sentence.toLowerCase()
    if (loweredMarkers.some((marker) => loweredSentence.includes(marker))) {
      return sentence
    }
  }

  return undefined
}

function clampConfidence(value: number): number {
  if (value < 0) return 0
  if (value > 1) return 1
  return Math.round(value * 100) / 100
}

export class TaskReflectionExtractor {
  extract(taskLog: string, taskMeta: TaskMeta): TaskReflection {
    const normalized = normalizeLog(taskLog)
    const sentences = splitSentences(normalized)
    const result = this.detectResult(normalized)
    const cause = firstMatchingSentence(sentences, CAUSE_MARKERS)
    const fix = firstMatchingSentence(sentences, FIX_MARKERS)
    const reusableRule = firstMatchingSentence(sentences, RULE_MARKERS) ?? this.buildReusableRule(result, cause, fix)
    const memoryDecision = this.detectMemoryType(normalized, result, reusableRule, cause)
    const confidence = this.computeConfidence({
      normalized,
      result,
      cause,
      fix,
      reusableRule,
      memoryType: memoryDecision.memoryType,
      memoryConfidence: memoryDecision.confidence,
    })

    const reflection: TaskReflection = {
      taskId: taskMeta.taskId,
      timestamp: taskMeta.endedAt,
      taskType: taskMeta.taskType,
      result,
      confidence,
      shouldMemorize: false,
      memoryType: memoryDecision.memoryType,
    }

    if (cause) reflection.cause = cause
    if (fix) reflection.fix = fix
    if (reusableRule) reflection.reusableRule = reusableRule

    reflection.shouldMemorize = this.shouldPersist(reflection)
    return reflection
  }

  extractBatch(logs: Array<{ log: string; meta: TaskMeta }>): TaskReflection[] {
    return logs.map(({ log, meta }) => this.extract(log, meta))
  }

  shouldPersist(reflection: TaskReflection): boolean {
    if (reflection.confidence < 0.6) return false
    if (reflection.result === 'failure') return true
    if (reflection.memoryType === 'preference') return true
    if (reflection.memoryType === 'sop' && Boolean(reflection.reusableRule)) return true
    if (reflection.result === 'success' && reflection.memoryType === 'success_pattern') return true
    if (reflection.result === 'partial' && Boolean(reflection.fix || reflection.reusableRule)) return true
    return false
  }

  private detectResult(taskLog: string): TaskResult {
    if (hasAnyPattern(taskLog, FAILURE_PATTERNS)) return 'failure'
    if (hasAnyPattern(taskLog, PARTIAL_PATTERNS)) return 'partial'
    if (hasAnyPattern(taskLog, SUCCESS_PATTERNS)) return 'success'
    return 'partial'
  }

  private detectMemoryType(
    taskLog: string,
    result: TaskResult,
    reusableRule?: string,
    cause?: string,
  ): { memoryType: MemoryType; confidence: number } {
    for (const rule of MEMORY_RULES) {
      if (rule.test.test(taskLog)) {
        return { memoryType: rule.type, confidence: rule.confidence }
      }
    }

    if (result === 'failure' || cause) {
      return { memoryType: 'failure', confidence: 0.75 }
    }

    if (reusableRule) {
      return { memoryType: 'sop', confidence: 0.72 }
    }

    if (result === 'success') {
      return { memoryType: 'success_pattern', confidence: 0.68 }
    }

    return { memoryType: 'preference', confidence: 0.55 }
  }

  private buildReusableRule(
    result: TaskResult,
    cause?: string,
    fix?: string,
  ): string | undefined {
    if (fix) return fix
    if (result === 'failure' && cause) return `Avoid recurrence: ${cause}`
    if (result === 'success') return 'Reuse the successful execution pattern for similar tasks.'
    return undefined
  }

  private computeConfidence(input: {
    normalized: string
    result: TaskResult
    cause?: string
    fix?: string
    reusableRule?: string
    memoryType: MemoryType
    memoryConfidence: number
  }): number {
    let score = input.memoryConfidence

    if (input.normalized.length > 40) score += 0.05
    if (input.cause) score += 0.08
    if (input.fix) score += 0.08
    if (input.reusableRule) score += 0.06
    if (input.result === 'partial') score -= 0.08
    if (input.normalized.length < 12) score -= 0.1
    if (!input.cause && !input.fix && !input.reusableRule) score -= 0.08

    return clampConfidence(score)
  }
}
