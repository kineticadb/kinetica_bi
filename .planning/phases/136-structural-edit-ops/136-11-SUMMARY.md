---
phase: 136-structural-edit-ops
plan: 11
subsystem: web-dev-harness
tags: [ai-session, dev-harness, temp-layer-visibility, e2e]
requires: [136-02, 136-08]
provides:
  - "__kbiAiHarness methods for every Phase 136 op incl. approveRemoval()"
  - "aiSessionStore.tempLayerVisibility/setTempLayerVisible; session-only legend eye for AI layers"
  - "structuralOps.e2e.spec.ts (E2EW6-1..5): scripted session with undo, WMS params, palette proof"
key-files:
  modified:
    - packages/web/src/lib/aiSession/devHarness.ts (+spec)
    - packages/web/src/hooks/useLayerVisibilityToggle.ts (+spec)
    - packages/web/src/hooks/useEffectiveLayers.ts
    - packages/web/src/store/aiSessionStore.ts (+spec)
  created:
    - packages/web/src/lib/aiSession/structuralOps.e2e.spec.ts
metrics:
  tasks: 2
completed: 2026-10-13
---

# Phase 136 Plan 11: DEV harness, session-only AI layer eye, client e2e

The console harness drives every Phase 136 op, the legend eye on AI-added layers toggles in the session only, and one scripted store-level session proves add/edit/retype/remove, heatmap add/restyle/remove, set_layout and full undo/redo.

## Commits
- 6f8d830 Task 1: harness methods, temp-layer visibility store/eye/useEffectiveLayers
- c9ce3eb Task 2: structuralOps.e2e.spec.ts

## Evidence
- Mutation proof (Task 2): changing `{ removalApproved: s.removalApproved }` to `{ removalApproved: false }` in applyTurn fails E2EW6-1/2 and E2EW6-3 (turn 3 stays skipped); reverted (git checkout of the committed file), green.
- Gates: web `tsc --noEmit` clean; full vitest 4648 passed, 1 failed = RT6-5 in `src/lib/aiSavedConfigRoundTrip.spec.ts`, an untracked file that belongs to 136-10 (mid-flight, not touched); theme-guard 160/160. WidgetRenderer.line flake did not occur.
- AIREAD-EYE-2 (apiUpdateLayer not called for temp layer) still green.

## Deviations from Plan
- Red-first not followed for Task 1/2: implementation was written before the specs, which then passed on first run (HARN6-1..9, E2EW6-1..5). The E2EW6 mutation proof above is the discrimination evidence. No separate red run exists.
- E2EW6 expectation corrected: an add_widget op's `layout` lands in `addedWidgets[].config.layout`, not `derived.layout` (that map is set_layout only). Assertion points at config.layout.
- HARN6-8 prunes on applyTurn/setCursor via `derived.addedLayers`; the spec also covers revert past the add.
- `AI_PALETTE_NAMES` lives in shared `actionAllowList.ts` (not aiCatalog); imported from `@kinetica-bi/shared`.

## Non-discriminating criteria
- None found. Pre-checks (tempLayerVisibility, approveRemoval, addChart, E2EW6- all 0 before) were valid.

## Operator harness commands (136-12 human check, browser console, DEV build)
Tables 5 and map ids are examples; substitute real ids (`__kbiAiHarness.help()` lists saved widgets).
```js
const h = __kbiAiHarness;
h.help();
// add chart (returns tempId in the logged op; also h.state())
h.addChart("bar", "Avg fare by vendor", 5, { metric: "fare_amount", aggregation: "avg", groupByColumn: "vendor_id", color: "teal" });
// edit chart / change type / rename (use the negative tempId for AI charts, or a saved id)
h.editChart(-1, { aggregation: "max", color: "amber" });
h.changeType(-1, "line");
h.renameWidget(-1, "Max fare by vendor");
// add heatmap incl. weight column (mapId omitted: host picked like the gateway; pass mapId as 2nd arg if asked)
h.addHeatmap({ tableId: 5, spatialMode: "latlon", latColumn: "lat", lonColumn: "lon", style: { colormap: "plasma", valueColumn: "fare_amount", opacity: 0.5 } });
h.editHeatmap(-2, { blurRadius: 12, colormap: "viridis" });
h.setLayerVisible(-2, false);   // session-only eye; true to show again
h.removeLayer(-2);
// no-map case: with no map widget addHeatmap warns and returns null; add a map first
h.addChart("map", "Trips map");
h.addHeatmap({ tableId: 5, spatialMode: "latlon", latColumn: "lat", lonColumn: "lon" });
// remove saved content: first call is skipped (needs_confirmation), approve, repeat
h.removeWidget(<savedWidgetId>);
h.approveRemoval();
h.removeWidget(<savedWidgetId>);
// layout
h.setLayout([{ id: <widgetId>, x: 0, y: 200, w: 18, h: 30 }]);
// undo / redo (-1 = saved dashboard)
h.revert(-1);
h.forward(<lastTurnIndex>);
h.discard();   // also resets removal approval
h.state();
```

## Self-Check: PASSED
Commits 6f8d830, c9ce3eb exist; all listed files committed.
