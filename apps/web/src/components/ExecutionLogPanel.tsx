import type { ChatMessage, SubmitCommandResponse } from "@bossassistant/contracts";

import { formatTimestamp } from "../formatters";
import type { AppLocale, UICopy } from "../i18n";

type ExecutionLogPanelProps = {
  copy: UICopy;
  locale: AppLocale;
  result: SubmitCommandResponse | null;
  conversation: ChatMessage[];
  loading: boolean;
};

type LogEntry = {
  timestamp: string;
  label: string;
  detail: string;
  tone: "neutral" | "good" | "warn";
};

function buildLogEntries(result: SubmitCommandResponse | null, conversation: ChatMessage[]): LogEntry[] {
  if (!result) {
    return [];
  }

  const entries: LogEntry[] = [
    {
      timestamp: result.receivedAt,
      label: "RUN_ACCEPTED",
      detail: result.input.commandText,
      tone: "neutral"
    },
    {
      timestamp: result.receivedAt,
      label: "ROUTE_IDENTIFIED",
      detail: `${result.route.intentLabel} -> ${result.route.nextAction.summary}`,
      tone: result.route.routeStatus === "routed" ? "good" : "warn"
    },
    {
      timestamp: result.receivedAt,
      label: "APPROVAL_POSTURE",
      detail: result.route.approvalHint.summary,
      tone: result.route.approvalHint.expected ? "warn" : "neutral"
    }
  ];

  for (const step of result.plan.steps) {
    entries.push({
      timestamp: result.receivedAt,
      label: `PLAN_${step.status.toUpperCase()}`,
      detail: `${step.title} / ${step.owner}`,
      tone: step.status === "ready" ? "good" : "neutral"
    });
  }

  if (conversation.length > 0) {
    const lastMessage = conversation[conversation.length - 1];
    entries.push({
      timestamp: lastMessage.timestamp,
      label: lastMessage.role === "assistant" ? "ASSISTANT_REPLY" : "USER_CONTEXT",
      detail: lastMessage.content,
      tone: lastMessage.role === "assistant" ? "good" : "neutral"
    });
  }

  return entries.slice(0, 8);
}

export function ExecutionLogPanel(props: ExecutionLogPanelProps) {
  const logEntries = buildLogEntries(props.result, props.conversation);

  return (
    <section className="system-panel execution-log-panel">
      <div className="system-panel-header">
        <div>
          <p className="kicker">{props.copy.liveTelemetry}</p>
          <h2>{props.copy.executionLog}</h2>
        </div>
        <span className="system-badge">{props.loading ? props.copy.routing : props.copy.systemReady}</span>
      </div>

      {props.result ? (
        <div className="activity-summary-grid">
          <div className="activity-summary-card">
            <span>{props.copy.activeWorkflow}</span>
            <strong>{props.result.route.intentLabel}</strong>
          </div>
          <div className="activity-summary-card">
            <span>{props.copy.nextActionLabel}</span>
            <strong>{props.result.route.nextAction.summary}</strong>
          </div>
          <div className="activity-summary-card">
            <span>{props.copy.approvalHint}</span>
            <strong>{props.result.route.approvalHint.summary}</strong>
          </div>
        </div>
      ) : null}

      {logEntries.length > 0 ? (
        <div className="log-stream">
          {logEntries.map((entry, index) => (
            <div key={`${entry.label}-${index}`} className={`log-line log-${entry.tone}`}>
              <span className="log-time">{formatTimestamp(entry.timestamp, props.locale)}</span>
              <div className="log-copy">
                <strong>{entry.label}</strong>
                <p>{entry.detail}</p>
              </div>
            </div>
          ))}

          {props.loading ? (
            <div className="log-line log-good">
              <span className="log-time">LIVE</span>
              <div className="log-copy">
                <strong>AGENT_ACTIVE</strong>
                <p>{props.copy.agentThinking}</p>
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="empty-block compact-empty-block">
          <p>{props.copy.noExecutionLog}</p>
        </div>
      )}
    </section>
  );
}
