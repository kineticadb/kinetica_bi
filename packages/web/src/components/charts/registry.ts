import type { ComponentType } from "react";
import type { WidgetDto, DynamicViewRow } from "../../api/client";

/* ------------------------------------------------------------------ */
/*  Config‑field descriptor – drives the generic config form          */
/* ------------------------------------------------------------------ */

export type FieldType =
  | "text"
  | "textarea"
  | "number"
  | "boolean"
  | "select"
  | "color"
  | "range"
  // Repeatable {min?, max?, color} rules — used by Big Number to color the value
  // by range. Stored as an array on config[key].
  | "colorRules"
  // Reusable number/date format picker (the shared FormatSpecEditor). Stored as a
  // FormatSpec object on config[key], or null/undefined = "use column default".
  | "formatSpec";

export type ConfigField = {
  key: string;
  label: string;
  type: FieldType;
  /** For "select" fields */
  options?: { value: string; label: string }[];
  /** For "range" fields */
  min?: number;
  max?: number;
  step?: number;
  defaultValue: unknown;
  /** Optional grouping label shown as a section header */
  group?: string;
  /** Hint text shown below the field */
  hint?: string;
};

/* ------------------------------------------------------------------ */
/*  Chart‑type definition                                             */
/* ------------------------------------------------------------------ */

export type ConfigPanelProps = {
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
  /**
   * Column list from the selected table — passed by ChartConfigPanel to CustomConfigPanel
   * so panels like MapConfigPanel can filter by column type (Phase 11 MAP-02).
   */
  columns?: { name: string; type: string }[];
  /**
   * v1.5 Phase 28 (TARGET-V15-03): dashboard-scoped table list with per-table column metadata,
   * threaded through ChartConfigPanel from DashboardsPage's `associatedTables` state. MapConfigPanel
   * uses this to render the "Spatial filter targets" section's per-row table picker (operator can
   * configure any associated table as a spatial filter target, not just the widget's primary table).
   * Optional — non-map panels can ignore.
   */
  tables?: {
    id: number;
    name: string;
    schema: string;
    columns: Record<string, string>;
  }[];
  /**
   * Phase 11 11-08: panels can signal Apply-disable state to the parent.
   * If called with false, the caller should disable the Apply button.
   * MapConfigPanel uses this for classbreak mode when classbreaks.length < 2.
   */
  isValid?: (valid: boolean) => void;
  /**
   * Phase 42 (Plan 42-01 / WIDGET-V17-03): dashboard widget list, threaded from
   * DashboardsPage → WidgetConfigModal → ChartConfigPanel → Custom panel slot.
   * LegendConfigPanel (Plan 42-02) uses this to populate the source-map-widget
   * dropdown. Required as a prop (not via useDashboardContext) because
   * WidgetConfigModal is rendered OUTSIDE DashboardContextProvider —
   * useDashboardContext() would throw at runtime.
   * Optional — non-legend panels ignore.
   */
  widgets?: WidgetDto[];
  /**
   * Phase 66 (CAL-V113-01): dashboard-scoped dynamic-view list, forwarded from
   * ChartConfigPanel's own `dynamicViews` prop into the CustomConfigPanel slot.
   * CalendarConfigPanel uses this to render a dv-aware data-source dropdown
   * (table OR dynamic view) — TimelineConfigPanel never built a dv binding so
   * this prop was previously absent from ConfigPanelProps. Optional — panels
   * that bind base-table-only (Timeline) ignore it.
   */
  dynamicViews?: DynamicViewRow[];
};

export type ChartTypeDefinition = {
  type: string;
  label: string;
  icon: string;
  /** Declarative field list – the generic form renderer uses this */
  fields: ConfigField[];
  /** Merged into widget config on creation */
  defaultConfig: Record<string, unknown>;
  /**
   * Optional custom React component that replaces the generic form.
   * Use this when a chart type needs UI that can't be expressed as
   * simple fields (e.g. a column mapping builder).
   */
  CustomConfigPanel?: ComponentType<ConfigPanelProps>;
  /**
   * Whether this chart type uses aggregated SQL (group-by + AGG(metric)).
   * - true / undefined: standard chart (bar, line, pie, etc.) — config panel
   *   shows metric/aggregation/group-by fields and SQL is aggregated.
   * - false: raw-record viewer (records table). Config panel hides the
   *   aggregation fields and SQL is `SELECT cols FROM table` shape.
   */
  usesAggregation?: boolean;
  /**
   * Whether this aggregated chart type needs a Group By column.
   * - true / undefined: requires Group By (bar / line / pie / scatter / table) —
   *   ChartConfigPanel shows the picker; SQL is `SELECT groupBy, AGG(metric) ... GROUP BY groupBy`.
   * - false: scalar result (bignumber) — picker hidden; SQL is `SELECT AGG(metric) AS value FROM table`.
   *
   * Only consulted when `usesAggregation !== false`. Ignored for raw-record viewers
   * (records table) since those don't use aggregation at all.
   */
  requiresGroupBy?: boolean;
  /**
   * Whether this chart type uses a single source table — i.e. needs the
   * "Data Source" dropdown in ChartConfigPanel.
   * - true / undefined: chart pulls rows from one table/view via SQL. ChartConfigPanel
   *   shows the Data Source dropdown and persists tableRef + tableId into widget.config.
   * - false: chart owns its own source-of-truth (e.g. map widget configures per-row
   *   layers via dashboard_layers; ChartConfigPanel hides the Data Source section and
   *   does NOT write tableRef/tableId on save).
   */
  usesDataSource?: boolean;
  /**
   * Whether this chart type supports drill-down click-to-filter.
   * - true: clicks on chart elements (bars/slices/points/rows) call addFilter
   *   on useFilterStore; ChartConfigPanel shows the drill-down column picker.
   * - false / undefined: click handlers are no-ops; picker is hidden.
   *
   * Phase 10 / DRILL-01..DRILL-04. Bar, line, pie, scatter, table, records have
   * supportsDrillDown: true. Bignumber, heatmap, map remain unset (no row context
   * for bignumber; heatmap renderer doesn't exist; map drill-down is Phase 12).
   */
  supportsDrillDown?: boolean;
  /**
   * Whether this chart type can be ADDED from the "add visualization" picker.
   * - true / undefined: appears in the picker (default).
   * - false: hidden from the picker so no NEW widget of this type can be created.
   *   The type stays REGISTERED (getChartType still resolves it) so any pre-existing
   *   widget of this type continues to render. Used to retire non-functional types
   *   (heatmap — no renderer; scatter — non-functional) without a data migration.
   */
  addable?: boolean;
};

/* ------------------------------------------------------------------ */
/*  Registry                                                          */
/* ------------------------------------------------------------------ */

const registry = new Map<string, ChartTypeDefinition>();

export function registerChartType(def: ChartTypeDefinition) {
  registry.set(def.type, def);
}

export function getChartType(type: string): ChartTypeDefinition | undefined {
  return registry.get(type);
}

export function getAllChartTypes(): ChartTypeDefinition[] {
  return Array.from(registry.values());
}
