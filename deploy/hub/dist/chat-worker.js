"use strict";
/**
 * ChatWorker — isolated chat processing with priority queue
 *
 * Owns the WebSocket connection pool and message delivery pipeline.
 * All IO is async/non-blocking. Never awaits LLM calls.
 *
 * Message priority (lower value = higher priority):
 *   0 → human   (direct human↔agent messages)
 *   1 → task    (task dispatch messages)
 *   2 → system  (everything else)
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.chatWorker = exports.ChatWorker = void 0;
exports.getMessageTrace = getMessageTrace;
exports.getMessageStatus = getMessageStatus;
const fs_1 = __importDefault(require("fs"));
const os_1 = __importDefault(require("os"));
const path_1 = __importDefault(require("path"));
const ws_1 = require("ws");
const chat_1 = require("./store/chat");
const human_registry_1 = require("./store/human-registry");
const push_service_1 = require("./push-service");
const presence_1 = require("./presence");
const directory_1 = require("./store/directory");
const offline_queue_1 = require("./store/offline-queue");
const protocol_1 = require("@jackclaw/protocol");
// ─── Deduplication ────────────────────────────────────────────────────────────
const DEDUP_WINDOW_MS = 60_000; // 60s sliding window
const seenMessages = new Map(); // messageId → timestamp
function isDuplicate(messageId) {
    const now = Date.now();
    // Prune expired entries every 100 checks
    if (seenMessages.size > 0 && seenMessages.size % 100 === 0) {
        for (const [id, ts] of seenMessages) {
            if (now - ts > DEDUP_WINDOW_MS)
                seenMessages.delete(id);
        }
    }
    if (seenMessages.has(messageId))
        return true;
    seenMessages.set(messageId, now);
    return false;
}
// ─── ACK tracking ─────────────────────────────────────────────────────────────
const ACK_TIMEOUT_MS = 3000; // 3s wait for delivery_ack
const RETRY_DELAY_MS = 500; // 500ms before retry
const MAX_RETRIES = 1; // retry once
// messageId → pending ack info
const pendingAcks = new Map();
// ─── Message trace store (in-memory, keyed by messageId) ──────────────────────
const messageTraces = new Map();
function getMessageTrace(messageId) {
    return messageTraces.get(messageId) ?? [];
}
function getMessageStatus(messageId) {
    const trace = messageTraces.get(messageId);
    if (!trace || trace.length === 0)
        return null;
    return trace[trace.length - 1].to;
}
function recordTransition(messageId, from, to, nodeId) {
    const transitions = messageTraces.get(messageId) ?? [];
    transitions.push({ from, to, nodeId, ts: Date.now() });
    messageTraces.set(messageId, transitions);
}
// ─── Priority ─────────────────────────────────────────────────────────────────
const MSG_PRIORITY = { human: 0, task: 1 };
function getPriority(msg) {
    return MSG_PRIORITY[msg.type] ?? 2;
}
// ─── Config ───────────────────────────────────────────────────────────────────
const WS_MAX_CONNECTIONS = 1000;
const HEARTBEAT_INTERVAL = 30_000;
const MAX_QUEUE_MEM = 2000; // items before spilling to disk
// ─── ChatWorker ───────────────────────────────────────────────────────────────
class ChatWorker {
    store;
    wsClients = new Map();
    wsAlive = new Map();
    heartbeatTimer = null;
    // Priority queue — sorted ascending by (priority, seq)
    queue = [];
    seq = 0;
    draining = false;
    // ─── Delivery ACK tracking ──────────────────────────────────────────────────
    _ackTimers = new Map();
    ACK_TIMEOUT = 3000; // 3s to receive delivery_ack
    RETRY_DELAY = 500; // 500ms before retry
    // ─── Message deduplication ──────────────────────────────────────────────────
    _recentIds = new Map();
    DEDUPE_TTL = 60_000; // 60s sliding window
    _dedupeTimer = null;
    // Disk overflow
    overflowFile;
    overflowActive = false;
    // Stats
    totalReceived = 0;
    totalDelivered = 0;
    totalQueued = 0;
    latencySamples = [];
    constructor(store) {
        this.store = store ?? new chat_1.ChatStore();
        const overflowDir = path_1.default.join(os_1.default.homedir(), '.jackclaw', 'hub', 'overflow');
        fs_1.default.mkdirSync(overflowDir, { recursive: true });
        this.overflowFile = path_1.default.join(overflowDir, 'chat-queue.ndjson');
        this._startHeartbeat();
    }
    _startDedupeCleanup() {
        // no-op: dedup cleanup handled by module-level seenMessages map
    }
    // ─── Public API ─────────────────────────────────────────────────────────────
    /**
     * Accept an incoming message, expand group targets, and enqueue for delivery.
     * Saves to store immediately; delivery happens asynchronously.
     */
    handleIncoming(msg) {
        // ─── Deduplication ─────────────────────────────────────────────────────────
        if (isDuplicate(msg.id)) {
            this.pushEvent(msg.from, 'receipt', {
                messageId: msg.id, status: 'duplicate', nodeId: 'hub', ts: Date.now()
            });
            return;
        }
        this.totalReceived++;
        this.store.saveMessage(msg);
        // Record trace: → accepted
        recordTransition(msg.id, 'accepted', 'accepted', 'hub');
        // Notify sender: hub received and stored the message
        this.pushEvent(msg.from, 'receipt', {
            messageId: msg.id, status: 'accepted', nodeId: 'hub', ts: Date.now()
        });
        const toId = Array.isArray(msg.to) ? msg.to[0] : msg.to;
        const group = this.store.getGroup(toId);
        const rawTargets = group
            ? group.members.filter(m => m !== msg.from)
            : (Array.isArray(msg.to) ? msg.to : [msg.to]);
        // Normalize targets: resolve any handle variant (@jack.jackclaw, jack@jackclaw.ai) to the local identity
        const targets = rawTargets.map(t => {
            // Try to find the real nodeId via directory → use that as target
            const nodeId = directory_1.directoryStore.getNodeIdForHandle(t);
            if (nodeId) {
                // Reverse-lookup: find the short handle registered under this nodeId
                const handles = directory_1.directoryStore.getHandlesForNode(nodeId);
                // Prefer the shortest handle (e.g. @jack over @jack.jackclaw)
                const shortest = handles.sort((a, b) => a.length - b.length)[0];
                return shortest?.startsWith('@') ? shortest.slice(1) : (shortest ?? t);
            }
            // Fallback: parse handle to extract local part
            const parsed = (0, protocol_1.parseHandle)(t);
            return parsed?.local ?? t;
        });
        const priority = getPriority(msg);
        for (const target of targets) {
            const payload = group
                ? { ...msg, groupId: group.groupId, groupName: group.name }
                : msg;
            this._enqueue(priority, target, payload);
        }
    }
    /**
     * Deliver a single message to target.
     * WebSocket if online; offline queue otherwise.
     * Human targets are routed via agentNodeId or direct webhook.
     */
    deliver(target, msg) {
        if ((0, human_registry_1.isHumanTarget)(target)) {
            this._deliverToHuman(target, msg);
            return;
        }
        const ws = this.wsClients.get(target);
        if (ws && ws.readyState === ws_1.WebSocket.OPEN) {
            const payload = JSON.stringify({ event: 'message', data: msg });
            ws.send(payload, (err) => {
                if (err) {
                    // ws.send failed — retry once after 500ms
                    console.warn(`[chat-worker] ws.send failed for ${target}: ${err.message}`);
                    recordTransition(msg.id, 'accepted', 'failed', target);
                    setTimeout(() => this._retryDeliver(target, msg, 0), RETRY_DELAY_MS);
                }
                else {
                    // Sent successfully — record transition and start ACK timer
                    this.totalDelivered++;
                    recordTransition(msg.id, 'accepted', 'sent', target);
                    this.pushEvent(msg.from, 'receipt', {
                        messageId: msg.id, status: 'sent', nodeId: target, ts: Date.now()
                    });
                    this._startAckTimer(msg.id, target, msg);
                }
            });
        }
        else {
            this._queueOffline(target, msg);
        }
    }
    /** Retry delivery once, then queue offline */
    _retryDeliver(target, msg, attempt) {
        if (attempt >= MAX_RETRIES) {
            this._queueOffline(target, msg);
            return;
        }
        const ws = this.wsClients.get(target);
        if (ws && ws.readyState === ws_1.WebSocket.OPEN) {
            ws.send(JSON.stringify({ event: 'message', data: msg }), (err) => {
                if (err) {
                    this._queueOffline(target, msg);
                }
                else {
                    this.totalDelivered++;
                    recordTransition(msg.id, 'failed', 'sent', target);
                    this.pushEvent(msg.from, 'receipt', {
                        messageId: msg.id, status: 'sent', nodeId: target, ts: Date.now()
                    });
                    this._startAckTimer(msg.id, target, msg);
                }
            });
        }
        else {
            this._queueOffline(target, msg);
        }
    }
    /** Start ACK timeout — if no delivery_ack within 3s, queue offline */
    _startAckTimer(messageId, target, msg) {
        // Clear any existing timer
        const existing = pendingAcks.get(messageId);
        if (existing)
            clearTimeout(existing.timer);
        const timer = setTimeout(() => {
            // ACK timeout — queue offline
            pendingAcks.delete(messageId);
            recordTransition(messageId, 'sent', 'failed', target);
            this._queueOffline(target, msg);
        }, ACK_TIMEOUT_MS);
        timer.unref();
        pendingAcks.set(messageId, { target, msg, retries: 0, timer });
    }
    /** Called when we receive a delivery_ack from a node */
    handleDeliveryAck(messageId, nodeId) {
        const pending = pendingAcks.get(messageId);
        if (pending) {
            clearTimeout(pending.timer);
            pendingAcks.delete(messageId);
        }
        recordTransition(messageId, 'sent', 'acked', nodeId);
        // Find the original sender to notify
        const trace = messageTraces.get(messageId);
        if (trace && trace.length > 0) {
            this.pushEvent(trace[0].nodeId, 'receipt', {
                messageId, status: 'acked', nodeId, ts: Date.now()
            });
        }
    }
    /** Queue message offline with push notification */
    _queueOffline(target, msg) {
        this.store.queueForOffline(target, msg);
        this.totalQueued++;
        recordTransition(msg.id, 'sent', 'failed', target);
        // Notify via Web Push
        setImmediate(() => {
            void push_service_1.pushService.push(target, {
                title: `New message from ${msg.from}`,
                body: (typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)).slice(0, 120),
                data: { type: 'chat', messageId: msg.id, from: msg.from },
            });
        });
    }
    /**
     * Enqueue delivery to multiple targets at the same priority.
     */
    broadcast(targets, msg) {
        const priority = getPriority(msg);
        for (const target of targets) {
            this._enqueue(priority, target, msg);
        }
    }
    /**
     * Push an arbitrary event to a connected node's WebSocket.
     * Returns false if node is offline (caller handles queueing).
     */
    pushEvent(nodeId, event, data) {
        const ws = this.wsClients.get(nodeId);
        if (ws && ws.readyState === ws_1.WebSocket.OPEN) {
            ws.send(JSON.stringify({ event, data }));
            return true;
        }
        return false;
    }
    /** Raw WebSocket access (for social route offline queueing) */
    getClientWs(nodeId) {
        return this.wsClients.get(nodeId);
    }
    getStats() {
        const avg = this.latencySamples.length > 0
            ? this.latencySamples.reduce((a, b) => a + b, 0) / this.latencySamples.length
            : 0;
        return {
            connections: this.wsClients.size,
            queueDepth: this.queue.length,
            overflowActive: this.overflowActive,
            totalReceived: this.totalReceived,
            totalDelivered: this.totalDelivered,
            totalQueued: this.totalQueued,
            avgLatencyMs: Math.round(avg),
        };
    }
    // ─── WebSocket server ────────────────────────────────────────────────────────
    attachWss(server) {
        const wss = new ws_1.WebSocketServer({ server, path: '/chat/ws' });
        wss.on('connection', (ws, req) => {
            const url = new URL(req.url ?? '', 'http://localhost');
            let nodeId = url.searchParams.get('nodeId');
            const tokenParam = url.searchParams.get('token');
            // JWT auth: verify token → derive nodeId from the user's agentNodeId
            if (!nodeId && tokenParam) {
                try {
                    // Lazy imports to avoid load-time circular deps
                    // eslint-disable-next-line @typescript-eslint/no-var-requires
                    const { verifyJWT } = require('./server');
                    // eslint-disable-next-line @typescript-eslint/no-var-requires
                    const { userStore } = require('./store/users');
                    const payload = verifyJWT(tokenParam);
                    if (payload?.handle) {
                        const user = userStore.getUser(payload.handle);
                        if (user?.agentNodeId)
                            nodeId = user.agentNodeId;
                    }
                }
                catch { /* invalid token — nodeId stays null → close below */ }
            }
            if (!nodeId) {
                ws.close(4001, 'nodeId required');
                return;
            }
            if (this.wsClients.size >= WS_MAX_CONNECTIONS) {
                console.warn(`[chat-worker] Connection limit reached (${WS_MAX_CONNECTIONS}), rejecting ${nodeId}`);
                ws.close(4503, 'Service Unavailable: connection limit reached');
                return;
            }
            this.wsClients.set(nodeId, ws);
            this.wsAlive.set(nodeId, true);
            presence_1.presenceManager.setOnline(nodeId, ['ws']);
            console.log(`[chat-worker] ${nodeId} connected (total: ${this.wsClients.size})`);
            ws.on('pong', () => {
                this.wsAlive.set(nodeId, true);
                presence_1.presenceManager.heartbeat(nodeId);
            });
            // Drain chat offline inbox
            for (const offlineMsg of this.store.drainInbox(nodeId)) {
                ws.send(JSON.stringify({ event: 'message', data: offlineMsg }));
            }
            // Drain unified offline queue for all @handles associated with this node
            const handles = directory_1.directoryStore.getHandlesForNode(nodeId);
            for (const handle of handles) {
                for (const envelope of offline_queue_1.offlineQueue.dequeue(handle)) {
                    ws.send(JSON.stringify(envelope));
                }
            }
            ws.on('message', (raw) => {
                try {
                    const parsed = JSON.parse(raw.toString());
                    // ─── Handle delivery_ack from Node ─────────────────────────────────
                    if (parsed.event === 'delivery_ack' && parsed.messageId) {
                        this.handleDeliveryAck(parsed.messageId, nodeId);
                        return;
                    }
                    // ─── Handle stored confirmation from Node ──────────────────────────
                    if (parsed.event === 'stored' && parsed.messageId) {
                        recordTransition(parsed.messageId, 'acked', 'stored', nodeId);
                        return;
                    }
                    // ─── Handle consumed confirmation from Node ────────────────────────
                    if (parsed.event === 'consumed' && parsed.messageId) {
                        recordTransition(parsed.messageId, 'stored', 'consumed', nodeId);
                        return;
                    }
                    if (parsed.event === 'typing') {
                        const to = typeof parsed.to === 'string' ? parsed.to : null;
                        const threadId = typeof parsed.threadId === 'string' ? parsed.threadId : '';
                        if (!to || !threadId)
                            return;
                        this.pushEvent(to, 'typing', {
                            from: nodeId,
                            to,
                            threadId,
                            isTyping: Boolean(parsed.isTyping),
                            ts: Date.now(),
                        });
                        return;
                    }
                    if (parsed.event === 'read_receipt' && typeof parsed.messageId === 'string') {
                        const readMessage = this.store.markMessageRead(parsed.messageId, nodeId);
                        if (!readMessage)
                            return;
                        recordTransition(parsed.messageId, 'stored', 'consumed', nodeId);
                        this.pushEvent(readMessage.from, 'message_read', {
                            messageId: parsed.messageId,
                            threadId: readMessage.threadId,
                            readBy: nodeId,
                            ts: Date.now(),
                        });
                        return;
                    }
                    // ─── Regular chat message ──────────────────────────────────────────
                    const msg = parsed;
                    // Enqueue for priority delivery — never block the WS event loop
                    this.handleIncoming(msg);
                    // task → fire-and-forget planner (no await)
                    if (msg.type === 'task') {
                        setImmediate(() => { void this._triggerPlanner(msg); });
                    }
                    // human → observe for OwnerMemory (fire-and-forget)
                    if (msg.type === 'human') {
                        setImmediate(() => {
                            this.store.observeMessage(msg.from, {
                                content: msg.content,
                                direction: 'incoming',
                                type: msg.type,
                            });
                        });
                    }
                    ws.send(JSON.stringify({ event: 'ack', messageId: msg.id }));
                }
                catch {
                    ws.send(JSON.stringify({ event: 'error', message: 'Invalid message format' }));
                }
            });
            ws.on('close', () => {
                this.wsClients.delete(nodeId);
                this.wsAlive.delete(nodeId);
                presence_1.presenceManager.setOffline(nodeId);
                console.log(`[chat-worker] ${nodeId} disconnected (total: ${this.wsClients.size})`);
            });
        });
        return wss;
    }
    // ─── Private: priority queue ─────────────────────────────────────────────────
    _enqueue(priority, target, msg) {
        const item = { priority, seq: this.seq++, target, msg };
        if (this.queue.length >= MAX_QUEUE_MEM) {
            this._spillToDisk(item);
            this.overflowActive = true;
        }
        else {
            this._insertSorted(item);
        }
        if (!this.draining) {
            setImmediate(() => this._drain());
        }
    }
    /** Binary-search insert to maintain priority-ascending (FIFO within same priority) order */
    _insertSorted(item) {
        let lo = 0, hi = this.queue.length;
        while (lo < hi) {
            const mid = (lo + hi) >>> 1;
            const q = this.queue[mid];
            if (q.priority < item.priority || (q.priority === item.priority && q.seq < item.seq)) {
                lo = mid + 1;
            }
            else {
                hi = mid;
            }
        }
        this.queue.splice(lo, 0, item);
    }
    _drain() {
        if (this.queue.length === 0) {
            if (this.overflowActive) {
                this._reloadFromDisk();
                if (this.queue.length > 0) {
                    // Items reloaded — keep draining
                    setImmediate(() => this._drain());
                    return;
                }
            }
            this.draining = false;
            return;
        }
        this.draining = true;
        const item = this.queue.shift();
        const start = Date.now();
        this.deliver(item.target, item.msg);
        const latency = Date.now() - start;
        this.latencySamples.push(latency);
        if (this.latencySamples.length > 100)
            this.latencySamples.shift();
        setImmediate(() => this._drain());
    }
    // ─── Private: disk overflow ──────────────────────────────────────────────────
    _spillToDisk(item) {
        try {
            fs_1.default.appendFileSync(this.overflowFile, JSON.stringify(item) + '\n');
        }
        catch (e) {
            console.error('[chat-worker] Overflow spill failed:', e);
        }
    }
    _reloadFromDisk() {
        if (!fs_1.default.existsSync(this.overflowFile)) {
            this.overflowActive = false;
            return;
        }
        try {
            const data = fs_1.default.readFileSync(this.overflowFile, 'utf-8');
            fs_1.default.unlinkSync(this.overflowFile);
            this.overflowActive = false;
            for (const line of data.trim().split('\n').filter(Boolean)) {
                const item = JSON.parse(line);
                // Re-insert without triggering another disk spill
                if (this.queue.length < MAX_QUEUE_MEM) {
                    this._insertSorted(item);
                }
                else {
                    this._spillToDisk(item);
                    this.overflowActive = true;
                }
            }
        }
        catch (e) {
            console.error('[chat-worker] Overflow reload failed:', e);
            this.overflowActive = false;
        }
    }
    // ─── Private: heartbeat ──────────────────────────────────────────────────────
    _startHeartbeat() {
        this.heartbeatTimer = setInterval(() => {
            for (const [nodeId, ws] of this.wsClients) {
                if (!this.wsAlive.get(nodeId)) {
                    console.log(`[chat-worker] ${nodeId} heartbeat timeout, closing`);
                    ws.terminate();
                    this.wsClients.delete(nodeId);
                    this.wsAlive.delete(nodeId);
                    presence_1.presenceManager.setOffline(nodeId);
                    continue;
                }
                this.wsAlive.set(nodeId, false);
                ws.ping();
            }
        }, HEARTBEAT_INTERVAL);
        // Don't prevent process exit
        this.heartbeatTimer.unref();
    }
    // ─── Private: task planner ───────────────────────────────────────────────────
    async _triggerPlanner(msg) {
        try {
            const resp = await fetch('http://localhost:3100/api/plan/estimate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    taskId: msg.id,
                    title: msg.content.slice(0, 80),
                    description: msg.content,
                    useAi: false,
                }),
            });
            const { plan, formatted } = await resp.json();
            const planMsg = {
                id: `plan-${msg.id}`,
                from: 'hub-planner',
                to: msg.from,
                content: formatted ?? JSON.stringify(plan),
                type: 'plan-result',
                ts: Date.now(),
                signature: '',
                encrypted: false,
                metadata: { plan },
            };
            // deliver through normal path — queued if sender is offline
            this.deliver(msg.from, planMsg);
        }
        catch { /* planner failure never blocks routing */ }
    }
    // ─── Private: human delivery ─────────────────────────────────────────────────
    _deliverToHuman(target, msg) {
        const human = (0, human_registry_1.getHuman)(target);
        if (!human)
            return;
        if (human.agentNodeId) {
            const agentPayload = {
                ...msg,
                to: human.agentNodeId,
                metadata: {
                    ...msg.metadata,
                    humanTarget: human.humanId,
                    humanDisplayName: human.displayName,
                },
            };
            const agentWs = this.wsClients.get(human.agentNodeId);
            if (agentWs && agentWs.readyState === ws_1.WebSocket.OPEN) {
                agentWs.send(JSON.stringify({ event: 'message', data: agentPayload }));
                this.totalDelivered++;
            }
            else {
                this.store.queueForOffline(human.agentNodeId, agentPayload);
                this.totalQueued++;
            }
        }
        else {
            // No agent — direct webhook fallback (fire-and-forget)
            (0, human_registry_1.pushToHuman)(human, { from: msg.from, content: msg.content, type: msg.type, id: msg.id })
                .catch(() => { });
            this.totalDelivered++;
        }
    }
}
exports.ChatWorker = ChatWorker;
// ─── Singleton ────────────────────────────────────────────────────────────────
exports.chatWorker = new ChatWorker();
//# sourceMappingURL=chat-worker.js.map