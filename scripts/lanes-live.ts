#!/usr/bin/env tsx
// lanes-live.ts — kanban-live-lanes-visibility AC-0a. The oracle CLI: given a
// board.json snapshot, prints the SAME "which lanes are live right now"
// computation the web view runs — computed by IMPORTING lib/active.ts's
// computeActiveIds and lib/lanes.ts's deriveLanes, never re-implementing or
// memorizing their logic (the reviewer checks this one line: no local
// re-derivation of chainInFlight / openPunchInClock / the disjunct rules
// lives in this file). This is a deliberately thin wrapper so every Binary AC
// in the plan, ai-brain's own lane counters, and a human operator can all
// read "N lanes live" from a board.json without a browser.
//
// Mirrors components/BoardView.tsx's own selection EXACTLY: the chosen
// session is `board.sessionId` (already the 8-char id `buildBoard` writes),
// `sessionLive` is that session's `SessionSummary.live`, `visible` is the
// board's tickets filtered to that session's id (falling back to ALL tickets
// when none carry a sessionId — a stale pre-v0.2.0 snapshot), and `now` is
// the snapshot's own `generatedAt` (the deterministic "at generation time"
// clock the view uses at first paint, before it advances to wall-clock).
//
// Usage: npx tsx scripts/lanes-live.ts <path-to-board.json>

import * as fs from "node:fs";
import type { Board, Ticket } from "../lib/board-schema";
import { computeActiveIds } from "../lib/active";
import { deriveLanes } from "../lib/lanes";

/** Mirrors components/BoardView.tsx's filterVisible VERBATIM. */
function filterVisible(tickets: Ticket[], sessionId: string | undefined): Ticket[] {
  const anyTagged = tickets.some((t) => t.sessionId);
  if (!anyTagged) return tickets;
  return tickets.filter((t) => t.sessionId === sessionId);
}

function main(): void {
  const file = process.argv[2];
  if (!file) {
    console.error("usage: lanes-live.ts <path-to-board.json>");
    process.exit(1);
  }

  const raw = fs.readFileSync(file, "utf8");
  const board = JSON.parse(raw) as Board;

  const session = board.sessions.find((s) => s.id === board.sessionId) ?? null;
  const sessionLive = !!session?.live;
  const visible = filterVisible(board.tickets, board.sessionId);

  const activeIds = computeActiveIds(visible, sessionLive, board.generatedAt);
  const lanes = deriveLanes(visible, activeIds).map((l) => ({
    id: l.id,
    currentStageIndex: l.currentStageIndex,
    rolesSeen: [...l.rolesSeen].sort(),
  }));

  const out = {
    sessionId: board.sessionId,
    sessionLive,
    activeIds: [...activeIds].sort(),
    lanes,
  };
  console.log(JSON.stringify(out));
}

main();
