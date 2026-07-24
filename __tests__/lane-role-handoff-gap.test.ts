// lane-role-handoff-gap.test.ts — #1852 plan AC-7 (Defect C, r2-carried,
// unchanged in r3): the between-roles GAP. A chain whose most-recent
// pipeline role is punched-OUT (closedAt present) with NO newer open
// punch-in must read DARK / not counted — even though chainInFlight's older
// "completeness" latch (no PASS review yet) is still TRUE. This is CORRECT:
// no agent is genuinely working the ticket between one role's punch-out and
// the next role's punch-in. It self-heals the INSTANT the next role's open
// punch-in lands, and — the load-bearing negative — NO grace window re-lights
// a punched-out chain purely from elapsed time (a grace window would just be
// a small version of the pre-#1852 6h-window bug).
//
// Fixture idiom matches lane-inflight-undercount.test.ts / lane-punchout-cap-
// immunity.test.ts: buildTicket + synthetic RawLedgerLine[], chain-less
// focusTicket() decoy (isolates disjunct-1; not exercising the AC-8 focus
// path, which has its own decoy-free file).

import {
  buildTicket,
  type RawLedgerLine,
  type RawTask,
} from "@/lib/build-board";
import { ACTIVE_WINDOW_MS, chainInFlight, computeActiveIds } from "@/lib/active";

const NOW = 1_700_000_000_000;
const MIN = 60_000;
const SID = "sess1852ac7";

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

function focusTicket() {
  return buildTicket(inProgressTask("focus"), [], NOW - 1 * MIN, SID);
}

describe("#1852 AC-7 — role-handoff gap: between punch-out and the next punch-in, the lane is honestly DARK", () => {
  it("(a) planner punched-OUT, no plan-review yet, no newer open punch-in -> DARK / not counted", () => {
    const focus = focusTicket();
    const underTest = buildTicket(
      inProgressTask("handoff"),
      [
        line("planner", 10, {
          agentId: "ag-handoff-1",
          closedAt: new Date(NOW - 10 * MIN).toISOString(),
        }),
      ],
      NOW - 10 * MIN,
      SID,
      NOW - 10 * MIN
    );
    // chainInFlight's completeness latch is STILL true (no execution-review
    // exists yet) — the OLD predicate would read this in-flight forever. The
    // punch-out-aware predicate must read it dark: the planner stopped
    // cleanly and no one has picked the chain up yet.
    expect(chainInFlight(underTest)).toBe(false);
    const active = computeActiveIds([focus, underTest], true, NOW);
    expect(active.has("handoff")).toBe(false);
  });

  it("(b) self-heals: the SAME chain + a fresh OPEN plan-review punch-in -> flips back LIVE", () => {
    const focus = focusTicket();
    const underTest = buildTicket(
      inProgressTask("handoff"),
      [
        line("planner", 10, {
          agentId: "ag-handoff-1",
          closedAt: new Date(NOW - 10 * MIN).toISOString(),
        }),
        line("plan-review", 1, { agentId: "ag-handoff-2" }), // next role spawned — OPEN
      ],
      NOW - 1 * MIN,
      SID,
      NOW - 1 * MIN
    );
    expect(chainInFlight(underTest)).toBe(true);
    const active = computeActiveIds([focus, underTest], true, NOW);
    expect(active.has("handoff")).toBe(true);
  });

  it("(c) NO grace window: close+2s (immediately) with no new role -> chain state is dark with ZERO time dependency", () => {
    // chainInFlight() takes no `nowMs` — proving there is no elapsed-time
    // grace window on the punch-out signal itself requires checking the
    // predicate the instant AFTER close, not waiting out any window.
    const focus = focusTicket();
    const underTest = buildTicket(
      inProgressTask("handoff"),
      [
        line("planner", 0, {
          agentId: "ag-handoff-1",
          closedAt: new Date(NOW - 2000).toISOString(), // closed 2s ago
        }),
      ],
      NOW,
      SID,
      NOW
    );
    expect(chainInFlight(underTest)).toBe(false); // no grace window — dark instantly, not "eventually"
  });

  it("(c') NO grace window in computeActiveIds either: close+10min (past ACTIVE_WINDOW_MS, so disjunct-3 recency cannot rescue it), no new role -> NOT active", () => {
    // HONEST NOTE (same idiom as research-inflight-lane.test.ts AC-7b(b)):
    // computeActiveIds has a separate, pre-existing, accepted disjunct-3
    // (WINDOW) that lights ANY in_progress ticket touched within
    // ACTIVE_WINDOW_MS (8 min) purely on recency — untouched by #1852 and
    // out of scope to change (the SAME transient a chain-less rider gets,
    // see lane-inflight-undercount.test.ts AC-5(c)). A literal "close+2min"
    // fixture would read ACTIVE via that disjunct regardless of this fix —
    // not a #1852 grace-window regression, just the pre-existing recency
    // transient every ticket type exhibits right after ANY touch. Placing
    // the fixture past that window isolates exactly what AC-7(c) needs: the
    // "not active" verdict comes from the punch-out predicate, not from a
    // grace window, and not from waiting out INFLIGHT_LANE_CAP_MS either.
    expect(10 * MIN).toBeGreaterThan(ACTIVE_WINDOW_MS);
    const focus = focusTicket();
    const underTest = buildTicket(
      inProgressTask("handoff"),
      [
        line("planner", 10, {
          agentId: "ag-handoff-1",
          closedAt: new Date(NOW - 10 * MIN).toISOString(),
        }),
      ],
      NOW - 10 * MIN,
      SID,
      NOW - 10 * MIN
    );
    expect(chainInFlight(underTest)).toBe(false);
    const active = computeActiveIds([focus, underTest], true, NOW);
    expect(active.has("handoff")).toBe(false);
  });
});
