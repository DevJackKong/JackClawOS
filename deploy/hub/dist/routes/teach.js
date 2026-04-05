"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const router = (0, express_1.Router)();
// 内存存储（生产应用持久化）
const requests = new Map();
const sessions = new Map();
router.post("/request", (req, res) => {
    const { from, to, topic, clearAfterSession = true } = req.body ?? {};
    if (!from || !to || !topic) {
        res.status(400).json({ error: "from, to, topic required" });
        return;
    }
    const id = `tr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const request = { id, from, to, topic, clearAfterSession, requestedAt: Date.now(), expiresAt: Date.now() + 1800000 };
    requests.set(id, request);
    res.json({ requestId: id, request });
});
router.post("/respond", (req, res) => {
    const { requestId, accept } = req.body ?? {};
    const request = requests.get(requestId);
    if (!request) {
        res.status(404).json({ error: "Request not found" });
        return;
    }
    if (accept) {
        const session = { ...request, id: requestId, state: "active", startedAt: Date.now(), knowledge: [] };
        sessions.set(requestId, session);
    }
    requests.delete(requestId);
    res.json({ ok: true, state: accept ? "active" : "rejected" });
});
router.post("/knowledge", (req, res) => {
    const { sessionId, entries } = req.body ?? {};
    const session = sessions.get(sessionId);
    if (!session) {
        res.status(404).json({ error: "Session not found" });
        return;
    }
    session.knowledge = [...(session.knowledge ?? []), ...(entries ?? [])];
    res.json({ ok: true, count: entries?.length ?? 0 });
});
router.get("/sessions", (_req, res) => {
    res.json([...sessions.values()]);
});
router.post("/complete", (req, res) => {
    const { sessionId } = req.body ?? {};
    const session = sessions.get(sessionId);
    if (!session) {
        res.status(404).json({ error: "Session not found" });
        return;
    }
    session.state = "completed";
    session.completedAt = Date.now();
    const knowledge = session.knowledge ?? [];
    if (session.clearAfterSession)
        delete session.knowledge;
    res.json({ ok: true, knowledge });
});
exports.default = router;
//# sourceMappingURL=teach.js.map