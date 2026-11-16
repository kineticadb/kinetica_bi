/**
 * liveMetricSql.ts — Phase 121 Plan 05 (DXIM-V124-10 gap closure).
 *
 * Problem: `ChartConfigPanel`'s `generatedSql` useMemo resolves a custom metric's
 * `metricId -> expression` via `resolveMetricExpr` (reads `customMetricsStore` live) and bakes
 * the RESULT into `widget.config.sql` at Apply time. `AggregatedWidgetRenderer` then renders that
 * frozen text verbatim (`cfg.sql`) and never re-resolves the metric
 * (`grep -c resolveMetricExpr packages/web/src/components/charts/WidgetRenderer.tsx` -> 0). So
 * bar/line/pie/scatter/table/bignumber/heatmap widgets keep computing whatever expression was in
 * force when Apply was last pressed — the SOURCE environment's after an import, or a stale one
 * after any in-place metric edit (the frozen config.sql metric-expression defect).
 *
 * Decision: a targeted, positional select-item swap at render time — NOT a full SQL rebuild.
 * `AggregatedWidgetRenderer` does not have the inputs a rebuild needs (`columnTypeMap` for the
 * heatmap DATE_TRUNC decision requires `tables`, which the renderer is never given, and is empty
 * on first render on the async-load path); a rebuild would also silently re-derive limit ladders,
 * sort defaults, and `customWhere` formatting for widgets that are not broken. In all four SQL
 * shapes the panel emits for a custom metric, the metric expression is the LAST select-list item
 * and is aliased `AS value` — a positional anchor that stays unambiguous even when a group-by
 * column is itself named `value`.
 *
 * Fail-closed rule: any SQL this lib cannot fully account for — an unrecognized shape, a
 * mid-string parse failure, an unbalanced/invalid replacement expression — is returned
 * byte-identical (the caller's own string reference where possible). This lib NEVER emits a
 * partially rewritten query.
 *
 * Zero React / Recharts imports. This plan wires NOTHING into a renderer or component — that is
 * Plan 121-06's job.
 */

import { isCustomSelection, resolveMetricExpr } from "./customMetricSql";
import { isMetricsHydrated } from "../store/customMetricsStore";
import { extraMetricAlias, type TableExtraMetric } from "./tableExtraMetrics";

export type LiveMetricSql =
  | { kind: "ready"; sql: string | undefined }
  | { kind: "pending" };

// ---------------------------------------------------------------------------
// Scanner — shared depth- and quote-aware walker
// ---------------------------------------------------------------------------

type ScanState = { inSingle: boolean; inDouble: boolean; depth: number };

type ScanResult = {
  /** Indices of every TOP-LEVEL comma encountered (not inside quotes or parens). */
  commas: number[];
  /** Index of the leading space of a top-level " FROM " match, or null if not found. */
  fromIndex: number | null;
  endState: ScanState;
};

/**
 * Walks `str` from `start`, char by char, tracking:
 *   - `inSingle` — inside a `'...'` string literal (a doubled `''` stays inside the literal)
 *   - `inDouble` — inside a `"..."` identifier/string literal
 *   - `depth`    — paren nesting depth
 * "Top level" means `!inSingle && !inDouble && depth === 0` — quotes and parens both suppress
 * comma/FROM detection, and quote state is checked BEFORE depth, so a comma or `FROM` inside a
 * quoted literal is ignored regardless of paren depth.
 *
 * When `detectFrom` is true, stops at the first top-level literal " FROM " (leading + trailing
 * single space, case-sensitive) and returns immediately. Otherwise scans to the end of `str`.
 */
function scanTopLevel(str: string, start: number, detectFrom: boolean): ScanResult {
  let inSingle = false;
  let inDouble = false;
  let depth = 0;
  const commas: number[] = [];
  let i = start;

  while (i < str.length) {
    const ch = str[i];

    if (inSingle) {
      if (ch === "'") {
        if (str[i + 1] === "'") {
          i += 2; // doubled '' escape — stays inside the literal
          continue;
        }
        inSingle = false;
      }
      i++;
      continue;
    }

    if (inDouble) {
      if (ch === '"') inDouble = false;
      i++;
      continue;
    }

    if (ch === "'") {
      inSingle = true;
      i++;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      i++;
      continue;
    }
    if (ch === "(") {
      depth++;
      i++;
      continue;
    }
    if (ch === ")") {
      depth--;
      i++;
      continue;
    }

    if (depth === 0) {
      if (ch === ",") {
        commas.push(i);
        i++;
        continue;
      }
      if (detectFrom && str.slice(i, i + 6) === " FROM ") {
        return { commas, fromIndex: i, endState: { inSingle, inDouble, depth } };
      }
    }

    i++;
  }

  return { commas, fromIndex: null, endState: { inSingle, inDouble, depth } };
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/** Span offsets into the source string; `fromStart` is the index of the top-level " FROM ". */
export function parseAggregatedSelectList(
  sql: string,
): { items: Array<{ start: number; end: number }>; fromStart: number } | null {
  const leadingWs = sql.length - sql.trimStart().length;
  if (!sql.slice(leadingWs).startsWith("SELECT ")) return null;

  const listStart = leadingWs + "SELECT ".length;
  const { commas, fromIndex, endState } = scanTopLevel(sql, listStart, true);

  if (fromIndex === null) return null;
  if (endState.depth !== 0 || endState.inSingle || endState.inDouble) return null;

  const starts = [listStart, ...commas.map((c) => c + 1)];
  const ends = [...commas, fromIndex];
  const items = starts.map((s, idx) => ({ start: s, end: ends[idx] }));

  return { items, fromStart: fromIndex };
}

const VALUE_SUFFIX = " AS value";

/** Returns the rewritten SQL, or null when the shape is not one this lib can safely rewrite. */
export function replaceValueSelectItem(sql: string, newExpr: string): string | null {
  return replaceAliasedSelectItem(sql, "value", newExpr);
}

/**
 * Replace the expression of the select item aliased `alias`. The primary `value` must be the LAST
 * item (the positional anchor above); a Data Table extra metric (`value_N`) may be any item, and
 * exactly one item may carry that alias. Same fail-closed rules as replaceValueSelectItem.
 */
export function replaceAliasedSelectItem(sql: string, alias: string, newExpr: string): string | null {
  const parsed = parseAggregatedSelectList(sql);
  if (!parsed) return null;

  const suffix = alias === "value" ? VALUE_SUFFIX : ` AS ${alias}`;
  const candidates = alias === "value"
    ? [parsed.items[parsed.items.length - 1]]
    : parsed.items.filter((it) => sql.slice(it.start, it.end).trim().endsWith(suffix));
  if (candidates.length !== 1) return null;
  const lastItem = candidates[0];
  const rawItemText = sql.slice(lastItem.start, lastItem.end);
  const trimmedText = rawItemText.trim();
  if (!trimmedText.endsWith(suffix)) return null;

  // Validate newExpr: non-empty, balanced on parens/quotes, no top-level comma.
  const trimmedExpr = newExpr.trim();
  if (trimmedExpr === "") return null;
  const exprScan = scanTopLevel(trimmedExpr, 0, false);
  if (exprScan.commas.length > 0) return null;
  if (exprScan.endState.depth !== 0 || exprScan.endState.inSingle || exprScan.endState.inDouble) {
    return null;
  }

  const leadingItemWs = rawItemText.length - rawItemText.trimStart().length;
  const exprStart = lastItem.start + leadingItemWs;
  const exprEnd = exprStart + trimmedText.length - suffix.length;

  return sql.slice(0, exprStart) + trimmedExpr + sql.slice(exprEnd);
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

export function applyLiveMetricExpr(
  storedSql: string | undefined,
  metricId: number | undefined,
  tableId: number | undefined,
  extraMetrics: readonly TableExtraMetric[] = [],
): LiveMetricSql {
  const customExtras = extraMetrics
    .map((m, i) => ({ m, alias: extraMetricAlias(i) }))
    .filter(({ m }) => isCustomSelection(m.metricId));
  if (!isCustomSelection(metricId) && customExtras.length === 0) return { kind: "ready", sql: storedSql };
  if (storedSql === undefined || tableId === undefined) return { kind: "ready", sql: storedSql };
  if (!isMetricsHydrated(tableId)) return { kind: "pending" };
  let sql = storedSql;
  // Each swap is independent and fail-closed: a deleted metric or an unparseable item leaves that
  // item's frozen text in place without blocking the others.
  if (isCustomSelection(metricId)) {
    const expr = resolveMetricExpr(metricId, "", tableId);
    if (expr !== null && expr.trim() !== "") sql = replaceValueSelectItem(sql, expr) ?? sql;
  }
  for (const { m, alias } of customExtras) {
    const expr = resolveMetricExpr(m.metricId, "", tableId);
    if (expr !== null && expr.trim() !== "") sql = replaceAliasedSelectItem(sql, alias, expr) ?? sql;
  }
  return { kind: "ready", sql };
}
