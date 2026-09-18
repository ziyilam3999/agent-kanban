// ledger-only-lane-export.test.ts — kanban-live-lanes-visibility plan, AC-0..AC-6.
// Same real-exporter idiom as lane-punchout-exporter.test.ts /
// research-close-stamp-export.test.ts: every case shells out to the ACTUAL
// scripts/export-board.ts against a hermetic mktemp-d fixture tree (TASKS_DIR /
// LEDGER_DIR / HEARTBEAT_DIR / OUT all redirected — never the real ~/.claude
// state or the tracked data/board.json), then feeds the emitted board.json into
// the ACTUAL oracle CLI (scripts/lanes-live.ts), which itself imports the
// library's own computeActiveIds/deriveLanes. No environment variable named
// the session-pin env var is ever set here — the exporter always falls back to
// "the session whose task dir has the newest task-file mtime" (see #1516/#1852
// suite precedent; this file deliberately mirrors the AC-0 recipe's env table
// instead).
//
// AC-0b's "self-mutation leg" pins the pre-fix mechanism as a permanent
// in-repo regression guard: running the SAME real exporter with the
// LEDGER_ONLY_LANES_OFF=1 test-only kill-switch (Rule-16 override convention,
// never a shipped semantic switch) reproduces today's "no ticket for a
// card-less ledger" defect on THIS branch — the executor's PR body separately
// quotes a manual origin/master run of the identical fixture as the one-time
// RED proof.

import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { Board } from "@/lib/board-schema";

const REPO_ROOT = path.resolve(__dirname, "..");
const MIN = 60_000;
const HOUR = 60 * MIN;

interface Dirs {
  tmp: string;
  tasksDir: string;
  ledgerDir: string;
  heartbeatDir: string;
  outFile: string;
}

function freshDirs(prefix: string): Dirs {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const tasksDir = path.join(tmp, "tasks");
  const ledgerDir = path.join(tmp, "ledger");
  const heartbeatDir = path.join(tmp, "hb");
  const outFile = path.join(tmp, "board.json");
  fs.mkdirSync(tasksDir, { recursive: true });
  fs.mkdirSync(ledgerDir, { recursive: true });
  fs.mkdirSync(heartbeatDir, { recursive: true });
  return { tmp, tasksDir, ledgerDir, heartbeatDir, outFile };
}

function isoAgo(msAgo: number): string {
  return new Date(Date.now() - msAgo).toISOString();
}

function touch(p: string, msAgo: number): void {
  const t = (Date.now() - msAgo) / 1000;
  fs.utimesSync(p, t, t);
}

function writeTask(
  d: Dirs,
  session: string,
  id: string,
  fields: { status: string; subject: string }
): string {
  const dir = path.join(d.tasksDir, session);
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, `${id}.json`);
  fs.writeFileSync(
    p,
    JSON.stringify({
      id,
      subject: fields.subject,
      description: "",
      status: fields.status,
      blocks: [],
      blockedBy: [],
    })
  );
  return p;
}

function writeLedger(
  d: Dirs,
  session: string,
  id: string,
  lines: Record<string, unknown>[]
): string {
  const dir = path.join(d.ledgerDir, session);
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, `${id}.jsonl`);
  fs.writeFileSync(p, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  return p;
}

function writeFreshBeat(d: Dirs, session: string): string {
  const p = path.join(d.heartbeatDir, `${session}.beat`);
  fs.writeFileSync(p, "");
  return p;
}

function runExport(
  d: Dirs,
  extraEnv: Record<string, string> = {}
): { status: number | null; stdout: string; stderr: string } {
  const res = spawnSync("npx", ["tsx", "scripts/export-board.ts"], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      NODE_ENV: "development", // main() runs only when NODE_ENV !== "test"
      TASKS_DIR: d.tasksDir,
      LEDGER_DIR: d.ledgerDir,
      HEARTBEAT_DIR: d.heartbeatDir,
      OUT: d.outFile,
      ...extraEnv,
    },
    encoding: "utf8",
    timeout: 60_000,
    shell: true, // Windows: npx is npx.cmd, not directly spawnable without a shell.
  });
  return { status: res.status, stdout: res.stdout || "", stderr: res.stderr || "" };
}

function readBoard(d: Dirs): Board {
  return JSON.parse(fs.readFileSync(d.outFile, "utf8")) as Board;
}

interface OracleOut {
  sessionId: string;
  sessionLive: boolean;
  activeIds: string[];
  lanes: Array<{ id: string; currentStageIndex: number | null; rolesSeen: string[] }>;
}

function runOracle(boardPath: string): OracleOut {
  const res = spawnSync("npx", ["tsx", "scripts/lanes-live.ts", boardPath], {
    cwd: REPO_ROOT,
    env: { ...process.env },
    encoding: "utf8",
    timeout: 60_000,
    shell: true,
  });
  expect(res.status).toBe(0);
  return JSON.parse((res.stdout || "").trim()) as OracleOut;
}

const LANE_ID = "lane-x";
const ANCHOR_ID = "9001";

/** Base Fixture F (plan's Binary AC preamble): one session, an anchor card
 *  (pending, backdated >=10 min), a fresh session beat, and lane-x.jsonl
 *  holding one OPEN executor row — NO lane-x.json anywhere. */
function writeFixtureF(d: Dirs, sid: string): { taskPath: string; ledgerPath: string } {
  const taskPath = writeTask(d, sid, ANCHOR_ID, { status: "pending", subject: "fixture F anchor" });
  touch(taskPath, 10 * MIN);
  writeFreshBeat(d, sid);
  const ledgerPath = writeLedger(d, sid, LANE_ID, [
    { role: "executor", ts: new Date().toISOString(), agentId: "exec-agent-f" },
  ]);
  return { taskPath, ledgerPath };
}

describe("kanban-live-lanes-visibility — ledger-only lane export (AC-0..AC-6)", () => {
  describe("AC-0a / AC-1 — a card-less live lane renders, counts, and the oracle proves it via the REAL library selectors", () => {
    it("fixture F: lane-x renders as a ledger-only lane; oracle shape + activeIds/lanes match; anchor untouched; no fixture file mutated", () => {
      const d = freshDirs("kb-live-lanes-ac1-");
      try {
        const sid = "ac1session";
        const { taskPath, ledgerPath } = writeFixtureF(d, sid);
        const beforeTask = fs.statSync(taskPath).mtimeMs;
        const beforeLedger = fs.statSync(ledgerPath).mtimeMs;

        const res = runExport(d);
        expect(res.status).toBe(0);
        const board = readBoard(d);

        const lane = board.tickets.find((t) => t.id === LANE_ID);
        expect(lane).toBeDefined();
        expect(lane!.sessionId).toBe(sid.slice(0, 8));
        expect(lane!.column).toBe("in_progress");
        expect(lane!.ledgerOnly).toBe(true);
        expect(lane!.comments).toHaveLength(1);
        expect(lane!.comments[0].role).toBe("executor");
        const ledgerMtimeMs = fs.statSync(ledgerPath).mtimeMs;
        expect(Math.abs(lane!.updatedAt - ledgerMtimeMs)).toBeLessThanOrEqual(1);
        expect(lane!.subject).toContain(LANE_ID);
        expect(lane!.subject.toLowerCase()).toContain("no ticket");
        const serialized = JSON.stringify(lane);
        expect(serialized).not.toMatch(/\/(Users|home)\/[^/"]+/i);
        expect(serialized).not.toMatch(/[a-z]:[\\/]Users[\\/][^/\\"]+/i);

        // AC-0a — the oracle CLI's shape + its REAL computeActiveIds/deriveLanes read.
        const oracle = runOracle(d.outFile);
        expect(typeof oracle.sessionId).toBe("string");
        expect(typeof oracle.sessionLive).toBe("boolean");
        expect(Array.isArray(oracle.activeIds)).toBe(true);
        expect(Array.isArray(oracle.lanes)).toBe(true);
        expect(oracle.activeIds).toEqual(expect.arrayContaining([LANE_ID]));
        const oracleLane = oracle.lanes.find((l) => l.id === LANE_ID);
        expect(oracleLane).toBeDefined();
        expect(oracleLane!.currentStageIndex).toBe(2); // executor's PIPELINE_ROLES index
        expect(oracleLane!.rolesSeen).toEqual(["executor"]);

        const anchor = board.tickets.find((t) => t.id === ANCHOR_ID);
        expect(anchor).toBeDefined();
        expect(anchor!.status).toBe("pending");
        expect(anchor!.updatedAt).toBe(fs.statSync(taskPath).mtimeMs);

        // Isolation — no fixture file mutated by the export.
        expect(fs.statSync(taskPath).mtimeMs).toBe(beforeTask);
        expect(fs.statSync(ledgerPath).mtimeMs).toBe(beforeLedger);
      } finally {
        fs.rmSync(d.tmp, { recursive: true, force: true });
      }
    });
  });

  describe("AC-0b — self-mutation: the ledger-only leg OFF reproduces today's mechanism as a permanent in-repo regression guard", () => {
    it("LEDGER_ONLY_LANES_OFF=1 -> no lane-x ticket at all; oracle activeIds == [] and lanes == []", () => {
      const d = freshDirs("kb-live-lanes-ac0b-");
      try {
        writeFixtureF(d, "ac0bsession");
        const res = runExport(d, { LEDGER_ONLY_LANES_OFF: "1" });
        expect(res.status).toBe(0);
        const board = readBoard(d);
        expect(board.tickets.find((t) => t.id === LANE_ID)).toBeUndefined();

        const oracle = runOracle(d.outFile);
        expect(oracle.activeIds).toEqual([]);
        expect(oracle.lanes).toEqual([]);
      } finally {
        fs.rmSync(d.tmp, { recursive: true, force: true });
      }
    });
  });

  describe("AC-2 — no phantom: a finished/dead/out-of-window card-less lane produces NOTHING", () => {
    it("(a) closedAt + ts 20 min ago -> absent (punched out, outside window)", () => {
      const d = freshDirs("kb-live-lanes-ac2a-");
      try {
        const sid = "ac2asession";
        writeTask(d, sid, ANCHOR_ID, { status: "pending", subject: "anchor" });
        writeFreshBeat(d, sid);
        const ledgerPath = writeLedger(d, sid, LANE_ID, [
          {
            role: "executor",
            ts: isoAgo(20 * MIN),
            agentId: "a-closed",
            closedAt: isoAgo(19 * MIN),
          },
        ]);
        touch(ledgerPath, 20 * MIN);

        const res = runExport(d);
        expect(res.status).toBe(0);
        const board = readBoard(d);
        expect(board.tickets.find((t) => t.id === LANE_ID)).toBeUndefined();

        const oracle = runOracle(d.outFile);
        expect(oracle.activeIds).toEqual([]);
      } finally {
        fs.rmSync(d.tmp, { recursive: true, force: true });
      }
    });

    it("(b) open row, ts 7h ago -> absent (beyond INFLIGHT_LANE_CAP_MS, beyond window)", () => {
      const d = freshDirs("kb-live-lanes-ac2b-");
      try {
        const sid = "ac2bsession";
        writeTask(d, sid, ANCHOR_ID, { status: "pending", subject: "anchor" });
        writeFreshBeat(d, sid);
        const ledgerPath = writeLedger(d, sid, LANE_ID, [
          { role: "executor", ts: isoAgo(7 * HOUR), agentId: "a-stale" },
        ]);
        touch(ledgerPath, 7 * HOUR);

        const res = runExport(d);
        expect(res.status).toBe(0);
        const board = readBoard(d);
        expect(board.tickets.find((t) => t.id === LANE_ID)).toBeUndefined();
      } finally {
        fs.rmSync(d.tmp, { recursive: true, force: true });
      }
    });

    it("(c) row with closedAt, ts 2 min ago -> PRESENT (the same handoff-gap grace a card-backed lane gets)", () => {
      const d = freshDirs("kb-live-lanes-ac2c-");
      try {
        const sid = "ac2csession";
        writeTask(d, sid, ANCHOR_ID, { status: "pending", subject: "anchor" });
        writeFreshBeat(d, sid);
        const ledgerPath = writeLedger(d, sid, LANE_ID, [
          {
            role: "executor",
            ts: isoAgo(2 * MIN),
            agentId: "a-recent-closed",
            closedAt: isoAgo(1 * MIN),
          },
        ]);
        touch(ledgerPath, 2 * MIN);

        const res = runExport(d);
        expect(res.status).toBe(0);
        const board = readBoard(d);
        expect(board.tickets.find((t) => t.id === LANE_ID)).toBeDefined();

        const oracle = runOracle(d.outFile);
        expect(oracle.activeIds).toEqual(expect.arrayContaining([LANE_ID]));
      } finally {
        fs.rmSync(d.tmp, { recursive: true, force: true });
      }
    });

    it("(d) newest row is a resolved non-fail execution-review -> present only via the window grace (2 min), absent once stale (20 min)", () => {
      const rows = (ageAgo: number) => [
        { role: "executor", ts: isoAgo(ageAgo + 5 * MIN), agentId: "d-exec", closedAt: isoAgo(ageAgo + 3 * MIN) },
        {
          role: "execution-review",
          ts: isoAgo(ageAgo),
          agentId: "d-review",
          verdict: "PASS",
          closedAt: isoAgo(ageAgo),
        },
      ];

      // present (2 min old newest row)
      {
        const d = freshDirs("kb-live-lanes-ac2d-fresh-");
        try {
          const sid = "ac2dfreshsession";
          writeTask(d, sid, ANCHOR_ID, { status: "pending", subject: "anchor" });
          writeFreshBeat(d, sid);
          const ledgerPath = writeLedger(d, sid, LANE_ID, rows(2 * MIN));
          touch(ledgerPath, 2 * MIN);

          const res = runExport(d);
          expect(res.status).toBe(0);
          const board = readBoard(d);
          expect(board.tickets.find((t) => t.id === LANE_ID)).toBeDefined();
        } finally {
          fs.rmSync(d.tmp, { recursive: true, force: true });
        }
      }

      // absent (20 min old newest row)
      {
        const d = freshDirs("kb-live-lanes-ac2d-stale-");
        try {
          const sid = "ac2dstalesession";
          writeTask(d, sid, ANCHOR_ID, { status: "pending", subject: "anchor" });
          writeFreshBeat(d, sid);
          const ledgerPath = writeLedger(d, sid, LANE_ID, rows(20 * MIN));
          touch(ledgerPath, 20 * MIN);

          const res = runExport(d);
          expect(res.status).toBe(0);
          const board = readBoard(d);
          expect(board.tickets.find((t) => t.id === LANE_ID)).toBeUndefined();
        } finally {
          fs.rmSync(d.tmp, { recursive: true, force: true });
        }
      }
    });
  });

  describe("AC-3 — global absence: the sibling's migrated-card fixture is untouched (no phantom twin under OLD)", () => {
    it("card under NEW only + a stray OPEN ledger row under OLD -> exactly one ticket, under NEW, unforged mtime; the picker is unaffected by the stray ledger; no orphan-backlog line", () => {
      const d = freshDirs("kb-live-lanes-ac3-");
      try {
        const OLD = "old3sessio";
        const NEW = "new3sessio";
        const ID = "migrated1";

        // NEW holds the real (migrated) card — the sibling's own AC-1(g) shape.
        const cardPath = writeTask(d, NEW, ID, { status: "in_progress", subject: "migrated card" });
        touch(cardPath, 10 * MIN);

        // OLD keeps an UNRELATED, terminal card (so it stays a "valid session"
        // per collectSessions — >=1 task file) plus a fresh OPEN planner row
        // for `ID` — the sibling's fixture shape (a stray row for a migrated id).
        const oldAnchor = writeTask(d, OLD, "9500", { status: "completed", subject: "old anchor (unrelated)" });
        touch(oldAnchor, 60 * MIN);
        writeFreshBeat(d, OLD); // fresh beat under OLD only — no NEW beat
        const strayLedger = writeLedger(d, OLD, ID, [
          { role: "planner", ts: new Date().toISOString(), agentId: "old-planner" },
        ]);

        const beforeCard = fs.statSync(cardPath).mtimeMs;

        const res = runExport(d);
        expect(res.status).toBe(0);
        const board = readBoard(d);

        const matches = board.tickets.filter((t) => t.id === ID);
        expect(matches).toHaveLength(1);
        expect(matches[0].sessionId).toBe(NEW.slice(0, 8));
        expect(matches[0].ledgerOnly).toBeUndefined();
        expect(matches[0].updatedAt).toBe(fs.statSync(cardPath).mtimeMs);
        expect(fs.statSync(cardPath).mtimeMs).toBe(beforeCard); // untouched

        // No phantom orphan-backlog entry is EVER attributable to OLD: since no
        // ledger-only ticket was synthesized for `id` under OLD (the global-
        // absence check above already proved that), OLD can never appear as an
        // orphan-backlog COUNT subject (`old…=<n>`). NOTE (executor, honest
        // scope note): this fixture's OLD session is live (its own fresh beat,
        // required by this AC's literal env-table), so the REAL migrated card
        // under non-live NEW legitimately fires its OWN orphan-backlog line —
        // that is pre-existing `detectOrphanBacklog` behavior, unrelated to
        // this fix (AC-5 is the dedicated, unambiguous test of the ledger-only
        // exclusion, with a session shape that does not cross-fire this way).
        expect(res.stderr).not.toMatch(new RegExp(`${OLD.slice(0, 8)}=\\d`));

        const firstSessionId = board.sessionId;
        fs.rmSync(strayLedger);
        const res2 = runExport(d);
        expect(res2.status).toBe(0);
        const board2 = readBoard(d);
        expect(board2.sessionId).toBe(firstSessionId);
      } finally {
        fs.rmSync(d.tmp, { recursive: true, force: true });
      }
    });
  });

  describe("AC-5 — orphan-backlog never counts a card-less lane (with positive control)", () => {
    it("non-live session B holding only a ledger-only lane -> no orphan-backlog line; a REAL open card under B -> the line appears", () => {
      const d = freshDirs("kb-live-lanes-ac5-");
      try {
        const A = "sess5aaaaa";
        const B = "sess5bbbbb";

        writeTask(d, A, "8001", { status: "pending", subject: "A anchor" });
        writeFreshBeat(d, A); // A live

        const cardB = writeTask(d, B, "8002", { status: "completed", subject: "B anchor (done)" });
        touch(cardB, 3 * HOUR);
        const ledgerB = writeLedger(d, B, "lane-y", [
          { role: "executor", ts: isoAgo(3 * HOUR), agentId: "b-exec" },
        ]);
        touch(ledgerB, 3 * HOUR); // inside the 6h cap -> renders as a ledger-only lane under B

        const res = runExport(d);
        expect(res.status).toBe(0);
        const board = readBoard(d);
        expect(board.tickets.find((t) => t.id === "lane-y" && t.ledgerOnly)).toBeDefined();
        expect(res.stderr).not.toContain("orphan-backlog");

        // Positive control — a REAL stranded open card under non-live B.
        const pendingB = writeTask(d, B, "8003", { status: "pending", subject: "B stray backlog card" });
        touch(pendingB, 3 * HOUR);

        const res2 = runExport(d);
        expect(res2.status).toBe(0);
        expect(res2.stderr).toContain("orphan-backlog");
        expect(res2.stderr).toContain(B.slice(0, 8));
      } finally {
        fs.rmSync(d.tmp, { recursive: true, force: true });
      }
    });
  });

  describe("AC-6 — ship-tail in-flight parity (leg 2)", () => {
    it("(a) card-backed ticket, ONE open ship-tail row 20 min old -> IN activeIds; lane currentStageIndex==null, rolesSeen==['ship-tail']", () => {
      const d = freshDirs("kb-live-lanes-ac6a-");
      try {
        const sid = "ac6asession";
        const taskPath = writeTask(d, sid, "7001", { status: "in_progress", subject: "ship-tail card" });
        touch(taskPath, 20 * MIN); // updatedAt = max(task mtime, ledger mtime) — both must age together
        writeFreshBeat(d, sid);
        const ledgerPath = writeLedger(d, sid, "7001", [
          { role: "ship-tail", ts: isoAgo(20 * MIN), agentId: "st-agent-a" },
        ]);
        touch(ledgerPath, 20 * MIN);

        const res = runExport(d);
        expect(res.status).toBe(0);
        const oracle = runOracle(d.outFile);
        expect(oracle.activeIds).toEqual(expect.arrayContaining(["7001"]));
        const lane = oracle.lanes.find((l) => l.id === "7001");
        expect(lane).toBeDefined();
        expect(lane!.currentStageIndex).toBeNull();
        expect(lane!.rolesSeen).toEqual(["ship-tail"]);
      } finally {
        fs.rmSync(d.tmp, { recursive: true, force: true });
      }
    });

    it("(b) same shape WITH closedAt -> NOT in activeIds", () => {
      const d = freshDirs("kb-live-lanes-ac6b-");
      try {
        const sid = "ac6bsession";
        // A fresh, chain-less FOCUS ticket alongside the ship-tail ticket under
        // test — same convention research-inflight-lane.test.ts's focusTicket()
        // uses. Without a competing max-updatedAt ticket, computeActiveIds'
        // disjunct 2 (the unconditional "current focus" grant for a ticket with
        // NO pipeline-role comment at all — ship-tail is deliberately not a
        // pipeline role) would light the punched-out ship-tail ticket anyway
        // simply for being the sole in-progress ticket, masking the very
        // closedAt/chainInFlight behavior this case exists to prove.
        writeTask(d, sid, "7099", { status: "in_progress", subject: "focus (chain-less rider)" }); // freshest — stays max-updatedAt focus
        const taskPath = writeTask(d, sid, "7002", { status: "in_progress", subject: "ship-tail card closed" });
        touch(taskPath, 20 * MIN); // updatedAt = max(task mtime, ledger mtime) — both must age together
        writeFreshBeat(d, sid);
        const ledgerPath = writeLedger(d, sid, "7002", [
          {
            role: "ship-tail",
            ts: isoAgo(20 * MIN),
            agentId: "st-agent-b",
            closedAt: isoAgo(19 * MIN),
          },
        ]);
        touch(ledgerPath, 20 * MIN);

        const res = runExport(d);
        expect(res.status).toBe(0);
        const oracle = runOracle(d.outFile);
        expect(oracle.activeIds).not.toEqual(expect.arrayContaining(["7002"]));
      } finally {
        fs.rmSync(d.tmp, { recursive: true, force: true });
      }
    });

    it("(c) ledger-only ship-tail lane, open, 20 min old -> rendered + in activeIds", () => {
      const d = freshDirs("kb-live-lanes-ac6c-");
      try {
        const sid = "ac6csession";
        const anchor = writeTask(d, sid, "9700", { status: "pending", subject: "anchor" });
        touch(anchor, 10 * MIN);
        writeFreshBeat(d, sid);
        const ledgerPath = writeLedger(d, sid, "lane-st", [
          { role: "ship-tail", ts: isoAgo(20 * MIN), agentId: "st-agent-c" },
        ]);
        touch(ledgerPath, 20 * MIN);

        const res = runExport(d);
        expect(res.status).toBe(0);
        const board = readBoard(d);
        const ticket = board.tickets.find((t) => t.id === "lane-st");
        expect(ticket).toBeDefined();
        expect(ticket!.ledgerOnly).toBe(true);

        const oracle = runOracle(d.outFile);
        expect(oracle.activeIds).toEqual(expect.arrayContaining(["lane-st"]));
      } finally {
        fs.rmSync(d.tmp, { recursive: true, force: true });
      }
    });
  });
});
