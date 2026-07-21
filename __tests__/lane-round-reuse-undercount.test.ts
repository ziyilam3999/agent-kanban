// lane-round-reuse-undercount.test.ts — #1791: chainInFlight latches onto a
// STALE execution-review comment left over from an earlier, semantically
// different round on the SAME ticket id (e.g. a "ship-review proof" that
// gated merging a PLAN's PR), and reports a chain COMPLETE even while a
// brand-new planner -> plan-review -> executor round is genuinely running.
//
// Live incident (2026-07-21): ticket #1746 was reused across two purposes in
// one session — first a ship-review-proof execution-review PASS gated
// merging the PLAN's PR, then a real 3-role round started for the actual
// build. chainInFlight() picks "newest execution-review" as the LAST
// execution-review comment in array order; since no NEW execution-review had
// landed yet, it still pointed at the OLD PASS row, so the chain read as
// COMPLETE the entire time the real executor was running — the ticket fell
// out of all three computeActiveIds disjuncts once past the 8-min window,
// reproducing "1 LANE LIVE" on the board while a genuine second lane ran.
//
// Fix: chain-complete requires BOTH (a) the newest execution-review verdict
// is non-fail AND (b) no pipeline-role comment occurred AFTER that review —
// a pipeline comment after the last review means a new round has started,
// so the chain re-enters in-flight regardless of the earlier round's verdict.
//
// Pure number-fed (buildTicket + synthetic RawLedgerLine[]), same discipline
// as lane-inflight-undercount.test.ts. All fixture data synthetic.

import {
  buildTicket,
  type RawLedgerLine,
  type RawTask,
} from "@/lib/build-board";
import { chainInFlight, computeActiveIds } from "@/lib/active";

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

function line(role: string, minsAgo: number, verdict?: string): RawLedgerLine {
  const l: RawLedgerLine = {
    role,
    ts: new Date(NOW - minsAgo * MIN).toISOString(),
  };
  if (verdict !== undefined) l.verdict = verdict;
  return l;
}

function focusTicket() {
  return buildTicket(inProgressTask("focus"), [], NOW - 1 * MIN, SID);
}

describe("#1791 — chainInFlight must not treat an EARLIER round's resolved review as covering a NEW round", () => {
  it("AC-1: old PASS execution-review + a fresh planner/plan-review/executor round after it → STILL in-flight (RED on master)", () => {
    const focus = focusTicket();
    const underTest = buildTicket(
      inProgressTask("ut"),
      [
        // Round 1 (an earlier, unrelated purpose — e.g. a ship-review proof):
        // resolves clean.
        line("execution-review", 200, "PASS"),
        // Round 2: a brand-new chain starts on the SAME ticket id. No new
        // execution-review has landed yet — the executor is genuinely
        // mid-flight, last touched 15 min ago (stale relative to the 8-min
        // window, so only the chain-state disjunct can rescue it).
        line("planner", 20),
        line("plan-review", 18, "PASS"),
        line("executor", 15),
      ],
      NOW - 15 * MIN,
      SID,
      NOW - 15 * MIN
    );
    expect(chainInFlight(underTest)).toBe(true);
    const active = computeActiveIds([focus, underTest], true, NOW);
    expect(active.has("ut")).toBe(true);
  });

  it("AC-2: old PASS execution-review with NOTHING after it → still chain-complete (unchanged behavior)", () => {
    const focus = focusTicket();
    const underTest = buildTicket(
      inProgressTask("ut"),
      [line("planner", 205), line("plan-review", 202, "PASS"), line("executor", 201), line("execution-review", 200, "PASS")],
      NOW - 200 * MIN,
      SID,
      NOW - 200 * MIN
    );
    expect(chainInFlight(underTest)).toBe(false);
    const active = computeActiveIds([focus, underTest], true, NOW);
    expect(active.has("ut")).toBe(false);
  });

  it("AC-3: old FAIL execution-review + a fresh round after it → in-flight for BOTH reasons (fail-class AND new-round)", () => {
    const focus = focusTicket();
    const underTest = buildTicket(
      inProgressTask("ut"),
      [
        line("execution-review", 200, "FAIL"),
        line("planner", 20),
        line("executor", 15),
      ],
      NOW - 15 * MIN,
      SID,
      NOW - 15 * MIN
    );
    expect(chainInFlight(underTest)).toBe(true);
  });
});
