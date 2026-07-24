// lane-punchout-exporter.test.ts — #1852 plan AC-4 (End-to-end, exporter
// output, no diff-reading). Runs the REAL scripts/export-board.ts (same
// pattern as research-close-stamp-export.test.ts / orphan-warning-command.
// test.ts) against a hermetic OS-temp fixture tree containing:
//   (i)  an in-flight ticket whose pipeline roles are ALL punched-out
//        (closedAt on every role) — a dead chain
//   (ii) an in-flight ticket with an OPEN pipeline-role punch-in (no
//        closedAt) — a genuinely-running chain
// then feeds the emitted board.json's own tickets + the exporter's own
// session.live verdict into the REAL lib/active.ts computeActiveIds and
// asserts EXACTLY ONE live lane — catching a fix that works in a unit test
// (buildTicket fed directly) but is not actually wired through the exporter
// pipeline (RawLedgerLine parsing, toComment()'s field copier, buildTicket's
// threading into Ticket.comments).

import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { Board } from "@/lib/board-schema";
import { computeActiveIds } from "@/lib/active";

describe("#1852 AC-4 — real exporter run: dead (punched-out) chain + genuinely-open chain -> live-lane count == 1", () => {
  const SID = "sess1852ac4";
  const DEAD_ID = "9101";
  const OPEN_ID = "9102";
  let tmp: string;
  let tasksDir: string;
  let ledgerDir: string;
  let outFile: string;

  function writeTask(id: string, subject: string): string {
    const dir = path.join(tasksDir, SID);
    fs.mkdirSync(dir, { recursive: true });
    const p = path.join(dir, `${id}.json`);
    fs.writeFileSync(
      p,
      JSON.stringify({
        id,
        subject,
        description: "",
        status: "in_progress",
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
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ac4-punchout-"));
    tasksDir = path.join(tmp, "tasks");
    ledgerDir = path.join(tmp, "ledger");
    outFile = path.join(tmp, "board.json");
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("exports both tickets with punch-out fields intact, and a fresh liveness computation counts exactly ONE live lane", () => {
    // (i) DEAD chain: planner + plan-review, both agents punched-OUT.
    const deadTaskPath = writeTask(DEAD_ID, "dead all-punched-out chain");
    const deadLedgerPath = writeLedger(DEAD_ID, [
      {
        role: "planner",
        ts: "2026-07-20T09:00:00Z",
        agentId: "ac4-planner-dead",
        closedAt: "2026-07-20T09:05:00Z",
      },
      {
        role: "plan-review",
        ts: "2026-07-20T09:10:00Z",
        agentId: "ac4-review-dead",
        verdict: "PASS",
        closedAt: "2026-07-20T09:15:00Z",
      },
    ]);
    touch(deadTaskPath, 30 * 60 * 1000); // 30 min stale — past ACTIVE_WINDOW_MS, well under the cap
    touch(deadLedgerPath, 30 * 60 * 1000);

    // (ii) OPEN chain: planner punched-in, no closedAt — genuinely running.
    // Its task/ledger mtime is the FRESHEST in the session, so the session
    // reads live and this ticket is also the max-updatedAt focus.
    const openTaskPath = writeTask(OPEN_ID, "genuinely open chain");
    const openLedgerPath = writeLedger(OPEN_ID, [
      { role: "planner", ts: new Date().toISOString(), agentId: "ac4-planner-open" },
    ]);
    touch(openTaskPath, 10 * 1000); // 10s ago — freshest, keeps the session live
    touch(openLedgerPath, 10 * 1000);

    const board = runExport();

    const deadTicket = board.tickets.find((t) => t.id === DEAD_ID);
    const openTicket = board.tickets.find((t) => t.id === OPEN_ID);
    expect(deadTicket).toBeDefined();
    expect(openTicket).toBeDefined();

    // The exported comments carry the punch-out fields intact (no dropped
    // field in RawLedgerLine parsing / toComment()'s allowlist copier).
    expect(deadTicket!.comments.every((c) => !!c.closedAt)).toBe(true);
    expect(openTicket!.comments.some((c) => !c.closedAt)).toBe(true);

    const session = board.sessions.find((s) => s.id === SID.slice(0, 8));
    expect(session).toBeDefined();
    expect(session!.live).toBe(true);

    const active = computeActiveIds(board.tickets, session!.live, Date.now());
    expect(active.has(DEAD_ID)).toBe(false);
    expect(active.has(OPEN_ID)).toBe(true);
    expect(active.size).toBe(1);
  });
});
