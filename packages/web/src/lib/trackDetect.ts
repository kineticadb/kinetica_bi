/**
 * v1.7 Phase 38 (SCHEMA-V17-07): pure helper module for detecting Kinetica
 * track tables by column-name shape. Strict 4-name case-insensitive match:
 * TRACKID + x + y + TIMESTAMP. NO alias support (no track_id / lat / lon /
 * time / ts). NO column type checks. Operator override (Phase 40
 * TRACK-V17-02) is the escape hatch for non-standard schemas.
 *
 * Pure module — no React, no Zustand, no async. Phase 40 form UI is the
 * first consumer (useEffect([columns]) fires isTrackTable; when truthy,
 * the Track sub-section pre-populates with the matched column names).
 */

export type TrackColumns = {
  /** Matched TRACKID column name, preserving original casing from the columns list. */
  trackIdCol: string;
  /** Matched x column name, preserving original casing. */
  xCol: string;
  /** Matched y column name, preserving original casing. */
  yCol: string;
  /** Matched TIMESTAMP column name, preserving original casing. */
  orderCol: string;
};

/**
 * Detect whether the given columns list constitutes a Kinetica track table.
 * Matches exactly four required column names case-insensitively: TRACKID, x,
 * y, TIMESTAMP. Returns the matched columns (preserving original casing) when
 * all four are present; null otherwise. Extra columns are silently ignored.
 */
export function isTrackTable(columns: { name: string }[]): TrackColumns | null {
  const lower = new Map<string, string>();
  for (const c of columns) {
    lower.set(c.name.toLowerCase(), c.name);
  }
  const trackIdCol = lower.get("trackid");
  const xCol = lower.get("x");
  const yCol = lower.get("y");
  const orderCol = lower.get("timestamp");
  if (!trackIdCol || !xCol || !yCol || !orderCol) return null;
  return { trackIdCol, xCol, yCol, orderCol };
}
