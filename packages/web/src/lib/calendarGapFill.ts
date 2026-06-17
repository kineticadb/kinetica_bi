/**
 * Phase 68.2 Plan 03 (CALUX-V113-03): per-group date-range-aware gap-fill.
 *
 * Pure module — zero React/Zustand imports.
 *
 * buildCalendarSql emits DATE_TRUNC + GROUP BY rows containing ONLY populated
 * buckets, ordered by domain_bucket ASC, subdomain_bucket ASC. The renderer
 * needs per-group cells so each domain group draws ONLY the cells belonging to
 * its own time range.
 *
 * gapFillCalendar takes the populated rows + (domain, subdomain) units and:
 *   domainKeys    — sorted distinct domain_bucket values (columns, left→right)
 *   subdomainKeys — sorted union of all groups' expected keys (informational;
 *                   layout consumes per-block cells, not this top-level union)
 *   rows          — one CalendarRow per domain, each with cells for ONLY that
 *                   group's expected subdomain buckets (per-group time range):
 *                     • in-range bucket with data  → value from SQL
 *                     • in-range bucket with no data → value: null (GREY tile)
 *                     • out-of-range bucket → NO cell at all (BLANK — no rect)
 *   cellAt        — O(1) lookup helper (domain, subdomain) → value | null
 *
 * NEVER collapses or shifts neighbors to fill a gap — the gap itself becomes
 * a null-value cell at the correct coordinate, so the renderer can show a
 * distinct grey tile and the Phase-68 click guard can test (value === null).
 *
 * Out-of-range slots simply have no PositionedCell, so layoutCalendar draws
 * nothing there — giving the true GitHub/calendar blank appearance.
 */

import { enumerateGroupBuckets } from "./calendarBuckets";
import type { CalendarDomain, CalendarSubdomain } from "./calendarBin";

/**
 * Normalize a DATE_TRUNC bucket string to a canonical UTC-epoch key for value lookups.
 *
 * Kinetica's DATE_TRUNC output format is NOT guaranteed identical to the format
 * enumerateGroupBuckets generates ("YYYY-MM-DD HH:mm:ss"). It may be date-only
 * ("2022-10-05"), carry milliseconds, or use a 'T' separator. Keying the lookup by
 * raw strings made every generated key miss the raw SQL key → an all-grey grid.
 * Parsing both sides to epoch-ms makes the lookup format-agnostic.
 *
 * Falls back to the trimmed raw string if unparseable, so an exact-string match
 * can still succeed.
 */
function normKey(raw: string): string {
  let s = raw.trim();
  if (!s.includes("T")) s = s.replace(" ", "T"); // "YYYY-MM-DD HH:mm:ss" → ISO
  if (!s.includes("T")) s += "T00:00:00"; // pure date with no time component
  if (!/[zZ]$/.test(s) && !/[+-]\d\d:?\d\d$/.test(s)) s += "Z"; // assume UTC
  const ms = new Date(s).getTime();
  return Number.isNaN(ms) ? raw.trim() : String(ms);
}

/** One cell in the 2D calendar grid. */
export type CalendarCell = {
  /** The domain_bucket key this cell belongs to (e.g. "2024", "2024-01"). */
  domainKey: string;
  /** The subdomain_bucket key this cell belongs to (e.g. "2024-W01", "2024-01-15"). */
  subdomainKey: string;
  /** Aggregated value from the SQL query, or null for gap (missing) cells. */
  value: number | null;
};

/** One vertical column in the calendar heatmap (one domain group). */
export type CalendarRow = {
  /** The domain_bucket key for this column. */
  domainKey: string;
  /** All cells for this domain, ordered by the group's expected subdomain buckets (top→bottom). */
  cells: CalendarCell[];
};

type InputRow = {
  domain_bucket: string;
  subdomain_bucket: string;
  value: number | null;
};

type GapFillResult = {
  /** Distinct domain_bucket values, sorted ascending (columns left→right). */
  domainKeys: string[];
  /**
   * Informational: sorted union of all groups' expected subdomain keys.
   * Layout consumes per-block cells directly; this field is for callers that
   * need a sense of the overall subdomain axis (e.g. axis labels).
   */
  subdomainKeys: string[];
  /** Per-group rows: each CalendarRow's cells cover ONLY that group's own date range. */
  rows: CalendarRow[];
  /** O(1) value lookup. Returns null for gap cells, out-of-range keys, or unknown coords. */
  cellAt: (domainKey: string, subdomainKey: string) => number | null;
};

/**
 * Build per-group cells from a sparse array of populated SQL result rows.
 *
 * @param rows     — Output of buildCalendarSql after decode:
 *                   { domain_bucket, subdomain_bucket, value }[]
 *                   ordered by domain_bucket ASC, subdomain_bucket ASC.
 * @param domain   — The outer grouping unit (e.g. "month", "week", "day", "year").
 * @param subdomain — The inner cell granularity (e.g. "day", "hour", "week", "month").
 */
export function gapFillCalendar(
  rows: InputRow[],
  domain: CalendarDomain,
  subdomain: CalendarSubdomain,
): GapFillResult {
  if (rows.length === 0) {
    return {
      domainKeys: [],
      subdomainKeys: [],
      rows: [],
      cellAt: () => null,
    };
  }

  // Collect distinct domain keys
  const domainSet = new Set<string>();
  for (const row of rows) {
    domainSet.add(row.domain_bucket);
  }

  const domainKeys = Array.from(domainSet).sort();

  // Build lookup map keyed by NORMALIZED (epoch) domain|subdomain → value, so the
  // generated bucket keys match regardless of Kinetica's exact DATE_TRUNC string format.
  const lookup = new Map<string, number | null>();
  for (const row of rows) {
    lookup.set(`${normKey(row.domain_bucket)}|${normKey(row.subdomain_bucket)}`, row.value);
  }

  // Build per-group rows: each group's cells are ONLY the expected in-range
  // subdomain buckets for that group's own time range.
  const allSubdomainKeys = new Set<string>();
  const calendarRows: CalendarRow[] = domainKeys.map((domainKey) => {
    // Get the expected in-range subdomain keys for this group
    const expected = enumerateGroupBuckets(domainKey, domain, subdomain);
    for (const sub of expected) {
      allSubdomainKeys.add(sub);
    }
    // Map each expected key to a cell: populated → its value; missing → null (GREY)
    // No cell is created for out-of-range keys (they never enter `expected`)
    const cells: CalendarCell[] = expected.map((subdomainKey) => {
      const lookupKey = `${normKey(domainKey)}|${normKey(subdomainKey)}`;
      const value = lookup.has(lookupKey) ? (lookup.get(lookupKey) ?? null) : null;
      return { domainKey, subdomainKey, value };
    });
    return { domainKey, cells };
  });

  // Top-level subdomainKeys: informational sorted union of all groups' expected keys
  const subdomainKeys = Array.from(allSubdomainKeys).sort();

  const cellAt = (d: string, s: string): number | null => {
    const key = `${normKey(d)}|${normKey(s)}`;
    if (!lookup.has(key)) return null;
    return lookup.get(key) ?? null;
  };

  return {
    domainKeys,
    subdomainKeys,
    rows: calendarRows,
    cellAt,
  };
}
