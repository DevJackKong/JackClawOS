/**
 * CostTracker — LLM usage and cost tracking
 *
 * Tracks per-model, per-node, per-day token usage and estimated cost.
 * Zero external dependencies. All in-memory with periodic flush to file.
 */

// ─── Cost table (USD per 1M tokens) ──────────────────────────────────────────
const MODEL_COSTS: Record<string, { input: number; output: number }> = {
  // OpenAI
  'gpt-4o':           { input: 2.5,   output: 10 },
  'gpt-4o-mini':      { input: 0.15,  output: 0.6 },
  'o1':               { input: 15,    output: 60 },
  'o3':               { input: 10,    output: 40 },
  'o3-mini':          { input: 1.1,   output: 4.4 },
  // Anthropic
  'claude-opus-4':    { input: 15,    output: 75 },
  'claude-sonnet-4':  { input: 3,     output: 15 },
  'claude-haiku-3.5': { input: 0.8,   output: 4 },
  // Google
  'gemini-2.5-flash': { input: 0.15,  output: 0.6 },
  'gemini-2.5-pro':   { input: 1.25,  output: 10 },
  // DeepSeek
  'deepseek-chat':    { input: 0.14,  output: 0.28 },
  'deepseek-reasoner':{ input: 0.55,  output: 2.19 },
  // Local (free)
  'ollama':           { input: 0,     output: 0 },
}

function getModelCost(model: string): { input: number; output: number } {
  // Try exact match first, then prefix match
  if (MODEL_COSTS[model]) return MODEL_COSTS[model]
  for (const [key, cost] of Object.entries(MODEL_COSTS)) {
    if (model.startsWith(key) || model.includes(key)) return cost
  }
  // Default: assume mid-range cloud pricing
  return { input: 1, output: 5 }
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface UsageRecord {
  model: string
  nodeId: string
  inputTokens: number
  outputTokens: number
  estimatedCostUSD: number
  ts: number
}

export interface CostSummary {
  totalInputTokens: number
  totalOutputTokens: number
  totalCostUSD: number
  byModel: Record<string, { input: number; output: number; cost: number; calls: number }>
  byNode: Record<string, { input: number; output: number; cost: number; calls: number }>
  period: { from: number; to: number }
}

// ─── CostTracker ─────────────────────────────────────────────────────────────

export class CostTracker {
  private records: UsageRecord[] = []
  private budgetUSD: number
  private onBudgetAlert?: (current: number, budget: number) => void
  private readonly MAX_RECORDS = 10_000

  constructor(opts?: { budgetUSD?: number; onBudgetAlert?: (current: number, budget: number) => void }) {
    this.budgetUSD = opts?.budgetUSD ?? 100
    this.onBudgetAlert = opts?.onBudgetAlert
  }

  /**
   * Record a completed LLM call.
   */
  record(model: string, nodeId: string, inputTokens: number, outputTokens: number): UsageRecord {
    const cost = getModelCost(model)
    const estimatedCostUSD = (inputTokens * cost.input + outputTokens * cost.output) / 1_000_000

    const rec: UsageRecord = {
      model, nodeId, inputTokens, outputTokens, estimatedCostUSD, ts: Date.now(),
    }

    this.records.push(rec)
    if (this.records.length > this.MAX_RECORDS) {
      this.records = this.records.slice(-this.MAX_RECORDS / 2)
    }

    // Budget check
    const total = this.getTotalCost()
    if (total >= this.budgetUSD * 0.8 && this.onBudgetAlert) {
      this.onBudgetAlert(total, this.budgetUSD)
    }

    return rec
  }

  /**
   * Get total cost for all records.
   */
  getTotalCost(): number {
    return this.records.reduce((sum, r) => sum + r.estimatedCostUSD, 0)
  }

  /**
   * Get cost summary for a date range.
   */
  getSummary(from?: number, to?: number): CostSummary {
    const now = Date.now()
    const start = from ?? now - 24 * 60 * 60 * 1000 // default: last 24h
    const end = to ?? now

    const filtered = this.records.filter(r => r.ts >= start && r.ts <= end)

    const byModel: CostSummary['byModel'] = {}
    const byNode: CostSummary['byNode'] = {}
    let totalInput = 0, totalOutput = 0, totalCost = 0

    for (const r of filtered) {
      totalInput += r.inputTokens
      totalOutput += r.outputTokens
      totalCost += r.estimatedCostUSD

      // By model
      if (!byModel[r.model]) byModel[r.model] = { input: 0, output: 0, cost: 0, calls: 0 }
      byModel[r.model].input += r.inputTokens
      byModel[r.model].output += r.outputTokens
      byModel[r.model].cost += r.estimatedCostUSD
      byModel[r.model].calls++

      // By node
      if (!byNode[r.nodeId]) byNode[r.nodeId] = { input: 0, output: 0, cost: 0, calls: 0 }
      byNode[r.nodeId].input += r.inputTokens
      byNode[r.nodeId].output += r.outputTokens
      byNode[r.nodeId].cost += r.estimatedCostUSD
      byNode[r.nodeId].calls++
    }

    return {
      totalInputTokens: totalInput,
      totalOutputTokens: totalOutput,
      totalCostUSD: Math.round(totalCost * 10000) / 10000,
      byModel,
      byNode,
      period: { from: start, to: end },
    }
  }

  /**
   * Get summary for a specific node.
   */
  getNodeSummary(nodeId: string, from?: number, to?: number): CostSummary {
    const summary = this.getSummary(from, to)
    const nodeData = summary.byNode[nodeId]
    if (!nodeData) {
      return { ...summary, totalInputTokens: 0, totalOutputTokens: 0, totalCostUSD: 0, byModel: {}, byNode: {} }
    }
    return summary
  }

  /**
   * Set budget.
   */
  setBudget(usd: number): void {
    this.budgetUSD = usd
  }

  /**
   * Get raw record count.
   */
  get recordCount(): number {
    return this.records.length
  }
}

/** Singleton CostTracker */
export const costTracker = new CostTracker()
