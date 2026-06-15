/**
 * v1.7 Phase 44 Plan 02 (FILTER-V17-08..10): CustomConfigPanel for the 'datafilter' chart type.
 *
 * Renders:
 *   1. A base-table picker (reads from props.tables — same dashboard-scoped associatedTables that
 *      ChartConfigPanel uses for its generic Data Source section; we render our own picker because
 *      `usesDataSource: false` on the definition suppresses the parent's section).
 *   2. An N-row "filter fields" builder. Each row has:
 *      - a column picker (column names from the base table, filtered by isColumnDrillDownSafe
 *        to exclude WKT/geometry/large-text)
 *      - a control-kind picker, whose options are scoped to the column's inferred DrillDownDataType
 *
 * NO Apply / Clear / data-fetching here — this is config-only. Plan 44-03 ships DataFilterRenderer
 * which consumes config.filterFields and renders the actual operator-facing controls.
 *
 * onChange contract: the panel calls onChange({...config, ...patch}) on every edit;
 * ChartConfigPanel debounces + PATCHes. The panel never calls save directly.
 *
 * isValid contract: the panel calls props.isValid(false) when ANY row has an empty column
 * or empty kind OR filterFields is empty; props.isValid(true) when every row is complete.
 * ChartConfigPanel uses this to disable the modal's Apply button.
 */

import { useEffect, useMemo } from "react";
import type { ConfigPanelProps } from "./registry";
import {
  isColumnDrillDownSafe,
  inferDataTypeFromColumn,
} from "../../lib/columnTypes";

export type FilterFieldKind =
  | "text-eq"
  | "text-in"
  | "dropdown"
  | "multi-select"
  | "number-eq"
  | "number-range"
  | "number-slider"
  | "date-eq"
  | "date-range"
  | "boolean-toggle";

type FilterField = {
  column: string;
  kind: FilterFieldKind | ""; // empty until operator picks both column AND kind
};

// Per-column-type allowed kinds (locked in 44-CONTEXT.md "Per-column-type control variants").
const KINDS_BY_DATA_TYPE: Record<
  string,
  { value: FilterFieldKind; label: string }[]
> = {
  string: [
    { value: "text-eq", label: "Text input (single value, =)" },
    {
      value: "text-in",
      label: "Text input with comma-separated values (IN)",
    },
    { value: "dropdown", label: "Dropdown (single value from base table)" },
    {
      value: "multi-select",
      label: "Multi-select (multi values from base table, IN)",
    },
  ],
  number: [
    { value: "number-eq", label: "Number input (single value, =)" },
    { value: "number-range", label: "Range (min / max, BETWEEN)" },
    { value: "number-slider", label: "Slider (dual-thumb, BETWEEN)" },
  ],
  datetime: [
    { value: "date-eq", label: "Single date (=)" },
    { value: "date-range", label: "Date range (from / to, BETWEEN)" },
  ],
  boolean: [
    {
      value: "boolean-toggle",
      label: "3-state toggle (Any / True / False)",
    },
  ],
};

export default function DataFilterConfigPanel({
  config,
  onChange,
  tables,
  isValid,
}: ConfigPanelProps): JSX.Element {
  const tableId = config.tableId as number | undefined;
  const filterFields = (config.filterFields as FilterField[] | undefined) ?? [];
  const allTables = tables ?? [];

  // Resolve the selected base table (for column picker)
  const selectedTable = useMemo(
    () =>
      tableId !== undefined ? allTables.find((t) => t.id === tableId) : undefined,
    [tableId, allTables],
  );
  const columns = selectedTable?.columns ?? {};

  // Eligible column names (exclude WKT/geometry/large-text via isColumnDrillDownSafe)
  const eligibleColumnNames = useMemo(
    () =>
      Object.entries(columns)
        .filter(([, type]) => isColumnDrillDownSafe(type))
        .map(([name]) => name),
    [columns],
  );

  // Validity: every row needs both column AND kind; filterFields cannot be empty
  const allRowsValid = useMemo(
    () =>
      filterFields.length > 0 &&
      filterFields.every((f) => f.column !== "" && f.kind !== ""),
    [filterFields],
  );

  useEffect(() => {
    isValid?.(allRowsValid);
  }, [allRowsValid, isValid]);

  // ----- Handlers -----

  const handleTableChange = (newValue: string) => {
    if (newValue === "") {
      // operator cleared selection
      onChange({
        ...config,
        tableId: undefined,
        tableRef: undefined,
        filterFields: [],
      });
      return;
    }
    const newTable = allTables.find(
      (t) => `${t.schema}.${t.name}` === newValue,
    );
    if (!newTable) return;
    // Table change clears filterFields — old column refs may be invalid for new table
    onChange({
      ...config,
      tableId: newTable.id,
      tableRef: `${newTable.schema}.${newTable.name}`,
      filterFields: [], // RESET — operator must re-pick columns
    });
  };

  const handleAddRow = () => {
    onChange({
      ...config,
      filterFields: [...filterFields, { column: "", kind: "" }],
    });
  };

  const handleRemoveRow = (idx: number) => {
    onChange({
      ...config,
      filterFields: filterFields.filter((_, i) => i !== idx),
    });
  };

  const handleColumnChange = (idx: number, newColumn: string) => {
    const next = [...filterFields];
    next[idx] = { column: newColumn, kind: "" }; // reset kind — may not be valid for new column type
    onChange({ ...config, filterFields: next });
  };

  const handleKindChange = (idx: number, newKind: FilterFieldKind) => {
    const next = [...filterFields];
    next[idx] = { ...next[idx], kind: newKind };
    onChange({ ...config, filterFields: next });
  };

  // ----- Render -----

  const baseTableValue = selectedTable
    ? `${selectedTable.schema}.${selectedTable.name}`
    : "";

  return (
    <div
      className="config-group"
      role="group"
      aria-labelledby="datafilter-config-label"
    >
      <label id="datafilter-config-label" className="config-group-label">
        DATA FILTER CONFIG
      </label>

      {/* Base-table picker — required first selection */}
      <div className="ds-field">
        <span className="ds-field-label">Base table</span>
        <select
          className="ds-select"
          aria-label="Base table"
          value={baseTableValue}
          onChange={(e) => handleTableChange(e.target.value)}
        >
          <option value="">Select a base table...</option>
          {allTables.map((t) => {
            const full = `${t.schema}.${t.name}`;
            return (
              <option key={t.id} value={full}>
                {full}
              </option>
            );
          })}
        </select>
      </div>

      {/* Row builder — gated on having a selected table */}
      {tableId === undefined ? (
        <div className="config-hint">Pick a base table first.</div>
      ) : (
        <>
          <div className="config-group-label" style={{ marginTop: 16 }}>
            FILTER FIELDS
          </div>

          {filterFields.length === 0 && (
            <div className="config-hint">
              No filter fields configured. Click &quot;Add filter field&quot; below to add
              one.
            </div>
          )}

          {filterFields.map((row, idx) => {
            const colType = columns[row.column];
            const dataType = colType
              ? inferDataTypeFromColumn(row.column, columns)
              : "null";
            const allowedKinds = KINDS_BY_DATA_TYPE[dataType] ?? [];
            const columnMissing = row.column !== "" && colType === undefined;

            return (
              <div
                key={idx}
                className="datafilter-row"
                data-testid={`datafilter-row-${idx}`}
                style={{
                  display: "flex",
                  gap: 8,
                  marginBottom: 8,
                  alignItems: "center",
                }}
              >
                {/* Column picker */}
                <select
                  className="ds-select"
                  aria-label={`Filter field ${idx + 1} column`}
                  value={row.column}
                  onChange={(e) => handleColumnChange(idx, e.target.value)}
                >
                  <option value="">Pick a column...</option>
                  {eligibleColumnNames.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>

                {/* Kind picker — disabled until column picked */}
                <select
                  className="ds-select"
                  aria-label={`Filter field ${idx + 1} control kind`}
                  value={row.kind}
                  onChange={(e) =>
                    handleKindChange(idx, e.target.value as FilterFieldKind)
                  }
                  disabled={row.column === "" || columnMissing}
                >
                  <option value="">Pick a control...</option>
                  {allowedKinds.map((k) => (
                    <option key={k.value} value={k.value}>
                      {k.label}
                    </option>
                  ))}
                </select>

                {/* Remove */}
                <button
                  type="button"
                  className="ghost-sm ghost-danger"
                  aria-label={`Remove filter field ${idx + 1}`}
                  onClick={() => handleRemoveRow(idx)}
                >
                  Remove
                </button>

                {columnMissing && (
                  <span className="config-hint" style={{ color: "var(--danger)" }}>
                    Column &apos;{row.column}&apos; not found on base table
                  </span>
                )}
              </div>
            );
          })}

          <button
            type="button"
            className="ghost-sm datafilter-add-row"
            aria-label="Add filter field"
            onClick={handleAddRow}
          >
            + Add filter field
          </button>
        </>
      )}
    </div>
  );
}
