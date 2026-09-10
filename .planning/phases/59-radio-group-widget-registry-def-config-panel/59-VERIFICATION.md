---
phase: 59-radio-group-widget-registry-def-config-panel
verified: 2026-06-10T19:10:00Z
status: passed
score: 6/6 success-criteria verified
re_verification:
  previous_status: gaps_found
  previous_score: 5/6
  gaps_closed:
    - "A target that no longer exists surfaces a dedicated orphan warning (ROADMAP SC3)"
  gaps_remaining: []
  regressions: []
---

# Phase 59: Radio-Group Widget — Registry Def + Config Panel Verification Report

**Phase Goal:** A `radiogroup` control widget type exists + an operator can author N options (each an independent multi-field action bound to a same-dashboard target), validated against the v2 allow-list and saved; targets that no longer exist surface an orphan warning. NO runtime behavior (Phase 60).
**Verified:** 2026-06-10T19:10:00Z
**Status:** passed
**Re-verification:** Yes — after gap closure (commit efc40aa)

---

## Automated Gates

| Gate | Result | Evidence |
|------|--------|----------|
| `cd packages/web && npx tsc --noEmit` | CLEAN (exit 0) | No type errors |
| `cd packages/web && npx vitest run` | 1914/1914 passed (91 files) | +2 over prior 1912 baseline (the 2 new orphan specs) |
| Phase-59 orphan specs specifically | 2/2 passed | `orphan-target-warning` describe block in RadioGroupConfigPanel.spec.tsx |
| `git diff --name-only -- packages/server` | EMPTY | Zero server changes |

---

## Goal Achievement

### Observable Truths vs ROADMAP Success Criteria

| # | Success Criterion | Status | Evidence |
|---|-------------------|--------|----------|
| SC1 | `radiogroup` type appears in registry + add-widget surface | VERIFIED | `definitions/radio-group.ts` exports `registerRadioGroup()`; `definitions/index.ts` calls it; `getChartType("radiogroup")` resolves with `CustomConfigPanel:RadioGroupConfigPanel`, `usesDataSource:false`; registry spec passes |
| SC2 | Operator authors N options; config panel reads `widgets` from props (NOT context) | VERIFIED | `RadioGroupConfigPanel.tsx` uses `props.widgets ?? []`; no `useDashboardContext` import; 3-kind target picker built from props.widgets / useDashboardLayersStore / listDynamicViews; add/remove option rows work |
| SC3 | Field+value constrained by allow-list; invalid/empty binding prevented; target-not-found surfaces orphan warning | VERIFIED | Allow-list validation via `validateRadioOption` blocks save on out-of-list/empty. **Gap closed (efc40aa):** `OptionRow` detects when `kind:id` is absent from allWidgets/layers/dynamicViews and renders `data-testid="orphan-target-warning-{idx}"` with `var(--warning, #d97706)` (theme token). Two specs confirm: orphaned id renders warning; resolvable id is absent. |
| SC4 | Save validates options against allow-list; persists via existing widget config PATCH path | VERIFIED | `isRadioGroupConfigValid` + `validateRadioOption` run in `useMemo`; `isValid?.(result)` in `useEffect`; out-of-list / empty / meta-proto rejected; config flows through `onChange` to the auto-save ChartConfigPanel path |

### Derived Must-Have Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| T1 | RadioGroupConfig type model correct: `{ title?, orientation, defaultOptionId?, options: RadioOption[] }` | VERIFIED | `radioGroupConfig.ts` lines 52–57 |
| T2 | RadioOption carries full WidgetAction envelope; each option independent | VERIFIED | `type RadioOption = { id, label, action: WidgetAction }` |
| T3 | captureAllowListedSubset is location-aware via `getFieldLocation`; no hardcoded field→location mapping | VERIFIED | `radioGroupCapture.ts` derives location via `getFieldLocation`; candidate names enumerated |
| T4 | Single capture returns BOTH nested `renderMode` (from `layer.config`) AND top-level `track_config` from correct sources | VERIFIED | `radioGroupCapture.spec.ts`: asserts `result.renderMode === "raster"` AND `result.track_config === '{"TRACK":true}'`; test passes |
| T5 | validateRadioOption rejects empty/out-of-list/meta-proto/wrong-type; valid passes | VERIFIED | `radioGroupConfig.ts`; delegates to `validateActionPatch`; 23 spec tests covering all cases |
| T6 | No runtime apply/select/default-on-open logic in Phase 59 files | VERIFIED | `grep applyWidgetAction|selectOption|selectedIndex` in RadioGroupConfigPanel.tsx and definitions/radio-group.ts returns nothing |

---

## Gap Closure Detail: SC3 Orphan Warning

**Commit:** efc40aa — `fix(59): orphan-target warning on radio option row (SC3 gap)`

**Implementation (RadioGroupConfigPanel.tsx lines 163–171, 292–301):**

```
const targetIsSet = targetId !== 0;
const targetResolved =
  !targetIsSet ||
  (kind === "widget" && allWidgets.some((w) => w.id === targetId)) ||
  (kind === "layer" && layers.some((l) => l.id === targetId)) ||
  (kind === "dynamicView" && dynamicViews.some((dv) => dv.id === targetId));
const isOrphanTarget = targetIsSet && !targetResolved;
```

When `isOrphanTarget` is true, renders:
```
<div
  className="config-hint"
  style={{ color: "var(--warning, #d97706)" }}
  data-testid={`orphan-target-warning-${idx}`}
>
  Target no longer available — pick a new target
</div>
```

**Color tokens:** `var(--warning, #d97706)` — theme token primary, hex fallback only. No hardcoded colors without a CSS-var wrapper.

**Spec coverage (RadioGroupConfigPanel.spec.tsx lines 750–809):**

- Case 1 (orphaned): widget id=999 absent from props.widgets (only id=1 present) — `getByTestId("orphan-target-warning-0")` asserts present.
- Case 2 (resolvable): widget id=1 present in props.widgets — `queryByTestId("orphan-target-warning-0")` asserts null.

---

## Required Artifacts

| Artifact | Status | Evidence |
|----------|--------|----------|
| `packages/web/src/lib/radioGroupConfig.ts` | VERIFIED | Unchanged from prior verification |
| `packages/web/src/lib/radioGroupCapture.ts` | VERIFIED | Unchanged from prior verification |
| `packages/web/src/lib/radioGroupConfig.spec.ts` | VERIFIED | 23 tests green |
| `packages/web/src/lib/radioGroupCapture.spec.ts` | VERIFIED | 20 tests green |
| `packages/web/src/components/charts/RadioGroupConfigPanel.tsx` | VERIFIED | Orphan detection added (lines 163–171, 292–301); 571 lines |
| `packages/web/src/components/charts/definitions/radio-group.ts` | VERIFIED | Unchanged |
| `packages/web/src/components/charts/definitions/index.ts` | VERIFIED | Unchanged |
| `packages/web/src/components/charts/RadioGroupConfigPanel.spec.tsx` | VERIFIED | 22 tests (was 20); 2 new orphan-target-warning specs at lines 750–809 |

---

## Key Link Verification

| From | To | Via | Status | Evidence |
|------|----|-----|--------|----------|
| `definitions/index.ts` | `definitions/radio-group.ts` | `registerRadioGroup()` called in `registerAllChartTypes` | WIRED | Unchanged |
| `RadioGroupConfigPanel.tsx` | `radioGroupCapture.ts` | `captureAllowListedSubset` imported and called in `handleCapture` | WIRED | Unchanged |
| `RadioGroupConfigPanel.tsx` | `radioGroupConfig.ts` | `validateRadioOption` + `isRadioGroupConfigValid` imported and used | WIRED | Unchanged |
| `RadioGroupConfigPanel.tsx` | `dashboardLayersStore.ts` | `useDashboardLayersStore` read for layers (also fed to orphan check) | WIRED | Unchanged; layers also passed to OptionRow for orphan resolution |
| `RadioGroupConfigPanel.tsx` | `api/client.ts` | `listDynamicViews(dashboardId, signal)` — dvs also fed to orphan check | WIRED | Unchanged; dynamicViews also passed to OptionRow |
| `radioGroupConfig.ts` | `actionAllowList.ts` | `validateActionPatch` called in `validateRadioOption` | WIRED | Unchanged |
| `radioGroupCapture.ts` | `actionAllowList.ts` | `getFieldLocation` called per field in loop | WIRED | Unchanged |

---

## Requirements Coverage

| Requirement | Description | Status | Evidence |
|-------------|-------------|--------|----------|
| RADIO-V111-01 | Net-new radiogroup widget type with registry def + config panel; N options with label + bound action | SATISFIED | Unchanged from prior verification |
| RADIO-V111-02 | Config panel lets operator pick target + allow-listed field+value; invalid/empty binding prevented | SATISFIED | Gap closed: dedicated orphan-target warning now surfaces when configured target id is absent; allow-list validation and save-blocking confirmed throughout |

---

## Anti-Pattern Scan

| File | Pattern | Severity | Impact |
|------|---------|----------|--------|
| `RadioGroupConfigPanel.tsx` — orphan warning color | `style={{ color: "var(--warning, #d97706)" }}` | None | Theme token primary; hex is only a CSS fallback. Compliant with UI consistency conventions. |
| All Phase 59 files | `render_mode` (snake_case) | None found | Clean — renderMode camelCase throughout |
| `RadioGroupConfigPanel.tsx` | No runtime apply/select/default-on-open | None found | Phase 60 boundary correctly respected |

---

## Human Verification Required

None. All success criteria verified programmatically. Live UAT (operator interaction, visual rendering in browser) is scoped to Phase 61 per plan.

---

_Verified: 2026-06-10T19:10:00Z_
_Verifier: Claude (gsd-verifier)_
