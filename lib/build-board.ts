// build-board.ts — board-assembly logic. The IO wrapper (scripts/export-board.ts)
// reads the local stores and feeds already-parsed inputs into these deterministic
// functions, which is what makes the whole exporter unit-testable.
//
// ONE narrow filesystem exception lives here: the verdict-from-artifact FALLBACK
// in toComment(). When a review-role ledger line carries no `verdict` field but
// DOES have an artifact_path, we best-effort read the artifact and lift its
// `Decision:` token onto the comment. The read is fully guarded (try/catch,
// 64KB cap) so a missing/unreadable/huge file never throws — it just yields no
// verdict. The token-extraction itself (extractDecisionVerdict) stays PURE.

import { closeSync, openSync, readSync } from "fs";

import type {
  Board,
  Column,
  LedgerComment,
  SessionSummary,
  Ticket,
} from "./board-schema";
import { PIPELINE_ROLES } from "./ui-meta";

/** The canonical pipeline roles as a set (orchestrator is NOT a member). */
const PIPELINE_ROLE_SET = new Set<string>(PIPELINE_ROLES);

/** Default "live" window — a session is live if its last activity is within this. */
export const LIVE_WINDOW_MS = 5 * 60 * 1000;

/** Raw task as stored in ~/.claude/tasks/<session>/<id>.json. */
export interface RawTask {
  id: string;
  subject: string;
  description: string;
  activeForm?: string;
  status: "pending" | "in_progress" | "completed";
  blocks: string[];
  blockedBy: string[];
}

/** One parsed line from a ~/.claude/3role-ledger/<session>/<id>.jsonl file. */
export interface RawLedgerLine {
  role: string;
  ts: string;
  session_id?: string;
  agentId?: string;
  artifact_path?: string;
  skip_reason?: string;
  oracle?: string;
  /** Review decision written by a review role (plan-review / execution-review / ship-review). */
  verdict?: string;
}

/** Max characters kept for a verdict pill — long verdicts are truncated. */
export const VERDICT_MAX_LEN = 24;

/** Roles whose artifact may carry a `Decision:` verdict when the ledger omits one. */
const REVIEW_ROLES = new Set(["plan-review", "execution-review"]);

/** Only scan the first 64KB of a review artifact — never slurp a huge file. */
const ARTIFACT_READ_CAP_BYTES = 64 * 1024;

/** Recognised verdict tokens written as a `Decision: <token>` line in an artifact. */
const DECISION_RE =
  /Decision:\s*(PASS|FAIL|REVISE|APPROVE|BLOCK|SHIP-WITH-FIXES)/i;

/**
 * PURE: extract the first `Decision: <token>` verdict from arbitrary text.
 * Case-insensitive on the token; returns the matched token (original casing)
 * or undefined when no Decision line is present. No filesystem access.
 */
export function extractDecisionVerdict(text: string): string | undefined {
  if (typeof text !== "string") return undefined;
  const m = DECISION_RE.exec(text);
  return m ? m[1] : undefined;
}

/**
 * Best-effort read of the first ARTIFACT_READ_CAP_BYTES of a file. Fully guarded:
 * a missing / unreadable / permission-denied path yields undefined, never throws.
 */
function readArtifactHead(path: string): string | undefined {
  let fd: number | undefined;
  try {
    fd = openSync(path, "r");
    const buf = Buffer.alloc(ARTIFACT_READ_CAP_BYTES);
    const bytes = readSync(fd, buf, 0, ARTIFACT_READ_CAP_BYTES, 0);
    return buf.toString("utf8", 0, bytes);
  } catch {
    return undefined;
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        /* ignore close failure — best-effort */
      }
    }
  }
}

// Home-path patterns. NO hardcoded username — every <name> segment is a wildcard.
// Matched up to (but not including) the next path separator or whitespace.
const HOME_PATTERNS: RegExp[] = [
  // /Users/<name>  and  /home/<name>  (unix + macOS)
  /\/(?:Users|home)\/[^/\\\s]+/gi,
  // C:\Users\<name>  (Windows, backslash) and C:/Users/<name> (forward-slash)
  /[a-z]:[\\/]Users[\\/][^/\\\s]+/gi,
];

/**
 * Strip absolute home paths from a string so no `/Users/<name>/`, `/home/<name>/`,
 * or `C:\Users\<name>\` survives. Each home-prefix collapses to `~`. An optional
 * homedir prefix passed in is collapsed first. Uses NO hardcoded username.
 */
export function redact(s: string, homedir?: string): string {
  if (typeof s !== "string") return s;
  let out = s;
  if (homedir && homedir.length > 0) {
    // Collapse a literal leading homedir prefix to `~` (e.g. the machine homedir).
    while (out.includes(homedir)) {
      out = out.replace(homedir, "~");
    }
  }
  for (const pat of HOME_PATTERNS) {
    out = out.replace(pat, "~");
  }
  return out;
}

/** Pure basename for both `/` and `\` separated paths (no fs/path import). */
export function basenameOf(p: string): string {
  if (!p) return p;
  const parts = p.split(/[\\/]/);
  // Drop trailing empty segments (e.g. a trailing slash).
  for (let i = parts.length - 1; i >= 0; i--) {
    if (parts[i] !== "") return parts[i];
  }
  return p;
}

/**
 * Map a raw task status (+ derived ledger signals) to a display Column:
 *   completed                                       → done
 *   in_progress + a PENDING execution-review        → in_review
 *   in_progress otherwise                            → in_progress
 *   pending + a pipeline-role comment                → in_progress (already started)
 *   pending otherwise                                → todo
 *
 * `hasPendingExecutionReview` is TRUE iff the NEWEST execution-review ledger line is
 * still unresolved (no verdict). A resolved (PASS/FAIL) execution-review, or none at
 * all, leaves an in_progress task in in_progress — "a review is pending NOW", not
 * "a review ever happened" (#1304).
 *
 * `hasPipelineRoleComment` is TRUE iff the ledger carries ≥1 comment whose role is a
 * PIPELINE_ROLES member (planner / plan-review / executor / execution-review).
 * orchestrator is EXCLUDED, so an orchestrator-only pending task stays in todo.
 */
export function toColumn(
  status: RawTask["status"],
  hasPendingExecutionReview: boolean,
  hasPipelineRoleComment = false
): Column {
  switch (status) {
    case "completed":
      return "done";
    case "in_progress":
      return hasPendingExecutionReview ? "in_review" : "in_progress";
    case "pending":
    default:
      return hasPipelineRoleComment ? "in_progress" : "todo";
  }
}

/**
 * Resolve a review line's verdict: PRIMARY explicit `verdict` field (trimmed,
 * non-empty), FALLBACK the artifact's `Decision:` token (review-roles only, via a
 * guarded best-effort artifact read). Returns the RAW token (no redact / no cap)
 * or undefined when no verdict can be resolved. Pure except the guarded read —
 * never throws. This is the SINGLE source of truth for verdict resolution: both
 * `toComment` (display) and `hasPendingExecutionReview` (column) call it.
 */
function resolveVerdict(line: RawLedgerLine): string | undefined {
  // PRIMARY: an explicit verdict recorded on the ledger line.
  if (typeof line.verdict === "string") {
    const v = line.verdict.trim();
    if (v) return v;
  }

  // FALLBACK: review-role line with no ledger verdict but a readable artifact
  // carrying a `Decision: <token>` line (e.g. a review recorded without
  // --verdict). Best-effort + safe — never throws, never crashes board build.
  if (
    REVIEW_ROLES.has(line.role) &&
    typeof line.artifact_path === "string" &&
    line.artifact_path.length > 0
  ) {
    const text = readArtifactHead(line.artifact_path);
    const decision = text ? extractDecisionVerdict(text) : undefined;
    if (decision) {
      const d = decision.trim();
      if (d) return d;
    }
  }

  return undefined;
}

/** Parse one ledger line into a redacted, UI-safe comment. */
function toComment(line: RawLedgerLine): LedgerComment {
  const c: LedgerComment = { role: line.role, ts: line.ts };
  if (line.agentId) c.agentId = line.agentId;
  if (line.artifact_path) c.artifact = redact(basenameOf(line.artifact_path));
  if (line.skip_reason) c.skipReason = line.skip_reason;

  // Resolve the verdict from the single source of truth, then apply the
  // display-only redact + length cap. The post-redact truthiness guard is kept:
  // a raw token that redacts to empty must STILL not set a verdict.
  const raw = resolveVerdict(line);
  if (raw !== undefined) {
    const v = redact(raw).slice(0, VERDICT_MAX_LEN);
    if (v) c.verdict = v;
  }

  return c;
}

/**
 * TRUE iff the NEWEST `execution-review` ledger line is still PENDING (no resolved
 * verdict). "Newest" = max by parsed `ts`; a tie (equal `ts`, or all `ts`
 * NaN/missing) is broken by LATEST array index — the ledger is append-ordered, so
 * the last-appended execution-review is the genuinely newest at equal-second
 * granularity. A NaN/missing `ts` sorts as oldest. Returns false when there is no
 * execution-review at all. (MINOR-1 tiebreak; #1304.)
 */
function hasPendingExecutionReview(ledgerLines: RawLedgerLine[]): boolean {
  let newest: RawLedgerLine | undefined;
  let newestTs = -Infinity; // NaN/missing ts sorts as oldest (-Infinity)
  for (const line of ledgerLines) {
    if (line.role !== "execution-review") continue;
    const parsed = Date.parse(line.ts);
    const ts = Number.isNaN(parsed) ? -Infinity : parsed;
    // `>=` over a forward scan: on a tie the LATER array index wins (append-order).
    if (newest === undefined || ts >= newestTs) {
      newest = line;
      newestTs = ts;
    }
  }
  if (newest === undefined) return false;
  return resolveVerdict(newest) === undefined;
}

/**
 * Build a single Ticket from a raw task, its (possibly empty) ledger lines, and
 * the task-file mtime (ms epoch). Comments are ordered oldest-first by ts.
 *
 * `updatedAt` is the NEWER of the task-file mtime and the optional per-ticket
 * 3-role ledger mtime (`ledgerMtimeMs`). During a 4-role chain the work appends
 * to `<ledgerDir>/<session>/<taskId>.jsonl` without touching the task file, so a
 * task-file-only `updatedAt` goes stale mid-work and the ticket's lane stops
 * breathing (#1305 — the per-ticket twin of the session-level #1121 fix). Folding
 * the ledger mtime via `max` keeps the lane lit. NO-OP when `ledgerMtimeMs` is
 * undefined: `max(mtimeMs, 0) === mtimeMs` (mtimeMs is a positive epoch), so a
 * ticket with no ledger file behaves exactly as before.
 */
export function buildTicket(
  rawTask: RawTask,
  ledgerLines: RawLedgerLine[],
  mtimeMs: number,
  sessionId?: string,
  ledgerMtimeMs?: number
): Ticket {
  const comments = [...ledgerLines]
    .sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts))
    .map(toComment);

  const pendingExecutionReview = hasPendingExecutionReview(ledgerLines);
  // TRUE iff any ledger comment is from a pipeline role (orchestrator excluded) —
  // lets a pending task that a role has already started surface as in_progress.
  const hasPipelineRoleComment = ledgerLines.some((l) =>
    PIPELINE_ROLE_SET.has(l.role)
  );

  const ticket: Ticket = {
    id: rawTask.id,
    subject: rawTask.subject,
    description: redact(rawTask.description ?? ""),
    column: toColumn(rawTask.status, pendingExecutionReview, hasPipelineRoleComment),
    status: rawTask.status,
    blockedBy: rawTask.blockedBy ?? [],
    comments,
    updatedAt: Math.max(mtimeMs, ledgerMtimeMs ?? 0),
  };
  if (sessionId) ticket.sessionId = sessionId;
  return ticket;
}

/** Human-friendly relative-time fragment, e.g. "just now", "2m", "3h", "5d". */
function relTime(diffMs: number): string {
  if (diffMs < 60_000) return "just now";
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

/**
 * Build a SessionSummary for the picker. `live` is true when lastActive is within
 * the 5-minute window of nowMs. `id` is the first 8 chars of the session uuid.
 */
export function buildSessionSummary(
  sessionId: string,
  lastActiveMs: number,
  ticketCount: number,
  nowMs: number
): SessionSummary {
  const diff = nowMs - lastActiveMs;
  const rel = relTime(diff);
  const when = rel === "just now" ? "just now" : `${rel} ago`;
  return {
    id: sessionId.slice(0, 8),
    label: `active ${when} · ${ticketCount} tickets`,
    lastActive: lastActiveMs,
    ticketCount,
    live: diff <= LIVE_WINDOW_MS,
  };
}

/** The display columns that represent OPEN (non-terminal) work. `done` is terminal. */
const OPEN_COLUMNS = new Set<Column>(["todo", "in_progress", "in_review"]);

/** One non-live session holding orphaned open work, with its open-ticket count. */
export interface OrphanBacklog {
  /** 8-char session id (matches `SessionSummary.id` and `Ticket.sessionId`). */
  sessionId: string;
  /** Number of OPEN tickets stranded under this non-live session. */
  openCount: number;
}

/**
 * PURE: detect orphaned backlog — OPEN tickets (todo|in_progress|in_review)
 * stranded under a NON-live (superseded) session while a LIVE session exists.
 *
 * This is the genuine post-`/clear` orphan signal: when a session is retired the
 * agent-kanban backlog stays under the dead session's id, so the new live session
 * can't see or update it. It fires in that canonical case (open work under a
 * non-live prior session + a newer live session present) and stays SILENT when
 * the board merely spans several LIVE sessions (normal concurrent multi-agent
 * work is multi-session by design). Reuses the `SessionSummary.live` signal.
 *
 * Returns one entry per non-live session that holds ≥1 open ticket, sorted by
 * open count (desc). Empty when no live session exists (no migration target) or
 * when all open tickets already sit under a live session.
 */
export function detectOrphanBacklog(
  tickets: Ticket[],
  sessions: SessionSummary[]
): OrphanBacklog[] {
  // No live session → no migration target → not an actionable orphan signal.
  if (!sessions.some((s) => s.live)) return [];

  // sessionId(8-char) → live? — sessions absent from this map are ignored.
  const liveById = new Map<string, boolean>(sessions.map((s) => [s.id, s.live]));

  const counts = new Map<string, number>();
  for (const t of tickets) {
    const sid = t.sessionId;
    if (!sid) continue;
    // Only count tickets under an EXPLICITLY non-live session (live === false);
    // live sessions and unknown ids are skipped.
    if (liveById.get(sid) !== false) continue;
    if (!OPEN_COLUMNS.has(t.column)) continue; // terminal (done) — not open
    counts.set(sid, (counts.get(sid) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([sessionId, openCount]) => ({ sessionId, openCount }))
    .sort((a, b) => b.openCount - a.openCount);
}

/** Inputs to buildBoard — all already-parsed/derived; generatedAt is passed IN. */
export interface BuildBoardInput {
  generatedAt: number;
  sessionId: string;
  sessions: SessionSummary[];
  tickets: Ticket[];
}

/** Assemble the full Board snapshot. Deterministic — no Date.now() inside. */
export function buildBoard(input: BuildBoardInput): Board {
  return {
    schema: 1,
    generatedAt: input.generatedAt,
    sessionId: input.sessionId,
    sessions: input.sessions,
    tickets: input.tickets,
  };
}
