# BossAssistant Product Principles & IA v2

Status: Draft v2  
Date: 2026-03-29  
Owner: BossAssistant

## 1. Product Definition

BossAssistant is not a chat assistant. It is an agent operating system for executive work.

Its purpose is to let a user submit one sentence, then have the system:

- identify the task
- decompose the task
- execute the work
- review the output
- run compliance and risk checks
- prepare a decision-ready result
- write useful memory back into the system

The human remains the final decision-maker. The system absorbs process-heavy cognitive work.

## 2. Product Vision

BossAssistant should feel like an executive operating system, not a messaging app.

The user experience should shift from:

- "talking to an AI"

to:

- "issuing a command to a decision system"
- "reviewing plans, risks, and results"
- "approving or correcting key outcomes"

## 3. Product Goals

### 3.1 Primary Goals

- Provide a single-entry interface for executive requests
- Convert natural-language requests into structured workflows
- Produce decision-ready outputs instead of long conversational transcripts
- Persist memory across people, companies, meetings, decisions, and content work
- Expose risk, uncertainty, and approval points clearly

### 3.2 V2 Delivery Goals

- Lock product principles and information architecture
- Define the surfaces required for a usable V1 implementation
- Align product structure with workflow-first execution instead of chat-first interaction

## 4. Product Non-Goals

BossAssistant v2 does not aim to:

- mimic JackClaw OS visuals or implementation details
- behave like a general-purpose assistant for all consumer tasks
- fully automate all external systems from day one
- remove human approval from high-stakes work
- expose raw model/provider complexity as the primary user interaction

## 5. Core Product Principles

### 5.1 Single Entry

Every task starts from one executive command input. Users should not need to pre-pick a tool before the system begins reasoning.

### 5.2 Decision First

The end product is a decision-ready artifact, not a long chat log.

### 5.3 Workflow Native

The product is built around workflows such as Meeting, Deal, and Content, not around generic free-form chat threads.

### 5.4 Human Gated

The system can plan and execute autonomously, but high-stakes moments must pause for human review.

### 5.5 Transparent by Default

Users should be able to see:

- what the system thinks the task is
- what plan it generated
- what is currently running
- what failed
- what needs approval
- what risks were found

### 5.6 Memory Backed

Repeated work should get better over time. The system should preserve facts, preferences, decisions, and context in structured memory.

### 5.7 Model Agnostic

BossAssistant should not be product-defined by one model vendor. Model choice is infrastructure, not product identity.

### 5.8 Open-Source Friendly

The product must be understandable to contributors. Naming, boundaries, states, and flows should be explicit and documented.

## 6. Primary User

Primary user:

- founder
- chairman
- CEO
- chief of staff
- senior operator

This user typically wants:

- fewer manual steps
- higher signal and lower noise
- visibility into progress and risk
- fast review and approval loops
- continuity across long-running work

## 7. Core Jobs To Be Done

- "Prepare me for this meeting and tell me what matters."
- "Assess this deal and tell me whether to proceed."
- "Draft this content and make sure it is safe to publish."
- "Summarize what needs my approval today."
- "Track what we already know about this person, company, or decision."

## 8. Product Surface Model

BossAssistant has two product layers:

- Decision Surface
- Execution Workspace

### 8.1 Decision Surface

This is the executive-facing surface. It should answer:

- What should I pay attention to?
- What is the system doing?
- What needs my approval?
- What is risky?
- What do we already know?

### 8.2 Execution Workspace

This is the operating layer behind the decision surface. It contains:

- workflow runs
- artifacts
- files
- tasks
- memory
- project context
- execution logs

## 9. Primary Navigation

Top-level navigation should be:

- Home
- Workflows
- Artifacts
- Memory
- Workspaces
- Runtime
- Admin

The `Home` view is the main executive dashboard. The others are supporting operational views.

## 10. Home Information Architecture

The Home screen should contain six primary sections.

### 10.1 Command Console

Purpose:

- accept one-sentence executive commands
- show the interpreted task type after submission
- expose immediate next system action

Key elements:

- main input
- execute button
- current mode or cost policy
- recent commands

### 10.2 Active Decisions

Purpose:

- surface the highest-priority items needing a human decision

Typical cards:

- approve plan
- approve outbound content
- choose between options
- resolve missing information
- confirm whether to continue a workflow

### 10.3 Workflow Runs

Purpose:

- show the live state of execution

Typical statuses:

- queued
- routing
- planning
- executing
- evaluating
- compliance check
- waiting approval
- completed
- blocked
- failed

### 10.4 Risk & Compliance

Purpose:

- make risk visible before output is acted on

Typical signals:

- missing facts
- low-confidence claims
- legal/compliance concerns
- sensitive brand language
- contradictory source material

### 10.5 Memory Signals

Purpose:

- show which stored entities and preferences are influencing the current task

Typical memory types:

- people
- companies
- meetings
- decisions
- content history
- executive preferences

### 10.6 Executive Brief

Purpose:

- provide an ambient daily summary for the user

Typical content:

- today’s top priorities
- latest completed runs
- outstanding approvals
- new risks
- recent memory updates

## 11. Supporting Views

### 11.1 Workflows

Purpose:

- browse workflow types and active runs

Key views:

- Meeting
- Deal
- Content
- future workflow placeholders: Project, PPT, Intelligence

### 11.2 Artifacts

Purpose:

- store outputs generated by workflows

Artifact examples:

- meeting briefs
- deal memos
- talking points
- content drafts
- approval packages

### 11.3 Memory

Purpose:

- inspect and manage structured memory

Core tabs:

- People
- Companies
- Meetings
- Decisions
- Contents
- Preferences

### 11.4 Workspaces

Purpose:

- preserve project-oriented operational context

This is the place for:

- sessions
- file attachments
- task lists
- project-level memory
- execution history

### 11.5 Runtime

Purpose:

- show execution policy and infrastructure state without forcing users to understand model internals

Primary concepts:

- policy mode: Economy / Balanced / Executive
- active runtime provider
- available capabilities
- failure notices

### 11.6 Admin

Purpose:

- configuration, team settings, connectors, permissions, and audit access

## 12. Core Workflow Definitions

V2 only requires these three workflows to be product-first citizens.

### 12.1 Meeting Workflow

User intent examples:

- prepare for a meeting
- analyze participants
- create agenda
- draft follow-up notes

Expected outputs:

- meeting brief
- objectives
- tailored questions
- risk notes
- follow-up draft

### 12.2 Deal Workflow

User intent examples:

- assess an investment or transaction
- summarize a deal structure
- identify critical risks
- propose next-step recommendation

Expected outputs:

- deal brief
- risk analysis
- go / pause / no-go recommendation
- missing diligence list

### 12.3 Content Workflow

User intent examples:

- draft public content
- create internal messaging
- rewrite for platform fit
- perform publication risk checks

Expected outputs:

- content strategy
- first draft
- variants
- publishability review

## 13. Approval Model

BossAssistant should support approval at three levels:

- plan approval
- artifact approval
- action approval

Examples:

- approve a generated execution plan
- approve a post before publication
- approve whether a workflow should continue after a risk warning

## 14. Trust Model

Trust should come from visible structure, not from anthropomorphic tone.

Users should feel confident because the system shows:

- plan
- rationale
- status
- evidence
- risk
- history

## 15. Product Language

Preferred product nouns:

- command
- workflow
- run
- approval
- artifact
- memory
- risk
- brief

Avoid making `chat`, `assistant reply`, and `conversation` the dominant product nouns.

## 16. Design Direction

BossAssistant should feel:

- focused
- high-signal
- deliberate
- operational

It should avoid:

- playful chatbot metaphors
- cluttered dashboard noise
- developer-only terminology on the main surface

Recommended visual traits:

- structured dashboard hierarchy
- restrained dark or neutral executive palette
- strong typographic contrast
- visible system status
- dense but readable information panels

## 17. Product Success Criteria

BossAssistant is succeeding when:

- users can issue a command without selecting a tool first
- the system consistently maps requests into the right workflow
- outputs are presented as decision-ready artifacts
- approval points are obvious
- risk is surfaced before action
- memory reduces re-explanation over time
- the main screen feels like an executive operating system rather than a chat app

## 18. Immediate Product Implications

This document implies the following implementation priorities:

1. Build a Home screen centered on Command Console, Active Decisions, Workflow Runs, Risk, Memory, and Executive Brief
2. Treat Meeting, Deal, and Content as first-class workflows
3. Separate executive-facing surfaces from operational workspace surfaces
4. Design every execution flow to produce approval-ready artifacts
5. Keep model/provider details behind a runtime policy layer
