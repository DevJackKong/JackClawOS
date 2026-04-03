/**
 * JackClaw Payment Vault — 支付隔离区
 *
 * 设计原则：
 * 1. 完全隔离：即使其他区域被攻陷/中毒，Payment Vault 不受影响
 * 2. 司法合规：内置多司法区 AI Agent 支付法规规则引擎
 * 3. 人工审批：超过阈值的支付必须真人确认（类似 Watchdog humanAck）
 * 4. 不可篡改审计：所有支付操作写入只读日志
 */

// ─── 司法区合规规则 ─────────────────────────────────────────────────────────

export type Jurisdiction =
  | 'CN'   // 中国：AI Agent 支付需用户实名 + 单笔≤1000元自动，超出需人工
  | 'EU'   // 欧盟：PSD2/GDPR，AI 发起支付必须有人类授权链
  | 'US'   // 美国：FinCEN，AI Agent 被视为代理人，超$500需审批
  | 'HK'   // 香港：SFC/HKMA，AI 支付需留存决策记录
  | 'SG'   // 新加坡：MAS，AI Agent 支付白名单制度
  | 'GLOBAL' // 最保守策略（适用多司法区重叠）

export interface ComplianceRule {
  jurisdiction: Jurisdiction
  autoApproveLimit: number        // 自动批准上限（USD 等值）
  requireHumanAbove: number       // 超过此金额必须真人审批
  requireAuditTrail: boolean      // 是否强制审计记录
  requireRealNameKYC: boolean     // 是否需要 KYC 实名
  allowedPaymentMethods: string[] // 允许的支付方式
  prohibitedCategories: string[]  // 禁止类别（赌博/成人等）
  aiAgentDisclosure: boolean      // 支付时是否需要声明"由AI代理发起"
  maxDailyLimit: number           // 单日累计上限
  cooldownSeconds: number         // 两次支付最短间隔
}

export const COMPLIANCE_RULES: Record<Jurisdiction, ComplianceRule> = {
  CN: {
    jurisdiction: 'CN',
    autoApproveLimit: 137,          // ~1000 CNY
    requireHumanAbove: 685,         // ~5000 CNY
    requireAuditTrail: true,
    requireRealNameKYC: true,
    allowedPaymentMethods: ['alipay', 'wechat_pay', 'unionpay'],
    prohibitedCategories: ['gambling', 'crypto', 'adult'],
    aiAgentDisclosure: true,
    maxDailyLimit: 1370,            // ~10000 CNY
    cooldownSeconds: 60,
  },
  EU: {
    jurisdiction: 'EU',
    autoApproveLimit: 30,           // PSD2 SCA 豁免上限
    requireHumanAbove: 30,
    requireAuditTrail: true,
    requireRealNameKYC: true,
    allowedPaymentMethods: ['sepa', 'card', 'paypal'],
    prohibitedCategories: ['gambling', 'adult'],
    aiAgentDisclosure: true,        // GDPR 透明度要求
    maxDailyLimit: 1000,
    cooldownSeconds: 30,
  },
  US: {
    jurisdiction: 'US',
    autoApproveLimit: 500,
    requireHumanAbove: 500,
    requireAuditTrail: true,
    requireRealNameKYC: false,      // 低金额豁免
    allowedPaymentMethods: ['ach', 'card', 'wire'],
    prohibitedCategories: ['gambling'],
    aiAgentDisclosure: false,
    maxDailyLimit: 5000,
    cooldownSeconds: 0,
  },
  HK: {
    jurisdiction: 'HK',
    autoApproveLimit: 200,          // ~1500 HKD
    requireHumanAbove: 1300,        // ~10000 HKD
    requireAuditTrail: true,
    requireRealNameKYC: true,
    allowedPaymentMethods: ['fps', 'octopus', 'card'],
    prohibitedCategories: ['gambling', 'adult'],
    aiAgentDisclosure: true,
    maxDailyLimit: 6500,
    cooldownSeconds: 30,
  },
  SG: {
    jurisdiction: 'SG',
    autoApproveLimit: 150,          // ~200 SGD
    requireHumanAbove: 750,         // ~1000 SGD
    requireAuditTrail: true,
    requireRealNameKYC: true,
    allowedPaymentMethods: ['paynow', 'card', 'grabpay'],
    prohibitedCategories: ['gambling', 'adult', 'crypto'],
    aiAgentDisclosure: true,
    maxDailyLimit: 3750,
    cooldownSeconds: 60,
  },
  GLOBAL: {
    jurisdiction: 'GLOBAL',
    autoApproveLimit: 10,           // 最保守：$10以内自动批准
    requireHumanAbove: 10,
    requireAuditTrail: true,
    requireRealNameKYC: true,
    allowedPaymentMethods: [],      // 需手动配置
    prohibitedCategories: ['gambling', 'adult', 'crypto', 'weapons'],
    aiAgentDisclosure: true,
    maxDailyLimit: 100,
    cooldownSeconds: 300,
  },
}

// ─── 支付请求类型 ───────────────────────────────────────────────────────────

export type PaymentStatus =
  | 'pending_compliance'  // 合规检查中
  | 'pending_human'       // 等待真人审批
  | 'approved'            // 已批准
  | 'rejected'            // 已拒绝（合规/人工）
  | 'executed'            // 已执行
  | 'failed'              // 执行失败
  | 'cancelled'           // 已取消

export interface PaymentRequest {
  requestId: string
  nodeId: string              // 发起支付的 Agent
  handle: string              // @handle
  amount: number              // 金额（USD 等值）
  currency: string
  recipient: string
  description: string
  category: string
  jurisdiction: Jurisdiction
  paymentMethod: string
  metadata: Record<string, unknown>
  status: PaymentStatus
  complianceResult?: ComplianceCheckResult
  humanApprovalRequired: boolean
  humanApprovedBy?: string    // 真人 ID
  humanApprovedAt?: number
  executedAt?: number
  failureReason?: string
  auditHash?: string          // 不可篡改审计哈希
  createdAt: number
}

export interface ComplianceCheckResult {
  passed: boolean
  jurisdiction: Jurisdiction
  rule: ComplianceRule
  violations: string[]
  requiresHuman: boolean
  autoApproved: boolean
}

// ─── Payment Vault 核心类 ───────────────────────────────────────────────────

export interface PaymentVaultConfig {
  nodeId: string
  jurisdiction: Jurisdiction
  humanTokenSecret: string    // 与 Watchdog 共用 human-token 机制
  vaultDir: string            // 隔离存储目录，默认 ~/.jackclaw/vault/
  webhookUrl?: string         // 支付结果推送
}
