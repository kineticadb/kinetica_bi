---
phase: 141-keep-persist-ai-changes
plan: 07
subsystem: server
tags: [keep, validation, rbac, dynamic-views]
requires: [141-01, 141-03]
provides: [requiredRights, missingRights, checkKeepChange, prepareKeep, KeepPrepared]
affects: [141-12]
key-files:
  created:
    - packages/server/src/lib/aiKeepValidate.ts
    - packages/server/tests/lib.aiKeepValidate.spec.ts
gaps: []
requirements: [AISES-V20-05]
completed: 2026-10-21
---

# Phase 141 Plan 07: Keep server-side re-validation Summary

Keep requests are re-validated server-side before any write: D-01 rights from the real change set, ownership/shape/blocked-key/reference checks, live-schema column checks as the user, and dynamic views rebuilt from the structured spec only.

## Commits
- 00371ab: requiredRights / missingRights / checkKeepChange (KVAL-1..10)
- 3c32054: prepareKeep (KVAL-11..16)

## RED (recorded)
- Task 1 (stubs throwing): `Tests 10 failed (10)`, all "Error: not implemented".
- Task 2 (prepareKeep stubbed): `Tests 6 failed | 10 passed (16)`, KVAL-11..16 all "not implemented".
- GREEN: lib.aiKeepValidate + lib.aiDvCompile = 36 passed; `tsc --noEmit` clean.

## Deviations
- **Deliberate (per plan): PERMANENTLY_BLOCKED_KEYS not applied wholesale**, since saved widget configs legitimately carry `tableId`. Keep blocks identity keys `id, widgetId, dashboardId, dashboard_id, table_id, position, type` at the top level of widget config/configSet/configUnset, `customWhere` at the top level (also layer configs), and `__proto__/constructor/prototype` at any depth. Layer configs do not get the identity-key block (layer config key names were not confirmed; customWhere and proto keys only).
- **[Rule 1 - test bugs, mine]** KVAL-8 fixture first used `{type: undefined}` as a widget config (the key `type` is blocked by design); KVAL-16 first put `columns: "bogus,cols"` in a widget config, which is correctly refused by the column check. Both fixed in the specs, not the code.
- Acceptance note: the `joinRefs` = 0 grep cannot fail first (plan says so); the discriminating proof is KVAL-12 (template equals the no-joinRefs compile, contains the raw joined table ref). I also removed the word from a code comment so the literal count is 0.

## Notes for 141-12
- `checkKeepChange` is sync and reads the db; `prepareKeep` is async, takes `describe`, `limits`, `savedDvColumns` via deps and also reads stored widget/layer rows for edit binding resolution (no writes).
- Reasons are fixed text + ids + identifier names only (KVAL-10 asserts a canary never appears).
- `warnings` from the two functions are separate: check -> "N saved references point at removed items"; prepare -> the 139 D-21 joined-view warning.
- `savedDvColumns` returning null skips the column check for widgets bound to that saved view.

## Self-Check: PASSED
Files exist; commits 00371ab and 3c32054 present; focused specs and tsc green.
