/**
 * Phase 67 Plan 02 (CAL-V113-04 + CAL-V113-05):
 * CalendarRenderer — read-only SVG calendar heatmap.
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
import type { TimelineAggregation, TimelineIntervalKey } from "../../lib/timelineBin";
import { formatTimelineTick } from "../../lib/timelineBin";
import { useFilterStore } from "../../store/filterStore";
import { useFilterViewStore } from "../../store/filterViewStore";
import { useDynamicViewStore } from "../../store/dynamicViewStore";
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

  // ---- Scoped store selectors (PITFALL C-02 — never the whole map) ----
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const filterVersion = useFilterStore((s) => s.filterVersion);

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
    // Resolve the FROM view: table path uses fvViewName, dv path uses dvFilterViewName || dvViewName
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

    // Resolve fromTarget: view name is unprefixed (empty schema); else schema.table
    const fromTarget = fromView
      ? fromView
      : effectiveSchema
      ? `${effectiveSchema}.${effectiveTable}`
      : effectiveTable;

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
          domain,
          subdomain,
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    effectiveSchema,
    effectiveTable,
    timeCol,
    metricColumn,
    aggregation,
    domain,
    subdomain,
    filterVersion,
    fvViewName,
    fvExpiresAt,
    fvMaterializing,
    dvFilterViewName,
    dvFilterMaterializing,
    dvViewName,
    dvStatus,
  ]);

  // ---- Gap-fill (useMemo) ----
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const grid = useMemo(() => gapFillCalendar(data), [data]);

  // ---- Reactive color domain (useMemo — NOT init-once) ----
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const colorDomain = useMemo(() => computeDomain(data), [data]);
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const colors = useMemo(() => calendarBucketColors(colorTheme), [colorTheme]);

  // Theme-aware axis/empty cell colors (concrete strings for SVG attributes)
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const { axis, emptyCell } = useChartAxisColors();

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

  // ---- SVG layout ----
  const { domainKeys, subdomainKeys, rows: calendarRows } = grid;
  const colCount = domainKeys.length;
  const rowCount = subdomainKeys.length;

  const svgWidth = LEFT_AXIS_WIDTH + colCount * (CELL_PX + GAP);
  const svgHeight = TOP_AXIS_HEIGHT + rowCount * (CELL_PX + GAP);

  // Sparse subdomain label stride: show ~12 labels
  const labelStride = Math.max(1, Math.ceil(rowCount / 12));

  // Agg label for tooltip
  const aggLabel = `${aggregation}(${metricColumn})`;

  return (
    <div className="widget-calendar" style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%" }}>
      {/* Scrollable SVG wrapper */}
      <div style={{ overflow: "auto", flex: 1, width: "100%" }}>
        <svg
          data-testid="calendar-renderer"
          width={svgWidth}
          height={svgHeight}
          style={{ display: "block" }}
        >
          {/* ---- Domain axis (column headers, top) ---- */}
          {domainKeys.map((dk, ci) => (
            <text
              key={dk}
              x={LEFT_AXIS_WIDTH + ci * (CELL_PX + GAP) + CELL_PX / 2}
              y={TOP_AXIS_HEIGHT - 6}
              textAnchor="middle"
              fontSize={10}
              fill={axis}
            >
              {formatTimelineTick(dk, domain as TimelineIntervalKey)}
            </text>
          ))}

          {/* ---- Subdomain axis (row labels, left) ---- */}
          {subdomainKeys.map((sk, ri) =>
            ri % labelStride === 0 ? (
              <text
                key={sk}
                x={LEFT_AXIS_WIDTH - 4}
                y={TOP_AXIS_HEIGHT + ri * (CELL_PX + GAP) + CELL_PX / 2 + 4}
                textAnchor="end"
                fontSize={9}
                fill={axis}
              >
                {formatTimelineTick(sk, subdomain as TimelineIntervalKey)}
              </text>
            ) : null,
          )}

          {/* ---- Cell grid ---- */}
          {calendarRows.map((calRow, ci) =>
            calRow.cells.map((cell, ri) => {
              const x = LEFT_AXIS_WIDTH + ci * (CELL_PX + GAP);
              const y = TOP_AXIS_HEIGHT + ri * (CELL_PX + GAP);
              const isEmpty = cell.value === null;
              if (isEmpty) {
                return (
                  <rect
                    key={`${ci}-${ri}`}
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
              const timeSlice = `${formatTimelineTick(cell.domainKey, domain as TimelineIntervalKey)} / ${formatTimelineTick(cell.subdomainKey, subdomain as TimelineIntervalKey)}`;
              const tooltipText = `${timeSlice} · ${aggLabel}: ${numValue.toLocaleString()}`;

              return (
                <rect
                  key={`${ci}-${ri}`}
                  x={x}
                  y={y}
                  width={CELL_PX}
                  height={CELL_PX}
                  fill={fill}
                >
                  <title>{tooltipText}</title>
                </rect>
              );
            }),
          )}
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
