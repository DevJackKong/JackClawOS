"use strict";
// Hub Memory Routes
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const crypto_1 = require("crypto");
const crypto_2 = __importDefault(require("crypto"));
const memory_js_1 = require("../store/memory.js");
const router = (0, express_1.Router)();
// GET /memory/org — 获取 org L3 记忆列表
router.get('/org', (_req, res) => {
    res.json({ entries: (0, memory_js_1.getOrgMemories)() });
});
// POST /memory/broadcast — 节点广播记忆到 org
router.post('/broadcast', (req, res) => {
    const entry = req.body;
    if (!entry?.id || !entry?.content) {
        res.status(400).json({ error: 'Invalid memory entry' });
        return;
    }
    (0, memory_js_1.broadcastMemory)(entry);
    res.json({ ok: true });
});
// POST /memory/skills — 节点注册技能
router.post('/skills', (req, res) => {
    const { nodeId, name, skills } = req.body;
    if (!nodeId || !Array.isArray(skills)) {
        res.status(400).json({ error: 'nodeId and skills[] required' });
        return;
    }
    (0, memory_js_1.registerNodeSkills)(nodeId, name ?? nodeId, skills);
    res.json({ ok: true });
});
// GET /memory/experts?skill=xxx — 查找有某技能的节点
router.get('/experts', (req, res) => {
    const skill = req.query['skill'];
    if (!skill) {
        res.status(400).json({ error: 'skill query param required' });
        return;
    }
    res.json({ experts: (0, memory_js_1.findExpertsBySkill)(skill) });
});
// POST /memory/collab/init — 发起协作会话
router.post('/collab/init', (req, res) => {
    const { initiatorId, peerId, intent, topic } = req.body;
    if (!initiatorId || !peerId) {
        res.status(400).json({ error: 'initiatorId and peerId required' });
        return;
    }
    const sessionId = (0, crypto_1.randomUUID)();
    (0, memory_js_1.createCollabSession)({
        id: sessionId,
        intent: (intent ?? 'collaborate'),
        initiatorId,
        peerId,
        topic,
        status: 'active',
        startedAt: Date.now(),
        entries: [],
    });
    res.json({ sessionId });
});
// POST /memory/collab/:id/sync — 同步协作记忆
router.post('/collab/:id/sync', (req, res) => {
    const { id } = req.params;
    const { entries } = req.body;
    if (!Array.isArray(entries)) {
        res.status(400).json({ error: 'entries[] required' });
        return;
    }
    (0, memory_js_1.syncCollabSession)(id, entries);
    res.json({ ok: true });
});
// POST /memory/collab/:id/end — 结束协作，返回对方条目
router.post('/collab/:id/end', (req, res) => {
    const { id } = req.params;
    const { mode } = req.body;
    const session = (0, memory_js_1.endCollabSession)(id, mode ?? 'discard');
    if (!session) {
        res.status(404).json({ error: 'Session not found' });
        return;
    }
    res.json({ entries: session.entries });
});
// ── 跨节点 MemDir 同步 ────────────────────────────────────────────────────
function getSyncSecret() {
    return process.env.JACKCLAW_SYNC_SECRET ?? process.env.JWT_SECRET ?? '';
}
function verifySyncSig(payload, sig) {
    const secret = getSyncSecret();
    if (!secret)
        return false;
    const expected = crypto_2.default.createHmac('sha256', secret).update(payload).digest('hex');
    // 使用 timingSafeEqual 防止时序攻击
    try {
        return crypto_2.default.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'));
    }
    catch {
        return false;
    }
}
// POST /memory/push — 节点推送 MemDir 条目到 Hub
router.post('/push', (req, res) => {
    const sig = req.headers['x-sync-sig'];
    const rawBody = JSON.stringify(req.body);
    if (!sig || !verifySyncSig(rawBody, sig)) {
        res.status(401).json({ error: 'Invalid or missing HMAC signature' });
        return;
    }
    const { nodeId, entries } = req.body;
    if (!nodeId || !Array.isArray(entries)) {
        res.status(400).json({ error: 'nodeId and entries[] required' });
        return;
    }
    (0, memory_js_1.storeNodeMemDirs)(nodeId, entries);
    res.json({ ok: true, stored: entries.length });
});
// GET /memory/pull?nodeId=xxx&ts=yyy — 拉取其他节点共享的 MemDir 条目
router.get('/pull', (req, res) => {
    const sig = req.headers['x-sync-sig'];
    const query = req.url.split('?')[1] ?? '';
    if (!sig || !verifySyncSig(query, sig)) {
        res.status(401).json({ error: 'Invalid or missing HMAC signature' });
        return;
    }
    const nodeId = req.query['nodeId'];
    if (!nodeId) {
        res.status(400).json({ error: 'nodeId query param required' });
        return;
    }
    res.json({ entries: (0, memory_js_1.getSharedMemDirs)(nodeId) });
});
exports.default = router;
//# sourceMappingURL=memory.js.map