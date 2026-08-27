// clock.ts — board-render-perf-inp: quantize the poll-driven wall clock to the
// coarsest granularity every `now` consumer actually needs, so React's setState
// same-value bail (Object.is) turns "advance `now` on every 5s poll tick" into
// "advance `now` roughly once a minute" — cutting the `now`-driven re-render
// rate ~12x (POLL_MS=5000 in components/BoardView.tsx).
//
// Why this is visually free: every consumer of `now` is coarser than a minute —
// lib/relative-time.ts is minute-granular below 1h ("just now" < 60s, then
// per-minute buckets); lib/ui-meta.ts's heldFor is DAY-granular
// (Math.floor(diff / 86_400_000)); phaseLine's threshold crossings are the 1h
// SHIPPING_STALE_MS and 5min LIVE_WINDOW_MS boundaries; lib/active.ts's
// computeActiveIds only reads `now` at the 8min ACTIVE_WINDOW_MS and 6h
// INFLIGHT_LANE_CAP_MS boundaries. No card's rendered output can change more
// than once a minute from clock advance alone — quantizing here just stops
// paying render cost 11 out of every 12 ticks for a clock nothing is reading
// at that resolution.
export const CLOCK_GRANULARITY_MS = 60_000;

/**
 * Floor `ms` to the nearest `granularityMs` boundary. Always rounds DOWN —
 * the displayed clock may lag reality by up to one granularity step, never
 * lead it (a card's relative-time/heartbeat/stale-pill state must never
 * appear to cross a threshold before it actually has).
 */
export function quantizeNow(
  ms: number,
  granularityMs: number = CLOCK_GRANULARITY_MS,
): number {
  return Math.floor(ms / granularityMs) * granularityMs;
}
