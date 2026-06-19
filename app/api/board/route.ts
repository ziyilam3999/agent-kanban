// GET /api/board — returns the current board snapshot as JSON.
// Always fresh (no caching) so the client can poll it for near-live transitions.

import { NextResponse } from "next/server";
import { loadBoard } from "@/lib/load-board";

// Force dynamic evaluation — never statically cache this route.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const board = await loadBoard();
  return NextResponse.json(board, {
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}
