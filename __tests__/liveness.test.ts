// liveness.test.ts — #1121 regression: the live board must NOT read IDLE during a
// long 3-role pipeline stretch where the ONLY activity is `3role-ledger append`
// bumping the session's ledger files (the task-file mtime goes stale because a
// TaskUpdate fires only at task start/completion). collectSessions must fold the
// newest `<LEDGER_DIR>/<session>/*.jsonl` mtime into lastActiveMs so the session
// stays live and the current-focus in_progress ticket keeps breathing.

import { mkdtempSync, mkdirSync, writeFileSync, utimesSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { collectSessions } from "@/scripts/export-board";
import { buildSessionSummary, buildTicket, type RawTask } from "@/lib/build-board";
import { computeActiveIds } from "@/lib/active";

const SESSION = "0737beca-260d-4f7f-8f9b-a47df66f0154";

/** Write a file then stamp its mtime to `whenMs` ms-epoch (utimes takes seconds). */
function writeAt(path: string, body: string, whenMs: number): void {
  writeFileSync(path, body, "utf8");
  const secs = whenMs / 1000;
  utimesSync(path, secs, secs);
}

function seed(opts: { withFreshLedger: boolean }): {
  tasksDir: string;
  ledgerDir: string;
  now: number;
  taskMtime: number;
  ledgerMtime: number;
} {
  const root = mkdtempSync(join(tmpdir(), "akb-liveness-"));
  const tasksDir = join(root, "tasks");
  const ledgerDir = join(root, "3role-ledger");
  const now = Date.now();
  const taskMtime = now - 30 * 60 * 1000; // 30 min ago → STALE (outside 5-min window)
  const ledgerMtime = now - 1 * 60 * 1000; // 1 min ago → FRESH (inside the window)

  // Task file: an in_progress ticket whose file mtime is STALE.
  const sessTasksDir = join(tasksDir, SESSION);
  mkdirSync(sessTasksDir, { recursive: true });
  const task: RawTask = {
    id: "1121",
    subject: "board liveness",
    description: "",
    status: "in_progress",
    blocks: [],
    blockedBy: [],
  };
  writeAt(join(sessTasksDir, "1121.json"), JSON.stringify(task), taskMtime);

  // Ledger file: FRESH activity from the in-flight 3-role stretch (only present
  // in the withFreshLedger arm — the other arm proves the fail-safe).
  if (opts.withFreshLedger) {
    const sessLedgerDir = join(ledgerDir, SESSION);
    mkdirSync(sessLedgerDir, { recursive: true });
    const line = JSON.stringify({ role: "executor", ts: new Date(ledgerMtime).toISOString() });
    writeAt(join(sessLedgerDir, "1121.jsonl"), line + "\n", ledgerMtime);
  }

  return { tasksDir, ledgerDir, now, taskMtime, ledgerMtime };
}

describe("collectSessions — #1121 ledger mtimes keep a 3-role stretch live", () => {
  it("RED-on-master / GREEN-after: lastActiveMs reflects the FRESH ledger mtime, not the stale task mtime → session is live", () => {
    const { tasksDir, ledgerDir, now, taskMtime, ledgerMtime } = seed({ withFreshLedger: true });

    const sessions = collectSessions(tasksDir, ledgerDir);
    expect(sessions).toHaveLength(1);
    const s = sessions[0];

    // The CORE assertion that is RED on master (master uses task-file mtime only,
    // so lastActiveMs would be the stale 30-min-old value → not live).
    expect(s.lastActiveMs).toBe(ledgerMtime);
    expect(s.lastActiveMs).toBeGreaterThan(taskMtime);

    const summary = buildSessionSummary(s.sessionId, s.lastActiveMs, s.taskFiles.length, now);
    expect(summary.live).toBe(true); // RED on master: false (stale mtime > 5-min window)
  });

  it("end-to-end: the most-recent in_progress ticket breathes (active) for the now-live session", () => {
    const { tasksDir, ledgerDir, now } = seed({ withFreshLedger: true });
    const s = collectSessions(tasksDir, ledgerDir)[0];
    const summary = buildSessionSummary(s.sessionId, s.lastActiveMs, s.taskFiles.length, now);

    const ticket = buildTicket(
      { id: "1121", subject: "board liveness", description: "", status: "in_progress", blocks: [], blockedBy: [] },
      [],
      s.lastActiveMs,
      s.sessionId.slice(0, 8),
    );
    const active = computeActiveIds([ticket], summary.live, now);
    expect(active.has("1121")).toBe(true);
  });

  it("fail-safe: a session with NO ledger dir falls back to the task-file mtime (no throw)", () => {
    const { tasksDir, ledgerDir, taskMtime } = seed({ withFreshLedger: false });
    let sessions: ReturnType<typeof collectSessions> = [];
    expect(() => {
      sessions = collectSessions(tasksDir, ledgerDir);
    }).not.toThrow();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].lastActiveMs).toBe(taskMtime);
  });
});
