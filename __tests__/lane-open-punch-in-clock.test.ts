// lane-open-punch-in-clock.test.ts — #1980: the dead-lane cap must read the
// lane's OWN open punch-in (the OPEN PUNCH-IN CLOCK, OPC), not the ticket's
// `updatedAt` (task/ledger file mtime), and the "OPC beyond cap ⇒ dead"
// conjunction must hold on ALL THREE lit-disjuncts (in-flight, focus, window) —
// not just disjunct 1.
//
// The two defects this pins (one contract):
//   1. The cap's clock previously read `updatedAt` = max(task-file mtime,
//      ledger-file mtime) — activity by ANYONE on the ticket. A single bulk
//      touch (a sweep, a clerk annotation, another agent's row) re-armed a
//      fresh 6h window on a chain that had been dead for up to 19 days.
//   2. Two of the three disjuncts (focus, window) carried NO cap at all, so a
//      dead-beyond-cap chain could re-light through either side door.
//
// The fix defines the OPC per ticket (the newest parseable `ts` among its
// CURRENT open in-flight evidence — per-agent and closedAt-aware, reusing
// chainInFlight / pipelineHasOpenPunchIn's individuation verbatim) and makes
// every lit-disjunct treat "OPC beyond cap" as dead. AC-6 pins the
// degraded/unparseable-timestamp fail-direction (UNKNOWN OPC ⇒ byte-identical
// legacy `updatedAt` clock).
//
// Pure number-fed (buildTicket + synthetic RawLedgerLine[] — no fs, no
// network), same discipline as lane-inflight-undercount.test.ts. Fixtures use
// EXPLICIT agentIds + closedAt so the per-agentId punch-in/punch-out
// discriminator is exercised for real, not via the agentId-less back-compat
// path. Every AC carries an explicit `[master: ...]` baseline so the delta is
// visible; the executor note's "run AC-0 first / stop if a [master: included]
// fixture passes on master" anti-vacuity discipline applies here too.

import {
  buildTicket,
  type RawLedgerLine,
  type RawTask,
} from "@/lib/build-board";
import {
  ACTIVE_WINDOW_MS,
  INFLIGHT_LANE_CAP_MS,
  chainInFlight,
  computeActiveIds,
  openPunchInClock,
} from "@/lib/active";

const NOW = 1_700_000_000_000;
const MIN = 60_000;
const SID = "sess1980";
const H7 = 7 * 60; // 7h in minutes — comfortably beyond the 6h cap
const CAP_MIN = INFLIGHT_LANE_CAP_MS / MIN;

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

/** Synthetic ledger line, ts offset minutes before NOW, explicit fields. */
function line(
  role: string,
  minsAgo: number,
  fields?: Partial<RawLedgerLine>
): RawLedgerLine {
  return {
    role,
    ts: new Date(NOW - minsAgo * MIN).toISOString(),
    ...fields,
  };
}

const closedAt = (minsAgo: number) => new Date(NOW - minsAgo * MIN).toISOString();

/** A fresh chain-less focus ticket so the ticket under test is NON-focus —
 *  same helper shape as lane-inflight-undercount.test.ts's focusTicket(). */
function focusTicket(minsAgo = 1) {
  return buildTicket(inProgressTask("focus"), [], NOW - minsAgo * MIN, SID);
}

describe("#1980 — the open punch-in clock (OPC) binds the dead-lane cap to the lane's OWN evidence", () => {
  describe("AC-1: a recent unrelated punch-OUT (different agent) does NOT re-arm a dead chain", () => {
    // The load-bearing measured incident: an agent that died without a
    // closedAt (open punch-in 7h old) sits alongside a DIFFERENT agent's
    // recent punch-OUT row (closedAt = now−10min). Under master that recent
    // ledger write bumps `updatedAt` to now−10min and re-arms a fresh 6h
    // window; under the fix the OPC reads the OPEN agent's own 7h-old ts and
    // the lane stays dark. Kills both re-arm vectors (the `updatedAt` bump
    // AND the recent row's own ts) in one fixture: neither the closed agent's
    // recent ts nor the bumped `updatedAt` contributes to the OPC.
    const deadChain = (updatedAtMinAgo: number, closedMinAgo = 10) =>
      buildTicket(
        inProgressTask("ut"),
        [
          line("executor", H7, { agentId: "ag-ex-dead" }), // OPEN, 7h old
          line("plan-review", closedMinAgo, {
            agentId: "ag-pr-closed", // a DIFFERENT agent, punched-OUT
            closedAt: closedAt(closedMinAgo),
          }),
        ],
        NOW - updatedAtMinAgo * MIN,
        SID,
        NOW - updatedAtMinAgo * MIN
      );

    it("the open punch-in (7h) governs; the recent closed row's ts/updatedAt do NOT re-arm → EXCLUDED [master: included]", () => {
      const focus = focusTicket();
      const ut = deadChain(10); // updatedAt = now−10min (the re-armed mtime)
      expect(chainInFlight(ut)).toBe(true); // still content-in-flight…
      expect(openPunchInClock(ut)).toBe(NOW - H7 * MIN); // …but the OPC is the 7h-old punch-in
      const active = computeActiveIds([focus, ut], true, NOW);
      expect(active.has("ut")).toBe(false); // …so the cap darkens it.
    });

    it("master-side baseline check: the SAME fixture lit before the fix (updatedAt within cap)", () => {
      // Discriminator sanity: under master's updatedAt-clock this fixture is
      // lit (now − updatedAt = 10min ≤ cap). This expectation is written
      // against the FIX's contract (OPC), so it asserts the fix-side EXCLUDED
      // verdict above is a real delta, not a constant. The [master: included]
      // baseline is the OPC > updatedAt comparison this fixture encodes.
      const ut = deadChain(10);
      // OPC age (7h) exceeds the cap; updatedAt age (10min) does not. The fix
      // reads OPC → dark; master read updatedAt → light. The two ages diverge
      // by construction, so the EXCLUDED verdict turns on the OPC, not on a
      // constant.
      expect(NOW - (openPunchInClock(ut) as number)).toBeGreaterThan(
        INFLIGHT_LANE_CAP_MS
      );
      expect(NOW - ut.updatedAt).toBeLessThanOrEqual(INFLIGHT_LANE_CAP_MS);
    });
  });

  describe("AC-2: monotone death — the cap darkens the chain across a swept `updatedAt`", () => {
    // The SAME dead chain (open punch-in 7h) with `updatedAt` swept across
    // {now, now−5min, now−4h}. The OPC is 7h in every case, so the lane is
    // EXCLUDED in all three — `updatedAt` may move freely without ever
    // extending an in-flight lane's life. [master: included in all three —
    // master reads `updatedAt`, which is within the cap for all three values.]
    const deadChain = (updatedAtMinAgo: number) =>
      buildTicket(
        inProgressTask("ut"),
        [
          line("executor", H7, { agentId: "ag-ex-dead" }),
          line("plan-review", 10, {
            agentId: "ag-pr-closed",
            closedAt: closedAt(10),
          }),
        ],
        NOW - updatedAtMinAgo * MIN,
        SID,
        NOW - updatedAtMinAgo * MIN
      );

    it.each([
      ["now", 0],
      ["now−5min", 5],
      ["now−4h", 4 * 60],
    ])("updatedAt = %s → EXCLUDED (OPC is 7h in every case)", (_label, minsAgo) => {
      const focus = focusTicket();
      const ut = deadChain(minsAgo);
      expect(chainInFlight(ut)).toBe(true);
      expect(openPunchInClock(ut)).toBe(NOW - H7 * MIN);
      const active = computeActiveIds([focus, ut], true, NOW);
      expect(active.has("ut")).toBe(false);
    });
  });

  describe("AC-3: both uncapped re-light paths (focus, window) are closed", () => {
    // The dead chain: open executor punch-in 7h + a punched-out other agent.
    // (a) the dead chain as the max-updatedAt FOCUS alongside one other
    //     staler in-progress ticket → EXCLUDED. [master: included via the
    //     unconditional focus grant — `updatedAt` is 7h (beyond cap) so
    //     master's disjunct 1 does not light it, but disjunct 2's
    //     `inFlightIds.has(focus.id)` grants it unconditionally.]
    // (b) the dead chain with updatedAt = now, inside the 8-minute window →
    //     EXCLUDED. [master: included — note (N6) master lights this via
    //     disjunct 1 too since updatedAt = now; the load-bearing assertion is
    //     the fix-side EXCLUDED, which a partial fix that closes only
    //     disjunct 1 + 2 (omitting the window disjunct) still fails.]
    const baseChain = (id: string, updatedAtMinAgo: number, closedMinAgo: number) =>
      buildTicket(
        inProgressTask(id),
        [
          line("executor", H7, { agentId: "ag-ex-dead" }),
          line("plan-review", closedMinAgo, {
            agentId: "ag-pr-closed",
            closedAt: closedAt(closedMinAgo),
          }),
        ],
        NOW - updatedAtMinAgo * MIN,
        SID,
        NOW - updatedAtMinAgo * MIN
      );

    it("(a) dead chain as the max-updatedAt FOCUS → EXCLUDED [master: included via the focus grant]", () => {
      const dead = baseChain("dead", H7, H7 + 5); // updatedAt = now−7h → the focus
      // A staler chain-less rider so the dead chain is the max-updatedAt focus.
      const rider = buildTicket(
        inProgressTask("rider"),
        [],
        NOW - (H7 + 60) * MIN,
        SID
      );
      expect(chainInFlight(dead)).toBe(true);
      expect(openPunchInClock(dead)).toBe(NOW - H7 * MIN);
      const active = computeActiveIds([dead, rider], true, NOW);
      expect(active.has("dead")).toBe(false); // focus grant closed by deadBeyondCap
      expect(active.has("rider")).toBe(false); // staler chain-less rider, outside window
    });

    it("(b) dead chain with updatedAt = now, inside the 8-minute window → EXCLUDED [master: included]", () => {
      // A fresh chain-less focus decoy (updatedAt = now, first in the array)
      // keeps the dead chain NON-focus, so the window disjunct is the path
      // under test. The dead chain's OPC is 7h (beyond cap) so it is
      // dead-beyond-cap and excluded from the window disjunct too.
      const decoy = buildTicket(inProgressTask("decoy"), [], NOW, SID);
      const dead = baseChain("dead", 0, 10); // updatedAt = now, OPC = 7h
      expect(chainInFlight(dead)).toBe(true);
      expect(openPunchInClock(dead)).toBe(NOW - H7 * MIN);
      const active = computeActiveIds([decoy, dead], true, NOW);
      expect(active.has("dead")).toBe(false); // window disjunct closed by deadBeyondCap
    });
  });

  describe("AC-4: a second genuinely-live agent is TRUTH, not a re-arm", () => {
    // A dead agent A (open punch-in 7h) alongside an OPEN agent B (punch-in
    // 30min) → the lane is LIVE (B's fresh punch-in is genuine evidence).
    // Then B's rows are close-stamped → only dead A remains → EXCLUDED. The
    // OPC is the MAX over open units, so B's fresh ts governs while B is open
    // and drops out the instant B is punched-out. [master: included in both
    // halves — master reads `updatedAt`, fresh in both halves.]
    const chain = (bClosed: boolean) =>
      buildTicket(
        inProgressTask("ut"),
        [
          line("executor", H7, { agentId: "ag-A" }), // dead agent A, OPEN
          line("plan-review", 30, {
            agentId: "ag-B",
            ...(bClosed ? { closedAt: closedAt(30) } : {}),
          }), // agent B, OPEN then closed
        ],
        NOW - 30 * MIN,
        SID,
        NOW - 30 * MIN
      );

    it("dead A (7h) + OPEN B (30min) → INCLUDED (B's fresh punch-in is truth)", () => {
      const focus = focusTicket();
      const ut = chain(false);
      expect(chainInFlight(ut)).toBe(true);
      expect(openPunchInClock(ut)).toBe(NOW - 30 * MIN); // max(7h, 30min) = 30min
      const active = computeActiveIds([focus, ut], true, NOW);
      expect(active.has("ut")).toBe(true);
    });

    it("then B close-stamped → only dead A (7h) remains → EXCLUDED", () => {
      const focus = focusTicket();
      const ut = chain(true);
      expect(chainInFlight(ut)).toBe(true); // A still punched-in → still in-flight…
      expect(openPunchInClock(ut)).toBe(NOW - H7 * MIN); // …but the OPC is now A's 7h ts
      const active = computeActiveIds([focus, ut], true, NOW);
      expect(active.has("ut")).toBe(false);
    });
  });

  describe("AC-5: no regression — within-cap and inline work behave exactly as today", () => {
    it("(a) open punch-in 5h, updatedAt 5h → INCLUDED (long silent executor leg)", () => {
      const focus = focusTicket();
      const ut = buildTicket(
        inProgressTask("ut"),
        [line("executor", 5 * 60, { agentId: "ag-ex" })],
        NOW - 5 * 60 * MIN,
        SID,
        NOW - 5 * 60 * MIN
      );
      expect(chainInFlight(ut)).toBe(true);
      expect(openPunchInClock(ut)).toBe(NOW - 5 * 60 * MIN);
      const active = computeActiveIds([focus, ut], true, NOW);
      expect(active.has("ut")).toBe(true); // 5h ≤ 6h cap → live
    });

    it("(b) in_review pending-review ticket, OPEN reviewer punch-in 30min → INCLUDED (#1867)", () => {
      const focus = focusTicket();
      const ut = buildTicket(
        inProgressTask("ut"),
        [
          line("planner", 60, { agentId: "ag-pl", closedAt: closedAt(60) }),
          line("plan-review", 50, {
            agentId: "ag-pr",
            verdict: "PASS",
            closedAt: closedAt(50),
          }),
          line("executor", 30, { agentId: "ag-ex", closedAt: closedAt(30) }),
          // The running reviewer: punched IN (agentId, no closedAt), verdict pending.
          line("execution-review", 12, { agentId: "ag-er" }),
        ],
        NOW - 30 * MIN,
        SID,
        NOW - 12 * MIN
      );
      expect(ut.column).toBe("in_review");
      expect(chainInFlight(ut)).toBe(true);
      expect(openPunchInClock(ut)).toBe(NOW - 12 * MIN); // the open reviewer's ts
      const active = computeActiveIds([focus, ut], true, NOW);
      expect(active.has("ut")).toBe(true);
    });

    it("(c) chain-less ticket, zero comments, updatedAt = now → INCLUDED (window/focus unchanged for inline work)", () => {
      const focus = focusTicket();
      const ut = buildTicket(inProgressTask("ut"), [], NOW, SID);
      expect(chainInFlight(ut)).toBe(false);
      expect(openPunchInClock(ut)).toBe(undefined); // no open-evidence rows
      const active = computeActiveIds([focus, ut], true, NOW);
      expect(active.has("ut")).toBe(true); // lit via the 8-min window (recency)
    });

    describe("(d) research-only lane (#1516) — OPC over the open research rows", () => {
      it("open research row 30min → INCLUDED", () => {
        const focus = focusTicket();
        const ut = buildTicket(
          inProgressTask("ut"),
          [line("research", 30)], // OPEN — no closedAt
          NOW - 30 * MIN,
          SID,
          NOW - 30 * MIN
        );
        expect(chainInFlight(ut)).toBe(true);
        expect(openPunchInClock(ut)).toBe(NOW - 30 * MIN);
        const active = computeActiveIds([focus, ut], true, NOW);
        expect(active.has("ut")).toBe(true);
      });

      it("closedAt stamped → EXCLUDED instantly (zero time dependency; focus decoy keeps it non-focus)", () => {
        const focus = focusTicket();
        const ut = buildTicket(
          inProgressTask("ut"),
          [line("research", 30, { closedAt: closedAt(30) })],
          NOW - 30 * MIN,
          SID,
          NOW - 30 * MIN
        );
        expect(chainInFlight(ut)).toBe(false);
        expect(openPunchInClock(ut)).toBe(undefined); // no OPEN research rows
        const active = computeActiveIds([focus, ut], true, NOW);
        expect(active.has("ut")).toBe(false); // outside the 8-min window, non-focus
      });

      it("open research row 7h with updatedAt = now → EXCLUDED (OPC governs over a fresh `updatedAt`)", () => {
        const focus = focusTicket();
        const ut = buildTicket(
          inProgressTask("ut"),
          [line("research", H7)], // OPEN, 7h old
          NOW, // fresh updatedAt — the re-arm the old clock granted
          SID,
          NOW
        );
        expect(chainInFlight(ut)).toBe(true);
        expect(openPunchInClock(ut)).toBe(NOW - H7 * MIN); // 7h, not the fresh updatedAt
        const active = computeActiveIds([focus, ut], true, NOW);
        expect(active.has("ut")).toBe(false); // OPC beyond cap ⇒ dark, even with updatedAt = now
      });
    });
  });

  describe("AC-6: degraded / unparseable timestamp fail-direction", () => {
    // (a) ALL open punch-in rows carry an UNPARSEABLE ts → OPC is UNKNOWN →
    //     the cap falls back to the legacy `updatedAt` clock (byte-identical
    //     to master). updatedAt = now−1h → INCLUDED; now−7h → EXCLUDED.
    //     [master: same — master reads `updatedAt` directly.]
    // (b) MIXED — one open unit with an unparseable ts alongside an open unit
    //     with a parseable ts = now−7h, updatedAt = now → EXCLUDED. The
    //     parseable evidence governs; an unknown-age unit must NOT re-open the
    //     `updatedAt` fallback, or a single degraded row would immunise a
    //     lane against ever darkening. [master: included — fresh `updatedAt`.]
    const UNPARSEABLE = "not-a-timestamp";

    it("(a) ALL unparseable: updatedAt now−1h → INCLUDED, now−7h → EXCLUDED (UNKNOWN ⇒ legacy clock)", () => {
      const focus = focusTicket();
      const chain = (updatedAtMinAgo: number) =>
        buildTicket(
          inProgressTask("ut"),
          [
            line("planner", 0, { agentId: "ag-x", ts: UNPARSEABLE } as Partial<RawLedgerLine>),
            line("executor", 0, { agentId: "ag-y", ts: UNPARSEABLE } as Partial<RawLedgerLine>),
          ],
          NOW - updatedAtMinAgo * MIN,
          SID,
          NOW - updatedAtMinAgo * MIN
        );

      const within = chain(60); // updatedAt = now−1h
      expect(chainInFlight(within)).toBe(true);
      expect(openPunchInClock(within)).toBe(undefined); // UNKNOWN — no parseable open ts
      expect(computeActiveIds([focus, within], true, NOW).has("ut")).toBe(true); // 1h ≤ cap

      const beyond = chain(H7); // updatedAt = now−7h
      expect(chainInFlight(beyond)).toBe(true);
      expect(openPunchInClock(beyond)).toBe(undefined); // UNKNOWN
      expect(computeActiveIds([focus, beyond], true, NOW).has("ut")).toBe(false); // 7h > cap
    });

    it("(b) MIXED: one unparseable open unit + one parseable open unit (7h), updatedAt = now → EXCLUDED (parseable governs)", () => {
      const focus = focusTicket();
      // An explicit RawLedgerLine with an unparseable ts for agent A (open),
      // plus a normal parseable open row for agent B at 7h.
      const a: RawLedgerLine = {
        role: "executor",
        ts: UNPARSEABLE,
        agentId: "ag-A",
      };
      const ut = buildTicket(
        inProgressTask("ut"),
        [a, line("plan-review", H7, { agentId: "ag-B" })],
        NOW, // fresh updatedAt — would light under the UNKNOWN fallback
        SID,
        NOW
      );
      expect(chainInFlight(ut)).toBe(true);
      expect(openPunchInClock(ut)).toBe(NOW - H7 * MIN); // B's parseable 7h governs; A's unparseable ts is skipped, NOT UNKNOWN-for-the-whole-ticket
      const active = computeActiveIds([focus, ut], true, NOW);
      expect(active.has("ut")).toBe(false); // parseable OPC (7h) > cap ⇒ dark
    });
  });

  describe("AC sanity: the cap value and the OPC contract", () => {
    it("the 7h fixture is genuinely beyond the 6h cap (the EXCLUDED verdicts above are not constants)", () => {
      expect(H7 * MIN).toBeGreaterThan(INFLIGHT_LANE_CAP_MS);
      expect(CAP_MIN).toBe(6 * 60);
    });

    it("a punched-OUT agent's recent ts NEVER contributes to the OPC (closedAt-aware individuation)", () => {
      // The AC-1 shape: open executor 7h + a recently-closed (now−10min) other
      // agent. The closed agent's ts is RECENT but it is punched-OUT, so the
      // OPC is the 7h-old open punch-in — not the 10min-old closed row.
      const ut = buildTicket(
        inProgressTask("ut"),
        [
          line("executor", H7, { agentId: "ag-ex-dead" }),
          line("plan-review", 10, {
            agentId: "ag-pr-closed",
            closedAt: closedAt(10),
          }),
        ],
        NOW - 10 * MIN,
        SID,
        NOW - 10 * MIN
      );
      expect(openPunchInClock(ut)).toBe(NOW - H7 * MIN);
      expect(openPunchInClock(ut)).not.toBe(NOW - 10 * MIN);
    });
  });
});