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

/** CDN edge-cache window in seconds (how stale the board may be). */
export const BOARD_CDN_SMAXAGE = 10;

/** Background-refresh grace window in seconds after the cache window expires. */
export const BOARD_CDN_SWR = 20;

/** The exact Cache-Control header value the /api/board response carries. */
export const BOARD_CACHE_CONTROL = `public, s-maxage=${BOARD_CDN_SMAXAGE}, stale-while-revalidate=${BOARD_CDN_SWR}`;
