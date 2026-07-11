// research-inflight-lane.test.ts — #1516: the research seat's spawn-time ledger row
// must be a genuine liveness signal (mid-flight visible, punched out on close), not a
// new zombie lane. Sibling to lane-inflight-undercount.test.ts — same fixture idioms
// (buildTicket + synthetic RawLedgerLine[], pure number-fed, no fs/network).
//
// Three ACs form a discriminating truth table over chainInFlight()'s new research
// branch, each killing a distinct wrong implementation (plan-review round 3 / this
// task's plan, "the trap"):
//   AC-7  (open,  within cap  -> ACTIVE)     kills a no-op (research never counted)
//   AC-7b (closed, at close+~ -> NOT ACTIVE) kills the naive PIPELINE_ROLE_SET widening
//         (which would make newestExecReview stay undefined forever for a
//         research-only ticket -> chainInFlight returns true PERMANENTLY)
//   AC-7c (open,  beyond cap  -> NOT ACTIVE) kills a new UNCAPPED disjunct
// AC-7d proves the four-role chain's own liveness verdict is byte-identical with and
// without a research row present on the same ticket (chainInFlight's research branch
// is entered ONLY when there is no pipeline-role comment at all).

import {
  buildTicket,
  type RawLedgerLine,
  type RawTask,
} from "@/lib/build-board";
import {
  ACTIVE_WINDOW_MS,
  chainInFlight,
  computeActiveIds,
} from "@/lib/active";

const NOW = 1_700_000_000_000;
const MIN = 60_000;
const SID = "sess1516";

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
function line(
  role: string,
  minsAgo: number,
  extra?: Partial<RawLedgerLine>
): RawLedgerLine {
  return {
    role,
    ts: new Date(NOW - minsAgo * MIN).toISOString(),
    ...extra,
  };
}

/** A fresh chain-less focus ticket so the ticket under test is NON-focus — same
 *  helper shape as lane-inflight-undercount.test.ts's focusTicket(). */
function focusTicket() {
  return buildTicket(inProgressTask("focus"), [], NOW - 1 * MIN, SID);
}

describe("#1516 — research-seat spawn-time row is a genuine liveness signal, not a zombie", () => {
  it("AC-7: an OPEN (un-close-stamped) research row, last event within the cap -> ACTIVE", () => {
    // Mirrors lane-inflight-undercount.test.ts's AC-1 shape: 2h stale (well outside
    // the 8-min WINDOW disjunct, so disjunct-1/in-flight is what's proven to light
    // it — not disjunct-3 recency), well within the default 6h cap.
    const focus = focusTicket();
    const underTest = buildTicket(
      inProgressTask("ut"),
      [line("research", 120)], // no closedAt -> OPEN
      NOW - 120 * MIN,
      SID,
      NOW - 120 * MIN
    );
    expect(chainInFlight(underTest)).toBe(true);
    const active = computeActiveIds([focus, underTest], true, NOW);
    expect(active.has("ut")).toBe(true);
  });

  describe("AC-7b: a CLOSED research row reads NOT active (anti-zombie control)", () => {
    it("(a) chainInFlight() itself: false the INSTANT closedAt is present — zero time dependency", () => {
      // This is the "not merely at t > 6h" proof in its strongest form: chainInFlight
      // takes no `nowMs` at all, so there is no cap, no window, no elapsed time for
      // it to rely on. A closed research-only ticket reads NOT in-flight regardless
      // of when you ask — proven here at a comment timestamp just 1 SECOND before
      // NOW (the "close + 1s" moment).
      const closedJustNow = buildTicket(
        inProgressTask("ut"),
        [line("research", 0, { closedAt: new Date(NOW - 1000).toISOString() })],
        NOW,
        SID,
        NOW
      );
      expect(chainInFlight(closedJustNow)).toBe(false);

      // ...and identically at 2h stale (same content, different age) — the
      // predicate's answer must not depend on staleness either way.
      const closedStale = buildTicket(
        inProgressTask("ut2"),
        [line("research", 120, { closedAt: line("research", 120).ts })],
        NOW - 120 * MIN,
        SID,
        NOW - 120 * MIN
      );
      expect(chainInFlight(closedStale)).toBe(false);
    });

    it("(b) computeActiveIds() at close+10min (past the WINDOW, FAR short of the 6h cap) -> NOT active", () => {
      // HONEST NOTE on why this is "close+10min" and not a literal "close+1s" here:
      // computeActiveIds has a SEPARATE, pre-existing, accepted disjunct (disjunct 3,
      // "WINDOW") that lights ANY in_progress ticket touched within ACTIVE_WINDOW_MS
      // (8 min) purely on recency, independent of chain state — the exact same
      // transient every other ticket type gets (see lane-inflight-undercount.test.ts's
      // AC-5(c), "window pin: a chain-less ... ticket touched 2min ago is ACTIVE
      // (documented transient)"). That disjunct is untouched by #1516 and out of
      // scope to change. So a literal +1s fixture would read ACTIVE via disjunct 3
      // regardless of this fix — not a #1516 regression, the same short-lived,
      // already-accepted behavior every ticket exhibits right after ANY touch.
      // Placing the fixture just past that window (10 min) — comfortably short of
      // the 6-HOUR cap — isolates exactly what AC-7b needs to prove: the "not
      // active" verdict comes from chainInFlight() being false, NOT from waiting
      // out INFLIGHT_LANE_CAP_MS.
      const focus = focusTicket();
      const underTest = buildTicket(
        inProgressTask("ut"),
        [line("research", 10, { closedAt: line("research", 10).ts })],
        NOW - 10 * MIN,
        SID,
        NOW - 10 * MIN
      );
      expect(10 * MIN).toBeGreaterThan(ACTIVE_WINDOW_MS); // past the window
      const active = computeActiveIds([focus, underTest], true, NOW);
      expect(active.has("ut")).toBe(false);
    });
  });

  it("AC-7c: an OPEN research row OLDER than the cap -> NOT active (killed-agent control)", () => {
    // SubagentStop never fires for a killed agent, so the row is PERMANENTLY
    // un-close-stamped. Pins the signal to the CAPPED disjunct-1 arm: an
    // implementation that adds a new UNCAPPED disjunct for research passes AC-7 and
    // AC-7b but fails HERE. inflightCapMs is injected explicitly (small, ms-scale)
    // so the control runs fast rather than needing a real 6h-plus fixture.
    const focus = focusTicket();
    const smallCap = 5 * MIN;
    const underTest = buildTicket(
      inProgressTask("ut"),
      [line("research", 20)], // OPEN, 20 min old — older than the 5-min injected cap
      NOW - 20 * MIN,
      SID,
      NOW - 20 * MIN
    );
    expect(chainInFlight(underTest)).toBe(true); // still content-in-flight...
    const active = computeActiveIds(
      [focus, underTest],
      true,
      NOW,
      ACTIVE_WINDOW_MS,
      smallCap
    );
    expect(active.has("ut")).toBe(false); // ...but the CAP bounds it dark.
  });

  describe("AC-7d: no regression to the four-role chain", () => {
    it("a four-role chain's active/not-active verdict is IDENTICAL with and without a research row", () => {
      // A ticket with all four pipeline roles (mid-chain, punched IN) — the SAME
      // inFlightComments() shape as lane-inflight-undercount.test.ts.
      const chainOnly = () =>
        buildTicket(
          inProgressTask("chain"),
          [line("planner", 130), line("plan-review", 125, { verdict: "PASS" })],
          NOW - 120 * MIN,
          SID,
          NOW - 120 * MIN
        );
      const chainPlusResearch = () =>
        buildTicket(
          inProgressTask("chain"),
          [
            line("planner", 130),
            line("plan-review", 125, { verdict: "PASS" }),
            line("research", 100, { closedAt: line("research", 100).ts }),
          ],
          NOW - 120 * MIN,
          SID,
          NOW - 120 * MIN
        );

      expect(chainInFlight(chainOnly())).toBe(
        chainInFlight(chainPlusResearch())
      );
      expect(chainInFlight(chainOnly())).toBe(true); // sanity: still punched-in mid-chain

      const focus = focusTicket();
      const activeWithout = computeActiveIds([focus, chainOnly()], true, NOW);
      const activeWith = computeActiveIds(
        [focus, chainPlusResearch()],
        true,
        NOW
      );
      expect(activeWithout.has("chain")).toBe(activeWith.has("chain"));
      expect(activeWithout.has("chain")).toBe(true);
    });

    it("a COMPLETE (PASSed) four-role chain stays NOT in-flight whether or not a research row is present", () => {
      const complete = (withResearch: boolean) =>
        buildTicket(
          inProgressTask("chain2"),
          [
            line("planner", 130),
            line("plan-review", 125, { verdict: "PASS" }),
            line("executor", 122),
            line("execution-review", 121, { verdict: "PASS" }),
            ...(withResearch
              ? [line("research", 100, { closedAt: line("research", 100).ts })]
              : []),
          ],
          NOW - 120 * MIN,
          SID,
          NOW - 120 * MIN
        );
      expect(chainInFlight(complete(false))).toBe(false);
      expect(chainInFlight(complete(true))).toBe(false);
    });
  });
});
