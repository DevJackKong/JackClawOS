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

const HUB_PORT = 19099;
const HUB_URL = `http://localhost:${HUB_PORT}`;
const JWT_SECRET = 'e2e-test-secret';

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
    env: { ...process.env, JWT_SECRET, NODE_ENV: 'test' },
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
  ok('CEO registers (201)', r.s === 201);
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
  ok('Alice registers (201)', r1.s === 201);
  aliceToken = r1.b?.token;

  const kpB = genKeyPair();
  const r2 = await req('POST', '/api/register', {
    nodeId: 'bob',
    name: 'Designer Bob',
    role: 'designer',
    publicKey: kpB.publicKey,
    callbackUrl: 'http://localhost:19002',
  });
  ok('Bob registers (201)', r2.s === 201);
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
  const r = await req('POST', '/api/report', {
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
  ok('Message queued for bob', (r1.b?.queued || []).includes('bob'));

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
  const r1 = await req('POST', '/api/collab/invite', {
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
  const r2 = await req('POST', '/api/collab/respond', {
    inviteId,
    fromHandle: '@bob',
    decision: 'accept',
  }, bobToken);
  ok('Respond → 200', r2.s === 200);
  ok('Status = accepted', r2.b?.status === 'accepted');

  // List active sessions
  const r3 = await req('GET', '/api/collab/sessions?status=accepted', null, aliceToken);
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
  } catch (err) {
    console.log(`\n💥 Fatal: ${err.message}`);
    console.log(err.stack);
    failed++;
  } finally {
    if (hubProcess) hubProcess.kill('SIGTERM');
  }

  console.log('\n═══════════════════════════════════════');
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log('═══════════════════════════════════════\n');

  process.exit(failed > 0 ? 1 : 0);
}

run();
