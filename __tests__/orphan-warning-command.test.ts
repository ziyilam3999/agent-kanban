import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

// ship-fix #1: the orphan-backlog warning prints a copy-paste
// `npm run kanban:handoff --to <id>` hint. The handoff CLI treats `--to` as the
// literal task-dir name (the FULL session id), so the hint MUST carry the full
// live session id — NOT the 8-char display id. This test runs the real exporter
// against an OS-temp store (never the real ~/.claude/tasks) and asserts the
// emitted `--to` is runnable (full-length). Both-ends: it FAILS on the 8-char
// bug and PASSES on the full-id fix.
describe("orphan-backlog warning emits a runnable --to (ship-fix #1)", () => {
  const LIVE = "aaaabbbb-1111-2222-3333-444455556666"; // 36 chars, > 8
  const ORPHAN = "ccccdddd-7777-8888-9999-aaaabbbbcccc";
  let tmp: string;
  let tasksDir: string;
  let ledgerDir: string;
  let outFile: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ob-warn-"));
    tasksDir = path.join(tmp, "tasks");
    ledgerDir = path.join(tmp, "ledger");
    outFile = path.join(tmp, "board.json");
    fs.mkdirSync(path.join(tasksDir, LIVE), { recursive: true });
    fs.mkdirSync(path.join(tasksDir, ORPHAN), { recursive: true });
    fs.mkdirSync(ledgerDir, { recursive: true });

    // Live session: a recent (completed) ticket → newest mtime → the chosen/live session.
    fs.writeFileSync(
      path.join(tasksDir, LIVE, "9000.json"),
      JSON.stringify({ id: "9000", subject: "live", status: "completed", blockedBy: [] })
    );

    // Orphan session: an OPEN (pending) ticket, made stale so it is non-live.
    const orphanTask = path.join(tasksDir, ORPHAN, "9001.json");
    fs.writeFileSync(
      orphanTask,
      JSON.stringify({ id: "9001", subject: "orphan open", status: "pending", blockedBy: [] })
    );
    const staleSec = (Date.now() - 10 * 24 * 60 * 60 * 1000) / 1000; // 10 days ago » any LIVE_WINDOW
    fs.utimesSync(orphanTask, staleSec, staleSec);
    fs.utimesSync(path.join(tasksDir, ORPHAN), staleSec, staleSec);
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("uses the FULL live session id in the --to hint, not the 8-char display id", () => {
    const res = spawnSync("npx", ["tsx", "scripts/export-board.ts"], {
      cwd: path.resolve(__dirname, ".."),
      env: {
        ...process.env,
        NODE_ENV: "development", // main() runs only when NODE_ENV !== "test"
        TASKS_DIR: tasksDir,
        LEDGER_DIR: ledgerDir,
        OUT: outFile,
      },
      encoding: "utf8",
      timeout: 60_000,
      // Windows: `npx` is npx.cmd and is not directly spawnable without a shell.
      shell: true,
    });

    const stderr = res.stderr || "";
    expect(stderr).toContain("orphan-backlog");

    const m = stderr.match(/--to (\S+)/);
    expect(m).toBeTruthy();
    const toId = (m as RegExpMatchArray)[1];

    // The hint must be runnable: the full dir name, not the truncated display id.
    expect(toId).toBe(LIVE);
    expect(toId.length).toBeGreaterThan(8);
    expect(toId).not.toBe(LIVE.slice(0, 8));
  });
});
