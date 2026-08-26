// GET /api/board — returns the current board snapshot as JSON.
// The Vercel CDN caches each response for a short window (see lib/board-cache) so
// frequent client polls are served from the edge instead of re-running Compute +
// re-reading the board from Blob on every poll. This is the #1138 cut to Fast Origin
// Transfer: the board lags a few seconds, imperceptible for a live dashboard.
//
// CACHE-POLICY: this route carries `s-maxage` via BOARD_CACHE_CONTROL (lib/board-cache.ts)
// on BOTH the 200 and the 304 branch below — the literal "s-maxage" string lives in that
// shared constant, not here, so a naive grep of this file alone won't see it.
//
// fold8-poll-metered-payload-diet: the response ALSO carries an ETag validator and
// honors `If-None-Match` with an empty `304` when the board hasn't changed — the
// remaining large metered-cost lever beyond the #1138 edge cache. `bodyText` is
// serialized exactly ONCE and used for BOTH the hash and the served bytes (r1: a
// mismatch between hashed and served bytes silently breaks 304 correctness).

import { NextResponse } from "next/server";
import { loadBoard } from "@/lib/load-board";
import {
  BOARD_CACHE_CONTROL,
  computeBoardETag,
  ifNoneMatchHits,
} from "@/lib/board-cache";

// Keep the route a live function (never baked at build time); the CDN caches each
// RESPONSE for a short window via the explicit Cache-Control header below.
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const board = await loadBoard();
  const bodyText = JSON.stringify(board);
  const etag = computeBoardETag(bodyText);

  const ifNoneMatch = req.headers.get("if-none-match");
  if (ifNoneMatchHits(ifNoneMatch, etag)) {
    // Unchanged: empty body, but the CDN policy is repeated — the edge keeps
    // absorbing repeat polls between real changes, not just the 200s.
    return new NextResponse(null, {
      status: 304,
      headers: { "Cache-Control": BOARD_CACHE_CONTROL, ETag: etag },
    });
  }

  return new NextResponse(bodyText, {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": BOARD_CACHE_CONTROL,
      ETag: etag,
    },
  });
}
