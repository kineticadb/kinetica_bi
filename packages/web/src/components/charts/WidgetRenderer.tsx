import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import MapChartRenderer from "./MapChartRenderer";
import WidgetErrorBoundary from "../WidgetErrorBoundary";
import InfoCardRenderer from "./InfoCardRenderer";
import LegendRenderer from "./LegendRenderer";
import DataFilterRenderer from "./DataFilterRenderer";
import RadioGroupRenderer from "./RadioGroupRenderer";
import TimelineRenderer from "./TimelineRenderer";
import CalendarRenderer from "./CalendarRenderer";
import NumericLineRenderer from "./NumericLineRenderer";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { runSql, materializeFilter, dropFilterView } from "../../api/client";
import type { WidgetDto, TableDto } from "../../api/client";
import { isViewNotFoundError } from "../../lib/kineticaErrors";
import {
  useFilterStore,
  type ActiveFilter,
} from "../../store/filterStore";
import { useFilterViewStore } from "../../store/filterViewStore";
import { useFilterCombinationStore } from "../../store/filterCombinationStore";
import { NOFILTER_SENTINEL } from "../../lib/stableComboHash";
// Phase 35 Plan 05 (DV-V16-13/14): dynamic-view scoped selectors for dv-bound widgets.
// Effect 2 (chart-query) flips viewName source to useDynamicViewStore when
// widget.config.dynamicViewId is set; render-body status gates branch on dvStatus.
// Phase 94 (FSCOPE-V118-03): Effect 1 (AggregatedWidgetRenderer filter-view materialize trigger)
// REMOVED — the combination orchestrator (useCombinationOrchestrator) is now the sole trigger.
import { useDynamicViewStore } from "../../store/dynamicViewStore";
import { useDashboardContext } from "../DashboardContext";
import { useSpatialFilterStore } from "../../store/spatialFilterStore";
import { aggregateSpatialTargetsByTable } from "../../lib/spatialTargets";
import { fromSwap } from "../../lib/fromSwap";
import { useChartAxisColors } from "../../lib/chartColors";
import { buildChipText, type DrillDownDataType } from "../../lib/columnTypes";
import { formatBigNumberValue, pickBigNumberColor, type BigNumberColorRule } from "../../lib/bigNumberFormat";
import { rowsToCsv, buildCsvFilename } from "../../lib/csvExport";
import { useToastStore } from "../../store/toast";
import { useWidgetActionStore } from "../../store/widgetActionStore";
// Phase 77 Plan 01 (COLAPPLY-V115-01): column display config resolution for RecordsTableRenderer.
// Phase 77 Plan 02 (COLAPPLY-V115-02): ColumnFormatTooltip for chart renderers.
import {
  useColumnDisplayConfigStore,
  resolveLabel,
  resolveFormatter,
} from "../../store/columnDisplayConfigStore";
import { ColumnFormatTooltip } from "./ColumnFormatTooltip";
import { buildFormatter, type FormatSpec } from "../../lib/columnFormatter";
import { estimateValueAxisWidth } from "../../lib/estimateAxisWidth";
import {
  RECHARTS_TOOLTIP_PROPS,
  DEFAULT_CHART_PALETTE,
  DEFAULT_BAR_COLOR,
  DEFAULT_LINE_COLOR,
  DEFAULT_SCATTER_COLOR,
  DEFAULT_TABLE_BAR_COLOR,
  DEFAULT_BIGNUMBER_COLOR,
} from "../../lib/chartTheme";
import { whereCustomWhere } from "../../lib/customWhere";

type Props = {
  widget: WidgetDto;
  /**
   * Phase 42 (Plan 42-01): callback to request the widget config modal to open.
   * Threaded down from DashboardsPage (which owns setConfiguringWidget state).
   * Consumed by Plan 42-02 LegendRenderer's Reconfigure button. Optional — non-legend
   * renderers ignore.
   */
  onConfigureWidget?: (widget: WidgetDto) => void;
};

type WidgetRendererProps = Props & {
  tables?: TableDto[];
};

type Row = Record<string, unknown>;

/* ------------------------------------------------------------------ */
/*  Phase 10 DRILL-01 + DRILL-04 — drill-down click dispatcher         */
/* ------------------------------------------------------------------ */

/**
 * Dispatch a drill-down click into useFilterStore.
 *
 * Pre-checks the store state for dedupe/replace status BEFORE the addFilter
 * dispatch, so the confirmation toast fires only on first add for a previously
 * unfiltered column. Phase 9 dedupe + replace paths keep the chip change as
 * feedback (CONTEXT.md "Toast suppression rules").
 *
 * Caller MUST handle:
 *   - dim-peers transient via local clickedElement state
 *   - 300ms setTimeout BEFORE invoking this function (PITFALL C-03 sequencing —
 *     the dim render must be visible before Phase 9's data-clear → loading takes over)
 *
 * AP-3 lock (v1.3): value is passed verbatim to addFilter; SQL escaping is now
 * SERVER-SIDE in packages/server/src/lib/whereClause.ts (Phase 13 VIEW-V13-06).
 * Phase 15-02 deleted the client-side counterparts; FROM-swap (Plan 15-02) consumes
 * the server-built view name. Never bypass server-side escaping.
 */
function dispatchDrillDown(args: {
  // Phase 63 (DVDRILL-V112-01): tableId optional — a dv-backed widget may carry no tableId.
  tableId?: number;
  // Phase 63 (DVDRILL-V112-01): when present, route the drill into the dv-scoped slice
  // (dvFilters[dynamicViewId]) INSTEAD of the table-keyed slice. This is the root-cause fix —
  // pre-v1.12 the drill always keyed by tableId, so a dv drill mis-landed in filters[sourceTableId].
  dynamicViewId?: number;
  dashboardId: number;
  column: string;
  value: unknown;
  dataType: DrillDownDataType;
  widgetId: number;
}): void {
  const { tableId, dynamicViewId, dashboardId, column, value, dataType, widgetId } = args;

  // ── Phase 63 dv branch ────────────────────────────────────────────────────
  // When the widget is dv-bound, the drill filters THAT dynamic view's data (dv-isolated
  // scope, LOCKED). Mirrors the table path VERBATIM but reads/writes the dv slices:
  // dvFilters[dvId] for dedupe + addDvFilter; markDvMaterializing for the sync gate.
  // The source table's filters[tableId] is NEVER touched (the bug was exactly that).
  if (dynamicViewId !== undefined) {
    const existing = useFilterStore.getState().dvFilters[dynamicViewId] ?? [];
    const sameCol = existing.find((f) => f.column === column);
    const isDedupe =
      sameCol !== undefined && sameCol.value === (value as ActiveFilter["value"]);
    const isReplace = sameCol !== undefined && !isDedupe;

    if (!isDedupe && !isReplace) {
      const chipText = buildChipText(column, value, dataType);
      useToastStore.getState().showToast(chipText, "info");
    }

    useFilterStore.getState().addDvFilter(dynamicViewId, {
      column,
      value: value as ActiveFilter["value"],
      dataType,
      sourceWidgetId: widgetId,
      addedAt: Date.now(),
    });

    // Sync materializing flag on the dv slice (mirrors the table path's markMaterializing).
    // Skip on dedupe: filterVersion does NOT tick on dedupe, so no Effect 1 re-fire.
    if (!isDedupe) {
      useFilterViewStore.getState().markDvMaterializing(dynamicViewId, dashboardId);
    }
    return;
  }

  // ── Table path (UNCHANGED) ────────────────────────────────────────────────
  // A dv widget may have no tableId; the table path requires one. Defensive guard.
  if (tableId === undefined) return;
  const existing = useFilterStore.getState().filters[tableId] ?? [];
  const sameCol = existing.find((f) => f.column === column);
  const isDedupe =
    sameCol !== undefined && sameCol.value === (value as ActiveFilter["value"]);
  const isReplace = sameCol !== undefined && !isDedupe;

  // First-add (column not in filters): show confirmation toast with chip text.
  // Suppressed on dedupe (no change) and replace (chip change is the feedback).
  if (!isDedupe && !isReplace) {
    const chipText = buildChipText(column, value, dataType);
    useToastStore.getState().showToast(chipText, "info");
  }

  // Dispatch — addFilter handles dedupe/replace/cap internally (Phase 9 lock).
  useFilterStore.getState().addFilter(tableId, {
    column,
    value: value as ActiveFilter["value"],
    dataType,
    sourceWidgetId: widgetId,
    addedAt: Date.now(),
  });

  // Phase 17-03 gap-closure: flip the view-store entry's materializing flag SYNCHRONOUSLY with
  // addFilter. Pre-17-03, markMaterializing was buried inside Effect 1's 300ms setTimeout, leaving
  // a t=0..t=300 window where Effect 2 (chart SQL), Effect 3 (WMS), and RecordsTableRenderer effects
  // all raced ahead and fired queries against raw FROM/LAYERS. By marking here — in the same
  // synchronous tick as addFilter — by the time React re-renders subscribers, the entry already
  // has materializing=true and every renderer's suspend gate engages.
  // Skip on dedupe: filterVersion does NOT tick on dedupe (Phase 9 lock), so no Effect 1 re-fire,
  // no materialize POST. Marking here would leave materializing=true with no setView ever firing.
  if (!isDedupe) {
    useFilterViewStore.getState().markMaterializing(tableId, dashboardId);
  }
}

/**
 * Parse Kinetica's columnar response into an array of row objects.
 *
 * Kinetica ALWAYS returns data under positional keys (column_1, column_2, …)
 * regardless of whether the SELECT list named columns explicitly.
 * The real column names are always present in a sibling "column_headers" array.
 * "column_datatypes" is also a sibling metadata key and must be excluded from
 * the data pivot.
 *
 * Two shapes accepted:
 *   1. v1.0+ (Phase 2 kineticaSql helper unwraps server-side):
 *        { column_1: [...], column_2: [...], column_headers: [...], column_datatypes: [...] }
 *   2. Pre-v1.0 raw Kinetica wrapper (kept for backwards-compat):
 *        { data_str: [{ json_encoded_response: "..." }] }
 * We need: [{ real_col_name: val, ... }, ...]
 */
function parseKineticaResponse(payload: Record<string, unknown>): Row[] {
  try {
    // Check for Kinetica error
    if (payload.status === "ERROR") {
      throw new Error((payload.message as string) || "Kinetica query error");
    }

    let columnar: Record<string, unknown> | undefined;

    if ("data_str" in payload) {
      // Pre-v1.0 wrapper shape — unwrap data_str -> json_encoded_response.
      let dataStr = payload.data_str;
      if (typeof dataStr === "string") dataStr = JSON.parse(dataStr);
      if (Array.isArray(dataStr) && dataStr.length > 0) dataStr = dataStr[0];
      let encoded = (dataStr as Record<string, unknown>)?.json_encoded_response;
      if (typeof encoded === "string") encoded = JSON.parse(encoded);
      columnar = encoded as Record<string, unknown> | undefined;
    } else {
      // v1.0+ shape — payload is already the columnar object.
      columnar = payload as unknown as Record<string, unknown>;
    }

    if (!columnar || typeof columnar !== "object") return [];

    // Extract the real column names from column_headers (always present in
    // Kinetica responses). Metadata-only keys are excluded from data iteration.
    const METADATA_KEYS = new Set(["column_headers", "column_datatypes"]);
    const columnHeaders = Array.isArray(columnar.column_headers)
      ? (columnar.column_headers as string[])
      : null;

    // Collect only the positional data keys (column_1, column_2, …) in insertion order.
    const dataKeys = Object.keys(columnar).filter((k) => !METADATA_KEYS.has(k));
    if (dataKeys.length === 0) return [];

    // Build a mapping: column_N (or whatever the raw key is) -> real name.
    // If column_headers has fewer entries than data keys, fall back to the raw key.
    const keyToName: Record<string, string> = {};
    dataKeys.forEach((rawKey, idx) => {
      keyToName[rawKey] = (columnHeaders && columnHeaders[idx]) ? columnHeaders[idx] : rawKey;
    });

    const firstDataKey = dataKeys[0];
    const numRows = Array.isArray(columnar[firstDataKey])
      ? (columnar[firstDataKey] as unknown[]).length
      : 0;

    // Pivot columnar -> row-based using real column names.
    const rows: Row[] = [];
    for (let i = 0; i < numRows; i++) {
      const row: Row = {};
      for (const rawKey of dataKeys) {
        const realName = keyToName[rawKey];
        row[realName] = (columnar[rawKey] as unknown[])[i];
      }
      rows.push(row);
    }
    return rows;
  } catch (e) {
    if (e instanceof Error && e.message.includes("Kinetica")) throw e;
    // If parsing fails, try treating it as already-row-based data
    if (Array.isArray(payload)) return payload as Row[];
    if (Array.isArray((payload as any).data)) return (payload as any).data;
    if (Array.isArray((payload as any).rows)) return (payload as any).rows;
    return [];
  }
}

/**
 * Renders the actual chart for a widget based on its type and config.
 * Fetches data via the SQL query stored in widget.config.sql.
 *
 * The "records" type owns its own data-fetch lifecycle (server-side pagination
 * + interactive sort), so it short-circuits the shared SQL effect below.
 */
const WidgetRenderer = ({ widget, tables = [], onConfigureWidget }: WidgetRendererProps) => {
  // Phase 12: MapChartRenderer reads layers from useDashboardLayersStore. Each layer carries
  // its own table_id; `tables` is threaded through so the renderer can resolve table_id →
  // schema.name for the WMS LAYERS param.
  //
  // Post-VERIFY (Phase 35 follow-up): each widget's render is isolated by a
  // WidgetErrorBoundary so a render-phase exception (e.g. OpenLayers / React reconciler
  // desync when a dv-bound layer fires imageloaderror mid-render — observed live after
  // adding a second map widget to a dashboard with a dv-bound layer in
  // `over_threshold`/`error` state) doesn't cascade up and crash the entire dashboard.
  // Each widget gets its own boundary keyed by widget.id so a retry resets that widget's
  // tree independently.

  // Phase 58 Plan 02 (ENGINE-V111-02/03): widget.config overlay merge.
  // Scoped selector — only re-renders when THIS widget's overlay changes.
  // Depth-1 merge, consistent with the allow-list field granularity.
  // map widgets skip this merge because their layer config is handled by
  // MapChartRenderer via effectiveLayers (useDashboardLayersStore + layerOverrides).
  // The widget.config merge still applies to non-layer widget-level config fields
  // (e.g. show_popup / show_scale_bar for map widgets).
  const widgetOverlay = useWidgetActionStore((s) => s.widgetOverrides[widget.id] ?? null);
  const effectiveWidget = widgetOverlay
    ? { ...widget, config: { ...(widget.config ?? {}), ...widgetOverlay } }
    : widget;

  let body: ReactElement;
  if (effectiveWidget.type === "map") {
    // Pass effectiveWidget so widget.config-level fields (show_popup, show_scale_bar, etc.)
    // reflect any overlay-merged config. Map LAYER overlays are handled separately inside
    // MapChartRenderer via effectiveLayers (see Phase 58 Plan 02 wiring there).
    body = <MapChartRenderer widget={effectiveWidget} tables={tables} />;
  } else if (effectiveWidget.type === "records") {
    body = <RecordsTableRenderer widget={effectiveWidget} />;
  } else if (effectiveWidget.type === "info-card") {
    // Phase 23 (CARD-V14-01): info-card short-circuits BEFORE AggregatedWidgetRenderer so it
    // does not try to read widget.config.sql (info-card defaultConfig is {} — no SQL).
    body = <InfoCardRenderer widget={effectiveWidget} tables={tables} />;
  } else if (effectiveWidget.type === "legend") {
    // Phase 42 Plan 02 (WIDGET-V17-01): legend short-circuits BEFORE AggregatedWidgetRenderer
    // so it does not try to read widget.config.sql (legend defaultConfig is {} — no SQL).
    // onConfigureWidget threaded from DashboardsPage (Plan 42-01) for the Reconfigure CTA.
    body = <LegendRenderer widget={effectiveWidget} onConfigureWidget={onConfigureWidget} />;
  } else if (effectiveWidget.type === "datafilter") {
    // Phase 44 Plan 03 (FILTER-V17-16): datafilter short-circuits BEFORE AggregatedWidgetRenderer
    // — it owns its own lifecycle (no SQL, dispatches into useFilterStore on Apply).
    // Sole materialize trigger invariant (Phase 15/30 lock): DataFilterRenderer NEVER calls
    // the materialize function directly; Effect 1 in AggregatedWidgetRenderer fires off the
    // filterVersion tick produced by setBulkFilters.
    // tables prop mirrors InfoCardRenderer pattern (tables not in DashboardContext).
    body = <DataFilterRenderer widget={effectiveWidget} tables={tables} />;
  } else if (effectiveWidget.type === "timeline") {
    // Phase 45 Plan 03 (TIMELINE-V17-02): timeline owns multi-axis Recharts + drag-to-filter
    // lifecycle. Sole materialize trigger invariant (Phase 15/30 lock): TimelineRenderer NEVER
    // calls the materialize function directly; Effect 1 in AggregatedWidgetRenderer fires off
    // the filterVersion tick produced by setBulkFilters.
    body = <TimelineRenderer widget={effectiveWidget} tables={tables} />;
  } else if (effectiveWidget.type === "numericline") {
    // Numeric Line chart — numeric-X analog of timeline; owns multi-axis Recharts +
    // drag-to-filter lifecycle. Same sole-materialize-trigger invariant as TimelineRenderer.
    body = <NumericLineRenderer widget={effectiveWidget} tables={tables} />;
  } else if (effectiveWidget.type === "radiogroup") {
    // Phase 60 Plan 02 (RADIO-V111-03): radiogroup short-circuits BEFORE AggregatedWidgetRenderer
    // — it is a pure action-engine consumer (no SQL, no filter-store contact). The renderer reads
    // its RadioGroupConfig live and dispatches selections via applyWidgetAction(action, widget.id).
    // Runtime wiring follows the same WidgetRenderer-dispatch pattern as datafilter + legend.
    // (Registry def radio-group.ts has no renderer field — runtime dispatched here exclusively.)
    body = <RadioGroupRenderer widget={effectiveWidget} />;
  } else if (effectiveWidget.type === "calendar") {
    // Phase 67 (CAL-V113-04): calendar short-circuits BEFORE AggregatedWidgetRenderer
    // (usesAggregation:false → sole-materialize-trigger invariant preserved). The real
    // SVG CalendarRenderer is live as of Phase 67; CalendarRenderer owns its own data
    // lifecycle (no materializeFilter / dropFilterView) — AggregatedWidgetRenderer is
    // NOT called, preserving the sole-materialize-trigger invariant.
    body = <CalendarRenderer widget={effectiveWidget} tables={tables} />;
  } else {
    body = <AggregatedWidgetRenderer widget={effectiveWidget} />;
  }
  return (
    <WidgetErrorBoundary widgetLabel={effectiveWidget.title || effectiveWidget.type}>
      {body}
    </WidgetErrorBoundary>
  );
};

const AggregatedWidgetRenderer = ({ widget }: Props) => {
  const [data, setData] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cfg = widget.config ?? {};
  const sql = cfg.sql as string | undefined;
  // Plan 09-02 persists tableId at widget save time; legacy widgets may have it undefined.
  const tableId = cfg.tableId as number | undefined;
  // Phase 35 Plan 05 (DV-V16-13): dv-bound widget — points to a dashboard_dynamic_views row.
  // When set, this widget reads viewName from useDynamicViewStore.views[dynamicViewId]
  // instead of useFilterViewStore.views[tableId]. Effect 1 (filter-view materialize trigger)
  // STAYS UNCHANGED — filter view is the `{view}` substitution source for the dv template.
  const dynamicViewId = cfg.dynamicViewId as number | undefined;
  // Phase 10 DRILL-02: drill-down config is persisted by ChartConfigPanel (Plan 10-03).
  // Empty drillDownColumn → click handlers no-op (legacy widget compatibility).
  const drillDownColumn = (cfg.drillDownColumn as string) || "";
  const drillDownColumnType =
    (cfg.drillDownColumnType as DrillDownDataType) || "string";

  // PITFALL C-02 lock: scope the selector to filters[tableId] — NEVER state.filters whole.
  // Subscribing to the whole map would cause this widget to re-render on any other table's mutation.
  // PITFALL AP-1 / S-01 lock: filter state lives ONLY in useFilterStore — no useState shadow copy.
  const tableFilters = useFilterStore((state) =>
    tableId !== undefined ? state.filters[tableId] ?? [] : []
  );
  // PITFALL S-02 lock: filterVersion (primitive) is the useEffect dep — NEVER the array reference.
  // An empty-array reference can be stable across mutations (e.g., clearFilters via `delete next[tableId]`),
  // which would prevent useEffect from re-firing. The version counter always advances on mutation.
  const filterVersion = useFilterStore((state) => state.filterVersion);

  // Phase 91 (READ-V118-01): table-bound read flips from filterViewStore.views[tableId]
  // to filterCombinationStore (orchestrator-owned combo registry). dv path is unchanged.
  // vizKey is stable for the component's life — widget.id never changes while mounted.
  const vizKey = `w:${widget.id}`;
  // PITFALL S-02 lock: ONE primitive comboKey selector (viewName:expiresAt:materializing),
  // mirrors MapChartRenderer.viewsKey. NEVER subscribe to s.registry (object) — re-render storm.
  // NOFILTER hashes (end ":NOFILTER") and an undefined hash (orchestrator not yet run) both
  // resolve to viewName "" → base table (fromSwap("") === fromSwap(undefined)).
  const comboKey = useFilterCombinationStore((s) => {
    const h = s.vizToHash[vizKey];
    const e = h && !h.endsWith(`:${NOFILTER_SENTINEL}`) ? s.registry[h] : undefined;
    return `${e?.viewName ?? ""}:${e?.expiresAt ?? 0}:${e?.materializing ? "1" : "0"}`;
  });
  // combinationVersion replaces clearMaterializingVersion as the Effect 2 suspend-lift dep.
  // setEntry / markMaterializing / clearEntry all bump it (covers success AND error).
  const combinationVersion = useFilterCombinationStore((s) => s.combinationVersion);

  // Phase 35 Plan 05 (DV-V16-13): scoped selectors to useDynamicViewStore for dv-bound widgets.
  // PITFALL C-02 lock — scope to s.views[dynamicViewId], NEVER the whole views map.
  // When dynamicViewId is undefined, selectors return undefined → legacy path unchanged.
  const dvEntry = useDynamicViewStore((s) =>
    dynamicViewId !== undefined ? s.views[dynamicViewId] : undefined,
  );
  const dvStatus = dvEntry?.status;
  const dvViewName = dvEntry?.viewName;
  const dvError = dvEntry?.error;
  // dvReason distinguishes the over_threshold empty state: "no_filter" offers an
  // on-demand "Load full table" CTA (server falls back to the unfiltered base table
  // when unlimited or base < max_records); "exceeds_max_records" keeps the
  // narrow-your-filters message (a filter IS applied but its result is too large).
  const dvReason = dvEntry?.reason;

  // Phase 94 (FSCOPE-V118-03): dvFilterEntry / dvFilterViewName / dvFilterMaterializing RETIRED.
  // The dv-filter materialize trigger was moved to the orchestrator (useCombinationOrchestrator).
  // The effectiveViewName dv branch now reads filterCombinationStore.vizToHash[vizKey] instead of
  // filterViewStore.dvViews[dynamicViewId]. See effectiveViewName dv branch in Effect 2 below.

  // Phase 15-02: dashboardId from DashboardContext (15-01 ships the provider).
  // Throws if no provider — tests MUST wrap in <DashboardContextProvider dashboardId={N}>.
  // Phase 30 (MAT-V15-02): read both dashboardId and widgets from context. widgets feeds
  // the per-table SpatialTarget aggregation memo below. Provider supplies widgets via
  // Plan 30-01 wiring in DashboardsPage.tsx.
  // Phase 35 Plan 05 (DV-V16-13): also read dynamicViews (for orphan detection) and
  // retryDynamicView (for the error-state Retry button).
  const { dashboardId, widgets, dynamicViews: dashboardDynamicViews, retryDynamicView } =
    useDashboardContext();

  // Phase 35 Plan 05 (DV-V16-13): orphan detection — widget references a dynamic view
  // that has been deleted (no entry in store + not in the dashboard's dv list).
  const isOrphanDynamicView =
    dynamicViewId !== undefined &&
    dvEntry === undefined &&
    !dashboardDynamicViews.some((dv) => dv.id === dynamicViewId);

  // Phase 30 (MAT-V15-02 + MAT-V15-03): resolve per-table eligible spatial target.
  // First-eligible-target-per-table from the lowest-id map widget wins (deterministic
  // across renders; see lib/spatialTargets.ts aggregateSpatialTargetsByTable contract).
  // WKB and incomplete targets are filtered out by isSpatialTargetEligible inside the
  // helper — myTarget is GUARANTEED eligible or undefined.
  const targetsByTable = useMemo(
    () => aggregateSpatialTargetsByTable(widgets),
    [widgets],
  );
  const myTarget = tableId !== undefined
    ? targetsByTable.get(tableId)
    : undefined;

  // Phase 30 (MAT-V15-01): primitive-selector subscription to spatialFilterVersion.
  // Increments on every successful shape mutation (addShape / removeShape existing /
  // clearAll when non-empty); resets to 0 on store.reset(). This is the 5th dep of
  // Effect 1 below — mirrors PITFALL S-02 lock (counter, NOT array reference, in dep array).
  const spatialFilterVersion = useSpatialFilterStore((s) => s.spatialFilterVersion);

  // Phase 94 (FSCOPE-V118-03): Effect 1 REMOVED entirely.
  // Phase 91 had already removed the table-path materialize branch; Phase 94 removes the
  // dv-branch (materializeFilter({ dynamicViewId, filters: dvFilters }) → setDvView).
  // The orchestrator (useCombinationOrchestrator) is now the SOLE materialize trigger for
  // the dv combination path. AggregatedWidgetRenderer is a READ-ONLY consumer of
  // filterCombinationStore (dv path reads vizToHash[vizKey] → registry[hash] in Effect 2).
  // materializeAbortRef also removed — it was only used by the dv-branch.

  // Phase 15-04 (LIFE-V13-02): retry tracking — max 1 reactive retry per chart-query invocation.
  // useRef survives effect re-creates within the same component instance; reset on viewName change
  // (a new viewName means we're querying a freshly-materialized view, so retry budget renews).
  const retryRef = useRef<{ viewName: string | undefined; retried: boolean }>({
    viewName: undefined,
    retried: false,
  });

  // Effect 2 (EXTENDED from 15-02 with LIFE-V13-01 proactive + LIFE-V13-02 reactive paths)
  // Replaces the deleted buildWhereClause + injectWhereClause path with fromSwap(sql, viewName).
  // When viewName is undefined (no filters or pre-materialize), fromSwap returns sql unchanged
  // (FILT-V13-03 zero-overhead lock).
  //
  // Phase 35 Plan 05 (DV-V16-13):
  //   - For dv-bound widgets (dynamicViewId !== undefined), viewName source flips to
  //     useDynamicViewStore.views[dynamicViewId]?.viewName (NOT useFilterViewStore).
  //   - Suspend-gate extends to dvStatus === "pending" — research finding #7 lock,
  //     prevents stale-viewName race during cascade re-materialize.
  //   - Status short-circuits for over_threshold / error / orphan are pure-render side effects
  //     (no runSql fire); the render-body status gates below handle the JSX. Effect 2 simply
  //     skips runSql when dvStatus is not "materialized".
  useEffect(() => {
    if (!sql?.trim()) {
      setData([]);
      return;
    }

    // Phase 91: imperative entry read for table-bound suspend gate (avoids stale closure —
    // mirrors the `shapes` imperative read in Effect 1). comboKey/combinationVersion are the
    // reactive deps; actual entry fields read here at effect-call time for accuracy.
    const comboHash = useFilterCombinationStore.getState().vizToHash[vizKey];
    const comboEntry =
      comboHash && !comboHash.endsWith(`:${NOFILTER_SENTINEL}`)
        ? useFilterCombinationStore.getState().registry[comboHash]
        : undefined;
    if (dynamicViewId === undefined && comboEntry?.materializing) return; // table suspend gate

    // Phase 35 Plan 05 (research finding #7): extend the suspend-gate to dvStatus === "pending"
    // for dv-bound widgets. Without this, the chart query race-fires against the prior (stale)
    // dv viewName during cascade re-materialize.
    if (dynamicViewId !== undefined && dvStatus === "pending") return;

    // Phase 94 (FSCOPE-V118-03): dv suspend gate — reads the dv-combo entry's materializing flag
    // via the same imperative comboEntry path as the table gate above (comboEntry reads vizToHash[vizKey]).
    // The comboEntry variable already handles both table AND dv paths (vizKey = "w:<id>" in both cases;
    // the hash prefix determines the path). If a dv-combo is materializing, suspend the chart query.
    if (dynamicViewId !== undefined && comboEntry?.materializing) return;

    // Phase 35 Plan 05: short-circuit for non-materialized dv statuses. Render-body status
    // gates below render the appropriate empty/error JSX; here we just skip runSql.
    if (dynamicViewId !== undefined) {
      if (isOrphanDynamicView) return; // orphan render handled below
      if (dvStatus === undefined) return; // initial render — render-body shows loading
      if (dvStatus === "over_threshold") return; // empty-state render below — NO runSql
      if (dvStatus === "error") return; // error+retry render below — NO runSql
      // dvStatus === "materialized" → fall through to fromSwap + runSql with dv viewName.
    }

    // LIFE-V13-01 PROACTIVE: if combo view exists and is past expiresAt, clear the entry.
    // Phase 91: replaced filterViewStore.clearView(tableId) with clearEntry(comboHash).
    // The orchestrator re-materializes on its next filterVersion tick.
    // Phase 35 Plan 05: applies ONLY to table-bound path (dv expiry owned by orchestrator).
    if (
      dynamicViewId === undefined &&
      comboEntry?.viewName &&
      comboEntry.expiresAt > 0 &&
      Date.now() >= comboEntry.expiresAt &&
      comboHash
    ) {
      useFilterCombinationStore.getState().clearEntry(comboHash);
      return; // orchestrator re-materializes on next tick; effect re-fires on combinationVersion
    }

    // Phase 35 Plan 05 (Pitfall 4 lock from 35-RESEARCH.md): viewName source selection.
    //   - dv-bound + materialized → combo view (Phase 94) or raw dv view (Phase 94 fallback)
    //   - legacy / non-dv-bound → combo entry viewName (existing path)
    // Pitfall 4 defense-in-depth: materialized with empty viewName is an internal error.
    let effectiveViewName: string | undefined;
    if (dynamicViewId !== undefined) {
      // Phase 94 (FSCOPE-V118-03): prefer the dv-combination view (from filterCombinationStore)
      // when available; fall back to the raw dv view (dvViewName).
      // Imperative getState() read — same S-02 pattern as the table-path comboEntry read above.
      const dvComboHash = useFilterCombinationStore.getState().vizToHash[vizKey];
      const dvComboEntry =
        dvComboHash && !dvComboHash.endsWith(`:${NOFILTER_SENTINEL}`)
          ? useFilterCombinationStore.getState().registry[dvComboHash]
          : undefined;
      const dvSource = dvComboEntry?.viewName || dvViewName;
      if (!dvSource) {
        setData([]);
        setLoading(false);
        setError("Internal error: materialized dynamic view has no viewName");
        return;
      }
      effectiveViewName = dvSource;
    } else {
      // Phase 91: table path reads combo entry (NOFILTER/undefined → "" → base table).
      effectiveViewName = comboEntry?.viewName ?? "";
    }

    // Reset retry budget when viewName changes (fresh view = fresh retry budget)
    if (retryRef.current.viewName !== effectiveViewName) {
      retryRef.current = { viewName: effectiveViewName, retried: false };
    }

    // Phase 9 FILT-02: cancel any in-flight fetch when filter changes before response arrives.
    const controller = new AbortController();
    const finalSql = fromSwap(sql, effectiveViewName);
    setLoading(true);
    setError(null);

    const runChartQuery = async (sqlToRun: string): Promise<void> => {
      try {
        const res = await runSql<Record<string, unknown>>(sqlToRun, undefined, controller.signal);
        setData(parseKineticaResponse(res));
      } catch (err) {
        // AbortError is expected control flow on filter change — never route to setError
        // (would flash red error UI on every filter mutation).
        if ((err as Error)?.name === "AbortError") return;

        // LIFE-V13-02 REACTIVE: detect view-not-found.
        // Phase 35 Plan 05: scoped to non-dv-bound widgets — dv-bound widget retry is owned by
        // the orchestrator hook (retryDynamicView from DashboardContext, surfaced via the Retry
        // button in the error-state render gate below).
        // Phase 91: table path no longer re-materializes inline (orchestrator owns it).
        // Clear the stale entry so the orchestrator re-materializes on its next tick,
        // and render base-table data now (no flash of error). Open Decision 2 → option (a).
        if (
          dynamicViewId === undefined &&
          isViewNotFoundError(err) &&
          comboEntry?.viewName &&
          comboHash &&
          !retryRef.current.retried
        ) {
          retryRef.current = { viewName: comboEntry.viewName, retried: true };
          useFilterCombinationStore.getState().clearEntry(comboHash);
          await runChartQuery(fromSwap(sql, undefined));
          return;
        }

        // Non-view-not-found error OR already retried OR no viewName — surface normally.
        // Pitfall 3 lock: max 1 reactive retry; second view-not-found falls through silently to raw FROM <table>.
        if (isViewNotFoundError(err) && retryRef.current.retried) {
          // Second view-not-found — do not loop. Fall through silently to raw FROM <table>.
          await runChartQuery(fromSwap(sql, undefined));
          return;
        }

        setError((err as Error).message);
      }
    };

    runChartQuery(finalSql).finally(() => setLoading(false));

    return () => controller.abort();
    // PITFALL S-02: filterVersion stays in deps; comboKey drives re-fire on combo-entry changes
    // (viewName/expiresAt/materializing encoded as primitive string). combinationVersion replaces
    // clearMaterializingVersion as the suspend-gate lift dep — bumped by setEntry/markMaterializing/
    // clearEntry (covers success, error, and stale-view-clear paths).
    // Phase 91: viewName/expiresAt/clearMaterializingVersion removed; comboKey+combinationVersion added.
    // Phase 35 Plan 05 (DV-V16-13): dv deps (dvStatus, dvViewName) unchanged.
    // Phase 94 (FSCOPE-V118-03): dvFilterViewName + dvFilterMaterializing REMOVED (retired selectors);
    // comboKey/combinationVersion now drive the dv-combo path (same primitives as the table path).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    sql,
    filterVersion,
    comboKey,
    combinationVersion,
    dynamicViewId,
    dvStatus,
    dvViewName,
  ]);

  if (!sql?.trim()) {
    return (
      <div className="widget-placeholder">
        <span>Select a table and configure metrics to load data</span>
      </div>
    );
  }

  // Phase 35 Plan 05 (DV-V16-13/14): status-aware render gates for dv-bound widgets.
  // ORDER: orphan first (highest priority — dv reference is dangling), then status branches.
  // After all dv gates, fall through to the existing loading/error/data-empty/switch chain.
  if (isOrphanDynamicView) {
    return (
      <div className="widget-placeholder widget-orphan-dynamic-view">
        <span>This dynamic view was deleted. Reconfigure the widget.</span>
      </div>
    );
  }
  if (dynamicViewId !== undefined) {
    if (dvStatus === undefined || dvStatus === "pending") {
      return (
        <div className="widget-placeholder">
          <span>Loading...</span>
        </div>
      );
    }
    if (dvStatus === "over_threshold") {
      // no_filter: no filter is applied. Offer an on-demand CTA — the server falls back
      // to the unfiltered base table when the DV is unlimited OR the base row count is
      // below max_records (otherwise it returns no_filter again → "too large").
      if (dvReason === "no_filter") {
        return (
          <div className="widget-placeholder widget-over-threshold">
            <span>No filter applied — load the full table, or apply a filter to narrow it.</span>
            <button
              type="button"
              className="widget-retry-btn"
              onClick={() => retryDynamicView(dynamicViewId)}
            >
              Load full table
            </button>
          </div>
        );
      }
      // exceeds_max_records — a filter IS applied but its result is still too large.
      return (
        <div className="widget-placeholder widget-over-threshold">
          <span>Too much data — narrow your filters to enable this view.</span>
        </div>
      );
    }
    if (dvStatus === "error") {
      return (
        <div className="widget-placeholder widget-error">
          <span>{dvError ?? "Dynamic view materialize failed"}</span>
          <button
            type="button"
            className="widget-retry-btn"
            onClick={() => retryDynamicView(dynamicViewId)}
          >
            Retry
          </button>
        </div>
      );
    }
    // dvStatus === "materialized" → fall through to existing render chain
  }

  if (loading) {
    return (
      <div className="widget-placeholder">
        <span>Loading...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="widget-placeholder widget-error">
        <span>{error}</span>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="widget-placeholder">
        <span>No data returned</span>
      </div>
    );
  }

  // Drill-down props threaded through to renderers — Plan 10-04 wiring + Phase 17-03 dashboardId.
  const drillProps = {
    widgetId: widget.id,
    tableId,
    // Phase 63 (DVDRILL-V112-01): thread the dv binding so each chart renderer's drill
    // handler routes to the dv slice when set.
    dynamicViewId,
    dashboardId,
    drillDownColumn,
    drillDownColumnType,
  };

  switch (widget.type) {
    case "bar":
      return <BarRenderer data={data} config={cfg} {...drillProps} />;
    case "line":
      return <LineRenderer data={data} config={cfg} {...drillProps} />;
    case "pie":
      return <PieRenderer data={data} config={cfg} {...drillProps} />;
    case "scatter":
      return <ScatterRenderer data={data} config={cfg} {...drillProps} />;
    case "table":
      return <TableRenderer data={data} config={cfg} tableFilters={tableFilters} {...drillProps} />;
    case "bignumber":
      return <BigNumberRenderer data={data} config={cfg} />;
    case "map":
      // Phase 12: MapChartRenderer reads layers from useDashboardLayersStore. Each layer carries
      // its own table_id; the renderer resolves table_id → schema.name for the WMS LAYERS param.
      // Note: map widgets are short-circuited BEFORE this component via the early-return in
      // WidgetRenderer. This branch is unreachable at runtime but serves as a documentation landmark.
      return <MapChartRenderer widget={widget} />;
    default:
      return (
        <div className="widget-placeholder">
          <span>Renderer not available for "{widget.type}"</span>
        </div>
      );
  }
};

/* ------------------------------------------------------------------ */
/*  Shared helpers                                                     */
/* ------------------------------------------------------------------ */

// Grid/axis colors are theme-aware (useChartAxisColors) and resolved per-renderer —
// SVG stroke/fill attributes can't read CSS vars, so each chart renderer reads the hook.

/** Phase 10 DRILL-01: drill-down props threaded from AggregatedWidgetRenderer to each chart renderer. */
/** Phase 17-03: dashboardId added so dispatchDrillDown can flip materializing synchronously. */
type DrillProps = {
  widgetId: number;
  tableId: number | undefined;
  // Phase 63 (DVDRILL-V112-01): dv binding. When set, the renderer's drill handler routes
  // the click into dvFilters[dynamicViewId] instead of filters[tableId].
  dynamicViewId: number | undefined;
  dashboardId: number;
  drillDownColumn: string;
  drillDownColumnType: DrillDownDataType;
};

/**
 * Resolve the x (category) and y (value) keys from config.
 * The generated SQL uses `groupByColumn` as the first column and `value` as the alias.
 */
function resolveKeys(data: Row[], config: Record<string, unknown>) {
  const keys = Object.keys(data[0] ?? {});
  const groupBy = config.groupByColumn as string;
  const x = groupBy && keys.includes(groupBy) ? groupBy : keys[0] ?? "x";
  const y = keys.includes("value") ? "value" : keys[1] ?? "y";
  return { x, y };
}

/**
 * Drill target for AGGREGATED charts (bar/line/area/pie). Their rows are shaped
 * `{ <groupByColumn>: category, value: n }`, so the only column a click can meaningfully
 * filter on is the group-by column — that IS the clicked category. A separately-configured
 * `drillDownColumn` that differs from the group-by column is absent from the aggregated row,
 * so reading it yields `undefined` (the filter then shows `= 'undefined'` and matches nothing).
 * Always prefer the group-by column; keep the persisted type only when the two agree, else
 * infer from the clicked value (categorical group-bys → string, numeric → number).
 */
export function resolveAggregatedDrillTarget(
  row: Row | undefined,
  groupByColumn: string,
  drillDownColumn: string,
  drillDownColumnType: DrillDownDataType,
): { column: string; value: unknown; dataType: DrillDownDataType } {
  const column = groupByColumn || drillDownColumn;
  const value = row?.[column];
  const dataType: DrillDownDataType =
    column === drillDownColumn
      ? drillDownColumnType
      : typeof value === "number"
        ? "number"
        : "string";
  return { column, value, dataType };
}

/* ------------------------------------------------------------------ */
/*  Chart renderers                                                    */
/* ------------------------------------------------------------------ */

const BarRenderer = ({
  data,
  config,
  widgetId,
  tableId,
  dynamicViewId,
  dashboardId,
  drillDownColumn,
  drillDownColumnType,
}: { data: Row[]; config: Record<string, unknown> } & DrillProps) => {
  const { grid: GRID_COLOR, axis: AXIS_COLOR } = useChartAxisColors();
  // Phase 77 Plan 02 (COLAPPLY-V115-02): configVersion subscription forces re-render on label/format edit.
  const configVersion = useColumnDisplayConfigStore((s) => s.configVersion);
  void configVersion; // referenced to prevent tree-shaking; reactive via subscription
  const { loadConfig } = useColumnDisplayConfigStore.getState();
  useEffect(() => {
    if (tableId !== undefined) loadConfig(tableId);
  }, [tableId, loadConfig]);
  const groupByColumn = (config.groupByColumn as string) || "";
  const metricColumn = (config.metricColumn as string) || "";
  const { x, y } = resolveKeys(data, config);
  const color = (config.color as string) || DEFAULT_BAR_COLOR;
  const radius = (config.barRadius as number) ?? 4;
  const showGrid = config.showGrid !== false;
  const showLegend = config.showLegend !== false;
  const showTooltip = config.showTooltip !== false;
  const showValueLabels = config.showValueLabels === true;
  const horizontal = config.horizontal === true; // horizontal bars (Recharts layout="vertical")
  // Axis titles are SEMANTIC, not physical: categoryTitle = the grouping dimension,
  // valueTitle = the metric. They follow the DATA so flipping orientation moves each title
  // to whichever axis now carries it (xAxisLabel = category, yAxisLabel = value by default).
  const categoryTitle = (config.xAxisLabel as string) || (tableId !== undefined && groupByColumn ? resolveLabel(tableId, groupByColumn) : "");
  const valueTitle = (config.yAxisLabel as string) || (tableId !== undefined && metricColumn ? resolveLabel(tableId, metricColumn) : "");
  // Map to the physical axes: vertical → bottom=category, left=value;
  // horizontal → bottom=value, left=category.
  const bottomTitle = horizontal ? valueTitle : categoryTitle;
  const leftTitle = horizontal ? categoryTitle : valueTitle;
  // Axis title objects positioned for their physical axis (or undefined when blank).
  const bottomLabelObj = bottomTitle
    ? { value: bottomTitle, position: "insideBottom" as const, offset: -4, fill: AXIS_COLOR, fontSize: 11 }
    : undefined;
  const leftLabelObj = leftTitle
    ? { value: leftTitle, angle: -90, position: "insideLeft" as const, fill: AXIS_COLOR, fontSize: 11, style: { textAnchor: "middle" as const } }
    : undefined;

  // Phase 10 DRILL-04: dim-peers transient — non-active <Cell> elements drop to 0.3
  // fillOpacity for 300ms before addFilter dispatch (PITFALL C-03 sequencing).
  const [clickedElement, setClickedElement] = useState<unknown>(null);
  // Clear local clicked state when data arrives (refetch completed)
  useEffect(() => {
    setClickedElement(null);
  }, [data]);

  const drillEnabled =
    !!drillDownColumn && (tableId !== undefined || dynamicViewId !== undefined);
  const wrapperStyle = { cursor: drillEnabled ? "pointer" : "default" };

  const handleChartClick = (nextState: unknown) => {
    if (!drillEnabled) return;
    const payload = (nextState as { activePayload?: Array<{ payload?: Row }> } | null)
      ?.activePayload?.[0]?.payload;
    if (!payload) return;
    // Aggregated chart → drill on the group-by column (the clicked category), never a
    // diverged drillDownColumn that isn't in the aggregated row (would filter `= 'undefined'`).
    const { column, value, dataType } = resolveAggregatedDrillTarget(
      payload, groupByColumn, drillDownColumn, drillDownColumnType,
    );
    // 1. dim-peers transient (PITFALL C-03 sequencing)
    setClickedElement(value);
    // 2. dispatch addFilter after 300ms — gives the dim render visible time before
    //    Phase 9 data-clear → loading state takes over.
    setTimeout(() => {
      dispatchDrillDown({
        tableId,
        dynamicViewId,
        dashboardId,
        column,
        value,
        dataType,
        widgetId,
      });
    }, 300);
  };

  // Phase 87 (UAT): value-axis number format — per-widget override → bound metric column
  // default → raw. Mirrors the timeline/line hybrid; unconfigured bars keep their raw tick
  // appearance. Applied to the VALUE axis (YAxis when vertical, XAxis when horizontal).
  const yAxisFormatSpec = config.yAxisFormat as FormatSpec | undefined;
  const valueAxisTickFormatter = (v: unknown): string => {
    if (yAxisFormatSpec) return String(buildFormatter(yAxisFormatSpec)(v) ?? v);
    if (tableId !== undefined && metricColumn) {
      const out = resolveFormatter(tableId, metricColumn)(v);
      if (out !== v) return String(out);
    }
    return v == null ? "" : String(v);
  };
  // Size the vertical value axis to its formatted labels so short SI ticks ("1.2M") reclaim
  // left-edge space; recharts 2.x YAxis width is a fixed number (no "auto").
  const valueAxisWidth = estimateValueAxisWidth(
    data.map((row) => Number((row as Record<string, unknown>)[y])),
    valueAxisTickFormatter,
  );

  return (
    // Bulletproof fill: a relative full-height box with an absolutely-positioned inset:0
    // child gives ResponsiveContainer a concrete pixel-sized parent, so the chart fills the
    // widget body even when the flex percentage-height chain resolves late. Phase 87 (UAT) —
    // plain height:100% left dead space below the bars.
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
    <div style={{ position: "absolute", inset: 0 }}>
    <ResponsiveContainer width="100%" height="100%">
      <BarChart
        data={data}
        layout={horizontal ? "vertical" : "horizontal"}
        margin={{
          top: 8,
          right: 10,
          left: horizontal ? 8 : 0,
          bottom: bottomTitle ? 8 : 0,
        }}
        onClick={handleChartClick}
        style={wrapperStyle}
      >
        {showGrid && <CartesianGrid stroke={GRID_COLOR} vertical={horizontal} horizontal={!horizontal} />}
        {horizontal ? (
          <>
            <XAxis type="number" stroke={AXIS_COLOR} tick={{ fontSize: 11 }} label={bottomLabelObj} tickFormatter={valueAxisTickFormatter} />
            <YAxis type="category" dataKey={x} stroke={AXIS_COLOR} tick={{ fontSize: 11 }} width={leftTitle ? 104 : 90} label={leftLabelObj} />
          </>
        ) : (
          <>
            <XAxis dataKey={x} stroke={AXIS_COLOR} tick={{ fontSize: 11 }} label={bottomLabelObj} />
            <YAxis stroke={AXIS_COLOR} tick={{ fontSize: 11 }} width={valueAxisWidth + (leftTitle ? 16 : 0)} label={leftLabelObj} tickFormatter={valueAxisTickFormatter} />
          </>
        )}
        {showTooltip && (
          <Tooltip
            {...RECHARTS_TOOLTIP_PROPS}
            content={<ColumnFormatTooltip tableId={tableId} groupByColumn={groupByColumn} metricColumn={metricColumn} />}
          />
        )}
        {showLegend && <Legend wrapperStyle={{ paddingTop: 6, fontSize: 11 }} />}
        <Bar
          dataKey={y}
          fill={color}
          radius={horizontal ? [0, radius, radius, 0] : [radius, radius, 0, 0]}
          name={(config.yFieldLabel as string) || (tableId !== undefined && metricColumn ? resolveLabel(tableId, metricColumn) : "") || y}
        >
          {showValueLabels && (
            <LabelList
              dataKey={y}
              position={horizontal ? "right" : "top"}
              fill={AXIS_COLOR}
              fontSize={11}
              // Phase 77 follow-up (COLAPPLY-V115-02): run on-bar value labels through the
              // column formatter for consistency with the tooltip + pie slice labels. When no
              // format spec is set, resolveFormatter is identity → fall back to the prior
              // toLocaleString() default (thousands separator) so unconfigured bars look unchanged.
              formatter={(v: unknown) => {
                if (tableId !== undefined && metricColumn) {
                  const out = resolveFormatter(tableId, metricColumn)(v);
                  if (out !== v) return String(out); // a real format spec was applied
                }
                return typeof v === "number" ? v.toLocaleString() : String(v ?? "");
              }}
            />
          )}
          {data.map((row, index) => (
            <Cell
              key={index}
              fill={color}
              fillOpacity={
                clickedElement !== null
                  ? String(row[x]) === String(clickedElement)
                    ? 1.0
                    : 0.3
                  : 1.0
              }
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
    </div>
    </div>
  );
};

const LineRenderer = ({
  data,
  config,
  widgetId,
  tableId,
  dynamicViewId,
  dashboardId,
  drillDownColumn,
  drillDownColumnType,
}: { data: Row[]; config: Record<string, unknown> } & DrillProps) => {
  const { grid: GRID_COLOR, axis: AXIS_COLOR } = useChartAxisColors();
  // Phase 77 Plan 02 (COLAPPLY-V115-02): configVersion subscription forces re-render on label/format edit.
  const configVersion = useColumnDisplayConfigStore((s) => s.configVersion);
  void configVersion; // referenced to prevent tree-shaking; reactive via subscription
  const { loadConfig } = useColumnDisplayConfigStore.getState();
  useEffect(() => {
    if (tableId !== undefined) loadConfig(tableId);
  }, [tableId, loadConfig]);
  const groupByColumn = (config.groupByColumn as string) || "";
  const metricColumn = (config.metricColumn as string) || "";
  const { x, y } = resolveKeys(data, config);
  const color = (config.color as string) || DEFAULT_LINE_COLOR;
  const strokeWidth = (config.strokeWidth as number) ?? 2;
  const curved = config.curved !== false;
  const showDots = config.showDots !== false;
  const fillArea = config.fillArea === true;
  const showGrid = config.showGrid !== false;
  const showLegend = config.showLegend !== false;
  const showTooltip = config.showTooltip !== false;
  const gradientId = `area-fill-${y}`;

  // Phase 10 DRILL-04: clickedElement state is preserved across line/area branches
  // for consistency, though Recharts Line/Area do not support per-point opacity easily —
  // the user feedback comes from the filter bar chip + toast + the chart-card's data
  // refetch. The 300ms setTimeout is preserved across chart types per PITFALL C-03.
  const [, setClickedElement] = useState<unknown>(null);
  useEffect(() => {
    setClickedElement(null);
  }, [data]);

  const drillEnabled =
    !!drillDownColumn && (tableId !== undefined || dynamicViewId !== undefined);
  const wrapperStyle = { cursor: drillEnabled ? "pointer" : "default" };

  const handleChartClick = (nextState: unknown) => {
    if (!drillEnabled) return;
    const payload = (nextState as { activePayload?: Array<{ payload?: Row }> } | null)
      ?.activePayload?.[0]?.payload;
    if (!payload) return;
    // Aggregated chart → drill on the group-by / x-dimension column (the clicked category).
    const { column, value, dataType } = resolveAggregatedDrillTarget(
      payload, groupByColumn, drillDownColumn, drillDownColumnType,
    );
    setClickedElement(value);
    // PITFALL C-03 sequencing: dispatch addFilter after 300ms.
    setTimeout(() => {
      dispatchDrillDown({
        tableId,
        dynamicViewId,
        dashboardId,
        column,
        value,
        dataType,
        widgetId,
      });
    }, 300);
  };

  return (
    <ResponsiveContainer width="100%" height="100%">
      {fillArea ? (
        <AreaChart
          data={data}
          margin={{ top: 10, right: 10, left: -10, bottom: 0 }}
          onClick={handleChartClick}
          style={wrapperStyle}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
              <stop offset="5%" stopColor={color} stopOpacity={0.5} />
              <stop offset="95%" stopColor={color} stopOpacity={0.05} />
            </linearGradient>
          </defs>
          {showGrid && <CartesianGrid stroke={GRID_COLOR} vertical={false} />}
          <XAxis dataKey={x} stroke={AXIS_COLOR} tick={{ fontSize: 12 }} />
          <YAxis stroke={AXIS_COLOR} tick={{ fontSize: 12 }} />
          {showTooltip && (
            <Tooltip
              {...RECHARTS_TOOLTIP_PROPS}
              content={<ColumnFormatTooltip tableId={tableId} groupByColumn={groupByColumn} metricColumn={metricColumn} />}
            />
          )}
          {showLegend && <Legend />}
          <Area
            type={curved ? "monotone" : "linear"}
            dataKey={y}
            stroke={color}
            fill={`url(#${gradientId})`}
            strokeWidth={strokeWidth}
            dot={showDots ? { r: 3 } : false}
            name={(config.yFieldLabel as string) || (tableId !== undefined && metricColumn ? resolveLabel(tableId, metricColumn) : "") || y}
          />
        </AreaChart>
      ) : (
        <LineChart
          data={data}
          margin={{ top: 10, right: 10, left: -10, bottom: 0 }}
          onClick={handleChartClick}
          style={wrapperStyle}
        >
          {showGrid && <CartesianGrid stroke={GRID_COLOR} vertical={false} />}
          <XAxis dataKey={x} stroke={AXIS_COLOR} tick={{ fontSize: 12 }} />
          <YAxis stroke={AXIS_COLOR} tick={{ fontSize: 12 }} />
          {showTooltip && (
            <Tooltip
              {...RECHARTS_TOOLTIP_PROPS}
              content={<ColumnFormatTooltip tableId={tableId} groupByColumn={groupByColumn} metricColumn={metricColumn} />}
            />
          )}
          {showLegend && <Legend />}
          <Line
            type={curved ? "monotone" : "linear"}
            dataKey={y}
            stroke={color}
            strokeWidth={strokeWidth}
            dot={showDots ? { r: 3 } : false}
            name={(config.yFieldLabel as string) || (tableId !== undefined && metricColumn ? resolveLabel(tableId, metricColumn) : "") || y}
          />
        </LineChart>
      )}
    </ResponsiveContainer>
  );
};


const PieRenderer = ({
  data,
  config,
  widgetId,
  tableId,
  dynamicViewId,
  dashboardId,
  drillDownColumn,
  drillDownColumnType,
}: { data: Row[]; config: Record<string, unknown> } & DrillProps) => {
  // Phase 77 Plan 02 (COLAPPLY-V115-02): configVersion subscription forces re-render on label/format edit.
  const configVersion = useColumnDisplayConfigStore((s) => s.configVersion);
  void configVersion; // referenced to prevent tree-shaking; reactive via subscription
  const { loadConfig } = useColumnDisplayConfigStore.getState();
  useEffect(() => {
    if (tableId !== undefined) loadConfig(tableId);
  }, [tableId, loadConfig]);
  const groupByColumn = (config.groupByColumn as string) || "";
  const metricColumn = (config.metricColumn as string) || "";
  const { x: nameKey, y: valueKey } = resolveKeys(data, config);
  const innerRadius = (config.innerRadius as number) ?? 0;
  const padAngle = (config.padAngle as number) ?? 2;
  const showLegend = config.showLegend !== false;
  const showTooltip = config.showTooltip !== false;

  const colors = [
    config.color1, config.color2, config.color3,
    config.color4, config.color5, config.color6,
  ].filter(Boolean) as string[];
  const palette = colors.length > 0 ? colors : DEFAULT_CHART_PALETTE;

  // Phase 10 DRILL-04: dim-peers transient via per-Cell fillOpacity comparison
  // against clickedElement (the nameKey value of the clicked slice).
  const [clickedElement, setClickedElement] = useState<unknown>(null);
  useEffect(() => {
    setClickedElement(null);
  }, [data]);

  const drillEnabled =
    !!drillDownColumn && (tableId !== undefined || dynamicViewId !== undefined);
  const wrapperStyle = { cursor: drillEnabled ? "pointer" : "default" };

  // RESEARCH.md Pitfall 1: Pie click signature differs — slice.payload is the
  // source row, NOT slice directly.
  const handleSliceClick = (slice: unknown) => {
    if (!drillEnabled) return;
    const row = (slice as { payload?: Row })?.payload;
    if (!row) return;
    // Aggregated chart → drill on the group-by column (the clicked slice's category).
    const { column, value, dataType } = resolveAggregatedDrillTarget(
      row, groupByColumn, drillDownColumn, drillDownColumnType,
    );
    setClickedElement(value);
    // PITFALL C-03 sequencing: dispatch addFilter after 300ms.
    setTimeout(() => {
      dispatchDrillDown({
        tableId,
        dynamicViewId,
        dashboardId,
        column,
        value,
        dataType,
        widgetId,
      });
    }, 300);
  };

  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart style={wrapperStyle}>
        <Pie
          data={data}
          dataKey={valueKey}
          nameKey={nameKey}
          innerRadius={innerRadius}
          outerRadius="80%"
          paddingAngle={padAngle}
          // Phase 77 follow-up (COLAPPLY-V115-02): slice labels run the metric value through
          // the column formatter (e.g. raw 252191.8498… → $252,191.85) for consistency with the
          // tooltip. Falls back to the raw value when no tableId/metricColumn (legacy/dv-bound).
          label={
            config.showLabels === false
              ? false
              : (entry: { value?: unknown }) =>
                  String(
                    (tableId !== undefined && metricColumn
                      ? resolveFormatter(tableId, metricColumn)(entry.value)
                      : entry.value) ?? "",
                  )
          }
          onClick={handleSliceClick}
        >
          {data.map((row, index) => (
            <Cell
              key={index}
              fill={palette[index % palette.length]}
              fillOpacity={
                clickedElement !== null
                  ? String(row[nameKey]) === String(clickedElement)
                    ? 1.0
                    : 0.3
                  : 1.0
              }
            />
          ))}
        </Pie>
        {/* ColumnFormatTooltip handles item color via var(--text) and entry.color — these
            explicit itemStyle/labelStyle props are preserved for fallback but content= takes precedence. */}
        {showTooltip && (
          <Tooltip
            {...RECHARTS_TOOLTIP_PROPS}
            itemStyle={{ color: "var(--text)" }}
            labelStyle={{ color: "var(--text)" }}
            content={<ColumnFormatTooltip tableId={tableId} groupByColumn={groupByColumn} metricColumn={metricColumn} />}
          />
        )}
        {showLegend && <Legend />}
      </PieChart>
    </ResponsiveContainer>
  );
};

const ScatterRenderer = ({
  data,
  config,
  widgetId,
  tableId,
  dynamicViewId,
  dashboardId,
  drillDownColumn,
  drillDownColumnType,
}: { data: Row[]; config: Record<string, unknown> } & DrillProps) => {
  const { grid: GRID_COLOR, axis: AXIS_COLOR } = useChartAxisColors();
  // Phase 77 Plan 02 (COLAPPLY-V115-02): configVersion subscription forces re-render on label/format edit.
  const configVersion = useColumnDisplayConfigStore((s) => s.configVersion);
  void configVersion; // referenced to prevent tree-shaking; reactive via subscription
  const { loadConfig } = useColumnDisplayConfigStore.getState();
  useEffect(() => {
    if (tableId !== undefined) loadConfig(tableId);
  }, [tableId, loadConfig]);
  const groupByColumn = (config.groupByColumn as string) || "";
  const metricColumn = (config.metricColumn as string) || "";
  const { x, y } = resolveKeys(data, config);
  const color = (config.color as string) || DEFAULT_SCATTER_COLOR;
  const dotSize = (config.dotSize as number) ?? 6;
  const showGrid = config.showGrid !== false;
  const showTooltip = config.showTooltip !== false;

  // Phase 10 DRILL-04: dim-peers transient — clickedElement holds the x-value of
  // the clicked dot for the 300ms window.
  const [clickedElement, setClickedElement] = useState<unknown>(null);
  useEffect(() => {
    setClickedElement(null);
  }, [data]);

  const drillEnabled =
    !!drillDownColumn && (tableId !== undefined || dynamicViewId !== undefined);
  const wrapperStyle = { cursor: drillEnabled ? "pointer" : "default" };

  const handleChartClick = (nextState: unknown) => {
    if (!drillEnabled) return;
    const payload = (nextState as { activePayload?: Array<{ payload?: Row }> } | null)
      ?.activePayload?.[0]?.payload;
    if (!payload) return;
    // Aggregated chart → drill on the group-by / x-dimension column (the clicked category).
    const { column, value, dataType } = resolveAggregatedDrillTarget(
      payload, groupByColumn, drillDownColumn, drillDownColumnType,
    );
    setClickedElement(value);
    // PITFALL C-03 sequencing: dispatch addFilter after 300ms.
    setTimeout(() => {
      dispatchDrillDown({
        tableId,
        dynamicViewId,
        dashboardId,
        column,
        value,
        dataType,
        widgetId,
      });
    }, 300);
  };

  return (
    <ResponsiveContainer width="100%" height="100%">
      <ScatterChart
        margin={{ top: 10, right: 10, left: -10, bottom: 0 }}
        onClick={handleChartClick}
        style={wrapperStyle}
      >
        {showGrid && <CartesianGrid stroke={GRID_COLOR} />}
        <XAxis
          dataKey={x}
          stroke={AXIS_COLOR}
          tick={{ fontSize: 12 }}
          name={(config.xLabel as string) || x}
          type="number"
        />
        <YAxis
          dataKey={y}
          stroke={AXIS_COLOR}
          tick={{ fontSize: 12 }}
          name={(config.yLabel as string) || y}
          type="number"
        />
        {showTooltip && (
          <Tooltip
            {...RECHARTS_TOOLTIP_PROPS}
            content={<ColumnFormatTooltip tableId={tableId} groupByColumn={groupByColumn} metricColumn={metricColumn} />}
          />
        )}
        <Scatter data={data} fill={color}>
          {data.map((row, i) => (
            <Cell
              key={i}
              r={dotSize}
              fillOpacity={
                clickedElement !== null
                  ? String(row[x]) === String(clickedElement)
                    ? 1.0
                    : 0.3
                  : 1.0
              }
            />
          ))}
        </Scatter>
      </ScatterChart>
    </ResponsiveContainer>
  );
};

const TableRenderer = ({
  data,
  config,
  widgetId,
  tableId,
  dynamicViewId,
  dashboardId,
  drillDownColumn,
  drillDownColumnType,
  tableFilters,
}: { data: Row[]; config: Record<string, unknown>; tableFilters: ActiveFilter[] } & DrillProps) => {
  const pageSize = (config.pageSize as number) || 25;
  const compact = config.compact !== false; // default compact to match the compact theme
  const striped = config.striped !== false;
  const showValueBars = config.showValueBars !== false; // default ON
  const barColor = (config.barColor as string) || DEFAULT_TABLE_BAR_COLOR;

  // Aggregated-only contract: ChartConfigPanel emits SQL of the form
  //   SELECT <groupByColumn>, AGG(<metricColumn>) AS value FROM ... GROUP BY ...
  // so the result rows always have exactly two columns — the group-by column and `value`.
  // Detect aggregation from the data shape (presence of a `value` column + ≥1 other column)
  // rather than config keys: older widgets carry only `sql` in config, and the un-configured
  // fallback path (SELECT * LIMIT 100) returns rows that lack `value`, naturally landing on
  // the empty-state branch.
  const dataKeys = Object.keys(data[0] ?? {});
  const hasValueCol = dataKeys.includes("value");
  // Use config.groupByColumn when set, otherwise fall back to the first non-`value` data
  // column so legacy widgets (sql-only config) still render correctly.
  const groupByColumn =
    (config.groupByColumn as string) || dataKeys.find((k) => k !== "value") || "";
  const metricColumn = (config.metricColumn as string) || "";
  const aggregation = (config.aggregation as string) || "";
  const isAggregated = hasValueCol && Boolean(groupByColumn);

  // No `value` column → SQL fell back to SELECT *. Don't render raw rows with bars.
  if (!isAggregated) {
    return (
      <div className="widget-placeholder">
        <span>Configure Group By, Metric, and Aggregation to see aggregated values.</span>
      </div>
    );
  }

  // Cap rendered rows to pageSize (SQL already applied LIMIT; this is a defensive trim).
  const displayData = data.slice(0, pageSize);

  // Per-column max scan on the value column. Bar width = (row.value / colMax) * 100%.
  // Scaled across rendered rows so the largest aggregated value always fills the cell.
  let valueMax = -Infinity;
  for (const row of displayData) {
    const raw = row["value"];
    if (raw === null || raw === undefined || raw === "") continue;
    const n = typeof raw === "number" ? raw : Number(raw);
    if (Number.isFinite(n) && n > valueMax) valueMax = n;
  }
  if (!(valueMax > 0)) valueMax = 1; // guard divide-by-zero when all values are 0/null

  // Build a human header. If config carries the discrete fields we prefer
  // `AGG(metric)`; legacy widgets that only stored `sql` fall back to `value`.
  const valueHeader = aggregation && metricColumn
    ? (aggregation === "COUNT_DISTINCT"
        ? `COUNT(DISTINCT ${metricColumn})`
        : `${aggregation}(${metricColumn})`)
    : "value";

  const drillEnabled =
    !!drillDownColumn && (tableId !== undefined || dynamicViewId !== undefined);
  // This "Data Table" is an AGGREGATED chart (group-by + value), so — like bar/pie — the
  // drill filters on the group-by column (the clicked row's category), never a diverged
  // drillDownColumn that isn't in the aggregated row (which produced `= 'undefined'`).
  const drillCol = groupByColumn || drillDownColumn;
  // Phase 10 DRILL-04: row-tint — find the active filter value for the drill column so
  // matching rows get the highlight class.
  const activeFilterValue = tableFilters.find((f) => f.column === drillCol)?.value;

  const handleRowClick = (row: Row) => {
    if (!drillEnabled) return;
    const { column, value, dataType } = resolveAggregatedDrillTarget(
      row, groupByColumn, drillDownColumn, drillDownColumnType,
    );
    // No dim-peers transient on table — direct dispatch, but still 300ms-delayed
    // for consistency with bar/pie/scatter timing AND to keep the data-clear visible
    // (PITFALL C-03 sequencing — same across chart types).
    setTimeout(() => {
      dispatchDrillDown({
        tableId,
        dynamicViewId,
        dashboardId,
        column,
        value,
        dataType,
        widgetId,
      });
    }, 300);
  };

  return (
    <div className="widget-table-wrap">
      <table className={`widget-table ${compact ? "widget-table-compact" : ""}`}>
        <thead>
          <tr>
            <th>{groupByColumn.toUpperCase()}</th>
            <th>{valueHeader}</th>
          </tr>
        </thead>
        <tbody>
          {displayData.map((row, i) => {
            const groupVal = row[groupByColumn];
            const rawValue = row["value"];
            const n = typeof rawValue === "number" ? rawValue : Number(rawValue);
            const safeN = Number.isFinite(n) ? n : 0;
            const pct = safeN > 0 ? Math.min(100, (safeN / valueMax) * 100) : 0;
            const display = formatBigNumberValue(safeN, { format: "smart" });

            const isFiltered =
              drillEnabled &&
              activeFilterValue !== undefined &&
              String(row[drillCol]) === String(activeFilterValue);
            const classes = [
              striped && i % 2 === 1 ? "widget-table-stripe" : "",
              isFiltered ? "widget-table-row-active" : "",
            ]
              .filter(Boolean)
              .join(" ");
            return (
              <tr
                key={i}
                className={classes}
                onClick={() => handleRowClick(row)}
                style={{ cursor: drillEnabled ? "pointer" : undefined }}
              >
                <td>{String(groupVal ?? "")}</td>
                {showValueBars ? (
                  <td className="widget-table-cell-bar">
                    <div
                      className="widget-table-cell-bar-fill"
                      style={{
                        width: `${pct}%`,
                        background: `linear-gradient(to right, ${barColor}b3 0%, ${barColor}33 100%)`,
                      }}
                      aria-hidden="true"
                    />
                    <span className="widget-table-cell-bar-text">{display}</span>
                  </td>
                ) : (
                  <td>{display}</td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

const BigNumberRenderer = ({ data, config }: { data: Row[]; config: Record<string, unknown> }) => {
  const keys = Object.keys(data[0] ?? {});
  const valueField = keys.includes("value") ? "value" : keys[0] || "";
  const rawValue = data[0]?.[valueField];
  const prefix = (config.prefix as string) || "";
  const suffix = (config.suffix as string) || "";
  const color = (config.color as string) || DEFAULT_BIGNUMBER_COLOR;
  const label = (config.label as string) || valueField;
  const subLabel = (config.subLabel as string) || "";

  const formatted = formatBigNumberValue(rawValue, {
    format: config.format as string | undefined,
    decimals: config.decimals as number | undefined,
  });
  const effectiveColor = pickBigNumberColor(
    rawValue,
    color,
    config.colorRules as BigNumberColorRule[] | undefined,
  );

  return (
    <div className="widget-bignumber">
      <div className="widget-bignumber-label">{label}</div>
      <div className="widget-bignumber-value" style={{ color: effectiveColor }}>
        {prefix}{formatted}{suffix}
      </div>
      {subLabel && <div className="widget-bignumber-sub">{subLabel}</div>}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  Records Table — server-paginated, interactive sort, total count    */
/* ------------------------------------------------------------------ */

const IDENT_RE = /^[a-zA-Z_][a-zA-Z0-9_.]*$/;

const RecordsTableRenderer = ({ widget }: Props) => {
  const cfg = widget.config ?? {};
  const table = (cfg.table as string) || "";
  const columnsRaw = ((cfg.columns as string) || "").split(",").map((c) => c.trim()).filter(Boolean);
  const safeColumns = columnsRaw.filter((c) => IDENT_RE.test(c));
  const initialSortField = (cfg.sortField as string) || "";
  const initialSortDir = ((cfg.sortDirection as string) || "asc").toLowerCase() === "desc" ? "desc" : "asc";
  const pageSize = Math.max(1, Number(cfg.pageSize) || 25);
  const compact = cfg.compact !== false; // default compact to match the compact theme
  const striped = cfg.striped !== false;
  // Phase 98-02 (VIZSQL-V119-02): compute WHERE clause for non-empty customWhere.
  // whereCustomWhere returns ' WHERE (<predicate>)' with leading space, or '' for empty/absent.
  const cw = whereCustomWhere((cfg.customWhere as string | undefined) ?? "");

  // Phase 10 DRILL-01 + DRILL-04: drill-down config + filter subscription.
  // RESEARCH.md Pitfall 3: RecordsTableRenderer was previously NOT subscribed to
  // the filter store (only AggregatedWidgetRenderer was). For DRILL-04's row-tint
  // we MUST subscribe directly here — the records short-circuit at line 175 means
  // AggregatedWidgetRenderer's subscription never reaches us.
  const tableId = cfg.tableId as number | undefined;
  // Phase 77-01 (COLAPPLY-V115-01): subscribe to configVersion (primitive selector) so
  // Phase 76 editor mutations re-render this component and re-invoke resolve* helpers.
  // Mirror the filterVersion pattern at :394 — primitive selector, not the whole state.
  const configVersion = useColumnDisplayConfigStore((s) => s.configVersion);
  // Phase 35 Plan 05 (DV-V16-13): dv-bound widget — same semantics as AggregatedWidget.
  // Effect 1 (Phase 30 spatial materialize trigger) STAYS UNCHANGED — filter view is the
  // `{view}` substitution source for the dv template.
  const dynamicViewId = cfg.dynamicViewId as number | undefined;
  const drillDownColumn = (cfg.drillDownColumn as string) || "";
  const drillDownColumnType =
    (cfg.drillDownColumnType as DrillDownDataType) || "string";
  const drillEnabled =
    !!drillDownColumn && (tableId !== undefined || dynamicViewId !== undefined);
  // Phase 17-03: dashboardId from DashboardContext for synchronous markMaterializing in row-click drill.
  // Phase 96-01 GAP 2: records is now part of the combination model (orchestrator owns
  // materialization, incl. spatial), so this renderer no longer reads `widgets` to fire its own
  // spatial materialize — that legacy island was removed.
  // Phase 35 Plan 05 (DV-V16-13): also read dynamicViews (orphan detection) + retryDynamicView (error retry).
  const { dashboardId, dynamicViews: dashboardDynamicViews, retryDynamicView } =
    useDashboardContext();
  const recordsTableFilters = useFilterStore((state) =>
    tableId !== undefined ? state.filters[tableId] ?? [] : []
  );
  // Phase 96-01 GAP 2: migrated into the combination model — selectors now read
  // filterCombinationStore (vizToHash → registry) instead of the legacy filterViewStore.
  // Mirrors AggregatedWidgetRenderer's combo-read pattern (Phase 91).
  const recordsVizKey = `w:${widget.id}`;
  // PITFALL S-02 lock: ONE primitive comboKey selector (viewName:expiresAt:materializing).
  const recordsComboKey = useFilterCombinationStore((s) => {
    const h = s.vizToHash[recordsVizKey];
    const e = h && !h.endsWith(`:${NOFILTER_SENTINEL}`) ? s.registry[h] : undefined;
    return `${e?.viewName ?? ""}:${e?.expiresAt ?? 0}:${e?.materializing ? "1" : "0"}`;
  });
  // combinationVersion is the suspend-lift dep (mirrors AggregatedWidgetRenderer pattern).
  const recordsCombinationVersion = useFilterCombinationStore((s) => s.combinationVersion);
  // Phase 35 Plan 05 (DV-V16-13): scoped dv selectors for dv-bound records-table widgets.
  // PITFALL C-02 lock — scope to s.views[dynamicViewId], NEVER the whole views map.
  // KEPT as fallback for dv path (combo view prefers dv-combo entry, falls back to raw dv view).
  const recordsDvEntry = useDynamicViewStore((s) =>
    dynamicViewId !== undefined ? s.views[dynamicViewId] : undefined,
  );
  const recordsDvStatus = recordsDvEntry?.status;
  const recordsDvViewName = recordsDvEntry?.viewName;
  const recordsDvError = recordsDvEntry?.error;
  const recordsDvReason = recordsDvEntry?.reason;
  // Phase 35 Plan 05: orphan detection — dynamicViewId set + no entry + not in dashboard list.
  const isOrphanRecordsDynamicView =
    dynamicViewId !== undefined &&
    recordsDvEntry === undefined &&
    !dashboardDynamicViews.some((dv) => dv.id === dynamicViewId);

  const activeFilterValue = recordsTableFilters.find(
    (f) => f.column === drillDownColumn,
  )?.value;

  const [page, setPage] = useState(1);
  const [sortField, setSortField] = useState<string>(initialSortField);
  const [sortDir, setSortDir] = useState<"asc" | "desc">(initialSortDir);
  const [data, setData] = useState<Row[]>([]);
  const [columnOrder, setColumnOrder] = useState<string[]>([]);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // FK4: CSV export state
  const enableCsvDownload = cfg.enableCsvDownload !== false;
  const csvDownloadRowCap = Math.max(1, Math.floor(Number(cfg.csvDownloadRowCap) || 100000));
  const [exporting, setExporting] = useState(false);
  const exportAbortRef = useRef<AbortController | null>(null);

  // FK4: abort in-flight export on unmount
  useEffect(() => () => exportAbortRef.current?.abort(), []);

  // Phase 77-01 (COLAPPLY-V115-01): load column display config for this table once when
  // tableId is known. The store caches; loadConfig replaces the entry and bumps configVersion.
  // Guard against undefined (dv-bound widgets have no tableId — raw fallback is accepted).
  useEffect(() => {
    if (tableId !== undefined) {
      void useColumnDisplayConfigStore.getState().loadConfig(tableId);
    }
  }, [tableId]);

  const handleDownloadCsv = async () => {
    // Abort previous in-flight export if still running
    exportAbortRef.current?.abort();
    const controller = new AbortController();
    exportAbortRef.current = controller;

    // Phase 96-01 GAP 2: Resolve source via combo store (mirrors page-fetch effect).
    const comboHashCsv = useFilterCombinationStore.getState().vizToHash[recordsVizKey];
    const comboEntryCsv = comboHashCsv && !comboHashCsv.endsWith(`:${NOFILTER_SENTINEL}`)
      ? useFilterCombinationStore.getState().registry[comboHashCsv]
      : undefined;
    const effectiveViewNameCsv = dynamicViewId !== undefined
      ? (comboEntryCsv?.viewName || recordsDvViewName)
      : (comboEntryCsv?.viewName ?? "");
    const fromSourceCsv = effectiveViewNameCsv || table;

    // Columns: use columnOrder if non-empty (on-screen order), else fall back to effectiveColumns
    const exportCols = columnOrder.length > 0 ? columnOrder : effectiveColumns;
    const colsClause = exportCols.length > 0 ? exportCols.join(", ") : "*";
    const orderBy =
      sortField && IDENT_RE.test(sortField)
        ? ` ORDER BY ${sortField} ${sortDir.toUpperCase()}`
        : "";

    setExporting(true);
    const PAGE = 5000;
    const all: Row[] = [];
    let offset = 0;
    let capped = false;
    try {
      while (all.length < csvDownloadRowCap) {
        const remaining = csvDownloadRowCap - all.length;
        const limit = Math.min(PAGE, remaining);
        const sql = `SELECT ${colsClause} FROM ${fromSourceCsv}${cw}${orderBy} LIMIT ${limit} OFFSET ${offset}`;
        const res = await runSql<Record<string, unknown>>(sql, undefined, controller.signal);
        const rows = parseKineticaResponse(res);
        all.push(...rows);
        offset += rows.length;
        if (rows.length < limit) break; // exhausted the view
        if (all.length >= csvDownloadRowCap && rows.length === limit) {
          capped = true;
          break;
        }
      }

      const finalCols = exportCols.length > 0 ? exportCols : Object.keys(all[0] ?? {});
      const csv = rowsToCsv(all, finalCols);
      const filename = buildCsvFilename(
        widget.title && widget.title.trim() ? widget.title : table,
        new Date(),
      );

      if (typeof document !== "undefined") {
        const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.style.display = "none";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }

      if (capped) {
        useToastStore.getState().showToast(`Capped at ${csvDownloadRowCap.toLocaleString()} rows`, "info");
      }
    } catch (err) {
      if ((err as Error)?.name === "AbortError") return;
      useToastStore.getState().showToast((err as Error).message, "error");
    } finally {
      if (exportAbortRef.current === controller) setExporting(false);
    }
  };

  // Reset page when sort changes
  useEffect(() => {
    setPage(1);
  }, [sortField, sortDir]);

  // Phase 96-01 GAP 2: The records-table materialize-trigger effect has been REMOVED.
  // The combination orchestrator (useCombinationOrchestrator) is now the SOLE trigger for
  // records' combination view. RecordsTableRenderer is a READ-ONLY consumer of
  // filterCombinationStore (reads vizToHash[recordsVizKey] → registry[hash] in page/count effects).

  // Effective columns: user-configured list, or empty (SELECT * — Kinetica always
  // returns positional keys column_N, but parseKineticaResponse remaps them via
  // column_headers so real names flow through automatically).
  const effectiveColumns = safeColumns;

  // Fetch one page of records
  // Phase 96-01 GAP 2: reads combo store imperatively (mirrors AggregatedWidgetRenderer Effect 2).
  // Suspend gate: comboEntry?.materializing (replaces legacy recordsTableMaterializing).
  // effectiveViewName: comboEntry?.viewName (table) or dvComboEntry?.viewName || recordsDvViewName (dv).
  // Phase 35 Plan 05 (DV-V16-13): for dv-bound widgets, dv status gates apply (pending / error / etc.).
  useEffect(() => {
    if (!table) {
      setData([]);
      setError(null);
      return;
    }
    if (!IDENT_RE.test(table)) {
      setError(`Invalid table name: ${table}`);
      return;
    }

    // Phase 96-01: imperative combo read (avoids stale closure — mirrors AWR Effect 2).
    // recordsComboKey / recordsCombinationVersion are the reactive deps; actual entry fields
    // read here at effect-call time for accuracy (PITFALL S-02 pattern).
    const comboHash = useFilterCombinationStore.getState().vizToHash[recordsVizKey];
    const comboEntry = comboHash && !comboHash.endsWith(`:${NOFILTER_SENTINEL}`)
      ? useFilterCombinationStore.getState().registry[comboHash]
      : undefined;

    // Suspend gate: combo materializing (covers both table and dv paths via same vizKey).
    if (comboEntry?.materializing) return;

    // Phase 35 Plan 05 (research finding #7): extend suspend-gate to dv pending status.
    if (dynamicViewId !== undefined && recordsDvStatus === "pending") return;

    // Phase 35 Plan 05: short-circuit for non-materialized dv statuses.
    if (dynamicViewId !== undefined) {
      if (isOrphanRecordsDynamicView) return;
      if (recordsDvStatus === undefined) return; // initial — render-body shows loading
      if (recordsDvStatus === "over_threshold") return; // empty-state render below
      if (recordsDvStatus === "error") return; // error+retry render below
      // recordsDvStatus === "materialized" → fall through with effectiveViewName below.
    }

    // LIFE-V13-01 PROACTIVE: clear stale combo entry; orchestrator re-materializes on next tick.
    // Phase 96-01: replaced filterViewStore.clearView with clearEntry(comboHash).
    if (
      dynamicViewId === undefined &&
      comboEntry?.viewName &&
      comboEntry.expiresAt > 0 &&
      Date.now() >= comboEntry.expiresAt &&
      comboHash
    ) {
      useFilterCombinationStore.getState().clearEntry(comboHash);
      return; // effect re-fires when recordsComboKey selector flips
    }

    const colsClause = effectiveColumns.length > 0 ? effectiveColumns.join(", ") : "*";
    const orderBy = sortField && IDENT_RE.test(sortField)
      ? ` ORDER BY ${sortField} ${sortDir.toUpperCase()}`
      : "";
    const offset = (page - 1) * pageSize;
    // Phase 96-01: FROM-swap — dv path prefers dv-combo view, falls back to raw dv view.
    // table path uses combo entry viewName ("" → base table). `||` not `??` — empty string falls through.
    const effectiveViewName = dynamicViewId !== undefined
      ? (comboEntry?.viewName || recordsDvViewName)
      : (comboEntry?.viewName ?? "");
    const fromSource = effectiveViewName || table;
    const sql = `SELECT ${colsClause} FROM ${fromSource}${cw}${orderBy} LIMIT ${pageSize} OFFSET ${offset}`;

    setLoading(true);
    setError(null);
    runSql<Record<string, unknown>>(sql)
      .then((res) => {
        const rows = parseKineticaResponse(res);
        setData(rows);
        // Lock in column order from effectiveColumns (preferred) or response keys
        const firstRowKeys = Object.keys(rows[0] ?? {});
        setColumnOrder(effectiveColumns.length > 0 ? effectiveColumns : firstRowKeys);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
    // Phase 96-01: recordsComboKey + recordsCombinationVersion replace legacy filterViewStore deps.
    // dynamicViewId + recordsDvStatus + recordsDvViewName still drive dv re-fires.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    table,
    recordsComboKey,
    recordsCombinationVersion,
    effectiveColumns.join(","),
    sortField,
    sortDir,
    page,
    pageSize,
    dynamicViewId,
    recordsDvStatus,
    recordsDvViewName,
  ]);

  // Fetch total count — Phase 15-03 (FILT-V13-02 success criterion #2): re-fires on comboKey change
  // so the count narrows when filter is activated.
  // Phase 96-01 GAP 2: mirrors page-fetch effect — reads combo store, same suspend gate.
  useEffect(() => {
    if (!table || !IDENT_RE.test(table)) {
      setTotalCount(null);
      return;
    }

    // Phase 96-01: imperative combo read (mirrors page-fetch effect).
    const comboHash = useFilterCombinationStore.getState().vizToHash[recordsVizKey];
    const comboEntry = comboHash && !comboHash.endsWith(`:${NOFILTER_SENTINEL}`)
      ? useFilterCombinationStore.getState().registry[comboHash]
      : undefined;

    // Suspend gate: combo materializing.
    if (comboEntry?.materializing) return;

    // Phase 35 Plan 05 (research finding #7): extend suspend-gate to dv pending status.
    if (dynamicViewId !== undefined && recordsDvStatus === "pending") return;

    // Phase 35 Plan 05: short-circuit for non-materialized dv statuses.
    if (dynamicViewId !== undefined) {
      if (isOrphanRecordsDynamicView) return;
      if (recordsDvStatus === undefined) return;
      if (recordsDvStatus === "over_threshold") return;
      if (recordsDvStatus === "error") return;
    }

    // LIFE-V13-01 PROACTIVE: clear stale combo entry.
    if (
      dynamicViewId === undefined &&
      comboEntry?.viewName &&
      comboEntry.expiresAt > 0 &&
      Date.now() >= comboEntry.expiresAt &&
      comboHash
    ) {
      useFilterCombinationStore.getState().clearEntry(comboHash);
      return;
    }

    // Phase 96-01: FROM-swap via combo store.
    const effectiveViewName = dynamicViewId !== undefined
      ? (comboEntry?.viewName || recordsDvViewName)
      : (comboEntry?.viewName ?? "");
    const fromSource = effectiveViewName || table;
    runSql<Record<string, unknown>>(`SELECT COUNT(*) AS total FROM ${fromSource}`)
      .then((res) => {
        const rows = parseKineticaResponse(res);
        const v = rows[0]?.total;
        const n = typeof v === "number" ? v : Number(v);
        setTotalCount(Number.isFinite(n) ? n : null);
      })
      .catch(() => setTotalCount(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    table,
    recordsComboKey,
    recordsCombinationVersion,
    dynamicViewId,
    recordsDvStatus,
    recordsDvViewName,
  ]);

  const handleHeaderClick = (col: string) => {
    if (!IDENT_RE.test(col)) return;
    if (sortField === col) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(col);
      setSortDir("asc");
    }
  };

  if (!table) {
    return <div className="widget-placeholder"><span>Select a data source to load records</span></div>;
  }

  // Phase 35 Plan 05 (DV-V16-13/14): status-aware render gates for dv-bound records-table widgets.
  // ORDER: orphan first (highest priority — dv reference is dangling), then status branches.
  if (isOrphanRecordsDynamicView) {
    return (
      <div className="widget-placeholder widget-orphan-dynamic-view">
        <span>This dynamic view was deleted. Reconfigure the widget.</span>
      </div>
    );
  }
  if (dynamicViewId !== undefined) {
    if (recordsDvStatus === undefined || recordsDvStatus === "pending") {
      return (
        <div className="widget-placeholder">
          <span>Loading...</span>
        </div>
      );
    }
    if (recordsDvStatus === "over_threshold") {
      if (recordsDvReason === "no_filter") {
        return (
          <div className="widget-placeholder widget-over-threshold">
            <span>No filter applied — load the full table, or apply a filter to narrow it.</span>
            <button
              type="button"
              className="widget-retry-btn"
              onClick={() => retryDynamicView(dynamicViewId)}
            >
              Load full table
            </button>
          </div>
        );
      }
      return (
        <div className="widget-placeholder widget-over-threshold">
          <span>Too much data — narrow your filters to enable this view.</span>
        </div>
      );
    }
    if (recordsDvStatus === "error") {
      return (
        <div className="widget-placeholder widget-error">
          <span>{recordsDvError ?? "Dynamic view materialize failed"}</span>
          <button
            type="button"
            className="widget-retry-btn"
            onClick={() => retryDynamicView(dynamicViewId)}
          >
            Retry
          </button>
        </div>
      );
    }
    // recordsDvStatus === "materialized" → fall through to existing render chain.
  }

  if (error) {
    return <div className="widget-placeholder widget-error"><span>{error}</span></div>;
  }
  if (loading && data.length === 0) {
    return <div className="widget-placeholder"><span>Loading records…</span></div>;
  }
  if (!loading && data.length === 0) {
    return <div className="widget-placeholder"><span>No records returned</span></div>;
  }

  const totalPages = totalCount !== null ? Math.max(1, Math.ceil(totalCount / pageSize)) : null;
  const fromRow = (page - 1) * pageSize + 1;
  const toRow = (page - 1) * pageSize + data.length;
  const canPrev = page > 1;
  const canNext = totalPages !== null ? page < totalPages : data.length === pageSize;

  return (
    <div className="widget-records">
      <div className="widget-table-wrap">
        <table className={`widget-table ${compact ? "widget-table-compact" : ""}`}>
          <thead>
            <tr>
              {columnOrder.map((col) => {
                const isSorted = sortField === col;
                const arrow = isSorted ? (sortDir === "asc" ? " ▲" : " ▼") : "";
                // Phase 77-01 (COLAPPLY-V115-01): resolve display label.
                // Guard against undefined tableId (dv-bound widget) — raw col name as fallback.
                // configVersion subscription above ensures re-render when config changes.
                const headerLabel = tableId !== undefined ? resolveLabel(tableId, col) : col;
                return (
                  <th
                    key={col}
                    className="widget-table-th-sortable"
                    onClick={() => handleHeaderClick(col)}
                    title={`Sort by ${col}`}
                  >
                    {headerLabel}{arrow}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {data.map((row, i) => {
              const isFiltered =
                drillEnabled &&
                activeFilterValue !== undefined &&
                String(row[drillDownColumn]) === String(activeFilterValue);
              const classes = [
                striped && i % 2 === 1 ? "widget-table-stripe" : "",
                isFiltered ? "widget-table-row-active" : "",
              ]
                .filter(Boolean)
                .join(" ");
              const handleRowClick = () => {
                if (!drillEnabled) return;
                const value = row[drillDownColumn];
                // PITFALL C-03 sequencing: dispatch addFilter after 300ms.
                setTimeout(() => {
                  dispatchDrillDown({
                    tableId,
                    dynamicViewId,
                    dashboardId,
                    column: drillDownColumn,
                    value,
                    dataType: drillDownColumnType,
                    widgetId: widget.id,
                  });
                }, 300);
              };
              return (
                <tr
                  key={i}
                  className={classes}
                  onClick={handleRowClick}
                  style={{ cursor: drillEnabled ? "pointer" : undefined }}
                >
                  {columnOrder.map((col) => {
                    // Phase 77-01 (COLAPPLY-V115-01): resolve formatter for this column.
                    // Guard against undefined tableId (dv-bound widget) — identity passthrough.
                    const fmt = tableId !== undefined ? resolveFormatter(tableId, col) : (v: unknown) => v;
                    const formatted = fmt(row[col]);
                    return <td key={col}>{String(formatted ?? "")}</td>;
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="widget-records-footer">
        {enableCsvDownload && (
          <button
            type="button"
            className="widget-csv-download ghost-sm"
            disabled={exporting}
            onClick={handleDownloadCsv}
          >
            {exporting ? "Exporting…" : "Download"}
          </button>
        )}
        <span className="widget-records-count">
          {totalCount !== null
            ? `Showing ${fromRow.toLocaleString()}–${toRow.toLocaleString()} of ${totalCount.toLocaleString()}`
            : `Showing ${fromRow.toLocaleString()}–${toRow.toLocaleString()}`}
        </span>
        <div className="widget-records-pager">
          <button
            className="ghost-sm"
            disabled={!canPrev}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Prev
          </button>
          <span className="widget-records-page-indicator">
            Page {page}{totalPages !== null ? ` of ${totalPages.toLocaleString()}` : ""}
          </span>
          <button
            className="ghost-sm"
            disabled={!canNext}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
};

export default WidgetRenderer;
