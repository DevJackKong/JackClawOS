/**
 * OwnerMemory — Agent 主人记忆区
 *
 * 设计原则：
 * 1. 与 WorkMemory 完全隔离 — 工作调用不读此区，情感模块不读工作区
 * 2. 被动积累 — 从日常对话中静默提取，不打扰主人
 * 3. 未来情感模块的数据源 — 结构化存储，随时可接入
 * 4. 主人不可见（默认） — Agent 的私人观察，提升自然度
 */

import fs from 'fs'
import path from 'path'
import os from 'os'

// ─── 类型定义 ─────────────────────────────────────────────────────────────────

export type OwnerMemoryType =
  | 'personality'      // 性格特征（稳定，慢变）
  | 'relationship'     // 与 Agent 的关系状态（信任度/合作次数）
  | 'emotional-state'  // 当前情绪/状态（快变，有 TTL）
  | 'preference'       // 沟通偏好（活跃时间/风格）
  | 'milestone'        // 重要时刻（永久保留）
  | 'private-note'     // Agent 的私人观察

export interface OwnerMemoryEntry {
  id: string
  type: OwnerMemoryType
  content: string
  confidence: number    // 0-1，越高越确定
  source: 'observed'    // 从对话中提取
    | 'inferred'        // AI 推断
    | 'explicit'        // 主人明确说过
  createdAt: number
  updatedAt: number
  expiresAt?: number    // emotional-state 有 TTL（如 24h）
  tags?: string[]
}

export interface RelationshipStats {
  trustScore: number         // 0-100
  totalInteractions: number
  tasksSent: number
  tasksCompleted: number
  tasksRejected: number
  lastActiveAt: number
  firstMet: number
  longestInactiveDays: number
}

export interface OwnerProfile {
  nodeId: string
  ownerName: string
  stats: RelationshipStats
  entries: OwnerMemoryEntry[]
  lastUpdated: number
}

// ─── OwnerMemory ──────────────────────────────────────────────────────────────

export class OwnerMemory {
  private profile: OwnerProfile
  private dirty = false
  private saveTimer?: ReturnType<typeof setTimeout>

  constructor(
    private nodeId: string,
    private ownerName: string,
    private storePath = path.join(os.homedir(), '.jackclaw', 'owner-memory'),
  ) {
    fs.mkdirSync(storePath, { recursive: true })
    this.profile = this.load()
  }

  // ─── 读取 ──────────────────────────────────────────────────────────────────

  /** 获取指定类型的记忆条目 */
  get(type?: OwnerMemoryType): OwnerMemoryEntry[] {
    const now = Date.now()
    const entries = this.profile.entries
      .filter(e => !e.expiresAt || e.expiresAt > now)  // 过滤已过期
      .filter(e => !type || e.type === type)
      .sort((a, b) => b.updatedAt - a.updatedAt)
    return entries
  }

  /** 获取关系统计 */
  getStats(): RelationshipStats {
    return { ...this.profile.stats }
  }

  /**
   * 为情感模块生成摘要快照
   * 返回结构化的主人画像，供情感模块直接使用
   */
  getEmotionSnapshot(): {
    personality: string[]
    currentState: string | null
    preferences: string[]
    trustLevel: 'low' | 'medium' | 'high' | 'deep'
    relationshipAge: number  // days
    recentMilestones: string[]
  } {
    const personality = this.get('personality').slice(0, 5).map(e => e.content)
    const state = this.get('emotional-state')[0]?.content ?? null
    const preferences = this.get('preference').slice(0, 5).map(e => e.content)
    const stats = this.profile.stats

    const trustLevel =
      stats.trustScore >= 80 ? 'deep'
      : stats.trustScore >= 60 ? 'high'
      : stats.trustScore >= 40 ? 'medium'
      : 'low'

    const relationshipAge = Math.floor(
      (Date.now() - stats.firstMet) / (1000 * 60 * 60 * 24)
    )

    const recentMilestones = this.get('milestone')
      .slice(0, 3)
      .map(e => e.content)

    return { personality, currentState: state, preferences, trustLevel, relationshipAge, recentMilestones }
  }

  // ─── 写入 ──────────────────────────────────────────────────────────────────

  /** 添加/更新记忆条目 */
  upsert(entry: Omit<OwnerMemoryEntry, 'id' | 'createdAt' | 'updatedAt'>): void {
    const now = Date.now()

    // 同类型+相同内容：更新 confidence
    const existing = this.profile.entries.find(
      e => e.type === entry.type && e.content === entry.content
    )

    if (existing) {
      existing.confidence = Math.min(1, existing.confidence + 0.1)
      existing.updatedAt = now
      if (entry.expiresAt) existing.expiresAt = entry.expiresAt
    } else {
      this.profile.entries.push({
        ...entry,
        id: `om-${now}-${Math.random().toString(36).slice(2, 8)}`,
        createdAt: now,
        updatedAt: now,
      })
    }

    this.profile.lastUpdated = now
    this.scheduleSave()
  }

  /** 从一条消息中提取并更新 owner memory（静默后台调用） */
  observeMessage(opts: {
    content: string
    direction: 'incoming' | 'outgoing'  // 主人发来 or Agent 发出
    type: string
    responseTimeMs?: number             // 主人回复速度
  }): void {
    const now = Date.now()
    const stats = this.profile.stats
    stats.totalInteractions++
    stats.lastActiveAt = now

    // 更新活跃时间偏好（按小时统计）
    const hour = new Date().getHours()
    this.upsert({
      type: 'preference',
      content: `活跃时段：${hour}:00-${hour + 1}:00`,
      confidence: 0.3,
      source: 'observed',
      tags: ['active-hours'],
    })

    // 回复速度 → 情绪状态推断
    if (opts.direction === 'incoming' && opts.responseTimeMs) {
      if (opts.responseTimeMs < 30000) {
        this.upsert({
          type: 'emotional-state',
          content: '响应迅速，当前状态活跃',
          confidence: 0.6,
          source: 'inferred',
          expiresAt: now + 4 * 60 * 60 * 1000,  // 4h TTL
        })
      } else if (opts.responseTimeMs > 3600000) {
        this.upsert({
          type: 'emotional-state',
          content: '响应较慢（>1h），可能忙碌或休息',
          confidence: 0.5,
          source: 'inferred',
          expiresAt: now + 2 * 60 * 60 * 1000,  // 2h TTL
        })
      }
    }

    // 消息长度 → 沟通风格
    const wordCount = opts.content.length
    if (wordCount < 20 && opts.direction === 'incoming') {
      this.upsert({
        type: 'personality',
        content: '偏好简短指令，不喜欢冗长回复',
        confidence: 0.4,
        source: 'inferred',
      })
    }

    this.scheduleSave()
  }

  /** 任务完成 → 更新信任度和关系统计 */
  recordTaskOutcome(outcome: 'completed' | 'rejected' | 'approved'): void {
    const stats = this.profile.stats
    if (outcome === 'completed') {
      stats.tasksCompleted++
      stats.trustScore = Math.min(100, stats.trustScore + 1)
    } else if (outcome === 'rejected') {
      stats.tasksRejected++
      stats.trustScore = Math.max(0, stats.trustScore - 3)
    } else if (outcome === 'approved') {
      stats.trustScore = Math.min(100, stats.trustScore + 2)
    }
    this.scheduleSave()
  }

  /** 记录对话对象的情绪模式（供 EmotionSensor 调用） */
  recordEmotionPattern(opts: {
    sentiment: 'positive' | 'negative' | 'neutral' | 'urgent'
    confidence: number
    keywords?: string[]
    threadId?: string
  }): void {
    const now = Date.now()
    const ttl = opts.sentiment === 'neutral' ? 0 : 6 * 60 * 60 * 1000  // 6h TTL，中性不过期

    const keywordStr = opts.keywords?.length ? `，关键词：${opts.keywords.slice(0, 5).join('/')}` : ''
    const contentMap = {
      positive: `对话情绪积极${keywordStr}`,
      negative: `对话情绪负面${keywordStr}`,
      urgent:   `对话有紧迫感${keywordStr}`,
      neutral:  `对话情绪平稳`,
    }

    this.upsert({
      type: 'emotional-state',
      content: contentMap[opts.sentiment],
      confidence: opts.confidence,
      source: 'inferred',
      expiresAt: ttl > 0 ? now + ttl : undefined,
      tags: ['emotion-sensor', opts.sentiment, ...(opts.threadId ? [`thread:${opts.threadId}`] : [])],
    })
  }

  /** 记录里程碑 */
  recordMilestone(content: string): void {
    this.upsert({
      type: 'milestone',
      content: `${new Date().toLocaleDateString('zh-CN')} ${content}`,
      confidence: 1,
      source: 'explicit',
    })
  }

  // ─── 持久化 ────────────────────────────────────────────────────────────────

  private load(): OwnerProfile {
    const file = this.profilePath()
    try {
      return JSON.parse(fs.readFileSync(file, 'utf-8'))
    } catch {
      return {
        nodeId: this.nodeId,
        ownerName: this.ownerName,
        stats: {
          trustScore: 50,
          totalInteractions: 0,
          tasksSent: 0,
          tasksCompleted: 0,
          tasksRejected: 0,
          lastActiveAt: Date.now(),
          firstMet: Date.now(),
          longestInactiveDays: 0,
        },
        entries: [],
        lastUpdated: Date.now(),
      }
    }
  }

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => this.flush(), 2000)  // 2s 防抖
  }

  flush(): void {
    fs.writeFileSync(this.profilePath(), JSON.stringify(this.profile, null, 2))
    this.dirty = false
  }

  private profilePath(): string {
    return path.join(this.storePath, `${this.nodeId}.json`)
  }
}

// 单例工厂
const instances = new Map<string, OwnerMemory>()
export function getOwnerMemory(nodeId: string, ownerName = 'owner'): OwnerMemory {
  if (!instances.has(nodeId)) {
    instances.set(nodeId, new OwnerMemory(nodeId, ownerName))
  }
  return instances.get(nodeId)!
}
