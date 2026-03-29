import type {
  ApprovalHint,
  ApprovalReasonCode,
  CandidateWorkflow,
  FallbackStrategy,
  IntentRouterInput,
  IntentRouterOutput,
  RequiredInput,
  RiskLevel,
  RouterNextAction,
  UrgencyLevel,
  WorkflowType
} from "@bossassistant/contracts";

import { copyForLanguage, localizeWorkflowType, resolveLanguage, type Language } from "./i18n.js";

const supportedWorkflowKeywords: Record<"meeting" | "deal" | "content", string[]> = {
  meeting: [
    "meeting",
    "会议",
    "board",
    "董事会",
    "agenda",
    "议程",
    "attendees",
    "参会",
    "follow-up",
    "follow up",
    "brief",
    "简报",
    "prep",
    "prepare me for",
    "准备",
    "会前"
  ],
  deal: [
    "assess",
    "evaluate",
    "评估",
    "deal",
    "交易",
    "acquisition",
    "收购",
    "investment",
    "投资",
    "transaction",
    "并购",
    "diligence",
    "尽调",
    "proceed",
    "继续",
    "推进",
    "recommendation",
    "no-go",
    "go/no-go",
    "valuation",
    "估值",
    "target",
    "标的",
    "是否继续"
  ],
  content: [
    "content",
    "内容",
    "draft",
    "草稿",
    "post",
    "帖子",
    "memo",
    "备忘录",
    "article",
    "文章",
    "linkedin",
    "领英",
    "twitter",
    "x post",
    "rewrite",
    "改写",
    "publish",
    "发布",
    "文案"
  ]
};

const unsupportedKeywords = [
  "ppt",
  "幻灯片",
  "slides",
  "powerpoint",
  "路线图",
  "project plan",
  "roadmap",
  "competitor intelligence",
  "intelligence report",
  "竞品情报",
  "情报报告"
];

const urgencyKeywords: Array<{ value: UrgencyLevel; terms: string[] }> = [
  {
    value: "immediate",
    terms: ["asap", "right now", "now", "immediately", "in 1 hour", "立刻", "马上", "现在", "一小时内"]
  },
  {
    value: "high",
    terms: ["today", "tonight", "tomorrow", "before the meeting", "urgent", "今天", "今晚", "明天", "会前", "紧急"]
  }
];

const externalActionKeywords = [
  "publish",
  "public",
  "send",
  "board",
  "investor",
  "press",
  "external",
  "发布",
  "公开",
  "发送",
  "董事会",
  "投资人",
  "媒体",
  "对外"
];
const legalRiskKeywords = ["legal", "compliance", "regulatory", "sensitive", "confidential", "法务", "合规", "监管", "敏感", "机密", "保密"];
const costRiskKeywords = ["budget", "funding", "acquisition", "investment", "transaction", "spend", "预算", "融资", "收购", "投资", "交易", "支出"];

function normalize(text: string) {
  return text.trim().toLowerCase();
}

function inferDetectedEntities(rawCommandText: string, workflowType: WorkflowType) {
  const entities: IntentRouterOutput["detectedEntities"] = [];
  const seen = new Set<string>();

  const pushEntity = (entityType: IntentRouterOutput["detectedEntities"][number]["entityType"], displayName: string, confidence: number) => {
    const normalized = `${entityType}:${displayName.trim()}`;
    if (!displayName.trim() || seen.has(normalized)) {
      return;
    }

    seen.add(normalized);
    entities.push({
      entityType,
      displayName: displayName.trim(),
      confidence
    });
  };

  const withMatch = rawCommandText.match(/(?:with|和|与)([^,，。]+)/i);
  if (withMatch?.[1]) {
    const candidate = withMatch[1].trim();
    const entityType = /(字节|bytedance|公司|labs|capital|集团|fund|inc|corp|llc)/i.test(candidate) ? "company" : "person";
    pushEntity(entityType, candidate, 0.74);
  }

  const quotedMatches = rawCommandText.match(/["“](.+?)["”]/g) ?? [];
  for (const match of quotedMatches.slice(0, 2)) {
    pushEntity("project", match.replace(/["“”]/g, ""), 0.62);
  }

  if (workflowType === "meeting") {
    pushEntity("meeting", "active meeting", 0.52);
  }

  if (workflowType === "deal") {
    pushEntity("deal", "active transaction", 0.52);
  }

  if (workflowType === "content") {
    pushEntity("content", "active narrative", 0.52);
  }

  return entities.slice(0, 4);
}

function scoreWorkflow(
  commandText: string,
  workflowType: "meeting" | "deal" | "content",
  language: Language
): CandidateWorkflow {
  const terms = supportedWorkflowKeywords[workflowType];
  const hits = terms.filter((term) => commandText.includes(term)).length;
  const confidence = Math.min(0.92, hits * 0.18 + (hits > 0 ? 0.28 : 0));
  const reason = hits > 0
    ? copyForLanguage(language, {
        en: `Matched ${hits} ${workflowType} workflow cues in the command.`,
        zh: `命中了 ${hits} 个${localizeWorkflowType(language, workflowType)}工作流线索。`
      })
    : copyForLanguage(language, {
        en: `No strong ${workflowType} cue detected.`,
        zh: `未检测到足够强的${localizeWorkflowType(language, workflowType)}工作流线索。`
      });

  return {
    workflowType,
    confidence,
    reason
  };
}

function inferRequiredInputs(commandText: string, workflowType: WorkflowType, language: Language): RequiredInput[] {
  if (workflowType === "meeting") {
    const items: RequiredInput[] = [];

    if (
      !/(tomorrow|today|\d{1,2}:\d{2}|monday|tuesday|wednesday|thursday|friday|saturday|sunday|今天|明天|周一|周二|周三|周四|周五|周六|周日|星期)/.test(
        commandText
      )
    ) {
      items.push({
        key: "meeting_time",
        label: copyForLanguage(language, { en: "Meeting time", zh: "会议时间" }),
        reason: copyForLanguage(language, {
          en: "Meeting prep is stronger when the event timing is known.",
          zh: "已知会议时间后，系统才能更准确地生成会前准备。"
        }),
        severity: "important"
      });
    }

    if (!/(with|board|attendees|participants|ceo|founder|与|参会|董事会|创始人|CEO)/.test(commandText)) {
      items.push({
        key: "participants",
        label: copyForLanguage(language, { en: "Participants", zh: "参会人" }),
        reason: copyForLanguage(language, {
          en: "Attendee context is needed for tailored meeting prep.",
          zh: "只有知道参会对象，系统才能输出针对性的会议准备。"
        }),
        severity: "important"
      });
    }

    return items;
  }

  if (workflowType === "deal") {
    const items: RequiredInput[] = [];

    if (!/(acquisition|investment|transaction|deal|target|company|收购|投资|交易|标的|公司|并购)/.test(commandText)) {
      items.push({
        key: "deal_target",
        label: copyForLanguage(language, { en: "Deal target", zh: "交易标的" }),
        reason: copyForLanguage(language, {
          en: "The system needs to know which company or transaction to assess.",
          zh: "系统需要知道具体是哪家公司或哪笔交易。"
        }),
        severity: "blocking"
      });
    }

    if (!/(risk|recommend|diligence|proceed|pause|no-go|go\/no-go|风险|建议|尽调|推进|暂停|否决|是否继续)/.test(commandText)) {
      items.push({
        key: "decision_goal",
        label: copyForLanguage(language, { en: "Decision goal", zh: "决策目标" }),
        reason: copyForLanguage(language, {
          en: "The system should know whether to focus on diligence, recommendation, or risk review.",
          zh: "系统需要知道重点是尽调、建议，还是风险审阅。"
        }),
        severity: "important"
      });
    }

    return items;
  }

  if (workflowType === "content") {
    const items: RequiredInput[] = [];

    if (!/(linkedin|twitter|x |post|email|memo|article|announcement|领英|微博|邮件|备忘录|文章|公告|公众号)/.test(commandText)) {
      items.push({
        key: "channel",
        label: copyForLanguage(language, { en: "Channel", zh: "渠道" }),
        reason: copyForLanguage(language, {
          en: "Content workflow needs a publishing or delivery channel.",
          zh: "内容工作流需要明确发布或投放渠道。"
        }),
        severity: "important"
      });
    }

    if (!/(audience|customer|team|investor|public|internal|founder|受众|客户|团队|投资人|公众|内部|创始人)/.test(commandText)) {
      items.push({
        key: "audience",
        label: copyForLanguage(language, { en: "Audience", zh: "受众" }),
        reason: copyForLanguage(language, {
          en: "Content workflow should adapt tone and framing to the audience.",
          zh: "内容工作流需要根据受众调整语气和表达。"
        }),
        severity: "important"
      });
    }

    return items;
  }

  return [
    {
      key: "target_object",
      label: copyForLanguage(language, { en: "Target object", zh: "目标对象" }),
      reason: copyForLanguage(language, {
        en: "The command is not specific enough to determine a safe workflow route.",
        zh: "当前命令还不够具体，系统无法安全决定工作流。"
      }),
      severity: "blocking"
    }
  ];
}

function inferRiskLevel(commandText: string, workflowType: WorkflowType): RiskLevel {
  let risk: RiskLevel = workflowType === "deal" ? "high" : workflowType === "unsupported" ? "medium" : "medium";

  if (workflowType === "unknown") {
    risk = "high";
  }

  if (workflowType === "content" && !externalActionKeywords.some((term) => commandText.includes(term))) {
    risk = "medium";
  }

  if (externalActionKeywords.some((term) => commandText.includes(term))) {
    risk = risk === "high" ? "critical" : "high";
  }

  if (legalRiskKeywords.some((term) => commandText.includes(term))) {
    risk = "critical";
  }

  if (costRiskKeywords.some((term) => commandText.includes(term)) && risk !== "critical") {
    risk = "high";
  }

  return risk;
}

function inferUrgency(commandText: string): UrgencyLevel {
  for (const item of urgencyKeywords) {
    if (item.terms.some((term) => commandText.includes(term))) {
      return item.value;
    }
  }

  return "normal";
}

function inferApprovalHint(
  commandText: string,
  workflowType: WorkflowType,
  riskLevel: RiskLevel,
  requiredInputs: RequiredInput[],
  language: Language
): ApprovalHint {
  const reasonCodes = new Set<ApprovalReasonCode>();

  if (riskLevel === "high") {
    reasonCodes.add("high_risk_task");
  }

  if (riskLevel === "critical") {
    reasonCodes.add("critical_risk_task");
  }

  if (externalActionKeywords.some((term) => commandText.includes(term))) {
    reasonCodes.add("external_publish");
    reasonCodes.add("reputation_exposure");
  }

  if (legalRiskKeywords.some((term) => commandText.includes(term))) {
    reasonCodes.add("legal_or_compliance_exposure");
  }

  if (costRiskKeywords.some((term) => commandText.includes(term))) {
    reasonCodes.add("budget_or_cost_exposure");
  }

  if (workflowType === "deal" || commandText.includes("recommend")) {
    reasonCodes.add("executive_recommendation");
  }

  if (requiredInputs.some((item) => item.severity === "blocking")) {
    reasonCodes.add("insufficient_context");
  }

  if (workflowType === "unknown") {
    reasonCodes.add("ambiguous_intent");
  }

  const expected = reasonCodes.size > 0;

  if (!expected) {
    return {
      expected: false,
      stage: "none",
      reasonCodes: [],
      summary: copyForLanguage(language, {
        en: "No immediate approval gate is expected before planning.",
        zh: "在进入规划前，当前无需立即触发审批。"
      })
    };
  }

  if (workflowType === "unknown" || riskLevel === "critical") {
    return {
      expected: true,
      stage: "before_planning",
      reasonCodes: [...reasonCodes],
      summary: copyForLanguage(language, {
        en: "Human review should happen before planning continues.",
        zh: "在继续规划前，应先由人工审阅。"
      })
    };
  }

  if (externalActionKeywords.some((term) => commandText.includes(term))) {
    return {
      expected: true,
      stage: "before_external_action",
      reasonCodes: [...reasonCodes],
      summary: copyForLanguage(language, {
        en: "The system can draft, but outward-facing action should pause for approval.",
        zh: "系统可以先起草，但对外动作应等待审批后再继续。"
      })
    };
  }

  if (workflowType === "deal") {
    return {
      expected: true,
      stage: "before_artifact_release",
      reasonCodes: [...reasonCodes],
      summary: copyForLanguage(language, {
        en: "Deal recommendations should be reviewed before release.",
        zh: "交易建议在输出前应先经过人工复核。"
      })
    };
  }

  return {
    expected: true,
    stage: "before_execution",
    reasonCodes: [...reasonCodes],
    summary: copyForLanguage(language, {
      en: "Planning can proceed, but a human gate is expected before execution expands.",
      zh: "可以继续生成计划，但在进一步执行前预计仍需人工把关。"
    })
  };
}

function inferFallbackStrategy(
  workflowType: WorkflowType,
  confidence: number,
  riskLevel: RiskLevel,
  requiredInputs: RequiredInput[],
  language: Language
): FallbackStrategy {
  if (workflowType === "unsupported") {
    return {
      mode: "block_and_explain",
      reason: copyForLanguage(language, {
        en: "The request is outside the current BossAssistant demo workflow scope.",
        zh: "该请求超出了当前 BossAssistant demo 支持的工作流范围。"
      }),
      requiredUserInput: []
    };
  }

  if (riskLevel === "critical" && confidence < 0.75) {
    return {
      mode: "route_to_manual_review",
      reason: copyForLanguage(language, {
        en: "The task appears too sensitive for an autonomous route guess.",
        zh: "该任务敏感度较高，不适合由系统自行猜测路由。"
      }),
      requiredUserInput: requiredInputs
        .filter((item) => item.severity !== "optional")
        .map((item) => `${item.label}: ${item.reason}`)
    };
  }

  if (workflowType === "unknown" || confidence < 0.75) {
    return {
      mode: "clarify_and_retry",
      reason: copyForLanguage(language, {
        en: "The router needs one more business-defining variable to choose safely.",
        zh: "路由器还需要一个关键业务变量，才能安全决定工作流。"
      }),
      requiredUserInput: requiredInputs
        .filter((item) => item.severity !== "optional")
        .map((item) => `${item.label}: ${item.reason}`)
    };
  }

  return {
    mode: "none",
    reason: copyForLanguage(language, {
      en: "Workflow classification is strong enough to proceed.",
      zh: "当前工作流识别已足够明确，可以继续。"
    }),
    requiredUserInput: []
  };
}

function inferNextAction(
  fallbackStrategy: FallbackStrategy,
  approvalHint: ApprovalHint,
  workflowType: WorkflowType,
  language: Language
): RouterNextAction {
  if (fallbackStrategy.mode === "block_and_explain") {
    return {
      type: "block_run",
      summary: copyForLanguage(language, {
        en: "Stop the run and explain that the request is outside demo scope.",
        zh: "中止本次运行，并说明该请求超出 demo 范围。"
      })
    };
  }

  if (fallbackStrategy.mode === "clarify_and_retry") {
    return {
      type: "ask_user_clarification",
      summary: copyForLanguage(language, {
        en: "Ask one decisive clarification before planning.",
        zh: "在继续规划前，先补问一个关键澄清问题。"
      })
    };
  }

  if (fallbackStrategy.mode === "route_to_manual_review") {
    return {
      type: "request_manual_review",
      summary: copyForLanguage(language, {
        en: "Escalate to human review before planning.",
        zh: "在继续规划前，升级为人工审阅。"
      })
    };
  }

  if (approvalHint.expected && approvalHint.stage === "before_planning") {
    return {
      type: "request_plan_approval",
      summary: copyForLanguage(language, {
        en: "Request approval before planning due to route sensitivity.",
        zh: "由于路由敏感度较高，先申请审批再继续规划。"
      })
    };
  }

  return {
    type: "send_to_planner",
    summary: copyForLanguage(language, {
      en: `Generate a ${workflowType} plan.`,
      zh: `生成 ${localizeWorkflowType(language, workflowType)} 工作流计划。`
    })
  };
}

export function routeIntent(input: IntentRouterInput): IntentRouterOutput {
  const rawCommandText = input.commandText.trim();
  const commandText = normalize(rawCommandText);
  const language = resolveLanguage(input.locale);

  if (unsupportedKeywords.some((term) => commandText.includes(term))) {
    const requiredInputs = inferRequiredInputs(commandText, "unsupported", language);
    const riskLevel = inferRiskLevel(commandText, "unsupported");
    const approvalHint = inferApprovalHint(commandText, "unsupported", riskLevel, requiredInputs, language);
    const fallbackStrategy = inferFallbackStrategy("unsupported", 0.2, riskLevel, requiredInputs, language);
    const nextAction = inferNextAction(fallbackStrategy, approvalHint, "unsupported", language);

    return {
      routeId: `route_${input.commandId}`,
      commandId: input.commandId,
      routeStatus: "blocked",
      workflowType: "unsupported",
      intentLabel: "unsupported_request",
      confidence: 0.2,
      rationale: copyForLanguage(language, {
        en: "The command maps to a reserved or unsupported workflow for the current demo.",
        zh: "该命令命中了当前 demo 尚未支持的保留工作流。"
      }),
      requiredInputs,
      detectedEntities: inferDetectedEntities(rawCommandText, "unsupported"),
      riskLevel,
      urgency: inferUrgency(commandText),
      approvalHint,
      fallbackStrategy,
      candidateWorkflows: [],
      nextAction
    };
  }

  const candidates = (["meeting", "deal", "content"] as const)
    .map((workflowType) => scoreWorkflow(commandText, workflowType, language))
    .filter((candidate) => candidate.confidence > 0)
    .sort((left, right) => right.confidence - left.confidence);

  const top = candidates[0];
  const runnerUp = candidates[1];

  const isAmbiguous =
    Boolean(top && runnerUp) && top.confidence - runnerUp.confidence < 0.12;

  const workflowType: WorkflowType = !top
    ? "unknown"
    : isAmbiguous || top.confidence < 0.45
      ? "unknown"
      : top.workflowType;

  const confidence = workflowType === "unknown" ? Math.max(top?.confidence ?? 0.32, 0.32) : top.confidence;
  const requiredInputs = inferRequiredInputs(commandText, workflowType, language);
  const riskLevel = inferRiskLevel(commandText, workflowType);
  const urgency = inferUrgency(commandText);
  const approvalHint = inferApprovalHint(commandText, workflowType, riskLevel, requiredInputs, language);
  const fallbackStrategy = inferFallbackStrategy(workflowType, confidence, riskLevel, requiredInputs, language);
  const nextAction = inferNextAction(fallbackStrategy, approvalHint, workflowType, language);

  const routeStatus =
    fallbackStrategy.mode === "clarify_and_retry"
      ? "needs_clarification"
      : fallbackStrategy.mode === "route_to_manual_review"
        ? "manual_review"
        : "routed";

  return {
    routeId: `route_${input.commandId}`,
    commandId: input.commandId,
    routeStatus,
    workflowType,
    intentLabel:
      workflowType === "unknown" ? "ambiguous_executive_request" : `${workflowType}_workflow_request`,
    confidence,
    rationale:
      workflowType === "unknown"
        ? copyForLanguage(language, {
            en: "The command partially matches supported workflows but needs one more clarifying variable.",
            zh: "该命令与已支持工作流部分匹配，但仍缺少一个关键澄清变量。"
          })
        : copyForLanguage(language, {
            en: `The command strongly matches the ${workflowType} workflow.`,
            zh: `该命令与${localizeWorkflowType(language, workflowType)}工作流高度匹配。`
          }),
    requiredInputs,
    detectedEntities: inferDetectedEntities(rawCommandText, workflowType),
    riskLevel,
    urgency,
    approvalHint,
    fallbackStrategy,
    candidateWorkflows: candidates,
    nextAction
  };
}
