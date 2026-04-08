// JackClaw Hub - RBAC Models
// JackClaw Hub - 基于角色的访问控制模型

/**
 * System role name / 系统角色名称
 */
export type RoleName =
  | 'owner'
  | 'admin'
  | 'manager'
  | 'agent'
  | 'guest'
  | 'auditor'
  | 'custom'

/**
 * Protected resource type / 受保护的资源类型
 */
export type PermissionResource =
  | 'memory'
  | 'channel'
  | 'agent'
  | 'task'
  | 'approval'
  | 'payment'
  | 'audit'
  | 'plugin'
  | '*'
  | '*'

/**
 * Supported permission action / 支持的权限动作
 */
export type PermissionAction =
  | 'create'
  | 'read'
  | 'update'
  | 'delete'
  | 'execute'
  | 'approve'
  | '*'
  | '*'

/**
 * Permission scope / 权限作用域
 */
export type PermissionScope = 'own' | 'org' | 'tenant' | 'global'

/**
 * Policy effect / 策略效果
 */
export type PolicyEffect = 'allow' | 'deny'

/**
 * Role definition / 角色定义
 */
export interface Role {
  /** Unique role ID / 角色唯一 ID */
  id: string
  /** Tenant ID / 租户 ID */
  tenantId: string
  /** Role machine name / 角色标识名 */
  name: RoleName
  /** Human-readable role name / 人类可读角色名 */
  displayName: string
  /** Permission keys or descriptors / 权限键或权限描述列表 */
  permissions: string[]
  /** Whether this is a built-in system role / 是否为系统内置角色 */
  isSystem: boolean
  /** Creation timestamp / 创建时间戳 */
  createdAt: number
  /** Last update timestamp / 更新时间戳 */
  updatedAt: number
}

/**
 * Permission definition / 权限定义
 */
export interface Permission {
  /** Unique permission ID / 权限唯一 ID */
  id: string
  /** Target resource / 目标资源 */
  resource: PermissionResource
  /** Allowed action / 允许动作 */
  action: PermissionAction
  /** Effective scope / 生效范围 */
  scope: PermissionScope
}

/**
 * Role assignment record / 角色分配记录
 */
export interface RoleAssignment {
  /** Unique assignment ID / 分配记录唯一 ID */
  id: string
  /** User ID / 用户 ID */
  userId: string
  /** Role ID / 角色 ID */
  roleId: string
  /** Tenant ID / 租户 ID */
  tenantId: string
  /** Optional organization ID / 可选组织 ID */
  orgId?: string
  /** Optional resource-scoped target ID / 可选资源级目标 ID */
  resourceId?: string
  /** Grantor user ID / 授权人用户 ID */
  grantedBy: string
  /** Grant timestamp / 授权时间戳 */
  grantedAt: number
  /** Creation timestamp / 创建时间戳 */
  createdAt?: number
  /** Update timestamp / 更新时间戳 */
  updatedAt?: number
}

/**
 * Conditional policy rule / 条件策略规则
 */
export interface PolicyRule {
  /** Unique policy rule ID / 策略规则唯一 ID */
  id: string
  /** Tenant ID / 租户 ID */
  tenantId: string
  /** Role ID / 角色 ID */
  roleId: string
  /** Target resource / 目标资源 */
  resource: PermissionResource
  /** Target action / 目标动作 */
  action: PermissionAction
  /** Allow or deny / 允许或拒绝 */
  effect: PolicyEffect
  /** Optional runtime conditions / 可选运行条件 */
  conditions?: Record<string, unknown>
}

const SYSTEM_TENANT_ID = 'system'
const SYSTEM_CREATED_AT = 0

/**
 * Default built-in roles / 默认内置角色
 */
export const DEFAULT_ROLES: Role[] = [
  {
    id: 'role_owner',
    tenantId: SYSTEM_TENANT_ID,
    name: 'owner',
    displayName: 'Owner / 拥有者',
    permissions: ['*'],
    isSystem: true,
    createdAt: SYSTEM_CREATED_AT,
    updatedAt: SYSTEM_CREATED_AT,
  },
  {
    id: 'role_admin',
    tenantId: SYSTEM_TENANT_ID,
    name: 'admin',
    displayName: 'Admin / 管理员',
    permissions: [
      'memory:*:tenant',
      'channel:*:tenant',
      'agent:*:tenant',
      'task:*:tenant',
      'approval:*:tenant',
      'payment:*:tenant',
      'audit:read:tenant',
      'plugin:*:tenant',
    ],
    isSystem: true,
    createdAt: SYSTEM_CREATED_AT,
    updatedAt: SYSTEM_CREATED_AT,
  },
  {
    id: 'role_manager',
    tenantId: SYSTEM_TENANT_ID,
    name: 'manager',
    displayName: 'Manager / 经理',
    permissions: [
      'memory:read:org',
      'memory:update:org',
      'channel:create:org',
      'channel:read:org',
      'channel:update:org',
      'agent:read:org',
      'agent:execute:org',
      'task:create:org',
      'task:read:org',
      'task:update:org',
      'approval:create:org',
      'approval:approve:org',
      'audit:read:org',
      'plugin:read:org',
    ],
    isSystem: true,
    createdAt: SYSTEM_CREATED_AT,
    updatedAt: SYSTEM_CREATED_AT,
  },
  {
    id: 'role_agent',
    tenantId: SYSTEM_TENANT_ID,
    name: 'agent',
    displayName: 'Agent / 智能体',
    permissions: [
      'memory:read:own',
      'memory:update:own',
      'channel:read:own',
      'channel:execute:own',
      'agent:read:own',
      'agent:execute:own',
      'task:create:own',
      'task:read:own',
      'task:update:own',
      'approval:create:own',
      'plugin:read:own',
      'plugin:execute:own',
    ],
    isSystem: true,
    createdAt: SYSTEM_CREATED_AT,
    updatedAt: SYSTEM_CREATED_AT,
  },
  {
    id: 'role_guest',
    tenantId: SYSTEM_TENANT_ID,
    name: 'guest',
    displayName: 'Guest / 访客',
    permissions: [
      'memory:read:own',
      'channel:read:own',
      'agent:read:own',
      'task:read:own',
      'plugin:read:own',
    ],
    isSystem: true,
    createdAt: SYSTEM_CREATED_AT,
    updatedAt: SYSTEM_CREATED_AT,
  },
  {
    id: 'role_auditor',
    tenantId: SYSTEM_TENANT_ID,
    name: 'auditor',
    displayName: 'Auditor / 审计员',
    permissions: [
      'memory:read:tenant',
      'channel:read:tenant',
      'agent:read:tenant',
      'task:read:tenant',
      'approval:read:tenant',
      'payment:read:tenant',
      'audit:read:tenant',
      'plugin:read:tenant',
    ],
    isSystem: true,
    createdAt: SYSTEM_CREATED_AT,
    updatedAt: SYSTEM_CREATED_AT,
  },
]
