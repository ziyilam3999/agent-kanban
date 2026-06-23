// handoff-session.test.ts — #1184. migrateOpenTickets moves the OPEN backlog
// (pending|in_progress) from a retired session's task dir into the active
// session's, leaving `completed` history behind, fail-closed on id-collision,
// and skipping malformed files. Both-ends: a no-op stub fails `migrates-open`;
// the collision case forces the stat-before-move (POSIX rename overwrites).
//
// SAFETY: every case uses an OS temp dir as TASKS_DIR via fs.mkdtempSync — it
// NEVER reads or writes the real ~/.claude/tasks. Cleaned up in afterEach.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { migrateOpenTickets } from "@/scripts/handoff-session";

type Status = "pending" | "in_progress" | "completed";

let root: string;
let tasksDir: string;
const FROM = "0737beca-260d-4f7f-8f9b-a47df66f0154";
const TO = "ee426cae-9054-4680-91ab-5397aa6f573a";

function sessionDir(session: string): string {
  return join(tasksDir, session);
}

/** Write a task file `<id>.json` under `session` with the given status. */
function writeTask(session: string, id: string, status: Status): string {
  const dir = sessionDir(session);
  mkdirSync(dir, { recursive: true });
  const body = JSON.stringify({
    id,
    subject: `ticket ${id}`,
    description: "",
    status,
    blocks: [],
    blockedBy: [],
  });
  const file = join(dir, `${id}.json`);
  writeFileSync(file, body, "utf8");
  return file;
}

/** Set of task-file ids present under a session dir (empty if dir absent). */
function idsIn(session: string): Set<string> {
  let entries: string[] = [];
  try {
    entries = readdirSync(sessionDir(session));
  } catch {
    return new Set();
  }
  return new Set(entries.filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, "")));
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "akb-handoff-"));
  tasksDir = join(root, "tasks");
  mkdirSync(tasksDir, { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("migrateOpenTickets — #1184 session-handoff backlog migration", () => {
  it("red-state: from has 2 open + 1 completed, to is empty (pre-conditions)", () => {
    writeTask(FROM, "1001", "pending");
    writeTask(FROM, "1002", "in_progress");
    writeTask(FROM, "1003", "completed");
    // `to` dir does not exist yet → 0 files, neither open id present.
    expect(idsIn(TO).size).toBe(0);
    expect(idsIn(TO).has("1001")).toBe(false);
    expect(idsIn(TO).has("1002")).toBe(false);
    expect(idsIn(FROM)).toEqual(new Set(["1001", "1002", "1003"]));
  });

  it("migrates-open: both open ids move to `to` (not in `from`); contents byte-identical", () => {
    const open1 = writeTask(FROM, "1001", "pending");
    writeTask(FROM, "1002", "in_progress");
    writeTask(FROM, "1003", "completed");
    const open1Before = readFileSync(open1, "utf8");

    const r = migrateOpenTickets({ tasksDir, fromSession: FROM, toSession: TO });

    expect(new Set(r.moved)).toEqual(new Set(["1001", "1002"]));
    expect(r.keptDone).toEqual(["1003"]);
    expect(r.skippedCollisions).toEqual([]);
    expect(r.skippedMalformed).toEqual([]);

    // Open ids now under `to`, gone from `from`.
    expect(idsIn(TO)).toEqual(new Set(["1001", "1002"]));
    expect(idsIn(FROM).has("1001")).toBe(false);
    expect(idsIn(FROM).has("1002")).toBe(false);

    // Completed id still in `from`, never in `to`.
    expect(idsIn(FROM).has("1003")).toBe(true);
    expect(idsIn(TO).has("1003")).toBe(false);

    // Id + contents preserved (byte-identical) after the move.
    const open1After = readFileSync(join(sessionDir(TO), "1001.json"), "utf8");
    expect(open1After).toBe(open1Before);
  });

  it("leaves-done: a completed ticket never moves", () => {
    writeTask(FROM, "1003", "completed");
    const r = migrateOpenTickets({ tasksDir, fromSession: FROM, toSession: TO });
    expect(r.moved).toEqual([]);
    expect(r.keptDone).toEqual(["1003"]);
    expect(idsIn(FROM).has("1003")).toBe(true);
    expect(existsSync(sessionDir(TO))).toBe(false); // no dest dir created for a no-move
  });

  it("idempotent: a 2nd run with no open tickets left is a clean no-op (no throw)", () => {
    writeTask(FROM, "1001", "pending");
    migrateOpenTickets({ tasksDir, fromSession: FROM, toSession: TO });
    const second = migrateOpenTickets({ tasksDir, fromSession: FROM, toSession: TO });
    expect(second.moved).toEqual([]);
    expect(second.skippedCollisions).toEqual([]);
  });

  it("refuses-same: fromSession === toSession throws", () => {
    expect(() => migrateOpenTickets({ tasksDir, fromSession: FROM, toSession: FROM })).toThrow();
  });

  it("collision-fail-closed: a same-id file already in `to` → skippedCollisions, source NOT deleted", () => {
    writeTask(FROM, "1001", "pending");
    writeTask(TO, "1001", "pending"); // pre-existing dest with the same id
    const destBefore = readFileSync(join(sessionDir(TO), "1001.json"), "utf8");

    const r = migrateOpenTickets({ tasksDir, fromSession: FROM, toSession: TO });

    expect(r.moved).toEqual([]);
    expect(r.skippedCollisions).toEqual(["1001"]);
    // Source still present (not overwritten / not deleted).
    expect(idsIn(FROM).has("1001")).toBe(true);
    // Dest untouched (rename did NOT silently overwrite it).
    expect(readFileSync(join(sessionDir(TO), "1001.json"), "utf8")).toBe(destBefore);
  });

  it("malformed-skipped: a non-JSON file in `from` → skippedMalformed, run still completes", () => {
    writeTask(FROM, "1001", "pending");
    // A .json file with invalid contents — guarded parse must skip it, not throw.
    writeFileSync(join(sessionDir(FROM), "bad.json"), "{ this is not valid json", "utf8");

    const r = migrateOpenTickets({ tasksDir, fromSession: FROM, toSession: TO });

    expect(r.skippedMalformed).toEqual(["bad"]);
    expect(r.moved).toEqual(["1001"]); // the open ticket still migrates
    expect(idsIn(TO).has("1001")).toBe(true);
    // The malformed file is left in `from` (skipped, not moved).
    expect(idsIn(FROM).has("bad")).toBe(true);
  });
});
