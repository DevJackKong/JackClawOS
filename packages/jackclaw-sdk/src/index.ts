/**
 * @jackclaw/sdk — JackClaw Plugin Development SDK
 *
 * The minimal surface area for building JackClaw plugins and nodes.
 */

// ─── Core Types ──────────────────────────────────────────────────────────────

export interface NodeInfo {
  /** Node unique identifier */
  id: string
  /** Human-readable name */
  name: string
  /** Node version string */
  version: string
  /** Tags/labels assigned to this node */
  tags: string[]
  /** Arbitrary node metadata */
  metadata: Record<string, unknown>
}

export interface PluginInfo {
  name: string
  version: string
  description?: string
}

export interface CommandResult {
  /** Text to send back to the requester */
  text?: string
  /** Structured data (attached to message metadata) */
  data?: Record<string, unknown>
  /** Markdown-formatted text */
  markdown?: string
  /** Optional list of items (rendered as a table/list in clients) */
  items?: Array<{ label: string; value: string | number | boolean }>
}

export interface ReportPayload {
  summary: string
  items?: Array<{ label: string; value: string | number | boolean }>
  data?: Record<string, unknown>
}

// ─── Context Objects ──────────────────────────────────────────────────────────

export interface Logger {
  debug(msg: string, ...args: unknown[]): void
  info(msg: string, ...args: unknown[]): void
  warn(msg: string, ...args: unknown[]): void
  error(msg: string, ...args: unknown[]): void
}

export interface CommandContext {
  /** The node this plugin is running on */
  node: NodeInfo
  /** Plugin metadata */
  plugin: PluginInfo
  /** Command arguments (tokens after the command name) */
  args: string[]
  /** Raw input string */
  input: string
  /** Caller's user id (if available) */
  userId?: string
  /** Caller's display name */
  userName?: string
  /** Logger scoped to this plugin */
  log: Logger
  /** Store plugin-specific state (persisted between calls) */
  store: PluginStore
}

export interface ScheduleContext {
  node: NodeInfo
  plugin: PluginInfo
  log: Logger
  store: PluginStore
  /** Send a structured report to the configured channel */
  report(payload: ReportPayload): Promise<void>
  /** Send a plain text notification */
  notify(text: string): Promise<void>
}

export interface HookContext {
  node: NodeInfo
  plugin: PluginInfo
  log: Logger
  store: PluginStore
}

export interface PluginStore {
  get<T = unknown>(key: string): T | undefined
  set(key: string, value: unknown): void
  delete(key: string): void
  clear(): void
}

// ─── Plugin / Node Definition ─────────────────────────────────────────────────

export type CommandHandler = (ctx: CommandContext) => Promise<CommandResult | void>
export type ScheduleHandler = (ctx: ScheduleContext) => Promise<void>
export type HookHandler = (ctx: HookContext) => Promise<void>

export interface ScheduleDefinition {
  /** Every day at 09:00 local time */
  daily?: ScheduleHandler
  /** Every hour */
  hourly?: ScheduleHandler
  /** Every minute */
  minutely?: ScheduleHandler
  /** Custom cron expression, e.g. "0 9 * * 1" */
  cron?: Record<string, ScheduleHandler>
}

export interface HooksDefinition {
  onLoad?: HookHandler
  onShutdown?: HookHandler
  onError?: (error: Error, ctx: HookContext) => Promise<void>
}

export interface PluginDefinition {
  name: string
  version: string
  description?: string
  /** Slash commands this plugin handles */
  commands?: Record<string, CommandHandler>
  /** Scheduled tasks */
  schedule?: ScheduleDefinition
  /** Lifecycle hooks */
  hooks?: HooksDefinition
}

export interface NodeDefinition extends PluginDefinition {
  /** Capabilities this node advertises to the hub */
  capabilities?: string[]
}

// ─── Runtime (stub) ──────────────────────────────────────────────────────────
/**
 * In production this is replaced by the JackClaw runtime injected at load time.
 * During development / unit tests it provides no-op implementations.
 */

function makeStore(): PluginStore {
  const map = new Map<string, unknown>()
  return {
    get: (k) => map.get(k) as never,
    set: (k, v) => { map.set(k, v) },
    delete: (k) => { map.delete(k) },
    clear: () => map.clear(),
  }
}

function makeLogger(name: string): Logger {
  const prefix = `[${name}]`
  return {
    debug: (m, ...a) => console.debug(prefix, m, ...a),
    info:  (m, ...a) => console.info(prefix, m, ...a),
    warn:  (m, ...a) => console.warn(prefix, m, ...a),
    error: (m, ...a) => console.error(prefix, m, ...a),
  }
}

// ─── definePlugin ─────────────────────────────────────────────────────────────

/**
 * Define a JackClaw plugin.
 *
 * @example
 * ```ts
 * import { definePlugin } from '@jackclaw/sdk'
 *
 * export default definePlugin({
 *   name: 'my-plugin',
 *   version: '1.0.0',
 *   commands: {
 *     hello: async (ctx) => ({ text: `Hello from ${ctx.node.name}!` }),
 *   },
 * })
 * ```
 */
export function definePlugin(definition: PluginDefinition): PluginDefinition {
  // Validate required fields
  if (!definition.name) throw new Error('Plugin name is required')
  if (!definition.version) throw new Error('Plugin version is required')

  // Return as-is; the JackClaw runtime picks this up at load time.
  // The runtime replaces context objects with real implementations.
  return definition
}

// ─── defineNode ───────────────────────────────────────────────────────────────

/**
 * Define a JackClaw node.
 *
 * Nodes are like plugins but additionally declare capabilities
 * and receive `onShutdown` lifecycle hooks for graceful termination.
 *
 * @example
 * ```ts
 * import { defineNode } from '@jackclaw/sdk'
 *
 * export default defineNode({
 *   name: 'my-node',
 *   version: '1.0.0',
 *   capabilities: ['report', 'command'],
 *   commands: {
 *     status: async (ctx) => ({ text: `${ctx.node.name} is online` }),
 *   },
 * })
 * ```
 */
export function defineNode(definition: NodeDefinition): NodeDefinition {
  if (!definition.name) throw new Error('Node name is required')
  if (!definition.version) throw new Error('Node version is required')
  return definition
}

// ─── createContext helpers (for testing) ─────────────────────────────────────

/**
 * Create a mock CommandContext for unit testing.
 *
 * @example
 * ```ts
 * const ctx = createMockCommandContext({ args: ['world'] })
 * const result = await myPlugin.commands!.hello!(ctx)
 * assert.strictEqual(result?.text, 'Hello from test-node!')
 * ```
 */
export function createMockCommandContext(
  overrides: Partial<CommandContext> = {}
): CommandContext {
  return {
    node: { id: 'test', name: 'test-node', version: '0.0.0', tags: [], metadata: {} },
    plugin: { name: 'test-plugin', version: '0.0.0' },
    args: [],
    input: '',
    userId: 'user-test',
    userName: 'Tester',
    log: makeLogger('test'),
    store: makeStore(),
    ...overrides,
  }
}

export function createMockScheduleContext(
  overrides: Partial<ScheduleContext> = {}
): ScheduleContext {
  return {
    node: { id: 'test', name: 'test-node', version: '0.0.0', tags: [], metadata: {} },
    plugin: { name: 'test-plugin', version: '0.0.0' },
    log: makeLogger('test'),
    store: makeStore(),
    report: async (p) => { console.log('[mock report]', p.summary) },
    notify: async (t) => { console.log('[mock notify]', t) },
    ...overrides,
  }
}

// ─── ClawChat Types ───────────────────────────────────────────────────────────
// Mirror of hub/src/store/chat.ts — for plugin and SDK consumers

export type ChatMessageType =
  | 'human'
  | 'task'
  | 'ask'
  | 'broadcast'
  | 'reply'
  | 'ack'

export interface ChatMessage {
  id: string
  threadId?: string
  replyToId?: string
  from: string
  to: string | string[]
  type: ChatMessageType
  content: string
  attachments?: Array<{
    name: string
    type: 'file' | 'image' | 'memory-ref' | 'task-result'
    url?: string
    data?: string
    memoryKey?: string
  }>
  ts: number
  signature: string
  encrypted: boolean
  read?: boolean
  executionResult?: {
    status: 'success' | 'failed' | 'pending-review'
    output: string
    attempts: number
  }
}

export interface ChatThread {
  id: string
  participants: string[]
  title?: string
  createdAt: number
  lastMessageAt: number
  messageCount: number
}

// ─── OwnerMemory Types ────────────────────────────────────────────────────────
// Mirror of node/src/owner-memory.ts — for plugin and SDK consumers

export type OwnerMemoryType =
  | 'personality'
  | 'relationship'
  | 'emotional-state'
  | 'preference'
  | 'milestone'
  | 'private-note'

export interface OwnerMemoryEntry {
  id: string
  type: OwnerMemoryType
  content: string
  confidence: number
  source: 'observed' | 'inferred' | 'explicit'
  createdAt: number
  updatedAt: number
  expiresAt?: number
  tags?: string[]
}

export interface RelationshipStats {
  trustScore: number
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

// ─── Harness Types ────────────────────────────────────────────────────────────

// HarnessTask and HarnessResult — re-exported via relative path (workspace link pending)
// export type { HarnessTask, HarnessResult } from '@jackclaw/harness'
