/**
 * Phase 65 Plan 01 (CAL-V113-03): pure calendar bucketing helpers.
 *
 * Zero React/Recharts/Zustand imports. Consumed by:
 *   - Plan 65-01 buildCalendarSql.ts (CELL_LIMIT + types)
 *   - Plan 66 CalendarConfigPanel.tsx (VALID_DOMAIN_SUBDOMAIN + isValidCombo)
 *   - Plan 67 CalendarRenderer.tsx (computeCellBounds)
 *   - Plan 68 cell-drill integration (computeCellBounds → BETWEEN bounds)
 *
 * PITFALL 1 (half-open vs inclusive BETWEEN): DATE_TRUNC returns half-open buckets
 * [start, nextStart). The server whereClause.ts BETWEEN path (line 124) uses:
 *   `${col} BETWEEN '${escape(lo)}' AND '${escape(hi)}'`
 * which is inclusive. cellEnd = nextBucketStart − 1ms reconciles half-open with
 * inclusive BETWEEN — the last millisecond of the bucket is included, the first ms
 * of the next bucket is excluded.
 *
 * PITFALL 2 (UTC/DST): All date arithmetic uses Date.UTC / getUTC* / toISOString.
 * NEVER use local-time constructors (new Date(y, m, d)) or local getters (getDate,
 * getMonth, etc.). UTC arithmetic is inherently offset-independent — a DST transition
 * at 2:00 AM US/Eastern has zero effect on UTC calculations.
 *
 * Output format: Date.prototype.toISOString() → "YYYY-MM-DDTHH:mm:ss.SSSZ"
 * Compatible with the whereClause.ts datetime BETWEEN path — the 'Z' suffix contains
 * no embedded single quotes, safe as a single-quoted SQL literal.
 *
 * Week bucketing: computeCellBounds for "week" trusts the input as Kinetica's
 * DATE_TRUNC('week') bucket START (the deployment's actual anchor — NOT assumed Monday)
 * and spans [start, start + 7 days). See computeCellBounds for the v1.13 anchor-bug history.
 */

/** The domain is the "outer" grouping level in the calendar (rows). */
export type CalendarDomain = "year" | "month" | "week" | "day";

/** The subdomain is the "inner" cell granularity (columns within a row). */
export type CalendarSubdomain = "month" | "week" | "day" | "hour";

/**
 * DATE_TRUNC units supported by this Kinetica instance.
 * NOT YET VERIFIED against live Kinetica — spike could not run in this env
 * (the /api/sql route on localhost:4000 requires a valid Kinetica session obtained
 * via POST /api/auth/login with Kinetica password credentials; credentials are not
 * accessible to the executor without reading packages/server/.env, which is
 * security-prohibited); FLAGGED for Phase 69 UAT (CAL-V113-03).
 * Re-attempted in Phase 68.2-02 (2026-06-17): still NOT-RUN, same auth barrier persists.
 * See .planning/phases/65-calendar-sql-builder-kinetica-spike/65-02-SUMMARY.md and
 * .planning/phases/68.2-calendar-week-anchor-spike-per-group-date-range-gap-fill/68.2-02-SPIKE.md
 * for the exact spike queries to run during Phase 69 UAT.
 */
export const KINETICA_DATE_TRUNC_UNITS = [
  "year",
  "month",
  "week",
  "day",
  "hour",
] as const;

/**
 * The 8 valid (domain → subdomain) combos where subdomain is strictly finer than domain.
 * Shared — Phase 66 CalendarConfigPanel imports this to enforce combos at config-save.
 *
 * year  → {month, week, day}
 * month → {week, day}
 * week  → {day, hour}
 * day   → {hour}
 */
export const VALID_DOMAIN_SUBDOMAIN: Record<CalendarDomain, readonly CalendarSubdomain[]> = {
  year:  ["month", "week", "day"],
  month: ["week", "day"],
  week:  ["day", "hour"],
  day:   ["hour"],
};

/** Returns true iff (domain, subdomain) is one of the 8 valid combos. */
export function isValidCombo(
  domain: CalendarDomain,
  subdomain: CalendarSubdomain,
): boolean {
  const allowed = VALID_DOMAIN_SUBDOMAIN[domain];
  if (!allowed) return false;
  return (allowed as readonly string[]).includes(subdomain);
}

/** LIMIT safety cap emitted by buildCalendarSql. */
export const CELL_LIMIT = 10000;

/**
 * Compute the UTC-truncated start and inclusive end for a single calendar cell.
 *
 * @param dateIso  - Any ISO-8601 string (UTC 'Z' suffix recommended; local offsets are
 *                   parsed correctly by new Date(str).getTime() per ECMA-262 §21.4.3.2).
 * @param subdomainUnit - The cell granularity (hour, day, week, month).
 * @returns [cellStartIso, cellEndIso] where:
 *   cellStart = UTC-truncated start of the bucket containing dateIso.
 *   cellEnd   = nextBucketStart − 1ms (inclusive BETWEEN upper bound).
 *
 * Implementation notes:
 *   - Month rollover: Date.UTC(y, mo+1, 1) handles Dec→Jan correctly (mo+1=12
 *     overflows to Jan of y+1 via JS Date.UTC's month normalization).
 *   - Week start: Monday (ISO). offset = (getUTCDay() + 6) % 7 (Mon=0 … Sun=6).
 *     Documented assumption — Plan 65-02 confirms against the live Kinetica instance.
 *   - DO NOT add fixed ms for month (months vary 28-31 days) — use Date.UTC rollover.
 *   - DST-immune: UTC arithmetic has no concept of local DST transitions.
 */
export function computeCellBounds(
  dateIso: string,
  subdomainUnit: CalendarSubdomain,
): [string, string] {
  // Parse to UTC ms epoch — ISO with 'Z' is UTC-safe per ECMA-262.
  const epoch = new Date(dateIso).getTime();

  const d = new Date(epoch);
  const y  = d.getUTCFullYear();
  const mo = d.getUTCMonth();  // 0-based
  const day = d.getUTCDate();
  const hr = d.getUTCHours();

  let startMs: number;
  let nextBucketStartMs: number;

  switch (subdomainUnit) {
    case "hour": {
      // Zero out minutes / seconds / ms (UTC)
      startMs = Date.UTC(y, mo, day, hr, 0, 0, 0);
      nextBucketStartMs = startMs + 3_600_000; // +1 hour in ms
      break;
    }
    case "day": {
      startMs = Date.UTC(y, mo, day, 0, 0, 0, 0);
      nextBucketStartMs = startMs + 86_400_000; // +1 day in ms
      break;
    }
    case "week": {
      // The input is Kinetica's DATE_TRUNC('week', timeCol) bucket START — i.e. the ACTUAL
      // week anchor Kinetica uses for THIS deployment (NOT guaranteed Monday; it varies by
      // Kinetica config). Trust it verbatim: the bucket spans [bucketStart, bucketStart + 7d).
      //
      // The previous code re-anchored the input back to Monday. When Kinetica's anchor was
      // not Monday, that shifted the drilled BETWEEN window to a DIFFERENT week than the one
      // the cell's COUNT was computed over — so the filtered record count never matched the
      // cell tooltip (small mismatch for similar adjacent weeks; catastrophic at the data's
      // start/end boundary where the shifted week is near-empty). v1.13 CALUX week-anchor bug.
      //
      // The renderer already infers the anchor for layout/gap-fill (inferWeekAnchorDow); the
      // drill bounds must likewise honor the real bucket start rather than assume Monday.
      startMs = Date.UTC(y, mo, day, 0, 0, 0, 0);
      nextBucketStartMs = startMs + 7 * 86_400_000; // +7 days from the bucket start
      break;
    }
    case "month": {
      startMs = Date.UTC(y, mo, 1, 0, 0, 0, 0);
      // Date.UTC normalizes mo+1: if mo===11 (Dec), mo+1=12 → Jan of y+1.
      // This correctly handles the Dec→Jan year rollover without special-casing.
      nextBucketStartMs = Date.UTC(y, mo + 1, 1, 0, 0, 0, 0);
      break;
    }
  }

  const cellStart = new Date(startMs).toISOString();
  const cellEnd   = new Date(nextBucketStartMs - 1).toISOString();

  return [cellStart, cellEnd];
}
