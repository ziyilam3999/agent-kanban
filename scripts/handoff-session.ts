#!/usr/bin/env tsx
// handoff-session.ts — migrate the OPEN agent-kanban backlog from a retired
// session's task dir into the active session's, so the new session's native
// TaskList/TaskUpdate (session-scoped) can see + continue the backlog after a
// `/clear` handoff. Local files only — READ + MOVE under ~/.claude/tasks; NEVER
// uploads (that stays opt-in via kanban:upload). See #1184.
//
// Env:
//   TASKS_DIR   default <homedir>/.claude/tasks
//   LEDGER_DIR  default <homedir>/.claude/3role-ledger  (auto-detect liveness only)
//
// CLI:
//   npm run kanban:handoff --to <session> [--from <session>]
//   --to   REQUIRED — the active/target session (never guessed).
//   --from optional — a single explicit source. When omitted, auto-consolidate
//          open tickets from ALL non-live sessions (≠ --to) in ONE run.

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { LIVE_WINDOW_MS } from "../lib/build-board";

/** Raw task statuses that count as OPEN (non-terminal). `completed` is terminal. */
const OPEN_STATUSES = new Set(["pending", "in_progress"]);

export interface MigrateResult {
  /** Ticket ids (filename without .json) MOVED into toSession. */
  moved: string[];
  /** Ticket ids left in fromSession because they are `completed` (history). */
  keptDone: string[];
  /** Ticket ids NOT moved because the same id already exists in toSession. */
  skippedCollisions: string[];
  /** Ticket ids skipped because the file failed a guarded parse / has no usable status. */
  skippedMalformed: string[];
}

/** Strip a trailing `.json` to get the ticket id from a filename. */
function ticketId(file: string): string {
  return file.replace(/\.json$/, "");
}

/**
 * PURE-ish (filesystem MOVE only, no network / no child process): migrate every
 * OPEN ticket file from `tasksDir/fromSession/` into `tasksDir/toSession/`.
 *
 * - Open = raw status `pending` | `in_progress`. `completed` is left in place.
 * - Each `<id>.json` is read with a GUARDED parse (mirrors export-board's
 *   readTask); a malformed file is recorded in `skippedMalformed` and skipped —
 *   it never aborts the run.
 * - POSIX `fs.rename` silently OVERWRITES the destination, so a
 *   `fs.existsSync(dest)` pre-check is MANDATORY: on a target-id collision the
 *   source is left intact and the id recorded in `skippedCollisions`.
 * - Ticket id / filename is preserved; file contents are never mutated.
 * - Throws if `fromSession === toSession` (refuses a no-op self-migration).
 */
export function migrateOpenTickets(opts: {
  tasksDir: string;
  fromSession: string;
  toSession: string;
}): MigrateResult {
  const { tasksDir, fromSession, toSession } = opts;
  if (fromSession === toSession) {
    throw new Error(
      `migrateOpenTickets: fromSession === toSession (${fromSession}) — refusing a no-op self-migration`
    );
  }

  const result: MigrateResult = {
    moved: [],
    keptDone: [],
    skippedCollisions: [],
    skippedMalformed: [],
  };

  const fromDir = path.join(tasksDir, fromSession);
  const toDir = path.join(tasksDir, toSession);

  let entries: string[] = [];
  try {
    entries = fs.readdirSync(fromDir);
  } catch {
    return result; // no source dir → nothing to migrate
  }

  const jsonFiles = entries.filter((f) => f.endsWith(".json"));

  // Classify first (guarded read), so a parse failure never aborts mid-move.
  const toMove: string[] = [];
  for (const f of jsonFiles) {
    const src = path.join(fromDir, f);
    let status: unknown;
    try {
      if (!fs.statSync(src).isFile()) continue;
      const raw = fs.readFileSync(src, "utf8");
      status = (JSON.parse(raw) as { status?: unknown }).status;
    } catch {
      result.skippedMalformed.push(ticketId(f));
      continue;
    }
    if (status === "completed") {
      result.keptDone.push(ticketId(f));
    } else if (typeof status === "string" && OPEN_STATUSES.has(status)) {
      toMove.push(f);
    } else {
      // Valid JSON but an unexpected/absent status — don't move, don't claim done.
      result.skippedMalformed.push(ticketId(f));
    }
  }

  if (toMove.length > 0) {
    fs.mkdirSync(toDir, { recursive: true });
  }
  for (const f of toMove) {
    const dest = path.join(toDir, f);
    // MANDATORY collision guard — fs.rename would silently overwrite otherwise.
    if (fs.existsSync(dest)) {
      result.skippedCollisions.push(ticketId(f));
      continue; // leave the source file intact
    }
    fs.renameSync(path.join(fromDir, f), dest);
    result.moved.push(ticketId(f));
  }

  return result;
}

/** Newest mtime (ms epoch) among files ending in `ext` under `dir`; 0 if none. */
function newestMtimeMs(dir: string, ext: string): number {
  let newest = 0;
  let entries: string[] = [];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return 0;
  }
  for (const f of entries) {
    if (!f.endsWith(ext)) continue;
    try {
      const st = fs.statSync(path.join(dir, f));
      if (st.isFile() && st.mtimeMs > newest) newest = st.mtimeMs;
    } catch {
      /* ignore unreadable */
    }
  }
  return newest;
}

/**
 * Enumerate candidate sessions under `tasksDir` with their last-active mtime
 * (newest task-file mtime folded with the newest 3-role ledger mtime — the same
 * liveness inputs collectSessions uses, so a ledger-only-active session is not
 * mistaken for non-live). Excludes scratch dirs + dirs with no task files.
 */
function enumerateSessions(
  tasksDir: string,
  ledgerDir: string
): { sessionId: string; lastActiveMs: number }[] {
  let dirs: string[] = [];
  try {
    dirs = fs.readdirSync(tasksDir);
  } catch {
    return [];
  }
  const out: { sessionId: string; lastActiveMs: number }[] = [];
  for (const name of dirs) {
    if (name.startsWith("_quarantine") || name.startsWith("test-sess")) continue;
    const dir = path.join(tasksDir, name);
    try {
      if (!fs.statSync(dir).isDirectory()) continue;
    } catch {
      continue;
    }
    const taskMtime = newestMtimeMs(dir, ".json");
    if (taskMtime === 0) continue; // lacking *.json task files
    const ledgerMtime = newestMtimeMs(path.join(ledgerDir, name), ".jsonl");
    out.push({ sessionId: name, lastActiveMs: Math.max(taskMtime, ledgerMtime) });
  }
  return out;
}

function parseArgs(argv: string[]): { from?: string; to?: string } {
  const out: { from?: string; to?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--from") out.from = argv[++i];
    else if (a === "--to") out.to = argv[++i];
    else if (a.startsWith("--from=")) out.from = a.slice("--from=".length);
    else if (a.startsWith("--to=")) out.to = a.slice("--to=".length);
  }
  return out;
}

/** CLI entry. Returns the process exit code. */
function run(argv: string[]): number {
  const HOME = os.homedir();
  const TASKS_DIR = process.env.TASKS_DIR || path.join(HOME, ".claude", "tasks");
  const LEDGER_DIR =
    process.env.LEDGER_DIR || path.join(HOME, ".claude", "3role-ledger");

  const { from, to } = parseArgs(argv);

  // --to is REQUIRED — never guess the active session.
  if (!to) {
    console.error(
      "kanban:handoff: --to <session> is REQUIRED (never guess the active session)."
    );
    return 2;
  }

  // Determine source session(s): explicit single --from, else auto-consolidate
  // ALL non-live sessions (≠ --to) so ONE run clears the orphan backlog.
  let sources: string[];
  if (from) {
    sources = [from];
  } else {
    const now = Date.now();
    sources = enumerateSessions(TASKS_DIR, LEDGER_DIR)
      .filter((s) => s.sessionId !== to)
      .filter((s) => now - s.lastActiveMs > LIVE_WINDOW_MS) // non-live only
      .map((s) => s.sessionId);
  }

  const agg: MigrateResult = {
    moved: [],
    keptDone: [],
    skippedCollisions: [],
    skippedMalformed: [],
  };
  // Sources that actually held open tickets (moved or collided) — drives the
  // single-vs-multi summary form and the "nothing to migrate" exit.
  const contributingSources: string[] = [];

  for (const src of sources) {
    const r = migrateOpenTickets({
      tasksDir: TASKS_DIR,
      fromSession: src,
      toSession: to,
    });
    agg.moved.push(...r.moved);
    agg.keptDone.push(...r.keptDone);
    agg.skippedCollisions.push(...r.skippedCollisions);
    agg.skippedMalformed.push(...r.skippedMalformed);
    if (r.moved.length > 0 || r.skippedCollisions.length > 0) {
      contributingSources.push(src);
    }
  }

  const to8 = to.slice(0, 8);

  // Nothing open anywhere → clean no-op (idempotent 2nd run / no orphaned backlog).
  if (agg.moved.length === 0 && agg.skippedCollisions.length === 0) {
    if (from) {
      console.log(
        `kanban:handoff: nothing to migrate (no open tickets in ${from.slice(0, 8)} → ${to8})`
      );
    } else {
      console.log(
        "kanban:handoff: no orphaned backlog (no non-live session holds open tickets)"
      );
    }
    return 0;
  }

  // A successful move happened → refresh the board snapshot (shell, no importable
  // entry — export-board exports only collectSessions). Non-fatal if it fails.
  if (agg.moved.length > 0) {
    const res = spawnSync("npm", ["run", "export:board"], {
      stdio: "inherit",
      env: process.env,
    });
    if (res.status !== 0) {
      console.error(
        "kanban:handoff: warning — `npm run export:board` did not exit 0; board snapshot may be stale."
      );
    }
  }

  // One-line summary — unambiguous for >1 source.
  const N = agg.moved.length;
  const M = agg.keptDone.length;
  if (contributingSources.length <= 1) {
    const from8 = (contributingSources[0] ?? from ?? "").slice(0, 8);
    console.log(
      `handoff: moved ${N} open tickets ${from8} → ${to8}, kept ${M} done; board active now ${to8}`
    );
  } else {
    console.log(
      `handoff: moved ${N} open tickets from ${contributingSources.length} source session(s) → ${to8}, kept ${M} done; board active now ${to8}`
    );
  }

  // Fail closed on any collision — open work was NOT moved and needs attention.
  if (agg.skippedCollisions.length > 0) {
    console.error(
      `kanban:handoff: ${agg.skippedCollisions.length} id-collision(s), left in source — ${agg.skippedCollisions.join(", ")}`
    );
    return 1;
  }

  return 0;
}

// Run only when invoked as a script — NOT when imported by a unit test (jest
// sets NODE_ENV=test) so importing migrateOpenTickets never shells/exits.
if (process.env.NODE_ENV !== "test") {
  let code: number;
  try {
    code = run(process.argv.slice(2));
  } catch (err) {
    // Fail closed (e.g. fromSession === toSession) with a clean message.
    console.error(`kanban:handoff: ${(err as Error).message}`);
    code = 1;
  }
  process.exit(code);
}
