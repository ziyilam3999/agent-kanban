// active.ts — which tickets the agent is ACTIVELY working "right now" (the
// breathing heartbeat). PURE logic so it can be unit-tested without a DOM.
//
// Why this isn't just "updated within N minutes": `updatedAt` is the task FILE's
// mtime, which only changes at discrete events (a status flip, a comment/ledger
// append). An agent works a single ticket for many minutes but touches its file
// only occasionally — so a pure "touched within ACTIVE_WINDOW" rule goes DARK
// mid-work (observed live: #1082 was actively worked for 12 min with no file
// touch in between → its mtime was 12 min old → outside the 3-min window → no
// indicator at all, even though it WAS the current focus). The robust signal is:
// in a LIVE session, the MOST-RECENTLY-UPDATED in-progress ticket is the agent's
// current focus and always breathes; any OTHER in-progress ticket also breathes
// while it was genuinely touched within the (widened) window, for parallel work.

import type { Ticket } from "./board-schema";
import { PIPELINE_ROLES } from "./ui-meta";

/** A ticket is "active" when its session is live and updated within this window
 *  — widened from 3 min because the file-mtime touch cadence is coarse. The
 *  most-recent in-progress ticket is ALSO active regardless of this window. */
export const ACTIVE_WINDOW_MS = 8 * 60 * 1000;

/**
 * Upper bound on how long an IN-FLIGHT chain (see chainInFlight) stays live with
 * no observable event — the dead-lane cap (#1403). A chain that dies mid-role
 * (crashed subagent, abandoned in_progress task) in a still-live session must
 * not show live forever: after this long since its last observable event
 * (`updatedAt` max-folds task-file mtime + ledger mtime, and the #1350 spawn
 * heartbeat bumps it at every role boundary, so `updatedAt` IS "last chain
 * event") the lane goes dark. 6 h comfortably exceeds the multi-hour silent
 * executor legs that motivated the fix while bounding a zombie lane to under a
 * working day. Configurable: change here, or inject per call via the
 * `inflightCapMs` parameter of computeActiveIds. CAVEAT (F4): any later
 * task-file touch on a dead in-flight chain re-arms a fresh cap window
 * (`updatedAt` bumps), so this bounds time-since-last-EVENT, not
 * time-since-death — bounded and rare, accepted.
 */
export const INFLIGHT_LANE_CAP_MS = 6 * 60 * 60 * 1000;

/** The canonical pipeline roles as a set (orchestrator is NOT a member). */
const PIPELINE_ROLE_SET = new Set<string>(PIPELINE_ROLES);

/**
 * Fail-class review verdicts — mirrors verdictHue's severe class in
 * lib/ui-meta.ts (keep the two in sync). A FAIL/BLOCK/REJECT execution-review
 * does NOT complete the chain: the chain must run again.
 */
const FAIL_CLASS_RE = /BLOCK|FAIL|REJECT/i;

/**
 * TRUE when a ticket's 3-role chain is STARTED-BUT-UNFINISHED — punched IN but
 * not yet punched OUT (#1403):
 *   - ≥1 comment from a PIPELINE role (planner / plan-review / executor /
 *     execution-review; orchestrator is excluded), AND
 *   - the chain is NOT complete. Chain-complete ⇔ the NEWEST execution-review
 *     comment carries a verdict that is present, non-empty, and NOT fail-class.
 *
 * FAIL/BLOCK/REJECT stays IN-FLIGHT by design: a rework respawn after a FAIL
 * verdict bumps only the ledger-file MTIME — it writes NO new JSONL line — so
 * during a rework leg the comments still end in that resolved FAIL review;
 * treating FAIL as complete would darken every rework leg 8 minutes in (the
 * exact recorded bug class). An abandoned-after-FAIL zombie is bounded by
 * INFLIGHT_LANE_CAP_MS like any other zombie.
 *
 * "Newest execution-review" = the LAST one in the comments array: Ticket.comments
 * arrives sorted by Date.parse(ts) from build-board (whose
 * hasPendingExecutionReview already documents the NaN-ts + tie ordering — a
 * NaN-ts line sorts stably in place, and append order breaks ties), so the last
 * array match is the newest. A NaN-ts line never crashes this predicate.
 */
export function chainInFlight(t: Ticket): boolean {
  let hasPipelineComment = false;
  let newestExecReview: Ticket["comments"][number] | undefined;
  for (const c of t.comments) {
    if (PIPELINE_ROLE_SET.has(c.role)) hasPipelineComment = true;
    if (c.role === "execution-review") newestExecReview = c;
  }
  if (!hasPipelineComment) return false;
  if (newestExecReview === undefined) return true; // punched IN, no review yet
  const verdict = (newestExecReview.verdict ?? "").trim();
  if (verdict === "") return true; // unresolved review — still in flight
  return FAIL_CLASS_RE.test(verdict); // fail-class stays in-flight; PASS completes
}

/**
 * The set of ticket ids that should render the "actively in progress" heartbeat.
 *
 * Three disjuncts over the in_progress tickets of a LIVE session (#1403):
 *   1. IN-FLIGHT: chainInFlight(t) AND its last observable event is within
 *      `inflightCapMs` — chain state, not recency, so a chain survives a long
 *      silent executor leg.
 *   2. FOCUS (conditioned): the max-updatedAt in_progress ticket is
 *      unconditionally active ONLY when it is itself chainInFlight OR NO
 *      in_progress ticket is chainInFlight. When chain-state evidence exists it
 *      must win — otherwise a chain-less rider (a fold-in ticket touched once)
 *      that becomes max-updatedAt would stay unconditionally lit for an entire
 *      multi-hour silent leg. With an all-chain-less population the behavior is
 *      byte-identical to the pre-#1403 rule.
 *   3. WINDOW: any in_progress ticket touched within `windowMs` — recency is
 *      the only liveness signal inline (non-3-role) work has, so this stays. A
 *      demoted-from-focus fresh rider stays lit via this window for 8 minutes
 *      (the accepted, pinned transient).
 *
 * @param tickets       the visible tickets (any columns; only in_progress matter)
 * @param isLive        whether the current session is live (idle session → none)
 * @param nowMs         wall-clock now (ms epoch)
 * @param windowMs      the "recently touched" window for secondary/parallel tickets
 * @param inflightCapMs the dead-lane cap for in-flight chains (INFLIGHT_LANE_CAP_MS)
 */
export function computeActiveIds(
  tickets: ReadonlyArray<Ticket>,
  isLive: boolean,
  nowMs: number,
  windowMs: number = ACTIVE_WINDOW_MS,
  inflightCapMs: number = INFLIGHT_LANE_CAP_MS,
): Set<string> {
  const active = new Set<string>();
  if (!isLive) return active;

  const inProgress = tickets.filter((t) => t.column === "in_progress");
  if (inProgress.length === 0) return active;

  // Disjunct 1 — IN-FLIGHT chains, bounded by the cap. Also gathers the
  // chain-state evidence that conditions the focus disjunct below.
  const inFlightIds = new Set<string>();
  for (const t of inProgress) {
    if (chainInFlight(t)) {
      inFlightIds.add(t.id);
      if (nowMs - t.updatedAt <= inflightCapMs) active.add(t.id);
    }
  }

  // Disjunct 2 — the agent's CURRENT FOCUS = the most-recently-updated
  // in-progress ticket. Unconditionally breathes while the session is live —
  // this is what keeps the indicator lit through sustained work between file
  // touches — but ONLY when chain-state evidence doesn't contradict it (see
  // the function doc). A demoted focus can still qualify via disjunct 1 or 3.
  let focus = inProgress[0];
  for (const t of inProgress) {
    if (t.updatedAt > focus.updatedAt) focus = t;
  }
  if (inFlightIds.size === 0 || inFlightIds.has(focus.id)) {
    active.add(focus.id);
  }

  // Disjunct 3 — any other in-progress ticket genuinely touched within the
  // window (genuine parallel work — e.g. two roles active at once).
  for (const t of inProgress) {
    if (nowMs - t.updatedAt <= windowMs) active.add(t.id);
  }

  return active;
}
