---
phase: 75-column-display-config-foundation
plan: 03
subsystem: ui
tags: [zustand, store, formatter, typescript, vitest, pure-helpers, api-client]

# Dependency graph
requires:
  - phase: 75-01
    provides: "GET /api/tables/:tableId/column-display-config endpoint + ColumnDisplayConfigRow server DTO"
  - phase: 75-02
    provides: "FormatSpec union + buildFormatter factory in packages/web/src/lib/columnFormatter.ts"
provides:
  - "useColumnDisplayConfigStore (Zustand) in packages/web/src/store/columnDisplayConfigStore.ts"
  - "ColumnDisplayConfigState type: configs (per-table_id cache) + configVersion + setConfig/upsertColumn/removeColumn/loadConfig/reset"
  - "resolveLabel(tableId, col) → label ?? rawColumnName (pure getState()-based, not a React hook)"
  - "resolveFormatter(tableId, col) → buildFormatter(spec) | identity (pure getState()-based, not a React hook)"
  - "listColumnDisplayConfig/upsertColumnDisplayConfig/deleteColumnDisplayConfig fetch helpers in packages/web/src/api/client.ts"
  - "ColumnDisplayConfigRow client type in packages/web/src/api/client.ts"
  - "Store reset wired into DashboardsPage.tsx canonical 8-store cleanup block"
affects:
  - 76 (editor UI — writes via upsertColumnDisplayConfig/deleteColumnDisplayConfig; reads current config via store)
  - 77 (render surfaces — resolveLabel/resolveFormatter for column headers + cell formatting + tooltip labels)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "dynamicViewStore mirror: per-key cache + top-level version counter bumped every mutation (even byte-identical)"
    - "strict no-op remove: return state reference when table/key absent, no version bump"
    - "pure resolver helpers co-located in store file (getState() calls forbid pure-lib placement)"
    - "resolveFormatter identity fallback: spec ? buildFormatter(spec) : (v) => v"
    - "resolveLabel raw-name fallback: label ?? columnName"

key-files:
  created:
    - "packages/web/src/store/columnDisplayConfigStore.ts"
    - "packages/web/src/store/columnDisplayConfigStore.spec.ts"
  modified:
    - "packages/web/src/api/client.ts"
    - "packages/web/src/components/DashboardsPage.tsx"
    - "packages/web/src/components/DashboardsPage.spec.tsx"

key-decisions:
  - "resolveLabel/resolveFormatter co-located in columnDisplayConfigStore.ts (not columnFormatter.ts) because they call useColumnDisplayConfigStore.getState() — the pure lib forbids store imports"
  - "configVersion bumps unconditionally on every setConfig/upsertColumn — mirrors dynamicViewVersion Pitfall 5"
  - "removeColumn strict no-op: return s (state reference) when table or column absent — mirrors dynamicViewStore.clearView"
  - "loadConfig is async and on the store (not a hook) so any consumer can trigger on-demand fetch"
  - "ColumnDisplayConfigRow client type lives in api/client.ts alongside the fetch helpers (not types.ts which is server-side)"

requirements-completed: [COLCFG-V115-03]

# Metrics
duration: 6min
completed: 2026-06-20
---

# Phase 75 Plan 03: columnDisplayConfigStore + api/client helpers + lifecycle reset Summary

**Zustand column display config store (per-table cache + configVersion) + resolveLabel/resolveFormatter pure helpers + 3 api/client fetch functions (list/upsert/delete) + DashboardsPage reset wiring — 24 new store tests, full 2518-test suite green, web tsc clean**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-06-20T02:07:40Z
- **Completed:** 2026-06-20T02:13:08Z
- **Tasks:** 2
- **Files modified:** 5 (client.ts, columnDisplayConfigStore.ts, columnDisplayConfigStore.spec.ts, DashboardsPage.tsx, DashboardsPage.spec.tsx)

## Accomplishments

### Task 1: api/client.ts additions

- Added `ColumnDisplayConfigRow` client type with `{ table_id: number; column_name: string; label: string | null; format_spec: FormatSpec | null; created_at: string; updated_at: string }` — FormatSpec imported from `../lib/columnFormatter`
- Added `listColumnDisplayConfig(tableId)` — GET fetch, returns `json.data` array
- Added `upsertColumnDisplayConfig(tableId, columnName, label, formatSpec)` — PUT with JSON body
- Added `deleteColumnDisplayConfig(tableId, columnName)` — DELETE, both use `encodeURIComponent(columnName)`
- All three follow `apiFetch` + `throwForStatus` pattern (mirrors `listDashboardTables`)

### Task 2: columnDisplayConfigStore.ts + spec + DashboardsPage wiring

- Created `useColumnDisplayConfigStore` with `configs: Record<number, ColumnDisplayConfigEntry>` (keyed by `table_id`) and `configVersion: number` top-level counter
- `setConfig` — REPLACE semantics; builds columns map from rows; bumps configVersion unconditionally
- `upsertColumn` — MERGE semantics; sets/overwrites one column entry; bumps configVersion unconditionally (byte-identical too — Pitfall 5 mirror)
- `removeColumn` — STRICT NO-OP when `configs[tableId]` absent OR `columns[col]` absent: returns `s` (state reference), no version bump (mirrors `dynamicViewStore.clearView`)
- `loadConfig(tableId)` — async action: calls `listColumnDisplayConfig`, feeds rows into `setConfig`
- `reset()` — hard-set to `{ configs: {}, configVersion: 0 }` (NOT an increment)
- Exported `resolveLabel(tableId, col)` and `resolveFormatter(tableId, col)` as pure getState()-based functions
- Created 24-test spec covering all semantics; DashboardsPage.spec.tsx updated (8th store added to cleanup assertions)
- Wired `useColumnDisplayConfigStore.getState().reset()` as the 8th store in DashboardsPage.tsx canonical cleanup block (after `useWidgetActionStore`)

## Task Commits

1. **Task 1: Add column-display-config fetch helpers to api/client.ts** - `cc1f8b1` (feat)
2. **Task 2: columnDisplayConfigStore + resolveLabel/resolveFormatter + lifecycle reset** - `1d57731` (feat)

## Files Created/Modified

- `packages/web/src/store/columnDisplayConfigStore.ts` — New: store + resolveLabel + resolveFormatter (143 lines)
- `packages/web/src/store/columnDisplayConfigStore.spec.ts` — New: 24 unit tests
- `packages/web/src/api/client.ts` — ColumnDisplayConfigRow type + 3 fetch helpers appended
- `packages/web/src/components/DashboardsPage.tsx` — import + 8th reset call in cleanup useEffect
- `packages/web/src/components/DashboardsPage.spec.tsx` — import + "SIX" → "EIGHT" stores test updated

## Store Selectors / Helpers for Downstream Plans

### Phase 76 (editor UI) consumes:
- `useColumnDisplayConfigStore` — read `configs[tableId]` for current column values
- `upsertColumnDisplayConfig(tableId, columnName, label, formatSpec)` — save per-column config
- `deleteColumnDisplayConfig(tableId, columnName)` — clear per-column config
- After save: call `useColumnDisplayConfigStore.getState().upsertColumn(...)` to reflect changes in the store

### Phase 77 (render surfaces) consumes:
- `resolveLabel(tableId, columnName): string` — column headers (records-table) + tooltip labels + axis labels
- `resolveFormatter(tableId, columnName): (v: unknown) => string | unknown` — cell formatting + tooltip values

### On-demand loading:
- `useColumnDisplayConfigStore.getState().loadConfig(tableId)` — fetch and cache all rows for a table (call once per table on mount; configVersion bump signals downstream re-render)

## Decisions Made

- **resolveLabel/resolveFormatter live in columnDisplayConfigStore.ts** — they call `useColumnDisplayConfigStore.getState()`, making them store-coupled. The pure lib (`columnFormatter.ts`) explicitly forbids store imports. Co-locating the helpers in the store file is the only correct placement.
- **ColumnDisplayConfigRow type in api/client.ts** — the server DTO is a client-facing type (used by fetch helpers, the store's setConfig, and upsertColumn calls). It belongs next to the fetch helpers, not in a server types file.
- **configVersion bumps unconditionally** — exact same reasoning as `dynamicViewVersion`: Phase 77 renderers use `configVersion` in dep arrays to trigger re-render; a byte-identical upsert (e.g. admin confirms same spec) must still signal change.

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None.

## Self-Check: PASSED

- `packages/web/src/store/columnDisplayConfigStore.ts` — FOUND
- `packages/web/src/store/columnDisplayConfigStore.spec.ts` — FOUND
- `packages/web/src/api/client.ts` — FOUND (modified with 3 helpers + type)
- `packages/web/src/components/DashboardsPage.tsx` — FOUND (reset wired)
- `packages/web/src/components/DashboardsPage.spec.tsx` — FOUND (8th store added)
- Commit `cc1f8b1` — FOUND (Task 1)
- Commit `1d57731` — FOUND (Task 2)
- `grep configVersion: s.configVersion + 1 columnDisplayConfigStore.ts` — 3 matches (setConfig, upsertColumn, removeColumn-when-present)
- `grep reset: () => set` — FOUND (hard-set to 0)
- `grep resolveLabel\|resolveFormatter` — BOTH exported
- `grep buildFormatter(` — FOUND in resolveFormatter
- `grep ?? columnName` — FOUND in resolveLabel
- `grep useColumnDisplayConfigStore.getState().reset()` in DashboardsPage.tsx — FOUND
- `cd packages/web && npx vitest --run src/store/columnDisplayConfigStore.spec.ts` — 24/24 PASSED
- `cd packages/web && npm test` — 2518/2518 PASSED (all 107 test files)
- `cd packages/web && npx tsc --noEmit` — CLEAN

## Next Phase Readiness

- Phase 76 (Column Formatting Editor UI): ready to build. Import `ColumnDisplayConfigRow` and fetch helpers from `api/client.ts`; read current config from `useColumnDisplayConfigStore`; write via `upsertColumnDisplayConfig` + `deleteColumnDisplayConfig`; update store after save via `upsertColumn`/`removeColumn`
- Phase 77 (Apply Labels + Formatting at Render Surfaces): ready to build. Import `resolveLabel` + `resolveFormatter` from `columnDisplayConfigStore.ts`; call `loadConfig(tableId)` on mount; subscribe to `configVersion` as the re-render dep signal
- No blockers.

---
*Phase: 75-column-display-config-foundation*
*Completed: 2026-06-20*
