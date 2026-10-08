// Phase 132 (LINE-V126-01): PURE module, zero React/Recharts/Zustand imports.

const NUM_RE = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)?Z?$/;
const isMissing = (v: unknown) => v == null || v === "" || v === "null";
const parseDate = (s: string) => Date.parse(s.replace(" ", "T"));

// Phase 132 O-1: line X is ascending by value (accepted visible change to D-05: lines used to plot in metric-value order).
export function sortLineRowsByX<T>(rows: readonly T[], xOf: (row: T) => unknown): T[] {
  const vals = rows.map(xOf);
  const present = vals.filter((v) => !isMissing(v));
  const numeric = present.every((v) => (typeof v === "number" && Number.isFinite(v)) || (typeof v === "string" && NUM_RE.test(v.trim())));
  const date =
    !numeric && present.every((v) => typeof v === "string" && DATE_RE.test(v) && Number.isFinite(parseDate(v)));
  const key = (v: unknown): number | string =>
    numeric ? Number(v) : date ? parseDate(v as string) : String(v);

  const present_: { i: number; k: number | string }[] = [];
  const missing_: number[] = [];
  vals.forEach((v, i) => {
    if (isMissing(v)) missing_.push(i);
    else present_.push({ i, k: key(v) });
  });
  present_.sort((a, b) =>
    numeric || date ? (a.k as number) - (b.k as number) || a.i - b.i : String(a.k).localeCompare(String(b.k)) || a.i - b.i,
  );
  return [...present_.map((p) => rows[p.i]), ...missing_.map((i) => rows[i])];
}

/**
 * Category-count SQL derived from the SQL actually run (UI-SPEC Amendment A1,
 * "Where M comes from"), so it inherits the FROM swap, custom WHERE and live
 * custom-metric expression. Returns null when the aggregate tail is absent.
 */
export function buildLineCategoryCountSql(sql: string, xColumn: string): string | null {
  if (!xColumn.trim()) return null;
  const m = /\s+ORDER\s+BY\s+value\s+(?:ASC|DESC)\s+LIMIT\s+\d+\s*;?\s*$/i.exec(sql);
  if (!m) return null;
  const inner = sql.slice(0, m.index);
  return `SELECT COUNT(DISTINCT ${xColumn}) AS n FROM (${inner}) kbi_line_x`;
}

/** Column-name agnostic: Kinetica may upper/lower-case the alias. */
export function parseCategoryCount(rows: ReadonlyArray<Record<string, unknown>>): number | null {
  const v = rows[0] ? Object.values(rows[0])[0] : undefined;
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : null;
}

export type LineCategoryTruncation = { totalCategories: number | null };

export function lineCategoryNoteText(a: { shown: number; total: number | null }): string {
  if (a.total == null) return `Showing top ${a.shown.toLocaleString()} categories (more exist)`;
  if (a.shown < a.total) return `Showing ${a.shown.toLocaleString()} of ${a.total.toLocaleString()} categories`;
  return "Some lower values are not shown (result limit reached)";
}

export const LINE_CATEGORY_NOTE_TITLE =
  'The query reached its Result limit, so lower-value points are not shown. Raise "Result limit" or narrow the query.';
