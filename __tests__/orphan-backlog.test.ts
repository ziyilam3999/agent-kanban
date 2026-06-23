// orphan-backlog.test.ts — #1184. detectOrphanBacklog is the PURE post-`/clear`
// orphan signal: OPEN tickets stranded under a NON-live (superseded) session
// while a newer LIVE session exists. Liveness is controlled via the session's
// lastActive mtime (residual 2 — the warning is a DELAYED backstop that fires
// once the retiring session ages out of the live window, NOT instantly post-/clear).

import { buildSessionSummary, buildTicket, detectOrphanBacklog, type RawTask } from "@/lib/build-board";
import type { SessionSummary, Ticket } from "@/lib/board-schema";

const STALE = "0737beca"; // retiring session (8-char)
const LIVE = "ee426cae"; // new active session (8-char)

const NOW = Date.now();
const STALE_MS = NOW - 30 * 60 * 1000; // 30 min ago → NON-live (outside 5-min window)
const FRESH_MS = NOW - 1 * 60 * 1000; // 1 min ago → LIVE (inside the window)

function ticket(id: string, status: RawTask["status"], session8: string): Ticket {
  const raw: RawTask = { id, subject: id, description: "", status, blocks: [], blockedBy: [] };
  return buildTicket(raw, [], NOW, session8);
}

describe("detectOrphanBacklog — #1184 non-live-session orphan signal", () => {
  it("canonical post-/clear (aged): open tickets under a NON-live session + a LIVE session present → returns the non-live session", () => {
    const sessions: SessionSummary[] = [
      buildSessionSummary(STALE, STALE_MS, 2, NOW), // live === false
      buildSessionSummary(LIVE, FRESH_MS, 0, NOW), // live === true (the new empty session)
    ];
    expect(sessions[0].live).toBe(false);
    expect(sessions[1].live).toBe(true);

    const tickets = [ticket("1001", "pending", STALE), ticket("1002", "in_progress", STALE)];

    const orphans = detectOrphanBacklog(tickets, sessions);
    expect(orphans).toEqual([{ sessionId: STALE, openCount: 2 }]);
  });

  it("consolidated under the live session: all open tickets under the LIVE session → empty", () => {
    const sessions: SessionSummary[] = [
      buildSessionSummary(STALE, STALE_MS, 1, NOW), // non-live but only holds done
      buildSessionSummary(LIVE, FRESH_MS, 2, NOW), // live, holds the open work
    ];
    const tickets = [
      ticket("1001", "pending", LIVE),
      ticket("1002", "in_progress", LIVE),
      ticket("0999", "completed", STALE), // terminal under the stale session → not orphaned
    ];
    expect(detectOrphanBacklog(tickets, sessions)).toEqual([]);
  });

  it("does NOT fire when the board merely spans multiple LIVE sessions (normal concurrent work)", () => {
    const otherLive = "aaaaaaaa";
    const sessions: SessionSummary[] = [
      buildSessionSummary(LIVE, FRESH_MS, 1, NOW),
      buildSessionSummary(otherLive, FRESH_MS, 1, NOW),
    ];
    const tickets = [ticket("1001", "pending", LIVE), ticket("2001", "in_progress", otherLive)];
    expect(detectOrphanBacklog(tickets, sessions)).toEqual([]);
  });

  it("no LIVE session present → empty (no migration target, not an actionable orphan)", () => {
    const sessions: SessionSummary[] = [buildSessionSummary(STALE, STALE_MS, 1, NOW)];
    const tickets = [ticket("1001", "pending", STALE)];
    expect(detectOrphanBacklog(tickets, sessions)).toEqual([]);
  });
});
