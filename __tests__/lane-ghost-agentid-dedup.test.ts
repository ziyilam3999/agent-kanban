// lane-ghost-agentid-dedup.test.ts — #1852 plan AC-9 (r3 CORE): the MEASURED
// #1682 ghost — one pipeline-role agentId carrying an OPEN row (no closedAt)
// AND a LATER CLOSED row (closedAt present) for the SAME agentId. Round-2's
// row-level predicate ("a pipeline row with no closedAt = punched in") finds
// the open row and reads that agent as punched-in FOREVER — a ghost zombie
// lane. The fix (`pipelineHasOpenPunchIn` in lib/active.ts) dedupes PER
// AGENTID: ANY closedAt row for an agentId marks it punched-OUT, regardless
// of how many open-looking rows exist for the same id.
//
// Non-blocking note N3 (plan-review r3): state explicitly whether the ghost
// fixture is a DECOY (isolates the per-agentId predicate via disjunct-1 only,
// using a chain-less focusTicket() so the ghost ticket is non-focus) or the
// SOLE FOCUS (couples to AC-8's disjunct-2 narrowing too). Both are included
// below, each labeled — #1682 is closed by #1852 either way since both AC-8
// and AC-9 ship together, but only the decoy form isolates AC-9 in
// isolation from AC-8.

import {
  buildTicket,
  type RawLedgerLine,
  type RawTask,
} from "@/lib/build-board";
import { chainInFlight, computeActiveIds } from "@/lib/active";

const NOW = 1_700_000_000_000;
const MIN = 60_000;
const SID = "sess1852ac9";
// Mirrors the measured #1682 shape: open row ts 11:06, closed row ts 11:18 —
// same agentId, ~12 minutes apart.
const GHOST_AGENT_ID = "af085741-ghost";

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

/** A fresh chain-less focus ticket — used ONLY in the DECOY-form fixtures
 *  below, so the ghost ticket under test is deliberately NON-focus and the
 *  assertion isolates disjunct-1 (the per-agentId predicate) from AC-8's
 *  disjunct-2 narrowing. */
function focusTicket() {
  return buildTicket(inProgressTask("focus"), [], NOW - 1 * MIN, SID);
}

describe("#1852 AC-9 — per-agentId punch-out dedup (closes the measured #1682 ghost)", () => {
  describe("DECOY form (N3): a chain-less focusTicket() keeps the ghost ticket NON-focus — isolates the per-agentId predicate via disjunct-1 only", () => {
    it("one agentId, open row (11:06) THEN closed row (11:18) -> that agent reads punched-OUT -> ticket DARK / not counted", () => {
      const focus = focusTicket();
      const ghostTicket = buildTicket(
        inProgressTask("ghost"),
        [
          line("planner", 130, { agentId: GHOST_AGENT_ID }), // open row (11:06-equivalent)
          line("planner", 118, {
            agentId: GHOST_AGENT_ID,
            closedAt: new Date(NOW - 118 * MIN).toISOString(),
          }), // later closed row (11:18-equivalent), SAME agentId
        ],
        NOW - 118 * MIN,
        SID,
        NOW - 118 * MIN
      );
      expect(chainInFlight(ghostTicket)).toBe(false);
      const active = computeActiveIds([focus, ghostTicket], true, NOW);
      expect(active.has("ghost")).toBe(false);
    });

    it("power proof — RED against a ROW-LEVEL predicate: the identical fixture's OPEN row alone (r2 shape) would read LIVE", () => {
      // This does not re-implement the row-level predicate as a competing
      // code path (dead code); it isolates the discriminating half of the
      // fixture — the SAME open row in ISOLATION (no closed row yet) DOES
      // read live, proving the difference is entirely the later closed row
      // for the SAME agentId, not some other property of the fixture.
      const focus = focusTicket();
      const openRowOnly = buildTicket(
        inProgressTask("ghost-open-only"),
        [line("planner", 130, { agentId: GHOST_AGENT_ID })],
        NOW - 130 * MIN,
        SID,
        NOW - 130 * MIN
      );
      expect(chainInFlight(openRowOnly)).toBe(true);
      const active = computeActiveIds([focus, openRowOnly], true, NOW);
      expect(active.has("ghost-open-only")).toBe(true);
    });

    it("delete-the-input oracle: removing the closed row (leaving only the open row) flips the ghost back LIVE", () => {
      const focus = focusTicket();
      const openOnly = buildTicket(
        inProgressTask("ghost"),
        [line("planner", 130, { agentId: GHOST_AGENT_ID })], // no closed row at all
        NOW - 130 * MIN,
        SID,
        NOW - 130 * MIN
      );
      expect(chainInFlight(openOnly)).toBe(true);
      const active = computeActiveIds([focus, openOnly], true, NOW);
      expect(active.has("ghost")).toBe(true);
    });
  });

  describe("SOLE-FOCUS form (N3): the ghost IS the only in_progress ticket (couples to AC-8's disjunct-2 narrowing) — #1682 is still closed", () => {
    it("the ghost as sole focus, open-then-closed same agentId, no other chain -> DARK / live-count 0", () => {
      const ghostTicket = buildTicket(
        inProgressTask("ghost-focus"),
        [
          line("planner", 130, { agentId: GHOST_AGENT_ID }),
          line("planner", 118, {
            agentId: GHOST_AGENT_ID,
            closedAt: new Date(NOW - 118 * MIN).toISOString(),
          }),
        ],
        NOW - 118 * MIN,
        SID,
        NOW - 118 * MIN
      );
      const active = computeActiveIds([ghostTicket], true, NOW);
      expect(active.has("ghost-focus")).toBe(false);
      expect(active.size).toBe(0);
    });
  });

  it("monotonicity (#1590): a THIRD row for the ghost agentId, open-looking but chronologically BEFORE the closedAt row, still cannot un-punch it", () => {
    // Any closedAt row for the agentId is terminal — order of rows in the
    // array does not matter, only whether ANY row for that agentId carries
    // closedAt. This guards against an accidental "last row wins" reading.
    const focus = focusTicket();
    const ticket = buildTicket(
      inProgressTask("ghost3"),
      [
        line("planner", 130, {
          agentId: GHOST_AGENT_ID,
          closedAt: new Date(NOW - 118 * MIN).toISOString(),
        }), // closed row appended FIRST in the array
        line("planner", 100, { agentId: GHOST_AGENT_ID }), // an open-looking row for the SAME id, chronologically newer ts, but no closedAt
      ],
      NOW - 100 * MIN,
      SID,
      NOW - 100 * MIN
    );
    expect(chainInFlight(ticket)).toBe(false);
    const active = computeActiveIds([focus, ticket], true, NOW);
    expect(active.has("ghost3")).toBe(false);
  });

  it("a genuine REOPEN mints a FRESH agentId, unaffected by the old agentId's closedAt (not a false-negative)", () => {
    const focus = focusTicket();
    const ticket = buildTicket(
      inProgressTask("reopened"),
      [
        line("planner", 130, {
          agentId: GHOST_AGENT_ID,
          closedAt: new Date(NOW - 128 * MIN).toISOString(),
        }), // the old agent, closed
        line("plan-review", 5, { agentId: "fresh-reopen-agent" }), // a NEW role/agent, genuinely open
      ],
      NOW - 5 * MIN,
      SID,
      NOW - 5 * MIN
    );
    expect(chainInFlight(ticket)).toBe(true);
    const active = computeActiveIds([focus, ticket], true, NOW);
    expect(active.has("reopened")).toBe(true);
  });
});
