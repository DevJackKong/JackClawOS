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
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const server_1 = require("../server");
const nodes_1 = require("../store/nodes");
const router = (0, express_1.Router)();
/**
 * Safe getter wrapper.
 * 安全读取包装：任意 store 不存在、方法不存在或抛错时，返回兜底值。
 */
async function safeGet(getter, fallback) {
    try {
        return await getter();
    }
    catch {
        return fallback;
    }
}
/**
 * Best-effort import for taskStateStore.
 * 尝试导入 taskStateStore；失败时返回 null。
 */
async function getTaskStateStore() {
    try {
        const mod = await Promise.resolve().then(() => __importStar(require('../store/task-state-store')));
        return mod.taskStateStore ?? null;
    }
    catch {
        return null;
    }
}
/**
 * Best-effort import for approvalStore.
 * 尝试导入 approvalStore；失败时返回 null。
 */
async function getApprovalStore() {
    try {
        const mod = await Promise.resolve().then(() => __importStar(require('../store/approval-store')));
        return mod.approvalStore ?? null;
    }
    catch {
        return null;
    }
}
/**
 * Best-effort import for contactStore.
 * 尝试导入 contactStore；失败时返回 null。
 */
async function getContactStore() {
    try {
        const mod = await Promise.resolve().then(() => __importStar(require('../store/contact-store')));
        return mod.contactStore ?? null;
    }
    catch {
        return null;
    }
}
/**
 * Read total tasks from task store.
 * 从任务 store 读取总任务数；若无法读取则降级为 0。
 */
async function getTotalTasks() {
    return safeGet(async () => {
        const store = await getTaskStateStore();
        if (!store || typeof store.list !== 'function')
            return 0;
        const tasks = await store.list('');
        return Array.isArray(tasks) ? tasks.length : 0;
    }, 0);
}
/**
 * Read pending approvals from approval store.
 * 从审批 store 读取待审批数；若无法读取则降级为 0。
 */
async function getPendingApprovals() {
    return safeGet(async () => {
        const store = await getApprovalStore();
        if (!store || typeof store.list !== 'function')
            return 0;
        const approvals = await store.list('', { state: 'pending' });
        return Array.isArray(approvals) ? approvals.length : 0;
    }, 0);
}
/**
 * Read total contacts from contact store.
 * 从联系人 store 读取总联系人数；若无法读取则降级为 0。
 */
async function getTotalContacts() {
    return safeGet(async () => {
        const store = await getContactStore();
        if (!store || typeof store.list !== 'function')
            return 0;
        const contacts = await store.list('');
        return Array.isArray(contacts) ? contacts.length : 0;
    }, 0);
}
/**
 * GET /api/dashboard/overview
 * Dashboard overview metrics.
 * Dashboard 概览统计。
 */
router.get('/overview', (0, server_1.asyncHandler)(async (_req, res) => {
    const nodes = await safeGet(() => (0, nodes_1.getAllNodes)(), []);
    // onlineNodes 暂按最近有心跳/上报时间的节点估算；若字段不存在则回退为 0。
    const onlineNodes = nodes.filter((node) => {
        const lastSeen = node.lastReportAt ?? node.lastHeartbeatAt ?? node.updatedAt;
        return typeof lastSeen === 'number' && lastSeen > 0;
    }).length;
    const overview = {
        totalNodes: nodes.length,
        onlineNodes,
        totalMessages: 0,
        totalTasks: await getTotalTasks(),
        pendingApprovals: await getPendingApprovals(),
        totalContacts: await getTotalContacts(),
        recentActivity: [],
    };
    res.json(overview);
}));
/**
 * GET /api/dashboard/timeline
 * Timeline data.
 * 时间线数据；当前返回空数组。
 */
router.get('/timeline', (0, server_1.asyncHandler)(async (_req, res) => {
    res.json([]);
}));
exports.default = router;
//# sourceMappingURL=dashboard.js.map