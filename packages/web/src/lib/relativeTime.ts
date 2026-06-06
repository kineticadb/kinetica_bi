/**
 * relativeTime.ts — hand-rolled humanized relative-time helper (no date libs).
 * Phase 49 — Users Management UI.
 */

/**
 * Returns a human-friendly relative time string for an ISO timestamp.
 * null / falsy input returns "never".
 * Buckets: s ago → m ago → h ago → d ago.
 *
 * Server (SQLite datetime('now')) emits "YYYY-MM-DD HH:MM:SS" with NO timezone
 * marker; new Date() would parse it as LOCAL time. Treat marker-less strings as UTC.
 * Any non-positive diff (clock skew / future timestamps) is clamped to "just now".
 */
export function humanizeRelativeTime(isoString: string | null): string {
  if (!isoString) return "never";
  const hasMarker = isoString.includes("T") || /[zZ]|[+-]\d\d:?\d\d$/.test(isoString);
  const normalized = hasMarker ? isoString : isoString.replace(" ", "T") + "Z";
  const diffMs = Date.now() - new Date(normalized).getTime();
  if (diffMs <= 0) return "just now";
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  return `${diffDays}d ago`;
}
