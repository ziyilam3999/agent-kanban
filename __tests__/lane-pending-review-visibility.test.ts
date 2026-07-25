// lane-pending-review-visibility.test.ts — #1867: a PENDING execution-review
// must not hide a genuinely-running reviewer from the lane count.
//
// The gap (live-confirmed 2026-07-25 on real board data): the moment an
// execution-review ledger row lands (no verdict yet), toColumn() moves the
// ticket from in_progress to in_review — but the lane population in BOTH
// computeActiveIds (lib/active.ts) and deriveLanes (lib/lanes.ts) was
// `in_progress ∪ shippingAfterPass` (resolved-NONFAIL reviews only). So for the
// entire time the reviewer agent is running, its ticket is excluded from the
// "N LANES LIVE" pill — a FALSE NEGATIVE, the mirror image of #1852's false
// positives. The fix adds pendingReviewInFlight() (in_review + status
// in_progress + chainInFlight's open punch-in) as a third population disjunct
// in both filters.
//
// Pure number-fed (buildTicket + synthetic RawLedgerLine[] — no fs, no
// network), same discipline as lane-inflight-undercount.test.ts. Fixtures use
// EXPLICIT agentIds + closedAt so the punch-in/punch-out discriminator (#1852
// r3 per-agentId rule) is exercised for real, not via the agentId-less
// back-compat path.
//
// RED→GREEN provenance: AC-1 was run RED first — with pendingReviewInFlight()
// exported but the population filters still unwired, `active.has("ut")` failed
// exactly as it does against the live pre-fix board (replayed 2026-07-25 on
// real ledger data: pill=1, #1880's running reviewer invisible). The suite
// went GREEN only once both filters consumed the predicate.

import {
  buildTicket,
  type RawLedgerLine,
  type RawTask,
} from "@/lib/build-board";
import {
  INFLIGHT_LANE_CAP_MS,
  computeActiveIds,
  pendingReviewInFlight,
} from "@/lib/active";
import { deriveLanes } from "@/lib/lanes";
import { shippingAfterPass } from "@/lib/ui-meta";

const NOW = 1_700_000_000_000;
const MIN = 60_000;
const SID = "sess0001";

function inProgressTask(id: string, onHold?: string): RawTask {
  const t: RawTask = {
    id,
    subject: `t${id}`,
    description: "",
    status: "in_progress",
    blocks: [],
    blockedBy: [],
  };
  if (onHold) t.metadata = { on_hold: onHold };
  return t;
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

const closedAt = (minsAgo: number) =>
  new Date(NOW - minsAgo * MIN).toISOString();

/**
 * The #1867 shape: a full chain whose execution-review row has LANDED (so the
 * column is in_review) but carries NO verdict and NO closedAt — the reviewer
 * agent is punched IN and genuinely running.
 */
function pendingReviewComments(): RawLedgerLine[] {
  return [
    line("planner", 60, { agentId: "ag-pl", closedAt: closedAt(60) }),
    line("plan-review", 50, {
      agentId: "ag-pr",
      verdict: "PASS",
      closedAt: closedAt(50),
    }),
    line("executor", 30, { agentId: "ag-ex", closedAt: closedAt(30) }),
    // The running reviewer: punched IN (agentId, no closedAt), verdict pending.
    line("execution-review", 12, { agentId: "ag-er" }),
  ];
}

/** A fresh chain-less focus ticket so the ticket under test is NON-focus. */
function focusTicket() {
  return buildTicket(inProgressTask("focus"), [], NOW - 1 * MIN, SID);
}

describe("#1867 — pending execution-review must not hide a running reviewer", () => {
  it("AC-1 (RED pre-fix): in_review ticket with an OPEN exec-review punch-in → counted live + gets a lane row", () => {
    const focus = focusTicket();
    const underTest = buildTicket(
      inProgressTask("ut"),
      pendingReviewComments(),
      NOW - 30 * MIN,
      SID,
      NOW - 12 * MIN // ledger touched when the reviewer row landed
    );

    // Precondition — this IS the crack: pending review moved the column.
    expect(underTest.column).toBe("in_review");
    expect(shippingAfterPass(underTest)).toBe(false);
    expect(pendingReviewInFlight(underTest)).toBe(true);

    const active = computeActiveIds([focus, underTest], true, NOW);
    expect(active.has("ut")).toBe(true); // the pill counts the running reviewer

    const lanes = deriveLanes([focus, underTest], active);
    const laneIds = lanes.map((l) => l.id);
    expect(laneIds).toContain("ut"); // and the swimlane row exists
    // The lane's lit stage is the execution-review seat (index 3).
    expect(lanes.find((l) => l.id === "ut")!.currentStageIndex).toBe(3);
  });

  it("AC-2 (delete-the-input oracle): SAME fixture but the reviewer punched OUT (closedAt, still no verdict) → dark", () => {
    // Differs from AC-1 ONLY in the exec-review row's closedAt — proving the
    // verdict turns on the punch-in signal, not on column/recency (#1852
    // punch-out semantics preserved: a crashed/killed reviewer goes dark).
    const focus = focusTicket();
    const comments = pendingReviewComments();
    comments[3] = line("execution-review", 12, {
      agentId: "ag-er",
      closedAt: closedAt(12),
    });
    const underTest = buildTicket(
      inProgressTask("ut"),
      comments,
      NOW - 30 * MIN,
      SID,
      NOW - 12 * MIN
    );

    expect(underTest.column).toBe("in_review"); // still parked in REVIEW
    expect(pendingReviewInFlight(underTest)).toBe(false);

    const active = computeActiveIds([focus, underTest], true, NOW);
    expect(active.has("ut")).toBe(false);
    expect(deriveLanes([focus, underTest], active).map((l) => l.id)).not.toContain("ut");
  });

  it("AC-3: NON-focus pending-review chain beyond INFLIGHT_LANE_CAP_MS → dark (zombie stays bounded)", () => {
    const focus = focusTicket();
    const STALE = INFLIGHT_LANE_CAP_MS + 10 * MIN;
    const staleMins = STALE / MIN;
    const underTest = buildTicket(
      inProgressTask("ut"),
      [
        line("planner", staleMins + 40, { agentId: "ag-pl", closedAt: closedAt(staleMins + 40) }),
        line("execution-review", staleMins, { agentId: "ag-er" }),
      ],
      NOW - STALE,
      SID,
      NOW - STALE
    );

    expect(pendingReviewInFlight(underTest)).toBe(true); // in-flight by state…
    const active = computeActiveIds([focus, underTest], true, NOW);
    expect(active.has("ut")).toBe(false); // …but capped, exactly like in_progress chains
  });

  it("AC-4 (#1816 interaction, pinned): hold-marked ticket parked in REVIEW by a pending review with a RUNNING reviewer → counted", () => {
    // isHeld() is DELIBERATELY column-gated to in_progress (#1816 — "terminal
    // status wins by construction"), so an `on_hold` string on an in_review
    // ticket does not suppress the lane. That is the honest verdict here: the
    // reviewer agent is genuinely punched-IN and running, and a running agent
    // is a live lane regardless of the operator's parked-for-later intent.
    // (Pre-#1867 such a ticket was dark only as a side effect of the
    // population gap this suite closes.) Pinning the interaction so a future
    // isHeld() widening shows up as a conscious decision, not silent drift.
    const focus = focusTicket();
    const underTest = buildTicket(
      inProgressTask("ut", "parked on purpose for the demo"),
      pendingReviewComments(),
      NOW - 30 * MIN,
      SID,
      NOW - 12 * MIN
    );

    expect(underTest.column).toBe("in_review"); // hold treatment column-gated away
    const active = computeActiveIds([focus, underTest], true, NOW);
    expect(active.has("ut")).toBe(true);
  });

  it("AC-5 (non-regression): resolved-PASS shipping ticket is untouched by the new predicate", () => {
    const comments = pendingReviewComments();
    comments[3] = line("execution-review", 12, {
      agentId: "ag-er",
      verdict: "PASS",
      closedAt: closedAt(12),
    });
    const underTest = buildTicket(
      inProgressTask("ut"),
      comments,
      NOW - 30 * MIN,
      SID,
      NOW - 5 * MIN // window-fresh: the ship tail touched the ledger 5m ago
    );

    expect(underTest.column).toBe("in_review");
    expect(shippingAfterPass(underTest)).toBe(true); // existing shipping path…
    expect(pendingReviewInFlight(underTest)).toBe(false); // …not hijacked

    // Still lane-eligible via the EXISTING shipping disjunct + 8-min window
    // (identical verdict on master — this asserts non-regression, not new
    // behavior).
    const active = computeActiveIds([underTest], true, NOW);
    expect(active.has("ut")).toBe(true);
  });

  it("AC-6: idle session → nothing is live, new predicate included", () => {
    const underTest = buildTicket(
      inProgressTask("ut"),
      pendingReviewComments(),
      NOW - 30 * MIN,
      SID,
      NOW - 12 * MIN
    );
    expect(computeActiveIds([underTest], false, NOW).size).toBe(0);
  });
});
