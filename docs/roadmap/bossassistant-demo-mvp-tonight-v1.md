# JackClaw OS — Demo MVP Tonight v1

Status: Working Draft  
Date: 2026-03-29  
Owner: JackClaw OS

## 1. Goal

Tonight's goal is not a full JackClaw OS system.

Tonight's goal is a believable, runnable demo that proves the core product thesis:

- one command in
- workflow recognized
- plan shape generated
- risk and approval surfaced
- result presented as a decision-oriented run, not a chat transcript

## 2. Demo Narrative

The demo should let a user type commands such as:

- "Prepare me for tomorrow's board meeting with ByteDance"
- "Assess whether we should proceed with this AI tooling acquisition"
- "Draft a LinkedIn post about our new strategy and check publication risk"

The system should then show:

1. detected workflow
2. route confidence
3. risk level
4. urgency
5. approval expectation
6. fallback behavior if intent is weak
7. a stub plan with next steps
8. a decision-ready summary card

## 3. MVP Scope

### 3.1 In Scope Tonight

- single command submission UI
- Intent Router contract and implementation
- simple Planner stub driven by workflow type
- API endpoint for command submission
- dashboard-style result view
- support for `meeting`, `deal`, `content`
- support for `unknown`, `unsupported`
- visible `riskLevel`, `urgency`, `approvalHint`, `fallbackStrategy`

### 3.2 Explicitly Out Of Scope Tonight

- real model orchestration across providers
- structured memory persistence
- full harness state machine
- workflow execution with tools
- approval persistence
- evaluator/compliance full engines
- auth and team features

## 4. Architecture Slice For Demo

Minimal demo path:

1. Web command console posts to API
2. API validates payload with shared contract
3. Intent Router returns typed route result
4. Planner stub generates 3-5 workflow-specific steps
5. API returns a unified demo run payload
6. Web renders dashboard cards and plan

## 5. Demo Acceptance Criteria

The demo is good enough tonight when:

1. the app starts locally with one command
2. all three core workflows can be demonstrated with realistic examples
3. ambiguous input produces clarification-style fallback
4. unsupported input is handled explicitly
5. UI looks like an operating console, not a chatbot
6. shared contracts are isolated enough to grow into the future monorepo

## 6. Recommended Build Order

1. workspace scaffold
2. shared contracts
3. router implementation
4. planner stub
5. API endpoint
6. frontend command console + result cards
7. smoke validation

## 7. What Makes This Demo Credible

The credibility comes from:

- typed contract-first routing
- explicit risk and approval semantics
- workflow-first outputs
- visible uncertainty handling
- clear separation between command intake and decision artifact

The credibility does not require:

- full autonomous execution
- real provider switching
- full data persistence

## 8. Follow-On After Tonight

After the demo works, the next logical sequence is:

1. move planner stub into workflow contracts
2. add harness states
3. add compliance rules per workflow
4. add approval request objects
5. add memory write-back
