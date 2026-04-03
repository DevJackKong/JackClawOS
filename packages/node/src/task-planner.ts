/**
 * JackClaw Task Planner — 任务规划引擎
 *
 * 收到任何开发任务时，先自动输出执行计划：
 * - 预计耗时
 * - 消耗 token 估算
 * - 是否需要并行（以及如何拆分）
 * - 依赖关系图
 * - 风险评估
 *
 * 规划结果存入 TaskBundle，供 Dispatcher / Hub 直接消费
 */

import type { AiClient } from './ai-client'

// ─── 类型定义 ─────────────────────────────────────────────────────────────────

export type TaskComplexity = 'trivial' | 'simple' | 'moderate' | 'complex' | 'epic'

export interface SubTask {
  id: string
  title: string
  description: string
  estimatedMinutes: number
  estimatedTokens: number
  canParallel: boolean          // 是否可以与其他 subtask 并行
  dependsOn: string[]           // 依赖的 subtask id 列表
  assignTo?: string             // 建议分配给哪个 node/agent
  riskLevel: 'low' | 'medium' | 'high'
  riskNote?: string
}

export interface ExecutionPlan {
  taskId: string
  title: string
  complexity: TaskComplexity

  // 时间估算
  estimatedMinutesSerial: number    // 串行总耗时
  estimatedMinutesParallel: number  // 并行后耗时（关键路径）
  parallelSpeedup: number           // 加速比

  // Token 估算
  estimatedTotalTokens: number      // 总 token
  estimatedCostUsd: number          // 估算费用（按 claude-sonnet 计价）

  // 并行策略
  needsParallel: boolean
  parallelBatches: string[][]       // 并行批次，每批内可同时执行
  suggestedAgentCount: number

  // 子任务
  subtasks: SubTask[]

  // 风险
  overallRisk: 'low' | 'medium' | 'high'
  risks: string[]

  // 元数据
  plannerVersion: '1.0'
  plannedAt: number
  planningTokensUsed?: number
}

// ─── Token 估算常数 ───────────────────────────────────────────────────────────

const TOKEN_RATES = {
  // 每分钟复杂度对应的平均 token 消耗（经验值）
  trivial: 500,       // 改一行代码
  simple: 2000,       // 写一个函数
  moderate: 8000,     // 实现一个模块
  complex: 25000,     // 实现一个完整功能
  epic: 80000,        // 重构/整个系统
} as const

const USD_PER_1M_INPUT = 3.0   // claude-sonnet-4 input
const USD_PER_1M_OUTPUT = 15.0 // claude-sonnet-4 output
const OUTPUT_RATIO = 0.3       // 输出约占 30%

// ─── 规划引擎 ─────────────────────────────────────────────────────────────────

export class TaskPlanner {
  constructor(private aiClient: AiClient) {}

  /**
   * 分析任务，生成执行计划
   * 如果 aiClient 可用，使用 AI 做细化分析；否则用启发式规则
   */
  async plan(opts: {
    taskId: string
    title: string
    description: string
    context?: string            // 项目背景（可选）
    useAi?: boolean             // 是否用 AI 分析（默认 true，但不阻塞）
  }): Promise<ExecutionPlan> {
    const start = Date.now()

    // 先用启发式规则生成基础计划（即时返回，不等 AI）
    const basePlan = this.heuristicPlan(opts)

    if (opts.useAi === false) return basePlan

    // AI 细化（最多 30s，超时则用启发式结果）
    try {
      const refined = await Promise.race([
        this.aiRefinePlan(opts, basePlan),
        new Promise<null>(resolve => setTimeout(() => resolve(null), 30000)),
      ])
      if (refined) {
        refined.planningTokensUsed = basePlan.planningTokensUsed
        return refined
      }
    } catch (e) {
      console.warn('[planner] AI refinement failed, using heuristic plan:', (e as Error).message)
    }

    basePlan.planningTokensUsed = Math.round((Date.now() - start) / 10)
    return basePlan
  }

  // ─── 启发式规则规划 ─────────────────────────────────────────────────────────

  private heuristicPlan(opts: {
    taskId: string
    title: string
    description: string
  }): ExecutionPlan {
    const desc = opts.description.toLowerCase()
    const wordCount = opts.description.split(/\s+/).length

    // 复杂度判断
    const complexity = this.guessComplexity(desc, wordCount)
    const baseMinutes = this.complexityToMinutes(complexity)

    // 简单拆分：按关键词检测可并行子任务
    const subtasks = this.extractSubtasks(opts.taskId, opts.description, complexity)

    // 计算并行批次（拓扑排序）
    const batches = this.topoSort(subtasks)
    const serialMinutes = subtasks.reduce((s, t) => s + t.estimatedMinutes, 0)
    const parallelMinutes = batches.reduce(
      (s, batch) => s + Math.max(...batch.map(id => subtasks.find(t => t.id === id)!.estimatedMinutes)),
      0
    )

    const totalTokens = subtasks.reduce((s, t) => s + t.estimatedTokens, 0)
    const costUsd = this.estimateCost(totalTokens)

    const risks = this.detectRisks(desc)

    return {
      taskId: opts.taskId,
      title: opts.title,
      complexity,
      estimatedMinutesSerial: serialMinutes || baseMinutes,
      estimatedMinutesParallel: parallelMinutes || Math.ceil(baseMinutes * 0.4),
      parallelSpeedup: parallelMinutes > 0
        ? Math.round((serialMinutes / parallelMinutes) * 10) / 10
        : 2.5,
      estimatedTotalTokens: totalTokens || TOKEN_RATES[complexity],
      estimatedCostUsd: costUsd,
      needsParallel: subtasks.length > 1 && complexity !== 'trivial',
      parallelBatches: batches,
      suggestedAgentCount: Math.min(batches[0]?.length || 1, 8),
      subtasks,
      overallRisk: risks.length > 2 ? 'high' : risks.length > 0 ? 'medium' : 'low',
      risks,
      plannerVersion: '1.0',
      plannedAt: Date.now(),
    }
  }

  // ─── AI 细化规划 ────────────────────────────────────────────────────────────

  private async aiRefinePlan(
    opts: { taskId: string; title: string; description: string; context?: string },
    basePlan: ExecutionPlan,
  ): Promise<ExecutionPlan> {
    const systemPrompt = `你是 JackClaw 任务规划专家。
分析开发任务，输出精确的执行计划。
规则：
- 时间估算要保守（宁可高估，不能低估）
- token 估算基于实际 LLM 调用次数 × 每次平均 token
- 并行拆分必须考虑依赖关系（有依赖的不能并行）
- 风险只列真实的，不要臆造
输出严格 JSON，不加任何说明文字。`

    const prompt = `任务：${opts.title}
描述：${opts.description}
${opts.context ? `背景：${opts.context}` : ''}

基础计划（供参考，可以覆盖）：
复杂度=${basePlan.complexity} 串行耗时=${basePlan.estimatedMinutesSerial}min

请输出以下 JSON 结构（严格遵循，不要增减字段）：
{
  "complexity": "trivial|simple|moderate|complex|epic",
  "estimatedMinutesSerial": <number>,
  "estimatedMinutesParallel": <number>,
  "estimatedTotalTokens": <number>,
  "needsParallel": <boolean>,
  "suggestedAgentCount": <number>,
  "subtasks": [
    {
      "id": "s1",
      "title": "子任务名",
      "description": "描述",
      "estimatedMinutes": <number>,
      "estimatedTokens": <number>,
      "canParallel": <boolean>,
      "dependsOn": [],
      "riskLevel": "low|medium|high",
      "riskNote": "可选"
    }
  ],
  "risks": ["风险1", "风险2"]
}`

    const result = await this.aiClient.call({
      systemPrompt,
      messages: [{ role: 'user', content: prompt }],
      queryContext: opts.title,
    })

    // 提取 JSON（AI 可能包裹在 markdown 里）
    const jsonMatch = result.content.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error('AI did not return valid JSON')
    const aiData = JSON.parse(jsonMatch[0])

    // 合并 AI 结果和基础计划
    const subtasks: SubTask[] = (aiData.subtasks ?? []).map((s: any, i: number) => ({
      ...s,
      id: s.id || `s${i + 1}`,
      assignTo: undefined,
    }))

    const batches = this.topoSort(subtasks)
    const costUsd = this.estimateCost(aiData.estimatedTotalTokens)

    return {
      taskId: opts.taskId,
      title: opts.title,
      complexity: aiData.complexity ?? basePlan.complexity,
      estimatedMinutesSerial: aiData.estimatedMinutesSerial,
      estimatedMinutesParallel: aiData.estimatedMinutesParallel,
      parallelSpeedup: aiData.estimatedMinutesSerial > 0
        ? Math.round((aiData.estimatedMinutesSerial / aiData.estimatedMinutesParallel) * 10) / 10
        : 1,
      estimatedTotalTokens: aiData.estimatedTotalTokens,
      estimatedCostUsd: costUsd,
      needsParallel: aiData.needsParallel,
      parallelBatches: batches,
      suggestedAgentCount: aiData.suggestedAgentCount ?? 1,
      subtasks,
      overallRisk: aiData.risks?.length > 2 ? 'high' : aiData.risks?.length > 0 ? 'medium' : 'low',
      risks: aiData.risks ?? [],
      plannerVersion: '1.0',
      plannedAt: Date.now(),
      planningTokensUsed: result.usage.inputTokens + result.usage.outputTokens,
    }
  }

  // ─── 工具函数 ───────────────────────────────────────────────────────────────

  private guessComplexity(desc: string, wordCount: number): TaskComplexity {
    if (wordCount < 20) return 'trivial'
    const complexKeywords = ['重构', '系统', '框架', 'refactor', 'system', 'architecture', '整个', 'entire']
    const moderateKeywords = ['模块', '功能', 'module', 'feature', '实现', 'implement', '接入']
    const simpleKeywords = ['添加', '修复', 'fix', 'add', '更新', 'update', '优化']

    if (complexKeywords.some(k => desc.includes(k)) || wordCount > 200) return 'complex'
    if (moderateKeywords.some(k => desc.includes(k)) || wordCount > 80) return 'moderate'
    if (simpleKeywords.some(k => desc.includes(k)) || wordCount > 30) return 'simple'
    return 'trivial'
  }

  private complexityToMinutes(c: TaskComplexity): number {
    return { trivial: 5, simple: 20, moderate: 60, complex: 180, epic: 480 }[c]
  }

  private extractSubtasks(taskId: string, description: string, complexity: TaskComplexity): SubTask[] {
    // 简单启发：按段落/数字列表切分
    const lines = description.split('\n').filter(l => l.trim().match(/^[\d\-\*]|^[a-z]\./i))
    if (lines.length >= 2) {
      return lines.slice(0, 8).map((line, i) => {
        const title = line.replace(/^[\d\-\*\.]\s*/, '').trim().slice(0, 80)
        const mins = this.complexityToMinutes(complexity) / lines.length
        return {
          id: `${taskId}-s${i + 1}`,
          title: title || `子任务 ${i + 1}`,
          description: title,
          estimatedMinutes: Math.max(5, Math.round(mins)),
          estimatedTokens: Math.round(TOKEN_RATES[complexity] / lines.length),
          canParallel: i > 0,    // 除第一个外都标可并行（保守估计）
          dependsOn: i === 0 ? [] : [],
          riskLevel: 'low',
        }
      })
    }

    // 无明显列表：作为单一任务
    return [{
      id: `${taskId}-s1`,
      title: description.slice(0, 80),
      description,
      estimatedMinutes: this.complexityToMinutes(complexity),
      estimatedTokens: TOKEN_RATES[complexity],
      canParallel: false,
      dependsOn: [],
      riskLevel: complexity === 'epic' ? 'high' : complexity === 'complex' ? 'medium' : 'low',
    }]
  }

  private topoSort(subtasks: SubTask[]): string[][] {
    const batches: string[][] = []
    const done = new Set<string>()
    const remaining = [...subtasks]

    while (remaining.length > 0) {
      const ready = remaining.filter(t => t.dependsOn.every(d => done.has(d)))
      if (ready.length === 0) {
        // 循环依赖，强制推进
        batches.push(remaining.map(t => t.id))
        break
      }
      batches.push(ready.map(t => t.id))
      ready.forEach(t => done.add(t.id))
      ready.forEach(t => remaining.splice(remaining.indexOf(t), 1))
    }
    return batches
  }

  private detectRisks(desc: string): string[] {
    const risks: string[] = []
    if (desc.includes('数据库') || desc.includes('database') || desc.includes('migration'))
      risks.push('数据迁移可能造成数据丢失，需要备份')
    if (desc.includes('支付') || desc.includes('payment') || desc.includes('stripe'))
      risks.push('支付模块需要沙盒测试，不能直接上生产')
    if (desc.includes('重构') || desc.includes('refactor'))
      risks.push('重构可能引入回归，需要完整测试覆盖')
    if (desc.includes('第三方') || desc.includes('api') || desc.includes('外部'))
      risks.push('第三方 API 可能有速率限制或变更')
    return risks
  }

  private estimateCost(tokens: number): number {
    const inputTokens = tokens * (1 - OUTPUT_RATIO)
    const outputTokens = tokens * OUTPUT_RATIO
    return Math.round(
      (inputTokens / 1_000_000 * USD_PER_1M_INPUT + outputTokens / 1_000_000 * USD_PER_1M_OUTPUT) * 100
    ) / 100
  }
}

// ─── 格式化输出（供 ClawChat / CLI 展示）────────────────────────────────────

export function formatPlan(plan: ExecutionPlan): string {
  const lines: string[] = []

  lines.push(`📋 **任务规划：${plan.title}**`)
  lines.push(``)
  lines.push(`**复杂度：** ${complexityLabel(plan.complexity)}`)
  lines.push(`**预计耗时：**`)
  lines.push(`  - 串行执行：${formatMinutes(plan.estimatedMinutesSerial)}`)
  lines.push(`  - 并行执行：${formatMinutes(plan.estimatedMinutesParallel)} ${plan.needsParallel ? `（加速 ${plan.parallelSpeedup}×）` : ''}`)
  lines.push(`**Token 消耗：** ~${formatTokens(plan.estimatedTotalTokens)} tokens（~$${plan.estimatedCostUsd}）`)
  lines.push(`**建议并行：** ${plan.needsParallel ? `是（${plan.suggestedAgentCount} 个 Agent）` : '否，顺序执行'}`)
  lines.push(``)

  if (plan.subtasks.length > 1) {
    lines.push(`**子任务分解（${plan.subtasks.length} 个）：**`)
    plan.parallelBatches.forEach((batch, i) => {
      lines.push(`  批次 ${i + 1}（可同时执行 ${batch.length} 个）：`)
      batch.forEach(id => {
        const t = plan.subtasks.find(s => s.id === id)!
        lines.push(`    • ${t.title} [${formatMinutes(t.estimatedMinutes)}, ~${formatTokens(t.estimatedTokens)} tokens]`)
      })
    })
    lines.push(``)
  }

  if (plan.risks.length > 0) {
    lines.push(`**风险：**`)
    plan.risks.forEach(r => lines.push(`  ⚠️ ${r}`))
    lines.push(``)
  }

  if (plan.planningTokensUsed) {
    lines.push(`_规划消耗：${plan.planningTokensUsed} tokens_`)
  }

  return lines.join('\n')
}

function complexityLabel(c: TaskComplexity): string {
  return { trivial: '🟢 简单', simple: '🟡 轻量', moderate: '🟠 中等', complex: '🔴 复杂', epic: '🚨 史诗' }[c]
}

function formatMinutes(m: number): string {
  if (m < 60) return `${m} 分钟`
  const h = Math.floor(m / 60), min = m % 60
  return min > 0 ? `${h}h ${min}min` : `${h} 小时`
}

function formatTokens(t: number): string {
  if (t >= 1000000) return `${(t / 1000000).toFixed(1)}M`
  if (t >= 1000) return `${Math.round(t / 1000)}K`
  return `${t}`
}
