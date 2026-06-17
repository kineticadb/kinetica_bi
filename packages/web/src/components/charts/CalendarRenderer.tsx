/**
 * Phase 67 Plan 02 (CAL-V113-04 + CAL-V113-05):
 * CalendarRenderer — read-only SVG calendar heatmap.
 *
 * Phase 68 Plan 02 (CALDR-V113-01 + CALDR-V113-02):
 * Added cell-click BETWEEN drill dispatch + reactive selected-cell highlight.
 *
 * Owns its full data lifecycle (mirrors TimelineRenderer):
 *   - Resolves the FROM target via precedence (fvViewName || dvFilterViewName ||
 *     dvViewName || schema.table) BEFORE building the SQL string — no fromSwap.
 *   - Issues a SINGLE runSql(buildCalendarSql(...)) call.
 *   - Re-fetches on the filter-aware dep set (CAL-V113-05).
 *   - 2D gap-fill via gapFillCalendar (useMemo).
 *   - Reactive 5-bucket color scale via computeDomain + calendarBucketColors (useMemo).
 *   - Theme-grey empty cells (non-interactive, no tooltip).
 *   - Discrete Less→More legend.
 *   - Both-axis sparse labels via formatTimelineTick.
 *   - Per-cell tooltip (populated cells only).
 *   - Cell-click BETWEEN drill (table-bound → filters[tableId]; dv-bound → dvFilters[dvId]).
 *   - Toggle-off: re-clicking the active cell clears its BETWEEN filter.
 *   - Reactive selected-cell outline via appliedCell memo (mirrors TimelineRenderer appliedBand).
 *
 * NO raw hex — all colors via calendarBucketColors / useChartAxisColors.
 * NO import of materializeFilter / dropFilterView / fromSwap.
 */

import { useEffect, useMemo, useState } from "react";
import type { TableDto, WidgetDto } from "../../api/client";
import { runSql } from "../../api/client";
import { buildCalendarSql } from "../../lib/buildCalendarSql";
import {
  CALENDAR_BUCKET_COUNT,
  calendarBucketColors,
  computeDomain,
  quantizeToBucket,
} from "../../lib/calendarColorScale";
import { gapFillCalendar } from "../../lib/calendarGapFill";
import { useChartAxisColors } from "../../lib/chartColors";
import type { CalendarDomain, CalendarSubdomain } from "../../lib/calendarBin";
import { computeCellBounds, VALID_DOMAIN_SUBDOMAIN } from "../../lib/calendarBin";
import { layoutCalendar, WEEK_START } from "../../lib/calendarLayout";
import type { TimelineAggregation, TimelineIntervalKey } from "../../lib/timelineBin";
import { formatTimelineTick } from "../../lib/timelineBin";
import { useFilterStore, type ActiveFilter } from "../../store/filterStore";
import { useFilterViewStore } from "../../store/filterViewStore";
import { useDynamicViewStore } from "../../store/dynamicViewStore";
import { useToastStore } from "../../store/toast";
import { buildChipText } from "../../lib/columnTypes";
import { useDashboardContext } from "../DashboardContext";
import type { CalendarConfig } from "./CalendarConfigPanel";

/* ------------------------------------------------------------------ */
/*  Layout constants                                                   */
/* ------------------------------------------------------------------ */

const CELL_PX = 14;
const GAP = 2;
const LEFT_AXIS_WIDTH = 52;
const TOP_AXIS_HEIGHT = 32;
const LEGEND_HEIGHT = 28;
const LEGEND_SWATCH = 14;

/* ------------------------------------------------------------------ */
/*  decodeSqlResponse — verbatim from TimelineRenderer.tsx lines 86-100 */
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
/*  CalendarRow type for decoded SQL output                            */
/* ------------------------------------------------------------------ */

type CalendarSqlRow = {
  domain_bucket: string;
  subdomain_bucket: string;
  value: number | null;
};

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function CalendarRenderer({
  widget,
  tables: _tables,
}: {
  widget: WidgetDto;
  tables: TableDto[];
}): JSX.Element {
  const cfg = (widget.config ?? {}) as Partial<CalendarConfig>;
  const tableId = cfg.tableId;
  const tableRef = cfg.tableRef;
  const dynamicViewId = cfg.dynamicViewId;
  const timeCol = cfg.timeCol ?? "";
  const metricColumn = cfg.metricColumn ?? "*";
  const aggregation: TimelineAggregation = cfg.aggregation ?? "COUNT";
  const domain: CalendarDomain = cfg.domain ?? "month";
  const subdomain: CalendarSubdomain = cfg.subdomain ?? "day";
  const colorTheme = cfg.colorTheme ?? "Greens";
  // Phase 68-03: OFF (default) = always read unfiltered source; ON = Phase 67 filter-aware behavior.
  const respondToFilters = cfg.respondToFilters ?? false;
  // Phase 68.1-03: layout mode + viewer control bar gate.
  const layoutMode = cfg.layoutMode ?? "wrap";
  const showControls = cfg.showDomainSubdomainControls ?? false;

  // ---- Empty-state gates (before hooks — mirroring TimelineRenderer eslint-disable pattern) ----
  // eslint-disable-next-line react-hooks/rules-of-hooks
  if (tableId === undefined || tableRef === undefined) {
    return (
      <div className="widget-calendar widget-calendar--empty">
        <div className="config-hint">Widget not configured. Open config to pick a data source.</div>
      </div>
    );
  }
  if (timeCol === "") {
    return (
      <div className="widget-calendar widget-calendar--empty">
        <div className="config-hint">No time column selected.</div>
      </div>
    );
  }

  // Parse tableRef "schema.name"
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const [schemaName, baseTableName] = (tableRef ?? ".").split(".");
  const effectiveSchema = dynamicViewId !== undefined ? "" : (schemaName ?? "");
  const effectiveTable = baseTableName ?? "";

  // ---- Dashboard context (for markMaterializing / markDvMaterializing) ----
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const { dashboardId } = useDashboardContext();

  // ---- Scoped store selectors (PITFALL C-02 — never the whole map) ----
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const filterVersion = useFilterStore((s) => s.filterVersion);

  // Active filters for the applied-cell memo (table path vs dv path)
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const activeFilters = useFilterStore((s) =>
    dynamicViewId !== undefined
      ? (s.dvFilters[dynamicViewId] ?? [])
      : (s.filters[tableId] ?? []),
  );

  // Table path selectors
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const fvViewName = useFilterViewStore((s) => s.views[tableId]?.viewName);
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const fvExpiresAt = useFilterViewStore((s) => s.views[tableId]?.expiresAt ?? 0);
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const fvMaterializing = useFilterViewStore((s) => s.views[tableId]?.materializing ?? false);

  // DV path selectors (WidgetRenderer §425-446)
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const dvEntry = useDynamicViewStore((s) =>
    dynamicViewId !== undefined ? s.views[dynamicViewId] : undefined,
  );
  const dvStatus = dvEntry?.status;
  const dvViewName = dvEntry?.viewName;

  // eslint-disable-next-line react-hooks/rules-of-hooks
  const dvFilterEntry = useFilterViewStore((s) =>
    dynamicViewId !== undefined ? s.dvViews[dynamicViewId] : undefined,
  );
  const dvFilterViewName = dvFilterEntry?.viewName;
  const dvFilterMaterializing = dvFilterEntry?.materializing ?? false;

  // ---- Reactive appliedCell memo (mirrors TimelineRenderer appliedBand, §173-180) ----
  // Finds the active BETWEEN filter on timeCol; captures [lo, hi] as the active bounds.
  // Used for: (1) selected-cell outline, (2) toggle-off equality test.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const appliedCell: [string, string] | null = useMemo(() => {
    const f = activeFilters.find(
      (af) =>
        af.column === timeCol &&
        af.operator === "between" &&
        Array.isArray(af.value) &&
        af.value.length === 2,
    );
    if (!f) return null;
    const [lo, hi] = f.value as [unknown, unknown];
    return [String(lo), String(hi)];
  }, [activeFilters, timeCol]);

  // ---- VIEW-LOCAL viewer override state (CALUX-V113-02) ----
  // Viewer dropdown overrides — never call patch/onChange (view-local; resets on reload).
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const [viewerDomain, setViewerDomain] = useState<CalendarDomain | null>(null);
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const [viewerSubdomain, setViewerSubdomain] = useState<CalendarSubdomain | null>(null);
  // Effective values: viewer override ?? operator config. Used EVERYWHERE (SQL, labels, bounds, drill).
  const effDomain: CalendarDomain = viewerDomain ?? domain;
  const effSubdomain: CalendarSubdomain = viewerSubdomain ?? subdomain;

  // ---- Data fetch state ----
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const [data, setData] = useState<CalendarSqlRow[]>([]);
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const [loading, setLoading] = useState(true);
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const [error, setError] = useState<string | null>(null);

  // ---- useEffect fetch: resolve FROM target BEFORE building SQL (NO fromSwap) ----
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    // Phase 68-03: gate FROM resolution on respondToFilters.
    //   OFF (default): ignore filter views → always read unfiltered source.
    //   ON: Phase 67 full filter-aware precedence.
    let fromTarget: string;

    if (respondToFilters) {
      // ON: Phase 67 filter-aware precedence —
      //   table path: fvViewName || schema.table
      //   dv path: dvFilterViewName ?? dvViewName
      const fromView =
        dynamicViewId === undefined ? fvViewName : (dvFilterViewName ?? dvViewName);

      // Table path suspend/expiry gates
      if (dynamicViewId === undefined) {
        if (fvMaterializing) return;
        if (fvViewName && fvExpiresAt > 0 && Date.now() >= fvExpiresAt) {
          useFilterViewStore.getState().clearView(tableId);
          return;
        }
      }

      // DV path gates
      if (dynamicViewId !== undefined) {
        if (dvFilterMaterializing) return;
        if (dvStatus !== "materialized") return;
      }

      // Resolve fromTarget with filter-aware view precedence
      fromTarget = fromView
        ? fromView
        : effectiveSchema
        ? `${effectiveSchema}.${effectiveTable}`
        : effectiveTable;
    } else {
      // OFF (default): skip filter views entirely; read the unfiltered source.
      //   table-bound: schema.table (base table)
      //   dv-bound: raw dvViewName (not dvFilterViewName)

      // DV path gate: raw dv view must still be materialized and present
      if (dynamicViewId !== undefined) {
        if (dvStatus !== "materialized") return;
        if (!dvViewName) return;
        fromTarget = dvViewName;
      } else {
        // Table path: base table always available, no materializing wait needed
        fromTarget = effectiveSchema
          ? `${effectiveSchema}.${effectiveTable}`
          : effectiveTable;
      }
    }

    const ctrl = new AbortController();
    let cancelled = false;

    async function fetchData() {
      setLoading(true);
      setError(null);
      try {
        const sql = buildCalendarSql({
          fromTarget,
          timeCol,
          metricColumn,
          aggregation,
          domain: effDomain,
          subdomain: effSubdomain,
        });
        const resp = await runSql(sql, undefined, ctrl.signal);
        const rows = decodeSqlResponse(resp).map((r) => ({
          domain_bucket: String(r.domain_bucket),
          subdomain_bucket: String(r.subdomain_bucket),
          value:
            typeof r.value === "number" && Number.isFinite(r.value)
              ? r.value
              : r.value == null
              ? null
              : Number(r.value),
        }));
        if (!cancelled) {
          setData(rows);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled && (err as Error).name !== "AbortError") {
          setError((err as Error).message);
          setLoading(false);
        }
      }
    }

    void fetchData();
    return () => {
      cancelled = true;
      ctrl.abort();
    };
    // Re-fetch when config or filter-aware deps change (CAL-V113-05).
    // respondToFilters in dep array: toggling re-resolves the FROM target.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    effectiveSchema,
    effectiveTable,
    timeCol,
    metricColumn,
    aggregation,
    effDomain,
    effSubdomain,
    respondToFilters,
    filterVersion,
    fvViewName,
    fvExpiresAt,
    fvMaterializing,
    dvFilterViewName,
    dvFilterMaterializing,
    dvViewName,
    dvStatus,
  ]);

  // ---- Gap-fill (useMemo) — per-group, date-range-aware (68.2-03) ----
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const grid = useMemo(() => gapFillCalendar(data, effDomain, effSubdomain), [data, effDomain, effSubdomain]);

  // ---- Wrapped / strip block layout (CALUX-V113-01) — MUST be before early returns ----
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const blocks = useMemo(
    () => layoutCalendar({ rows: grid.rows, domain: effDomain, subdomain: effSubdomain }),
    [grid, effDomain, effSubdomain],
  );

  // ---- Reactive color domain (useMemo — NOT init-once) ----
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const colorDomain = useMemo(() => computeDomain(data), [data]);
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const colors = useMemo(() => calendarBucketColors(colorTheme), [colorTheme]);

  // Theme-aware axis/empty cell colors (concrete strings for SVG attributes)
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const { axis, emptyCell, accent } = useChartAxisColors();

  // ---- Render states ----
  if (loading) {
    return (
      <div className="widget-calendar" data-testid="calendar-loading">
        Loading…
      </div>
    );
  }
  if (error) {
    return (
      <div className="widget-calendar" data-testid="calendar-error" style={{ color: "var(--danger)" }}>
        {error}
      </div>
    );
  }
  if (data.length === 0 || colorDomain === null) {
    return (
      <div className="widget-calendar" data-testid="calendar-empty">
        No data for this time range
      </div>
    );
  }

  // ---- Cell-click handler (CALDR-V113-01 + CALDR-V113-02) ----
  // SOLE-TRIGGER INVARIANT: only writes filter stores; AggregatedWidgetRenderer Effect 1 materializes.
  // Does NOT import materializeFilter / dropFilterView / fromSwap.
  // Note: tableId is guaranteed non-undefined at this point (early-return guard above the hooks),
  // but TypeScript cannot narrow through closures, so we cast to number where needed.
  function handleCellClick(cell: { value: number | null; subdomainKey: string; domainKey: string }) {
    // Guard: empty/grey cells are inert
    if (cell.value === null) return;

    const tid = tableId as number; // narrowed by the early-return guard above hooks
    const [cellStart, cellEnd] = computeCellBounds(cell.subdomainKey, effSubdomain);

    // Toggle-off: if the active filter matches this exact cell, clear it
    if (
      appliedCell !== null &&
      appliedCell[0] === cellStart &&
      appliedCell[1] === cellEnd
    ) {
      if (dynamicViewId !== undefined) {
        useFilterStore.getState().removeDvFilter(dynamicViewId, timeCol);
        useFilterViewStore.getState().markDvMaterializing(dynamicViewId, dashboardId);
      } else {
        useFilterStore.getState().removeFilter(tid, timeCol);
        useFilterViewStore.getState().markMaterializing(tid, dashboardId);
      }
      return;
    }

    // Build the BETWEEN ActiveFilter
    const filter: ActiveFilter = {
      column: timeCol,
      value: [cellStart, cellEnd] as [string, string],
      operator: "between",
      dataType: "datetime",
      sourceWidgetId: widget.id,
      addedAt: Date.now(),
    };

    // Dispatch — table-bound vs dv-bound routing (CALDR-V113-02 dv-isolation)
    if (dynamicViewId !== undefined) {
      useFilterStore.getState().addDvFilter(dynamicViewId, filter);
      useFilterViewStore.getState().markDvMaterializing(dynamicViewId, dashboardId);
    } else {
      useFilterStore.getState().setBulkFilters(tid, [filter]);
      useFilterViewStore.getState().markMaterializing(tid, dashboardId);
    }

    // Toast: show human-readable slice label on a new drill
    const chipText = buildChipText(timeCol, [cellStart, cellEnd], "datetime", "between");
    useToastStore.getState().showToast(chipText, "info");
  }

  // ---- Viewer control-bar handlers (view-local; mirrors CalendarConfigPanel.handleDomainChange pattern) ----
  function handleViewerDomainChange(d: CalendarDomain) {
    setViewerDomain(d);
    const valid = VALID_DOMAIN_SUBDOMAIN[d];
    if (!(valid as readonly string[]).includes(effSubdomain)) {
      setViewerSubdomain(valid[0]);
    }
  }
  function handleViewerSubdomainChange(s: CalendarSubdomain) {
    setViewerSubdomain(s);
  }

  // Layout constants for block rendering
  const LABEL_HEIGHT = TOP_AXIS_HEIGHT;  // height above each block for the group label
  const DOW_GUTTER = LEFT_AXIS_WIDTH;    // left gutter for sparse DOW labels (day subdomain)
  const BLOCK_GAP = 16;                  // gap between adjacent blocks

  // DOW label rows to show in the left gutter (Mon/Wed/Fri = rows 0,2,4 with WEEK_START=Monday)
  const DOW_LABELS = ["Mon", "Wed", "Fri"];
  const DOW_LABEL_ROWS = [0, 2, 4];

  // Compute block pixel dimensions
  function blockPixelWidth(b: { cols: number }): number {
    return (effSubdomain === "day" ? DOW_GUTTER : 0) + b.cols * (CELL_PX + GAP);
  }
  function blockPixelHeight(b: { rows: number }): number {
    return LABEL_HEIGHT + b.rows * (CELL_PX + GAP);
  }

  // Compute absolute block origins for the chosen layoutMode.
  // "wrap": blocks flow left→right; when running x + block width > WRAP_WIDTH, wrap.
  // "strip": all blocks in a single horizontal row.
  const WRAP_WIDTH = 800; // wrap column breakpoint (px); scrollable wrapper handles overflow
  type BlockOrigin = { bx: number; by: number };
  const blockOrigins: BlockOrigin[] = [];
  {
    let curX = 0;
    let curY = 0;
    let rowMaxH = 0;
    for (const b of blocks) {
      const bw = blockPixelWidth(b);
      const bh = blockPixelHeight(b);
      if (layoutMode === "wrap" && curX > 0 && curX + bw > WRAP_WIDTH) {
        // Wrap to next row
        curX = 0;
        curY += rowMaxH + BLOCK_GAP;
        rowMaxH = 0;
      }
      blockOrigins.push({ bx: curX, by: curY });
      curX += bw + BLOCK_GAP;
      rowMaxH = Math.max(rowMaxH, bh);
    }
  }

  // Total SVG dimensions
  const svgWidth = blockOrigins.length > 0
    ? Math.max(...blockOrigins.map((o, i) => o.bx + blockPixelWidth(blocks[i])))
    : 0;
  const svgHeight = blockOrigins.length > 0
    ? Math.max(...blockOrigins.map((o, i) => o.by + blockPixelHeight(blocks[i])))
    : 0;

  // Agg label for tooltip
  const aggLabel = `${aggregation}(${metricColumn})`;

  return (
    <div className="widget-calendar" style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%" }}>
      {/* ---- Config-gated viewer control bar (CALUX-V113-02) ---- */}
      {showControls && (
        <div data-testid="calendar-control-bar" style={{ display: "flex", gap: 8, padding: "4px 8px", flexShrink: 0 }}>
          <select
            className="ds-select"
            aria-label="Domain"
            value={effDomain}
            onChange={(e) => handleViewerDomainChange(e.target.value as CalendarDomain)}
          >
            {(Object.keys(VALID_DOMAIN_SUBDOMAIN) as CalendarDomain[]).map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
          <select
            className="ds-select"
            aria-label="Subdomain"
            value={effSubdomain}
            onChange={(e) => handleViewerSubdomainChange(e.target.value as CalendarSubdomain)}
          >
            {VALID_DOMAIN_SUBDOMAIN[effDomain].map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
      )}

      {/* Scrollable SVG wrapper */}
      <div style={{ overflow: "auto", flex: 1, width: "100%" }}>
        <svg
          data-testid="calendar-renderer"
          width={svgWidth}
          height={svgHeight}
          style={{ display: "block" }}
        >
          {/* ---- Block-based render: one <g> per domain group (CALUX-V113-01) ---- */}
          {blocks.map((block, bi) => {
            const { bx, by } = blockOrigins[bi];
            const gutterW = effSubdomain === "day" ? DOW_GUTTER : 0;
            const cellsOriginX = bx + gutterW;
            const cellsOriginY = by + LABEL_HEIGHT;

            return (
              <g key={block.domainKey}>
                {/* Per-block group label (domain-level) */}
                <text
                  x={bx + gutterW + (block.cols * (CELL_PX + GAP)) / 2}
                  y={by + LABEL_HEIGHT - 6}
                  textAnchor="middle"
                  fontSize={10}
                  fill={axis}
                >
                  {formatTimelineTick(block.domainKey, effDomain as TimelineIntervalKey)}
                </text>

                {/* Sparse DOW labels down the left gutter (day subdomain only: Mon/Wed/Fri) */}
                {effSubdomain === "day" && DOW_LABEL_ROWS.map((rowIdx, li) => (
                  <text
                    key={DOW_LABELS[li]}
                    x={bx + gutterW - 4}
                    y={cellsOriginY + rowIdx * (CELL_PX + GAP) + CELL_PX / 2 + 4}
                    textAnchor="end"
                    fontSize={9}
                    fill={axis}
                  >
                    {DOW_LABELS[li]}
                  </text>
                ))}

                {/* Cells */}
                {block.cells.map((pc) => {
                  const x = cellsOriginX + pc.col * (CELL_PX + GAP);
                  const y = cellsOriginY + pc.row * (CELL_PX + GAP);
                  const cell = pc.cell;
                  const isEmpty = cell.value === null;

                  if (isEmpty) {
                    return (
                      <rect
                        key={`${block.domainKey}-${pc.col}-${pc.row}`}
                        x={x}
                        y={y}
                        width={CELL_PX}
                        height={CELL_PX}
                        fill={emptyCell}
                        data-empty="true"
                        style={{ pointerEvents: "none" }}
                      />
                    );
                  }

                  const numValue = cell.value as number;
                  const fill = colors[quantizeToBucket(numValue, colorDomain, CALENDAR_BUCKET_COUNT)];
                  const timeSlice = `${formatTimelineTick(cell.domainKey, effDomain as TimelineIntervalKey)} / ${formatTimelineTick(cell.subdomainKey, effSubdomain as TimelineIntervalKey)}`;
                  const tooltipText = `${timeSlice} · ${aggLabel}: ${numValue.toLocaleString()}`;

                  // Reactive selected-cell outline: match this cell's bounds against the active BETWEEN filter
                  const [cellStart, cellEnd] = computeCellBounds(cell.subdomainKey, effSubdomain);
                  const isActive =
                    appliedCell !== null &&
                    appliedCell[0] === cellStart &&
                    appliedCell[1] === cellEnd;

                  return (
                    <rect
                      key={`${block.domainKey}-${pc.col}-${pc.row}`}
                      x={x}
                      y={y}
                      width={CELL_PX}
                      height={CELL_PX}
                      fill={fill}
                      stroke={isActive ? accent : "none"}
                      strokeWidth={isActive ? 2 : 0}
                      onClick={() => handleCellClick(cell)}
                      style={{ cursor: "pointer" }}
                    >
                      <title>{tooltipText}</title>
                    </rect>
                  );
                })}
              </g>
            );
          })}
        </svg>
      </div>

      {/* ---- Discrete Less→More legend ---- */}
      <div
        data-testid="calendar-legend"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          height: LEGEND_HEIGHT,
          padding: "4px 8px",
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: 11, color: axis }}>Less</span>
        {colors.map((c, i) => (
          <span
            key={i}
            style={{
              display: "inline-block",
              width: LEGEND_SWATCH,
              height: LEGEND_SWATCH,
              background: c,
            }}
          />
        ))}
        <span style={{ fontSize: 11, color: axis }}>More</span>
      </div>
    </div>
  );
}
