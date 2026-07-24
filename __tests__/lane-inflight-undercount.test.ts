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
//
// #1852 r3 — AC-1 REWRITE (mandatory reconciliation, plan-review r1's
// "reconciliation the executor MUST handle"). The ORIGINAL AC-1 below asserted
// "an in-flight chain 2h stale -> ACTIVE" using an agentId-less fixture — that
// assertion IS the #1852 false positive baked in as a passing test (chainInFlight's
// pre-#1852 pipeline branch has no punch-out/running-agent input at all, so ANY
// incomplete-by-state chain reads in-flight forever, bounded only by the 6h cap).
// It is RED on origin/master under the NEW mechanism-(b) semantics: a genuinely
// dead chain (every pipeline-role agent punched OUT via `closedAt`, per r3 AC-9's
// per-agentId rule) must now read DARK even mid-cap. The rewritten AC-1 below
// makes that the discriminator, with a delete-the-input oracle proving the
// verdict turns on the punch-out signal, not on elapsed time. Every OTHER test
// in this file uses agentId-LESS fixtures (the pre-#1852 idiom) — under the new
// mechanism these are back-compat "always open" units (see pipelineHasOpenPunchIn
// in lib/active.ts), so they are UNCHANGED and continue to exercise the cap /
// focus-conditioning behavior this file already proved, byte-identically.

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

/**
 * Synthetic ledger line, ts offset minutes before NOW. The 3rd arg accepts
 * either a bare verdict string (the original idiom — no agentId/closedAt,
 * back-compat "always open" per pipelineHasOpenPunchIn) OR (#1852 r3) a
 * partial-fields object so a fixture can set agentId / closedAt explicitly.
 */
function line(
  role: string,
  minsAgo: number,
  verdictOrFields?: string | Partial<RawLedgerLine>
): RawLedgerLine {
  const l: RawLedgerLine = {
    role,
    ts: new Date(NOW - minsAgo * MIN).toISOString(),
  };
  if (typeof verdictOrFields === "string") {
    l.verdict = verdictOrFields;
  } else if (verdictOrFields) {
    Object.assign(l, verdictOrFields);
  }
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
  it("AC-1 (#1852 r3 REWRITE): NON-focus in-flight-by-state chain, 2h stale, ALL pipeline agents punched-OUT (closedAt) → NOT active (RED on origin/master)", () => {
    // RED-on-baseline: on origin/master (pre-#1852), chainInFlight's pipeline
    // branch ignores closedAt entirely, so this SAME fixture reads ACTIVE —
    // this assertion genuinely fails there (verified by hand: `git stash` to
    // pre-#1852 lib/active.ts + re-run this suite -> this exact expectation
    // flips). It passes ONLY once the pipeline branch consumes the per-agentId
    // punch-out signal (mechanism (b), AC-9's per-agentId rule).
    const focus = focusTicket();
    const CLOSED_TS = new Date(NOW - 125 * MIN).toISOString();
    const underTest = buildTicket(
      inProgressTask("ut"),
      [
        line("planner", 130, { agentId: "ag-planner-1", closedAt: CLOSED_TS }),
        line("plan-review", 125, {
          agentId: "ag-review-1",
          verdict: "PASS",
          closedAt: CLOSED_TS,
        }),
      ],
      NOW - 120 * MIN,
      SID,
      NOW - 120 * MIN
    );
    expect(chainInFlight(underTest)).toBe(false);
    const active = computeActiveIds([focus, underTest], true, NOW);
    expect(active.has("ut")).toBe(false);
    expect(active.size).toBe(1); // only the chain-less focus ticket breathes
  });

  it("AC-1 power-proof #2 (delete-the-input oracle): SAME fixture, clear ONE role's closedAt (open punch-in) → flips back ACTIVE", () => {
    // Proves the AC-1 verdict turns on the punch-out signal, not on a constant
    // or on staleness: identical ticket, identical 120-min age, only the
    // planner row's closedAt is removed (that agent is still punched-IN).
    const focus = focusTicket();
    const CLOSED_TS = new Date(NOW - 125 * MIN).toISOString();
    const underTest = buildTicket(
      inProgressTask("ut"),
      [
        line("planner", 130, { agentId: "ag-planner-1" }), // OPEN — no closedAt
        line("plan-review", 125, {
          agentId: "ag-review-1",
          verdict: "PASS",
          closedAt: CLOSED_TS,
        }),
      ],
      NOW - 120 * MIN,
      SID,
      NOW - 120 * MIN
    );
    expect(chainInFlight(underTest)).toBe(true);
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
