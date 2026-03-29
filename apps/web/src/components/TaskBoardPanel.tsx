import { localizeEnum, taskStatusLabels, type AppLocale, type UICopy } from "../i18n";

export type TaskBoardStatus = "pending" | "ready" | "blocked" | "done";

export type TaskBoardItem = {
  id: string;
  title: string;
  detail: string;
  status: TaskBoardStatus;
  source: "plan" | "manual";
};

type TaskBoardPanelProps = {
  copy: UICopy;
  locale: AppLocale;
  tasks: TaskBoardItem[];
  newTaskTitle: string;
  onNewTaskTitleChange: (value: string) => void;
  onAddTask: () => void;
  onTaskChange: (taskId: string, patch: Partial<TaskBoardItem>) => void;
  onMoveTask: (taskId: string, direction: "up" | "down") => void;
  onDeleteTask: (taskId: string) => void;
};

const statusOrder: TaskBoardStatus[] = ["pending", "ready", "blocked", "done"];

export function TaskBoardPanel(props: TaskBoardPanelProps) {
  return (
    <section className="system-panel task-board-panel">
      <div className="system-panel-header">
        <div>
          <p className="kicker">{props.copy.agentWorkspace}</p>
          <h2>{props.copy.taskBoard}</h2>
          <p className="panel-lead">{props.copy.taskBoardHint}</p>
        </div>
        <span className="system-badge">{props.tasks.length}</span>
      </div>

      {props.tasks.length > 0 ? (
        <div className="task-board-list">
          {props.tasks.map((task, index) => (
            <article key={task.id} className={`task-card task-${task.status}`}>
              <div className="task-card-top">
                <span className={`task-source task-source-${task.source}`}>
                  {task.source === "plan" ? props.copy.sourcePlan : props.copy.sourceManual}
                </span>
                <div className="task-reorder">
                  <button type="button" className="icon-button" onClick={() => props.onMoveTask(task.id, "up")} disabled={index === 0}>
                    {props.copy.moveUp}
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    onClick={() => props.onMoveTask(task.id, "down")}
                    disabled={index === props.tasks.length - 1}
                  >
                    {props.copy.moveDown}
                  </button>
                </div>
              </div>

              <input
                className="task-title-input"
                value={task.title}
                onChange={(event) => props.onTaskChange(task.id, { title: event.target.value })}
              />

              <textarea
                className="task-detail-input"
                value={task.detail}
                onChange={(event) => props.onTaskChange(task.id, { detail: event.target.value })}
                placeholder={props.copy.detailPlaceholder}
                rows={2}
              />

              <div className="task-card-footer">
                <div className="task-status-pills">
                  {statusOrder.map((status) => (
                    <button
                      key={status}
                      type="button"
                      className={`status-pill ${task.status === status ? "status-pill-active" : ""}`}
                      onClick={() => props.onTaskChange(task.id, { status })}
                    >
                      {localizeEnum(props.locale, taskStatusLabels, status)}
                    </button>
                  ))}
                </div>
                <button type="button" className="icon-button danger-button" onClick={() => props.onDeleteTask(task.id)}>
                  {props.copy.deleteTask}
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="empty-block compact-empty-block">
          <p>{props.copy.taskBoardEmpty}</p>
        </div>
      )}

      <div className="task-create-row">
        <input
          className="task-create-input"
          value={props.newTaskTitle}
          onChange={(event) => props.onNewTaskTitleChange(event.target.value)}
          placeholder={props.copy.newTaskPlaceholder}
        />
        <button type="button" className="primary-action" onClick={props.onAddTask}>
          {props.copy.addTask}
        </button>
      </div>
    </section>
  );
}
