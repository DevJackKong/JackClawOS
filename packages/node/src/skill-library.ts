/**
 * SkillLibrary — Voyager-style Skill Accumulation
 *
 * Agent 完成任务后自动提取可复用技能，存入技能库。
 * 下次遇到类似任务，先查技能库，直接复用已学会的能力。
 * 技能越用越强——根据反馈自动优化。
 */

import fs from 'fs'
import path from 'path'
import os from 'os'
import crypto from 'crypto'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Skill {
  id: string
  name: string
  description: string
  /** 可复用的函数体 / prompt 模板 / 工作流步骤 */
  code: string
  /** 输入参数描述 */
  inputSchema: Record<string, string>
  /** 输出描述 */
  outputSchema: Record<string, string>
  tags: string[]
  /** 成功率 0-1 */
  successRate: number
  usageCount: number
  /** 最近一次使用的反馈 */
  lastFeedback?: string
  createdAt: number
  updatedAt: number
  /** 来源：self=自己学的, shared=别人共享的 */
  origin: 'self' | 'shared'
  originNodeId?: string
}

export interface SkillExtractionResult {
  extracted: boolean
  skill?: Skill
  reason: string
}

export interface SkillMatch {
  skill: Skill
  relevance: number // 0-1
}

// ─── LLM Interface (duck-typed) ───────────────────────────────────────────────

interface LLMClient {
  chat(messages: Array<{ role: string; content: string }>, opts?: { model?: string; temperature?: number }): Promise<string>
}

// ─── SkillLibrary ─────────────────────────────────────────────────────────────

export class SkillLibrary {
  private skills: Map<string, Skill> = new Map()
  private storePath: string

  constructor(
    private nodeId: string,
    private llm?: LLMClient
  ) {
    this.storePath = path.join(os.homedir(), '.jackclaw', 'skills', nodeId)
    fs.mkdirSync(this.storePath, { recursive: true })
    this.load()
  }

  // ─── 技能提取（任务完成后调用）─────────────────────────────────────────────

  async extractSkill(taskDescription: string, taskResult: string, success: boolean): Promise<SkillExtractionResult> {
    if (!success) {
      return { extracted: false, reason: 'Task failed, no skill to extract' }
    }

    if (!this.llm) {
      return { extracted: false, reason: 'No LLM client available' }
    }

    const prompt = `You are a skill extraction engine. Analyze the following completed task and extract a reusable skill if applicable.

Task: ${taskDescription}

Result: ${taskResult.slice(0, 2000)}

Rules:
1. Only extract if the task contains a reusable pattern (not one-off work)
2. The skill should be generalizable to similar future tasks
3. Return JSON only, no markdown

Return JSON:
{
  "extractable": true/false,
  "name": "skill name (concise, action-oriented)",
  "description": "what this skill does",
  "code": "reusable prompt template or step-by-step procedure",
  "inputSchema": {"param1": "description", ...},
  "outputSchema": {"output1": "description", ...},
  "tags": ["tag1", "tag2"]
}

If not extractable, return: {"extractable": false, "reason": "why"}`

    try {
      const response = await this.llm.chat([{ role: 'user', content: prompt }], { temperature: 0.2 })
      const parsed = JSON.parse(response.replace(/```json?\n?/g, '').replace(/```/g, '').trim())

      if (!parsed.extractable) {
        return { extracted: false, reason: parsed.reason || 'Not extractable' }
      }

      const skill: Skill = {
        id: crypto.randomUUID(),
        name: parsed.name,
        description: parsed.description,
        code: parsed.code,
        inputSchema: parsed.inputSchema || {},
        outputSchema: parsed.outputSchema || {},
        tags: parsed.tags || [],
        successRate: 1.0,
        usageCount: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        origin: 'self',
      }

      // 检查是否已有类似技能，有则合并
      const existing = this.findSimilar(skill.name, skill.tags)
      if (existing) {
        existing.code = skill.code
        existing.description = skill.description
        existing.updatedAt = Date.now()
        existing.usageCount++
        this.save()
        return { extracted: true, skill: existing, reason: 'Merged with existing skill' }
      }

      this.skills.set(skill.id, skill)
      this.save()
      return { extracted: true, skill, reason: 'New skill extracted' }
    } catch (e) {
      return { extracted: false, reason: `Extraction failed: ${(e as Error).message}` }
    }
  }

  // ─── 技能检索（任务开始前调用）─────────────────────────────────────────────

  async searchSkills(taskDescription: string, limit = 3): Promise<SkillMatch[]> {
    if (this.skills.size === 0) return []

    // 快速关键词匹配
    const words = taskDescription.toLowerCase().split(/\s+/)
    const scored: SkillMatch[] = []

    for (const skill of this.skills.values()) {
      let relevance = 0
      const skillText = `${skill.name} ${skill.description} ${skill.tags.join(' ')}`.toLowerCase()

      for (const word of words) {
        if (word.length > 2 && skillText.includes(word)) {
          relevance += 1 / words.length
        }
      }

      // tag 精确匹配加分
      for (const tag of skill.tags) {
        if (taskDescription.toLowerCase().includes(tag.toLowerCase())) {
          relevance += 0.2
        }
      }

      // 成功率加权
      relevance *= skill.successRate

      if (relevance > 0.1) {
        scored.push({ skill, relevance: Math.min(relevance, 1) })
      }
    }

    // 如果关键词匹配不够且有 LLM，用 LLM 做语义匹配
    if (scored.length < limit && this.llm && this.skills.size > 0) {
      try {
        const skillList = Array.from(this.skills.values())
          .map(s => `[${s.id}] ${s.name}: ${s.description}`)
          .join('\n')

        const response = await this.llm.chat([{
          role: 'user',
          content: `Given this task: "${taskDescription}"

Which of these skills are relevant? Return JSON array of {id, relevance(0-1)}. Max ${limit} results.

Skills:
${skillList}`
        }], { temperature: 0 })

        const matches: Array<{ id: string; relevance: number }> = JSON.parse(
          response.replace(/```json?\n?/g, '').replace(/```/g, '').trim()
        )

        for (const m of matches) {
          const skill = this.skills.get(m.id)
          if (skill && !scored.find(s => s.skill.id === m.id)) {
            scored.push({ skill, relevance: m.relevance })
          }
        }
      } catch { /* fallback to keyword results */ }
    }

    return scored
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, limit)
  }

  // ─── 技能使用（注入任务上下文）─────────────────────────────────────────────

  useSkill(skillId: string): Skill | undefined {
    const skill = this.skills.get(skillId)
    if (skill) {
      skill.usageCount++
      skill.updatedAt = Date.now()
      this.save()
    }
    return skill
  }

  // ─── 技能反馈（任务完成后更新成功率）───────────────────────────────────────

  feedbackSkill(skillId: string, success: boolean, feedback?: string): void {
    const skill = this.skills.get(skillId)
    if (!skill) return

    // 指数移动平均更新成功率
    const alpha = 0.3
    skill.successRate = alpha * (success ? 1 : 0) + (1 - alpha) * skill.successRate
    skill.lastFeedback = feedback
    skill.updatedAt = Date.now()
    this.save()
  }

  // ─── 技能进化（LLM 优化技能代码）──────────────────────────────────────────

  async evolveSkill(skillId: string): Promise<boolean> {
    const skill = this.skills.get(skillId)
    if (!skill || !this.llm) return false
    if (skill.usageCount < 3) return false // 至少用过3次才进化

    const prompt = `This skill has been used ${skill.usageCount} times with ${Math.round(skill.successRate * 100)}% success rate.

Name: ${skill.name}
Current code/procedure:
${skill.code}

Last feedback: ${skill.lastFeedback || 'none'}

Improve this skill to be more robust and effective. Return only the improved code/procedure, nothing else.`

    try {
      const improved = await this.llm.chat([{ role: 'user', content: prompt }], { temperature: 0.3 })
      skill.code = improved.trim()
      skill.updatedAt = Date.now()
      this.save()
      return true
    } catch {
      return false
    }
  }

  // ─── 技能共享（导出给 Hub）────────────────────────────────────────────────

  exportForSharing(): Skill[] {
    return Array.from(this.skills.values())
      .filter(s => s.successRate > 0.7 && s.usageCount >= 2)
  }

  importSharedSkill(skill: Skill): void {
    skill.origin = 'shared'
    skill.originNodeId = skill.originNodeId || 'unknown'
    this.skills.set(skill.id, skill)
    this.save()
  }

  // ─── 查询 ──────────────────────────────────────────────────────────────────

  getAll(): Skill[] {
    return Array.from(this.skills.values())
  }

  getById(id: string): Skill | undefined {
    return this.skills.get(id)
  }

  getStats(): { total: number; avgSuccessRate: number; totalUsage: number } {
    const all = this.getAll()
    return {
      total: all.length,
      avgSuccessRate: all.length ? all.reduce((s, sk) => s + sk.successRate, 0) / all.length : 0,
      totalUsage: all.reduce((s, sk) => s + sk.usageCount, 0),
    }
  }

  // ─── 内部方法 ──────────────────────────────────────────────────────────────

  private findSimilar(name: string, tags: string[]): Skill | undefined {
    const nameLower = name.toLowerCase()
    for (const skill of this.skills.values()) {
      if (skill.name.toLowerCase() === nameLower) return skill
      const tagOverlap = skill.tags.filter(t => tags.includes(t)).length
      if (tagOverlap >= 2 && skill.name.toLowerCase().includes(nameLower.split(' ')[0])) {
        return skill
      }
    }
    return undefined
  }

  private save(): void {
    const data = Array.from(this.skills.values())
    fs.writeFileSync(
      path.join(this.storePath, 'skills.json'),
      JSON.stringify(data, null, 2)
    )
  }

  private load(): void {
    const filePath = path.join(this.storePath, 'skills.json')
    if (!fs.existsSync(filePath)) return
    try {
      const data: Skill[] = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
      for (const skill of data) {
        this.skills.set(skill.id, skill)
      }
    } catch { /* corrupted file, start fresh */ }
  }
}
