/**
 * relativeTime.ts — hand-rolled humanized relative-time helper (no date libs).
 * Phase 49 — Users Management UI.
 */

/**
 * Returns a human-friendly relative time string for an ISO timestamp.
 * null / falsy input returns "never".
 * Buckets: s ago → m ago → h ago → d ago.
 */
export function humanizeRelativeTime(isoString: string | null): string {
  if (!isoString) return "never";
  const diffMs = Date.now() - new Date(isoString).getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  return `${diffDays}d ago`;
}
