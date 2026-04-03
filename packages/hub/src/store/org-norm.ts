/**
 * OrgNorm — CEO 设置全局规范，所有 Node system prompt 自动注入
 * 类似"公司工作手册"，但自动执行
 */

import { randomUUID } from 'crypto'

export interface OrgNorm {
  id: string
  rule: string
  scope: 'all' | 'ceo' | 'manager' | 'worker'
  enabled: boolean
  createdAt: number
  createdBy: string
}

const ROLE_HIERARCHY: Record<string, string[]> = {
  ceo: ['ceo'],
  manager: ['manager'],
  worker: ['worker'],
  all: ['ceo', 'manager', 'worker'],
}

export class OrgNormStore {
  private norms: OrgNorm[] = []

  add(rule: string, scope: OrgNorm['scope'], createdBy: string): OrgNorm {
    const norm: OrgNorm = {
      id: randomUUID(),
      rule,
      scope,
      enabled: true,
      createdAt: Date.now(),
      createdBy,
    }
    this.norms.push(norm)
    return norm
  }

  disable(id: string): void {
    const norm = this.norms.find(n => n.id === id)
    if (norm) norm.enabled = false
  }

  /** 返回对指定角色生效的所有启用规范 */
  getActive(role: string): OrgNorm[] {
    const lowerRole = role.toLowerCase()
    return this.norms.filter(n => {
      if (!n.enabled) return false
      if (n.scope === 'all') return true
      return n.scope === lowerRole
    })
  }

  list(): OrgNorm[] {
    return [...this.norms]
  }

  /**
   * 构建注入到 system prompt 的字符串块。
   * 例：
   *   ORGANIZATION NORMS:
   *   - 代码必须有测试
   *   - 不直接修改 main 分支
   */
  buildSystemPromptInject(role: string): string {
    const active = this.getActive(role)
    if (active.length === 0) return ''

    const lines = active.map(n => `- ${n.rule}`).join('\n')
    return `ORGANIZATION NORMS:\n${lines}`
  }
}

// Singleton
let _store: OrgNormStore | null = null
export function getOrgNormStore(): OrgNormStore {
  if (!_store) _store = new OrgNormStore()
  return _store
}
