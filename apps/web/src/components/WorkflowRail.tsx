import type { RunHistoryEntry, SubmitCommandResponse, WorkflowType } from "@bossassistant/contracts";

import { formatTimestamp, statusTone } from "../formatters";
import { localizeEnum, workflowLabels, type AppLocale, type UICopy } from "../i18n";

const workflowOrder: WorkflowType[] = ["meeting", "deal", "content", "unknown", "unsupported"];

type WorkflowRailProps = {
  copy: UICopy;
  locale: AppLocale;
  history: RunHistoryEntry[];
  result: SubmitCommandResponse | null;
  loading: boolean;
  onQuickCommand: (command: string) => void;
};

function buildPriorityItems(copy: UICopy, result: SubmitCommandResponse | null, history: RunHistoryEntry[]) {
  const items: Array<{ label: string; meta: string; tone: "good" | "warn" | "risk" }> = [];

  if (result) {
    items.push({
      label: result.route.nextAction.summary,
      meta: copy.nextActionLabel,
      tone: result.route.routeStatus === "blocked" ? "risk" : "good"
    });

    if (result.route.approvalHint.expected) {
      items.push({
        label: result.route.approvalHint.summary,
        meta: copy.approvalHint,
        tone: "warn"
      });
    }

    if (result.route.requiredInputs[0]) {
      items.push({
        label: result.route.requiredInputs[0].label,
        meta: result.route.requiredInputs[0].reason,
        tone: result.route.requiredInputs[0].severity === "blocking" ? "risk" : "warn"
      });
    }

    return items;
  }

  return history.slice(0, 3).map((run) => ({
    label: run.headline,
    meta: run.nextActionSummary,
    tone: statusTone(run.routeStatus) as "good" | "warn" | "risk"
  }));
}

export function WorkflowRail(props: WorkflowRailProps) {
  const workflowCounts = workflowOrder.map((workflowType) => ({
    workflowType,
    count: props.history.filter((run) => run.workflowType === workflowType).length
  }));

  const priorityItems = buildPriorityItems(props.copy, props.result, props.history);
  const activeWorkflow = props.result?.route.workflowType;

  return (
    <div className="workflow-rail-stack">
      <section className="system-panel">
        <div className="system-panel-header">
          <div>
            <p className="kicker">{props.copy.workflowRail}</p>
            <h2>{props.copy.priorityQueue}</h2>
          </div>
          <span className="system-badge">{props.loading ? props.copy.routing : props.copy.historySynced}</span>
        </div>

        {priorityItems.length > 0 ? (
          <div className="priority-list">
            {priorityItems.map((item) => (
              <div key={`${item.meta}-${item.label}`} className={`priority-card priority-${item.tone}`}>
                <span className="priority-meta">{item.meta}</span>
                <strong>{item.label}</strong>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-block compact-empty-block">
            <p>{props.copy.noPriority}</p>
          </div>
        )}
      </section>

      <section className="system-panel">
        <div className="system-panel-header">
          <div>
            <p className="kicker">{props.copy.workflowRail}</p>
            <h2>{props.copy.workflowMatrix}</h2>
          </div>
          <span className="subtle-text">
            {props.history.length} {props.copy.runs}
          </span>
        </div>

        <div className="workflow-matrix">
          {workflowCounts.map((item) => (
            <div
              key={item.workflowType}
              className={`workflow-card ${activeWorkflow === item.workflowType ? "workflow-card-active" : ""}`}
            >
              <div className="workflow-card-top">
                <span className="workflow-dot" />
                <span className="subtle-text">{item.count}</span>
              </div>
              <strong>{localizeEnum(props.locale, workflowLabels, item.workflowType)}</strong>
            </div>
          ))}
        </div>
      </section>

      <section className="system-panel">
        <div className="system-panel-header">
          <div>
            <p className="kicker">{props.copy.commandDeck}</p>
            <h2>{props.copy.quickLaunch}</h2>
          </div>
        </div>

        <div className="rail-command-list">
          {props.copy.sampleCommands.slice(0, 4).map((sample) => (
            <button key={sample} className="rail-command-card" onClick={() => props.onQuickCommand(sample)} disabled={props.loading}>
              <span className="subtle-text">{props.copy.runCommand}</span>
              <strong>{sample}</strong>
            </button>
          ))}
        </div>

        {props.history[0] ? (
          <div className="rail-footnote">
            <span>{props.copy.lastRun}</span>
            <strong>{formatTimestamp(props.history[0].receivedAt, props.locale)}</strong>
          </div>
        ) : null}
      </section>
    </div>
  );
}
