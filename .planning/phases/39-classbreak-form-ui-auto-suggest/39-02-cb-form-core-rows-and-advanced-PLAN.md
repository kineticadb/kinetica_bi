---
phase: 39-classbreak-form-ui-auto-suggest
plan: 02
type: execute
wave: 2
depends_on: ["39-01"]
files_modified:
  - kinetica_bi/src/components/charts/CbConfigForm.tsx
  - kinetica_bi/src/components/charts/CbConfigForm.spec.tsx
autonomous: true
requirements:
  - CB-V17-02
  - CB-V17-03
  - CB-V17-05
  - CB-V17-07
  - CB-V17-08
must_haves:
  truths:
    - "Operator can select a CB attr column from the eligible-columns dropdown; WKB-binary columns absent with inline message"
    - "Selecting a numeric column auto-defaults cb_config.valsType to 'numeric'; selecting a string column auto-defaults to 'categorical'"
    - "Advanced section header (closed by default) reveals a 'Treat numeric column as categorical' checkbox that flips valsType when checked"
    - "Operator can add break rows via [+ Add break]; each new row has value/color/label + 5 advanced fields populated with defaults"
    - "Operator can remove break rows via per-row remove button"
    - "Per-row label text input is visible alongside the color picker on every row"
    - "Per-row color picker uses the AARRGGBB two-control idiom (color picker + text input) writing into cb_config.breaks[i].color"
    - "Per-row chevron expands an inline advanced panel below the row with pointSize (1-20), pointShape (circle/square/diamond/triangle), shapeLineWidth (1-20), shapeLineColor (AARRGGBB), shapeFillColor (AARRGGBB)"
    - "Switching CB column preserves breaks[].length + colors + labels + advanced fields by index; clears values based on new valsType (numeric→0, categorical→'')"
    - "isValid(true) when breaks.length >= 2 AND every break has a non-empty value (excluding the <other> bucket sentinel); isValid(false) otherwise"
    - "Form writes via onChange({ ...config, cb_config: JSON.stringify(nextCbConfig) }) — never reads or writes legacy config.cbColumn / config.classbreaks[]"
  artifacts:
    - path: "kinetica_bi/src/components/charts/CbConfigForm.tsx"
      provides: "Full-featured CB column picker + break-row builder + advanced expand panel + isValid signaling"
      min_lines: 250
    - path: "kinetica_bi/src/components/charts/CbConfigForm.spec.tsx"
      provides: "Dedicated spec file covering column picker, row builder, per-row advanced, column-change behavior, isValid signaling"
      min_lines: 200
  key_links:
    - from: "CbConfigForm column picker change handler"
      to: "cb_config.attr + cb_config.valsType (auto-detect via detectValsTypeFromColumn)"
      via: "onChange + JSON.stringify(cb_config)"
      pattern: "JSON.stringify"
    - from: "CbConfigForm [+ Add break] button"
      to: "lib/cbConfig.ts createDefaultBreak helper"
      via: "createDefaultBreak(cbConfig.valsType, cbConfig.breaks.length)"
      pattern: "createDefaultBreak"
    - from: "CbConfigForm CB column dropdown"
      to: "lib/cbConfig.ts filterCbEligibleColumns helper"
      via: "filterCbEligibleColumns(columns, spatialBoundSet)"
      pattern: "filterCbEligibleColumns"
---

<objective>
Wave 2 core of Phase 39. Build out the CbConfigForm skeleton from 39-01 into a fully-functional CB column picker + break-row builder + per-row advanced expand panel.

Closes (frontend side, no server): CB-V17-02 (column picker + auto-detect valsType + override), CB-V17-03 (numeric N-row builder with value/color), CB-V17-05 (per-break label field), CB-V17-07 (per-row advanced expand-on-click panel with 5 fields), CB-V17-08 (WKB column gate inline message — eligibility filter from 39-01 consumed here).

Out of scope (deferred to Plan 39-03): categorical `<other>` toggle, probeCardinality wiring, value validation (empty/duplicate), Auto-suggest button + N slider + modal-confirm + AbortController + error UX, wiring `schema`/`tableName` props through.

Purpose: Operator can configure numeric breaks end-to-end inside the classbreak render mode. cb_config persists via the existing onChange chain → 300ms debounce → PATCH `/api/dashboards/:id/layers/:layerId`. wmsUrlBuilder (Phase 38) reads cb_config and emits Lane C params; tile re-render fires automatically via the Phase 38-locked fingerprint.

Output: CbConfigForm.tsx (~300-400 lines, replacing the 39-01 skeleton) + CbConfigForm.spec.tsx (~250 lines, new dedicated spec file).
</objective>

<execution_context>
@/Users/rydelpereira/.claude/get-shit-done/workflows/execute-plan.md
@/Users/rydelpereira/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/39-classbreak-form-ui-auto-suggest/39-CONTEXT.md
@.planning/phases/39-classbreak-form-ui-auto-suggest/39-RESEARCH.md
@.planning/phases/39-classbreak-form-ui-auto-suggest/39-01-foundation-palette-and-cleanup-PLAN.md

<interfaces>
<!-- Key types and contracts. Plan 39-01 ships the helpers; this plan consumes them directly. -->

From kinetica_bi/src/lib/cbConfig.ts (Plan 39-01 extensions):
```typescript
export type CbBreak = {
  value: string | number;
  color: string;          // 8-char AARRGGBB
  label?: string;
  pointSize?: number;
  pointShape?: string;
  shapeLineWidth?: number;
  shapeLineColor?: string;
  shapeFillColor?: string;
};
export type CbConfig = {
  attr: string;
  valsType: "numeric" | "categorical";
  breaks: CbBreak[];
  includeOtherBucket?: boolean;
};
export const EMPTY_CB_CONFIG: CbConfig;
export function coalesceCbConfig(raw: string | null): CbConfig;
export function isCbConfigConfigured(cfg: CbConfig): boolean;
export function isNumericValsType(cfg: CbConfig): boolean;
export function isCategoricalValsType(cfg: CbConfig): boolean;
export const PALETTE_COLORS: readonly string[]; // 8 entries
export function createDefaultBreak(valsType: "numeric" | "categorical", index: number): CbBreak;
export function filterCbEligibleColumns(
  columns: { name: string; type: string }[],
  spatialBound?: Set<string>,
): { name: string; type: string }[];
export function detectValsTypeFromColumn(
  column: { name: string; type: string } | undefined,
): "numeric" | "categorical";
```

From kinetica_bi/src/lib/colorHex.ts:
```typescript
export function normalizeAARRGGBB(hex: string | undefined, fallback?: string): string;
export function rgbFromAARRGGBB(hex: string | undefined, fallback?: string): string;
export function alphaFromAARRGGBB(hex: string | undefined, fallback?: string): string;
export function joinAARRGGBB(alpha: string, rgb: string): string;
```

From kinetica_bi/src/lib/columnTypes.ts:
```typescript
export type Column = { name: string; type: string };
```

From the raster Point color pattern in KineticaWmsLayerForm.tsx:832-859 (the canonical AARRGGBB two-control color picker idiom — mirror exactly for per-row colors):
```typescript
<input
  type="color"
  className="config-color-picker"
  value={`#${rgbFromAARRGGBB(<currentValue> || "FFFF3838")}`}
  onChange={(e) =>
    <updateFn>(joinAARRGGBB(
      alphaFromAARRGGBB(<currentValue> || "FFFF3838"),
      e.target.value.replace("#", ""),
    ))
  }
/>
<input
  type="text"
  className="config-color-text"
  value={normalizeAARRGGBB(<currentValue> || "FFFF3838")}
  onChange={(e) => <updateFn>(normalizeAARRGGBB(e.target.value, "FFFF3838"))}
/>
```
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Build CbConfigForm — column picker + break-row builder + valsType auto-detect + advanced override</name>
  <files>kinetica_bi/src/components/charts/CbConfigForm.tsx, kinetica_bi/src/components/charts/CbConfigForm.spec.tsx</files>
  <read_first>
    - kinetica_bi/src/components/charts/CbConfigForm.tsx (Plan 39-01 skeleton — REPLACE entirely)
    - kinetica_bi/src/lib/cbConfig.ts (Plan 39-01 extensions — types + helpers consumed here)
    - kinetica_bi/src/lib/colorHex.ts (normalizeAARRGGBB / rgbFromAARRGGBB / alphaFromAARRGGBB / joinAARRGGBB)
    - kinetica_bi/src/components/charts/KineticaWmsLayerForm.tsx lines 832-859 (raster pointColor — canonical AARRGGBB color-picker idiom to mirror per-row)
  </read_first>
  <behavior>
    - Test: renders with empty cb_config — shows column picker, no break rows, [+ Add break] disabled when no column selected
    - Test: renders WKB column inline message "WKB columns not supported for classbreak in v1.7" when columns include WKB-binary types
    - Test: column dropdown options exclude any column whose type contains "bytes" or "wkb" (case-insensitive)
    - Test: column dropdown options exclude spatial-bound columns (config.latColumn / lonColumn / wktColumn / wkbColumn)
    - Test: selecting a numeric column (type "double") emits onChange with cb_config.attr === "<col>" AND cb_config.valsType === "numeric"
    - Test: selecting a string column (type "varchar") emits onChange with cb_config.attr === "<col>" AND cb_config.valsType === "categorical"
    - Test: [+ Add break] click emits onChange with cb_config.breaks.length increasing by 1; the new break has value === 0 (numeric mode), color from PALETTE_COLORS, label "", and all 5 advanced fields populated with defaults
    - Test: clicking remove on row i emits onChange with breaks.length decreasing by 1; breaks[i] removed
    - Test: editing value on row i emits onChange with cb_config.breaks[i].value === new value (numeric input parses to number)
    - Test: editing label on row i emits onChange with cb_config.breaks[i].label === new string
    - Test: editing color on row i (via the text input) emits onChange with cb_config.breaks[i].color normalized to 8-char AARRGGBB
    - Test: clicking the "Advanced" form-level chevron reveals the "Treat numeric column as categorical" checkbox; checking it flips cb_config.valsType to "categorical"
    - Test: switching CB column from "fare" (numeric) to "vendor" (varchar) preserves breaks[].length AND breaks[].color by index AND breaks[].label by index, but clears breaks[].value to "" (categorical default for new type)
    - Test: switching CB column from numeric to numeric (e.g. "fare" → "tip") preserves all break fields including values
    - Test: isValid(true) signaled when breaks.length >= 2 AND every break.value is non-empty (numeric 0 counts as non-empty)
    - Test: isValid(false) signaled when breaks.length < 2
    - Test: form NEVER writes config.cbColumn or config.classbreaks (assert by spying onChange and grep-ing the call args)
  </behavior>
  <action>
    REPLACE the entire `kinetica_bi/src/components/charts/CbConfigForm.tsx` skeleton from 39-01 with the full implementation. The component:

    1. **Imports** (top of file):
    ```typescript
    import { useCallback, useEffect, useMemo, useState } from "react";
    import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
    import { faXmark, faChevronRight, faChevronDown } from "@fortawesome/free-solid-svg-icons";
    import type { Column } from "../../lib/columnTypes";
    import {
      coalesceCbConfig,
      createDefaultBreak,
      filterCbEligibleColumns,
      detectValsTypeFromColumn,
      type CbBreak,
      type CbConfig,
    } from "../../lib/cbConfig";
    import {
      normalizeAARRGGBB,
      rgbFromAARRGGBB,
      alphaFromAARRGGBB,
      joinAARRGGBB,
    } from "../../lib/colorHex";
    ```

    2. **Props type**:
    ```typescript
    type CbConfigFormProps = {
      config: Record<string, unknown>;
      onChange: (config: Record<string, unknown>) => void;
      columns: Column[];
      isValid?: (valid: boolean) => void;
      tableRef?: string;
      schema?: string;
      tableName?: string;
    };
    ```

    3. **Component body** — `export default function CbConfigForm({...}: CbConfigFormProps): JSX.Element` with this structure:

    a) Deserialize cb_config at top:
    ```typescript
    const cbConfig: CbConfig = coalesceCbConfig((config.cb_config as string | null) ?? null);
    ```

    b) Per-row advanced reveal state — Set<number> of expanded row indices:
    ```typescript
    const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());
    const toggleExpanded = (i: number) => {
      setExpandedRows((prev) => {
        const next = new Set(prev);
        if (next.has(i)) next.delete(i); else next.add(i);
        return next;
      });
    };
    ```

    c) Form-level Advanced section reveal:
    ```typescript
    const [advancedOpen, setAdvancedOpen] = useState<boolean>(false);
    ```

    d) Compute eligible columns + spatial-bound set:
    ```typescript
    const spatialBound = new Set(
      [config.latColumn, config.lonColumn, config.wktColumn, config.wkbColumn]
        .filter((v) => typeof v === "string" && v.length > 0) as string[],
    );
    const eligibleColumns = useMemo(
      () => filterCbEligibleColumns(columns, spatialBound),
      [columns, config.latColumn, config.lonColumn, config.wktColumn, config.wkbColumn],
    );
    const hasWkbColumns = useMemo(
      () => columns.some((c) => {
        const t = c.type.toLowerCase();
        return t.includes("bytes") || t.includes("wkb");
      }),
      [columns],
    );
    ```

    e) Patch helper — central write site (ALWAYS through this; NEVER touch config.cbColumn / config.classbreaks):
    ```typescript
    const patchCb = useCallback(
      (next: CbConfig) => {
        onChange({ ...config, cb_config: JSON.stringify(next) });
      },
      [config, onChange],
    );
    ```

    f) Column picker handler with auto-detect + column-change rules (preserve count/colors/labels/advanced by index; clear value based on new valsType):
    ```typescript
    const onPickCbColumn = (newAttr: string) => {
      const newCol = columns.find((c) => c.name === newAttr);
      const detectedType = detectValsTypeFromColumn(newCol);
      // Override: if advanced "force categorical" is checked AND new column is numeric,
      // keep valsType=categorical
      const newValsType = cbConfig.valsType === "categorical" && advancedForceCategorical
        ? "categorical"
        : detectedType;
      const typeChanged = cbConfig.valsType !== newValsType;
      const nextBreaks: CbBreak[] = cbConfig.breaks.map((b) => ({
        ...b,
        value: typeChanged
          ? (newValsType === "numeric" ? 0 : "")
          : b.value,
      }));
      patchCb({ ...cbConfig, attr: newAttr, valsType: newValsType, breaks: nextBreaks });
    };
    ```

    g) "Force categorical" override state derived from cbConfig.valsType + column type:
    ```typescript
    const currentColumn = columns.find((c) => c.name === cbConfig.attr);
    const columnIsNumeric = detectValsTypeFromColumn(currentColumn) === "numeric";
    const advancedForceCategorical = cbConfig.valsType === "categorical" && columnIsNumeric;
    const onToggleForceCategorical = (checked: boolean) => {
      const newValsType: "numeric" | "categorical" = checked ? "categorical" : "numeric";
      const nextBreaks = cbConfig.breaks.map((b) => ({
        ...b,
        value: newValsType === "numeric" ? 0 : "",
      }));
      patchCb({ ...cbConfig, valsType: newValsType, breaks: nextBreaks });
    };
    ```

    h) Add / remove / update break handlers:
    ```typescript
    const addBreak = () => {
      const newBreak = createDefaultBreak(cbConfig.valsType, cbConfig.breaks.length);
      patchCb({ ...cbConfig, breaks: [...cbConfig.breaks, newBreak] });
    };
    const removeBreak = (idx: number) => {
      patchCb({ ...cbConfig, breaks: cbConfig.breaks.filter((_, i) => i !== idx) });
      // Also collapse the removed row from expanded set
      setExpandedRows((prev) => {
        const next = new Set<number>();
        prev.forEach((i) => {
          if (i < idx) next.add(i);
          else if (i > idx) next.add(i - 1);
        });
        return next;
      });
    };
    const updateBreak = (idx: number, patch: Partial<CbBreak>) => {
      patchCb({
        ...cbConfig,
        breaks: cbConfig.breaks.map((b, i) => (i === idx ? { ...b, ...patch } : b)),
      });
    };
    ```

    i) isValid signaling — fires whenever breaks length OR any value changes:
    ```typescript
    useEffect(() => {
      if (!isValid) return;
      if (cbConfig.breaks.length < 2) {
        isValid(false);
        return;
      }
      // Every break must have a non-empty value; the literal "<other>" sentinel counts as valid
      const allValuesPresent = cbConfig.breaks.every((b) => {
        if (typeof b.value === "number") return Number.isFinite(b.value);
        return typeof b.value === "string" && b.value.length > 0;
      });
      isValid(allValuesPresent);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [cbConfig.breaks.length, JSON.stringify(cbConfig.breaks.map((b) => b.value))]);
    ```

    j) **JSX render** (structure — exact markup):
    - Top-level: `<div className="config-group" role="group" aria-labelledby="cb-config-form-label">`
    - Header: `<label id="cb-config-form-label" className="config-group-label">CLASS BREAK PARAMS</label>`
    - **Column picker block**: `<label className="ds-field-label" htmlFor="cb-attr">CB column</label>` followed by `<select id="cb-attr" className="ds-select" aria-label="CB column" value={cbConfig.attr} onChange={(e) => onPickCbColumn(e.target.value)}>` with `<option value="">— select —</option>` plus an option for each eligible column. If eligibleColumns.length === 0 AND hasWkbColumns, render below the select: `<div className="config-hint" style={{ color: "var(--muted)" }}>WKB columns not supported for classbreak in v1.7</div>`. If eligibleColumns.length === 0 AND !hasWkbColumns, render: `<div className="config-hint">No CB-eligible columns on this table.</div>`.
    - **Advanced section header** (form-level): clickable `<button type="button" className="cb-advanced-header" aria-expanded={advancedOpen} onClick={() => setAdvancedOpen(v => !v)}>` containing `<FontAwesomeIcon icon={advancedOpen ? faChevronDown : faChevronRight} /> Advanced</button>`. When open, render the override checkbox (only meaningful when columnIsNumeric):
    ```typescript
    {advancedOpen && (
      <div className="cb-advanced-panel">
        <label>
          <input
            type="checkbox"
            aria-label="Treat numeric column as categorical"
            checked={advancedForceCategorical}
            disabled={!columnIsNumeric || cbConfig.attr === ""}
            onChange={(e) => onToggleForceCategorical(e.target.checked)}
          />
          Treat numeric column as categorical
        </label>
      </div>
    )}
    ```
    - **Break rows container**: `<div className="config-classbreak-rows" data-testid="cb-rows">`. For each break, render `<div key={i} className="config-classbreak-row" data-row-index={i}>` containing:
      - Per-row chevron toggle: `<button type="button" aria-label={\`Toggle advanced for row ${i + 1}\`} onClick={() => toggleExpanded(i)}><FontAwesomeIcon icon={expandedRows.has(i) ? faChevronDown : faChevronRight} /></button>`
      - Row label span: `<span className="config-classbreak-row-label">Break {i + 1}</span>`
      - Value input — `cbConfig.valsType === "numeric"` ? `<input type="number" aria-label={\`Value for break ${i + 1}\`} placeholder="Upper boundary" value={typeof b.value === "number" ? b.value : ""} onChange={(e) => updateBreak(i, { value: e.target.value === "" ? "" : Number(e.target.value) })} />` : `<input type="text" aria-label={\`Value for break ${i + 1}\`} value={String(b.value ?? "")} onChange={(e) => updateBreak(i, { value: e.target.value })} />`
      - Color picker pair (mirroring raster pointColor at line 832-859 — see <interfaces>): two inputs, the color picker for RGB and the text input for AARRGGBB. Use `b.color || PALETTE_COLORS[i % PALETTE_COLORS.length]` as fallback. Update via `updateBreak(i, { color: ... })`.
      - Label input: `<input type="text" aria-label={\`Label for break ${i + 1}\`} placeholder="Label (optional)" value={b.label ?? ""} onChange={(e) => updateBreak(i, { label: e.target.value })} />`
      - Remove button: `<button type="button" className="ghost-sm ghost-danger" aria-label={\`Remove break ${i + 1}\`} onClick={() => removeBreak(i)}><FontAwesomeIcon icon={faXmark} /></button>`
      - **Per-row advanced panel** (rendered BELOW the row when `expandedRows.has(i)`):
      ```typescript
      {expandedRows.has(i) && (
        <div className="cb-row-advanced" data-testid={`cb-row-advanced-${i}`}>
          <label>
            Point size
            <input
              type="number"
              aria-label={`Point size for break ${i + 1}`}
              min={1} max={20} step={1}
              value={b.pointSize ?? 5}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                const clamped = isNaN(v) ? 5 : Math.max(1, Math.min(20, v));
                updateBreak(i, { pointSize: clamped });
              }}
            />
          </label>
          <label>
            Point shape
            <select
              aria-label={`Point shape for break ${i + 1}`}
              value={b.pointShape ?? "circle"}
              onChange={(e) => updateBreak(i, { pointShape: e.target.value })}
            >
              <option value="circle">circle</option>
              <option value="square">square</option>
              <option value="diamond">diamond</option>
              <option value="triangle">triangle</option>
            </select>
          </label>
          <label>
            Shape line width
            <input
              type="number"
              aria-label={`Shape line width for break ${i + 1}`}
              min={1} max={20} step={1}
              value={b.shapeLineWidth ?? 1}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                const clamped = isNaN(v) ? 1 : Math.max(1, Math.min(20, v));
                updateBreak(i, { shapeLineWidth: clamped });
              }}
            />
          </label>
          <label>
            Shape line color
            <input
              type="color"
              className="config-color-picker"
              aria-label={`Shape line color (RGB) for break ${i + 1}`}
              value={`#${rgbFromAARRGGBB(b.shapeLineColor || "FF000000")}`}
              onChange={(e) =>
                updateBreak(i, {
                  shapeLineColor: joinAARRGGBB(
                    alphaFromAARRGGBB(b.shapeLineColor || "FF000000"),
                    e.target.value.replace("#", ""),
                  ),
                })
              }
            />
            <input
              type="text"
              className="config-color-text"
              aria-label={`Shape line color (AARRGGBB hex) for break ${i + 1}`}
              value={normalizeAARRGGBB(b.shapeLineColor || "FF000000")}
              onChange={(e) =>
                updateBreak(i, { shapeLineColor: normalizeAARRGGBB(e.target.value, "FF000000") })
              }
            />
          </label>
          <label>
            Shape fill color
            <input
              type="color"
              className="config-color-picker"
              aria-label={`Shape fill color (RGB) for break ${i + 1}`}
              value={`#${rgbFromAARRGGBB(b.shapeFillColor || "FFFFFFFF")}`}
              onChange={(e) =>
                updateBreak(i, {
                  shapeFillColor: joinAARRGGBB(
                    alphaFromAARRGGBB(b.shapeFillColor || "FFFFFFFF"),
                    e.target.value.replace("#", ""),
                  ),
                })
              }
            />
            <input
              type="text"
              className="config-color-text"
              aria-label={`Shape fill color (AARRGGBB hex) for break ${i + 1}`}
              value={normalizeAARRGGBB(b.shapeFillColor || "FFFFFFFF")}
              onChange={(e) =>
                updateBreak(i, { shapeFillColor: normalizeAARRGGBB(e.target.value, "FFFFFFFF") })
              }
            />
          </label>
        </div>
      )}
      ```
    - **[+ Add break] button** below the rows: `<button type="button" className="config-classbreak-add ghost-sm" aria-label="+ Add break" disabled={cbConfig.attr === ""} onClick={addBreak}>+ Add break</button>`
    - **Validity hint** when breaks.length < 2: `<div className="config-hint" style={{ color: "var(--muted)" }}>Add at least 2 break rows</div>`
    - **Placeholder for categorical UX** (Plan 39-03 fills): `<div className="cb-categorical-placeholder" style={{ display: "none" }} data-testid="cb-categorical-placeholder">categorical + auto-suggest land in Plan 39-03</div>` — Plan 39-03 replaces this with the real categorical sub-UI + Auto-suggest button.

    Reference the raster Point color block at KineticaWmsLayerForm.tsx:832-859 for the canonical color-picker idiom (already shown in <interfaces> above).

    Silence unused-prop warnings for tableRef/schema/tableName (Plan 39-03 consumes): `void tableRef; void schema; void tableName;`

    Now create `kinetica_bi/src/components/charts/CbConfigForm.spec.tsx` with the test cases from <behavior>. Use the same mock pattern as KineticaWmsLayerForm.spec.tsx (no Zustand mocking needed — CbConfigForm doesn't subscribe to stores yet). Import `userEvent` from `@testing-library/user-event` if available, OR use `fireEvent` for compatibility with the existing spec style.

    Spec fixtures:
    ```typescript
    const baseColumns = [
      { name: "fare", type: "double" },
      { name: "tip", type: "double" },
      { name: "vendor", type: "varchar" },
      { name: "geom_wkb", type: "BYTES" },
      { name: "geom_wkt", type: "wkt" },
      { name: "lat", type: "double" },
      { name: "lon", type: "double" },
    ];
    const baseConfig: Record<string, unknown> = {
      latColumn: "lat",
      lonColumn: "lon",
    };
    function makeCbConfig(cb: Partial<{ attr: string; valsType: "numeric"|"categorical"; breaks: any[]; includeOtherBucket: boolean }>): Record<string, unknown> {
      return { ...baseConfig, cb_config: JSON.stringify({ attr: "", valsType: "numeric", breaks: [], ...cb }) };
    }
    ```

    Tests (one per <behavior> entry):
    - "renders column picker with eligible columns" — render with baseConfig, assert getByLabelText("CB column") exists, assert dropdown options include "fare", "tip", "vendor"
    - "excludes WKB-binary columns from picker" — assert dropdown options do NOT include "geom_wkb"
    - "excludes WKT spatial columns from picker (filterCbEligibleColumns native behavior)" — assert dropdown does NOT include "geom_wkt"
    - "excludes spatial-bound columns (lat/lon) from picker" — assert dropdown does NOT include "lat" or "lon"
    - "shows WKB inline message when WKB columns present" — assert getByText("WKB columns not supported for classbreak in v1.7") visible
    - "selecting numeric column emits cb_config with valsType='numeric'" — fireEvent.change on the select, assert onChange called with cb_config containing `attr:"fare"` and `valsType:"numeric"`
    - "selecting categorical column emits cb_config with valsType='categorical'" — same pattern for "vendor"
    - "[+ Add break] disabled when no column selected" — render with empty cb_config, assert button is disabled
    - "[+ Add break] enabled when column selected; clicking emits cb_config with new default break" — render with attr:"fare", click button, assert onChange called with breaks.length === 1 + new break has value:0, color from PALETTE_COLORS, label "", pointSize 5, etc.
    - "remove button on row 1 emits cb_config with breaks.length decreased and row 1 removed"
    - "editing numeric value emits onChange with breaks[i].value as number" — fire change on input, assert call arg has cb_config.breaks[i].value === parsed number
    - "editing label emits onChange with breaks[i].label as string"
    - "editing color via text input emits onChange with breaks[i].color normalized to 8-char AARRGGBB"
    - "advanced header click reveals 'Treat numeric column as categorical' checkbox; clicking checkbox flips valsType to categorical (with numeric column selected)"
    - "switching from numeric to varchar column preserves breaks count + colors + labels by index, clears values to ''"
    - "switching from numeric to numeric column preserves all break fields including values"
    - "isValid(true) called when breaks.length >= 2 and all values are non-empty"
    - "isValid(false) called when breaks.length < 2"
    - "isValid(false) called when categorical break has empty string value"
    - "per-row chevron expands advanced panel showing 5 fields (pointSize, pointShape, shapeLineWidth, shapeLineColor, shapeFillColor)"
    - "pointSize input clamps to 1-20 range — 0 → 1, 50 → 20"
    - "pointShape dropdown has exactly 4 options: circle, square, diamond, triangle"
    - "shapeLineWidth input clamps to 1-20"
    - "form NEVER writes config.cbColumn or config.classbreaks on any onChange call" — spy onChange, assert all calls' first arg has no `cbColumn` or `classbreaks` keys
  </action>
  <verify>
    <automated>cd kinetica_bi && npx vitest run src/components/charts/CbConfigForm.spec.tsx --reporter=verbose</automated>
  </verify>
  <acceptance_criteria>
    - kinetica_bi/src/components/charts/CbConfigForm.tsx file exists with >= 250 lines
    - `grep -c "createDefaultBreak" kinetica_bi/src/components/charts/CbConfigForm.tsx` returns at least 1
    - `grep -c "filterCbEligibleColumns" kinetica_bi/src/components/charts/CbConfigForm.tsx` returns at least 1
    - `grep -c "detectValsTypeFromColumn" kinetica_bi/src/components/charts/CbConfigForm.tsx` returns at least 1
    - `grep -c "coalesceCbConfig" kinetica_bi/src/components/charts/CbConfigForm.tsx` returns at least 1
    - `grep -c "JSON.stringify" kinetica_bi/src/components/charts/CbConfigForm.tsx` returns at least 1
    - `grep -c "cbColumn\|classbreaks" kinetica_bi/src/components/charts/CbConfigForm.tsx` returns 0 (hard cutover lock — NEVER read/write legacy fields)
    - `grep -c "WKB columns not supported" kinetica_bi/src/components/charts/CbConfigForm.tsx` returns at least 1
    - `grep -c "+ Add break" kinetica_bi/src/components/charts/CbConfigForm.tsx` returns at least 1
    - `grep -c 'min={1} max={20}' kinetica_bi/src/components/charts/CbConfigForm.tsx` returns at least 2 (pointSize and shapeLineWidth both clamp 1-20)
    - kinetica_bi/src/components/charts/CbConfigForm.spec.tsx exists with >= 200 lines
    - `cd kinetica_bi && npx vitest run src/components/charts/CbConfigForm.spec.tsx` exits 0
    - `cd kinetica_bi && npx vitest run src/components/charts/KineticaWmsLayerForm.spec.tsx` still exits 0 (39-01 specs unaffected)
    - `cd kinetica_bi && npx tsc -p tsconfig.app.json --noEmit` exits 0
  </acceptance_criteria>
  <done>
    CbConfigForm.tsx fleshed out from skeleton to full implementation: column picker with WKB + spatial exclusion, break-row builder with value/color/label/remove/add, per-row advanced chevron with 5 fields (pointSize/pointShape/shapeLineWidth/shapeLineColor/shapeFillColor), form-level Advanced override checkbox (force categorical), column-change rules (preserve count/colors/labels by index, clear value on type-change), isValid signaling on breaks.length + value-presence. All writes go through patchCb → onChange({ ...config, cb_config: JSON.stringify(next) }). NEVER touches legacy config.cbColumn / config.classbreaks. Dedicated spec file covers all behaviors. All Phase 39-01 specs still pass.
  </done>
</task>

</tasks>

<verification>
- vitest passes for CbConfigForm.spec.tsx with all test cases in <behavior>
- vitest passes for KineticaWmsLayerForm.spec.tsx (no regressions from 39-01)
- tsc clean: `cd kinetica_bi && npx tsc -p tsconfig.app.json --noEmit` exits 0
- `grep cbColumn\|classbreaks kinetica_bi/src/components/charts/CbConfigForm.tsx` returns nothing (hard cutover lock)
- Manual smoke test (optional, deferred to Plan 39-03 integration): renderMode=classbreak in LayersModal shows the new form
</verification>

<success_criteria>
- CB-V17-02 closed: column picker with type detection auto-defaults valsType, operator override via Advanced
- CB-V17-03 closed (numeric path): N-row builder with value/color, add/remove rows, 256-cap deferred to Plan 39-03 (cardinality probe)
- CB-V17-05 closed: per-break label field persisted in cb_config.breaks[].label
- CB-V17-07 closed: per-row advanced expand panel with 5 fields, clamped defaults
- CB-V17-08 closed: WKB column gate inline message + filter
- Plan 39-03 unblocked: CbConfigForm.tsx exists with the central patchCb helper and the categorical placeholder div for the categorical UX to mount into
- No regressions in KineticaWmsLayerForm.spec.tsx
</success_criteria>

<output>
After completion, create `.planning/phases/39-classbreak-form-ui-auto-suggest/39-02-SUMMARY.md` documenting:
- Final CbConfigForm.tsx structure (sections: column picker, advanced header, break rows container, [+ Add break])
- Key state machines (expandedRows Set, advancedOpen boolean)
- Key invariants (patchCb central write site; never touches legacy fields; column-change preserves colors/labels by index)
- Test surface in CbConfigForm.spec.tsx (count of tests; coverage gaps for Plan 39-03)
- Any deviations from the plan
</output>
