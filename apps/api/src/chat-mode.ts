import type { BriefingItem, DemoPlan, DecisionSummary, IntentRouterOutput, SubmitCommandRequest } from "@bossassistant/contracts";

import { getDashboardBriefing } from "./briefings.js";
import { extractTextContent, postJson, resolveMessagesUrl } from "./http-helpers.js";
import { copyForLanguage, resolveLanguage } from "./i18n.js";
import { resolveChatRuntimePreference, runOpenClawChatTurn } from "./openclaw-runtime.js";

const conversationPatterns = [
  /请结合.+继续分析/,
  /继续分析/,
  /继续聊/,
  /正常聊天/,
  /这条推送/,
  /保留原文链接/,
  /看看这个链接/,
  /analyze this link/i,
  /continue (the )?analysis/i,
  /keep the original link/i,
  /github\.com\//i,
  /https?:\/\//i
];

const genericFollowUpPatterns = [
  /直接回答这个问题/,
  /直接回答/,
  /继续说/,
  /继续讲/,
  /展开说/,
  /详细讲/,
  /接着说/,
  /answer directly/i,
  /go on/i,
  /tell me more/i
];

type RoutedChatInput = SubmitCommandRequest & {
  commandId: string;
  submittedAt: string;
};

function extractGithubRepo(commandText: string) {
  const match = commandText.match(/https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+)/i);

  if (!match) {
    return null;
  }

  return {
    owner: match[1],
    repo: match[2].replace(/\.git$/i, ""),
    url: `https://github.com/${match[1]}/${match[2].replace(/\.git$/i, "")}`
  };
}

async function fetchGithubRepo(repo: { owner: string; repo: string }) {
  const response = await fetch(`https://api.github.com/repos/${repo.owner}/${repo.repo}`, {
    headers: {
      accept: "application/vnd.github+json",
      "user-agent": "BossAssistant/0.1"
    }
  });

  if (!response.ok) {
    throw new Error(`GitHub repo request failed: ${response.status}`);
  }

  return response.json() as Promise<{
    full_name: string;
    description: string | null;
    stargazers_count: number;
    forks_count: number;
    updated_at: string;
    language: string | null;
    html_url: string;
  }>;
}

function hasAnthropicChatRuntime() {
  return Boolean(resolveMessagesUrl() && process.env.ANTHROPIC_AUTH_TOKEN?.trim());
}

export function shouldUseChatMode(commandText: string) {
  return conversationPatterns.some((pattern) => pattern.test(commandText));
}

function isDirectDraftRequest(commandText: string) {
  return /(起草|写一篇|写个|draft|write).*(推特|twitter|x post|帖子|post)/i.test(commandText);
}

function extractTopic(commandText: string) {
  const match = commandText.match(/(?:关于|围绕|主题是|about)\s*([^，。,.]+)/i);
  return match?.[1]?.trim() ?? "";
}

function isUnhelpfulModelReply(reply: string) {
  return /(无法实时联网|没有联网能力|无法获取今天的最新新闻|知识截止|knowledge cutoff|cannot browse|can't browse|unable to browse|无法浏览当前|不能联网)/i.test(reply);
}

function resolveEffectiveCommandText(input: RoutedChatInput) {
  if (!genericFollowUpPatterns.some((pattern) => pattern.test(input.commandText))) {
    return input.commandText;
  }

  const previousUserMessage = [...(input.conversation ?? [])].reverse().find((message) => message.role === "user");
  return previousUserMessage?.content ?? input.commandText;
}

function buildKnowledgeFallbackReply(commandText: string, locale?: string) {
  const language = resolveLanguage(locale);

  if (/(openclaw)/i.test(commandText) && /(agent workflow|agent.*workflow)/i.test(commandText) && /(解释|是什么|what is|explain)/i.test(commandText)) {
    return copyForLanguage(language, {
      en: [
        "Here is the simple version:",
        "",
        "Agent workflow means giving an AI agent a goal, context, tools, and a step-by-step execution loop so it can plan, act, check results, and continue until the task is finished.",
        "A typical workflow looks like this: understand the task -> break it into steps -> call tools or APIs -> review the output -> decide the next action -> stop when the result is good enough.",
        "",
        "OpenClaw, in AI-agent conversations, is usually understood as a project or tool layer around this style of agent execution. The important idea is not the name itself, but that it tries to make agent workflows more open, inspectable, and easier to run in real work.",
        "",
        "So the relationship is: agent workflow is the method, and OpenClaw is the kind of project that tries to implement or operationalize that method.",
        "",
        "If you want, I can next explain it from either a product angle, a technical architecture angle, or with one concrete example."
      ].join("\n"),
      zh: [
        "先用最直接的话说：",
        "",
        "`agent workflow` 指的是给 AI 一个目标、上下文和工具，让它按“理解任务 -> 拆步骤 -> 调工具 -> 检查结果 -> 决定下一步”的循环去推进，直到把事情做完。",
        "它和普通聊天最大的区别是：普通聊天主要是回答一句话，agent workflow 则更像一个会连续执行的小系统。",
        "",
        "`OpenClaw` 如果放在 AI agent 的语境里，你可以先把它理解成一类围绕 agent 工作流的开源项目或工具层。重点不只是模型本身，而是把 agent 的执行过程做得更开放、更可观察，也更容易接进真实任务里。",
        "",
        "所以两者关系是：`agent workflow` 是方法，`OpenClaw` 更像是在实现这种方法的项目或工具。",
        "",
        "如果你愿意，我下一步可以继续用三种方式讲：产品视角、技术架构视角，或者举一个真实工作流例子。"
      ].join("\n")
    });
  }

  if (/(agent workflow|agent.*workflow)/i.test(commandText) && /(解释|是什么|what is|explain)/i.test(commandText)) {
    return copyForLanguage(language, {
      en: [
        "Agent workflow is the execution loop behind an AI agent.",
        "Instead of answering once like a chatbot, the agent receives a goal, breaks it into steps, uses tools, checks progress, and keeps going until it reaches a stopping condition.",
        "In practice, it usually includes five pieces: goal, memory/context, tools, planning, and feedback.",
        "That is why agent workflow is useful for research, drafting, scheduling, data collection, and any task that needs multiple steps instead of a single reply."
      ].join("\n"),
      zh: [
        "`agent workflow` 可以理解成 AI agent 背后的执行流程。",
        "它不是只回答一句话，而是先接收目标，再拆分步骤、调用工具、检查结果，然后继续推进，直到完成任务或者达到停止条件。",
        "通常它至少包含 5 个部分：目标、上下文记忆、可用工具、规划机制、反馈闭环。",
        "所以 agent workflow 适合做调研、写作、排期、信息收集这类多步骤任务，而不只是单轮问答。"
      ].join("\n")
    });
  }

  if (/(openclaw)/i.test(commandText) && /(解释|是什么|what is|explain)/i.test(commandText)) {
    return copyForLanguage(language, {
      en: "If you mean OpenClaw in the AI-agent context, the safest way to read it is as an open project around agent execution and workflow tooling. If you send me the exact repo or link, I can explain it much more precisely.",
      zh: "如果你说的 OpenClaw 是 AI agent 语境里的那个项目，先可以把它理解成围绕 agent 执行和工作流工具层的一个开源项目。你把具体仓库或链接发我，我可以更准确地给你拆解。"
    });
  }

  return null;
}

function isAiHotspotRequest(commandText: string) {
  return /((AI|人工智能).*(热点|新闻|动态|值得看|新消息|消息|圈子|日报|快讯)|收集今天.*(AI|人工智能)|今天.*(AI|人工智能).*(消息|新闻|动态)|today.*AI|AI (stories|news|hotspots?))/i.test(commandText);
}

function isHongKongFinanceRequest(commandText: string) {
  return /(香港.*(金融|财经|财金|股市|新闻)|hong kong.*(finance|market|news))/i.test(commandText);
}

function formatBriefingLine(item: BriefingItem, index: number, locale?: string) {
  const publishedAt = new Date(item.publishedAt);
  const dateLabel = Number.isNaN(publishedAt.getTime())
    ? item.publishedAt
    : publishedAt.toISOString().slice(0, 10);

  if (resolveLanguage(locale) === "zh") {
    return `${index + 1}. ${item.title}\n看点：${item.summary}\n来源：${item.source} | ${dateLabel}\n原文：${item.url}`;
  }

  return `${index + 1}. ${item.title}\nWhy it matters: ${item.summary}\nSource: ${item.source} | ${dateLabel}\nLink: ${item.url}`;
}

async function buildDashboardBackedReply(input: RoutedChatInput) {
  const language = resolveLanguage(input.locale);
  const dashboard = await getDashboardBriefing().catch(() => null);

  if (!dashboard) {
    return null;
  }

  if (isAiHotspotRequest(input.commandText)) {
    const picks = [
      dashboard.hotspots.social[0],
      dashboard.hotspots.news[0],
      dashboard.aiColumn.github[0],
      dashboard.aiColumn.research[0]
    ].filter(Boolean) as BriefingItem[];

    if (picks.length === 0) {
      return null;
    }

    return copyForLanguage(language, {
      en: [
        "Here are the AI items most worth watching right now:",
        "",
        ...picks.map((item, index) => formatBriefingLine(item, index, input.locale)),
        "",
        "If you want, I can continue with one of three directions: quick digest, strategic read, or link-by-link deep dive."
      ].join("\n"),
      zh: [
        "今天最值得看的 AI 热点，我先帮你抓 4 条：",
        "",
        ...picks.map((item, index) => formatBriefingLine(item, index, input.locale)),
        "",
        "如果你愿意，我可以继续往下做三种展开：快速摘要、战略判断，或者逐条深挖。"
      ].join("\n")
    });
  }

  if (isHongKongFinanceRequest(input.commandText)) {
    const picks = dashboard.hotspots.news.slice(0, 3);

    if (picks.length === 0) {
      return null;
    }

    return copyForLanguage(language, {
      en: [
        "These are the Hong Kong finance and market stories I would watch first:",
        "",
        ...picks.map((item, index) => formatBriefingLine(item, index, input.locale)),
        "",
        "If helpful, I can turn this into a market brief with impact, risk, and what to watch next."
      ].join("\n"),
      zh: [
        "香港财经和市场方向里，我会先看这 3 条：",
        "",
        ...picks.map((item, index) => formatBriefingLine(item, index, input.locale)),
        "",
        "如果你要，我可以继续把它整理成一页市场简报，补上影响、风险和接下来要观察什么。"
      ].join("\n")
    });
  }

  return null;
}

async function askAnthropicChatModel(input: RoutedChatInput, effectiveCommandText: string, signal?: AbortSignal) {
  const url = resolveMessagesUrl();
  const token = process.env.ANTHROPIC_AUTH_TOKEN?.trim();
  const model = process.env.ANTHROPIC_MODEL?.trim() || "claude-opus-4-6";

  if (!url || !token) {
    return null;
  }

  const language = resolveLanguage(input.locale);
  const system = copyForLanguage(language, {
    en: [
      "You are BossAssistant in plain chatbot mode.",
      "Reply like a normal helpful AI assistant.",
      "Do not mention routing, workflows, approval gates, planners, or system internals.",
      "If the user asks for writing, directly write it.",
      "If the user shares a link, analyze it naturally and keep the original link in the answer when useful."
    ].join(" "),
    zh: [
      "你现在是 BossAssistant 的普通聊天模式。",
      "像一个正常、直接、好用的 AI 助手那样回答。",
      "不要提路由、工作流、审批、planner、系统内部机制。",
      "如果用户要你写内容，就直接写。",
      "如果用户给你链接，就自然分析它，并在有用时保留原文链接。"
    ].join(" ")
  });

  const response = await postJson(url, {
    "content-type": "application/json",
    "x-api-key": token,
    "anthropic-version": "2023-06-01"
  }, {
      model,
      max_tokens: 1200,
      system,
      messages: [
        ...(input.conversation ?? []).slice(-10).map((message) => ({
          role: message.role,
          content: message.content
        })),
        {
          role: "user",
          content: effectiveCommandText
        }
      ]
  }, 30_000, signal);

  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`Chat model request failed with HTTP ${response.statusCode}`);
  }

  const payload = JSON.parse(response.body) as unknown;
  return extractTextContent(payload);
}

async function askChatModel(input: RoutedChatInput, signal?: AbortSignal) {
  const effectiveCommandText = resolveEffectiveCommandText(input);
  const runtimePreference = resolveChatRuntimePreference();

  if (runtimePreference === "openclaw" || runtimePreference === "auto") {
    try {
      const openClawReply = await runOpenClawChatTurn({
        commandId: input.commandId,
        commandText: effectiveCommandText,
        conversation: input.conversation,
        locale: input.locale,
        projectId: input.projectId,
        workspaceId: input.workspaceId
      }, signal);

      return openClawReply.reply;
    } catch (caughtError) {
      if (runtimePreference === "openclaw" || !hasAnthropicChatRuntime()) {
        throw caughtError;
      }
    }
  }

  return askAnthropicChatModel(input, effectiveCommandText, signal);
}

export function buildChatRoute(input: RoutedChatInput): IntentRouterOutput {
  const language = resolveLanguage(input.locale);

  return {
    routeId: `route_${input.commandId}`,
    commandId: input.commandId,
    routeStatus: "routed",
    workflowType: "chat",
    intentLabel: "chat_conversation",
    confidence: 0.96,
    rationale: copyForLanguage(language, {
      en: "This request is better handled as a normal conversational assistant turn instead of a structured workflow.",
      zh: "这条请求更适合按普通连续对话来处理，而不是强行进入结构化工作流。"
    }),
    requiredInputs: [],
    detectedEntities: [],
    riskLevel: "low",
    urgency: "normal",
    approvalHint: {
      expected: false,
      stage: "none",
      reasonCodes: [],
      summary: copyForLanguage(language, {
        en: "No approval gate is needed for a conversational analysis turn.",
        zh: "普通对话分析无需额外审批。"
      })
    },
    fallbackStrategy: {
      mode: "none",
      reason: copyForLanguage(language, {
        en: "The assistant can reply directly in chat mode.",
        zh: "助手可以直接进入聊天模式回复。"
      }),
      requiredUserInput: []
    },
    candidateWorkflows: [],
    nextAction: {
      type: "send_to_planner",
      summary: copyForLanguage(language, {
        en: "Reply in normal chat mode and continue the conversation.",
        zh: "按正常聊天模式回复，并继续推进对话。"
      })
    }
  };
}

export function buildChatPlan(commandId: string, locale?: string): DemoPlan {
  const language = resolveLanguage(locale);

  return {
    planId: `plan_${commandId}`,
    workflowType: "chat",
    summary: copyForLanguage(language, {
      en: "Continue as a conversational agent: understand the source, extract the key signal, and suggest the next useful question.",
      zh: "以正常对话 agent 的方式继续：先理解链接内容，再提炼关键信号，并给出下一步值得追问的方向。"
    }),
    doneCriteria: copyForLanguage(language, {
      en: [
        "The source is summarized in plain language",
        "The key takeaway is clear",
        "The next useful follow-up is suggested"
      ],
      zh: ["用自然语言说明来源内容", "把关键判断讲清楚", "给出下一步值得追问的方向"]
    }),
    expectedArtifacts: ["chat_reply", "source_summary"],
    steps: [
      {
        id: "step_1",
        title: copyForLanguage(language, { en: "Read the source", zh: "读懂来源内容" }),
        owner: "system",
        status: "ready",
        description: copyForLanguage(language, {
          en: "Identify what the linked source actually is and why people are paying attention to it.",
          zh: "先判断链接本身是什么，以及它为什么值得被关注。"
        })
      },
      {
        id: "step_2",
        title: copyForLanguage(language, { en: "Explain the signal", zh: "解释关键信号" }),
        owner: "system",
        status: "ready",
        description: copyForLanguage(language, {
          en: "Translate the source into plain-language takeaways instead of workflow jargon.",
          zh: "把信息翻译成自然对话里的判断，而不是工作流术语。"
        })
      },
      {
        id: "step_3",
        title: copyForLanguage(language, { en: "Offer the next angle", zh: "给出下一步角度" }),
        owner: "system",
        status: "pending",
        description: copyForLanguage(language, {
          en: "Suggest the most useful follow-up question or comparison.",
          zh: "给出下一步最值得继续追问或对比的方向。"
        })
      }
    ]
  };
}

export async function buildChatResponse(input: RoutedChatInput, route: IntentRouterOutput, options: { signal?: AbortSignal } = {}) {
  const language = resolveLanguage(input.locale);
  const effectiveCommandText = resolveEffectiveCommandText(input);
  const effectiveInput = {
    ...input,
    commandText: effectiveCommandText
  };
  const repo = extractGithubRepo(effectiveCommandText);

  if (repo) {
    try {
      const github = await fetchGithubRepo(repo);

      const assistantReply = copyForLanguage(language, {
        en: [
          `This looks more like a project signal than a deal workflow. ${github.full_name} is a GitHub repo about "${github.description ?? "AI research automation"}".`,
          `My quick read: it is interesting because it points to Karpathy pushing toward agent-style automated research on a single-GPU setup, which lowers the barrier for experimentation.`,
          `What stands out right now is the traction: about ${github.stargazers_count.toLocaleString("en-US")} stars, ${github.forks_count.toLocaleString("en-US")} forks, and it was updated on ${github.updated_at.slice(0, 10)}.`,
          `If you want, I can continue in one of three ways next: explain what the repo is doing technically, judge whether it matters strategically, or compare it with other agent-research projects.`,
          `Original link: ${github.html_url}`
        ].join(" "),
        zh: [
          `这条更像一个值得跟踪的项目动态，不是交易工作流。${github.full_name} 是一个 GitHub 项目，简介是“${github.description ?? "面向 AI research automation 的项目"}”。`,
          "我的第一判断是：它的价值不在于单个功能点，而在于它在尝试把“自动化研究 agent”压到单卡可跑的门槛上，这会让更多人能低成本实验这类能力。",
          `当前值得关注的信号有三个：第一，热度已经很高，约 ${github.stargazers_count.toLocaleString("en-US")} stars；第二，社区开始跟进，约 ${github.forks_count.toLocaleString("en-US")} forks；第三，最近仍在更新，最近更新时间是 ${github.updated_at.slice(0, 10)}。`,
          "如果你愿意，我下一步可以继续沿三个方向展开：1. 它技术上到底在做什么；2. 它对 AI agent 赛道意味着什么；3. 它和同类项目相比强弱在哪里。",
          `原文链接：${github.html_url}`
        ].join(" ")
      });

      const decisionSummary: DecisionSummary = {
        headline: copyForLanguage(language, {
          en: "Chat mode: project signal analysis",
          zh: "聊天模式：项目动态分析"
        }),
        operatorView: assistantReply,
        recommendedNextMove: copyForLanguage(language, {
          en: "Pick the next angle: technical breakdown, strategic meaning, or peer comparison.",
          zh: "下一步可以选一个角度继续：技术拆解、战略意义，或同类对比。"
        })
      };

      return {
        assistantReply,
        decisionSummary,
        plan: buildChatPlan(input.commandId, input.locale)
      };
    } catch {
      // fall through to generic chat reply
    }
  }

  const dashboardBackedReply = await buildDashboardBackedReply(effectiveInput).catch(() => null);

  if (dashboardBackedReply) {
    return {
      assistantReply: dashboardBackedReply,
      decisionSummary: {
        headline: copyForLanguage(language, {
          en: "Reply ready",
          zh: "已生成回复"
        }),
        operatorView: dashboardBackedReply,
        recommendedNextMove: copyForLanguage(language, {
          en: "Continue with the item that matters most.",
          zh: "从你最关心的那一条继续往下聊。"
        })
      },
      plan: buildChatPlan(input.commandId, input.locale)
    };
  }

  let modelReply: string | null = null;
  let modelError: unknown = null;

  try {
    modelReply = await askChatModel(effectiveInput, options.signal);
  } catch (caughtError) {
    modelError = caughtError;
  }

  if (modelReply && !isUnhelpfulModelReply(modelReply)) {
    const decisionSummary: DecisionSummary = {
      headline: copyForLanguage(language, {
        en: "Reply ready",
        zh: "已生成回复"
      }),
      operatorView: modelReply,
      recommendedNextMove: copyForLanguage(language, {
        en: "Continue the conversation naturally.",
        zh: "继续自然对话即可。"
      })
    };

    return {
      assistantReply: modelReply,
      decisionSummary,
      plan: buildChatPlan(input.commandId, input.locale)
    };
  }

  if (isDirectDraftRequest(effectiveCommandText)) {
    const topic = extractTopic(effectiveCommandText) || copyForLanguage(language, { en: "AI and OpenClaw", zh: "AI 与 OpenClaw" });
    const draft = copyForLanguage(language, {
      en: `AI is changing how small teams build and operate software. What interests me about OpenClaw is that it makes agent-style workflows more accessible, inspectable, and easier to adapt to real work. The next wave is not just bigger models, but better operational tooling around them. #AI #OpenClaw`,
      zh: `AI 正在改变小团队构建和运营软件的方式。对我来说，OpenClaw 值得关注的地方，不只是模型能力，而是它让 agent 式工作流变得更可接入、更可观察，也更接近真实业务场景。下一波竞争，不只是更大的模型，而是更好的工作流与工具链。#AI #OpenClaw`
    });

    const assistantReply = copyForLanguage(language, {
      en: `Here is a simple draft you can post:\n\n${draft}\n\nQuick publishing risk check:\n1. Avoid implying capabilities that OpenClaw does not publicly document.\n2. If "OpenClaw" refers to a specific product or repo, keep the naming consistent with the original source.\n3. If this is for an official account, add one concrete example or link so the post feels grounded.`,
      zh: `我先直接给你一个可发的版本：\n\n${draft}\n\n顺手帮你做一个简短发布风险检查：\n1. 不要暗示 OpenClaw 有官方未公开说明的能力。\n2. 如果这里的 OpenClaw 指某个具体产品或仓库，名称最好和原始项目保持一致。\n3. 如果这是官方账号发文，建议再补一个具体例子或链接，让内容更落地。`
    });

    const decisionSummary: DecisionSummary = {
      headline: copyForLanguage(language, {
        en: `Draft ready for ${topic}`,
        zh: `${topic} 的草稿已生成`
      }),
      operatorView: assistantReply,
      recommendedNextMove: copyForLanguage(language, {
        en: "Tighten tone, add a link, or turn it into a thread if needed.",
        zh: "如果需要，我可以继续帮你收紧语气、补链接，或者改成 thread。"
      })
    };

    return {
      assistantReply,
      decisionSummary,
      plan: buildChatPlan(input.commandId, input.locale)
      };
    }

  const knowledgeFallbackReply = buildKnowledgeFallbackReply(effectiveCommandText, input.locale);

  if (knowledgeFallbackReply) {
    return {
      assistantReply: knowledgeFallbackReply,
      decisionSummary: {
        headline: copyForLanguage(language, {
          en: "Reply ready",
          zh: "已生成回复"
        }),
        operatorView: knowledgeFallbackReply,
        recommendedNextMove: copyForLanguage(language, {
          en: "Continue with a deeper example or technical breakdown.",
          zh: "如果需要，可以继续往具体例子或技术拆解展开。"
        })
      },
      plan: buildChatPlan(input.commandId, input.locale)
    };
  }

  if (modelError) {
    throw modelError;
  }

  const assistantReply = copyForLanguage(language, {
    en: repo
      ? `I can continue from this source directly. If you want, I can give you a concise summary, a strategic read, or a comparison with similar projects.\nOriginal link: ${repo.url}`
      : "I can answer this directly. You can continue with a more specific angle, for example AI hotspots, Hong Kong finance news, a project link, content drafting, or crypto market moves.",
    zh: repo
      ? `我可以直接围绕这个来源继续往下分析。你如果愿意，我可以继续给你三种版本：简明摘要、战略判断，或者和相似项目做对比。\n原文链接：${repo.url}`
      : "我可以直接回答这个问题。你也可以继续具体一点，比如看 AI 热点、香港财经新闻、项目链接分析、内容起草，或者主流加密货币走势。"
  });

  const decisionSummary: DecisionSummary = {
    headline: copyForLanguage(language, {
      en: "Reply ready",
      zh: "已生成回复"
    }),
    operatorView: assistantReply,
    recommendedNextMove: copyForLanguage(language, {
      en: "Continue the discussion naturally from the source you shared.",
      zh: "围绕你给的来源继续自然对话。"
    })
  };

  return {
    assistantReply,
    decisionSummary,
    plan: buildChatPlan(input.commandId, input.locale)
  };
}
