---
phase: 139-session-only-dynamic-views
plan: 07
subsystem: server
tags: [ai, gateway, shadow, dynamic-view]
requires: [139-01, 139-03, 139-04]
provides:
  - shadow dvInfo / refCols / layer dynamicViewId, add/remove dv application with repoint/drop, named labels
  - gateway add_dynamic_view (permission -> reference -> cap -> live_schema -> compile -> stamp) and remove_dynamic_view (dependents plan, confirm_remove)
  - AI (negative id) dynamic views filterable (D-23)
affects: [139-10, 139-14]
key-files:
  created:
    - packages/server/tests/lib.aiGateway.dv.spec.ts
  modified:
    - packages/server/src/lib/ai/shadow.ts
    - packages/server/src/lib/ai/gateway.ts
    - packages/server/tests/lib.aiShadow.spec.ts
    - packages/server/tests/lib.aiGateway.filter.spec.ts
    - packages/server/tests/lib.aiGateway.spec.ts
key-decisions:
  - "Saved-view removal confirmation is asked before dependents are computed; a second confirm_remove only fires when the drop list holds a saved widget/layer"
  - "If the view's base table cannot be described, every dependent goes to drop (no repoint)"
requirements-completed: [AISAFE-V20-04, AIACT-V20-07, AIACT-V20-08]
duration: ~25min
completed: 2026-10-20
---

# Phase 139 Plan 07: Gateway and shadow for dynamic views Summary

The one gateway now validates, compiles, caps and stamps `add_dynamic_view` (columns, maxRecords and aggregated stamped onto the op), stamps repoint/drop on `remove_dynamic_view` via the shared `planDvDependents`, and accepts filters on AI views.

## Commits
- 8221407: feat(139-07): shadow tracks dynamic-view info, column refs and dependents
- 7645e0f: feat(139-07): gateway add/remove_dynamic_view ... AI-view filters

## Verification
- Red-first: SHDV-1..7 (6 of 7 failed) and GWDV-1..16 (12 of 16 failed) before implementation. GWDV-2, 8, 9 and 16 passed early because they assert refusals that already existed or vacuous privacy; GWDV-16 additionally requires both an ok and a refused result, so it is meaningful after implementation.
- `tsc --noEmit` clean. The four named specs: 73/73. `vitest run ai` (40 files, 422 tests): green. Full gate (`test-gate.mjs`) NOT run, per orchestrator (139-14 owns it).
- Acceptance greps: `can't be filtered yet` 1 -> 0; `planDvDependents(` 1; `compileAiDvSpec(` 1; `session views (limit` 1.

## Deviations from Plan
1. [Orchestrator-directed] GW-2 in `lib.aiGateway.spec.ts`: the `dynamicViewId: 3` assertion changed from `allow_list` to `ok`. 139-01's carve-out lets it past allow_list, and the gateway does not yet resolve the dv id for add_widget, so an unknown id passes. NOTE FOR 139-10: add the "reference" refusal for an unknown/inaccessible dv id on add_widget and tighten this assertion to "reference". The plan's "green unchanged" criterion was stale.
2. GWF-6 (filter spec): the "can't be filtered yet" expectation became "dynamic view -3 does not exist" (D-23), as the plan directed.
3. SHD-2 placeholder `add_dynamic_view` literal replaced with a valid op, as the plan directed.
4. GWDV-13 test passes `approvals.removeSaved` because widget 42 and layer 70 in the fixture are saved (positive ids) and dropping them correctly asks first; the behaviour under test (everything dropped, no repoint) is unchanged.
5. GWDV-15 filter uses a numeric value because `trips` is a long column; the first draft used a string and the coercion refusal (correct behaviour) masked the source resolution.
6. Non-discriminating criteria: the plan's `grep -c "dvInfo"` / `refCols` / `GWDV-` counts only count symbols/titles; behaviour is proven by the specs.

## Notes
- `aiDv` limits and `sourceTableId` on `dynamicViewInfo` are OPTIONAL in GatewayDeps; runAnswer compiles unchanged. 139-10 must wire AiConfig limits and `sourceTableId`.
- Known-red not mine: TTL specs under the packages/server/.env DEFAULT_VIEW_TTL_MINUTES leak.

## Self-Check: PASSED
Files exist (dv spec, shadow.ts, gateway.ts); commits 8221407 and 7645e0f are in git log.
