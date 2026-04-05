/**
 * clawchat-auth.ts — ClawChat Hub account auto-registration / token refresh.
 *
 * Credentials are persisted to ~/.jackclaw/clawchat-auth.json (mode 0o600).
 * Token expiry is checked by decoding the JWT payload inline — no external
 * dependency required.
 */

import os from 'os'
import path from 'path'
import fs from 'fs/promises'
import { randomBytes } from 'crypto'

const AUTH_FILE = path.join(os.homedir(), '.jackclaw', 'clawchat-auth.json')
const AUTH_DIR  = path.dirname(AUTH_FILE)

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ClawChatCredentials {
  handle:       string
  password:     string
  token:        string
  hubUrl:       string
  registeredAt: number
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/** Decode JWT payload.exp and return true when the token expires within 60 s. */
function isTokenExpired(token: string): boolean {
  try {
    const parts = token.split('.')
    if (parts.length < 2) return true
    const payload = JSON.parse(
      Buffer.from(parts[1]!, 'base64url').toString('utf8'),
    ) as { exp?: number }
    if (!payload.exp) return false
    return Date.now() / 1000 > payload.exp - 60
  } catch {
    return true
  }
}

async function readCredentials(): Promise<ClawChatCredentials | null> {
  try {
    const raw  = await fs.readFile(AUTH_FILE, 'utf8')
    const data = JSON.parse(raw) as Partial<ClawChatCredentials>
    if (data.handle && data.password && data.token && data.hubUrl) {
      return data as ClawChatCredentials
    }
  } catch {
    // File absent or malformed.
  }
  return null
}

async function writeCredentials(creds: ClawChatCredentials): Promise<void> {
  await fs.mkdir(AUTH_DIR, { recursive: true })
  await fs.writeFile(AUTH_FILE, JSON.stringify(creds, null, 2), { encoding: 'utf8', mode: 0o600 })
}

async function loginRequest(hubUrl: string, handle: string, password: string): Promise<string> {
  const res = await fetch(`${hubUrl}/api/auth/login`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ handle, password }),
    signal:  AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`ClawChat login failed: ${res.status} ${res.statusText}`)
  const data = (await res.json()) as { token?: string }
  if (!data.token) throw new Error('ClawChat login: no token in response')
  return data.token
}

async function registerRequest(hubUrl: string, handle: string, password: string): Promise<string> {
  const res = await fetch(`${hubUrl}/api/auth/register`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ handle, password, displayName: handle }),
    signal:  AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`ClawChat registration failed: ${res.status} ${res.statusText}`)
  const data = (await res.json()) as { token?: string }
  if (!data.token) throw new Error('ClawChat registration: no token in response')
  return data.token
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Read stored credentials without any side-effects.
 * Returns null when the auth file is absent or malformed.
 */
export async function getClawChatAuth(): Promise<{ handle: string; token: string; hubUrl: string } | null> {
  const creds = await readCredentials()
  if (!creds) return null
  return { handle: creds.handle, token: creds.token, hubUrl: creds.hubUrl }
}

/**
 * Ensure a valid ClawChat session exists for `hubUrl`:
 *
 *   1. Valid token on disk  → return immediately.
 *   2. Expired token on disk → re-login with stored password, persist new token.
 *   3. No credentials        → register a fresh account ("claw-" + 8 hex chars),
 *                              persist credentials with mode 0o600.
 */
export async function ensureClawChatAuth(
  hubUrl: string,
  preferredHandle?: string,
): Promise<{ handle: string; token: string }> {
  const existing = await readCredentials()

  if (existing) {
    if (!isTokenExpired(existing.token)) {
      return { handle: existing.handle, token: existing.token }
    }
    // Token expired — re-login silently.
    const newToken = await loginRequest(hubUrl, existing.handle, existing.password)
    await writeCredentials({ ...existing, token: newToken })
    return { handle: existing.handle, token: newToken }
  }

  // No credentials — register a brand-new account.
  const handle   = preferredHandle ?? 'claw-' + randomBytes(4).toString('hex')
  const password = randomBytes(32).toString('hex')
  const token    = await registerRequest(hubUrl, handle, password)

  await writeCredentials({ handle, password, token, hubUrl, registeredAt: Date.now() })
  return { handle, token }
}
