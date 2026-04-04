// JackClaw Hub — Federation Manager
// Manages inter-hub peer registration, message routing, and handle discovery

import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import https from 'https'
import http from 'http'

import type {
  HubPeer,
  FederatedMessage,
  FederationHandshake,
  HubDirectory,
  FederatedMessageResponse,
  FederationDiscoverResponse,
} from '@jackclaw/protocol'
import type { SocialMessage } from '@jackclaw/protocol'

const HUB_DIR = path.join(process.env.HOME || '~', '.jackclaw', 'hub')
const FEDERATION_FILE   = path.join(HUB_DIR, 'federation.json')
const BLACKLIST_FILE    = path.join(HUB_DIR, 'federation-blacklist.json')
const HEALTH_INTERVAL_MS = 60_000  // ping peers every 60 s

// ─── Persistence shape ────────────────────────────────────────────────────────

interface BlacklistEntry {
  hubUrl:   string
  reason:   string
  addedAt:  number
}

interface FederationStore {
  peers: Record<string, HubPeer>          // keyed by url
  directory: HubDirectory                 // @handle → { hubUrl, lastConfirmed }
}

// ─── Blacklist helpers ────────────────────────────────────────────────────────

function loadBlacklist(): Record<string, BlacklistEntry> {
  try {
    if (fs.existsSync(BLACKLIST_FILE)) {
      return JSON.parse(fs.readFileSync(BLACKLIST_FILE, 'utf-8')) as Record<string, BlacklistEntry>
    }
  } catch { /* ignore */ }
  return {}
}

function saveBlacklist(bl: Record<string, BlacklistEntry>): void {
  fs.mkdirSync(path.dirname(BLACKLIST_FILE), { recursive: true })
  fs.writeFileSync(BLACKLIST_FILE, JSON.stringify(bl, null, 2), 'utf-8')
}

function loadStore(): FederationStore {
  try {
    if (fs.existsSync(FEDERATION_FILE)) {
      return JSON.parse(fs.readFileSync(FEDERATION_FILE, 'utf-8')) as FederationStore
    }
  } catch { /* ignore parse errors */ }
  return { peers: {}, directory: {} }
}

function saveStore(store: FederationStore): void {
  fs.mkdirSync(path.dirname(FEDERATION_FILE), { recursive: true })
  fs.writeFileSync(FEDERATION_FILE, JSON.stringify(store, null, 2), 'utf-8')
}

// ─── HTTP helper ──────────────────────────────────────────────────────────────

function postJSON(url: string, body: unknown, timeoutMs = 8000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body)
    const parsed = new URL(url)
    const isHttps = parsed.protocol === 'https:'
    const lib = isHttps ? https : http

    const req = lib.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || (isHttps ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
        timeout: timeoutMs,
      },
      (res) => {
        let data = ''
        res.on('data', (chunk: Buffer) => { data += chunk.toString() })
        res.on('end', () => {
          try { resolve(JSON.parse(data)) }
          catch { resolve(data) }
        })
      }
    )
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')) })
    req.write(payload)
    req.end()
  })
}

function getJSON(url: string, timeoutMs = 8000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url)
    const isHttps = parsed.protocol === 'https:'
    const lib = isHttps ? https : http

    const req = lib.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || (isHttps ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: 'GET',
        timeout: timeoutMs,
      },
      (res) => {
        let data = ''
        res.on('data', (chunk: Buffer) => { data += chunk.toString() })
        res.on('end', () => {
          try { resolve(JSON.parse(data)) }
          catch { resolve(data) }
        })
      }
    )
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')) })
    req.end()
  })
}

// ─── FederationManager ────────────────────────────────────────────────────────

export class FederationManager {
  private store: FederationStore
  private hubUrl: string
  private publicKey: string
  private privateKey: string
  private startedAt: number
  private healthTimer: ReturnType<typeof setInterval> | null = null

  constructor(
    hubUrl: string,
    publicKey: string,
    privateKey: string,
  ) {
    this.hubUrl = hubUrl
    this.publicKey = publicKey
    this.privateKey = privateKey
    this.startedAt = Date.now()
    this.store = loadStore()
    this._startHealthCheck()
  }

  // ─── Peer management ───────────────────────────────────────────────────────

  /**
   * Register a remote hub as a peer by performing a handshake.
   * The remote hub is expected to have a POST /api/federation/handshake endpoint.
   */
  async registerPeer(hubUrl: string): Promise<HubPeer> {
    const normalizedUrl = hubUrl.replace(/\/$/, '')

    const handshake = this._buildHandshake()

    const result = await postJSON(`${normalizedUrl}/api/federation/handshake`, { handshake }) as {
      status: string
      hub: { url: string; publicKey: string; displayName?: string }
    }

    if (result.status !== 'ok' || !result.hub?.publicKey) {
      throw new Error(`Handshake with ${normalizedUrl} failed: ${JSON.stringify(result)}`)
    }

    const peer: HubPeer = {
      url: result.hub.url || normalizedUrl,
      publicKey: result.hub.publicKey,
      displayName: result.hub.displayName,
      status: 'online',
      lastSeen: Date.now(),
      registeredAt: this.store.peers[normalizedUrl]?.registeredAt ?? Date.now(),
    }

    this.store.peers[normalizedUrl] = peer
    saveStore(this.store)

    console.log(`[federation] Registered peer: ${normalizedUrl}`)
    return peer
  }

  /** Remove a peer hub from the registry */
  removePeer(hubUrl: string): void {
    const normalizedUrl = hubUrl.replace(/\/$/, '')
    delete this.store.peers[normalizedUrl]
    // Also remove any directory entries pointing to this hub
    for (const [handle, entry] of Object.entries(this.store.directory)) {
      if (entry.hubUrl === normalizedUrl) {
        delete this.store.directory[handle]
      }
    }
    saveStore(this.store)
    console.log(`[federation] Removed peer: ${normalizedUrl}`)
  }

  /** List all known peer hubs */
  listPeers(): HubPeer[] {
    return Object.values(this.store.peers)
  }

  // ─── Message routing ───────────────────────────────────────────────────────

  /**
   * Route a SocialMessage to a remote hub.
   * Looks up which hub owns targetHandle, then forwards via federation envelope.
   * Returns 'delivered' | 'queued' | throws on failure.
   */
  async routeToRemoteHub(targetHandle: string, msg: SocialMessage): Promise<FederatedMessageResponse> {
    // Find which peer hosts this handle
    const entry = this.store.directory[targetHandle]
    let targetHubUrl: string | null = entry?.hubUrl ?? null

    // If not in local directory, try to discover
    if (!targetHubUrl) {
      targetHubUrl = await this._discoverHandleInPeers(targetHandle)
    }

    if (!targetHubUrl) {
      throw new Error(`agent_not_found: ${targetHandle} not reachable in federation`)
    }

    const envelope: FederatedMessage = {
      id: crypto.randomUUID(),
      fromHub: this.hubUrl,
      toHub: targetHubUrl,
      message: msg,
      federatedAt: Date.now(),
      hubSignature: this._sign(`${crypto.randomUUID()}${this.hubUrl}${targetHubUrl}${msg.id}`),
    }

    // Re-sign with stable content
    const sigInput = `${envelope.id}${envelope.fromHub}${envelope.toHub}${envelope.message.id}`
    envelope.hubSignature = this._sign(sigInput)

    const result = await postJSON(
      `${targetHubUrl}/api/federation/message`,
      { federatedMessage: envelope }
    ) as FederatedMessageResponse

    return result
  }

  /**
   * Accept a FederatedMessage that arrived from a remote hub.
   * Returns the inner SocialMessage for local delivery.
   */
  receiveFromRemoteHub(envelope: FederatedMessage): SocialMessage {
    // Reject messages from blacklisted hubs
    if (this.isBlacklisted(envelope.fromHub)) {
      throw new Error(`Rejected message from blacklisted hub: ${envelope.fromHub}`)
    }

    // Update peer's lastSeen
    const peer = this.store.peers[envelope.fromHub]
    if (peer) {
      peer.lastSeen = Date.now()
      peer.status = 'online'
      saveStore(this.store)
    }

    console.log(`[federation] Received from ${envelope.fromHub}: ${envelope.message.fromAgent} → ${envelope.message.toAgent}`)
    return envelope.message
  }

  // ─── Handle discovery ──────────────────────────────────────────────────────

  /**
   * Ask all known peers if they host a given @handle.
   * Returns the hub URL of the first peer that claims to have it, or null.
   */
  async discoverHandle(handle: string): Promise<string | null> {
    const normalized = handle.startsWith('@') ? handle : `@${handle}`

    // Check local directory cache first
    const cached = this.store.directory[normalized]
    if (cached) return cached.hubUrl

    return this._discoverHandleInPeers(normalized)
  }

  /**
   * Register a handle → hub mapping in the local federation directory.
   * Called when a remote hub confirms it owns a handle.
   */
  cacheHandleLocation(handle: string, hubUrl: string): void {
    const normalized = handle.startsWith('@') ? handle : `@${handle}`
    this.store.directory[normalized] = { hubUrl, lastConfirmed: Date.now() }
    saveStore(this.store)
  }

  /**
   * Register local handles so peers can discover them.
   * @param handles Array of @handle strings hosted on this hub
   */
  announceLocalHandles(handles: string[]): void {
    for (const h of handles) {
      const normalized = h.startsWith('@') ? h : `@${h}`
      this.store.directory[normalized] = { hubUrl: this.hubUrl, lastConfirmed: Date.now() }
    }
    saveStore(this.store)
  }

  // ─── Inbound handshake processing ─────────────────────────────────────────

  /**
   * Process an inbound handshake from another hub.
   * Verifies the signature and registers the peer.
   */
  processInboundHandshake(handshake: FederationHandshake): HubPeer {
    // Reject replays older than 5 minutes
    if (Date.now() - handshake.ts > 5 * 60 * 1000) {
      throw new Error('Handshake expired (ts too old)')
    }

    const normalizedUrl = handshake.hubUrl.replace(/\/$/, '')

    // Reject blacklisted hubs
    if (this.isBlacklisted(normalizedUrl)) {
      throw new Error(`Hub is blacklisted: ${normalizedUrl}`)
    }

    const sigInput = `${handshake.hubUrl}${handshake.publicKey}${handshake.ts}`
    if (!this._verify(sigInput, handshake.signature, handshake.publicKey)) {
      throw new Error('Handshake signature invalid')
    }

    const existing = this.store.peers[normalizedUrl]

    const peer: HubPeer = {
      url: normalizedUrl,
      publicKey: handshake.publicKey,
      displayName: handshake.displayName,
      status: 'online',
      lastSeen: Date.now(),
      registeredAt: existing?.registeredAt ?? Date.now(),
    }

    this.store.peers[normalizedUrl] = peer
    saveStore(this.store)

    console.log(`[federation] Peer registered via handshake: ${normalizedUrl}`)
    return peer
  }

  // ─── Federation Blacklist ──────────────────────────────────────────────────

  /** Add a hub to the federation blacklist. Removes it from peers as well. */
  addToBlacklist(hubUrl: string, reason: string): void {
    const normalized = hubUrl.replace(/\/$/, '')
    const bl = loadBlacklist()
    bl[normalized] = { hubUrl: normalized, reason, addedAt: Date.now() }
    saveBlacklist(bl)
    // Also remove from peers so we stop pinging it
    if (this.store.peers[normalized]) {
      delete this.store.peers[normalized]
      saveStore(this.store)
    }
    console.log(`[federation] Blacklisted hub: ${normalized} — ${reason}`)
  }

  /** Remove a hub from the blacklist. */
  removeFromBlacklist(hubUrl: string): void {
    const normalized = hubUrl.replace(/\/$/, '')
    const bl = loadBlacklist()
    if (bl[normalized]) {
      delete bl[normalized]
      saveBlacklist(bl)
      console.log(`[federation] Removed from blacklist: ${normalized}`)
    }
  }

  /** Return true if the hub URL is on the blacklist. */
  isBlacklisted(hubUrl: string): boolean {
    const normalized = hubUrl.replace(/\/$/, '')
    return normalized in loadBlacklist()
  }

  /** List all blacklisted hubs. */
  listBlacklist(): BlacklistEntry[] {
    return Object.values(loadBlacklist())
  }

  // ─── Health check ──────────────────────────────────────────────────────────

  /** Ping all known peers and update their status */
  async healthCheck(): Promise<void> {
    const peers = Object.values(this.store.peers)
    await Promise.allSettled(
      peers.map(async (peer) => {
        try {
          await getJSON(`${peer.url}/api/federation/status`, 5000)
          this.store.peers[peer.url].status = 'online'
          this.store.peers[peer.url].lastSeen = Date.now()
        } catch {
          this.store.peers[peer.url].status = 'offline'
        }
      })
    )
    if (peers.length > 0) saveStore(this.store)
  }

  /** Uptime in milliseconds */
  get uptimeMs(): number {
    return Date.now() - this.startedAt
  }

  /** Stop the periodic health check timer (for clean shutdown) */
  stop(): void {
    if (this.healthTimer) {
      clearInterval(this.healthTimer)
      this.healthTimer = null
    }
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  private _buildHandshake(): FederationHandshake {
    const ts = Date.now()
    const sigInput = `${this.hubUrl}${this.publicKey}${ts}`
    return {
      hubUrl: this.hubUrl,
      publicKey: this.publicKey,
      ts,
      signature: this._sign(sigInput),
    }
  }

  private _sign(input: string): string {
    return crypto
      .createSign('SHA256')
      .update(input)
      .sign(this.privateKey, 'base64')
  }

  private _verify(input: string, signature: string, publicKey: string): boolean {
    try {
      return crypto
        .createVerify('SHA256')
        .update(input)
        .verify(publicKey, signature, 'base64')
    } catch {
      return false
    }
  }

  private async _discoverHandleInPeers(handle: string): Promise<string | null> {
    const peers = Object.values(this.store.peers).filter(p => p.status !== 'offline')

    for (const peer of peers) {
      try {
        const result = await postJSON(
          `${peer.url}/api/federation/discover`,
          { handle }
        ) as FederationDiscoverResponse

        if (result.found && result.hubUrl) {
          // Cache the result
          this.store.directory[handle] = { hubUrl: result.hubUrl, lastConfirmed: Date.now() }
          saveStore(this.store)
          return result.hubUrl
        }
      } catch {
        // Peer unreachable — mark offline but continue trying others
        this.store.peers[peer.url].status = 'offline'
      }
    }

    return null
  }

  private _startHealthCheck(): void {
    this.healthTimer = setInterval(() => {
      this.healthCheck().catch(err => {
        console.error('[federation] Health check error:', err)
      })
    }, HEALTH_INTERVAL_MS)
    // Don't block process exit
    if (this.healthTimer.unref) this.healthTimer.unref()
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

let _instance: FederationManager | null = null

export function getFederationManager(): FederationManager {
  if (!_instance) {
    throw new Error('FederationManager not initialized — call initFederationManager() first')
  }
  return _instance
}

export function initFederationManager(
  hubUrl: string,
  publicKey: string,
  privateKey: string,
): FederationManager {
  if (_instance) return _instance
  _instance = new FederationManager(hubUrl, publicKey, privateKey)
  return _instance
}
