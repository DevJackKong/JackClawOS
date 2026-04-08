export type AgentSessionCommand =
  | '/health'
  | '/task'
  | '/result'
  | '/pop'
  | '/fs/list'
  | '/fs/read'
  | '/fs/write'
  | '/fs/find'
  | '/fs/download'
  | '/fs/tail'
  | '/fs/read_bytes'
  | '/semantic'

export interface AgentSessionEnvelope<TArgs = any> {
  sessionId: string
  messageId: string
  from: string
  to: string
  command: AgentSessionCommand
  args: TArgs
  traceId?: string
  timestamp: number
}

export interface AgentSessionSuccess<TData = any> {
  ok: true
  sessionId: string
  messageId: string
  data: TData
  error: null
}

export interface AgentSessionFailure {
  ok: false
  sessionId: string
  messageId: string
  data: null
  error: {
    code: string
    message: string
  }
}

export type AgentSessionResponse<TData = any> = AgentSessionSuccess<TData> | AgentSessionFailure

export interface AgentHealthArgs {}
export interface AgentTaskArgs {
  taskId?: string
  goal: string
  input?: unknown
}
export interface AgentResultArgs {
  taskId: string
  ok: boolean
  output?: unknown
  error?: string
}
export interface AgentPopArgs {
  limit?: number
}

export interface AgentFsListArgs { path: string }
export interface AgentFsReadArgs { path: string; encoding?: 'utf8' | 'base64' }
export interface AgentFsWriteArgs { path: string; content: string; encoding?: 'utf8' | 'base64' }
export interface AgentFsFindArgs { path: string; pattern: string }
export interface AgentFsDownloadArgs { fileId: string }
export interface AgentFsTailArgs { path: string; lines?: number }
export interface AgentFsReadBytesArgs { path: string; offset?: number; length: number }

export interface AgentSemanticArgs {
  protocol: string
  input: unknown
}
