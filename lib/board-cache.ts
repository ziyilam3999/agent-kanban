// board-cache.ts — the CDN cache policy for the /api/board response.
//
// #1138: frequent client polls were re-running Compute + re-reading the board from
// Blob on EVERY poll (no caching), which dominated Vercel "Fast Origin Transfer".
// Caching the response at the Vercel edge for a short window means repeat polls are
// served from the edge, not Compute. The board lags at most BOARD_CDN_SMAXAGE
// seconds — imperceptible for a live dashboard, and stale-while-revalidate keeps a
// viewer from ever blocking on a cache miss.
//
// Single source of truth so the route handler and its test agree on the policy.

import { createHash } from "crypto";

/** CDN edge-cache window in seconds (how stale the board may be). */
export const BOARD_CDN_SMAXAGE = 10;

/** Background-refresh grace window in seconds after the cache window expires. */
export const BOARD_CDN_SWR = 20;

/** The exact Cache-Control header value the /api/board response carries. */
export const BOARD_CACHE_CONTROL = `public, s-maxage=${BOARD_CDN_SMAXAGE}, stale-while-revalidate=${BOARD_CDN_SWR}`;

// ---------------------------------------------------------------------------
// fold8-poll-metered-payload-diet: ETag/304 conditional-request support.
//
// The client polls /api/board every 5s; on a metered platform (Vercel Fast
// Origin Transfer + Blob reads), an unchanged board answered with a full
// ~5.5 MB body every tick is pure waste. A STABLE validator lets the client
// present what it last saw (`If-None-Match`) and the server answer with an
// empty 304 when nothing changed.
//
// r1 (plan risk): the hashed bytes MUST equal the served bytes, or 304
// correctness silently breaks. The route computes `JSON.stringify(board)`
// ONCE and both hashes it (here) and serves it — never re-serializes.
// ---------------------------------------------------------------------------

/**
 * Compute a strong ETag validator from the EXACT JSON text the route is
 * about to serve. Deterministic for byte-identical input (SHA-256 over the
 * already-serialized board text) — a board that hasn't changed since the
 * last export (verified: `generatedAt` is stamped only at export time, not
 * per-request) reproduces the SAME validator, which is what makes 304 fire
 * on idle stretches. No extra Blob/file read: the caller passes in the body
 * text it already has from `JSON.stringify(board)`.
 */
export function computeBoardETag(bodyText: string): string {
  const digest = createHash("sha256").update(bodyText).digest("hex");
  return `"${digest}"`;
}

/**
 * True when `etag` is one of the (possibly multiple, comma-separated)
 * validators listed in an `If-None-Match` request header, or the header is
 * the wildcard `*`. Standard HTTP conditional-request list syntax.
 */
export function ifNoneMatchHits(
  ifNoneMatch: string | null | undefined,
  etag: string
): boolean {
  if (!ifNoneMatch) return false;
  const trimmed = ifNoneMatch.trim();
  if (trimmed === "*") return true;
  return trimmed
    .split(",")
    .map((s) => s.trim())
    .includes(etag);
}
