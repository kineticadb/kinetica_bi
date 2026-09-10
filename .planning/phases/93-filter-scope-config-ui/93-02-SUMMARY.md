---
phase: 93-filter-scope-config-ui
plan: "02"
subsystem: filter-scope-persistence-and-layer-ui
tags: [filter-scope, persistence, both-stack, layer-form, supertests]
dependency_graph:
  requires: [phase-93-plan-01, phase-92-map-wiring, phase-89-server-foundation]
  provides: [filter_scope-persistence, KineticaWmsLayerForm-filter-scope, widgets-threading]
  affects: [DashboardLayerDto, updateDashboardLayer, PATCH-layers-route, LayersModal, KineticaWmsLayerForm, useCombinationOrchestrator]
tech_stack:
  added: []
  patterns: [track_config-toplevel-mirror, json-stringify-write-json-parse-read, key-in-attrs-discriminant, controlled-component-prop-threading]
key_files:
  created: []
  modified:
    - packages/server/src/types.ts
    - packages/server/src/db.ts
    - packages/server/src/index.ts
    - packages/server/tests/layers.spec.ts
    - packages/web/src/api/client.ts
    - packages/web/src/hooks/useCombinationOrchestrator.ts
    - packages/web/src/hooks/useCombinationOrchestrator.spec.ts
    - packages/web/src/components/charts/KineticaWmsLayerForm.tsx
    - packages/web/src/components/LayersModal.tsx
    - packages/web/src/components/DashboardsPage.tsx
    - packages/web/src/components/LayersModal.spec.tsx
    - packages/web/src/components/charts/KineticaWmsLayerForm.spec.tsx
decisions:
  - "filter_scope travels as OBJECT on the wire: route stringifies FilterSelectionConfig object to JSON string on write (index.ts); mapDashboardLayer JSON.parses to object on read (db.ts). Both sides explicit — no vague cast as needed."
  - "updateDashboardLayer fallback for existing.filter_scope must re-stringify: mapDashboardLayer returns parsed object; preserve-on-omit must JSON.stringify before passing to better-sqlite3 to avoid bindable-value error."
  - "snake_case filter_scope used on both DTO and DB column (matches cb_config/track_config convention); camelCase filterScope in local KineticaWmsLayerForm prop names is TypeScript-internal only."
  - "FilterSelectionPanel rendered as last config-group after INFO POPUP in KineticaWmsLayerForm; KineticaWmsLayerForm.spec.tsx L1 updated to reflect new last section."
metrics:
  duration_seconds: 982
  completed_date: "2026-06-28"
  tasks_completed: 3
  tasks_total: 3
  files_created: 0
  files_modified: 12
---

# Phase 93 Plan 02: filter_scope End-to-End Persistence + KineticaWmsLayerForm Filter Scope UI Summary

**One-liner:** filter_scope TOP-LEVEL persistence end-to-end (SQLite column + PATCH route stringify/parse round-trip + DTO/updateLayer Pick + orchestrator rename) + FilterSelectionPanel integrated into KineticaWmsLayerForm with widgets threading from DashboardsPage, proven by both-auth-mode supertests and LayersModal top-level-vs-config-split spec assertion.

---

## What Was Built

### Task 1: Server filter_scope persistence (6 closed gaps)

**types.ts:** `filter_scope: string | null` added to `DashboardLayer` after `track_config`. This is the column-level type (string, not object).

**db.ts DDL:** `filter_scope TEXT,` added after `track_config TEXT,` in the `CREATE TABLE dashboard_layers` block (fresh installs).

**db.ts PRAGMA ALTER:** Third guarded ALTER added after the `track_config` guard:
```ts
if (!layerColNames.has("filter_scope")) {
  instance.exec("ALTER TABLE dashboard_layers ADD COLUMN filter_scope TEXT");
}
```
Idempotent — second boot is a no-op.

**db.ts mapDashboardLayer (read side):** Parses JSON string to object on read:
```ts
filter_scope: (row.filter_scope ? JSON.parse(row.filter_scope) : undefined) as any,
```
The `as any` cast bridges the column type (`string | null`) to the DTO wire type (`FilterSelectionConfig | undefined`).

**db.ts updateDashboardLayer (preserve-on-omit):** Added `filter_scope` to the `Partial<Pick<DashboardLayer, ...>>` signature, UPDATE SQL column + `?`, and the `"key" in attrs` discriminant. Critical deviation: `existing.filter_scope` at this layer comes from `mapDashboardLayer` which parsed it to an object — the preserve-on-omit fallback must re-stringify to avoid a "too few parameters" error from better-sqlite3:
```ts
"filter_scope" in attrs
  ? attrs.filter_scope
  : (existing.filter_scope == null ? existing.filter_scope : JSON.stringify(existing.filter_scope)),
```

**index.ts PATCH route (write side):** Added `"filter_scope"` to the body `Partial<Pick<DashboardLayer, ...>>`. Before calling `updateDashboardLayer`, when `"filter_scope" in body`, stringify the FilterSelectionConfig object:
```ts
if ("filter_scope" in body) {
  const rawFilterScope = (body as any).filter_scope;
  body.filter_scope = rawFilterScope == null ? null : JSON.stringify(rawFilterScope);
}
```
Guard prevents unnecessary stringify when field is absent (preserve-on-omit).

**layers.spec.ts:** Added password-mode trio (round-trip / null-clear / preserve-on-omit) + OIDC smoke describe block with round-trip + null-clear. All 23 tests pass.

### Task 2: Client naming reconciliation

**client.ts DTO:** Renamed `filterScope?: FilterSelectionConfig` → `filter_scope?: FilterSelectionConfig | null` (snake_case; matches DB column + cb_config/track_config convention).

**client.ts updateLayer Pick:** Added `"filter_scope"` so PATCH payloads include the field.

**useCombinationOrchestrator.ts:** `layer.filterScope as FilterSelectionConfig | undefined` → `layer.filter_scope ?? undefined` (no cast needed — already an object from mapDashboardLayer parse).

**useCombinationOrchestrator.spec.ts:** `makeLayer` factory: `filterScope` overrides key + spread renamed to `filter_scope`.

**Result:** Zero live camelCase `filterScope` references in `packages/web/src`. One acceptable comment in `MapChartRenderer.tsx:554`.

### Task 3: KineticaWmsLayerForm Filter Scope section + widget threading

**KineticaWmsLayerForm.tsx props added:**
```typescript
widgets?: WidgetDto[];
filterScope?: DashboardLayerDto["filter_scope"];
onChangeFilterScope?: (next: FilterSelectionConfig | undefined) => void;
```

**FilterSelectionPanel insertion** (last config-group, after INFO POPUP):
```tsx
<FilterSelectionPanel
  value={filterScope ?? undefined}
  onChange={(next: FilterSelectionConfig | undefined) => onChangeFilterScope?.(next)}
  widgets={widgets}
/>
```
No `selfWidgetId` — layers are not widgets, no self-exclusion.

**LayersModal.tsx:** Added `widgets?: WidgetDto[]` to `LayersModalProps` + destructure. Threaded to `KineticaWmsLayerForm` with `filterScope` and `onChangeFilterScope` following the `onChangeInfoConfig` pattern (TOP-LEVEL, NOT in config blob):
```tsx
widgets={widgets}
filterScope={selectedLayer.filter_scope ?? undefined}
onChangeFilterScope={(next) => onPatch(selectedLayer.id, { filter_scope: next ?? null })}
```

**DashboardsPage.tsx:** `widgets={widgets}` added to `<LayersModal>` render.

**LayersModal.spec.tsx Tests 20 & 21:** Widget-threading assertion (filter-producing widget appears in checklist when allowlist mode pre-set) + Pitfall-1 top-level-vs-config-split assertion (onPatch called with `filter_scope` at top level; `patchArg.config?.filter_scope` is undefined).

**KineticaWmsLayerForm.spec.tsx L1:** Updated to reflect Filter Scope as new last section (INFO POPUP now second-to-last).

---

## Wire Format Decision (Object on Wire, String in DB)

The wire format is an object (`FilterSelectionConfig`) on both the request body and the response JSON. The DB stores a JSON string. The conversion is explicit at both ends:

| Site | Direction | Operation |
|------|-----------|-----------|
| `index.ts` PATCH route | Write | `JSON.stringify(rawFilterScope)` before `updateDashboardLayer` |
| `db.ts mapDashboardLayer` | Read | `JSON.parse(row.filter_scope)` in the mapper |
| `db.ts updateDashboardLayer` | Preserve-on-omit | `JSON.stringify(existing.filter_scope)` (already an object from the mapper) |

`track_config` travels as a raw string on the wire (client sends string, server stores verbatim). `filter_scope` differs: client sends the parsed object, server stringifies. This was intentional per plan decision: the orchestrator reads `layer.filter_scope` as an object (`FilterSelectionConfig | undefined`) — keeping it as a string on the DTO would have required an extra parse at the orchestrator.

---

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Re-stringify existing.filter_scope in preserve-on-omit path**

- **Found during:** Task 1 — "PATCH that omits filter_scope preserves" test failed with "Too few parameter values were provided"
- **Issue:** `mapDashboardLayer` returns `existing.filter_scope` as a parsed JS object (via `JSON.parse`). When `updateDashboardLayer` falls back to `existing.filter_scope` for the preserve-on-omit case, better-sqlite3 cannot bind a plain object as a TEXT parameter.
- **Fix:** Detect non-null `existing.filter_scope` in the discriminant fallback and re-stringify it: `existing.filter_scope == null ? existing.filter_scope : JSON.stringify(existing.filter_scope)`
- **Files modified:** `packages/server/src/db.ts`
- **Commit:** `1a10ef6`

**2. [Rule 1 - Bug] FilterSelectionPanel is a named export, not default**

- **Found during:** Task 3 — `npx tsc --noEmit` error TS2613
- **Issue:** `import FilterSelectionPanel from "./FilterSelectionPanel"` fails — Plan 01 exported it as `export function FilterSelectionPanel`
- **Fix:** Changed to named import `import { FilterSelectionPanel } from "./FilterSelectionPanel"`
- **Files modified:** `packages/web/src/components/charts/KineticaWmsLayerForm.tsx`
- **Commit:** `00e753a`

**3. [Rule 1 - Bug] KineticaWmsLayerForm.spec.tsx L1 assertion updated**

- **Found during:** Task 3 full suite run — L1 asserted INFO POPUP is the last config-group
- **Issue:** Filter Scope is now the last config-group (after INFO POPUP). Existing assertion failed.
- **Fix:** Updated assertion to verify Filter Scope is last and INFO POPUP is second-to-last
- **Files modified:** `packages/web/src/components/charts/KineticaWmsLayerForm.spec.tsx`
- **Commit:** `00e753a`

**4. [Rule 1 - Bug] LayersModal spec Test 20 must use pre-set allowlist layer**

- **Found during:** Task 3 — Test 20 tried to click Customize to reveal the checklist, but LayersModal is controlled; clicking doesn't re-render with new filterScope
- **Issue:** The component is controlled — `selectedLayer.filter_scope` comes from the prop; `onPatch` fires but the parent doesn't update the layer in the test
- **Fix:** Pass `mkLayer(1, 10, { filter_scope: { sourceMode: "allowlist", allowedSourceWidgetIds: [] } })` so the checklist renders immediately
- **Files modified:** `packages/web/src/components/LayersModal.spec.tsx`
- **Commit:** `00e753a`

---

## Verification Results

- `cd packages/server && npx tsc --noEmit` — clean
- `cd packages/server && npx vitest run tests/layers.spec.ts` — 23/23 pass (all new filter_scope tests green)
- `cd packages/server && npx vitest run` — failing files ⊆ TD-V16-TEST-ISOLATION set (auth.oidc, auth.routes, boot specs, oidc.module, routes.dynamic-view, routes.filter-materialize, routes.wms — all pre-existing); layers.spec.ts is NOT in failing set
- `cd packages/web && npx tsc --noEmit` — clean
- `cd packages/web && npx vitest run` — 127 test files, 2919 tests, 100% pass (unhandled rejections are pre-existing TD-V16-TEST-ISOLATION cross-test pollution from InfoPopup + InfoCardRenderer)
- `cd packages/web && npx vitest run src/styles/theme-guard.spec.ts` — 130 tests green
- `grep -rn "filterScope" packages/web/src` — only comment at MapChartRenderer.tsx:554 + local prop names in KineticaWmsLayerForm.tsx (TypeScript-internal, not DTO field names)

## Self-Check: PASSED
