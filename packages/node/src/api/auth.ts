import fs from 'fs'
import path from 'path'
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'crypto'
import type { RequestHandler } from 'express'

export interface ApiKey {
  id: string
  key: string // sha256 hash 存储
  name: string
  permissions: string[] // ['tasks:read', 'tasks:write', 'skills:invoke', 'admin']
  createdAt: number
  lastUsedAt?: number
  expiresAt?: number
  isActive: boolean
}

interface PersistedApiKeyData {
  keys: ApiKey[]
}

export class ApiKeyManager {
  private readonly keys = new Map<string, ApiKey>()

  generate(name: string, permissions: string[], expiresInDays?: number): { key: string; record: ApiKey } {
    const rawKey = `jck_${randomBytes(16).toString('hex')}_${randomBytes(24).toString('hex')}`
    const now = Date.now()
    const record: ApiKey = {
      id: randomUUID(),
      key: this.hashKey(rawKey),
      name,
      permissions: this.normalizePermissions(permissions),
      createdAt: now,
      expiresAt: typeof expiresInDays === 'number' && Number.isFinite(expiresInDays)
        ? now + Math.max(0, expiresInDays) * 24 * 60 * 60 * 1000
        : undefined,
      isActive: true,
    }

    this.keys.set(record.id, record)
    return { key: rawKey, record: this.clone(record) }
  }

  verify(rawKey: string): ApiKey | null {
    if (!rawKey) return null

    const hashed = this.hashKey(rawKey)
    const now = Date.now()

    for (const [id, record] of this.keys.entries()) {
      if (!record.isActive) continue
      if (typeof record.expiresAt === 'number' && record.expiresAt <= now) continue
      if (!this.safeEqual(record.key, hashed)) continue

      const updated: ApiKey = {
        ...record,
        lastUsedAt: now,
      }
      this.keys.set(id, updated)
      return this.clone(updated)
    }

    return null
  }

  revoke(keyId: string): void {
    const record = this.keys.get(keyId)
    if (!record) return
    this.keys.set(keyId, {
      ...record,
      isActive: false,
    })
  }

  list(): ApiKey[] {
    return Array.from(this.keys.values())
      .map((record) => this.clone(record))
      .sort((a, b) => b.createdAt - a.createdAt)
  }

  save(filePath: string): void {
    const fullPath = path.resolve(filePath)
    fs.mkdirSync(path.dirname(fullPath), { recursive: true })
    const payload: PersistedApiKeyData = { keys: this.list() }
    fs.writeFileSync(fullPath, JSON.stringify(payload, null, 2), 'utf-8')
  }

  load(filePath: string): void {
    const fullPath = path.resolve(filePath)
    if (!fs.existsSync(fullPath)) return

    const raw = fs.readFileSync(fullPath, 'utf-8').trim()
    if (!raw) {
      this.keys.clear()
      return
    }

    const parsed = JSON.parse(raw) as PersistedApiKeyData | ApiKey[]
    const items = Array.isArray(parsed) ? parsed : parsed.keys

    this.keys.clear()
    for (const item of items ?? []) {
      if (!item?.id || !item?.key) continue
      this.keys.set(item.id, {
        id: item.id,
        key: item.key,
        name: item.name,
        permissions: this.normalizePermissions(item.permissions),
        createdAt: item.createdAt,
        lastUsedAt: item.lastUsedAt,
        expiresAt: item.expiresAt,
        isActive: item.isActive !== false,
      })
    }
  }

  private hashKey(rawKey: string): string {
    return createHash('sha256').update(rawKey).digest('hex')
  }

  private normalizePermissions(permissions: string[]): string[] {
    return Array.from(new Set((permissions ?? []).filter(Boolean)))
  }

  private clone(record: ApiKey): ApiKey {
    return {
      ...record,
      permissions: [...record.permissions],
    }
  }

  private safeEqual(left: string, right: string): boolean {
    const leftBuffer = Buffer.from(left, 'utf-8')
    const rightBuffer = Buffer.from(right, 'utf-8')
    if (leftBuffer.length !== rightBuffer.length) return false
    return timingSafeEqual(leftBuffer, rightBuffer)
  }
}

function extractApiKey(rawHeader?: string | string[]): string | null {
  if (Array.isArray(rawHeader)) {
    return extractApiKey(rawHeader[0])
  }
  if (!rawHeader) return null

  const trimmed = rawHeader.trim()
  if (!trimmed) return null

  if (/^Bearer\s+/i.test(trimmed)) {
    return trimmed.replace(/^Bearer\s+/i, '').trim() || null
  }

  return trimmed
}

function hasPermission(apiKey: ApiKey, requiredPermission?: string): boolean {
  if (!requiredPermission) return true
  return apiKey.permissions.includes('admin') || apiKey.permissions.includes(requiredPermission)
}

export function apiKeyMiddleware(manager: ApiKeyManager, requiredPermission?: string): RequestHandler {
  return (req, res, next) => {
    const candidate = extractApiKey(req.headers['x-api-key']) ?? extractApiKey(req.headers.authorization)
    if (!candidate) {
      res.status(401).json({ error: 'API key required' })
      return
    }

    const apiKey = manager.verify(candidate)
    if (!apiKey) {
      res.status(401).json({ error: 'Invalid or expired API key' })
      return
    }

    if (!hasPermission(apiKey, requiredPermission)) {
      res.status(403).json({ error: 'Insufficient API key permissions' })
      return
    }

    ;(req as typeof req & { apiKey?: ApiKey }).apiKey = apiKey
    next()
  }
}
