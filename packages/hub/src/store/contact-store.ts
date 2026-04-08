// JackClaw Hub - Contact Store
// Persists to ~/.jackclaw/hub/contacts.json
// 联系人数据持久化到 ~/.jackclaw/hub/contacts.json

import fs from 'fs'
import path from 'path'
import crypto from 'crypto'

const HUB_DIR = path.join(process.env.HOME ?? '~', '.jackclaw', 'hub')
const CONTACTS_FILE = path.join(HUB_DIR, 'contacts.json')

export interface ContactChannel {
  type: 'wechat' | 'feishu' | 'whatsapp' | 'email' | 'phone' | 'telegram' | 'other'
  identifier: string
  isPrimary?: boolean
}

export interface Contact {
  id: string
  tenantId: string
  orgId?: string
  nodeId?: string
  name: string
  displayName?: string
  type: 'customer' | 'lead' | 'partner' | 'internal' | 'bot'
  channels: ContactChannel[]
  tags?: string[]
  metadata?: Record<string, unknown>
  createdAt: number
  updatedAt: number
}

/**
 * Read JSON file with fallback value.
 * 读取 JSON 文件；不存在或损坏时返回兜底值。
 */
function loadJSON<T>(file: string, fallback: T): T {
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf-8')) as T
  } catch {
    // ignore missing/invalid file / 忽略缺失或损坏文件
  }
  return fallback
}

/**
 * Save JSON file to disk and create parent directory automatically.
 * 保存 JSON 到磁盘，并自动创建父目录。
 */
function saveJSON(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8')
}

/**
 * Normalize string value.
 * 规范化字符串值。
 */
function normalizeText(value: string | undefined): string | undefined {
  const next = value?.trim()
  return next ? next : undefined
}

/**
 * Normalize and deduplicate channels.
 * 规范化并去重联系方式。
 */
function normalizeChannels(channels: ContactChannel[] | undefined): ContactChannel[] {
  if (!Array.isArray(channels)) return []

  const normalized: ContactChannel[] = []
  const seen = new Set<string>()
  let hasPrimary = false

  for (const channel of channels) {
    const type = channel?.type
    const identifier = normalizeText(String(channel?.identifier ?? ''))
    if (!type || !identifier) continue

    const key = `${type}:${identifier.toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)

    const next: ContactChannel = { type, identifier }
    if (channel.isPrimary === true && !hasPrimary) {
      next.isPrimary = true
      hasPrimary = true
    }

    normalized.push(next)
  }

  return normalized
}

/**
 * Normalize and deduplicate tags.
 * 规范化并去重标签。
 */
function normalizeTags(tags: string[] | undefined): string[] | undefined {
  if (!Array.isArray(tags)) return undefined

  const normalized = [...new Set(
    tags
      .map(tag => normalizeText(String(tag)))
      .filter((tag): tag is string => Boolean(tag)),
  )]

  return normalized.length > 0 ? normalized : undefined
}

/**
 * Normalize metadata object.
 * 规范化 metadata 对象。
 */
function normalizeMetadata(metadata: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return undefined
  return metadata
}

/**
 * Contact store backed by one JSON file.
 * 基于单个 JSON 文件的联系人存储。
 */
export class ContactStore {
  /**
   * Load all contacts from disk.
   * 从磁盘加载全部联系人。
   */
  private load(): Contact[] {
    return loadJSON<Contact[]>(CONTACTS_FILE, [])
  }

  /**
   * Persist all contacts to disk.
   * 将全部联系人持久化到磁盘。
   */
  private save(contacts: Contact[]): void {
    saveJSON(CONTACTS_FILE, contacts)
  }

  /**
   * Create a contact record.
   * 创建联系人记录。
   */
  create(tenantId: string, name: string, type: Contact['type'], opts: Partial<Contact> = {}): Contact {
    const contacts = this.load()
    const now = Date.now()

    const contact: Contact = {
      id: crypto.randomUUID(),
      tenantId: tenantId.trim(),
      orgId: normalizeText(opts.orgId),
      nodeId: normalizeText(opts.nodeId),
      name: name.trim(),
      displayName: normalizeText(opts.displayName),
      type,
      channels: normalizeChannels(opts.channels),
      tags: normalizeTags(opts.tags),
      metadata: normalizeMetadata(opts.metadata),
      createdAt: now,
      updatedAt: now,
    }

    contacts.push(contact)
    this.save(contacts)
    return contact
  }

  /**
   * Get contact by id.
   * 按 id 获取联系人。
   */
  get(id: string): Contact | null {
    return this.load().find(contact => contact.id === id) ?? null
  }

  /**
   * Get contact by node id.
   * 按 nodeId 获取联系人。
   */
  getByNodeId(nodeId: string): Contact | null {
    const normalizedNodeId = nodeId.trim()
    if (!normalizedNodeId) return null
    return this.load().find(contact => contact.nodeId === normalizedNodeId) ?? null
  }

  /**
   * List contacts in one tenant with optional filters.
   * 列出租户下联系人，并支持可选过滤。
   */
  list(
    tenantId: string,
    opts: { type?: string; tag?: string; search?: string; limit?: number } = {},
  ): Contact[] {
    const type = normalizeText(opts.type)
    const tag = normalizeText(opts.tag)
    const search = normalizeText(opts.search)?.toLowerCase()
    const limit = typeof opts.limit === 'number' && opts.limit > 0 ? opts.limit : undefined

    let contacts = this.load()
      .filter(contact => contact.tenantId === tenantId)
      .sort((a, b) => b.updatedAt - a.updatedAt)

    if (type) {
      contacts = contacts.filter(contact => contact.type === type)
    }

    if (tag) {
      contacts = contacts.filter(contact => contact.tags?.includes(tag))
    }

    if (search) {
      contacts = contacts.filter(contact => {
        const haystacks = [
          contact.name,
          contact.displayName,
          contact.nodeId,
          contact.orgId,
          ...(contact.tags ?? []),
          ...contact.channels.map(channel => `${channel.type}:${channel.identifier}`),
        ]

        return haystacks.some(value => String(value ?? '').toLowerCase().includes(search))
      })
    }

    return limit ? contacts.slice(0, limit) : contacts
  }

  /**
   * Update mutable contact fields.
   * 更新联系人可变字段。
   */
  update(
    id: string,
    updates: Partial<Pick<Contact, 'name' | 'displayName' | 'type' | 'channels' | 'tags' | 'metadata'>>,
  ): Contact {
    const contacts = this.load()
    const contact = contacts.find(item => item.id === id)
    if (!contact) throw Object.assign(new Error(`Contact not found: ${id}`), { status: 404 })

    if (updates.name !== undefined) contact.name = updates.name.trim()
    if (updates.displayName !== undefined) contact.displayName = normalizeText(updates.displayName)
    if (updates.type !== undefined) contact.type = updates.type
    if (updates.channels !== undefined) contact.channels = normalizeChannels(updates.channels)
    if (updates.tags !== undefined) contact.tags = normalizeTags(updates.tags)
    if (updates.metadata !== undefined) contact.metadata = normalizeMetadata(updates.metadata)
    contact.updatedAt = Date.now()

    this.save(contacts)
    return contact
  }

  /**
   * Delete contact by id.
   * 按 id 删除联系人。
   */
  delete(id: string): boolean {
    const contacts = this.load()
    const next = contacts.filter(contact => contact.id !== id)
    if (next.length === contacts.length) return false
    this.save(next)
    return true
  }

  /**
   * Add one channel to a contact.
   * 为联系人添加一个联系方式。
   */
  addChannel(id: string, channel: Contact['channels'][0]): Contact {
    const contacts = this.load()
    const contact = contacts.find(item => item.id === id)
    if (!contact) throw Object.assign(new Error(`Contact not found: ${id}`), { status: 404 })

    const nextChannels = normalizeChannels([...(contact.channels ?? []), channel])
    contact.channels = nextChannels
    contact.updatedAt = Date.now()

    this.save(contacts)
    return contact
  }

  /**
   * Add one tag if absent.
   * 为联系人添加标签；若已存在则跳过。
   */
  addTag(id: string, tag: string): Contact {
    const contacts = this.load()
    const contact = contacts.find(item => item.id === id)
    if (!contact) throw Object.assign(new Error(`Contact not found: ${id}`), { status: 404 })

    contact.tags = normalizeTags([...(contact.tags ?? []), tag])
    contact.updatedAt = Date.now()

    this.save(contacts)
    return contact
  }
}

export const contactStore = new ContactStore()
