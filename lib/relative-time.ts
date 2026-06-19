// relative-time.ts — pure relative-time formatting for the telemetry UI.
// Kept dependency-free + deterministic so it is trivially unit-testable.

/**
 * Render a compact, glanceable relative time for a past ms-epoch timestamp.
 *   < 1 min            → "just now"
 *   < 60 min           → "2m ago"
 *   < 24 h             → "3h ago"
 *   exactly 1 day span → "yesterday"
 *   ≥ 2 days           → "5d ago"
 * Future timestamps (ms > nowMs) clamp to "just now".
 */
export function relativeTime(ms: number, nowMs: number): string {
  const diff = nowMs - ms;
  if (diff < 60_000) return "just now";
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  return `${days}d ago`;
}
