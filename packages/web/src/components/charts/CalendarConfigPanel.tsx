/**
 * Phase 66 Plan 03 (CAL-V113-02 + CAL-V113-05 cap portion):
 * CalendarConfigPanel — dv-aware custom config panel for the calendar chart type.
 *
 * Structural template: TimelineConfigPanel (Phase 45 Plan 02).
 *
 * Four divergences from TimelineConfigPanel:
 *   1. Data-source dropdown lists BOTH base tables AND dynamic views (dv-aware).
 *      Picking a dv dual-writes dynamicViewId + tableId + tableRef into config.
 *   2. SINGLE metric column + aggregation (not N-row builder).
 *   3. Dependent Domain/Subdomain dropdowns enforcing the 8 valid combos from
 *      VALID_DOMAIN_SUBDOMAIN — invalid subdomains are NOT rendered (hidden).
 *   4. Save-time cell-count cap probe via runSql + buildCalendarRangeQuery +
 *      estimateCalendarCells — hard-blocks configs over CELL_LIMIT.
 *
 * NO raw hex literals — theme tokens only (theme-guard auto-scan asserts this).
 */

import { useEffect, useMemo, useState } from "react";
import { MultiSelectChips } from "./MultiSelectChips";
import type { ConfigPanelProps } from "./registry";
import {
  inferDataTypeFromColumn,
  isColumnDrillDownSafe,
} from "../../lib/columnTypes";
import {
  isCustomSelection,
  encodeCustomValue,
  decodeMetricSelection,
  metricSelectValue,
  isOrphanedMetric,
} from "../../lib/customMetricSql";
import { useCustomMetricsStore, selectMetrics } from "../../store/customMetricsStore";
import { CB_COLOR_THEMES } from "../../lib/cbColorThemes";
import type { TimelineAggregation } from "../../lib/timelineBin";
import {
  VALID_DOMAIN_SUBDOMAIN,
  isValidCombo,
  CELL_LIMIT,
  SMART_SCALES,
  SMART_SCALE_TO_PAIR,
} from "../../lib/calendarBin";
import type { CalendarDomain, CalendarSubdomain, SmartScale } from "../../lib/calendarBin";
import {
  estimateCalendarCells,
  buildCalendarRangeQuery,
} from "../../lib/estimateCalendarCells";
import { runSql } from "../../api/client";
import { FilterSelectionPanel } from "./FilterSelectionPanel";
import type { FilterSelectionConfig } from "../../types/filterSelection";
import { useAuthStore } from "../../store/auth";

/* ------------------------------------------------------------------ */
/*  Exported types + defaults                                          */
/* ------------------------------------------------------------------ */

export type CalendarConfig = {
  tableId?: number;
  tableRef?: string;           // "schema.name"
  dynamicViewId?: number;      // set ONLY for dv binding (mutually exclusive intent)
  timeCol: string;
  metricColumn: string;        // "*" allowed (default) for COUNT
  metricId?: number;           // Phase 100 (METRIC-V119-01): custom metric id marker; absent → real column (byte-identical)
  aggregation: TimelineAggregation;
  domain: CalendarDomain;
  subdomain: CalendarSubdomain;
  colorTheme: string;          // ColorBrewer Sequential scheme id
  respondToFilters?: boolean;  // Phase 68-03: OFF = always read unfiltered source (default). ON = Phase 67 filter-aware behavior.
  layoutMode?: "wrap" | "strip";              // CALUX-V113-01: "wrap" = GitHub-style week blocks (default); "strip" = continuous horizontal strip
  showDomainSubdomainControls?: boolean;       // CALUX-V113-02: viewer dropdowns to change grouping live (default false / OFF)
  controlMode?: "advanced" | "advanced-adjustable" | "smart"; // Phase 97/103: absent → "advanced" (byte-identical legacy); "advanced-adjustable" = domain+subdomain viewer bar ON
  smartScale?: SmartScale;                     // selected Time scale when controlMode === "smart"
  allowedSmartScales?: SmartScale[];           // designer-restricted offered scales; default = all four
  customWhere?: string;                        // Phase 98 (VIZSQL-V119-01): raw SQL predicate ANDed into the query; absent → byte-identical
  filterSelection?: FilterSelectionConfig;     // Phase 109.1 (FSCOPE-V120-04): per-viz filter scope; absent → accept-all.
};

export const DEFAULT_CALENDAR_CONFIG: CalendarConfig = {
  timeCol: "",
  metricColumn: "*",
  aggregation: "COUNT",
  domain: "month",
  subdomain: "day",
  colorTheme: "Greens",
  respondToFilters: false,
  layoutMode: "wrap",
  showDomainSubdomainControls: false,
  controlMode: "advanced",
  smartScale: "day",
  allowedSmartScales: ["month", "week", "day", "hour"],
};

/* ------------------------------------------------------------------ */
/*  Aggregations — copied verbatim from TimelineConfigPanel lines 45-54 */
/* ------------------------------------------------------------------ */

const AGGREGATIONS: { value: TimelineAggregation; label: string }[] = [
  { value: "SUM",            label: "SUM" },
  { value: "AVG",            label: "AVG" },
  { value: "MIN",            label: "MIN" },
  { value: "MAX",            label: "MAX" },
  { value: "COUNT",          label: "COUNT" },
  { value: "COUNT_DISTINCT", label: "COUNT_DISTINCT" },
  { value: "STDDEV",         label: "STDDEV" },
  { value: "VARIANCE",       label: "VARIANCE" },
];

/* ------------------------------------------------------------------ */
/*  Decode the runSql response envelope (mirrors TimelineRenderer      */
/*  lines 86-100: column_headers + column_N indexed arrays).          */
/* ------------------------------------------------------------------ */

function decodeSqlResponse(payload: unknown): Record<string, unknown>[] {
  if (!payload || typeof payload !== "object") return [];
  const p = payload as Record<string, unknown>;
  const headers = p.column_headers as string[] | undefined;
  if (!Array.isArray(headers)) return [];
  const cols: unknown[][] = headers.map((_, i) => (p[`column_${i + 1}`] as unknown[]) ?? []);
  const len = cols[0]?.length ?? 0;
  const rows: Record<string, unknown>[] = [];
  for (let i = 0; i < len; i++) {
    const row: Record<string, unknown> = {};
    headers.forEach((h, j) => { row[h] = cols[j][i]; });
    rows.push(row);
  }
  return rows;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function CalendarConfigPanel({
  config,
  onChange,
  tables,
  dynamicViews,
  isValid,
  widgets,
  widgetId,
}: ConfigPanelProps): JSX.Element {
  const cfg = config as Partial<CalendarConfig>;
  const tableId = cfg.tableId;
  const tableRef = cfg.tableRef ?? "";
  const dynamicViewId = cfg.dynamicViewId;
  const dvFilterScopeDisabled = useAuthStore((s) => s.dvFilterScopeDisabled);
  const timeCol = cfg.timeCol ?? "";
  const metricColumn = cfg.metricColumn ?? DEFAULT_CALENDAR_CONFIG.metricColumn;
  const metricId = cfg.metricId as number | undefined;
  const aggregation = cfg.aggregation ?? DEFAULT_CALENDAR_CONFIG.aggregation;
  const domain = (cfg.domain ?? DEFAULT_CALENDAR_CONFIG.domain) as CalendarDomain;
  const subdomain = (cfg.subdomain ?? DEFAULT_CALENDAR_CONFIG.subdomain) as CalendarSubdomain;
  const colorTheme = cfg.colorTheme ?? DEFAULT_CALENDAR_CONFIG.colorTheme;
  const respondToFilters = cfg.respondToFilters ?? false;
  const layoutMode = (cfg.layoutMode ?? DEFAULT_CALENDAR_CONFIG.layoutMode) as "wrap" | "strip";
  const controlMode = (cfg.controlMode ?? DEFAULT_CALENDAR_CONFIG.controlMode) as "advanced" | "advanced-adjustable" | "smart";
  const smartScale = (cfg.smartScale ?? DEFAULT_CALENDAR_CONFIG.smartScale) as SmartScale;
  const allowedSmartScales: SmartScale[] =
    cfg.allowedSmartScales && cfg.allowedSmartScales.length > 0
      ? cfg.allowedSmartScales
      : (DEFAULT_CALENDAR_CONFIG.allowedSmartScales as SmartScale[]);
  const customWhere = cfg.customWhere ?? "";

  const allTables = tables ?? [];

  // Phase 100 (METRIC-V119-01/03): subscribe to configVersion so picker re-renders on metric edits.
  const customMetricsConfigVersion = useCustomMetricsStore((s) => s.configVersion);
  void customMetricsConfigVersion; // reactive via subscription

  // Load custom metrics for the current table on mount / table change.
  useEffect(() => {
    if (tableId !== undefined) {
      useCustomMetricsStore.getState().loadConfig(tableId).catch(() => {});
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableId]);

  // Phase 100: custom metrics for the current table (always independent of numeric-only filter).
  const customMetrics = tableId !== undefined ? selectMetrics(tableId) : [];

  // Cap probe state
  const [capState, setCapState] = useState<"idle" | "checking" | "ok" | "over">("idle");
  const [estimatedCells, setEstimatedCells] = useState<number | null>(null);

  /* ---------------------------------------------------------------- */
  /*  patch helper (identical to Timeline)                            */
  /* ---------------------------------------------------------------- */

  const patch = (partial: Partial<CalendarConfig>) => {
    onChange({ ...(config as Record<string, unknown>), ...partial });
  };

  /* ---------------------------------------------------------------- */
  /*  Data source: unified table + dv option list                     */
  /* ---------------------------------------------------------------- */

  // Current picker value: "dv:<id>" for dv binding, "schema.name" for table.
  const currentPickerValue = dynamicViewId !== undefined
    ? `dv:${dynamicViewId}`
    : (tableRef ?? "");

  // Resolve selected columns as a Record<name, type> for inferDataTypeFromColumn.
  const columns: Record<string, string> = useMemo(() => {
    if (dynamicViewId !== undefined) {
      // dv-bound: columns come from the dv's columns_json.
      const dv = dynamicViews?.find((d) => d.id === dynamicViewId);
      if (!dv || dv.columns_json == null) return {};
      const raw: unknown = typeof dv.columns_json === "string"
        ? (() => {
            try { return JSON.parse(dv.columns_json as string); } catch { return null; }
          })()
        : dv.columns_json;
      if (!Array.isArray(raw)) return {};
      const result: Record<string, string> = {};
      for (const col of raw as { name: string; type: string }[]) {
        result[col.name] = col.type;
      }
      return result;
    }
    // table-bound: from the selected table's columns map.
    if (tableId !== undefined) {
      const t = allTables.find((t) => t.id === tableId);
      return t?.columns ?? {};
    }
    return {};
  }, [dynamicViewId, tableId, dynamicViews, allTables]);

  /* ---------------------------------------------------------------- */
  /*  Timestamp columns (datetime-only)                               */
  /* ---------------------------------------------------------------- */

  const timeColumns = useMemo(
    () =>
      Object.keys(columns).filter(
        (name) => inferDataTypeFromColumn(name, columns) === "datetime",
      ),
    [columns],
  );

  /* ---------------------------------------------------------------- */
  /*  Metric columns (numeric + drilldown-safe)                       */
  /* ---------------------------------------------------------------- */

  const metricColumns = useMemo(
    () =>
      Object.entries(columns)
        .filter(
          ([name, type]) =>
            inferDataTypeFromColumn(name, columns) === "number" &&
            isColumnDrillDownSafe(type),
        )
        .map(([name]) => name),
    [columns],
  );

  /* ---------------------------------------------------------------- */
  /*  Sequential palette options                                      */
  /* ---------------------------------------------------------------- */

  const sequentialThemes = useMemo(
    () => CB_COLOR_THEMES.filter((t) => t.group === "Sequential"),
    [],
  );

  /* ---------------------------------------------------------------- */
  /*  Cell-count cap probe                                            */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    // Run the probe whenever source + timeCol + subdomain are all set.
    const fromTarget = tableRef; // "schema.table" — always resolved from the source table
    // For dv-bound widgets: fromTarget is the source table (config-time conservative upper bound).
    // The dv's materialized view is narrower than the source table, so probing the
    // source table gives a SAFE UPPER BOUND on actual cell count (Phase 67 uses the dv view at runtime).
    // Catch errors → capState "idle": the cap is a guard against KNOWN-large configs,
    // not a hard requirement that the probe succeed; probe failure never blocks save.
    if (!fromTarget || !timeCol || !subdomain) {
      setCapState("idle");
      setEstimatedCells(null);
      return;
    }

    const ctrl = new AbortController();
    let cancelled = false;

    setCapState("checking");

    const sql = buildCalendarRangeQuery({ fromTarget, timeCol });

    runSql(sql, undefined, ctrl.signal)
      .then((resp) => {
        if (cancelled) return;
        const rows = decodeSqlResponse(resp);
        const lo = Number(rows[0]?.lo ?? 0);
        const hi = Number(rows[0]?.hi ?? 0);
        if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) {
          setCapState("idle");
          setEstimatedCells(null);
          return;
        }
        const rangeMs = (hi - lo) * 1000; // EXTRACT(EPOCH) → seconds → ×1000 → ms
        const estimate = estimateCalendarCells({ rangeMs, subdomain });
        setEstimatedCells(estimate);
        setCapState(estimate > CELL_LIMIT ? "over" : "ok");
      })
      .catch(() => {
        if (!cancelled) {
          // Probe failed — do not block save (see comment above).
          setCapState("idle");
          setEstimatedCells(null);
        }
      });

    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, [tableRef, dynamicViewId, timeCol, subdomain]);

  /* ---------------------------------------------------------------- */
  /*  Validity + isValid wiring                                       */
  /* ---------------------------------------------------------------- */

  const comboValid = isValidCombo(domain, subdomain);
  const formValid =
    tableId !== undefined &&
    timeCol !== "" &&
    comboValid &&
    capState !== "over";

  useEffect(() => {
    isValid?.(formValid);
  }, [formValid, isValid]);

  /* ---------------------------------------------------------------- */
  /*  Handlers                                                        */
  /* ---------------------------------------------------------------- */

  const handleSourceChange = (value: string) => {
    if (value === "") {
      patch({
        tableId: undefined,
        tableRef: undefined,
        dynamicViewId: undefined,
        timeCol: "",
        metricColumn: "*",
        aggregation: "COUNT",
      });
      return;
    }

    if (value.startsWith("dv:")) {
      const dvId = Number.parseInt(value.slice(3), 10);
      const dv = dynamicViews?.find((d) => d.id === dvId);
      if (!dv) return;
      const srcTable = allTables.find((t) => t.id === dv.source_table_id);
      const srcFull = srcTable
        ? (srcTable.schema
            ? `${srcTable.schema}.${srcTable.name}`
            : srcTable.name)
        : "";
      patch({
        dynamicViewId: dvId,
        tableId: dv.source_table_id,
        tableRef: srcFull,
        timeCol: "",
        metricColumn: "*",
        aggregation: "COUNT",
      });
      return;
    }

    // Plain table pick — clear dynamicViewId (mutual exclusion).
    const parts = value.split(".");
    const newTable = allTables.find(
      (t) => `${t.schema}.${t.name}` === value || t.name === value,
    );
    if (!newTable) return;
    const full = newTable.schema
      ? `${newTable.schema}.${newTable.name}`
      : newTable.name;
    void parts; // consumed via allTables lookup above
    patch({
      tableId: newTable.id,
      tableRef: full,
      dynamicViewId: undefined,
      timeCol: "",
      metricColumn: "*",
      aggregation: "COUNT",
    });
  };

  const handleDomainChange = (newDomain: CalendarDomain) => {
    const validSubs = VALID_DOMAIN_SUBDOMAIN[newDomain];
    // If current subdomain is invalid for the new domain, reset to the first valid one.
    const newSub = (validSubs as readonly string[]).includes(subdomain)
      ? subdomain
      : validSubs[0];
    patch({ domain: newDomain, subdomain: newSub });
  };

  const handleSmartScaleChange = (scale: SmartScale) => {
    const pair = SMART_SCALE_TO_PAIR[scale];
    patch({ smartScale: scale, domain: pair.domain, subdomain: pair.subdomain });
  };

  const handleAllowedScalesChange = (next: string[]) => {
    // enforce ≥1: ignore a call that would leave the set empty
    if (next.length === 0) return;
    // re-establish SMART_SCALES canonical order
    const ordered = SMART_SCALES.filter((s) => next.includes(s));
    if (ordered.length === 0) return;
    // if the currently-selected smartScale is no longer allowed, snap it to the first allowed
    if (ordered.includes(smartScale)) {
      patch({ allowedSmartScales: ordered });
    } else {
      const nextSmart = ordered[0];
      const pair = SMART_SCALE_TO_PAIR[nextSmart];
      patch({ allowedSmartScales: ordered, smartScale: nextSmart, domain: pair.domain, subdomain: pair.subdomain });
    }
  };

  /* ---------------------------------------------------------------- */
  /*  Render                                                          */
  /* ---------------------------------------------------------------- */

  const validSubdomains = VALID_DOMAIN_SUBDOMAIN[domain];

  return (
    <div className="config-group" role="group" aria-labelledby="calendar-config-label">
      <label id="calendar-config-label" className="config-group-label">
        CALENDAR CONFIG
      </label>

      {/* ---- Data Source ---- */}
      <div className="ds-field">
        <span className="ds-field-label">Data source</span>
        <select
          className="ds-select"
          aria-label="Data source"
          value={currentPickerValue}
          onChange={(e) => handleSourceChange(e.target.value)}
        >
          <option value="">Select a data source...</option>

          {allTables.length > 0 && (
            <optgroup label="Tables">
              {allTables.map((t) => {
                const full = t.schema ? `${t.schema}.${t.name}` : t.name;
                return (
                  <option key={t.id} value={full}>
                    {full}
                  </option>
                );
              })}
            </optgroup>
          )}

          {(dynamicViews?.length ?? 0) > 0 && (
            <optgroup label="Dynamic Views">
              {dynamicViews!.map((dv) => (
                <option key={dv.id} value={`dv:${dv.id}`}>
                  {dv.name}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </div>

      {tableId === undefined ? (
        <div className="config-hint">Pick a data source first.</div>
      ) : (
        <>
          {/* ---- Timestamp column ---- */}
          <div className="ds-field">
            <span className="ds-field-label">Timestamp column</span>
            <select
              className="ds-select"
              aria-label="Timestamp column"
              value={timeCol}
              onChange={(e) => patch({ timeCol: e.target.value })}
            >
              <option value="">Pick a datetime column...</option>
              {timeColumns.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            {timeColumns.length === 0 && (
              <div className="config-hint">
                No datetime columns on this source. Pick a different data source.
              </div>
            )}
          </div>

          {/* ---- Metric column (Phase 100: custom-metric-aware) ---- */}
          <div className="ds-field">
            <span className="ds-field-label">Metric column</span>
            <select
              className="ds-select"
              aria-label="Metric column"
              value={metricSelectValue(metricId, metricColumn)}
              onChange={(e) => {
                const sel = decodeMetricSelection(e.target.value);
                if (sel.kind === "custom") {
                  patch({ metricId: sel.metricId, metricColumn: "" });
                } else {
                  patch({ metricId: undefined, metricColumn: sel.column });
                }
              }}
            >
              <option value="*">* (count rows)</option>
              {metricColumns.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
              <optgroup label="Custom metrics">
                {isOrphanedMetric(metricId, tableId) && (
                  <option value={encodeCustomValue(metricId!)}>(deleted metric)</option>
                )}
                {customMetrics.map((m) => (
                  <option key={m.id} value={encodeCustomValue(m.id)}>
                    {m.label}
                  </option>
                ))}
              </optgroup>
            </select>
          </div>

          {/* ---- Aggregation: hidden when a custom metric is selected ---- */}
          {!isCustomSelection(metricId) && (
          <div className="ds-field">
            <span className="ds-field-label">Aggregation</span>
            <select
              className="ds-select"
              aria-label="Aggregation"
              value={aggregation}
              onChange={(e) =>
                patch({ aggregation: e.target.value as TimelineAggregation })
              }
            >
              {AGGREGATIONS.map((a) => (
                <option key={a.value} value={a.value}>
                  {a.label}
                </option>
              ))}
            </select>
          </div>
          )}

          {/* ---- Control mode (Phase 97/103) ---- */}
          <div className="ds-field">
            <span className="ds-field-label">Time grouping control</span>
            <select
              className="ds-select"
              aria-label="Time grouping control"
              value={controlMode}
              onChange={(e) => {
                const value = e.target.value as "advanced" | "advanced-adjustable" | "smart";
                patch({ controlMode: value, showDomainSubdomainControls: value === "advanced-adjustable" });
              }}
            >
              <option value="advanced">Advanced (domain + subdomain)</option>
              <option value="advanced-adjustable">Advanced (domain + subdomain, dashboard adjustable)</option>
              <option value="smart">Smart (single time scale, dashboard adjustable)</option>
            </select>
          </div>

          {(controlMode === "advanced" || controlMode === "advanced-adjustable") && (
            <>
              {/* ---- Domain ---- */}
              <div className="ds-field">
                <span className="ds-field-label">Domain (rows)</span>
                <select
                  className="ds-select"
                  aria-label="Domain"
                  value={domain}
                  onChange={(e) => handleDomainChange(e.target.value as CalendarDomain)}
                >
                  {(Object.keys(VALID_DOMAIN_SUBDOMAIN) as CalendarDomain[]).map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </div>

              {/* ---- Subdomain — dependent on domain ---- */}
              <div className="ds-field">
                <span className="ds-field-label">Subdomain (cells)</span>
                <select
                  className="ds-select"
                  aria-label="Subdomain"
                  value={subdomain}
                  onChange={(e) => patch({ subdomain: e.target.value as CalendarSubdomain })}
                >
                  {validSubdomains.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>

              {/* ---- Combo-invalid defense-in-depth hint (normally unreachable) ---- */}
              {!comboValid && (
                <div className="config-hint" style={{ color: "var(--danger)" }}>
                  Invalid domain/subdomain combination. Please pick a valid pair.
                </div>
              )}
            </>
          )}

          {controlMode === "smart" && (
            <>
              <div className="ds-field">
                <span className="ds-field-label">Time scale</span>
                <select
                  className="ds-select"
                  aria-label="Time scale"
                  value={smartScale}
                  onChange={(e) => handleSmartScaleChange(e.target.value as SmartScale)}
                >
                  {SMART_SCALES.filter((s) => allowedSmartScales.includes(s)).map((s) => (
                    <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
                  ))}
                </select>
              </div>
              <div className="ds-field">
                <span className="ds-field-label">Allowed time scales</span>
                <MultiSelectChips
                  ariaLabel="Allowed time scales"
                  options={SMART_SCALES.slice()}
                  value={allowedSmartScales}
                  formatOption={(s) => s.charAt(0).toUpperCase() + s.slice(1)}
                  onChange={handleAllowedScalesChange}
                />
              </div>
            </>
          )}

          {/* ---- Color palette (Sequential only) ---- */}
          <div className="ds-field">
            <span className="ds-field-label">Color palette</span>
            <select
              className="ds-select"
              aria-label="Color palette"
              value={colorTheme}
              onChange={(e) => patch({ colorTheme: e.target.value })}
            >
              {sequentialThemes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>

          {/* ---- Respond to dashboard filters toggle (Phase 68-03) ---- */}
          <label className="config-toggle">
            <input
              type="checkbox"
              className="accent-checkbox"
              checked={respondToFilters}
              onChange={(e) => patch({ respondToFilters: e.target.checked })}
              aria-label="Respond to dashboard filters"
            />
            <span>Respond to dashboard filters</span>
          </label>

          {/* ---- Display section ---- */}
          <div className="config-group-label" style={{ marginTop: 16 }}>DISPLAY</div>

          {/* Layout mode */}
          <div className="ds-field">
            <span className="ds-field-label">Layout</span>
            <select
              className="ds-select"
              aria-label="Layout"
              value={layoutMode}
              onChange={(e) => patch({ layoutMode: e.target.value as "wrap" | "strip" })}
            >
              <option value="wrap">Wrap</option>
              <option value="strip">Continuous strip</option>
            </select>
          </div>

          {/* ---- Custom filter (SQL) — Phase 98 (VIZSQL-V119-01) ---- */}
          <div className="config-group-label" style={{ marginTop: 16 }}>CUSTOM FILTER</div>
          <div className="ds-field">
            <span className="ds-field-label">Custom filter (SQL)</span>
            <textarea
              className="config-textarea"
              value={customWhere}
              onChange={(e) => patch({ customWhere: e.target.value })}
              placeholder="Raw SQL predicate ANDed with active filters, e.g. region = 'West'"
              rows={3}
            />
          </div>

          {/* ---- Cap probe status ---- */}
          {capState === "checking" && (
            <div className="config-hint">Checking cell count...</div>
          )}
          {capState === "over" && estimatedCells !== null && (
            <div className="config-hint" style={{ color: "var(--danger)" }}>
              Estimated {estimatedCells.toLocaleString()} cells exceeds the{" "}
              {CELL_LIMIT.toLocaleString()} cap. Choose a coarser subdomain or a narrower
              domain.
            </div>
          )}

          {/* Phase 109.1 (FSCOPE-V120-04): per-visualization Filter Scope — mirrors
              ChartConfigPanel's generic usage. FilterSelectionPanel renders its own
              config-group wrapper; do NOT wrap it again. Hidden for dv-bound widgets
              when dvFilterScopeDisabled (matches the generic panel). */}
          {(() => {
            const filterSourceWidgets =
              dynamicViewId !== undefined
                ? (widgets ?? []).filter((w) => (w.config.dynamicViewId as number | undefined) === dynamicViewId)
                : (widgets ?? []);
            return !(dynamicViewId !== undefined && dvFilterScopeDisabled) && (
              <FilterSelectionPanel
                value={cfg.filterSelection as FilterSelectionConfig | undefined}
                onChange={(next) => patch({ filterSelection: next })}
                widgets={filterSourceWidgets}
                selfWidgetId={widgetId}
                allowSpatial={dynamicViewId === undefined}
              />
            );
          })()}
        </>
      )}
    </div>
  );
}
