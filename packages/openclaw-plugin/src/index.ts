/**
 * index.ts — JackClaw OpenClaw Plugin entry point.
 *
 * OpenClaw loads this file as the plugin entry. It calls register(api)
 * which wires commands, hooks, and the background Hub poller.
 *
 * Required openclaw.yaml / config snippet:
 *
 *   plugins:
 *     entries:
 *       jackclaw:
 *         path: /path/to/jackclaw/packages/openclaw-plugin
 *
 * Optional env vars:
 *   JACKCLAW_HUB_URL    — Hub base URL (default: http://localhost:3100)
 *   JACKCLAW_CEO_TOKEN  — JWT for CEO-level Hub API access
 *
 * Optional plugin config (under plugins.jackclaw):
 *   notifyTo      — delivery target (e.g. Telegram user ID or Feishu open_id)
 *   notifyChannel — channel to deliver push notifications (e.g. "feishu", "telegram")
 */

import type { OpenClawPluginDefinition } from 'openclaw/plugin-sdk/plugin-entry'
import { registerJackclawPlugin } from './plugin.js'

// ─── Re-exports: Heartbeat Hooks ─────────────────────────────────────────────
export type {
  SharedMemoryEntry,
  CollabInvite,
  WatchdogAlert,
  AlertSeverity,
  PendingAuthRequest,
} from './hooks/heartbeat.hook.js'
export {
  onHeartbeat,
  checkOwnerEmotionalState,
  checkPendingAuthRequests,
  checkPendingInvites,
  checkWatchdogAlerts,
} from './hooks/heartbeat.hook.js'

// ─── Re-exports: Compact Hooks ───────────────────────────────────────────────
export type { CompactResult } from './hooks/compact.hook.js'
export {
  autoCompact,
  snipCompact,
  crossNodeCompact,
} from './hooks/compact.hook.js'

// ─── Re-exports: Agent Tools ─────────────────────────────────────────────────
export type { OpenClawTool } from './agent-tool.js'
export { getJackClawTools } from './agent-tool.js'

// ─── Plugin Definition ───────────────────────────────────────────────────────

const jackclawPlugin: OpenClawPluginDefinition = {
  id: 'jackclaw',
  name: 'JackClaw',
  description: 'JackClaw — 团队汇报与节点状态查询插件。支持 /jackclaw 命令及自然语言触发。',
  register(api) {
    registerJackclawPlugin(api)
  },
}

export default jackclawPlugin
