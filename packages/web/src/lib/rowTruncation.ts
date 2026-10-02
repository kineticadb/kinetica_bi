/**
 * Pure row-truncation decision helpers shared by every renderer notice.
 *
 * PURE module — zero React/Zustand imports.
 *
 * Why limit+1: every widget query carries its OWN SQL `LIMIT n`. Kinetica's
 * `has_more_records` refers to that SQL-bounded result, so it is true ONLY when
 * the app's envelope (the deployment per-query max) cut the result short. It can
 * never say "more rows than the widget's own LIMIT exist". To detect that, the
 * query asks for `LIMIT n+1`, the renderer shows at most n, and if n+1 came back
 * the widget's own limit was hit.
 */

export type TruncationReason = "result-limit" | "deployment-max";

export interface TruncationInfo {
  shown: number;
  reason: TruncationReason;
}

/** Shared tooltip guidance for the deployment-max case. */
export const DEPLOYMENT_MAX_HINT = "Ask an admin to raise KINETICA_MAX_ROWS_PER_QUERY.";

/** has_more_records from a /api/sql response; undefined unless it is a real boolean. */
export function readHasMore(res: unknown): boolean | undefined {
  if (res && typeof res === "object" && !Array.isArray(res)) {
    const v = (res as Record<string, unknown>).has_more_records;
    if (typeof v === "boolean") return v;
  }
  return undefined;
}

/**
 * fetched = rows the query returned (BEFORE slicing to ownLimit);
 * ownLimit = the widget's own row limit n (query asked for n+1), or null;
 * serverHasMore = readHasMore(res).
 */
export function detectTruncation(args: {
  fetched: number;
  ownLimit: number | null;
  serverHasMore: boolean | undefined;
}): TruncationInfo | null {
  const { fetched, ownLimit, serverHasMore } = args;
  if (ownLimit != null && fetched > ownLimit) return { shown: ownLimit, reason: "result-limit" };
  if (serverHasMore === true) {
    if (ownLimit != null && fetched >= ownLimit) return { shown: ownLimit, reason: "result-limit" };
    return { shown: fetched, reason: "deployment-max" };
  }
  return null;
}

/** Rewrites a trailing `LIMIT <n>` to `LIMIT <n+1>`; null if SQL does not end in a plain LIMIT. */
export function bumpTrailingLimit(sql: string): { sql: string; limit: number } | null {
  const m = /(\bLIMIT\s+)(\d+)(\s*;?\s*)$/i.exec(sql);
  if (!m) return null;
  const limit = parseInt(m[2], 10);
  const head = sql.slice(0, m.index);
  return { sql: `${head}${m[1]}${limit + 1}${m[3]}`, limit };
}
