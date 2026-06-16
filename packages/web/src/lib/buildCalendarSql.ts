/**
 * Phase 65 Plan 01 (CAL-V113-03): pure two-level DATE_TRUNC aggregation SQL builder.
 *
 * (a) Pure module — zero React/Recharts/Zustand imports.
 * (b) Consumed by the Phase 67 CalendarRenderer to fetch heatmap data.
 * (c) fromTarget is pre-resolved by the caller — NEVER apply a post-construction
 *     first-FROM regex swap. Reason: DATE_TRUNC SQL can contain 'FROM' tokens
 *     (e.g. EXTRACT(EPOCH FROM ...)) that a first-FROM regex would clobber. Same
 *     clobber-hazard as TimelineRenderer line 202. The caller resolves
 *     (schema, table) → fromTarget before calling this function.
 * (d) Output pivot contract for the CalendarRenderer:
 *       domain_bucket   — DATE_TRUNC('<domain>', timeCol)
 *       subdomain_bucket — DATE_TRUNC('<subdomain>', timeCol)
 *       value           — AGG(metricColumn)
 */

import type { CalendarDomain, CalendarSubdomain } from "./calendarBin";
import { CELL_LIMIT } from "./calendarBin";
import type { TimelineAggregation } from "./timelineBin"; // reuse the aggregation set

export type BuildCalendarSqlArgs = {
  /**
   * Fully resolved FROM target — "schema.table" for table-bound, or a bare
   * unprefixed view name for dv-bound (e.g. "_kbi_dv_v1234").
   * RESOLVED BY THE CALLER, never via a post-construction first-FROM regex swap.
   * (EXTRACT(EPOCH FROM ...) elsewhere has a FROM token; first-FROM regex would
   * clobber it — ARCHITECTURE §Anti-Patterns.)
   */
  fromTarget: string;
  timeCol: string;
  metricColumn: string;      // "*" allowed for COUNT
  aggregation: TimelineAggregation;
  domain: CalendarDomain;    // DATE_TRUNC('<domain>', timeCol)  → domain_bucket
  subdomain: CalendarSubdomain; // DATE_TRUNC('<subdomain>', timeCol) → subdomain_bucket
  limit?: number;            // defaults to CELL_LIMIT (10000)
};

/**
 * Build the aggregation expression for a single metric.
 * COUNT_DISTINCT is NOT a Kinetica function — use COUNT(DISTINCT col) instead.
 * (aggExpr is private in buildTimelineSql.ts — replicated here as the only
 *  permitted duplication per plan spec.)
 */
function aggExpr(aggregation: TimelineAggregation, column: string): string {
  if (aggregation === "COUNT_DISTINCT") {
    return `COUNT(DISTINCT ${column})`;
  }
  return `${aggregation}(${column})`;
}

/**
 * Build the full two-level calendar aggregation query.
 *
 * Emitted shape (single-space-delimited, alias-based GROUP BY):
 *   SELECT DATE_TRUNC('<domain>', <timeCol>) AS domain_bucket,
 *          DATE_TRUNC('<subdomain>', <timeCol>) AS subdomain_bucket,
 *          <agg> AS value
 *   FROM <fromTarget>
 *   WHERE <timeCol> IS NOT NULL
 *   GROUP BY domain_bucket, subdomain_bucket
 *   ORDER BY domain_bucket ASC, subdomain_bucket ASC
 *   LIMIT <limit ?? CELL_LIMIT>
 *
 * GROUP BY uses the computed-column aliases (domain_bucket, subdomain_bucket)
 * per Kinetica's GROUP-BY-alias pattern (mirrors buildTimelineSql.ts).
 */
export function buildCalendarSql(args: BuildCalendarSqlArgs): string {
  const {
    fromTarget,
    timeCol,
    metricColumn,
    aggregation,
    domain,
    subdomain,
    limit,
  } = args;

  const agg = aggExpr(aggregation, metricColumn);
  const lim = limit ?? CELL_LIMIT;

  return (
    `SELECT DATE_TRUNC('${domain}', ${timeCol}) AS domain_bucket, ` +
    `DATE_TRUNC('${subdomain}', ${timeCol}) AS subdomain_bucket, ` +
    `${agg} AS value ` +
    `FROM ${fromTarget} ` +
    `WHERE ${timeCol} IS NOT NULL ` +
    `GROUP BY domain_bucket, subdomain_bucket ` +
    `ORDER BY domain_bucket ASC, subdomain_bucket ASC ` +
    `LIMIT ${lim}`
  );
}
