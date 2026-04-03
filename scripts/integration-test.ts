/**
 * JackClaw Integration Test
 * 启动真实 Hub + Node，跑完整流程，验证所有核心功能
 */
import { spawn, ChildProcess } from "child_process"
import { setTimeout as sleep } from "timers/promises"
import crypto from "crypto"

const HUB_PORT = 13100
const NODE_PORT = 13200
const HUB_URL = `http://localhost:${HUB_PORT}`

let hubProc: ChildProcess, nodeProc: ChildProcess
let passed = 0, failed = 0

async function waitFor(url: string, maxMs = 10000): Promise<boolean> {
  const t = Date.now()
  while (Date.now() - t < maxMs) {
    try { const r = await fetch(url); if (r.ok) return true } catch {}
    await sleep(300)
  }
  return false
}

async function assert(name: string, fn: () => Promise<boolean>) {
  try {
    const ok = await fn()
    if (ok) { console.log(`  ✅ ${name}`); passed++ }
    else { console.log(`  ❌ ${name}`); failed++ }
  } catch (e: any) { console.log(`  ❌ ${name}: ${e.message}`); failed++ }
}

async function main() {
  console.log("🦞 JackClaw Integration Test\n")
  const timeout = setTimeout(() => { console.log("\n⏰ Timeout"); cleanup(); process.exit(1) }, 60000)

  // 1. 启动 Hub
  console.log("Starting Hub...")
  hubProc = spawn("npx", ["tsx", "packages/hub/src/index.ts"], {
    env: { ...process.env, HUB_PORT: String(HUB_PORT) }, stdio: "pipe"
  })
  const hubReady = await waitFor(`${HUB_URL}/health`)
  await assert("Hub starts and /health OK", async () => hubReady)
  if (!hubReady) { cleanup(); process.exit(1) }

  // 2. 启动 Node
  console.log("Starting Node...")
  nodeProc = spawn("npx", ["tsx", "packages/node/src/index.ts"], {
    env: {
      ...process.env,
      NODE_PORT: String(NODE_PORT),
      JACKCLAW_HUB_URL: HUB_URL,
      NODE_AUTO_REGISTER: "true",
    },
    stdio: "pipe"
  })
  const nodeReady = await waitFor(`http://localhost:${NODE_PORT}/health`)
  await assert("Node starts and /health OK", async () => nodeReady)

  // 3. 注册 Node → 获取 JWT token（后续所有 /api/* 请求需要）
  const regResp = await fetch(`${HUB_URL}/api/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      nodeId: "test-node-001",
      name: "Test Node",
      role: "ceo",
      publicKey: "test-key",
      callbackUrl: `http://localhost:${NODE_PORT}`,
    })
  })
  await assert("Node registers with Hub", async () => regResp.ok || regResp.status === 200 || regResp.status === 201)

  const regData = await regResp.json().catch(() => ({})) as { token?: string }
  const token = regData.token ?? ""

  // 4. 节点列表（需要 JWT）
  if (token) {
    const nodesResp = await fetch(`${HUB_URL}/api/nodes`, {
      headers: { Authorization: `Bearer ${token}` }
    })
    await assert("CEO can list nodes", async () => nodesResp.ok)
  }

  // 5. ClawChat 发消息（需要 JWT）
  const msgResp = await fetch(`${HUB_URL}/api/chat/send`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      id: crypto.randomUUID(),
      from: "test-ceo",
      to: "test-node-001",
      content: "Hello from integration test",
      type: "human",
      ts: Date.now(),
      signature: "",
      encrypted: false,
    })
  })
  await assert("ClawChat: send message", async () => msgResp.ok)

  // 6. 离线消息队列（需要 JWT）
  const inboxResp = await fetch(`${HUB_URL}/api/chat/inbox?nodeId=test-node-001`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  await assert("ClawChat: offline inbox", async () => inboxResp.ok)

  // 7. Task Plan 估算（需要 JWT）
  const planResp = await fetch(`${HUB_URL}/api/plan/estimate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ title: "Test task", description: "Build a simple feature" })
  })
  await assert("TaskPlanner: estimate returns plan", async () => {
    if (!planResp.ok) return false
    const data = await planResp.json()
    return !!data.plan?.complexity
  })

  // 8. Health check
  await assert("Hub /health returns ok", async () => {
    const r = await fetch(`${HUB_URL}/health`)
    const d = await r.json()
    return d.status === "ok"
  })

  clearTimeout(timeout)
  cleanup()
  console.log(`\n${"─".repeat(40)}`)
  console.log(`Results: ${passed} passed, ${failed} failed`)
  process.exit(failed > 0 ? 1 : 0)
}

function cleanup() {
  hubProc?.kill("SIGTERM")
  nodeProc?.kill("SIGTERM")
}

process.on("exit", cleanup)
main().catch(e => { console.error(e); cleanup(); process.exit(1) })
