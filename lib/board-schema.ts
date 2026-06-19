// board-schema.ts — the contract between the exporter (scripts/export-board.mjs) and the web view.
// The exporter produces a Board snapshot; the UI renders it. Keep this the single source of the shape.

/** The four derived columns, in display order. */
export const COLUMNS = ["todo", "in_progress", "in_review", "done"] as const;
export type Column = (typeof COLUMNS)[number];

export const COLUMN_LABELS: Record<Column, string> = {
  todo: "To Do",
  in_progress: "In Progress",
  in_review: "In Review",
  done: "Done",
};

/** One role event from the 3-role ledger = one agent comment on a card. */
export interface LedgerComment {
  /** planner | plan-review | executor | execution-review | orchestrator (free-form tolerated) */
  role: string;
  /** ISO 8601 timestamp from the ledger line. */
  ts: string;
  /** Short opaque agent id (NOT a transcript path). */
  agentId?: string;
  /** Basename of the produced artifact (path redacted to basename only). */
  artifact?: string;
  /** Present when the role was explicitly skipped inline. */
  skipReason?: string;
  /** Review decision for review roles (e.g. APPROVE / BLOCK / SHIP-WITH-FIXES). Trimmed + length-capped. */
  verdict?: string;
}

/** One ticket = one ~/.claude/tasks/<session>/<id>.json joined with its ledger. */
export interface Ticket {
  id: string;
  subject: string;
  /** Redacted (home paths stripped). May be empty. */
  description: string;
  column: Column;
  /** Raw task status: pending | in_progress | completed. */
  status: "pending" | "in_progress" | "completed";
  /** Open task ids this is blocked by (cards render a "blocked" pill when non-empty). */
  blockedBy: string[];
  /** Role audit trail, oldest-first. */
  comments: LedgerComment[];
  /** ms epoch of the task file mtime — used for ordering + "last updated". */
  updatedAt: number;
  /**
   * 8-char id of the session this ticket belongs to — matches `SessionSummary.id`.
   * OPTIONAL for back-compat: snapshots exported before v0.2.0 carry no sessionId;
   * the view falls back to showing all tickets when none is tagged.
   */
  sessionId?: string;
}

/** A selectable session (one board). */
export interface SessionSummary {
  /** Opaque short id (first 8 chars of the session uuid is fine — it is shown only behind auth). */
  id: string;
  /** Friendly label, e.g. "active 2m ago · 14 tickets". */
  label: string;
  /** ms epoch of the most-recent task-file mtime in the session. */
  lastActive: number;
  ticketCount: number;
  /** true when lastActive is within the live window (default 5 min). */
  live: boolean;
}

/** The full snapshot the web view fetches. */
export interface Board {
  /** Schema version for forward-compat. */
  schema: 1;
  /** ms epoch when this snapshot was exported. */
  generatedAt: number;
  /** The session this board's tickets belong to. */
  sessionId: string;
  /** All recent sessions, newest-first, for the picker. */
  sessions: SessionSummary[];
  /** Tickets for `sessionId`, grouped by column. */
  tickets: Ticket[];
}
