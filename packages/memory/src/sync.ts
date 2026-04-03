// Hub 同步 — L3 网络记忆 push/pull，技能发现，协作发起

import type { MemoryEntry, NodeRef, CollabSessionState } from './types.js'

export class HubSync {
  constructor(
    private agentId: string,
    private hubUrl: string
  ) {}

  /** 推送记忆到 org L3 */
  async pushToOrg(entry: MemoryEntry): Promise<void> {
    try {
      const res = await fetch(`${this.hubUrl}/memory/broadcast`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
    } catch (err) {
      console.error('[sync] pushToOrg failed:', err)
    }
  }

  /** 从 Hub 拉取 org L3 记忆 */
  async pullFromOrg(): Promise<MemoryEntry[]> {
    try {
      const res = await fetch(`${this.hubUrl}/memory/org`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json() as { entries: MemoryEntry[] }
      return data.entries ?? []
    } catch (err) {
      console.error('[sync] pullFromOrg failed:', err)
      return []
    }
  }

  /** 注册自己的技能到 Hub */
  async registerSkills(name: string, skills: string[]): Promise<void> {
    try {
      const res = await fetch(`${this.hubUrl}/memory/skills`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodeId: this.agentId, name, skills }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
    } catch (err) {
      console.error('[sync] registerSkills failed:', err)
    }
  }

  /** 查找拥有某技能的 Agent */
  async findExpert(skill: string): Promise<NodeRef[]> {
    try {
      const res = await fetch(`${this.hubUrl}/memory/experts?skill=${encodeURIComponent(skill)}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json() as { experts: NodeRef[] }
      return data.experts ?? []
    } catch (err) {
      console.error('[sync] findExpert failed:', err)
      return []
    }
  }

  /** 发起协作会话 */
  async initCollab(peerId: string, intent: string, topic?: string): Promise<string> {
    const res = await fetch(`${this.hubUrl}/memory/collab/init`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initiatorId: this.agentId, peerId, intent, topic }),
    })
    if (!res.ok) throw new Error(`[sync] initCollab HTTP ${res.status}`)
    const data = await res.json() as { sessionId: string }
    return data.sessionId
  }

  /** 同步协作记忆到 Hub */
  async syncCollab(sessionId: string, entries: MemoryEntry[]): Promise<void> {
    try {
      const res = await fetch(`${this.hubUrl}/memory/collab/${sessionId}/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
    } catch (err) {
      console.error('[sync] syncCollab failed:', err)
    }
  }

  /** 结束协作，返回对方的教学条目 */
  async endCollab(sessionId: string, mode: string): Promise<MemoryEntry[]> {
    try {
      const res = await fetch(`${this.hubUrl}/memory/collab/${sessionId}/end`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json() as { entries: MemoryEntry[] }
      return data.entries ?? []
    } catch (err) {
      console.error('[sync] endCollab failed:', err)
      return []
    }
  }
}
