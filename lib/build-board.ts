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
 * Map a raw task status (+ whether the ledger carries an execution-review) to a
 * display Column:
 *   completed                                  → done
 *   in_progress + execution-review in ledger   → in_review
 *   in_progress otherwise                       → in_progress
 *   pending                                     → todo
 */
export function toColumn(
  status: RawTask["status"],
  hasExecutionReview: boolean
): Column {
  switch (status) {
    case "completed":
      return "done";
    case "in_progress":
      return hasExecutionReview ? "in_review" : "in_progress";
    case "pending":
    default:
      return "todo";
  }
}

/** Parse one ledger line into a redacted, UI-safe comment. */
function toComment(line: RawLedgerLine): LedgerComment {
  const c: LedgerComment = { role: line.role, ts: line.ts };
  if (line.agentId) c.agentId = line.agentId;
  if (line.artifact_path) c.artifact = redact(basenameOf(line.artifact_path));
  if (line.skip_reason) c.skipReason = line.skip_reason;

  // PRIMARY: an explicit verdict recorded on the ledger line.
  if (typeof line.verdict === "string") {
    const v = redact(line.verdict.trim()).slice(0, VERDICT_MAX_LEN);
    if (v) c.verdict = v;
  }

  // FALLBACK: review-role line with no ledger verdict but a readable artifact
  // carrying a `Decision: <token>` line (e.g. a review recorded without
  // --verdict). Best-effort + safe — never throws, never crashes board build.
  if (
    !c.verdict &&
    REVIEW_ROLES.has(line.role) &&
    typeof line.artifact_path === "string" &&
    line.artifact_path.length > 0
  ) {
    const text = readArtifactHead(line.artifact_path);
    const decision = text ? extractDecisionVerdict(text) : undefined;
    if (decision) {
      const v = redact(decision.trim()).slice(0, VERDICT_MAX_LEN);
      if (v) c.verdict = v;
    }
  }

  return c;
}

/**
 * Build a single Ticket from a raw task, its (possibly empty) ledger lines, and
 * the task-file mtime (ms epoch). Comments are ordered oldest-first by ts.
 */
export function buildTicket(
  rawTask: RawTask,
  ledgerLines: RawLedgerLine[],
  mtimeMs: number,
  sessionId?: string
): Ticket {
  const comments = [...ledgerLines]
    .sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts))
    .map(toComment);

  const hasExecutionReview = ledgerLines.some(
    (l) => l.role === "execution-review"
  );

  const ticket: Ticket = {
    id: rawTask.id,
    subject: rawTask.subject,
    description: redact(rawTask.description ?? ""),
    column: toColumn(rawTask.status, hasExecutionReview),
    status: rawTask.status,
    blockedBy: rawTask.blockedBy ?? [],
    comments,
    updatedAt: mtimeMs,
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
