---
phase: 11-map-chart
plan: "02"
subsystem: column-type utilities
tags: [spatial, helpers, pure-functions, tdd, map-chart]
dependency_graph:
  requires: []
  provides: [getValidSpatialColumns, autoSuggestSpatialMode, SpatialMode, Column]
  affects: [MapConfigPanel.tsx (Wave 3)]
tech_stack:
  added: []
  patterns: [pure-function library, TDD red-green, in-file constant reuse]
key_files:
  created: []
  modified:
    - kinetica_bi/src/lib/columnTypes.ts
    - kinetica_bi/src/lib/columnTypes.spec.ts
key_decisions:
  - "NUMERIC_TYPES reused in-file from Phase 10 (no export modifier change needed; the constant was already module-scoped and usable within the file)"
  - "normalizeType reused in-file from Phase 10 (single paren-stripping fn serves both drill-down and spatial helpers)"
  - "SpatialMode and Column exported as named types alongside helpers for direct Wave 3 import"
metrics:
  duration: "~2min"
  completed: "2026-05-05"
  tasks_completed: 2
  files_modified: 2
requirements_satisfied: [MAP-02]
---

# Phase 11 Plan 02: Spatial Column Helper Summary

One-liner: Pure spatial column helpers (getValidSpatialColumns + autoSuggestSpatialMode) with auto-suggest precedence ladder added to the Phase 10 column-type utilities file.

## What Was Built

Two pure functions added to `kinetica_bi/src/lib/columnTypes.ts` as a Phase 11 append (no Phase 10 lines touched):

### New Exports

| Export | Kind | Description |
|--------|------|-------------|
| `SpatialMode` | type | `"latlon" \| "wkt" \| "wkb"` union |
| `Column` | type | `{ name: string; type: string }` |
| `getValidSpatialColumns` | function | Filters a column list to those valid for the given spatial mode |
| `autoSuggestSpatialMode` | function | Inspects column list and returns the best-fit spatial mode |

### Auto-Suggest Precedence Ladder (verbatim — for downstream plan consumption)

1. Any column with `type` in `KINETICA_GEOMETRY_TYPES` (`geometry`, `geography`, `wkb`, `point`) → `"wkb"`
2. Any column with `type` containing `"wkt"` (case-insensitive substring) → `"wkt"`
3. Both a lat-named column (`/^(lat|latitude|y)$/i`) AND a lon-named column (`/^(lon|lng|longitude|x)$/i`) present → `"latlon"`
4. Fallback → `"latlon"`

### Type-Sets Used by getValidSpatialColumns

| Mode | Accepts |
|------|---------|
| `latlon` | NUMERIC_TYPES (reused from Phase 10) |
| `wkt` | STRING_TYPES ∪ {"wkt"} (`string`, `varchar`, `text`, `char`, `wkt`) |
| `wkb` | KINETICA_GEOMETRY_TYPES (`geometry`, `geography`, `wkb`, `point`) |

All type matching is case-insensitive via `normalizeType()` (strips parens, lowercases) — same function as Phase 10.

## Test Count Delta

| Baseline (Phase 10) | New (Phase 11) | Total |
|---------------------|----------------|-------|
| 20 tests | 16 tests | 36 tests (columnTypes.spec.ts) |

Full suite: 106 (pre-plan baseline) + 16 new = 122 tests passing.

## NUMERIC_TYPES Status

`NUMERIC_TYPES` is module-scoped (no `export` keyword) in Phase 10's declaration. It was **reused in-file** by the Phase 11 helpers — no `export` modifier was added and none was needed. The constant is accessible to `getValidSpatialColumns` because both declarations live in the same module.

## Commits

| Task | Hash | Message |
|------|------|---------|
| Task 1 (RED spec) | 263b2a9 | `test(11-02): add failing spec for spatial column helpers` |
| Task 2 (GREEN impl) | 1f7d540 | `feat(11-02): add getValidSpatialColumns + autoSuggestSpatialMode helpers` |

## Deviations from Plan

None — plan executed exactly as written.

## Wave 3 Consumption Contract

MapConfigPanel.tsx (plan 11-08) should import as:

```typescript
import {
  getValidSpatialColumns,
  autoSuggestSpatialMode,
  type SpatialMode,
  type Column,
} from "../lib/columnTypes";
```

`autoSuggestSpatialMode` is called once on first config-modal open when `widget.config.spatialMode` is unset. `getValidSpatialColumns` populates the spatial-column dropdowns based on the active mode.

## Self-Check

Verified: `kinetica_bi/src/lib/columnTypes.ts` — FOUND
Verified: `kinetica_bi/src/lib/columnTypes.spec.ts` — FOUND
Verified commit 263b2a9 — FOUND
Verified commit 1f7d540 — FOUND

## Self-Check: PASSED
