"use strict";
// JackClaw Hub - Approval Store
// Persists to ~/.jackclaw/hub/approvals.json
// 审批记录持久化到 ~/.jackclaw/hub/approvals.json
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.approvalStore = exports.ApprovalStore = void 0;
const fs_1 = __importDefault(require("fs"));
const os_1 = __importDefault(require("os"));
const path_1 = __importDefault(require("path"));
const crypto_1 = __importDefault(require("crypto"));
// NOTE:
// The current repository snapshot does not contain ../state-machine yet.
// 为避免当前仓库缺少 ../state-machine 时直接编译失败，这里做兼容导入。
// 等 state-machine 文件落地后，可移除下方 ts-ignore/fallback。
// @ts-ignore - module may be added in a later commit
const state_machine_1 = require("../state-machine");
const HUB_DIR = path_1.default.join(os_1.default.homedir(), '.jackclaw', 'hub');
const APPROVALS_FILE = path_1.default.join(HUB_DIR, 'approvals.json');
/**
 * Lightweight fallback state machine.
 * 轻量兜底状态机；当 ../state-machine 尚未存在时使用。
 */
class FallbackStateMachine {
    config;
    constructor(config) {
        this.config = config;
    }
    transition(currentState, event) {
        const next = this.config[currentState]?.[event];
        if (!next) {
            throw Object.assign(new Error(`非法状态流转: ${currentState} -> ${event}`), { status: 409 });
        }
        return next;
    }
}
const fallbackApprovalStateMachineConfig = {
    pending: {
        approve: 'approved',
        reject: 'rejected',
        expire: 'expired',
    },
    approved: {},
    rejected: {},
    expired: {},
};
function loadJSON(file, fallback) {
    try {
        if (fs_1.default.existsSync(file))
            return JSON.parse(fs_1.default.readFileSync(file, 'utf-8'));
    }
    catch {
        // Ignore missing/broken JSON file / 忽略缺失或损坏的 JSON 文件
    }
    return fallback;
}
function saveJSON(file, data) {
    fs_1.default.mkdirSync(path_1.default.dirname(file), { recursive: true });
    fs_1.default.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
}
/**
 * Normalize records loaded from disk.
 * 标准化磁盘中的审批记录，兼容旧数据或脏数据。
 */
function normalizeRecord(input) {
    const createdAt = Number.isFinite(input.createdAt) ? input.createdAt : Date.now();
    const updatedAt = Number.isFinite(input.updatedAt) ? input.updatedAt : createdAt;
    const state = (input.state ?? 'pending');
    return {
        ...input,
        createdAt,
        updatedAt,
        state,
        stateHistory: Array.isArray(input.stateHistory) ? input.stateHistory : [],
    };
}
/**
 * Create one shared state machine instance.
 * 创建共享状态机实例；优先使用 ../state-machine 的正式实现。
 */
function createApprovalStateMachine() {
    const ImportedStateMachine = state_machine_1.StateMachine
        ?? FallbackStateMachine;
    const importedConfig = state_machine_1.ApprovalStateMachineConfig ?? fallbackApprovalStateMachineConfig;
    try {
        return new ImportedStateMachine(importedConfig);
    }
    catch {
        return new FallbackStateMachine(fallbackApprovalStateMachineConfig);
    }
}
class ApprovalStore {
    file;
    machine;
    constructor(file = APPROVALS_FILE) {
        this.file = file;
        this.machine = createApprovalStateMachine();
    }
    /**
     * Load all approval records.
     * 加载全部审批记录。
     */
    load() {
        return loadJSON(this.file, []).map(normalizeRecord);
    }
    /**
     * Persist approval records.
     * 持久化审批记录。
     */
    save(records) {
        saveJSON(this.file, records);
    }
    /**
     * Require one record by id.
     * 按 id 获取记录；不存在时抛错。
     */
    mustGet(records, id) {
        const record = records.find(item => item.id === id);
        if (!record)
            throw Object.assign(new Error('审批记录不存在'), { status: 404 });
        return record;
    }
    /**
     * Apply one state transition and append history.
     * 执行状态流转，并写入状态历史。
     */
    transition(record, event, actorId) {
        const from = record.state;
        const to = this.machine.transition(from, event);
        const now = Date.now();
        record.state = to;
        record.updatedAt = now;
        record.stateHistory.push({ from, to, event, ts: now, actorId });
        return record;
    }
    /**
     * Create a new approval request.
     * 创建一条新的审批请求。
     */
    create(tenantId, type, title, requestedBy, opts = {}) {
        if (!tenantId.trim())
            throw Object.assign(new Error('tenantId 不能为空'), { status: 400 });
        if (!type.trim())
            throw Object.assign(new Error('type 不能为空'), { status: 400 });
        if (!title.trim())
            throw Object.assign(new Error('title 不能为空'), { status: 400 });
        if (!requestedBy.trim())
            throw Object.assign(new Error('requestedBy 不能为空'), { status: 400 });
        const records = this.load();
        const now = Date.now();
        const id = opts.id?.trim() || crypto_1.default.randomUUID();
        if (records.some(item => item.id === id)) {
            throw Object.assign(new Error(`审批记录 ${id} 已存在`), { status: 409 });
        }
        const record = {
            id,
            tenantId: tenantId.trim(),
            type: type.trim(),
            title: title.trim(),
            description: opts.description,
            state: 'pending',
            requestedBy: requestedBy.trim(),
            approvedBy: opts.approvedBy,
            rejectedBy: opts.rejectedBy,
            reason: opts.reason,
            metadata: opts.metadata,
            stateHistory: [],
            expiresAt: opts.expiresAt,
            createdAt: now,
            updatedAt: now,
        };
        // Preserve caller-provided timestamps only when valid.
        // 若调用方传入合法时间戳，则保留。
        if (typeof opts.createdAt === 'number' && Number.isFinite(opts.createdAt))
            record.createdAt = opts.createdAt;
        if (typeof opts.updatedAt === 'number' && Number.isFinite(opts.updatedAt))
            record.updatedAt = opts.updatedAt;
        // Create event is always written into history.
        // create 事件始终写入历史，便于后续审计。
        record.stateHistory.push({
            from: 'none',
            to: 'pending',
            event: 'create',
            ts: record.createdAt,
            actorId: record.requestedBy,
        });
        records.push(record);
        this.save(records);
        return record;
    }
    /**
     * Get one approval record by id.
     * 按 id 获取审批记录。
     */
    get(id) {
        return this.load().find(item => item.id === id) ?? null;
    }
    /**
     * List records under one tenant with optional filters.
     * 按租户列出审批记录，支持状态/申请人/数量过滤。
     */
    list(tenantId, opts = {}) {
        const { state, requestedBy, limit } = opts;
        const records = this.load()
            .filter(item => item.tenantId === tenantId)
            .filter(item => (state ? item.state === state : true))
            .filter(item => (requestedBy ? item.requestedBy === requestedBy : true))
            .sort((a, b) => b.createdAt - a.createdAt);
        if (typeof limit === 'number' && Number.isFinite(limit) && limit > 0) {
            return records.slice(0, Math.floor(limit));
        }
        return records;
    }
    /**
     * Approve a pending record.
     * 批准一条待审批记录。
     */
    approve(id, approvedBy, reason) {
        if (!approvedBy.trim())
            throw Object.assign(new Error('approvedBy 不能为空'), { status: 400 });
        const records = this.load();
        const record = this.mustGet(records, id);
        this.transition(record, 'approve', approvedBy.trim());
        record.approvedBy = approvedBy.trim();
        record.reason = reason;
        this.save(records);
        return record;
    }
    /**
     * Reject a pending record.
     * 拒绝一条待审批记录。
     */
    reject(id, rejectedBy, reason) {
        if (!rejectedBy.trim())
            throw Object.assign(new Error('rejectedBy 不能为空'), { status: 400 });
        const records = this.load();
        const record = this.mustGet(records, id);
        this.transition(record, 'reject', rejectedBy.trim());
        record.rejectedBy = rejectedBy.trim();
        record.reason = reason;
        this.save(records);
        return record;
    }
    /**
     * Expire a pending record.
     * 将一条待审批记录标记为已过期。
     */
    expire(id) {
        const records = this.load();
        const record = this.mustGet(records, id);
        this.transition(record, 'expire');
        this.save(records);
        return record;
    }
    /**
     * List pending approvals for one tenant.
     * 列出租户下所有待审批记录。
     */
    pending(tenantId) {
        return this.list(tenantId, { state: 'pending' });
    }
}
exports.ApprovalStore = ApprovalStore;
exports.approvalStore = new ApprovalStore();
//# sourceMappingURL=approval-store.js.map