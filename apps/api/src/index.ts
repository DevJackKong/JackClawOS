import { existsSync } from "node:fs";
import process from "node:process";
import { fileURLToPath } from "node:url";

import cors from "cors";
import express from "express";
import { z } from "zod";

import {
  dashboardBriefingSchema,
  consoleBootstrapResponseSchema,
  listInspirationNotesResponseSchema,
  listRunsResponseSchema,
  listSocialEventsResponseSchema,
  listTasksResponseSchema,
  submitCommandRequestSchema,
  submitCommandResponseSchema,
  type ChatMessage,
  type SubmitCommandResponse
} from "@bossassistant/contracts";

import { isAiEnhancementEnabled } from "./ai.js";
import { getDashboardBriefing } from "./briefings.js";
import { buildChatPlan, buildChatResponse, buildChatRoute } from "./chat-mode.js";
import { buildCockpitState } from "./cockpit.js";
import { getOpenClawRuntimeDescriptor, isAbortError, resolveChatRuntimePreference } from "./openclaw-runtime.js";
import { runStore } from "./run-store.js";
import { parseTaskCommand } from "./task-ops.js";
import { copyForLanguage, resolveLanguage } from "./i18n.js";

const envFilePath = fileURLToPath(new URL("../../../.env.local", import.meta.url));

if (typeof process.loadEnvFile === "function" && existsSync(envFilePath)) {
  process.loadEnvFile(envFilePath);
}

const cryptoAssets = [
  { id: "bitcoin", symbol: "BTC", name: "Bitcoin" },
  { id: "ethereum", symbol: "ETH", name: "Ethereum" },
  { id: "solana", symbol: "SOL", name: "Solana" },
  { id: "binancecoin", symbol: "BNB", name: "BNB" },
  { id: "ripple", symbol: "XRP", name: "XRP" },
  { id: "dogecoin", symbol: "DOGE", name: "Dogecoin" }
] as const;

type CryptoMarketSnapshot = {
  refreshedAt: string;
  quotes: Array<{
    id: string;
    symbol: string;
    name: string;
    priceUsd: number;
    change24h: number;
  }>;
};

let cryptoMarketCache: CryptoMarketSnapshot | null = null;
let cryptoMarketCacheExpiresAt = 0;

async function getCryptoMarketSnapshot(forceRefresh = false): Promise<CryptoMarketSnapshot> {
  const now = Date.now();

  if (!forceRefresh && cryptoMarketCache && cryptoMarketCacheExpiresAt > now) {
    return cryptoMarketCache;
  }

  const response = await fetch(
    `https://api.coingecko.com/api/v3/simple/price?ids=${cryptoAssets.map((asset) => asset.id).join(",")}&vs_currencies=usd&include_24hr_change=true`
  );

  if (!response.ok) {
    if (cryptoMarketCache) {
      return cryptoMarketCache;
    }

    throw new Error(`crypto_market_fetch_failed:${response.status}`);
  }

  const payload = (await response.json()) as Record<string, { usd?: number; usd_24h_change?: number }>;
  const snapshot: CryptoMarketSnapshot = {
    refreshedAt: new Date().toISOString(),
    quotes: cryptoAssets.map((asset) => ({
      id: asset.id,
      symbol: asset.symbol,
      name: asset.name,
      priceUsd: Number(payload[asset.id]?.usd ?? 0),
      change24h: Number(payload[asset.id]?.usd_24h_change ?? 0)
    }))
  };

  cryptoMarketCache = snapshot;
  cryptoMarketCacheExpiresAt = now + 60_000;
  return snapshot;
}

const app = express();
const port = Number(process.env.PORT ?? 8787);

app.use(cors());
app.use(express.json());

app.get("/api/health", (_request, response) => {
  const chatRuntime = resolveChatRuntimePreference();
  const openClawRuntime = getOpenClawRuntimeDescriptor();

  response.json({
    ok: true,
    service: "bossassistant-api",
    timestamp: new Date().toISOString(),
    persistence: "sqlite",
    aiEnabled: chatRuntime === "openclaw"
      ? true
      : Boolean(process.env.ANTHROPIC_AUTH_TOKEN?.trim() && process.env.ANTHROPIC_BASE_URL?.trim()),
    aiEnhancementEnabled: isAiEnhancementEnabled(),
    chatRuntime,
    aiModel: chatRuntime === "openclaw"
      ? openClawRuntime.agentId || openClawRuntime.bin
      : process.env.ANTHROPIC_MODEL?.trim() || null
  });
});

app.get("/api/runs", (request, response) => {
  const requestedLimit = Number(request.query.limit ?? 8);
  const runs = runStore.listRuns(Number.isFinite(requestedLimit) ? requestedLimit : 8);
  response.json(listRunsResponseSchema.parse({ runs }));
});

app.get("/api/tasks", (_request, response) => {
  response.json(listTasksResponseSchema.parse({ tasks: runStore.listTasks() }));
});

app.get("/api/social-events", (_request, response) => {
  response.json(listSocialEventsResponseSchema.parse({ socialEvents: runStore.listSocialEvents() }));
});

app.get("/api/inspirations", (_request, response) => {
  response.json(listInspirationNotesResponseSchema.parse({ inspirationNotes: runStore.listInspirationNotes() }));
});

app.post("/api/tasks", (request, response) => {
  const parsed = z.object({
    title: z.string().min(1),
    detail: z.string().optional(),
    startAt: z.string(),
    endAt: z.string(),
    status: submitCommandResponseSchema.shape.tasks.element.shape.status.optional()
  }).safeParse(request.body);

  if (!parsed.success) {
    response.status(400).json({
      error: "invalid_task_request",
      issues: parsed.error.issues
    });
    return;
  }

  runStore.createTask({
    title: parsed.data.title,
    detail: parsed.data.detail ?? "",
    status: parsed.data.status ?? "pending",
    source: "manual",
    startAt: parsed.data.startAt,
    endAt: parsed.data.endAt
  });

  response.json(listTasksResponseSchema.parse({ tasks: runStore.listTasks() }));
});

app.patch("/api/tasks/:taskId", (request, response) => {
  const parsed = submitCommandResponseSchema.shape.tasks.element
    .pick({
      title: true,
      detail: true,
      status: true,
      startAt: true,
      endAt: true
    })
    .partial()
    .safeParse(request.body);

  if (!parsed.success) {
    response.status(400).json({
      error: "invalid_task_patch",
      issues: parsed.error.issues
    });
    return;
  }

  const updated = runStore.updateTask(request.params.taskId, parsed.data);

  if (!updated) {
    response.status(404).json({
      error: "task_not_found"
    });
    return;
  }

  response.json(listTasksResponseSchema.parse({ tasks: runStore.listTasks() }));
});

app.delete("/api/tasks/:taskId", (request, response) => {
  const deleted = runStore.deleteTask(request.params.taskId);

  if (!deleted) {
    response.status(404).json({
      error: "task_not_found"
    });
    return;
  }

  response.json(listTasksResponseSchema.parse({ tasks: runStore.listTasks() }));
});

app.post("/api/social-events", (request, response) => {
  const parsed = z.object({
    title: z.string().min(1),
    detail: z.string().optional(),
    location: z.string().optional(),
    startAt: z.string(),
    endAt: z.string(),
    remindMinutes: z.number().int().nonnegative().optional(),
    status: z.enum(["planned", "done", "cancelled"]).optional()
  }).safeParse(request.body);

  if (!parsed.success) {
    response.status(400).json({
      error: "invalid_social_event_request",
      issues: parsed.error.issues
    });
    return;
  }

  runStore.createSocialEvent(parsed.data);
  response.json(listSocialEventsResponseSchema.parse({ socialEvents: runStore.listSocialEvents() }));
});

app.patch("/api/social-events/:eventId", (request, response) => {
  const parsed = z.object({
    title: z.string().min(1).optional(),
    detail: z.string().optional(),
    location: z.string().optional(),
    startAt: z.string().optional(),
    endAt: z.string().optional(),
    remindMinutes: z.number().int().nonnegative().optional(),
    status: z.enum(["planned", "done", "cancelled"]).optional()
  }).safeParse(request.body);

  if (!parsed.success) {
    response.status(400).json({
      error: "invalid_social_event_patch",
      issues: parsed.error.issues
    });
    return;
  }

  const updated = runStore.updateSocialEvent(request.params.eventId, parsed.data);

  if (!updated) {
    response.status(404).json({
      error: "social_event_not_found"
    });
    return;
  }

  response.json(listSocialEventsResponseSchema.parse({ socialEvents: runStore.listSocialEvents() }));
});

app.delete("/api/social-events/:eventId", (request, response) => {
  const deleted = runStore.deleteSocialEvent(request.params.eventId);

  if (!deleted) {
    response.status(404).json({
      error: "social_event_not_found"
    });
    return;
  }

  response.json(listSocialEventsResponseSchema.parse({ socialEvents: runStore.listSocialEvents() }));
});

app.post("/api/inspirations", (request, response) => {
  const parsed = z.object({
    title: z.string().min(1),
    content: z.string().min(1),
    source: z.string().optional(),
    tag: z.string().optional()
  }).safeParse(request.body);

  if (!parsed.success) {
    response.status(400).json({
      error: "invalid_inspiration_request",
      issues: parsed.error.issues
    });
    return;
  }

  runStore.createInspirationNote(parsed.data);
  response.json(listInspirationNotesResponseSchema.parse({ inspirationNotes: runStore.listInspirationNotes() }));
});

app.patch("/api/inspirations/:noteId", (request, response) => {
  const parsed = z.object({
    title: z.string().min(1).optional(),
    content: z.string().min(1).optional(),
    source: z.string().optional(),
    tag: z.string().optional()
  }).safeParse(request.body);

  if (!parsed.success) {
    response.status(400).json({
      error: "invalid_inspiration_patch",
      issues: parsed.error.issues
    });
    return;
  }

  const updated = runStore.updateInspirationNote(request.params.noteId, parsed.data);

  if (!updated) {
    response.status(404).json({
      error: "inspiration_note_not_found"
    });
    return;
  }

  response.json(listInspirationNotesResponseSchema.parse({ inspirationNotes: runStore.listInspirationNotes() }));
});

app.delete("/api/inspirations/:noteId", (request, response) => {
  const deleted = runStore.deleteInspirationNote(request.params.noteId);

  if (!deleted) {
    response.status(404).json({
      error: "inspiration_note_not_found"
    });
    return;
  }

  response.json(listInspirationNotesResponseSchema.parse({ inspirationNotes: runStore.listInspirationNotes() }));
});

app.get("/api/dashboard", async (request, response) => {
  const forceRefresh = request.query.refresh === "1";
  const dashboard = await getDashboardBriefing(forceRefresh);
  response.json(dashboardBriefingSchema.parse(dashboard));
});

app.get("/api/market/crypto", async (request, response) => {
  try {
    const snapshot = await getCryptoMarketSnapshot(request.query.refresh === "1");
    response.json(snapshot);
  } catch (caughtError) {
    response.status(502).json({
      error: "crypto_market_unavailable",
      detail: caughtError instanceof Error ? caughtError.message : "unknown_error"
    });
  }
});

app.get("/api/console/bootstrap", async (request, response) => {
  const history = runStore.listRuns(8);
  const latestRunId = history[0]?.runId;
  const latestRun = latestRunId ? runStore.getRun(latestRunId) : null;
  const forceRefresh = request.query.refresh === "1";
  const dashboard = await getDashboardBriefing(forceRefresh);

  const payload = {
    latestRunId,
    history,
    cockpit: latestRun?.cockpit ?? buildCockpitState({ history }),
    tasks: runStore.listTasks(),
    socialEvents: runStore.listSocialEvents(),
    inspirationNotes: runStore.listInspirationNotes(),
    dashboard
  };

  response.json(consoleBootstrapResponseSchema.parse(payload));
});

app.get("/api/runs/:runId", async (request, response) => {
  const run = runStore.getRun(request.params.runId);

  if (!run) {
    response.status(404).json({
      error: "run_not_found"
    });
    return;
  }

  response.json(
    submitCommandResponseSchema.parse({
      ...run,
      tasks: runStore.listTasks(),
      socialEvents: runStore.listSocialEvents(),
      inspirationNotes: runStore.listInspirationNotes(),
      dashboard: await getDashboardBriefing()
    })
  );
});

app.post("/api/console/submit", async (request, response) => {
  const parsed = submitCommandRequestSchema.safeParse(request.body);

  if (!parsed.success) {
    response.status(400).json({
      error: "invalid_request",
      issues: parsed.error.issues
    });
    return;
  }

  const submittedAt = new Date().toISOString();
  const commandId = `cmd_${Date.now()}`;
  const routedInput = {
    ...parsed.data,
    commandId,
    submittedAt
  };
  const route = buildChatRoute(routedInput);

  const language = resolveLanguage(parsed.data.locale);
  const input = {
    ...parsed.data,
    commandId,
    submittedAt
  };
  const requestAbortController = new AbortController();
  const abortRequest = () => {
    if (!requestAbortController.signal.aborted) {
      requestAbortController.abort();
    }
  };
  request.on("aborted", abortRequest);
  request.on("close", abortRequest);
  const initialPlan = buildChatPlan(commandId, parsed.data.locale);
  const initialDecisionSummary = {
    headline: copyForLanguage(language, {
      en: "Reply pending",
      zh: "正在生成回复"
    }),
    operatorView: copyForLanguage(language, {
      en: "Preparing a direct assistant reply.",
      zh: "正在准备直接回复。"
    }),
    recommendedNextMove: copyForLanguage(language, {
      en: "Continue the conversation naturally.",
      zh: "继续自然对话即可。"
    })
  };

  let plan = initialPlan;
  let decisionSummary = initialDecisionSummary;
  let assistantReply = "";

  try {
    const chatResponse = await buildChatResponse(input, route, {
      signal: requestAbortController.signal
    });
    plan = chatResponse.plan;
    decisionSummary = chatResponse.decisionSummary;
    assistantReply = chatResponse.assistantReply;
  } catch (caughtError) {
    request.off("aborted", abortRequest);
    request.off("close", abortRequest);

    if (requestAbortController.signal.aborted || isAbortError(caughtError)) {
      return;
    }

    response.status(502).json({
      error: "chat_runtime_unavailable",
      detail: caughtError instanceof Error ? caughtError.message : "unknown_error"
    });
    return;
  }

  request.off("aborted", abortRequest);
  request.off("close", abortRequest);

  if (requestAbortController.signal.aborted || response.writableEnded) {
    return;
  }

  const currentTasks = runStore.listTasks();
  const taskMutation = parseTaskCommand(parsed.data.commandText, currentTasks);

  if (taskMutation.action === "add") {
    const createdTask = runStore.createTask(taskMutation.payload);
    taskMutation.effect.taskId = createdTask.id;
  } else if (taskMutation.action === "update") {
    runStore.updateTask(taskMutation.taskId, taskMutation.patch);
  } else if (taskMutation.action === "delete") {
    runStore.deleteTask(taskMutation.taskId);
  }

  if (taskMutation.effect.summary) {
    assistantReply = copyForLanguage(language, {
      en: `${taskMutation.effect.summary}. I have synced the checklist on the left, and you can continue to manage it from chat or by hand.`,
      zh: `${taskMutation.effect.summary}。我已经同步左侧任务清单，你可以继续通过对话或手动方式管理它。`
    });
    decisionSummary = {
      headline: copyForLanguage(language, {
        en: "Task checklist updated",
        zh: "任务清单已更新"
      }),
      operatorView: assistantReply,
      recommendedNextMove: copyForLanguage(language, {
        en: "Review the updated checklist and run the next task when you are ready.",
        zh: "查看更新后的任务清单，准备好后继续运行下一项。"
      })
    };
  }

  const tasks = runStore.listTasks();
  const socialEvents = runStore.listSocialEvents();
  const inspirationNotes = runStore.listInspirationNotes();
  const dashboard = await getDashboardBriefing();

  const conversation: ChatMessage[] = [
    ...(parsed.data.conversation ?? []),
    {
      role: "user" as const,
      content: parsed.data.commandText,
      timestamp: submittedAt
    },
    {
      role: "assistant" as const,
      content: assistantReply,
      timestamp: submittedAt,
      runId: `run_${commandId}`
    }
  ].slice(-12);

  const payload: SubmitCommandResponse = {
    runId: `run_${commandId}`,
    receivedAt: submittedAt,
    input,
    route,
    plan,
    decisionSummary,
    assistantReply,
    conversation,
    cockpit: buildCockpitState({
      locale: input.locale,
      history: runStore.listRuns(8),
      receivedAt: submittedAt,
      input: parsed.data,
      route,
      plan,
      conversation
    }),
    tasks,
    socialEvents,
    inspirationNotes,
    dashboard,
    taskCommandEffect: taskMutation.effect.action === "none" && !taskMutation.effect.summary ? undefined : taskMutation.effect
  };

  const validated = submitCommandResponseSchema.parse(payload);
  runStore.saveRun(validated);
  response.json(validated);
});

app.listen(port, () => {
  console.log(`BossAssistant API listening on http://localhost:${port}`);
});
