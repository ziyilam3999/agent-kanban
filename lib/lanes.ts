// lanes.ts — PURE selector that maps the set of "actively live right now" tickets
// into per-lane descriptors for the Live Swimlanes view. One lane = one genuinely
// live in-progress 4-role chain. Derived ENTIRELY from already-fetched board state
// (the visible tickets + the activeIds set computeActiveIds() already produced) —
// NO network, no poll, no schema change. Pure so it unit-tests in node.

import type { Ticket } from "./board-schema";
import { PIPELINE_ROLES, shippingAfterPass } from "./ui-meta";
import { resolveStageBar } from "./stage-bar";

/** One live ticket's lane descriptor for the swimlanes view. */
export interface Lane {
  /** Ticket id (the lane's stable identity). */
  id: string;
  /** Ticket subject (already redacted upstream). */
  subject: string;
  /**
   * Index into PIPELINE_ROLES of the lane's CURRENT stage. Non-bounced
   * (unchanged pre-#1468 semantics): the highest-index pipeline role present
   * in this ticket's comments — 0 (planner) when no pipeline role has been
   * seen yet. Bounced (#1468): the index of the WORK role (planner/executor)
   * the chain returned to after a fail-class review, derived from the SAME
   * resolveStageBar() selector the drawer bar consumes — so the lane track and
   * the drawer pill can never disagree about which role is genuinely active.
   */
  currentStageIndex: number;
  /** The set of distinct roles seen on this ticket (drives done/pending tinting). */
  rolesSeen: Set<string>;
  /** True iff a fail-class review bounced the pointer back onto a prior work
   * role (#1468) — undefined on every non-bounced lane, so existing fixtures
   * that never set this field stay exactly as they render today. */
  reworking?: boolean;
  /** Index of the FAILED review role's stage (--err tint), set only when
   * `reworking` is true (#1468). */
  failedStage?: number;
}

/**
 * Derive the live swimlanes from the visible tickets + the active-id set.
 *
 * A ticket becomes a lane when it is BOTH in `activeIds` (genuinely live per
 * computeActiveIds) AND in the lane population — the `in_progress` column, plus
 * passed-and-shipping REVIEW-column tickets (#1410: a resolved-PASS execution
 * review keeps the card in REVIEW for the ship tail, but its lane semantics
 * must not change). Lanes are sorted focus-first (newest `updatedAt` first)
 * for a stable, meaningful order.
 *
 * The caller (BoardView) gates rendering on `deriveLanes(...).length >= 2` — below
 * two live lanes the normal column board renders unchanged.
 *
 * @param tickets   the visible tickets (any columns; the lane population is
 *                  in_progress ∪ shipping — master-equivalent for all-valid-ts
 *                  exec-review ledgers; a mixed valid/NaN ledger can diverge —
 *                  see the mixed-ts pin in monotonic-flow.test.ts)
 * @param activeIds the set from computeActiveIds() — the "breathing right now" ids
 */
export function deriveLanes(
  tickets: ReadonlyArray<Ticket>,
  activeIds: ReadonlySet<string>,
): Lane[] {
  const lanes: Array<Lane & { updatedAt: number }> = [];

  for (const t of tickets) {
    // Lane population (#1410): in_progress OR passed-and-shipping — must match
    // computeActiveIds' filter. Revisit if a future Column value is added.
    if (t.column !== "in_progress" && !shippingAfterPass(t)) continue;
    if (!activeIds.has(t.id)) continue;

    const rolesSeen = new Set(t.comments.map((c) => c.role));
    const stageBar = resolveStageBar(t);

    let currentStageIndex: number;
    let reworking: boolean | undefined;
    let failedStage: number | undefined;

    if (stageBar.reworking && stageBar.pointer) {
      // Bounce active (#1468): the lit stage RETURNS to the work role the
      // chain bounced back to — must agree with the drawer bar's pointer.
      currentStageIndex = PIPELINE_ROLES.indexOf(stageBar.pointer);
      reworking = true;
      if (stageBar.loopbackGap) {
        failedStage = PIPELINE_ROLES.indexOf(stageBar.loopbackGap[1]);
      }
    } else {
      // No bounce: preserve the EXACT pre-#1468 semantics (highest reached
      // index) — non-regression for every non-fail fixture (AC5).
      currentStageIndex = 0;
      for (let i = 0; i < PIPELINE_ROLES.length; i++) {
        if (rolesSeen.has(PIPELINE_ROLES[i])) currentStageIndex = i;
      }
    }

    lanes.push({
      id: t.id,
      subject: t.subject,
      currentStageIndex,
      rolesSeen,
      reworking,
      failedStage,
      updatedAt: t.updatedAt,
    });
  }

  // Focus-first: most-recently-updated lane on top (stable order).
  lanes.sort((a, b) => b.updatedAt - a.updatedAt);

  // Strip the sort key — Lane does not expose updatedAt.
  return lanes.map(({ updatedAt: _updatedAt, ...lane }) => lane);
}
