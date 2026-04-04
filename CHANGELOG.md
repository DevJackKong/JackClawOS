# Changelog

## v0.2.0 (2026-04-04)

### 🚀 Major Features

- **Message Reliability** — 6-state message state machine (accepted → sent → acked → stored → consumed → failed) with delivery ACK, deduplication, and WAL
- **Unified Identity Model** — 6 branded types (HumanId, AgentHandle, NodeId, HubId, ThreadId, DeliveryTarget) with compile-time safety
- **EventBus** — Pub/sub event system with wildcard patterns (~160 lines). All plugins communicate through events, not direct imports
- **Plugin Manager** — Load/unload plugins with sandboxed API (on/emit/log/getConfig/store)
- **Context Store** — LLM-aware context management with auto-summary compression. WebSocket routing = 0 tokens; AI calls use summary + recent K (~80% token savings)
- **CostTracker** — Per-model, per-node, per-day LLM usage and cost tracking with budget alerts
- **AnomalyDetector** — Sliding-window behavioral anomaly detection (message flood, login brute force, bulk export)
- **AuditLog** — Append-only immutable audit trail with JSONL export for compliance

### 📦 Infrastructure

- **All 14 packages bumped to 0.2.0**
- **11 packages published to npm** (@jackclaw/cli, create, hub, node, protocol, sdk, llm-gateway, memory, harness, openclaw-plugin, tunnel, watchdog, payment-vault)
- **Agent Card discovery** at `/.well-known/agents.json` (A2A + OpenAgents compatible)
- **CLI quick commands**: `jackclaw send`, `jackclaw inbox`, `jackclaw hub-status`
- **Declarative config**: `jackclaw.yaml` (CrewAI-style simple YAML)
- **Health API**: `/health`, `/health/detailed`, `/health/metrics` (Prometheus format)
- **GitHub Actions CI** workflow
- **QUICKSTART.md** — Full getting started guide
- **CONTRIBUTING.md** — Contributor guide

### 🧪 Testing

- **83 unit tests** across 14 suites (Protocol, Hub, LLM Gateway, Watchdog)
- **158 E2E assertions** covering registration, messaging, federation, health, plugins, and more
- **0 failures**

### 📊 Extended Message Types

```typescript
type ChatMessageType =
  | 'text' | 'card' | 'task' | 'transaction' | 'media'
  | 'reminder' | 'calendar' | 'approval' | 'system'
  | `x-${string}`  // custom extensions
```

### 🏗️ Node Local Store

- `sql.js` (pure WASM) replaces `better-sqlite3` to avoid native compilation issues
- Works in both Hub and Node environments

---

## v0.1.0 (2026-03-31)

Initial release with 14 packages:
- Protocol (RSA-4096 + AES-256 encryption)
- Hub (REST + WebSocket orchestrator)
- Node (AI agent worker)
- CLI, LLM Gateway, Memory, SDK, Dashboard, Watchdog
- Payment Vault, Harness, Tunnel, OpenClaw Plugin, create-jackclaw
