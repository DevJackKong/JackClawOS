/**
 * ws-tunnel.ts — WebSocket-based reverse tunnel client
 *
 * The intranet Node connects to Hub's /tunnel/ws?nodeId=xxx endpoint,
 * receives forwarded HTTP requests, proxies them to a local port,
 * and sends responses back through the WebSocket.
 *
 * Protocol:
 *   Hub → Node: { type: 'request',  id, method, path, headers, body (base64) }
 *   Node → Hub: { type: 'response', id, status, headers, body (base64) }
 *   Hub → Node: { type: 'ready',    publicUrl }
 */

import * as http from 'http';
import { WebSocket } from 'ws';

// ─── Protocol Types ──────────────────────────────────────────────────────────

export interface TunnelRequestMsg {
  type: 'request';
  id: string;
  method: string;
  path: string;
  headers: Record<string, string>;
  body: string; // base64-encoded
}

export interface TunnelResponseMsg {
  type: 'response';
  id: string;
  status: number;
  headers: Record<string, string[]>;
  body: string; // base64-encoded
}

export interface TunnelReadyMsg {
  type: 'ready';
  publicUrl: string;
}

export type TunnelMsg = TunnelRequestMsg | TunnelResponseMsg | TunnelReadyMsg;

// ─── Options ─────────────────────────────────────────────────────────────────

export interface WsTunnelOptions {
  /** Hub WebSocket URL, e.g. ws://hub.example.com/tunnel/ws */
  hubWsUrl: string;
  /** Node ID to register under */
  nodeId: string;
  /** Local HTTP port to proxy incoming requests to */
  localPort: number;
  /** Optional auth token passed as ?token= query param */
  token?: string;
  /** Max reconnect attempts (default: 10; 0 = no reconnect) */
  maxRetries?: number;
  /** Milliseconds between retries (default: 3000) */
  retryDelayMs?: number;
  onReady?: (publicUrl: string) => void;
  onDisconnect?: () => void;
}

// ─── WsTunnel ────────────────────────────────────────────────────────────────

export class WsTunnel {
  private ws: WebSocket | null = null;
  private publicUrl: string | null = null;
  private stopped = false;
  private retryCount = 0;

  private readonly maxRetries: number;
  private readonly retryDelayMs: number;

  constructor(private readonly opts: WsTunnelOptions) {
    this.maxRetries = opts.maxRetries ?? 10;
    this.retryDelayMs = opts.retryDelayMs ?? 3000;
  }

  /** Connect to Hub and resolve when the tunnel is ready. Returns the public URL. */
  start(): Promise<string> {
    return new Promise((resolve, reject) => {
      this.connect(resolve, reject);
    });
  }

  private connect(
    resolve?: (url: string) => void,
    reject?: (err: Error) => void,
  ): void {
    if (this.stopped) return;

    const url = new URL(this.opts.hubWsUrl);
    url.searchParams.set('nodeId', this.opts.nodeId);
    if (this.opts.token) url.searchParams.set('token', this.opts.token);

    const ws = new WebSocket(url.toString());
    this.ws = ws;

    ws.on('open', () => {
      this.retryCount = 0;
    });

    ws.on('message', (data: Buffer | string) => {
      let msg: TunnelMsg;
      try {
        msg = JSON.parse(data.toString()) as TunnelMsg;
      } catch {
        return;
      }

      if (msg.type === 'ready') {
        this.publicUrl = msg.publicUrl;
        this.opts.onReady?.(msg.publicUrl);
        if (resolve) { resolve(msg.publicUrl); resolve = undefined; }
      } else if (msg.type === 'request') {
        this.handleRequest(ws, msg);
      }
    });

    ws.on('error', (err: Error) => {
      if (reject) { reject(err); reject = undefined; }
    });

    ws.on('close', () => {
      this.ws = null;
      this.opts.onDisconnect?.();

      if (!this.stopped && this.retryCount < this.maxRetries) {
        this.retryCount++;
        this.publicUrl = null;
        setTimeout(() => this.connect(), this.retryDelayMs);
      } else if (reject) {
        reject(new Error(`WsTunnel: disconnected after ${this.retryCount} retries`));
        reject = undefined;
      }
    });
  }

  private handleRequest(ws: WebSocket, req: TunnelRequestMsg): void {
    const body = req.body ? Buffer.from(req.body, 'base64') : Buffer.alloc(0);

    const options: http.RequestOptions = {
      hostname: '127.0.0.1',
      port: this.opts.localPort,
      path: req.path,
      method: req.method,
      headers: {
        ...req.headers,
        host: `localhost:${this.opts.localPort}`,
        'content-length': String(body.length),
      },
    };

    const proxyReq = http.request(options, (proxyRes) => {
      const chunks: Buffer[] = [];
      proxyRes.on('data', (chunk: Buffer) => chunks.push(chunk));
      proxyRes.on('end', () => {
        const responseBody = Buffer.concat(chunks).toString('base64');
        const headers: Record<string, string[]> = {};
        for (const [k, v] of Object.entries(proxyRes.headers)) {
          if (v !== undefined) {
            headers[k] = Array.isArray(v) ? v : [String(v)];
          }
        }
        this.send(ws, {
          type: 'response',
          id: req.id,
          status: proxyRes.statusCode ?? 502,
          headers,
          body: responseBody,
        });
      });
    });

    proxyReq.on('error', (err: Error) => {
      this.send(ws, {
        type: 'response',
        id: req.id,
        status: 502,
        headers: { 'content-type': ['text/plain'] },
        body: Buffer.from(`Proxy error: ${err.message}`).toString('base64'),
      });
    });

    if (body.length > 0) proxyReq.write(body);
    proxyReq.end();
  }

  private send(ws: WebSocket, msg: TunnelMsg): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  getPublicUrl(): string | null {
    return this.publicUrl;
  }

  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  stop(): void {
    this.stopped = true;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

/** Convenience factory — connects and resolves on ready. */
export async function startWsTunnel(opts: WsTunnelOptions): Promise<WsTunnel> {
  const tunnel = new WsTunnel(opts);
  await tunnel.start();
  return tunnel;
}
