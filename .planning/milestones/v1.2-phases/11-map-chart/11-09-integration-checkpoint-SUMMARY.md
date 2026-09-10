---
phase: 11-map-chart
plan: 09
status: gaps_found
date: 2026-05-05
---

# Plan 11-09 Summary — Integration Checkpoint (Phase 11 Gate)

## Verdict

**1 RED / 4 BLOCKED** — Phase 11 cannot ship.

## Five-criterion verdict

| Criterion | Status | Notes |
|-----------|--------|-------|
| 1. Spatial-column-mode picker renders + tiles align | RED | No table picker in config modal |
| 2. Four render modes; pan/zoom preserved across switches | BLOCKED | Depends on Criterion 1 |
| 3. Filter changes invalidate tiles, no stale tiles | BLOCKED | Depends on Criterion 1 |
| 4. Cleanup on unmount; no leak; no dup tile fetches | BLOCKED | Depends on Criterion 1 |
| 5. Cache-Control: no-store on /api/wms | BLOCKED | Depends on Criterion 1 (cannot trigger tile fetch without rendered map) |

## RED gap detail

`ChartConfigPanel.tsx:162-188` — when `chartDef.CustomConfigPanel` is set, the parent early-returns the `<Custom>` component WITHOUT the Title input, Data Source picker, or Apply/Cancel scaffolding that non-custom charts get at `ChartConfigPanel.tsx:249-431`.

`MapConfigPanel.tsx` reads `config.tableRef` (`MapConfigPanel.tsx:78`) and `columns` prop (passed from parent) but exposes no UI to set them. Without a table selection, `allColumns` is empty → spatial-column dropdowns are empty → no map can be configured → no WMS request can be issued → Criteria 2-5 all blocked.

## Fix scope (for `/gsd:plan-phase 11 --gaps`)

1. Restore Title + Data Source UI in the `CustomConfigPanel` branch of `ChartConfigPanel.tsx`. Two options:
   - **Option A:** Wrap `<Custom>` in the same Title + Data Source scaffold that non-custom charts get; keep the auto-save flow the custom panel uses today.
   - **Option B:** Add Apply/Cancel for custom-panel charts so the save flow is uniform.
2. Persist `tableRef` AND `tableId` on save (matches Phase 9 FILT-02 / AP-4 lock at `ChartConfigPanel.tsx:90-94`).
3. Verify `MapConfigPanel` clears stale spatial column selections when `columns` changes (table swap mid-config).
4. Re-run all 5 criteria after fix lands.

## UI-SPEC copy spot-check

Deferred — full modal traversal blocked behind the table-picker gap. The three pickers that DID render (SPATIAL MODE / RENDER MODE / BASEMAP) showed expected labels.

## Caveats / Follow-ups

- The `__autoSuggestActive` draft-leak noted in `11-07-SUMMARY.md` is still unresolved and could not be validated against persisted config.
- Once the table-picker fix lands, re-test interaction with auto-suggest on first open (with a real table loaded).

## Resume signal recorded

User typed: `"issues"` — "criterion 1 did not work. The Configure map needs an option to select a table from one of the tables configured for the dashboard"
