// lane-mtime-undercount.test.ts — #1305: the live board under-counts "lanes
// live" because a ticket's `updatedAt` was the TASK-file mtime only. During a
// 4-role chain the work appends to the per-ticket 3-role ledger WITHOUT touching
// the task file, so the task-file mtime goes stale mid-work and the ticket's lane
// stops breathing — run 3 chains at once and the board shows "1 LANE LIVE", not 3.
// The fix folds the per-ticket ledger mtime into `updatedAt` via `max`.
//
// NOTE: these ACs are baseline-RED against master — the 5th `ledgerMtimeMs` arg
// is silently ignored by master's 4-param buildTicket, so `updatedAt` stays the
// stale task mtime and AC-1/AC-4 fail. They GREEN only with the fold in place,
// which is exactly what pins the bug. Pure number-fed (no fs) per cairn :377 —
// exact mtime equality is non-portable, so we feed plain numbers to buildTicket.

import { buildTicket, type RawTask } from "@/lib/build-board";
import { computeActiveIds } from "@/lib/active";

const NOW = 1_700_000_000_000;
const MIN = 60_000;

const SID = "sess0001";

function inProgressTask(id: string): RawTask {
  return {
    id,
    subject: `t${id}`,
    description: "",
    status: "in_progress",
    blocks: [],
    blockedBy: [],
  };
}

/** The current focus: a fresh in_progress ticket so the *window* path (not the
 *  always-on focus path) is what's under test for the other tickets. */
function focusTicket() {
  return buildTicket(inProgressTask("focus"), [], NOW - 1 * MIN, SID);
}

describe("#1305 — per-ticket ledger mtime folded into updatedAt (lane undercount)", () => {
  it("AC-1: stale task mtime + FRESH ledger mtime (non-focus) → counted ACTIVE (RED on master)", () => {
    const focus = focusTicket();
    // Task file touched 20 min ago (stale, outside the 8-min window) but the
    // ledger was appended 2 min ago (inside the window).
    const underTest = buildTicket(
      inProgressTask("ut"),
      [],
      NOW - 20 * MIN,
      SID,
      NOW - 2 * MIN
    );
    // updatedAt moves forward to the fresh ledger mtime.
    expect(underTest.updatedAt).toBe(NOW - 2 * MIN);
    const active = computeActiveIds([focus, underTest], true, NOW);
    expect(active.has("ut")).toBe(true);
  });

  it("AC-2: stale task mtime AND stale ledger mtime (non-focus) → NOT active (no false widening)", () => {
    const focus = focusTicket();
    const underTest = buildTicket(
      inProgressTask("ut"),
      [],
      NOW - 20 * MIN,
      SID,
      NOW - 15 * MIN
    );
    // max(now-20m, now-15m) = now-15m — still well outside the 8-min window.
    expect(underTest.updatedAt).toBe(NOW - 15 * MIN);
    const active = computeActiveIds([focus, underTest], true, NOW);
    expect(active.has("ut")).toBe(false);
  });

  it("AC-3: no ledger mtime → exact no-op (updatedAt === task mtime, behaves like today)", () => {
    const taskMtime = NOW - 20 * MIN;
    const underTest = buildTicket(inProgressTask("ut"), [], taskMtime, SID);
    expect(underTest.updatedAt).toBe(taskMtime);
    // As a non-focus stale ticket it is NOT active — identical to master.
    const focus = focusTicket();
    const active = computeActiveIds([focus, underTest], true, NOW);
    expect(active.has("ut")).toBe(false);
  });

  it("AC-4: 3 concurrent chains with fresh ledger mtimes → laneCount === 3 (master shows 1)", () => {
    const staleTask = NOW - 20 * MIN;
    const freshLedgers = [NOW - 1 * MIN, NOW - 2 * MIN, NOW - 3 * MIN];

    // WITH the fold: each ticket's updatedAt rides its fresh ledger mtime → all 3
    // are inside the window → 3 lanes live.
    const withFold = freshLedgers.map((led, i) =>
      buildTicket(inProgressTask(`c${i}`), [], staleTask, SID, led)
    );
    const activeWith = computeActiveIds(withFold, true, NOW);
    expect(activeWith.size).toBe(3);

    // CONTRAST — the exact "3 chains shows 1 lane" bug: same 3 tickets built
    // WITHOUT the ledger fold (stale task mtime only) → only the most-recent
    // (focus) breathes → size === 1.
    const withoutFold = freshLedgers.map((_led, i) =>
      buildTicket(inProgressTask(`c${i}`), [], staleTask - i, SID)
    );
    const activeWithout = computeActiveIds(withoutFold, true, NOW);
    expect(activeWithout.size).toBe(1);
  });
});
