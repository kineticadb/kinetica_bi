/**
 * Bar chart time bucketing (quick 261116-bti).
 *
 * A raw timestamp on a bar chart's x-axis gives one bar per distinct instant. When the x column is
 * temporal the bar groups by DATE_TRUNC('<unit>', col) instead. The unit is either fixed by the
 * operator or "auto": re-picked on EVERY render from the MIN/MAX of the rows the chart actually
 * reads (the final, filter-swapped FROM/WHERE), so narrowing a filter narrows the interval.
 *
 * Only Kinetica-native DATE_TRUNC units are used — the same units timelineBin's INTERVAL_LADDER has
 * proven against Kinetica. The stored SQL always carries a concrete unit (Auto stores a fallback),
 * so it stays a valid standalone query for export, the AI and any reader that does not re-pick.
 *
 * PURE module — no React / store imports.
 */
import { INTERVAL_LADDER, type TimelineIntervalKey } from "./timelineBin";

export const BAR_TIME_UNITS = ["year", "quarter", "month", "week", "day", "hour", "minute"] as const;
export type BarTimeUnit = (typeof BAR_TIME_UNITS)[number];
export type BarTimeMode = "none" | "auto" | BarTimeUnit;

export const DEFAULT_BAR_TIME_TARGET = 50;
export const MAX_BAR_TIME_TARGET = 500;
/** Auto's stored fallback when no floor is coarser — used only if the render-time probe fails. */
export const AUTO_FALLBACK_UNIT: BarTimeUnit = "month";

const isUnit = (v: unknown): v is BarTimeUnit => typeof v === "string" && (BAR_TIME_UNITS as readonly string[]).includes(v);
const unitMs = (u: BarTimeUnit): number => INTERVAL_LADDER.find((i) => i.key === u)!.ms;
/** Index in BAR_TIME_UNITS: 0 = coarsest (year). */
const rank = (u: BarTimeUnit): number => BAR_TIME_UNITS.indexOf(u);

export type BarTimeSettings = { mode: BarTimeMode; floor: BarTimeUnit | undefined; target: number };

/** Read the widget's time settings. Absent/unknown interval = "none" (legacy, byte-identical). */
export function barTimeSettings(cfg: Record<string, unknown>): BarTimeSettings {
  const raw = cfg.timeInterval;
  const mode: BarTimeMode = raw === "auto" ? "auto" : isUnit(raw) ? raw : "none";
  const floor = isUnit(cfg.timeIntervalMin) ? cfg.timeIntervalMin : undefined;
  const t = Number(cfg.timeTargetBars);
  const target = Number.isFinite(t) && t >= 1 ? Math.min(MAX_BAR_TIME_TARGET, Math.round(t)) : DEFAULT_BAR_TIME_TARGET;
  return { mode, floor, target };
}

/** Never finer than the floor: the coarser of the two units. */
const atLeast = (u: BarTimeUnit, floor: BarTimeUnit | undefined): BarTimeUnit =>
  floor !== undefined && rank(floor) < rank(u) ? floor : u;

/** The unit stored in SQL at Apply: the fixed unit, or for Auto the fallback (respecting the floor). */
export function storedBarTimeUnit(s: BarTimeSettings): BarTimeUnit | null {
  if (s.mode === "none") return null;
  if (s.mode === "auto") return atLeast(AUTO_FALLBACK_UNIT, s.floor);
  return s.mode;
}

/**
 * The finest unit whose bucket count over `rangeMs` is ≤ target, never finer than `floor`.
 * When even a year exceeds the target, year (coarsest). A zero/invalid range has no width to
 * fit, so it gets the finest allowed unit.
 */
export function pickBarTimeUnit(a: { rangeMs: number; target: number; floor?: BarTimeUnit }): BarTimeUnit {
  const finestAllowed = a.floor ?? "minute";
  if (!Number.isFinite(a.rangeMs) || a.rangeMs <= 0) return finestAllowed;
  let best: BarTimeUnit = "year";
  for (const u of BAR_TIME_UNITS) {
    if (rank(u) > rank(finestAllowed)) break; // finer than the floor
    if (Math.ceil(a.rangeMs / unitMs(u)) <= a.target) best = u; // coarsest→finest: last fit wins
  }
  return best;
}

export const barTimeBucketExpr = (col: string, unit: BarTimeUnit): string => `DATE_TRUNC('${unit}', ${col})`;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const tokenRe = (col: string) => new RegExp(`DATE_TRUNC\\('([a-z]+)', ${escapeRe(col)}\\)`, "g");

/** The unit currently baked into `sql` for `col`, or null (not a time-bucketed bar). */
export function readBarTimeUnit(sql: string, col: string): BarTimeUnit | null {
  const units = [...sql.matchAll(tokenRe(col))].map((m) => m[1]);
  if (units.length === 0 || !units.every((u) => u === units[0]) || !isUnit(units[0])) return null;
  return units[0];
}

/** Rewrite every bucket expression for `col` to `unit`. Null (fail closed) when there is none. */
export function swapBarTimeUnit(sql: string, col: string, unit: BarTimeUnit): string | null {
  if (!isUnit(unit) || readBarTimeUnit(sql, col) === null) return null;
  return sql.replace(tokenRe(col), barTimeBucketExpr(col, unit));
}

/**
 * MIN/MAX probe over the RAW rows the chart reads: the FROM … WHERE of the final SQL (after the
 * filter-view FROM swap), cut at its outermost GROUP BY. Probing the bucketed query instead would
 * collapse a narrow filtered window into a single coarse bucket. Epoch seconds, like timelineBin.
 */
export function buildBarTimeRangeSql(sql: string, col: string): string | null {
  const from = sql.indexOf(" FROM ");
  const groupBy = sql.lastIndexOf(" GROUP BY ");
  if (from < 0 || groupBy < from) return null;
  const source = sql.slice(from + 1, groupBy);
  return `SELECT EXTRACT(EPOCH FROM MIN(${col})) AS lo, EXTRACT(EPOCH FROM MAX(${col})) AS hi ${source}`;
}

/** (hi - lo) in ms from the probe's first row, or NaN. Column-name agnostic about case. */
export function readBarTimeRangeMs(rows: ReadonlyArray<Record<string, unknown>>): number {
  const r = rows[0];
  if (!r) return NaN;
  const get = (k: string) => {
    const key = Object.keys(r).find((x) => x.toLowerCase() === k);
    const v = key === undefined ? undefined : r[key];
    return typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  };
  return (get("hi") - get("lo")) * 1000;
}

/**
 * Inclusive [start, end] for the bucket that starts at `bucket` — the drill filter for a clicked
 * bar (`between`, inclusive on both ends, so end = next start − 1 ms). The wall-clock parts are
 * parsed by regex and treated as UTC, then emitted with toISOString() ("…T23:59:59.999Z") — the
 * same convention as the calendar drill (calendarBin), which the server and the chip formatter
 * read as UTC wall-clock. An un-zoned "… 23:59:59.999" would be parsed as LOCAL time by the chip
 * formatter and shift a day (live UAT: a Q2 drill chip read "Apr 1 – Jul 1").
 */
export function barTimeBucketRange(bucket: string, unit: BarTimeUnit): [string, string] | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(String(bucket));
  if (!m) return null;
  const [y, mo, d, h, mi, s] = [m[1], m[2], m[3], m[4] ?? "0", m[5] ?? "0", m[6] ?? "0"].map(Number);
  const start = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
  const next = new Date(start.getTime());
  switch (unit) {
    case "year": next.setUTCFullYear(y + 1); break;
    case "quarter": next.setUTCMonth(mo - 1 + 3); break;
    case "month": next.setUTCMonth(mo - 1 + 1); break;
    default: next.setTime(start.getTime() + unitMs(unit));
  }
  return [start.toISOString(), new Date(next.getTime() - 1).toISOString()];
}

/** formatTimelineTick accepts these keys directly. */
export const asTimelineKey = (u: BarTimeUnit): TimelineIntervalKey => u;
