/**
 * Phase 67 Plan 01 (CAL-V113-04): 2D domain×subdomain dense-grid gap-fill.
 *
 * Pure module — zero React/Zustand imports.
 *
 * buildCalendarSql emits DATE_TRUNC + GROUP BY rows containing ONLY populated
 * buckets, ordered by domain_bucket ASC, subdomain_bucket ASC. The renderer
 * needs the FULL expected grid so it can draw grey cells for missing positions.
 *
 * gapFillCalendar takes the populated rows and computes:
 *   domainKeys    — sorted distinct domain_bucket values (columns, left→right)
 *   subdomainKeys — sorted distinct subdomain_bucket values (cells, top→bottom)
 *   rows          — one CalendarRow per domain, each with a cell for EVERY
 *                   subdomain key; missing positions get value: null
 *   cellAt        — O(1) lookup helper (domain, subdomain) → value | null
 *
 * NEVER collapses or shifts neighbors to fill a gap — the gap itself becomes
 * a null-value cell at the correct coordinate, so the renderer can show a
 * distinct grey tile and the Phase-68 click guard can test (value === null).
 */

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
  /** All cells for this domain, ordered by subdomainKeys (top→bottom). */
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
  /** Distinct subdomain_bucket values, sorted ascending (rows top→bottom). */
  subdomainKeys: string[];
  /** Dense 2D grid: one CalendarRow per domainKey, each with a cell for every subdomainKey. */
  rows: CalendarRow[];
  /** O(1) value lookup. Returns null for gap cells or unknown coordinates. */
  cellAt: (domainKey: string, subdomainKey: string) => number | null;
};

/**
 * Build a dense 2D grid from a sparse array of populated SQL result rows.
 *
 * @param rows — Output of buildCalendarSql after decode:
 *               { domain_bucket, subdomain_bucket, value }[]
 *               ordered by domain_bucket ASC, subdomain_bucket ASC.
 */
export function gapFillCalendar(rows: InputRow[]): GapFillResult {
  if (rows.length === 0) {
    return {
      domainKeys: [],
      subdomainKeys: [],
      rows: [],
      cellAt: () => null,
    };
  }

  // Collect distinct keys
  const domainSet = new Set<string>();
  const subdomainSet = new Set<string>();
  for (const row of rows) {
    domainSet.add(row.domain_bucket);
    subdomainSet.add(row.subdomain_bucket);
  }

  const domainKeys = Array.from(domainSet).sort();
  const subdomainKeys = Array.from(subdomainSet).sort();

  // Build lookup map: "domainKey|subdomainKey" → value
  const lookup = new Map<string, number | null>();
  for (const row of rows) {
    lookup.set(`${row.domain_bucket}|${row.subdomain_bucket}`, row.value);
  }

  // Build dense grid
  const calendarRows: CalendarRow[] = domainKeys.map((domainKey) => {
    const cells: CalendarCell[] = subdomainKeys.map((subdomainKey) => {
      const key = `${domainKey}|${subdomainKey}`;
      const value = lookup.has(key) ? (lookup.get(key) ?? null) : null;
      return { domainKey, subdomainKey, value };
    });
    return { domainKey, cells };
  });

  const cellAt = (d: string, s: string): number | null => {
    const key = `${d}|${s}`;
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
