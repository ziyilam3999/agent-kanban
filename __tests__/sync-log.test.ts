// sync-log.test.ts — #1158. The pure JSONL logbook helper: append-only, single
// atomic write per record, mkdir-p, never throws to the caller, SYNC_LOG override.
// Hermetic — every case uses an OS temp dir, never touches the real data/sync.log.

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  appendSyncRecord,
  defaultSyncLogPath,
  readSyncLog,
  type SyncRecord,
} from "@/lib/sync-log";

let root: string;
const savedEnv = process.env.SYNC_LOG;

function rec(over: Partial<SyncRecord> = {}): SyncRecord {
  return {
    ts: "2026-06-26T00:00:00.000Z",
    result: "uploaded",
    reason: "env-token",
    url: "https://blob.example.test/board.json",
    boardBytes: 123,
    boardMtime: "2026-06-26T00:00:00.000Z",
    ...over,
  };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "akb-synclog-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  if (savedEnv === undefined) delete process.env.SYNC_LOG;
  else process.env.SYNC_LOG = savedEnv;
});

describe("sync-log helper (#1158)", () => {
  it("append → read round-trips a record as one JSONL line", () => {
    const logPath = join(root, "sync.log");
    appendSyncRecord(rec(), logPath);
    const recs = readSyncLog(logPath);
    expect(recs).toHaveLength(1);
    expect(recs[0].result).toBe("uploaded");
    // Exactly one trailing newline-terminated line.
    expect(readFileSync(logPath, "utf8").split("\n").filter(Boolean)).toHaveLength(1);
  });

  it("creates missing parent dirs (mkdir-p)", () => {
    const logPath = join(root, "nested", "deep", "sync.log");
    appendSyncRecord(rec(), logPath);
    expect(existsSync(logPath)).toBe(true);
  });

  it("appends (never truncates) across multiple records", () => {
    const logPath = join(root, "sync.log");
    appendSyncRecord(rec({ result: "uploaded" }), logPath);
    appendSyncRecord(rec({ result: "skipped-no-token", url: null }), logPath);
    appendSyncRecord(rec({ result: "failed", url: null }), logPath);
    const recs = readSyncLog(logPath);
    expect(recs.map((r) => r.result)).toEqual([
      "uploaded",
      "skipped-no-token",
      "failed",
    ]);
  });

  it("each record is a single line (no embedded newline → atomic O_APPEND write)", () => {
    const logPath = join(root, "sync.log");
    for (let i = 0; i < 5; i++) appendSyncRecord(rec(), logPath);
    const lines = readFileSync(logPath, "utf8").split("\n").filter(Boolean);
    expect(lines).toHaveLength(5);
    for (const l of lines) expect(() => JSON.parse(l)).not.toThrow();
  });

  it("never throws on an unwritable path (best-effort logging)", () => {
    // A path whose parent is a FILE, not a dir → mkdir/append fail internally.
    const filePath = join(root, "afile");
    appendSyncRecord(rec(), filePath); // create the file
    const bogus = join(filePath, "child", "sync.log");
    expect(() => appendSyncRecord(rec(), bogus)).not.toThrow();
  });

  it("readSyncLog on an absent file returns [] (no throw)", () => {
    expect(readSyncLog(join(root, "nope.log"))).toEqual([]);
  });

  it("readSyncLog skips malformed lines", () => {
    const logPath = join(root, "sync.log");
    appendSyncRecord(rec(), logPath);
    // Simulate a corrupt half-line by appending raw garbage via the helper's file.
    require("node:fs").appendFileSync(logPath, "{not json\n");
    appendSyncRecord(rec({ result: "failed", url: null }), logPath);
    const recs = readSyncLog(logPath);
    expect(recs.map((r) => r.result)).toEqual(["uploaded", "failed"]);
  });

  it("defaultSyncLogPath honours SYNC_LOG override, else data/sync.log", () => {
    process.env.SYNC_LOG = "/tmp/custom-sync.log";
    expect(defaultSyncLogPath()).toBe("/tmp/custom-sync.log");
    delete process.env.SYNC_LOG;
    expect(defaultSyncLogPath()).toBe(join("data", "sync.log"));
  });
});
