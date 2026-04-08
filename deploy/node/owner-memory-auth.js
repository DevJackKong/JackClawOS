"use strict";
/**
 * OwnerMemory Authorization Layer — 情绪独立区授权框架
 *
 * 核心设计原则：
 * 1. 数据归用户所有，存在本地 Node，不上传任何服务器
 * 2. 第三方产品（硬件/软件）通过 OAuth2-like 授权机制申请访问
 * 3. 授权粒度细化到 MemoryType 级别（只允许读 preference，不允许读 private-note）
 * 4. 授权可随时撤销，撤销后立即生效
 * 5. 所有访问行为审计日志记录
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OwnerMemoryAuth = void 0;
exports.getOwnerMemoryAuth = getOwnerMemoryAuth;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
const crypto_1 = require("crypto");
// ─── 授权管理器 ───────────────────────────────────────────────────────────────
class OwnerMemoryAuth {
    nodeId;
    storePath;
    grants = new Map();
    tokens = new Map();
    auditLogs = [];
    pendingRequests = new Map();
    constructor(nodeId, storePath = path_1.default.join(os_1.default.homedir(), '.jackclaw', 'owner-memory', 'auth')) {
        this.nodeId = nodeId;
        this.storePath = storePath;
        fs_1.default.mkdirSync(storePath, { recursive: true });
        this.load();
    }
    // ─── 用户操作（主人侧）────────────────────────────────────────────────────
    /** 列出所有待审批的授权申请 */
    getPendingRequests() {
        return [...this.pendingRequests.entries()].map(([id, r]) => ({ ...r, requestId: id }));
    }
    /** 用户批准授权申请 */
    approve(requestId, opts) {
        const request = this.pendingRequests.get(requestId);
        if (!request)
            throw new Error(`Request not found: ${requestId}`);
        const scopes = opts?.scopes
            ? opts.scopes.filter(s => request.requestedScopes.includes(s)) // 只能缩小
            : request.requestedScopes;
        const expiryDays = opts?.expiryDays ?? 90;
        const grant = {
            grantId: (0, crypto_1.randomUUID)(),
            nodeId: this.nodeId,
            clientId: request.clientId,
            clientName: request.clientName,
            productType: request.productType,
            scopes,
            createdAt: Date.now(),
            expiresAt: Date.now() + expiryDays * 86400000,
            accessCount: 0,
            active: true,
            userNote: opts?.userNote,
        };
        this.grants.set(grant.grantId, grant);
        this.pendingRequests.delete(requestId);
        this.save();
        console.log(`[auth] Grant approved: ${grant.clientName} → ${scopes.join(', ')}`);
        return grant;
    }
    /** 撤销授权（立即生效） */
    revoke(grantId) {
        const grant = this.grants.get(grantId);
        if (!grant)
            throw new Error(`Grant not found: ${grantId}`);
        grant.active = false;
        // 作废所有相关 token
        for (const [token, at] of this.tokens) {
            if (at.grantId === grantId)
                this.tokens.delete(token);
        }
        this.save();
        console.log(`[auth] Grant revoked: ${grant.clientName} (${grantId})`);
    }
    /** 列出所有有效授权 */
    listGrants() {
        return [...this.grants.values()].filter(g => g.active);
    }
    /** 查看访问日志 */
    getAuditLog(grantId) {
        return grantId
            ? this.auditLogs.filter(l => l.grantId === grantId)
            : this.auditLogs.slice(-100); // 最近100条
    }
    // ─── 产品侧操作 ────────────────────────────────────────────────────────────
    /** 产品方提交授权申请（返回 requestId，等待用户审批） */
    requestAccess(request) {
        // private-note 永远不可申请
        const safeScopes = request.requestedScopes.filter(s => !s.startsWith('private'));
        const requestId = (0, crypto_1.randomUUID)();
        this.pendingRequests.set(requestId, {
            ...request,
            requestedScopes: safeScopes,
            requestedAt: Date.now(),
        });
        this.save();
        console.log(`[auth] Access request from ${request.clientName}: ${safeScopes.join(', ')}`);
        return requestId;
    }
    /** 用授权凭证换取访问 token（grant_type=client_credentials like） */
    issueToken(grantId, clientSecret) {
        const grant = this.grants.get(grantId);
        if (!grant || !grant.active)
            throw new Error('Invalid or revoked grant');
        if (Date.now() > grant.expiresAt)
            throw new Error('Grant expired');
        // 简单验证：clientSecret = SHA256(clientId + grantId)
        const expected = (0, crypto_1.createHash)('sha256')
            .update(grant.clientId + grantId)
            .digest('hex');
        if (clientSecret !== expected)
            throw new Error('Invalid client secret');
        const token = {
            token: (0, crypto_1.randomUUID)(),
            grantId,
            scopes: grant.scopes,
            expiresAt: Math.min(grant.expiresAt, Date.now() + 3600000), // token 最长1h
        };
        this.tokens.set(token.token, token);
        return token;
    }
    /**
     * 产品方用 token 访问 OwnerMemory 数据
     * 返回脱敏后的数据（不含 private-note，不含原始 ID）
     */
    access(token, scope, entries) {
        const accessToken = this.tokens.get(token);
        // 验证 token
        if (!accessToken) {
            this.logAccess(null, scope, false);
            throw new Error('Invalid token');
        }
        if (Date.now() > accessToken.expiresAt) {
            this.tokens.delete(token);
            throw new Error('Token expired');
        }
        if (!accessToken.scopes.includes(scope)) {
            this.logAccess(accessToken, scope, false);
            throw new Error(`Scope not authorized: ${scope}`);
        }
        const grant = this.grants.get(accessToken.grantId);
        if (!grant || !grant.active)
            throw new Error('Grant revoked');
        // 更新统计
        grant.accessCount++;
        grant.lastUsedAt = Date.now();
        this.logAccess(accessToken, scope, true);
        this.save();
        // 返回脱敏数据（去掉 id、去掉 private-note）
        const type = scope.split(':')[0];
        return entries
            .filter(e => e.type === type && e.type !== 'private-note')
            .map(({ id: _id, ...rest }) => rest); // 去掉内部 ID
    }
    // ─── 内部方法 ──────────────────────────────────────────────────────────────
    logAccess(token, scope, success) {
        if (!token)
            return;
        const grant = this.grants.get(token.grantId);
        this.auditLogs.push({
            id: (0, crypto_1.randomUUID)(),
            grantId: token.grantId,
            clientId: grant?.clientId ?? 'unknown',
            clientName: grant?.clientName ?? 'unknown',
            scope,
            accessedAt: Date.now(),
            success,
        });
        // 只保留最近 1000 条
        if (this.auditLogs.length > 1000)
            this.auditLogs.splice(0, this.auditLogs.length - 1000);
    }
    load() {
        try {
            const data = JSON.parse(fs_1.default.readFileSync(path_1.default.join(this.storePath, `${this.nodeId}.json`), 'utf-8'));
            for (const g of data.grants ?? [])
                this.grants.set(g.grantId, g);
            this.auditLogs = data.auditLogs ?? [];
            for (const r of data.pendingRequests ?? []) {
                const { requestId, ...rest } = r;
                this.pendingRequests.set(requestId, rest);
            }
        }
        catch { /* 首次运行 */ }
    }
    save() {
        const data = {
            grants: [...this.grants.values()],
            auditLogs: this.auditLogs.slice(-1000),
            pendingRequests: [...this.pendingRequests.entries()].map(([id, r]) => ({ ...r, requestId: id })),
        };
        fs_1.default.writeFileSync(path_1.default.join(this.storePath, `${this.nodeId}.json`), JSON.stringify(data, null, 2));
    }
}
exports.OwnerMemoryAuth = OwnerMemoryAuth;
// 单例工厂
const authInstances = new Map();
function getOwnerMemoryAuth(nodeId) {
    if (!authInstances.has(nodeId)) {
        authInstances.set(nodeId, new OwnerMemoryAuth(nodeId));
    }
    return authInstances.get(nodeId);
}
//# sourceMappingURL=owner-memory-auth.js.map