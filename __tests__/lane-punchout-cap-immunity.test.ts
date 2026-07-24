// lane-punchout-cap-immunity.test.ts — #1852 plan AC-5 (Defect A, r1/r2-carried,
// REWRITTEN airtight anti-cosmetic-constant proof).
//
// r1's original AC-5 pinned its discriminating fixture at 1h stale and claimed
// it "fails any fix that merely lowers INFLIGHT_LANE_CAP_MS" — that claim was
// FALSE: a cosmetic shrink to any value in (8min, 1h) (e.g. 6h -> 30min) makes
// the 1h fixture dark too, so it PASSES AC-5 while remaining pure
// timestamp-window-as-liveness (the exact non-fix AC-5 exists to block). The
// r2 fix (kept here, unchanged since r2) moves the discriminator to a SINGLE
// FIXED staleness (~9-10 min — just past ACTIVE_WINDOW_MS=8min, so disjunct-3
// recency cannot rescue it): a DELETE-THE-INPUT FLIP at that one staleness.
//
//   (i)  an in-flight chain with an OPEN pipeline-role punch-in       -> LIVE
//   (ii) the SAME chain with that row close-stamped (closedAt present) -> DARK
//
// Why this is airtight independent of the exact cap value: a cosmetic
// cap-shrink ignores closedAt entirely, so chainInFlight returns the SAME
// value for (i) and (ii) at the one fixed staleness — it can NEVER reproduce
// the (i)!=(ii) flip, so it fails this test regardless of what it shrinks the
// cap to. Only a closedAt-CONSUMING fix (mechanism (b)) makes (i) != (ii).
// Fixture placement mirrors the proven research-inflight-lane.test.ts AC-7b(b)
// idiom (`expect(10 * MIN).toBeGreaterThan(ACTIVE_WINDOW_MS)`).
//
// Uses a chain-less focusTicket() decoy (same idiom as
// lane-inflight-undercount.test.ts) — AC-5 is isolating disjunct-1's
// cap-immunity, not the disjunct-2 focus residual (that is AC-8's job, in its
// own decoy-FREE file).

import {
  buildTicket,
  type RawLedgerLine,
  type RawTask,
} from "@/lib/build-board";
import { ACTIVE_WINDOW_MS, chainInFlight, computeActiveIds } from "@/lib/active";

const NOW = 1_700_000_000_000;
const MIN = 60_000;
const SID = "sess1852ac5";
const STALE_MIN = 9; // just past the 8-min ACTIVE_WINDOW_MS; comfortably short of any plausible cap

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

/** A fresh chain-less focus ticket so the ticket under test is NON-focus. */
function focusTicket() {
  return buildTicket(inProgressTask("focus"), [], NOW - 1 * MIN, SID);
}

describe("#1852 AC-5 — anti-cosmetic-cap airtight flip (a cap-shrink can never pass this)", () => {
  it("sanity: the fixture staleness is past ACTIVE_WINDOW_MS (disjunct-3 cannot rescue it)", () => {
    expect(STALE_MIN * MIN).toBeGreaterThan(ACTIVE_WINDOW_MS);
  });

  it("(i) OPEN pipeline-role punch-in at ~9min stale -> LIVE", () => {
    const focus = focusTicket();
    const underTest = buildTicket(
      inProgressTask("open"),
      [line("planner", STALE_MIN, { agentId: "ag-ac5-1" })], // no closedAt -> OPEN
      NOW - STALE_MIN * MIN,
      SID,
      NOW - STALE_MIN * MIN
    );
    expect(chainInFlight(underTest)).toBe(true);
    const active = computeActiveIds([focus, underTest], true, NOW);
    expect(active.has("open")).toBe(true);
  });

  it("(ii) SAME chain, SAME staleness, role close-stamped -> DARK (the flip)", () => {
    const focus = focusTicket();
    const closedTs = new Date(NOW - STALE_MIN * MIN).toISOString();
    const underTest = buildTicket(
      inProgressTask("closed"),
      [line("planner", STALE_MIN, { agentId: "ag-ac5-1", closedAt: closedTs })],
      NOW - STALE_MIN * MIN,
      SID,
      NOW - STALE_MIN * MIN
    );
    expect(chainInFlight(underTest)).toBe(false);
    const active = computeActiveIds([focus, underTest], true, NOW);
    expect(active.has("closed")).toBe(false);
  });

  it("the flip itself: (i) and (ii) diverge at the IDENTICAL staleness — a cosmetic cap-shrink cannot reproduce this", () => {
    // A cap-shrink implementation ignores closedAt, so chainInFlight() returns
    // the SAME boolean for both cases -> active-set membership would be
    // identical for (i) and (ii). This assertion is what makes AC-5 airtight:
    // it does not depend on the exact cap value, only on the (i) != (ii) flip.
    const focus = focusTicket();
    const openTicket = buildTicket(
      inProgressTask("flip-open"),
      [line("planner", STALE_MIN, { agentId: "ag-ac5-flip" })],
      NOW - STALE_MIN * MIN,
      SID,
      NOW - STALE_MIN * MIN
    );
    const closedTicket = buildTicket(
      inProgressTask("flip-closed"),
      [
        line("planner", STALE_MIN, {
          agentId: "ag-ac5-flip",
          closedAt: new Date(NOW - STALE_MIN * MIN).toISOString(),
        }),
      ],
      NOW - STALE_MIN * MIN,
      SID,
      NOW - STALE_MIN * MIN
    );
    const activeOpen = computeActiveIds([focus, openTicket], true, NOW);
    const activeClosed = computeActiveIds([focus, closedTicket], true, NOW);
    expect(activeOpen.has("flip-open")).toBe(true);
    expect(activeClosed.has("flip-closed")).toBe(false);
    expect(activeOpen.has("flip-open")).not.toBe(activeClosed.has("flip-closed"));
  });
});
