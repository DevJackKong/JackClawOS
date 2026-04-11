import fs from 'fs'
import path from 'path'

export interface TaskReflection {
  task: string
  result: string
  cause: string
  fix: string
  reusable_rule: string
  confidence: number
}

const DEFAULT_REFLECTION: TaskReflection = {
  task: '',
  result: '',
  cause: '',
  fix: '',
  reusable_rule: '',
  confidence: 0.2,
}

const SECTION_PATTERNS: Record<keyof Omit<TaskReflection, 'confidence'>, RegExp[]> = {
  task: [
    /(?:^|\n)\s*(?:task|任务|目标|objective|goal)\s*[:：]\s*([^\n]+)/i,
    /(?:^|\n)\s*(?:需要|请|目标是)\s*(.+?)(?:[。！？\n]|$)/i,
  ],
  result: [
    /(?:^|\n)\s*(?:result|结果|结论|状态|outcome)\s*[:：]\s*([^\n]+)/i,
    /(?:^|\n)\s*(?:最终|最后)\s*(.+?)(?:[。！？\n]|$)/i,
    /(?:^|\n)\s*(?:完成了|已完成|成功|失败)\s*(.+?)(?:[。！？\n]|$)/i,
  ],
  cause: [
    /(?:^|\n)\s*(?:cause|原因|根因|问题|问题原因)\s*[:：]\s*([^\n]+)/i,
    /(?:因为|由于|根因是|原因是)\s*(.+?)(?:[。！？\n]|$)/i,
  ],
  fix: [
    /(?:^|\n)\s*(?:fix|修复|改进|解决方案|处理)\s*[:：]\s*([^\n]+)/i,
    /(?:改为|解决办法是|修复方式是|处理方式是)\s*(.+?)(?:[。！？\n]|$)/i,
  ],
  reusable_rule: [
    /(?:^|\n)\s*(?:rule|经验|复用规则|规则|原则)\s*[:：]\s*([^\n]+)/i,
    /(?:下次|以后|今后)\s*(.+?)(?:[。！？\n]|$)/i,
  ],
}

function normalizeText(value: string): string {
  return value
    .replace(/\r\n/g, '\n')
    .replace(/[\t ]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim()
}

function cleanExtracted(value: string): string {
  return value
    .replace(/^[\s:：-]+/, '')
    .replace(/[。；;\s]+$/u, '')
    .trim()
}

function firstMatch(text: string, patterns: RegExp[]): string {
  for (const pattern of patterns) {
    const match = text.match(pattern)
    const captured = match?.[1]
    if (captured) {
      const cleaned = cleanExtracted(captured)
      if (cleaned) return cleaned
    }
  }
  return ''
}

function sentenceCandidates(text: string): string[] {
  return normalizeText(text)
    .split(/(?<=[。！？.!?\n])/u)
    .map(part => cleanExtracted(part))
    .filter(Boolean)
}

function chooseSentence(text: string, keywords: string[]): string {
  const sentences = sentenceCandidates(text)
  const found = sentences.find(sentence =>
    keywords.some(keyword => sentence.toLowerCase().includes(keyword.toLowerCase()))
  )
  return found ?? ''
}

function deriveTask(text: string): string {
  return chooseSentence(text, ['任务', '目标', '需要', '实现', '修复', '新增'])
}

function deriveResult(text: string): string {
  return chooseSentence(text, ['完成', '成功', '失败', '结果', '最终', '报错', '通过'])
}

function deriveCause(text: string): string {
  return chooseSentence(text, ['原因', '根因', '因为', '由于', '问题', '报错'])
}

function deriveFix(text: string): string {
  return chooseSentence(text, ['修复', '解决', '改为', '处理', '优化', '补充'])
}

function deriveRule(task: string, cause: string, fix: string): string {
  if (fix && cause) {
    return `遇到${cause}时，优先${fix}`
  }
  if (task && fix) {
    return `处理“${task}”时，先${fix}`
  }
  if (fix) {
    return `类似任务优先执行：${fix}`
  }
  if (cause) {
    return `出现${cause}时，需要先定位根因再处理`
  }
  return ''
}

function clampConfidence(value: number): number {
  if (value < 0) return 0
  if (value > 1) return 1
  return Number(value.toFixed(2))
}

export function extractReflection(taskLog: string): TaskReflection {
  const normalized = normalizeText(taskLog)
  if (!normalized) {
    return { ...DEFAULT_REFLECTION }
  }

  const task = firstMatch(normalized, SECTION_PATTERNS.task) || deriveTask(normalized)
  const result = firstMatch(normalized, SECTION_PATTERNS.result) || deriveResult(normalized)
  const cause = firstMatch(normalized, SECTION_PATTERNS.cause) || deriveCause(normalized)
  const fix = firstMatch(normalized, SECTION_PATTERNS.fix) || deriveFix(normalized)
  const reusable_rule =
    firstMatch(normalized, SECTION_PATTERNS.reusable_rule) || deriveRule(task, cause, fix)

  const filledCount = [task, result, cause, fix, reusable_rule].filter(Boolean).length
  const confidence = clampConfidence(0.2 + filledCount * 0.16)

  return {
    task,
    result,
    cause,
    fix,
    reusable_rule,
    confidence,
  }
}

function safeFileName(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/giu, '-')
    .replace(/^-+|-+$/g, '')
  return normalized || 'task-reflection'
}

export function writeReflection(reflection: TaskReflection, memoryDir: string): void {
  const dir = path.resolve(memoryDir)
  fs.mkdirSync(dir, { recursive: true })

  const timestamp = new Date().toISOString().replace(/[.:]/g, '-')
  const baseName = reflection.task ? safeFileName(reflection.task) : 'task-reflection'
  const filePath = path.join(dir, `${timestamp}-${baseName}.json`)

  fs.writeFileSync(filePath, `${JSON.stringify(reflection, null, 2)}\n`, 'utf-8')
}
