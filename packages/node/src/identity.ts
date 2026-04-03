import fs from 'fs'
import path from 'path'
import os from 'os'
import { generateKeyPair, NodeIdentity } from '@jackclaw/protocol'
import { createHash } from 'crypto'

const IDENTITY_DIR = path.join(os.homedir(), '.jackclaw')
const IDENTITY_FILE = path.join(IDENTITY_DIR, 'identity.json')

/**
 * Derive a stable node ID from the public key.
 */
function deriveNodeId(publicKey: string): string {
  const hash = createHash('sha256').update(publicKey).digest('hex')
  return `node-${hash.slice(0, 16)}`
}

/**
 * Load existing identity or generate + persist a new one.
 * Accepts optional overrides from config for display name and role.
 */
export function loadOrCreateIdentity(opts?: { displayName?: string; role?: string }): NodeIdentity {
  if (fs.existsSync(IDENTITY_FILE)) {
    const raw = fs.readFileSync(IDENTITY_FILE, 'utf8')
    const existing = JSON.parse(raw) as NodeIdentity
    // Merge config overrides
    if (opts?.displayName) existing.displayName = opts.displayName
    if (opts?.role) existing.role = opts.role
    return existing
  }

  // First run: generate identity
  const kp = generateKeyPair()
  const hostname = os.hostname().replace(/\.local$/, '')
  const identity: NodeIdentity = {
    nodeId: deriveNodeId(kp.publicKey),
    publicKey: kp.publicKey,
    privateKey: kp.privateKey,
    displayName: opts?.displayName ?? `node-${hostname}`,
    role: opts?.role ?? 'worker',
    createdAt: Date.now(),
  }

  fs.mkdirSync(IDENTITY_DIR, { recursive: true })
  fs.writeFileSync(IDENTITY_FILE, JSON.stringify(identity, null, 2), { mode: 0o600 })
  console.log(`[identity] Generated new node identity: ${identity.nodeId}`)
  console.log(`[identity] Name: ${identity.displayName}, Role: ${identity.role}`)
  console.log(`[identity] Stored at: ${IDENTITY_FILE}`)

  return identity
}
