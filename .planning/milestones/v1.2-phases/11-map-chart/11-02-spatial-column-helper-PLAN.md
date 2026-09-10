---
phase: 11-map-chart
plan: 02
type: execute
wave: 1
depends_on: []
files_modified:
  - kinetica_bi/src/lib/columnTypes.ts
  - kinetica_bi/src/lib/columnTypes.spec.ts
autonomous: true
requirements:
  - MAP-02
must_haves:
  truths:
    - "Given a column list and a spatial mode, getValidSpatialColumns returns only columns valid for that mode"
    - "autoSuggestSpatialMode picks 'wkb' when a Kinetica geometry-typed column exists, 'wkt' for WKT-tagged columns, 'latlon' when lat/lon-named numeric columns exist, falls through to 'latlon'"
    - "Both helpers are pure functions (no I/O, no side effects) consumable by MapConfigPanel.tsx in Wave 3"
  artifacts:
    - path: "kinetica_bi/src/lib/columnTypes.ts"
      provides: "getValidSpatialColumns + autoSuggestSpatialMode + SpatialMode type export"
      exports:
        - "getValidSpatialColumns"
        - "autoSuggestSpatialMode"
        - "SpatialMode"
    - path: "kinetica_bi/src/lib/columnTypes.spec.ts"
      provides: "Pitfall-locking spec covering filter behavior and auto-suggest precedence"
      contains: "describe(\"getValidSpatialColumns"
  key_links:
    - from: "src/lib/columnTypes.ts (getValidSpatialColumns)"
      to: "MapConfigPanel.tsx (Wave 3 spatial-column dropdowns)"
      via: "named import"
      pattern: "import .*getValidSpatialColumns.* from .*columnTypes"
    - from: "src/lib/columnTypes.ts (autoSuggestSpatialMode)"
      to: "MapConfigPanel.tsx (Wave 3 auto-suggest hint)"
      via: "named import; called once on first config-modal open when widget.config.spatialMode is unset"
      pattern: "import .*autoSuggestSpatialMode.* from .*columnTypes"
---

<objective>
Add two pure helpers to `src/lib/columnTypes.ts` — `getValidSpatialColumns(columns, mode)` and `autoSuggestSpatialMode(columns)` — colocated with Phase 10's `isColumnDrillDownSafe` so the codebase has ONE column-type philosophy in ONE file. These helpers are the foundation Wave 3's `MapConfigPanel.tsx` builds on for the spatial-mode picker (MAP-02).

Purpose: Phase 10 locked the "column-type utilities live in `src/lib/columnTypes.ts`" pattern. Phase 11 mirrors that for spatial columns. Both helpers are pure (no I/O, no SQL, no React) so they can be unit-tested exhaustively before Wave 3 wires them into the config UI.

Output: Two new exports + ~12-15 unit tests covering the auto-suggest precedence ladder and per-mode column filtering.
</objective>

<execution_context>
@/Users/rydelpereira/.claude/get-shit-done/workflows/execute-plan.md
@/Users/rydelpereira/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/11-map-chart/11-CONTEXT.md
@.planning/phases/11-map-chart/11-RESEARCH.md
@kinetica_bi/src/lib/columnTypes.ts
@kinetica_bi/src/lib/columnTypes.spec.ts

<interfaces>
<!-- Existing exports from src/lib/columnTypes.ts (Phase 10) — extend, do NOT replace -->
```typescript
export type DrillDownDataType = "string" | "number" | "boolean" | "datetime" | "null";
export const EXCLUDED_DRILLDOWN_TYPES: ReadonlySet<string>;
export function isColumnDrillDownSafe(columnType: string): boolean;
export function inferDataTypeFromColumn(columnType: string): DrillDownDataType;
export function buildChipText(column: string, value: unknown): string;
export const NUMERIC_TYPES: ReadonlySet<string>; // already declared by Phase 10
```

<!-- New exports this plan adds -->
```typescript
export type SpatialMode = "latlon" | "wkt" | "wkb";
export type Column = { name: string; type: string };
export function getValidSpatialColumns(columns: Column[], mode: SpatialMode): Column[];
export function autoSuggestSpatialMode(columns: Column[]): SpatialMode;
```

<!-- Type-set definitions per RESEARCH.md Pattern 6 -->
```typescript
const STRING_TYPES: ReadonlySet<string> = new Set(["string", "varchar", "text", "char"]);
const KINETICA_GEOMETRY_TYPES: ReadonlySet<string> = new Set(["geometry", "geography", "wkb", "point"]);
const WKT_HOSTING_TYPES: ReadonlySet<string> = new Set([...STRING_TYPES, "wkt"]);
// NUMERIC_TYPES already exists from Phase 10 — REUSE, do NOT redeclare
```

<!-- Existing test setup (kinetica_bi/src/test/setup.ts) ships the Zustand store-reset shim;
     this spec doesn't touch stores so the shim is inert here, but vitest config picks up the file
     via src/**/*.spec.{ts,tsx} glob (S-03 lock). -->
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: TDD — write spec for getValidSpatialColumns + autoSuggestSpatialMode</name>
  <files>kinetica_bi/src/lib/columnTypes.spec.ts</files>
  <read_first>
    - kinetica_bi/src/lib/columnTypes.spec.ts (existing Phase 10 spec — append a new `describe` block at end of file; do NOT replace existing tests)
    - kinetica_bi/src/lib/columnTypes.ts (existing Phase 10 file — confirm NUMERIC_TYPES is already exported and reusable)
    - .planning/phases/11-map-chart/11-RESEARCH.md (Pattern 6 — exact type-sets and auto-suggest precedence ladder)
    - .planning/phases/11-map-chart/11-CONTEXT.md ("Spatial-column-mode picker" decisions section — locked auto-suggest rules)
  </read_first>
  <behavior>
    Auto-suggest precedence ladder (in order — first match wins):
    1. Any column with type ∈ KINETICA_GEOMETRY_TYPES → return "wkb"
    2. Any column with type containing "wkt" (case-insensitive substring) → return "wkt"
    3. Any column with name matching `/^(lat|latitude|y)$/i` AND any column with name matching `/^(lon|lng|longitude|x)$/i` BOTH present → return "latlon"
    4. Fallback → return "latlon"

    Test cases for `getValidSpatialColumns`:
    - `latlon` mode + cols `[{name:"lat",type:"double"},{name:"region",type:"string"}]` → returns `[{name:"lat",type:"double"}]` (numeric only)
    - `latlon` mode + cols `[{name:"x",type:"int"},{name:"y",type:"long"}]` → returns both (both numeric)
    - `wkt` mode + cols `[{name:"geom",type:"varchar"},{name:"id",type:"long"}]` → returns `[{name:"geom",type:"varchar"}]` (string types host WKT)
    - `wkt` mode + cols `[{name:"geom_wkt",type:"WKT"}]` → returns `[{name:"geom_wkt",type:"WKT"}]` (case-insensitive type match)
    - `wkb` mode + cols `[{name:"shape",type:"geometry"}]` → returns `[{name:"shape",type:"geometry"}]`
    - `wkb` mode + cols `[{name:"shape",type:"varchar"}]` → returns `[]` (varchar is not Kinetica geometry-typed)
    - Type with parens `"varchar(255)"` → matches as `varchar` (paren stripping)
    - Empty cols → returns `[]` for any mode

    Test cases for `autoSuggestSpatialMode`:
    - cols include `{type:"geometry"}` AND `{name:"lat",type:"double"}` → returns `"wkb"` (geometry wins)
    - cols include `{type:"geography"}` only → returns `"wkb"`
    - cols include `{type:"WKT"}` no geometry → returns `"wkt"`
    - cols include `{name:"lat",type:"double"}` AND `{name:"lng",type:"double"}` → returns `"latlon"`
    - cols include `{name:"latitude",type:"float"}` AND `{name:"longitude",type:"float"}` → returns `"latlon"` (long names accepted)
    - cols include only `{name:"id",type:"long"}` → returns `"latlon"` (fallback)
    - cols include `{name:"lat",type:"double"}` only (no lon) → returns `"latlon"` (fallback because both required)
    - Empty cols → returns `"latlon"` (fallback)

    Total: ≥12 test cases.
  </behavior>
  <action>
    Append a new `describe("getValidSpatialColumns + autoSuggestSpatialMode (Phase 11)", () => { ... })` block to the END of `kinetica_bi/src/lib/columnTypes.spec.ts`.

    Use the existing import style at the top of the file (extend the existing import statement):
    ```typescript
    import { getValidSpatialColumns, autoSuggestSpatialMode, type SpatialMode, type Column } from "./columnTypes";
    ```

    Inside the describe block, write the test cases listed in `<behavior>` above. One `it("...", ...)` per case. Use `expect(getValidSpatialColumns(cols, mode)).toEqual([...])` for array assertions and `expect(autoSuggestSpatialMode(cols)).toBe("...")` for string assertions.

    Run `cd kinetica_bi && npx vitest run src/lib/columnTypes.spec.ts`. ALL tests must FAIL because the helpers don't exist yet (RED phase). Confirm: vitest reports "ReferenceError" or "X is not exported" or fails to compile. If vitest somehow passes (e.g. the helpers are accidentally already there), the spec is wrong — investigate.

    Commit at end of task as: `test(11-02): add failing spec for spatial column helpers`.
  </action>
  <acceptance_criteria>
    - `kinetica_bi/src/lib/columnTypes.spec.ts` contains the literal substring `describe("getValidSpatialColumns + autoSuggestSpatialMode (Phase 11)"`
    - Total `it(` count in the new describe block is ≥ 12 (use `grep -c "it(" kinetica_bi/src/lib/columnTypes.spec.ts` to verify increase from baseline)
    - `cd kinetica_bi && npx vitest run src/lib/columnTypes.spec.ts` EXITS NON-ZERO (RED — helpers don't exist yet)
    - The Phase 10 tests in the same spec file still appear (`grep "describe(\"isColumnDrillDownSafe" kinetica_bi/src/lib/columnTypes.spec.ts` returns ≥ 1)
    - Git commit message starts with `test(11-02):`
  </acceptance_criteria>
  <verify>
    <automated>cd kinetica_bi && npx vitest run src/lib/columnTypes.spec.ts; test $? -ne 0 && echo "RED phase confirmed"</automated>
  </verify>
  <done>Spec file extended with ≥12 new test cases; existing Phase 10 tests untouched; vitest fails because helpers don't exist; commit recorded.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: GREEN — implement getValidSpatialColumns + autoSuggestSpatialMode</name>
  <files>kinetica_bi/src/lib/columnTypes.ts</files>
  <read_first>
    - kinetica_bi/src/lib/columnTypes.ts (full file — must add new exports WITHOUT modifying existing Phase 10 exports)
    - kinetica_bi/src/lib/columnTypes.spec.ts (the spec from Task 1 — implement against this spec exactly)
    - .planning/phases/11-map-chart/11-RESEARCH.md (Pattern 6 — copy the type-set definitions and auto-suggest logic)
  </read_first>
  <action>
    Append the following to the END of `kinetica_bi/src/lib/columnTypes.ts` (after the existing Phase 10 exports — DO NOT modify any existing line):

    ```typescript
    // Phase 11: Spatial column helpers (MAP-02)
    // CONTEXT.md "Spatial-column-mode picker" lock; RESEARCH.md Pattern 6.

    export type SpatialMode = "latlon" | "wkt" | "wkb";
    export type Column = { name: string; type: string };

    const STRING_TYPES: ReadonlySet<string> = new Set([
      "string", "varchar", "text", "char",
    ]);
    const KINETICA_GEOMETRY_TYPES: ReadonlySet<string> = new Set([
      "geometry", "geography", "wkb", "point",
    ]);
    const WKT_HOSTING_TYPES: ReadonlySet<string> = new Set([
      ...STRING_TYPES,
      "wkt",
    ]);

    function normalizeType(type: string): string {
      return type.toLowerCase().replace(/\(.*\)/, "").trim();
    }

    export function getValidSpatialColumns(
      columns: Column[],
      mode: SpatialMode
    ): Column[] {
      return columns.filter((c) => {
        const t = normalizeType(c.type);
        if (mode === "latlon") return NUMERIC_TYPES.has(t);
        if (mode === "wkt") return WKT_HOSTING_TYPES.has(t);
        return KINETICA_GEOMETRY_TYPES.has(t); // wkb
      });
    }

    export function autoSuggestSpatialMode(columns: Column[]): SpatialMode {
      // Precedence (RESEARCH.md Pattern 6):
      // 1. Any KINETICA_GEOMETRY_TYPES column → wkb
      const hasGeometry = columns.some((c) =>
        KINETICA_GEOMETRY_TYPES.has(normalizeType(c.type))
      );
      if (hasGeometry) return "wkb";

      // 2. Any column with type containing "wkt" → wkt
      const hasWktHint = columns.some((c) =>
        c.type.toLowerCase().includes("wkt")
      );
      if (hasWktHint) return "wkt";

      // 3. Both lat-name + lon-name numeric columns → latlon
      const hasLat = columns.some((c) => /^(lat|latitude|y)$/i.test(c.name));
      const hasLon = columns.some((c) => /^(lon|lng|longitude|x)$/i.test(c.name));
      if (hasLat && hasLon) return "latlon";

      // 4. Fallback
      return "latlon";
    }
    ```

    Critical: REUSE the existing `NUMERIC_TYPES` constant from Phase 10 (already exported per the locked decision in 10-01 plan summary's "NUMERIC_TYPES constant duplicated from ChartConfigPanel.tsx" note — confirm it is exported; if it is module-private, this task ALSO adds `export` to the existing declaration — and only that one keyword change). Do NOT redeclare NUMERIC_TYPES.

    Run `cd kinetica_bi && npx vitest run src/lib/columnTypes.spec.ts`. ALL Phase 11 tests must PASS (GREEN phase). All existing Phase 10 tests must STILL PASS (no regression).

    Run the entire test suite: `cd kinetica_bi && npx vitest run` — must remain green (no other consumers broken). Commit: `feat(11-02): add getValidSpatialColumns + autoSuggestSpatialMode helpers`.
  </action>
  <acceptance_criteria>
    - `grep -c "export function getValidSpatialColumns\|export function autoSuggestSpatialMode\|export type SpatialMode\|export type Column" kinetica_bi/src/lib/columnTypes.ts` returns 4
    - `cd kinetica_bi && npx vitest run src/lib/columnTypes.spec.ts` EXITS 0 with all ≥12 new tests passing
    - `cd kinetica_bi && npx vitest run` EXITS 0 (full suite green — Phase 9/10 tests unaffected)
    - `grep "import .*NUMERIC_TYPES.* from" kinetica_bi/src/lib/columnTypes.ts` returns 0 lines (NUMERIC_TYPES is reused in-file, not imported)
    - Git commit message starts with `feat(11-02):`
  </acceptance_criteria>
  <verify>
    <automated>cd kinetica_bi && npx vitest run src/lib/columnTypes.spec.ts && npx vitest run</automated>
  </verify>
  <done>Both helpers exported; all new tests + Phase 10 tests + entire suite green; helpers ready for Wave 3 consumption.</done>
</task>

</tasks>

<verification>
- ≥12 new tests in `columnTypes.spec.ts` covering filter behavior + auto-suggest precedence ladder.
- `getValidSpatialColumns` and `autoSuggestSpatialMode` exported from `src/lib/columnTypes.ts`.
- Phase 10 helpers (`isColumnDrillDownSafe`, `inferDataTypeFromColumn`, `buildChipText`) untouched.
- Full vitest suite remains green.
</verification>

<success_criteria>
- `cd kinetica_bi && npx vitest run` exits 0.
- New helpers compile under `tsc --noEmit` (verified by vitest's TS pipeline).
- Wave 3 plans (11-08-map-config-panel-shell) can import these helpers directly with no further work.
</success_criteria>

<output>
After completion, create `.planning/phases/11-map-chart/11-02-SUMMARY.md` summarizing:
- The 4 new exports (getValidSpatialColumns, autoSuggestSpatialMode, SpatialMode, Column)
- The auto-suggest precedence ladder (verbatim, for downstream plan consumption)
- Test count delta (Phase 10 baseline + N new = M total)
- Whether NUMERIC_TYPES required an export modifier change
</output>
