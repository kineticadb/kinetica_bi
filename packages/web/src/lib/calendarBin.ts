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
 * Week start-day: Monday (ISO week; offset = (getUTCDay() + 6) % 7).
 * Documented assumption — confirmed in Plan 65-02 against the live Kinetica instance.
 */

/** The domain is the "outer" grouping level in the calendar (rows). */
export type CalendarDomain = "year" | "month" | "week" | "day";

/** The subdomain is the "inner" cell granularity (columns within a row). */
export type CalendarSubdomain = "month" | "week" | "day" | "hour";

/**
 * DATE_TRUNC units supported by this Kinetica instance.
 * Documented-assumption default; Plan 65-02 confirms/annotates against the live instance.
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
      // Truncate to day first, then back up to Monday (ISO week start).
      // offset = (getUTCDay() + 6) % 7  →  Mon=0, Tue=1, …, Sun=6
      const dayTrunc = Date.UTC(y, mo, day, 0, 0, 0, 0);
      const dow = new Date(dayTrunc).getUTCDay(); // 0=Sun, 1=Mon, …, 6=Sat
      const offset = (dow + 6) % 7; // distance from Monday (Mon=0 … Sun=6)
      startMs = dayTrunc - offset * 86_400_000;
      nextBucketStartMs = startMs + 7 * 86_400_000; // +7 days
      // week anchor = documented assumption (Monday); confirmed in Plan 65-02.
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
