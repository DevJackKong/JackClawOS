/**
 * Hub reverse-tunnel route
 *
 * WS  /tunnel/ws?nodeId=xxx  — Intranet node establishes a persistent tunnel
 * ANY /tunnel/:nodeId/*       — External requests forwarded to the node via WS
 *
 * Protocol (JSON over WebSocket):
 *   Hub → Node: { type: 'request',  id, method, path, headers, body (base64) }
 *   Node → Hub: { type: 'response', id, status, headers, body (base64) }
 *   Hub → Node: { type: 'ready',    publicUrl }
 */
import http from 'http';
declare const router: import("express-serve-static-core").Router;
/**
 * Attach the tunnel WebSocket handler to an existing http.Server.
 * Call this alongside attachChatWss in hub/index.ts.
 */
export declare function attachTunnelWss(server: http.Server, hubUrl: string): void;
/** Returns a snapshot of all connected node IDs. */
export declare function getConnectedTunnels(): string[];
export default router;
//# sourceMappingURL=tunnel.d.ts.map