// GET /api/board — returns the current board snapshot as JSON.
// The Vercel CDN caches each response for a short window (see lib/board-cache) so
// frequent client polls are served from the edge instead of re-running Compute +
// re-reading the board from Blob on every poll. This is the #1138 cut to Fast Origin
// Transfer: the board lags a few seconds, imperceptible for a live dashboard.

import { NextResponse } from "next/server";
import { loadBoard } from "@/lib/load-board";
import { BOARD_CACHE_CONTROL } from "@/lib/board-cache";

// Keep the route a live function (never baked at build time); the CDN caches each
// RESPONSE for a short window via the explicit Cache-Control header below.
export const dynamic = "force-dynamic";

export async function GET() {
  const board = await loadBoard();
  return NextResponse.json(board, {
    headers: { "Cache-Control": BOARD_CACHE_CONTROL },
  });
}
