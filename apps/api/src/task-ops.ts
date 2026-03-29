import type { DemoPlan, TaskCommandEffect, TaskListItem, TaskListStatus } from "@bossassistant/contracts";

type PendingTaskMutation =
  | {
      action: "add";
      payload: {
        title: string;
        detail: string;
        status: TaskListStatus;
        source: "chat";
        startAt: string;
        endAt: string;
      };
      effect: TaskCommandEffect;
    }
  | {
      action: "update";
      taskId: string;
      patch: Partial<Pick<TaskListItem, "status" | "detail" | "startAt" | "endAt">>;
      effect: TaskCommandEffect;
    }
  | {
      action: "delete";
      taskId: string;
      effect: TaskCommandEffect;
    }
  | {
      action: "none";
      effect: TaskCommandEffect;
    };

const ADD_PATTERNS = [/新增/, /添加/, /加入/, /创建/, /安排/, /\badd\b/i, /\bcreate\b/i, /\bschedule\b/i];
const DELETE_PATTERNS = [/删除/, /删掉/, /移除/, /取消.*任务/, /\bdelete\b/i, /\bremove\b/i, /\bcancel\b/i];
const DONE_PATTERNS = [/标记.*完成/, /设为完成/, /完成这个?任务/, /搞定/, /\bdone\b/i, /\bfinish(?:ed)?\b/i, /\bcomplete(?:d)?\b/i];
const PROGRESS_PATTERNS = [/标记.*进行中/, /开始这个?任务/, /处理中/, /推进/, /\bin progress\b/i, /\bstart\b/i, /\bworking on\b/i];
const PENDING_PATTERNS = [/标记.*待办/, /稍后处理/, /\bpending\b/i, /\btodo\b/i, /\bbacklog\b/i];

function normalizeText(value: string) {
  return value.toLowerCase().replace(/[\s"'`“”‘’.,:：;；!！?？()[\]{}<>/\\-]+/g, "");
}

function cleanTaskTitle(value: string) {
  return value
    .replace(/\b(please|task|todo)\b/gi, " ")
    .replace(/^(把|将)\s*/, "")
    .replace(/^(新增|添加|加入|创建|安排|删除|删掉|移除|标记|设为|开始|完成|搞定|取消|add|create|schedule|delete|remove|complete|start)\s*/i, "")
    .replace(/(标记为?完成|标记完成|设为完成|进行中|开始处理|待办|删除|删掉|移除|取消|done|complete|in progress|pending)/gi, " ")
    .replace(/(任务|todo|task)\s*/gi, "")
    .replace(/[:：]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function roundToNextHour(date: Date) {
  const next = new Date(date);
  next.setMinutes(0, 0, 0);
  next.setHours(next.getHours() + 1);
  return next;
}

function createDateFromHour(base: Date, hour: number, minute: number) {
  const next = new Date(base);
  next.setHours(hour, minute, 0, 0);
  return next;
}

function extractDayOffset(text: string) {
  if (/后天|day after tomorrow/i.test(text)) {
    return 2;
  }

  if (/明天|tomorrow/i.test(text)) {
    return 1;
  }

  return 0;
}

function extractTimeRange(text: string) {
  const match = text.match(/(\d{1,2})(?:[:：](\d{2}))?\s*(?:点|时)?\s*(?:到|至|-|—|~)\s*(\d{1,2})(?:[:：](\d{2}))?\s*(?:点|时)?/);

  if (!match) {
    return null;
  }

  return {
    startHour: Number(match[1]),
    startMinute: Number(match[2] ?? 0),
    endHour: Number(match[3]),
    endMinute: Number(match[4] ?? 0),
    raw: match[0]
  };
}

function buildNextWindow(tasks: TaskListItem[], anchor = new Date()) {
  const latestTask = tasks
    .slice()
    .sort((left, right) => new Date(right.endAt).getTime() - new Date(left.endAt).getTime())[0];

  const anchorDate = latestTask ? new Date(latestTask.endAt) : roundToNextHour(anchor);
  const start = latestTask ? new Date(anchorDate) : anchorDate;
  const end = new Date(start);
  end.setHours(end.getHours() + 1);

  return {
    startAt: start.toISOString(),
    endAt: end.toISOString()
  };
}

function extractTaskTitle(text: string) {
  const quoted = text.match(/[“"]([^"”]+)[”"]/);

  if (quoted?.[1]) {
    return cleanTaskTitle(quoted[1]);
  }

  const noTime = cleanTaskTitle(text.replace(/(\d{1,2})(?:[:：](\d{2}))?\s*(?:点|时)?\s*(?:到|至|-|—|~)\s*(\d{1,2})(?:[:：](\d{2}))?\s*(?:点|时)?/, ""));
  return noTime.replace(/^(今天|明天|后天|today|tomorrow)\s*/i, "").trim();
}

function findTaskByQuery(tasks: TaskListItem[], query: string) {
  const normalizedQuery = normalizeText(query);

  if (!normalizedQuery) {
    return null;
  }

  return (
    tasks.find((task) => normalizeText(task.title) === normalizedQuery) ??
    tasks.find((task) => normalizeText(task.title).includes(normalizedQuery)) ??
    tasks.find((task) => normalizeText(task.detail).includes(normalizedQuery)) ??
    null
  );
}

function buildExplicitWindow(text: string) {
  const timeRange = extractTimeRange(text);

  if (!timeRange) {
    return null;
  }

  const base = new Date();
  base.setDate(base.getDate() + extractDayOffset(text));
  const start = createDateFromHour(base, timeRange.startHour, timeRange.startMinute);
  const end = createDateFromHour(base, timeRange.endHour, timeRange.endMinute);

  if (end.getTime() <= start.getTime()) {
    end.setDate(end.getDate() + 1);
  }

  return {
    startAt: start.toISOString(),
    endAt: end.toISOString()
  };
}

function pickTargetStatus(commandText: string): TaskListStatus | null {
  if (DONE_PATTERNS.some((pattern) => pattern.test(commandText))) {
    return "done";
  }

  if (PROGRESS_PATTERNS.some((pattern) => pattern.test(commandText))) {
    return "in_progress";
  }

  if (PENDING_PATTERNS.some((pattern) => pattern.test(commandText))) {
    return "pending";
  }

  return null;
}

export function parseTaskCommand(commandText: string, tasks: TaskListItem[]): PendingTaskMutation {
  const trimmed = commandText.trim();

  if (!trimmed) {
    return {
      action: "none",
      effect: {
        action: "none",
        summary: ""
      }
    };
  }

  const explicitWindow = buildExplicitWindow(trimmed);
  const targetTitle = extractTaskTitle(trimmed);
  const matchedTask = findTaskByQuery(tasks, targetTitle);

  if (DELETE_PATTERNS.some((pattern) => pattern.test(trimmed)) && matchedTask) {
    return {
      action: "delete",
      taskId: matchedTask.id,
      effect: {
        action: "deleted",
        taskId: matchedTask.id,
        summary: `已从任务清单移除「${matchedTask.title}」`
      }
    };
  }

  const nextStatus = pickTargetStatus(trimmed);

  if (nextStatus && matchedTask) {
    return {
      action: "update",
      taskId: matchedTask.id,
      patch: {
        status: nextStatus
      },
      effect: {
        action: "updated",
        taskId: matchedTask.id,
        summary: `已将「${matchedTask.title}」标记为${nextStatus === "done" ? "完成" : nextStatus === "in_progress" ? "进行中" : "待办"}`
      }
    };
  }

  if (ADD_PATTERNS.some((pattern) => pattern.test(trimmed)) && targetTitle) {
    const window = explicitWindow ?? buildNextWindow(tasks);
    return {
      action: "add",
      payload: {
        title: targetTitle,
        detail: "",
        status: "pending",
        source: "chat",
        startAt: window.startAt,
        endAt: window.endAt
      },
      effect: {
        action: "added",
        summary: `已新增任务「${targetTitle}」`
      }
    };
  }

  if ((DELETE_PATTERNS.some((pattern) => pattern.test(trimmed)) || nextStatus) && !matchedTask) {
    return {
      action: "none",
      effect: {
        action: "none",
        summary: "我想更新任务清单，但没有找到对应任务。你可以直接说出任务标题，或者先手动添加。"
      }
    };
  }

  return {
    action: "none",
    effect: {
      action: "none",
      summary: ""
    }
  };
}

export function buildPlanTaskSeeds(plan: DemoPlan, tasks: TaskListItem[], receivedAt: string) {
  const existingKeys = new Set(tasks.map((task) => normalizeText(task.title)));
  let cursorTasks = tasks.slice();

  return plan.steps.slice(0, 3).flatMap((step) => {
    const normalizedTitle = normalizeText(step.title);

    if (!normalizedTitle || existingKeys.has(normalizedTitle)) {
      return [];
    }

    const window = buildNextWindow(cursorTasks, new Date(receivedAt));
    const seed: Omit<TaskListItem, "id" | "createdAt" | "updatedAt"> = {
      title: step.title,
      detail: step.description,
      status: step.status === "ready" ? "in_progress" : step.status === "blocked" ? "pending" : "pending",
      source: "plan",
      startAt: window.startAt,
      endAt: window.endAt
    };

    existingKeys.add(normalizedTitle);
    cursorTasks = cursorTasks.concat({
      ...seed,
      id: `seed_${step.id}`,
      createdAt: receivedAt,
      updatedAt: receivedAt
    });

    return [seed];
  });
}
