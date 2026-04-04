// Hub API client — wraps all REST endpoints for JackClaw Hub

const BASE =
  typeof window !== 'undefined'
    ? `${window.location.protocol}//${window.location.hostname}:3100`
    : 'http://localhost:3100';

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
  type?: 'human' | 'task' | 'ask';
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

export interface PlanEstimateRequest {
  title: string;
  description: string;
  nodeId?: string;
  useAi?: boolean;
}

export interface ExecutionPlan {
  taskId: string;
  title: string;
  complexity: 'trivial' | 'simple' | 'moderate' | 'complex' | 'epic';
  estimatedMinutesSerial: number;
  estimatedMinutesParallel: number;
  parallelSpeedup: number;
  estimatedTotalTokens: number;
  estimatedCostUsd: number;
  needsParallel: boolean;
  suggestedAgentCount: number;
  subtasks: Array<{ id: string; title: string; estimatedMinutes: number; dependencies?: string[] }>;
  parallelBatches: Array<Array<string>>;
  overallRisk: string;
  risks: string[];
  plannerVersion: string;
  plannedAt: number;
}

export interface PlanEstimateResponse {
  plan: ExecutionPlan;
  note?: string;
}

// ── Auth types ───────────────────────────────────────────────────────────────

export interface UserProfile {
  handle: string;
  displayName: string;
  bio: string;
  avatar: string;
}

export interface AuthResponse {
  token: string;
  user: UserProfile;
}

export interface HandleCheckResponse {
  available: boolean;
  reason?: string;
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

    inbox: (token: string, nodeId: string): Promise<{ messages: ChatMessage[] }> =>
      req(`${BASE}/api/chat/inbox?nodeId=${encodeURIComponent(nodeId)}`, {
        headers: authHeaders(token),
      }),
  },

  stats: (token: string): Promise<TokenStatsResponse> =>
    req(`${BASE}/api/stats/tokens`, { headers: authHeaders(token) }),

  plan: (token: string, body: PlanEstimateRequest): Promise<PlanEstimateResponse> =>
    req(`${BASE}/api/plan/estimate`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify(body),
    }),

  auth: {
    checkHandle: (handle: string): Promise<HandleCheckResponse> =>
      req(`${BASE}/api/auth/check-handle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handle }),
      }),

    register: (body: { displayName: string; handle: string; password: string }): Promise<AuthResponse> =>
      req(`${BASE}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),

    login: (body: { handle: string; password: string }): Promise<AuthResponse> =>
      req(`${BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),

    me: (token: string): Promise<UserProfile> =>
      req(`${BASE}/api/auth/me`, { headers: authHeaders(token) }),

    updateProfile: (token: string, body: Partial<Omit<UserProfile, 'handle'>>): Promise<UserProfile> =>
      req(`${BASE}/api/auth/profile`, {
        method: 'PATCH',
        headers: authHeaders(token),
        body: JSON.stringify(body),
      }),
  },
};
