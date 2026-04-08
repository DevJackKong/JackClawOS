// JackClaw Hub - Tenant Models

/**
 * Tenant / 租户
 */
export interface Tenant {
  id: string
  name: string
  slug: string
  plan: 'free' | 'pro' | 'enterprise'           // Subscription plan / 订阅套餐
  status: 'active' | 'suspended' | 'deleted'    // Tenant status / 租户状态
  createdAt: number                              // Created timestamp / 创建时间戳
  updatedAt: number                              // Updated timestamp / 更新时间戳
  settings: Record<string, unknown>              // JSON settings / JSON 配置
}

/**
 * Organization / 组织
 */
export interface Organization {
  id: string
  tenantId: string
  name: string
  slug: string
  createdAt: number                              // Created timestamp / 创建时间戳
  updatedAt: number                              // Updated timestamp / 更新时间戳
}

/**
 * Workspace / 工作区
 */
export interface Workspace {
  id: string
  orgId: string
  tenantId: string
  name: string
  slug: string
  createdAt: number                              // Created timestamp / 创建时间戳
  updatedAt: number                              // Updated timestamp / 更新时间戳
}

/**
 * Member / 成员
 */
export interface Member {
  id: string
  tenantId: string
  orgId: string
  userId: string
  role: string
  status: 'active' | 'invited' | 'disabled'     // Member status / 成员状态
  joinedAt: number                               // Joined timestamp / 加入时间戳
  updatedAt: number                              // Updated timestamp / 更新时间戳
}
