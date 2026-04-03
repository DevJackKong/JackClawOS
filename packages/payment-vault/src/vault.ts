/**
 * PaymentVault — 隔离支付区核心类
 *
 * 状态机：pending_compliance → approved/pending_human → approved → executed
 *                            → rejected (compliance fail or human reject)
 *
 * 安全约束：
 * - Agent 不能直接执行支付，只能 submit → 合规检查 → 可能等人工审批 → execute
 * - execute() 内部验证状态机，只有 approved 状态才能执行
 * - 人工审批使用 HMAC-SHA256（同 Watchdog/HumanInLoop）
 */

import { randomUUID, createHmac, timingSafeEqual } from 'crypto'
import {
  type PaymentRequest,
  type PaymentVaultConfig,
  type ComplianceCheckResult,
  type Jurisdiction,
  type PaymentStatus,
  COMPLIANCE_RULES,
} from '@jackclaw/protocol'
import {
  appendPaymentLog,
  readPaymentLog,
  computeDailyTotal,
  VAULT_BASE_DEFAULT,
} from './isolation'

export class PaymentVault {
  private config: PaymentVaultConfig
  private baseDir: string

  /** In-memory index of active requests (persisted to JSONL on every mutation) */
  private requests = new Map<string, PaymentRequest>()

  /** Per-node last-payment timestamp for cooldown enforcement */
  private lastPaymentAt = new Map<string, number>()

  constructor(config: PaymentVaultConfig) {
    this.config = config
    this.baseDir = config.vaultDir || VAULT_BASE_DEFAULT
  }

  // ── Compliance Engine ────────────────────────────────────────────────────────

  checkCompliance(req: {
    amount: number
    currency: string
    jurisdiction: Jurisdiction
    paymentMethod: string
    category: string
    nodeId: string
  }): ComplianceCheckResult {
    const rule = COMPLIANCE_RULES[req.jurisdiction] ?? COMPLIANCE_RULES['GLOBAL']
    const violations: string[] = []

    // 1. Prohibited category
    if (rule.prohibitedCategories.includes(req.category)) {
      violations.push(`Category "${req.category}" is prohibited in ${req.jurisdiction}`)
    }

    // 2. Payment method whitelist (empty = needs manual config)
    if (rule.allowedPaymentMethods.length > 0 && !rule.allowedPaymentMethods.includes(req.paymentMethod)) {
      violations.push(`Payment method "${req.paymentMethod}" not allowed in ${req.jurisdiction}`)
    }
    if (rule.allowedPaymentMethods.length === 0) {
      violations.push(`No payment methods configured for ${req.jurisdiction} — requires manual setup`)
    }

    // 3. Daily limit
    const dailyTotal = computeDailyTotal(this.baseDir, req.nodeId)
    if (dailyTotal + req.amount > rule.maxDailyLimit) {
      violations.push(
        `Daily limit exceeded: current $${dailyTotal} + $${req.amount} > $${rule.maxDailyLimit}`
      )
    }

    // 4. Cooldown
    const lastTs = this.lastPaymentAt.get(req.nodeId)
    if (lastTs && rule.cooldownSeconds > 0) {
      const elapsed = (Date.now() - lastTs) / 1000
      if (elapsed < rule.cooldownSeconds) {
        violations.push(
          `Cooldown: ${Math.ceil(rule.cooldownSeconds - elapsed)}s remaining`
        )
      }
    }

    // Determine auto-approve or human required
    const requiresHuman = req.amount > rule.autoApproveLimit || req.amount > rule.requireHumanAbove
    const autoApproved = violations.length === 0 && !requiresHuman

    return {
      passed: violations.length === 0,
      jurisdiction: req.jurisdiction,
      rule,
      violations,
      requiresHuman,
      autoApproved,
    }
  }

  // ── Submit (Agent entry point) ─────────────────────────────────────────────

  submit(req: Omit<PaymentRequest, 'requestId' | 'status' | 'complianceResult' | 'humanApprovalRequired' | 'createdAt' | 'auditHash'>): PaymentRequest {
    const requestId = randomUUID()

    // Run compliance
    const complianceResult = this.checkCompliance({
      amount: req.amount,
      currency: req.currency,
      jurisdiction: req.jurisdiction,
      paymentMethod: req.paymentMethod,
      category: req.category,
      nodeId: req.nodeId,
    })

    let status: PaymentStatus
    if (!complianceResult.passed) {
      status = 'rejected'
    } else if (complianceResult.autoApproved) {
      status = 'approved'
    } else {
      status = 'pending_human'
    }

    const payment: PaymentRequest = {
      ...req,
      requestId,
      status,
      complianceResult,
      humanApprovalRequired: complianceResult.requiresHuman,
      createdAt: Date.now(),
      auditHash: this.computeAuditHash(requestId, req.amount, req.nodeId),
    }

    this.requests.set(requestId, payment)
    appendPaymentLog(this.baseDir, req.nodeId, payment)

    return payment
  }

  // ── Human Approve / Reject ─────────────────────────────────────────────────

  humanApprove(requestId: string, humanToken: string): PaymentRequest {
    const payment = this.getRequest(requestId)
    if (payment.status !== 'pending_human') {
      throw new Error(`Cannot approve: status is "${payment.status}", expected "pending_human"`)
    }
    if (!this.verifyHumanToken(requestId, humanToken)) {
      throw new Error('Invalid human-token. Unauthorized.')
    }

    payment.status = 'approved'
    payment.humanApprovedBy = `human:${humanToken.slice(0, 8)}`
    payment.humanApprovedAt = Date.now()
    this.requests.set(requestId, payment)
    appendPaymentLog(this.baseDir, payment.nodeId, payment)

    return payment
  }

  humanReject(requestId: string, humanToken: string, reason: string): PaymentRequest {
    const payment = this.getRequest(requestId)
    if (payment.status !== 'pending_human') {
      throw new Error(`Cannot reject: status is "${payment.status}", expected "pending_human"`)
    }
    if (!this.verifyHumanToken(requestId, humanToken)) {
      throw new Error('Invalid human-token. Unauthorized.')
    }

    payment.status = 'rejected'
    payment.failureReason = reason
    payment.humanApprovedBy = `human:${humanToken.slice(0, 8)}`
    payment.humanApprovedAt = Date.now()
    this.requests.set(requestId, payment)
    appendPaymentLog(this.baseDir, payment.nodeId, payment)

    return payment
  }

  // ── Execute (state-machine enforced) ───────────────────────────────────────

  execute(requestId: string): PaymentRequest {
    const payment = this.getRequest(requestId)
    if (payment.status !== 'approved') {
      throw new Error(
        `Cannot execute: status is "${payment.status}". Only "approved" payments can be executed.`
      )
    }

    // Verify audit hash integrity
    const expectedHash = this.computeAuditHash(requestId, payment.amount, payment.nodeId)
    if (payment.auditHash !== expectedHash) {
      payment.status = 'failed'
      payment.failureReason = 'Audit hash mismatch — possible tampering'
      this.requests.set(requestId, payment)
      appendPaymentLog(this.baseDir, payment.nodeId, payment)
      throw new Error('Audit hash verification failed')
    }

    // Execute (log-only in this version — no real payment gateway)
    payment.status = 'executed'
    payment.executedAt = Date.now()
    this.lastPaymentAt.set(payment.nodeId, Date.now())
    this.requests.set(requestId, payment)
    appendPaymentLog(this.baseDir, payment.nodeId, payment)

    console.log(
      `[vault] Payment executed: ${requestId} | $${payment.amount} ${payment.currency} → ${payment.recipient} | node=${payment.nodeId}`
    )

    return payment
  }

  // ── Read-only queries ──────────────────────────────────────────────────────

  getDailyTotal(nodeId: string): number {
    return computeDailyTotal(this.baseDir, nodeId)
  }

  getAuditLog(nodeId: string): PaymentRequest[] {
    return readPaymentLog(this.baseDir, nodeId)
  }

  getPending(): PaymentRequest[] {
    return Array.from(this.requests.values()).filter(
      r => r.status === 'pending_human'
    )
  }

  getRequest(requestId: string): PaymentRequest {
    const payment = this.requests.get(requestId)
    if (!payment) {
      throw new Error(`Payment request ${requestId} not found`)
    }
    return payment
  }

  // ── HMAC token (same mechanism as Watchdog/HumanInLoop) ────────────────────

  generateHumanToken(requestId: string): string {
    return createHmac('sha256', this.config.humanTokenSecret)
      .update(requestId)
      .digest('hex')
  }

  private verifyHumanToken(requestId: string, token: string): boolean {
    const expected = this.generateHumanToken(requestId)
    try {
      return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(token, 'hex'))
    } catch {
      return false
    }
  }

  private computeAuditHash(requestId: string, amount: number, nodeId: string): string {
    return createHmac('sha256', this.config.humanTokenSecret)
      .update(`${requestId}:${amount}:${nodeId}`)
      .digest('hex')
  }
}
