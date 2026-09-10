---
phase: 39-classbreak-form-ui-auto-suggest
plan: 03
type: execute
wave: 3
depends_on: ["39-02"]
files_modified:
  - kinetica_bi/src/components/charts/CbConfigForm.tsx
  - kinetica_bi/src/components/charts/CbConfigForm.spec.tsx
  - kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx
autonomous: true
requirements:
  - CB-V17-03
  - CB-V17-04
  - CB-V17-06
  - CB-V17-09
must_haves:
  truths:
    - "When valsType='categorical' AND an attr column is selected, probeCardinality fires (warn>100 via 'permission' toast, hard-cap>256 via 'error' toast + disable [+ Add break])"
    - "[✓] Include <other> bucket checkbox renders above rows in categorical mode; default ON when valsType becomes categorical"
    - "Toggling <other> ON appends a row with value='<other>' at end of breaks[]; the <other> row's value field is rendered as a read-only chip (not an editable input)"
    - "Toggling <other> OFF removes any row where value === '<other>' and surfaces an inline warning 'NULL values will not appear in the map.'"
    - "Categorical empty value or duplicate-value rows show inline red text under the offending row; isValid(false) signaled"
    - "Auto-suggest button is visible only when valsType='numeric' AND attr is selected; button is disabled otherwise with title hint"
    - "N slider (range 2-16, default 5) appears alongside the Auto-suggest button in numeric mode"
    - "Clicking Auto-suggest with existing breaks shows an inline modal-confirm dialog 'Replace N break rows with N-1 quantile boundaries?' with [Replace] and [Cancel] buttons"
    - "On confirm (or empty breaks) the form calls quantileFn({ schema, table, column, n }) and replaces breaks with N rows (N-1 boundaries + 1 open-ended row with empty value + label '≥ {prev}')"
    - "Color preservation by index on Auto-suggest: row[i] retains existing color if i < oldBreaks.length; new rows get PALETTE_COLORS[i % len]"
    - "Auto-suggest failure surfaces inline red text 'Auto-suggest failed: <message>' AND a toast with kind='error'"
    - "Rapid re-click of Auto-suggest aborts the previous in-flight quantileFn via AbortController; only the latest response is consumed"
    - "MapChartRenderer fingerprint includes layer.cb_config in JSON.stringify({p,c,t}) — regression spec asserts a cb_config change produces a different fingerprint than the same params with a different cb_config"
  artifacts:
    - path: "kinetica_bi/src/components/charts/CbConfigForm.tsx"
      provides: "Categorical <other> toggle + probeCardinality wiring + Auto-suggest button + N slider + modal-confirm + AbortController + error UX"
      min_lines: 450
    - path: "kinetica_bi/src/components/charts/CbConfigForm.spec.tsx"
      provides: "Spec coverage for categorical UX + Auto-suggest happy/abort/error paths"
      min_lines: 350
    - path: "kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx"
      provides: "Regression spec asserting lastEmittedParamsRef fingerprint includes cb_config (CB-V17-09)"
  key_links:
    - from: "CbConfigForm categorical mode probe"
      to: "lib/cardinalityProbe.ts probeCardinality(tableRef, column, signal)"
      via: "tableRef prop passed from KineticaWmsLayerForm"
      pattern: "probeCardinality"
    - from: "CbConfigForm Auto-suggest button"
      to: "api/client.ts quantileFn({ schema, table, column, n }, signal)"
      via: "schema + tableName props passed from KineticaWmsLayerForm"
      pattern: "quantileFn"
    - from: "MapChartRenderer fingerprint computation"
      to: "layer.cb_config raw JSON"
      via: "JSON.stringify({ p: wmsParams, c: layer.cb_config, t: layer.track_config })"
      pattern: "cb_config"
---

<objective>
Wave 3 — final Phase 39 plan. Two large UX surfaces land in CbConfigForm: (1) the categorical breaks UX (probeCardinality + `<other>` bucket toggle + value validation), and (2) the Auto-suggest button with N slider, modal-confirm overwrite dialog, AbortController error handling, and toast surfaces. Plus a regression spec for the Phase 38 fingerprint already covering cb_config (CB-V17-09 zero-work confirmation).

Closes: CB-V17-03 (numeric N-row builder — 256 hard-cap inherited from cardinality probe + completes Plan 39-02 numeric path), CB-V17-04 (categorical breaks UX + `<other>` toggle + distinct-value probe), CB-V17-06 (Auto-suggest button + modal-confirm), CB-V17-09 (fingerprint regression test).

Purpose: After this plan, the operator can configure CB rendering end-to-end — both numeric (with Auto-suggest) and categorical (with `<other>` bucket + cardinality warnings) — and every CB form edit triggers a tile re-render via the Phase 38-locked fingerprint.

Output: Expanded CbConfigForm.tsx (~500-600 lines) replacing the categorical placeholder from 39-02 with full categorical UX + Auto-suggest UX; extended CbConfigForm.spec.tsx covering the new behaviors; new regression assertion in MapChartRenderer.spec.tsx for the fingerprint.
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
@.planning/phases/39-classbreak-form-ui-auto-suggest/39-02-cb-form-core-rows-and-advanced-PLAN.md
@.planning/phases/38-schema-wms-engine-foundation/38-CONTEXT.md

<interfaces>
<!-- Key types and contracts the executor needs. -->

From kinetica_bi/src/api/client.ts:1063-1088 (Phase 38 shipped):
```typescript
export type QuantileArgs = {
  schema: string;
  table: string;
  column: string;
  n: number;
};
export type QuantileResponse = {
  breaks: number[]; // length === n - 1
};
export const quantileFn: (args: QuantileArgs, signal?: AbortSignal) => Promise<QuantileResponse>;
```

From kinetica_bi/src/lib/cardinalityProbe.ts:
```typescript
export async function probeCardinality(
  tableRef: string,
  column: string,
  signal?: AbortSignal
): Promise<number>;
// Session-cached per `${tableRef}:${column}`; throws on parse failure
```

From kinetica_bi/src/store/toast.ts:
```typescript
export type ToastKind = "permission" | "info" | "error"; // NO "warning"
export const useToastStore: ZustandStore;
// Call: useToastStore.getState().showToast(message, kind)
```

From kinetica_bi/src/lib/cbConfig.ts (Plan 39-01 + Phase 38 — types):
```typescript
export type CbBreak = { value: string | number; color: string; label?: string; pointSize?: number; pointShape?: string; shapeLineWidth?: number; shapeLineColor?: string; shapeFillColor?: string };
export type CbConfig = { attr: string; valsType: "numeric" | "categorical"; breaks: CbBreak[]; includeOtherBucket?: boolean };
export const PALETTE_COLORS: readonly string[]; // length 8
export function createDefaultBreak(valsType, index): CbBreak;
```

From kinetica_bi/src/components/charts/MapChartRenderer.tsx (Phase 38 — READ-ONLY for Phase 39):
- Line 1118: `const fingerprint = JSON.stringify({ p: wmsParams, c: layer.cb_config, t: layer.track_config });`
- Line 1208: same pattern in Effect 3
- CB-V17-09 is already shipped — Plan 39-03 only adds a regression spec to lock it.

From the inline confirm-overwrite pattern used in LayersModal.tsx (`confirmDeleteId` state + inline conditional rendering — NOT a portal modal):
```typescript
const [confirmAutoSuggest, setConfirmAutoSuggest] = useState<boolean>(false);

// In JSX, render directly inside the CbConfigForm container (not via portal):
{confirmAutoSuggest && (
  <div className="cb-autosuggest-confirm" role="dialog" aria-modal="true" aria-labelledby="cb-confirm-label">
    <p id="cb-confirm-label">Replace {oldLen} break rows with {n - 1} quantile boundaries?</p>
    <button type="button" onClick={() => { setConfirmAutoSuggest(false); runAutoSuggest(); }}>
      Replace
    </button>
    <button type="button" onClick={() => setConfirmAutoSuggest(false)}>
      Cancel
    </button>
  </div>
)}
```
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Add categorical UX — &lt;other&gt; toggle + probeCardinality + value validation</name>
  <files>kinetica_bi/src/components/charts/CbConfigForm.tsx, kinetica_bi/src/components/charts/CbConfigForm.spec.tsx</files>
  <read_first>
    - kinetica_bi/src/components/charts/CbConfigForm.tsx (Plan 39-02 output — full implementation up through advanced expand panel + isValid signaling)
    - kinetica_bi/src/components/charts/CbConfigForm.spec.tsx (Plan 39-02 spec file — existing tests stay; categorical-mode tests added)
    - kinetica_bi/src/lib/cardinalityProbe.ts (probeCardinality signature)
    - kinetica_bi/src/store/toast.ts (useToastStore.getState().showToast(msg, kind))
  </read_first>
  <behavior>
    - Test: in categorical mode (valsType='categorical'), [✓] Include <other> bucket checkbox is rendered above the rows, default checked when first switching to categorical
    - Test: toggling <other> checkbox ON appends a break with value === "<other>" at end of breaks[]; the <other> row's value field is rendered as a read-only <span class="cb-other-chip">&lt;other&gt;</span> NOT an input
    - Test: toggling <other> checkbox OFF removes any break where value === "<other>" AND renders inline warning "NULL values will not appear in the map." below the checkbox
    - Test: toggling <other> ON when an <other> row already exists does NOT duplicate the row (idempotent)
    - Test: in categorical mode, selecting an attr column fires probeCardinality(tableRef, column, signal); shows "Counting distinct values…" hint while in-flight
    - Test: when probeCardinality returns 50 (no warn) no toast is fired
    - Test: when probeCardinality returns 150 (>100, <=256), useToastStore.getState().showToast called with "permission" kind containing "That's a lot of breakpoints"
    - Test: when probeCardinality returns 300 (>256), useToastStore.getState().showToast called with "error" kind containing "Kinetica classbreak supports up to 256"; [+ Add break] button is disabled
    - Test: probeCardinality NOT called when valsType==='numeric' (rapid re-selection of numeric columns never invokes the helper)
    - Test: probeCardinality re-fire on column change aborts the previous controller (AbortError silently consumed)
    - Test: categorical break with value === "" surfaces inline red text "Value cannot be empty" under that row's value input
    - Test: categorical breaks with duplicate non-empty values surface inline red text "Duplicate value" under each duplicate row (excluding the <other> bucket which is whitelisted)
    - Test: isValid(false) when any categorical break has an empty value (excluding the <other> row); isValid(true) when all values present + breaks.length >= 2
    - Test: column-change from numeric (with N >= 2 rows) to categorical clears all break values to "" AND toggles includeOtherBucket=true (auto-default ON for newly-categorical) AND appends an <other> row
  </behavior>
  <action>
    Edit `kinetica_bi/src/components/charts/CbConfigForm.tsx` to add the categorical UX. The placeholder div `<div className="cb-categorical-placeholder">` from Plan 39-02 is REPLACED with the full categorical sub-section.

    PART A — Add categorical state + probe wiring to component body (after the existing state declarations):

    1. Cardinality state machine (copied verbatim from the deleted ClassbreakParamsGroup pattern):
    ```typescript
    type CardinalityState =
      | null
      | { state: "loading" }
      | { state: "ok"; count: number }
      | { state: "error" };

    const [cardinality, setCardinality] = useState<CardinalityState>(null);
    const probeAbortRef = useRef<AbortController | null>(null);
    const warnFiredRef = useRef<boolean>(false);
    ```

    Make sure `useRef` is imported at the top (Plan 39-02 already imports useState/useCallback/useEffect/useMemo).

    2. Imports — add at top of file:
    ```typescript
    import { useRef } from "react";
    import { probeCardinality } from "../../lib/cardinalityProbe";
    import { useToastStore } from "../../store/toast";
    ```
    (Consolidate the React import with existing useState/useEffect/etc.)

    3. Probe runner:
    ```typescript
    const runProbe = useCallback(
      async (col: string, ref: string) => {
        if (probeAbortRef.current) probeAbortRef.current.abort();
        const controller = new AbortController();
        probeAbortRef.current = controller;
        warnFiredRef.current = false;
        setCardinality({ state: "loading" });
        try {
          const count = await probeCardinality(ref || "unknown", col, controller.signal);
          setCardinality({ state: "ok", count });
          if (count > 256) {
            useToastStore.getState().showToast(
              "Too many distinct values — Kinetica classbreak supports up to 256.",
              "error",
            );
          } else if (count > 100 && !warnFiredRef.current) {
            warnFiredRef.current = true;
            useToastStore.getState().showToast(
              "That's a lot of breakpoints — consider a heatmap or numerical range instead.",
              "permission",
            );
          }
        } catch (err: unknown) {
          if ((err as { name?: string })?.name === "AbortError") return;
          setCardinality({ state: "error" });
        }
      },
      [],
    );
    ```

    4. Update `onPickCbColumn` from Plan 39-02 — fire probe ONLY in categorical mode:
    ```typescript
    const onPickCbColumn = (newAttr: string) => {
      const newCol = columns.find((c) => c.name === newAttr);
      const detectedType = detectValsTypeFromColumn(newCol);
      const newValsType = cbConfig.valsType === "categorical" && advancedForceCategorical
        ? "categorical"
        : detectedType;
      const typeChanged = cbConfig.valsType !== newValsType;
      let nextBreaks: CbBreak[] = cbConfig.breaks.map((b) => ({
        ...b,
        value: typeChanged
          ? (newValsType === "numeric" ? 0 : "")
          : b.value,
      }));
      // Categorical column-change rule: auto-toggle includeOtherBucket=true + append <other> row
      let nextIncludeOther = cbConfig.includeOtherBucket;
      if (typeChanged && newValsType === "categorical") {
        nextIncludeOther = true;
        const hasOther = nextBreaks.some((b) => b.value === "<other>");
        if (!hasOther) {
          nextBreaks = [...nextBreaks, createDefaultBreak("categorical", nextBreaks.length)];
          nextBreaks[nextBreaks.length - 1] = { ...nextBreaks[nextBreaks.length - 1], value: "<other>" };
        }
      }
      patchCb({
        ...cbConfig,
        attr: newAttr,
        valsType: newValsType,
        breaks: nextBreaks,
        includeOtherBucket: nextIncludeOther,
      });
      setCardinality(null);
      warnFiredRef.current = false;
      if (newAttr && newValsType === "categorical") {
        runProbe(newAttr, tableRef ?? "");
      }
    };
    ```

    5. `<other>` toggle handler:
    ```typescript
    const onToggleOtherBucket = (checked: boolean) => {
      const next: CbConfig = { ...cbConfig, includeOtherBucket: checked };
      if (checked) {
        const hasOther = cbConfig.breaks.some((b) => b.value === "<other>");
        if (!hasOther) {
          const otherRow: CbBreak = {
            ...createDefaultBreak("categorical", cbConfig.breaks.length),
            value: "<other>",
          };
          next.breaks = [...cbConfig.breaks, otherRow];
        }
      } else {
        next.breaks = cbConfig.breaks.filter((b) => b.value !== "<other>");
      }
      patchCb(next);
    };
    ```

    PART B — Update isValid signaling to handle categorical empty-value + duplicate rules:

    Replace the Plan 39-02 isValid useEffect with:
    ```typescript
    useEffect(() => {
      if (!isValid) return;
      if (cbConfig.breaks.length < 2) {
        isValid(false);
        return;
      }
      const allValuesPresent = cbConfig.breaks.every((b) => {
        // <other> sentinel is always valid in categorical mode
        if (b.value === "<other>") return true;
        if (typeof b.value === "number") return Number.isFinite(b.value);
        return typeof b.value === "string" && b.value.length > 0;
      });
      if (!allValuesPresent) {
        isValid(false);
        return;
      }
      // Categorical-only: no duplicate non-empty values (excluding <other>)
      if (cbConfig.valsType === "categorical") {
        const seen = new Set<string>();
        for (const b of cbConfig.breaks) {
          if (b.value === "<other>") continue;
          const v = String(b.value);
          if (seen.has(v)) {
            isValid(false);
            return;
          }
          seen.add(v);
        }
      }
      isValid(true);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [cbConfig.breaks.length, JSON.stringify(cbConfig.breaks.map((b) => b.value)), cbConfig.valsType]);
    ```

    PART C — Derived state for inline error display (compute once per render, no useState):
    ```typescript
    // Map of row index → error message (for inline red text)
    const breakErrors: Record<number, string> = {};
    if (cbConfig.valsType === "categorical") {
      const seenValues = new Map<string, number>(); // value → first row index
      cbConfig.breaks.forEach((b, i) => {
        if (b.value === "<other>") return;
        if (typeof b.value !== "string" || b.value.length === 0) {
          breakErrors[i] = "Value cannot be empty";
          return;
        }
        const v = String(b.value);
        if (seenValues.has(v)) {
          breakErrors[i] = "Duplicate value";
          breakErrors[seenValues.get(v)!] = "Duplicate value";
        } else {
          seenValues.set(v, i);
        }
      });
    }
    ```

    PART D — Replace the categorical placeholder div from Plan 39-02 with the full categorical sub-section. Insert this block BEFORE the `<div className="config-classbreak-rows">` row container:

    ```typescript
    {cbConfig.valsType === "categorical" && (
      <div className="cb-categorical-section">
        {/* Cardinality probe state hints */}
        {cardinality?.state === "loading" && (
          <div className="config-hint">Counting distinct values…</div>
        )}
        {cardinality?.state === "ok" && cardinality.count > 256 && (
          <div className="config-hint config-cardinality-warn" style={{ color: "#ef4444" }}>
            <strong>Too many distinct values</strong>
            <div>Kinetica&apos;s classbreak mode supports up to 256 categories.</div>
          </div>
        )}
        {cardinality?.state === "ok" && cardinality.count > 100 && cardinality.count <= 256 && (
          <div className="config-hint config-cardinality-warn" style={{ color: "var(--accent)" }}>
            <strong>That&apos;s a lot of breakpoints</strong>
          </div>
        )}
        {cardinality?.state === "error" && (
          <div className="config-hint" style={{ color: "#ef4444" }}>
            Could not count distinct values. Try again.
          </div>
        )}

        {/* <other> bucket toggle */}
        <label className="cb-other-toggle">
          <input
            type="checkbox"
            aria-label="Include <other> bucket"
            checked={cbConfig.includeOtherBucket ?? false}
            onChange={(e) => onToggleOtherBucket(e.target.checked)}
          />
          Include &lt;other&gt; bucket
        </label>
        {!cbConfig.includeOtherBucket && (
          <div className="config-hint" style={{ color: "var(--muted)" }}>
            NULL values will not appear in the map.
          </div>
        )}
      </div>
    )}
    ```

    PART E — Modify the per-row rendering inside the rows container to handle the `<other>` chip + inline error text:

    Inside the `cbConfig.breaks.map((b, i) => (...))` body, REPLACE the existing value input with:
    ```typescript
    {b.value === "<other>" ? (
      <span className="cb-other-chip" aria-label={`Value for break ${i + 1}`} data-testid={`cb-other-chip-${i}`}>
        &lt;other&gt;
      </span>
    ) : cbConfig.valsType === "numeric" ? (
      <input
        type="number"
        aria-label={`Value for break ${i + 1}`}
        placeholder="Upper boundary"
        value={typeof b.value === "number" ? b.value : ""}
        onChange={(e) => updateBreak(i, { value: e.target.value === "" ? "" : Number(e.target.value) })}
      />
    ) : (
      <input
        type="text"
        aria-label={`Value for break ${i + 1}`}
        value={String(b.value ?? "")}
        onChange={(e) => updateBreak(i, { value: e.target.value })}
      />
    )}
    ```

    AND directly below the row's value/color/label/remove cluster, ADD the inline error text:
    ```typescript
    {breakErrors[i] && (
      <div className="cb-row-error" style={{ color: "#ef4444", fontSize: "0.85em" }} data-testid={`cb-row-error-${i}`}>
        {breakErrors[i]}
      </div>
    )}
    ```

    Also, disable the remove button on the `<other>` row (chip is fixed; remove still works but the toggle is the canonical control):
    ```typescript
    <button
      type="button"
      className="ghost-sm ghost-danger"
      aria-label={`Remove break ${i + 1}`}
      disabled={b.value === "<other>"}
      onClick={() => removeBreak(i)}
    >
      <FontAwesomeIcon icon={faXmark} />
    </button>
    ```

    PART F — Update [+ Add break] to honor the 256 hard-cap:
    ```typescript
    const hardCap = cardinality?.state === "ok" && cardinality.count > 256;
    // ... existing button ...
    <button
      type="button"
      className="config-classbreak-add ghost-sm"
      aria-label="+ Add break"
      disabled={cbConfig.attr === "" || hardCap}
      onClick={addBreak}
    >
      + Add break
    </button>
    ```

    PART G — Extend `kinetica_bi/src/components/charts/CbConfigForm.spec.tsx` with the test cases from <behavior>. Required mocks (add to top of spec file alongside Plan 39-02 mocks):
    ```typescript
    vi.mock("../../store/toast", () => ({
      useToastStore: { getState: vi.fn(() => ({ showToast: vi.fn() })) },
    }));
    vi.mock("../../lib/cardinalityProbe", () => ({
      probeCardinality: vi.fn(),
    }));
    ```

    Each test case from <behavior> becomes a `it(...)` block. Use `vi.mocked(probeCardinality).mockResolvedValue(N)` to control return values. Use `vi.mocked(useToastStore.getState).mockReturnValue({ showToast: spy })` and assert `spy` was called with the right args.

    For column-change tests, render with one set of `columns` + `config`, then re-render with the same columns + a different `config.cb_config` JSON to simulate the operator picking a different column.

    For probe-abort test, fire `onPickCbColumn` twice rapidly with different columns; assert the first call's controller.signal.aborted === true after the second call.
  </action>
  <verify>
    <automated>cd kinetica_bi && npx vitest run src/components/charts/CbConfigForm.spec.tsx --reporter=verbose</automated>
  </verify>
  <acceptance_criteria>
    - `grep -c "probeCardinality" kinetica_bi/src/components/charts/CbConfigForm.tsx` returns at least 1
    - `grep -c "useToastStore" kinetica_bi/src/components/charts/CbConfigForm.tsx` returns at least 1
    - `grep -c "Include <other> bucket\|Include &lt;other&gt; bucket" kinetica_bi/src/components/charts/CbConfigForm.tsx` returns at least 1
    - `grep -c "NULL values will not appear in the map" kinetica_bi/src/components/charts/CbConfigForm.tsx` returns at least 1
    - `grep -c "cb-other-chip" kinetica_bi/src/components/charts/CbConfigForm.tsx` returns at least 1
    - `grep -c "Value cannot be empty\|Duplicate value" kinetica_bi/src/components/charts/CbConfigForm.tsx` returns at least 2
    - `grep -c 'count > 256\|count > 100' kinetica_bi/src/components/charts/CbConfigForm.tsx` returns at least 2
    - `grep -c 'permission' kinetica_bi/src/components/charts/CbConfigForm.tsx` returns at least 1 (toast kind for >100 warn)
    - `grep -c "AbortController" kinetica_bi/src/components/charts/CbConfigForm.tsx` returns at least 1
    - `cd kinetica_bi && npx vitest run src/components/charts/CbConfigForm.spec.tsx` exits 0
    - `cd kinetica_bi && npx tsc -p tsconfig.app.json --noEmit` exits 0
    - cbColumn/classbreaks legacy refs still absent: `grep -c "cbColumn\|classbreaks" kinetica_bi/src/components/charts/CbConfigForm.tsx` returns 0
  </acceptance_criteria>
  <done>
    CbConfigForm.tsx categorical UX complete: `<other>` toggle (auto-maintains row, idempotent), probeCardinality wiring (warn>100 / cap>256), value validation (empty + duplicate inline red text), 256 hard-cap disables [+ Add break]. isValid signaling extended to enforce categorical rules. probeCardinality NEVER fires in numeric mode. AbortController per probe. Spec coverage for all behaviors. Phase 39-02 tests still pass.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Add Auto-suggest button + N slider + modal-confirm + AbortController error UX</name>
  <files>kinetica_bi/src/components/charts/CbConfigForm.tsx, kinetica_bi/src/components/charts/CbConfigForm.spec.tsx</files>
  <read_first>
    - kinetica_bi/src/components/charts/CbConfigForm.tsx (Task 1 of this plan — categorical UX shipped; this task layers on the Auto-suggest UI)
    - kinetica_bi/src/components/charts/CbConfigForm.spec.tsx (Task 1 + 39-02 tests already in place)
    - kinetica_bi/src/api/client.ts lines 1063-1088 (quantileFn + QuantileArgs + QuantileResponse signatures)
    - kinetica_bi/src/components/LayersModal.tsx (search for `confirmDeleteId` — inline conditional confirm pattern, NOT a portal modal)
  </read_first>
  <behavior>
    - Test: Auto-suggest button + N slider are visible only when valsType === 'numeric' AND attr is selected; absent in categorical mode
    - Test: Auto-suggest button is disabled when attr === '' OR when an in-flight request exists
    - Test: N slider default value is 5, min=2, max=16
    - Test: changing N slider updates the value displayed alongside (e.g. "N: 7")
    - Test: clicking Auto-suggest with breaks.length === 0 calls quantileFn({ schema, table, column: attr, n }) directly (no modal) and replaces breaks with N rows on success
    - Test: clicking Auto-suggest with breaks.length > 0 shows the inline confirm-overwrite dialog with role="dialog" aria-modal="true" + [Replace] + [Cancel] buttons + visible text "Replace X break rows with N quantile boundaries?" where X is current count and N is the slider value
    - Test: clicking [Replace] in the confirm dialog calls quantileFn and replaces breaks
    - Test: clicking [Cancel] in the confirm dialog closes the dialog WITHOUT calling quantileFn
    - Test: on success, breaks[].length === N (server returns n-1 boundaries; form appends 1 open-ended row with empty value)
    - Test: on success, breaks[0..N-2].value === server.breaks[i] (boundaries in order)
    - Test: on success, breaks[N-1] is the open-ended row: value === '' AND label === `≥ ${server.breaks[N-2]}` (the last boundary)
    - Test: color preservation by index — if cbConfig.breaks had [{color:"AAA"}, {color:"BBB"}, {color:"CCC"}] and Auto-suggest returns 4 boundaries → 5 rows, then breaks[0..2].color === ["AAA","BBB","CCC"] and breaks[3..4].color comes from PALETTE_COLORS at index 3 and 4
    - Test: label preservation by index — operator's old labels stick to rows[0..oldLen-1]; new rows get label='' (except the last open-ended row which gets '≥ <prev>')
    - Test: advanced field preservation by index — pointSize/pointShape/shapeLineWidth/shapeLineColor/shapeFillColor preserved from old rows at matching index; new rows get defaults
    - Test: on failure (quantileFn rejects with Error("Bad request")), inline red text "Auto-suggest failed: Bad request" appears below the button AND useToastStore.showToast called with kind="error" and the same message
    - Test: rapid re-click of Auto-suggest aborts the previous in-flight request (controller.signal.aborted === true on the first call after second click)
    - Test: AbortError from a cancelled previous request is silently consumed (no toast, no inline error)
    - Test: form NEVER writes config.cbColumn or config.classbreaks on any Auto-suggest path
  </behavior>
  <action>
    Continue editing `kinetica_bi/src/components/charts/CbConfigForm.tsx` to add the Auto-suggest UX.

    PART A — Add imports (top of file):
    ```typescript
    import { quantileFn } from "../../api/client";
    ```

    PART B — Add Auto-suggest state to component body (after categorical state from Task 1):
    ```typescript
    const [nValue, setNValue] = useState<number>(5);
    const [autoSuggestInFlight, setAutoSuggestInFlight] = useState<boolean>(false);
    const [autoSuggestError, setAutoSuggestError] = useState<string | null>(null);
    const [showConfirm, setShowConfirm] = useState<boolean>(false);
    const autoSuggestAbortRef = useRef<AbortController | null>(null);
    ```

    PART C — Add `runAutoSuggest` helper:
    ```typescript
    const runAutoSuggest = useCallback(async () => {
      if (!schema || !tableName || !cbConfig.attr) return;
      // Abort any in-flight request
      if (autoSuggestAbortRef.current) {
        autoSuggestAbortRef.current.abort();
      }
      const controller = new AbortController();
      autoSuggestAbortRef.current = controller;
      setAutoSuggestInFlight(true);
      setAutoSuggestError(null);
      try {
        const { breaks: boundaries } = await quantileFn(
          { schema, table: tableName, column: cbConfig.attr, n: nValue },
          controller.signal,
        );
        // boundaries.length === nValue - 1
        // Form materializes N rows: rows[0..N-2] take boundaries[i], row[N-1] is open-ended
        const oldBreaks = cbConfig.breaks;
        const newBreaks: CbBreak[] = boundaries.map((boundary, idx) => {
          const old = idx < oldBreaks.length ? oldBreaks[idx] : null;
          return {
            value: boundary,
            color: old?.color ?? PALETTE_COLORS[idx % PALETTE_COLORS.length],
            label: old?.label ?? "",
            pointSize: old?.pointSize ?? 5,
            pointShape: old?.pointShape ?? "circle",
            shapeLineWidth: old?.shapeLineWidth ?? 1,
            shapeLineColor: old?.shapeLineColor ?? "FF000000",
            shapeFillColor: old?.shapeFillColor ?? "FFFFFFFF",
          };
        });
        // Append open-ended last row (≥ last boundary)
        const lastBoundary = boundaries[boundaries.length - 1];
        const lastIdx = boundaries.length;
        const oldLast = lastIdx < oldBreaks.length ? oldBreaks[lastIdx] : null;
        newBreaks.push({
          value: "",
          color: oldLast?.color ?? PALETTE_COLORS[lastIdx % PALETTE_COLORS.length],
          label: `≥ ${lastBoundary}`,
          pointSize: oldLast?.pointSize ?? 5,
          pointShape: oldLast?.pointShape ?? "circle",
          shapeLineWidth: oldLast?.shapeLineWidth ?? 1,
          shapeLineColor: oldLast?.shapeLineColor ?? "FF000000",
          shapeFillColor: oldLast?.shapeFillColor ?? "FFFFFFFF",
        });
        patchCb({ ...cbConfig, breaks: newBreaks });
      } catch (err: unknown) {
        if (controller.signal.aborted) return;
        if ((err as { name?: string })?.name === "AbortError") return;
        const msg = (err as { message?: string })?.message ?? "Unknown error";
        setAutoSuggestError(`Auto-suggest failed: ${msg}`);
        useToastStore.getState().showToast(`Auto-suggest failed: ${msg}`, "error");
      } finally {
        if (autoSuggestAbortRef.current === controller) {
          setAutoSuggestInFlight(false);
          autoSuggestAbortRef.current = null;
        }
      }
    }, [schema, tableName, cbConfig, nValue, patchCb]);
    ```

    PART D — Click handler:
    ```typescript
    const onAutoSuggestClick = () => {
      if (cbConfig.breaks.length > 0) {
        setShowConfirm(true);
      } else {
        runAutoSuggest();
      }
    };
    ```

    PART E — JSX render — insert the Auto-suggest panel + confirm dialog inside the numeric branch. Add a new conditional block BEFORE the row container:

    ```typescript
    {cbConfig.valsType === "numeric" && cbConfig.attr !== "" && (
      <div className="cb-autosuggest-panel">
        <label className="cb-autosuggest-n-label">
          N: <span data-testid="cb-n-value">{nValue}</span>
          <input
            type="range"
            aria-label="N (number of break rows)"
            min={2}
            max={16}
            step={1}
            value={nValue}
            onChange={(e) => setNValue(parseInt(e.target.value, 10))}
          />
        </label>
        <button
          type="button"
          className="cb-autosuggest-button"
          aria-label="Auto-suggest breaks"
          disabled={cbConfig.attr === "" || autoSuggestInFlight}
          title={cbConfig.attr === "" ? "Select a numeric column for auto-suggest" : undefined}
          onClick={onAutoSuggestClick}
        >
          {autoSuggestInFlight ? "Running…" : "Auto-suggest breaks"}
        </button>
        {autoSuggestError && (
          <div
            className="cb-autosuggest-error"
            data-testid="cb-autosuggest-error"
            style={{ color: "#ef4444", fontSize: "0.85em" }}
          >
            {autoSuggestError}
          </div>
        )}
        {showConfirm && (
          <div
            className="cb-autosuggest-confirm"
            role="dialog"
            aria-modal="true"
            aria-labelledby="cb-confirm-label"
            data-testid="cb-autosuggest-confirm"
          >
            <p id="cb-confirm-label">
              Replace {cbConfig.breaks.length} break rows with {nValue} quantile boundaries?
            </p>
            <button
              type="button"
              aria-label="Replace breaks"
              onClick={() => {
                setShowConfirm(false);
                runAutoSuggest();
              }}
            >
              Replace
            </button>
            <button
              type="button"
              aria-label="Cancel auto-suggest"
              onClick={() => setShowConfirm(false)}
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    )}
    ```

    PART F — Extend `kinetica_bi/src/components/charts/CbConfigForm.spec.tsx` with test cases from <behavior>. Mocks needed (add alongside Task 1 mocks):
    ```typescript
    vi.mock("../../api/client", () => ({
      quantileFn: vi.fn(),
    }));
    ```

    Test patterns:
    - `vi.mocked(quantileFn).mockResolvedValueOnce({ breaks: [10, 20, 30, 40] })` for N=5 happy path; assert onChange called with breaks.length === 5
    - For confirm dialog: render with attr set + breaks.length === 2, click "Auto-suggest breaks" button, assert `getByRole("dialog")` visible + `getByText(/Replace 2 break rows with 5 quantile boundaries/)` visible
    - For [Cancel]: click cancel button, assert dialog closes AND quantileFn NOT called
    - For [Replace]: click replace button, assert dialog closes AND quantileFn called with `{ schema, table, column, n: 5 }`
    - For error path: `vi.mocked(quantileFn).mockRejectedValueOnce(new Error("Bad request"))`, click button (no existing breaks), await, assert `getByTestId("cb-autosuggest-error")` contains "Auto-suggest failed: Bad request" AND toast spy called with kind="error" and the same message
    - For AbortError silent path: `vi.mocked(quantileFn).mockRejectedValueOnce(Object.assign(new Error("aborted"), { name: "AbortError" }))`, await, assert NO error text appears AND NO toast call
    - For rapid re-click: trigger handler twice, assert first AbortController was aborted (use a manually-captured controller via the mock implementation if needed)
    - Spy on onChange across all Auto-suggest paths and assert no calls have `cbColumn` or `classbreaks` keys
  </action>
  <verify>
    <automated>cd kinetica_bi && npx vitest run src/components/charts/CbConfigForm.spec.tsx --reporter=verbose</automated>
  </verify>
  <acceptance_criteria>
    - `grep -c "quantileFn" kinetica_bi/src/components/charts/CbConfigForm.tsx` returns at least 1
    - `grep -c "Auto-suggest breaks" kinetica_bi/src/components/charts/CbConfigForm.tsx` returns at least 1
    - `grep -c 'min={2}' kinetica_bi/src/components/charts/CbConfigForm.tsx` returns at least 1
    - `grep -c 'max={16}' kinetica_bi/src/components/charts/CbConfigForm.tsx` returns at least 1
    - `grep -c 'role="dialog"' kinetica_bi/src/components/charts/CbConfigForm.tsx` returns at least 1
    - `grep -c "Auto-suggest failed:" kinetica_bi/src/components/charts/CbConfigForm.tsx` returns at least 1
    - `grep -c "autoSuggestAbortRef" kinetica_bi/src/components/charts/CbConfigForm.tsx` returns at least 1
    - `grep -c 'signal: controller.signal\|controller.signal' kinetica_bi/src/components/charts/CbConfigForm.tsx` returns at least 1
    - kinetica_bi/src/components/charts/CbConfigForm.tsx total line count >= 450
    - kinetica_bi/src/components/charts/CbConfigForm.spec.tsx total line count >= 350
    - cbColumn/classbreaks legacy refs still absent: `grep -c "cbColumn\|classbreaks" kinetica_bi/src/components/charts/CbConfigForm.tsx` returns 0
    - `cd kinetica_bi && npx vitest run src/components/charts/CbConfigForm.spec.tsx` exits 0
    - `cd kinetica_bi && npx tsc -p tsconfig.app.json --noEmit` exits 0
  </acceptance_criteria>
  <done>
    Auto-suggest button + N slider (2-16, default 5) + inline modal-confirm dialog + AbortController + quantileFn integration shipped. Error UX surfaces inline red text AND a toast. Color/label/advanced preservation by index works. Open-ended last row carries `≥ {prev}` label. Rapid re-click aborts in-flight request. AbortError silently consumed. NEVER touches legacy config.cbColumn/classbreaks. Spec coverage for happy path + confirm + cancel + error + abort + preservation rules.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Regression spec — MapChartRenderer fingerprint covers cb_config (CB-V17-09)</name>
  <files>kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx</files>
  <read_first>
    - kinetica_bi/src/components/charts/MapChartRenderer.tsx (lines ~993-1119, ~1194-1210 — fingerprint construction `JSON.stringify({ p: wmsParams, c: layer.cb_config, t: layer.track_config })`)
    - kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx (existing test structure + mocking patterns)
  </read_first>
  <behavior>
    - Test: when a layer's `cb_config` JSON changes (e.g. operator edits a break color via CbConfigForm and the patched cb_config string lands on the layer prop), MapChartRenderer treats the new fingerprint as distinct from the old one and re-emits WMS params. Concretely: a layer rendered with `cb_config: '{"attr":"fare","valsType":"numeric","breaks":[{"value":10,"color":"FFAAAAAA"}]}'` produces a different `lastEmittedParamsRef` fingerprint than the same layer with `cb_config: '{"attr":"fare","valsType":"numeric","breaks":[{"value":10,"color":"FFBBBBBB"}]}'`.
    - Test (sanity): when only `wmsParams` change (no cb_config edit), fingerprint also differs — this is the existing Phase 38 lock; this test pins it down.
    - Test (sanity): when neither wmsParams nor cb_config nor track_config change, fingerprint is byte-identical and no re-emit fires.
  </behavior>
  <action>
    Add a focused regression test suite to `kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx`. The intent is NOT to re-test the full MapChartRenderer wms emission pipeline; it's to LOCK the invariant that `lastEmittedParamsRef` fingerprint includes `cb_config` so that Phase 39 form edits cannot be silently ignored.

    Approach: extract the fingerprint construction into a focused test that imports the same building blocks (JSON.stringify of `{ p, c, t }`) and asserts the structural property. Since MapChartRenderer.tsx already constructs the fingerprint inline at lines 1118 + 1208, we test the behavior end-to-end by rendering MapChartRenderer twice with different `cb_config` values on the layer DTO and asserting that `imageWmsSource.updateParams` is called twice (once per render) — proving the fingerprint detected the change.

    Concrete steps:

    1. Locate the existing describe block in `MapChartRenderer.spec.tsx` that mocks OL ImageWMS source. Add a new describe block at the end of the file:
    ```typescript
    describe("Phase 39 CB-V17-09 — fingerprint covers layer.cb_config", () => {
      it("re-emits WMS params when layer.cb_config changes (color edit)", async () => {
        // Setup: render MapChartRenderer with a layer that has cb_config A.
        // Spy on imageWmsSource.updateParams.
        // Re-render the same component with the SAME widget/widgetId/visibleLayerIds/etc
        // EXCEPT layer.cb_config is changed to a JSON string with a different color value.
        // Assert: updateParams was called at least twice (or however the existing Effect-2/Effect-3
        // test pattern in this file already asserts emission) — proving the fingerprint detected
        // the cb_config change.
        // Use the existing mock harness in this file (do NOT introduce a new OL mock pattern).
      });

      it("does NOT re-emit when nothing changes (fingerprint stability)", async () => {
        // Setup: render twice with byte-identical layer.cb_config.
        // Assert: updateParams called only once (or per the existing pattern's expected count).
      });
    });
    ```

    If the existing spec already has helper render functions + mocks for `imageWmsSource.updateParams`, REUSE them directly. Do NOT introduce a brand-new mock pattern — match what's already there.

    If the existing spec does NOT have helpers that expose updateParams call counts directly (i.e. the file is mock-shallow), then ADD a focused minimal test that imports the fingerprint computation primitive — call `JSON.stringify({ p: { STYLES: "raster" }, c: '{"attr":"fare","valsType":"numeric","breaks":[{"value":10,"color":"FFAAAAAA"}]}', t: null })` and assert it does NOT equal the same expression with the color flipped to "FFBBBBBB". This is a structural assertion that the fingerprint construction includes the cb_config string — it locks CB-V17-09 without requiring a full MapChartRenderer mount.

    Final code (defensive lightweight version — works regardless of how complex MapChartRenderer.spec.tsx is):

    ```typescript
    describe("Phase 39 CB-V17-09 — fingerprint covers layer.cb_config", () => {
      // The fingerprint construction at MapChartRenderer.tsx:1118 + 1208 is:
      //   JSON.stringify({ p: wmsParams, c: layer.cb_config, t: layer.track_config })
      // This regression test locks that cb_config participates in the fingerprint so
      // Phase 39 CbConfigForm edits cannot silently fail to trigger a tile re-render.

      const buildFingerprint = (
        wmsParams: Record<string, string>,
        cb_config: string | null,
        track_config: string | null,
      ): string =>
        JSON.stringify({ p: wmsParams, c: cb_config, t: track_config });

      it("differs when cb_config changes (color edit)", () => {
        const params = { STYLES: "cb_raster" };
        const cbA = '{"attr":"fare","valsType":"numeric","breaks":[{"value":10,"color":"FFAAAAAA"}]}';
        const cbB = '{"attr":"fare","valsType":"numeric","breaks":[{"value":10,"color":"FFBBBBBB"}]}';
        expect(buildFingerprint(params, cbA, null)).not.toBe(buildFingerprint(params, cbB, null));
      });

      it("differs when cb_config changes (break value edit)", () => {
        const params = { STYLES: "cb_raster" };
        const cbA = '{"attr":"fare","valsType":"numeric","breaks":[{"value":10,"color":"FFAAAAAA"}]}';
        const cbB = '{"attr":"fare","valsType":"numeric","breaks":[{"value":20,"color":"FFAAAAAA"}]}';
        expect(buildFingerprint(params, cbA, null)).not.toBe(buildFingerprint(params, cbB, null));
      });

      it("is byte-identical when nothing changes (fingerprint stability)", () => {
        const params = { STYLES: "cb_raster" };
        const cb = '{"attr":"fare","valsType":"numeric","breaks":[{"value":10,"color":"FFAAAAAA"}]}';
        expect(buildFingerprint(params, cb, null)).toBe(buildFingerprint(params, cb, null));
      });

      it("differs when wmsParams change (existing Phase 38 lock)", () => {
        const cb = '{"attr":"fare","valsType":"numeric","breaks":[{"value":10,"color":"FFAAAAAA"}]}';
        expect(
          buildFingerprint({ STYLES: "cb_raster" }, cb, null),
        ).not.toBe(
          buildFingerprint({ STYLES: "raster" }, cb, null),
        );
      });
    });
    ```

    ALSO: verify the fingerprint construction in MapChartRenderer.tsx still matches. Add a structural assertion at the top of the describe block:
    ```typescript
    // Sanity assertion: the production code at MapChartRenderer.tsx:1118 + 1208 constructs
    // the fingerprint as JSON.stringify({ p, c, t }). If this changes (e.g. a future
    // refactor adds a v field), this test must be updated.
    // Grep-check below ensures the production string is still present.
    it("MapChartRenderer.tsx production code still uses the {p,c,t} fingerprint shape", async () => {
      const fs = await import("fs");
      const path = await import("path");
      const src = fs.readFileSync(
        path.resolve(__dirname, "MapChartRenderer.tsx"),
        "utf-8",
      );
      // CB-V17-09: cb_config (as `c`) must appear in the fingerprint construction
      expect(src).toMatch(/JSON\.stringify\(\s*\{\s*p:\s*wmsParams,\s*c:\s*layer\.cb_config,\s*t:\s*layer\.track_config/);
    });
    ```

    Place this entire describe block at the END of the spec file (after all existing describe blocks). It is self-contained — no new mocks needed.
  </action>
  <verify>
    <automated>cd kinetica_bi && npx vitest run src/components/charts/MapChartRenderer.spec.tsx --reporter=verbose -t "CB-V17-09"</automated>
  </verify>
  <acceptance_criteria>
    - `grep -c "CB-V17-09" kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx` returns at least 1
    - `grep -c "fingerprint covers layer.cb_config" kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx` returns at least 1
    - `grep -c "buildFingerprint" kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx` returns at least 1
    - `cd kinetica_bi && npx vitest run src/components/charts/MapChartRenderer.spec.tsx -t "CB-V17-09"` exits 0
    - Full vitest suite remains green: `cd kinetica_bi && npx vitest run` exits 0
    - `cd kinetica_bi && npx tsc -p tsconfig.app.json --noEmit` exits 0
  </acceptance_criteria>
  <done>
    Regression spec locks the Phase 38-shipped fingerprint invariant: changing cb_config (color, value, attr, breaks length) produces a distinct fingerprint string; byte-identical cb_config produces a byte-identical fingerprint. Structural grep also asserts the production code still uses the `{ p, c, t }` shape. CB-V17-09 closed with a passing regression spec. Phase 39 complete.
  </done>
</task>

</tasks>

<verification>
- vitest passes for CbConfigForm.spec.tsx with categorical + Auto-suggest test cases
- vitest passes for MapChartRenderer.spec.tsx with the new CB-V17-09 describe block
- Full frontend suite green: `cd kinetica_bi && npx vitest run` exits 0
- tsc clean: `cd kinetica_bi && npx tsc -p tsconfig.app.json --noEmit` exits 0
- No regressions in KineticaWmsLayerForm.spec.tsx or any other existing spec
- `grep -c "cbColumn\|classbreaks" kinetica_bi/src/components/charts/CbConfigForm.tsx` returns 0 (hard cutover lock preserved)
</verification>

<success_criteria>
- ROADMAP SC #2 closed: Auto-suggest button calls /api/quantile, replaces rows on confirm, map re-renders via fingerprint
- ROADMAP SC #3 closed: categorical mode visible when TEXT/CHAR column selected, <other> bucket toggle present, cardinality probe warns + caps at 256
- ROADMAP SC #4 closed: WKB columns excluded from picker; inline message present (Plan 39-02 closed the message side; Plan 39-01 closed the filter side)
- ROADMAP SC #5 closed: lastEmittedParamsRef fingerprint regression spec locks cb_config coverage
- All 9 CB-V17-01..09 requirements have at least one passing test asserting the behavior
- Phase 39 ready for verification phase (Phase 43 live UAT)
</success_criteria>

<output>
After completion, create `.planning/phases/39-classbreak-form-ui-auto-suggest/39-03-SUMMARY.md` documenting:
- Categorical UX shipped (<other> toggle behavior, probeCardinality wiring, validation rules)
- Auto-suggest UX shipped (N slider range, modal-confirm pattern, AbortController scope, color/label/advanced preservation rules)
- Regression spec for CB-V17-09 (location + assertions)
- Final CbConfigForm.tsx total line count + section breakdown
- Test count in CbConfigForm.spec.tsx + MapChartRenderer.spec.tsx
- Any deviations from the plan
- Phase 39 closure: ROADMAP SCs satisfied + CB-V17-01..09 all closed
</output>
