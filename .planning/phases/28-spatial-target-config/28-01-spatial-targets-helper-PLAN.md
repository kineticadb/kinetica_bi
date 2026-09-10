---
phase: 28-spatial-target-config
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - kinetica_bi/src/lib/spatialTargets.ts
  - kinetica_bi/src/lib/spatialTargets.spec.ts
  - kinetica_bi/src/lib/wmsUrlBuilder.ts
autonomous: true
requirements:
  - TARGET-V15-01
  - TARGET-V15-02

must_haves:
  truths:
    - "Importing `SpatialMode` from `kinetica_bi/src/lib/spatialTargets.ts` yields the exact union `'latlon' | 'wkt' | 'wkb'` (byte-parity with server `kinetica_bi/server/src/lib/spatialWhereClause.ts` line 54)"
    - "Importing `SpatialTarget` from `kinetica_bi/src/lib/spatialTargets.ts` yields the exact shape `{ tableId: number; spatialMode: SpatialMode; lonCol?: string; latCol?: string; spatialCol?: string }` (byte-parity with server lines 75-81; no frontend-only fields)"
    - "Calling `getSpatialTargets(widget)` on a legacy widget without `widget.config.spatialTargets` returns `[]` (no migration needed)"
    - "Calling `getSpatialTargets(widget)` on a widget with `widget.config.spatialTargets = [t1, t2]` returns the same array reference (no defensive copy — mirrors `getInfoEnabled` minimal-helper style)"
    - "Calling `isSpatialTargetEligible({ tableId: 1, spatialMode: 'wkb', spatialCol: 'geom' })` returns `false` (WKB always ineligible; TD-V14-WKB-SPIKE)"
    - "Calling `isSpatialTargetEligible({ tableId: 1, spatialMode: 'latlon' })` returns `false` (missing lonCol AND latCol)"
    - "Calling `isSpatialTargetEligible({ tableId: 1, spatialMode: 'latlon', lonCol: 'x' })` returns `false` (missing latCol)"
    - "Calling `isSpatialTargetEligible({ tableId: 1, spatialMode: 'latlon', latCol: 'y' })` returns `false` (missing lonCol)"
    - "Calling `isSpatialTargetEligible({ tableId: 1, spatialMode: 'latlon', lonCol: 'x', latCol: 'y' })` returns `true`"
    - "Calling `isSpatialTargetEligible({ tableId: 1, spatialMode: 'wkt' })` returns `false` (missing spatialCol)"
    - "Calling `isSpatialTargetEligible({ tableId: 1, spatialMode: 'wkt', spatialCol: 'geom' })` returns `true`"
    - "`MapWidgetConfig` in `kinetica_bi/src/lib/wmsUrlBuilder.ts` has optional `spatialTargets?: SpatialTarget[]` field imported from `./spatialTargets`"
    - "Frontend vitest suite green: `npx vitest run kinetica_bi/src/lib/spatialTargets.spec.ts` exits 0"
    - "TypeScript compilation passes: `cd kinetica_bi && npx tsc --noEmit` exits 0"
  artifacts:
    - path: "kinetica_bi/src/lib/spatialTargets.ts"
      provides: "SpatialMode + SpatialTarget types + getSpatialTargets + isSpatialTargetEligible helpers"
      exports: ["SpatialMode", "SpatialTarget", "getSpatialTargets", "isSpatialTargetEligible"]
      contains: "export type SpatialTarget"
      min_lines: 40
    - path: "kinetica_bi/src/lib/spatialTargets.spec.ts"
      provides: "Vitest coverage for SpatialTarget shape + getSpatialTargets default-coercion + isSpatialTargetEligible eligibility branches (WKB / incomplete latlon (3 cases) / incomplete wkt / valid latlon / valid wkt)"
      contains: "isSpatialTargetEligible"
      min_lines: 80
    - path: "kinetica_bi/src/lib/wmsUrlBuilder.ts"
      provides: "Extended MapWidgetConfig with optional spatialTargets field (single source of truth import from ./spatialTargets)"
      contains: "spatialTargets?: SpatialTarget[]"
  key_links:
    - from: "kinetica_bi/src/lib/spatialTargets.ts"
      to: "kinetica_bi/server/src/lib/spatialWhereClause.ts"
      via: "byte-parity type duplication (no import; established convention per DashboardLayer/DashboardLayerDto)"
      pattern: "export type SpatialTarget = \\{"
    - from: "kinetica_bi/src/lib/wmsUrlBuilder.ts"
      to: "kinetica_bi/src/lib/spatialTargets.ts"
      via: "import type { SpatialTarget }"
      pattern: "from \"./spatialTargets\""
    - from: "kinetica_bi/src/lib/spatialTargets.spec.ts"
      to: "kinetica_bi/src/lib/spatialTargets.ts"
      via: "sibling import"
      pattern: "from \"./spatialTargets\""
---

<objective>
Create the `spatialTargets.ts` helper module (type + helpers co-located, mirrors `mapInfoConfig.ts` pattern) with its sibling vitest spec, and extend `MapWidgetConfig` in `wmsUrlBuilder.ts` with the optional `spatialTargets?: SpatialTarget[]` field so widget configs can persist explicit spatial filter targets. Closes TARGET-V15-02 fully and the type-shape half of TARGET-V15-01 (persistence wiring rides the existing `PATCH /api/widgets/:id` endpoint — no server work in this plan; legacy widgets default to `[]` via `getSpatialTargets`).

Purpose: Phase 30 (`materializeFilter` client helper) will import `SpatialTarget` from this module to type its request body — byte-parity with server `kinetica_bi/server/src/lib/spatialWhereClause.ts` lines 54-81 means the helper sends the type over the wire as-is (zero projection). `isSpatialTargetEligible` is the single source of truth across all three v1.5 gates (config-time MapConfigPanel WKB warning in Plan 28-02; materialize-time silent-skip in Phase 30; server-time `SpatialFilterWkbDeferredError` → 501 already shipped in Phase 26).

Output: Two new files (`spatialTargets.ts` + `spatialTargets.spec.ts`) + one edited file (`wmsUrlBuilder.ts`). Plan ships dormant — no production consumer outside the spec. Plan 28-02 is the first consumer (UI). Phase 30 wires the eligibility gate into the materialize trigger.
</objective>

<execution_context>
@/Users/rydelpereira/.claude/get-shit-done/workflows/execute-plan.md
@/Users/rydelpereira/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/ROADMAP.md
@.planning/REQUIREMENTS.md
@.planning/phases/28-spatial-target-config/28-CONTEXT.md

<interfaces>
<!-- Server type to mirror byte-for-byte. Frontend type must match field names + optionality. -->

From kinetica_bi/server/src/lib/spatialWhereClause.ts lines 54-81:
```typescript
export type SpatialMode = "latlon" | "wkt" | "wkb";

export type SpatialFilter = {
  id: string;
  wkt: string;
};

export type SpatialTarget = {
  tableId: number;
  spatialMode: SpatialMode;
  lonCol?: string;     // required for latlon
  latCol?: string;     // required for latlon
  spatialCol?: string; // required for wkt (and theoretically wkb — unreachable in production)
};
```

<!-- Template helper module — mirror this pattern verbatim for type+helper co-location. -->

From kinetica_bi/src/lib/mapInfoConfig.ts:
```typescript
import type { MapWidgetConfig } from "./wmsUrlBuilder";

export const DEFAULT_INFO_ENABLED = true;
export const DEFAULT_INFO_RADIUS_PX = 20;

export function getInfoEnabled(config: Pick<MapWidgetConfig, "infoEnabled">): boolean {
  return config.infoEnabled ?? DEFAULT_INFO_ENABLED;
}

export function getInfoRadiusPx(config: Pick<MapWidgetConfig, "infoRadiusPx">): number {
  return config.infoRadiusPx ?? DEFAULT_INFO_RADIUS_PX;
}
```

<!-- The MapWidgetConfig type that this plan extends. Current ending (line 103-107) shown for context. -->

From kinetica_bi/src/lib/wmsUrlBuilder.ts (existing, lines 95-107):
```typescript
  // v1.4 Phase 19 (CONFIG-V14-02): Map info popup widget-level fields.
  // ... (existing JSDoc) ...
  infoEnabled?: boolean;
  infoRadiusPx?: number;
  infoPopupWidthPx?: number;
  infoPopupHeightPx?: number;
};
```

Note: `MapWidgetConfig` already imports `SpatialMode` from `./columnTypes` (line 23 of wmsUrlBuilder.ts). The columnTypes `SpatialMode` is the SAME union (`"latlon" | "wkt" | "wkb"` per columnTypes.ts line 111). This plan adds a SECOND import — `import type { SpatialTarget } from "./spatialTargets"` — so that the new optional field types as the canonical co-located shape.
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Create spatialTargets.ts (type + helpers, co-located)</name>
  <files>kinetica_bi/src/lib/spatialTargets.ts</files>
  <read_first>
    - kinetica_bi/src/lib/mapInfoConfig.ts (template pattern — co-located type + default constants + getter helpers)
    - kinetica_bi/server/src/lib/spatialWhereClause.ts lines 1-100 (server type shape to mirror byte-for-byte; locked at lines 54-81)
    - kinetica_bi/src/lib/wmsUrlBuilder.ts lines 1-110 (where MapWidgetConfig lives; this plan adds `spatialTargets?: SpatialTarget[]` here in Task 3)
    - .planning/phases/28-spatial-target-config/28-CONTEXT.md §"Frontend SpatialTarget type & helper contract" (LOCKED type shape + helper signatures)
  </read_first>
  <behavior>
    Test 1 (already written in Task 2 spec): `SpatialMode` is the exact union `"latlon" | "wkt" | "wkb"`.
    Test 2: `getSpatialTargets({ config: {} } as any)` returns `[]` (legacy widget default-coercion).
    Test 3: `getSpatialTargets({ config: { spatialTargets: [{ tableId: 1, spatialMode: 'latlon' }] } } as any)` returns the same array reference (no defensive copy).
    Test 4: `isSpatialTargetEligible({ tableId: 1, spatialMode: 'wkb', spatialCol: 'geom' })` returns `false` (WKB always ineligible).
    Test 5: `isSpatialTargetEligible({ tableId: 1, spatialMode: 'latlon' })` returns `false` (missing both columns).
    Test 6: `isSpatialTargetEligible({ tableId: 1, spatialMode: 'latlon', lonCol: 'x' })` returns `false` (missing latCol).
    Test 7: `isSpatialTargetEligible({ tableId: 1, spatialMode: 'latlon', latCol: 'y' })` returns `false` (missing lonCol).
    Test 8: `isSpatialTargetEligible({ tableId: 1, spatialMode: 'latlon', lonCol: 'x', latCol: 'y' })` returns `true`.
    Test 9: `isSpatialTargetEligible({ tableId: 1, spatialMode: 'wkt' })` returns `false` (missing spatialCol).
    Test 10: `isSpatialTargetEligible({ tableId: 1, spatialMode: 'wkt', spatialCol: 'geom' })` returns `true`.
    Test 11: `isSpatialTargetEligible({ tableId: 1, spatialMode: 'wkt', spatialCol: '' })` returns `false` (empty string treated as missing — falsy).
  </behavior>
  <action>
    Create `kinetica_bi/src/lib/spatialTargets.ts` with EXACTLY the following structure (file header JSDoc, type definitions, helper functions). Use the LOCKED type shape from CONTEXT.md `<decisions>` (byte-parity with `kinetica_bi/server/src/lib/spatialWhereClause.ts` lines 54-81):

    ```typescript
    /**
     * v1.5 Phase 28 (TARGET-V15-02): co-located SpatialTarget type + helper module
     * for per-map widget spatial filter target configuration.
     *
     * Mirrors the `mapInfoConfig.ts` co-location pattern (type + DEFAULT_* constants
     * + getter helpers in a single file). The `SpatialTarget` type is BYTE-PARITY
     * with the server-side counterpart in `kinetica_bi/server/src/lib/spatialWhereClause.ts`
     * lines 54-81 — same field names, same optionality, NO frontend-only fields
     * (no UI `id`, no camelCase rename). Phase 30's `materializeFilter` client helper
     * sends this type over the wire as-is (zero projection). The type duplication is
     * the established convention (matches DashboardLayer / DashboardLayerDto).
     *
     * `isSpatialTargetEligible` is the SINGLE SOURCE OF TRUTH for the v1.5
     * three-gate eligibility pattern (MAT-V15-03):
     *   - Config-time:      MapConfigPanel shows WKB warning + incomplete indicator (Plan 28-02)
     *   - Materialize-time: AggregatedWidgetRenderer silently skips ineligible targets (Phase 30)
     *   - Server-time:      buildSpatialOrBlock throws SpatialFilterWkbDeferredError → 501
     *                       (already shipped Phase 26)
     *
     * Phase 28 ships this module DORMANT — Plan 28-02 is the first consumer (UI).
     * Phase 30 is the second consumer (materialize trigger eligibility gate).
     */

    import type { MapWidgetConfig } from "./wmsUrlBuilder";

    // ─── Types ─────────────────────────────────────────────────────────────────

    /**
     * Spatial mode discriminant. Byte-parity with server
     * `kinetica_bi/server/src/lib/spatialWhereClause.ts` line 54.
     * Note: a same-shape union also lives in `./columnTypes` (Phase 11) — separate
     * declarations for cross-module independence, mirrors the server-side local
     * declaration choice (STATE.md Phase 26 [WHERE-V15-01] decision).
     */
    export type SpatialMode = "latlon" | "wkt" | "wkb";

    /**
     * Per-table spatial filter target. Byte-parity with server
     * `kinetica_bi/server/src/lib/spatialWhereClause.ts` lines 75-81 — same field
     * names, same optionality. The Phase 30 materializeFilter helper sends this
     * exact shape over the wire (no projection).
     *
     * Exactly one mode-appropriate column variant must be set for eligibility:
     *   - spatialMode "latlon" → lonCol + latCol BOTH required
     *   - spatialMode "wkt"    → spatialCol required
     *   - spatialMode "wkb"    → ineligible regardless (TD-V14-WKB-SPIKE; isSpatialTargetEligible always returns false)
     */
    export type SpatialTarget = {
      tableId: number;
      spatialMode: SpatialMode;
      lonCol?: string;     // required for latlon
      latCol?: string;     // required for latlon
      spatialCol?: string; // required for wkt
    };

    // ─── Helpers ───────────────────────────────────────────────────────────────

    /**
     * Read the per-widget `spatialTargets` array with legacy-default coercion.
     * Returns `[]` for legacy v1.4 widgets that lack the field entirely (no
     * migration needed — spatial filtering inert until operator configures via
     * MapConfigPanel in Plan 28-02).
     *
     * Returns the SAME array reference (no defensive copy) — mirrors
     * `getInfoEnabled` minimal-helper style. Callers that need only eligible
     * targets do: `getSpatialTargets(widget).filter(isSpatialTargetEligible)`.
     */
    export function getSpatialTargets(
      widget: { config: Pick<MapWidgetConfig, "spatialTargets"> },
    ): SpatialTarget[] {
      return widget.config.spatialTargets ?? [];
    }

    /**
     * Single eligibility predicate. Source of truth across all three v1.5 gates
     * (MAT-V15-03). Returns `false` for:
     *   - spatialMode === "wkb" (TD-V14-WKB-SPIKE; deferred)
     *   - spatialMode === "latlon" AND (missing lonCol OR missing latCol)
     *   - spatialMode === "wkt" AND missing spatialCol
     *
     * Treats empty-string columns as missing (falsy check). Returns `true` only
     * for fully-configured latlon or wkt targets.
     */
    export function isSpatialTargetEligible(target: SpatialTarget): boolean {
      if (target.spatialMode === "wkb") return false;
      if (target.spatialMode === "latlon") {
        return Boolean(target.lonCol) && Boolean(target.latCol);
      }
      if (target.spatialMode === "wkt") {
        return Boolean(target.spatialCol);
      }
      return false;
    }
    ```

    Notes:
    - The `getSpatialTargets` parameter type uses `Pick<MapWidgetConfig, "spatialTargets">` on `widget.config` — symmetric with how `getInfoEnabled` types its config arg. This works because Task 3 below adds `spatialTargets?: SpatialTarget[]` to `MapWidgetConfig`.
    - Do NOT add `SpatialFilter` type — Phase 27 already shipped `Shape` in `useSpatialFilterStore`, and Phase 30 will project Shape → SpatialFilter at the materialize-call site (server lines 63-66 are the canonical SpatialFilter shape).
    - Do NOT add `DEFAULT_SPATIAL_TARGETS = []` constant — `[]` is inline literal at the one read site (`getSpatialTargets`), unlike `DEFAULT_INFO_ENABLED` / `DEFAULT_INFO_RADIUS_PX` which are reused in MapConfigPanel + tests.
  </action>
  <verify>
    <automated>cd kinetica_bi && npx tsc --noEmit 2>&1 | grep -E "spatialTargets|wmsUrlBuilder" || echo "TSC_CLEAN"</automated>
  </verify>
  <acceptance_criteria>
    - File `kinetica_bi/src/lib/spatialTargets.ts` exists
    - `grep -q "export type SpatialMode = \"latlon\" | \"wkt\" | \"wkb\"" kinetica_bi/src/lib/spatialTargets.ts` succeeds
    - `grep -q "export type SpatialTarget = {" kinetica_bi/src/lib/spatialTargets.ts` succeeds
    - `grep -q "tableId: number;" kinetica_bi/src/lib/spatialTargets.ts` succeeds
    - `grep -q "spatialMode: SpatialMode;" kinetica_bi/src/lib/spatialTargets.ts` succeeds
    - `grep -q "lonCol?: string;" kinetica_bi/src/lib/spatialTargets.ts` succeeds
    - `grep -q "latCol?: string;" kinetica_bi/src/lib/spatialTargets.ts` succeeds
    - `grep -q "spatialCol?: string;" kinetica_bi/src/lib/spatialTargets.ts` succeeds
    - `grep -q "export function getSpatialTargets" kinetica_bi/src/lib/spatialTargets.ts` succeeds
    - `grep -q "export function isSpatialTargetEligible" kinetica_bi/src/lib/spatialTargets.ts` succeeds
    - `grep -q "widget.config.spatialTargets ?? \\[\\]" kinetica_bi/src/lib/spatialTargets.ts` succeeds
    - `grep -q "target.spatialMode === \"wkb\"" kinetica_bi/src/lib/spatialTargets.ts` succeeds
    - File contains NO `import` statement from `./columnTypes` (SpatialMode is locally declared per CONTEXT.md decision)
    - File contains NO `id:` field in `SpatialTarget` (no frontend-only fields per locked decision)
    - `cd kinetica_bi && npx tsc --noEmit` exits 0 (the Task-3 import in wmsUrlBuilder.ts and any other type references must compile)
  </acceptance_criteria>
  <done>
    File `kinetica_bi/src/lib/spatialTargets.ts` exists, declares `SpatialMode` + `SpatialTarget` types matching server byte-parity, exports `getSpatialTargets` + `isSpatialTargetEligible` helpers, compiles cleanly under tsc.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Create spatialTargets.spec.ts (vitest coverage)</name>
  <files>kinetica_bi/src/lib/spatialTargets.spec.ts</files>
  <read_first>
    - kinetica_bi/src/lib/mapInfoConfig.spec.ts (template spec style — describe blocks per helper, then a regression block at the end)
    - kinetica_bi/src/lib/spatialTargets.ts (after Task 1 lands)
    - .planning/phases/28-spatial-target-config/28-CONTEXT.md §"Frontend SpatialTarget type & helper contract" (LOCKED eligibility branches)
  </read_first>
  <behavior>
    All 11 tests from Task 1's <behavior> block must pass against the implementation in Task 1.
    Spec organization: 3 describe blocks — "SpatialMode + SpatialTarget types", "getSpatialTargets", "isSpatialTargetEligible".
    The describe("isSpatialTargetEligible") block has 7 it() cases covering all branches:
      - WKB always ineligible (even with all columns set)
      - latlon missing both columns
      - latlon missing latCol only
      - latlon missing lonCol only
      - latlon both set → eligible
      - wkt missing spatialCol
      - wkt set → eligible
      - wkt empty-string spatialCol → ineligible (falsy)
  </behavior>
  <action>
    Create `kinetica_bi/src/lib/spatialTargets.spec.ts` with EXACTLY the following structure. Use the literal text below verbatim:

    ```typescript
    import { describe, it, expect } from "vitest";
    import {
      getSpatialTargets,
      isSpatialTargetEligible,
      type SpatialMode,
      type SpatialTarget,
    } from "./spatialTargets";
    import type { MapWidgetConfig } from "./wmsUrlBuilder";

    describe("spatialTargets — Phase 28 (TARGET-V15-02)", () => {
      describe("SpatialMode + SpatialTarget types", () => {
        it("SpatialMode is the union 'latlon' | 'wkt' | 'wkb' (byte-parity with server)", () => {
          // Compile-time assertion via exhaustive switch
          const assertMode = (m: SpatialMode): string => {
            switch (m) {
              case "latlon":
                return "latlon";
              case "wkt":
                return "wkt";
              case "wkb":
                return "wkb";
            }
          };
          expect(assertMode("latlon")).toBe("latlon");
          expect(assertMode("wkt")).toBe("wkt");
          expect(assertMode("wkb")).toBe("wkb");
        });

        it("SpatialTarget shape matches server byte-for-byte (tableId + spatialMode required; lonCol/latCol/spatialCol optional)", () => {
          // Compile-time + runtime assertion: a minimum-viable SpatialTarget needs only tableId + spatialMode.
          const minimal: SpatialTarget = { tableId: 1, spatialMode: "latlon" };
          expect(minimal.tableId).toBe(1);
          expect(minimal.spatialMode).toBe("latlon");
          // All three column fields are optional and may coexist on the same value.
          const full: SpatialTarget = {
            tableId: 2,
            spatialMode: "wkt",
            lonCol: "x",
            latCol: "y",
            spatialCol: "geom",
          };
          expect(full.lonCol).toBe("x");
          expect(full.latCol).toBe("y");
          expect(full.spatialCol).toBe("geom");
        });
      });

      describe("getSpatialTargets", () => {
        it("returns [] for a legacy widget without spatialTargets (no migration needed)", () => {
          const legacy = { config: {} as Pick<MapWidgetConfig, "spatialTargets"> };
          expect(getSpatialTargets(legacy)).toEqual([]);
        });

        it("returns [] when config.spatialTargets === undefined (explicit undefined treated as missing)", () => {
          const widget = { config: { spatialTargets: undefined } as Pick<MapWidgetConfig, "spatialTargets"> };
          expect(getSpatialTargets(widget)).toEqual([]);
        });

        it("returns the same array reference when spatialTargets is set (no defensive copy — minimal-helper style)", () => {
          const targets: SpatialTarget[] = [
            { tableId: 1, spatialMode: "latlon", lonCol: "x", latCol: "y" },
            { tableId: 2, spatialMode: "wkt", spatialCol: "geom" },
          ];
          const widget = { config: { spatialTargets: targets } };
          const out = getSpatialTargets(widget);
          expect(out).toBe(targets); // reference equality, not just deep equality
          expect(out).toHaveLength(2);
        });

        it("returns [] for an empty stored array (still empty after default-coercion)", () => {
          const widget = { config: { spatialTargets: [] as SpatialTarget[] } };
          expect(getSpatialTargets(widget)).toEqual([]);
        });
      });

      describe("isSpatialTargetEligible", () => {
        it("returns false for spatialMode='wkb' even when spatialCol is set (TD-V14-WKB-SPIKE)", () => {
          expect(
            isSpatialTargetEligible({ tableId: 1, spatialMode: "wkb", spatialCol: "geom" }),
          ).toBe(false);
        });

        it("returns false for latlon target missing both lonCol and latCol", () => {
          expect(isSpatialTargetEligible({ tableId: 1, spatialMode: "latlon" })).toBe(false);
        });

        it("returns false for latlon target with lonCol but missing latCol", () => {
          expect(
            isSpatialTargetEligible({ tableId: 1, spatialMode: "latlon", lonCol: "x" }),
          ).toBe(false);
        });

        it("returns false for latlon target with latCol but missing lonCol", () => {
          expect(
            isSpatialTargetEligible({ tableId: 1, spatialMode: "latlon", latCol: "y" }),
          ).toBe(false);
        });

        it("returns true for latlon target with BOTH lonCol and latCol set", () => {
          expect(
            isSpatialTargetEligible({
              tableId: 1,
              spatialMode: "latlon",
              lonCol: "x",
              latCol: "y",
            }),
          ).toBe(true);
        });

        it("returns false for wkt target missing spatialCol", () => {
          expect(isSpatialTargetEligible({ tableId: 1, spatialMode: "wkt" })).toBe(false);
        });

        it("returns true for wkt target with spatialCol set", () => {
          expect(
            isSpatialTargetEligible({ tableId: 1, spatialMode: "wkt", spatialCol: "geom" }),
          ).toBe(true);
        });

        it("returns false for wkt target with empty-string spatialCol (falsy treated as missing)", () => {
          expect(
            isSpatialTargetEligible({ tableId: 1, spatialMode: "wkt", spatialCol: "" }),
          ).toBe(false);
        });

        it("returns false for latlon target with empty-string lonCol (falsy treated as missing)", () => {
          expect(
            isSpatialTargetEligible({
              tableId: 1,
              spatialMode: "latlon",
              lonCol: "",
              latCol: "y",
            }),
          ).toBe(false);
        });
      });
    });
    ```
  </action>
  <verify>
    <automated>cd kinetica_bi && npx vitest run src/lib/spatialTargets.spec.ts --reporter=basic 2>&1 | tail -20</automated>
  </verify>
  <acceptance_criteria>
    - File `kinetica_bi/src/lib/spatialTargets.spec.ts` exists
    - `grep -q "describe(\"spatialTargets" kinetica_bi/src/lib/spatialTargets.spec.ts` succeeds
    - `grep -q "describe(\"isSpatialTargetEligible\"" kinetica_bi/src/lib/spatialTargets.spec.ts` succeeds
    - `grep -q "describe(\"getSpatialTargets\"" kinetica_bi/src/lib/spatialTargets.spec.ts` succeeds
    - `grep -q "returns false for spatialMode='wkb'" kinetica_bi/src/lib/spatialTargets.spec.ts` succeeds
    - `grep -q "returns true for latlon target with BOTH" kinetica_bi/src/lib/spatialTargets.spec.ts` succeeds
    - `grep -q "returns true for wkt target with spatialCol set" kinetica_bi/src/lib/spatialTargets.spec.ts` succeeds
    - `grep -q "no defensive copy" kinetica_bi/src/lib/spatialTargets.spec.ts` succeeds (asserts reference equality intent)
    - `grep -q "expect(out).toBe(targets)" kinetica_bi/src/lib/spatialTargets.spec.ts` succeeds (reference equality assertion)
    - `cd kinetica_bi && npx vitest run src/lib/spatialTargets.spec.ts` exits 0 (all tests pass)
    - Spec contains at least 11 `it(` test cases (count via `grep -c "  it(" kinetica_bi/src/lib/spatialTargets.spec.ts` returns >= 11)
  </acceptance_criteria>
  <done>
    Spec file exists, all 11+ test cases pass, file is structured into 3 describe blocks matching the helper organization, reference-equality is explicitly tested for `getSpatialTargets`.
  </done>
</task>

<task type="auto">
  <name>Task 3: Extend MapWidgetConfig with optional spatialTargets field</name>
  <files>kinetica_bi/src/lib/wmsUrlBuilder.ts</files>
  <read_first>
    - kinetica_bi/src/lib/wmsUrlBuilder.ts (CURRENT file — the MapWidgetConfig type ends at line 107 with `infoPopupHeightPx?: number;` followed by `};`)
    - kinetica_bi/src/lib/spatialTargets.ts (after Task 1 — provides the SpatialTarget type to import)
    - .planning/phases/28-spatial-target-config/28-CONTEXT.md §"Integration Points" (`MapWidgetConfig` — Extend with optional `spatialTargets?: SpatialTarget[]`. Import the type from `lib/spatialTargets.ts` to keep single-source-of-truth.)
  </read_first>
  <action>
    Edit `kinetica_bi/src/lib/wmsUrlBuilder.ts` to add the `SpatialTarget` import and the new optional field on `MapWidgetConfig`.

    Step 1 — Add the import. Find the existing import line (line 23):
    ```typescript
    import type { SpatialMode } from "./columnTypes";
    ```
    Insert the following IMMEDIATELY AFTER it (line 24):
    ```typescript
    import type { SpatialTarget } from "./spatialTargets";
    ```

    Step 2 — Add the field to `MapWidgetConfig`. Find the closing brace of `MapWidgetConfig` (currently at line 107, the line immediately after `infoPopupHeightPx?: number;`). BEFORE the closing `};`, insert the following block (between the `infoPopupHeightPx?: number;` line and the closing `};`):

    ```typescript
      // v1.5 Phase 28 (TARGET-V15-01): Per-map widget spatial filter target list.
      // Locked-empty default for legacy v1.4 widgets via getSpatialTargets() — no migration.
      // Each target binds a tableId + spatialMode + the mode-appropriate column(s) so the
      // Phase 30 materialize trigger can compose a per-target spatial WHERE clause via the
      // server-side buildSpatialOrBlock builder (already shipped Phase 26). The SpatialTarget
      // type is byte-parity with kinetica_bi/server/src/lib/spatialWhereClause.ts lines 75-81;
      // the Phase 30 materializeFilter helper sends this array as-is over the wire.
      spatialTargets?: SpatialTarget[];
    ```

    Do NOT touch any other field, JSDoc, or constant in the file. Do NOT modify `buildWmsParams` — spatialTargets is NOT emitted as a WMS URL param (it rides the /api/filter/materialize POST body in Phase 30, not the WMS GET).

    The final MapWidgetConfig type closing must read:
    ```typescript
      infoEnabled?: boolean;
      infoRadiusPx?: number;
      infoPopupWidthPx?: number;
      infoPopupHeightPx?: number;
      // v1.5 Phase 28 (TARGET-V15-01): Per-map widget spatial filter target list.
      // ... (full JSDoc above) ...
      spatialTargets?: SpatialTarget[];
    };
    ```
  </action>
  <verify>
    <automated>cd kinetica_bi && npx tsc --noEmit 2>&1 | tail -5</automated>
  </verify>
  <acceptance_criteria>
    - `grep -q "import type { SpatialTarget } from \"./spatialTargets\"" kinetica_bi/src/lib/wmsUrlBuilder.ts` succeeds
    - `grep -q "spatialTargets?: SpatialTarget\\[\\]" kinetica_bi/src/lib/wmsUrlBuilder.ts` succeeds
    - `grep -q "Phase 28 (TARGET-V15-01)" kinetica_bi/src/lib/wmsUrlBuilder.ts` succeeds
    - `cd kinetica_bi && npx tsc --noEmit` exits 0 (the new import + field type-check cleanly across all consumers)
    - The existing 4 info-popup fields (`infoEnabled`, `infoRadiusPx`, `infoPopupWidthPx`, `infoPopupHeightPx`) remain present (regression: `grep -q "infoPopupHeightPx?: number;" kinetica_bi/src/lib/wmsUrlBuilder.ts` succeeds)
    - `buildWmsParams` function body is unchanged: `grep -A 2 "function buildWmsParams" kinetica_bi/src/lib/wmsUrlBuilder.ts | grep -q "config: MapWidgetConfig"` succeeds AND no new line contains `spatialTargets` inside the `buildWmsParams` body (the field is config-only, not a WMS URL param)
  </acceptance_criteria>
  <done>
    `MapWidgetConfig` exposes `spatialTargets?: SpatialTarget[]` imported from `./spatialTargets`; tsc passes; existing buildWmsParams behavior unchanged.
  </done>
</task>

</tasks>

<verification>
After all tasks complete, run:
1. `cd kinetica_bi && npx tsc --noEmit` exits 0
2. `cd kinetica_bi && npx vitest run src/lib/spatialTargets.spec.ts` exits 0 (all 11+ tests green)
3. `cd kinetica_bi && npx vitest run src/lib/` exits 0 (no regression in sibling lib specs — especially `mapInfoConfig.spec.ts` and `wmsUrlBuilder.spec.ts`)
4. `grep -r "spatialTargets" kinetica_bi/src/lib/` returns hits in spatialTargets.ts, spatialTargets.spec.ts, and wmsUrlBuilder.ts (no stray production imports outside these three files — plan ships dormant)
</verification>

<success_criteria>
- spatialTargets.ts exports SpatialMode + SpatialTarget types byte-parity with server lines 54-81
- spatialTargets.ts exports getSpatialTargets (default-coerces to []) + isSpatialTargetEligible (WKB false; incomplete false; valid true)
- spatialTargets.spec.ts has 11+ test cases covering all eligibility branches; vitest green
- wmsUrlBuilder.ts MapWidgetConfig has optional spatialTargets?: SpatialTarget[] field; tsc clean
- Module ships dormant — only consumers are the spec file and the field declaration; Plan 28-02 wires the first UI consumer
</success_criteria>

<output>
After completion, create `.planning/phases/28-spatial-target-config/28-01-SUMMARY.md` documenting:
- Files created (spatialTargets.ts, spatialTargets.spec.ts) + edited (wmsUrlBuilder.ts)
- Confirmed byte-parity with server (cite specific line numbers verified)
- Vitest result count
- Tsc clean confirmation
- Plan 28-02 readiness (SpatialTarget importable from `./spatialTargets`)
</output>
