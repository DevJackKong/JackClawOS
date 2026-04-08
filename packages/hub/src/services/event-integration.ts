import { eventBus, HubEvents } from '../event-bus'
import { traceStore } from '../store/trace-store'

/**
 * 事件载荷的宽松结构。
 * Loose event payload shape used by integration layer.
 */
type IntegrationEventData = {
  tenantId?: string
  orgId?: string
  workspaceId?: string
  taskId?: string
  approvalId?: string
  messageId?: string
  traceId?: string
  memoryId?: string
  id?: string
  memberId?: string
  roleId?: string
  sourceId?: string
  targetId?: string
  actorId?: string
  userId?: string
  from?: string
  to?: string
  [key: string]: unknown
}

/**
 * EventBus 事件对象的本地类型。
 * Local event type for EventBus callbacks.
 */
type IntegrationEvent = {
  type: HubEvents
  data?: IntegrationEventData
  ts: number
  source?: string
}

/**
 * 从事件类型中提取动作名。
 * Extract action part from event type like task.created -> created.
 */
function getAction(type: string): string {
  const [, action = type] = type.split('.')
  return action
}

/**
 * 尝试从事件数据里提取 tenantId。
 * Best-effort tenant id extraction from event payload.
 */
function getTenantId(data?: IntegrationEventData): string {
  return data?.tenantId ?? ''
}

/**
 * 推断 actorId，尽量保留真实操作者。
 * Infer actor id with a stable fallback.
 */
function getActorId(event: IntegrationEvent): string {
  return event.data?.actorId
    ?? event.source
    ?? (typeof event.data?.from === 'string' ? event.data.from : undefined)
    ?? (typeof event.data?.userId === 'string' ? event.data.userId : undefined)
    ?? 'system'
}

/**
 * 从多种字段中推断 targetId。
 * Infer a target entity id from common payload fields.
 */
function getTargetId(data?: IntegrationEventData): string | undefined {
  return data?.targetId
    ?? data?.taskId
    ?? data?.approvalId
    ?? data?.messageId
    ?? data?.memoryId
    ?? data?.memberId
    ?? data?.roleId
    ?? data?.orgId
    ?? data?.workspaceId
    ?? data?.id
}

/**
 * 写入一条 trace。
 * Persist one trace entry for the incoming event.
 */
function addTrace(
  event: IntegrationEvent,
  type: 'message' | 'task' | 'approval' | 'memory' | 'system',
  targetId?: string,
): void {
  traceStore.add({
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
  })
}

/**
 * 初始化事件集成：监听关键事件，自动写入 trace。
 * Initialize event integration: subscribe key events and auto-write trace logs.
 */
export function initEventIntegration(): void {
  // 监听任务事件，记录任务生命周期。
  // Listen to task events and track task lifecycle.
  eventBus.on('task.*', (event) => {
    const payload = event as IntegrationEvent
    addTrace(payload, 'task', payload.data?.taskId ?? payload.data?.id)
  })

  // 监听审批事件，记录审批流动作。
  // Listen to approval events and trace approval workflow.
  eventBus.on('approval.*', (event) => {
    const payload = event as IntegrationEvent
    addTrace(payload, 'approval', payload.data?.approvalId ?? payload.data?.id)
  })

  // 监听消息事件，记录消息收发与状态变化。
  // Listen to message events and trace message lifecycle.
  eventBus.on('msg.*', (event) => {
    const payload = event as IntegrationEvent
    addTrace(payload, 'message', payload.data?.messageId ?? payload.data?.id)
  })

  // 监听租户事件，归类为 system trace。
  // Listen to tenant events and store them as system traces.
  eventBus.on('tenant.*', (event) => {
    const payload = event as IntegrationEvent
    addTrace(payload, 'system', payload.data?.id ?? payload.data?.tenantId)
  })

  // 监听组织事件。
  // Listen to organization events.
  eventBus.on('org.*', (event) => {
    const payload = event as IntegrationEvent
    addTrace(payload, 'system', payload.data?.orgId ?? payload.data?.id)
  })

  // 监听成员事件。
  // Listen to member events.
  eventBus.on('member.*', (event) => {
    const payload = event as IntegrationEvent
    addTrace(payload, 'system', payload.data?.memberId ?? payload.data?.id)
  })

  // 监听角色事件。
  // Listen to role events.
  eventBus.on('role.*', (event) => {
    const payload = event as IntegrationEvent
    addTrace(payload, 'system', payload.data?.roleId ?? payload.data?.id)
  })

  // 监听 memory 事件，记录记忆写入/更新/删除。
  // Listen to memory events and trace memory changes.
  eventBus.on('memory.*', (event) => {
    const payload = event as IntegrationEvent
    addTrace(payload, 'memory', payload.data?.memoryId ?? payload.data?.id)
  })
}
