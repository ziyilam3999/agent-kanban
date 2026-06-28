// ledger-mtime-map.test.ts — #1305 AC-5: the IO seam that reads each ticket's
// 3-role ledger file mtime. `ledgerMtimeByTaskId` does ONE guarded readdir of
// `<ledgerDir>/<sessionId>/` and maps every `<taskId>.jsonl` → its statSync mtime.
//
// NOTE: baseline-RED against master — `ledgerMtimeByTaskId` does not exist on
// master (the per-ticket scan is the #1305 fix), so this file does not even
// compile/import there. It pins the new IO helper + its missing-dir no-op guard.
//
// mtime is asserted with a < 1000ms tolerance (NEVER toBe): utimesSync stamps in
// SECONDS and readback mtimeMs drifts sub-second across filesystems (cairn :377).

import { mkdtempSync, mkdirSync, writeFileSync, utimesSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { ledgerMtimeByTaskId } from "@/scripts/export-board";

const SESSION = "0737beca-260d-4f7f-8f9b-a47df66f0154";

/** Write a file then stamp its mtime to `whenMs` ms-epoch (utimes takes seconds). */
function writeAt(path: string, body: string, whenMs: number): void {
  writeFileSync(path, body, "utf8");
  const secs = whenMs / 1000;
  utimesSync(path, secs, secs);
}

describe("ledgerMtimeByTaskId — #1305 IO seam", () => {
  it("AC-5: maps each <taskId>.jsonl to its mtime (±1s), only real .jsonl files", () => {
    const root = mkdtempSync(join(tmpdir(), "akb-ledger-map-"));
    const ledgerDir = join(root, "3role-ledger");
    const sessLedgerDir = join(ledgerDir, SESSION);
    mkdirSync(sessLedgerDir, { recursive: true });

    const now = Date.now();
    const mtimeA = now - 2 * 60 * 1000; // ticket 1305
    const mtimeB = now - 9 * 60 * 1000; // ticket 1306
    writeAt(join(sessLedgerDir, "1305.jsonl"), '{"role":"executor"}\n', mtimeA);
    writeAt(join(sessLedgerDir, "1306.jsonl"), '{"role":"planner"}\n', mtimeB);

    // A non-.jsonl file and a directory named like a ledger file must be ignored.
    writeAt(join(sessLedgerDir, "notes.txt"), "ignore me", now);
    mkdirSync(join(sessLedgerDir, "1307.jsonl")); // dir, NOT a file → isFile() guard

    const map = ledgerMtimeByTaskId(ledgerDir, SESSION);

    expect(map.size).toBe(2); // only the two real .jsonl files
    expect(Math.abs((map.get("1305") as number) - mtimeA)).toBeLessThan(1000);
    expect(Math.abs((map.get("1306") as number) - mtimeB)).toBeLessThan(1000);
    expect(map.has("notes")).toBe(false);
    expect(map.has("1307")).toBe(false); // the isFile() guard excludes the dir
  });

  it("AC-5: a MISSING session ledger dir returns an empty Map (no throw)", () => {
    const root = mkdtempSync(join(tmpdir(), "akb-ledger-map-empty-"));
    const ledgerDir = join(root, "3role-ledger"); // no <SESSION>/ subdir created
    let map: Map<string, number> = new Map([["seed", 1]]);
    expect(() => {
      map = ledgerMtimeByTaskId(ledgerDir, SESSION);
    }).not.toThrow();
    expect(map.size).toBe(0);
  });
});
