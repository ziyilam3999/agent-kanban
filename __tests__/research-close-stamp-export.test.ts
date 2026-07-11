// research-close-stamp-export.test.ts — #1516 AC-6c: the close-stamp is a REAL
// emitted-board field, not just a type-checker fiction. This shells out to the
// ACTUAL scripts/export-board.ts (same pattern as
// __tests__/orphan-warning-command.test.ts) against a hermetic OS-temp fixture
// tree — never the real ~/.claude state or the tracked data/board.json (OUT is
// always pointed at a temp file, satisfying the reviewer's "set OUT explicitly"
// note).
//
// Two assertions form the discriminating pair:
//   - a research ledger line WITH closedAt -> the exported ticket's research
//     comment carries `closedAt` with the exact value (kills a dropped-field
//     regression in toComment()'s allowlist copier, or in RawLedgerLine's parse
//     shape — either one silently drops the field).
//   - a research ledger line WITHOUT closedAt -> the exported comment has NO
//     closedAt key at all (kills a false-stamp / default-fabrication bug).
//
// RED-verified by hand pre-fix (board-schema.ts / build-board.ts reverted to
// HEAD before #1516): the exported comment carried no closedAt field at all —
// `jq -e '.tickets[0].comments[0].closedAt'` returned `null` / exit 1. This test
// mechanizes that same proof so it survives as a permanent regression guard.

import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

describe("#1516 AC-6c — closedAt survives the REAL export pipeline into board.json", () => {
  const SID = "sess1516ac6c";
  const TASK_ID = "9001";
  const CLOSED_AT = "2026-07-11T09:00:00Z";
  let tmp: string;
  let tasksDir: string;
  let ledgerDir: string;
  let outFile: string;

  function writeFixture(researchLine: Record<string, unknown>): void {
    const taskDir = path.join(tasksDir, SID);
    const ledgerSessDir = path.join(ledgerDir, SID);
    fs.mkdirSync(taskDir, { recursive: true });
    fs.mkdirSync(ledgerSessDir, { recursive: true });
    fs.writeFileSync(
      path.join(taskDir, `${TASK_ID}.json`),
      JSON.stringify({
        id: TASK_ID,
        subject: "research seat close-stamp fixture",
        description: "",
        status: "in_progress",
        blocks: [],
        blockedBy: [],
      })
    );
    fs.writeFileSync(
      path.join(ledgerSessDir, `${TASK_ID}.jsonl`),
      JSON.stringify(researchLine) + "\n"
    );
  }

  function runExport(): unknown {
    const res = spawnSync("npx", ["tsx", "scripts/export-board.ts"], {
      cwd: path.resolve(__dirname, ".."),
      env: {
        ...process.env,
        NODE_ENV: "development", // main() runs only when NODE_ENV !== "test"
        TASKS_DIR: tasksDir,
        LEDGER_DIR: ledgerDir,
        OUT: outFile, // explicit — unset would default to the tracked data/board.json
        SESSION_ID: SID,
      },
      encoding: "utf8",
      timeout: 60_000,
      shell: true, // Windows: npx is npx.cmd, not directly spawnable without a shell.
    });
    expect(res.status).toBe(0);
    const raw = fs.readFileSync(outFile, "utf8");
    return JSON.parse(raw);
  }

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ac6c-close-stamp-"));
    tasksDir = path.join(tmp, "tasks");
    ledgerDir = path.join(tmp, "ledger");
    outFile = path.join(tmp, "board.json");
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("a CLOSED research row exports closedAt with the exact ledger value", () => {
    writeFixture({
      role: "research",
      ts: "2026-07-11T08:55:00Z",
      agentId: "agent-ac6c-closed",
      closedAt: CLOSED_AT,
    });

    const board = runExport() as {
      tickets: Array<{ id: string; comments: Array<Record<string, unknown>> }>;
    };
    const ticket = board.tickets.find((t) => t.id === TASK_ID);
    expect(ticket).toBeDefined();
    expect(ticket!.comments).toHaveLength(1);
    expect(ticket!.comments[0].role).toBe("research");
    expect(ticket!.comments[0].closedAt).toBe(CLOSED_AT);
  });

  it("an OPEN research row (no closedAt) exports with NO closedAt key at all", () => {
    writeFixture({
      role: "research",
      ts: "2026-07-11T08:55:00Z",
      agentId: "agent-ac6c-open",
      // no closedAt
    });

    const board = runExport() as {
      tickets: Array<{ id: string; comments: Array<Record<string, unknown>> }>;
    };
    const ticket = board.tickets.find((t) => t.id === TASK_ID);
    expect(ticket).toBeDefined();
    expect(ticket!.comments).toHaveLength(1);
    expect(ticket!.comments[0].role).toBe("research");
    expect("closedAt" in ticket!.comments[0]).toBe(false);
  });
});
