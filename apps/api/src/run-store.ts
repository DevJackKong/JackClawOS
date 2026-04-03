import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import {
  dashboardBriefingSchema,
  listInspirationNotesResponseSchema,
  listRunsResponseSchema,
  listSocialEventsResponseSchema,
  listTasksResponseSchema,
  runHistoryEntrySchema,
  submitCommandResponseSchema,
  type InspirationNote,
  type RunHistoryEntry,
  type SocialEvent,
  type SocialEventStatus,
  type SubmitCommandResponse,
  type TaskListItem,
  type TaskListSource,
  type TaskListStatus
} from "@bossassistant/contracts";

import { buildCockpitState } from "./cockpit.js";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");

type RunRow = {
  run_id: string;
  command_id: string;
  command_text: string;
  policy_mode: RunHistoryEntry["policyMode"];
  locale: string | null;
  received_at: string;
  workflow_type: RunHistoryEntry["workflowType"];
  route_status: RunHistoryEntry["routeStatus"];
  risk_level: RunHistoryEntry["riskLevel"];
  urgency: RunHistoryEntry["urgency"];
  headline: string;
  next_action_summary: string;
  payload_json?: string;
};

type TaskRow = {
  id: string;
  title: string;
  detail: string;
  status: TaskListStatus;
  source: TaskListSource;
  start_at: string;
  end_at: string;
  created_at: string;
  updated_at: string;
};

type SocialEventRow = {
  id: string;
  title: string;
  detail: string;
  location: string;
  start_at: string;
  end_at: string;
  remind_minutes: number;
  status: SocialEventStatus;
  created_at: string;
  updated_at: string;
};

type InspirationNoteRow = {
  id: string;
  title: string;
  content: string;
  source: string;
  tag: string;
  created_at: string;
  updated_at: string;
};

function resolveDatabasePath() {
  const configuredPath = process.env.BOSSASSISTANT_DB_PATH;
  return path.resolve(configuredPath ?? path.join(process.cwd(), "data", "bossassistant.sqlite"));
}

function buildEmptyDashboardBriefing() {
  return dashboardBriefingSchema.parse({
    refreshedAt: new Date().toISOString(),
    hotspots: {
      social: [],
      news: []
    },
    aiColumn: {
      github: [],
      research: [],
      funding: []
    }
  });
}

export class RunStore {
  private readonly db: InstanceType<typeof DatabaseSync>;

  constructor() {
    const databasePath = resolveDatabasePath();
    mkdirSync(path.dirname(databasePath), { recursive: true });

    this.db = new DatabaseSync(databasePath);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;

      CREATE TABLE IF NOT EXISTS task_runs (
        run_id TEXT PRIMARY KEY,
        command_id TEXT NOT NULL,
        command_text TEXT NOT NULL,
        policy_mode TEXT NOT NULL,
        locale TEXT,
        received_at TEXT NOT NULL,
        workflow_type TEXT NOT NULL,
        route_status TEXT NOT NULL,
        risk_level TEXT NOT NULL,
        urgency TEXT NOT NULL,
        headline TEXT NOT NULL,
        next_action_summary TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_task_runs_received_at
      ON task_runs (received_at DESC);

      CREATE TABLE IF NOT EXISTS task_items (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        detail TEXT NOT NULL,
        status TEXT NOT NULL,
        source TEXT NOT NULL,
        start_at TEXT NOT NULL,
        end_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_task_items_start_at
      ON task_items (start_at ASC, created_at ASC);

      CREATE TABLE IF NOT EXISTS social_events (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        detail TEXT NOT NULL,
        location TEXT NOT NULL,
        start_at TEXT NOT NULL,
        end_at TEXT NOT NULL,
        remind_minutes INTEGER NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_social_events_start_at
      ON social_events (start_at ASC, created_at ASC);

      CREATE TABLE IF NOT EXISTS inspiration_notes (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        source TEXT NOT NULL,
        tag TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_inspiration_notes_created_at
      ON inspiration_notes (created_at DESC);
    `);
  }

  private toTaskItem(row: TaskRow): TaskListItem {
    return {
      id: row.id,
      title: row.title,
      detail: row.detail,
      status: row.status,
      source: row.source,
      startAt: row.start_at,
      endAt: row.end_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  private writeTask(task: TaskListItem) {
    this.db
      .prepare(`
        INSERT OR REPLACE INTO task_items (
          id,
          title,
          detail,
          status,
          source,
          start_at,
          end_at,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        task.id,
        task.title,
        task.detail,
        task.status,
        task.source,
        task.startAt,
        task.endAt,
        task.createdAt,
        task.updatedAt
      );
  }

  private toSocialEvent(row: SocialEventRow): SocialEvent {
    return {
      id: row.id,
      title: row.title,
      detail: row.detail,
      location: row.location,
      startAt: row.start_at,
      endAt: row.end_at,
      remindMinutes: row.remind_minutes,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  private writeSocialEvent(event: SocialEvent) {
    this.db.prepare(`
      INSERT OR REPLACE INTO social_events (
        id,
        title,
        detail,
        location,
        start_at,
        end_at,
        remind_minutes,
        status,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.id,
      event.title,
      event.detail,
      event.location,
      event.startAt,
      event.endAt,
      event.remindMinutes,
      event.status,
      event.createdAt,
      event.updatedAt
    );
  }

  private toInspirationNote(row: InspirationNoteRow): InspirationNote {
    return {
      id: row.id,
      title: row.title,
      content: row.content,
      source: row.source,
      tag: row.tag,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  private writeInspirationNote(note: InspirationNote) {
    this.db.prepare(`
      INSERT OR REPLACE INTO inspiration_notes (
        id,
        title,
        content,
        source,
        tag,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      note.id,
      note.title,
      note.content,
      note.source,
      note.tag,
      note.createdAt,
      note.updatedAt
    );
  }

  saveRun(payload: SubmitCommandResponse) {
    const validated = submitCommandResponseSchema.parse(payload);

    this.db
      .prepare(`
        INSERT OR REPLACE INTO task_runs (
          run_id,
          command_id,
          command_text,
          policy_mode,
          locale,
          received_at,
          workflow_type,
          route_status,
          risk_level,
          urgency,
          headline,
          next_action_summary,
          payload_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        validated.runId,
        validated.input.commandId,
        validated.input.commandText,
        validated.input.policyMode,
        validated.input.locale ?? null,
        validated.receivedAt,
        validated.route.workflowType,
        validated.route.routeStatus,
        validated.route.riskLevel,
        validated.route.urgency,
        validated.decisionSummary.headline,
        validated.route.nextAction.summary,
        JSON.stringify(validated)
      );

    return validated;
  }

  listRuns(limit = 8): RunHistoryEntry[] {
    const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 50);
    const rows = this.db
      .prepare(`
        SELECT
          run_id,
          command_id,
          command_text,
          policy_mode,
          locale,
          received_at,
          workflow_type,
          route_status,
          risk_level,
          urgency,
          headline,
          next_action_summary
        FROM task_runs
        ORDER BY received_at DESC
        LIMIT ?
      `)
      .all(safeLimit) as RunRow[];

    return listRunsResponseSchema.parse({
      runs: rows.map((row) =>
        runHistoryEntrySchema.parse({
          runId: row.run_id,
          commandId: row.command_id,
          commandText: row.command_text,
          policyMode: row.policy_mode,
          locale: row.locale ?? undefined,
          receivedAt: row.received_at,
          workflowType: row.workflow_type,
          routeStatus: row.route_status,
          riskLevel: row.risk_level,
          urgency: row.urgency,
          headline: row.headline,
          nextActionSummary: row.next_action_summary
        })
      )
    }).runs;
  }

  listTasks(): TaskListItem[] {
    const rows = this.db
      .prepare(`
        SELECT
          id,
          title,
          detail,
          status,
          source,
          start_at,
          end_at,
          created_at,
          updated_at
        FROM task_items
        ORDER BY start_at ASC, end_at ASC, created_at ASC
      `)
      .all() as TaskRow[];

    return listTasksResponseSchema.parse({
      tasks: rows.map((row) => this.toTaskItem(row))
    }).tasks;
  }

  listSocialEvents(): SocialEvent[] {
    const rows = this.db.prepare(`
      SELECT
        id,
        title,
        detail,
        location,
        start_at,
        end_at,
        remind_minutes,
        status,
        created_at,
        updated_at
      FROM social_events
      ORDER BY start_at ASC, end_at ASC, created_at ASC
    `).all() as SocialEventRow[];

    return listSocialEventsResponseSchema.parse({
      socialEvents: rows.map((row) => this.toSocialEvent(row))
    }).socialEvents;
  }

  getSocialEvent(eventId: string): SocialEvent | null {
    const row = this.db.prepare(`
      SELECT
        id,
        title,
        detail,
        location,
        start_at,
        end_at,
        remind_minutes,
        status,
        created_at,
        updated_at
      FROM social_events
      WHERE id = ?
    `).get(eventId) as SocialEventRow | undefined;

    return row ? this.toSocialEvent(row) : null;
  }

  createSocialEvent(input: {
    id?: string;
    title: string;
    detail?: string;
    location?: string;
    startAt: string;
    endAt: string;
    remindMinutes?: number;
    status?: SocialEventStatus;
    createdAt?: string;
    updatedAt?: string;
  }) {
    const timestamp = new Date().toISOString();
    const event: SocialEvent = {
      id: input.id ?? `social_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      title: input.title,
      detail: input.detail ?? "",
      location: input.location ?? "",
      startAt: input.startAt,
      endAt: input.endAt,
      remindMinutes: input.remindMinutes ?? 30,
      status: input.status ?? "planned",
      createdAt: input.createdAt ?? timestamp,
      updatedAt: input.updatedAt ?? timestamp
    };

    this.writeSocialEvent(event);
    return event;
  }

  updateSocialEvent(
    eventId: string,
    patch: Partial<Pick<SocialEvent, "title" | "detail" | "location" | "startAt" | "endAt" | "remindMinutes" | "status">>
  ) {
    const current = this.getSocialEvent(eventId);

    if (!current) {
      return null;
    }

    const next: SocialEvent = {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString()
    };

    this.writeSocialEvent(next);
    return next;
  }

  deleteSocialEvent(eventId: string) {
    const result = this.db.prepare(`DELETE FROM social_events WHERE id = ?`).run(eventId);
    return result.changes > 0;
  }

  listInspirationNotes(): InspirationNote[] {
    const rows = this.db.prepare(`
      SELECT
        id,
        title,
        content,
        source,
        tag,
        created_at,
        updated_at
      FROM inspiration_notes
      ORDER BY created_at DESC, updated_at DESC
    `).all() as InspirationNoteRow[];

    return listInspirationNotesResponseSchema.parse({
      inspirationNotes: rows.map((row) => this.toInspirationNote(row))
    }).inspirationNotes;
  }

  getInspirationNote(noteId: string): InspirationNote | null {
    const row = this.db.prepare(`
      SELECT
        id,
        title,
        content,
        source,
        tag,
        created_at,
        updated_at
      FROM inspiration_notes
      WHERE id = ?
    `).get(noteId) as InspirationNoteRow | undefined;

    return row ? this.toInspirationNote(row) : null;
  }

  createInspirationNote(input: {
    id?: string;
    title: string;
    content: string;
    source?: string;
    tag?: string;
    createdAt?: string;
    updatedAt?: string;
  }) {
    const timestamp = new Date().toISOString();
    const note: InspirationNote = {
      id: input.id ?? `idea_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      title: input.title,
      content: input.content,
      source: input.source ?? "",
      tag: input.tag ?? "",
      createdAt: input.createdAt ?? timestamp,
      updatedAt: input.updatedAt ?? timestamp
    };

    this.writeInspirationNote(note);
    return note;
  }

  updateInspirationNote(
    noteId: string,
    patch: Partial<Pick<InspirationNote, "title" | "content" | "source" | "tag">>
  ) {
    const current = this.getInspirationNote(noteId);

    if (!current) {
      return null;
    }

    const next: InspirationNote = {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString()
    };

    this.writeInspirationNote(next);
    return next;
  }

  deleteInspirationNote(noteId: string) {
    const result = this.db.prepare(`DELETE FROM inspiration_notes WHERE id = ?`).run(noteId);
    return result.changes > 0;
  }

  getTask(taskId: string): TaskListItem | null {
    const row = this.db
      .prepare(`
        SELECT
          id,
          title,
          detail,
          status,
          source,
          start_at,
          end_at,
          created_at,
          updated_at
        FROM task_items
        WHERE id = ?
      `)
      .get(taskId) as TaskRow | undefined;

    return row ? this.toTaskItem(row) : null;
  }

  createTask(input: {
    id?: string;
    title: string;
    detail?: string;
    status?: TaskListStatus;
    source?: TaskListSource;
    startAt: string;
    endAt: string;
    createdAt?: string;
    updatedAt?: string;
  }) {
    const timestamp = new Date().toISOString();
    const task: TaskListItem = {
      id: input.id ?? `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      title: input.title,
      detail: input.detail ?? "",
      status: input.status ?? "pending",
      source: input.source ?? "manual",
      startAt: input.startAt,
      endAt: input.endAt,
      createdAt: input.createdAt ?? timestamp,
      updatedAt: input.updatedAt ?? timestamp
    };

    this.writeTask(task);
    return task;
  }

  upsertTask(task: TaskListItem) {
    this.writeTask(task);
    return task;
  }

  updateTask(
    taskId: string,
    patch: Partial<Pick<TaskListItem, "title" | "detail" | "status" | "source" | "startAt" | "endAt">>
  ) {
    const current = this.getTask(taskId);

    if (!current) {
      return null;
    }

    const next: TaskListItem = {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString()
    };

    this.writeTask(next);
    return next;
  }

  deleteTask(taskId: string) {
    const result = this.db
      .prepare(`
        DELETE FROM task_items
        WHERE id = ?
      `)
      .run(taskId);

    return result.changes > 0;
  }

  getRun(runId: string): SubmitCommandResponse | null {
    const row = this.db
      .prepare(`
        SELECT payload_json
        FROM task_runs
        WHERE run_id = ?
      `)
      .get(runId) as Pick<RunRow, "payload_json"> | undefined;

    if (!row?.payload_json) {
      return null;
    }

    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(row.payload_json) as Record<string, unknown>;
    } catch {
      console.error(`[RunStore] corrupt payload_json for run ${runId}, skipping`);
      return null;
    }

    const parsed = submitCommandResponseSchema.safeParse(raw);

    if (parsed.success) {
      return parsed.data;
    }

    const legacyParsed = submitCommandResponseSchema.omit({
      cockpit: true,
      tasks: true,
      dashboard: true,
      taskCommandEffect: true
    }).safeParse(raw);

    if (!legacyParsed.success) {
      console.error(`[RunStore] unrecoverable payload for run ${runId}`, legacyParsed.error.message);
      return null;
    }

    return submitCommandResponseSchema.parse({
      ...legacyParsed.data,
      cockpit: buildCockpitState({
        locale: legacyParsed.data.input.locale,
        history: this.listRuns(8),
        receivedAt: legacyParsed.data.receivedAt,
        input: legacyParsed.data.input,
        route: legacyParsed.data.route,
        plan: legacyParsed.data.plan,
        conversation: legacyParsed.data.conversation
      }),
      tasks: this.listTasks(),
      dashboard: buildEmptyDashboardBriefing()
    });
  }
}

export const runStore = new RunStore();
