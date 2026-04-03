# JackClaw OS — Technical Architecture Spec v2

Status: Draft v2  
Date: 2026-03-29  
Owner: JackClaw OS

## 1. Purpose

This document defines the technical architecture for JackClaw OS v2.

It translates the approved product direction into an implementation-oriented system design that is:

- workflow-first
- model-agnostic
- open-source friendly
- maintainable by a small team
- extensible beyond a demo project

## 2. System Summary

JackClaw OS is an agent operating system that turns a single natural-language command into a controlled execution pipeline.

The system must:

- classify the task
- build context
- generate a plan
- execute subtasks
- evaluate outputs
- run compliance checks
- pause for approval where needed
- write memory back
- project final state to the dashboard

## 3. Architectural Principles

### 3.1 Contract First

All major modules communicate through explicit contracts and typed payloads.

### 3.2 Workflow First

Execution logic is organized by workflow domain, not by generic chat messages.

### 3.3 Adapter Based Runtime

Model providers and execution runtimes sit behind adapters. Product logic must not depend on one provider.

### 3.4 Human Approval As A System Primitive

Approval states are not UI hacks. They are first-class orchestration states.

### 3.5 Structured Memory Over Raw Transcript Reliance

System continuity should come from structured memory plus selected transcript slices, not from endlessly growing chat history.

### 3.6 Progressive Complexity

Start with simple composable orchestration patterns and only add more autonomy where it measurably improves outcomes.

This aligns with Anthropic's guidance in `Building effective agents`.

## 4. Recommended Tech Stack

Primary language:

- `TypeScript`

Recommended stack:

- `React + TypeScript + Vite` for web
- `Node.js + TypeScript` for API and orchestration
- `SQLite` for v1/v2 persistence
- `Zod` or JSON Schema for contracts
- `Vitest` for unit and contract tests
- `Playwright` for end-to-end workflow tests

Rationale:

- one language across client and server
- strong typing for contracts
- low onboarding cost for open-source contributors
- natural fit with existing Node-based local execution tools

## 5. Monorepo Layout

Recommended structure:

```text
bossassistant/
├── apps/
│   ├── web/
│   └── api/
├── packages/
│   ├── contracts/
│   ├── harness/
│   ├── workflows/
│   ├── memory/
│   ├── compliance/
│   ├── runtime/
│   ├── model-policy/
│   └── ui/
├── docs/
│   ├── product/
│   ├── architecture/
│   ├── workflows/
│   └── adr/
└── scripts/
```

## 6. High-Level System Modules

JackClaw OS consists of the following runtime modules:

- Input Intake
- Intent Router
- Context Builder
- Planner
- Workflow Executors
- Evaluator
- Compliance Guard
- Loop Controller
- Approval Engine
- Artifact Builder
- Memory Layer
- Dashboard Projector
- Runtime Adapter Layer
- Model Policy Engine

## 7. Execution Flow

Primary execution path:

1. User submits a command
2. Intake service creates a task run
3. Intent Router classifies the request
4. Context Builder retrieves relevant memory and workspace context
5. Planner generates an execution plan and done criteria
6. Approval Engine decides whether planning needs human confirmation
7. Workflow Executor runs subtasks
8. Evaluator scores completeness and quality
9. Compliance Guard checks risk and policy concerns
10. Loop Controller decides pass, retry, revise, escalate, or block
11. Artifact Builder produces decision-ready outputs
12. Memory Layer writes back stable facts and artifacts
13. Dashboard Projector updates executive views

## 8. Anthropic Pattern Mapping

JackClaw OS uses a combination of agentic patterns described by Anthropic.

### 8.1 Routing

Used by:

- Intent Router
- model policy selection
- risk-based escalation

### 8.2 Orchestrator-Workers

Used by:

- Planner
- workflow-specific executor dispatch
- parallel subtasks where applicable

### 8.3 Evaluator-Optimizer

Used by:

- Evaluator
- Compliance Guard
- Loop Controller

### 8.4 Augmented LLM

Used by:

- retrieval
- memory
- tools
- runtime adapters

JackClaw OS should not begin with full open-ended autonomy. It should begin with controlled workflows that can adopt more autonomy over time.

## 9. Domain Model

### 9.1 Core Runtime Objects

- `Command`
- `TaskRun`
- `Plan`
- `PlanStep`
- `WorkflowRun`
- `Artifact`
- `ApprovalRequest`
- `RiskSignal`
- `MemoryEntity`
- `ExecutionEvent`

### 9.2 Workflow Types

Supported first-class workflows in v2:

- `meeting`
- `deal`
- `content`

Reserved future workflow types:

- `project`
- `ppt`
- `intelligence`

## 10. Contracts

All of the following contracts should live in `packages/contracts`.

### 10.1 Intent Router Contract

Input:

- command text
- current workspace or project
- user context
- optional attachments

Output:

- workflow type
- confidence score
- required inputs
- risk level
- urgency
- fallback route if classification is weak

### 10.2 Planner Contract

Input:

- routed workflow type
- normalized task context
- retrieved memory
- user policy mode

Output:

- plan id
- ordered steps
- dependencies
- done criteria
- approval gates
- expected artifacts
- execution hints

### 10.3 Executor Contract

Input:

- workflow type
- plan step
- current context bundle
- runtime policy

Output:

- status
- generated artifact fragments
- evidence
- tool usage log
- unresolved blockers

### 10.4 Evaluator Contract

Input:

- workflow type
- artifact output
- done criteria
- plan expectations

Output:

- pass/fail
- score
- defects
- revision instructions

### 10.5 Compliance Guard Contract

Input:

- workflow type
- artifact
- execution metadata
- policy rules

Output:

- pass/fail
- risk signals
- severity
- approval required flag
- mandatory revision notes

### 10.6 Memory Write-back Contract

Input:

- completed run
- approved artifacts
- extracted entities
- confidence thresholds

Output:

- inserted entities
- updated entities
- skipped uncertain facts
- linked artifacts

## 11. API Surface

Recommended API groups:

- `/api/console/*`
- `/api/tasks/*`
- `/api/workflows/*`
- `/api/memory/*`
- `/api/dashboard/*`
- `/api/runtime/*`
- `/api/admin/*`

Representative endpoints:

- `POST /api/console/submit`
- `GET /api/tasks/:taskId`
- `POST /api/tasks/:taskId/approve`
- `POST /api/tasks/:taskId/revise`
- `GET /api/dashboard/home`
- `GET /api/memory/search`
- `GET /api/runtime/status`
- `GET /api/runtime/models`
- `POST /api/runtime/policy`

## 12. Frontend Architecture

The web app should be divided into:

- executive surfaces
- workflow surfaces
- supporting operational views

Recommended feature slices:

- `home`
- `command-console`
- `workflow-runs`
- `approvals`
- `risk`
- `memory`
- `artifacts`
- `workspaces`
- `runtime`

The frontend should consume typed API clients generated from shared contracts when practical.

## 13. Harness Architecture

The harness is the orchestration core.

### 13.1 Harness Responsibilities

- track task state
- coordinate module ordering
- maintain execution events
- invoke runtime adapters
- manage approval pauses
- manage retries and escalations

### 13.2 Harness States

Suggested run states:

- `created`
- `routing`
- `planning`
- `awaiting_plan_approval`
- `executing`
- `evaluating`
- `compliance_check`
- `awaiting_artifact_approval`
- `retrying`
- `blocked`
- `completed`
- `failed`
- `cancelled`

### 13.3 Harness Event Log

Every task run should emit immutable events such as:

- command received
- workflow classified
- plan generated
- step started
- step completed
- evaluation failed
- compliance flagged
- approval requested
- approval granted
- memory written
- run completed

This event log powers the dashboard and auditability.

## 14. Workflow Executor Design

Each workflow should own:

- input normalizer
- context builder extension
- planner prompt/spec extension
- executor implementation
- evaluator rubric
- compliance rules
- artifact formatter

Recommended package layout:

```text
packages/workflows/
├── meeting/
├── deal/
└── content/
```

Each workflow directory should contain:

- `contract.ts`
- `planner.ts`
- `executor.ts`
- `evaluator.ts`
- `compliance.ts`
- `artifacts.ts`

## 15. Runtime Adapter Layer

JackClaw OS must support multiple runtimes without rewriting orchestration logic.

### 15.1 Adapter Interface

Each runtime adapter should expose:

- `listModels()`
- `executeStep()`
- `countTokens()`
- `supportsTools()`
- `supportsStructuredOutput()`
- `supportsLongContext()`
- `healthCheck()`

### 15.2 Initial Adapters

- `openai`
- `anthropic`
- `google`
- `codex`

### 15.3 Adapter Boundary

Workflow code should not directly call provider SDKs. It should call the runtime adapter interface.

## 16. Model Policy Engine

The Model Policy Engine selects runtime + model + reasoning profile per stage.

### 16.1 Policy Dimensions

- task complexity
- token size
- workflow type
- risk severity
- approval proximity
- latency tolerance
- user policy mode

### 16.2 User-Facing Modes

- `economy`
- `balanced`
- `executive`

### 16.3 Internal Role Mapping

- `router_model`
- `planner_model`
- `executor_model`
- `evaluator_model`
- `compliance_model`

### 16.4 Policy Requirements

- deterministic fallback rules
- provider failover where practical
- explicit logging of chosen runtime path

## 17. Memory Architecture

Memory should be implemented as structured storage, not transcript dumping.

### 17.1 Memory Layers

- `working_memory`
- `project_memory`
- `executive_memory`

### 17.2 Core Entities

- `people`
- `companies`
- `meetings`
- `deals`
- `decisions`
- `contents`
- `preferences`
- `projects`
- `artifacts`
- `risks`

### 17.3 Memory Write Rules

- only write stable facts automatically
- separate fact from inference
- mark confidence and provenance
- distinguish draft outputs from approved outputs

### 17.4 Retrieval Rules

Context Builder should retrieve:

- direct entity matches
- related project context
- recent approved artifacts
- recent unresolved risks
- executive preferences relevant to the workflow

## 18. Persistence Model

SQLite is acceptable for v2 if schema is explicit and migration-ready.

Suggested tables:

- `task_runs`
- `task_events`
- `plans`
- `plan_steps`
- `workflow_runs`
- `approval_requests`
- `artifacts`
- `risk_signals`
- `people`
- `companies`
- `meetings`
- `deals`
- `decisions`
- `contents`
- `preferences`
- `entity_links`

## 19. Approval Engine

Approvals should be first-class persisted objects.

Each approval request should include:

- request id
- task id
- approval type
- summary
- proposed action
- risks
- artifact references
- deadline or urgency
- current status

Approval statuses:

- `pending`
- `approved`
- `rejected`
- `revised`
- `expired`

## 20. Compliance Guard

Compliance Guard should combine:

- deterministic rules
- workflow-specific policy checks
- model-based review

Initial check categories:

- unsupported claims
- sensitive language
- legal/compliance concerns
- reputation risk
- incomplete sourcing
- internal inconsistency

## 21. Artifact System

Artifacts are durable outputs, not transient chat messages.

Artifact types:

- `meeting_brief`
- `meeting_followup`
- `deal_memo`
- `deal_risk_note`
- `content_draft`
- `content_variants`
- `approval_pack`

Artifacts should store:

- version
- status
- approval state
- provenance
- related entities

## 22. Dashboard Projection

The dashboard should not query raw orchestration internals directly. Use projection views.

Suggested projections:

- home summary
- active approvals
- running workflows
- recent artifacts
- unresolved risks
- top memory signals

This keeps the UI fast and decoupled from orchestration complexity.

## 23. Security And Safety

Minimum technical requirements:

- explicit runtime capability boundaries
- environment-based secret injection
- no secret values in artifacts or logs
- audit trail for approvals and runtime selection
- clear separation between approved and unapproved content

## 24. Testing Strategy

Testing layers:

- unit tests for pure logic
- contract tests for shared schemas
- workflow tests for Meeting / Deal / Content
- integration tests for harness state transitions
- end-to-end tests for executive flows

Critical v2 test targets:

- router classification correctness
- planner schema validity
- approval pause and resume
- evaluator-triggered retry
- compliance-triggered block
- memory write-back rules
- dashboard projection correctness

## 25. Open-Source Readiness

To support open-source collaboration, the project should include:

- architecture docs
- ADRs for major design choices
- workflow contracts
- sample fixtures
- local development instructions
- explicit contributing guidance

Recommended first ADRs:

- use TypeScript end-to-end
- workflow-first over chat-first
- runtime adapter boundary
- structured memory model
- approval-first high-stakes policy

## 26. Implementation Priorities

Immediate implementation sequence:

1. Create shared contracts package
2. Build Home IA and command submission flow
3. Implement Intent Router contract
4. Implement Planner contract
5. Define Meeting / Deal / Content workflow contracts
6. Implement Memory schema
7. Build harness state machine
8. Implement runtime adapter boundary
9. Add Evaluator and Compliance Guard
10. Project run state to the dashboard

## 27. Mapping To Current Planning Tasks

This spec maps cleanly to the existing planning direction:

- `J00`: naming, entry, page layout
- `J02`: workflow boundaries and done criteria
- `J10`: intent router contract
- `J11`: planner contract
- `J14`: compliance guard rules
- `J20`: memory entity model
- `J40`: dashboard information architecture

## 28. Summary

JackClaw OS v2 should be implemented as a workflow-first, harness-driven, model-agnostic system with explicit contracts, approval checkpoints, structured memory, and a dashboard designed for executive decision-making.

The architecture should remain simple enough for open-source contributors to understand, while still supporting the core agentic patterns needed for real executive workflows.
