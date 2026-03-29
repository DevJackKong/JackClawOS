import type { ChatMessage, SubmitCommandResponse } from "@bossassistant/contracts";

import { formatTimestamp } from "../formatters";
import {
  localeOptions,
  localizeEnum,
  policyModeLabels,
  riskLabels,
  routeStatusLabels,
  workflowLabels,
  type AppLocale,
  type UICopy
} from "../i18n";

const policyModes = ["economy", "balanced", "executive"] as const;

type PolicyMode = (typeof policyModes)[number];

type CommandChatPanelProps = {
  copy: UICopy;
  locale: AppLocale;
  commandText: string;
  policyMode: PolicyMode;
  conversation: ChatMessage[];
  result: SubmitCommandResponse | null;
  loading: boolean;
  onLocaleChange: (locale: AppLocale) => void;
  onPolicyModeChange: (mode: PolicyMode) => void;
  onCommandTextChange: (value: string) => void;
  onSubmit: () => void;
  onSampleCommand: (command: string) => void;
};

export function CommandChatPanel(props: CommandChatPanelProps) {
  const suggestedPrompts = props.copy.sampleCommands.slice(0, props.conversation.length > 0 ? 2 : 4);

  return (
    <section className="system-panel command-chat-panel" data-testid="chat-panel">
      <div className="system-panel-header command-chat-header">
        <div>
          <p className="kicker">{props.copy.agentWindow}</p>
          <h2>{props.copy.chatTitle}</h2>
          <p className="panel-lead">{props.copy.conversationAssist}</p>
        </div>
        <div className="panel-controls">
          <label className="selector-group">
            <span>{props.copy.languageLabel}</span>
            <select
              data-testid="language-select"
              value={props.locale}
              onChange={(event) => props.onLocaleChange(event.target.value as AppLocale)}
            >
              {localeOptions.map((option) => (
                <option key={option} value={option}>
                  {option === "zh-CN" ? "中文" : "English"}
                </option>
              ))}
            </select>
          </label>
          <label className="selector-group">
            <span>{props.copy.policyMode}</span>
            <select value={props.policyMode} onChange={(event) => props.onPolicyModeChange(event.target.value as PolicyMode)}>
              {policyModes.map((mode) => (
                <option key={mode} value={mode}>
                  {localizeEnum(props.locale, policyModeLabels, mode)}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="agent-presence-card">
        <div className="agent-presence-main">
          <div className="agent-avatar">JC</div>
          <div>
            <strong>{props.copy.appName}</strong>
            <p className="panel-lead">{props.loading ? props.copy.agentThinking : props.copy.agentReady}</p>
          </div>
        </div>
        <div className="agent-context-pills">
          <span className="agent-context-pill">{localizeEnum(props.locale, policyModeLabels, props.policyMode)}</span>
          {props.result ? (
            <>
              <span className="agent-context-pill">
                {localizeEnum(props.locale, workflowLabels, props.result.route.workflowType)}
              </span>
              <span className="agent-context-pill">
                {localizeEnum(props.locale, routeStatusLabels, props.result.route.routeStatus)}
              </span>
              <span className="agent-context-pill">
                {localizeEnum(props.locale, riskLabels, props.result.route.riskLevel)}
              </span>
            </>
          ) : null}
        </div>
      </div>

      <div className="chat-transcript executive-chat-transcript agent-transcript" data-testid="chat-transcript">
        {props.conversation.length > 0 ? (
          props.conversation.map((message, index) => (
            <div
              key={`${message.role}-${message.timestamp}-${index}`}
              className={`message-row message-row-${message.role}`}
              data-testid={`chat-message-${message.role}`}
            >
              <div className={`message-avatar message-avatar-${message.role}`}>{message.role === "user" ? "Y" : "JC"}</div>
              <div className={`chat-message chat-${message.role}`}>
                <div className="chat-meta">
                  <strong>{message.role === "user" ? "You" : props.copy.appName}</strong>
                  <span>{formatTimestamp(message.timestamp, props.locale)}</span>
                </div>
                <p>{message.content}</p>

                {message.role === "assistant" && props.result && index === props.conversation.length - 1 ? (
                  <div className="message-workbench">
                    <div className="message-workbench-grid">
                      <div className="message-workbench-card">
                        <span>{props.copy.liveContext}</span>
                        <strong>{props.result.route.intentLabel}</strong>
                      </div>
                      <div className="message-workbench-card">
                        <span>{props.copy.nextActionLabel}</span>
                        <strong>{props.result.route.nextAction.summary}</strong>
                      </div>
                      <div className="message-workbench-card">
                        <span>{props.copy.planOutline}</span>
                        <strong>{props.result.plan.summary}</strong>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          ))
        ) : (
          <div className="empty-block empty-agent-state">
            <h3>{props.copy.noChat}</h3>
            <p>{props.copy.noChatText}</p>
            <div className="sample-list">
              {props.copy.sampleCommands.slice(0, 3).map((sample) => (
                <button key={sample} className="sample-chip" onClick={() => props.onSampleCommand(sample)} disabled={props.loading}>
                  {sample}
                </button>
              ))}
            </div>
          </div>
        )}

        {props.loading ? (
          <div className="message-row message-row-assistant">
            <div className="message-avatar message-avatar-assistant">JC</div>
            <div className="chat-message chat-assistant chat-loading">
              <div className="chat-meta">
                <strong>{props.copy.appName}</strong>
                <span>{props.copy.routing}</span>
              </div>
              <p>{props.copy.agentThinking}</p>
            </div>
          </div>
        ) : null}
      </div>

      <div className="suggestion-row">
        <span className="subtle-text">{props.copy.suggestedPrompts}</span>
        <div className="sample-list">
          {suggestedPrompts.map((sample) => (
            <button key={sample} className="sample-chip" onClick={() => props.onSampleCommand(sample)} disabled={props.loading}>
              {sample}
            </button>
          ))}
        </div>
      </div>

      <div className="command-composer">
        <div className="composer-header">
          <span>{props.copy.agentWorkspace}</span>
          <span className="subtle-text">{props.copy.pressEnterToSend}</span>
        </div>

        <textarea
          data-testid="command-input"
          value={props.commandText}
          onChange={(event) => props.onCommandTextChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              props.onSubmit();
            }
          }}
          placeholder={props.copy.commandPlaceholder}
          rows={3}
        />

        <div className="composer-footer">
          <span className="subtle-text">{props.copy.commandConsole}</span>
          <button className="primary-action" data-testid="run-command" onClick={props.onSubmit} disabled={props.loading}>
            {props.loading ? props.copy.routing : props.copy.sendMessage}
          </button>
        </div>
      </div>
    </section>
  );
}
