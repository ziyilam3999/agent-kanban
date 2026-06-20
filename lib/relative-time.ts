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

/**
 * Compact elapsed gap between two adjacent ISO timestamps, e.g. "+15m". Returns null when the gap
 * carries no signal or is unknown:
 *   unparseable / negative → null
 *   < 1 s (near-simultaneous, e.g. a retroactively batch-logged ledger) → null (no noisy "+0s")
 *   < 60 s → "+Ns"   · < 60 min → "+Nm"   · < 24 h → "+Nh"   · ≥ 24 h → "+Nd"
 */
export function elapsedGap(prevIso: string, iso: string): string | null {
  const d = Date.parse(iso) - Date.parse(prevIso);
  if (!Number.isFinite(d) || d < 0) return null;
  if (d < 1000) return null;
  const s = Math.floor(d / 1000);
  if (s < 60) return `+${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `+${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `+${h}h`;
  return `+${Math.floor(h / 24)}d`;
}
