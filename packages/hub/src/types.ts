// JackClaw Hub - Type Definitions

export interface RegisteredNode {
  nodeId: string
  name: string
  role: string
  publicKey: string         // PEM - node's public key
  registeredAt: number
  lastReportAt?: number
  callbackUrl?: string      // Node 暴露的 HTTP endpoint（用于 Hub→Node 任务/规划转发）
}

export interface NodeRegistry {
  nodes: Record<string, RegisteredNode>
  updatedAt: number
}

export interface ReportEntry {
  nodeId: string
  messageId: string
  timestamp: number
  summary: string
  period: string
  visibility: 'full' | 'summary_only' | 'private'
  data: Record<string, unknown>
}

export interface DailyReports {
  date: string              // YYYY-MM-DD
  nodeId: string
  reports: ReportEntry[]
}

export interface SummaryResponse {
  date: string
  byRole: Record<string, RoleSummary>
  totalNodes: number
  reportingNodes: number
}

export interface RoleSummary {
  role: string
  nodes: Array<{
    nodeId: string
    name: string
    summary: string
    period: string
    reportedAt: number
  }>
}

export interface JWTPayload {
  nodeId: string
  role: string
  iat?: number
  exp?: number
}

export interface TenantContext {
  tenantId: string
  orgId?: string
  workspaceId?: string
  userId: string
  role: string
}

declare global {
  namespace Express {
    interface Request {
      tenantContext?: TenantContext
    }
  }
}
