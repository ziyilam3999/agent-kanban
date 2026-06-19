#!/usr/bin/env tsx
// export-board.ts — thin IO wrapper around the pure builders in lib/build-board.ts.
// Reads the LOCAL Claude-Code state (READ-ONLY), redacts it, and writes a Board
// snapshot to OUT (default data/board.json). NEVER prints secrets or home paths.
//
// Env:
//   TASKS_DIR   default <homedir>/.claude/tasks
//   LEDGER_DIR  default <homedir>/.claude/3role-ledger
//   SESSION_ID  default = the session whose task dir has the NEWEST task-file mtime
//   OUT         default data/board.json

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  buildBoard,
  buildSessionSummary,
  buildTicket,
  type RawLedgerLine,
  type RawTask,
} from "../lib/build-board";
import { COLUMNS, type SessionSummary } from "../lib/board-schema";

const HOME = os.homedir();
const TASKS_DIR = process.env.TASKS_DIR || path.join(HOME, ".claude", "tasks");
const LEDGER_DIR =
  process.env.LEDGER_DIR || path.join(HOME, ".claude", "3role-ledger");
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
}

function collectSessions(): SessionInfo[] {
  let dirs: string[] = [];
  try {
    dirs = fs.readdirSync(TASKS_DIR);
  } catch {
    return [];
  }
  const out: SessionInfo[] = [];
  for (const name of dirs) {
    if (isExcludedName(name)) continue;
    const dir = path.join(TASKS_DIR, name);
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
    out.push({ sessionId: name, dir, taskFiles, lastActiveMs });
  }
  // newest-first by last activity
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
          return buildTicket(parsed.task, ledger, parsed.mtimeMs, sid);
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
}

main();
