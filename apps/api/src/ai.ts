import http from "node:http";
import https from "node:https";
import { z } from "zod";

import type { DecisionSummary, DemoPlan, IntentRouterOutput, SubmitCommandRequest } from "@bossassistant/contracts";

import { copyForLanguage, resolveLanguage } from "./i18n.js";

const aiEnhancementSchema = z.object({
  assistantReply: z.string().min(1),
  decisionSummary: z.object({
    headline: z.string().min(1),
    operatorView: z.string().min(1),
    recommendedNextMove: z.string().min(1)
  }),
  plan: z.object({
    summary: z.string().min(1),
    doneCriteria: z.array(z.string().min(1)).min(1).max(5),
    steps: z.array(
      z.object({
        title: z.string().min(1),
        description: z.string().min(1)
      })
    ).min(1).max(5)
  })
});

type AiEnhancement = z.infer<typeof aiEnhancementSchema>;

function resolveMessagesUrl() {
  const baseUrl = process.env.ANTHROPIC_BASE_URL?.trim();

  if (!baseUrl) {
    return null;
  }

  return new URL(
    baseUrl.endsWith("/v1") || baseUrl.endsWith("/v1/")
      ? `${baseUrl.replace(/\/$/, "")}/messages`
      : `${baseUrl.replace(/\/$/, "")}/v1/messages`
  ).toString();
}

function extractTextContent(payload: unknown) {
  const parsed = z.object({
    content: z.array(
      z.object({
        type: z.string(),
        text: z.string().optional()
      })
    )
  }).safeParse(payload);

  if (!parsed.success) {
    return null;
  }

  return parsed.data.content
    .filter((item) => item.type === "text" && item.text)
    .map((item) => item.text)
    .join("\n")
    .trim();
}

function extractJsonBlock(text: string) {
  const fencedMatch = text.match(/```json\s*([\s\S]*?)```/i);

  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");

  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return text.slice(firstBrace, lastBrace + 1);
  }

  return text;
}

function normalizeJsonCandidate(text: string) {
  return text
    .replace(/[“”]/g, "\"")
    .replace(/[‘’]/g, "'")
    .replace(/\u00a0/g, " ")
    .replace(/,\s*([}\]])/g, "$1")
    .trim();
}

function parseAiEnhancement(text: string) {
  const candidates = [
    extractJsonBlock(text),
    normalizeJsonCandidate(extractJsonBlock(text)),
    normalizeJsonCandidate(text)
  ];

  let lastError: unknown;

  for (const candidate of candidates) {
    try {
      return aiEnhancementSchema.parse(JSON.parse(candidate)) as AiEnhancement;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Unable to parse AI enhancement JSON");
}

async function postJson(urlString: string, headers: Record<string, string>, payload: unknown) {
  const url = new URL(urlString);
  const body = JSON.stringify(payload);
  const transport = url.protocol === "http:" ? http : https;

  return new Promise<{ statusCode: number; body: string }>((resolve, reject) => {
    const request = transport.request(
      url,
      {
        method: "POST",
        headers: {
          ...headers,
          "content-length": Buffer.byteLength(body).toString()
        }
      },
      (response) => {
        const chunks: Buffer[] = [];

        response.on("data", (chunk) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });

        response.on("end", () => {
          resolve({
            statusCode: response.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8")
          });
        });
      }
    );

    request.on("error", reject);
    request.write(body);
    request.end();
  });
}

function buildSystemPrompt(locale?: string) {
  const language = resolveLanguage(locale);

  return copyForLanguage(language, {
    en: [
      "You are the BossAssistant executive operations agent.",
      "Your job is to improve an already-classified workflow run without changing its safety posture.",
      "Keep the same workflow type, route status, approval posture, and next-action intent.",
      "Respond like an agentic chief-of-staff style chatbot that can operate on behalf of the user.",
      "Write concise, decision-ready business language that sounds proactive and operational.",
      "Return JSON only."
    ].join(" "),
    zh: [
      "你是 BossAssistant 的高管运营 agent。",
      "你的任务是在不改变安全姿态的前提下，增强一条已经完成分类的 workflow run。",
      "必须保持相同的 workflow type、route status、approval posture 和 next-action intent。",
      "回复要像一个能代替用户推进工作的高管助理 chatbot，语气主动、可执行、面向操作。",
      "只返回 JSON。"
    ].join(" ")
  });
}

function buildUserPrompt(input: SubmitCommandRequest, route: IntentRouterOutput, plan: DemoPlan, summary: DecisionSummary) {
  const language = resolveLanguage(input.locale);
  const instruction = copyForLanguage(language, {
    en: "Write a conversational assistant reply for the user, and rewrite the decision summary and plan so they feel more like a strong executive assistant, while remaining faithful to the provided route and safety posture.",
    zh: "请先给用户写一段自然对话式回复，再在严格遵守现有 route 与安全姿态的前提下，重写 decision summary 和 plan，让它更像一位强执行力的高管助理。"
  });

  return [
    instruction,
    "",
    "JSON schema:",
    JSON.stringify({
      assistantReply: "string",
      decisionSummary: {
        headline: "string",
        operatorView: "string",
        recommendedNextMove: "string"
      },
      plan: {
        summary: "string",
        doneCriteria: ["string"],
        steps: [
          {
            title: "string",
            description: "string"
          }
        ]
      }
    }, null, 2),
    "",
    "Prior conversation:",
    JSON.stringify(input.conversation ?? [], null, 2),
    "",
    "Current input:",
    JSON.stringify(input, null, 2),
    "",
    "Current route:",
    JSON.stringify(route, null, 2),
    "",
    "Current decision summary:",
    JSON.stringify(summary, null, 2),
    "",
    "Current plan:",
    JSON.stringify(plan, null, 2)
  ].join("\n");
}

export function isAiEnhancementEnabled() {
  const flag = process.env.BOSSASSISTANT_ENABLE_AI?.trim().toLowerCase();

  if (flag === "0" || flag === "false" || flag === "off") {
    return false;
  }

  return Boolean(resolveMessagesUrl() && process.env.ANTHROPIC_AUTH_TOKEN?.trim());
}

export async function maybeEnhanceRunWithAi(input: SubmitCommandRequest, route: IntentRouterOutput, plan: DemoPlan, decisionSummary: DecisionSummary) {
  const url = resolveMessagesUrl();
  const token = process.env.ANTHROPIC_AUTH_TOKEN?.trim();
  const model = process.env.ANTHROPIC_MODEL?.trim() || "claude-opus-4-6";

  if (!isAiEnhancementEnabled() || !url || !token) {
    return null;
  }

  const response = await postJson(url, {
    "content-type": "application/json",
    "x-api-key": token,
    "anthropic-version": "2023-06-01"
  }, {
    model,
    max_tokens: 900,
    system: buildSystemPrompt(input.locale),
    messages: [
      {
        role: "user",
        content: buildUserPrompt(input, route, plan, decisionSummary)
      }
    ]
  });

  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`AI enhancement failed with HTTP ${response.statusCode}: ${response.body}`);
  }

  const payload = JSON.parse(response.body) as unknown;
  const text = extractTextContent(payload);

  if (!text) {
    throw new Error("AI enhancement returned no text content");
  }

  const enhancement = parseAiEnhancement(text);

  return {
    assistantReply: enhancement.assistantReply,
    decisionSummary: enhancement.decisionSummary,
    plan: {
      ...plan,
      summary: enhancement.plan.summary,
      doneCriteria: enhancement.plan.doneCriteria,
      steps: plan.steps.map((step, index) => {
        const rewritten = enhancement.plan.steps[index];

        if (!rewritten) {
          return step;
        }

        return {
          ...step,
          title: rewritten.title,
          description: rewritten.description
        };
      })
    }
  };
}
