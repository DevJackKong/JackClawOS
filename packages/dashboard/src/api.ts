// Hub API client — wraps all REST endpoints for JackClaw Hub

const BASE = 'http://localhost:3100';

// ── Types ────────────────────────────────────────────────────────────────────

export interface HealthResponse {
  status: string;
  uptime?: number;
  version?: string;
}

export interface NodeInfo {
  nodeId: string;
  name: string;
  role: string;
  registeredAt: number;
  lastReportAt?: number;
  capabilities?: string[];
  metadata?: Record<string, unknown>;
}

export interface NodesResponse {
  nodes: NodeInfo[];
}

export interface SummaryNodeReport {
  name: string;
  summary: string;
  reportedAt: number;
}

export interface SummaryByRole {
  nodes: SummaryNodeReport[];
}

export interface SummaryResponse {
  date: string;
  totalNodes: number;
  reportingNodes: number;
  byRole: Record<string, SummaryByRole>;
}

export interface ChatThread {
  id: string;
  nodeId: string;
  title?: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
}

export interface ChatMessage {
  id: string;
  threadId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: number;
  tokens?: number;
}

export interface ChatThreadDetail {
  thread: ChatThread;
  messages: ChatMessage[];
}

export interface SendMessageRequest {
  nodeId: string;
  content: string;
  threadId?: string;
}

export interface SendMessageResponse {
  threadId: string;
  message: ChatMessage;
}

export interface TokenStatsResponse {
  totalTokens: number;
  cacheHits: number;
  cacheMisses: number;
  hitRate: number;
  savedTokens: number;
  byNode?: Record<string, { tokens: number; cacheHits: number }>;
}

// ── Auth helper ──────────────────────────────────────────────────────────────

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

async function req<T>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(url, opts);
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

// ── API surface ──────────────────────────────────────────────────────────────

export const api = {
  health: (): Promise<HealthResponse> =>
    req(`${BASE}/health`),

  nodes: (token: string): Promise<NodesResponse> =>
    req(`${BASE}/api/nodes`, { headers: authHeaders(token) }),

  summary: (token: string, date?: string): Promise<SummaryResponse> => {
    const d = date ?? new Date().toISOString().slice(0, 10);
    return req(`${BASE}/api/summary?date=${d}`, { headers: authHeaders(token) });
  },

  chat: {
    send: (token: string, body: SendMessageRequest): Promise<SendMessageResponse> =>
      req(`${BASE}/api/chat/send`, {
        method: 'POST',
        headers: authHeaders(token),
        body: JSON.stringify(body),
      }),

    threads: (token: string, nodeId: string): Promise<{ threads: ChatThread[] }> =>
      req(`${BASE}/api/chat/threads?nodeId=${encodeURIComponent(nodeId)}`, {
        headers: authHeaders(token),
      }),

    thread: (token: string, id: string): Promise<ChatThreadDetail> =>
      req(`${BASE}/api/chat/thread/${encodeURIComponent(id)}`, {
        headers: authHeaders(token),
      }),
  },

  stats: (token: string): Promise<TokenStatsResponse> =>
    req(`${BASE}/api/stats/tokens`, { headers: authHeaders(token) }),
};
