"use strict";
/**
 * AiConcierge — AI 代办
 *
 * 功能：
 *   - 日程协商：解析自然语言时间，与对方 Agent 协商可用时段
 *   - 任务提醒：创建/查看/取消到期提醒，定时检查触发
 *
 * 存储：~/.jackclaw/node/concierge.json
 * 通信：通过 Hub /api/social/send 发送协商消息
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AiConcierge = void 0;
exports.createConcierge = createConcierge;
exports.getConcierge = getConcierge;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
const crypto_1 = require("crypto");
const protocol_1 = require("@jackclaw/protocol");
// ─── 存储路径 ─────────────────────────────────────────────────────────────────
const STORE_DIR = path_1.default.join(os_1.default.homedir(), '.jackclaw', 'node');
const STORE_FILE = path_1.default.join(STORE_DIR, 'concierge.json');
// ─── AiConcierge ─────────────────────────────────────────────────────────────
class AiConcierge {
    nodeId;
    hubUrl;
    agentHandle;
    token;
    constructor(opts) {
        this.nodeId = opts.nodeId;
        this.hubUrl = opts.hubUrl;
        this.agentHandle = opts.agentHandle ?? opts.nodeId;
        this.token = opts.token;
    }
    // ─── 日程协商 ─────────────────────────────────────────────────────────────
    /**
     * 发起日程协商：
     *   1. 解析自然语言时间
     *   2. 生成候选时间列表（目标时间 + 备选）
     *   3. 通过 Hub 发送协商消息给对方 Agent
     *   4. 本地记录 pending 请求
     */
    async scheduleNegotiation(withAgent, request) {
        const toAgent = withAgent.startsWith('@') ? withAgent : `@${withAgent}`;
        const ts = (0, protocol_1.parseNaturalTime)(request);
        if (!ts)
            throw new Error(`无法解析时间：${request}`);
        const duration = (0, protocol_1.parseDuration)(request);
        const topic = request
            .replace(/[零一二两三四五六七八九十\d]+小时/g, '')
            .replace(/[零一二两三四五六七八九十\d]+分[钟]?/g, '')
            .replace(/半小时/g, '')
            .replace(/@[\w\-_]+/g, '')
            .trim() || '会议';
        // 候选时间：目标时间 + 同日+1h + 次日同时间
        const proposedTimes = [
            ts,
            ts + 60 * 60 * 1000,
            ts + 24 * 60 * 60 * 1000,
        ];
        const requestId = (0, crypto_1.randomUUID)();
        const schedReq = {
            requestId,
            fromAgent: this.agentHandle,
            toAgent,
            proposedTimes,
            duration,
            topic,
            ts: Date.now(),
        };
        const state = this._load();
        state.pendingRequests.push(schedReq);
        this._save(state);
        const content = JSON.stringify({ type: 'schedule_request', data: schedReq });
        await this._sendSocial(toAgent, content, 'schedule_request');
        const message = `[concierge] 已向 ${toAgent} 发送日程协商请求 (requestId=${requestId.slice(0, 8)})\n候选时间：${proposedTimes.map(t => new Date(t).toLocaleString('zh-CN')).join(' / ')}`;
        console.log(message);
        return { requestId, proposedTimes, message };
    }
    /**
     * 处理对方 Agent 发来的协商消息（来自 Hub WebSocket social 事件）。
     * - 若为 schedule_request → 自动选第一个时间回复，并创建提醒
     * - 若为 schedule_response → 记录结果，创建提醒
     */
    handleNegotiationResponse(msg) {
        let parsed;
        try {
            parsed = JSON.parse(msg.content);
        }
        catch {
            return;
        }
        if (parsed.type === 'schedule_request') {
            const req = parsed.data;
            // 仅处理发给本节点的请求
            if (req.toAgent !== this.agentHandle && req.toAgent !== `@${this.nodeId}`)
                return;
            const accepted = req.proposedTimes[0];
            const response = {
                requestId: req.requestId,
                fromAgent: this.agentHandle,
                toAgent: req.fromAgent,
                acceptedTime: accepted,
                ts: Date.now(),
            };
            const content = JSON.stringify({ type: 'schedule_response', data: response });
            this._sendSocial(req.fromAgent, content, 'schedule_response').catch((err) => {
                console.warn('[concierge] failed to send schedule_response:', err.message);
            });
            const topic = req.topic || '会议';
            this.createReminder(accepted, `[日程] 与 ${req.fromAgent} 的 ${topic}（${req.duration} 分钟）`);
            console.log(`[concierge] 已接受 ${req.fromAgent} 的日程请求，时间：${new Date(accepted).toLocaleString('zh-CN')}`);
        }
        if (parsed.type === 'schedule_response') {
            const resp = parsed.data;
            const state = this._load();
            const idx = state.pendingRequests.findIndex(r => r.requestId === resp.requestId);
            if (idx === -1)
                return;
            const req = state.pendingRequests[idx];
            state.pendingRequests.splice(idx, 1);
            state.completedRequests.push({ ...req, response: resp });
            this._save(state);
            if (resp.declined) {
                console.log(`[concierge] ${resp.fromAgent} 拒绝了日程请求 ${resp.requestId.slice(0, 8)}：${resp.reason ?? ''}`);
                return;
            }
            const accepted = resp.acceptedTime ?? resp.counterProposal?.[0];
            if (accepted) {
                this.createReminder(accepted, `[日程] 与 ${resp.fromAgent} 的 ${req.topic}（${req.duration} 分钟）`);
                console.log(`[concierge] 日程已确认：${new Date(accepted).toLocaleString('zh-CN')} 与 ${resp.fromAgent}`);
            }
        }
    }
    // ─── 提醒管理 ─────────────────────────────────────────────────────────────
    createReminder(time, message) {
        const reminder = {
            id: (0, crypto_1.randomUUID)(),
            nodeId: this.nodeId,
            time,
            message,
            status: 'pending',
            createdAt: Date.now(),
        };
        const state = this._load();
        state.reminders.push(reminder);
        this._save(state);
        console.log(`[concierge] 提醒已创建：${new Date(time).toLocaleString('zh-CN')} — ${message}`);
        return reminder;
    }
    listReminders() {
        return this._load().reminders.filter(r => r.status !== 'cancelled');
    }
    cancelReminder(id) {
        const state = this._load();
        const r = state.reminders.find(x => x.id === id || x.id.startsWith(id));
        if (!r)
            return false;
        r.status = 'cancelled';
        this._save(state);
        return true;
    }
    /**
     * 检查到期提醒（每分钟调用一次），触发并标记已触发。
     */
    checkReminders() {
        const now = Date.now();
        const state = this._load();
        let changed = false;
        for (const r of state.reminders) {
            if (r.status === 'pending' && r.time <= now) {
                r.status = 'triggered';
                changed = true;
                console.log(`\n[concierge] ⏰ 提醒：${r.message}\n`);
            }
        }
        if (changed)
            this._save(state);
    }
    // ─── 私有辅助 ─────────────────────────────────────────────────────────────
    async _sendSocial(toAgent, content, type) {
        const body = JSON.stringify({
            fromHuman: 'concierge',
            fromAgent: this.agentHandle,
            toAgent,
            content,
            type,
        });
        const res = await fetch(`${this.hubUrl}/api/social/send`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}) },
            body,
        });
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(`Hub send failed: ${res.status} ${text}`);
        }
    }
    _load() {
        if (!fs_1.default.existsSync(STORE_FILE)) {
            return { reminders: [], pendingRequests: [], completedRequests: [] };
        }
        try {
            return JSON.parse(fs_1.default.readFileSync(STORE_FILE, 'utf8'));
        }
        catch {
            return { reminders: [], pendingRequests: [], completedRequests: [] };
        }
    }
    _save(state) {
        fs_1.default.mkdirSync(STORE_DIR, { recursive: true });
        fs_1.default.writeFileSync(STORE_FILE, JSON.stringify(state, null, 2));
    }
}
exports.AiConcierge = AiConcierge;
// ─── 单例 ──────────────────────────────────────────────────────────────────
let _instance = null;
function createConcierge(opts) {
    _instance = new AiConcierge(opts);
    return _instance;
}
function getConcierge() {
    return _instance;
}
//# sourceMappingURL=ai-concierge.js.map