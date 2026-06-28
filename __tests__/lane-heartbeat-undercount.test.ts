// lane-heartbeat-undercount.test.ts — #1317: the LANE-LIVE counter must count a
// content / non-4-role lane (one that writes NO 3-role ledger). The reader folds
// a generic SESSION-keyed lane-heartbeat marker's mtime into the session
// `lastActiveMs` by the SAME `max` rule the #1305/#1121 ledger fold uses, so a
// quiet content-lane-only session breathes instead of going dark.
//
// SHARED MARKER CONTRACT (the cross-PR seam the ai-brain writer hook PRODUCES and
// this reader CONSUMES — both assert against THIS, never each other's binary):
//   filename: <session_id>.beat   (full session UUID + ".beat")
//   location: flat inside heartbeatDir (NOT nested under a per-session subdir)
//   contents: EMPTY (zero bytes) — the mtime is the ENTIRE signal
//
// Baseline-RED on master: master's export-board exports NO `heartbeatMtimeBySession`
// and `collectSessions` folds only task + ledger mtimes, so this file does not even
// import/compile there. mtime assertions use a ±1s tolerance (NEVER toBe):
// utimesSync stamps WHOLE seconds and mtimeMs drifts sub-second across filesystems
// (APFS local vs ext4 CI) — exactly as ledger-mtime-map.test.ts already asserts.

import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  utimesSync,
  statSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  collectSessions,
  heartbeatMtimeBySession,
} from "@/scripts/export-board";
import {
  buildSessionSummary,
  buildTicket,
  type RawTask,
} from "@/lib/build-board";
import { computeActiveIds } from "@/lib/active";

const SESSION = "0737beca-260d-4f7f-8f9b-a47df66f0154";
const SESSION_B = "1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d";

/** Write a file then stamp its mtime to `whenMs` ms-epoch (utimes takes seconds). */
function writeAt(path: string, body: string, whenMs: number): void {
  writeFileSync(path, body, "utf8");
  const secs = whenMs / 1000;
  utimesSync(path, secs, secs);
}

function inProgressTask(id: string): RawTask {
  return {
    id,
    subject: `content lane ${id}`,
    description: "",
    status: "in_progress",
    blocks: [],
    blockedBy: [],
  };
}

/**
 * Seed a content-lane-only session: one in_progress ticket with a STALE task-file
 * mtime (30 min ago), NO 3-role ledger dir, and (optionally) a `<session>.beat`
 * marker stamped `beatAgeMs` ago. When `beatAgeMs` is null the heartbeat dir is
 * never created (proves the missing-dir no-op).
 */
function seedContentLane(opts: { beatAgeMs: number | null }): {
  tasksDir: string;
  ledgerDir: string;
  heartbeatDir: string;
  now: number;
  taskMtime: number;
  beatMtime: number;
  taskId: string;
} {
  const root = mkdtempSync(join(tmpdir(), "akb-heartbeat-"));
  const tasksDir = join(root, "tasks");
  const ledgerDir = join(root, "3role-ledger"); // intentionally absent
  const heartbeatDir = join(root, "lane-heartbeats");
  const now = Date.now();
  const taskMtime = now - 30 * 60 * 1000; // 30 min ago → STALE (outside 5-min window)

  const sessTasksDir = join(tasksDir, SESSION);
  mkdirSync(sessTasksDir, { recursive: true });
  const taskId = "9001";
  writeAt(
    join(sessTasksDir, `${taskId}.json`),
    JSON.stringify(inProgressTask(taskId)),
    taskMtime
  );

  let beatMtime = 0;
  if (opts.beatAgeMs !== null) {
    mkdirSync(heartbeatDir, { recursive: true });
    beatMtime = now - opts.beatAgeMs;
    // The contracted marker: flat in heartbeatDir, <session>.beat, ZERO bytes.
    writeAt(join(heartbeatDir, `${SESSION}.beat`), "", beatMtime);
  }
  return { tasksDir, ledgerDir, heartbeatDir, now, taskMtime, beatMtime, taskId };
}

describe("#1317 reader — session lane-heartbeat fold counts a content lane", () => {
  it("AC-1: a FRESH heartbeat counts a content-lane-only session's lane", () => {
    const { tasksDir, ledgerDir, heartbeatDir, now, taskMtime, beatMtime, taskId } =
      seedContentLane({ beatAgeMs: 60 * 1000 }); // 1 min ago → FRESH

    const sessions = collectSessions(tasksDir, ledgerDir, heartbeatDir);
    expect(sessions).toHaveLength(1);
    const s = sessions[0];

    // lastActiveMs tracks the FRESH beat, not the stale task mtime (±1s per R1).
    expect(Math.abs(s.lastActiveMs - beatMtime)).toBeLessThan(1000);
    expect(s.lastActiveMs).toBeGreaterThan(taskMtime);

    const summary = buildSessionSummary(
      s.sessionId,
      s.lastActiveMs,
      s.taskFiles.length,
      now
    );
    expect(summary.live).toBe(true);

    // The content ticket (stale task mtime, the sole focus) breathes once live.
    const ticket = buildTicket(
      inProgressTask(taskId),
      [],
      taskMtime,
      s.sessionId.slice(0, 8)
    );
    const active = computeActiveIds([ticket], summary.live, now);
    expect(active.has(taskId)).toBe(true);
  });

  it("AC-2: a STALE heartbeat does NOT widen the count (recent-touch ≠ being-worked)", () => {
    const { tasksDir, ledgerDir, heartbeatDir, now, taskId } = seedContentLane({
      beatAgeMs: 15 * 60 * 1000, // 15 min ago → outside the 5-min LIVE_WINDOW_MS
    });

    const s = collectSessions(tasksDir, ledgerDir, heartbeatDir)[0];
    const summary = buildSessionSummary(
      s.sessionId,
      s.lastActiveMs,
      s.taskFiles.length,
      now
    );
    expect(summary.live).toBe(false); // no fabricated liveness

    const ticket = buildTicket(
      inProgressTask(taskId),
      [],
      now - 30 * 60 * 1000,
      s.sessionId.slice(0, 8)
    );
    const active = computeActiveIds([ticket], summary.live, now);
    expect(active.size).toBe(0);
  });

  it("AC-3: no-regression — the fold is purely additive (no .beat ⇒ lastActiveMs unchanged)", () => {
    // (a) a session with NO .beat and NO ledger → lastActiveMs == task-file mtime
    //     (±1s) — IDENTICAL to today's behavior; the fold added NOTHING.
    const a = seedContentLane({ beatAgeMs: null });
    const sa = collectSessions(a.tasksDir, a.ledgerDir, a.heartbeatDir)[0];
    expect(Math.abs(sa.lastActiveMs - a.taskMtime)).toBeLessThan(1000);

    // (b) a 4-role session with a FRESH per-ticket ledger mtime but NO .beat still
    //     counts exactly as today (#1305/#1121 ledger path byte-unchanged).
    const root = mkdtempSync(join(tmpdir(), "akb-heartbeat-noreg-"));
    const tasksDir = join(root, "tasks");
    const ledgerDir = join(root, "3role-ledger");
    const heartbeatDir = join(root, "lane-heartbeats"); // never created → no beat
    const now = Date.now();
    const taskMtime = now - 30 * 60 * 1000; // stale
    const ledgerMtime = now - 1 * 60 * 1000; // fresh ledger activity

    const sessTasksDir = join(tasksDir, SESSION);
    mkdirSync(sessTasksDir, { recursive: true });
    writeAt(
      join(sessTasksDir, "1305.json"),
      JSON.stringify(inProgressTask("1305")),
      taskMtime
    );
    const sessLedgerDir = join(ledgerDir, SESSION);
    mkdirSync(sessLedgerDir, { recursive: true });
    writeAt(join(sessLedgerDir, "1305.jsonl"), '{"role":"executor"}\n', ledgerMtime);

    const sb = collectSessions(tasksDir, ledgerDir, heartbeatDir)[0];
    expect(Math.abs(sb.lastActiveMs - ledgerMtime)).toBeLessThan(1000);
    const summaryB = buildSessionSummary(
      sb.sessionId,
      sb.lastActiveMs,
      sb.taskFiles.length,
      now
    );
    expect(summaryB.live).toBe(true);
  });

  it("AC-4: heartbeat fold flips a content session invisible→counted, but does NOT back-date a stale idle 2nd ticket (honest bound R4)", () => {
    // A session live ONLY by the beat: BOTH in_progress tickets have stale task
    // mtimes and NO ledger, so the ONLY fresh source is the session beat.
    const root = mkdtempSync(join(tmpdir(), "akb-heartbeat-parallel-"));
    const tasksDir = join(root, "tasks");
    const ledgerDir = join(root, "3role-ledger"); // absent
    const heartbeatDir = join(root, "lane-heartbeats");
    const now = Date.now();
    const staleA = now - 30 * 60 * 1000; // focus content lane — stale
    const staleB = now - 40 * 60 * 1000; // idle 2nd ticket — even staler
    const beatMtime = now - 1 * 60 * 1000; // FRESH session pulse

    const sessTasksDir = join(tasksDir, SESSION);
    mkdirSync(sessTasksDir, { recursive: true });
    writeAt(join(sessTasksDir, "9001.json"), JSON.stringify(inProgressTask("9001")), staleA);
    writeAt(join(sessTasksDir, "9002.json"), JSON.stringify(inProgressTask("9002")), staleB);
    mkdirSync(heartbeatDir, { recursive: true });
    writeAt(join(heartbeatDir, `${SESSION}.beat`), "", beatMtime);

    const ticketA = buildTicket(inProgressTask("9001"), [], staleA, SESSION.slice(0, 8));
    const ticketB = buildTicket(inProgressTask("9002"), [], staleB, SESSION.slice(0, 8));

    // WITH the heartbeat fold → session live → the focus lane (most-recent
    // in_progress) breathes on its OWN. The idle stale 2nd ticket is NOT
    // back-dated (outside the 8-min window) → size === 1, never 2.
    const withFold = collectSessions(tasksDir, ledgerDir, heartbeatDir)[0];
    const liveSummary = buildSessionSummary(
      withFold.sessionId,
      withFold.lastActiveMs,
      withFold.taskFiles.length,
      now
    );
    expect(liveSummary.live).toBe(true);
    const activeWith = computeActiveIds([ticketA, ticketB], liveSummary.live, now);
    expect(activeWith.has("9001")).toBe(true); // focus lit by the beat
    expect(activeWith.has("9002")).toBe(false); // stale idle 2nd ticket NOT faked
    expect(activeWith.size).toBe(1);

    // WITHOUT the heartbeat fold (point the scanner at an empty dir so no beat is
    // seen) → lastActiveMs stays stale → not live → size === 0.
    const noBeatDir = mkdtempSync(join(tmpdir(), "akb-heartbeat-none-"));
    const withoutFold = collectSessions(tasksDir, ledgerDir, noBeatDir)[0];
    const deadSummary = buildSessionSummary(
      withoutFold.sessionId,
      withoutFold.lastActiveMs,
      withoutFold.taskFiles.length,
      now
    );
    expect(deadSummary.live).toBe(false);
    expect(computeActiveIds([ticketA, ticketB], deadSummary.live, now).size).toBe(0);
  });
});

describe("#1317 reader — heartbeatMtimeBySession scanner (AC-5)", () => {
  it("AC-5: maps each <session>.beat to its mtime (±1s), ignoring non-.beat + dirs", () => {
    const heartbeatDir = mkdtempSync(join(tmpdir(), "akb-beat-map-"));
    const now = Date.now();
    const mtimeA = now - 2 * 60 * 1000;
    const mtimeB = now - 9 * 60 * 1000;
    writeAt(join(heartbeatDir, `${SESSION}.beat`), "", mtimeA);
    writeAt(join(heartbeatDir, `${SESSION_B}.beat`), "", mtimeB);

    // A non-.beat file and a DIRECTORY named like a marker must be ignored.
    writeAt(join(heartbeatDir, "notes.txt"), "ignore me", now);
    mkdirSync(join(heartbeatDir, "deadbeef.beat")); // dir, NOT a file → isFile() guard

    const map = heartbeatMtimeBySession(heartbeatDir);

    expect(map.size).toBe(2);
    expect(Math.abs((map.get(SESSION) as number) - mtimeA)).toBeLessThan(1000);
    expect(Math.abs((map.get(SESSION_B) as number) - mtimeB)).toBeLessThan(1000);
    expect(map.has("notes")).toBe(false);
    expect(map.has("deadbeef")).toBe(false); // the isFile() guard excludes the dir
  });

  it("AC-5: a MISSING heartbeat dir returns an empty Map (no throw)", () => {
    const root = mkdtempSync(join(tmpdir(), "akb-beat-map-empty-"));
    const heartbeatDir = join(root, "lane-heartbeats"); // never created
    let map: Map<string, number> = new Map([["seed", 1]]);
    expect(() => {
      map = heartbeatMtimeBySession(heartbeatDir);
    }).not.toThrow();
    expect(map.size).toBe(0);
  });
});

describe("#1317 reader — session lastActiveMs fold (AC-6 / M1)", () => {
  it("AC-6 fresh→live: a fresh <session>.beat makes a content-lane-only session live", () => {
    const { tasksDir, ledgerDir, heartbeatDir, now, taskMtime, beatMtime } =
      seedContentLane({ beatAgeMs: 60 * 1000 });

    const s = collectSessions(tasksDir, ledgerDir, heartbeatDir)[0];
    // lastActiveMs tracks the beat (±1s per R1) AND is > the stale task mtime.
    expect(Math.abs(s.lastActiveMs - beatMtime)).toBeLessThan(1000);
    expect(s.lastActiveMs).toBeGreaterThan(taskMtime);
    expect(
      buildSessionSummary(s.sessionId, s.lastActiveMs, s.taskFiles.length, now).live
    ).toBe(true); // RED on master (folds only task+ledger → stale → false)
  });

  it("AC-6 stale→not-live: a stale <session>.beat does NOT make the session live", () => {
    const { tasksDir, ledgerDir, heartbeatDir, now } = seedContentLane({
      beatAgeMs: 15 * 60 * 1000,
    });
    const s = collectSessions(tasksDir, ledgerDir, heartbeatDir)[0];
    expect(
      buildSessionSummary(s.sessionId, s.lastActiveMs, s.taskFiles.length, now).live
    ).toBe(false);
  });
});

describe("#1317 reader — hermetic end-to-end against the SHARED MARKER CONTRACT (AC-8)", () => {
  it("AC-8: hand-written empty <session>.beat fixture → reader counts the lane live (no ai-brain binary)", () => {
    const root = mkdtempSync(join(tmpdir(), "akb-heartbeat-e2e-"));
    const tasksDir = join(root, "tasks");
    const ledgerDir = join(root, "3role-ledger"); // absent — non-4-role lane
    const heartbeatDir = join(root, "lane-heartbeats");
    const now = Date.now();
    const taskMtime = now - 30 * 60 * 1000; // STALE
    const beatMtime = now - 1 * 60 * 1000; // FRESH

    // Seed one in_progress content ticket with a stale task mtime, NO ledger.
    const sessTasksDir = join(tasksDir, SESSION);
    mkdirSync(sessTasksDir, { recursive: true });
    writeAt(
      join(sessTasksDir, "9001.json"),
      JSON.stringify(inProgressTask("9001")),
      taskMtime
    );

    // REPRODUCE the SHARED MARKER CONTRACT directly: an EMPTY (zero-byte) file
    // named <session>.beat, flat in heartbeatDir, mtime stamped fresh.
    const marker = join(heartbeatDir, `${SESSION}.beat`);
    mkdirSync(heartbeatDir, { recursive: true });
    writeAt(marker, "", beatMtime);
    expect(statSync(marker).size).toBe(0); // contract: ZERO bytes — mtime is the signal

    const s = collectSessions(tasksDir, ledgerDir, heartbeatDir)[0];
    expect(Math.abs(s.lastActiveMs - beatMtime)).toBeLessThan(1000);

    const summary = buildSessionSummary(
      s.sessionId,
      s.lastActiveMs,
      s.taskFiles.length,
      now
    );
    expect(summary.live).toBe(true);

    const ticket = buildTicket(
      inProgressTask("9001"),
      [],
      taskMtime,
      s.sessionId.slice(0, 8)
    );
    expect(
      computeActiveIds([ticket], summary.live, now).has("9001")
    ).toBe(true);
  });
});
