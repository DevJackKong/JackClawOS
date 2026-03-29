import type { SubmitCommandResponse } from "@bossassistant/contracts";

import { formatConfidence, statusTone } from "../formatters";
import {
  approvalStageLabels,
  fallbackModeLabels,
  localizeEnum,
  nextActionLabels,
  riskLabels,
  routeStatusLabels,
  urgencyLabels,
  workflowLabels,
  type AppLocale,
  type UICopy
} from "../i18n";

type DecisionPanelProps = {
  copy: UICopy;
  locale: AppLocale;
  result: SubmitCommandResponse | null;
  error: string | null;
};

function MetricCard(props: {
  label: string;
  value: string;
  tone?: "neutral" | "warn" | "risk" | "good";
  testId?: string;
}) {
  return (
    <div className={`metric-card metric-${props.tone ?? "neutral"}`} data-testid={props.testId}>
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  );
}

export function DecisionPanel(props: DecisionPanelProps) {
  return (
    <section className="system-panel decision-panel" data-testid="active-decision">
      <div className="system-panel-header">
        <div>
          <p className="kicker">{props.copy.activeWorkflow}</p>
          <h2>{props.copy.activeDecision}</h2>
        </div>
        <span className="system-badge">{props.result ? props.copy.workflowFirst : props.copy.systemStatus}</span>
      </div>

      {props.error ? <p className="error-text">{props.error}</p> : null}

      {props.result ? (
        <>
          <div className="status-banner">
            <span className={`status-badge status-${statusTone(props.result.route.routeStatus)}`} data-testid="route-status-badge">
              {localizeEnum(props.locale, routeStatusLabels, props.result.route.routeStatus)}
            </span>
            <span className="status-next-action">{props.result.route.nextAction.summary}</span>
          </div>

          <div className="decision-heading">
            <h2>{props.result.decisionSummary.headline}</h2>
            <p className="panel-lead">{props.result.decisionSummary.operatorView}</p>
            <p className="next-move">{props.result.decisionSummary.recommendedNextMove}</p>
          </div>

          <div className="metric-grid">
            <MetricCard
              label={props.copy.workflowMetric}
              value={localizeEnum(props.locale, workflowLabels, props.result.route.workflowType)}
              tone="good"
              testId="metric-workflow"
            />
            <MetricCard label={props.copy.confidenceMetric} value={formatConfidence(props.result.route.confidence)} />
            <MetricCard
              label={props.copy.riskMetric}
              value={localizeEnum(props.locale, riskLabels, props.result.route.riskLevel)}
              tone="risk"
            />
            <MetricCard
              label={props.copy.urgencyMetric}
              value={localizeEnum(props.locale, urgencyLabels, props.result.route.urgency)}
              tone="warn"
            />
          </div>

          <div className="decision-section-grid">
            <div className="mini-panel">
              <div className="mini-panel-header">
                <span>{props.copy.routeControl}</span>
                <span className="subtle-text">{props.result.route.intentLabel}</span>
              </div>
              <ul className="simple-list compact-list">
                <li>
                  <strong>{props.copy.statusLabel}</strong>
                  <span>{localizeEnum(props.locale, routeStatusLabels, props.result.route.routeStatus)}</span>
                </li>
                <li>
                  <strong>{props.copy.nextActionLabel}</strong>
                  <span>{localizeEnum(props.locale, nextActionLabels, props.result.route.nextAction.type)}</span>
                </li>
                <li>
                  <strong>{props.copy.fallbackModeLabel}</strong>
                  <span>{localizeEnum(props.locale, fallbackModeLabels, props.result.route.fallbackStrategy.mode)}</span>
                </li>
              </ul>
            </div>

            <div className="mini-panel">
              <div className="mini-panel-header">
                <span>{props.copy.approvalHint}</span>
                <span className="subtle-text">
                  {localizeEnum(props.locale, approvalStageLabels, props.result.route.approvalHint.stage)}
                </span>
              </div>
              <p className="panel-lead">{props.result.route.approvalHint.summary}</p>
              <div className="tag-row">
                {props.result.route.approvalHint.reasonCodes.length > 0 ? (
                  props.result.route.approvalHint.reasonCodes.map((reasonCode) => (
                    <span key={reasonCode} className="tag">
                      {reasonCode}
                    </span>
                  ))
                ) : (
                  <span className="tag">{props.copy.noApprovalTrigger}</span>
                )}
              </div>
            </div>
          </div>

          <div className="mini-panel" data-testid="required-inputs-panel">
            <div className="mini-panel-header">
              <span>{props.copy.requiredInputs}</span>
              <span className="subtle-text">
                {props.result.route.requiredInputs.length} {props.copy.items}
              </span>
            </div>
            <ul className="simple-list compact-list">
              {props.result.route.requiredInputs.length > 0 ? (
                props.result.route.requiredInputs.map((item) => (
                  <li key={item.key}>
                    <strong>
                      {item.label} · {item.severity}
                    </strong>
                    <span>{item.reason}</span>
                  </li>
                ))
              ) : (
                <li>{props.copy.routeEnoughDetail}</li>
              )}
            </ul>
          </div>

          <div className="decision-section-grid">
            <div className="mini-panel">
              <div className="mini-panel-header">
                <span>{props.copy.fallbackStrategy}</span>
                <span className="subtle-text">
                  {localizeEnum(props.locale, fallbackModeLabels, props.result.route.fallbackStrategy.mode)}
                </span>
              </div>
              <p className="panel-lead">{props.result.route.fallbackStrategy.reason}</p>
              <ul className="simple-list">
                {props.result.route.fallbackStrategy.requiredUserInput.length > 0 ? (
                  props.result.route.fallbackStrategy.requiredUserInput.map((item) => <li key={item}>{item}</li>)
                ) : (
                  <li>{props.copy.noExtraClarification}</li>
                )}
              </ul>
            </div>

            <div className="mini-panel">
              <div className="mini-panel-header">
                <span>{props.copy.candidateWorkflows}</span>
                <span className="subtle-text">
                  {props.result.route.candidateWorkflows.length} {props.copy.scored}
                </span>
              </div>
              <ul className="simple-list compact-list">
                {props.result.route.candidateWorkflows.length > 0 ? (
                  props.result.route.candidateWorkflows.map((candidate) => (
                    <li key={candidate.workflowType}>
                      <strong>
                        {localizeEnum(props.locale, workflowLabels, candidate.workflowType)} · {formatConfidence(candidate.confidence)}
                      </strong>
                      <span>{candidate.reason}</span>
                    </li>
                  ))
                ) : (
                  <li>{props.copy.noCandidates}</li>
                )}
              </ul>
            </div>
          </div>

          <div className="mini-panel plan-panel" data-testid="plan-panel">
            <div className="mini-panel-header">
              <span>{props.copy.planOutline}</span>
              <span className="subtle-text">
                {localizeEnum(props.locale, workflowLabels, props.result.plan.workflowType)}
              </span>
            </div>
            <p className="panel-lead">{props.result.plan.summary}</p>
            <ul className="plan-stream">
              {props.result.plan.steps.map((step, index) => (
                <li key={step.id} className="plan-step">
                  <div className="plan-index">{index + 1}</div>
                  <div>
                    <strong>{step.title}</strong>
                    <p>{step.description}</p>
                  </div>
                </li>
              ))}
            </ul>
            <div className="decision-section-grid">
              <div>
                <p className="kicker">{props.copy.criteriaLabel}</p>
                <ul className="simple-list">
                  {props.result.plan.doneCriteria.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="kicker">{props.copy.artifactsLabel}</p>
                <ul className="simple-list">
                  {props.result.plan.expectedArtifacts.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </>
      ) : (
        <div className="empty-block">
          <h3>{props.copy.noRun}</h3>
          <p>{props.copy.noRunText}</p>
        </div>
      )}
    </section>
  );
}
