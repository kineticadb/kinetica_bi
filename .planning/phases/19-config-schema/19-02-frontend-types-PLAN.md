---
phase: 19-config-schema
plan: 02
type: execute
wave: 2
depends_on: [19-01]
files_modified:
  - kinetica_bi/src/api/client.ts
  - kinetica_bi/src/lib/wmsUrlBuilder.ts
  - kinetica_bi/src/lib/mapInfoConfig.ts
  - kinetica_bi/src/lib/mapInfoConfig.spec.ts
autonomous: true
requirements:
  - CONFIG-V14-02
must_haves:
  truths:
    - "Frontend DashboardLayerDto in kinetica_bi/src/api/client.ts mirrors the v1.4-extended server DashboardLayer type: gains info_enabled: number (0 | 1 from SQLite), info_columns: string | null (raw JSON-array string), info_template: string | null"
    - "MapWidgetConfig in kinetica_bi/src/lib/wmsUrlBuilder.ts gains infoEnabled?: boolean and infoRadiusPx?: number — both OPTIONAL so legacy widgets stored before Phase 19 type-check without migration"
    - "Backward-compatibility default helpers exist as named exports in kinetica_bi/src/lib/mapInfoConfig.ts: getInfoEnabled(config) returns true when config.infoEnabled is undefined; getInfoRadiusPx(config) returns 20 when config.infoRadiusPx is undefined; existing MapWidgetConfig records lacking these fields are read as { infoEnabled: true, infoRadiusPx: 20 }"
    - "getInfoEnabled returns the explicit boolean when set (false stays false; true stays true); getInfoRadiusPx returns the explicit number when set (any positive number stays as-is); the helpers do NOT silently coerce or clamp — value validation is Phase 22 UI scope"
    - "vitest spec at kinetica_bi/src/lib/mapInfoConfig.spec.ts covers: default-when-undefined for both helpers; explicit-true / explicit-false for infoEnabled; explicit-number for infoRadiusPx; explicit-zero / explicit-negative for infoRadiusPx (passes through unchanged — Phase 22 validates)"
    - "No new behavior: helpers are PURE getters; Phase 21 click handler will import and call them; Phase 19 itself does not consume them in any UI code (LOCKED scope: no React components, no popup, no info-card)"
    - "Loading a dashboard whose stored widget.config records contain neither infoEnabled nor infoRadiusPx — through the existing widget loading path — does not throw, and the helpers return the documented defaults (true, 20). Verified via the spec exercising raw config objects shaped like a pre-Phase-19 widget."
    - "tsc --noEmit passes clean for the frontend package; the existing frontend test suite (347/347 baseline pre-Phase-19) remains green; the new mapInfoConfig.spec.ts adds at least 6 tests"
  artifacts:
    - path: "kinetica_bi/src/api/client.ts"
      provides: "DashboardLayerDto extended with info_enabled, info_columns, info_template (mirrors server DashboardLayer)"
      contains: "info_enabled"
    - path: "kinetica_bi/src/lib/wmsUrlBuilder.ts"
      provides: "MapWidgetConfig type extended with optional infoEnabled / infoRadiusPx fields"
      contains: "infoEnabled"
    - path: "kinetica_bi/src/lib/mapInfoConfig.ts"
      provides: "Backward-compatible default helpers getInfoEnabled / getInfoRadiusPx for the v1.4 map info popup config"
      min_lines: 30
    - path: "kinetica_bi/src/lib/mapInfoConfig.spec.ts"
      provides: "Vitest spec covering default-when-undefined, explicit values, and shape of pre-Phase-19 widget configs"
      min_lines: 50
  key_links:
    - from: "kinetica_bi/src/api/client.ts DashboardLayerDto"
      to: "kinetica_bi/server/src/types.ts DashboardLayer (Plan 19-01)"
      via: "field-shape mirror — info_enabled: number, info_columns: string | null, info_template: string | null match server byte-for-byte"
      pattern: "info_enabled: number"
    - from: "kinetica_bi/src/lib/wmsUrlBuilder.ts MapWidgetConfig"
      to: "kinetica_bi/src/lib/mapInfoConfig.ts getInfoEnabled / getInfoRadiusPx"
      via: "optional infoEnabled / infoRadiusPx fields read by the helpers; helpers default when undefined"
      pattern: "infoEnabled\\?: boolean"
    - from: "kinetica_bi/src/lib/mapInfoConfig.ts"
      to: "kinetica_bi/src/lib/mapInfoConfig.spec.ts"
      via: "spec asserts default-when-undefined behavior for both helpers across legacy and extended config shapes"
      pattern: "describe.*mapInfoConfig"
---

<objective>
Mirror Plan 19-01's server-side `DashboardLayer` type extension on the frontend (`DashboardLayerDto` in `kinetica_bi/src/api/client.ts`); extend `MapWidgetConfig` in `kinetica_bi/src/lib/wmsUrlBuilder.ts` with two optional info-popup fields (`infoEnabled?: boolean`, `infoRadiusPx?: number`); and ship a small pure module `kinetica_bi/src/lib/mapInfoConfig.ts` exporting `getInfoEnabled(config)` + `getInfoRadiusPx(config)` getter helpers that apply backward-compatible defaults so map widgets stored before Phase 19 (which lack both fields) read as `{ infoEnabled: true, infoRadiusPx: 20 }` at the data layer. Add a vitest spec for the helpers.

Purpose: CONFIG-V14-02 — frontend type mirror + backward-compat default plumbing. Phase 21 (popup) imports `getInfoEnabled` to decide whether to register the click handler at all; Phase 22 (UI) reads/writes the same fields with explicit values. Phase 19 ships ONLY the type extensions and the default getters — no React component, no UI panel, no popup behavior.

Output:
1. `kinetica_bi/src/api/client.ts` — `DashboardLayerDto` (lines 448-457) extended with `info_enabled: number`, `info_columns: string | null`, `info_template: string | null`. The `Pick<DashboardLayerDto, ...>` in `updateLayer` (line 482) widened to include the three new fields.
2. `kinetica_bi/src/lib/wmsUrlBuilder.ts` — `MapWidgetConfig` (lines 57-95) gains `infoEnabled?: boolean` and `infoRadiusPx?: number` as optional fields with documenting comments; existing `buildWmsParams` is NOT touched (info popup is OUT of the WMS URL request — it's a separate POST /api/info/query).
3. `kinetica_bi/src/lib/mapInfoConfig.ts` — new pure module exporting `getInfoEnabled(config: Pick<MapWidgetConfig, "infoEnabled">): boolean` and `getInfoRadiusPx(config: Pick<MapWidgetConfig, "infoRadiusPx">): number`.
4. `kinetica_bi/src/lib/mapInfoConfig.spec.ts` — vitest spec with at least 6 tests covering the default-when-undefined and explicit-value branches, plus a regression test against a "legacy widget config" object literal (no info fields).

LOCKED scope: NO React components, NO config UI, NO popup, NO consumption of these helpers anywhere yet (Phase 21 will be the first caller). This plan is type-and-helper plumbing only.
</objective>

<execution_context>
@/Users/rydelpereira/.claude/get-shit-done/workflows/execute-plan.md
@/Users/rydelpereira/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/REQUIREMENTS.md

# Server-side contract finalized (Plan 19-01) — frontend mirrors the column shapes exactly
@.planning/phases/19-config-schema/19-01-schema-migration-PLAN.md

# Pattern references — read before writing any code
@kinetica_bi/src/api/client.ts
@kinetica_bi/src/lib/wmsUrlBuilder.ts
@kinetica_bi/src/components/charts/MapChartRenderer.tsx
@kinetica_bi/src/components/charts/MapConfigPanel.tsx

<interfaces>
<!-- Existing types/exports the plan extends -->

From kinetica_bi/src/api/client.ts (lines 446-457 — current shape, BEFORE this plan):
```typescript
export type LayerType = "KineticaWms";

export type DashboardLayerDto = {
  id: number;
  dashboard_id: number;
  table_id: number;
  layer_type: LayerType;
  position: number;
  config: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};
```

From kinetica_bi/src/api/client.ts (lines 479-491 — updateLayer, Pick<...> needs widening):
```typescript
export const updateLayer = async (
  dashboardId: number,
  layerId: number,
  attrs: Partial<Pick<DashboardLayerDto, "table_id" | "position" | "config">>
): Promise<DashboardLayerDto> => {
  // ...
};
```

From kinetica_bi/src/lib/wmsUrlBuilder.ts (lines 57-95 — current MapWidgetConfig):
```typescript
export type MapWidgetConfig = {
  tableId: number;
  tableRef?: string;
  layerName?: string;
  basemap?: "osm" | "voyager" | "dark";
  // Spatial
  spatialMode: SpatialMode;
  latColumn?: string;
  lonColumn?: string;
  wktColumn?: string;
  wkbColumn?: string;
  // Render
  renderMode: RenderMode;
  // ... raster / heatmap / classbreak / contour params (all optional)
};
```

LOCKED defaults (from ROADMAP.md Phase 19 Notes + REQUIREMENTS.md CONFIG-V14-02):
- `infoEnabled` default: `true`  (per-widget click-popup enabled by default — opt-out, not opt-in)
- `infoRadiusPx` default: `20`   (click radius in pixels)

LOCKED server-side mirror (Plan 19-01's DashboardLayer extension — this plan must match):
```typescript
// Server (kinetica_bi/server/src/types.ts after Plan 19-01):
info_enabled: number;          // 0 | 1 (SQLite has no boolean)
info_columns: string | null;   // raw JSON-array string of column names; null = all columns
info_template: string | null;  // raw HTML template string; null = default key-value table
```

LOCKED scope boundary (from STATE.md v1.4 architecture decisions):
"Config schema split from config UI: Phase 19 delivers only schema migrations and TS type updates (CONFIG-V14-01, CONFIG-V14-02). Phase 22 delivers the React UI panels (CONFIG-V14-03, CONFIG-V14-04)."

This plan must NOT include: any React component, any change to MapConfigPanel/KineticaWmsLayerForm/MapChartRenderer, any popup, any info-card, any consumption of getInfoEnabled or getInfoRadiusPx in production code. ONLY: the DTO type extension, the MapWidgetConfig optional field addition, the pure helper module, and the helper spec.
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Extend DashboardLayerDto in client.ts + MapWidgetConfig in wmsUrlBuilder.ts</name>
  <files>kinetica_bi/src/api/client.ts, kinetica_bi/src/lib/wmsUrlBuilder.ts</files>
  <read_first>
    - kinetica_bi/src/api/client.ts (lines 440-514 — DashboardLayerDto definition + 5 CRUD helper functions; updateLayer Pick<...> needs widening)
    - kinetica_bi/src/lib/wmsUrlBuilder.ts (lines 1-130 — MapWidgetConfig type at lines 57-95; buildWmsParams at line 128 — DO NOT TOUCH; the info popup is NOT a WMS param)
    - kinetica_bi/server/src/types.ts (post Plan 19-01 — confirms the exact column names + types to mirror)
    - .planning/phases/19-config-schema/19-01-schema-migration-PLAN.md (confirms locked column shapes — info_enabled: number, info_columns: string | null, info_template: string | null)
  </read_first>
  <behavior>
    - Test 1 (DTO mirror compiles): tsc --noEmit passes when consumer code reads layer.info_enabled / layer.info_columns / layer.info_template (verifies DashboardLayerDto extension)
    - Test 2 (updateLayer Pick widened): tsc --noEmit passes when calling updateLayer(dashId, layerId, { info_enabled: 0 }) — currently the Pick<...> would reject this property
    - Test 3 (MapWidgetConfig optional fields): tsc --noEmit passes when reading / writing config.infoEnabled and config.infoRadiusPx; legacy MapWidgetConfig literals lacking these fields still type-check (because both are optional)
    - Test 4 (buildWmsParams unchanged): the buildWmsParams signature and body are NOT modified — verified by grep that the function body still exists verbatim
  </behavior>
  <action>
    Step 1 — Extend DashboardLayerDto in `kinetica_bi/src/api/client.ts` (lines 448-457).

    Replace the existing block:
      export type DashboardLayerDto = {
        id: number;
        dashboard_id: number;
        table_id: number;
        layer_type: LayerType;
        position: number;
        config: Record<string, unknown>;
        created_at: string;
        updated_at: string;
      };

    With:
      export type DashboardLayerDto = {
        id: number;
        dashboard_id: number;
        table_id: number;
        layer_type: LayerType;
        position: number;
        config: Record<string, unknown>;
        // v1.4 Phase 19 (CONFIG-V14-01/02): info popup config columns mirroring the server-side
        // DashboardLayer type. SQLite returns INTEGER as number (0 | 1) and NULL TEXT as JS null.
        // info_columns is the raw JSON-array string ('["lon","lat"]') — Phase 21 popup parses it.
        // info_template is the raw HTML template string — Phase 21 popup renders it directly
        // (no sanitization per locked Key Decision in PROJECT.md).
        info_enabled: number;
        info_columns: string | null;
        info_template: string | null;
        created_at: string;
        updated_at: string;
      };

    Step 2 — Widen the Pick<...> in updateLayer in `kinetica_bi/src/api/client.ts` (line 482).

    Current code:
      attrs: Partial<Pick<DashboardLayerDto, "table_id" | "position" | "config">>

    Update to:
      attrs: Partial<Pick<DashboardLayerDto,
        | "table_id"
        | "position"
        | "config"
        | "info_enabled"
        | "info_columns"
        | "info_template"
      >>

    Step 3 — Extend MapWidgetConfig in `kinetica_bi/src/lib/wmsUrlBuilder.ts` (insert AFTER line 94 — the `contourBandwidth?: number;` line — and BEFORE the closing `};` on line 95).

    Insert these fields:
      // v1.4 Phase 19 (CONFIG-V14-02): Map info popup widget-level fields.
      // Both are OPTIONAL so MapWidgetConfig records persisted BEFORE Phase 19 (which carry
      // neither field) continue to type-check without a migration. Backward-compatible defaults
      // (infoEnabled=true, infoRadiusPx=20) are applied at the read site by getInfoEnabled /
      // getInfoRadiusPx in src/lib/mapInfoConfig.ts. These fields are NOT emitted as WMS URL
      // params — the info popup uses a separate POST /api/info/query call (Phase 18).
      infoEnabled?: boolean;
      infoRadiusPx?: number;

    Step 4 — Verify no other call sites in `kinetica_bi/src/` reference the OLD MapWidgetConfig shape in a way that would break. Run a grep sanity check:
      grep -rn "MapWidgetConfig" kinetica_bi/src --include="*.ts" --include="*.tsx"
    The expected matches are:
      - kinetica_bi/src/lib/wmsUrlBuilder.ts (the type itself)
      - kinetica_bi/src/components/charts/MapChartRenderer.tsx (imports + uses for the chart renderer — both fields are optional, so these usages compile)
      - kinetica_bi/src/components/charts/MapConfigPanel.spec.tsx + MapChartRenderer.spec.tsx (test files referencing the type)
    All call sites should still compile because both new fields are optional.

    Step 5 — Confirm buildWmsParams is unchanged:
      grep -n "export function buildWmsParams" kinetica_bi/src/lib/wmsUrlBuilder.ts
    It should still match line ~128 with the existing 2-arg signature `(config: MapWidgetConfig, materializeVersion: number | undefined, ...)`. DO NOT modify this function — info popup is a separate concern from WMS tile rendering.

    Anti-patterns to avoid:
    - Do NOT change DashboardLayerDto field types from `number` / `string | null` to `boolean` / `string[]` / similar — keep them as raw SQLite shapes mirroring the server side. Phase 21 / 22 do the parse/cast at consumption time.
    - Do NOT add a `Layer = DashboardLayerDto` re-export or duplicate the type in another file — keep the single definition in client.ts.
    - Do NOT make `infoEnabled` or `infoRadiusPx` REQUIRED in MapWidgetConfig — that would break every existing widget.config literal stored in SQLite or used in tests.
    - Do NOT consume getInfoEnabled / getInfoRadiusPx anywhere yet — Phase 21 will be the first caller. This plan is plumbing only.
    - Do NOT modify buildWmsParams or any WMS URL construction — info popup is OUT-OF-BAND from WMS tile rendering.
  </action>
  <acceptance_criteria>
    - `kinetica_bi/src/api/client.ts` DashboardLayerDto contains the three fields (verify each grep): `info_enabled: number`, `info_columns: string \| null`, `info_template: string \| null`
    - `kinetica_bi/src/api/client.ts` updateLayer Pick<...> includes all three new fields (verify: `grep -E '"info_enabled"' src/api/client.ts` AND `grep -E '"info_columns"' src/api/client.ts` AND `grep -E '"info_template"' src/api/client.ts` — all must match inside the updateLayer signature)
    - `kinetica_bi/src/lib/wmsUrlBuilder.ts` MapWidgetConfig contains `infoEnabled?: boolean` (verify: `grep -E 'infoEnabled\?: boolean' src/lib/wmsUrlBuilder.ts`)
    - `kinetica_bi/src/lib/wmsUrlBuilder.ts` MapWidgetConfig contains `infoRadiusPx?: number` (verify: `grep -E 'infoRadiusPx\?: number' src/lib/wmsUrlBuilder.ts`)
    - `kinetica_bi/src/lib/wmsUrlBuilder.ts` buildWmsParams body unchanged (verify: `grep -c "export function buildWmsParams" src/lib/wmsUrlBuilder.ts` returns 1)
    - `cd kinetica_bi && npx tsc --noEmit` exits 0 (frontend tsc clean)
  </acceptance_criteria>
  <verify>
    <automated>cd kinetica_bi && grep -E "info_enabled: number" src/api/client.ts && grep -E "info_columns: string \| null" src/api/client.ts && grep -E "info_template: string \| null" src/api/client.ts && grep -E "infoEnabled\?: boolean" src/lib/wmsUrlBuilder.ts && grep -E "infoRadiusPx\?: number" src/lib/wmsUrlBuilder.ts && grep -c "export function buildWmsParams" src/lib/wmsUrlBuilder.ts | awk '$1 == 1 {exit 0} {exit 1}' && npx tsc --noEmit</automated>
  </verify>
  <done>DashboardLayerDto extended with info_enabled / info_columns / info_template; updateLayer Pick<...> widened; MapWidgetConfig gains infoEnabled?: boolean and infoRadiusPx?: number; buildWmsParams untouched; tsc --noEmit clean.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Create mapInfoConfig.ts default helpers + spec</name>
  <files>kinetica_bi/src/lib/mapInfoConfig.ts, kinetica_bi/src/lib/mapInfoConfig.spec.ts</files>
  <read_first>
    - kinetica_bi/src/lib/wmsUrlBuilder.ts (post Task 1 — confirms MapWidgetConfig has infoEnabled?: boolean and infoRadiusPx?: number)
    - kinetica_bi/src/lib/viewExpiry.ts (a sibling pure helper module; reuse its file-header comment style + JSDoc pattern; same directory, same level of complexity)
    - kinetica_bi/src/lib/wmsUrlBuilder.ts top-of-file comment block (Phase 11 → Phase 16 docs pattern — match this header style)
  </read_first>
  <behavior>
    Test cases for kinetica_bi/src/lib/mapInfoConfig.spec.ts:

    - Test 1: getInfoEnabled returns true when config has no infoEnabled field (legacy widget config — pre-Phase-19 stored shape)
    - Test 2: getInfoEnabled returns true when config.infoEnabled === undefined (explicit undefined treated same as missing)
    - Test 3: getInfoEnabled returns true when config.infoEnabled === true
    - Test 4: getInfoEnabled returns false when config.infoEnabled === false (explicit kill switch — Phase 21 will skip click-handler registration)
    - Test 5: getInfoRadiusPx returns 20 when config has no infoRadiusPx field
    - Test 6: getInfoRadiusPx returns 20 when config.infoRadiusPx === undefined
    - Test 7: getInfoRadiusPx returns the explicit value when set (e.g., 50 → 50, 1 → 1, 200 → 200)
    - Test 8: getInfoRadiusPx returns 0 when config.infoRadiusPx === 0 (NO clamping — Phase 22 UI is responsible for min/max validation; helper is a pure read)
    - Test 9: getInfoRadiusPx returns -5 when config.infoRadiusPx === -5 (no clamping — same reason; documents the explicit no-clamp lock)
    - Test 10 (regression — legacy widget config object literal): a pre-Phase-19-shaped MapWidgetConfig (e.g. { tableId: 1, spatialMode: "latlon", latColumn: "lat", lonColumn: "lon", renderMode: "raster" }) read through both helpers returns { infoEnabled: true, infoRadiusPx: 20 }. Asserts the v1.4 ROADMAP success criterion 2: "Existing map widgets that have no infoEnabled or infoRadiusPx fields in their stored config are treated as infoEnabled: true and infoRadiusPx: 20 by the frontend"
  </behavior>
  <action>
    Step 1 — Create `kinetica_bi/src/lib/mapInfoConfig.ts` with the following content:

      /**
       * v1.4 Phase 19 (CONFIG-V14-02): backward-compatible default getters for the map info
       * popup widget-level config fields. Map widgets stored BEFORE Phase 19 carry no
       * `infoEnabled` and no `infoRadiusPx` in their `widget.config` JSON; these helpers
       * default the missing values to the locked v1.4 defaults so legacy widgets render
       * the popup at the standard click radius without a migration.
       *
       * LOCKED DEFAULTS (from REQUIREMENTS.md CONFIG-V14-02 + ROADMAP Phase 19 Notes):
       *   infoEnabled  → true   (per-widget click popup is opt-out, not opt-in)
       *   infoRadiusPx → 20     (click radius in pixels)
       *
       * Phase 19 ships these helpers DORMANT. Phase 21 (map-click-popup) is the first
       * caller — it imports getInfoEnabled to decide whether to register the OL click
       * listener at all (kill switch lock per STATE.md v1.4 architecture decisions:
       * "Per-widget infoEnabled: false disables the OL click listener entirely (no listener
       * registration)"). Phase 22 (config-ui) writes explicit values via MapConfigPanel.
       *
       * NO CLAMPING / VALIDATION HERE — Phase 22 UI is responsible for min/max enforcement
       * (REQUIREMENTS.md CONFIG-V14-04: "numeric input for infoRadiusPx (pixel radius,
       * integer, min 1, max 200, default 20)"). These helpers are pure reads; they pass
       * through whatever value is set, including 0 / negative / non-integer / NaN. Phase 22
       * is where the user-facing bound is enforced.
       */

      import type { MapWidgetConfig } from "./wmsUrlBuilder";

      /** Locked default for `infoEnabled` per CONFIG-V14-02. */
      export const DEFAULT_INFO_ENABLED = true;

      /** Locked default for `infoRadiusPx` (click radius in pixels) per CONFIG-V14-02. */
      export const DEFAULT_INFO_RADIUS_PX = 20;

      /**
       * Read the per-widget info-popup kill switch. Returns DEFAULT_INFO_ENABLED (true) when
       * the config carries no `infoEnabled` field — legacy / pre-Phase-19 widgets opt in
       * automatically.
       *
       * Pass an explicit boolean to override the default. Pre-Phase-19 stored widget configs
       * (which lack the field entirely) read as `true` here; widgets created in Phase 22 with
       * an explicit `infoEnabled: false` read as `false` (kill switch active).
       */
      export function getInfoEnabled(config: Pick<MapWidgetConfig, "infoEnabled">): boolean {
        return config.infoEnabled ?? DEFAULT_INFO_ENABLED;
      }

      /**
       * Read the per-widget info-popup click radius in pixels. Returns DEFAULT_INFO_RADIUS_PX
       * (20) when the config carries no `infoRadiusPx` field.
       *
       * NO clamping — this getter passes through whatever value is set (including 0, negative,
       * NaN). Phase 22's MapConfigPanel UI enforces the min=1, max=200 bound at edit time.
       */
      export function getInfoRadiusPx(config: Pick<MapWidgetConfig, "infoRadiusPx">): number {
        return config.infoRadiusPx ?? DEFAULT_INFO_RADIUS_PX;
      }

    Step 2 — Create `kinetica_bi/src/lib/mapInfoConfig.spec.ts` with the following content:

      import { describe, it, expect } from "vitest";
      import {
        DEFAULT_INFO_ENABLED,
        DEFAULT_INFO_RADIUS_PX,
        getInfoEnabled,
        getInfoRadiusPx,
      } from "./mapInfoConfig";
      import type { MapWidgetConfig } from "./wmsUrlBuilder";

      describe("mapInfoConfig — backward-compatible defaults (CONFIG-V14-02)", () => {
        describe("DEFAULT_* constants", () => {
          it("DEFAULT_INFO_ENABLED is true (locked v1.4 default)", () => {
            expect(DEFAULT_INFO_ENABLED).toBe(true);
          });
          it("DEFAULT_INFO_RADIUS_PX is 20 (locked v1.4 default)", () => {
            expect(DEFAULT_INFO_RADIUS_PX).toBe(20);
          });
        });

        describe("getInfoEnabled", () => {
          it("returns true when config has no infoEnabled field (legacy widget — pre-Phase-19 shape)", () => {
            // Use empty object literal cast — represents a stored widget.config from before Phase 19
            const legacy: Pick<MapWidgetConfig, "infoEnabled"> = {};
            expect(getInfoEnabled(legacy)).toBe(true);
          });

          it("returns true when config.infoEnabled === undefined (explicit undefined treated as missing)", () => {
            expect(getInfoEnabled({ infoEnabled: undefined })).toBe(true);
          });

          it("returns true when config.infoEnabled === true", () => {
            expect(getInfoEnabled({ infoEnabled: true })).toBe(true);
          });

          it("returns false when config.infoEnabled === false (kill switch active)", () => {
            // Phase 21 lock: per-widget infoEnabled: false disables the OL click listener entirely.
            expect(getInfoEnabled({ infoEnabled: false })).toBe(false);
          });
        });

        describe("getInfoRadiusPx", () => {
          it("returns 20 when config has no infoRadiusPx field (legacy widget)", () => {
            const legacy: Pick<MapWidgetConfig, "infoRadiusPx"> = {};
            expect(getInfoRadiusPx(legacy)).toBe(20);
          });

          it("returns 20 when config.infoRadiusPx === undefined", () => {
            expect(getInfoRadiusPx({ infoRadiusPx: undefined })).toBe(20);
          });

          it("returns the explicit value when set (typical Phase 22 case)", () => {
            expect(getInfoRadiusPx({ infoRadiusPx: 1 })).toBe(1);
            expect(getInfoRadiusPx({ infoRadiusPx: 50 })).toBe(50);
            expect(getInfoRadiusPx({ infoRadiusPx: 200 })).toBe(200);
          });

          it("returns 0 when explicitly set to 0 (no clamping — Phase 22 UI validates the min)", () => {
            // Document the no-clamp lock: helper is a pure read, not a validator.
            expect(getInfoRadiusPx({ infoRadiusPx: 0 })).toBe(0);
          });

          it("returns negative values unchanged (no clamping — Phase 22 UI validates)", () => {
            expect(getInfoRadiusPx({ infoRadiusPx: -5 })).toBe(-5);
          });
        });

        describe("backward-compat regression: a complete pre-Phase-19 MapWidgetConfig literal", () => {
          it("a legacy MapWidgetConfig (no info fields) reads as { infoEnabled: true, infoRadiusPx: 20 } via the helpers — ROADMAP Phase 19 success criterion 2", () => {
            // This is the SHAPE of a MapWidgetConfig persisted to widget.config in v1.2/v1.3,
            // before Phase 19 added infoEnabled/infoRadiusPx. The helpers must read it cleanly.
            const legacyWidget: MapWidgetConfig = {
              tableId: 1,
              spatialMode: "latlon",
              latColumn: "lat",
              lonColumn: "lon",
              renderMode: "raster",
            };
            expect(getInfoEnabled(legacyWidget)).toBe(true);
            expect(getInfoRadiusPx(legacyWidget)).toBe(20);
          });

          it("a Phase 22-shaped MapWidgetConfig with explicit info fields reads as those values", () => {
            const explicit: MapWidgetConfig = {
              tableId: 1,
              spatialMode: "latlon",
              latColumn: "lat",
              lonColumn: "lon",
              renderMode: "raster",
              infoEnabled: false,
              infoRadiusPx: 35,
            };
            expect(getInfoEnabled(explicit)).toBe(false);
            expect(getInfoRadiusPx(explicit)).toBe(35);
          });
        });
      });

    Step 3 — Run the spec to confirm green:
      cd kinetica_bi && npx vitest run src/lib/mapInfoConfig.spec.ts --reporter=verbose

    Anti-patterns to avoid:
    - Do NOT clamp / validate values inside getInfoRadiusPx — Phase 22 UI is the validation site (REQUIREMENTS.md CONFIG-V14-04 sets the min=1, max=200 bound). The locked decision in this plan is "helpers are pure reads."
    - Do NOT export the helpers from `kinetica_bi/src/lib/wmsUrlBuilder.ts` — keep `mapInfoConfig.ts` as a separate sibling module (mirrors `viewExpiry.ts` precedent).
    - Do NOT consume the helpers in any production component — Phase 21 is the first caller. The spec is the only consumer in Phase 19.
    - Do NOT add a default-export — both helpers are named exports, alongside the `DEFAULT_*` constants.
    - Do NOT add a `MapInfoConfig` type alias for `Pick<MapWidgetConfig, "infoEnabled" | "infoRadiusPx">` — the helpers take narrower `Pick` directly so unrelated MapWidgetConfig fields don't constrain callers.
  </action>
  <acceptance_criteria>
    - File `kinetica_bi/src/lib/mapInfoConfig.ts` exists
    - File exports `DEFAULT_INFO_ENABLED` (verify: `grep -E 'export const DEFAULT_INFO_ENABLED = true' src/lib/mapInfoConfig.ts`)
    - File exports `DEFAULT_INFO_RADIUS_PX` (verify: `grep -E 'export const DEFAULT_INFO_RADIUS_PX = 20' src/lib/mapInfoConfig.ts`)
    - File exports `getInfoEnabled` function (verify: `grep -E 'export function getInfoEnabled' src/lib/mapInfoConfig.ts`)
    - File exports `getInfoRadiusPx` function (verify: `grep -E 'export function getInfoRadiusPx' src/lib/mapInfoConfig.ts`)
    - File `kinetica_bi/src/lib/mapInfoConfig.spec.ts` exists
    - Spec contains at least 10 it(...) blocks (verify: `grep -c "it(" src/lib/mapInfoConfig.spec.ts` returns >= 10)
    - Spec asserts on the legacy-widget shape (verify: `grep -c "ROADMAP Phase 19 success criterion 2" src/lib/mapInfoConfig.spec.ts` >= 1)
    - `cd kinetica_bi && npx vitest run src/lib/mapInfoConfig.spec.ts --reporter=verbose` exits 0 (all tests pass)
    - `cd kinetica_bi && npx tsc --noEmit` exits 0
  </acceptance_criteria>
  <verify>
    <automated>cd kinetica_bi && npx vitest run src/lib/mapInfoConfig.spec.ts --reporter=verbose && grep -E "export function getInfoEnabled" src/lib/mapInfoConfig.ts && grep -E "export function getInfoRadiusPx" src/lib/mapInfoConfig.ts && grep -E "DEFAULT_INFO_ENABLED = true" src/lib/mapInfoConfig.ts && grep -E "DEFAULT_INFO_RADIUS_PX = 20" src/lib/mapInfoConfig.ts && grep -c "it(" src/lib/mapInfoConfig.spec.ts | awk '$1 >= 10 {exit 0} {exit 1}' && npx tsc --noEmit</automated>
  </verify>
  <done>kinetica_bi/src/lib/mapInfoConfig.ts exports getInfoEnabled (defaults to true) and getInfoRadiusPx (defaults to 20) plus DEFAULT_* constants; spec at kinetica_bi/src/lib/mapInfoConfig.spec.ts has 10+ tests covering default-when-undefined, explicit values, no-clamp behavior, and a legacy-widget regression case; vitest green; tsc --noEmit clean.</done>
</task>

</tasks>

<verification>
- `kinetica_bi/src/api/client.ts` DashboardLayerDto extended with info_enabled, info_columns, info_template (mirror of server-side DashboardLayer per Plan 19-01)
- `kinetica_bi/src/api/client.ts` updateLayer Pick<...> widened to include the three new fields so PATCH callers can persist them
- `kinetica_bi/src/lib/wmsUrlBuilder.ts` MapWidgetConfig gains optional infoEnabled?: boolean and infoRadiusPx?: number; buildWmsParams body unchanged
- `kinetica_bi/src/lib/mapInfoConfig.ts` ships getInfoEnabled (defaults to true) + getInfoRadiusPx (defaults to 20) + DEFAULT_* constants; helpers are pure reads with no clamping
- `kinetica_bi/src/lib/mapInfoConfig.spec.ts` 10+ tests passing covering default-when-undefined, explicit values, no-clamp, and legacy MapWidgetConfig regression
- `npx tsc --noEmit` clean across kinetica_bi (frontend)
- Existing frontend test suite (347/347 baseline) remains green — these changes are pure additions
- No React component, no MapConfigPanel modification, no MapChartRenderer modification, no popup, no info-card (Phase 21/22/23 scope)
</verification>

<success_criteria>
- CONFIG-V14-02 implemented: MapWidgetConfig gains infoEnabled?: boolean and infoRadiusPx?: number; backward-compat defaults (true / 20) accessible via pure getter helpers
- Phase 19 ROADMAP success criterion 2 satisfied: "Existing map widgets that have no infoEnabled or infoRadiusPx fields in their stored config are treated as infoEnabled: true and infoRadiusPx: 20 by the frontend" — proved by the regression test in mapInfoConfig.spec.ts that exercises a legacy MapWidgetConfig literal
- Phase 19 ROADMAP success criterion 3 fully satisfied: "TypeScript types for DashboardLayerDto and the map widget config object are updated to include the new fields; tsc --noEmit passes clean" — DashboardLayerDto extension lands here (server side landed in Plan 19-01); both server and frontend tsc are clean
- Phase 21 (map-click-popup) can now import getInfoEnabled to gate the OL click handler registration
- Phase 22 (config-ui) can now read/write infoEnabled and infoRadiusPx with the type system supporting both branches (set / unset)
</success_criteria>

<output>
After completion, create `.planning/phases/19-config-schema/19-02-frontend-types-SUMMARY.md` summarizing:
- The DashboardLayerDto extension (line range in client.ts) + updateLayer Pick<...> widening
- The MapWidgetConfig extension (line range in wmsUrlBuilder.ts)
- The new mapInfoConfig.ts module (line count, exports)
- The mapInfoConfig.spec.ts test count (e.g., "12/12 passing")
- Whether `npx tsc --noEmit` was clean
- Whether the existing 347/347 frontend test baseline remained green (run `npx vitest run --reporter=summary` to confirm; record the new total)
- Phase 19 verification roll-up: both CONFIG-V14-01 (Plan 19-01) and CONFIG-V14-02 (this plan) reachable end-to-end across server + frontend types
</output>
