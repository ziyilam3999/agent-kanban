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

/** A ticket is "active" when its session is live and updated within this window
 *  — widened from 3 min because the file-mtime touch cadence is coarse. The
 *  most-recent in-progress ticket is ALSO active regardless of this window. */
export const ACTIVE_WINDOW_MS = 8 * 60 * 1000;

/**
 * The set of ticket ids that should render the "actively in progress" heartbeat.
 *
 * @param tickets   the visible tickets (any columns; only in_progress matter)
 * @param isLive    whether the current session is live (idle session → none)
 * @param nowMs     wall-clock now (ms epoch)
 * @param windowMs  the "recently touched" window for secondary/parallel tickets
 */
export function computeActiveIds(
  tickets: ReadonlyArray<Ticket>,
  isLive: boolean,
  nowMs: number,
  windowMs: number = ACTIVE_WINDOW_MS,
): Set<string> {
  const active = new Set<string>();
  if (!isLive) return active;

  const inProgress = tickets.filter((t) => t.column === "in_progress");
  if (inProgress.length === 0) return active;

  // The agent's CURRENT FOCUS = the most-recently-updated in-progress ticket.
  // Always breathes while the session is live, regardless of absolute age — this
  // is what keeps the indicator lit through sustained work between file touches.
  let focus = inProgress[0];
  for (const t of inProgress) {
    if (t.updatedAt > focus.updatedAt) focus = t;
  }
  active.add(focus.id);

  // Plus any other in-progress ticket genuinely touched within the window
  // (genuine parallel work — e.g. two roles active at once).
  for (const t of inProgress) {
    if (nowMs - t.updatedAt <= windowMs) active.add(t.id);
  }

  return active;
}
