// Watchdog 告警推送到 ClawChat
// 当检测到以下情况时，通过 Hub /api/chat/send 发消息给 CEO：
// - memory hash 异常变化
// - trust score 骤降（>10分）
// - 进程内存超过阈值（>500MB）
// - 任务失败率过高（>30%）

export class WatchdogAlerter {
  constructor(
    private nodeId: string,
    private hubUrl: string,
    private ceoNodeId = "ceo",
  ) {}

  async alert(type: "memory-tamper" | "trust-drop" | "memory-oom" | "high-failure", detail: string) {
    const emoji = { "memory-tamper": "🚨", "trust-drop": "⚠️", "memory-oom": "💾", "high-failure": "❌" }[type]
    await fetch(`${this.hubUrl}/api/chat/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: `watchdog-${Date.now()}`,
        from: `watchdog-${this.nodeId}`,
        to: this.ceoNodeId,
        content: `${emoji} [Watchdog Alert] ${type}: ${detail}`,
        type: "human",
        createdAt: Date.now(),
        metadata: { alertType: type, severity: type === "memory-tamper" ? "critical" : "warning" }
      })
    }).catch(() => {}) // 告警失败不崩溃
  }
}

// ─── Module-level singleton for use inside monitor.ts ─────────────────────────

let _alerter: WatchdogAlerter | null = null

/**
 * 初始化模块级 alerter（由 Hub 或 Node 启动时调用一次）
 */
export function configureAlerter(nodeId: string, hubUrl: string, ceoNodeId?: string): void {
  _alerter = new WatchdogAlerter(nodeId, hubUrl, ceoNodeId)
}

/**
 * 获取当前 alerter（未配置时返回 null，调用方做 null check）
 */
export function getAlerter(): WatchdogAlerter | null {
  return _alerter
}
