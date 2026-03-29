import { z } from "zod";

export const workflowTypeSchema = z.enum([
  "chat",
  "meeting",
  "deal",
  "content",
  "unknown",
  "unsupported"
]);

export const policyModeSchema = z.enum(["economy", "balanced", "executive"]);

export const routerAttachmentSchema = z.object({
  attachmentId: z.string(),
  type: z.enum(["file", "image", "link", "note"]),
  name: z.string(),
  mimeType: z.string().optional(),
  url: z.string().url().optional()
});

export const routerUserContextSchema = z.object({
  role: z.string().optional(),
  companyId: z.string().optional(),
  activeEntityIds: z.array(z.string()).optional(),
  recentWorkflowTypes: z.array(z.enum(["meeting", "deal", "content"])).optional()
});

export const intentRouterInputSchema = z.object({
  commandId: z.string(),
  commandText: z.string().min(1),
  submittedAt: z.string(),
  workspaceId: z.string().optional(),
  projectId: z.string().optional(),
  userId: z.string().optional(),
  policyMode: policyModeSchema.default("balanced"),
  locale: z.string().optional(),
  timezone: z.string().optional(),
  attachments: z.array(routerAttachmentSchema).optional(),
  userContext: routerUserContextSchema.optional()
});

export const routeStatusSchema = z.enum([
  "routed",
  "needs_clarification",
  "manual_review",
  "blocked"
]);

export const requiredInputSchema = z.object({
  key: z.string(),
  label: z.string(),
  reason: z.string(),
  severity: z.enum(["blocking", "important", "optional"])
});

export const detectedEntityRefSchema = z.object({
  entityType: z.enum(["person", "company", "meeting", "deal", "content", "project"]),
  entityId: z.string().optional(),
  displayName: z.string(),
  confidence: z.number().min(0).max(1)
});

export const riskLevelSchema = z.enum(["low", "medium", "high", "critical"]);

export const urgencyLevelSchema = z.enum(["low", "normal", "high", "immediate"]);

export const approvalReasonCodeSchema = z.enum([
  "high_risk_task",
  "critical_risk_task",
  "external_publish",
  "insufficient_context",
  "budget_or_cost_exposure",
  "legal_or_compliance_exposure",
  "reputation_exposure",
  "executive_recommendation",
  "ambiguous_intent"
]);

export const approvalStageSchema = z.enum([
  "none",
  "before_planning",
  "before_execution",
  "before_external_action",
  "before_artifact_release"
]);

export const approvalHintSchema = z.object({
  expected: z.boolean(),
  stage: approvalStageSchema,
  reasonCodes: z.array(approvalReasonCodeSchema),
  summary: z.string()
});

export const fallbackModeSchema = z.enum([
  "none",
  "clarify_and_retry",
  "route_to_manual_review",
  "safe_brief_only",
  "block_and_explain"
]);

export const fallbackStrategySchema = z.object({
  mode: fallbackModeSchema,
  reason: z.string(),
  requiredUserInput: z.array(z.string()),
  safeDefaultWorkflow: z.enum(["chat", "meeting", "deal", "content"]).optional()
});

export const candidateWorkflowSchema = z.object({
  workflowType: workflowTypeSchema,
  confidence: z.number().min(0).max(1),
  reason: z.string()
});

export const routerNextActionSchema = z.object({
  type: z.enum([
    "send_to_planner",
    "ask_user_clarification",
    "request_plan_approval",
    "request_manual_review",
    "block_run"
  ]),
  summary: z.string()
});

export const intentRouterOutputSchema = z.object({
  routeId: z.string(),
  commandId: z.string(),
  routeStatus: routeStatusSchema,
  workflowType: workflowTypeSchema,
  intentLabel: z.string(),
  confidence: z.number().min(0).max(1),
  rationale: z.string(),
  requiredInputs: z.array(requiredInputSchema),
  detectedEntities: z.array(detectedEntityRefSchema),
  riskLevel: riskLevelSchema,
  urgency: urgencyLevelSchema,
  approvalHint: approvalHintSchema,
  fallbackStrategy: fallbackStrategySchema,
  candidateWorkflows: z.array(candidateWorkflowSchema),
  nextAction: routerNextActionSchema
});

export type WorkflowType = z.infer<typeof workflowTypeSchema>;
export type PolicyMode = z.infer<typeof policyModeSchema>;
export type IntentRouterInput = z.infer<typeof intentRouterInputSchema>;
export type RouteStatus = z.infer<typeof routeStatusSchema>;
export type RequiredInput = z.infer<typeof requiredInputSchema>;
export type DetectedEntityRef = z.infer<typeof detectedEntityRefSchema>;
export type RiskLevel = z.infer<typeof riskLevelSchema>;
export type UrgencyLevel = z.infer<typeof urgencyLevelSchema>;
export type ApprovalHint = z.infer<typeof approvalHintSchema>;
export type ApprovalReasonCode = z.infer<typeof approvalReasonCodeSchema>;
export type FallbackStrategy = z.infer<typeof fallbackStrategySchema>;
export type CandidateWorkflow = z.infer<typeof candidateWorkflowSchema>;
export type RouterNextAction = z.infer<typeof routerNextActionSchema>;
export type IntentRouterOutput = z.infer<typeof intentRouterOutputSchema>;
