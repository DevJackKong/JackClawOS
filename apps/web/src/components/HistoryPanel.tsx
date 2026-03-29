import type { RunHistoryEntry, SubmitCommandResponse } from "@bossassistant/contracts";

import { formatLocaleTag, formatTimestamp, statusTone } from "../formatters";
import {
  localizeEnum,
  riskLabels,
  routeStatusLabels,
  workflowLabels,
  type AppLocale,
  type UICopy
} from "../i18n";

type HistoryPanelProps = {
  copy: UICopy;
  locale: AppLocale;
  history: RunHistoryEntry[];
  result: SubmitCommandResponse | null;
  loading: boolean;
  historyLoading: boolean;
  historyError: string | null;
  onOpenRun: (runId: string) => void;
};

export function HistoryPanel(props: HistoryPanelProps) {
  return (
    <section className="system-panel history-panel" data-testid="history-panel">
      <div className="system-panel-header">
        <div>
          <p className="kicker">{props.copy.memoryLayer}</p>
          <h2>{props.copy.runHistory}</h2>
        </div>
        <span className="subtle-text">
          {props.history.length} {props.copy.runs}
        </span>
      </div>

      {props.historyError ? <p className="error-text">{props.historyError}</p> : null}
      {props.historyLoading ? <p className="panel-lead">{props.copy.loadingHistory}</p> : null}

      {!props.historyLoading && props.history.length === 0 ? (
        <div className="empty-block compact-empty-block">
          <h3>{props.copy.noHistory}</h3>
          <p>{props.copy.noHistoryText}</p>
        </div>
      ) : null}

      {props.history.length > 0 ? (
        <div className="history-list">
          {props.history.map((run) => (
            <button
              key={run.runId}
              className={`history-item ${props.result?.runId === run.runId ? "history-item-active" : ""}`}
              onClick={() => props.onOpenRun(run.runId)}
              disabled={props.loading}
            >
              <div className="history-item-top">
                <span className={`status-badge status-${statusTone(run.routeStatus)}`}>
                  {localizeEnum(props.locale, routeStatusLabels, run.routeStatus)}
                </span>
                <span className="subtle-text">{formatTimestamp(run.receivedAt, props.locale)}</span>
              </div>
              <strong>{run.headline}</strong>
              <p>{run.commandText}</p>
              <div className="history-meta">
                <span>{localizeEnum(props.locale, workflowLabels, run.workflowType)}</span>
                <span>{localizeEnum(props.locale, riskLabels, run.riskLevel)}</span>
                <span>
                  {props.copy.localeTag}: {formatLocaleTag(run.locale)}
                </span>
              </div>
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}
