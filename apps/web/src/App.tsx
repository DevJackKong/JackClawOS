import { useEffect, useRef, useState } from "react";

import type {
  BriefingItem,
  ChatMessage,
  ConsoleBootstrapResponse,
  DashboardBriefing,
  InspirationNote,
  SocialEvent,
  SubmitCommandResponse,
  TaskListItem,
  TaskListStatus,
  SocialEventStatus
} from "@bossassistant/contracts";

import {
  deriveConversation,
  formatLocaleTag,
  formatTimestamp
} from "./formatters";
import {
  localizeEnum,
  policyModeLabels,
  socialEventStatusLabels,
  taskStatusLabels,
  uiCopy,
  type AppLocale
} from "./i18n";

const policyModes = ["economy", "balanced", "executive"] as const;
const taskStatuses: TaskListStatus[] = ["pending", "in_progress", "done", "cancelled"];
const socialEventStatuses: SocialEventStatus[] = ["planned", "done", "cancelled"];
const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8787";

type PolicyMode = (typeof policyModes)[number];

type TaskDraft = {
  title: string;
  detail: string;
  startAt: string;
  endAt: string;
};

type SocialDraft = {
  title: string;
  detail: string;
  location: string;
  startAt: string;
  endAt: string;
  remindMinutes: number;
};

type InspirationDraft = {
  title: string;
  content: string;
  source: string;
  tag: string;
};

type CryptoQuote = {
  id: string;
  symbol: string;
  name: string;
  priceUsd: number;
  change24h: number;
};

type CryptoMarketResponse = {
  refreshedAt: string;
  quotes: CryptoQuote[];
};

function toDateTimeLocalValue(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  const hour = `${date.getHours()}`.padStart(2, "0");
  const minute = `${date.getMinutes()}`.padStart(2, "0");
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

function buildDefaultTaskDraft(): TaskDraft {
  const start = new Date();
  start.setMinutes(0, 0, 0);
  start.setHours(start.getHours() + 1);
  const end = new Date(start);
  end.setHours(end.getHours() + 1);

  return {
    title: "",
    detail: "",
    startAt: toDateTimeLocalValue(start),
    endAt: toDateTimeLocalValue(end)
  };
}

function buildDefaultSocialDraft(): SocialDraft {
  const start = new Date();
  start.setMinutes(0, 0, 0);
  start.setHours(start.getHours() + 2);
  const end = new Date(start);
  end.setHours(end.getHours() + 2);

  return {
    title: "",
    detail: "",
    location: "",
    startAt: toDateTimeLocalValue(start),
    endAt: toDateTimeLocalValue(end),
    remindMinutes: 30
  };
}

function buildDefaultInspirationDraft(): InspirationDraft {
  return {
    title: "",
    content: "",
    source: "",
    tag: ""
  };
}

function isoFromLocalInput(value: string) {
  return new Date(value).toISOString();
}

function formatCryptoPrice(value: number, locale: AppLocale) {
  const digits = value >= 1000 ? 0 : value >= 1 ? 2 : 4;
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: digits,
    minimumFractionDigits: digits === 0 ? 0 : 2
  }).format(value);
}

function ButtonRow(props: {
  item: BriefingItem;
  copy: (typeof uiCopy)[AppLocale];
  onSendToChat: (item: BriefingItem) => void;
}) {
  return (
    <div className="briefing-actions">
      <button type="button" className="secondary-button" onClick={() => props.onSendToChat(props.item)}>
        {props.copy.sendToChatLink}
      </button>
      <a className="link-button" href={props.item.url} target="_blank" rel="noreferrer">
        {props.copy.viewOriginal}
      </a>
    </div>
  );
}

export default function App() {
  const [locale, setLocale] = useState<AppLocale>("zh-CN");
  const copy = uiCopy[locale];
  const [policyMode, setPolicyMode] = useState<PolicyMode>("balanced");
  const [commandText, setCommandText] = useState<string>("");
  const [result, setResult] = useState<SubmitCommandResponse | null>(null);
  const [conversation, setConversation] = useState<ChatMessage[]>([]);
  const [history, setHistory] = useState<ConsoleBootstrapResponse["history"]>([]);
  const [cockpit, setCockpit] = useState<ConsoleBootstrapResponse["cockpit"] | null>(null);
  const [tasks, setTasks] = useState<TaskListItem[]>([]);
  const [socialEvents, setSocialEvents] = useState<SocialEvent[]>([]);
  const [inspirationNotes, setInspirationNotes] = useState<InspirationNote[]>([]);
  const [dashboard, setDashboard] = useState<DashboardBriefing | null>(null);
  const [cryptoQuotes, setCryptoQuotes] = useState<CryptoQuote[]>([]);
  const [marketRefreshedAt, setMarketRefreshedAt] = useState<string | null>(null);
  const [taskDraft, setTaskDraft] = useState<TaskDraft>(buildDefaultTaskDraft());
  const [socialDraft, setSocialDraft] = useState<SocialDraft>(buildDefaultSocialDraft());
  const [inspirationDraft, setInspirationDraft] = useState<InspirationDraft>(buildDefaultInspirationDraft());
  const [loading, setLoading] = useState(false);
  const [savingTask, setSavingTask] = useState(false);
  const [savingSocial, setSavingSocial] = useState(false);
  const [savingInspiration, setSavingInspiration] = useState(false);
  const [activeTaskActionId, setActiveTaskActionId] = useState<string | null>(null);
  const [activeSocialActionId, setActiveSocialActionId] = useState<string | null>(null);
  const [activeInspirationActionId, setActiveInspirationActionId] = useState<string | null>(null);
  const [refreshingFeeds, setRefreshingFeeds] = useState(false);
  const [refreshingMarket, setRefreshingMarket] = useState(false);
  const [sessionEnded, setSessionEnded] = useState(false);
  const [enterArmed, setEnterArmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chatFeedRef = useRef<HTMLDivElement | null>(null);
  const requestAbortRef = useRef<AbortController | null>(null);
  const enterResetTimerRef = useRef<number | null>(null);

  async function loadBootstrap(nextLocale: AppLocale, forceRefresh = false) {
    try {
      const response = await fetch(`${apiBaseUrl}/api/console/bootstrap${forceRefresh ? "?refresh=1" : ""}`);

      if (!response.ok) {
        throw new Error("Bootstrap request failed");
      }

      const data = (await response.json()) as ConsoleBootstrapResponse;
      setHistory(data.history);
      setCockpit(data.cockpit);
      setTasks(data.tasks);
      setSocialEvents(data.socialEvents);
      setInspirationNotes(data.inspirationNotes);
      setDashboard(data.dashboard);
      setResult(null);
      setConversation([]);
      setCommandText("");
      setSessionEnded(false);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unknown error");
    }
  }

  async function openRun(runId: string) {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`${apiBaseUrl}/api/runs/${runId}`);

      if (!response.ok) {
        throw new Error("Run request failed");
      }

      const data = (await response.json()) as SubmitCommandResponse;
      setResult(data);
      setConversation(deriveConversation(data));
      setCockpit(data.cockpit);
      setTasks(data.tasks);
      setSocialEvents(data.socialEvents);
      setInspirationNotes(data.inspirationNotes);
      setDashboard(data.dashboard);
      setCommandText(data.input.commandText);
      setSessionEnded(false);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  async function submitCommand(nextCommand?: string) {
    const payloadText = (nextCommand ?? commandText).trim();

    if (!payloadText || loading) {
      return;
    }

    const submittedAt = new Date().toISOString();
    const nextConversation = [
      ...conversation,
      {
        role: "user" as const,
        content: payloadText,
        timestamp: submittedAt
      }
    ].slice(-12);

    requestAbortRef.current?.abort();
    const controller = new AbortController();
    requestAbortRef.current = controller;

    if (enterResetTimerRef.current) {
      window.clearTimeout(enterResetTimerRef.current);
      enterResetTimerRef.current = null;
    }

    setEnterArmed(false);
    setLoading(true);
    setError(null);
    setConversation(nextConversation);
    setCommandText("");
    setSessionEnded(false);

    try {
      const response = await fetch(`${apiBaseUrl}/api/console/submit`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        signal: controller.signal,
        body: JSON.stringify({
          commandText: payloadText,
          policyMode,
          timezone: "Asia/Shanghai",
          locale,
          conversation
        })
      });

      if (!response.ok) {
        throw new Error("Request failed");
      }

      const data = (await response.json()) as SubmitCommandResponse;
      setResult(data);
      setConversation(deriveConversation(data));
      setCockpit(data.cockpit);
      setTasks(data.tasks);
      setSocialEvents(data.socialEvents);
      setInspirationNotes(data.inspirationNotes);
      setDashboard(data.dashboard);
      setHistory((current) => {
        const nextEntry = {
          runId: data.runId,
          commandId: data.input.commandId,
          commandText: data.input.commandText,
          policyMode: data.input.policyMode,
          locale: data.input.locale,
          receivedAt: data.receivedAt,
          workflowType: data.route.workflowType,
          routeStatus: data.route.routeStatus,
          riskLevel: data.route.riskLevel,
          urgency: data.route.urgency,
          headline: data.decisionSummary.headline,
          nextActionSummary: data.route.nextAction.summary
        };

        return [nextEntry, ...current.filter((item) => item.runId !== data.runId)].slice(0, 8);
      });
    } catch (caughtError) {
      if (caughtError instanceof Error && caughtError.name === "AbortError") {
        return;
      }

      setError(caughtError instanceof Error ? caughtError.message : "Unknown error");
    } finally {
      if (requestAbortRef.current === controller) {
        requestAbortRef.current = null;
      }
      setLoading(false);
    }
  }

  function stopGenerating() {
    requestAbortRef.current?.abort();
    requestAbortRef.current = null;
    setLoading(false);
    setError(null);
  }

  async function loadCryptoMarket(forceRefresh = false) {
    setRefreshingMarket(true);

    try {
      const response = await fetch(`${apiBaseUrl}/api/market/crypto${forceRefresh ? "?refresh=1" : ""}`);

      if (!response.ok) {
        throw new Error("Crypto market request failed");
      }

      const data = (await response.json()) as CryptoMarketResponse;
      setCryptoQuotes(data.quotes);
      setMarketRefreshedAt(data.refreshedAt);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unknown error");
    } finally {
      setRefreshingMarket(false);
    }
  }

  async function refreshFeeds() {
    setRefreshingFeeds(true);

    try {
      const response = await fetch(`${apiBaseUrl}/api/dashboard?refresh=1`);

      if (!response.ok) {
        throw new Error("Dashboard request failed");
      }

      const data = (await response.json()) as DashboardBriefing;
      setDashboard(data);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unknown error");
    } finally {
      setRefreshingFeeds(false);
    }
  }

  async function createTask() {
    if (!taskDraft.title.trim()) {
      return;
    }

    setSavingTask(true);
    setError(null);

    try {
      const response = await fetch(`${apiBaseUrl}/api/tasks`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          title: taskDraft.title.trim(),
          detail: taskDraft.detail.trim(),
          startAt: isoFromLocalInput(taskDraft.startAt),
          endAt: isoFromLocalInput(taskDraft.endAt),
          status: "pending"
        })
      });

      if (!response.ok) {
        throw new Error("Create task failed");
      }

      const data = (await response.json()) as { tasks: TaskListItem[] };
      setTasks(data.tasks);
      setTaskDraft(buildDefaultTaskDraft());
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unknown error");
    } finally {
      setSavingTask(false);
    }
  }

  async function patchTask(taskId: string, patch: Partial<Pick<TaskListItem, "status">>) {
    setSavingTask(true);
    setActiveTaskActionId(taskId);
    setError(null);

    try {
      const response = await fetch(`${apiBaseUrl}/api/tasks/${taskId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(patch)
      });

      if (!response.ok) {
        throw new Error("Update task failed");
      }

      const data = (await response.json()) as { tasks: TaskListItem[] };
      setTasks(data.tasks);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unknown error");
    } finally {
      setSavingTask(false);
      setActiveTaskActionId(null);
    }
  }

  async function deleteTask(taskId: string) {
    const confirmed = window.confirm(locale === "zh-CN" ? "确认删除这条任务吗？" : "Delete this task?");

    if (!confirmed) {
      return;
    }

    setSavingTask(true);
    setActiveTaskActionId(taskId);
    setError(null);

    try {
      const response = await fetch(`${apiBaseUrl}/api/tasks/${taskId}`, {
        method: "DELETE"
      });

      if (!response.ok) {
        throw new Error("Delete task failed");
      }

      const data = (await response.json()) as { tasks: TaskListItem[] };
      setTasks(data.tasks);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unknown error");
    } finally {
      setSavingTask(false);
      setActiveTaskActionId(null);
    }
  }

  async function createSocialEvent() {
    if (!socialDraft.title.trim()) {
      return;
    }

    setSavingSocial(true);
    setError(null);

    try {
      const response = await fetch(`${apiBaseUrl}/api/social-events`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          title: socialDraft.title.trim(),
          detail: socialDraft.detail.trim(),
          location: socialDraft.location.trim(),
          startAt: isoFromLocalInput(socialDraft.startAt),
          endAt: isoFromLocalInput(socialDraft.endAt),
          remindMinutes: socialDraft.remindMinutes,
          status: "planned"
        })
      });

      if (!response.ok) {
        throw new Error("Create social event failed");
      }

      const data = (await response.json()) as { socialEvents: SocialEvent[] };
      setSocialEvents(data.socialEvents);
      setSocialDraft(buildDefaultSocialDraft());
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unknown error");
    } finally {
      setSavingSocial(false);
    }
  }

  async function patchSocialEvent(eventId: string, patch: Partial<Pick<SocialEvent, "status">>) {
    setSavingSocial(true);
    setActiveSocialActionId(eventId);
    setError(null);

    try {
      const response = await fetch(`${apiBaseUrl}/api/social-events/${eventId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(patch)
      });

      if (!response.ok) {
        throw new Error("Update social event failed");
      }

      const data = (await response.json()) as { socialEvents: SocialEvent[] };
      setSocialEvents(data.socialEvents);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unknown error");
    } finally {
      setSavingSocial(false);
      setActiveSocialActionId(null);
    }
  }

  async function deleteSocialEvent(eventId: string) {
    const confirmed = window.confirm(locale === "zh-CN" ? "确认删除这条社交活动吗？" : "Delete this social event?");

    if (!confirmed) {
      return;
    }

    setSavingSocial(true);
    setActiveSocialActionId(eventId);
    setError(null);

    try {
      const response = await fetch(`${apiBaseUrl}/api/social-events/${eventId}`, {
        method: "DELETE"
      });

      if (!response.ok) {
        throw new Error("Delete social event failed");
      }

      const data = (await response.json()) as { socialEvents: SocialEvent[] };
      setSocialEvents(data.socialEvents);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unknown error");
    } finally {
      setSavingSocial(false);
      setActiveSocialActionId(null);
    }
  }

  async function createInspirationNote() {
    if (!inspirationDraft.title.trim() || !inspirationDraft.content.trim()) {
      return;
    }

    setSavingInspiration(true);
    setError(null);

    try {
      const response = await fetch(`${apiBaseUrl}/api/inspirations`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          title: inspirationDraft.title.trim(),
          content: inspirationDraft.content.trim(),
          source: inspirationDraft.source.trim(),
          tag: inspirationDraft.tag.trim()
        })
      });

      if (!response.ok) {
        throw new Error("Create inspiration failed");
      }

      const data = (await response.json()) as { inspirationNotes: InspirationNote[] };
      setInspirationNotes(data.inspirationNotes);
      setInspirationDraft(buildDefaultInspirationDraft());
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unknown error");
    } finally {
      setSavingInspiration(false);
    }
  }

  async function deleteInspirationNote(noteId: string) {
    const confirmed = window.confirm(locale === "zh-CN" ? "确认删除这条灵感吗？" : "Delete this idea?");

    if (!confirmed) {
      return;
    }

    setSavingInspiration(true);
    setActiveInspirationActionId(noteId);
    setError(null);

    try {
      const response = await fetch(`${apiBaseUrl}/api/inspirations/${noteId}`, {
        method: "DELETE"
      });

      if (!response.ok) {
        throw new Error("Delete inspiration failed");
      }

      const data = (await response.json()) as { inspirationNotes: InspirationNote[] };
      setInspirationNotes(data.inspirationNotes);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unknown error");
    } finally {
      setSavingInspiration(false);
      setActiveInspirationActionId(null);
    }
  }

  function injectBriefingIntoChat(item: BriefingItem) {
    const prompt = locale === "zh-CN"
      ? `请结合这条推送继续分析，并保留原文链接方便我查看：\n${item.title}\n${item.url}`
      : `Continue from this briefing item and keep the original source link in context:\n${item.title}\n${item.url}`;

    setCommandText((current) => (current.trim() ? `${current}\n\n${prompt}` : prompt));
  }

  function injectInspirationIntoChat(note: InspirationNote) {
    const prompt = locale === "zh-CN"
      ? `请把这条灵感整理成一个更成熟的表达，并告诉我适合放进 PPT 的哪一页：\n标题：${note.title}\n内容：${note.content}${note.source ? `\n来源：${note.source}` : ""}${note.tag ? `\n标签：${note.tag}` : ""}`
      : `Turn this idea into a sharper deck-ready point and tell me where it fits in a presentation:\nTitle: ${note.title}\nContent: ${note.content}${note.source ? `\nSource: ${note.source}` : ""}${note.tag ? `\nTag: ${note.tag}` : ""}`;

    setCommandText((current) => (current.trim() ? `${current}\n\n${prompt}` : prompt));
  }

  useEffect(() => {
    void loadBootstrap(locale);
  }, []);

  useEffect(() => {
    void loadCryptoMarket();
    const timer = window.setInterval(() => {
      void loadCryptoMarket();
    }, 60_000);

    return () => {
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!chatFeedRef.current) {
      return;
    }

    chatFeedRef.current.scrollTo({
      top: chatFeedRef.current.scrollHeight,
      behavior: "smooth"
    });
  }, [conversation, loading]);

  useEffect(() => {
    return () => {
      requestAbortRef.current?.abort();

      if (enterResetTimerRef.current) {
        window.clearTimeout(enterResetTimerRef.current);
      }
    };
  }, []);

  const activeCockpit = result?.cockpit ?? cockpit;
  const promptSuggestions = conversation.length > 0
    ? activeCockpit?.suggestedPrompts?.slice(0, 3) ?? copy.sampleCommands.slice(0, 3)
    : copy.sampleCommands.slice(0, 4);
  const taskSourceLabel = (task: TaskListItem) =>
    task.source === "manual" ? copy.manualTaskSource : task.source === "chat" ? copy.chatTaskSource : copy.planTaskSource;
  const socialItems = dashboard?.hotspots.social ?? [];
  const newsItems = dashboard?.hotspots.news ?? [];
  const githubItems = dashboard?.aiColumn.github ?? [];
  const researchItems = dashboard?.aiColumn.research ?? [];
  const fundingItems = dashboard?.aiColumn.funding ?? [];

  return (
    <div className="dashboard-shell">
      <div className="ambient-grid" />

      <header className="topbar">
        <div className="brand-block">
          <div className="brand-mark">JC</div>
          <div>
            <p className="eyebrow">{copy.osSubtitle}</p>
            <h1>{copy.osTitle}</h1>
          </div>
        </div>

        <div className="topbar-controls">
          <div className="status-pill status-pill-live">
            <span className="status-dot" />
            <span>{copy.liveStatus}</span>
          </div>

          <select
            data-testid="language-select"
            value={locale}
            onChange={(event) => {
              const nextLocale = event.target.value as AppLocale;
              setLocale(nextLocale);
              setCockpit(null);
              void loadBootstrap(nextLocale);
            }}
          >
            <option value="zh-CN">中文</option>
            <option value="en-US">English</option>
          </select>

          <select value={policyMode} onChange={(event) => setPolicyMode(event.target.value as PolicyMode)}>
            {policyModes.map((mode) => (
              <option key={mode} value={mode}>
                {localizeEnum(locale, policyModeLabels, mode)}
              </option>
            ))}
          </select>
        </div>
      </header>

      <main className="workspace-grid">
        <aside className="left-column">
          <section className="surface">
            <div className="section-header">
              <div>
                <p className="eyebrow">{copy.taskRankLabel}</p>
                <h2>{copy.taskChecklist}</h2>
                <p className="section-copy">{copy.taskChecklistHint}</p>
              </div>
              <span className="counter-badge">{tasks.length}</span>
            </div>

            <div className="task-form">
              <input
                value={taskDraft.title}
                onChange={(event) => setTaskDraft((current) => ({ ...current, title: event.target.value }))}
                placeholder={copy.newTaskPlaceholder}
              />
              <textarea
                value={taskDraft.detail}
                onChange={(event) => setTaskDraft((current) => ({ ...current, detail: event.target.value }))}
                placeholder={copy.detailPlaceholder}
                rows={3}
              />
              <div className="task-time-grid">
                <label>
                  <span>{copy.taskStart}</span>
                  <input
                    type="datetime-local"
                    value={taskDraft.startAt}
                    onChange={(event) => setTaskDraft((current) => ({ ...current, startAt: event.target.value }))}
                  />
                </label>
                <label>
                  <span>{copy.taskEnd}</span>
                  <input
                    type="datetime-local"
                    value={taskDraft.endAt}
                    onChange={(event) => setTaskDraft((current) => ({ ...current, endAt: event.target.value }))}
                  />
                </label>
              </div>
              <button type="button" className="primary-button" onClick={() => void createTask()} disabled={savingTask}>
                {savingTask ? copy.processing : copy.addTask}
              </button>
            </div>

            <div className="task-list">
              {tasks.length > 0 ? (
                tasks.map((task, index) => (
                  <article key={task.id} className={`task-card task-card-${task.status}`}>
                    <div className="task-rank">{String(index + 1).padStart(2, "0")}</div>
                    <div className="task-card-body">
                      <div className="task-card-top task-card-top-spread">
                        <span className="task-source-chip">{taskSourceLabel(task)}</span>
                        <button
                          type="button"
                          className="danger-link"
                          onClick={() => void deleteTask(task.id)}
                          disabled={savingTask && activeTaskActionId === task.id}
                        >
                          {copy.deleteTask}
                        </button>
                      </div>
                      <div className="task-time-stack">
                        <div className="task-time-box">
                          <span>{copy.taskStart}</span>
                          <strong>{formatTimestamp(task.startAt, locale)}</strong>
                        </div>
                        <div className="task-time-box">
                          <span>{copy.taskEnd}</span>
                          <strong>{formatTimestamp(task.endAt, locale)}</strong>
                        </div>
                      </div>
                      <h3>{task.title}</h3>
                      <p>{task.detail || copy.taskNoDetail}</p>
                      <div className="card-action-row">
                        <div className="segmented-control">
                          <span className="segmented-label">{copy.statusLabel}</span>
                          <div className="status-chip-row">
                            {taskStatuses.map((status) => (
                              <button
                                key={status}
                                type="button"
                                className={`status-chip ${task.status === status ? "status-chip-active" : ""}`}
                                onClick={() => void patchTask(task.id, { status })}
                                disabled={savingTask && activeTaskActionId === task.id}
                              >
                                {localizeEnum(locale, taskStatusLabels, status)}
                              </button>
                            ))}
                          </div>
                        </div>
                        {savingTask && activeTaskActionId === task.id ? <span className="item-meta-text">{copy.processing}</span> : null}
                      </div>
                    </div>
                  </article>
                ))
              ) : (
                <div className="empty-card">
                  <h3>{copy.taskBoardEmpty}</h3>
                </div>
              )}
            </div>
          </section>
        </aside>

        <section className="center-column">
          <section className="surface">
            <div className="section-header">
              <div>
                <p className="eyebrow">{copy.agentWindow}</p>
                <h2>{copy.chatTitle}</h2>
                <p className="section-copy">{copy.conversationAssist}</p>
              </div>
              <div className="header-stack">
                <span className="status-pill">{loading ? copy.thinkingLabel : sessionEnded ? copy.endSession : copy.agentReady}</span>
              </div>
            </div>

            {error ? <p className="error-text">{error}</p> : null}
            {sessionEnded ? <div className="session-banner">{copy.sessionEnded}</div> : null}

            <div ref={chatFeedRef} className="chat-feed" data-testid="chat-transcript">
              {conversation.length > 0 ? (
                conversation.map((message, index) => (
                  <div key={`${message.role}-${message.timestamp}-${index}`} className={`chat-row chat-row-${message.role}`}>
                    <div className={`chat-avatar chat-avatar-${message.role}`}>{message.role === "user" ? "Y" : "JC"}</div>
                    <div className={`chat-bubble chat-bubble-${message.role}`}>
                      <div className="chat-meta">
                        <strong>{message.role === "user" ? "You" : copy.appName}</strong>
                        <span>{formatTimestamp(message.timestamp, locale)}</span>
                      </div>
                      <p className="chat-content">{message.content}</p>
                    </div>
                  </div>
                ))
              ) : (
                <div className="empty-card">
                  <h3>{copy.noChat}</h3>
                  <p>{copy.noChatText}</p>
                </div>
              )}

              {loading ? (
                <div className="chat-row chat-row-assistant">
                  <div className="chat-avatar chat-avatar-assistant">JC</div>
                  <div className="chat-bubble chat-bubble-assistant">
                    <div className="chat-meta">
                      <strong>{copy.appName}</strong>
                      <span>{copy.thinkingLabel}</span>
                    </div>
                    <p className="chat-content">{copy.agentThinking}</p>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="suggestion-row">
              {promptSuggestions.map((prompt) => (
                <button key={prompt} type="button" className="suggestion-chip" onClick={() => setCommandText(prompt)} disabled={loading}>
                  {prompt}
                </button>
              ))}
            </div>

            <div className="composer">
              <textarea
                data-testid="command-input"
                value={commandText}
                onChange={(event) => {
                  setCommandText(event.target.value);
                  if (enterArmed) {
                    setEnterArmed(false);
                    if (enterResetTimerRef.current) {
                      window.clearTimeout(enterResetTimerRef.current);
                      enterResetTimerRef.current = null;
                    }
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    if (loading || !commandText.trim()) {
                      return;
                    }

                    if (enterArmed) {
                      if (enterResetTimerRef.current) {
                        window.clearTimeout(enterResetTimerRef.current);
                        enterResetTimerRef.current = null;
                      }

                      setEnterArmed(false);
                      void submitCommand();
                      return;
                    }

                    setEnterArmed(true);
                    if (enterResetTimerRef.current) {
                      window.clearTimeout(enterResetTimerRef.current);
                    }

                    enterResetTimerRef.current = window.setTimeout(() => {
                      setEnterArmed(false);
                      enterResetTimerRef.current = null;
                    }, 1200);
                  }
                }}
                placeholder={copy.commandPlaceholder}
                rows={4}
              />
              <div className="composer-footer">
                <span className="helper-text">
                  {loading ? copy.thinkingLabel : enterArmed ? copy.pressEnterAgainToSend : copy.doubleEnterToSend}
                </span>
                <div className="button-group">
                  <button
                    type="button"
                    className="primary-button"
                    data-testid="run-command"
                    onClick={() => void submitCommand()}
                    disabled={loading}
                  >
                    {copy.sendMessage}
                  </button>
                  {loading ? (
                    <button type="button" className="secondary-button" onClick={stopGenerating}>
                      {copy.stopGenerating}
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          </section>

          <section className="surface">
            <div className="section-header">
              <div>
                <p className="eyebrow">{copy.socialManager}</p>
                <h2>{copy.socialManager}</h2>
                <p className="section-copy">{copy.socialManagerHint}</p>
              </div>
              <span className="counter-badge">{socialEvents.length}</span>
            </div>

            <div className="task-form">
              <input
                value={socialDraft.title}
                onChange={(event) => setSocialDraft((current) => ({ ...current, title: event.target.value }))}
                placeholder={copy.socialTitlePlaceholder}
              />
              <input
                value={socialDraft.location}
                onChange={(event) => setSocialDraft((current) => ({ ...current, location: event.target.value }))}
                placeholder={copy.socialLocationPlaceholder}
              />
              <textarea
                value={socialDraft.detail}
                onChange={(event) => setSocialDraft((current) => ({ ...current, detail: event.target.value }))}
                placeholder={copy.detailPlaceholder}
                rows={3}
              />
              <div className="task-time-grid social-form-grid">
                <label>
                  <span>{copy.taskStart}</span>
                  <input
                    type="datetime-local"
                    value={socialDraft.startAt}
                    onChange={(event) => setSocialDraft((current) => ({ ...current, startAt: event.target.value }))}
                  />
                </label>
                <label>
                  <span>{copy.taskEnd}</span>
                  <input
                    type="datetime-local"
                    value={socialDraft.endAt}
                    onChange={(event) => setSocialDraft((current) => ({ ...current, endAt: event.target.value }))}
                  />
                </label>
                <label>
                  <span>{copy.socialReminder}</span>
                  <select
                    value={socialDraft.remindMinutes}
                    onChange={(event) => setSocialDraft((current) => ({ ...current, remindMinutes: Number(event.target.value) }))}
                  >
                    {[15, 30, 60, 120].map((minutes) => (
                      <option key={minutes} value={minutes}>
                        {copy.socialReminderMinutes} {minutes} min
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <button type="button" className="primary-button" onClick={() => void createSocialEvent()} disabled={savingSocial}>
                {savingSocial ? copy.processing : copy.addSocialEvent}
              </button>
            </div>

            <div className="social-list">
              {socialEvents.length > 0 ? (
                socialEvents.map((event) => (
                  <article key={event.id} className="social-card">
                    <div className="social-card-head">
                      <div>
                        <h3>{event.title}</h3>
                        <p>{event.location || copy.socialLocationPlaceholder}</p>
                      </div>
                      <div className="social-card-actions">
                        <span className="task-source-chip">{event.remindMinutes} min</span>
                        <button
                          type="button"
                          className="danger-link"
                          onClick={() => void deleteSocialEvent(event.id)}
                          disabled={savingSocial && activeSocialActionId === event.id}
                        >
                          {copy.deleteSocialEvent}
                        </button>
                      </div>
                    </div>
                    <div className="task-time-stack">
                      <div className="task-time-box">
                        <span>{copy.taskStart}</span>
                        <strong>{formatTimestamp(event.startAt, locale)}</strong>
                      </div>
                      <div className="task-time-box">
                        <span>{copy.taskEnd}</span>
                        <strong>{formatTimestamp(event.endAt, locale)}</strong>
                      </div>
                    </div>
                    <p>{event.detail || copy.socialNoDetail}</p>
                    <div className="card-action-row">
                      <div className="segmented-control">
                        <span className="segmented-label">{copy.statusLabel}</span>
                        <div className="status-chip-row">
                          {socialEventStatuses.map((status) => (
                            <button
                              key={status}
                              type="button"
                              className={`status-chip ${event.status === status ? "status-chip-active" : ""}`}
                              onClick={() => void patchSocialEvent(event.id, { status })}
                              disabled={savingSocial && activeSocialActionId === event.id}
                            >
                              {localizeEnum(locale, socialEventStatusLabels, status)}
                            </button>
                          ))}
                        </div>
                      </div>
                      {savingSocial && activeSocialActionId === event.id ? <span className="item-meta-text">{copy.processing}</span> : null}
                    </div>
                  </article>
                ))
              ) : (
                <div className="empty-card">
                  <h3>{copy.socialEmpty}</h3>
                </div>
              )}
            </div>
          </section>

          <section className="surface">
            <div className="section-header">
              <div>
                <p className="eyebrow">{copy.marketPulse}</p>
                <h2>{copy.marketPulse}</h2>
                <p className="section-copy">{copy.marketPulseHint}</p>
              </div>
              <div className="header-stack">
                <span className="status-pill">
                  {copy.latestRefresh}: {marketRefreshedAt ? formatTimestamp(marketRefreshedAt, locale) : "--"}
                </span>
                <button type="button" className="secondary-button" onClick={() => void loadCryptoMarket(true)} disabled={refreshingMarket}>
                  {refreshingMarket ? copy.processing : copy.refreshMarket}
                </button>
              </div>
            </div>

            <div className="market-grid">
              {cryptoQuotes.length > 0 ? (
                cryptoQuotes.map((quote) => (
                  <article key={quote.id} className="market-card">
                    <div className="market-card-top">
                      <div>
                        <strong>{quote.symbol}</strong>
                        <p>{quote.name}</p>
                      </div>
                      <span className={`market-change ${quote.change24h >= 0 ? "market-change-up" : "market-change-down"}`}>
                        {quote.change24h >= 0 ? "+" : ""}{quote.change24h.toFixed(2)}%
                      </span>
                    </div>
                    <h3>{formatCryptoPrice(quote.priceUsd, locale)}</h3>
                  </article>
                ))
              ) : (
                <div className="empty-card">
                  <p>{copy.noBriefing}</p>
                </div>
              )}
            </div>
          </section>

          <section className="surface">
            <div className="section-header">
              <div>
                <p className="eyebrow">{copy.inspirationNotebook}</p>
                <h2>{copy.inspirationNotebook}</h2>
                <p className="section-copy">{copy.inspirationNotebookHint}</p>
              </div>
              <span className="counter-badge">{inspirationNotes.length}</span>
            </div>

            <div className="task-form">
              <input
                value={inspirationDraft.title}
                onChange={(event) => setInspirationDraft((current) => ({ ...current, title: event.target.value }))}
                placeholder={copy.inspirationTitlePlaceholder}
              />
              <textarea
                value={inspirationDraft.content}
                onChange={(event) => setInspirationDraft((current) => ({ ...current, content: event.target.value }))}
                placeholder={copy.inspirationContentPlaceholder}
                rows={4}
              />
              <div className="task-time-grid social-form-grid">
                <label>
                  <span>{copy.inspirationSourceLabel}</span>
                  <input
                    value={inspirationDraft.source}
                    onChange={(event) => setInspirationDraft((current) => ({ ...current, source: event.target.value }))}
                    placeholder={copy.inspirationSourcePlaceholder}
                  />
                </label>
                <label>
                  <span>{copy.inspirationTagLabel}</span>
                  <input
                    value={inspirationDraft.tag}
                    onChange={(event) => setInspirationDraft((current) => ({ ...current, tag: event.target.value }))}
                    placeholder={copy.inspirationTagPlaceholder}
                  />
                </label>
              </div>
              <button type="button" className="primary-button" onClick={() => void createInspirationNote()} disabled={savingInspiration}>
                {savingInspiration ? copy.processing : copy.addInspiration}
              </button>
            </div>

            <div className="inspiration-list">
              {inspirationNotes.length > 0 ? (
                inspirationNotes.map((note) => (
                  <article key={note.id} className="briefing-card inspiration-card">
                    <div className="briefing-meta">
                      <span>{note.tag || copy.inspirationNotebook}</span>
                      <span>{formatTimestamp(note.createdAt, locale)}</span>
                    </div>
                    <h4>{note.title}</h4>
                    <p>{note.content}</p>
                    <div className="inspiration-actions">
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => injectInspirationIntoChat(note)}
                        disabled={savingInspiration && activeInspirationActionId === note.id}
                      >
                        {copy.sendToChatLink}
                      </button>
                      {note.source ? (
                        <a className="link-button" href={note.source} target="_blank" rel="noreferrer">
                          {copy.viewOriginal}
                        </a>
                      ) : null}
                      <button
                        type="button"
                        className="danger-link"
                        onClick={() => void deleteInspirationNote(note.id)}
                        disabled={savingInspiration && activeInspirationActionId === note.id}
                      >
                        {copy.deleteInspiration}
                      </button>
                      {savingInspiration && activeInspirationActionId === note.id ? <span className="item-meta-text">{copy.processing}</span> : null}
                    </div>
                  </article>
                ))
              ) : (
                <div className="empty-card">
                  <h3>{copy.inspirationEmpty}</h3>
                </div>
              )}
            </div>
          </section>
        </section>

        <aside className="right-column">
          <section className="surface">
            <div className="section-header">
              <div>
                <p className="eyebrow">{copy.hotspotBroadcast}</p>
                <h2>{copy.hotspotBroadcast}</h2>
                <p className="section-copy">{copy.hotspotHint}</p>
              </div>
              <button type="button" className="secondary-button" onClick={() => void refreshFeeds()} disabled={refreshingFeeds}>
                {refreshingFeeds ? copy.processing : copy.refreshHotspots}
              </button>
            </div>

            <div className="briefing-column">
              <div className="briefing-group">
                <div className="briefing-group-header">
                  <h3>{copy.socialBuzz}</h3>
                  <span>{copy.latestRefresh}: {dashboard ? formatTimestamp(dashboard.refreshedAt, locale) : "--"}</span>
                </div>
                {socialItems.length > 0 ? (
                  socialItems.map((item) => (
                    <article key={item.id} className="briefing-card">
                      <div className="briefing-meta">
                        <span>{item.source}</span>
                        <span>{item.badge ?? formatTimestamp(item.publishedAt, locale)}</span>
                      </div>
                      <h4>{item.title}</h4>
                      <p>{item.summary}</p>
                      <ButtonRow item={item} copy={copy} onSendToChat={injectBriefingIntoChat} />
                    </article>
                  ))
                ) : (
                  <div className="empty-card">
                    <p>{copy.noBriefing}</p>
                  </div>
                )}
              </div>

              <div className="briefing-group">
                <div className="briefing-group-header">
                  <h3>{copy.newsBuzz}</h3>
                </div>
                {newsItems.length > 0 ? (
                  newsItems.map((item) => (
                    <article key={item.id} className="briefing-card">
                      <div className="briefing-meta">
                        <span>{item.source}</span>
                        <span>{formatTimestamp(item.publishedAt, locale)}</span>
                      </div>
                      <h4>{item.title}</h4>
                      <p>{item.summary}</p>
                      <ButtonRow item={item} copy={copy} onSendToChat={injectBriefingIntoChat} />
                    </article>
                  ))
                ) : (
                  <div className="empty-card">
                    <p>{copy.noBriefing}</p>
                  </div>
                )}
              </div>
            </div>
          </section>

          <section className="surface">
            <div className="section-header">
              <div>
                <p className="eyebrow">{copy.aiColumnTitle}</p>
                <h2>{copy.aiColumnTitle}</h2>
                <p className="section-copy">{copy.aiColumnHint}</p>
              </div>
            </div>

            <div className="briefing-column">
              {[
                { label: copy.githubHot, items: githubItems },
                { label: copy.researchHot, items: researchItems },
                { label: copy.fundingHot, items: fundingItems }
              ].map((group) => (
                <div key={group.label} className="briefing-group">
                  <div className="briefing-group-header">
                    <h3>{group.label}</h3>
                  </div>
                  {group.items.length > 0 ? (
                    group.items.map((item) => (
                      <article key={item.id} className="briefing-card">
                        <div className="briefing-meta">
                          <span>{item.source}</span>
                          <span>{item.badge ?? formatTimestamp(item.publishedAt, locale)}</span>
                        </div>
                        <h4>{item.title}</h4>
                        <p>{item.summary}</p>
                        <ButtonRow item={item} copy={copy} onSendToChat={injectBriefingIntoChat} />
                      </article>
                    ))
                  ) : (
                    <div className="empty-card">
                      <p>{copy.noBriefing}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>

          <section className="surface" data-testid="history-panel">
            <div className="section-header">
              <div>
                <p className="eyebrow">{copy.runHistory}</p>
                <h2>{copy.recentRuns}</h2>
              </div>
            </div>

            <div className="history-list">
              {history.length > 0 ? (
                history.map((run) => (
                  <button
                    key={run.runId}
                    type="button"
                    className={`history-card ${result?.runId === run.runId ? "history-card-active" : ""}`}
                    onClick={() => void openRun(run.runId)}
                  >
                    <div className="briefing-meta">
                      <span>{formatTimestamp(run.receivedAt, locale)}</span>
                      <span>{formatLocaleTag(run.locale)}</span>
                    </div>
                    <strong>{run.headline}</strong>
                    <p>{run.commandText}</p>
                  </button>
                ))
              ) : (
                <div className="empty-card">
                  <h3>{copy.noHistory}</h3>
                  <p>{copy.noHistoryText}</p>
                </div>
              )}
            </div>
          </section>
        </aside>
      </main>
    </div>
  );
}
