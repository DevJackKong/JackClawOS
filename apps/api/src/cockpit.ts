import type {
  ChatMessage,
  CockpitExecutionLog,
  CockpitMemoryItem,
  CockpitPriorityAction,
  CockpitSignal,
  CockpitState,
  CockpitTask,
  CockpitWorkflowCard,
  DemoPlan,
  IntentRouterOutput,
  RunHistoryEntry,
  SubmitCommandRequest,
  WorkflowType
} from "@bossassistant/contracts";

import { copyForLanguage, localizeWorkflowType, resolveLanguage, type Language } from "./i18n.js";

const workflowCardDefinitions: Record<WorkflowType, { en: string; zh: string; enDesc: string; zhDesc: string }> = {
  chat: {
    en: "Chat Agent",
    zh: "对话 Agent",
    enDesc: "Normal assistant conversation, source analysis, and follow-up reasoning.",
    zhDesc: "普通助理对话、来源解读和后续判断。"
  },
  meeting: {
    en: "Meeting OS",
    zh: "会议 OS",
    enDesc: "Background, decision points, and follow-up control.",
    zhDesc: "人物背景、关键判断点和后续跟进控制。"
  },
  deal: {
    en: "Deal Designer",
    zh: "交易设计",
    enDesc: "Structure, risk, economics, and recommendation posture.",
    zhDesc: "结构、风险、经济性和建议立场。"
  },
  content: {
    en: "Content Engine",
    zh: "叙事引擎",
    enDesc: "Channel-aware drafting, review, and publication guardrails.",
    zhDesc: "面向渠道的内容起草、审阅与发布护栏。"
  },
  unknown: {
    en: "Clarify Lane",
    zh: "澄清通道",
    enDesc: "Resolve the missing variable before the agent operates.",
    zhDesc: "先补齐关键变量，再让 agent 继续操作。"
  },
  unsupported: {
    en: "Reserved Lane",
    zh: "保留通道",
    enDesc: "Request is outside the currently supported demo scope.",
    zhDesc: "请求超出当前 demo 支持的能力范围。"
  }
};

function workflowOrder(): WorkflowType[] {
  return ["chat", "meeting", "deal", "content", "unknown", "unsupported"];
}

function mapTaskStatus(step: DemoPlan["steps"][number]["status"]): CockpitTask["status"] {
  if (step === "ready") {
    return "active";
  }

  if (step === "blocked") {
    return "blocked";
  }

  return "pending";
}

function inferAgentStatus(route?: IntentRouterOutput): CockpitState["agentStatus"] {
  if (!route) {
    return "ready";
  }

  if (route.routeStatus === "blocked") {
    return "blocked";
  }

  if (route.routeStatus === "needs_clarification" || route.routeStatus === "manual_review") {
    return "waiting_user";
  }

  return "thinking";
}

function buildWorkflowCards(language: Language, history: RunHistoryEntry[], activeWorkflowType?: WorkflowType): CockpitWorkflowCard[] {
  return workflowOrder().map((workflowType) => {
    const definition = workflowCardDefinitions[workflowType];

    return {
      workflowType,
      title: copyForLanguage(language, { en: definition.en, zh: definition.zh }),
      description: copyForLanguage(language, { en: definition.enDesc, zh: definition.zhDesc }),
      count: history.filter((run) => run.workflowType === workflowType).length,
      active: activeWorkflowType === workflowType
    };
  });
}

function buildSuggestedPrompts(language: Language, route?: IntentRouterOutput): string[] {
  if (!route || route.workflowType === "unknown") {
    return copyForLanguage(language, {
      en: [
        "Prepare me for tomorrow's board meeting with ByteDance",
        "Assess whether we should proceed with this AI tooling acquisition",
        "Draft a LinkedIn post and check publication risk"
      ],
      zh: ["帮我准备明天和字节跳动管理层的董事会会议", "评估一下这笔 AI 工具收购我们是否应该继续推进", "起草一篇领英帖子并检查发布风险"]
    });
  }

  if (route.workflowType === "chat") {
    return copyForLanguage(language, {
      en: [
        "Summarize the source for me in plain language",
        "Tell me why this matters now",
        "Compare it with two similar projects"
      ],
      zh: ["先用自然语言帮我总结一下", "告诉我它现在为什么值得关注", "拿它和两个相似项目做个对比"]
    });
  }

  if (route.workflowType === "meeting") {
    return copyForLanguage(language, {
      en: [
        "Summarize the participants I should pay attention to",
        "Turn this into a board briefing outline",
        "List the sharpest follow-up questions"
      ],
      zh: ["总结我该重点关注的参会人", "把它整理成董事会 briefing 提纲", "列出最尖锐的追问问题"]
    });
  }

  if (route.workflowType === "deal") {
    return copyForLanguage(language, {
      en: [
        "Tell me the go / pause / no-go posture",
        "What diligence gaps should the agent chase next",
        "Draft the recommendation memo"
      ],
      zh: ["直接告诉我继续 / 暂停 / 否决立场", "下一步还要追哪些尽调缺口", "起草交易建议 memo"]
    });
  }

  return copyForLanguage(language, {
    en: [
      "Show me the riskiest publication issue",
      "Rewrite this for investors",
      "Prepare an approval-ready version"
    ],
    zh: ["告诉我最高风险的发布问题", "改写成面向投资人的版本", "整理成可审批的版本"]
  });
}

function buildTasks(plan: DemoPlan, route: IntentRouterOutput, language: Language): CockpitTask[] {
  if (route.workflowType === "chat") {
    return [];
  }

  const tasks: CockpitTask[] = plan.steps.map((step) => ({
    id: step.id,
    title: step.title,
    detail: step.description,
    owner: step.owner === "system" ? "agent" : "user",
    status: mapTaskStatus(step.status),
    source: "plan" as const
  }));

  if (route.requiredInputs.length > 0) {
    tasks.unshift({
      id: "agent_follow_up",
      title: copyForLanguage(language, {
        en: "Resolve the missing route variable",
        zh: "先补齐路由缺失变量"
      }),
      detail: route.requiredInputs.map((item) => `${item.label}: ${item.reason}`).join(" / "),
      owner: "user",
      status: route.routeStatus === "needs_clarification" ? "blocked" : "pending",
      source: "agent"
    });
  }

  return tasks.slice(0, 6);
}

function buildExecutionLog(
  language: Language,
  receivedAt?: string,
  input?: SubmitCommandRequest,
  route?: IntentRouterOutput,
  plan?: DemoPlan,
  conversation?: ChatMessage[]
): CockpitExecutionLog[] {
  if (!receivedAt || !input || !route || !plan) {
    const timestamp = new Date().toISOString();
    return [
      {
        id: "boot_1",
        timestamp,
        label: copyForLanguage(language, { en: "SYSTEM_BOOT", zh: "系统启动" }),
        detail: copyForLanguage(language, {
          en: "BossAssistant OS is online and waiting for an executive command.",
          zh: "BossAssistant OS 已上线，等待新的高管指令。"
        }),
        tone: "good"
      }
    ];
  }

  const entries: CockpitExecutionLog[] = [
    {
      id: "log_input",
      timestamp: receivedAt,
      label: copyForLanguage(language, { en: "COMMAND_RECEIVED", zh: "接收指令" }),
      detail: input.commandText,
      tone: "neutral"
    },
    {
      id: "log_route",
      timestamp: receivedAt,
      label: copyForLanguage(language, { en: "INTENT_ROUTED", zh: "完成路由" }),
      detail: `${route.intentLabel} / ${route.nextAction.summary}`,
      tone: route.routeStatus === "routed" ? "good" : route.routeStatus === "blocked" ? "risk" : "warn"
    },
    {
      id: "log_plan",
      timestamp: receivedAt,
      label: copyForLanguage(language, { en: "AGENT_PLAN_READY", zh: "Agent 计划已就绪" }),
      detail: plan.summary,
      tone: "good"
    }
  ];

  for (const step of plan.steps.slice(0, 3)) {
    entries.push({
      id: `step_${step.id}`,
      timestamp: receivedAt,
      label: `${copyForLanguage(language, { en: "OPERATE", zh: "执行" })}_${step.status.toUpperCase()}`,
      detail: step.title,
      tone: step.status === "blocked" ? "warn" : "neutral"
    });
  }

  const lastAssistant = conversation?.slice().reverse().find((message) => message.role === "assistant");
  if (lastAssistant) {
    entries.push({
      id: "assistant_reply",
      timestamp: lastAssistant.timestamp,
      label: copyForLanguage(language, { en: "ASSISTANT_REPLY", zh: "助理回复" }),
      detail: lastAssistant.content,
      tone: "good"
    });
  }

  return entries.slice(0, 8);
}

function buildPriorityActions(
  language: Language,
  route?: IntentRouterOutput,
  plan?: DemoPlan,
  history: RunHistoryEntry[] = []
): CockpitPriorityAction[] {
  if (!route || !plan) {
    return history.slice(0, 4).map((run, index) => ({
      id: `history_${run.runId}`,
      title: run.headline,
      detail: run.nextActionSummary,
      urgency: index === 0 ? "high" : "normal"
    }));
  }

  const items: CockpitPriorityAction[] = [
    {
      id: "priority_next_action",
      title: route.nextAction.summary,
      detail: route.rationale,
      urgency: route.urgency === "immediate" || route.urgency === "high" ? "high" : "normal"
    }
  ];

  if (plan.steps[0]) {
    items.push({
      id: "priority_first_task",
      title: plan.steps[0].title,
      detail: plan.steps[0].description,
      urgency: "normal"
    });
  }

  if (route.approvalHint.expected) {
    items.push({
      id: "priority_guard",
      title: route.approvalHint.summary,
      detail: copyForLanguage(language, {
        en: "Keep a human gate before the agent moves outward.",
        zh: "在 agent 对外动作前保持人工把关。"
      }),
      urgency: "high"
    });
  }

  return items.slice(0, 4);
}

function buildIntelligenceSignals(language: Language, route?: IntentRouterOutput, history: RunHistoryEntry[] = []): CockpitSignal[] {
  const signals: CockpitSignal[] = [];

  if (route) {
    signals.push({
      id: "signal_route",
      title: copyForLanguage(language, {
        en: `${localizeWorkflowType(language, route.workflowType)} route is active`,
        zh: `${localizeWorkflowType(language, route.workflowType)} 路由已激活`
      }),
      detail: route.nextAction.summary,
      source: copyForLanguage(language, { en: "Router", zh: "路由器" }),
      badge: `${Math.round(route.confidence * 100)}%`,
      tone: route.routeStatus === "routed" ? "good" : "warn"
    });

    if (route.candidateWorkflows[0]) {
      signals.push({
        id: "signal_candidate",
        title: route.candidateWorkflows[0].reason,
        detail: copyForLanguage(language, {
          en: "Primary workflow signal extracted from the incoming command.",
          zh: "从当前命令中抽取出的主工作流信号。"
        }),
        source: copyForLanguage(language, { en: "Classifier", zh: "分类器" }),
        badge: `${Math.round(route.candidateWorkflows[0].confidence * 100)}%`,
        tone: "neutral"
      });
    }

    signals.push({
      id: "signal_risk",
      title: route.approvalHint.summary,
      detail: route.fallbackStrategy.reason,
      source: copyForLanguage(language, { en: "Guardrail", zh: "护栏" }),
      tone: route.riskLevel === "critical" ? "risk" : route.riskLevel === "high" ? "warn" : "neutral"
    });
  }

  if (history[0]) {
    signals.push({
      id: "signal_history",
      title: history[0].headline,
      detail: history[0].nextActionSummary,
      source: copyForLanguage(language, { en: "Recent Run", zh: "最近运行" }),
      tone: "neutral"
    });
  }

  return signals.slice(0, 4);
}

function buildMemoryItems(language: Language, input?: SubmitCommandRequest, route?: IntentRouterOutput, history: RunHistoryEntry[] = []): CockpitMemoryItem[] {
  const items: CockpitMemoryItem[] = [];

  for (const entity of route?.detectedEntities ?? []) {
    items.push({
      id: `${entity.entityType}_${entity.displayName}`,
      label: entity.displayName,
      detail: copyForLanguage(language, {
        en: `${entity.entityType} detected from the current command.`,
        zh: `从当前命令中识别出的${entity.entityType}实体。`
      }),
      type: entity.entityType === "company" ? "company" : entity.entityType === "person" ? "person" : "project",
      meta: `${Math.round(entity.confidence * 100)}%`
    });
  }

  if (input?.timezone) {
    items.push({
      id: "memory_timezone",
      label: input.timezone,
      detail: copyForLanguage(language, {
        en: "Operator timezone used to schedule and interpret the run.",
        zh: "本次运行采用的操作员时区。"
      }),
      type: "signal",
      meta: copyForLanguage(language, { en: "Context", zh: "上下文" })
    });
  }

  for (const run of history.slice(0, 2)) {
    items.push({
      id: `memory_${run.runId}`,
      label: run.headline,
      detail: run.commandText,
      type: "run",
      meta: run.receivedAt
    });
  }

  return items.slice(0, 5);
}

export function buildCockpitState(args: {
  locale?: string;
  history?: RunHistoryEntry[];
  receivedAt?: string;
  input?: SubmitCommandRequest;
  route?: IntentRouterOutput;
  plan?: DemoPlan;
  conversation?: ChatMessage[];
}): CockpitState {
  const language = resolveLanguage(args.locale);
  const history = args.history ?? [];

  return {
    agentStatus: inferAgentStatus(args.route),
    statusLine:
      args.route?.nextAction.summary ??
      copyForLanguage(language, {
        en: "Ready to accept the next executive instruction.",
        zh: "准备接收下一条高管指令。"
      }),
    suggestedPrompts: buildSuggestedPrompts(language, args.route),
    workflows: buildWorkflowCards(language, history, args.route?.workflowType),
    priorityActions: buildPriorityActions(language, args.route, args.plan, history),
    tasks: args.route && args.plan ? buildTasks(args.plan, args.route, language) : [],
    executionLog: buildExecutionLog(language, args.receivedAt, args.input, args.route, args.plan, args.conversation),
    intelligenceSignals: buildIntelligenceSignals(language, args.route, history),
    memoryItems: buildMemoryItems(language, args.input, args.route, history)
  };
}
