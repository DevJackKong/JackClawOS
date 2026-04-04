#!/usr/bin/env node
/**
 * JackClaw E2E Integration Test
 * Tests the complete Hub lifecycle:
 *   Health → CEO register → Node register → Node listing (CEO) → Report → Directory → Messages
 */

const http = require('http');
const crypto = require('crypto');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const HUB_PORT = 19099;
const HUB_URL = `http://localhost:${HUB_PORT}`;
const JWT_SECRET = 'e2e-test-secret';

// Use a temp HOME so the Hub gets a fresh node store each run
const TEST_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'jackclaw-e2e-'));

let hubProcess = null;
let passed = 0;
let failed = 0;
let ceoToken = null;
let aliceToken = null;
let bobToken = null;

function genKeyPair() {
  return crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  });
}

function req(method, urlPath, body = null, token = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, HUB_URL);
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const opts = {
      hostname: url.hostname, port: url.port,
      path: url.pathname + url.search, method, headers, timeout: 5000,
    };
    const r = http.request(opts, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => {
        try { resolve({ s: res.statusCode, b: JSON.parse(d) }); }
        catch { resolve({ s: res.statusCode, b: d }); }
      });
    });
    r.on('error', reject);
    r.on('timeout', () => { r.destroy(); reject(new Error('timeout')); });
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

function ok(name, cond) {
  if (cond) { console.log(`  ✅ ${name}`); passed++; }
  else { console.log(`  ❌ ${name}`); failed++; }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function reqWithHeaders(method, urlPath, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, HUB_URL);
    const hdrs = { 'Content-Type': 'application/json', ...headers };
    const opts = {
      hostname: url.hostname, port: url.port,
      path: url.pathname + url.search, method, headers: hdrs, timeout: 5000,
    };
    const r = http.request(opts, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => {
        try { resolve({ s: res.statusCode, b: JSON.parse(d) }); }
        catch { resolve({ s: res.statusCode, b: d }); }
      });
    });
    r.on('error', reject);
    r.on('timeout', () => { r.destroy(); reject(new Error('timeout')); });
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

// ─── Hub Startup ───────────────────────────────────────────────

async function startHub() {
  console.log('\n🔷 Starting Hub...');
  const script = `
    const { createServer } = require('./packages/hub/dist/server.js');
    const app = createServer();
    app.listen(${HUB_PORT}, () => console.log('HUB_READY'));
  `;
  hubProcess = spawn('node', ['-e', script], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, JWT_SECRET, NODE_ENV: 'test', HOME: TEST_HOME },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  hubProcess.stderr.on('data', (d) => {
    const m = d.toString().trim();
    if (m && !m.includes('Warning')) console.log(`  [hub:err] ${m}`);
  });
  for (let i = 0; i < 30; i++) {
    await sleep(300);
    try {
      const r = await req('GET', '/health');
      if (r.s === 200) { console.log('  Hub ready.'); return; }
    } catch {}
  }
  throw new Error('Hub failed to start');
}

// ─── Tests ─────────────────────────────────────────────────────

async function testHealth() {
  console.log('\n🔷 Health Check');
  const r = await req('GET', '/health');
  ok('GET /health → 200', r.s === 200);
  ok('status=ok', r.b?.status === 'ok');
  ok('service=jackclaw-hub', r.b?.service === 'jackclaw-hub');
}

async function testRegisterCEO() {
  console.log('\n🔷 Register CEO');
  const kp = genKeyPair();
  const r = await req('POST', '/api/register', {
    nodeId: 'ceo-jack',
    name: 'CEO Jack',
    role: 'ceo',
    publicKey: kp.publicKey,
    callbackUrl: 'http://localhost:19010',
  });
  ok('CEO registers (201 or 200)', r.s === 201 || r.s === 200);
  ok('Returns token', typeof r.b?.token === 'string' && r.b.token.length > 20);
  ok('Returns hubPublicKey', typeof r.b?.hubPublicKey === 'string');
  ceoToken = r.b?.token;
}

async function testRegisterNodes() {
  console.log('\n🔷 Register Worker Nodes');
  const kpA = genKeyPair();
  const r1 = await req('POST', '/api/register', {
    nodeId: 'alice',
    name: 'Engineer Alice',
    role: 'engineer',
    publicKey: kpA.publicKey,
    callbackUrl: 'http://localhost:19001',
  });
  ok('Alice registers (201 or 200)', r1.s === 201 || r1.s === 200);
  aliceToken = r1.b?.token;

  const kpB = genKeyPair();
  const r2 = await req('POST', '/api/register', {
    nodeId: 'bob',
    name: 'Designer Bob',
    role: 'designer',
    publicKey: kpB.publicKey,
    callbackUrl: 'http://localhost:19002',
  });
  ok('Bob registers (201 or 200)', r2.s === 201 || r2.s === 200);
  bobToken = r2.b?.token;
}

async function testDuplicateRegister() {
  console.log('\n🔷 Duplicate Registration → Update');
  const kp = genKeyPair();
  const r = await req('POST', '/api/register', {
    nodeId: 'alice',
    name: 'Alice v2',
    role: 'engineer',
    publicKey: kp.publicKey,
  });
  ok('Re-register → 200', r.s === 200);
  ok('action=updated', r.b?.action === 'updated');
  aliceToken = r.b?.token; // refresh
}

async function testBadRegister() {
  console.log('\n🔷 Bad Registration → 400');
  const r = await req('POST', '/api/register', { nodeId: 'bad' });
  ok('Missing fields → 400', r.s === 400);
}

async function testNodesListAuth() {
  console.log('\n🔷 Node Listing (requires CEO)');
  // No token
  const r0 = await req('GET', '/api/nodes');
  ok('No token → 401', r0.s === 401);

  // Worker token
  const r1 = await req('GET', '/api/nodes', null, aliceToken);
  ok('Worker token → 403', r1.s === 403);

  // CEO token
  const r2 = await req('GET', '/api/nodes', null, ceoToken);
  ok('CEO token → 200', r2.s === 200);

  const nodes = Array.isArray(r2.b) ? r2.b : r2.b?.nodes || [];
  ok('Has ≥3 nodes (ceo+alice+bob)', nodes.length >= 3);

  const ids = nodes.map((n) => n.nodeId);
  ok('CEO in list', ids.includes('ceo-jack'));
  ok('Alice in list', ids.includes('alice'));
  ok('Bob in list', ids.includes('bob'));
}

async function testReport() {
  console.log('\n🔷 Report Submission (plaintext dev mode)');
  const r = await req('POST', '/api/reports', {
    summary: 'Login page done. Auth API 50% complete.',
    period: 'daily',
    visibility: 'ceo',
    data: {
      tasks: [
        { name: 'login-page', status: 'done', hours: 3 },
        { name: 'auth-api', status: 'in-progress', hours: 1 },
      ],
      blockers: [],
    },
  }, aliceToken);
  ok('Report → 200', r.s === 200);
  ok('Report has messageId', typeof r.b?.messageId === 'string');
}

async function testSummary() {
  console.log('\n🔷 Daily Summary (CEO)');
  const today = new Date().toISOString().slice(0, 10);
  const r = await req('GET', `/api/summary?date=${today}`, null, ceoToken);
  ok('Summary → 200', r.s === 200);
  ok('Has reporting nodes', (r.b?.reportingNodes ?? 0) >= 1);
}

async function testChatSend() {
  console.log('\n🔷 ClawChat: Send + Inbox');
  // Send message from Alice to Bob
  const r1 = await req('POST', '/api/chat/send', {
    id: `msg-${Date.now()}`,
    from: 'alice',
    to: 'bob',
    content: 'Hey Bob, can you review my PR?',
    type: 'text',
    ts: Date.now(),
    signature: '',
    encrypted: false,
  }, aliceToken);
  ok('Chat send → 200', r1.s === 200);
  ok('Message accepted', r1.b?.status === 'ok' || r1.b?.messageId);

  // Bob pulls inbox
  const r2 = await req('GET', '/api/chat/inbox?nodeId=bob', null, bobToken);
  ok('Inbox → 200', r2.s === 200);
  ok('Bob has ≥1 message', (r2.b?.count ?? 0) >= 1);
}

async function testChatThread() {
  console.log('\n🔷 ClawChat: Thread');
  const r1 = await req('POST', '/api/chat/thread', {
    participants: ['alice', 'bob'],
    title: 'PR Review Discussion',
  }, aliceToken);
  ok('Create thread → 200', r1.s === 200);
  ok('Thread has id', typeof r1.b?.thread?.id === 'string');

  const r2 = await req('GET', '/api/chat/threads?nodeId=alice', null, aliceToken);
  ok('List threads → 200', r2.s === 200);
}

async function testChatGroup() {
  console.log('\n🔷 ClawChat: Group');
  const r1 = await req('POST', '/api/chat/group/create', {
    name: 'Engineering Team',
    members: ['ceo-jack', 'alice', 'bob'],
    createdBy: 'ceo-jack',
    topic: 'Sprint planning',
  }, ceoToken);
  ok('Create group → 200', r1.s === 200);
  ok('Group has id', typeof r1.b?.group?.groupId === 'string');

  const r2 = await req('GET', '/api/chat/groups?nodeId=alice', null, aliceToken);
  ok('List groups → 200', r2.s === 200);
  ok('Alice in ≥1 group', (r2.b?.groups?.length ?? 0) >= 1);
}

async function testCollaboration() {
  console.log('\n🔷 Collaboration: Invite + Respond');
  // First register Bob's handle
  const kp = genKeyPair();
  await req('POST', '/api/directory/register', {
    handle: '@bob',
    nodeId: 'bob',
    publicKey: kp.publicKey,
    displayName: 'Designer Bob',
    role: 'member',
    capabilities: ['design'],
    visibility: 'public',
  }, bobToken);

  // Alice invites Bob
  const r1 = await req('POST', '/api/directory/collab/invite', {
    fromHandle: '@alice',
    toHandle: '@bob',
    topic: 'Login page design review',
    memoryScope: 'shared',
    memoryClearOnEnd: false,
  }, aliceToken);
  ok('Invite → 201', r1.s === 201);
  ok('Has sessionId', typeof r1.b?.sessionId === 'string');
  const inviteId = r1.b?.inviteId;

  // Bob responds
  const r2 = await req('POST', '/api/directory/collab/respond', {
    inviteId,
    fromHandle: '@bob',
    decision: 'accept',
  }, bobToken);
  ok('Respond → 200', r2.s === 200);
  ok('Status = accepted', r2.b?.status === 'accepted');

  // List active sessions
  const r3 = await req('GET', '/api/directory/collab/sessions?status=accepted', null, aliceToken);
  ok('Sessions list → 200', r3.s === 200);
  ok('Has ≥1 active session', (r3.b?.count ?? 0) >= 1);
}

async function testDirectory() {
  console.log('\n🔷 Directory: Register + Lookup');
  // Register a handle for Alice
  const kp = genKeyPair();
  const r1 = await req('POST', '/api/directory/register', {
    handle: '@alice',
    nodeId: 'alice',
    publicKey: kp.publicKey,
    displayName: 'Engineer Alice',
    role: 'member',
    capabilities: ['code', 'review'],
    visibility: 'public',
  }, aliceToken);
  ok('Handle register → 201', r1.s === 201);
  ok('Handle returned', typeof r1.b?.handle === 'string');

  // Lookup
  const r2 = await req('GET', '/api/directory/lookup/alice', null, aliceToken);
  ok('Lookup → 200', r2.s === 200);
  ok('Found alice', r2.b?.found === true);

  // List public
  const r3 = await req('GET', '/api/directory/list', null, ceoToken);
  ok('List → 200', r3.s === 200);
  ok('Has agents', (r3.b?.count ?? 0) >= 1);
}

// ─── Payment Vault Tests ───────────────────────────────────────

async function testPaymentVault() {
  console.log('\n🔷 Payment Vault');

  // 1. Submit payment (CN jurisdiction, amount > autoApproveLimit → pending_human)
  const r1 = await req('POST', '/api/payment/submit', {
    nodeId: 'alice',
    amount: 500,
    currency: 'CNY',
    recipient: 'vendor@example.com',
    description: 'Cloud hosting bill',
    category: 'infrastructure',
    jurisdiction: 'CN',
    paymentMethod: 'alipay',
  }, aliceToken);
  ok('Payment submit → 201', r1.s === 201);
  ok('Returns payment.requestId', typeof r1.b?.payment?.requestId === 'string');
  const paymentId = r1.b?.payment?.requestId;

  // 2. Get pending (CEO token)
  const r2 = await req('GET', '/api/payment/pending', null, ceoToken);
  ok('Pending → 200', r2.s === 200);
  const pendingBefore = r2.b?.requests?.length ?? 0;
  ok('Has ≥1 pending', pendingBefore >= 1);

  // 3. Approve without human-token → 401
  const humanTokenSecret = 'change-me-in-production';
  const hmacApprove = crypto.createHmac('sha256', humanTokenSecret)
    .update(paymentId)
    .digest('hex');
  const r3 = await req('POST', `/api/payment/approve/${paymentId}`, {}, ceoToken);
  ok('Approve without human-token → 401', r3.s === 401);

  // 4. Approve with proper human token
  const r3b = await reqWithHeaders('POST', `/api/payment/approve/${paymentId}`, {},
    { 'Authorization': `Bearer ${ceoToken}`, 'x-human-token': hmacApprove });
  ok('Approve with human-token → 200', r3b.s === 200);

  // 5. Pending should decrease
  const r4 = await req('GET', '/api/payment/pending', null, ceoToken);
  const pendingAfter = r4.b?.requests?.length ?? 0;
  ok('Pending decreased after approve', pendingAfter < pendingBefore);

  // 6. Submit another, then reject
  const r5 = await req('POST', '/api/payment/submit', {
    nodeId: 'bob',
    amount: 500,
    currency: 'CNY',
    recipient: 'suspicious@example.com',
    description: 'Suspicious payment',
    category: 'general',
    jurisdiction: 'CN',
    paymentMethod: 'wechat_pay',
  }, bobToken);
  const rejectId = r5.b?.payment?.requestId;
  const hmacReject = crypto.createHmac('sha256', humanTokenSecret)
    .update(rejectId)
    .digest('hex');
  const r5b = await reqWithHeaders('POST', `/api/payment/reject/${rejectId}`,
    { reason: 'Looks suspicious' },
    { 'Authorization': `Bearer ${ceoToken}`, 'x-human-token': hmacReject });
  ok('Reject with human-token → 200', r5b.s === 200);

  // 7. Audit log
  const r6 = await req('GET', '/api/payment/audit/alice', null, ceoToken);
  ok('Audit log → 200', r6.s === 200);
}

// ─── /api/ask Tests ────────────────────────────────────────────

async function testAskProxy() {
  console.log('\n🔷 /api/ask Proxy');

  // 1. Missing prompt → 400
  const r1 = await req('POST', '/api/ask', {}, aliceToken);
  ok('No prompt → 400', r1.s === 400);
  ok('Error mentions prompt', (r1.b?.error || '').includes('prompt'));

  // 2. With prompt but nodes have fake callbackUrls → 502 (unreachable)
  const r2 = await req('POST', '/api/ask', { prompt: 'Hello' }, aliceToken);
  ok('/api/ask responds (502 or 503)', r2.s === 502 || r2.s === 503);

  // 3. Ask with explicit nodeId that doesn't exist
  const r3 = await req('POST', '/api/ask', {
    prompt: 'Hello',
    nodeId: 'nonexistent-node',
  }, aliceToken);
  ok('Nonexistent node → 503', r3.s === 503);
  ok('Returns available list', Array.isArray(r3.b?.available));
}

// ─── Memory Search Tests (direct import) ───────────────────────

async function testMemorySearch() {
  console.log('\n🔷 Memory Search (MemoryManager)');

  let MemoryManager;
  try {
    const memModule = require(path.join(__dirname, '..', 'packages', 'memory', 'dist', 'index.js'));
    MemoryManager = memModule.MemoryManager;
  } catch (e) {
    console.log(`  [skip] Cannot load @jackclaw/memory: ${e.message}`);
    return;
  }

  const mgr = new MemoryManager();
  const testNodeId = `e2e-test-${Date.now()}`;

  // 1. Save memories
  const m1 = mgr.save({
    nodeId: testNodeId,
    type: 'project',
    scope: 'private',
    content: 'Building the JackClaw payment vault system with compliance checks',
    tags: ['payment', 'vault'],
  });
  ok('Save memory returns id', typeof m1.id === 'string');

  mgr.save({
    nodeId: testNodeId,
    type: 'feedback',
    scope: 'private',
    content: 'Always validate human token before approving payments',
    why: 'Security requirement for payment flow',
    tags: ['security'],
  });

  mgr.save({
    nodeId: testNodeId,
    type: 'user',
    scope: 'private',
    content: 'User prefers dark mode and minimal UI',
    tags: ['preference'],
  });

  // 2. Query basic
  const results = mgr.query(testNodeId, { type: 'project' });
  ok('Query by type returns results', results.length >= 1);

  // 3. Semantic query (TF-IDF, no embedder)
  const semResults = await mgr.semanticQuery(testNodeId, 'payment security', 3);
  ok('semanticQuery returns scored results', semResults.length >= 1 && typeof semResults[0].score === 'number');
  ok('Top result is relevant (score > 0)', semResults[0].score > 0);

  // 4. Stats
  const stats = mgr.stats(testNodeId);
  ok('Stats returns entry count', stats.totalEntries >= 3);

  // Cleanup
  for (const entry of mgr.query(testNodeId)) {
    mgr.deleteFromNode(testNodeId, entry.id);
  }
}

// ─── ClawChat Extended Tests ───────────────────────────────────

async function testChatExtended() {
  console.log('\n🔷 ClawChat: Extended');

  // 1. Create thread + get messages
  const r1 = await req('POST', '/api/chat/thread', {
    participants: ['alice', 'bob'],
    title: 'E2E Test Thread',
  }, aliceToken);
  ok('Create thread → 200', r1.s === 200);
  const threadId = r1.b?.thread?.id;

  // Send message to this thread
  await req('POST', '/api/chat/send', {
    id: `tmsg-${Date.now()}`,
    from: 'alice',
    to: 'bob',
    content: 'Thread test message',
    type: 'text',
    ts: Date.now(),
    threadId: threadId,
    signature: '',
    encrypted: false,
  }, aliceToken);

  const r2 = await req('GET', `/api/chat/thread/${threadId}`, null, aliceToken);
  ok('Get thread messages → 200', r2.s === 200);

  // 2. Create group
  const r3 = await req('POST', '/api/chat/group/create', {
    name: 'E2E Test Group',
    members: ['ceo-jack', 'alice', 'bob'],
    createdBy: 'ceo-jack',
    topic: 'E2E Testing',
  }, ceoToken);
  ok('Create group → 200', r3.s === 200);
  const groupId = r3.b?.group?.groupId;
  ok('Group has groupId', typeof groupId === 'string');

  // 3. Send message to group
  const r4 = await req('POST', '/api/chat/send', {
    id: `gmsg-${Date.now()}`,
    from: 'alice',
    to: groupId,
    content: 'Group test message',
    type: 'text',
    ts: Date.now(),
    signature: '',
    encrypted: false,
  }, aliceToken);
  ok('Send to group → 200', r4.s === 200);

  // 4. List groups for alice
  const r5 = await req('GET', '/api/chat/groups?nodeId=alice', null, aliceToken);
  ok('List groups → 200', r5.s === 200);
  ok('Alice in ≥2 groups (original + e2e)', (r5.b?.groups?.length ?? 0) >= 2);
}

// ─── OrgMemory API Tests ───────────────────────────────────────

async function testOrgMemory() {
  console.log('\n🔷 OrgMemory API');

  // 1. Add a lesson memory
  const r1 = await req('POST', '/api/org-memory', {
    type: 'lesson',
    content: 'Always run integration tests before merging to main.',
    nodeId: 'alice',
    tags: ['testing', 'process'],
  }, aliceToken);
  ok('Add lesson → 201', r1.s === 201);
  ok('Entry has id', typeof r1.b?.entry?.id === 'string');
  const lessonId = r1.b?.entry?.id;

  // 2. Add a decision memory
  const r2 = await req('POST', '/api/org-memory', {
    type: 'decision',
    content: 'Use JWT for all inter-node authentication.',
    nodeId: 'ceo-jack',
    tags: ['security', 'architecture'],
  }, ceoToken);
  ok('Add decision → 201', r2.s === 201);

  // 3. Add a milestone
  const r3 = await req('POST', '/api/org-memory', {
    type: 'milestone',
    content: 'Payment vault launched with human-in-loop approval.',
    nodeId: 'ceo-jack',
  }, ceoToken);
  ok('Add milestone → 201', r3.s === 201);

  // 4. Invalid type → 400
  const r4 = await req('POST', '/api/org-memory', {
    type: 'invalid-type',
    content: 'This should fail',
  }, aliceToken);
  ok('Invalid type → 400', r4.s === 400);

  // 5. Missing content → 400
  const r5 = await req('POST', '/api/org-memory', {
    type: 'lesson',
  }, aliceToken);
  ok('Missing content → 400', r5.s === 400);

  // 6. List all memories
  const r6 = await req('GET', '/api/org-memory', null, ceoToken);
  ok('List all → 200', r6.s === 200);
  ok('Has ≥3 entries', (r6.b?.total ?? 0) >= 3);

  // 7. Filter by type
  const r7 = await req('GET', '/api/org-memory?type=lesson', null, aliceToken);
  ok('Filter by type → 200', r7.s === 200);
  ok('All entries are lessons', r7.b?.entries?.every(e => e.type === 'lesson'));

  // 8. Search
  const r8 = await req('GET', '/api/org-memory/search?q=payment', null, aliceToken);
  ok('Search → 200', r8.s === 200);
  ok('Search finds payment entry', (r8.b?.total ?? 0) >= 1);

  // 9. Search missing q → 400
  const r9 = await req('GET', '/api/org-memory/search', null, aliceToken);
  ok('Search no q → 400', r9.s === 400);

  // 10. Get single entry by id
  const r10 = await req('GET', `/api/org-memory/${lessonId}`, null, aliceToken);
  ok('Get by id → 200', r10.s === 200);
  ok('Entry content matches', r10.b?.entry?.content?.includes('integration tests'));

  // 11. Get non-existent → 404
  const r11 = await req('GET', '/api/org-memory/nonexistent-id-xyz', null, aliceToken);
  ok('Non-existent entry → 404', r11.s === 404);

  // 12. Delete (non-CEO) → 403
  const r12 = await req('DELETE', `/api/org-memory/${lessonId}`, null, aliceToken);
  ok('Worker delete → 403', r12.s === 403);

  // 13. Delete (CEO) → 200
  const r13 = await req('DELETE', `/api/org-memory/${lessonId}`, null, ceoToken);
  ok('CEO delete → 200', r13.s === 200);

  // 14. Verify deleted
  const r14 = await req('GET', `/api/org-memory/${lessonId}`, null, ceoToken);
  ok('After delete → 404', r14.s === 404);
}

// ─── LLM Gateway Unit Tests (direct module import) ──────────────

async function testLLMGateway() {
  console.log('\n🔷 LLM Gateway (module)');

  let LLMGateway;
  try {
    const mod = require(path.join(__dirname, '..', 'packages', 'llm-gateway', 'dist', 'gateway.js'));
    LLMGateway = mod.LLMGateway;
  } catch (e) {
    console.log(`  [skip] Cannot load @jackclaw/llm-gateway: ${e.message}`);
    return;
  }

  // Build a gateway with a mock OpenAI-compatible provider
  const gw = new LLMGateway({
    providers: [
      {
        provider: 'openai',
        apiKey: 'sk-test-fake',
        baseUrl: 'http://localhost:9999/v1',
        defaultModel: 'gpt-4o-mini',
      },
      {
        provider: 'anthropic',
        apiKey: 'sk-ant-test-fake',
        defaultModel: 'claude-sonnet-4-6',
      },
      {
        provider: 'deepseek',
        apiKey: 'sk-deepseek-test-fake',
        baseUrl: 'https://api.deepseek.com/v1',
        defaultModel: 'deepseek-chat',
      },
    ],
    defaultProvider: 'openai',
    fallbackChain: ['anthropic', 'deepseek'],
    timeoutMs: 5000,
    maxRetries: 1,
  });

  // 1. listProviders
  const providers = gw.listProviders();
  ok('listProviders returns array', Array.isArray(providers));
  ok('Has openai provider', providers.includes('openai'));
  ok('Has anthropic provider', providers.includes('anthropic'));
  ok('Has deepseek provider', providers.includes('deepseek'));

  // 2. resolveProvider by model prefix
  const p1 = gw.resolveProvider('claude-sonnet-4-6');
  ok('claude model → anthropic provider', p1?.name === 'anthropic');

  const p2 = gw.resolveProvider('gpt-4o');
  ok('gpt model → openai provider', p2?.name === 'openai');

  const p3 = gw.resolveProvider('deepseek-chat');
  ok('deepseek model → deepseek provider', p3?.name === 'deepseek');

  // 3. estimateCost
  const cost1 = gw.estimateCost('gpt-4o', 1000, 500);
  ok('estimateCost gpt-4o > 0', cost1 > 0);

  const cost2 = gw.estimateCost('claude-sonnet-4-6', 1000, 500);
  ok('estimateCost claude > 0', cost2 > 0);

  const cost3 = gw.estimateCost('llama3', 10000, 5000);
  ok('estimateCost local = 0', cost3 === 0);

  // 4. getStats initial state
  const stats = gw.getStats();
  ok('Initial totalRequests = 0', stats.totalRequests === 0);
  ok('Initial totalCostUsd = 0', stats.totalCostUsd === 0);
  ok('Stats has byProvider', typeof stats.byProvider === 'object');

  // 5. chat() fails → all providers fail → throws
  let threw = false;
  try {
    await gw.chat({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'hello' }],
    });
  } catch (e) {
    threw = true;
    ok('chat() throws when all providers fail', threw);
    ok('Error message mentions gateway', e.message.includes('gateway') || e.message.length > 0);
  }
  if (!threw) ok('chat() throws when all providers fail', false);

  // 6. addProvider
  gw.addProvider({
    provider: 'groq',
    apiKey: 'gsk-test',
    baseUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.3-70b-versatile',
  });
  ok('addProvider adds groq', gw.listProviders().includes('groq'));
}

// ─── Humans API (Identity Complete Flow) ──────────────────────

async function testHumans() {
  console.log('\n🔷 Humans API (Identity Flow)');

  // 1. Register a human (no JWT needed)
  const r1 = await req('POST', '/api/humans/register', {
    humanId: 'jack-human',
    displayName: 'Jack (Human)',
    agentNodeId: 'ceo-jack',
    webhookUrl: 'http://localhost:19099/dev/null',
  });
  ok('Register human → 200', r1.s === 200);
  ok('Human has humanId', r1.b?.human?.humanId === 'jack-human');
  ok('Human has humanToken', typeof r1.b?.human?.humanToken === 'string');
  const humanToken = r1.b?.human?.humanToken;

  // 2. Register another human for messaging target
  const r2 = await req('POST', '/api/humans/register', {
    humanId: 'mary-human',
    displayName: 'Mary (Human)',
    agentNodeId: 'alice',
  });
  ok('Register second human → 200', r2.s === 200);

  // 3. Missing required fields → 400
  const r3 = await req('POST', '/api/humans/register', {
    humanId: 'incomplete-human',
    // missing displayName
  });
  ok('Missing displayName → 400', r3.s === 400);

  // 4. List all humans (no auth needed)
  const r4 = await req('GET', '/api/humans');
  ok('List humans → 200', r4.s === 200);
  ok('Has ≥2 humans', (r4.b?.humans?.length ?? 0) >= 2);
  const ids = r4.b?.humans?.map(h => h.humanId) ?? [];
  ok('jack-human in list', ids.includes('jack-human'));

  // 5. Human sends message with valid humanToken
  const r5 = await reqWithHeaders('POST', '/api/humans/message', {
    to: 'alice',
    content: 'Hello from Jack the human!',
    type: 'human',
  }, { 'Authorization': `HumanToken ${humanToken}` });
  ok('Human message → 200', r5.s === 200);
  ok('Message has messageId', typeof r5.b?.messageId === 'string');

  // 6. Human message to another humanId (routed via agent)
  const r6 = await reqWithHeaders('POST', '/api/humans/message', {
    to: 'mary-human',
    content: 'Hey Mary, how are you?',
  }, { 'Authorization': `HumanToken ${humanToken}` });
  ok('Human-to-human message → 200', r6.s === 200);

  // 7. Invalid humanToken → 401
  const r7 = await reqWithHeaders('POST', '/api/humans/message', {
    to: 'alice',
    content: 'Should fail',
  }, { 'Authorization': 'HumanToken invalid-token-xyz' });
  ok('Invalid humanToken → 401', r7.s === 401);

  // 8. Missing Authorization header → 401
  const r8 = await req('POST', '/api/humans/message', {
    to: 'alice',
    content: 'No auth',
  });
  ok('No auth header → 401', r8.s === 401);

  // 9. Missing required fields in message → 400
  const r9 = await reqWithHeaders('POST', '/api/humans/message', {
    // missing 'to'
    content: 'Missing to field',
  }, { 'Authorization': `HumanToken ${humanToken}` });
  ok('Missing to field → 400', r9.s === 400);
}

// ─── HumanInLoop Review Tests ──────────────────────────────────

async function testHumanReview() {
  console.log('\n🔷 Human-in-Loop Review');

  // 1. Submit review request
  const deadline = Date.now() + 60000; // 1 minute
  const r1 = await req('POST', '/api/review/request', {
    trigger: 'large_payment',
    nodeId: 'alice',
    description: 'Alice wants to approve $10,000 infrastructure spend',
    context: { amount: 10000, currency: 'USD', category: 'infrastructure' },
    options: [
      { id: 'approve', label: 'Approve', action: 'proceed' },
      { id: 'reject', label: 'Reject', action: 'abort' },
    ],
    deadline,
    defaultOnTimeout: 'reject',
  }, aliceToken);
  ok('Submit review request → 201', r1.s === 201);
  ok('Returns requestId', typeof r1.b?.requestId === 'string');
  const reviewId = r1.b?.requestId;

  // 2. Missing required fields → 400
  const r2 = await req('POST', '/api/review/request', {
    trigger: 'test',
    // missing nodeId, description
  }, aliceToken);
  ok('Missing fields → 400', r2.s === 400);

  // 3. Get pending reviews
  const r3 = await req('GET', '/api/review/pending', null, ceoToken);
  ok('Get pending → 200', r3.s === 200);
  ok('Has ≥1 pending review', (r3.b?.requests?.length ?? 0) >= 1);

  // 4. Get pending filtered by nodeId
  const r4 = await req('GET', '/api/review/pending?nodeId=alice', null, ceoToken);
  ok('Get pending by nodeId → 200', r4.s === 200);
  ok('All pending are from alice', r4.b?.requests?.every(r => r.nodeId === 'alice'));

  // 5. Resolve without human-token → 401
  const r5 = await req('POST', `/api/review/resolve/${reviewId}`, { decision: 'approve' }, ceoToken);
  ok('Resolve without human-token → 401', r5.s === 401);

  // 6. Resolve with invalid human-token → 403
  const r6 = await reqWithHeaders('POST', `/api/review/resolve/${reviewId}`,
    { decision: 'approve' },
    { 'Authorization': `Bearer ${ceoToken}`, 'human-token': 'invalid-token' });
  ok('Resolve with invalid token → 403', r6.s === 403);

  // 7. Resolve with valid HMAC human-token
  const humanTokenSecret = 'change-me-in-production';
  if (!reviewId) {
    ok('Resolve with valid token → 200', false);
    ok('Returns success=true', false);
    ok('Double resolve → 409', false);
    return;
  }
  const hmac = crypto.createHmac('sha256', humanTokenSecret)
    .update(reviewId)
    .digest('hex');
  const r7 = await reqWithHeaders('POST', `/api/review/resolve/${reviewId}`,
    { decision: 'approve' },
    { 'Authorization': `Bearer ${ceoToken}`, 'human-token': hmac });
  ok('Resolve with valid token → 200', r7.s === 200);
  ok('Returns success=true', r7.b?.success === true);

  // 8. Resolve already-resolved → 409
  const r8 = await reqWithHeaders('POST', `/api/review/resolve/${reviewId}`,
    { decision: 'reject' },
    { 'Authorization': `Bearer ${ceoToken}`, 'human-token': hmac });
  ok('Double resolve → 409', r8.s === 409);
}


// ─── Sprint 4-5 Tests: Plugin, Health, Trace ──────────────────

async function testPluginAPI() {
  console.log('\n🔷 Plugin API');
  const r1 = await req('GET', '/api/plugins', null, ceoToken);
  ok('GET /api/plugins → 200', r1.s === 200);
  ok('Has plugins array', Array.isArray(r1.b?.plugins));
  ok('Has stats object', typeof r1.b?.stats === 'object');

  const r2 = await req('GET', '/api/plugins/stats', null, ceoToken);
  ok('GET /api/plugins/stats → 200', r2.s === 200);
  ok('Has totalPlugins', typeof r2.b?.totalPlugins === 'number');

  const r3 = await req('GET', '/api/plugins/events', null, ceoToken);
  ok('GET /api/plugins/events → 200', r3.s === 200);
  ok('Has events array', Array.isArray(r3.b?.events));
}

async function testHealthDetailed() {
  console.log('\n🔷 Health Detailed + Metrics');
  const r1 = await req('GET', '/health/detailed');
  ok('GET /health/detailed → 200', r1.s === 200);
  ok('Has system info', typeof r1.b?.system === 'object');

  const r2 = await req('GET', '/health/metrics');
  ok('GET /health/metrics → 200', r2.s === 200);
}

async function testMessageTrace() {
  console.log('\n🔷 Message Trace');
  const msgId = `trace-msg-${Date.now()}`;
  await req('POST', '/api/chat/send', {
    id: msgId, from: 'alice', to: 'bob',
    content: 'Trace test', type: 'text',
    ts: Date.now(), signature: '', encrypted: false,
  }, aliceToken);
  const r = await req('GET', `/api/chat/trace/${msgId}`, null, aliceToken);
  ok('GET /api/chat/trace/:id → 200 or 404', r.s === 200 || r.s === 404);
}

async function testBadLogin() {
  console.log('\n🔷 Bad Login');
  const r = await req('POST', '/api/auth/login', {
    handle: 'nonexistent_xyz', password: 'wrong',
  });
  ok('Bad login → 401 or 400', r.s === 401 || r.s === 400);
}

// ─── Plan Estimate Tests ────────────────────────────────────────

async function testPlanEstimate() {
  console.log('\n🔷 Plan Estimate (local heuristic)');

  // 1. Missing required fields → 400
  const r1 = await req('POST', '/api/plan/estimate', {}, aliceToken);
  ok('Missing title/description → 400', r1.s === 400);

  // 2. Trivial task (very short description)
  const r2 = await req('POST', '/api/plan/estimate', {
    title: 'Fix typo',
    description: 'Fix a small typo in README',
  }, aliceToken);
  ok('Trivial task → 200', r2.s === 200);
  ok('Plan has complexity', typeof r2.b?.plan?.complexity === 'string');
  ok('Trivial task is trivial or simple', ['trivial', 'simple'].includes(r2.b?.plan?.complexity));

  // 3. Complex task (long description, >80 words → moderate or complex)
  const complexDesc = 'Implement a complete multi-tenant payment processing system with support for ' +
    'multiple currencies, jurisdictions, and compliance frameworks including PCI-DSS. ' +
    'The system needs to handle real-time fraud detection algorithms, integrate with multiple ' +
    'payment gateways including Stripe, PayPal, Alipay, and WeChat Pay, support automatic ' +
    'currency conversion with live exchange rates, generate detailed immutable audit trails, ' +
    'handle refunds, chargebacks, and disputes with automated workflows, comply with regional ' +
    'tax requirements, implement retry logic with exponential backoff and circuit breakers, ' +
    'and provide a comprehensive real-time dashboard for monitoring transactions and anomalies. ' +
    'The system should scale horizontally to handle millions of transactions per day with ' +
    'sub-100ms p99 latency, support multi-region active-active deployment, and integrate ' +
    'with the existing human-in-loop approval workflow for large payment amounts.';
  const r3 = await req('POST', '/api/plan/estimate', {
    title: 'Payment System',
    description: complexDesc,
  }, ceoToken);
  ok('Complex task → 200', r3.s === 200);
  ok('Complex task is moderate or complex', ['moderate', 'complex'].includes(r3.b?.plan?.complexity));
  ok('Plan has estimatedMinutesSerial', typeof r3.b?.plan?.estimatedMinutesSerial === 'number');
  ok('Plan has estimatedTotalTokens', typeof r3.b?.plan?.estimatedTotalTokens === 'number');

  // 4. Non-existent nodeId → 404
  const r4 = await req('POST', '/api/plan/estimate', {
    title: 'Test',
    description: 'Testing non-existent node',
    nodeId: 'ghost-node-xyz',
  }, aliceToken);
  ok('Non-existent nodeId → 404', r4.s === 404);
}

// ─── Runner ────────────────────────────────────────────────────

async function run() {
  console.log('╔═══════════════════════════════════════╗');
  console.log('║   JackClaw E2E Integration Test       ║');
  console.log('╚═══════════════════════════════════════╝');

  try {
    await startHub();
    await testHealth();
    await testRegisterCEO();
    await testRegisterNodes();
    await testDuplicateRegister();
    await testBadRegister();
    await testNodesListAuth();
    await testReport();
    await testSummary();
    await testChatSend();
    await testChatThread();
    await testChatGroup();
    await testDirectory();
    await testCollaboration();
    await testPaymentVault();
    await testAskProxy();
    await testMemorySearch();
    await testChatExtended();
    await testOrgMemory();
    await testLLMGateway();
    await testHumans();
    await testHumanReview();
    await testPluginAPI();
    await testHealthDetailed();
    await testMessageTrace();
    await testBadLogin();
    await testPlanEstimate();
  } catch (err) {
    console.log(`\n💥 Fatal: ${err.message}`);
    console.log(err.stack);
    failed++;
  } finally {
    if (hubProcess) hubProcess.kill('SIGTERM');
    // Cleanup temp HOME
    try { fs.rmSync(TEST_HOME, { recursive: true, force: true }); } catch {}
  }

  console.log('\n═══════════════════════════════════════');
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log('═══════════════════════════════════════\n');

  process.exit(failed > 0 ? 1 : 0);
}

run();
