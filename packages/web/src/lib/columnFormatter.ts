/**
 * columnFormatter.ts — Pure client-side column formatter library.
 *
 * PURE LIB: NO store / DOM / SQL / fetch imports.
 * Only imports: d3-format (npm) and ./columnTypes (pure type-inference lib, no store/DOM).
 *
 * CRITICAL percent rule (Pitfall 1):
 *   The `kind:"number"` percent PRESET appends a LITERAL "%" and does NOT multiply by 100.
 *   Stored 42 → renders "42%". We deliberately avoid d3's native "%" type specifier, which
 *   would produce 4200% (×100 is d3 convention for fractional values).
 *   Only `kind:"d3"` passes the specifier verbatim to d3, where "%" DOES ×100 (intentional
 *   escape hatch for power users — see Pitfall 1 / CONTEXT.md percent decision).
 */

import { format as d3Format } from "d3-format";
import { inferDataTypeFromColumn } from "./columnTypes";

// ---------------------------------------------------------------------------
// FormatSpec discriminated union — LOCKED shape (shared contract for Plan 03 + Phase 76 editor)
// ---------------------------------------------------------------------------

export type FormatSpecNumber = {
  kind: "number";
  thousandsSep: boolean;     // true = grouping separator
  decimals: number;          // 0..N fixed decimal places
  currency: false | string;  // false = none; string = symbol PREFIX (default "$"), placed BEFORE the number
  percent: boolean;          // true = append LITERAL % WITHOUT ×100
};

export type FormatSpecDate = {
  kind: "date";
  preset: "iso" | "us" | "long" | "us_time" | "long_time" | "custom";
  customPattern?: string;    // only when preset === "custom"; tokens YYYY MM DD HH mm (ss optional)
};

export type FormatSpecD3 = {
  kind: "d3";
  specifier: string;         // raw d3-format string passed verbatim — % DOES ×100 here (intentional)
};

export type FormatSpecNone = { kind: "none" }; // explicit no-op (operator cleared a prior spec)

export type FormatSpec = FormatSpecNumber | FormatSpecDate | FormatSpecD3 | FormatSpecNone;

// ---------------------------------------------------------------------------
// Internal: month name tables (UTC, mirrors columnTypes.ts MONTH_NAMES pattern)
// ---------------------------------------------------------------------------

const MONTH_NAMES_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

// ---------------------------------------------------------------------------
// Internal: normalize date input to milliseconds (epoch ms)
// ---------------------------------------------------------------------------

/**
 * Normalize a date input to epoch milliseconds.
 * Accepts: epoch ms (number), epoch seconds (number < 1e12), ISO string.
 * Returns NaN on invalid input.
 */
function normalizeToMs(v: unknown): number {
  if (v === null || v === undefined) return NaN;
  if (typeof v === "number") {
    if (isNaN(v)) return NaN;
    // Heuristic: values < 1e12 are epoch SECONDS (max seconds for ~2286 AD is ~1e10)
    // Values >= 1e12 are epoch ms (ms since epoch for reasonable dates > 1e12)
    return v < 1_000_000_000_000 ? v * 1000 : v;
  }
  if (typeof v === "string") {
    const ms = new Date(v).getTime();
    return ms;
  }
  if (v instanceof Date) {
    return v.getTime();
  }
  return NaN;
}

// ---------------------------------------------------------------------------
// Internal: format a date epoch ms using the 5 built-in presets
// ---------------------------------------------------------------------------

function formatDatePreset(
  ms: number,
  preset: "iso" | "us" | "long" | "us_time" | "long_time",
): string {
  const d = new Date(ms);
  const yr  = d.getUTCFullYear();
  const mo  = d.getUTCMonth();
  const day = d.getUTCDate();
  const hh  = String(d.getUTCHours()).padStart(2, "0");
  const mm  = String(d.getUTCMinutes()).padStart(2, "0");
  const moStr = String(mo + 1).padStart(2, "0");
  const dayStr = String(day).padStart(2, "0");
  switch (preset) {
    case "iso":
      return `${yr}-${moStr}-${dayStr}`;
    case "us":
      return `${moStr}/${dayStr}/${yr}`;
    case "long":
      return `${MONTH_NAMES_SHORT[mo]} ${day}, ${yr}`;
    case "us_time":
      return `${moStr}/${dayStr}/${yr} ${hh}:${mm}`;
    case "long_time":
      return `${MONTH_NAMES_SHORT[mo]} ${day}, ${yr} ${hh}:${mm}`;
  }
}

// ---------------------------------------------------------------------------
// Internal: format date using a custom token pattern
// ---------------------------------------------------------------------------

/**
 * Token-replace a custom date pattern.
 * Supported tokens (case-sensitive): YYYY MM DD HH mm ss
 * Tokens are replaced with zero-padded UTC parts.
 * Returns raw value (as string) on any error.
 */
function formatDateCustom(ms: number, pattern: string): string {
  const d = new Date(ms);
  const yr  = String(d.getUTCFullYear());
  const mo  = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  const hh  = String(d.getUTCHours()).padStart(2, "0");
  const mm  = String(d.getUTCMinutes()).padStart(2, "0");
  const ss  = String(d.getUTCSeconds()).padStart(2, "0");

  return pattern
    .replace(/YYYY/g, yr)
    .replace(/MM/g, mo)
    .replace(/DD/g, day)
    .replace(/HH/g, hh)
    .replace(/mm/g, mm)
    .replace(/ss/g, ss);
}

// ---------------------------------------------------------------------------
// Internal: build a formatter for each kind
// ---------------------------------------------------------------------------

function buildNumberFormatter(spec: FormatSpecNumber): (v: unknown) => string | unknown {
  return (v: unknown): string | unknown => {
    if (v === null || v === undefined) return v;
    const n = typeof v === "number" ? v : Number(v);
    if (isNaN(n)) return v; // type mismatch → raw value unchanged (never NaN output)

    try {
      // Build d3 specifier from number preset fields (without "%" type — see file header Pitfall 1)
      const commas = spec.thousandsSep ? "," : "";
      const d3Spec = `${commas}.${spec.decimals}f`;
      const formatted = d3Format(d3Spec)(n);

      // Currency prefix (placed BEFORE the number, CONTEXT.md lock)
      if (spec.currency !== false) {
        return `${spec.currency}${formatted}`;
      }

      // Percent: append literal "%" — do NOT use d3 "%" type (that would ×100)
      if (spec.percent) {
        return `${formatted}%`;
      }

      return formatted;
    } catch {
      return v; // invalid spec → raw value, never throw
    }
  };
}

function buildD3Formatter(spec: FormatSpecD3): (v: unknown) => string | unknown {
  return (v: unknown): string | unknown => {
    if (v === null || v === undefined) return v;
    const n = typeof v === "number" ? v : Number(v);
    if (isNaN(n)) return v; // type mismatch → raw value

    try {
      // NOTE: d3's % type DOES ×100 here — raw d3 semantics, intentional for the escape hatch
      // (see Pitfall 1 / CONTEXT.md percent decision). Power users who type ".1%" expect ×100.
      return d3Format(spec.specifier)(n);
    } catch {
      return v; // invalid specifier → raw value, never throw
    }
  };
}

function buildDateFormatter(spec: FormatSpecDate): (v: unknown) => string | unknown {
  return (v: unknown): string | unknown => {
    if (v === null || v === undefined) return v;

    try {
      const ms = normalizeToMs(v);
      if (isNaN(ms)) return v; // un-parseable input → raw value

      if (spec.preset === "custom") {
        const pattern = spec.customPattern ?? "";
        return formatDateCustom(ms, pattern);
      }

      return formatDatePreset(ms, spec.preset);
    } catch {
      return v; // any error → raw value, never throw
    }
  };
}

// ---------------------------------------------------------------------------
// Public API: buildFormatter
// ---------------------------------------------------------------------------

/**
 * Returns a never-throwing value formatter for the given FormatSpec.
 *
 * - null/undefined spec → identity (v) => v
 * - kind:"none"         → identity (v) => v
 * - kind:"number"       → number formatting; percent preset appends literal %, NO ×100
 * - kind:"d3"           → raw d3 specifier; d3's % type DOES ×100 (intentional escape hatch)
 * - kind:"date"         → hand-rolled UTC formatter (5 presets + custom token pattern)
 *
 * All formatters: null/undefined pass through unchanged; type mismatch returns raw value.
 */
export function buildFormatter(
  spec: FormatSpec | null | undefined,
): (v: unknown) => string | unknown {
  if (spec == null || spec.kind === "none") {
    return (v: unknown) => v;
  }

  switch (spec.kind) {
    case "number":
      return buildNumberFormatter(spec);
    case "d3":
      return buildD3Formatter(spec);
    case "date":
      return buildDateFormatter(spec);
    default: {
      // Exhaustiveness guard (TypeScript will catch unhandled kinds at compile time)
      const _exhaustive: never = spec;
      void _exhaustive;
      return (v: unknown) => v;
    }
  }
}

// ---------------------------------------------------------------------------
// Public API: defaultFormatKind
// ---------------------------------------------------------------------------

/**
 * Suggests the default FormatSpec.kind for a column based on its Kinetica data type.
 * Used by the Phase 76 editor's initial kind picker — NOT called by buildFormatter at render time.
 *
 * NOTE: importing columnTypes.ts (a pure type-inference lib, no store/DOM/SQL) is allowed.
 * This function is the ONLY place inferDataTypeFromColumn is imported in this module.
 */
export function defaultFormatKind(
  colName: string,
  columns: Record<string, string>,
): FormatSpec["kind"] {
  const dt = inferDataTypeFromColumn(colName, columns);
  if (dt === "number") return "number";
  if (dt === "datetime") return "date";
  return "none";
}
