"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TeachingProtocol = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
const crypto_1 = __importDefault(require("crypto"));
class TeachingProtocol {
    nodeId;
    sessions = new Map();
    storePath;
    constructor(nodeId) {
        this.nodeId = nodeId;
        this.storePath = path_1.default.join(os_1.default.homedir(), ".jackclaw", "teaching", nodeId);
        fs_1.default.mkdirSync(this.storePath, { recursive: true });
        this.load();
    }
    createRequest(opts) {
        const req = {
            id: crypto_1.default.randomUUID(),
            from: this.nodeId,
            to: opts.to,
            topic: opts.topic,
            clearAfterSession: opts.clearAfterSession ?? true,
            createdAt: Date.now(),
            expiresAt: Date.now() + 30 * 60 * 1000, // 30分钟
        };
        return req;
    }
    acceptRequest(request) {
        const session = {
            id: crypto_1.default.randomUUID(),
            request,
            state: "active",
            memoryScope: `teaching-${crypto_1.default.randomUUID().slice(0, 8)}`,
            knowledgeItems: [],
            startedAt: Date.now(),
        };
        this.sessions.set(session.id, session);
        // 创建独立 memory 目录
        fs_1.default.mkdirSync(path_1.default.join(this.storePath, session.memoryScope), { recursive: true });
        this.save();
        return session;
    }
    rejectRequest(requestId) {
        // 通知发起方被拒绝（通过 ClawChat）
        console.log(`[teaching] Request ${requestId} rejected`);
    }
    addKnowledge(sessionId, item) {
        const session = this.sessions.get(sessionId);
        if (!session || session.state !== "active")
            throw new Error("Session not active");
        const knowledge = { ...item, id: crypto_1.default.randomUUID(), addedAt: Date.now() };
        session.knowledgeItems.push(knowledge);
        // 写入独立 memory 目录
        const memDir = path_1.default.join(this.storePath, session.memoryScope);
        fs_1.default.appendFileSync(path_1.default.join(memDir, "knowledge.jsonl"), JSON.stringify(knowledge) + "\n");
        this.save();
    }
    complete(sessionId) {
        const session = this.sessions.get(sessionId);
        if (!session)
            throw new Error("Session not found");
        session.state = "completed";
        session.completedAt = Date.now();
        if (session.request.clearAfterSession) {
            // 清除教学记忆（隐私保护）
            const memDir = path_1.default.join(this.storePath, session.memoryScope);
            fs_1.default.rmSync(memDir, { recursive: true, force: true });
            console.log(`[teaching] Memory cleared for session ${sessionId}`);
        }
        this.save();
    }
    getActiveSessions() {
        return [...this.sessions.values()].filter(s => s.state === "active");
    }
    load() {
        try {
            const data = JSON.parse(fs_1.default.readFileSync(path_1.default.join(this.storePath, "sessions.json"), "utf-8"));
            for (const s of data)
                this.sessions.set(s.id, s);
        }
        catch { }
    }
    save() {
        fs_1.default.writeFileSync(path_1.default.join(this.storePath, "sessions.json"), JSON.stringify([...this.sessions.values()], null, 2));
    }
}
exports.TeachingProtocol = TeachingProtocol;
//# sourceMappingURL=teaching-protocol.js.map