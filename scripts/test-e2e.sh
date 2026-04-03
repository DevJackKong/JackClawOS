#!/bin/bash
# ═══════════════════════════════════════════════════════════════════
# JackClaw End-to-End Integration Test
# 验证 Hub + Node 两节点通信
# ═══════════════════════════════════════════════════════════════════
set -euo pipefail

# ── Configuration ──────────────────────────────────────────────────
HUB_PORT=19001
HUB_URL="http://localhost:${HUB_PORT}"
TEST_DIR="${HOME}/.jackclaw-test"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
HUB_PACKAGE="${PROJECT_DIR}/packages/hub"
HUB_LOG="${TEST_DIR}/hub.log"
HUB_PID_FILE="${TEST_DIR}/hub.pid"
TEST_SUMMARY="E2E测试汇报_$(date +%s)"

# ── Colors ─────────────────────────────────────────────────────────
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

ok()   { echo -e "${GREEN}[✓]${NC} $*"; }
fail() { echo -e "${RED}[✗]${NC} $*"; exit 1; }
step() { echo -e "\n${CYAN}[→]${NC} $*"; }
info() { echo -e "${YELLOW}[i]${NC} $*"; }

# ── Cleanup ─────────────────────────────────────────────────────────
cleanup() {
  step "清理测试环境..."
  if [ -f "${HUB_PID_FILE}" ]; then
    HUB_PID=$(cat "${HUB_PID_FILE}" 2>/dev/null || true)
    if [ -n "${HUB_PID}" ] && kill -0 "${HUB_PID}" 2>/dev/null; then
      kill "${HUB_PID}" 2>/dev/null || true
      sleep 1
      # Force kill if still running
      kill -9 "${HUB_PID}" 2>/dev/null || true
      ok "Hub 进程已终止 (PID: ${HUB_PID})"
    fi
  fi
  # Kill any lingering process on the port
  lsof -ti ":${HUB_PORT}" 2>/dev/null | xargs kill -9 2>/dev/null || true

  if [ -d "${TEST_DIR}" ]; then
    rm -rf "${TEST_DIR}"
    ok "测试目录已删除: ${TEST_DIR}"
  fi
}
trap cleanup EXIT

# ═══════════════════════════════════════════════════════════════════
# STEP 0: 前置检查
# ═══════════════════════════════════════════════════════════════════
step "前置检查..."

# Check node/npm
command -v node >/dev/null 2>&1 || fail "未找到 node，请安装 Node.js"
command -v npm  >/dev/null 2>&1 || fail "未找到 npm"
command -v curl >/dev/null 2>&1 || fail "未找到 curl"

# Check hub package is built
if [ ! -f "${HUB_PACKAGE}/dist/index.js" ]; then
  info "Hub 未构建，正在构建..."
  (cd "${PROJECT_DIR}" && npm run build 2>&1 | tail -5) || fail "Hub 构建失败"
fi
ok "前置检查通过"

# ═══════════════════════════════════════════════════════════════════
# STEP 1: 初始化测试目录 + 准备 Hub 环境
# ═══════════════════════════════════════════════════════════════════
step "初始化测试环境 (${TEST_DIR})..."
mkdir -p "${TEST_DIR}/hub" "${TEST_DIR}/node"
ok "测试目录已创建"

# ═══════════════════════════════════════════════════════════════════
# STEP 2: 启动 Hub（后台，端口 19001）
# ═══════════════════════════════════════════════════════════════════
step "启动 Hub（端口 ${HUB_PORT}）..."

# Check port is free
if lsof -ti ":${HUB_PORT}" >/dev/null 2>&1; then
  fail "端口 ${HUB_PORT} 已被占用，请先释放"
fi

JACKCLAW_HUB_DIR="${TEST_DIR}/hub" \
HUB_PORT="${HUB_PORT}" \
  node "${HUB_PACKAGE}/dist/index.js" > "${HUB_LOG}" 2>&1 &
HUB_PID=$!
echo "${HUB_PID}" > "${HUB_PID_FILE}"
info "Hub PID: ${HUB_PID}"

# Wait for Hub to be ready (up to 15s)
WAITED=0
until curl -sf "${HUB_URL}/health" >/dev/null 2>&1 || \
      curl -sf "${HUB_URL}/api/summary" >/dev/null 2>&1; do
  sleep 1
  WAITED=$((WAITED+1))
  if [ "${WAITED}" -ge 15 ]; then
    info "Hub 日志:"
    cat "${HUB_LOG}" | tail -20
    fail "Hub 未能在 15 秒内启动"
  fi
  if ! kill -0 "${HUB_PID}" 2>/dev/null; then
    info "Hub 进程已退出，日志:"
    cat "${HUB_LOG}"
    fail "Hub 进程意外退出"
  fi
done
ok "Hub 已就绪 (${HUB_URL})"

# ═══════════════════════════════════════════════════════════════════
# STEP 3: Node 注册到 Hub（用 Node.js helper 脚本）
# ═══════════════════════════════════════════════════════════════════
step "Node 注册到 Hub..."

# Write a small Node.js helper that uses @jackclaw/protocol
HELPER="${TEST_DIR}/e2e-helper.mjs"
cat > "${HELPER}" << 'NODEJS'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

// ── Args ─────────────────────────────────────────────────────────
const [,, action, ...args] = process.argv
const HUB_URL = process.env.HUB_URL || 'http://localhost:19001'
const NODE_DIR = process.env.NODE_DIR || '/tmp/jackclaw-test/node'

const IDENTITY_FILE = path.join(NODE_DIR, 'identity.json')

// ── Crypto helpers (mirror @jackclaw/protocol) ────────────────────
function generateKeyPair() {
  return crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  })
}

function deriveNodeId(publicKey) {
  return 'node-' + crypto.createHash('sha256').update(publicKey).digest('hex').slice(0, 16)
}

function encryptPayload(plaintext, recipientPubPem) {
  const aesKey = crypto.randomBytes(32)
  const iv = crypto.randomBytes(16)
  const cipher = crypto.createCipheriv('aes-256-gcm', aesKey, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  const encryptedKey = crypto.publicEncrypt(
    { key: recipientPubPem, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
    aesKey
  )
  return {
    encryptedKey: encryptedKey.toString('base64'),
    iv: iv.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    authTag: authTag.toString('base64'),
  }
}

function createMessage(from, to, type, payloadObj, recipientPub, senderPriv) {
  const plaintext = JSON.stringify(payloadObj)
  const encPayload = encryptPayload(plaintext, recipientPub)
  const payloadStr = JSON.stringify(encPayload)
  const timestamp = Date.now()
  const partial = { from, to, type, payload: payloadStr, timestamp }
  // Sign using the same canonical format as routes/report.ts
  // NOTE: report.ts uses: `${from}:${to ?? 'hub'}:${timestamp}:${payload}`
  const dataToSign = `${from}:${to}:${timestamp}:${payloadStr}`
  const signer = crypto.createSign('SHA256')
  signer.update(dataToSign)
  const signature = signer.sign(senderPriv, 'base64')
  return { ...partial, signature }
}

async function httpPost(url, body, headers = {}) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  let json
  try { json = JSON.parse(text) } catch { json = { raw: text } }
  return { status: res.status, ok: res.ok, body: json }
}

async function httpGet(url, headers = {}) {
  const res = await fetch(url, { headers })
  const text = await res.text()
  let json
  try { json = JSON.parse(text) } catch { json = { raw: text } }
  return { status: res.status, ok: res.ok, body: json }
}

// ── Actions ──────────────────────────────────────────────────────
if (action === 'register') {
  fs.mkdirSync(NODE_DIR, { recursive: true })

  const kp = generateKeyPair()
  const nodeId = deriveNodeId(kp.publicKey)
  const identity = { nodeId, publicKey: kp.publicKey, privateKey: kp.privateKey, createdAt: Date.now() }
  fs.writeFileSync(IDENTITY_FILE, JSON.stringify(identity, null, 2), { mode: 0o600 })

  const payload = { nodeId, name: 'TestNode-E2E', role: 'agent', publicKey: kp.publicKey }
  const res = await httpPost(`${HUB_URL}/api/register`, payload)

  if (!res.ok) {
    console.error('REGISTER_FAIL', JSON.stringify(res.body))
    process.exit(1)
  }

  // Save token + hub public key
  const state = { token: res.body.token, hubPublicKey: res.body.hubPublicKey, nodeId }
  fs.writeFileSync(path.join(NODE_DIR, 'hub-state.json'), JSON.stringify(state, null, 2))
  console.log('REGISTERED', nodeId)

} else if (action === 'report') {
  const identity = JSON.parse(fs.readFileSync(IDENTITY_FILE, 'utf8'))
  const state = JSON.parse(fs.readFileSync(path.join(NODE_DIR, 'hub-state.json'), 'utf8'))
  const summary = args[0] || 'E2E test report'

  const reportPayload = {
    summary,
    period: 'daily',
    visibility: 'summary_only',
    data: { test: true, ts: Date.now() },
  }

  const msg = createMessage(
    identity.nodeId, 'hub', 'report',
    reportPayload, state.hubPublicKey, identity.privateKey
  )

  const res = await httpPost(`${HUB_URL}/api/report`, msg, {
    Authorization: `Bearer ${state.token}`,
  })

  if (!res.ok) {
    console.error('REPORT_FAIL', JSON.stringify(res.body))
    process.exit(1)
  }
  console.log('REPORTED', identity.nodeId)

} else if (action === 'get-nodeId') {
  const identity = JSON.parse(fs.readFileSync(IDENTITY_FILE, 'utf8'))
  console.log(identity.nodeId)

} else {
  console.error('Unknown action:', action)
  process.exit(1)
}
NODEJS

# Run register
REGISTER_OUT=$(HUB_URL="${HUB_URL}" NODE_DIR="${TEST_DIR}/node" node "${HELPER}" register 2>&1)
if echo "${REGISTER_OUT}" | grep -q "^REGISTERED "; then
  NODE_ID=$(echo "${REGISTER_OUT}" | grep "^REGISTERED " | awk '{print $2}')
  ok "Node 已注册: ${NODE_ID}"
else
  fail "Node 注册失败: ${REGISTER_OUT}"
fi

# ═══════════════════════════════════════════════════════════════════
# STEP 4: Node 发送测试汇报
# ═══════════════════════════════════════════════════════════════════
step "Node 发送测试汇报..."

REPORT_OUT=$(HUB_URL="${HUB_URL}" NODE_DIR="${TEST_DIR}/node" node "${HELPER}" report "${TEST_SUMMARY}" 2>&1)
if echo "${REPORT_OUT}" | grep -q "^REPORTED "; then
  ok "汇报已发送"
else
  fail "汇报发送失败: ${REPORT_OUT}"
fi

# ═══════════════════════════════════════════════════════════════════
# STEP 5: 验证 Hub GET /api/summary 包含该汇报
# ═══════════════════════════════════════════════════════════════════
step "验证汇报是否出现在 /api/summary..."

# Get CEO token from hub-state (node is agent, needs ceo token for /api/nodes)
# For /api/summary, no role restriction — use node's JWT
NODE_TOKEN=$(node -e "const s=require('${TEST_DIR}/node/hub-state.json'); console.log(s.token)")

TODAY=$(date +%Y-%m-%d)

# Wait a moment for the hub to persist
sleep 1

SUMMARY_JSON=$(curl -sf \
  -H "Authorization: Bearer ${NODE_TOKEN}" \
  "${HUB_URL}/api/summary?date=${TODAY}" 2>&1) || fail "GET /api/summary 请求失败"

info "Summary 响应: $(echo "${SUMMARY_JSON}" | head -c 500)"

# Check the summary contains our test string
if echo "${SUMMARY_JSON}" | grep -q "${TEST_SUMMARY}"; then
  ok "汇报内容已验证: 在 summary 中找到 '${TEST_SUMMARY}'"
else
  fail "验证失败：/api/summary 响应中未找到 '${TEST_SUMMARY}'"
fi

# Also verify reportingNodes > 0
REPORTING=$(echo "${SUMMARY_JSON}" | node -e "let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{ try{const j=JSON.parse(d); console.log(j.reportingNodes??0)}catch{console.log(0)} })")
if [ "${REPORTING}" -gt 0 ]; then
  ok "reportingNodes = ${REPORTING} (预期 > 0)"
else
  fail "reportingNodes = 0，汇报未被记录"
fi

# ═══════════════════════════════════════════════════════════════════
# 全部通过
# ═══════════════════════════════════════════════════════════════════
echo ""
echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  ✓  JackClaw E2E 测试全部通过！                            ${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
echo ""
