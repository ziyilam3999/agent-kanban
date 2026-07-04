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
import { LIVE_WINDOW_MS } from "./board-schema";
import { PIPELINE_ROLES, isFailClassVerdict } from "./ui-meta";

/** The canonical pipeline roles as a set (orchestrator is NOT a member). */
const PIPELINE_ROLE_SET = new Set<string>(PIPELINE_ROLES);

// The live window now has ONE definition in the leaf board-schema module (#1449 —
// so the client pill in ui-meta can reuse it without a require cycle). Re-exported
// here so existing `@/lib/build-board` importers of LIVE_WINDOW_MS keep working.
export { LIVE_WINDOW_MS };

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
  /** OPTIONAL model+effort provenance (#1465) — see LedgerComment in board-schema.ts. */
  modelVersion?: string;
  modelTier?: string;
  effort?: string;
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
 * Classification of a ticket's NEWEST execution-review ledger line (#1410).
 * Discriminated four-state replacing the old pending/not-pending boolean:
 *   "none"             — no execution-review line at all
 *   "pending"          — newest execution-review has no resolvable verdict
 *   "resolved-nonfail" — newest execution-review resolved to a NON-fail verdict
 *   "resolved-fail"    — newest execution-review resolved to FAIL/BLOCK/REJECT
 */
export type ExecReviewState = "none" | "pending" | "resolved-nonfail" | "resolved-fail";

/**
 * Map a raw task status (+ derived ledger signals) to a display Column:
 *   completed                                        → done
 *   in_progress + exec-review "pending"              → in_review
 *   in_progress + exec-review "resolved-nonfail"     → in_review (monotonic —
 *                    passed review, stays in REVIEW for the ship tail, #1410)
 *   in_progress + exec-review "resolved-fail"        → in_progress (rework is
 *                    the honest backward move)
 *   in_progress + exec-review "none"                 → in_progress
 *   pending + a pipeline-role comment                → in_progress (already started)
 *   pending otherwise                                → todo
 *
 * MONOTONIC RULE (#1410, supersedes #1304's "pending NOW, not ever"): the board
 * only moves forward. Once an execution review resolves NON-fail, the card
 * stays in REVIEW — wearing the "✓ <VERDICT> — SHIPPING" pill — until the task
 * completes (→ done). Only a fail-class verdict sends it backward to
 * IN PROGRESS. `execReview` is `newestExecutionReviewState(ledgerLines)`.
 *
 * `hasPipelineRoleComment` is TRUE iff the ledger carries ≥1 comment whose role is a
 * PIPELINE_ROLES member (planner / plan-review / executor / execution-review).
 * orchestrator is EXCLUDED, so an orchestrator-only pending task stays in todo.
 */
export function toColumn(
  status: RawTask["status"],
  execReview: ExecReviewState,
  hasPipelineRoleComment = false
): Column {
  switch (status) {
    case "completed":
      return "done";
    case "in_progress":
      return execReview === "pending" || execReview === "resolved-nonfail"
        ? "in_review"
        : "in_progress";
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
 * `toComment` (display) and `newestExecutionReviewState` (column) call it.
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
  // #1465 — copy model+effort STRAIGHT from the ledger line (ai-brain captures at source);
  // optional + independent (mirrors the agentId/artifact copies above): a line may carry
  // any subset of the three, and each is copied only when present (back-compat).
  if (line.modelVersion) c.modelVersion = line.modelVersion;
  if (line.modelTier) c.modelTier = line.modelTier;
  if (line.effort) c.effort = line.effort;

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
 * Classify the NEWEST `execution-review` ledger line (#1410, generalizing the
 * old boolean hasPendingExecutionReview). "Newest" = max by parsed `ts`; a tie
 * (equal `ts`, or all `ts` NaN/missing) is broken by LATEST array index — the
 * ledger is append-ordered, so the last-appended execution-review is the
 * genuinely newest at equal-second granularity. A NaN/missing `ts` sorts as
 * oldest (MINOR-1 tiebreak). The newest line's `resolveVerdict` then maps:
 * undefined → "pending", fail-class → "resolved-fail", else →
 * "resolved-nonfail"; no execution-review at all → "none". The monotonic column
 * rule (#1410) keeps both "pending" AND "resolved-nonfail" in REVIEW — only
 * "resolved-fail" returns an in_progress task to IN PROGRESS.
 */
export function newestExecutionReviewState(
  ledgerLines: RawLedgerLine[]
): ExecReviewState {
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
  if (newest === undefined) return "none";
  const verdict = resolveVerdict(newest);
  if (verdict === undefined) return "pending";
  return isFailClassVerdict(verdict) ? "resolved-fail" : "resolved-nonfail";
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

  const execReviewState = newestExecutionReviewState(ledgerLines);
  // TRUE iff any ledger comment is from a pipeline role (orchestrator excluded) —
  // lets a pending task that a role has already started surface as in_progress.
  const hasPipelineRoleComment = ledgerLines.some((l) =>
    PIPELINE_ROLE_SET.has(l.role)
  );

  const ticket: Ticket = {
    id: rawTask.id,
    subject: rawTask.subject,
    description: redact(rawTask.description ?? ""),
    column: toColumn(rawTask.status, execReviewState, hasPipelineRoleComment),
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

/**
 * Blocker statuses that count as RESOLVED — a blocker in any of these no longer
 * blocks its dependent. Lowercased + trimmed before lookup. This set is
 * BYTE-IDENTICAL to the resolution set on the ai-brain parallelism gate
 * (`hooks/sole-lane-parallelization-gate.sh`) so the two sides agree on what
 * "resolved" means. Today only `completed` is reachable through the typed task
 * path (`RawTask.status`), but the broader set future-proofs raw data carrying
 * the other tokens and keeps the two sides symmetric. (#1316)
 */
export const RESOLVED_BLOCKER_STATUSES = new Set<string>([
  "completed",
  "done",
  "cancelled",
  "canceled",
  "closed",
]);

/**
 * PURE: return `blockedBy` with every id whose looked-up status is RESOLVED
 * removed. An id ABSENT from `statusById` is KEPT.
 *
 * DELIBERATE OPPOSITE of the ai-brain parallelism gate
 * (`hooks/sole-lane-parallelization-gate.sh`) on the absent case — same
 * resolution SET, opposite absent-case direction, and that asymmetry is
 * intentional (NOT a bug a code-only reader should "fix"): the GATE treats an
 * absent blocker as RESOLVED (it's advisory / block-once — a rare false fire is
 * a cheap nudge the orchestrator still judges). The BOARD keeps an absent
 * blocker VISIBLE — a human-facing status display must not HIDE a blocker it
 * cannot prove is resolved: false-"blocked" is merely cosmetic, but
 * false-"unblocked" actively misleads a human reader. So the board filters ONLY
 * a blocker that is PRESENT on the board AND resolved. (#1316)
 */
export function filterResolvedBlockers(
  blockedBy: string[],
  statusById: Map<string, string>
): string[] {
  return blockedBy.filter((id) => {
    const status = statusById.get(id);
    // Absent from the board → KEEP (fail-safe: never hide an unprovable blocker).
    if (status === undefined) return true;
    return !RESOLVED_BLOCKER_STATUSES.has(status.trim().toLowerCase());
  });
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
  // id → status across ALL tickets on the board (this is the choke point that
  // holds every ticket across all sessions, so even a cross-session blocker is
  // resolvable here). Pure + deterministic — no IO, no Date.now().
  const statusById = new Map<string, string>(
    input.tickets.map((t) => [t.id, t.status])
  );
  // Drop resolved blockers so a ticket blocked ONLY by a COMPLETED ticket no
  // longer renders "blocked by #X". A blocker ABSENT from the board stays
  // visible — see filterResolvedBlockers for why the absent case is the
  // deliberate OPPOSITE of the parallelism gate. (#1316)
  const tickets = input.tickets.map((t) => {
    const filtered = filterResolvedBlockers(t.blockedBy, statusById);
    // filterResolvedBlockers only ever removes ids, so an equal length means
    // nothing changed → reuse the original object (no needless copy).
    return filtered.length === t.blockedBy.length
      ? t
      : { ...t, blockedBy: filtered };
  });
  return {
    schema: 1,
    generatedAt: input.generatedAt,
    sessionId: input.sessionId,
    sessions: input.sessions,
    tickets,
  };
}
