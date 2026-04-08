"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AutoReplyHandler = void 0;
exports.main = main;
// ── Global error handlers — must be first ───────────────────────────────────
process.on('uncaughtException', (err) => {
    console.error('[fatal] uncaughtException:', err.stack ?? err.message);
    // Keep process alive — log and continue
});
process.on('unhandledRejection', (reason) => {
    const msg = reason instanceof Error ? reason.stack ?? reason.message : String(reason);
    console.error('[fatal] unhandledRejection:', msg);
    // Keep process alive — log and continue
});
const node_cron_1 = __importDefault(require("node-cron"));
const config_1 = require("./config");
const identity_1 = require("./identity");
const server_1 = require("./server");
const hub_1 = require("./hub");
const reporter_1 = require("./reporter");
const protocol_1 = require("@jackclaw/protocol");
const ai_client_1 = require("./ai-client");
const chat_client_1 = require("./chat-client");
const owner_memory_1 = require("./owner-memory");
const memory_1 = require("@jackclaw/memory");
const llm_gateway_1 = require("./llm-gateway");
const social_handler_1 = require("./social-handler");
const ai_secretary_1 = require("./ai-secretary");
const ai_concierge_1 = require("./ai-concierge");
const moltbook_1 = require("./integrations/moltbook");
const moltbook_agent_1 = require("./integrations/moltbook-agent");
const channels_1 = require("./channels");
async function main() {
    console.log('🦞 JackClaw Node starting...');
    const config = (0, config_1.loadConfig)();
    const identity = (0, identity_1.loadOrCreateIdentity)({
        displayName: config.nodeName ?? config.nodeId ?? undefined,
        role: config.nodeRole ?? undefined,
    });
    if (config.nodeId) {
        identity.nodeId = config.nodeId;
    }
    console.log(`[node] Node ID: ${identity.nodeId}`);
    console.log(`[node] Hub: ${config.hubUrl}`);
    console.log(`[node] Port: ${config.port}`);
    // 0. Initialize LLM Gateway
    const gateway = (0, llm_gateway_1.createNodeGateway)(config);
    // 1. Register with Hub (best-effort, non-blocking)
    await (0, hub_1.registerWithHub)(identity, config);
    // 1b. Connect NodeChatClient to Hub ClawChat
    const ownerMemory = (0, owner_memory_1.getOwnerMemory)(identity.nodeId);
    const chatClient = new chat_client_1.NodeChatClient(identity.nodeId, config.hubUrl);
    // 1c. Init Social Handler
    const socialHandler = new social_handler_1.SocialHandler({
        nodeId: identity.nodeId,
        agentHandle: config.agentHandle,
        hubUrl: config.hubUrl,
        webhookUrl: config.webhookUrl,
        humanId: config.humanId,
    });
    // 1d. Init AI Concierge
    const concierge = (0, ai_concierge_1.createConcierge)({
        nodeId: identity.nodeId,
        hubUrl: config.hubUrl,
        agentHandle: config.agentHandle,
    });
    // 1e. AI Secretary — initialized after aiClient; messages arrive async so this is safe
    let secretary = null;
    chatClient.onMessage((msg) => {
        // Route social events to SocialHandler first
        if (msg.type === 'social' || msg.type === 'social_contact_request' || msg.type === 'social_contact_response') {
            socialHandler.handleEvent(msg.type, msg);
            return;
        }
        if (msg.type === 'task') {
            (0, server_1.handleTask)({ taskId: msg.id, action: 'ai', params: { prompt: msg.content, title: `chat:${msg.id}` } }, identity, config);
        }
        else if (msg.type === 'human') {
            ownerMemory.observeMessage({ content: msg.content, direction: 'incoming', type: msg.type });
            if (secretary) {
                // Secretary decides whether/how to notify owner
                secretary.handleIncoming({ id: msg.id, from: msg.from, content: msg.content, type: msg.type, ts: Date.now() })
                    .catch((err) => console.error('[secretary] handleIncoming error:', err.message));
            }
        }
    });
    chatClient.connect();
    // 2. Start HTTP server
    const app = (0, server_1.createServer)(identity, config, chatClient);
    app.listen(config.port, () => {
        console.log(`[server] Listening on port ${config.port}`);
    });
    // 3. Init AI client + Harness runner
    const aiClient = (0, ai_client_1.getAiClient)(identity.nodeId, config);
    console.log('[ai] AiClient initialized — cache probe will run on first call');
    // 3a. Init AI Secretary
    secretary = new ai_secretary_1.AiSecretary({
        aiClient,
        ownerMemory,
        notifyOwner: (msg, priority) => {
            console.log(`[secretary] 📬 [${priority}] from=${msg.from}: ${msg.content.slice(0, 80)}`);
        },
        sendReply: async (to, content) => {
            chatClient.send(to, content, 'human');
        },
    });
    console.log(`[secretary] Initialized — mode: ${secretary.getMode()}`);
    // 3b. ChannelBridge — IM bridge framework
    const channelBridge = new channels_1.ChannelBridge({ hubUrl: config.hubUrl, nodeId: identity.nodeId });
    // Auto-connect any channels saved in ~/.jackclaw/node/channels.json
    channelBridge.autoConnect().catch((err) => console.error('[bridge] autoConnect error:', err.message));
    console.log('[bridge] ChannelBridge initialized — awaiting channel adapters');
    // 3c. Moltbook integration (optional — only if api_key configured)
    const moltbookClient = new moltbook_1.MoltbookClient();
    if (moltbookClient.isConfigured()) {
        const moltbookAgent = (0, moltbook_agent_1.createMoltbookAgent)(moltbookClient, aiClient, ownerMemory, identity.nodeId);
        console.log('[moltbook] Client initialized — agent connected');
        // Daily digest cron: every day at 8:30am
        node_cron_1.default.schedule('30 8 * * *', async () => {
            try {
                const digest = await moltbookAgent.dailyDigest();
                console.log('[moltbook] Daily digest:\n' + digest);
            }
            catch (err) {
                console.error('[moltbook] Digest cron failed:', err.message);
            }
        });
        console.log('[moltbook] Daily digest scheduled: 08:30 daily');
    }
    else {
        console.log('[moltbook] Not configured — run: jackclaw moltbook connect <api_key>');
    }
    // 注册 Harness runner（运行时注入，编译期无跨包依赖）
    try {
        const { getHarnessRegistry, buildDefaultContext } = await Promise.resolve(`${'../../harness/src/index.js'}`).then(s => __importStar(require(s)));
        const registry = await getHarnessRegistry();
        const harnessContext = buildDefaultContext({ nodeId: identity.nodeId, hubUrl: config.hubUrl });
        (0, server_1.registerHarnessRunner)(async (opts) => {
            const session = registry.spawnBest({ id: opts.taskId, title: opts.title, description: opts.description, workdir: opts.workdir, requireHumanApproval: opts.requireApproval }, harnessContext);
            const result = await session.run();
            return { status: result.status, attempts: result.attempts };
        });
        console.log('[harness] Runner registered — available:', registry.getAvailable().join(', ') || 'none');
    }
    catch {
        console.log('[harness] Package not available in this environment, skipping');
    }
    // 3b. Memory sync — startup pull + every 6 hours
    const memManager = new memory_1.MemoryManager();
    const memSync = new memory_1.MemDirSync(identity.nodeId);
    async function runMemorySync() {
        if (!config.visibility.shareMemory)
            return;
        try {
            // push local shared project/reference entries to Hub
            const { entries } = memManager.syncSummary(identity.nodeId);
            await memSync.push(entries, config.hubUrl);
            // pull other nodes' entries and merge into local shared scope
            const remote = await memSync.pull(identity.nodeId, config.hubUrl);
            for (const e of remote) {
                // avoid duplicates: skip if same id already stored locally
                const existing = memManager.query(identity.nodeId, { scope: 'shared' });
                if (!existing.some(x => x.id === e.id)) {
                    memManager.save({ ...e, nodeId: identity.nodeId, scope: 'shared' });
                }
            }
            console.log(`[memory-sync] done — pushed ${entries.length}, pulled ${remote.length}`);
        }
        catch (err) {
            console.error('[memory-sync] error:', err.message);
        }
    }
    // pull once at startup
    runMemorySync().catch(() => { });
    // repeat every 6 hours
    node_cron_1.default.schedule('0 */6 * * *', () => {
        runMemorySync().catch(() => { });
    });
    console.log('[cron] Memory sync scheduled: every 6 hours');
    // 3. Schedule daily report
    if (!node_cron_1.default.validate(config.reportCron)) {
        console.error(`[cron] Invalid cron expression: "${config.reportCron}", using default "0 8 * * *"`);
        config.reportCron = '0 8 * * *';
    }
    console.log(`[cron] Report scheduled: ${config.reportCron}`);
    node_cron_1.default.schedule(config.reportCron, async () => {
        console.log('[cron] Generating daily report...');
        try {
            const report = (0, reporter_1.buildDailyReport)(config);
            // Append SmartCache savings to report
            const savings = aiClient.getSavingsReport('today');
            report.tokenSavings = {
                savedTokens: savings.totalSavedTokens,
                savingsRate: `${(savings.savingsRate * 100).toFixed(1)}%`,
                estimatedCostSaved: `$${savings.estimatedCostSaved.toFixed(4)}`,
                strategy: savings.byStrategy,
            };
            // Encrypt for Hub (if Hub public key available) or send plaintext wrapped
            const hubPublicKey = config.hubPublicKey;
            if (hubPublicKey) {
                const msg = (0, protocol_1.createMessage)(identity.nodeId, 'hub', 'report', report, hubPublicKey, identity.privateKey);
                await (0, hub_1.sendReportToHub)(identity.nodeId, JSON.stringify(msg), config);
            }
            else {
                // Dev mode: send unencrypted (wrapped in plain JSON)
                console.warn('[cron] Hub public key not set — sending unencrypted report (dev mode)');
                await (0, hub_1.sendReportToHub)(identity.nodeId, JSON.stringify({ plain: true, report }), config);
            }
        }
        catch (err) {
            console.error('[cron] Report failed:', err.message);
        }
    });
    // 4. Graceful shutdown
    process.on('SIGTERM', () => {
        console.log('[node] SIGTERM received, shutting down.');
        chatClient.stop();
        channelBridge.disconnectAll().finally(() => process.exit(0));
    });
    process.on('SIGINT', () => {
        console.log('[node] SIGINT received, shutting down.');
        chatClient.stop();
        channelBridge.disconnectAll().finally(() => process.exit(0));
    });
    console.log('🦞 JackClaw Node ready.');
}
var auto_reply_js_1 = require("./auto-reply.js");
Object.defineProperty(exports, "AutoReplyHandler", { enumerable: true, get: function () { return auto_reply_js_1.AutoReplyHandler; } });
//# sourceMappingURL=index.js.map