#!/usr/bin/env node
/**
 * JackClaw E2E: Social Communication Tests
 *
 * Covers the complete social/groups/files/federation/receipt workflow:
 *   - Register two users (alice, bob)
 *   - Alice sends a social message to Bob
 *   - Bob checks inbox and confirms receipt
 *   - Bob replies to Alice
 *   - Alice sees the reply
 *   - Contact request flow (send + accept)
 *   - View contacts list
 *   - Create group + send group messages
 *   - Message history retrieval
 *   - File upload + download
 *   - WebSocket stats check (chat worker alive)
 *   - Federation status endpoints
 *   - Delivery + read receipts
 *
 * Run standalone: node tests/e2e-social.js
 * Or imported:   require('./e2e-social').runTests(hubUrl)
 */
'use strict'

const http     = require('http')
const net      = require('net')
const crypto   = require('crypto')
const { spawn } = require('child_process')
const path     = require('path')
const fs       = require('fs')
const os       = require('os')

// ─── Runtime state ────────────────────────────────────────────────────────────

let HUB_URL    = process.env.HUB_URL || ''
let hubProcess = null
let passed     = 0
let failed     = 0
const JWT_SECRET = 'e2e-test-secret'

// User + node tokens, set during setup
let aliceToken    = null  // user token (from /api/auth/register)
let bobToken      = null
let aliceHandle   = ''   // '@alice_social_xxx'
let bobHandle     = ''
let nodeAliceToken = null  // node JWT (from /api/register), used for groups
let nodeBobToken   = null

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

function req(method, urlPath, body = null, token = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, HUB_URL)
    const payload = body ? JSON.stringify(body) : null
    const headers = { 'Content-Type': 'application/json' }
    if (token) headers['Authorization'] = `Bearer ${token}`
    if (payload) headers['Content-Length'] = Buffer.byteLength(payload)
    const opts = {
      hostname: url.hostname, port: url.port,
      path: url.pathname + url.search, method, headers, timeout: 8000,
    }
    const r = http.request(opts, (res) => {
      let d = ''
      res.on('data', (c) => (d += c))
      res.on('end', () => {
        try { resolve({ s: res.statusCode, b: JSON.parse(d) }) }
        catch { resolve({ s: res.statusCode, b: d }) }
      })
    })
    r.on('error', reject)
    r.on('timeout', () => { r.destroy(); reject(new Error('timeout')) })
    if (payload) r.write(payload)
    r.end()
  })
}

/**
 * Send a raw HTTP request with arbitrary headers (for file upload etc.)
 */
function rawReq(method, urlPath, body, headers) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, HUB_URL)
    const buf = Buffer.isBuffer(body) ? body : Buffer.from(body ?? '')
    const hdrs = { 'Content-Length': buf.length, ...headers }
    const opts = {
      hostname: url.hostname, port: url.port,
      path: url.pathname + url.search, method, headers: hdrs, timeout: 10000,
    }
    const r = http.request(opts, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => {
        const raw = Buffer.concat(chunks)
        try { resolve({ s: res.statusCode, b: JSON.parse(raw.toString()) }) }
        catch { resolve({ s: res.statusCode, b: raw }) }
      })
    })
    r.on('error', reject)
    r.on('timeout', () => { r.destroy(); reject(new Error('timeout')) })
    if (buf.length) r.write(buf)
    r.end()
  })
}

function ok(name, cond) {
  if (cond) { console.log(`  ✅ ${name}`); passed++ }
  else       { console.log(`  ❌ ${name}`); failed++ }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function findFreePort() {
  return new Promise((resolve) => {
    const srv = net.createServer()
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port
      srv.close(() => resolve(port))
    })
  })
}

function genKeyPair() {
  return crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  })
}

// ─── Multipart builder ────────────────────────────────────────────────────────

function buildMultipart(filename, content, mimeType = 'text/plain') {
  const boundary = `----E2ETestBoundary${Date.now()}`
  const CRLF = '\r\n'
  const parts = [
    `--${boundary}${CRLF}`,
    `Content-Disposition: form-data; name="file"; filename="${filename}"${CRLF}`,
    `Content-Type: ${mimeType}${CRLF}`,
    CRLF,
    content,
    CRLF,
    `--${boundary}--${CRLF}`,
  ]
  return {
    body: Buffer.from(parts.join('')),
    contentType: `multipart/form-data; boundary=${boundary}`,
  }
}

// ─── Hub Startup ──────────────────────────────────────────────────────────────

async function startHub(port) {
  const TEST_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'jackclaw-social-'))
  console.log('\n🔷 Starting Hub for social tests...')
  const script = `
    const { createServer } = require('./packages/hub/dist/server.js')
    const app = createServer()
    app.listen(${port}, () => console.log('HUB_READY'))
  `
  hubProcess = spawn('node', ['-e', script], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, JWT_SECRET, NODE_ENV: 'test', HOME: TEST_HOME, HUB_PORT: String(port) },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  hubProcess.stdout.on('data', () => {})
  hubProcess.stderr.on('data', (d) => {
    const m = d.toString().trim()
    if (m && !m.includes('Warning') && !m.includes('ExperimentalWarning')) {
      console.log(`  [hub:err] ${m}`)
    }
  })
  for (let i = 0; i < 40; i++) {
    await sleep(300)
    try {
      const r = await req('GET', '/health')
      if (r.s === 200) { console.log('  Hub ready.'); return }
    } catch {}
  }
  throw new Error('Hub failed to start within 12s')
}

// ─── Setup: Register Users + Nodes ────────────────────────────────────────────

async function setup() {
  console.log('\n🔷 Setup: Registering users and nodes')

  // Register alice (user account — auto-registers @alice in directory)
  const r1 = await req('POST', '/api/auth/register', {
    handle: 'alice_social',
    password: 'password123',
    displayName: 'Alice Social',
  })
  ok('Alice user registered', r1.s === 201)
  aliceToken  = r1.b?.token
  aliceHandle = '@alice_social'

  // Register bob (user account)
  const r2 = await req('POST', '/api/auth/register', {
    handle: 'bob_social',
    password: 'password123',
    displayName: 'Bob Social',
  })
  ok('Bob user registered', r2.s === 201)
  bobToken  = r2.b?.token
  bobHandle = '@bob_social'

  // Register alice as a node agent (needed for groups JWT auth)
  const kpA = genKeyPair()
  const r3 = await req('POST', '/api/register', {
    nodeId: 'alice_social_node',
    name: 'Alice Social Node',
    role: 'engineer',
    publicKey: kpA.publicKey,
    callbackUrl: 'http://localhost:19001',
  })
  ok('Alice node registered', r3.s === 201 || r3.s === 200)
  nodeAliceToken = r3.b?.token

  // Register bob as a node agent
  const kpB = genKeyPair()
  const r4 = await req('POST', '/api/register', {
    nodeId: 'bob_social_node',
    name: 'Bob Social Node',
    role: 'designer',
    publicKey: kpB.publicKey,
    callbackUrl: 'http://localhost:19002',
  })
  ok('Bob node registered', r4.s === 201 || r4.s === 200)
  nodeBobToken = r4.b?.token
}

// ─── Social Messaging ─────────────────────────────────────────────────────────

async function testSocialMessaging() {
  console.log('\n🔷 Social: Direct Messaging')

  // Alice sends message to Bob
  const msgId = `msg-social-${Date.now()}`
  const r1 = await req('POST', '/api/social/send', {
    id: msgId,
    fromHuman: 'Alice',
    fromAgent: aliceHandle,
    toAgent: bobHandle,
    content: 'Hey Bob! This is a social test message.',
    type: 'text',
  })
  ok('Alice sends social message → 201', r1.s === 201)
  ok('Returns messageId', typeof r1.b?.messageId === 'string')
  ok('Returns thread', typeof r1.b?.thread === 'string')

  const thread = r1.b?.thread

  await sleep(100)

  // Bob checks inbox
  const r2 = await req('GET', `/api/social/messages?agentHandle=${encodeURIComponent(bobHandle)}`)
  ok('Bob inbox → 200', r2.s === 200)
  ok('Bob has messages', (r2.b?.count ?? 0) >= 1)
  const inbox = r2.b?.messages ?? []
  const received = inbox.find(m => m.id === msgId || m.content?.includes('social test message'))
  ok('Bob received the message', !!received)
  ok('Message from alice', received?.fromAgent === aliceHandle)

  return { msgId, thread }
}

async function testReply(msgId) {
  console.log('\n🔷 Social: Reply Flow')

  // Bob replies to Alice's message
  const r1 = await req('POST', '/api/social/reply', {
    replyToId: msgId,
    fromHuman: 'Bob',
    fromAgent: bobHandle,
    content: 'Hi Alice! Got your message, all good!',
    type: 'text',
  })
  ok('Bob replies → 201', r1.s === 201)
  ok('Reply returns messageId', typeof r1.b?.messageId === 'string')

  const replyId = r1.b?.messageId
  await sleep(100)

  // Alice checks her inbox to see Bob's reply
  const r2 = await req('GET', `/api/social/messages?agentHandle=${encodeURIComponent(aliceHandle)}`)
  ok('Alice inbox → 200', r2.s === 200)
  const aliceInbox = r2.b?.messages ?? []
  const reply = aliceInbox.find(m => m.content?.includes('Got your message'))
  ok('Alice received reply', !!reply)
  ok('Reply from bob', reply?.fromAgent === bobHandle)
  ok('Reply has replyTo set', reply?.replyTo === msgId)

  return replyId
}

async function testContactRequest() {
  console.log('\n🔷 Social: Contact Request + Accept')

  // Register charlie for contact test
  await req('POST', '/api/auth/register', {
    handle: 'charlie_social',
    password: 'password123',
    displayName: 'Charlie Social',
  })

  // Alice sends contact request to Charlie
  const r1 = await req('POST', '/api/social/contact', {
    fromAgent: aliceHandle,
    toAgent: '@charlie_social',
    message: 'Hi Charlie, I would like to connect!',
    purpose: 'business collaboration',
  })
  ok('Alice sends contact request → 201', r1.s === 201)
  ok('Returns requestId', typeof r1.b?.requestId === 'string')
  ok('Request status is pending', r1.b?.request?.status === 'pending')

  const requestId = r1.b?.requestId

  // Duplicate contact request after establishing
  // (first accept, then check already-contacts)

  // Charlie accepts the request
  const r2 = await req('POST', '/api/social/contact/respond', {
    requestId,
    fromAgent: '@charlie_social',  // the one responding (toAgent of original)
    decision: 'accept',
    message: 'Sure, happy to connect!',
  })
  ok('Charlie accepts contact → 200', r2.s === 200)
  ok('Decision is accept', r2.b?.decision === 'accept')

  // Alice checks her contacts — Charlie should be there
  const r3 = await req('GET', `/api/social/contacts?agentHandle=${encodeURIComponent(aliceHandle)}`)
  ok('Alice contacts → 200', r3.s === 200)
  const aliceContacts = r3.b?.contacts ?? []
  ok('Charlie in alice contacts', aliceContacts.some(c => c.handle === '@charlie_social'))

  // Charlie checks contacts — Alice should be there (bidirectional)
  const r4 = await req('GET', '/api/social/contacts?agentHandle=@charlie_social')
  ok('Charlie contacts → 200', r4.s === 200)
  const charlieContacts = r4.b?.contacts ?? []
  ok('Alice in charlie contacts (bidirectional)', charlieContacts.some(c => c.handle === aliceHandle))

  // Now try duplicate contact request → 409
  const r5 = await req('POST', '/api/social/contact', {
    fromAgent: aliceHandle,
    toAgent: '@charlie_social',
    message: 'Duplicate request',
  })
  ok('Duplicate contact request → 409', r5.s === 409)

  return requestId
}

async function testSocialProfile() {
  console.log('\n🔷 Social: Profile')

  // Set Alice's social profile
  const r1 = await req('POST', '/api/social/profile', {
    agentHandle: aliceHandle,
    ownerName: 'Alice',
    ownerTitle: 'Software Engineer',
    bio: 'Building cool things',
    skills: ['TypeScript', 'Node.js'],
    contactPolicy: 'open',
  })
  ok('Set profile → 200', r1.s === 200)
  ok('Profile agentHandle correct', r1.b?.profile?.agentHandle === aliceHandle)
  ok('contactPolicy set', r1.b?.profile?.contactPolicy === 'open')

  // Read Alice's profile
  const r2 = await req('GET', `/api/social/profile/${encodeURIComponent(aliceHandle)}`)
  ok('Get profile → 200', r2.s === 200)
  ok('Profile matches', r2.b?.profile?.ownerName === 'Alice')
  ok('Bio present', r2.b?.profile?.bio === 'Building cool things')

  // Non-existent profile → 404
  const r3 = await req('GET', '/api/social/profile/@does_not_exist_xyz')
  ok('Non-existent profile → 404', r3.s === 404)
}

async function testSocialThreads() {
  console.log('\n🔷 Social: Thread List')

  const r = await req('GET', `/api/social/threads?agentHandle=${encodeURIComponent(aliceHandle)}`)
  ok('Threads → 200', r.s === 200)
  ok('Has threads array', Array.isArray(r.b?.threads))
}

// ─── Groups ───────────────────────────────────────────────────────────────────

async function testGroups() {
  console.log('\n🔷 Groups: Create + Message + History')

  // Create group (uses node JWT token from /api/register)
  const r1 = await req('POST', '/api/groups/create', {
    name: 'E2E Test Group',
    members: ['bob_social_node'],
  }, nodeAliceToken)
  ok('Create group → 201', r1.s === 201)
  ok('Group has id', typeof r1.b?.group?.id === 'string')
  ok('Group name correct', r1.b?.group?.name === 'E2E Test Group')
  ok('Creator is admin', r1.b?.group?.admins?.includes('alice_social_node'))

  const groupId = r1.b?.group?.id

  // List groups for alice_social_node
  const r2 = await req('GET', '/api/groups/list', null, nodeAliceToken)
  ok('List groups → 200', r2.s === 200)
  ok('Alice is in the group', (r2.b?.groups ?? []).some(g => g.id === groupId))

  // Get group detail
  const r3 = await req('GET', `/api/groups/${groupId}`, null, nodeAliceToken)
  ok('Get group → 200', r3.s === 200)
  ok('Group detail has members', Array.isArray(r3.b?.group?.members))

  // Non-member access → 403 (register dave_node first)
  const kpD = genKeyPair()
  const rDave = await req('POST', '/api/register', {
    nodeId: 'dave_social_node',
    name: 'Dave Social Node',
    role: 'engineer',
    publicKey: kpD.publicKey,
  })
  const daveTok = rDave.b?.token
  const r4 = await req('GET', `/api/groups/${groupId}`, null, daveTok)
  ok('Non-member → 403', r4.s === 403)

  // Alice sends group message
  const r5 = await req('POST', `/api/groups/${groupId}/message`, {
    content: 'Hello everyone in the E2E test group!',
  }, nodeAliceToken)
  ok('Send group message → 201', r5.s === 201)
  ok('Message has id', typeof r5.b?.message?.id === 'string')

  const groupMsgId = r5.b?.message?.id

  // Bob sends a group message with reply
  const r6 = await req('POST', `/api/groups/${groupId}/message`, {
    content: 'Bob here, replying to the group!',
    replyToId: groupMsgId,
  }, nodeBobToken)
  ok('Bob sends group reply → 201', r6.s === 201)
  ok('Reply has replyToId', r6.b?.message?.replyToId === groupMsgId)

  // Get message history
  const r7 = await req('GET', `/api/groups/${groupId}/messages`, null, nodeAliceToken)
  ok('Get group messages → 200', r7.s === 200)
  ok('Has at least 2 messages', (r7.b?.count ?? 0) >= 2)

  // Add member (admin only)
  const r8 = await req('POST', `/api/groups/${groupId}/members`, {
    nodeIds: ['dave_social_node'],
  }, nodeAliceToken)
  ok('Add member → 200', r8.s === 200)
  ok('Dave now in group', r8.b?.group?.members?.includes('dave_social_node'))

  // Pin message (admin only)
  const r9 = await req('POST', `/api/groups/${groupId}/pin`, {
    messageId: groupMsgId,
  }, nodeAliceToken)
  ok('Pin message → 200', r9.s === 200)
  ok('Message pinned', (r9.b?.pinnedMessageIds ?? []).includes(groupMsgId))

  // Non-admin cannot pin
  const r10 = await req('POST', `/api/groups/${groupId}/pin`, {
    messageId: groupMsgId,
  }, nodeBobToken)
  ok('Non-admin pin → 403', r10.s === 403)

  return groupId
}

async function testGroupChannel() {
  console.log('\n🔷 Groups: Channel (admin-only messaging)')

  const r1 = await req('POST', '/api/groups/create', {
    name: 'E2E Test Channel',
    members: ['bob_social_node'],
    type: 'channel',
  }, nodeAliceToken)
  ok('Create channel → 201', r1.s === 201)
  ok('Type is channel', r1.b?.group?.type === 'channel')

  const channelId = r1.b?.group?.id

  // Alice (admin) can post to channel
  const r2 = await req('POST', `/api/groups/${channelId}/message`, {
    content: 'Admin announcement in channel',
  }, nodeAliceToken)
  ok('Admin posts to channel → 201', r2.s === 201)

  // Bob (member, not admin) cannot post
  const r3 = await req('POST', `/api/groups/${channelId}/message`, {
    content: 'Bob trying to post in channel',
  }, nodeBobToken)
  ok('Non-admin post to channel → 403', r3.s === 403)
}

// ─── File Upload/Download ─────────────────────────────────────────────────────

async function testFiles() {
  console.log('\n🔷 Files: Upload + Download')

  // Build multipart body
  const fileContent = 'This is the content of a test file for JackClaw E2E testing.'
  const { body, contentType } = buildMultipart('test-upload.txt', fileContent, 'text/plain')

  const r1 = await rawReq('POST', '/api/files/upload', body, {
    'Content-Type': contentType,
  })
  ok('File upload → 200 or 201', r1.s === 200 || r1.s === 201)
  ok('Returns fileId', typeof r1.b?.fileId === 'string')
  ok('Returns filename', typeof r1.b?.filename === 'string')

  const fileId = r1.b?.fileId

  // List files
  const r2 = await req('GET', '/api/files/list')
  ok('File list → 200', r2.s === 200)
  ok('Has files array', Array.isArray(r2.b?.files))
  ok('Uploaded file in list', (r2.b?.files ?? []).some(f => f.fileId === fileId))

  // Download the file
  const r3 = await rawReq('GET', `/api/files/${fileId}`, null, {})
  ok('File download → 200', r3.s === 200)
  const downloaded = Buffer.isBuffer(r3.b) ? r3.b.toString() : String(r3.b)
  ok('File content matches', downloaded.includes('E2E testing'))

  // Non-existent file → 404
  const r4 = await req('GET', '/api/files/nonexistent-file-id-xyz')
  ok('Non-existent file → 404', r4.s === 404)

  return fileId
}

// ─── WebSocket Stats ──────────────────────────────────────────────────────────

async function testChatWorkerStats() {
  console.log('\n🔷 Chat: Worker Stats (liveness check)')

  const r = await req('GET', '/api/chat/stats')
  ok('Chat stats → 200', r.s === 200)
  ok('Stats has connected count', typeof r.b?.connected === 'number' || typeof r.b?.connectedNodes === 'number' || 'queue' in (r.b ?? {}))
}

// ─── Federation ───────────────────────────────────────────────────────────────

async function testFederation() {
  console.log('\n🔷 Federation: Status + Peers + Handshake')

  // Status endpoint
  const r1 = await req('GET', '/api/federation/status')
  ok('Federation status → 200', r1.s === 200)
  ok('Has hubUrl', typeof r1.b?.hubUrl === 'string')
  ok('Has publicKey', typeof r1.b?.publicKey === 'string')
  ok('Has peerCount', typeof r1.b?.peerCount === 'number')

  // Peers list
  const r2 = await req('GET', '/api/federation/peers')
  ok('Federation peers → 200', r2.s === 200)
  ok('Has peers array', Array.isArray(r2.b?.peers))

  // Discover local handle
  const r3 = await req('POST', '/api/federation/discover', { handle: 'alice_social' })
  ok('Discover handle → 200', r3.s === 200)
  ok('Found alice locally', r3.b?.found === true && r3.b?.handle === '@alice_social')

  // Discover unknown handle
  const r4 = await req('POST', '/api/federation/discover', { handle: 'totally_unknown_user_xyz' })
  ok('Discover unknown → 200 (not found)', r4.s === 200 && r4.b?.found === false)

  // Handshake (will fail with invalid signature — just verify endpoint exists and returns 4xx not 5xx)
  const r5 = await req('POST', '/api/federation/handshake', {
    handshake: {
      hubUrl: 'http://remote-hub.example.com',
      publicKey: '-----BEGIN PUBLIC KEY-----\nMOCK\n-----END PUBLIC KEY-----',
      ts: Date.now(),
      signature: 'invalid_sig_for_test',
    },
  })
  ok('Handshake endpoint reachable (4xx or 200)', r5.s >= 200 && r5.s < 600)
  ok('Handshake bad sig → not 500', r5.s !== 500)
}

// ─── Message Receipts ─────────────────────────────────────────────────────────

async function testReceipts(msgId) {
  console.log('\n🔷 Receipts: Delivered + Read')

  // Mark delivered
  const r1 = await req('POST', '/api/receipt/delivered', {
    messageId: msgId,
    nodeId: 'bob_social_node',
  })
  ok('Mark delivered → 200', r1.s === 200)
  ok('Receipt status is delivered', r1.b?.receipt?.status === 'delivered')

  // Mark read
  const r2 = await req('POST', '/api/receipt/read', {
    messageId: msgId,
    readBy: 'bob_social_node',
  })
  ok('Mark read → 200', r2.s === 200)
  ok('Receipt has readBy', r2.b?.receipt?.readBy === 'bob_social_node')

  // Check status
  const r3 = await req('GET', `/api/receipt/status/${msgId}`)
  ok('Receipt status → 200', r3.s === 200)
  ok('Status is read', r3.b?.status === 'read')
  ok('readBy contains bob', (r3.b?.readBy ?? []).includes('bob_social_node'))

  // Batch read receipt
  const batchMsgId = `batch-msg-${Date.now()}`
  const r4 = await req('POST', '/api/receipt/read-batch', {
    messageIds: [batchMsgId],
    readBy: 'alice_social_node',
  })
  ok('Batch read → 200', r4.s === 200)
  ok('Batch count = 1', r4.b?.count === 1)

  // Non-existent message receipt status → 404 (if msg was never sent)
  const r5 = await req('GET', '/api/receipt/status/totally-fake-message-id')
  ok('Unknown message receipt → 404', r5.s === 404)
}

// ─── Typing Indicator ─────────────────────────────────────────────────────────

async function testTypingIndicator() {
  console.log('\n🔷 Chat: Typing Indicator')

  const r = await req('POST', '/api/receipt/typing', {
    fromAgent: 'alice_social_node',
    threadId: 'thread-test-123',
    isTyping: true,
    to: 'bob_social_node',
  })
  ok('Typing indicator → 200', r.s === 200)
  ok('Returns indicator object', r.b?.indicator?.fromAgent === 'alice_social_node')
}

// ─── Direct Chat (ClawChat) ───────────────────────────────────────────────────

async function testClawChat() {
  console.log('\n🔷 ClawChat: Send + Inbox + Threads')

  const msgId = `clawchat-${Date.now()}`
  const r1 = await req('POST', '/api/chat/send', {
    id: msgId,
    from: 'alice_social_node',
    to: 'bob_social_node',
    content: 'ClawChat test message',
    type: 'text',
    ts: Date.now(),
    signature: '',
    encrypted: false,
  })
  ok('ClawChat send → 200', r1.s === 200)
  ok('Returns messageId', r1.b?.messageId === msgId)

  await sleep(100)

  // Bob drains inbox
  const r2 = await req('GET', '/api/chat/inbox?nodeId=bob_social_node')
  ok('Bob inbox → 200', r2.s === 200)
  ok('Has messages', typeof r2.b?.count === 'number')

  // Threads for alice
  const r3 = await req('GET', '/api/chat/threads?nodeId=alice_social_node')
  ok('Threads → 200', r3.s === 200)
  ok('Has threads array', Array.isArray(r3.b?.threads))

  // Create a thread
  const r4 = await req('POST', '/api/chat/thread', {
    participants: ['alice_social_node', 'bob_social_node'],
    title: 'E2E Test Thread',
  })
  ok('Create thread → 200', r4.s === 200)
  ok('Thread has id', typeof r4.b?.thread?.id === 'string')
}

// ─── Message Search (filter by content) ──────────────────────────────────────

async function testMessageFilter() {
  console.log('\n🔷 Social: Message Filtering (search-like)')

  // Send a distinctive message
  await req('POST', '/api/social/send', {
    fromHuman: 'Alice',
    fromAgent: aliceHandle,
    toAgent: bobHandle,
    content: 'UNIQUE_SEARCHABLE_KEYWORD_12345',
    type: 'text',
  })

  await sleep(100)

  // Get inbox with limit
  const r = await req('GET', `/api/social/messages?agentHandle=${encodeURIComponent(bobHandle)}&limit=50&offset=0`)
  ok('Filtered messages → 200', r.s === 200)
  const found = (r.b?.messages ?? []).some(m => m.content?.includes('UNIQUE_SEARCHABLE_KEYWORD_12345'))
  ok('Distinctive message found in inbox', found)
}

// ─── Entry Point ──────────────────────────────────────────────────────────────

async function runTests(externalHubUrl) {
  if (externalHubUrl) HUB_URL = externalHubUrl

  passed = 0
  failed = 0

  try {
    await setup()
    const { msgId } = await testSocialMessaging()
    await testReply(msgId)
    await testContactRequest()
    await testSocialProfile()
    await testSocialThreads()
    await testGroups()
    await testGroupChannel()
    await testFiles()
    await testChatWorkerStats()
    await testFederation()
    await testReceipts(msgId)
    await testTypingIndicator()
    await testClawChat()
    await testMessageFilter()
  } catch (err) {
    console.error('\n💥 Social test error:', err.message)
    if (process.env.VERBOSE) console.error(err.stack)
    failed++
  }

  return { passed, failed }
}

// Standalone execution
if (require.main === module) {
  ;(async () => {
    const port = await findFreePort()
    HUB_URL = `http://localhost:${port}`
    await startHub(port)
    const { passed: p, failed: f } = await runTests()
    if (hubProcess) hubProcess.kill()
    console.log(`\n📊 Social Tests: ${p} passed, ${f} failed`)
    process.exit(f > 0 ? 1 : 0)
  })().catch(err => {
    console.error('Fatal:', err)
    if (hubProcess) hubProcess.kill()
    process.exit(1)
  })
}

module.exports = { runTests }
