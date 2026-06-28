#!/usr/bin/env tsx
// export-board.ts — thin IO wrapper around the pure builders in lib/build-board.ts.
// Reads the LOCAL Claude-Code state (READ-ONLY), redacts it, and writes a Board
// snapshot to OUT (default data/board.json). NEVER prints secrets or home paths.
//
// Env:
//   TASKS_DIR     default <homedir>/.claude/tasks
//   LEDGER_DIR    default <homedir>/.claude/3role-ledger
//   HEARTBEAT_DIR default <homedir>/.claude/lane-heartbeats
//   SESSION_ID    default = the session whose task dir has the NEWEST task-file mtime
//   OUT           default data/board.json

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  buildBoard,
  buildSessionSummary,
  buildTicket,
  detectOrphanBacklog,
  type RawLedgerLine,
  type RawTask,
} from "../lib/build-board";
import { COLUMNS, type SessionSummary } from "../lib/board-schema";

const HOME = os.homedir();
const TASKS_DIR = process.env.TASKS_DIR || path.join(HOME, ".claude", "tasks");
const LEDGER_DIR =
  process.env.LEDGER_DIR || path.join(HOME, ".claude", "3role-ledger");
// Generic session-keyed lane-heartbeat markers (#1317). A global PostToolUse
// hook in ai-brain touches `<HEARTBEAT_DIR>/<session_id>.beat` on tool activity
// in ANY repo, so a non-4-role lane (no 3-role ledger) still emits a freshness
// signal. The path mirrors TASKS_DIR / LEDGER_DIR (os.homedir() runtime, never
// committed). The marker is an EMPTY file — its mtime is the entire signal.
const HEARTBEAT_DIR =
  process.env.HEARTBEAT_DIR ||
  path.join(HOME, ".claude", "lane-heartbeats");
const OUT = process.env.OUT || path.join("data", "board.json");

/** A session dir is invalid if it is scratch (_quarantine / test-sess prefixes) or has no task files. */
function isExcludedName(name: string): boolean {
  return name.startsWith("_quarantine") || name.startsWith("test-sess");
}

function jsonTaskFiles(dir: string): string[] {
  let entries: string[] = [];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return entries
    .filter((f) => f.endsWith(".json"))
    .map((f) => path.join(dir, f))
    .filter((p) => {
      try {
        return fs.statSync(p).isFile();
      } catch {
        return false;
      }
    });
}

interface SessionInfo {
  sessionId: string;
  dir: string;
  taskFiles: string[];
  lastActiveMs: number;
  /** taskId → that ticket's 3-role ledger file mtime (ms epoch). One guarded
   *  scan per session; missing dir → empty Map. Folded into each ticket's
   *  `updatedAt` (#1305) AND into the session `lastActiveMs` (subsuming the old
   *  per-session `newestLedgerMtimeMs` scan with byte-identical behavior). */
  ledgerMtimes: Map<string, number>;
}

/**
 * Map each ticket's 3-role ledger file to its mtime for a session: one guarded
 * `readdirSync` of `<ledgerDir>/<sessionId>/`, mapping every `<taskId>.jsonl`
 * file → its `statSync().mtimeMs`. During a 4-role chain the work appends to
 * `<ledgerDir>/<session>/<taskId>.jsonl` WITHOUT touching the task file, so this
 * per-ticket ledger mtime is the freshness signal that keeps the ticket's lane
 * lit mid-work (#1305 — the per-ticket twin of the session-level #1121 fix).
 *
 * Fully guarded (same discipline as the old `newestLedgerMtimeMs`): a missing
 * ledger dir returns an empty Map; an unreadable/non-file entry is skipped;
 * never throws. The `isFile()` guard keeps this BYTE-IDENTICAL to the prior
 * `newestLedgerMtimeMs` fold so the session `lastActiveMs` semantics are
 * unchanged (a dir entry named `X.jsonl` is excluded by both).
 */
export function ledgerMtimeByTaskId(
  ledgerDir: string,
  sessionId: string
): Map<string, number> {
  const out = new Map<string, number>();
  try {
    const sessionLedgerDir = path.join(ledgerDir, sessionId);
    for (const f of fs.readdirSync(sessionLedgerDir)) {
      if (!f.endsWith(".jsonl")) continue;
      try {
        const st = fs.statSync(path.join(sessionLedgerDir, f));
        if (!st.isFile()) continue;
        const taskId = f.slice(0, -".jsonl".length);
        out.set(taskId, st.mtimeMs);
      } catch {
        /* ignore unreadable ledger file */
      }
    }
  } catch {
    /* no ledger dir for this session — empty Map */
  }
  return out;
}

/**
 * Map each session's lane-heartbeat marker to its mtime: one guarded
 * `readdirSync` of `heartbeatDir`, mapping every `<sessionId>.beat` FILE → its
 * `statSync().mtimeMs`. This is the structural twin of `ledgerMtimeByTaskId`,
 * but one level UP — keyed by SESSION, not taskId, because the generic global
 * writer hook fires on a plain tool call that exposes only the `session_id`
 * (#1317). The markers are flat in `heartbeatDir` (NOT nested under a
 * per-session subdir like the ledger's `<session>/<taskId>.jsonl`).
 *
 * Fully guarded (same discipline as `ledgerMtimeByTaskId`): a missing dir
 * returns an empty Map; non-`.beat` entries and a directory named `X.beat`
 * (`isFile()` guard) are skipped; never throws. The marker CONTENTS are never
 * read — the mtime is the entire freshness signal. Takes an injectable
 * `heartbeatDir` so tests point it at a synthetic temp dir.
 */
export function heartbeatMtimeBySession(
  heartbeatDir: string
): Map<string, number> {
  const out = new Map<string, number>();
  try {
    for (const f of fs.readdirSync(heartbeatDir)) {
      if (!f.endsWith(".beat")) continue;
      try {
        const st = fs.statSync(path.join(heartbeatDir, f));
        if (!st.isFile()) continue;
        const sessionId = f.slice(0, -".beat".length);
        out.set(sessionId, st.mtimeMs);
      } catch {
        /* ignore unreadable heartbeat marker */
      }
    }
  } catch {
    /* no heartbeat dir — empty Map */
  }
  return out;
}

export function collectSessions(
  tasksDir: string = TASKS_DIR,
  ledgerDir: string = LEDGER_DIR,
  heartbeatDir: string = HEARTBEAT_DIR
): SessionInfo[] {
  let dirs: string[] = [];
  try {
    dirs = fs.readdirSync(tasksDir);
  } catch {
    return [];
  }
  // Generic session-keyed lane-heartbeat freshness (#1317), scanned ONCE: a
  // non-4-role lane writes no 3-role ledger, so without this fold a quiet
  // content-lane-only session keeps a stale task-file mtime → not live → its
  // lane never counts. Folded into `lastActiveMs` by the SAME `max` rule as the
  // ledger fold below (purely additive — no `.beat` ⇒ no effect ⇒ no regression).
  const heartbeatMtimes = heartbeatMtimeBySession(heartbeatDir);
  const out: SessionInfo[] = [];
  for (const name of dirs) {
    if (isExcludedName(name)) continue;
    const dir = path.join(tasksDir, name);
    try {
      if (!fs.statSync(dir).isDirectory()) continue;
    } catch {
      continue;
    }
    const taskFiles = jsonTaskFiles(dir);
    if (taskFiles.length === 0) continue; // lacking *.json task files
    let lastActiveMs = 0;
    for (const f of taskFiles) {
      try {
        const m = fs.statSync(f).mtimeMs;
        if (m > lastActiveMs) lastActiveMs = m;
      } catch {
        /* ignore unreadable */
      }
    }
    // Build the per-ticket ledger-mtime map ONCE per session, then reuse it for
    // both folds: (a) the session `lastActiveMs` (subsumes the old
    // `newestLedgerMtimeMs` — max of task mtime + all ledger mtimes keeps a long
    // pipeline stretch live, #1121), and (b) each ticket's `updatedAt` (#1305).
    const ledgerMtimes = ledgerMtimeByTaskId(ledgerDir, name);
    for (const m of ledgerMtimes.values()) {
      if (m > lastActiveMs) lastActiveMs = m;
    }
    // (c) Fold this session's generic lane-heartbeat marker mtime (#1317) — the
    // second generic freshness source, keyed by session, max-folded the same
    // way. Keeps a non-4-role lane's session live without touching the ledger.
    const beatMtime = heartbeatMtimes.get(name);
    if (beatMtime !== undefined && beatMtime > lastActiveMs) {
      lastActiveMs = beatMtime;
    }
    out.push({ sessionId: name, dir, taskFiles, lastActiveMs, ledgerMtimes });
  }
  // newest-first by last activity (now reflects true activity incl. ledger).
  out.sort((a, b) => b.lastActiveMs - a.lastActiveMs);
  return out;
}

function readTask(file: string): { task: RawTask; mtimeMs: number } | null {
  try {
    const raw = fs.readFileSync(file, "utf8");
    const task = JSON.parse(raw) as RawTask;
    const mtimeMs = fs.statSync(file).mtimeMs;
    return { task, mtimeMs };
  } catch {
    return null;
  }
}

function readLedger(sessionId: string, taskId: string): RawLedgerLine[] {
  const file = path.join(LEDGER_DIR, sessionId, `${taskId}.jsonl`);
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return []; // ledger may be absent — comments = []
  }
  const lines: RawLedgerLine[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      lines.push(JSON.parse(trimmed) as RawLedgerLine);
    } catch {
      /* skip malformed line */
    }
  }
  return lines;
}

function main(): void {
  const now = Date.now();
  const sessions = collectSessions();

  if (sessions.length === 0) {
    console.error(
      "export-board: no valid sessions found under the tasks dir (nothing to export)"
    );
    process.exit(1);
  }

  // Picker list across ALL valid sessions, newest-first.
  const sessionSummaries: SessionSummary[] = sessions.map((s) =>
    buildSessionSummary(s.sessionId, s.lastActiveMs, s.taskFiles.length, now)
  );

  // Choose the session: env override, else the newest (first). This drives the
  // DEFAULT picker selection + the LIVE badge, but tickets are exported for ALL
  // sessions so switching the picker changes the rendered cards (v0.2.0 #3 fix).
  const chosenFull = process.env.SESSION_ID || sessions[0].sessionId;
  const chosen =
    sessions.find((s) => s.sessionId === chosenFull) ?? sessions[0];

  // Build tickets for EVERY non-excluded session, each tagged with its own
  // 8-char sessionId (matches SessionSummary.id) so the view can filter per-session.
  const tickets = sessions
    .flatMap((s) => {
      const sid = s.sessionId.slice(0, 8);
      return s.taskFiles
        .map((file) => {
          const parsed = readTask(file);
          if (!parsed) return null;
          const ledger = readLedger(s.sessionId, parsed.task.id);
          return buildTicket(
            parsed.task,
            ledger,
            parsed.mtimeMs,
            sid,
            s.ledgerMtimes.get(parsed.task.id)
          );
        })
        .filter((t): t is NonNullable<typeof t> => t !== null);
    })
    // newest-updated first within a column-agnostic list
    .sort((a, b) => b.updatedAt - a.updatedAt);

  const board = buildBoard({
    generatedAt: now,
    sessionId: chosen.sessionId.slice(0, 8),
    sessions: sessionSummaries,
    tickets,
  });

  // Write OUT (pretty), creating the directory if needed.
  const outDir = path.dirname(OUT);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(board, null, 2) + "\n", "utf8");

  // One-line column summary — counts only, no secrets / no home paths.
  const counts: Record<string, number> = {};
  for (const col of COLUMNS) counts[col] = 0;
  for (const t of tickets) counts[t.column] = (counts[t.column] ?? 0) + 1;
  const summary = COLUMNS.map((c) => `${c}=${counts[c]}`).join(" ");
  console.log(
    `export-board: active ${board.sessionId} · ${tickets.length} tickets across ${sessionSummaries.length} sessions · ${summary} → ${OUT}`
  );

  // Non-fatal backstop: warn if OPEN tickets are stranded under a non-live
  // (superseded) session while a live session exists — the post-`/clear` orphan
  // signal. The fix is to migrate them into the live session (#1184).
  const orphans = detectOrphanBacklog(tickets, sessionSummaries);
  for (const o of orphans) {
    console.error(
      // `--to` must be the FULL session dir name (the live session id), NOT the
      // 8-char display id (`board.sessionId`): the handoff CLI treats `--to` as
      // the literal task-dir name, so a truncated id would move the backlog into
      // a bogus dir no session reads (ship-fix #1).
      `⚠ orphan-backlog: ${o.sessionId}=${o.openCount} open ticket(s) under a non-live session — run: npm run kanban:handoff --to ${chosen.sessionId}`
    );
  }
}

// Run the exporter only when invoked as a script — NOT when imported by a unit
// test (jest sets NODE_ENV=test). Importing the module to exercise
// collectSessions must not read the real stores or write data/board.json.
if (process.env.NODE_ENV !== "test") {
  main();
}
