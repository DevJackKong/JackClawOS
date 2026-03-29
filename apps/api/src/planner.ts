import type { DemoPlan, IntentRouterOutput, PlanStep, WorkflowType } from "@bossassistant/contracts";

import { copyForLanguage, resolveLanguage, type Language } from "./i18n.js";

function buildSteps(workflowType: WorkflowType, language: Language): PlanStep[] {
  if (workflowType === "chat") {
    return [
      {
        id: "step_1",
        title: copyForLanguage(language, { en: "Understand the source", zh: "理解来源内容" }),
        owner: "system",
        status: "ready",
        description: copyForLanguage(language, {
          en: "Identify what the user shared and why it matters.",
          zh: "先判断用户分享的内容是什么，以及它为什么值得看。"
        })
      },
      {
        id: "step_2",
        title: copyForLanguage(language, { en: "Explain it in plain language", zh: "用自然语言解释" }),
        owner: "system",
        status: "ready",
        description: copyForLanguage(language, {
          en: "Reply like a normal assistant instead of routing the user into workflow jargon.",
          zh: "按正常助理对话回复，而不是把用户拉进工作流术语。"
        })
      },
      {
        id: "step_3",
        title: copyForLanguage(language, { en: "Offer a useful next angle", zh: "给出有价值的下一问" }),
        owner: "system",
        status: "pending",
        description: copyForLanguage(language, {
          en: "Suggest the most useful follow-up direction.",
          zh: "给出下一步最值得继续聊的方向。"
        })
      }
    ];
  }

  if (workflowType === "meeting") {
    return [
      {
        id: "step_1",
        title: copyForLanguage(language, { en: "Assemble meeting context", zh: "整理会议上下文" }),
        owner: "system",
        status: "ready",
        description: copyForLanguage(language, {
          en: "Collect participants, meeting purpose, and recent related decisions.",
          zh: "收集参会人、会议目的和最近相关决策。"
        })
      },
      {
        id: "step_2",
        title: copyForLanguage(language, { en: "Extract decision points", zh: "提取关键决策点" }),
        owner: "system",
        status: "ready",
        description: copyForLanguage(language, {
          en: "Identify the agenda items that likely require executive attention.",
          zh: "识别最需要董事长关注的议题和判断点。"
        })
      },
      {
        id: "step_3",
        title: copyForLanguage(language, { en: "Prepare brief and questions", zh: "生成简报与追问清单" }),
        owner: "system",
        status: "pending",
        description: copyForLanguage(language, {
          en: "Draft a concise meeting brief, tailored talking points, and risk questions.",
          zh: "生成简洁会议简报、定制化发言要点和风险追问。"
        })
      }
    ];
  }

  if (workflowType === "deal") {
    return [
      {
        id: "step_1",
        title: copyForLanguage(language, { en: "Normalize deal context", zh: "统一交易背景" }),
        owner: "system",
        status: "ready",
        description: copyForLanguage(language, {
          en: "Capture the target, transaction type, and decision objective.",
          zh: "明确标的、交易类型和决策目标。"
        })
      },
      {
        id: "step_2",
        title: copyForLanguage(language, { en: "Frame key diligence lanes", zh: "搭建尽调主线" }),
        owner: "system",
        status: "ready",
        description: copyForLanguage(language, {
          en: "Break the review into strategic fit, risk, economics, and open diligence.",
          zh: "将审阅拆成战略契合、风险、经济性和待补尽调四条主线。"
        })
      },
      {
        id: "step_3",
        title: copyForLanguage(language, { en: "Draft recommendation pack", zh: "起草交易建议包" }),
        owner: "system",
        status: "pending",
        description: copyForLanguage(language, {
          en: "Produce a go, pause, or no-go recommendation with missing evidence called out.",
          zh: "输出继续、暂停或否决建议，并明确缺失证据。"
        })
      }
    ];
  }

  if (workflowType === "content") {
    return [
      {
        id: "step_1",
        title: copyForLanguage(language, { en: "Clarify message objective", zh: "澄清内容目标" }),
        owner: "system",
        status: "ready",
        description: copyForLanguage(language, {
          en: "Translate the command into audience, tone, and channel intent.",
          zh: "把命令翻译成受众、语气和渠道目标。"
        })
      },
      {
        id: "step_2",
        title: copyForLanguage(language, { en: "Draft core narrative", zh: "起草核心叙事" }),
        owner: "system",
        status: "ready",
        description: copyForLanguage(language, {
          en: "Generate a first-pass content draft aligned to the chosen platform.",
          zh: "围绕目标平台生成第一版内容草稿。"
        })
      },
      {
        id: "step_3",
        title: copyForLanguage(language, { en: "Run publication review", zh: "执行发布前审查" }),
        owner: "system",
        status: "pending",
        description: copyForLanguage(language, {
          en: "Check claims, tone, and outward-facing risk before release.",
          zh: "在发布前检查事实、语气和对外风险。"
        })
      }
    ];
  }

  return [
    {
      id: "step_1",
      title: copyForLanguage(language, { en: "Clarify request", zh: "补充澄清信息" }),
      owner: "user",
      status: "blocked",
      description: copyForLanguage(language, {
        en: "Provide one missing business variable so the system can route safely.",
        zh: "请补充一个缺失的业务变量，帮助系统安全路由。"
      })
    }
  ];
}

function buildSummary(workflowType: WorkflowType, language: Language) {
  if (workflowType === "chat") {
    return {
      summary: copyForLanguage(language, {
        en: "Continue as a normal conversational agent and help the user reason through the shared source.",
        zh: "以正常对话 agent 的方式继续，帮助用户围绕分享的来源做判断。"
      }),
      doneCriteria: copyForLanguage(language, {
        en: [
          "The source is explained clearly",
          "The key signal is easy to understand",
          "A useful next follow-up is suggested"
        ],
        zh: ["来源被讲清楚了", "关键信号易于理解", "给出了值得继续追问的下一步"]
      }),
      expectedArtifacts: ["chat_reply", "source_summary"]
    };
  }

  if (workflowType === "meeting") {
    return {
      summary: copyForLanguage(language, {
        en: "Prepare an executive meeting brief with agenda focus, participant context, and suggested questions.",
        zh: "生成一份面向董事长的会议简报，包含议题重点、参会背景和建议追问。"
      }),
      doneCriteria: copyForLanguage(language, {
        en: [
          "Key participants are identified",
          "Decision points are visible",
          "Talking points and risks are easy to review"
        ],
        zh: ["关键参会方已识别", "关键决策点已明确", "发言要点和风险项便于审阅"]
      }),
      expectedArtifacts: ["meeting_brief", "question_pack", "risk_note"]
    };
  }

  if (workflowType === "deal") {
    return {
      summary: copyForLanguage(language, {
        en: "Produce a decision-ready deal assessment with risks, gaps, and recommendation posture.",
        zh: "生成一份可直接支持决策的交易评估，明确风险、缺口和建议立场。"
      }),
      doneCriteria: copyForLanguage(language, {
        en: [
          "Strategic fit is summarized",
          "Major risks are visible",
          "Recommendation posture is explicit"
        ],
        zh: ["战略契合度已总结", "主要风险已显式呈现", "建议立场已明确"]
      }),
      expectedArtifacts: ["deal_memo", "diligence_gaps", "recommendation_note"]
    };
  }

  if (workflowType === "content") {
    return {
      summary: copyForLanguage(language, {
        en: "Generate a publishable content draft with channel fit and release risk visibility.",
        zh: "生成一份可发布的内容草稿，并显式展示渠道适配与发布风险。"
      }),
      doneCriteria: copyForLanguage(language, {
        en: [
          "Audience and channel are reflected",
          "Draft is decision-ready",
          "Publication risks are visible"
        ],
        zh: ["受众和渠道已被纳入", "草稿已具备决策可读性", "发布风险已清晰可见"]
      }),
      expectedArtifacts: ["content_draft", "content_variants", "publishability_review"]
    };
  }

  return {
    summary: copyForLanguage(language, {
      en: "Wait for one clarifying input before building a workflow plan.",
      zh: "在生成工作流计划前，先等待一个关键澄清输入。"
    }),
    doneCriteria: copyForLanguage(language, {
      en: ["The missing workflow-defining context is provided"],
      zh: ["已补齐决定工作流所需的关键上下文"]
    }),
    expectedArtifacts: ["clarification_request"]
  };
}

export function buildDemoPlan(route: IntentRouterOutput, locale?: string): DemoPlan {
  const language = resolveLanguage(locale);
  const { summary, doneCriteria, expectedArtifacts } = buildSummary(route.workflowType, language);

  return {
    planId: `plan_${route.commandId}`,
    workflowType: route.workflowType,
    summary,
    doneCriteria,
    expectedArtifacts,
    steps: buildSteps(route.workflowType, language)
  };
}
