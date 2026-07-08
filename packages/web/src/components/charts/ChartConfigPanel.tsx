import { useState, useEffect, useMemo } from "react";
import { getChartType, type ConfigField } from "./registry";
import { FormatSpecEditor } from "./FormatSpecEditor";
import type { FormatSpec } from "../../lib/columnFormatter";
import { isColumnDrillDownSafe, inferDataTypeFromColumn } from "../../lib/columnTypes";
import type { DynamicViewRow, WidgetDto } from "../../api/client";
import { FilterSelectionPanel } from "./FilterSelectionPanel";
import type { FilterSelectionConfig } from "../../types/filterSelection";
import { useAuthStore } from "../../store/auth";
import { whereCustomWhere } from "../../lib/customWhere";
import {
  resolveMetricExpr,
  isCustomSelection,
  encodeCustomValue,
  decodeMetricSelection,
  metricSelectValue,
  isOrphanedMetric,
} from "../../lib/customMetricSql";
import { useCustomMetricsStore, selectMetrics } from "../../store/customMetricsStore";
import { isMultiColumnBarGroupBy } from "../../lib/barGroupedSeries";

type TableInfo = {
  id: number;
  name: string;
  schema: string;
  columns: Record<string, string>;
};

type ViewInfo = {
  id: number;
  table_id: number;
  view_name: string;
  filter_clause: string;
  status: string;
};

type Props = {
  widgetType: string;
  title: string;
  config: Record<string, unknown>;
  tables?: TableInfo[];
  views?: ViewInfo[];
  /**
   * Phase 35 (DV-V16-12): dashboard-scoped dynamic-view list. Threaded from
   * DashboardOpen via WidgetConfigModal. When non-empty, the "Data Source"
   * picker renders a third optgroup "Dynamic Views". Selecting a dv:<id> option
   * dual-writes dynamicViewId + tableId (= source_table_id) into widget.config
   * so existing drill-down + filter-bar code paths (which key on tableId)
   * keep working unchanged.
   */
  dynamicViews?: DynamicViewRow[];
  /**
   * Phase 42 (Plan 42-01): dashboard widget list threaded from WidgetConfigModal.
   * Forwarded to <Custom> panel slot so LegendConfigPanel (Plan 42-02) can populate
   * its source-map-widget dropdown.
   */
  widgets?: WidgetDto[];
  /**
   * Phase 93 (FSCOPE-V118-01): the id of the widget being configured. Passed to
   * FilterSelectionPanel for self-exclusion (the widget cannot list itself as a
   * filter source). Optional so existing call sites are unaffected.
   */
  widgetId?: number;
  onSave: (payload: { title: string; config: Record<string, unknown> }) => void;
  onCancel: () => void;
};

const AGGREGATIONS = [
  { value: "SUM", label: "Sum" },
  { value: "AVG", label: "Average" },
  { value: "MIN", label: "Min" },
  { value: "MAX", label: "Max" },
  { value: "COUNT", label: "Count" },
  { value: "COUNT_DISTINCT", label: "Count Distinct" },
  { value: "STDDEV", label: "Std Deviation" },
  { value: "VARIANCE", label: "Variance" },
];

const NUMERIC_TYPES = new Set([
  "int", "integer", "int8", "int16", "int32", "int64",
  "long", "float", "double", "double precision", "decimal", "numeric",
  "smallint", "bigint", "real", "number", "tinyint",
]);

function isNumericType(colType: string): boolean {
  const normalized = colType.toLowerCase().replace(/\(.*\)/, "").trim();
  return NUMERIC_TYPES.has(normalized);
}

const ChartConfigPanel = ({
  widgetType,
  title,
  config,
  tables,
  views,
  dynamicViews,
  widgets,           // Phase 42 Plan 42-01
  widgetId,          // Phase 93 Plan 93-01
  onSave,
  onCancel,
}: Props) => {
  const chartDef = getChartType(widgetType);
  // Phase 94 (FSCOPE-V118-03): deploy-time dv filter-scope disable gate.
  const dvFilterScopeDisabled = useAuthStore((s) => s.dvFilterScopeDisabled);
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [titleDraft, setTitleDraft] = useState<string>(title);
  // Phase 11 11-08: CustomConfigPanel can signal Apply-disable via isValid callback.
  // Starts as true (enabled); panels call isValid(false) to disable Apply.
  const [customPanelValid, setCustomPanelValid] = useState<boolean>(true);

  // Phase 100 (METRIC-V119-01/03): subscribe to configVersion so picker re-renders on metric edits.
  const customMetricsConfigVersion = useCustomMetricsStore((s) => s.configVersion);
  void customMetricsConfigVersion; // reactive via subscription

  useEffect(() => {
    const defaults = chartDef?.defaultConfig ?? {};
    setDraft({ ...defaults, ...config });
  }, [config, chartDef]);

  useEffect(() => {
    setTitleDraft(title);
  }, [title]);

  // Phase 100 (METRIC-V119-01/03): load custom metrics for the current table on mount/table change.
  // Lazy: no-op when tableId is unknown; store deduplicates repeated fetches via setConfig bump.
  useEffect(() => {
    const tableId = typeof draft.tableId === "number" ? draft.tableId : undefined;
    if (tableId !== undefined) {
      useCustomMetricsStore.getState().loadConfig(tableId).catch(() => {});
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.tableId]);

  // ──────────────────────────────────────────────────────────────────────────
  // Phase 35 (DV-V16-12): dataSourceOptions union extended with the "dynamic" kind.
  // Discriminator prefix `dv:<id>` on `value` keeps the option value space disjoint
  // from schema.table names + filter-view names (mutual exclusion at picker level).
  // The dv option carries `columnsJson: { name, type }[] | null` — parsed from the
  // server's `columns_json` string per Phase 34's columns_json contract.
  // ──────────────────────────────────────────────────────────────────────────
  type DataSourceOption =
    | { label: string; value: string; kind: "table"; tableId: number }
    | { label: string; value: string; kind: "view"; tableId: number }
    | {
        label: string;
        value: string;
        kind: "dynamic";
        dynamicViewId: number;
        sourceTableId: number;
        columnsJson: { name: string; type: string }[] | null;
      };

  const dataSourceOptions = useMemo<DataSourceOption[]>(() => {
    const opts: DataSourceOption[] = [];
    if (tables) {
      for (const t of tables) {
        const full = t.schema ? `${t.schema}.${t.name}` : t.name;
        opts.push({ label: full, value: full, kind: "table", tableId: t.id });
      }
    }
    if (views) {
      for (const v of views) {
        if (v.status === "created") {
          opts.push({ label: `${v.view_name} (view)`, value: v.view_name, kind: "view", tableId: v.table_id });
        }
      }
    }
    // Phase 35 third optgroup. Bare dv.name as the option label — the optgroup
    // label "Dynamic Views" provides the type context. columns_json is parsed
    // here (JSON string on the wire → ParsedColumns[] | null) so consumers
    // downstream don't need to JSON.parse.
    if (dynamicViews) {
      for (const dv of dynamicViews) {
        // Post-VERIFY type fix: server `mapDashboardDynamicView` ships PARSED arrays on
        // the wire (not the stringified form). The DynamicViewRow type now declares this
        // as `{name,type}[] | string | null`; accept both shapes here defensively.
        let parsedColumns: { name: string; type: string }[] | null = null;
        if (dv.columns_json != null) {
          const raw: unknown = typeof dv.columns_json === "string"
            ? (() => {
                try {
                  return JSON.parse(dv.columns_json as string);
                } catch {
                  return null;
                }
              })()
            : dv.columns_json;
          if (Array.isArray(raw)) {
            parsedColumns = raw as { name: string; type: string }[];
          }
        }
        opts.push({
          label: dv.name,
          value: `dv:${dv.id}`,
          kind: "dynamic",
          dynamicViewId: dv.id,
          sourceTableId: dv.source_table_id,
          columnsJson: parsedColumns,
        });
      }
    }
    return opts;
  }, [tables, views, dynamicViews]);

  // Resolve selected source's columns (from the parent table OR dynamic view).
  // Phase 35: when widget.config has dynamicViewId set, the picker value is
  // `dv:<id>`, NOT a schema.table string. Read both signals from draft.
  const draftDynamicViewId =
    typeof draft.dynamicViewId === "number" ? draft.dynamicViewId : undefined;
  const selectedTableName = (draft.table as string) || "";
  const currentPickerValue =
    draftDynamicViewId !== undefined ? `dv:${draftDynamicViewId}` : selectedTableName;
  // Phase 9 FILT-02 / AP-4 lock: tableId is persisted into widget.config so AggregatedWidgetRenderer
  // can subscribe to useFilterStore.filters[tableId] without runtime table-name lookup.
  // Phase 35 (DV-V16-12): also resolves dv-bound widgets via the dv:<id> value-prefix.
  const selectedSource = useMemo(() => {
    return dataSourceOptions.find((o) => o.value === currentPickerValue) ?? null;
  }, [dataSourceOptions, currentPickerValue]);

  const selectedTable = useMemo(() => {
    if (!tables || !selectedSource) return null;
    if (selectedSource.kind === "dynamic") {
      // dv-bound: column source flips to columnsJson; selectedTable is only used
      // for non-dv column-derivation paths (drillDownColumnType resolution still
      // reads the source table via sourceTableId so type inference uses the
      // canonical Kinetica datatype rather than the JSON column hint).
      return tables.find((t) => t.id === selectedSource.sourceTableId) ?? null;
    }
    return tables.find((t) => t.id === selectedSource.tableId) ?? null;
  }, [tables, selectedSource]);

  // Phase 35 (DV-V16-12): when bound to a dynamic-view, column pickers source
  // from the dv's columns_json instead of the source-table's columns map.
  const allColumns = useMemo(() => {
    if (selectedSource?.kind === "dynamic") {
      return selectedSource.columnsJson ?? [];
    }
    if (!selectedTable?.columns) return [];
    return Object.entries(selectedTable.columns).map(([name, type]) => ({ name, type }));
  }, [selectedSource, selectedTable]);

  // Phase 35 (DV-V16-12): disabled+hint state when operator picks a dv whose
  // Preview never ran (columns_json is null). The renderer + spec key on this.
  const dvColumnsMissing =
    selectedSource?.kind === "dynamic" && selectedSource.columnsJson === null;

  // Phase 11-10: hoisted above CustomConfigPanel branch to prevent Temporal Dead Zone.
  // (handleTableChange and hasSources are referenced in the custom-panel scaffold at line ~162;
  // originally they were declared after that branch — moved here per Step 0 of 11-10 fix.)
  const handleTableChange = (value: string) => {
    // Phase 35 (DV-V16-12): detect dv:<id> discriminator. Selecting a dynamic-view
    // dual-writes dynamicViewId + tableId (= source_table_id) into the draft; the
    // existing `table` field is set to the source table's full name so the
    // generated-SQL FROM clause + tableRef persistence continue to work for
    // legacy code paths that key off the source table.
    if (value.startsWith("dv:")) {
      const dvId = Number.parseInt(value.slice(3), 10);
      const dv = dynamicViews?.find((d) => d.id === dvId);
      if (!dv) return;
      const srcTable = tables?.find((t) => t.id === dv.source_table_id);
      const srcFull = srcTable
        ? srcTable.schema
          ? `${srcTable.schema}.${srcTable.name}`
          : srcTable.name
        : "";
      setDraft((prev) => ({
        ...prev,
        table: srcFull,
        dynamicViewId: dvId,
        // Reset query fields the same way a table change does.
        metricColumn: "",
        aggregation: "SUM",
        groupByColumn: "",
      }));
      return;
    }
    // Plain table/view pick: clear dynamicViewId (mutual exclusion at picker level).
    setDraft((prev) => {
      const next: Record<string, unknown> = {
        ...prev,
        table: value,
        metricColumn: "",
        aggregation: "SUM",
        groupByColumn: "",
      };
      delete next.dynamicViewId;
      return next;
    });
  };

  const hasSources = dataSourceOptions.length > 0;

  const numericColumns = useMemo(
    () => allColumns.filter((c) => isNumericType(c.type)),
    [allColumns]
  );

  // Phase 10 DRILL-02 / PITFALL D-01 lock: drill-down picker excludes geometry
  // (wkt/wkb/point/geometry/geography) and large-text (blob/text/bytes) columns.
  // Equality filters on these are nonsensical and would silently fail.
  const drillDownColumns = useMemo(
    () => allColumns.filter((c) => isColumnDrillDownSafe(c.type)),
    [allColumns],
  );

  const usesAggregation = chartDef?.usesAggregation !== false;
  // Scalar aggregated charts (e.g. bignumber) opt out of the Group By picker via
  // chartDef.requiresGroupBy === false. SQL becomes `SELECT AGG(metric) AS value FROM table`
  // and the renderer reads data[0].value (already does so by default).
  const requiresGroupBy = chartDef?.requiresGroupBy !== false;

  // Phase 102 (BARGRP-V119-01): multi-column group-by builder.
  // isBar/isTable gate the N-column builder UI; isMultiColumnBarGroupBy gates the SQL branch.
  // Bar turns extra columns into colored series; the Data Table renders them as extra columns.
  const isBar = widgetType === "bar";
  const isTable = widgetType === "table";
  const usesMultiColumnGroupBy = isBar || isTable;
  // Soft cap on the number of group-by columns in the builder (distinct from maxBarGroupBySeriesCap
  // which caps SERIES at render time). 6 columns is a reasonable UI ceiling before the
  // GROUP BY becomes unreadable — not an env-driven value per CONTEXT.md.
  const MAX_BAR_GROUP_BY_COLUMNS = 6;

  // Build the SQL preview from structured fields
  const generatedSql = useMemo(() => {
    const table = draft.table as string;
    if (!table) return "";

    // Phase 98-02 (VIZSQL-V119-02): compute WHERE clause for non-empty customWhere.
    // whereCustomWhere returns ' WHERE (<predicate>)' or '' for empty/absent — byte-identical.
    const cw = whereCustomWhere(draft.customWhere as string | undefined);

    // Records-table style: SELECT [cols] FROM table ORDER BY sortField DIR
    // (pagination LIMIT/OFFSET applied at render time, not stored in widget config)
    if (!usesAggregation) {
      const colsRaw = ((draft.columns as string) || "").split(",").map((c) => c.trim()).filter(Boolean);
      const safeCols = colsRaw.filter((c) => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(c));
      const colsClause = safeCols.length > 0 ? safeCols.join(", ") : "*";
      const sortField = (draft.sortField as string) || "";
      const sortDir = ((draft.sortDirection as string) || "asc").toUpperCase() === "DESC" ? "DESC" : "ASC";
      const orderBy = /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(sortField) ? ` ORDER BY ${sortField} ${sortDir}` : "";
      return `SELECT ${colsClause} FROM ${table}${cw}${orderBy}`;
    }

    // Aggregated chart style
    const metricColumn = draft.metricColumn as string;
    const aggregation = draft.aggregation as string;
    const groupByColumn = draft.groupByColumn as string;

    // Phase 100 (METRIC-V119-04): resolve the metric expression for both variants.
    // metricId is set by Plan 03's picker; absent → real-column path (byte-identical).
    const metricId = draft.metricId as number | undefined;
    const tableId = selectedTable?.id;
    const customMode = isCustomSelection(metricId);

    // Scalar variant (bignumber): SELECT AGG(metric) AS value FROM table — no GROUP BY.
    // Requires metricColumn + aggregation only (real); or a resolved custom expression.
    if (!requiresGroupBy) {
      if (customMode) {
        // Custom selection: resolve from store; fall back to placeholder if orphaned.
        const metricExpr = resolveMetricExpr(metricId, "", tableId);
        if (!metricExpr) return `SELECT * FROM ${table} LIMIT 100`;
        return `SELECT ${metricExpr} AS value FROM ${table}${cw}`;
      }
      if (!metricColumn || !aggregation) {
        return `SELECT * FROM ${table} LIMIT 100`;
      }
      const aggExpr = aggregation === "COUNT_DISTINCT"
        ? `COUNT(DISTINCT ${metricColumn})`
        : `${aggregation}(${metricColumn})`;
      return `SELECT ${aggExpr} AS value FROM ${table}${cw}`;
    }

    // Grouped variant (bar / line / pie / scatter / table):
    // SELECT groupBy, AGG(metric) AS value FROM table GROUP BY groupBy ORDER BY value DESC

    // Phase 102 (BARGRP-V119-01): multi-column GROUP BY for bar charts.
    // Guard: isMultiColumnBarGroupBy checks Array.isArray(groupByColumns) && length >= 2.
    // When false, execution falls through to the EXISTING single-column branches unchanged
    // — that is the byte-identical backward-compat path (BARGRP-V119-04).
    if (isMultiColumnBarGroupBy(draft)) {
      const cols = (draft.groupByColumns as string[]).filter(Boolean);
      const colsClause = cols.join(", ");
      // Metric expr: reuse the SAME resolution as the single-column path (custom vs real).
      const multiMetricExpr = customMode
        ? resolveMetricExpr(metricId, "", tableId)
        : (aggregation === "COUNT_DISTINCT" ? `COUNT(DISTINCT ${metricColumn})` : `${aggregation}(${metricColumn})`);
      if (!colsClause || !multiMetricExpr || (!customMode && (!metricColumn || !aggregation))) {
        return `SELECT * FROM ${table} LIMIT 100`;
      }
      const multiSortDir = ((draft.sortDir as string) || "DESC").toUpperCase() === "ASC" ? "ASC" : "DESC";
      const ALLOWED_LIMITS_M = [5, 10, 25, 50, 100, 250, 500];
      const rawLimitM = Number(draft.limit);
      const baseLimit = ALLOWED_LIMITS_M.includes(rawLimitM) ? rawLimitM : 100;
      // Bar expands categories × series so it needs a generous LIMIT (config.limit ×
      // maxBarGroupBySeriesCap × 2, read from auth store at save time). The Data Table renders
      // one row per group tuple, so it just uses the plain "Result limit".
      const sqlLimit = isBar
        ? baseLimit * useAuthStore.getState().maxBarGroupBySeriesCap * 2
        : baseLimit;
      // GROUP BY uses real column names — NEVER the "value" alias (RESEARCH Pitfall 1).
      return `SELECT ${colsClause}, ${multiMetricExpr} AS value FROM ${table}${cw} GROUP BY ${colsClause} ORDER BY value ${multiSortDir} LIMIT ${sqlLimit}`;
    }

    if (customMode) {
      // Custom selection: groupByColumn still required; metricExpr from store.
      if (!groupByColumn) return `SELECT * FROM ${table} LIMIT 100`;
      const metricExpr = resolveMetricExpr(metricId, "", tableId);
      if (!metricExpr) return `SELECT * FROM ${table} LIMIT 100`;
      const groupSortDirC = ((draft.sortDir as string) || "DESC").toUpperCase() === "ASC" ? "ASC" : "DESC";
      const ALLOWED_LIMITS_C = [5, 10, 25, 50, 100, 250, 500];
      const rawLimitC = Number(draft.limit);
      const groupLimitC = ALLOWED_LIMITS_C.includes(rawLimitC) ? rawLimitC : 100;
      return `SELECT ${groupByColumn}, ${metricExpr} AS value FROM ${table}${cw} GROUP BY ${groupByColumn} ORDER BY value ${groupSortDirC} LIMIT ${groupLimitC}`;
    }
    if (!metricColumn || !aggregation || !groupByColumn) {
      return `SELECT * FROM ${table} LIMIT 100`;
    }
    const aggExpr = aggregation === "COUNT_DISTINCT"
      ? `COUNT(DISTINCT ${metricColumn})`
      : `${aggregation}(${metricColumn})`;
    // Operator-configurable sort direction + result limit (defaults DESC / 100).
    const groupSortDir = ((draft.sortDir as string) || "DESC").toUpperCase() === "ASC" ? "ASC" : "DESC";
    const ALLOWED_LIMITS = [5, 10, 25, 50, 100, 250, 500];
    const rawLimit = Number(draft.limit);
    const groupLimit = ALLOWED_LIMITS.includes(rawLimit) ? rawLimit : 100;
    return `SELECT ${groupByColumn}, ${aggExpr} AS value FROM ${table}${cw} GROUP BY ${groupByColumn} ORDER BY value ${groupSortDir} LIMIT ${groupLimit}`;
  }, [usesAggregation, requiresGroupBy, draft.table, draft.columns, draft.sortField, draft.sortDirection, draft.metricColumn, draft.aggregation, draft.groupByColumn, draft.groupByColumns, draft.sortDir, draft.limit, draft.customWhere, draft.metricId, selectedTable]);

  if (!chartDef) {
    return (
      <div className="config-panel">
        <div className="muted">No configuration available for type "{widgetType}".</div>
        <div className="config-panel-actions">
          <button className="ghost-sm" onClick={onCancel}>Close</button>
        </div>
      </div>
    );
  }

  if (chartDef.CustomConfigPanel) {
    const Custom = chartDef.CustomConfigPanel;
    // Build the save payload for a given config and persist it (auto-save model — no Apply
    // button in the custom-panel branch). Shared by the custom panel's onChange AND the title
    // field's onBlur, so editing ONLY the title still persists to widget.title (previously the
    // title input just set local draft state and was never saved unless the custom panel changed).
    const persistCustom = (cfg: Record<string, unknown>) => {
      const customDrillDownColumn = (cfg.drillDownColumn as string) || "";
      const customDrillDownColumnType = customDrillDownColumn
        ? inferDataTypeFromColumn(customDrillDownColumn, selectedTable?.columns ?? {})
        : "null";
      // Phase 11-10: strip __autoSuggestActive draft flag before persistence.
      const { __autoSuggestActive: _drop, ...persistedConfig } = cfg as Record<string, unknown> & {
        __autoSuggestActive?: unknown;
      };
      const baseSourceTableId = selectedSource?.kind === "dynamic"
        ? selectedSource.sourceTableId
        : selectedSource?.tableId;
      const dataSourceFields = chartDef.usesDataSource === false
        ? {}
        : {
            tableRef: selectedTableName,
            tableId: baseSourceTableId,
            ...(selectedSource?.kind === "dynamic"
              ? { dynamicViewId: selectedSource.dynamicViewId }
              : {}),
          };
      onSave({
        title: titleDraft,
        config: {
          ...persistedConfig,
          ...dataSourceFields,
          drillDownColumn: customDrillDownColumn,
          drillDownColumnType: customDrillDownColumnType,
        },
      });
    };
    return (
      <div className="config-panel">
        {/* ChartConfigPanel — custom panel scaffold (Phase 11-10 fix; addresses 11-VERIFICATION.md Criterion 1 RED) */}
        <div className="config-panel-body">
          {/* Title section — identical to non-custom branch */}
          <div className="config-group">
            <div className="config-group-label">Title</div>
            <label className="ds-field">
              <input
                type="text"
                className="ds-input"
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                // Persist on blur so a title-only edit reaches widget.title even when the
                // custom panel itself never changes (auto-save model, no Apply button here).
                onBlur={() => persistCustom(draft)}
                placeholder="Chart title"
              />
            </label>
          </div>

          {/* Data Source section — suppressed when chartDef.usesDataSource === false
              (map widget configures per-layer table refs via dashboard_layers, NOT via
              a single source dropdown on the widget). */}
          {hasSources && chartDef.usesDataSource !== false && (
            <div className="config-group">
              <div className="config-group-label">Data Source</div>
              <label className="ds-field">
                <span className="ds-field-label">Table / View</span>
                <select
                  className="ds-select"
                  value={currentPickerValue}
                  onChange={(e) => handleTableChange(e.target.value)}
                >
                  <option value="">Select a data source...</option>
                  {tables && tables.length > 0 && (
                    <optgroup label="Tables">
                      {tables.map((t) => {
                        const fullName = t.schema ? `${t.schema}.${t.name}` : t.name;
                        return <option key={`t-${t.id}`} value={fullName}>{fullName}</option>;
                      })}
                    </optgroup>
                  )}
                  {views && views.filter((v) => v.status === "created").length > 0 && (
                    <optgroup label="Views">
                      {views.filter((v) => v.status === "created").map((v) => (
                        <option key={`v-${v.id}`} value={v.view_name}>{v.view_name}</option>
                      ))}
                    </optgroup>
                  )}
                  {dynamicViews && dynamicViews.length > 0 && (
                    <optgroup label="Dynamic Views">
                      {dynamicViews.map((dv) => (
                        <option key={`dv-${dv.id}`} value={`dv:${dv.id}`}>
                          {dv.name}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </label>
            </div>
          )}

          {/* Custom panel slot — receives draft + columns + isValid; onChange auto-saves with scaffold-resolved tableRef + tableId */}
          <Custom
            config={draft}
            columns={allColumns}
            tables={tables}
            widgets={widgets}       // Phase 42 Plan 42-01: thread for LegendConfigPanel
            dynamicViews={dynamicViews}  // Phase 66 (CAL-V113-01): forwarded for CalendarConfigPanel dv-aware picker
            isValid={(valid) => setCustomPanelValid(valid)}
            onChange={(c) => {
              setDraft(c);
              // Phase 10 DRILL-02 / Phase 11-10 / Phase 35 (DV-V16-12) persistence logic lives
              // in persistCustom (shared with the title field's onBlur). It threads drillDown
              // column+type, strips the __autoSuggestActive draft flag, and dual-writes
              // tableRef + tableId (+ dynamicViewId for dynamic-view sources; skipped entirely
              // when usesDataSource === false, e.g. the map widget).
              persistCustom(c);
            }}
          />
        </div>
        {/* Auto-save persists every onChange; the modal's header Close button is the dismiss affordance. */}
      </div>
    );
  }

  const set = (key: string, value: unknown) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  };

  // Group chart-specific fields (skip Query group since we handle it)
  const groups: { label: string; fields: ConfigField[] }[] = [];
  const seen = new Set<string>();
  for (const field of chartDef.fields) {
    if (field.group === "Query" || field.key === "sql") continue;
    const g = field.group || "General";
    if (!seen.has(g)) {
      seen.add(g);
      groups.push({ label: g, fields: [] });
    }
    groups.find((grp) => grp.label === g)!.fields.push(field);
  }

  // Phase 10 DRILL-02: compute default drillDownColumn per chart type when none is set yet.
  // CONTEXT.md "Drill-down column picker (DRILL-02)" defaults rule (LOCKED):
  //   - bar/line/pie: default to current groupByColumn (the category dimension)
  //   - scatter: default to the configured x-axis key (handled in its own branch BEFORE
  //     the bar/line/pie catch-all per CONTEXT.md lock; today scatter has no dedicated
  //     xAxisKey field — its x-axis column is resolved from groupByColumn by
  //     WidgetRenderer's resolveKeys() — so the branch reads groupByColumn for now.
  //     If scatter ever gains a dedicated xAxisKey field, update this branch only.)
  //   - records/table: no auto-default — user picks intentionally
  const supportsDrillDown = chartDef?.supportsDrillDown === true;
  const currentDrillDownColumn = (draft.drillDownColumn as string) ?? "";
  // Aggregated category charts (bar/line/area/pie) build rows as `{ <groupByColumn>: cat, value }`,
  // so a click can only meaningfully filter on the group-by column. The drill-down column ALWAYS
  // follows group-by for these types — an independent pick that diverged produced `= 'undefined'`
  // filters. (Records/table — non-aggregated, raw rows — keep an independent drill-down picker.)
  const drillFollowsGroupBy = supportsDrillDown && usesAggregation && requiresGroupBy;
  const defaultDrillDownColumn = (() => {
    if (!supportsDrillDown) return "";
    // Aggregated category charts: lock drill-down to the current group-by column (no divergence).
    if (drillFollowsGroupBy) return (draft.groupByColumn as string) || "";
    // An explicit pick wins for the remaining (non-aggregated / records) types.
    if (currentDrillDownColumn !== "") return currentDrillDownColumn;
    // Scatter: configured x-axis key (CONTEXT.md lock). Today derived from groupByColumn
    // because scatter has no separate xAxisKey field; future-proofed by being its own branch.
    if (widgetType === "scatter") return (draft.groupByColumn as string) || "";
    // Other aggregated (no group-by, e.g. scalar): groupByColumn fallback.
    if (usesAggregation) return (draft.groupByColumn as string) || "";
    // Records/table: no auto-default
    return "";
  })();

  return (
    <div className="config-panel">
      <div className="config-panel-body">
        {/* Title section */}
        <div className="config-group">
          <div className="config-group-label">Title</div>
          <label className="ds-field">
            <input
              type="text"
              className="ds-input"
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              placeholder="Chart title"
            />
          </label>
        </div>

        {/* Data Source section */}
        {hasSources && (
          <div className="config-group">
            <div className="config-group-label">Data Source</div>

            {/* Table / View selector */}
            <label className="ds-field">
              <span className="ds-field-label">Table / View</span>
              <select
                className="ds-select"
                value={currentPickerValue}
                onChange={(e) => handleTableChange(e.target.value)}
              >
                <option value="">Select a data source...</option>
                {tables && tables.length > 0 && (
                  <optgroup label="Tables">
                    {tables.map((t) => {
                      const fullName = t.schema ? `${t.schema}.${t.name}` : t.name;
                      return <option key={`t-${t.id}`} value={fullName}>{fullName}</option>;
                    })}
                  </optgroup>
                )}
                {views && views.filter((v) => v.status === "created").length > 0 && (
                  <optgroup label="Views">
                    {views.filter((v) => v.status === "created").map((v) => (
                      <option key={`v-${v.id}`} value={v.view_name}>{v.view_name}</option>
                    ))}
                  </optgroup>
                )}
                {dynamicViews && dynamicViews.length > 0 && (
                  <optgroup label="Dynamic Views">
                    {dynamicViews.map((dv) => (
                      <option key={`dv-${dv.id}`} value={`dv:${dv.id}`}>
                        {dv.name}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </label>

            {/* Phase 35 (DV-V16-12): when bound to a dv with columns_json === null,
                column pickers are disabled and an inline hint surfaces. Operator must
                run Preview in DynamicViewsModal first to populate columns_json. */}
            {dvColumnsMissing && (
              <div className="config-hint config-hint-warning">
                Run Preview in Dynamic Views to populate columns
              </div>
            )}

            {/* Metric column / Aggregation / Group By — only for aggregated chart types */}
            {usesAggregation && selectedSource && (
              <>
                {/* Phase 100 (METRIC-V119-01/03): custom-metric-aware metric picker.
                    Uses cm:<id> sentinel values so a single <select> covers both real
                    columns and custom metrics. The "Custom metrics" optgroup is always
                    rendered (independent of the numeric-only filter). */}
                {(() => {
                  const chartTableId = selectedTable?.id;
                  const customMetricsForTable = chartTableId !== undefined ? selectMetrics(chartTableId) : [];
                  const storedMetricId = draft.metricId as number | undefined;
                  const pickerValue = metricSelectValue(storedMetricId, (draft.metricColumn as string) || "");
                  const orphaned = isOrphanedMetric(storedMetricId, chartTableId);
                  const handleMetricChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
                    const sel = decodeMetricSelection(e.target.value);
                    if (sel.kind === "custom") {
                      set("metricId", sel.metricId);
                      set("metricColumn", "");
                    } else {
                      set("metricId", undefined);
                      set("metricColumn", sel.column);
                    }
                  };
                  return (
                    <label className="ds-field">
                      <span className="ds-field-label">Metric Column</span>
                      <select
                        className="ds-select"
                        value={pickerValue}
                        onChange={handleMetricChange}
                        disabled={dvColumnsMissing}
                        aria-label="Metric Column"
                      >
                        <option value="">Select a numeric column...</option>
                        <optgroup label="Columns">
                          {numericColumns.map((c) => (
                            <option key={c.name} value={c.name}>
                              {c.name} ({c.type})
                            </option>
                          ))}
                        </optgroup>
                        <optgroup label="Custom metrics">
                          {orphaned && (
                            <option value={encodeCustomValue(storedMetricId!)}>(deleted metric)</option>
                          )}
                          {customMetricsForTable.map((m) => (
                            <option key={m.id} value={encodeCustomValue(m.id)}>
                              {m.label}
                            </option>
                          ))}
                        </optgroup>
                      </select>
                      <span className="config-hint">Numeric column to aggregate</span>
                    </label>
                  );
                })()}

                {/* Aggregation: hidden when a custom metric is selected (expression is pre-aggregated) */}
                {!isCustomSelection(draft.metricId as number | undefined) && (
                <label className="ds-field">
                  <span className="ds-field-label">Aggregation</span>
                  <select
                    className="ds-select"
                    value={(draft.aggregation as string) || "SUM"}
                    onChange={(e) => set("aggregation", e.target.value)}
                    disabled={dvColumnsMissing}
                  >
                    {AGGREGATIONS.map((a) => (
                      <option key={a.value} value={a.value}>{a.label}</option>
                    ))}
                  </select>
                </label>
                )}

                {/* Group By — bar and the Data Table get the N-column ordered builder (Phase 102
                    BARGRP-V119-01; table added later); other grouped chart types keep the single
                    Group By select unchanged. Bar turns extra columns into colored series; the
                    table renders them as extra columns. */}
                {requiresGroupBy && usesMultiColumnGroupBy && (() => {
                  // Backward-compat: legacy single-column widgets carry `groupByColumn` but no
                  // `groupByColumns` array — seed the builder from it so their column still shows
                  // (and is captured into `groupByColumns` on the first edit).
                  const stored = draft.groupByColumns as string[] | undefined;
                  const groupByColumns = stored && stored.length > 0
                    ? stored
                    : (draft.groupByColumn ? [draft.groupByColumn as string] : []);
                  // Bar keeps its primary/series wording; the table's columns are all equal.
                  const labelFor = (idx: number) =>
                    isBar
                      ? (idx === 0 ? "Primary group (x-axis)" : `Series dimension ${idx}`)
                      : `Group column ${idx + 1}`;
                  return (
                    <div className="config-group">
                      <span className="config-group-label">Group By Columns</span>
                      {groupByColumns.map((col, idx) => (
                        <div key={idx} className="ds-field" style={{ flexDirection: "row", alignItems: "center", gap: "4px" }}>
                          <span className="ds-field-label" style={{ whiteSpace: "nowrap" }}>
                            {labelFor(idx)}
                          </span>
                          <select
                            className="ds-select"
                            style={{ flex: 1, minWidth: 0 }}
                            value={col}
                            disabled={dvColumnsMissing}
                            aria-label={labelFor(idx)}
                            onChange={(e) => {
                              const next = [...groupByColumns];
                              next[idx] = e.target.value;
                              set("groupByColumns", next);
                              set("groupByColumn", next[0] ?? "");
                            }}
                          >
                            <option value="">Select a column...</option>
                            {allColumns.map((c) => (
                              <option key={c.name} value={c.name}>
                                {c.name} ({c.type})
                              </option>
                            ))}
                          </select>
                          <button
                            className="ghost-sm"
                            type="button"
                            disabled={dvColumnsMissing}
                            onClick={() => {
                              const next = groupByColumns.filter((_, i) => i !== idx);
                              set("groupByColumns", next);
                              set("groupByColumn", next[0] ?? "");
                            }}
                          >×</button>
                        </div>
                      ))}
                      <button
                        className="ghost-sm"
                        type="button"
                        disabled={dvColumnsMissing || groupByColumns.length >= MAX_BAR_GROUP_BY_COLUMNS}
                        onClick={() => {
                          const next = [...groupByColumns, ""];
                          set("groupByColumns", next);
                          set("groupByColumn", next[0] ?? "");
                        }}
                      >+ Add column</button>
                      <span className="config-hint">
                        {isBar
                          ? `First column = x-axis categories; the rest become colored series (${MAX_BAR_GROUP_BY_COLUMNS} column max).`
                          : `Rows are grouped by every selected column; each becomes a column in the table (${MAX_BAR_GROUP_BY_COLUMNS} column max).`}
                      </span>
                    </div>
                  );
                })()}

                {/* Single Group By for grouped charts without the multi-column builder; hidden
                    for bignumber (requiresGroupBy false), bar, and the Data Table. */}
                {requiresGroupBy && !usesMultiColumnGroupBy && (
                  <label className="ds-field">
                    <span className="ds-field-label">Group By</span>
                    <select
                      className="ds-select"
                      value={(draft.groupByColumn as string) || ""}
                      onChange={(e) => set("groupByColumn", e.target.value)}
                      disabled={dvColumnsMissing}
                      aria-label="Group By"
                    >
                      <option value="">Select a column...</option>
                      {allColumns.map((c) => (
                        <option key={c.name} value={c.name}>
                          {c.name} ({c.type})
                        </option>
                      ))}
                    </select>
                    <span className="config-hint">Column to group results by</span>
                  </label>
                )}

                {/* Sort direction + result limit for grouped charts — shape the
                    ORDER BY value <dir> LIMIT <n> clause of the generated SQL. */}
                {requiresGroupBy && (
                  <label className="ds-field">
                    <span className="ds-field-label">Sort</span>
                    <select
                      className="ds-select"
                      value={(draft.sortDir as string) || "DESC"}
                      onChange={(e) => set("sortDir", e.target.value)}
                      disabled={dvColumnsMissing}
                      aria-label="Sort direction"
                    >
                      <option value="DESC">Descending (highest first)</option>
                      <option value="ASC">Ascending (lowest first)</option>
                    </select>
                  </label>
                )}
                {requiresGroupBy && (
                  <label className="ds-field">
                    <span className="ds-field-label">Result limit</span>
                    <select
                      className="ds-select"
                      value={String((draft.limit as number) ?? 100)}
                      onChange={(e) => set("limit", Number(e.target.value))}
                      disabled={dvColumnsMissing}
                      aria-label="Result limit"
                    >
                      {[5, 10, 25, 50, 100, 250, 500].map((n) => (
                        <option key={n} value={n}>{n}</option>
                      ))}
                    </select>
                    <span className="config-hint">Maximum number of groups to return</span>
                  </label>
                )}
              </>
            )}

            {/* SQL preview */}
            {generatedSql && (
              <div className="config-sql-preview">
                <span className="ds-field-label">Generated SQL</span>
                <code className="config-sql-code">{generatedSql}</code>
              </div>
            )}
          </div>
        )}

        {/* Phase 10 DRILL-02: drill-down column picker — visible only for chart types
            that supportsDrillDown. Geometry/large-text columns excluded via PITFALL D-01 lock.
            Phase 35 (DV-V16-12): visible when bound to a dv too (selectedSource defined). */}
        {supportsDrillDown && selectedSource && !drillFollowsGroupBy && (
          <div className="config-group">
            <div className="config-group-label">Drill-Down</div>
            <label className="ds-field">
              <span className="ds-field-label">Drill-Down column</span>
              <select
                className="ds-select"
                value={defaultDrillDownColumn}
                onChange={(e) => set("drillDownColumn", e.target.value)}
                disabled={dvColumnsMissing}
                aria-label="Drill-Down column"
              >
                <option value="">— none —</option>
                {drillDownColumns.map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.name} ({c.type})
                  </option>
                ))}
              </select>
              <span className="config-hint">Column whose value becomes the filter on click</span>
            </label>
          </div>
        )}
        {/* Aggregated category charts: drill-down always follows the Group By column (the
            clicked category) — there's nothing to configure, so no Drill-Down section is shown
            (the previous informational-only block configured nothing). The non-aggregated
            picker above (records) is the only case where drill-down is user-configurable. */}

        {/* Phase 93 (FSCOPE-V118-01): Filter Scope section — visible whenever the widget
            has a data source (same gate as Drill-Down). FilterSelectionPanel renders its
            own config-group wrapper; do NOT wrap it in another config-group.
            Phase 94 (FSCOPE-V118-03): hidden for dv-bound widgets when dvFilterScopeDisabled.
            Table-bound widgets (draftDynamicViewId === undefined) are NEVER affected — the
            && short-circuits to false only when BOTH dv-bound AND disabled.
            Phase 94 (LOCKED DECISION #8): same-dv source list — dv-bound widget's checklist
            restricted to sibling widgets on the same dynamicViewId. Table-bound: full list. */}
        {(() => {
          const filterSourceWidgets =
            draftDynamicViewId !== undefined
              ? (widgets ?? []).filter((w) => (w.config.dynamicViewId as number | undefined) === draftDynamicViewId)
              : (widgets ?? []);
          return selectedSource && !(draftDynamicViewId !== undefined && dvFilterScopeDisabled) && (
            <FilterSelectionPanel
              value={draft.filterSelection as FilterSelectionConfig | undefined}
              onChange={(next) => set("filterSelection", next)}
              widgets={filterSourceWidgets}
              selfWidgetId={widgetId}
              allowSpatial={draftDynamicViewId === undefined}
            />
          );
        })()}

        {/* Chart-specific field groups */}
        {groups.map((group) => (
          <div key={group.label} className="config-group">
            <div className="config-group-label">{group.label}</div>
            {group.fields.map((field) => (
              <FieldRenderer
                key={field.key}
                field={field}
                value={draft[field.key] ?? field.defaultValue}
                onChange={(v) => set(field.key, v)}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="config-panel-actions">
        <button
          className="btn-primary btn-sm"
          disabled={!customPanelValid}
          title={!customPanelValid ? "Add at least 2 break rows" : undefined}
          onClick={() => {
            // Phase 10 DRILL-02 + RESEARCH.md Pitfall 2: persist drillDownColumn AND
            // drillDownColumnType at save time so renderers don't need TableDto.columns
            // at render time. The default fallback (per-chart-type, including the scatter
            // x-axis-key branch from Step 3) is locked into the persisted config — no implicit
            // defaults at render time.
            const finalDrillDownColumn = supportsDrillDown ? defaultDrillDownColumn : "";
            const finalDrillDownColumnType = finalDrillDownColumn
              ? inferDataTypeFromColumn(finalDrillDownColumn, selectedTable?.columns ?? {})
              : "null";
            // Phase 35 (DV-V16-12) dual-write lock: dv-bound widgets persist BOTH
            // dynamicViewId AND tableId (= source_table_id) so existing drill-down
            // dispatch + filter-bar code paths (which key on tableId) keep working
            // unchanged. Mutual exclusion is enforced at handleTableChange (the picker).
            const persistedTableId = selectedSource?.kind === "dynamic"
              ? selectedSource.sourceTableId
              : selectedSource?.tableId;
            const persistedDynamicViewId = selectedSource?.kind === "dynamic"
              ? selectedSource.dynamicViewId
              : undefined;
            // Build config: spread draft, then explicitly set tableId/dynamicViewId.
            // When not dv-bound, ensure dynamicViewId is NOT present (mutual exclusion).
            const baseConfig: Record<string, unknown> = {
              ...draft,
              sql: generatedSql,
              tableId: persistedTableId,
              drillDownColumn: finalDrillDownColumn,
              drillDownColumnType: finalDrillDownColumnType,
            };
            if (persistedDynamicViewId !== undefined) {
              baseConfig.dynamicViewId = persistedDynamicViewId;
            } else {
              delete baseConfig.dynamicViewId;
            }
            onSave({
              title: titleDraft.trim() || title,
              config: baseConfig,
            });
          }}
        >
          Apply
        </button>
        <button className="ghost-sm" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  Field renderer                                                     */
/* ------------------------------------------------------------------ */

const FieldRenderer = ({
  field,
  value,
  onChange,
}: {
  field: ConfigField;
  value: unknown;
  onChange: (value: unknown) => void;
}) => {
  switch (field.type) {
    case "text":
      return (
        <label className="ds-field">
          <span className="ds-field-label">{field.label}</span>
          <input
            value={String(value ?? "")}
            onChange={(e) => onChange(e.target.value)}
            placeholder={field.hint}
          />
          {field.hint && <span className="config-hint">{field.hint}</span>}
        </label>
      );

    case "textarea":
      return (
        <label className="ds-field">
          <span className="ds-field-label">{field.label}</span>
          <textarea
            className="config-textarea"
            value={String(value ?? "")}
            onChange={(e) => onChange(e.target.value)}
            placeholder={field.hint}
            rows={4}
          />
          {field.hint && <span className="config-hint">{field.hint}</span>}
        </label>
      );

    case "number":
      return (
        <label className="ds-field">
          <span className="ds-field-label">{field.label}</span>
          <input
            type="number"
            value={Number(value ?? 0)}
            onChange={(e) => onChange(Number(e.target.value))}
          />
        </label>
      );

    case "boolean":
      return (
        <label className="config-toggle">
          <input
            type="checkbox"
            checked={Boolean(value)}
            onChange={(e) => onChange(e.target.checked)}
          />
          <span>{field.label}</span>
        </label>
      );

    case "select":
      return (
        <label className="ds-field">
          <span className="ds-field-label">{field.label}</span>
          <select
            className="ds-select"
            value={String(value ?? "")}
            onChange={(e) => onChange(e.target.value)}
          >
            {field.options?.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>
      );

    case "color":
      return (
        <label className="config-color-field">
          <span className="ds-field-label">{field.label}</span>
          <div className="config-color-row">
            <input
              type="color"
              value={String(value ?? "#000000")}
              onChange={(e) => onChange(e.target.value)}
              className="config-color-picker"
            />
            <input
              type="text"
              value={String(value ?? "")}
              onChange={(e) => onChange(e.target.value)}
              className="config-color-text"
              placeholder="#hex"
            />
          </div>
        </label>
      );

    case "range":
      return (
        <label className="ds-field">
          <span className="ds-field-label">
            {field.label}
            <span className="config-range-value">{String(value)}</span>
          </span>
          <input
            type="range"
            min={field.min ?? 0}
            max={field.max ?? 100}
            step={field.step ?? 1}
            value={Number(value ?? 0)}
            onChange={(e) => onChange(Number(e.target.value))}
            className="config-range"
          />
        </label>
      );

    case "colorRules":
      return <ColorRulesField field={field} value={value} onChange={onChange} />;

    case "formatSpec":
      return (
        <div className="ds-field">
          <span className="ds-field-label">{field.label}</span>
          <FormatSpecEditor
            spec={(value as FormatSpec | null) ?? null}
            onChange={(s) => onChange(s ?? undefined)}
          />
          {field.hint && <span className="config-hint">{field.hint}</span>}
        </div>
      );

    default:
      return null;
  }
};

type ColorRule = { min?: number; max?: number; color: string };

/**
 * Repeatable "if value in [min, max) then color" rules. First matching rule wins
 * at render time (BigNumberRenderer). Either bound is optional → open-ended range.
 */
const ColorRulesField = ({
  field,
  value,
  onChange,
}: {
  field: ConfigField;
  value: unknown;
  onChange: (value: unknown) => void;
}) => {
  const rules: ColorRule[] = Array.isArray(value) ? (value as ColorRule[]) : [];
  const update = (idx: number, patch: Partial<ColorRule>) =>
    onChange(rules.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  const addRule = () => onChange([...rules, { color: "#22c55e" }]);
  const removeRule = (idx: number) => onChange(rules.filter((_, i) => i !== idx));
  const numOrUndef = (s: string) => (s.trim() === "" ? undefined : Number(s));

  return (
    <div className="ds-field color-rules-field">
      <span className="ds-field-label">{field.label}</span>
      {field.hint && <span className="config-hint">{field.hint}</span>}
      {rules.map((r, i) => (
        <div key={i} className="color-rule-row">
          <input
            type="number"
            aria-label={`Rule ${i + 1} min`}
            placeholder="Min"
            value={r.min ?? ""}
            onChange={(e) => update(i, { min: numOrUndef(e.target.value) })}
          />
          <span className="color-rule-sep">–</span>
          <input
            type="number"
            aria-label={`Rule ${i + 1} max`}
            placeholder="Max"
            value={r.max ?? ""}
            onChange={(e) => update(i, { max: numOrUndef(e.target.value) })}
          />
          <input
            type="color"
            className="config-color-picker"
            aria-label={`Rule ${i + 1} color`}
            value={r.color || "#22c55e"}
            onChange={(e) => update(i, { color: e.target.value })}
          />
          <button
            type="button"
            className="ghost-sm ghost-danger"
            aria-label={`Remove rule ${i + 1}`}
            onClick={() => removeRule(i)}
          >
            ×
          </button>
        </div>
      ))}
      <button type="button" className="ghost-sm" onClick={addRule}>
        + Add color rule
      </button>
    </div>
  );
};

export default ChartConfigPanel;
