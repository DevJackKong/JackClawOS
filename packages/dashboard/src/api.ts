// Hub API client — wraps all REST endpoints for JackClaw Hub

const BASE =
  typeof window !== 'undefined'
    ? `${window.location.protocol}//${window.location.host}`
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
  read?: boolean;
  readBy?: string[];
  recalled?: boolean;
  recalledAt?: number;
  attachments?: Array<{ name: string; type: string; url?: string; data?: string }>;
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
  agentNodeId: string;
  email?: string;
  createdAt?: number;
  updatedAt?: number;
}

export interface AuthResponse {
  token: string;
  user: UserProfile;
}

export interface HandleCheckResponse {
  available: boolean;
  reason?: string;
}

// ── Social types ──────────────────────────────────────────────────────────────

export interface SocialMessage {
  id: string;
  fromHuman: string;
  fromAgent: string;
  toAgent: string;
  content: string;
  type: string;
  thread?: string;
  replyTo?: string;
  ts: number;
  encrypted?: boolean;
}

export interface SocialThread {
  id: string;
  participants: string[];
  lastMessage: string;
  lastMessageAt: number;
  messageCount: number;
}

export interface FileItem {
  fileId: string;
  filename: string;
  mimeType: string;
  size: number;
  ext: string;
  uploadedAt: number;
  url: string;
  thumbnailUrl?: string;
}

export interface FileUploadResponse {
  fileId: string;
  url: string;
  filename: string;
  size: number;
  mimeType: string;
  thumbnailUrl?: string;
}

export interface FileListResponse {
  files: FileItem[];
  total: number;
  page: number;
  limit: number;
  totalSize: number;
}

export interface UploadFileOptions {
  onProgress?: (percent: number, event: ProgressEvent<EventTarget>) => void;
}

// ── Auth helper ──────────────────────────────────────────────────────────────

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

function bearerHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
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

  healthDetailed: (): Promise<any> =>
    req(`${BASE}/health/detailed`),

  metrics: (): Promise<string> =>
    fetch(`${BASE}/health/metrics`).then(r => r.text()),

  plugins: (token: string): Promise<{ plugins: any[]; stats: any }> =>
    req(`${BASE}/api/plugins`, { headers: authHeaders(token) }),

  pluginStats: (token: string): Promise<any> =>
    req(`${BASE}/api/plugins/stats`, { headers: authHeaders(token) }),

  pluginEvents: (token: string): Promise<{ events: any[] }> =>
    req(`${BASE}/api/plugins/events`, { headers: authHeaders(token) }),

  agentCard: (): Promise<any> =>
    req(`${BASE}/.well-known/agents.json`),

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

    recall: (token: string, id: string): Promise<{ status: string; message: ChatMessage }> =>
      req(`${BASE}/api/chat/messages/${encodeURIComponent(id)}`, {
        method: 'DELETE',
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

    refresh: (token: string): Promise<AuthResponse> =>
      req(`${BASE}/api/auth/refresh`, {
        method: 'POST',
        headers: authHeaders(token),
      }),

    updateProfile: (token: string, body: Partial<Omit<UserProfile, 'handle'>>): Promise<UserProfile> =>
      req(`${BASE}/api/auth/profile`, {
        method: 'PATCH',
        headers: authHeaders(token),
        body: JSON.stringify(body),
      }),
  },

  social: {
    send: (
      token: string,
      body: { fromHuman: string; fromAgent: string; toAgent: string; content: string; type?: string },
    ): Promise<{ status: string; messageId: string; thread: string }> =>
      req(`${BASE}/api/social/send`, {
        method: 'POST',
        headers: authHeaders(token),
        body: JSON.stringify(body),
      }),

    threads: (token: string, agentHandle: string): Promise<{ threads: SocialThread[]; count: number }> =>
      req(`${BASE}/api/social/threads?agentHandle=${encodeURIComponent(agentHandle)}`, {
        headers: authHeaders(token),
      }),

    messages: (token: string, agentHandle: string, limit = 50): Promise<{ messages: SocialMessage[]; count: number }> =>
      req(`${BASE}/api/social/messages?agentHandle=${encodeURIComponent(agentHandle)}&limit=${limit}`, {
        headers: authHeaders(token),
      }),

    contacts: (token: string, agentHandle: string): Promise<{ contacts: Array<{ handle: string; profile: unknown }>; count: number }> =>
      req(`${BASE}/api/social/contacts?agentHandle=${encodeURIComponent(agentHandle)}`, {
        headers: authHeaders(token),
      }),

    threadMessages: (token: string, threadId: string, limit = 200): Promise<{ messages: SocialMessage[]; count: number }> =>
      req(`${BASE}/api/social/thread/${encodeURIComponent(threadId)}?limit=${limit}`, {
        headers: authHeaders(token),
      }),
  },

  presence: {
    online: (token: string): Promise<{ users: Array<{ handle: string; nodeId: string; displayName: string; role: string; onlineSince: number | null }>; count: number }> =>
      req(`${BASE}/api/presence/online`, { headers: authHeaders(token) }),
  },

  files: {
    uploadFile: (token: string, file: File, options?: UploadFileOptions): Promise<FileUploadResponse> =>
      new Promise<FileUploadResponse>((resolve, reject) => {
        const formData = new FormData();
        formData.append('file', file);

        const xhr = new XMLHttpRequest();
        xhr.open('POST', `${BASE}/api/files/upload`);
        Object.entries(bearerHeaders(token)).forEach(([key, value]) => {
          xhr.setRequestHeader(key, value);
        });
        xhr.responseType = 'json';

        xhr.upload.onprogress = event => {
          if (!event.lengthComputable) return;
          const percent = Math.round((event.loaded / event.total) * 100);
          options?.onProgress?.(percent, event);
        };

        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(xhr.response as FileUploadResponse);
            return;
          }

          const fallback = typeof xhr.response === 'object' && xhr.response && 'error' in xhr.response
            ? String((xhr.response as { error?: string }).error)
            : xhr.responseText || `HTTP ${xhr.status}`;
          reject(new Error(fallback));
        };

        xhr.onerror = () => reject(new Error('Upload failed'));
        xhr.send(formData);
      }),

    downloadFile: (token: string, fileId: string): Promise<Blob> =>
      fetch(`${BASE}/api/files/${encodeURIComponent(fileId)}`, {
        headers: bearerHeaders(token),
      }).then(async res => {
        if (!res.ok) {
          const text = await res.text().catch(() => res.statusText);
          throw new Error(`HTTP ${res.status}: ${text}`);
        }
        return res.blob();
      }),

    listFiles: (token: string, page = 1, limit = 20): Promise<FileListResponse> =>
      req(`${BASE}/api/files/list?page=${page}&limit=${limit}`, {
        headers: authHeaders(token),
      }),
  },

  // ── Admin APIs ─────────────────────────────────────────────────────────────

  dashboard: {
    overview: (token: string): Promise<{ totalNodes: number; onlineNodes: number; totalMessages: number; totalTasks: number; pendingApprovals: number; totalContacts: number; recentActivity: any[] }> =>
      req(`${BASE}/api/dashboard/overview`, { headers: authHeaders(token) }),
    timeline: (token: string): Promise<any[]> =>
      req(`${BASE}/api/dashboard/timeline`, { headers: authHeaders(token) }),
  },

  tenant: {
    list: (token: string): Promise<{ tenants: any[] }> =>
      req(`${BASE}/api/tenant`, { headers: authHeaders(token) }),
    get: (token: string, id: string): Promise<any> =>
      req(`${BASE}/api/tenant/${id}`, { headers: authHeaders(token) }),
    create: (token: string, body: { name: string; slug: string; plan?: string }): Promise<any> =>
      req(`${BASE}/api/tenant`, { method: 'POST', headers: authHeaders(token), body: JSON.stringify(body) }),
    update: (token: string, id: string, body: Record<string, unknown>): Promise<any> =>
      req(`${BASE}/api/tenant/${id}`, { method: 'PATCH', headers: authHeaders(token), body: JSON.stringify(body) }),
    delete: (token: string, id: string): Promise<any> =>
      req(`${BASE}/api/tenant/${id}`, { method: 'DELETE', headers: authHeaders(token) }),
  },

  org: {
    list: (token: string): Promise<{ orgs: any[] }> =>
      req(`${BASE}/api/org`, { headers: authHeaders(token) }),
    get: (token: string, id: string): Promise<any> =>
      req(`${BASE}/api/org/${id}`, { headers: authHeaders(token) }),
    create: (token: string, body: { tenantId: string; name: string; slug?: string }): Promise<any> =>
      req(`${BASE}/api/org`, { method: 'POST', headers: authHeaders(token), body: JSON.stringify(body) }),
    update: (token: string, id: string, body: Record<string, unknown>): Promise<any> =>
      req(`${BASE}/api/org/${id}`, { method: 'PATCH', headers: authHeaders(token), body: JSON.stringify(body) }),
    delete: (token: string, id: string): Promise<any> =>
      req(`${BASE}/api/org/${id}`, { method: 'DELETE', headers: authHeaders(token) }),
  },

  members: {
    list: (token: string): Promise<{ members: any[] }> =>
      req(`${BASE}/api/members`, { headers: authHeaders(token) }),
    add: (token: string, body: { tenantId: string; orgId: string; userId: string; role: string }): Promise<any> =>
      req(`${BASE}/api/members`, { method: 'POST', headers: authHeaders(token), body: JSON.stringify(body) }),
    update: (token: string, id: string, body: Record<string, unknown>): Promise<any> =>
      req(`${BASE}/api/members/${id}`, { method: 'PATCH', headers: authHeaders(token), body: JSON.stringify(body) }),
    remove: (token: string, id: string): Promise<any> =>
      req(`${BASE}/api/members/${id}`, { method: 'DELETE', headers: authHeaders(token) }),
  },

  roles: {
    list: (token: string): Promise<{ roles: any[] }> =>
      req(`${BASE}/api/roles`, { headers: authHeaders(token) }),
    get: (token: string, id: string): Promise<any> =>
      req(`${BASE}/api/roles/${id}`, { headers: authHeaders(token) }),
    create: (token: string, body: { name: string; permissions: string[] }): Promise<any> =>
      req(`${BASE}/api/roles`, { method: 'POST', headers: authHeaders(token), body: JSON.stringify(body) }),
    update: (token: string, id: string, body: Record<string, unknown>): Promise<any> =>
      req(`${BASE}/api/roles/${id}`, { method: 'PATCH', headers: authHeaders(token), body: JSON.stringify(body) }),
    delete: (token: string, id: string): Promise<any> =>
      req(`${BASE}/api/roles/${id}`, { method: 'DELETE', headers: authHeaders(token) }),
    assign: (token: string, body: { userId: string; roleId: string }): Promise<any> =>
      req(`${BASE}/api/roles/assign`, { method: 'POST', headers: authHeaders(token), body: JSON.stringify(body) }),
    userRoles: (token: string, userId: string): Promise<{ roles: any[] }> =>
      req(`${BASE}/api/roles/user/${userId}`, { headers: authHeaders(token) }),
  },

  audit: {
    list: (token: string, query?: string): Promise<{ logs: any[] }> =>
      req(`${BASE}/api/audit${query ? `?${query}` : ''}`, { headers: authHeaders(token) }),
  },

  risk: {
    rules: (token: string): Promise<{ rules: any[] }> =>
      req(`${BASE}/api/risk/rules`, { headers: authHeaders(token) }),
    createRule: (token: string, body: Record<string, unknown>): Promise<any> =>
      req(`${BASE}/api/risk/rules`, { method: 'POST', headers: authHeaders(token), body: JSON.stringify(body) }),
    deleteRule: (token: string, id: string): Promise<any> =>
      req(`${BASE}/api/risk/rules/${id}`, { method: 'DELETE', headers: authHeaders(token) }),
    evaluate: (token: string, body: Record<string, unknown>): Promise<any> =>
      req(`${BASE}/api/risk/evaluate`, { method: 'POST', headers: authHeaders(token), body: JSON.stringify(body) }),
  },

  approval: {
    list: (token: string): Promise<{ approvals: any[] }> =>
      req(`${BASE}/api/approval`, { headers: authHeaders(token) }),
    approve: (token: string, id: string): Promise<any> =>
      req(`${BASE}/api/approval/${id}/approve`, { method: 'POST', headers: authHeaders(token) }),
    reject: (token: string, id: string, reason?: string): Promise<any> =>
      req(`${BASE}/api/approval/${id}/reject`, { method: 'POST', headers: authHeaders(token), body: JSON.stringify({ reason }) }),
  },
};
