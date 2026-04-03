/**
 * OrgMemory — 组织级共享记忆（Hub 存储，所有 Node 可读）
 * 与 WorkMemory（Node私有）不同：
 * - 存在 Hub
 * - 只存项目级/决策级知识
 * - CEO 写，高管可写，员工 Node 只读
 * - 上限 500 条
 */
import fs from "fs"
import path from "path"
import os from "os"

export type OrgMemoryType = "decision" | "project" | "lesson" | "reference" | "norm"

export interface OrgMemoryEntry {
  id: string
  type: OrgMemoryType
  content: string
  author: string      // 写入的 nodeId
  createdAt: number
  tags?: string[]
}

export class OrgMemoryStore {
  private entries: OrgMemoryEntry[] = []
  private storePath = path.join(os.homedir(), ".jackclaw", "hub", "org-memory.jsonl")

  constructor() {
    this.load()
  }

  add(entry: Omit<OrgMemoryEntry, "id" | "createdAt">): OrgMemoryEntry {
    const e: OrgMemoryEntry = { ...entry, id: crypto.randomUUID(), createdAt: Date.now() }
    this.entries.push(e)
    if (this.entries.length > 500) this.entries.splice(0, this.entries.length - 500)
    this.flush()
    return e
  }

  query(type?: OrgMemoryType, limit = 20): OrgMemoryEntry[] {
    return this.entries
      .filter(e => !type || e.type === type)
      .slice(-limit)
      .reverse()
  }

  private load() {
    try {
      fs.mkdirSync(path.dirname(this.storePath), { recursive: true })
      const lines = fs.readFileSync(this.storePath, "utf-8").split("\n").filter(Boolean)
      this.entries = lines.map(l => JSON.parse(l))
    } catch {}
  }

  private flush() {
    fs.writeFileSync(this.storePath, this.entries.map(e => JSON.stringify(e)).join("\n") + "\n")
  }
}
