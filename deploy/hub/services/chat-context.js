"use strict";
/**
 * Chat Context Service / 聊天上下文聚合服务
 *
 * Aggregate lightweight contact/task/memory/approval context for one node.
 * 为单个 node 聚合轻量级联系人、任务、记忆、审批上下文。
 *
 * Design goals / 设计目标：
 * - Best-effort aggregation: missing store methods should not break callers
 *   尽力聚合：某个 store 缺方法时，不影响整体返回
 * - Small and safe payloads for chat-side context injection
 *   返回体保持轻量，适合注入聊天上下文
 * - Heuristic fallbacks where canonical store APIs are not available
 *   当缺少标准 API 时，使用启发式降级
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.chatContextService = exports.ChatContextService = void 0;
const directory_1 = require("../store/directory");
const nodes_1 = require("../store/nodes");
const memory_1 = require("../store/memory");
const org_memory_1 = require("../store/org-memory");
const message_store_1 = require("../store/message-store");
const users_1 = require("../store/users");
const member_store_1 = require("../store/member-store");
const workload_cache_1 = require("../store/workload-cache");
class ChatContextService {
    orgMemoryStore = new org_memory_1.OrgMemoryStore();
    /**
     * Build chat context for a node / 为指定 node 构建聊天上下文。
     */
    async getContext(nodeId, tenantId) {
        const contact = await this.getContact(nodeId, tenantId);
        const recentTasks = await this.getRecentTasks(nodeId);
        const recentMemory = await this.getRecentMemory(nodeId);
        const pendingApprovals = await this.getPendingApprovals(nodeId);
        const riskAlerts = this.buildRiskAlerts({ nodeId, contact, recentTasks, pendingApprovals });
        const recommendedActions = this.buildRecommendedActions({
            nodeId,
            contact,
            recentTasks,
            recentMemory,
            pendingApprovals,
            riskAlerts,
        });
        return {
            contact,
            recentTasks,
            recentMemory,
            pendingApprovals,
            recommendedActions,
            riskAlerts,
        };
    }
    /**
     * Resolve contact info from directory + nodes + users + members.
     * 从目录、节点、用户、成员表综合联系人信息。
     */
    async getContact(nodeId, tenantId) {
        let handle;
        let displayName;
        let role;
        let lastSeen;
        try {
            const handles = this.safeCall(() => directory_1.directoryStore.getHandlesForNode(nodeId), []);
            handle = handles[0];
            if (handle) {
                const resolvedHandle = handle;
                const profile = this.safeCall(() => directory_1.directoryStore.getProfile(resolvedHandle), null);
                displayName = this.pickString(profile, 'displayName') ?? displayName;
                role = this.pickString(profile, 'role') ?? role;
                lastSeen = this.pickNumber(profile, 'lastSeen') ?? lastSeen;
            }
        }
        catch {
            // Ignore missing directory capabilities / 忽略目录层异常
        }
        try {
            const node = this.safeCall(() => (0, nodes_1.getNode)(nodeId), undefined);
            displayName = this.pickString(node, 'name') ?? displayName;
            role = this.pickString(node, 'role') ?? role;
            lastSeen = this.pickNumber(node, 'lastReportAt') ?? lastSeen;
        }
        catch {
            // Ignore missing node registry / 忽略节点注册表异常
        }
        try {
            if (handle) {
                const resolvedHandle = handle;
                const user = this.safeCall(() => users_1.userStore.getUser(resolvedHandle), null);
                displayName = this.pickString(user, 'displayName') ?? displayName;
                const userTenantId = this.pickString(user, 'tenantId');
                const effectiveTenantId = tenantId ?? userTenantId;
                const userId = this.pickString(user, 'handle');
                if (effectiveTenantId && userId) {
                    const member = this.safeCall(() => member_store_1.memberStore.getByUser(userId, effectiveTenantId), null);
                    role = this.pickString(member, 'role') ?? role;
                }
            }
        }
        catch {
            // Ignore user/member lookup failure / 忽略用户成员查询失败
        }
        if (!handle && !displayName && !role && !lastSeen) {
            return { nodeId };
        }
        return {
            nodeId,
            handle,
            displayName,
            role,
            lastSeen,
        };
    }
    /**
     * Derive recent tasks from participant messages.
     * 当前仓库没有统一 task store 导出时，从消息存储做启发式推断。
     */
    async getRecentTasks(nodeId) {
        try {
            const messages = this.safeCall(() => message_store_1.messageStore.getMessagesByParticipant(nodeId, 50, 0), []);
            return messages
                .filter(msg => ['task', 'plan-result'].includes(String(msg.type ?? '')))
                .sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0))
                .slice(0, 5)
                .map(msg => ({
                id: msg.id,
                title: this.toTaskTitle(msg.content),
                state: this.toTaskState(msg),
                assignee: this.inferAssignee(nodeId, msg),
                updatedAt: msg.ts ?? Date.now(),
            }));
        }
        catch {
            return [];
        }
    }
    /**
     * Aggregate recent memory from shared memdirs + org memory store.
     * 从共享 MemDir 与组织记忆中聚合最近记忆。
     */
    async getRecentMemory(nodeId) {
        const items = [];
        try {
            const shared = this.safeCall(() => (0, memory_1.getSharedMemDirs)(nodeId), []);
            for (const entry of shared.slice(0, 5)) {
                const key = String(entry?.title ?? entry?.id ?? 'shared-memory');
                const value = String(entry?.content ?? entry?.summary ?? '');
                const updatedAt = Number(entry?.updatedAt ?? entry?.createdAt ?? Date.now());
                if (!value)
                    continue;
                items.push({ key, value: value.slice(0, 500), updatedAt });
            }
        }
        catch {
            // Ignore shared memory failures / 忽略共享记忆异常
        }
        try {
            const orgEntries = this.safeCall(() => this.orgMemoryStore.query(undefined, 5), []);
            for (const entry of orgEntries) {
                items.push({
                    key: String(entry?.type ?? entry?.id ?? 'org-memory'),
                    value: String(entry?.content ?? '').slice(0, 500),
                    updatedAt: Number(entry?.createdAt ?? Date.now()),
                });
            }
        }
        catch {
            // Ignore org memory failures / 忽略组织记忆异常
        }
        return items
            .filter(item => item.value)
            .sort((a, b) => b.updatedAt - a.updatedAt)
            .slice(0, 5);
    }
    /**
     * Derive pending approvals from approval messages or pending-review executions.
     * 从 approval 消息或 pending-review 执行状态中推断待审批项。
     */
    async getPendingApprovals(nodeId) {
        try {
            const messages = this.safeCall(() => message_store_1.messageStore.getMessagesByParticipant(nodeId, 50, 0), []);
            return messages
                .filter(msg => msg.type === 'approval' || msg.status === 'pending-review')
                .sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0))
                .slice(0, 5)
                .map(msg => ({
                id: msg.id,
                type: msg.type === 'approval' ? 'approval' : 'pending-review',
                requestedBy: String(msg.fromAgent ?? 'unknown'),
                requestedAt: msg.ts ?? Date.now(),
            }));
        }
        catch {
            return [];
        }
    }
    /**
     * Generate lightweight alerts / 生成轻量风险提醒。
     */
    buildRiskAlerts(input) {
        const alerts = [];
        const lastSeen = input.contact?.lastSeen;
        if (!lastSeen || Date.now() - lastSeen > 1000 * 60 * 60 * 24 * 7) {
            alerts.push('Contact may be stale / 联系人最近活跃时间较旧');
        }
        if ((input.pendingApprovals?.length ?? 0) > 0) {
            alerts.push(`There are ${input.pendingApprovals?.length ?? 0} pending approvals / 存在待审批项`);
        }
        if ((input.recentTasks?.length ?? 0) >= 3) {
            const unfinished = (input.recentTasks ?? []).filter(task => !['completed', 'success', 'done'].includes(task.state));
            if (unfinished.length >= 3) {
                alerts.push('Several recent tasks are still unresolved / 最近多项任务尚未完成');
            }
        }
        try {
            const workload = this.safeCall(() => (0, workload_cache_1.getWorkload)(input.nodeId), null);
            const queued = this.pickNumber(workload, 'queuedTasks') ?? 0;
            const active = this.pickNumber(workload, 'activeTasks') ?? 0;
            if (queued >= 5 || active >= 5) {
                alerts.push('Node workload is high / 节点负载较高');
            }
        }
        catch {
            // Ignore workload failures / 忽略负载读取异常
        }
        return alerts.slice(0, 5);
    }
    /**
     * Generate suggested next actions / 生成建议动作。
     */
    buildRecommendedActions(input) {
        const actions = [];
        if ((input.pendingApprovals?.length ?? 0) > 0) {
            actions.push('Review pending approvals / 先处理待审批项');
        }
        const latestTask = input.recentTasks?.[0];
        if (latestTask && !['completed', 'success', 'done'].includes(latestTask.state)) {
            actions.push(`Follow up task: ${latestTask.title} / 跟进最近任务`);
        }
        if ((input.recentMemory?.length ?? 0) > 0) {
            actions.push('Use recent memory as reply context / 回复时注入最近记忆');
        }
        try {
            const workload = this.safeCall(() => (0, workload_cache_1.getWorkload)(input.nodeId), null);
            const queued = this.pickNumber(workload, 'queuedTasks') ?? 0;
            if (queued > 0) {
                actions.push(`Queue has ${queued} pending items / 队列中仍有 ${queued} 个待处理项`);
            }
        }
        catch {
            // Ignore workload failures / 忽略负载读取异常
        }
        if ((input.riskAlerts?.length ?? 0) === 0) {
            actions.push('Safe to continue normal conversation / 可正常继续对话');
        }
        return Array.from(new Set(actions)).slice(0, 5);
    }
    /** Best-effort call wrapper / 尽力调用包装器。 */
    safeCall(fn, fallback) {
        try {
            return fn();
        }
        catch {
            return fallback;
        }
    }
    /** Truncate content into a task-like title / 将内容截断为任务标题。 */
    toTaskTitle(content) {
        const text = String(content ?? '').replace(/\s+/g, ' ').trim();
        if (!text)
            return 'Untitled task';
        return text.slice(0, 80);
    }
    /** Map message shape to a coarse task state / 将消息状态映射为粗粒度任务状态。 */
    toTaskState(msg) {
        const status = String(msg.status ?? '').trim();
        if (status)
            return status;
        if (msg.type === 'plan-result')
            return 'planned';
        return 'pending';
    }
    /** Infer assignee from message direction / 通过消息方向推断负责人。 */
    inferAssignee(nodeId, msg) {
        if (msg.toAgent === nodeId)
            return nodeId;
        if (msg.fromAgent === nodeId)
            return nodeId;
        return msg.toAgent || msg.fromAgent || undefined;
    }
    pickString(obj, key) {
        const value = obj?.[key];
        return typeof value === 'string' && value.trim() ? value : undefined;
    }
    pickNumber(obj, key) {
        const value = obj?.[key];
        return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
    }
}
exports.ChatContextService = ChatContextService;
exports.chatContextService = new ChatContextService();
//# sourceMappingURL=chat-context.js.map