import { spawn } from "node:child_process";
import process from "node:process";

import type { ChatMessage } from "@bossassistant/contracts";

import { copyForLanguage, resolveLanguage } from "./i18n.js";

export type ChatRuntimePreference = "anthropic" | "openclaw" | "auto";

type OpenClawToolCall = {
  name: string;
  args: Record<string, unknown>;
};

type OpenClawPayload = {
  response: string;
  connected: boolean;
  toolCalls: OpenClawToolCall[];
};

type OpenClawChatInput = {
  commandText: string;
  conversation?: ChatMessage[];
  locale?: string;
  workspaceId?: string;
  projectId?: string;
  commandId: string;
};

function normalizeToolCalls(payload: unknown) {
  if (!Array.isArray(payload)) {
    return [];
  }

  return payload
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }

      const candidate = item as {
        name?: unknown;
        id?: unknown;
        tool?: unknown;
        args?: unknown;
        parameters?: unknown;
        changes?: unknown;
      };

      const nameCandidate = candidate.name ?? candidate.id ?? candidate.tool;

      if (typeof nameCandidate !== "string" || !nameCandidate.trim()) {
        return null;
      }

      const argsCandidate = candidate.args ?? candidate.parameters ?? candidate.changes;

      return {
        name: nameCandidate.trim(),
        args: argsCandidate && typeof argsCandidate === "object" && !Array.isArray(argsCandidate)
          ? (argsCandidate as Record<string, unknown>)
          : {}
      };
    })
    .filter((item): item is OpenClawToolCall => Boolean(item));
}

function normalizeAgentResponsePayload(payload: unknown, fallbackText = ""): OpenClawPayload | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const root = payload as {
    result?: unknown;
    meta?: unknown;
    toolCalls?: unknown;
    response?: unknown;
    message?: unknown;
    payloads?: Array<{ text?: unknown }>;
  };

  const result = root.result && typeof root.result === "object"
    ? (root.result as {
        payloads?: Array<{ text?: unknown }>;
        response?: unknown;
        message?: unknown;
        toolCalls?: unknown;
      })
    : root;

  const responseFromPayloads = Array.isArray(result.payloads)
    ? result.payloads
        .map((item) => (typeof item?.text === "string" ? item.text : ""))
        .filter(Boolean)
        .join("\n\n")
    : "";

  const response = typeof result.response === "string"
    ? result.response
    : typeof result.message === "string"
      ? result.message
      : responseFromPayloads || fallbackText;

  return {
    response: String(response || fallbackText).trim(),
    connected: true,
    toolCalls: normalizeToolCalls(result.toolCalls ?? root.toolCalls ?? [])
  };
}

function parseOpenClawJsonOutput(stdout: string) {
  const trimmed = String(stdout || "").trim();

  if (!trimmed) {
    return null;
  }

  const candidates: string[] = [];

  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    candidates.push(trimmed);
  }

  const broadMatch = trimmed.match(/\{[\s\S]*\}/);

  if (broadMatch?.[0] && !candidates.includes(broadMatch[0])) {
    candidates.push(broadMatch[0]);
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      const normalized = normalizeAgentResponsePayload(parsed, trimmed);

      if (normalized) {
        return normalized;
      }
    } catch {
      // keep trying the next candidate
    }
  }

  return null;
}

function buildSessionId(input: OpenClawChatInput) {
  const prefix = process.env.OPENCLAW_SESSION_PREFIX?.trim() || "jackclaw-os";
  const workspacePart = (input.workspaceId || "default").replace(/[^\w-]+/g, "-");
  const projectPart = (input.projectId || "chat").replace(/[^\w-]+/g, "-");

  return `${prefix}-${workspacePart}-${projectPart}`;
}

function buildSystemInstruction(locale?: string) {
  const language = resolveLanguage(locale);

  return copyForLanguage(language, {
    en: [
      "You are JackClaw OS in plain chatbot mode.",
      "Reply like a normal, direct, useful AI assistant.",
      "Do not mention routing, workflows, planners, approval gates, or internal system mechanics.",
      "Do not say you cannot browse unless the user explicitly asks for a live source that is unavailable.",
      "If the user asks for writing, produce the writing directly.",
      "If the user shares a link, analyze it naturally and keep the original link when useful."
    ].join(" "),
    zh: [
      "你现在是 JackClaw OS 的普通聊天助手。",
      "像一个正常、直接、自然、好用的 AI 助手那样回答。",
      "不要提路由、工作流、planner、审批、系统内部机制。",
      "除非用户明确要求一个当前拿不到的实时来源，否则不要说你不能联网。",
      "如果用户要写内容，就直接给成品。",
      "如果用户给你链接，就自然分析它，并在有用时保留原文链接。"
    ].join(" ")
  });
}

function buildContextualMessage(input: OpenClawChatInput) {
  const conversationLines = (input.conversation ?? [])
    .slice(-8)
    .map((message) => `${message.role === "user" ? "User" : "Assistant"}: ${message.content}`)
    .join("\n");

  const segments = [
    buildSystemInstruction(input.locale)
  ];

  if (conversationLines) {
    segments.push("Recent conversation:");
    segments.push(conversationLines);
  }

  segments.push("Current user message:");
  segments.push(input.commandText);
  segments.push("Reply with the final assistant answer only.");

  return segments.join("\n\n");
}

export function resolveChatRuntimePreference(): ChatRuntimePreference {
  const value = process.env.BOSSASSISTANT_CHAT_RUNTIME?.trim().toLowerCase();

  if (value === "openclaw" || value === "auto" || value === "anthropic") {
    return value;
  }

  return "anthropic";
}

export function getOpenClawRuntimeDescriptor() {
  return {
    bin: process.env.OPENCLAW_BIN?.trim() || "openclaw",
    agentId: process.env.OPENCLAW_AGENT_ID?.trim() || null,
    timeoutMs: Number(process.env.OPENCLAW_TIMEOUT_MS ?? 120_000),
    sessionPrefix: process.env.OPENCLAW_SESSION_PREFIX?.trim() || "jackclaw-os"
  };
}

export function isAbortError(caughtError: unknown) {
  return caughtError instanceof Error && caughtError.name === "AbortError";
}

export async function runOpenClawChatTurn(input: OpenClawChatInput, signal?: AbortSignal) {
  const descriptor = getOpenClawRuntimeDescriptor();
  const sessionId = buildSessionId(input);
  const contextualMessage = buildContextualMessage(input);

  return new Promise<{ reply: string; sessionId: string; toolCalls: OpenClawToolCall[] }>((resolve, reject) => {
    const args = ["agent"];

    if (descriptor.agentId) {
      args.push("--agent", descriptor.agentId);
    }

    args.push("--session-id", sessionId, "--message", contextualMessage, "--json", "--thinking", "off");

    const child = spawn(descriptor.bin, args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    let timeout: NodeJS.Timeout | null = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`OpenClaw runtime timed out after ${descriptor.timeoutMs}ms`));
    }, descriptor.timeoutMs);

    const cleanup = () => {
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }

      if (signal) {
        signal.removeEventListener("abort", onAbort);
      }
    };

    const finish = (callback: () => void) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      callback();
    };

    const onAbort = () => {
      try {
        child.kill("SIGTERM");
      } catch {
        // ignore
      }

      finish(() => {
        const error = new Error("OpenClaw chat request aborted");
        error.name = "AbortError";
        reject(error);
      });
    };

    if (signal?.aborted) {
      onAbort();
      return;
    }

    signal?.addEventListener("abort", onAbort, { once: true });

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      finish(() => {
        reject(error);
      });
    });

    child.on("close", (code) => {
      finish(() => {
        const parsed = parseOpenClawJsonOutput(stdout);

        if (parsed?.response) {
          resolve({
            reply: parsed.response,
            sessionId,
            toolCalls: parsed.toolCalls
          });
          return;
        }

        const fallbackText = stdout.trim();

        if (code === 0 && fallbackText) {
          resolve({
            reply: fallbackText,
            sessionId,
            toolCalls: []
          });
          return;
        }

        reject(new Error(stderr.trim() || fallbackText || `OpenClaw exited with code ${code ?? "unknown"}`));
      });
    });
  });
}
