# BossAssistant Intent Router Contract v1

Status: Draft v1  
Date: 2026-03-29  
Owner: BossAssistant  
Depends on:

- `docs/product/bossassistant-product-principles-ia-v2.md`
- `docs/architecture/bossassistant-technical-architecture-spec-v2.md`

## 1. Purpose

This document defines the first formal contract for the BossAssistant Intent Router.

The Intent Router is the first typed decision point after command intake. Its job is to turn a single executive command into a workflow-ready routing result that the Planner, Approval Engine, and Dashboard can all rely on.

The contract must support:

- single-entry command submission
- workflow-first routing
- explicit uncertainty handling
- human-gated escalation for high-stakes work
- model-agnostic implementation
- open-source-friendly typed schemas

## 2. V1 Scope

The router in v1 only needs to classify commands into the three product-first workflows:

- `meeting`
- `deal`
- `content`

The contract must also handle commands that are not yet safe to route directly. For that reason, v1 includes:

- `unknown` for low-confidence or ambiguous commands
- `unsupported` for requests outside the current workflow scope

## 3. Router Responsibilities

The Intent Router must:

1. classify the command into a workflow domain
2. estimate routing confidence
3. detect missing inputs required for planning
4. assign `riskLevel`
5. assign `urgency`
6. generate an `approvalHint`
7. produce a deterministic `fallbackStrategy` when routing is weak or unsafe

The Intent Router must not:

- create a full execution plan
- perform workflow execution
- decide final approval outcomes
- write stable memory directly

## 4. Contract Shape

Naming convention for v1 shared contracts:

- use `camelCase` in TypeScript types and JSON payloads
- keep enum values lowercase with underscores only where readability benefits from it
- avoid maintaining separate API naming styles at this stage

### 4.1 Input Contract

```ts
type WorkflowType = "meeting" | "deal" | "content" | "unknown" | "unsupported";
type PolicyMode = "economy" | "balanced" | "executive";

interface IntentRouterInput {
  commandId: string;
  commandText: string;
  submittedAt: string;
  workspaceId?: string;
  projectId?: string;
  userId?: string;
  policyMode: PolicyMode;
  locale?: string;
  timezone?: string;
  attachments?: RouterAttachment[];
  userContext?: RouterUserContext;
}

interface RouterAttachment {
  attachmentId: string;
  type: "file" | "image" | "link" | "note";
  name: string;
  mimeType?: string;
  url?: string;
}

interface RouterUserContext {
  role?: string;
  companyId?: string;
  activeEntityIds?: string[];
  recentWorkflowTypes?: Array<"meeting" | "deal" | "content">;
}
```

### 4.2 Output Contract

```ts
type RouteStatus = "routed" | "needs_clarification" | "manual_review" | "blocked";

interface IntentRouterOutput {
  routeId: string;
  commandId: string;
  routeStatus: RouteStatus;
  workflowType: WorkflowType;
  intentLabel: string;
  confidence: number;
  rationale: string;
  requiredInputs: RequiredInput[];
  detectedEntities: DetectedEntityRef[];
  riskLevel: RiskLevel;
  urgency: UrgencyLevel;
  approvalHint: ApprovalHint;
  fallbackStrategy: FallbackStrategy;
  candidateWorkflows: CandidateWorkflow[];
  nextAction: RouterNextAction;
}

interface RequiredInput {
  key: string;
  label: string;
  reason: string;
  severity: "blocking" | "important" | "optional";
}

interface DetectedEntityRef {
  entityType: "person" | "company" | "meeting" | "deal" | "content" | "project";
  entityId?: string;
  displayName: string;
  confidence: number;
}

interface CandidateWorkflow {
  workflowType: WorkflowType;
  confidence: number;
  reason: string;
}

interface RouterNextAction {
  type:
    | "send_to_planner"
    | "ask_user_clarification"
    | "request_plan_approval"
    | "request_manual_review"
    | "block_run";
  summary: string;
}
```

## 5. Field Definitions

### 5.1 `workflowType`

`workflowType` is the router's primary workflow classification.

Allowed values:

- `meeting`: command is mainly about meeting preparation, participant analysis, agenda, notes, follow-up, or meeting decision support
- `deal`: command is mainly about investment, transaction, diligence, risk analysis, recommendation, or proceed/pause/no-go assessment
- `content`: command is mainly about drafting, rewriting, positioning, internal/external messaging, or publishability review
- `unknown`: command may belong to a supported workflow, but the router cannot safely decide yet
- `unsupported`: command is outside the v1 workflow boundary

### 5.2 `confidence`

`confidence` is a normalized score from `0` to `1` describing how safe direct routing is.

Recommended thresholds:

- `>= 0.75`: direct route allowed
- `0.45 - 0.74`: weak route, use clarification fallback
- `< 0.45`: do not route directly

### 5.3 `requiredInputs`

`requiredInputs` lists missing information that the Planner or executor would likely need.

Typical examples:

- meeting date or attendees missing for `meeting`
- deal target, stage, or materials missing for `deal`
- audience, platform, or publishing goal missing for `content`

### 5.4 `riskLevel`

`riskLevel` represents expected operational and decision risk at routing time, before execution.

```ts
type RiskLevel = "low" | "medium" | "high" | "critical";
```

Definitions:

- `low`: low consequence if misrouted or executed with limited review; mostly internal drafting or summarization
- `medium`: meaningful business impact or moderate ambiguity; review is recommended before external use
- `high`: material business, legal, financial, reputational, or executive decision impact; approval gate should be expected
- `critical`: potentially irreversible, highly sensitive, or high-liability task; human review is required before meaningful execution continues

Routing heuristics:

- default `meeting` commands start at `medium`
- default `deal` commands start at `high`
- default `content` commands start at `medium`
- any external publication, legal sensitivity, fund movement, board-level recommendation, or reputational exposure raises risk by at least one level
- insufficient facts plus high-stakes intent should bias upward, not downward

### 5.5 `urgency`

`urgency` represents time sensitivity inferred from the command and context.

```ts
type UrgencyLevel = "low" | "normal" | "high" | "immediate";
```

Definitions:

- `low`: no concrete deadline detected
- `normal`: standard operating priority
- `high`: time-sensitive within the current business cycle, day, or near-term event
- `immediate`: active deadline, ongoing event, imminent meeting/publication, or urgent executive decision

Routing heuristics:

- phrases like "today", "tonight", "before the meeting", "now", "ASAP", "in 1 hour" raise urgency
- calendar-linked meeting preparation should be at least `high` when the meeting is within 24 hours
- urgency must not suppress approval or compliance gates

### 5.6 `approvalHint`

`approvalHint` communicates whether the system should expect a human gate soon, and why.

```ts
type ApprovalStage =
  | "none"
  | "before_planning"
  | "before_execution"
  | "before_external_action"
  | "before_artifact_release";

interface ApprovalHint {
  expected: boolean;
  stage: ApprovalStage;
  reasonCodes: ApprovalReasonCode[];
  summary: string;
}

type ApprovalReasonCode =
  | "high_risk_task"
  | "critical_risk_task"
  | "external_publish"
  | "insufficient_context"
  | "budget_or_cost_exposure"
  | "legal_or_compliance_exposure"
  | "reputation_exposure"
  | "executive_recommendation"
  | "ambiguous_intent";
```

Definitions:

- `expected = false` only when the task is low-risk enough to continue through planning without an immediate human gate
- `before_planning` is used when the command itself is high-stakes or ambiguous enough that even plan generation should pause
- `before_execution` is used when planning can proceed but step execution should not
- `before_external_action` is used when outputs may trigger external publication, sending, filing, or other outward-facing action
- `before_artifact_release` is used when the system can draft safely, but artifact delivery or acceptance must pause

V1 rule of thumb:

- `deal` with recommendation intent should default to `expected = true`
- `content` intended for external publication should default to `before_artifact_release` or `before_external_action`
- `unknown` or `critical` routes should never return `stage = "none"`

## 6. Fallback Strategy

`fallbackStrategy` defines what the harness must do when routing is weak, ambiguous, unsupported, or unsafe.

```ts
type FallbackMode =
  | "none"
  | "clarify_and_retry"
  | "route_to_manual_review"
  | "safe_brief_only"
  | "block_and_explain";

interface FallbackStrategy {
  mode: FallbackMode;
  reason: string;
  requiredUserInput: string[];
  safeDefaultWorkflow?: "meeting" | "deal" | "content";
}
```

Definitions:

- `none`: router is confident enough to proceed normally
- `clarify_and_retry`: ask a targeted clarification, then rerun router before planning
- `route_to_manual_review`: create a human review item because classification or stakes are too sensitive to guess
- `safe_brief_only`: permit a constrained information-gathering or summarization path, but do not enter full workflow execution
- `block_and_explain`: stop and explain that the request is out of scope or unsafe

Deterministic fallback rules:

1. If `confidence >= 0.75` and `riskLevel` is not `critical`, use `mode = "none"`.
2. If `workflowType = "unknown"` and there are plausible candidate workflows, use `mode = "clarify_and_retry"`.
3. If `workflowType = "unsupported"`, use `mode = "block_and_explain"`.
4. If `riskLevel = "critical"`, prefer `route_to_manual_review` even if a candidate workflow exists.
5. If the command is useful for context gathering but unsafe for autonomous execution, use `safe_brief_only`.

Recommended clarification style:

- ask for missing business variable, not generic restatement
- ask one decisive question when possible
- preserve top candidate workflows so the user sees what the system is considering

Example clarification prompts:

- `meeting`: "Which meeting is this for, and when does it happen?"
- `deal`: "Which company or transaction is this about, and do you want diligence, recommendation, or risk review?"
- `content`: "Who is the audience and where will this be published?"

## 7. Suggested Routing Logic

Recommended router decision order:

1. detect supported workflow cues
2. detect explicit high-stakes signals
3. extract missing key inputs
4. score confidence
5. assign `riskLevel`
6. assign `urgency`
7. assign `approvalHint`
8. compute `fallbackStrategy`
9. set `nextAction`

This keeps risk and approval derived from the routed intent instead of treating them as unrelated metadata.

## 8. Example Outputs

### 8.1 Strong Meeting Route

```json
{
  "routeId": "route_001",
  "commandId": "cmd_001",
  "routeStatus": "routed",
  "workflowType": "meeting",
  "intentLabel": "prepare_board_meeting_brief",
  "confidence": 0.89,
  "rationale": "The command asks for a board meeting brief, agenda priorities, and participant-specific questions.",
  "requiredInputs": [],
  "detectedEntities": [
    {
      "entityType": "meeting",
      "displayName": "Board Meeting",
      "confidence": 0.86
    }
  ],
  "riskLevel": "high",
  "urgency": "high",
  "approvalHint": {
    "expected": true,
    "stage": "before_artifact_release",
    "reasonCodes": ["executive_recommendation"],
    "summary": "Board-facing material should be reviewed before release."
  },
  "fallbackStrategy": {
    "mode": "none",
    "reason": "Workflow classification is strong.",
    "requiredUserInput": []
  },
  "candidateWorkflows": [
    {
      "workflowType": "meeting",
      "confidence": 0.89,
      "reason": "Strong meeting preparation intent."
    }
  ],
  "nextAction": {
    "type": "send_to_planner",
    "summary": "Build a meeting preparation plan."
  }
}
```

### 8.2 Weak Route Requiring Clarification

```json
{
  "routeId": "route_002",
  "commandId": "cmd_002",
  "routeStatus": "needs_clarification",
  "workflowType": "unknown",
  "intentLabel": "analyze_and_prepare",
  "confidence": 0.58,
  "rationale": "The command suggests either a meeting prep workflow or a deal review workflow, but lacks the target object.",
  "requiredInputs": [
    {
      "key": "target_object",
      "label": "Target object",
      "reason": "The system cannot tell whether the request concerns a meeting, company, or transaction.",
      "severity": "blocking"
    }
  ],
  "detectedEntities": [],
  "riskLevel": "high",
  "urgency": "normal",
  "approvalHint": {
    "expected": true,
    "stage": "before_planning",
    "reasonCodes": ["ambiguous_intent", "high_risk_task"],
    "summary": "The task appears high-stakes but is not specific enough for safe routing."
  },
  "fallbackStrategy": {
    "mode": "clarify_and_retry",
    "reason": "Two supported workflows remain plausible.",
    "requiredUserInput": [
      "What is the target object: a meeting, a deal, or content to publish?"
    ]
  },
  "candidateWorkflows": [
    {
      "workflowType": "meeting",
      "confidence": 0.58,
      "reason": "Preparation language suggests a meeting brief."
    },
    {
      "workflowType": "deal",
      "confidence": 0.54,
      "reason": "Analysis language suggests transaction review."
    }
  ],
  "nextAction": {
    "type": "ask_user_clarification",
    "summary": "Ask one decisive question before planning."
  }
}
```

## 9. Implementation Notes

Recommended package targets:

- runtime schema: `packages/contracts/src/router.ts`
- contract tests: `packages/contracts/test/router.test.ts` *(not yet created)*
- router fixtures: `packages/contracts/fixtures/intent-router/`

Recommended validation approach:

- define runtime-safe enums with `Zod`
- export inferred TypeScript types
- keep threshold values configurable in router policy, not hardcoded in UI

## 10. Acceptance Criteria For v1

Intent Router Contract v1 is acceptable when:

1. every command returns a typed `workflowType`
2. weak routing always returns an explicit `fallbackStrategy`
3. `riskLevel`, `urgency`, and `approvalHint` are always populated
4. `unknown` and `unsupported` are handled without silent failure
5. Planner can consume the result without needing raw prompt text interpretation
6. Dashboard can display route status, risk, urgency, and approval expectation directly from this contract
