"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.initEventIntegration = initEventIntegration;
const event_bus_1 = require("../event-bus");
const trace_store_1 = require("../store/trace-store");
/**
 * 从事件类型中提取动作名。
 * Extract action part from event type like task.created -> created.
 */
function getAction(type) {
    const [, action = type] = type.split('.');
    return action;
}
/**
 * 尝试从事件数据里提取 tenantId。
 * Best-effort tenant id extraction from event payload.
 */
function getTenantId(data) {
    return data?.tenantId ?? '';
}
/**
 * 推断 actorId，尽量保留真实操作者。
 * Infer actor id with a stable fallback.
 */
function getActorId(event) {
    return event.data?.actorId
        ?? event.source
        ?? (typeof event.data?.from === 'string' ? event.data.from : undefined)
        ?? (typeof event.data?.userId === 'string' ? event.data.userId : undefined)
        ?? 'system';
}
/**
 * 从多种字段中推断 targetId。
 * Infer a target entity id from common payload fields.
 */
function getTargetId(data) {
    return data?.targetId
        ?? data?.taskId
        ?? data?.approvalId
        ?? data?.messageId
        ?? data?.memoryId
        ?? data?.memberId
        ?? data?.roleId
        ?? data?.orgId
        ?? data?.workspaceId
        ?? data?.id;
}
/**
 * 写入一条 trace。
 * Persist one trace entry for the incoming event.
 */
function addTrace(event, type, targetId) {
    trace_store_1.traceStore.add({
        tenantId: getTenantId(event.data),
        type,
        action: getAction(String(event.type)),
        actorId: getActorId(event),
        targetId,
        metadata: {
            eventType: event.type,
            source: event.source,
            ts: event.ts,
            raw: event.data,
        },
    });
}
/**
 * 初始化事件集成：监听关键事件，自动写入 trace。
 * Initialize event integration: subscribe key events and auto-write trace logs.
 */
function initEventIntegration() {
    // 监听任务事件，记录任务生命周期。
    // Listen to task events and track task lifecycle.
    event_bus_1.eventBus.on('task.*', (event) => {
        const payload = event;
        addTrace(payload, 'task', payload.data?.taskId ?? payload.data?.id);
    });
    // 监听审批事件，记录审批流动作。
    // Listen to approval events and trace approval workflow.
    event_bus_1.eventBus.on('approval.*', (event) => {
        const payload = event;
        addTrace(payload, 'approval', payload.data?.approvalId ?? payload.data?.id);
    });
    // 监听消息事件，记录消息收发与状态变化。
    // Listen to message events and trace message lifecycle.
    event_bus_1.eventBus.on('msg.*', (event) => {
        const payload = event;
        addTrace(payload, 'message', payload.data?.messageId ?? payload.data?.id);
    });
    // 监听租户事件，归类为 system trace。
    // Listen to tenant events and store them as system traces.
    event_bus_1.eventBus.on('tenant.*', (event) => {
        const payload = event;
        addTrace(payload, 'system', payload.data?.id ?? payload.data?.tenantId);
    });
    // 监听组织事件。
    // Listen to organization events.
    event_bus_1.eventBus.on('org.*', (event) => {
        const payload = event;
        addTrace(payload, 'system', payload.data?.orgId ?? payload.data?.id);
    });
    // 监听成员事件。
    // Listen to member events.
    event_bus_1.eventBus.on('member.*', (event) => {
        const payload = event;
        addTrace(payload, 'system', payload.data?.memberId ?? payload.data?.id);
    });
    // 监听角色事件。
    // Listen to role events.
    event_bus_1.eventBus.on('role.*', (event) => {
        const payload = event;
        addTrace(payload, 'system', payload.data?.roleId ?? payload.data?.id);
    });
    // 监听 memory 事件，记录记忆写入/更新/删除。
    // Listen to memory events and trace memory changes.
    event_bus_1.eventBus.on('memory.*', (event) => {
        const payload = event;
        addTrace(payload, 'memory', payload.data?.memoryId ?? payload.data?.id);
    });
}
//# sourceMappingURL=event-integration.js.map