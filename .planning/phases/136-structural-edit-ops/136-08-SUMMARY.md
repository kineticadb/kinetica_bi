---
phase: 136-structural-edit-ops
plan: 08
subsystem: web-session-layer
tags: [ai-session, fold, removal-gate, heatmap-layer, set-layout]
requires: [136-01, 136-03, 136-07]
provides:
  - "foldSession/evaluateTurn for every Phase 136 op (add/edit/retype/rename/remove widget, add/restyle/remove heatmap layer, set_layout)"
  - "SessionDerived.layout/aiEditedWidgetIds/aiEditedLayerIds/widgetMeta; SessionBaseline.tables/maxBarGroupBySeriesCap"
  - "aiSessionStore.removalApproved/approveRemoval, selectAiEditedWidgetIds, geometry clearing on set_layout"
affects: [136-10, 136-11, 136-12]
key-files:
  modified:
    - packages/web/src/lib/aiSession/{types,constants,applySession,foldSession}.ts
    - packages/web/src/store/aiSessionStore.ts
    - packages/web/src/test/aiSessionHarness.ts
metrics:
  tasks: 3
completed: 2026-10-13
---

# Phase 136 Plan 08: Client session fold for structural ops

The client session layer now applies every Phase 136 op with app-generated SQL only (strip, catalogue validate, defaults, translate, derive), builds renderable heatmap layers, gates saved removals behind a per-conversation approval, and flags AI-edited saved content.

## Commits
- 27077ef Task 1: derived-state shape and ref-stable apply helpers
- 95bc7ad Task 2: fold Phase 136 ops
- 7a228a4 Task 3: removal gate, approval, geometry clearing, selector, spec repairs

## Evidence
- Strip mutation proof: replacing `strip(op.config)` with `{ ...op.config }` in `makeSessionWidget` makes FOLD6-2 fail (generated-SQL assertion on the direct `makeSessionWidget` call, plus customWhere/dynamicViewId/metricId/tableRef assertions); reverted, green. Positive control: the same direct call with the strip returns the generated SELECT and `table: "demo.trips"`.
- Gate mutation proof: deleting the two `op.id > 0 && !opts.removalApproved` lines fails FOLD6-5 and STORE6-1 (exactly those two); reverted, green.
- Red-first: Task 1 spec was red before implementation (3 failing). Task 2 deviated: foldSession code was written before the FOLD6 specs (specs then green first run), so red-first for Task 2 is demonstrated by the mutation proof rather than a pre-implementation red run. Task 3: FOLD6-5/STORE6-1/2/4 written first and red (`approveRemoval is not a function`, FOLD6-5 failing); after the gate landed exactly five pre-existing specs went red (AIHOOK-2, AIREAD-LEG-1, AIREAD-INFO-1, AISESS-5, AIREAD-MAP-1) and were repaired. AISTORE-2/3/4, EVAL-3, FOLD-4 were repaired in the same step as the new tests so their individual red was not separately observed (they cannot go red before the gate exists).
- Repaired specs (intent kept: each now calls `approveRemoval()` / passes `{ removalApproved: true }` before the saved removal): AISTORE-2, AISTORE-3, AISTORE-4, EVAL-3, FOLD-4, AIHOOK-2, AISESS-5, AIREAD-MAP-1, AIREAD-INFO-1, AIREAD-LEG-1. AiLeaveDialog.spec and aiLeaveGuard.spec unchanged and green. FOLD-5 `table_id: 0` -> `1` (Task 2).
- Gates: web `tsc --noEmit` clean; full `vitest run` 4620 passed, 1 failure = known flake WidgetRenderer.line.spec L132-21, which passes 28/28 when rerun alone; theme-guard 160/160.

## Deviations from Plan
1. [Rule 1] FOLD-2 (foldSession.spec) not listed in the plan: its `track_config` / `renderMode` patches are now rejected by the strict AI layer list. Repaired to `{opacity, name}` then `{colormap}` on a heatmap layer 7 in the local baseline; it still proves cross-turn deep-merge into `contribution.layer`. The top-level (track_config) split is no longer reachable through AI layer patches.
2. [Rule 3] store/aiSessionStore.spec.tsx line ~137 also asserted `renderMode: "heatmap"` on the merged overlay; changed to `colormap: "plasma"` along with the t2 patch.
3. [Rule 3] lib/aiSession/devHarness.spec.ts (not in files_modified): HFB-1/HFB-3 built a `bignumber` AI widget with `{}` config, which the catalogue now rejects (`config_rejected`, missing metric/aggregation). Changed to a `records` widget; intent (two visible AI widgets) unchanged.
4. FOLD6-1 op includes `limit: 10` to match the plan's expected SQL (`LIMIT 10`); AI_WIDGET_DEFAULTS has no limit so without it the default is `LIMIT 100`.
5. set_layout validation: `validateLayout` over the moved items plus an overlap check of moved rects against unmoved KNOWN rects, rather than validating the whole substituted set (a pre-existing overlap or default-position violation elsewhere on the dashboard would otherwise reject every AI layout). Plan text said "known rects with substitutions"; the plan's own example (FOLD6-8) overlaps an unmoved default-positioned widget, so the FOLD6-8 fixture uses explicit saved layouts.
6. add_widget with no `tableId` skips the table check (records/map/bignumber with `{}` config used by existing specs); only a present, unknown `tableId` yields `table_not_on_dashboard`.
7. AIREAD-MAP-2 restated per plan. To render, its baseline uses `tables: [{id: 10 ...}]` and `tableId: 10` (the map spec's `defaultTables` are ids 10..); AIREAD-MAP-3 uses harness `tableId: 1`, absent from the map's `tables` prop.

## Non-discriminating criteria
- "`grep -c FOLD6- foldSession.spec.ts >= 12`" counts title lines; before Task 3 it reads 12 with FOLD6-5 absent (ids 1,2,3,4,6..13 plus one comment). It does not prove FOLD6-5 exists; verified FOLD6-5 and 6-13 directly by test run and mutation.

## Notes for wave 5 (136-10 / 136-11)
- `SessionBaseline.tables` and `maxBarGroupBySeriesCap` are optional: DashboardsPage MUST pass them (table id, schema, name, columns) or table checks and SQL derivation are silently skipped for AI-added widgets.
- `derived.widgetMeta[id]` carries retyped type, title and regenerated sql for SAVED widgets; `applySessionToWidgets` applies it (ref-stable when empty). `derived.layout` is id -> rect for saved and temp widgets; DashboardsPage must read it ahead of config.layout and drag geometry (store already deletes geometry for moved ids).
- AI-added widgets carry `config.layout = op.layout` only when the op had one; placement for others is still DashboardsPage's job.
- `applySessionToLayers(saved, derived, tempVisibility = {})` already accepts the temp-visibility map (negative ids only); 136-11 supplies it.
- Approval: harness/UI calls `useAiSessionStore.getState().approveRemoval()`; skipped removals carry reason `needs_confirmation` in the turn entry so the UI can ask and replay. Fold itself never adds `metricId:null` to added widgets, and temp-widget patches are translated in the fold (saved patches stay raw in `contribution` and are translated/derived by WidgetRenderer, no double translation).
- Layer config for temp heatmap patch: `opacity` -> POINTOPACITY via `translateLayerOverlay` inside the fold.

## Self-Check: PASSED
Commits 27077ef, 95bc7ad, 7a228a4 exist; all listed files committed.
