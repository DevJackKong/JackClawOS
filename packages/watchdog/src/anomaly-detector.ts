/**
 * AnomalyDetector — Behavioral anomaly detection for JackClaw Hub
 *
 * Detects:
 *   1. Message flood (>100 msgs/min from single node)
 *   2. Login brute force (>10 failures/5min from same IP)
 *   3. Bulk data export (>50 queries/min)
 *   4. Off-hours activity (high frequency at 03:00-05:00)
 *
 * Each anomaly triggers an alert with severity: info | warning | critical
 */

export type AnomalySeverity = 'info' | 'warning' | 'critical'

export interface AnomalyAlert {
  id: string
  type: string
  severity: AnomalySeverity
  actor: string     // nodeId, IP, or userId
  detail: string
  ts: number
  count: number     // how many events triggered this
}

interface SlidingWindow {
  events: number[]  // timestamps
  windowMs: number
}

function addEvent(window: SlidingWindow): number {
  const now = Date.now()
  window.events.push(now)
  // Prune old events
  const cutoff = now - window.windowMs
  window.events = window.events.filter(ts => ts >= cutoff)
  return window.events.length
}

type AlertCallback = (alert: AnomalyAlert) => void

export class AnomalyDetector {
  private windows = new Map<string, SlidingWindow>()
  private alerts: AnomalyAlert[] = []
  private alertCounter = 0
  private readonly MAX_ALERTS = 500
  private onAlert?: AlertCallback

  // Configurable thresholds
  private thresholds = {
    messageFlood:    { count: 100, windowMs: 60_000 },   // 100 msgs / 1 min
    loginBrute:      { count: 10,  windowMs: 300_000 },  // 10 failures / 5 min
    bulkExport:      { count: 50,  windowMs: 60_000 },   // 50 queries / 1 min
    offHoursStart:   3,  // 03:00
    offHoursEnd:     5,  // 05:00
    offHoursCount:   20, // >20 events in off-hours = alert
  }

  constructor(opts?: { onAlert?: AlertCallback }) {
    this.onAlert = opts?.onAlert
  }

  /**
   * Track a message send event.
   */
  trackMessage(nodeId: string): AnomalyAlert | null {
    const key = `msg:${nodeId}`
    return this._check(key, this.thresholds.messageFlood, 'message_flood', nodeId, 'critical',
      (count) => `Node ${nodeId} sent ${count} messages in 1 minute`)
  }

  /**
   * Track a login failure.
   */
  trackLoginFailure(ip: string): AnomalyAlert | null {
    const key = `login:${ip}`
    return this._check(key, this.thresholds.loginBrute, 'login_brute_force', ip, 'critical',
      (count) => `${count} failed login attempts from IP ${ip} in 5 minutes`)
  }

  /**
   * Track a data query.
   */
  trackQuery(nodeId: string): AnomalyAlert | null {
    const key = `query:${nodeId}`
    return this._check(key, this.thresholds.bulkExport, 'bulk_export', nodeId, 'warning',
      (count) => `Node ${nodeId} made ${count} queries in 1 minute`)
  }

  /**
   * Track any activity and check for off-hours pattern.
   */
  trackActivity(actor: string): AnomalyAlert | null {
    const hour = new Date().getHours()
    if (hour < this.thresholds.offHoursStart || hour >= this.thresholds.offHoursEnd) return null

    const key = `offhours:${actor}`
    const window = this._getWindow(key, 3600_000) // 1 hour window
    const count = addEvent(window)

    if (count >= this.thresholds.offHoursCount) {
      return this._emit('off_hours_activity', actor, 'warning',
        `${actor} had ${count} activities during off-hours (${this.thresholds.offHoursStart}:00-${this.thresholds.offHoursEnd}:00)`, count)
    }
    return null
  }

  /**
   * Get recent alerts.
   */
  getAlerts(limit = 50): AnomalyAlert[] {
    return this.alerts.slice(-limit)
  }

  /**
   * Get alerts by severity.
   */
  getAlertsBySeverity(severity: AnomalySeverity): AnomalyAlert[] {
    return this.alerts.filter(a => a.severity === severity)
  }

  /**
   * Update thresholds.
   */
  setThreshold(type: keyof typeof this.thresholds, value: number | { count: number; windowMs: number }): void {
    (this.thresholds as any)[type] = value
  }

  // ─── Internal ─────────────────────────────────────────────────────────

  private _getWindow(key: string, windowMs: number): SlidingWindow {
    let w = this.windows.get(key)
    if (!w) {
      w = { events: [], windowMs }
      this.windows.set(key, w)
    }
    return w
  }

  private _check(
    key: string, threshold: { count: number; windowMs: number },
    type: string, actor: string, severity: AnomalySeverity,
    detailFn: (count: number) => string,
  ): AnomalyAlert | null {
    const window = this._getWindow(key, threshold.windowMs)
    const count = addEvent(window)
    if (count >= threshold.count) {
      return this._emit(type, actor, severity, detailFn(count), count)
    }
    return null
  }

  private _emit(type: string, actor: string, severity: AnomalySeverity, detail: string, count: number): AnomalyAlert {
    const alert: AnomalyAlert = {
      id: `anomaly_${++this.alertCounter}`,
      type, severity, actor, detail, ts: Date.now(), count,
    }
    this.alerts.push(alert)
    if (this.alerts.length > this.MAX_ALERTS) {
      this.alerts = this.alerts.slice(-this.MAX_ALERTS / 2)
    }
    this.onAlert?.(alert)
    return alert
  }
}

/** Singleton AnomalyDetector */
export const anomalyDetector = new AnomalyDetector()
