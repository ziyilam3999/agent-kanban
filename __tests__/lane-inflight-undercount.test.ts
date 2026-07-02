// lane-inflight-undercount.test.ts — #1403: lane liveness must survive long
// silent executor legs. A NON-focus in_progress chain whose ledger shows a job
// punched IN but not punched OUT (planner + plan-review PASS, no completed
// execution-review) goes dark 8 minutes after its last role boundary, even while
// its executor is genuinely running — the 5th recurrence of the mtime-only
// liveness class (#1082, #1121, #1305, #1317/#1350). The fix adds a chain-state
// disjunct to computeActiveIds, bounded by INFLIGHT_LANE_CAP_MS.
//
// Pure number-fed (buildTicket + synthetic RawLedgerLine[] — no fs, no network),
// same discipline as lane-mtime-undercount.test.ts. All fixture data synthetic.

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
} from "@/lib/active";

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

/** Synthetic ledger line, ts offset minutes before NOW. */
function line(role: string, minsAgo: number, verdict?: string): RawLedgerLine {
  const l: RawLedgerLine = {
    role,
    ts: new Date(NOW - minsAgo * MIN).toISOString(),
  };
  if (verdict !== undefined) l.verdict = verdict;
  return l;
}

/** Mid-chain ledger state during a silent executor leg: punched IN, not OUT. */
function inFlightComments(): RawLedgerLine[] {
  return [line("planner", 130), line("plan-review", 125, "PASS")];
}

/** A fresh chain-less focus ticket so the ticket under test is NON-focus. */
function focusTicket() {
  return buildTicket(inProgressTask("focus"), [], NOW - 1 * MIN, SID);
}

describe("#1403 — chain-state lane liveness (in-flight chains survive silent legs)", () => {
  it("AC-1: NON-focus in-flight chain, updatedAt 2h stale → ACTIVE (RED on master)", () => {
    const focus = focusTicket();
    // Chain punched IN (planner + plan-review PASS, no execution-review); its
    // last observable event (ledger mtime) was 120 min ago — a long silent
    // executor leg, far outside the 8-min recency window.
    const underTest = buildTicket(
      inProgressTask("ut"),
      inFlightComments(),
      NOW - 120 * MIN,
      SID,
      NOW - 120 * MIN
    );
    const active = computeActiveIds([focus, underTest], true, NOW);
    expect(active.has("ut")).toBe(true);
    expect(active.size).toBe(2);
  });

  it("AC-2: dead-lane cap — same in-flight fixture at NOW − 7h (> cap) → NOT active", () => {
    const focus = focusTicket();
    const underTest = buildTicket(
      inProgressTask("ut"),
      inFlightComments(),
      NOW - 7 * 60 * MIN,
      SID,
      NOW - 7 * 60 * MIN
    );
    expect(7 * 60 * MIN).toBeGreaterThan(INFLIGHT_LANE_CAP_MS);
    const active = computeActiveIds([focus, underTest], true, NOW);
    expect(active.has("ut")).toBe(false);
  });

  it("AC-3: the cap is a HONORED parameter — inflightCapMs = 1h turns the 2h fixture dark", () => {
    const focus = focusTicket();
    const underTest = buildTicket(
      inProgressTask("ut"),
      inFlightComments(),
      NOW - 120 * MIN,
      SID,
      NOW - 120 * MIN
    );
    // Default cap (6h) → active (proven by AC-1); injected 1h cap → NOT active.
    const active = computeActiveIds(
      [focus, underTest],
      true,
      NOW,
      ACTIVE_WINDOW_MS,
      60 * MIN
    );
    expect(active.has("ut")).toBe(false);
  });

  describe("AC-4: verdict + shape semantics of chainInFlight", () => {
    it("(a) ZERO pipeline-role comments + 2h stale → NOT active (and not in-flight)", () => {
      const focus = focusTicket();
      const underTest = buildTicket(
        inProgressTask("ut"),
        [],
        NOW - 120 * MIN,
        SID,
        NOW - 120 * MIN
      );
      expect(chainInFlight(underTest)).toBe(false);
      const active = computeActiveIds([focus, underTest], true, NOW);
      expect(active.has("ut")).toBe(false);
    });

    it("(b) newest execution-review verdict PASS + 2h stale → chain complete → NOT active", () => {
      const focus = focusTicket();
      const underTest = buildTicket(
        inProgressTask("ut"),
        [
          ...inFlightComments(),
          line("executor", 122),
          line("execution-review", 121, "PASS"),
        ],
        NOW - 120 * MIN,
        SID,
        NOW - 120 * MIN
      );
      expect(chainInFlight(underTest)).toBe(false);
      const active = computeActiveIds([focus, underTest], true, NOW);
      expect(active.has("ut")).toBe(false);
    });

    it("(b') POSITIVE: newest execution-review verdict FAIL + 2h stale → STILL IN-FLIGHT → ACTIVE", () => {
      // Fail-class stays in-flight: the rework respawn writes no new JSONL
      // line, so treating FAIL as complete would darken every rework leg.
      const failChain = (staleMin: number) =>
        buildTicket(
          inProgressTask("ut"),
          [
            ...inFlightComments(),
            line("executor", 122),
            line("execution-review", 121, "FAIL"),
          ],
          NOW - staleMin * MIN,
          SID,
          NOW - staleMin * MIN
        );

      const focus = focusTicket();
      const at2h = failChain(120);
      expect(chainInFlight(at2h)).toBe(true);
      expect(computeActiveIds([focus, at2h], true, NOW).has("ut")).toBe(true);

      // …and the SAME fail fixture at NOW − 7h is still bounded by the cap (AC-2).
      const at7h = failChain(7 * 60);
      expect(chainInFlight(at7h)).toBe(true);
      expect(computeActiveIds([focus, at7h], true, NOW).has("ut")).toBe(false);
    });

    it("(c) orchestrator-only comments do NOT count as in-flight", () => {
      const focus = focusTicket();
      const underTest = buildTicket(
        inProgressTask("ut"),
        [line("orchestrator", 130)],
        NOW - 120 * MIN,
        SID,
        NOW - 120 * MIN
      );
      expect(chainInFlight(underTest)).toBe(false);
      const active = computeActiveIds([focus, underTest], true, NOW);
      expect(active.has("ut")).toBe(false);
    });

    it("(d) a NaN-ts execution-review line neither crashes nor breaks the documented ordering", () => {
      // A malformed ts sorts stably in place (build-board's comparator yields
      // NaN → treated as no-swap), so the appended NaN-ts review stays last and
      // IS the newest. PASS on it → chain complete → NOT active; no throw.
      const focus = focusTicket();
      const nanLine: RawLedgerLine = {
        role: "execution-review",
        ts: "not-a-timestamp",
        verdict: "PASS",
      };
      const underTest = buildTicket(
        inProgressTask("ut"),
        [...inFlightComments(), line("executor", 122), nanLine],
        NOW - 120 * MIN,
        SID,
        NOW - 120 * MIN
      );
      expect(() => chainInFlight(underTest)).not.toThrow();
      expect(chainInFlight(underTest)).toBe(false);
      const active = computeActiveIds([focus, underTest], true, NOW);
      expect(active.has("ut")).toBe(false);
    });
  });

  describe("AC-5: focus conditioning + rider pins (B2)", () => {
    /** Chain-less rider touched `minsAgo` — the fold-in-ticket pattern. */
    const rider = (minsAgo: number) =>
      buildTicket(inProgressTask("rider"), [], NOW - minsAgo * MIN, SID);
    /** The genuinely-working in-flight chain, silent for 2h. */
    const chain = () =>
      buildTicket(
        inProgressTask("chain"),
        inFlightComments(),
        NOW - 120 * MIN,
        SID,
        NOW - 120 * MIN
      );

    it("(a) FRESH rider (2min, max updatedAt, chain-less) + in-flight chain → BOTH active (size 2)", () => {
      // The rider is lit via the WINDOW (the accepted 8-min transient), the
      // chain via the in-flight disjunct — not via an unconditional focus grant.
      const active = computeActiveIds([rider(2), chain()], true, NOW);
      expect(active.has("rider")).toBe(true);
      expect(active.has("chain")).toBe(true);
      expect(active.size).toBe(2);
    });

    it("(b) STALE rider (10min, outside window, STILL max updatedAt) + in-flight chain → ONLY the chain (size 1)", () => {
      // Pins the hours-long focus overcount dead: chain-state evidence exists,
      // the rider is not in-flight → it gets NO unconditional focus grant.
      const active = computeActiveIds([rider(10), chain()], true, NOW);
      expect(active.has("chain")).toBe(true);
      expect(active.has("rider")).toBe(false);
      expect(active.size).toBe(1);
    });

    it("(c) window pin: a chain-less NON-focus ticket touched 2min ago is ACTIVE (documented transient)", () => {
      // Recency is load-bearing for inline (non-3-role) work — it has no ledger
      // comments, so the 8-min window is its only liveness signal.
      const focus = focusTicket(); // chain-less, 1 min → max updatedAt
      const touched = buildTicket(inProgressTask("ut"), [], NOW - 2 * MIN, SID);
      const active = computeActiveIds([focus, touched], true, NOW);
      expect(active.has("ut")).toBe(true);
    });

    it("(d) all-chain-less population: focus behaves exactly as today (unconditional grant)", () => {
      // Condition (b) of the focus rule: NO in_progress ticket is chainInFlight
      // → the max-updatedAt ticket breathes past the window, exactly pre-#1403.
      const focus = buildTicket(inProgressTask("focus"), [], NOW - 12 * MIN, SID);
      const older = buildTicket(inProgressTask("old"), [], NOW - 52 * MIN, SID);
      const active = computeActiveIds([focus, older], true, NOW);
      expect(active.has("focus")).toBe(true);
      expect(active.has("old")).toBe(false);
      expect(active.size).toBe(1);
    });
  });
});
