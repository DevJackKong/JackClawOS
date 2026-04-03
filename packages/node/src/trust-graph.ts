import fs from "fs"
import path from "path"
import os from "os"

export type TrustLevel = "unknown" | "contact" | "colleague" | "trusted" | "deep"
export type TrustEventType =
  | "task-completed" | "task-approved" | "task-rejected" | "task-timeout"
  | "collab-started" | "collab-completed" | "manual-boost" | "manual-revoke"

const SCORE_DELTA: Record<TrustEventType, number> = {
  "task-completed": 2, "task-approved": 3, "task-rejected": -5,
  "task-timeout": -2, "collab-started": 1, "collab-completed": 3,
  "manual-boost": 10, "manual-revoke": -50,
}

function scoreToLevel(score: number): TrustLevel {
  if (score >= 95) return "deep"
  if (score >= 80) return "trusted"
  if (score >= 50) return "colleague"
  if (score >= 20) return "contact"
  return "unknown"
}

export interface TrustEdge {
  from: string; to: string
  score: number; level: TrustLevel
  interactions: number
  lastInteractedAt: number
  history: Array<{ type: TrustEventType; delta: number; reason?: string; timestamp: number }>
}

export class TrustGraph {
  private edges = new Map<string, TrustEdge>()
  private storePath: string

  constructor(private nodeId: string) {
    this.storePath = path.join(os.homedir(), ".jackclaw", "trust", nodeId)
    fs.mkdirSync(this.storePath, { recursive: true })
    this.load()
  }

  record(to: string, type: TrustEventType, reason?: string): void {
    const key = `${this.nodeId}→${to}`
    const edge = this.edges.get(key) ?? {
      from: this.nodeId, to, score: 50, level: "contact" as TrustLevel,
      interactions: 0, lastInteractedAt: Date.now(), history: [],
    }
    const delta = SCORE_DELTA[type]
    edge.score = Math.max(0, Math.min(100, edge.score + delta))
    edge.level = scoreToLevel(edge.score)
    edge.interactions++
    edge.lastInteractedAt = Date.now()
    edge.history = [...edge.history.slice(-49), { type, delta, reason, timestamp: Date.now() }]
    this.edges.set(key, edge)
    this.save()
  }

  getEdge(to: string): TrustEdge | null {
    return this.edges.get(`${this.nodeId}→${to}`) ?? null
  }

  getTrustLevel(to: string): TrustLevel {
    return this.getEdge(to)?.level ?? "unknown"
  }

  canAutoAccept(to: string): boolean {
    const level = this.getTrustLevel(to)
    return level === "trusted" || level === "deep"
  }

  getTopTrusted(limit = 5): TrustEdge[] {
    return [...this.edges.values()]
      .filter(e => e.from === this.nodeId)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
  }

  export(): TrustEdge[] {
    return [...this.edges.values()].filter(e => e.from === this.nodeId)
  }

  private load(): void {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(this.storePath, "graph.json"), "utf-8"))
      for (const e of data) this.edges.set(`${e.from}→${e.to}`, e)
    } catch {}
  }

  private save(): void {
    fs.writeFileSync(path.join(this.storePath, "graph.json"), JSON.stringify([...this.edges.values()], null, 2))
  }
}
