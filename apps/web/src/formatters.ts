import type { ChatMessage, RouteStatus, SubmitCommandResponse } from "@bossassistant/contracts";

import type { AppLocale } from "./i18n";

export function formatConfidence(value: number) {
  return `${Math.round(value * 100)}%`;
}

export function statusTone(routeStatus: RouteStatus) {
  if (routeStatus === "routed") {
    return "good";
  }

  if (routeStatus === "blocked") {
    return "risk";
  }

  return "warn";
}

export function formatTimestamp(value: string, locale: AppLocale) {
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

export function formatTaskWindow(startAt: string, endAt: string, locale: AppLocale) {
  const start = new Date(startAt);
  const end = new Date(endAt);

  const startText = new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(start);
  const endText = new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit"
  }).format(end);

  return `${startText} - ${endText}`;
}

export function formatLocaleTag(locale?: string) {
  return locale?.toLowerCase().startsWith("zh") ? "中文" : "EN";
}

export function deriveConversation(result: SubmitCommandResponse | null): ChatMessage[] {
  if (!result) {
    return [];
  }

  if (result.conversation?.length) {
    return result.conversation;
  }

  return [
    {
      role: "user",
      content: result.input.commandText,
      timestamp: result.receivedAt
    },
    {
      role: "assistant",
      content: result.assistantReply ?? result.decisionSummary.operatorView,
      timestamp: result.receivedAt,
      runId: result.runId
    }
  ];
}
