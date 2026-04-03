/**
 * OwnerMemory Authorization Layer — 情绪独立区授权框架
 *
 * 核心设计原则：
 * 1. 数据归用户所有，存在本地 Node，不上传任何服务器
 * 2. 第三方产品（硬件/软件）通过 OAuth2-like 授权机制申请访问
 * 3. 授权粒度细化到 MemoryType 级别（只允许读 preference，不允许读 private-note）
 * 4. 授权可随时撤销，撤销后立即生效
 * 5. 所有访问行为审计日志记录
 */

import fs from 'fs'
import path from 'path'
import os from 'os'
import { randomUUID, createHash } from 'crypto'
import type { OwnerMemoryType, OwnerMemoryEntry } from './owner-memory'

// ─── 授权范围 ─────────────────────────────────────────────────────────────────

/** 可授权的 memory 类型（private-note 永远不可授权） */
export type AuthorizableMemoryType = Exclude<OwnerMemoryType, 'private-note'>

export type AccessScope =
  | 'personality:read'
  | 'relationship:read'
  | 'emotional-state:read'
  | 'preference:read'
  | 'milestone:read'
  | 'snapshot:read'    // getEmotionSnapshot() 的聚合视图
  | 'stats:read'       // 关系统计（不含具体内容）

/** 产品类型 */
export type ProductType =
  | 'hardware'         // 智能硬件（灯光/音箱/可穿戴）
  | 'app'              // 手机 App
  | 'ai-service'       // AI 服务（情感陪伴/助手）
  | 'analytics'        // 数据分析（用户自己的）

// ─── 授权凭证 ─────────────────────────────────────────────────────────────────

export interface AuthGrant {
  grantId: string
  nodeId: string              // 授权给哪个 Node（本地）
  clientId: string            // 被授权方 ID（产品方注册）
  clientName: string          // 产品名称
  productType: ProductType
  scopes: AccessScope[]       // 授权的访问范围
  createdAt: number
  expiresAt: number           // 过期时间（最长1年）
  lastUsedAt?: number
  accessCount: number
  active: boolean             // 是否有效（撤销后 false）
  userNote?: string           // 用户备注（"给我的台灯用"）
}

export interface AuthRequest {
  clientId: string
  clientName: string
  productType: ProductType
  requestedScopes: AccessScope[]
  reason: string              // 申请理由（展示给用户）
  webhookUrl?: string         // 授权结果回调
}

export interface AccessToken {
  token: string               // 随机 token，用于 API 调用
  grantId: string
  scopes: AccessScope[]
  expiresAt: number
}

export interface AuditLog {
  id: string
  grantId: string
  clientId: string
  clientName: string
  scope: AccessScope
  accessedAt: number
  success: boolean
  ipHint?: string
}

// ─── 授权管理器 ───────────────────────────────────────────────────────────────

export class OwnerMemoryAuth {
  private grants: Map<string, AuthGrant> = new Map()
  private tokens: Map<string, AccessToken> = new Map()
  private auditLogs: AuditLog[] = []
  private pendingRequests: Map<string, AuthRequest & { requestedAt: number }> = new Map()

  constructor(
    private nodeId: string,
    private storePath = path.join(os.homedir(), '.jackclaw', 'owner-memory', 'auth'),
  ) {
    fs.mkdirSync(storePath, { recursive: true })
    this.load()
  }

  // ─── 用户操作（主人侧）────────────────────────────────────────────────────

  /** 列出所有待审批的授权申请 */
  getPendingRequests(): Array<AuthRequest & { requestedAt: number; requestId: string }> {
    return [...this.pendingRequests.entries()].map(([id, r]) => ({ ...r, requestId: id }))
  }

  /** 用户批准授权申请 */
  approve(requestId: string, opts?: {
    scopes?: AccessScope[]     // 可以缩小范围（不能扩大）
    expiryDays?: number        // 默认 90 天
    userNote?: string
  }): AuthGrant {
    const request = this.pendingRequests.get(requestId)
    if (!request) throw new Error(`Request not found: ${requestId}`)

    const scopes = opts?.scopes
      ? opts.scopes.filter(s => request.requestedScopes.includes(s))  // 只能缩小
      : request.requestedScopes

    const expiryDays = opts?.expiryDays ?? 90
    const grant: AuthGrant = {
      grantId: randomUUID(),
      nodeId: this.nodeId,
      clientId: request.clientId,
      clientName: request.clientName,
      productType: request.productType,
      scopes,
      createdAt: Date.now(),
      expiresAt: Date.now() + expiryDays * 86400000,
      accessCount: 0,
      active: true,
      userNote: opts?.userNote,
    }

    this.grants.set(grant.grantId, grant)
    this.pendingRequests.delete(requestId)
    this.save()

    console.log(`[auth] Grant approved: ${grant.clientName} → ${scopes.join(', ')}`)
    return grant
  }

  /** 撤销授权（立即生效） */
  revoke(grantId: string): void {
    const grant = this.grants.get(grantId)
    if (!grant) throw new Error(`Grant not found: ${grantId}`)
    grant.active = false

    // 作废所有相关 token
    for (const [token, at] of this.tokens) {
      if (at.grantId === grantId) this.tokens.delete(token)
    }

    this.save()
    console.log(`[auth] Grant revoked: ${grant.clientName} (${grantId})`)
  }

  /** 列出所有有效授权 */
  listGrants(): AuthGrant[] {
    return [...this.grants.values()].filter(g => g.active)
  }

  /** 查看访问日志 */
  getAuditLog(grantId?: string): AuditLog[] {
    return grantId
      ? this.auditLogs.filter(l => l.grantId === grantId)
      : this.auditLogs.slice(-100)  // 最近100条
  }

  // ─── 产品侧操作 ────────────────────────────────────────────────────────────

  /** 产品方提交授权申请（返回 requestId，等待用户审批） */
  requestAccess(request: AuthRequest): string {
    // private-note 永远不可申请
    const safeScopes = request.requestedScopes.filter(s => !s.startsWith('private'))
    const requestId = randomUUID()
    this.pendingRequests.set(requestId, {
      ...request,
      requestedScopes: safeScopes,
      requestedAt: Date.now(),
    })
    this.save()
    console.log(`[auth] Access request from ${request.clientName}: ${safeScopes.join(', ')}`)
    return requestId
  }

  /** 用授权凭证换取访问 token（grant_type=client_credentials like） */
  issueToken(grantId: string, clientSecret: string): AccessToken {
    const grant = this.grants.get(grantId)
    if (!grant || !grant.active) throw new Error('Invalid or revoked grant')
    if (Date.now() > grant.expiresAt) throw new Error('Grant expired')

    // 简单验证：clientSecret = SHA256(clientId + grantId)
    const expected = createHash('sha256')
      .update(grant.clientId + grantId)
      .digest('hex')
    if (clientSecret !== expected) throw new Error('Invalid client secret')

    const token: AccessToken = {
      token: randomUUID(),
      grantId,
      scopes: grant.scopes,
      expiresAt: Math.min(grant.expiresAt, Date.now() + 3600000),  // token 最长1h
    }
    this.tokens.set(token.token, token)
    return token
  }

  /**
   * 产品方用 token 访问 OwnerMemory 数据
   * 返回脱敏后的数据（不含 private-note，不含原始 ID）
   */
  access(token: string, scope: AccessScope, entries: OwnerMemoryEntry[]): unknown {
    const accessToken = this.tokens.get(token)

    // 验证 token
    if (!accessToken) {
      this.logAccess(null, scope, false)
      throw new Error('Invalid token')
    }
    if (Date.now() > accessToken.expiresAt) {
      this.tokens.delete(token)
      throw new Error('Token expired')
    }
    if (!accessToken.scopes.includes(scope)) {
      this.logAccess(accessToken, scope, false)
      throw new Error(`Scope not authorized: ${scope}`)
    }

    const grant = this.grants.get(accessToken.grantId)
    if (!grant || !grant.active) throw new Error('Grant revoked')

    // 更新统计
    grant.accessCount++
    grant.lastUsedAt = Date.now()

    this.logAccess(accessToken, scope, true)
    this.save()

    // 返回脱敏数据（去掉 id、去掉 private-note）
    const type = scope.split(':')[0] as OwnerMemoryType
    return entries
      .filter(e => e.type === type && e.type !== 'private-note')
      .map(({ id: _id, ...rest }) => rest)  // 去掉内部 ID
  }

  // ─── 内部方法 ──────────────────────────────────────────────────────────────

  private logAccess(token: AccessToken | null, scope: AccessScope, success: boolean): void {
    if (!token) return
    const grant = this.grants.get(token.grantId)
    this.auditLogs.push({
      id: randomUUID(),
      grantId: token.grantId,
      clientId: grant?.clientId ?? 'unknown',
      clientName: grant?.clientName ?? 'unknown',
      scope,
      accessedAt: Date.now(),
      success,
    })
    // 只保留最近 1000 条
    if (this.auditLogs.length > 1000) this.auditLogs.splice(0, this.auditLogs.length - 1000)
  }

  private load(): void {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(this.storePath, `${this.nodeId}.json`), 'utf-8'))
      for (const g of data.grants ?? []) this.grants.set(g.grantId, g)
      this.auditLogs = data.auditLogs ?? []
    } catch { /* 首次运行 */ }
  }

  private save(): void {
    const data = {
      grants: [...this.grants.values()],
      auditLogs: this.auditLogs.slice(-1000),
    }
    fs.writeFileSync(
      path.join(this.storePath, `${this.nodeId}.json`),
      JSON.stringify(data, null, 2),
    )
  }
}

// 单例工厂
const authInstances = new Map<string, OwnerMemoryAuth>()
export function getOwnerMemoryAuth(nodeId: string): OwnerMemoryAuth {
  if (!authInstances.has(nodeId)) {
    authInstances.set(nodeId, new OwnerMemoryAuth(nodeId))
  }
  return authInstances.get(nodeId)!
}
