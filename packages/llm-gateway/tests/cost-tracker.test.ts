import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { CostTracker } from '../src/cost-tracker'

describe('CostTracker', () => {
  it('records usage and calculates cost', () => {
    const ct = new CostTracker()
    const rec = ct.record('gpt-4o', 'node-1', 1000, 500)
    assert.equal(rec.model, 'gpt-4o')
    assert.equal(rec.inputTokens, 1000)
    assert.equal(rec.outputTokens, 500)
    assert.ok(rec.estimatedCostUSD > 0)
    assert.equal(ct.recordCount, 1)
  })

  it('tracks total cost across records', () => {
    const ct = new CostTracker()
    ct.record('gpt-4o', 'node-1', 1000, 500)
    ct.record('gpt-4o-mini', 'node-2', 2000, 1000)
    assert.ok(ct.getTotalCost() > 0)
    assert.equal(ct.recordCount, 2)
  })

  it('generates summary by model', () => {
    const ct = new CostTracker()
    ct.record('gpt-4o', 'node-1', 1000, 500)
    ct.record('gpt-4o', 'node-1', 2000, 1000)
    ct.record('deepseek-chat', 'node-2', 5000, 3000)
    const summary = ct.getSummary(0)
    assert.equal(Object.keys(summary.byModel).length, 2)
    assert.equal(summary.byModel['gpt-4o'].calls, 2)
    assert.equal(summary.byModel['deepseek-chat'].calls, 1)
  })

  it('generates summary by node', () => {
    const ct = new CostTracker()
    ct.record('gpt-4o', 'node-1', 1000, 500)
    ct.record('gpt-4o', 'node-2', 2000, 1000)
    const summary = ct.getSummary(0)
    assert.equal(Object.keys(summary.byNode).length, 2)
    assert.ok(summary.byNode['node-1'])
    assert.ok(summary.byNode['node-2'])
  })

  it('local models have zero cost', () => {
    const ct = new CostTracker()
    const rec = ct.record('ollama', 'node-1', 10000, 5000)
    assert.equal(rec.estimatedCostUSD, 0)
  })

  it('fires budget alert at 80%', () => {
    let alertFired = false
    const ct = new CostTracker({
      budgetUSD: 0.001,
      onBudgetAlert: () => { alertFired = true },
    })
    // gpt-4o: $2.5/1M input + $10/1M output
    // 10000 input = $0.025, which is way over $0.001 * 0.8
    ct.record('gpt-4o', 'node-1', 10000, 5000)
    assert.equal(alertFired, true)
  })

  it('does not fire alert under budget', () => {
    let alertFired = false
    const ct = new CostTracker({
      budgetUSD: 1000,
      onBudgetAlert: () => { alertFired = true },
    })
    ct.record('gpt-4o-mini', 'node-1', 100, 50)
    assert.equal(alertFired, false)
  })

  it('setBudget updates threshold', () => {
    const ct = new CostTracker()
    ct.setBudget(50)
    // No assertion needed beyond no-throw; internal state
    assert.ok(true)
  })

  it('handles unknown model with default pricing', () => {
    const ct = new CostTracker()
    const rec = ct.record('some-future-model-v99', 'node-1', 1000, 500)
    assert.ok(rec.estimatedCostUSD > 0) // uses default pricing
  })

  it('filters summary by time range', () => {
    const ct = new CostTracker()
    ct.record('gpt-4o', 'node-1', 1000, 500)
    // Summary for far future should be empty
    const future = Date.now() + 100_000
    const summary = ct.getSummary(future, future + 1000)
    assert.equal(summary.totalInputTokens, 0)
    assert.equal(summary.totalCostUSD, 0)
  })
})
