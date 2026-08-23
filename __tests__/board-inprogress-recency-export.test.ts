// board-inprogress-recency-export.test.ts — AC-5 (real export invariant), from
// .ai-workspace/plans/2026-08-23-board-inprogress-recency-guard.md
// "## Round 1 fold — FINAL SPEC" (B2's non-fragile invariant, as rewritten by
// Round-1 plan-review Blocker 2 / confirmed Round-2 PASS) AND N3 (the
// inertness guard: execution-review MUST confirm the ACTUAL export-board.ts
// call threads `nowMs`, not just that unit tests calling buildTicket directly
// pass).
//
// This test runs the REAL scripts/export-board.ts (same hermetic-fixture
// pattern as lane-punchout-exporter.test.ts / research-close-stamp-export.
// test.ts) against a synthetic tasks/ledger tree containing THREE tickets:
//   (i)   STALE_ID  — status pending, newest pipeline comment OLDER than
//         INFLIGHT_LANE_CAP_MS before the export instant → must be `todo`.
//   (ii)  FRESH_ID  — status pending, newest pipeline comment WITHIN
//         INFLIGHT_LANE_CAP_MS of the export instant → must be `in_progress`.
//   (iii) LIVE_ID   — status in_progress (a genuine live lane), with an OLD
//         pipeline comment (older than the cap) → must STAY `in_progress`
//         (AC-3: genuine in_progress tickets are unaffected by comment age).
//
// Because this spawns the real script rather than calling buildTicket
// in-process, a forgotten `nowMs` thread-through at the export.ts call site
// (the N3 "shipped opt-in guard = zero protection until installed" shape)
// would make STALE_ID come back `in_progress` here — this test is the guard
// against exactly that regression.

import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { Board } from "@/lib/board-schema";
import { INFLIGHT_LANE_CAP_MS } from "@/lib/active";

describe("board-inprogress-recency — AC-5 real export invariant", () => {
  const SID = "sessrecency1";
  const STALE_ID = "recency-stale";
  const FRESH_ID = "recency-fresh";
  const LIVE_ID = "recency-live";
  let tmp: string;
  let tasksDir: string;
  let ledgerDir: string;
  let outFile: string;

  function writeTask(
    id: string,
    status: "pending" | "in_progress"
  ): string {
    const dir = path.join(tasksDir, SID);
    fs.mkdirSync(dir, { recursive: true });
    const p = path.join(dir, `${id}.json`);
    fs.writeFileSync(
      p,
      JSON.stringify({
        id,
        subject: `subject-${id}`,
        description: "",
        status,
        blocks: [],
        blockedBy: [],
      })
    );
    return p;
  }

  function writeLedger(id: string, lines: Record<string, unknown>[]): string {
    const dir = path.join(ledgerDir, SID);
    fs.mkdirSync(dir, { recursive: true });
    const p = path.join(dir, `${id}.jsonl`);
    fs.writeFileSync(p, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
    return p;
  }

  function touch(p: string, msAgo: number): void {
    const t = (Date.now() - msAgo) / 1000;
    fs.utimesSync(p, t, t);
  }

  function runExport(): Board {
    const res = spawnSync("npx", ["tsx", "scripts/export-board.ts"], {
      cwd: path.resolve(__dirname, ".."),
      env: {
        ...process.env,
        NODE_ENV: "development", // main() runs only when NODE_ENV !== "test"
        TASKS_DIR: tasksDir,
        LEDGER_DIR: ledgerDir,
        OUT: outFile,
        SESSION_ID: SID,
      },
      encoding: "utf8",
      timeout: 60_000,
      shell: true, // Windows: npx is npx.cmd, not directly spawnable without a shell.
    });
    expect(res.status).toBe(0);
    const raw = fs.readFileSync(outFile, "utf8");
    return JSON.parse(raw) as Board;
  }

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ac5-recency-"));
    tasksDir = path.join(tmp, "tasks");
    ledgerDir = path.join(tmp, "ledger");
    outFile = path.join(tmp, "board.json");
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("stale pending → todo, fresh pending → in_progress, genuine in_progress unaffected by stale comments — via the REAL export script", () => {
    const STALE_MS_AGO = INFLIGHT_LANE_CAP_MS + 60 * 60 * 1000; // 1h past the cap
    const FRESH_MS_AGO = 5 * 60 * 1000; // 5 min ago — well within the cap

    // (i) STALE pending ticket — freshest task-file touch (so the SESSION
    // still reads live and the fixture is realistic), but its only pipeline
    // comment is well past the cap.
    const stalePath = writeTask(STALE_ID, "pending");
    const staleLedgerPath = writeLedger(STALE_ID, [
      {
        role: "executor",
        ts: new Date(Date.now() - STALE_MS_AGO).toISOString(),
      },
    ]);
    touch(stalePath, 10 * 1000);
    touch(staleLedgerPath, STALE_MS_AGO);

    // (ii) FRESH pending ticket — pipeline comment within the cap.
    const freshPath = writeTask(FRESH_ID, "pending");
    const freshLedgerPath = writeLedger(FRESH_ID, [
      {
        role: "executor",
        ts: new Date(Date.now() - FRESH_MS_AGO).toISOString(),
      },
    ]);
    touch(freshPath, 10 * 1000);
    touch(freshLedgerPath, FRESH_MS_AGO);

    // (iii) LIVE in_progress ticket with an OLD comment — must stay
    // in_progress regardless of comment age (AC-3).
    const livePath = writeTask(LIVE_ID, "in_progress");
    const liveLedgerPath = writeLedger(LIVE_ID, [
      {
        role: "executor",
        ts: new Date(Date.now() - STALE_MS_AGO).toISOString(),
      },
    ]);
    touch(livePath, 10 * 1000);
    touch(liveLedgerPath, STALE_MS_AGO);

    const board = runExport();

    const stale = board.tickets.find((t) => t.id === STALE_ID);
    const fresh = board.tickets.find((t) => t.id === FRESH_ID);
    const live = board.tickets.find((t) => t.id === LIVE_ID);
    expect(stale).toBeDefined();
    expect(fresh).toBeDefined();
    expect(live).toBeDefined();

    // Per-ticket AC-1 / AC-2 / AC-3 assertions against the REAL export.
    expect(stale!.column).toBe("todo");
    expect(fresh!.column).toBe("in_progress");
    expect(live!.column).toBe("in_progress");

    // AC-5 / B2's rewritten invariant (checkable from board.json alone, no
    // pinned live count): EVERY exported in_progress-column ticket satisfies
    // status==="in_progress" OR (status==="pending" AND >=1 pipeline-role
    // comment within INFLIGHT_LANE_CAP_MS of the export's generatedAt).
    const PIPELINE_ROLES = new Set([
      "planner",
      "plan-review",
      "executor",
      "execution-review",
    ]);
    for (const t of board.tickets) {
      if (t.column !== "in_progress") continue;
      const ok =
        t.status === "in_progress" ||
        (t.status === "pending" &&
          t.comments.some((c) => {
            if (!PIPELINE_ROLES.has(c.role)) return false;
            const parsed = Date.parse(c.ts);
            if (Number.isNaN(parsed)) return false;
            return board.generatedAt - parsed <= INFLIGHT_LANE_CAP_MS;
          }));
      expect(ok).toBe(true);
    }

    // And the deduped in_progress count in THIS fixture is exactly the 2
    // genuinely-recent/live tickets — the stale one dropped out, proving the
    // guard actually fires end-to-end through the real script, not just in
    // a unit test calling buildTicket directly (N3 inertness guard).
    const inProgressIds = board.tickets
      .filter((t) => t.column === "in_progress")
      .map((t) => t.id);
    expect(inProgressIds.sort()).toEqual([FRESH_ID, LIVE_ID].sort());
  });
});
