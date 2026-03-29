import { z } from "zod";

import {
  intentRouterInputSchema,
  intentRouterOutputSchema,
  policyModeSchema,
  workflowTypeSchema
} from "./router.js";

export const planStepSchema = z.object({
  id: z.string(),
  title: z.string(),
  owner: z.enum(["system", "user"]),
  status: z.enum(["pending", "ready", "blocked"]),
  description: z.string()
});

export const demoPlanSchema = z.object({
  planId: z.string(),
  workflowType: workflowTypeSchema,
  summary: z.string(),
  doneCriteria: z.array(z.string()),
  expectedArtifacts: z.array(z.string()),
  steps: z.array(planStepSchema)
});

export const decisionSummarySchema = z.object({
  headline: z.string(),
  operatorView: z.string(),
  recommendedNextMove: z.string()
});

export const chatMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1),
  timestamp: z.string(),
  runId: z.string().optional()
});

export const taskListStatusSchema = z.enum(["pending", "in_progress", "done", "cancelled"]);

export const taskListSourceSchema = z.enum(["plan", "manual", "chat"]);

export const taskListItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  detail: z.string(),
  status: taskListStatusSchema,
  source: taskListSourceSchema,
  startAt: z.string(),
  endAt: z.string(),
  createdAt: z.string(),
  updatedAt: z.string()
});

export const socialEventStatusSchema = z.enum(["planned", "done", "cancelled"]);

export const socialEventSchema = z.object({
  id: z.string(),
  title: z.string(),
  detail: z.string(),
  location: z.string(),
  startAt: z.string(),
  endAt: z.string(),
  remindMinutes: z.number().int().nonnegative(),
  status: socialEventStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string()
});

export const inspirationNoteSchema = z.object({
  id: z.string(),
  title: z.string(),
  content: z.string(),
  source: z.string(),
  tag: z.string(),
  createdAt: z.string(),
  updatedAt: z.string()
});

export const taskCommandEffectSchema = z.object({
  action: z.enum(["added", "updated", "deleted", "none"]),
  summary: z.string(),
  taskId: z.string().optional()
});

export const briefingItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  summary: z.string(),
  source: z.string(),
  url: z.string().url(),
  publishedAt: z.string(),
  badge: z.string().optional()
});

export const dashboardBriefingSchema = z.object({
  refreshedAt: z.string(),
  hotspots: z.object({
    social: z.array(briefingItemSchema),
    news: z.array(briefingItemSchema)
  }),
  aiColumn: z.object({
    github: z.array(briefingItemSchema),
    research: z.array(briefingItemSchema),
    funding: z.array(briefingItemSchema)
  })
});

export const cockpitAgentStatusSchema = z.enum(["ready", "thinking", "waiting_user", "blocked"]);

export const cockpitTaskSchema = z.object({
  id: z.string(),
  title: z.string(),
  detail: z.string(),
  owner: z.enum(["agent", "user"]),
  status: z.enum(["pending", "active", "blocked", "done"]),
  source: z.enum(["plan", "agent", "manual"])
});

export const cockpitExecutionLogSchema = z.object({
  id: z.string(),
  timestamp: z.string(),
  label: z.string(),
  detail: z.string(),
  tone: z.enum(["neutral", "good", "warn", "risk"])
});

export const cockpitPriorityActionSchema = z.object({
  id: z.string(),
  title: z.string(),
  detail: z.string(),
  urgency: z.enum(["high", "normal"])
});

export const cockpitWorkflowCardSchema = z.object({
  workflowType: workflowTypeSchema,
  title: z.string(),
  description: z.string(),
  count: z.number().int().nonnegative(),
  active: z.boolean()
});

export const cockpitSignalSchema = z.object({
  id: z.string(),
  title: z.string(),
  detail: z.string(),
  source: z.string(),
  badge: z.string().optional(),
  tone: z.enum(["neutral", "good", "warn", "risk"])
});

export const cockpitMemoryItemSchema = z.object({
  id: z.string(),
  label: z.string(),
  detail: z.string(),
  type: z.enum(["person", "company", "project", "run", "signal"]),
  meta: z.string()
});

export const cockpitStateSchema = z.object({
  agentStatus: cockpitAgentStatusSchema,
  statusLine: z.string(),
  suggestedPrompts: z.array(z.string()).max(4),
  workflows: z.array(cockpitWorkflowCardSchema),
  priorityActions: z.array(cockpitPriorityActionSchema),
  tasks: z.array(cockpitTaskSchema),
  executionLog: z.array(cockpitExecutionLogSchema),
  intelligenceSignals: z.array(cockpitSignalSchema),
  memoryItems: z.array(cockpitMemoryItemSchema)
});

export const submitCommandRequestSchema = intentRouterInputSchema.pick({
  commandText: true,
  policyMode: true,
  workspaceId: true,
  projectId: true,
  locale: true,
  timezone: true
}).extend({
  attachments: intentRouterInputSchema.shape.attachments.optional(),
  conversation: z.array(chatMessageSchema).max(12).optional()
});

export const submitCommandResponseSchema = z.object({
  runId: z.string(),
  receivedAt: z.string(),
  input: submitCommandRequestSchema.extend({
    commandId: z.string(),
    submittedAt: z.string()
  }),
  route: intentRouterOutputSchema,
  plan: demoPlanSchema,
  decisionSummary: decisionSummarySchema,
  assistantReply: z.string().optional(),
  conversation: z.array(chatMessageSchema).optional(),
  cockpit: cockpitStateSchema,
  tasks: z.array(taskListItemSchema),
  socialEvents: z.array(socialEventSchema),
  inspirationNotes: z.array(inspirationNoteSchema),
  dashboard: dashboardBriefingSchema,
  taskCommandEffect: taskCommandEffectSchema.optional()
});

export const runHistoryEntrySchema = z.object({
  runId: z.string(),
  commandId: z.string(),
  commandText: z.string(),
  policyMode: policyModeSchema,
  locale: z.string().optional(),
  receivedAt: z.string(),
  workflowType: workflowTypeSchema,
  routeStatus: z.enum(["routed", "needs_clarification", "manual_review", "blocked"]),
  riskLevel: z.enum(["low", "medium", "high", "critical"]),
  urgency: z.enum(["low", "normal", "high", "immediate"]),
  headline: z.string(),
  nextActionSummary: z.string()
});

export const listRunsResponseSchema = z.object({
  runs: z.array(runHistoryEntrySchema)
});

export const listTasksResponseSchema = z.object({
  tasks: z.array(taskListItemSchema)
});

export const listSocialEventsResponseSchema = z.object({
  socialEvents: z.array(socialEventSchema)
});

export const listInspirationNotesResponseSchema = z.object({
  inspirationNotes: z.array(inspirationNoteSchema)
});

export const consoleBootstrapResponseSchema = z.object({
  latestRunId: z.string().optional(),
  history: z.array(runHistoryEntrySchema),
  cockpit: cockpitStateSchema,
  tasks: z.array(taskListItemSchema),
  socialEvents: z.array(socialEventSchema),
  inspirationNotes: z.array(inspirationNoteSchema),
  dashboard: dashboardBriefingSchema
});

export type PlanStep = z.infer<typeof planStepSchema>;
export type DemoPlan = z.infer<typeof demoPlanSchema>;
export type DecisionSummary = z.infer<typeof decisionSummarySchema>;
export type ChatMessage = z.infer<typeof chatMessageSchema>;
export type TaskListStatus = z.infer<typeof taskListStatusSchema>;
export type TaskListSource = z.infer<typeof taskListSourceSchema>;
export type TaskListItem = z.infer<typeof taskListItemSchema>;
export type SocialEventStatus = z.infer<typeof socialEventStatusSchema>;
export type SocialEvent = z.infer<typeof socialEventSchema>;
export type InspirationNote = z.infer<typeof inspirationNoteSchema>;
export type TaskCommandEffect = z.infer<typeof taskCommandEffectSchema>;
export type BriefingItem = z.infer<typeof briefingItemSchema>;
export type DashboardBriefing = z.infer<typeof dashboardBriefingSchema>;
export type CockpitAgentStatus = z.infer<typeof cockpitAgentStatusSchema>;
export type CockpitTask = z.infer<typeof cockpitTaskSchema>;
export type CockpitExecutionLog = z.infer<typeof cockpitExecutionLogSchema>;
export type CockpitPriorityAction = z.infer<typeof cockpitPriorityActionSchema>;
export type CockpitWorkflowCard = z.infer<typeof cockpitWorkflowCardSchema>;
export type CockpitSignal = z.infer<typeof cockpitSignalSchema>;
export type CockpitMemoryItem = z.infer<typeof cockpitMemoryItemSchema>;
export type CockpitState = z.infer<typeof cockpitStateSchema>;
export type SubmitCommandRequest = z.infer<typeof submitCommandRequestSchema>;
export type SubmitCommandResponse = z.infer<typeof submitCommandResponseSchema>;
export type RunHistoryEntry = z.infer<typeof runHistoryEntrySchema>;
export type ListRunsResponse = z.infer<typeof listRunsResponseSchema>;
export type ListTasksResponse = z.infer<typeof listTasksResponseSchema>;
export type ListSocialEventsResponse = z.infer<typeof listSocialEventsResponseSchema>;
export type ListInspirationNotesResponse = z.infer<typeof listInspirationNotesResponseSchema>;
export type ConsoleBootstrapResponse = z.infer<typeof consoleBootstrapResponseSchema>;
