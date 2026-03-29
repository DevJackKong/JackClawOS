import type { RunHistoryEntry, SubmitCommandResponse } from "@bossassistant/contracts";

import { formatConfidence, formatTimestamp } from "../formatters";
import {
  localizeEnum,
  riskLabels,
  routeStatusLabels,
  workflowLabels,
  type AppLocale,
  type UICopy
} from "../i18n";

type MemoryRadarProps = {
  copy: UICopy;
  locale: AppLocale;
  result: SubmitCommandResponse | null;
  history: RunHistoryEntry[];
};

function buildSignals(copy: UICopy, result: SubmitCommandResponse | null, history: RunHistoryEntry[]) {
  const signals: Array<{ title: string; detail: string; meta: string }> = [];

  if (!result) {
    return history.slice(0, 3).map((run) => ({
      title: run.headline,
      detail: run.nextActionSummary,
      meta: copy.runHistory
    }));
  }

  const topCandidate = result.route.candidateWorkflows[0];
  signals.push({
    title: result.route.nextAction.summary,
    detail: result.decisionSummary.recommendedNextMove,
    meta: copy.nextActionLabel
  });
  signals.push({
    title: result.route.approvalHint.summary,
    detail: result.route.fallbackStrategy.reason,
    meta: copy.approvalHint
  });

  if (topCandidate) {
    signals.push({
      title: `${topCandidate.workflowType} ${formatConfidence(topCandidate.confidence)}`,
      detail: topCandidate.reason,
      meta: copy.candidateWorkflows
    });
  }

  return signals;
}

export function MemoryRadar(props: MemoryRadarProps) {
  const signals = buildSignals(props.copy, props.result, props.history);
  const entities = props.result?.route.detectedEntities ?? [];

  return (
    <section className="system-panel">
      <div className="system-panel-header">
        <div>
          <p className="kicker">{props.copy.liveTelemetry}</p>
          <h2>{props.copy.intelligenceRadar}</h2>
        </div>
        <span className="system-badge">{props.copy.memorySynced}</span>
      </div>

      {signals.length > 0 ? (
        <div className="radar-stack">
          {signals.map((signal) => (
            <article key={`${signal.meta}-${signal.title}`} className="signal-card">
              <div className="signal-header">
                <span className="subtle-text">{signal.meta}</span>
              </div>
              <strong>{signal.title}</strong>
              <p>{signal.detail}</p>
            </article>
          ))}
        </div>
      ) : (
        <div className="empty-block compact-empty-block">
          <p>{props.copy.noSignals}</p>
        </div>
      )}

      <div className="memory-divider" />

      <div className="system-panel-header compact-header">
        <div>
          <p className="kicker">{props.copy.memoryLayer}</p>
          <h2>{props.copy.detectedEntities}</h2>
        </div>
        <span className="subtle-text">{entities.length}</span>
      </div>

      {entities.length > 0 ? (
        <div className="entity-list">
          {entities.map((entity) => (
            <div key={`${entity.entityType}-${entity.displayName}`} className="entity-card">
              <div className="entity-avatar">{entity.displayName.slice(0, 1).toUpperCase()}</div>
              <div className="entity-copy">
                <strong>{entity.displayName}</strong>
                <span>
                  {entity.entityType} · {formatConfidence(entity.confidence)}
                </span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="empty-block compact-empty-block">
          <p>{props.copy.noEntities}</p>
        </div>
      )}

      <div className="memory-divider" />

      <div className="system-panel-header compact-header">
        <div>
          <p className="kicker">{props.copy.memoryLayer}</p>
          <h2>{props.copy.recentSignals}</h2>
        </div>
      </div>

      <div className="history-snapshot-list">
        {props.history.slice(0, 3).map((run) => (
          <div key={run.runId} className="history-snapshot">
            <div className="history-snapshot-top">
              <span>{localizeEnum(props.locale, workflowLabels, run.workflowType)}</span>
              <span>{formatTimestamp(run.receivedAt, props.locale)}</span>
            </div>
            <strong>{run.headline}</strong>
            <p>{run.nextActionSummary}</p>
            <div className="snapshot-tags">
              <span>{localizeEnum(props.locale, routeStatusLabels, run.routeStatus)}</span>
              <span>{localizeEnum(props.locale, riskLabels, run.riskLevel)}</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
