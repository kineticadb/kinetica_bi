---
phase: 35-widget-binding-and-pipeline
plan: 02
type: execute
wave: 1
depends_on: []
files_modified:
  - kinetica_bi/src/lib/wmsUrlBuilder.ts
  - kinetica_bi/src/lib/wmsUrlBuilder.spec.ts
autonomous: true
requirements:
  - DV-V16-13
must_haves:
  truths:
    - "buildWmsParams returns LAYERS=<dvViewName> + _mv=<dynamicViewVersion> when a dv-bound layer is materialized"
    - "buildWmsParams returns null when a dv-bound layer is non-materialized (pending/over_threshold/error), telling caller to OMIT that layer"
    - "buildWmsParams still returns LAYERS=<filterViewName> + _mv=<materializeVersion> for table_id-bound layers (existing Phase 16 behavior)"
    - "buildWmsParams still returns LAYERS=<schema.table> for bare-table layers (existing behavior)"
    - "Existing callers (MapChartRenderer Effects 2/3) compile unchanged because new args are optional"
  artifacts:
    - path: "kinetica_bi/src/lib/wmsUrlBuilder.ts"
      provides: "Extended buildWmsParams with 4-case precedence + DynamicViewEntryInput type export"
      contains: "DynamicViewEntryInput"
    - path: "kinetica_bi/src/lib/wmsUrlBuilder.spec.ts"
      provides: "Precedence cases 1-4 covered (dv-materialized, dv-non-materialized→null, filter-view, bare-table)"
      contains: "dynamicViewEntry"
  key_links:
    - from: "buildWmsParams"
      to: "DynamicViewEntryInput"
      via: "optional 3rd/4th args"
      pattern: "dynamicViewEntry\\?\\: DynamicViewEntryInput"
---

<objective>
Extend `buildWmsParams` from a 2-case (filter-view → bare-table) to a 4-case precedence:
1. dv-bound + materialized → LAYERS=`<dvViewName>` + `_mv=<dynamicViewVersion>`
2. dv-bound + non-materialized → return `null` (caller OMITS layer from stack + surfaces overlay)
3. table_id + filter-view (existing v1.3) → LAYERS=`<filterViewName>` + `_mv=<materializeVersion>`
4. bare → LAYERS=`<schema.table>` (existing)

Purpose: Pure-function extension. No React, no store imports. The caller (MapChartRenderer Effects 2/3 in Plan 35-06) computes the per-layer dv lookup and passes it in. This isolates the precedence logic for spec coverage and keeps `wmsUrlBuilder` pure.

Output: Extended `buildWmsParams` signature (backward-compatible — new args are optional), new `DynamicViewEntryInput` type export, extended `null` return path, and a fully-covered spec.
</objective>

<execution_context>
@/Users/rydelpereira/.claude/get-shit-done/workflows/execute-plan.md
@/Users/rydelpereira/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/REQUIREMENTS.md
@.planning/phases/35-widget-binding-and-pipeline/35-CONTEXT.md
@.planning/phases/35-widget-binding-and-pipeline/35-RESEARCH.md
@kinetica_bi/src/lib/wmsUrlBuilder.ts
@kinetica_bi/src/lib/wmsUrlBuilder.spec.ts

<interfaces>
<!-- From 35-RESEARCH.md §"Example 2" (lines 854-909) — verbatim precedence spec -->

Existing `buildWmsParams` signature (kinetica_bi/src/lib/wmsUrlBuilder.ts:156-272):
```typescript
export function buildWmsParams(
  config: MapWidgetConfig,
  materializeVersion: number | undefined,
): Record<string, string> {
  const params: Record<string, string> = { /* base WMS params */ };
  if (materializeVersion !== undefined) {
    params._mv = String(materializeVersion);
  }
  if (config.tableRef) {
    params.LAYERS = config.tableRef;
  } else if (config.layerName) {
    params.LAYERS = config.layerName;
  }
  // ... existing spatial-mode + render-mode branches (DO NOT TOUCH) ...
  return params;
}
```

NEW Phase 35 signature (locked by 35-CONTEXT.md §"buildWmsParams extension" + 35-RESEARCH.md §"Example 2"):
```typescript
export type DynamicViewEntryInput = {
  status: "materialized" | "over_threshold" | "pending" | "error";
  viewName: string;
};

export function buildWmsParams(
  config: MapWidgetConfig,
  materializeVersion: number | undefined,
  // NEW Phase 35 (optional for backward-compat):
  dynamicViewEntry?: DynamicViewEntryInput,
  dynamicViewVersion?: number,
): Record<string, string> | null {  // CHANGED RETURN: null when layer should be SKIPPED
  // ...
}
```

LOCKED 4-case precedence (35-CONTEXT.md §"buildWmsParams extension"):
1. `dynamicViewEntry?.status === "materialized"` → `params.LAYERS = dynamicViewEntry.viewName; params._mv = String(dynamicViewVersion)`
2. `dynamicViewEntry?.status` is "pending"/"over_threshold"/"error" → `return null` (layer SKIPPED)
3. Else if `materializeVersion` present + `config.tableRef` (filter-view name) → existing behavior
4. Else if `config.tableRef` (bare) or `config.layerName` → existing behavior

Pitfall 5 (35-RESEARCH.md:630-645): Distinct counters, distinct cache-buster sources. NO collision because LAYERS values differ across source kinds.

Toast taxonomy lock: `ToastKind = "permission" | "info" | "error"` — no "warning". (Not directly used here, but referenced by Plan 35-03/35-06.)
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Extend buildWmsParams signature + 4-case precedence + DynamicViewEntryInput type</name>
  <files>kinetica_bi/src/lib/wmsUrlBuilder.ts</files>
  <read_first>
    - kinetica_bi/src/lib/wmsUrlBuilder.ts (FULL — verify existing 2-case at lines 156-272 + spatial-mode branches)
    - kinetica_bi/src/lib/wmsUrlBuilder.spec.ts (FULL — existing test structure to mirror)
    - .planning/phases/35-widget-binding-and-pipeline/35-CONTEXT.md (§"buildWmsParams extension")
    - .planning/phases/35-widget-binding-and-pipeline/35-RESEARCH.md (§"Example 2" + §"Pitfall 5")
  </read_first>
  <behavior>
    - Test 1: `buildWmsParams(config, undefined, { status: "materialized", viewName: "_kbi_dv_u1_d2_3" }, 7)` returns `{ LAYERS: "_kbi_dv_u1_d2_3", _mv: "7", ...baseParams }`.
    - Test 2: `buildWmsParams(config, undefined, { status: "pending", viewName: "_kbi_dv_..." }, 7)` returns `null`.
    - Test 3: `buildWmsParams(config, undefined, { status: "over_threshold", viewName: "_kbi_dv_..." }, 7)` returns `null`.
    - Test 4: `buildWmsParams(config, undefined, { status: "error", viewName: "_kbi_dv_..." }, 7)` returns `null`.
    - Test 5: `buildWmsParams(configWithTableRef, 4, undefined, undefined)` returns `{ LAYERS: configWithTableRef.tableRef, _mv: "4", ...baseParams }` (existing Phase 16 path — regression).
    - Test 6: `buildWmsParams(configBare, undefined, undefined, undefined)` returns `{ LAYERS: configBare.tableRef || configBare.layerName, ...baseParams }` (existing bare path — regression).
    - Test 7: `buildWmsParams(config, 4, { status: "materialized", viewName: "dv1" }, 7)` — dv takes precedence over filter-view: returns `{ LAYERS: "dv1", _mv: "7", ... }`, NOT `{ LAYERS: configTableRef, _mv: "4", ... }`.
    - Test 8: Existing spatial-mode + render-mode branches still apply when dv is materialized (e.g., FILTER spatial WHERE clause appended) — verify by passing a config with spatialFilter and asserting the OUTPUT contains both the dv LAYERS and the spatial FILTER param.
  </behavior>
  <action>
    **1. Add `DynamicViewEntryInput` export at the top of `kinetica_bi/src/lib/wmsUrlBuilder.ts`:**

    Add this exported type ABOVE the existing `buildWmsParams` function:

    ```typescript
    /**
     * Per-layer dynamic-view entry input for buildWmsParams precedence routing.
     *
     * Phase 35 (DV-V16-13): when a layer has dynamic_view_id set, the caller computes
     * this from `useDynamicViewStore.views[layer.dynamic_view_id]` and passes it in.
     * The function returns null when the dv is non-materialized → caller omits the layer.
     *
     * Distinct from `useFilterViewStore` entry shape — only `status` + `viewName` are
     * load-bearing for WMS URL construction. (expiresAt/reason/error are renderer concerns.)
     */
    export type DynamicViewEntryInput = {
      status: "materialized" | "over_threshold" | "pending" | "error";
      viewName: string;
    };
    ```

    **2. Extend `buildWmsParams` signature with 2 new optional args + null-able return:**

    ```typescript
    export function buildWmsParams(
      config: MapWidgetConfig,
      materializeVersion: number | undefined,
      // NEW Phase 35 (DV-V16-13) — optional for backward compat with existing test callers:
      dynamicViewEntry?: DynamicViewEntryInput,
      dynamicViewVersion?: number,
    ): Record<string, string> | null {
      // ... body below ...
    }
    ```

    **3. Insert the dv-precedence branch at the TOP of the LAYERS resolution block:**

    Read the existing body. Identify where LAYERS is currently set (probably an `if (config.tableRef) { params.LAYERS = config.tableRef }` block). Insert the dv branch BEFORE that existing logic:

    ```typescript
    export function buildWmsParams(
      config: MapWidgetConfig,
      materializeVersion: number | undefined,
      dynamicViewEntry?: DynamicViewEntryInput,
      dynamicViewVersion?: number,
    ): Record<string, string> | null {
      const params: Record<string, string> = { /* ...existing base params unchanged... */ };

      // NEW Phase 35 (DV-V16-13): dynamic-view precedence (cases 1+2 of 4-case precedence).
      if (dynamicViewEntry !== undefined) {
        if (dynamicViewEntry.status === "materialized") {
          // Case 1: dv-bound + materialized → LAYERS=<dvViewName>, _mv=<dynamicViewVersion>.
          params.LAYERS = dynamicViewEntry.viewName;
          if (dynamicViewVersion !== undefined) {
            params._mv = String(dynamicViewVersion);
          }
          // Spatial-mode + render-mode branches below still apply for materialized dv layers.
        } else {
          // Case 2: dv-bound + pending/over_threshold/error → SKIP layer entirely.
          // Caller (MapChartRenderer Effect 2) detects null and omits this layer from the visible stack.
          // Overlay "Some layers over threshold" is surfaced by the caller's overlay logic (Plan 35-06).
          return null;
        }
      } else {
        // Cases 3+4: existing v1.3 filter-view path + bare-table path — UNCHANGED.
        if (materializeVersion !== undefined) {
          params._mv = String(materializeVersion);
        }
        if (config.tableRef) {
          params.LAYERS = config.tableRef;
        } else if (config.layerName) {
          params.LAYERS = config.layerName;
        }
      }

      // ... existing spatial-mode + render-mode branches UNCHANGED — they apply to materialized dv layers
      // (the dv view name acts as the FROM source for any spatial WHERE clause Kinetica processes server-side).
      // DO NOT MOVE or DELETE these branches.

      return params;
    }
    ```

    **Critical anti-pattern lock (35-RESEARCH.md §"Anti-Patterns to Avoid"):** Use `||` (NOT `??`) for any `viewName || rawTableRef` fallback in caller code (Plan 35-06). The buildWmsParams function itself doesn't make this call — the caller does — but the function MUST NOT use `??` on viewName either.

    **4. Verify all existing tests in `wmsUrlBuilder.spec.ts` still pass** (the optional args mean existing 2-arg callers compile and behave unchanged).
  </action>
  <verify>
    <automated>cd kinetica_bi && npx vitest run src/lib/wmsUrlBuilder.spec.ts</automated>
  </verify>
  <acceptance_criteria>
    - `grep -q "export type DynamicViewEntryInput" kinetica_bi/src/lib/wmsUrlBuilder.ts`
    - `grep -q "dynamicViewEntry\?\: DynamicViewEntryInput" kinetica_bi/src/lib/wmsUrlBuilder.ts`
    - `grep -q "Record<string, string> | null" kinetica_bi/src/lib/wmsUrlBuilder.ts`
    - `grep -q "return null" kinetica_bi/src/lib/wmsUrlBuilder.ts` (case 2 skip path)
    - `grep -q "dynamicViewEntry.status === \"materialized\"" kinetica_bi/src/lib/wmsUrlBuilder.ts`
    - `cd kinetica_bi && npx vitest run src/lib/wmsUrlBuilder.spec.ts` exits 0 (existing tests regression-safe)
    - `cd kinetica_bi && npx tsc --noEmit` exits 0
  </acceptance_criteria>
  <done>
    - DynamicViewEntryInput type exported
    - 4-case precedence implemented in single function (no helper extraction needed)
    - Return type widened to `Record<string, string> | null` to support layer-skip semantics
    - Existing 2-case behavior preserved (regression-safe)
    - Existing spatial-mode + render-mode branches untouched
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Extend wmsUrlBuilder.spec.ts with 4-case precedence coverage</name>
  <files>kinetica_bi/src/lib/wmsUrlBuilder.spec.ts</files>
  <read_first>
    - kinetica_bi/src/lib/wmsUrlBuilder.spec.ts (FULL — copy existing describe/it structure verbatim for new cases)
    - kinetica_bi/src/lib/wmsUrlBuilder.ts (just-modified file — read the locked precedence comments for test phrasing)
    - .planning/phases/35-widget-binding-and-pipeline/35-CONTEXT.md (§"buildWmsParams extension" verbatim)
  </read_first>
  <behavior>
    See Task 1 behavior block — Tests 1-8 must all be present in the new spec extensions.
  </behavior>
  <action>
    **1. Add a new `describe` block** at the end of `wmsUrlBuilder.spec.ts`:

    ```typescript
    describe("buildWmsParams — Phase 35 dynamic-view precedence (DV-V16-13)", () => {
      const baseConfig: MapWidgetConfig = {
        // ... copy minimal valid config from existing tests in the spec ...
        // Required fields: schema, tableName (or whichever the existing config shape requires).
        // Recommend reading the existing tests for a literal example.
      };

      it("case 1: dv-bound + materialized → LAYERS=<dvViewName>, _mv=<dynamicViewVersion>", () => {
        const result = buildWmsParams(
          baseConfig,
          undefined,
          { status: "materialized", viewName: "_kbi_dv_u1_d2_3" },
          7,
        );
        expect(result).not.toBeNull();
        expect(result!.LAYERS).toBe("_kbi_dv_u1_d2_3");
        expect(result!._mv).toBe("7");
      });

      it("case 2a: dv-bound + pending → returns null (layer skipped)", () => {
        const result = buildWmsParams(
          baseConfig,
          undefined,
          { status: "pending", viewName: "_kbi_dv_u1_d2_3" },
          7,
        );
        expect(result).toBeNull();
      });

      it("case 2b: dv-bound + over_threshold → returns null (layer skipped)", () => {
        const result = buildWmsParams(
          baseConfig,
          undefined,
          { status: "over_threshold", viewName: "_kbi_dv_u1_d2_3" },
          7,
        );
        expect(result).toBeNull();
      });

      it("case 2c: dv-bound + error → returns null (layer skipped)", () => {
        const result = buildWmsParams(
          baseConfig,
          undefined,
          { status: "error", viewName: "_kbi_dv_u1_d2_3" },
          7,
        );
        expect(result).toBeNull();
      });

      it("case 3: dv NOT bound (undefined entry) + filter-view materializeVersion present → existing v1.3 LAYERS=<tableRef>, _mv=<materializeVersion>", () => {
        const fvConfig = { ...baseConfig, tableRef: "_kbi_filt_u1_d2_t3_s4" };
        const result = buildWmsParams(fvConfig, 4, undefined, undefined);
        expect(result).not.toBeNull();
        expect(result!.LAYERS).toBe("_kbi_filt_u1_d2_t3_s4");
        expect(result!._mv).toBe("4");
      });

      it("case 4: dv NOT bound + no filter-view → LAYERS=<schema.table> bare", () => {
        const bareConfig = { ...baseConfig, tableRef: "demo.taxi_trips" };
        const result = buildWmsParams(bareConfig, undefined, undefined, undefined);
        expect(result).not.toBeNull();
        expect(result!.LAYERS).toBe("demo.taxi_trips");
        // No _mv when no version source provided
        expect(result!._mv).toBeUndefined();
      });

      it("dv precedence wins over filter-view: when BOTH dvEntry materialized AND materializeVersion present, LAYERS=<dvViewName>", () => {
        const fvConfig = { ...baseConfig, tableRef: "_kbi_filt_should_be_ignored" };
        const result = buildWmsParams(
          fvConfig,
          4,
          { status: "materialized", viewName: "_kbi_dv_u1_d2_3" },
          7,
        );
        expect(result).not.toBeNull();
        expect(result!.LAYERS).toBe("_kbi_dv_u1_d2_3");  // dv wins
        expect(result!._mv).toBe("7");                    // dv version, not fv version (4)
      });

      it("case 1 + spatial-mode: dv-materialized + spatialFilter on config still appends spatial FILTER param", () => {
        const spatialConfig = {
          ...baseConfig,
          // Whatever shape the existing spec uses for triggering the spatial branch — read existing spec for canonical example.
          // Recommend: spatialFilter: { wkt: "POLYGON(...)" } or similar.
        };
        const result = buildWmsParams(
          spatialConfig,
          undefined,
          { status: "materialized", viewName: "_kbi_dv_u1_d2_3" },
          7,
        );
        expect(result).not.toBeNull();
        expect(result!.LAYERS).toBe("_kbi_dv_u1_d2_3");
        // Assert the spatial-mode branch still ran — exact param key depends on existing builder behavior.
        // Example (adjust to spec): expect(result!.FILTER).toContain("WITHIN(...)");
      });
    });
    ```

    **2. Verify existing tests still pass** alongside the new describe block.

    **3. If `MapWidgetConfig` typing prevents the spec's `tableRef` placeholder usage, read the existing spec for a canonical config shape** and copy it verbatim. The point is to exercise the precedence branches; the exact config shape is incidental.
  </action>
  <verify>
    <automated>cd kinetica_bi && npx vitest run src/lib/wmsUrlBuilder.spec.ts</automated>
  </verify>
  <acceptance_criteria>
    - `grep -q "Phase 35 dynamic-view precedence" kinetica_bi/src/lib/wmsUrlBuilder.spec.ts`
    - `grep -c "expect(result).toBeNull()" kinetica_bi/src/lib/wmsUrlBuilder.spec.ts` returns ≥ 3 (cases 2a, 2b, 2c)
    - `grep -q "dv precedence wins over filter-view" kinetica_bi/src/lib/wmsUrlBuilder.spec.ts` (Test 7)
    - `cd kinetica_bi && npx vitest run src/lib/wmsUrlBuilder.spec.ts` exits 0
    - `cd kinetica_bi && npx tsc --noEmit` exits 0
  </acceptance_criteria>
  <done>
    - 8 new test cases covering 4-case precedence + dv-over-fv precedence + dv + spatial-mode interaction
    - All existing tests still pass
    - tsc clean
  </done>
</task>

</tasks>

<verification>
- `cd kinetica_bi && npx vitest run src/lib/wmsUrlBuilder.spec.ts` passes
- `cd kinetica_bi && npx tsc --noEmit` clean
- Existing callers of `buildWmsParams` (MapChartRenderer Effects 2/3) compile unchanged because new args are optional
- `buildWmsParams` is the ONLY function modified; no React imports added; no Zustand imports added (pure-function discipline preserved)
</verification>

<success_criteria>
- 4-case precedence (dv-materialized → null-on-non-materialized → filter-view → bare) fully implemented and spec-covered
- DynamicViewEntryInput type exported for caller use (Plan 35-06 consumes)
- Return type widened to `Record<string, string> | null`
- Backward compat: existing 2-arg callers compile and behave unchanged
</success_criteria>

<output>
After completion, create `.planning/phases/35-widget-binding-and-pipeline/35-02-SUMMARY.md`.
</output>
