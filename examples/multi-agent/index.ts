import { createBundle, splitWeakBundle, type BundledTask } from "@jackclaw/protocol"

// ── 弱束示例：独立任务，可并行执行 ──────────────────────────────────────────
const weakTasks: BundledTask[] = [
  { taskId: "fetch-data",   action: "fetch",    params: { url: "/api/data" },          verifiable: true },
  { taskId: "fetch-config", action: "fetch",    params: { url: "/api/config" },         verifiable: true },
  { taskId: "process",      action: "process",  params: {},  dependsOn: ["fetch-data"], verifiable: true },
  { taskId: "send-report",  action: "report",   params: {},  dependsOn: ["process"],    verifiable: false },
]

const weakBundle = createBundle(weakTasks, { responsibleNodeId: "agent-1" })
console.log("📦 Weak bundle:", weakBundle.bundleId)
console.log("   strength:", weakBundle.strength, "| canParallelize:", weakBundle.canParallelize)

const layers = splitWeakBundle(weakBundle)
layers.forEach((layer, i) =>
  console.log(`   Layer ${i}:`, layer.map(t => t.taskId).join(", "))
)

// ── 强束示例：共享上下文，不可拆分 ──────────────────────────────────────────
const strongTasks: BundledTask[] = [
  { taskId: "draft",   action: "write",   params: { doc: "contract.md" }, verifiable: true },
  { taskId: "review",  action: "review",  params: { doc: "contract.md" }, verifiable: true },
  { taskId: "sign",    action: "sign",    params: { doc: "contract.md" }, verifiable: true },
]

const strongBundle = createBundle(strongTasks, {
  responsibleNodeId: "agent-2",
  sharedContext: "Contract negotiation for Q2 deal — must be atomic",
  humanApprovalRequired: true,
})
console.log("\n📦 Strong bundle:", strongBundle.bundleId)
console.log("   strength:", strongBundle.strength,
            "| humanApprovalRequired:", strongBundle.humanApprovalRequired)
console.log("   sharedContext:", strongBundle.sharedContext)

try {
  splitWeakBundle(strongBundle)
} catch (e: unknown) {
  console.log("   ✅ Split blocked (expected):", (e as Error).message.slice(0, 60))
}
