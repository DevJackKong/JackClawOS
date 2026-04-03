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
 */
export function loadOrCreateIdentity(): NodeIdentity {
  if (fs.existsSync(IDENTITY_FILE)) {
    const raw = fs.readFileSync(IDENTITY_FILE, 'utf8')
    return JSON.parse(raw) as NodeIdentity
  }

  // First run: generate identity
  const kp = generateKeyPair()
  const identity: NodeIdentity = {
    nodeId: deriveNodeId(kp.publicKey),
    publicKey: kp.publicKey,
    privateKey: kp.privateKey,
    createdAt: Date.now(),
  }

  fs.mkdirSync(IDENTITY_DIR, { recursive: true })
  fs.writeFileSync(IDENTITY_FILE, JSON.stringify(identity, null, 2), { mode: 0o600 })
  console.log(`[identity] Generated new node identity: ${identity.nodeId}`)
  console.log(`[identity] Stored at: ${IDENTITY_FILE}`)

  return identity
}
