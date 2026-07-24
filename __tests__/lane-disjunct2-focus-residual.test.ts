// lane-disjunct2-focus-residual.test.ts — #1852 plan AC-8 (r3 CORE, the r2
// BLOCKING finding): once chainInFlight becomes punch-out-aware (mechanism
// (b)), a dead all-punched-out chain has chainInFlight === false, exactly
// like a genuine chain-less rider — so `inFlightIds` can go empty even
// though a real 3-role chain existed and died. Without narrowing, disjunct-2
// (FOCUS)'s `inFlightIds.size === 0` unconditional grant would then light
// that dead chain whenever it happens to be the max-updatedAt in_progress
// ticket — shifting the #1852 false positive from disjunct-1 to disjunct-2
// (the measured "5 LANES LIVE, zero running" would become "1 LANE LIVE, zero
// running" — still a lie, and still enough to fool the sole-lane
// parallelization gate that keys on count==1).
//
// DECOY-FREE BY DESIGN (plan-review r2 + r3's explicit instruction): every
// OTHER liveness suite uses a fresh chain-less `focusTicket()` helper so the
// ticket-under-test is deliberately NON-focus (isolating disjunct-1). That
// decoy is exactly what HIDES this residual — it prevents disjunct-2 from
// ever firing on the ticket-under-test. This file NEVER uses that decoy: the
// dead chain under test IS the SOLE in_progress ticket and therefore IS the
// max-updatedAt focus in every fixture below. (Non-blocking note N2: this is
// explicitly the SOLE-FOCUS case, not a decoy case — stated here so a future
// reader cannot mistake it for the usual isolate-disjunct-1 idiom.)

import {
  buildTicket,
  type RawLedgerLine,
  type RawTask,
} from "@/lib/build-board";
import { computeActiveIds } from "@/lib/active";

const NOW = 1_700_000_000_000;
const MIN = 60_000;
const SID = "sess1852ac8";

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

describe("#1852 AC-8 — disjunct-2 FOCUS fallback must NOT resurrect a dead punched-out chain (decoy-free, sole focus)", () => {
  it("a SOLE all-punched-out dead chain, session live, no other in-flight chain, no decoy -> DARK / live-count 0", () => {
    // The ONLY in_progress ticket -> unconditionally the max-updatedAt FOCUS.
    // Every pipeline agent (planner, plan-review) is punched-OUT via
    // closedAt; no execution-review exists, so the chain is
    // incomplete-by-state but has no open punch-in -> a genuinely dead chain.
    const deadChain = buildTicket(
      inProgressTask("dead"),
      [
        line("planner", 130, {
          agentId: "ag-ac8-planner",
          closedAt: new Date(NOW - 130 * MIN).toISOString(),
        }),
        line("plan-review", 125, {
          agentId: "ag-ac8-review",
          verdict: "PASS",
          closedAt: new Date(NOW - 125 * MIN).toISOString(),
        }),
      ],
      NOW - 120 * MIN,
      SID,
      NOW - 120 * MIN
    );
    const active = computeActiveIds([deadChain], true, NOW);
    expect(active.has("dead")).toBe(false);
    expect(active.size).toBe(0);
  });

  it("delete-the-input oracle (i): the SAME sole-focus chain with a fresh OPEN punch-in -> flips back LIVE (a genuinely-running focus must still breathe)", () => {
    const runningChain = buildTicket(
      inProgressTask("running"),
      [
        line("planner", 130, {
          agentId: "ag-ac8-planner2",
          closedAt: new Date(NOW - 130 * MIN).toISOString(),
        }),
        line("plan-review", 125, { agentId: "ag-ac8-review2" }), // OPEN — no closedAt
      ],
      NOW - 120 * MIN,
      SID,
      NOW - 120 * MIN
    );
    const active = computeActiveIds([runningChain], true, NOW);
    expect(active.has("running")).toBe(true);
    expect(active.size).toBe(1);
  });

  it("delete-the-input oracle (ii): swap the dead chain for a genuine CHAIN-LESS rider at the same staleness -> LIVE (the legitimate #1403 focus intent is preserved)", () => {
    const chainLessRider = buildTicket(
      inProgressTask("rider"),
      [], // NO pipeline-role comments at all
      NOW - 120 * MIN,
      SID
    );
    const active = computeActiveIds([chainLessRider], true, NOW);
    expect(active.has("rider")).toBe(true);
    expect(active.size).toBe(1);
  });

});

// AC-8 power-proof (red against a disjunct-1-only PARTIAL fix): verified by
// hand, not encoded as a competing code path in this file (that would just be
// dead code duplicating lib/active.ts). With `chainInFlight` made punch-out
// aware but disjunct-2's clause left as the UN-narrowed
// `inFlightIds.size === 0 || inFlightIds.has(focus.id)` (i.e. temporarily
// reverting ONLY the `&& !hasAnyPipelineComment(focus)` conjunct added in
// lib/active.ts), the FIRST test above ("a SOLE all-punched-out dead chain
// ... -> DARK / live-count 0") flips from PASS to FAIL — `inFlightIds` for
// the sole dead ticket is empty (chainInFlight(dead) === false, exactly
// mechanism (b)'s effect), so the un-narrowed left arm fires unconditionally
// and lights it. Captured in the PR verification notes: disjunct-1-only RED,
// full fix (this file, as shipped) GREEN.

