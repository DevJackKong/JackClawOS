"use strict";
// JackClaw Hub - Entry Point
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const http_1 = __importDefault(require("http"));
const server_1 = require("./server");
const chat_1 = require("./routes/chat");
// ─── Process-level error guards (log but don't crash) ─────────────────────────
process.on('uncaughtException', (err) => {
    console.error('[hub] uncaughtException:', err);
});
process.on('unhandledRejection', (reason) => {
    console.error('[hub] unhandledRejection:', reason);
});
const PORT = parseInt(process.env.PORT ?? process.env.HUB_PORT ?? '3100', 10);
const app = (0, server_1.createServer)();
const httpServer = http_1.default.createServer(app);
// ClawChat WebSocket
(0, chat_1.attachChatWss)(httpServer);
httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`[hub] JackClaw Hub listening on http://0.0.0.0:${PORT}`);
    console.log(`[hub] Dashboard: http://localhost:${PORT}`);
    console.log(`[hub] PWA App:   http://localhost:${PORT}/app/`);
    console.log(`[hub] Routes:`);
    console.log(`  POST /api/register     - Node registration`);
    console.log(`  POST /api/report       - Receive agent report (JWT)`);
    console.log(`  GET  /api/nodes        - List nodes (JWT)`);
    console.log(`  GET  /api/summary      - Daily summary (JWT)`);
    console.log(`  POST /api/chat/send    - ClawChat send message`);
    console.log(`  GET  /api/chat/inbox   - Pull offline messages`);
    console.log(`  WS   /chat/ws          - ClawChat realtime`);
    console.log(`  POST /api/ask          - Ask any LLM via node gateway`);
    console.log(`  GET  /health           - Health check`);
});
exports.default = app;
//# sourceMappingURL=index.js.map