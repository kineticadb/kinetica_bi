---
phase: 44-data-filter-widget
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - kinetica_bi/src/store/filterStore.ts
  - kinetica_bi/src/store/filterStore.spec.ts
  - kinetica_bi/server/src/lib/whereClause.ts
  - kinetica_bi/server/tests/lib.whereClause.spec.ts
  - kinetica_bi/server/tests/routes.filter-materialize.spec.ts
  - kinetica_bi/src/lib/columnTypes.ts
  - kinetica_bi/src/lib/columnTypes.spec.ts
  - kinetica_bi/src/components/DashboardsPage.tsx
  - kinetica_bi/server/src/index.ts
autonomous: true
requirements:
  - FILTER-V17-01   # ActiveFilter type extension (client + server) with operator discriminator and widened value union
  - FILTER-V17-02   # setBulkFilters store action — single filterVersion tick for N column replacements
  - FILTER-V17-03   # 10-cap raised to 25 in filterStore (constant FILTER_CAP_PER_TABLE)
  - FILTER-V17-04   # buildServerWhereClause emits IN (...) and BETWEEN x AND y for new operators; backward-compat eq path preserved
  - FILTER-V17-05   # buildChipText + DashboardsPage chipText consolidated and extended for in/between operators
  - FILTER-V17-06   # /api/top-values route validation cap raised from 256 to 1000

must_haves:
  truths:
    - "ActiveFilter accepts operator: \"eq\" | \"in\" | \"between\" | \"isNull\" (optional; default \"eq\")"
    - "ActiveFilter.value union widened to also carry (string|number)[] for IN and [number,number] | [string,string] tuples for BETWEEN"
    - "useFilterStore.setBulkFilters replaces N column filters in ONE set() with ONE filterVersion increment"
    - "buildServerWhereClause emits `col IN ('a','b')` for operator==='in' with proper single-quote escaping"
    - "buildServerWhereClause emits `col BETWEEN x AND y` for operator==='between' (numeric and datetime/string forms)"
    - "Existing drill-down ActiveFilter literals (operator absent) still produce `col = 'value'` SQL — eq is the default"
    - "FilterBar chip text shows `region in ('EAST', 'WEST')` and `fare between 5 and 50` for new operators"
    - "/api/top-values accepts n up to 1000 (was 256)"
    - "Filter cap is 25 per table (was 10) — multi-column Data Filter widgets have headroom"
  artifacts:
    - path: "kinetica_bi/src/store/filterStore.ts"
      provides: "Extended ActiveFilter type + setBulkFilters action + 25-cap"
      contains: "setBulkFilters"
    - path: "kinetica_bi/server/src/lib/whereClause.ts"
      provides: "buildServerWhereClause with IN + BETWEEN emission"
      contains: "BETWEEN"
    - path: "kinetica_bi/src/lib/columnTypes.ts"
      provides: "buildChipText extended for in/between operators"
      contains: "operator"
    - path: "kinetica_bi/src/components/DashboardsPage.tsx"
      provides: "Local chipText delegates to buildChipText (single source of truth)"
      contains: "buildChipText"
    - path: "kinetica_bi/server/src/index.ts"
      provides: "/api/top-values n cap raised to 1000"
      contains: "n must be integer in [2, 1000]"
  key_links:
    - from: "kinetica_bi/src/store/filterStore.ts (setBulkFilters)"
      to: "AggregatedWidgetRenderer Effect 1 (filterVersion dep)"
      via: "single filterVersion increment after batched set()"
      pattern: "filterVersion: state.filterVersion \\+ 1"
    - from: "kinetica_bi/server/src/lib/whereClause.ts"
      to: "POST /api/filter/materialize (composeWhereClause)"
      via: "AND chain in composeWhereClause that interpolates buildServerWhereClause verbatim"
      pattern: "(IN \\(|BETWEEN )"
    - from: "kinetica_bi/src/components/DashboardsPage.tsx (chipText)"
      to: "kinetica_bi/src/lib/columnTypes.ts (buildChipText)"
      via: "import + delegate (research §I/Risk 7 recommendation)"
      pattern: "import .*buildChipText"
---

<objective>
Ship the pure-functions foundation that unblocks the Data Filter widget UI: extend `ActiveFilter` (client + server) with an `operator` discriminator and widened `value` union; add `setBulkFilters` store action; extend `buildServerWhereClause` to emit `IN (...)` and `BETWEEN x AND y`; consolidate the two `chipText` functions and extend for new operators; raise the per-table filter cap from 10 to 25; raise the `/api/top-values` route validation cap from 256 to 1000.

**No React UI changes here.** Every existing drill-down call site continues to work unchanged because the `operator` field defaults to `"eq"`. Plans 44-02 and 44-03 build the widget on top of this foundation.

Purpose: Decouple the "real architectural work" (type system + WHERE builder + store actions) from the widget UI so this layer can be unit-tested and code-reviewed in isolation, and so the back-compat regression surface (every drill-down path in BarRenderer / LineRenderer / PieRenderer / ScatterRenderer / TableRenderer / RecordsTableRenderer) is exercised by the existing spec suite without any widget code being involved.

Output:
- `filterStore.ts` extended with new operator + value union + `setBulkFilters` + 25-cap.
- `whereClause.ts` extended with IN + BETWEEN emission paths.
- `buildChipText` + `DashboardsPage.chipText` consolidated (single source of truth) and extended.
- `/api/top-values` route validation `n` upper bound raised.
- 4 spec files updated with regression coverage.
</objective>

<execution_context>
@/Users/rydelpereira/.claude/get-shit-done/workflows/execute-plan.md
@/Users/rydelpereira/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/44-data-filter-widget/44-CONTEXT.md
@.planning/phases/44-data-filter-widget/44-RESEARCH.md

<!-- Source files this plan modifies -->
@kinetica_bi/src/store/filterStore.ts
@kinetica_bi/src/store/filterStore.spec.ts
@kinetica_bi/server/src/lib/whereClause.ts
@kinetica_bi/server/tests/lib.whereClause.spec.ts
@kinetica_bi/server/tests/routes.filter-materialize.spec.ts
@kinetica_bi/src/lib/columnTypes.ts
@kinetica_bi/src/components/DashboardsPage.tsx
@kinetica_bi/server/src/index.ts

<interfaces>
<!-- Key types and contracts. Extracted verbatim from current codebase per RESEARCH.md line citations. -->
<!-- Executor must use these exact shapes — do not re-research. -->

From kinetica_bi/src/store/filterStore.ts (CURRENT — lines 12-31):
```typescript
const FILTER_CAP_PER_TABLE = 10; // PITFALL D-04 lock — never silently drop; warn user

export type ActiveFilter = {
  column: string;
  value: string | number | boolean | Date | null;
  dataType: "string" | "number" | "boolean" | "datetime" | "null";
  sourceWidgetId?: number;
  addedAt: number;
};

export type FilterState = {
  filters: Record<number, ActiveFilter[]>;
  filterVersion: number;
  addFilter: (tableId: number, filter: ActiveFilter) => void;
  removeFilter: (tableId: number, column: string) => void;
  clearFilters: (tableId: number) => void;
  reset: () => void;
};
```

From kinetica_bi/server/src/lib/whereClause.ts (CURRENT — lines 35-92):
```typescript
export type ActiveFilter = {
  column: string;
  value: string | number | boolean | Date | null;
  dataType: "string" | "number" | "boolean" | "datetime" | "null";
  sourceWidgetId?: number;
  addedAt: number;
};

export function escapeKineticaStringLiteral(val: string): string {
  return val.replace(/'/g, "''");
}

export function buildServerWhereClause(filters: ActiveFilter[]): string {
  if (filters.length === 0) return "1=1";
  return filters
    .map((f) => {
      if (f.dataType === "string") {
        return `${f.column} = '${escapeKineticaStringLiteral(String(f.value))}'`;
      }
      if (f.dataType === "number") {
        return `${f.column} = ${Number(f.value)}`;
      }
      if (f.dataType === "null") {
        return `${f.column} IS NULL`;
      }
      if (f.dataType === "boolean") {
        return `${f.column} = ${Boolean(f.value)}`;
      }
      // datetime — treat as string literal
      return `${f.column} = '${escapeKineticaStringLiteral(String(f.value))}'`;
    })
    .join(" AND ");
}
```

From kinetica_bi/src/lib/columnTypes.ts (CURRENT — lines 92-106):
```typescript
export function buildChipText(
  column: string,
  value: unknown,
  dataType: DrillDownDataType,
): string {
  if (dataType === "null" || value === null) return `${column} IS NULL`;
  if (dataType === "string") return `${column} = '${value}'`;
  if (dataType === "datetime") {
    const iso = value instanceof Date ? value.toISOString() : String(value);
    return `${column} = '${iso}'`;
  }
  if (dataType === "boolean") return `${column} = ${value ? "TRUE" : "FALSE"}`;
  return `${column} = ${value}`;
}
```

From kinetica_bi/src/components/DashboardsPage.tsx (CURRENT — lines 72-85):
```typescript
const chipText = (
  column: string,
  value: unknown,
  dataType: "string" | "number" | "boolean" | "datetime" | "null",
): string => {
  if (dataType === "null" || value === null) return `${column} IS NULL`;
  if (dataType === "string") return `${column} = '${value}'`;
  if (dataType === "datetime") {
    const iso = value instanceof Date ? value.toISOString() : String(value);
    return `${column} = '${iso}'`;
  }
  if (dataType === "boolean") return `${column} = ${value ? "TRUE" : "FALSE"}`;
  return `${column} = ${value}`;
};
```

From kinetica_bi/server/src/index.ts (CURRENT — lines 928-935, /api/top-values validation):
```typescript
if (
  typeof body.n !== "number" ||
  !Number.isInteger(body.n) ||
  body.n < 2 ||
  body.n > 256
) {
  return res.status(400).json({ error: "n must be integer in [2, 256]." });
}
```
</interfaces>

<critical_invariants>
<!-- Carry-forward locks the executor must NOT violate -->
1. **Drill-down back-compat (RESEARCH §A):** Six existing call sites construct `ActiveFilter` literals with NO `operator` field — BarRenderer, LineRenderer, PieRenderer, ScatterRenderer, TableRenderer, RecordsTableRenderer (all funnel through `dispatchDrillDown` at `WidgetRenderer.tsx:87-129`). After this plan lands, those literals MUST continue to produce `col = 'value'` SQL via the eq default. ZERO call site changes outside this plan's `files_modified`.
2. **Sole materialize trigger (Phase 15 lock):** `setBulkFilters` MUST do nothing more than `set()` the new filters and increment `filterVersion` by exactly 1. It MUST NOT call `materializeFilter` directly, MUST NOT call `markMaterializing` (the consumer in Plan 44-03 does that synchronously after the dispatch, mirroring `dispatchDrillDown:127-128`).
3. **escape parity (RESEARCH §B):** IN-clause string elements MUST be escaped via the existing `escapeKineticaStringLiteral` (per-value). Do NOT add a new escape function.
4. **Server WHERE module purity:** `whereClause.ts` MUST remain dependency-free (no Express, no db, no kinetica.ts imports). It is the same import-isolation contract carried since v1.3 Phase 13.
5. **Existing test count regression (frontend filterStore.spec.ts, server lib.whereClause.spec.ts, server routes.filter-materialize.spec.ts):** All existing `it` blocks MUST still pass byte-identical assertions (the spec helper `f()` at line 9 of filterStore.spec.ts uses `Pick<ActiveFilter, "column" | "value" | "dataType">` — adding optional `operator` doesn't break that).
</critical_invariants>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Extend ActiveFilter type (client + server) + add setBulkFilters + raise filter cap to 25</name>
  <read_first>
    - kinetica_bi/src/store/filterStore.ts (current ActiveFilter type lines 14-20, addFilter lines 37-74, removeFilter lines 76-85, clearFilters lines 87-97)
    - kinetica_bi/src/store/filterStore.spec.ts (existing spec patterns; `f()` helper at line 9 — verify Pick keeps working with optional operator)
    - kinetica_bi/server/src/lib/whereClause.ts (server-side ActiveFilter mirror — lines 35-41; documented as intentional dependency-isolation duplicate)
    - .planning/phases/44-data-filter-widget/44-RESEARCH.md (§A call-site audit, §C Effect-1 trigger sequencing, §J Risk 3 cap-interaction notes)
    - .planning/phases/44-data-filter-widget/44-CONTEXT.md (Edge-case resolutions section — `setBulkFilters` lock + 25-cap lock)
    - kinetica_bi/src/components/charts/WidgetRenderer.tsx (lines 87-129 — `dispatchDrillDown` — verify existing literal shape has no `operator` field; eq default must absorb it)
  </read_first>
  <files>kinetica_bi/src/store/filterStore.ts, kinetica_bi/src/store/filterStore.spec.ts, kinetica_bi/server/src/lib/whereClause.ts</files>
  <behavior>
    - filterStore.spec.ts adds these `it` blocks (RED first; type must exist before tests):
      1. `it("ActiveFilter accepts optional operator with 'eq' | 'in' | 'between' | 'isNull' values")` — compile-time assertion (TS typechecks pass for all four).
      2. `it("ActiveFilter.value accepts string[] for operator: 'in'")` — construct `{ column: 'region', value: ['EAST','WEST'], dataType: 'string', operator: 'in', addedAt: 0 }` and assert `filters[1][0].value` equals `['EAST','WEST']` after `addFilter`.
      3. `it("ActiveFilter.value accepts number tuple [min, max] for operator: 'between'")` — construct `{ column: 'fare', value: [5, 50], dataType: 'number', operator: 'between', addedAt: 0 }`; assert stored value array length 2.
      4. `it("ActiveFilter.value accepts string tuple [start, end] for operator: 'between' on datetime")` — construct `{ column: 'ts', value: ['2024-01-01', '2024-12-31'], dataType: 'datetime', operator: 'between', addedAt: 0 }`.
      5. `it("legacy ActiveFilter literal without operator still adds correctly — defaults to eq")` — existing `dispatchDrillDown` shape (no operator key) added via `addFilter`; assert `filters[1][0].operator` is `undefined` (NOT auto-defaulted at store level — buildServerWhereClause is the default site).
      6. `it("setBulkFilters replaces N column filters in ONE filterVersion tick")` — call `setBulkFilters(1, [f1, f2, f3])`; assert `filters[1].length === 3` and `filterVersion` advanced by exactly 1 (not 3).
      7. `it("setBulkFilters with empty array still increments filterVersion by 1")` — call `setBulkFilters(1, [])`; assert `filters[1]` is empty array or absent and `filterVersion` advanced by 1 (operator hitting Apply with all fields empty is a valid "clear-and-apply" gesture).
      8. `it("setBulkFilters replaces existing entries for the same columns (no append)")` — pre-populate `addFilter(1, region=EAST)`; then `setBulkFilters(1, [region=WEST, status=ACTIVE])`; assert `filters[1].length === 2` AND `filters[1].find(f => f.column==='region').value === 'WEST'`.
      9. `it("setBulkFilters preserves filters on OTHER tables — only mutates filters[tableId]")` — pre-populate `addFilter(2, region=EAST)`; then `setBulkFilters(1, [region=WEST])`; assert `filters[2][0].value === 'EAST'`.
      10. `it("setBulkFilters respects 25-cap: when batch + existing > 25, shows toast and stops adding new columns; existing are still replaced")` — pre-populate 20 filters on table 1; call `setBulkFilters(1, [...10 new columns...])`; assert filter count caps at 25 AND `useToastStore.showToast` was called with text containing "Filter limit reached (25 per table)".
      11. `it("FILTER_CAP_PER_TABLE constant exported as 25")` — `import { FILTER_CAP_PER_TABLE } from './filterStore'; expect(FILTER_CAP_PER_TABLE).toBe(25);` (export the constant for downstream visibility / spec assertion).
      12. `it("existing addFilter 25-cap behavior — 25 fills succeed; 26th is rejected with toast")` — replace the prior 10-cap test (line 73-89 of current spec) at the new 25 value (extend the loop bound).
  </behavior>
  <action>
    **Step 1 — Extend `kinetica_bi/src/store/filterStore.ts`:**

    Change `FILTER_CAP_PER_TABLE` from `10` to `25` AND `export` it (downstream consumers + specs need it):
    ```typescript
    export const FILTER_CAP_PER_TABLE = 25; // raised from 10 (Phase 44 — multi-column Data Filter widgets need headroom; FILTER-V17-03)
    ```

    Update the in-toast message to reflect the new cap. The current message is:
    `"Filter limit reached (10 per table). Clear some first."`
    Change to:
    `"Filter limit reached (25 per table). Clear some first."`

    Replace the `ActiveFilter` type (lines 14-20) with the extended union:
    ```typescript
    export type ActiveFilter = {
      column: string;
      // Phase 44 (FILTER-V17-01): value union widened to carry IN arrays and BETWEEN tuples
      // in addition to the legacy scalar shape. operator discriminator below determines which
      // arm is in use; back-compat callers omit operator and pass a scalar (treated as "eq").
      value:
        | string
        | number
        | boolean
        | Date
        | null
        | (string | number)[]                                  // for operator: "in"
        | [number, number]                                     // for operator: "between" on numeric
        | [string, string];                                    // for operator: "between" on datetime/string
      dataType: "string" | "number" | "boolean" | "datetime" | "null";
      // Phase 44 (FILTER-V17-01): optional operator discriminator. Default behavior when absent is "eq"
      // (legacy drill-down callers in WidgetRenderer.tsx:110 omit this field — they continue working).
      // "isNull" is a sentinel for explicit-null filters (column IS NULL); current callers achieve this
      // via dataType: "null" + value: null and that path is preserved, but the explicit "isNull" operator
      // is reserved for future symmetry.
      operator?: "eq" | "in" | "between" | "isNull";
      sourceWidgetId?: number;
      addedAt: number;
    };
    ```

    Extend `FilterState` with the new action signature:
    ```typescript
    export type FilterState = {
      filters: Record<number, ActiveFilter[]>;
      filterVersion: number;
      addFilter: (tableId: number, filter: ActiveFilter) => void;
      // Phase 44 (FILTER-V17-02): Apply button on Data Filter widget calls this to batch
      // N column replacements into ONE filterVersion tick — avoids N×materialize cycles.
      // Replace-semantics: existing entries for same column names are overwritten;
      // entries for columns NOT in the batch are PRESERVED (do not wipe other entries).
      // Respects FILTER_CAP_PER_TABLE — new columns that would push past 25 are rejected
      // (toast shown); existing columns can always be replaced even at cap.
      setBulkFilters: (tableId: number, filters: ActiveFilter[]) => void;
      removeFilter: (tableId: number, column: string) => void;
      clearFilters: (tableId: number) => void;
      reset: () => void;
    };
    ```

    Add the `setBulkFilters` implementation immediately after `addFilter` in the store creator (before `removeFilter`):
    ```typescript
    setBulkFilters: (tableId, batch) =>
      set((state) => {
        const existing = state.filters[tableId] ?? [];

        // Build replacement: start with existing entries whose column is NOT in the batch
        // (preserve other-column entries — drill-down chips on this table survive a Data Filter Apply
        // unless the operator configured the same column on both).
        const batchColumns = new Set(batch.map((f) => f.column));
        const preserved = existing.filter((f) => !batchColumns.has(f.column));

        // Cap check: count after preserved + batch should not exceed FILTER_CAP_PER_TABLE.
        // Columns being REPLACED don't count toward the cap (their slot is reused).
        // Truncate the batch if it would push past the cap; show toast.
        let acceptedBatch = batch;
        if (preserved.length + batch.length > FILTER_CAP_PER_TABLE) {
          const room = FILTER_CAP_PER_TABLE - preserved.length;
          acceptedBatch = batch.slice(0, Math.max(0, room));
          useToastStore
            .getState()
            .showToast(
              `Filter limit reached (${FILTER_CAP_PER_TABLE} per table). Clear some first.`,
              "info",
            );
        }

        const next = [...preserved, ...acceptedBatch];

        return {
          filters: { ...state.filters, [tableId]: next },
          filterVersion: state.filterVersion + 1, // exactly one tick for the whole batch
        };
      }),
    ```

    Update the existing `addFilter` 10-cap branch (lines 44-49) to use the new constant — it's currently a numeric literal `10` in the comparison; replace with `FILTER_CAP_PER_TABLE`:
    ```typescript
    if (sameColumnIdx === -1 && existing.length >= FILTER_CAP_PER_TABLE) {
      useToastStore.getState().showToast(
        `Filter limit reached (${FILTER_CAP_PER_TABLE} per table). Clear some first.`,
        "info"
      );
      return state;
    }
    ```
    (Same constant used in both branches — keep one source of truth.)

    **Step 2 — Mirror the type extension on the server side at `kinetica_bi/server/src/lib/whereClause.ts`:**

    Replace the `ActiveFilter` declaration (lines 35-41) with the same union extension as the client. Server-side type is a deliberate duplicate (see header comment lines 22-23 — "Pure module — zero imports beyond the Node stdlib"). MUST remain dependency-free.

    ```typescript
    export type ActiveFilter = {
      column: string;
      value:
        | string
        | number
        | boolean
        | Date
        | null
        | (string | number)[]
        | [number, number]
        | [string, string];
      dataType: "string" | "number" | "boolean" | "datetime" | "null";
      operator?: "eq" | "in" | "between" | "isNull";
      sourceWidgetId?: number;
      addedAt: number;
    };
    ```

    **DO NOT modify `buildServerWhereClause` yet** — Task 2 handles the IN/BETWEEN emission paths so this task can ship a passing build (the eq branch still handles every existing test case verbatim).

    **Step 3 — Update `kinetica_bi/src/store/filterStore.spec.ts`** with all 12 `it` blocks listed in `<behavior>`. Group them as:
    - Add a new `describe("useFilterStore.setBulkFilters", () => {...})` block with tests 6-11.
    - Extend the existing `describe("useFilterStore.addFilter", () => {...})` block to add tests 1-5 (type/operator/value-shape tests).
    - Modify the existing "at 10-cap" tests (lines 73-102) to use the 25-cap (rename test descriptions, extend loops to 25/26).

    Use the existing `f()` helper (line 9) — it accepts arbitrary overrides so adding `operator: "in"` works without helper changes:
    ```typescript
    const f1 = f({ column: "region", value: ["EAST", "WEST"], dataType: "string", operator: "in" });
    ```
  </action>
  <verify>
    <automated>cd kinetica_bi && npx tsc --noEmit && npx vitest run src/store/filterStore.spec.ts && cd ../kinetica_bi/server && npx tsc --noEmit</automated>
  </verify>
  <acceptance_criteria>
    - `grep -c "FILTER_CAP_PER_TABLE = 25" kinetica_bi/src/store/filterStore.ts` returns at least 1
    - `grep -c "export const FILTER_CAP_PER_TABLE" kinetica_bi/src/store/filterStore.ts` returns 1 (constant is exported)
    - `grep -c "setBulkFilters" kinetica_bi/src/store/filterStore.ts` returns at least 3 (type decl, action impl, JSDoc)
    - `grep -c "operator?: \"eq\" | \"in\" | \"between\" | \"isNull\"" kinetica_bi/src/store/filterStore.ts` returns 1
    - `grep -c "operator?: \"eq\" | \"in\" | \"between\" | \"isNull\"" kinetica_bi/server/src/lib/whereClause.ts` returns 1
    - `grep -c "(string | number)\\[\\]" kinetica_bi/src/store/filterStore.ts` returns at least 1
    - `grep -c "(string | number)\\[\\]" kinetica_bi/server/src/lib/whereClause.ts` returns at least 1
    - `grep -c "Filter limit reached (25" kinetica_bi/src/store/filterStore.ts` returns at least 1 (toast text reflects new cap)
    - `grep -c "10 per table" kinetica_bi/src/store/filterStore.ts` returns 0 (no stale 10-cap text)
    - `grep -c "describe(\"useFilterStore.setBulkFilters\"" kinetica_bi/src/store/filterStore.spec.ts` returns 1
    - `cd kinetica_bi && npx vitest run src/store/filterStore.spec.ts` reports all tests passing (existing + 12 new = at least 20)
    - `cd kinetica_bi && npx tsc --noEmit` exits 0
    - `cd kinetica_bi/server && npx tsc --noEmit` exits 0
    - No call site outside `kinetica_bi/src/store/filterStore.ts` and `kinetica_bi/server/src/lib/whereClause.ts` was modified: `git diff --name-only HEAD | grep -v -E "(filterStore\\.(ts|spec\\.ts)|whereClause\\.ts)" | wc -l` returns 0
  </acceptance_criteria>
  <done>
    ActiveFilter type extended with `operator?` discriminator and widened `value` union on both client and server. `setBulkFilters` action lands in `useFilterStore` with replace-then-preserve-others semantics and a single filterVersion tick. `FILTER_CAP_PER_TABLE` raised to 25 (and exported). 12 new spec tests pass; existing 8 specs still pass; tsc clean both sides.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Extend buildServerWhereClause for IN + BETWEEN; add filter-materialize integration coverage</name>
  <read_first>
    - kinetica_bi/server/src/lib/whereClause.ts (current buildServerWhereClause implementation lines 71-92 — eq-only)
    - kinetica_bi/server/src/lib/spatialWhereClause.ts (composeWhereClause lines 194-211 — the wrapper that interpolates buildServerWhereClause output verbatim; RESEARCH §B confirms ZERO changes needed here)
    - kinetica_bi/server/tests/lib.whereClause.spec.ts (full file — existing test patterns + matcher styles; new tests must match the style)
    - kinetica_bi/server/tests/routes.filter-materialize.spec.ts (lines 133-460 — supertest happy-path + DDL emission assertions; new tests must mirror this fixture pattern)
    - .planning/phases/44-data-filter-widget/44-RESEARCH.md (§B WHERE-builder safety, especially: empty-IN risk, BETWEEN datetime safety, escape parity, composeWhereClause non-interaction)
    - .planning/phases/44-data-filter-widget/44-CONTEXT.md (Edge-case resolutions — empty IN MUST be skipped at widget layer; buildServerWhereClause is allowed to assume a non-empty IN array — but defensive guard belongs here too)
  </read_first>
  <files>kinetica_bi/server/src/lib/whereClause.ts, kinetica_bi/server/tests/lib.whereClause.spec.ts, kinetica_bi/server/tests/routes.filter-materialize.spec.ts</files>
  <behavior>
    - lib.whereClause.spec.ts gains a new `describe("buildServerWhereClause — IN operator (Phase 44)", () => {...})` block with:
      1. `it("emits col IN ('a', 'b') for operator: 'in' with string array")` — `{ column: 'region', value: ['EAST', 'WEST'], dataType: 'string', operator: 'in', addedAt: 0 }` → `region IN ('EAST', 'WEST')`.
      2. `it("escapes single quotes per element in an IN string array")` — `{ value: ["O'Brien", "smith"], operator: 'in', dataType: 'string' }` → `name IN ('O''Brien', 'smith')`.
      3. `it("emits col IN (1, 2, 3) for operator: 'in' with number array — unquoted")` — `{ column: 'id', value: [1, 2, 3], dataType: 'number', operator: 'in' }` → `id IN (1, 2, 3)`.
      4. `it("emits col IN ('a') for operator: 'in' with single-element array")` → `region IN ('EAST')`.
      5. `it("emits 1=0 (no match) for operator: 'in' with empty array — never invalid IN ()")` — `{ value: [], operator: 'in', dataType: 'string' }` → predicate `1=0`. (Defensive: widget layer SHOULD skip these, but the WHERE builder MUST NOT emit invalid SQL.)
    - lib.whereClause.spec.ts gains a new `describe("buildServerWhereClause — BETWEEN operator (Phase 44)", () => {...})` block with:
      6. `it("emits col BETWEEN x AND y for operator: 'between' with number tuple")` — `{ column: 'fare', value: [5, 50], dataType: 'number', operator: 'between' }` → `fare BETWEEN 5 AND 50`.
      7. `it("emits col BETWEEN '...' AND '...' for operator: 'between' on datetime with single-quoted ISO strings")` — `{ column: 'ts', value: ['2024-01-01', '2024-12-31'], dataType: 'datetime', operator: 'between' }` → `ts BETWEEN '2024-01-01' AND '2024-12-31'`.
      8. `it("emits col BETWEEN '...' AND '...' for operator: 'between' on string dataType (with single-quote escape)")` — `{ value: ["A''", "Z"], dataType: 'string', operator: 'between' }` → `col BETWEEN 'A''''' AND 'Z'`.
    - lib.whereClause.spec.ts gains an explicit back-compat block `describe("buildServerWhereClause — back-compat (operator absent defaults to eq)", () => {...})` with:
      9. `it("ActiveFilter literal with NO operator field produces eq SQL (legacy drill-down compat)")` — `{ column: 'zone', value: 'East Village', dataType: 'string', addedAt: 0 }` (no operator key) → `zone = 'East Village'`. Byte-identical to legacy v1.3 behavior.
      10. `it("operator: 'eq' explicitly set behaves identically to operator absent")` — same input + `operator: "eq"` → `zone = 'East Village'`.
      11. `it("multi-column AND chain mixing operators: eq + in + between composes correctly")` — three filters: eq on zone, in on region, between on fare → `zone = 'Midtown' AND region IN ('EAST', 'WEST') AND fare BETWEEN 5 AND 50`.
    - routes.filter-materialize.spec.ts gains supertest cases (in BOTH password and oidc describe blocks per existing convention; for AUTH_MODE-agnostic minimum, password block is mandatory; oidc block per existing test patterns is recommended but acceptable if pattern is identical — check the file's existing structure and mirror):
      12. `it("materialize with operator: 'in' filter emits CREATE OR REPLACE MATERIALIZED VIEW ... WHERE region IN ('EAST', 'WEST')")` — supertest POST `/api/filter/materialize` with `filters: [{ column: 'region', value: ['EAST','WEST'], dataType: 'string', operator: 'in', addedAt: 0 }]`; capture the DDL passed to `kineticaSqlHelper` mock and assert it contains `region IN ('EAST', 'WEST')`.
      13. `it("materialize with operator: 'between' filter emits ... WHERE fare BETWEEN 5 AND 50")`.
      14. `it("materialize with mixed eq + in + between filters emits a flat AND chain")` — three filters; DDL contains exactly `zone = 'Midtown' AND region IN ('EAST', 'WEST') AND fare BETWEEN 5 AND 50` (or the same predicates in source order; assert each substring independently).
  </behavior>
  <action>
    **Step 1 — Extend `kinetica_bi/server/src/lib/whereClause.ts buildServerWhereClause`:**

    Replace the body of `buildServerWhereClause` (lines 71-92). The new structure routes by `operator` FIRST, falling back to the legacy dataType-based eq path. The eq path is preserved verbatim (no byte-level change in any case it handles today).

    ```typescript
    export function buildServerWhereClause(filters: ActiveFilter[]): string {
      if (filters.length === 0) return "1=1";
      return filters
        .map((f) => {
          const op = f.operator ?? "eq"; // default — legacy drill-down callers omit operator

          // ----- IN (Phase 44 FILTER-V17-04) -----
          if (op === "in") {
            // Defensive: empty array must NEVER produce `col IN ()` (invalid Kinetica SQL).
            // Widget layer is expected to skip empty IN filters before dispatch, but the
            // WHERE builder is the last line of defense — emit `1=0` (matches no rows) to keep
            // SQL valid while flagging "filter was set but empty".
            const arr = Array.isArray(f.value) ? f.value : [];
            if (arr.length === 0) return "1=0";

            // Element formatting routes by dataType:
            //   string / datetime → single-quoted, escape per element via escapeKineticaStringLiteral
            //   number            → bare Number(v)
            //   boolean / null    → not a valid IN target shape; fall back to string handling
            const elements = arr.map((v) => {
              if (f.dataType === "number") return String(Number(v));
              // string or datetime — single-quote + escape
              return `'${escapeKineticaStringLiteral(String(v))}'`;
            });
            return `${f.column} IN (${elements.join(", ")})`;
          }

          // ----- BETWEEN (Phase 44 FILTER-V17-04) -----
          if (op === "between") {
            // Expect a 2-element tuple. Defensive: anything else falls through to eq path
            // with the raw value (will produce a TS-noisy but Kinetica-valid scalar predicate).
            if (Array.isArray(f.value) && f.value.length === 2) {
              const [lo, hi] = f.value as [unknown, unknown];
              if (f.dataType === "number") {
                return `${f.column} BETWEEN ${Number(lo)} AND ${Number(hi)}`;
              }
              // datetime + string — single-quoted ISO/string literals, per-element escape.
              // (RESEARCH §B confirms Kinetica accepts single-quoted ISO strings on DATETIME cols.)
              return `${f.column} BETWEEN '${escapeKineticaStringLiteral(String(lo))}' AND '${escapeKineticaStringLiteral(String(hi))}'`;
            }
            // Fall through to eq path for malformed BETWEEN inputs (defensive — keep SQL valid).
          }

          // ----- eq / isNull / fall-through (PRESERVED VERBATIM from pre-Phase-44 path) -----
          if (f.dataType === "string") {
            return `${f.column} = '${escapeKineticaStringLiteral(String(f.value))}'`;
          }
          if (f.dataType === "number") {
            return `${f.column} = ${Number(f.value)}`;
          }
          if (f.dataType === "null") {
            return `${f.column} IS NULL`;
          }
          if (f.dataType === "boolean") {
            return `${f.column} = ${Boolean(f.value)}`;
          }
          // datetime — treat as string literal
          return `${f.column} = '${escapeKineticaStringLiteral(String(f.value))}'`;
        })
        .join(" AND ");
    }
    ```

    **Step 2 — Update `kinetica_bi/server/tests/lib.whereClause.spec.ts`** with the 11 new `it` blocks listed in `<behavior>`. Group them in three new describe blocks added at the end of the file (after existing describes):
    - `describe("buildServerWhereClause — IN operator (Phase 44 FILTER-V17-04)", () => {...})` → tests 1-5.
    - `describe("buildServerWhereClause — BETWEEN operator (Phase 44 FILTER-V17-04)", () => {...})` → tests 6-8.
    - `describe("buildServerWhereClause — back-compat eq default (Phase 44 FILTER-V17-04)", () => {...})` → tests 9-11.

    **Step 3 — Extend `kinetica_bi/server/tests/routes.filter-materialize.spec.ts`** with the 3 supertest cases (tests 12-14). Add inside the existing `describe("POST /api/filter/materialize — AUTH_MODE=password", ...)` block, immediately after the "audit log entry uses op: \"MATERIALIZE\"" test (around line 339, before the validation/error suite). Mirror the supertest fixture pattern at lines 133-200 (use the same kineticaSqlHelper mock + DDL capture).

    Use snapshot/regex assertion against the captured DDL `sql` argument, asserting:
    - Test 12: `expect(capturedSql).toContain("region IN ('EAST', 'WEST')")` AND `expect(capturedSql).toContain("CREATE OR REPLACE MATERIALIZED VIEW")` AND `expect(capturedSql).toContain("USING TABLE PROPERTIES (TTL = 5)")`.
    - Test 13: `expect(capturedSql).toContain("fare BETWEEN 5 AND 50")`.
    - Test 14: each predicate substring present.

    If existing tests share a `mockKineticaSql` fixture, reuse it. Do NOT introduce new mock layers.

    **No changes to `composeWhereClause` in `spatialWhereClause.ts`** — RESEARCH §B confirms it interpolates `buildServerWhereClause` output verbatim and the new operators compose naturally in the AND chain.
  </action>
  <verify>
    <automated>cd kinetica_bi/server && npx tsc --noEmit && AUTH_MODE=password npx vitest run tests/lib.whereClause.spec.ts tests/routes.filter-materialize.spec.ts</automated>
  </verify>
  <acceptance_criteria>
    - `grep -c "BETWEEN" kinetica_bi/server/src/lib/whereClause.ts` returns at least 2 (numeric + string branches)
    - `grep -c "IN (\${" kinetica_bi/server/src/lib/whereClause.ts` returns at least 1
    - `grep -c "1=0" kinetica_bi/server/src/lib/whereClause.ts` returns at least 1 (empty-IN defensive guard)
    - `grep -c "f.operator ?? \"eq\"" kinetica_bi/server/src/lib/whereClause.ts` returns 1 (legacy default site)
    - `grep -c "buildServerWhereClause emits IN" kinetica_bi/server/tests/lib.whereClause.spec.ts` returns at least 1
    - `grep -c "buildServerWhereClause emits .* BETWEEN" kinetica_bi/server/tests/lib.whereClause.spec.ts` returns at least 1
    - `grep -c "operator: 'in'" kinetica_bi/server/tests/lib.whereClause.spec.ts` returns at least 3 (multiple IN tests)
    - `grep -c "operator: 'between'" kinetica_bi/server/tests/lib.whereClause.spec.ts` returns at least 2
    - `grep -c "operator: 'in'" kinetica_bi/server/tests/routes.filter-materialize.spec.ts` returns at least 1
    - `grep -c "operator: 'between'" kinetica_bi/server/tests/routes.filter-materialize.spec.ts` returns at least 1
    - `cd kinetica_bi/server && AUTH_MODE=password npx vitest run tests/lib.whereClause.spec.ts` exits 0 with ALL tests passing
    - `cd kinetica_bi/server && AUTH_MODE=password npx vitest run tests/routes.filter-materialize.spec.ts` exits 0 with all tests passing including new IN/BETWEEN cases
    - `cd kinetica_bi/server && npx tsc --noEmit` exits 0
    - All existing pre-Phase-44 tests in `lib.whereClause.spec.ts` still pass byte-identically (no eq-path semantic changes)
    - `composeWhereClause` in `spatialWhereClause.ts` is NOT modified: `git diff --name-only HEAD -- kinetica_bi/server/src/lib/spatialWhereClause.ts | wc -l` returns 0
  </acceptance_criteria>
  <done>
    `buildServerWhereClause` emits `col IN (...)` and `col BETWEEN x AND y` for the new operators; empty-IN defensively emits `1=0`; eq-path preserved verbatim. 11 new unit tests + 3 new supertest cases pass. All pre-existing tests still green. Server tsc clean.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Consolidate chipText (DashboardsPage delegates to buildChipText) + extend buildChipText for in/between operators + raise /api/top-values n cap to 1000</name>
  <read_first>
    - kinetica_bi/src/lib/columnTypes.ts (current buildChipText lines 92-106, DrillDownDataType lines 20)
    - kinetica_bi/src/lib/columnTypes.spec.ts (existing buildChipText tests — verify scalar coverage; new tests follow same pattern)
    - kinetica_bi/src/components/DashboardsPage.tsx (local chipText lines 72-85, chip rendering at line 815)
    - .planning/phases/44-data-filter-widget/44-RESEARCH.md (§D FilterBar chip integration, §J Risk 7 dual-function recommendation — consolidate)
    - kinetica_bi/server/src/index.ts (lines 928-935 — current /api/top-values n validation)
    - .planning/phases/44-data-filter-widget/44-CONTEXT.md (Edge-case resolutions — Top-N cap raise to 1000)
  </read_first>
  <files>kinetica_bi/src/lib/columnTypes.ts, kinetica_bi/src/lib/columnTypes.spec.ts, kinetica_bi/src/components/DashboardsPage.tsx, kinetica_bi/server/src/index.ts</files>
  <behavior>
    - columnTypes.spec.ts gains:
      1. `it("buildChipText with operator 'in' on string array formats as `col in ('a', 'b')`")` — `buildChipText('region', ['EAST', 'WEST'], 'string', 'in')` → `region in ('EAST', 'WEST')` (lowercase `in` matches RESEARCH §D format).
      2. `it("buildChipText with operator 'in' on number array formats as `col in (1, 2, 3)`")` — `buildChipText('id', [1, 2, 3], 'number', 'in')` → `id in (1, 2, 3)`.
      3. `it("buildChipText with operator 'in' on empty array formats as `col in ()`")` — display-only, never emitted to SQL.
      4. `it("buildChipText with operator 'between' on number tuple formats as `col between 5 and 50`")` → `fare between 5 and 50`.
      5. `it("buildChipText with operator 'between' on datetime tuple formats as `col between 2024-01-01 and 2024-12-31`")` — single-quoted display NOT applied for between (matches RESEARCH §D format `ts between 2024-01-01 and 2024-12-31`).
      6. `it("buildChipText without operator falls back to existing eq behavior — back-compat")` — `buildChipText('region', 'EAST', 'string')` (no 4th arg) → `region = 'EAST'`. Byte-identical to current behavior.
      7. `it("buildChipText with operator 'eq' explicit produces same output as operator absent")` — same as test 6 but with `'eq'` as 4th arg.
  </behavior>
  <action>
    **Step 1 — Extend `kinetica_bi/src/lib/columnTypes.ts buildChipText`:**

    Add a new optional 4th param `operator` with default `"eq"`. RESEARCH §J Risk 7 recommends Option A (non-breaking optional param). Replace the function definition (lines 92-106) with:

    ```typescript
    /**
     * Produces the filter chip / toast text for a (column, value, dataType, operator?) tuple.
     * DISPLAY ONLY — does NOT SQL-escape. SQL safety is in server/src/lib/whereClause.ts.
     *
     * Phase 44 (FILTER-V17-05): extended for `in` / `between` operators. Format mirrors
     * the locked chip text contract in 44-RESEARCH.md §D:
     *   - in:      `column in ('a', 'b')`              (lowercase 'in'; single-quoted strings)
     *   - in (num):`column in (1, 2, 3)`               (unquoted numbers)
     *   - between: `column between x and y`            (numbers unquoted; strings/dates unquoted in display)
     *
     * The 4th param is optional; legacy callers (drill-down toast at WidgetRenderer.tsx:105)
     * omit it and get the eq path unchanged.
     */
    export function buildChipText(
      column: string,
      value: unknown,
      dataType: DrillDownDataType,
      operator: "eq" | "in" | "between" | "isNull" = "eq",
    ): string {
      // Phase 44 — IN operator display
      if (operator === "in") {
        const arr = Array.isArray(value) ? value : [];
        const items = arr
          .map((v) => (dataType === "number" ? String(v) : `'${v}'`))
          .join(", ");
        return `${column} in (${items})`;
      }

      // Phase 44 — BETWEEN operator display
      if (operator === "between") {
        const tup = Array.isArray(value) && value.length === 2 ? value : [undefined, undefined];
        const [lo, hi] = tup as [unknown, unknown];
        // Numbers display unquoted; strings/datetimes display unquoted in chips (RESEARCH §D format).
        return `${column} between ${String(lo)} and ${String(hi)}`;
      }

      // eq / isNull / fall-through — PRESERVED VERBATIM from pre-Phase-44 path
      if (dataType === "null" || value === null) return `${column} IS NULL`;
      if (dataType === "string") return `${column} = '${value}'`;
      if (dataType === "datetime") {
        const iso = value instanceof Date ? value.toISOString() : String(value);
        return `${column} = '${iso}'`;
      }
      if (dataType === "boolean") return `${column} = ${value ? "TRUE" : "FALSE"}`;
      return `${column} = ${value}`;
    }
    ```

    **Step 2 — Consolidate the duplicate in `kinetica_bi/src/components/DashboardsPage.tsx`:**

    Currently there are TWO chipText functions (RESEARCH §J Risk 7 — they have identical logic today but drift risk). Replace the local `chipText` definition (lines 72-85) by deleting the local function and changing the call site (line 815) to import and use `buildChipText` directly.

    a) Add import (top of file with the other lib imports — search for existing `import .* from "../lib/columnTypes"` to colocate):
    ```typescript
    import { buildChipText } from "../lib/columnTypes";
    ```
    (If the import already exists for other helpers, append `buildChipText` to the existing named-import list — do not create a second import statement from the same module.)

    b) Delete the local `chipText` arrow function (lines 72-85; the entire block starting `const chipText = (` through the closing `};`). Also delete the JSDoc above it (lines 65-71) — replace with a shorter comment:
    ```typescript
    // Phase 44 (FILTER-V17-05): Filter-bar chip text now comes from buildChipText in columnTypes.ts.
    // Previously duplicated here; consolidated to single source of truth.
    ```

    c) Update the call site at line 815:
    Current: `{chipText(f.column, f.value, f.dataType)}`
    New: `{buildChipText(f.column, f.value, f.dataType, f.operator)}`

    (The `f.operator` field is optional — buildChipText defaults to `"eq"` when undefined, so legacy filters render unchanged.)

    **Step 3 — Update `kinetica_bi/src/lib/columnTypes.spec.ts`** with the 7 new tests in `<behavior>`. If the file doesn't have an existing `describe("buildChipText"` block, create one; otherwise extend it. New tests added at the END of the existing describe.

    **Step 4 — Raise /api/top-values n cap in `kinetica_bi/server/src/index.ts`:**

    Locate the route handler (line 912). Find the validation block (lines 928-935):
    ```typescript
    if (
      typeof body.n !== "number" ||
      !Number.isInteger(body.n) ||
      body.n < 2 ||
      body.n > 256
    ) {
      return res.status(400).json({ error: "n must be integer in [2, 256]." });
    }
    ```

    Replace with:
    ```typescript
    if (
      typeof body.n !== "number" ||
      !Number.isInteger(body.n) ||
      body.n < 2 ||
      body.n > 1000
    ) {
      // Phase 44 (FILTER-V17-06): cap raised from 256 → 1000 for Data Filter widget dropdown population.
      // Server cost bounded by Kinetica `GROUP BY ... LIMIT 1000`.
      return res.status(400).json({ error: "n must be integer in [2, 1000]." });
    }
    ```

    **Server route specs:** If `kinetica_bi/server/tests/routes.top-values.spec.ts` exists (Phase 39 class-break work would have created it), update the validation test that asserts 400 for `n=257` — change to `n=1001`. If the spec doesn't exist or doesn't assert this boundary, no spec change needed (route returns 400 for the new bound; existing tests in [2, 256] still pass).

    Check via: `grep -rn "n.*256\\|n must be integer" kinetica_bi/server/tests/ 2>/dev/null` and adjust any matching assertions to the new 1000 bound. If no matches, this sub-step is a no-op.
  </action>
  <verify>
    <automated>cd kinetica_bi && npx tsc --noEmit && npx vitest run src/lib/columnTypes.spec.ts && cd ../kinetica_bi/server && npx tsc --noEmit && AUTH_MODE=password npx vitest run tests/</automated>
  </verify>
  <acceptance_criteria>
    - `grep -c "operator: \"eq\" | \"in\" | \"between\" | \"isNull\" = \"eq\"" kinetica_bi/src/lib/columnTypes.ts` returns 1 (new 4th param signature)
    - `grep -c "operator === \"in\"" kinetica_bi/src/lib/columnTypes.ts` returns 1
    - `grep -c "operator === \"between\"" kinetica_bi/src/lib/columnTypes.ts` returns 1
    - `grep -c "const chipText = " kinetica_bi/src/components/DashboardsPage.tsx` returns 0 (local fn deleted)
    - `grep -c "buildChipText" kinetica_bi/src/components/DashboardsPage.tsx` returns at least 2 (import + call site)
    - `grep -c "buildChipText(f.column, f.value, f.dataType, f.operator)" kinetica_bi/src/components/DashboardsPage.tsx` returns 1
    - `grep -c "n must be integer in \\[2, 1000\\]" kinetica_bi/server/src/index.ts` returns 1
    - `grep -c "body.n > 1000" kinetica_bi/server/src/index.ts` returns 1
    - `grep -c "body.n > 256" kinetica_bi/server/src/index.ts` returns 0
    - `cd kinetica_bi && npx vitest run src/lib/columnTypes.spec.ts` exits 0 with all tests passing (existing + 7 new)
    - `cd kinetica_bi && npx vitest run src/components/DashboardsPage.spec.tsx` exits 0 (regression — no spec broke due to local chipText deletion; if DashboardsPage spec snapshots chip text, snapshots must still match because format is identical for legacy filters)
    - `cd kinetica_bi && npx tsc --noEmit` exits 0
    - `cd kinetica_bi/server && npx tsc --noEmit` exits 0
    - Existing toast text from `dispatchDrillDown` at WidgetRenderer.tsx:105 (`buildChipText(column, value, dataType)` 3-arg form) still works (defaults `operator` to `"eq"`)
  </acceptance_criteria>
  <done>
    `buildChipText` extended with optional 4th `operator` param; emits `region in ('EAST', 'WEST')` and `fare between 5 and 50` formats per RESEARCH §D. `DashboardsPage.tsx` local `chipText` deleted; filter-bar chips render via `buildChipText` (single source of truth). `/api/top-values` accepts `n` up to 1000. 7 new spec tests pass; existing tests still green; tsc clean both sides.
  </done>
</task>

</tasks>

<verification>
**Phase-44 Plan 01 verification (run after all 3 tasks complete):**

```bash
# Frontend: filterStore + columnTypes specs + tsc + full widget regression
cd kinetica_bi
npx tsc --noEmit
npx vitest run src/store/filterStore.spec.ts src/lib/columnTypes.spec.ts src/components/DashboardsPage.spec.tsx src/components/charts/WidgetRenderer.spec.tsx

# Server: whereClause + filter-materialize specs + tsc
cd ../kinetica_bi/server
npx tsc --noEmit
AUTH_MODE=password npx vitest run tests/lib.whereClause.spec.ts tests/routes.filter-materialize.spec.ts
```

**Must-haves verification:**
- ActiveFilter optional operator: `grep -c "operator?: \"eq\" | \"in\" | \"between\" | \"isNull\"" kinetica_bi/src/store/filterStore.ts kinetica_bi/server/src/lib/whereClause.ts` returns ≥2 (one per file)
- IN emission: `grep -c "IN (" kinetica_bi/server/src/lib/whereClause.ts` returns ≥1
- BETWEEN emission: `grep -c "BETWEEN" kinetica_bi/server/src/lib/whereClause.ts` returns ≥1
- setBulkFilters: `grep -c "setBulkFilters:" kinetica_bi/src/store/filterStore.ts` returns ≥1
- 25-cap: `grep -c "FILTER_CAP_PER_TABLE = 25" kinetica_bi/src/store/filterStore.ts` returns 1
- chipText single source: `grep -c "const chipText = " kinetica_bi/src/components/DashboardsPage.tsx` returns 0
- top-values cap: `grep -c "body.n > 1000" kinetica_bi/server/src/index.ts` returns 1
</verification>

<success_criteria>
- All existing filterStore.spec.ts tests still pass (8 original + 12 new = 20 total minimum)
- All existing lib.whereClause.spec.ts tests still pass (existing + 11 new minimum)
- All existing routes.filter-materialize.spec.ts tests still pass (existing + 3 new minimum)
- All existing columnTypes.spec.ts tests still pass (existing + 7 new minimum)
- WidgetRenderer.spec.tsx (drill-down regression surface) passes unchanged — proves back-compat for ActiveFilter literals without `operator`
- Frontend `npx tsc --noEmit` clean
- Server `npx tsc --noEmit` clean
- No source file outside the plan's `files_modified` was modified
</success_criteria>

<output>
After completion, create `.planning/phases/44-data-filter-widget/44-01-SUMMARY.md` documenting:
- Final ActiveFilter type union (both sides)
- setBulkFilters semantics (replace-then-preserve, cap handling)
- buildServerWhereClause IN/BETWEEN code path summary
- Filter cap change (10→25) and any downstream UX implications surfaced
- Top-values n cap change (256→1000)
- chipText consolidation outcome and which spec proved the back-compat for legacy chips
- Any unexpected back-compat concerns discovered during execution (e.g., a 7th caller of `addFilter` that wasn't in RESEARCH §A)
</output>
