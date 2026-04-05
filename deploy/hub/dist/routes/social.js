"use strict";
/**
 * Hub Social Communication Routes
 *
 * POST /api/social/send           — 发社交消息
 * POST /api/social/contact        — 发联系请求
 * POST /api/social/contact/respond — 回复联系请求
 * GET  /api/social/contacts       — 查联系人列表  ?agentHandle=@alice
 * GET  /api/social/messages       — 收件箱       ?agentHandle=@alice&limit=20&offset=0
 * POST /api/social/profile        — 设置名片
 * GET  /api/social/profile/:handle — 查看名片
 * POST /api/social/reply          — 回复消息（自动找原消息 fromAgent）
 * GET  /api/social/threads        — 查看会话列表  ?agentHandle=@alice
 * GET  /api/social/drain/:nodeId  — Node 上线后拉取离线 social 消息
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.deliverFederatedMessage = deliverFederatedMessage;
const express_1 = require("express");
const crypto_1 = __importDefault(require("crypto"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const chat_1 = require("./chat");
const push_service_1 = require("../push-service");
const message_store_1 = require("../store/message-store");
const quota_1 = require("../quota");
const presence_1 = require("../presence");
const offline_queue_1 = require("../store/offline-queue");
const directory_1 = require("../store/directory");
// Lazy import to avoid circular dependencies at module load time
function getFedMgr() {
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { getFederationManager } = require('../federation');
        return getFederationManager();
    }
    catch {
        return null;
    }
}
const router = (0, express_1.Router)();
// ─── Storage (contacts, requests, profiles remain file-backed) ────────────────
const HUB_DIR = path_1.default.join(process.env.HOME || '~', '.jackclaw', 'hub');
const SOCIAL_CONTACTS_FILE = path_1.default.join(HUB_DIR, 'social-contacts.json');
const SOCIAL_REQUESTS_FILE = path_1.default.join(HUB_DIR, 'social-requests.json');
const SOCIAL_PROFILES_FILE = path_1.default.join(HUB_DIR, 'social-profiles.json');
function loadJSON(file, def) {
    try {
        if (fs_1.default.existsSync(file))
            return JSON.parse(fs_1.default.readFileSync(file, 'utf-8'));
    }
    catch { /* ignore */ }
    return def;
}
function saveJSON(file, data) {
    fs_1.default.mkdirSync(path_1.default.dirname(file), { recursive: true });
    fs_1.default.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
}
let contacts = loadJSON(SOCIAL_CONTACTS_FILE, {});
let requests = loadJSON(SOCIAL_REQUESTS_FILE, {});
let profiles = loadJSON(SOCIAL_PROFILES_FILE, {});
// ─── SocialMessage ↔ StoredMessage adapters ───────────────────────────────────
function socialToStored(msg) {
    return {
        id: msg.id,
        threadId: msg.thread,
        fromAgent: msg.fromAgent,
        toAgent: msg.toAgent,
        fromHuman: msg.fromHuman,
        content: msg.content,
        type: msg.type,
        replyTo: msg.replyTo,
        status: 'sent',
        ts: msg.ts,
        encrypted: msg.encrypted,
    };
}
function storedToSocial(s) {
    return {
        id: s.id,
        fromHuman: s.fromHuman ?? '',
        fromAgent: s.fromAgent,
        toAgent: s.toAgent,
        content: s.content,
        type: s.type,
        replyTo: s.replyTo,
        thread: s.threadId,
        ts: s.ts,
        encrypted: s.encrypted,
        signature: '',
    };
}
// ─── Thread helper ────────────────────────────────────────────────────────────
function getOrCreateThread(a, b) {
    const key = [a, b].sort().join('↔');
    const recent = message_store_1.messageStore.getMessagesByParticipant(a, 10, 0);
    const existing = recent.find(m => m.threadId &&
        ((m.fromAgent === a && m.toAgent === b) || (m.fromAgent === b && m.toAgent === a)));
    if (existing?.threadId)
        return existing.threadId;
    return `thread-${key}-${Date.now()}`;
}
// ─── Deliver helper ───────────────────────────────────────────────────────────
/**
 * Attempt to deliver a social message to the target agent.
 *
 * Flow:
 *   1. resolveHandle(toAgent) — get nodeId + online/wsConnected flags
 *   2. If wsConnected → push via WebSocket
 *   3. If offline → enqueue in unified offline-queue (keyed by @handle)
 *      + trigger Web Push notification
 */
function deliverSocialMsg(msg) {
    const { nodeId, wsConnected } = presence_1.presenceManager.resolveHandle(msg.toAgent);
    if (!nodeId) {
        // Agent not registered — queue by handle; will be drained when they register+connect
        offline_queue_1.offlineQueue.enqueue(msg.toAgent, { event: 'social', data: msg });
        return;
    }
    if (wsConnected) {
        const sent = (0, chat_1.pushToNodeWs)(nodeId, 'social', msg);
        if (sent)
            return;
    }
    // Node offline (or WS push failed) — queue by handle for reliable delivery
    offline_queue_1.offlineQueue.enqueue(msg.toAgent, { event: 'social', data: msg });
    // Best-effort Web Push notification
    setImmediate(() => {
        void push_service_1.pushService.push(nodeId, {
            title: `Social message from ${msg.fromAgent}`,
            body: msg.content.slice(0, 120),
            data: { type: 'social', messageId: msg.id, from: msg.fromAgent },
        });
    });
}
/**
 * Deliver a SocialMessage that arrived from a remote hub via federation.
 * Exported so routes/federation.ts can call it without circular imports at load time.
 */
function deliverFederatedMessage(msg) {
    try {
        message_store_1.messageStore.saveMessage(socialToStored(msg));
    }
    catch { /* best-effort */ }
    deliverSocialMsg(msg);
    console.log(`[social/fed] Federated delivery: ${msg.fromAgent} → ${msg.toAgent}`);
}
// ─── POST /send ───────────────────────────────────────────────────────────────
router.post('/send', async (req, res) => {
    const body = req.body;
    if (!body.fromHuman || !body.fromAgent || !body.toAgent || !body.content) {
        return res.status(400).json({ error: 'missing_fields', required: ['fromHuman', 'fromAgent', 'toAgent', 'content'] });
    }
    const targetProfile = profiles[body.toAgent];
    if (targetProfile?.contactPolicy === 'closed') {
        return res.status(403).json({ error: 'contact_policy_closed', message: `${body.toAgent} 不接受外来消息` });
    }
    if (targetProfile?.contactPolicy === 'request') {
        const myContacts = contacts[body.fromAgent] ?? [];
        if (!myContacts.includes(body.toAgent)) {
            return res.status(403).json({ error: 'contact_required', message: `需先发送联系请求并被接受` });
        }
    }
    const msgUserId = body.fromAgent;
    const msgQuota = quota_1.quotaManager.checkQuota(msgUserId, 'maxMessagePerDay');
    if (!msgQuota.allowed) {
        return res.status(429).json({
            error: 'quota_exceeded',
            message: `每日消息上限已达到 (${msgQuota.limit} 条/天)，剩余: 0`,
            remaining: 0,
        });
    }
    const thread = body.thread ?? getOrCreateThread(body.fromAgent, body.toAgent);
    const msg = {
        id: body.id ?? crypto_1.default.randomUUID(),
        fromHuman: body.fromHuman,
        fromAgent: body.fromAgent,
        toAgent: body.toAgent,
        toHuman: body.toHuman,
        content: body.content,
        type: body.type ?? 'text',
        replyTo: body.replyTo,
        thread,
        ts: Date.now(),
        encrypted: body.encrypted ?? false,
        signature: body.signature ?? '',
    };
    // Check if target is local
    const { nodeId: localNodeId } = presence_1.presenceManager.resolveHandle(msg.toAgent);
    if (!localNodeId) {
        const fedMgr = getFedMgr();
        if (fedMgr) {
            try {
                const result = await fedMgr.routeToRemoteHub(msg.toAgent, msg);
                try {
                    message_store_1.messageStore.saveMessage(socialToStored(msg));
                }
                catch { /* best-effort */ }
                quota_1.quotaManager.incrementUsage(msgUserId, 'maxMessagePerDay');
                console.log(`[social] ${msg.fromAgent} → ${msg.toAgent} (federated): ${msg.content.slice(0, 50)}`);
                return res.status(201).json({ status: 'ok', messageId: msg.id, thread, routed: 'federation', federationResult: result });
            }
            catch (err) {
                const errMsg = err instanceof Error ? err.message : String(err);
                if (errMsg.startsWith('agent_not_found')) {
                    return res.status(404).json({ error: 'agent_not_found', message: `${msg.toAgent} is not registered on this hub or any federated hub` });
                }
                console.error('[social] Federation routing error:', errMsg);
                return res.status(502).json({ error: 'federation_error', message: errMsg });
            }
        }
    }
    try {
        message_store_1.messageStore.saveMessage(socialToStored(msg));
    }
    catch { /* best-effort */ }
    deliverSocialMsg(msg);
    quota_1.quotaManager.incrementUsage(msgUserId, 'maxMessagePerDay');
    console.log(`[social] ${msg.fromAgent} → ${msg.toAgent}: ${msg.content.slice(0, 50)}`);
    return res.status(201).json({ status: 'ok', messageId: msg.id, thread });
});
// ─── POST /contact ────────────────────────────────────────────────────────────
router.post('/contact', (req, res) => {
    const body = req.body;
    if (!body.fromAgent || !body.toAgent || !body.message) {
        return res.status(400).json({ error: 'missing_fields', required: ['fromAgent', 'toAgent', 'message'] });
    }
    const myContacts = contacts[body.fromAgent] ?? [];
    if (myContacts.includes(body.toAgent)) {
        return res.status(409).json({ error: 'already_contacts', message: '你们已经是联系人' });
    }
    const req2 = {
        id: crypto_1.default.randomUUID(),
        fromAgent: body.fromAgent,
        toAgent: body.toAgent,
        message: body.message,
        purpose: body.purpose ?? '建立联系',
        status: 'pending',
        ts: Date.now(),
    };
    requests[req2.id] = req2;
    saveJSON(SOCIAL_REQUESTS_FILE, requests);
    // Notify target via WS or queue
    const { nodeId: toNodeId, wsConnected } = presence_1.presenceManager.resolveHandle(body.toAgent);
    if (toNodeId && wsConnected) {
        (0, chat_1.pushToNodeWs)(toNodeId, 'social_contact_request', req2);
    }
    else {
        offline_queue_1.offlineQueue.enqueue(body.toAgent, { event: 'social_contact_request', data: req2 });
    }
    console.log(`[social] Contact request: ${req2.fromAgent} → ${req2.toAgent}`);
    return res.status(201).json({ status: 'ok', requestId: req2.id, request: req2 });
});
// ─── POST /contact/respond ────────────────────────────────────────────────────
router.post('/contact/respond', (req, res) => {
    const body = req.body;
    if (!body.requestId || !body.fromAgent || !body.decision) {
        return res.status(400).json({ error: 'missing_fields', required: ['requestId', 'fromAgent', 'decision'] });
    }
    const cr = requests[body.requestId];
    if (!cr)
        return res.status(404).json({ error: 'request_not_found' });
    if (cr.toAgent !== body.fromAgent)
        return res.status(403).json({ error: 'not_your_request' });
    cr.status = body.decision === 'accept' ? 'accepted' : 'declined';
    requests[body.requestId] = cr;
    saveJSON(SOCIAL_REQUESTS_FILE, requests);
    if (body.decision === 'accept') {
        const aContacts = contacts[cr.fromAgent] ?? [];
        const bContacts = contacts[cr.toAgent] ?? [];
        if (!aContacts.includes(cr.toAgent))
            aContacts.push(cr.toAgent);
        if (!bContacts.includes(cr.fromAgent))
            bContacts.push(cr.fromAgent);
        contacts[cr.fromAgent] = aContacts;
        contacts[cr.toAgent] = bContacts;
        saveJSON(SOCIAL_CONTACTS_FILE, contacts);
    }
    // Notify requester via WS or queue
    const responsePayload = { requestId: body.requestId, decision: body.decision, message: body.message };
    const { nodeId: fromNodeId, wsConnected } = presence_1.presenceManager.resolveHandle(cr.fromAgent);
    if (fromNodeId && wsConnected) {
        (0, chat_1.pushToNodeWs)(fromNodeId, 'social_contact_response', responsePayload);
    }
    else if (cr.fromAgent) {
        offline_queue_1.offlineQueue.enqueue(cr.fromAgent, { event: 'social_contact_response', data: responsePayload });
    }
    console.log(`[social] Contact response: ${cr.toAgent} ${body.decision} request from ${cr.fromAgent}`);
    return res.json({ status: 'ok', requestId: body.requestId, decision: body.decision });
});
// ─── GET /contacts ────────────────────────────────────────────────────────────
router.get('/contacts', (req, res) => {
    const { agentHandle } = req.query;
    if (!agentHandle)
        return res.status(400).json({ error: 'agentHandle required' });
    const list = contacts[agentHandle] ?? [];
    const enriched = list.map(h => ({ handle: h, profile: profiles[h] ?? null }));
    return res.json({ contacts: enriched, count: list.length });
});
// ─── GET /messages ────────────────────────────────────────────────────────────
router.get('/messages', (req, res) => {
    const { agentHandle, limit: limitStr, offset: offsetStr } = req.query;
    if (!agentHandle)
        return res.status(400).json({ error: 'agentHandle required' });
    const limit = parseInt(limitStr ?? '20', 10);
    const offset = parseInt(offsetStr ?? '0', 10);
    const stored = message_store_1.messageStore.getInbox(agentHandle, limit, offset);
    const inbox = stored.map(storedToSocial);
    return res.json({ messages: inbox, count: inbox.length });
});
// ─── POST /profile ────────────────────────────────────────────────────────────
router.post('/profile', (req, res) => {
    const body = req.body;
    if (!body.agentHandle) {
        return res.status(400).json({ error: 'agentHandle required' });
    }
    const existing = profiles[body.agentHandle] ?? {};
    const profile = {
        agentHandle: body.agentHandle,
        ownerName: body.ownerName ?? existing.ownerName ?? '',
        ownerTitle: body.ownerTitle ?? existing.ownerTitle ?? '',
        bio: body.bio ?? existing.bio ?? '',
        skills: body.skills ?? existing.skills ?? [],
        contactPolicy: body.contactPolicy ?? existing.contactPolicy ?? 'request',
        hubUrl: body.hubUrl ?? existing.hubUrl ?? `http://localhost:${process.env.HUB_PORT ?? 3100}`,
        updatedAt: Date.now(),
    };
    profiles[body.agentHandle] = profile;
    saveJSON(SOCIAL_PROFILES_FILE, profiles);
    console.log(`[social] Profile updated: ${body.agentHandle}`);
    return res.json({ status: 'ok', profile });
});
// ─── GET /profile/:handle ─────────────────────────────────────────────────────
router.get('/profile/:handle', (req, res) => {
    const handle = decodeURIComponent(req.params.handle);
    const profile = profiles[handle] ?? null;
    if (!profile)
        return res.status(404).json({ error: 'profile_not_found', handle });
    return res.json({ profile });
});
// ─── POST /reply ──────────────────────────────────────────────────────────────
router.post('/reply', (req, res) => {
    const { replyToId, fromHuman, fromAgent, content, type } = req.body;
    if (!replyToId || !fromHuman || !fromAgent || !content) {
        return res.status(400).json({ error: 'missing_fields', required: ['replyToId', 'fromHuman', 'fromAgent', 'content'] });
    }
    const original = message_store_1.messageStore.getMessage(replyToId);
    if (!original)
        return res.status(404).json({ error: 'original_message_not_found' });
    const toAgent = original.fromAgent === fromAgent ? original.toAgent : original.fromAgent;
    const msg = {
        id: crypto_1.default.randomUUID(),
        fromHuman,
        fromAgent,
        toAgent,
        content,
        type: type ?? 'text',
        replyTo: replyToId,
        thread: original.threadId,
        ts: Date.now(),
        encrypted: false,
        signature: '',
    };
    try {
        message_store_1.messageStore.saveMessage(socialToStored(msg));
    }
    catch { /* best-effort */ }
    deliverSocialMsg(msg);
    console.log(`[social] Reply: ${fromAgent} → ${toAgent} (replyTo: ${replyToId})`);
    return res.status(201).json({ status: 'ok', messageId: msg.id });
});
// ─── GET /threads ─────────────────────────────────────────────────────────────
router.get('/threads', (req, res) => {
    const { agentHandle } = req.query;
    if (!agentHandle)
        return res.status(400).json({ error: 'agentHandle required' });
    const stored = message_store_1.messageStore.getMessagesByParticipant(agentHandle, 1000, 0);
    const myMsgs = stored.map(storedToSocial);
    const threadMap = new Map();
    for (const m of myMsgs) {
        const tid = m.thread ?? `direct-${[m.fromAgent, m.toAgent].sort().join('↔')}`;
        const existing = threadMap.get(tid);
        const other = m.fromAgent === agentHandle ? m.toAgent : m.fromAgent;
        if (!existing) {
            threadMap.set(tid, {
                id: tid,
                participants: [agentHandle, other],
                lastMessage: m.content.slice(0, 80),
                lastMessageAt: m.ts,
                messageCount: 1,
            });
        }
        else {
            existing.messageCount++;
            if (m.ts > existing.lastMessageAt) {
                existing.lastMessageAt = m.ts;
                existing.lastMessage = m.content.slice(0, 80);
            }
        }
    }
    const threads = [...threadMap.values()].sort((a, b) => b.lastMessageAt - a.lastMessageAt);
    return res.json({ threads, count: threads.length });
});
// ─── GET /thread/:id — 获取指定会话的完整消息历史 ─────────────────────────────
router.get('/thread/:id', (req, res) => {
    const threadId = decodeURIComponent(req.params.id);
    const limit = Math.min(parseInt(req.query.limit ?? '200', 10), 500);
    const stored = message_store_1.messageStore.getThread(threadId, limit, 0);
    const messages = stored.map(storedToSocial);
    return res.json({ messages, count: messages.length });
});
// ─── GET /drain/:nodeId — Node 上线后拉取离线 social 消息 ─────────────────────
router.get('/drain/:nodeId', (req, res) => {
    const { nodeId } = req.params;
    // Drain the unified offline queue for all @handles of this node
    const handles = directory_1.directoryStore.getHandlesForNode(nodeId);
    const messages = [];
    for (const handle of handles) {
        for (const envelope of offline_queue_1.offlineQueue.dequeue(handle)) {
            messages.push(envelope.data);
        }
    }
    return res.json({ messages, count: messages.length });
});
exports.default = router;
//# sourceMappingURL=social.js.map