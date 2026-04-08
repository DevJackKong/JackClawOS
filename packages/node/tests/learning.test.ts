/**
 * SkillLibrary + Reflexion Tests
 */

import { SkillLibrary } from '../src/skill-library'
import { Reflexion } from '../src/reflexion'
import fs from 'fs'
import path from 'path'
import os from 'os'

// ─── Test helpers ─────────────────────────────────────────────────────────────

const TEST_NODE = `test-node-${Date.now()}`
const TEST_SKILLS_DIR = path.join(os.homedir(), '.jackclaw', 'skills', TEST_NODE)
const TEST_REFLEXION_DIR = path.join(os.homedir(), '.jackclaw', 'reflexion', TEST_NODE)

function cleanup() {
  try { fs.rmSync(TEST_SKILLS_DIR, { recursive: true, force: true }) } catch {}
  try { fs.rmSync(TEST_REFLEXION_DIR, { recursive: true, force: true }) } catch {}
}

// Mock LLM
class MockLLM {
  private responses: string[] = []

  setResponse(json: object) {
    this.responses.push(JSON.stringify(json))
  }

  async chat(_messages: Array<{ role: string; content: string }>): Promise<string> {
    return this.responses.shift() || '{}'
  }
}

// ─── SkillLibrary Tests ──────────────────────────────────────────────────────

describe('SkillLibrary', () => {
  afterAll(cleanup)

  it('should initialize empty', () => {
    const lib = new SkillLibrary(TEST_NODE)
    expect(lib.getAll()).toHaveLength(0)
    expect(lib.getStats().total).toBe(0)
  })

  it('should extract skill from successful task', async () => {
    const llm = new MockLLM()
    llm.setResponse({
      extractable: true,
      name: 'API Error Handling',
      description: 'Add retry logic with exponential backoff to API calls',
      code: 'async function retryFetch(url, maxRetries=3) { ... }',
      inputSchema: { url: 'API endpoint', maxRetries: 'number' },
      outputSchema: { response: 'API response' },
      tags: ['api', 'error-handling', 'retry'],
    })

    const lib = new SkillLibrary(TEST_NODE, llm)
    const result = await lib.extractSkill(
      'Add error handling to the payment API',
      'Successfully added try-catch with retry logic',
      true
    )

    expect(result.extracted).toBe(true)
    expect(result.skill).toBeDefined()
    expect(result.skill!.name).toBe('API Error Handling')
    expect(result.skill!.tags).toContain('api')
    expect(lib.getAll()).toHaveLength(1)
  })

  it('should not extract from failed tasks', async () => {
    const llm = new MockLLM()
    const lib = new SkillLibrary(TEST_NODE, llm)
    const result = await lib.extractSkill('Build something', 'Error: failed', false)
    expect(result.extracted).toBe(false)
  })

  it('should search skills by keywords', async () => {
    const lib = new SkillLibrary(TEST_NODE)
    // Previous test left a skill with tags ['api', 'error-handling', 'retry']
    const matches = await lib.searchSkills('api error handling')
    expect(matches.length).toBeGreaterThan(0)
    expect(matches[0].skill.name).toBe('API Error Handling')
  })

  it('should track usage and feedback', () => {
    const lib = new SkillLibrary(TEST_NODE)
    const skills = lib.getAll()
    expect(skills.length).toBeGreaterThan(0)

    const skillId = skills[0].id
    lib.useSkill(skillId)
    lib.feedbackSkill(skillId, true, 'Worked perfectly')

    const updated = lib.getById(skillId)
    expect(updated).toBeDefined()
    expect(updated!.usageCount).toBeGreaterThan(0)
    expect(updated!.lastFeedback).toBe('Worked perfectly')
  })

  it('should export/import skills', () => {
    const lib1 = new SkillLibrary(TEST_NODE)
    const exportable = lib1.exportForSharing()
    // May not have skills meeting threshold yet, but function should work
    expect(Array.isArray(exportable)).toBe(true)

    // Test import
    const lib2 = new SkillLibrary(`${TEST_NODE}-peer`)
    const skill = lib1.getAll()[0]
    if (skill) {
      lib2.importSharedSkill({ ...skill, originNodeId: TEST_NODE })
      expect(lib2.getAll()).toHaveLength(1)
      expect(lib2.getAll()[0].origin).toBe('shared')
    }

    // Cleanup peer
    try {
      fs.rmSync(path.join(os.homedir(), '.jackclaw', 'skills', `${TEST_NODE}-peer`), { recursive: true })
    } catch {}
  })

  it('should persist across instances', () => {
    const lib1 = new SkillLibrary(TEST_NODE)
    const count1 = lib1.getAll().length

    const lib2 = new SkillLibrary(TEST_NODE) // new instance, same nodeId
    expect(lib2.getAll().length).toBe(count1)
  })
})

// ─── Reflexion Tests ─────────────────────────────────────────────────────────

describe('Reflexion', () => {
  afterAll(cleanup)

  it('should initialize empty', () => {
    const engine = new Reflexion(TEST_NODE)
    expect(engine.getAll()).toHaveLength(0)
    expect(engine.getStats().totalReflections).toBe(0)
  })

  it('should reflect on successful task', async () => {
    const llm = new MockLLM()
    llm.setResponse({
      score: 85,
      whatWorked: ['Clean API design', 'Good error messages'],
      whatFailed: [],
      lessonsLearned: ['Always validate input params'],
      improvementPlan: 'Add input validation middleware',
    })

    const engine = new Reflexion(TEST_NODE, llm)
    const entry = await engine.reflect({
      taskId: 'task-001',
      taskDescription: 'Build REST API for user management',
      taskResult: 'Successfully built CRUD API with 5 endpoints',
      success: true,
      duration: 30000,
      tokenUsage: { input: 500, output: 1500 },
    })

    expect(entry.success).toBe(true)
    expect(entry.score).toBe(85)
    expect(entry.lessonsLearned).toContain('Always validate input params')
    expect(engine.getAll()).toHaveLength(1)
  })

  it('should reflect on failed task', async () => {
    const llm = new MockLLM()
    llm.setResponse({
      score: 25,
      whatWorked: [],
      whatFailed: ['Timeout on large dataset'],
      lessonsLearned: ['Implement pagination for large queries'],
      improvementPlan: 'Add cursor-based pagination',
    })

    const engine = new Reflexion(TEST_NODE, llm)
    const entry = await engine.reflect({
      taskId: 'task-002',
      taskDescription: 'Query all users from database',
      taskResult: 'Error: timeout after 30s',
      success: false,
      duration: 30000,
      tokenUsage: { input: 200, output: 100 },
    })

    expect(entry.success).toBe(false)
    expect(entry.score).toBe(25)
    expect(entry.whatFailed).toContain('Timeout on large dataset')
  })

  it('should build reflection context for similar tasks', () => {
    const engine = new Reflexion(TEST_NODE)
    const context = engine.getReflexionContext('Build REST API')

    expect(context.entries.length).toBeGreaterThan(0)
    expect(context.summary).toBeTruthy()
  })

  it('should detect failure chains', async () => {
    const engine = new Reflexion(TEST_NODE)

    // Add another failure on similar task
    const entry = await engine.reflect({
      taskId: 'task-003',
      taskDescription: 'Query users with pagination',
      taskResult: 'Error: cursor invalid',
      success: false,
      duration: 5000,
      tokenUsage: { input: 100, output: 50 },
    })

    // Now get context — should detect multiple failures
    const context = engine.getReflexionContext('Query users')
    const failures = context.entries.filter(e => !e.success)
    expect(failures.length).toBeGreaterThanOrEqual(1)
  })

  it('should produce fallback reflection without LLM', async () => {
    const engine = new Reflexion(`${TEST_NODE}-nollm`)
    const entry = await engine.reflect({
      taskId: 'task-004',
      taskDescription: 'Simple task',
      taskResult: 'Done',
      success: true,
      duration: 1000,
      tokenUsage: { input: 10, output: 10 },
    })

    expect(entry.score).toBe(70) // default success score
    expect(entry.success).toBe(true)

    // Cleanup
    try {
      fs.rmSync(path.join(os.homedir(), '.jackclaw', 'reflexion', `${TEST_NODE}-nollm`), { recursive: true })
    } catch {}
  })

  it('should compute stats', () => {
    const engine = new Reflexion(TEST_NODE)
    const stats = engine.getStats()

    expect(stats.totalReflections).toBeGreaterThan(0)
    expect(stats.avgScore).toBeGreaterThan(0)
    expect(typeof stats.successRate).toBe('number')
  })

  it('should persist across instances', () => {
    const engine1 = new Reflexion(TEST_NODE)
    const count = engine1.getAll().length

    const engine2 = new Reflexion(TEST_NODE)
    expect(engine2.getAll().length).toBe(count)
  })
})
