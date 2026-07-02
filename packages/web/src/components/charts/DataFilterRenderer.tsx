/**
 * v1.7 Phase 44 Plan 03 (FILTER-V17-11..17): Data Filter widget renderer.
 *
 * Short-circuits BEFORE AggregatedWidgetRenderer in WidgetRenderer.tsx. Owns its full lifecycle:
 *   - On mount: fetches value universes (topValuesFn for dropdown/multi-select, columnStatsFn
 *     for number-range) with AbortController cleanup; refs base table (NOT filter view —
 *     value universes stay stable as the operator filters; not cascading per CONTEXT.md).
 *   - Subscribes to useFilterStore.filters[tableId] so external chip dismissals (filter-bar ×)
 *     re-render the controls to reflect "not applied" state.
 *   - Stages all control values in local useState; never auto-applies.
 *   - Apply: builds ActiveFilter[] from staged values (skipping empty/Any fields),
 *     dispatches via setBulkFilters (ONE filterVersion tick) + synchronous markMaterializing.
 *   - Clear: calls clearFilters(tableId) (widget-scoped reset) + resets staged values.
 *
 * SOLE MATERIALIZE TRIGGER INVARIANT (Phase 15 / Phase 30 lock):
 *   This file NEVER imports the materialize function from client.ts.
 *   Effect 1 in AggregatedWidgetRenderer fires materialize off the filterVersion tick driven
 *   by setBulkFilters.
 *
 * DashboardContext note: tables is NOT in DashboardContext (Phase 44-03 inspection confirmed).
 * Tables are passed as a prop from WidgetRenderer.tsx (mirrors InfoCardRenderer pattern).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { TableDto, WidgetDto } from "../../api/client";
import { topValuesFn, columnStatsFn } from "../../api/client";
import { useFilterStore, type ActiveFilter } from "../../store/filterStore";
import { useFilterViewStore } from "../../store/filterViewStore";
import { useDashboardContext } from "../DashboardContext";
import { inferDataTypeFromColumn } from "../../lib/columnTypes";
import type { FilterFieldKind } from "./DataFilterConfigPanel";
import ZoomRangeSlider from "./ZoomRangeSlider";
import { MultiSelectChips } from "./MultiSelectChips";

type Props = {
  widget: WidgetDto;
  /** Passed from WidgetRenderer.tsx (tables not exposed via DashboardContext). */
  tables: TableDto[];
};

type FilterField = { column: string; kind: FilterFieldKind };

// Staged-value shape per kind:
//   text-eq / dropdown / date-eq / number-eq   → string
//   text-in                                    → string (raw comma-separated; parsed at Apply)
//   multi-select                               → string[]
//   number-range                               → { min: string; max: string }
//   date-range                                 → { from: string; to: string }
//   boolean-toggle                             → "any" | "true" | "false"
type StagedValue =
  | string
  | string[]
  | { min: string; max: string }
  | { from: string; to: string };

type StagedValues = Record<number, StagedValue>; // keyed by filterFields index

function defaultStagedFor(kind: FilterFieldKind): StagedValue {
  switch (kind) {
    case "text-eq":
    case "dropdown":
    case "date-eq":
    case "number-eq":
    case "text-in":
      return "";
    case "multi-select":
      return [];
    case "number-range":
    case "number-slider":
      // number-slider starts empty too — the mount-time columnStatsFn fetch
      // populates `{ min, max }` with the column's true bounds, which the
      // slider thumbs render against. Until that fetch returns, the slider
      // hides behind a "Loading range…" hint (see renderControl).
      return { min: "", max: "" };
    case "date-range":
      return { from: "", to: "" };
    case "boolean-toggle":
      return "any";
  }
}

export default function DataFilterRenderer({ widget, tables }: Props): JSX.Element {
  const cfg = widget.config ?? {};
  const tableId = cfg.tableId as number | undefined;
  const tableRef = cfg.tableRef as string | undefined;
  const filterFields = (cfg.filterFields as FilterField[] | undefined) ?? [];

  const { dashboardId } = useDashboardContext();

  // Parse "schema.name" tableRef into separate schema + table for API calls
  const [schemaName, baseTableName] = (tableRef ?? ".").split(".");

  // Resolve base table for column metadata
  const baseTable = useMemo(
    () => (tableId !== undefined ? tables.find((t) => t.id === tableId) : undefined),
    [tableId, tables],
  );
  const columns: Record<string, string> = baseTable?.columns ?? {};

  // Stable signature of which configured fields' columns are currently known on the
  // base table. The `tables` registry loads asynchronously, so on first mount this
  // can be all-"absent" and then flips once metadata arrives. Used as a fetch-effect
  // dependency so the value-universe fetch RE-RUNS when columns become available —
  // fixing a race where the widget mounted before `tables` loaded, every field was
  // skipped, and the dropdown showed a spurious "No matches" that never recovered.
  const columnsReadyKey = filterFields
    .map((f) => (columns[f.column] !== undefined ? "1" : "0"))
    .join("");

  // ----- Empty-state gates -----
  if (tableId === undefined || tableRef === undefined) {
    return (
      <div className="widget-datafilter widget-datafilter--empty">
        <div className="config-hint">
          Widget not yet configured. Open the config panel to pick a base table and add filter
          fields.
        </div>
      </div>
    );
  }
  if (filterFields.length === 0) {
    return (
      <div className="widget-datafilter widget-datafilter--empty">
        <div className="config-hint">
          No filter fields configured. Open the config panel to add fields.
        </div>
      </div>
    );
  }

  // ----- Chip-dismissal sync subscription -----
  // PITFALL C-02 lock: scope selector to filters[tableId] — never the whole map.
  // External chip × dismissal calls removeFilter(tableId, col) → filterVersion ticks →
  // re-render here → appliedColumns set refreshes → applied badge clears.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const tableFilters = useFilterStore((s) => s.filters[tableId] ?? []);

  // ----- Staged control state -----
  // `dirty` tracks whether the staged values differ from the last-applied snapshot.
  // Toggled true on any user-initiated control change (via stageChange below); reset
  // to false after Apply or Clear. Mount-time async fetches (columnStatsFn populating
  // slider bounds) bypass stageChange and call setStaged directly, so they don't mark
  // the widget dirty. The Apply button is disabled when dirty=false — strongest signal
  // that there's nothing pending.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const [dirty, setDirty] = useState(false);
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const [staged, setStaged] = useState<StagedValues>(() => {
    const init: StagedValues = {};
    filterFields.forEach((f, idx) => {
      init[idx] = defaultStagedFor(f.kind);
    });
    return init;
  });

  // Value universes fetched on mount
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const [topValues, setTopValues] = useState<Record<number, string[]>>({});
  // Slider bounds per number-slider field — populated by columnStatsFn on mount.
  // Used both to render the slider's min/max attributes AND to detect "thumbs at
  // bounds = no narrowing" in the Apply handler (in which case we skip dispatch).
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const [sliderBounds, setSliderBounds] = useState<Record<number, { min: number; max: number }>>({});
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const [universeLoading, setUniverseLoading] = useState(true);
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const [universeError, setUniverseError] = useState<string | null>(null);

  // Mount-time value-universe fetch (dropdown/multi-select → topValuesFn; number-range → columnStatsFn)
  // Cleanup aborts all in-flight requests on unmount (AbortController pattern).
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    const ctrl = new AbortController();
    const signal = ctrl.signal;
    let cancelled = false;

    async function fetchUniverses() {
      if (!schemaName || !baseTableName) {
        setUniverseLoading(false);
        return;
      }

      // The `tables` registry loads asynchronously; until this widget's base table
      // resolves, its column metadata is unknown. Defer the fetch (keeping the
      // controls in their "Loading…" state) and let the effect re-fire once metadata
      // arrives — baseTable?.id + columnsReadyKey are in the dep array below. Without
      // this guard every field was skipped, Promise.all([]) resolved instantly,
      // universeLoading flipped to false, and the dropdown rendered a spurious
      // "No matches" that never recovered (the effect did not depend on table metadata).
      if (baseTable === undefined) {
        return; // keep universeLoading = true; effect re-runs when baseTable resolves
      }

      const promises: Promise<void>[] = [];

      filterFields.forEach((f, idx) => {
        if (columns[f.column] === undefined) return; // column missing — skip

        if (f.kind === "dropdown" || f.kind === "multi-select") {
          promises.push(
            topValuesFn(
              { schema: schemaName, table: baseTableName, column: f.column, n: 1000 },
              signal,
            ).then((r) => {
              if (!cancelled) {
                setTopValues((prev) => ({ ...prev, [idx]: r.values }));
              }
            }),
          );
        } else if (f.kind === "number-range" || f.kind === "number-slider") {
          promises.push(
            columnStatsFn(
              { schema: schemaName, table: baseTableName, column: f.column },
              signal,
            ).then((r) => {
              if (!cancelled) {
                setStaged((prev) => ({
                  ...prev,
                  [idx]: { min: String(r.min), max: String(r.max) },
                }));
                // number-slider needs the true bounds separately so the Apply
                // handler can detect "thumbs at bounds = no narrowing" and skip dispatch.
                if (f.kind === "number-slider") {
                  setSliderBounds((prev) => ({
                    ...prev,
                    [idx]: { min: r.min, max: r.max },
                  }));
                }
              }
            }),
          );
        }
      });

      try {
        await Promise.all(promises);
        if (!cancelled) setUniverseLoading(false);
      } catch (err) {
        if (!cancelled && (err as Error).name !== "AbortError") {
          setUniverseError((err as Error).message);
          setUniverseLoading(false);
        }
      }
    }

    void fetchUniverses();

    return () => {
      cancelled = true;
      ctrl.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schemaName, baseTableName, JSON.stringify(filterFields.map((f) => `${f.column}:${f.kind}`)), columnsReadyKey, baseTable?.id]);

  // User-initiated control updates flow through here so we can tick the dirty flag.
  // Mount-time fetches keep using setStaged directly above so they don't mark dirty.
  const stageChange = (idx: number, patch: StagedValue) => {
    setStaged((prev) => ({ ...prev, [idx]: patch }));
    setDirty(true);
  };

  // Applied columns set (for visual badge on each control)
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const appliedColumns = useMemo(
    () => new Set(tableFilters.map((f) => f.column)),
    [tableFilters],
  );

  // ----- Apply handler -----

  const handleApply = () => {
    const batch: ActiveFilter[] = [];

    filterFields.forEach((f, idx) => {
      // Skip columns not present on the base table (defensive — warning shown in render)
      if (columns[f.column] === undefined) return;

      const dataType = inferDataTypeFromColumn(f.column, columns);
      const v = staged[idx];
      const base = {
        column: f.column,
        sourceWidgetId: widget.id,
        addedAt: Date.now(),
      };

      switch (f.kind) {
        case "text-eq":
        case "dropdown": {
          const s = typeof v === "string" ? v : "";
          if (s === "") return; // empty string → skip
          batch.push({ ...base, value: s, dataType: "string", operator: "eq" });
          break;
        }
        case "text-in": {
          const raw = typeof v === "string" ? v : Array.isArray(v) ? v.join(", ") : "";
          const arr = raw
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
          if (arr.length === 0) return; // empty IN → SKIP (locked: never reaches WHERE builder)
          batch.push({ ...base, value: arr, dataType: "string", operator: "in" });
          break;
        }
        case "multi-select": {
          const arr = Array.isArray(v) ? v : [];
          if (arr.length === 0) return; // empty IN → SKIP (locked: never reaches WHERE builder)
          batch.push({ ...base, value: arr, dataType: "string", operator: "in" });
          break;
        }
        case "number-eq": {
          const s = typeof v === "string" ? v : "";
          const n = Number(s);
          if (s === "" || !Number.isFinite(n)) return;
          batch.push({ ...base, value: n, dataType: "number", operator: "eq" });
          break;
        }
        case "number-range": {
          const t =
            typeof v === "object" && v !== null && "min" in v
              ? (v as { min: string; max: string })
              : { min: "", max: "" };
          const lo = Number(t.min);
          const hi = Number(t.max);
          if (t.min === "" || t.max === "" || !Number.isFinite(lo) || !Number.isFinite(hi)) return;
          batch.push({ ...base, value: [lo, hi] as [number, number], dataType: "number", operator: "between" });
          break;
        }
        case "number-slider": {
          const t =
            typeof v === "object" && v !== null && "min" in v
              ? (v as { min: string; max: string })
              : { min: "", max: "" };
          const lo = Number(t.min);
          const hi = Number(t.max);
          if (t.min === "" || t.max === "" || !Number.isFinite(lo) || !Number.isFinite(hi)) return;
          // Skip dispatch when the slider thumbs are still at the column's true
          // bounds — equivalent to "no narrowing applied".
          const bounds = sliderBounds[idx];
          if (bounds && lo <= bounds.min && hi >= bounds.max) return;
          batch.push({ ...base, value: [lo, hi] as [number, number], dataType: "number", operator: "between" });
          break;
        }
        case "date-eq": {
          const s = typeof v === "string" ? v : "";
          if (s === "") return;
          batch.push({ ...base, value: s, dataType: "datetime", operator: "eq" });
          break;
        }
        case "date-range": {
          const t =
            typeof v === "object" && v !== null && "from" in v
              ? (v as { from: string; to: string })
              : { from: "", to: "" };
          if (t.from === "" || t.to === "") return;
          batch.push({ ...base, value: [t.from, t.to] as [string, string], dataType: "datetime", operator: "between" });
          break;
        }
        case "boolean-toggle": {
          if (v === "any" || v === undefined) return; // "Any" → skip column
          if (v === "true") batch.push({ ...base, value: true, dataType: "boolean", operator: "eq" });
          else if (v === "false") batch.push({ ...base, value: false, dataType: "boolean", operator: "eq" });
          break;
        }
      }
    });

    // Single filterVersion tick — ONE materialize cycle for all N fields (Plan 44-01 lock)
    useFilterStore.getState().setBulkFilters(tableId, batch);

    // Phase 17-03 pattern: markMaterializing fires SYNCHRONOUSLY after setBulkFilters
    // (mirrors dispatchDrillDown:127-128 — same synchronous-tick sequencing)
    useFilterViewStore.getState().markMaterializing(tableId, dashboardId);

    // Staged values now match what's applied → no pending changes.
    setDirty(false);
  };

  // ----- Clear handler -----

  const handleClear = () => {
    // Widget-scoped reset: only this table's filters cleared.
    // Other tables' filters untouched; drill-down chips on this tableId WILL be cleared
    // (intentional — operator can dismiss individual chips if needed).
    useFilterStore.getState().clearFilters(tableId);

    // Reset staged values to defaults. Special-case: number-slider must reset to
    // the column's TRUE bounds (so the thumbs return to full range = "no narrowing"),
    // not the empty-string default — empty strings parse as Number("") === 0 which
    // would collapse both thumbs to 0.
    const reset: StagedValues = {};
    filterFields.forEach((f, idx) => {
      const bounds = sliderBounds[idx];
      if (f.kind === "number-slider" && bounds) {
        reset[idx] = { min: String(bounds.min), max: String(bounds.max) };
      } else {
        reset[idx] = defaultStagedFor(f.kind);
      }
    });
    setStaged(reset);
    // Reset implicitly aligns staged with applied (nothing pending now).
    setDirty(false);
  };

  // ----- Render -----

  return (
    <div className="widget-datafilter" data-testid="datafilter-renderer">
      {universeError !== null && (
        <div className="config-hint datafilter-error" style={{ color: "var(--danger)" }}>
          Failed to load value universes: {universeError}
        </div>
      )}

      {filterFields.map((f, idx) => {
        const colType = columns[f.column];

        // Column no longer on base table — show warning, skip dispatch
        if (colType === undefined) {
          return (
            <div
              key={idx}
              className="datafilter-field datafilter-field--missing"
              data-testid={`datafilter-field-${idx}`}
            >
              <span style={{ color: "var(--danger)" }}>
                Column &apos;{f.column}&apos; not found on base table — skipped
              </span>
            </div>
          );
        }

        const isApplied = appliedColumns.has(f.column);

        return (
          <div
            key={idx}
            className="datafilter-field"
            data-testid={`datafilter-field-${idx}`}
          >
            <label className="ds-field-label">
              {f.column}
              {isApplied && (
                <span
                  className="datafilter-applied-badge"
                  aria-label="applied"
                >
                  {" "}
                  ●
                </span>
              )}
            </label>
            {renderControl(
              f,
              idx,
              staged,
              stageChange,
              topValues[idx] ?? [],
              universeLoading,
              sliderBounds[idx],
            )}
          </div>
        );
      })}

      <div className="datafilter-actions">
        <button
          type="button"
          className="btn-primary btn-sm"
          onClick={handleApply}
          aria-label={dirty ? "Apply pending changes" : "Apply (no pending changes)"}
          title={dirty ? "Apply pending changes" : "No pending changes"}
          disabled={!dirty}
          data-testid="datafilter-apply"
        >
          Apply
        </button>
        <button
          type="button"
          className="ghost-sm"
          onClick={handleClear}
          aria-label="Clear"
          data-testid="datafilter-clear"
        >
          Clear
        </button>
      </div>
    </div>
  );
}

// Per-kind control renderer
function renderControl(
  field: FilterField,
  idx: number,
  staged: StagedValues,
  stageChange: (idx: number, patch: StagedValue) => void,
  topValues: string[],
  universeLoading: boolean,
  sliderBounds: { min: number; max: number } | undefined,
): JSX.Element {
  const v = staged[idx];
  // Routes user-initiated changes through stageChange so the parent ticks `dirty`.
  const set = (patch: StagedValue) => stageChange(idx, patch);

  switch (field.kind) {
    case "text-eq":
      return (
        <input
          type="text"
          className="ds-input"
          aria-label={field.column}
          value={typeof v === "string" ? v : ""}
          onChange={(e) => set(e.target.value)}
        />
      );

    case "text-in":
      return (
        <input
          type="text"
          className="ds-input"
          aria-label={`${field.column} (comma-separated values)`}
          placeholder="comma-separated: value1, value2, value3"
          value={typeof v === "string" ? v : Array.isArray(v) ? (v as string[]).join(", ") : ""}
          onChange={(e) => set(e.target.value)}
        />
      );

    case "dropdown":
      return (
        <select
          className="ds-select"
          aria-label={field.column}
          disabled={universeLoading && topValues.length === 0}
          value={typeof v === "string" ? v : ""}
          onChange={(e) => set(e.target.value)}
        >
          <option value="">— any —</option>
          {topValues.map((val) => (
            <option key={val} value={val}>
              {val}
            </option>
          ))}
        </select>
      );

    case "multi-select": {
      const selected = Array.isArray(v) ? (v as string[]) : [];
      return (
        <MultiSelectChips
          ariaLabel={field.column}
          options={topValues}
          value={selected}
          onChange={(next) => set(next)}
          loading={universeLoading && topValues.length === 0}
        />
      );
    }

    case "number-eq":
      return (
        <input
          type="number"
          className="ds-input"
          aria-label={field.column}
          value={typeof v === "string" ? v : ""}
          onChange={(e) => set(e.target.value)}
        />
      );

    case "number-range": {
      const t =
        typeof v === "object" && v !== null && "min" in v
          ? (v as { min: string; max: string })
          : { min: "", max: "" };
      return (
        <div
          className="datafilter-range"
          role="group"
          aria-label={`${field.column} range`}
        >
          <input
            type="number"
            className="ds-input"
            aria-label={`${field.column} min`}
            value={t.min}
            onChange={(e) => set({ ...t, min: e.target.value })}
          />
          <span> to </span>
          <input
            type="number"
            className="ds-input"
            aria-label={`${field.column} max`}
            value={t.max}
            onChange={(e) => set({ ...t, max: e.target.value })}
          />
        </div>
      );
    }

    case "number-slider": {
      // Bounds come from columnStatsFn at mount. Until they arrive, show a hint
      // (slider can't render without finite min/max). Once loaded, ZoomRangeSlider
      // handles dual-thumb interaction; values are stored as strings to share the
      // BETWEEN dispatch path with `number-range`.
      if (!sliderBounds || !Number.isFinite(sliderBounds.min) || !Number.isFinite(sliderBounds.max)) {
        return (
          <div className="datafilter-slider-loading" aria-label={`${field.column} slider loading`}>
            Loading range…
          </div>
        );
      }
      const t =
        typeof v === "object" && v !== null && "min" in v
          ? (v as { min: string; max: string })
          : { min: String(sliderBounds.min), max: String(sliderBounds.max) };
      const lo = Number(t.min);
      const hi = Number(t.max);
      const safeLo = Number.isFinite(lo) ? Math.max(sliderBounds.min, Math.min(lo, sliderBounds.max)) : sliderBounds.min;
      const safeHi = Number.isFinite(hi) ? Math.max(sliderBounds.min, Math.min(hi, sliderBounds.max)) : sliderBounds.max;
      const range = sliderBounds.max - sliderBounds.min;
      // 100 discrete steps across the range; for integer-only columns a step of 1
      // would be ideal, but we don't know the column subtype here — operator gets
      // ~1% resolution which is fine for typical BI ranges.
      const step = range > 0 ? range / 100 : 1;
      return (
        <div className="datafilter-slider" role="group" aria-label={`${field.column} slider`}>
          <ZoomRangeSlider
            value={[safeLo, safeHi]}
            onChange={([nextLo, nextHi]) =>
              set({ min: String(nextLo), max: String(nextHi) })
            }
            min={sliderBounds.min}
            max={sliderBounds.max}
            step={step}
            ariaLabelPrefix={field.column}
          />
        </div>
      );
    }

    case "date-eq":
      return (
        <input
          type="date"
          className="ds-input"
          aria-label={field.column}
          value={typeof v === "string" ? v : ""}
          onChange={(e) => set(e.target.value)}
        />
      );

    case "date-range": {
      const t =
        typeof v === "object" && v !== null && "from" in v
          ? (v as { from: string; to: string })
          : { from: "", to: "" };
      return (
        <div
          className="datafilter-daterange"
          role="group"
          aria-label={`${field.column} date range`}
        >
          <input
            type="date"
            className="ds-input"
            aria-label={`${field.column} from`}
            value={t.from}
            onChange={(e) => set({ ...t, from: e.target.value })}
          />
          <span> to </span>
          <input
            type="date"
            className="ds-input"
            aria-label={`${field.column} to`}
            value={t.to}
            onChange={(e) => set({ ...t, to: e.target.value })}
          />
        </div>
      );
    }

    case "boolean-toggle": {
      const state =
        v === "true" || v === "false" || v === "any" ? v : "any";
      return (
        <div
          className="datafilter-tristate"
          role="radiogroup"
          aria-label={field.column}
        >
          {(["any", "true", "false"] as const).map((opt) => (
            <button
              key={opt}
              type="button"
              role="radio"
              aria-checked={state === opt}
              aria-label={`${field.column}: ${opt}`}
              onClick={() => set(opt)}
              className={state === opt ? "btn-primary btn-sm" : "ghost-sm"}
            >
              {opt === "any" ? "Any" : opt === "true" ? "True" : "False"}
            </button>
          ))}
        </div>
      );
    }
  }
}

/* MultiSelectChips is now in ./MultiSelectChips.tsx — imported above. */
