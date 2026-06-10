---
phase: 58-action-engine-contract-allow-list-canary
plan: 01
subsystem: ui
tags: [zod, widget-action, allow-list, validation, action-engine, safety]

# Dependency graph
requires: []
provides:
  - "WidgetActionSchema (zod) — serializable {target:{kind,id}, configPatch} envelope"
  - "WidgetActionResult discriminated union (applied/target_not_found/rejected)"
  - "ALLOW_LIST_VERSION v1 — versioned per-(kind/widgetType) patchable-field map"
  - "validateActionPatch() — blocking AI-safety contract (unknown/wrong-type/enum/meta/proto rejection)"
affects:
  - 58-02 (action router consumes WidgetAction type + validateActionPatch)
  - 59 (radio widget config-panel produces WidgetAction envelopes)
  - 60 (radio renderer dispatches WidgetActions through the engine)
  - 61 (verification of full engine + allow-list)

# Tech tracking
tech-stack:
  added: ["zod@^3 (packages/web only — zero server changes)"]
  patterns:
    - "Pure-logic lib modules (no React/Zustand) for engine contracts — unit-testable in isolation"
    - "TDD RED→GREEN for each task: failing spec first, minimal impl to pass"
    - "PERMANENTLY_BLOCKED_KEYS enumeration via Object.keys() — never spread untrusted patch before validation"
    - "__proto__ test must use JSON.parse to create own property (object literal silently sets prototype)"

key-files:
  created:
    - "packages/web/src/lib/widgetAction.ts — WidgetActionSchema + WidgetActionResult + INVARIANT comment"
    - "packages/web/src/lib/widgetAction.spec.ts — 14 tests: JSON round-trip + valid parse + 5 rejection cases"
    - "packages/web/src/lib/actionAllowList.ts — ALLOW_LIST_VERSION + allow-list seed + validateActionPatch"
    - "packages/web/src/lib/actionAllowList.spec.ts — 23 tests: 9 positive + 14 rejection cases"
  modified:
    - "packages/web/package.json — added zod@^3"
    - "package-lock.json — updated with zod"

key-decisions:
  - "zod@^3 in packages/web only — confirmed absent from packages/server/package.json"
  - "Allow-list seed: map (show_popup/show_scale_bar/show_fullscreen), chart (metric/aggregation enum: sum/avg/min/max/count/count_distinct), records (page_size), layer (render_mode enum/visible/opacity/track_config/cb_config), dynamicView (enabled)"
  - "track_config and cb_config in layer allow-list are TOP-LEVEL DashboardLayerDto fields (z.string()), NOT config.track_config — mirrors [[track-config-toplevel-field]] memory"
  - "__proto__ test uses JSON.parse() not object literal — object literal { __proto__: ... } silently mutates prototype and produces no own-property key"
  - "validateActionPatch uses Object.keys() enumeration (never spreads untrusted patch before validation) to prevent prototype pollution at the validation boundary"
  - "INVARIANT: ACTION-ENGINE-NO-FILTER comment in widgetAction.ts — engine never imports filter-store symbols; enforced by static grep in Plan 58-02"

patterns-established:
  - "Action envelope pattern: serializable {target:{kind,id}, configPatch} — no closures/refs, JSON-round-trips unchanged"
  - "Allow-list-as-AI-safety: validateActionPatch is the binding gate; router never free-form Object.assigns"
  - "Versioned allow-list: ALLOW_LIST_VERSION constant + per-(kind/widgetType) zod field validators"
  - "Blocked key enumeration before allow-list lookup — meta/proto rejections are unconditional"

requirements-completed: [ENGINE-V111-01, SAFETY-V111-01]

# Metrics
duration: 7min
completed: 2026-06-10
---

# Phase 58 Plan 01: Action Engine Contract + Allow-List Summary

**Serializable zod-validated `{target:{kind,id}, configPatch}` widget-action envelope + versioned ALLOW_LIST_VERSION v1 allow-list guarding against unknown/wrong-type/enum/meta/proto patches, with 37 passing tests (14 envelope + 23 allow-list)**

## Performance

- **Duration:** 7 min
- **Started:** 2026-06-10T19:38:34Z
- **Completed:** 2026-06-10T19:45:40Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments

- Installed `zod@^3` in `packages/web` only — verified absent from `packages/server/package.json`
- Created `widgetAction.ts`: `WidgetActionSchema` (zod), `WidgetActionResult` discriminated union, `TARGET_KINDS`, `INVARIANT: ACTION-ENGINE-NO-FILTER` documentation
- Created `actionAllowList.ts`: `ALLOW_LIST_VERSION = "v1"`, `PERMANENTLY_BLOCKED_KEYS`, per-(kind/widgetType) allow-list seed, `validateActionPatch()` with safe Object.keys enumeration
- 37 new tests: 14 envelope (round-trip + valid + 5 rejection) + 23 allow-list (9 positive + 14 rejection); full suite 1762/1762 green; `tsc --noEmit` clean; zero server diff

## Task Commits

Each task was committed atomically:

1. **Task 1: Add zod + serializable action envelope + typed result** — `f21a9a1` (feat)
2. **Task 2: Versioned allow-list + validateActionPatch** — `d4da539` (feat)

_Both tasks used TDD: RED (failing spec) → GREEN (minimal impl) flow_

## Test Gates

| Gate | Result |
|------|--------|
| `cd packages/web && npx vitest run` | 1762/1762 passed (84 files) — baseline was 1725 (+37 new) |
| `npx tsc --noEmit -p packages/web` | Clean (exit 0) |
| `git diff --name-only -- packages/server` | Empty — zero server changes |
| `grep '"zod"' packages/server/package.json` | Not found — zod is web-only |

## Allow-List Seed (exact fields per kind/type)

| Kind | Widget Type | Fields |
|------|------------|--------|
| `widget` | `map` | `show_popup: z.boolean()`, `show_scale_bar: z.boolean()`, `show_fullscreen: z.boolean()` |
| `widget` | `chart` | `metric: z.string()`, `aggregation: z.enum(["sum","avg","min","max","count","count_distinct"])` |
| `widget` | `records` | `page_size: z.number().int().positive()` |
| `layer` | N/A | `render_mode: z.enum(["raster","heatmap","classbreak","contour"])`, `visible: z.boolean()`, `opacity: z.number().min(0).max(1)`, `track_config: z.string()` (TOP-LEVEL), `cb_config: z.string()` (TOP-LEVEL) |
| `dynamicView` | N/A | `enabled: z.boolean()` |

## Files Created/Modified

- `packages/web/package.json` — added `"zod": "^3.25.76"` to dependencies
- `packages/web/src/lib/widgetAction.ts` — envelope schema + types + result union + INVARIANT comment
- `packages/web/src/lib/widgetAction.spec.ts` — 14 tests
- `packages/web/src/lib/actionAllowList.ts` — versioned allow-list + validateActionPatch
- `packages/web/src/lib/actionAllowList.spec.ts` — 23 tests (5+ rejection categories)
- `package-lock.json` — updated

## Decisions Made

- **zod range:** `^3.25.76` installed (satisfies `^3` — latest v3); plan specified `^3.23.8` minimum
- **`__proto__` test approach:** Object literal `{ __proto__: ... }` silently mutates the prototype chain and never creates an own-property key — `Object.keys()` returns `[]`. Test correctly uses `JSON.parse('{"__proto__":...}')` which creates `__proto__` as an own enumerable property (the real attack vector)
- **track_config/cb_config as `z.string()`:** These TOP-LEVEL DashboardLayerDto fields carry JSON strings (see client.ts DashboardLayerDto); allow-list validates they are strings (callers must pre-stringify). NOT `z.record()` — they are raw JSON strings on the DTO
- **PERMANENTLY_BLOCKED_KEYS includes `widgetId`/`dashboardId`/`dashboard_id`/`table_id`/`position`** — extended beyond minimum spec for completeness of identity/structural mutation prevention

## Deviations from Plan

None — plan executed exactly as written. The `__proto__` test adjustment (using `JSON.parse` instead of object literal) was correcting a JavaScript semantic in the spec, not a deviation from the spec's intent.

## Issues Encountered

One test failed on first GREEN run: the `__proto__` rejection test used `{ __proto__: { isAdmin: true } }` object literal syntax, which in JavaScript silently sets the prototype (not an own property) — `Object.keys()` returns `[]`. Fixed the test to use `JSON.parse('{"__proto__": ...}')` which correctly creates `__proto__` as an own enumerable property (the real JSON-injection attack vector). The `validateActionPatch` implementation was already correct.

## Next Phase Readiness

- `WidgetAction` type + `WidgetActionSchema` ready for Plan 58-02 (action router)
- `validateActionPatch` ready for Plan 58-02 router to call before dispatching
- `WidgetActionResult` discriminated union defined — router fills in `status` at dispatch time
- `INVARIANT: ACTION-ENGINE-NO-FILTER` grep target established for Plan 58-02 static assertion
- Allow-list seed includes map render-mode + layer track_config/cb_config — the primary Phase 59/60 use case (radio switching layer render mode) is covered

---
*Phase: 58-action-engine-contract-allow-list-canary*
*Completed: 2026-06-10*
