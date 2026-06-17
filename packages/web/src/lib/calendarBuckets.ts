/**
 * Phase 68.2-01: calendarBuckets.ts
 *
 * Pure per-group date-range subdomain bucket enumerator.
 *
 * Given a domain group key + (domain, subdomain) units, returns the expected
 * subdomain bucket keys that fall WITHIN that group's own time range — ascending,
 * formatted as "YYYY-MM-DD HH:mm:ss" (UTC, space separator) — the EXACT string
 * format Kinetica DATE_TRUNC emits and parseUTCMs (calendarLayout.ts) consumes.
 *
 * Zero React/Zustand/Recharts imports. Pure date math only.
 *
 * UTC discipline (mirrors computeCellBounds in calendarBin.ts):
 *   - ALWAYS Date.UTC / getUTC* — NEVER local-time constructors (new Date(y,m,d))
 *   - Week start = Monday-ISO: offset = (getUTCDay() + 6) % 7  (Mon=0 … Sun=6)
 *   - Month rollover via Date.UTC(y, mo+1, 1) — handles Dec→Jan automatically
 *
 * Format discipline:
 *   - Use fmtUTC() — NOT toISOString() (emits 'T', 'Z', ms — wrong format)
 *   - Keys must string-equal the SQL DATE_TRUNC row keys in Plan 03's per-group lookup
 */

import type { CalendarDomain, CalendarSubdomain } from "./calendarBin";

/**
 * Format a UTC epoch (ms) to "YYYY-MM-DD HH:mm:ss" (UTC, space separator, no 'T', no 'Z').
 * Uses getUTC* getters — never local-time equivalents.
 */
function fmtUTC(ms: number): string {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  const hr = String(d.getUTCHours()).padStart(2, "0");
  const min = String(d.getUTCMinutes()).padStart(2, "0");
  const sec = String(d.getUTCSeconds()).padStart(2, "0");
  return `${y}-${mo}-${day} ${hr}:${min}:${sec}`;
}

/**
 * Parse a "YYYY-MM-DD HH:mm:ss" key (or an ISO string already containing 'T') to a UTC
 * epoch (ms). Mirrors parseUTCMs from calendarLayout.ts. Tolerates date-only ("YYYY-MM-DD")
 * and millisecond/ISO forms (so a real Kinetica bucket string parses regardless of format).
 */
function parseKeyMs(key: string): number {
  let s = key.trim();
  if (!s.includes("T")) s = s.replace(" ", "T");
  if (!s.includes("T")) s += "T00:00:00"; // pure date with no time component
  if (!/[zZ]$/.test(s) && !/[+-]\d\d:?\d\d$/.test(s)) s += "Z";
  return new Date(s).getTime();
}

/**
 * Infer Kinetica's week-boundary day-of-week (0=Sun … 6=Sat) EMPIRICALLY from the data,
 * so the calendar is anchor-agnostic — it never assumes Monday. Kinetica's `DATE_TRUNC('week')`
 * anchor (Mon vs Sun vs other) is unverified (Phase 65/69 spike auth-blocked); rather than guess,
 * we read it off an actual week bucket present in the query result.
 *
 *   - domain === "week"     → use the day-of-week of any `domain_bucket` (week buckets are the rows)
 *   - subdomain === "week"  → use the day-of-week of any `subdomain_bucket` (week buckets are the cells)
 *   - otherwise             → null (no week involved; anchor is irrelevant)
 *
 * Returns null when no week bucket is available (empty data, or no week in the combo).
 */
export function inferWeekAnchorDow(
  rows: { domain_bucket: string; subdomain_bucket: string }[],
  domain: CalendarDomain,
  subdomain: CalendarSubdomain,
): number | null {
  let sample: string | undefined;
  if (domain === "week") sample = rows.find((r) => r.domain_bucket)?.domain_bucket;
  else if (subdomain === "week") sample = rows.find((r) => r.subdomain_bucket)?.subdomain_bucket;
  if (sample === undefined) return null;
  const ms = parseKeyMs(sample);
  return Number.isNaN(ms) ? null : new Date(ms).getUTCDay();
}

/**
 * Enumerate the expected subdomain bucket keys that fall WITHIN the given domain group's
 * own time range, ascending, formatted "YYYY-MM-DD HH:mm:ss" (UTC).
 *
 * @param domainKey  - The group's bucket key in "YYYY-MM-DD HH:mm:ss" format (UTC).
 * @param domain     - The outer (row) grouping unit.
 * @param subdomain  - The inner (column) cell granularity.
 * @returns Sorted ascending array of "YYYY-MM-DD HH:mm:ss" strings.
 */
export function enumerateGroupBuckets(
  domainKey: string,
  domain: CalendarDomain,
  subdomain: CalendarSubdomain,
  /**
   * Kinetica's week-boundary day-of-week (0=Sun … 6=Sat), from inferWeekAnchorDow.
   * Used ONLY to align generated week-START buckets for week-SUBDOMAIN combos
   * (month×week, year×week). Week-DOMAIN combos (week×day, week×hour) ignore it —
   * they use the domain bucket directly as the authoritative week start.
   * Defaults to 1 (Monday-ISO) for back-compat when no anchor is supplied.
   */
  weekAnchorDow = 1,
): string[] {
  const epochMs = parseKeyMs(domainKey);
  const tmp = new Date(epochMs);
  const y  = tmp.getUTCFullYear();
  const mo = tmp.getUTCMonth();   // 0-based (0=Jan … 11=Dec)
  const domainDay = tmp.getUTCDate();
  const domainHr  = tmp.getUTCHours();

  const result: string[] = [];

  // ─────────────────────────────────────────────────────────────────────────
  // subdomain "hour"
  // ─────────────────────────────────────────────────────────────────────────
  if (subdomain === "hour") {
    switch (domain) {
      case "day": {
        // 24 hours of the day
        for (let h = 0; h < 24; h++) {
          result.push(fmtUTC(Date.UTC(y, mo, domainDay, h, 0, 0, 0)));
        }
        break;
      }
      case "week": {
        // The domain bucket IS Kinetica's week start (already DATE_TRUNC'd) — do NOT
        // re-snap to Monday. 7 days × 24 hours = 168 hour keys from the week start.
        const weekStart = Date.UTC(y, mo, domainDay, 0, 0, 0, 0);
        for (let dayOff = 0; dayOff < 7; dayOff++) {
          for (let h = 0; h < 24; h++) {
            result.push(fmtUTC(weekStart + dayOff * 86_400_000 + h * 3_600_000));
          }
        }
        break;
      }
      default: {
        // year×hour, month×hour are not in VALID_DOMAIN_SUBDOMAIN but handle gracefully:
        // enumerate hours across the full domain range
        const domainStart = Date.UTC(y, mo, domainDay, domainHr, 0, 0, 0);
        let domainEnd: number;
        if (domain === "month") {
          domainEnd = Date.UTC(y, mo + 1, 1, 0, 0, 0, 0);
        } else {
          // year
          domainEnd = Date.UTC(y + 1, 0, 1, 0, 0, 0, 0);
        }
        for (let t = domainStart; t < domainEnd; t += 3_600_000) {
          result.push(fmtUTC(t));
        }
        break;
      }
    }
    return result;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // subdomain "day"
  // ─────────────────────────────────────────────────────────────────────────
  if (subdomain === "day") {
    switch (domain) {
      case "week": {
        // The domain bucket IS Kinetica's week start (already DATE_TRUNC'd) — do NOT
        // re-snap to Monday. The 7 days are simply weekStart + 0..6, so they always
        // align to the data's own week boundary regardless of Kinetica's anchor.
        const weekStart = Date.UTC(y, mo, domainDay, 0, 0, 0, 0);
        for (let i = 0; i < 7; i++) {
          result.push(fmtUTC(weekStart + i * 86_400_000));
        }
        break;
      }
      case "month": {
        // Days 1..lastDayOfMonth
        // Date.UTC(y, mo+1, 0) = day 0 of next month = last day of this month
        const lastDay = new Date(Date.UTC(y, mo + 1, 0, 0, 0, 0, 0)).getUTCDate();
        for (let d = 1; d <= lastDay; d++) {
          result.push(fmtUTC(Date.UTC(y, mo, d, 0, 0, 0, 0)));
        }
        break;
      }
      case "year": {
        // Every day Jan 1 → Dec 31 (advance by +86_400_000 ms while year stays === y)
        const yearStart = Date.UTC(y, 0, 1, 0, 0, 0, 0);
        const yearEnd   = Date.UTC(y + 1, 0, 1, 0, 0, 0, 0);
        for (let t = yearStart; t < yearEnd; t += 86_400_000) {
          result.push(fmtUTC(t));
        }
        break;
      }
      default:
        // day×day is not a valid combo; return empty
        break;
    }
    return result;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // subdomain "week"
  // ─────────────────────────────────────────────────────────────────────────
  if (subdomain === "week") {
    switch (domain) {
      case "month": {
        // Include anchor-aligned week-starts whose START falls within (y, mo).
        // Walk from the week-start on-or-before the 1st of the month, using Kinetica's
        // ACTUAL week anchor (weekAnchorDow) — not a hardcoded Monday.
        const monthStart = Date.UTC(y, mo, 1, 0, 0, 0, 0);
        const monthEnd   = Date.UTC(y, mo + 1, 1, 0, 0, 0, 0); // exclusive
        const dow1 = new Date(monthStart).getUTCDay();
        const offset1 = (dow1 - weekAnchorDow + 7) % 7;
        let weekCursor = monthStart - offset1 * 86_400_000;
        while (weekCursor < monthEnd) {
          const wd = new Date(weekCursor);
          if (wd.getUTCMonth() === mo && wd.getUTCFullYear() === y) {
            result.push(fmtUTC(weekCursor));
          }
          weekCursor += 7 * 86_400_000;
        }
        break;
      }
      case "year": {
        // Include anchor-aligned week-starts whose START falls within year y, using
        // Kinetica's ACTUAL week anchor (weekAnchorDow) — not a hardcoded Monday.
        const yearStart = Date.UTC(y, 0, 1, 0, 0, 0, 0);
        const yearEnd   = Date.UTC(y + 1, 0, 1, 0, 0, 0, 0); // exclusive
        const dow1 = new Date(yearStart).getUTCDay();
        const offset1 = (dow1 - weekAnchorDow + 7) % 7;
        let weekCursor = yearStart - offset1 * 86_400_000;
        while (weekCursor < yearEnd) {
          const wd = new Date(weekCursor);
          if (wd.getUTCFullYear() === y) {
            result.push(fmtUTC(weekCursor));
          }
          weekCursor += 7 * 86_400_000;
        }
        break;
      }
      default:
        // week×week not valid; return empty
        break;
    }
    return result;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // subdomain "month"
  // ─────────────────────────────────────────────────────────────────────────
  if (subdomain === "month") {
    // Only valid for domain "year"
    if (domain === "year") {
      for (let m = 0; m < 12; m++) {
        result.push(fmtUTC(Date.UTC(y, m, 1, 0, 0, 0, 0)));
      }
    }
    return result;
  }

  return result;
}
