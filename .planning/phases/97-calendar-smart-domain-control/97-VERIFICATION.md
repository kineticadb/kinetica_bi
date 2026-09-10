---
phase: 97-calendar-smart-domain-control
verified: 2026-06-30T16:00:00Z
status: passed
score: 5/5 must-haves verified
re_verification: false
---

# Phase 97: Calendar Smart Domain Control Verification Report

**Phase Goal:** Designers can configure a calendar to expose a single "smart" time-granularity dropdown (month / week / day / hour) that auto-maps to the correct domain+subdomain pair, without disturbing existing two-dropdown calendars.
**Verified:** 2026-06-30T16:00:00Z
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| #   | Truth                                                                                                    | Status     | Evidence                                                                                                      |
| --- | -------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------- |
| 1   | SMART_SCALE_TO_PAIR mapping exists with all four exact pairs, test-locked against isValidCombo           | VERIFIED   | calendarBin.ts lines 99-107; calendarBin.spec.ts describe "smart scale mapping" 6 assertions (all pass)       |
| 2   | controlMode "advanced"\|"smart" field on CalendarConfig; default "advanced"; mode-branched panel UI      | VERIFIED   | CalendarConfigPanel.tsx lines 58, 73, 138; "Time grouping control" select; controlMode===advanced/smart JSX   |
| 3   | allowedSmartScales restriction with ≥1 minimum enforced; config-time only, no viewer live dropdown       | VERIFIED   | toggleAllowedScale (lines 373-386) returns early when allowedSmartScales.length <= 1; spec Test S8 green      |
| 4   | Absent controlMode coalesces to "advanced" — byte-identical to pre-Phase-97 behavior (backward-compat)   | VERIFIED   | CalendarRenderer.tsx line 120 `cfg.controlMode ?? "advanced"`; CalendarRenderer.spec Test P97-3 green         |
| 5   | CalendarRenderer gates viewer control bar to advanced mode; no new SQL/materialize/fromSwap              | VERIFIED   | CalendarRenderer.tsx line 121-122: `controlMode === "advanced" && (cfg.showDomainSubdomainControls ?? false)`  |

**Score:** 5/5 truths verified

---

### Required Artifacts

| Artifact                                                                  | Expected                                                      | Status    | Details                                                                  |
| ------------------------------------------------------------------------- | ------------------------------------------------------------- | --------- | ------------------------------------------------------------------------ |
| `packages/web/src/lib/calendarBin.ts`                                     | SmartScale + SMART_SCALES + SMART_SCALE_TO_PAIR exports       | VERIFIED  | Lines 88-107; exports present and correctly typed                        |
| `packages/web/src/lib/calendarBin.spec.ts`                                | 6 smart-scale assertions including isValidCombo loop          | VERIFIED  | Lines 186-216; all four pairs + validity loop present                    |
| `packages/web/src/components/charts/CalendarConfigPanel.tsx`              | controlMode/smartScale/allowedSmartScales fields + branched UI | VERIFIED  | Lines 58-60 (type), 73-75 (defaults), 138-143 (coalescing), 500-588 (UI) |
| `packages/web/src/components/charts/CalendarConfigPanel.spec.tsx`         | describe "smart mode (Phase 97)" with 10 tests                | VERIFIED  | Lines 413-553; Tests S1-S10 all pass                                      |
| `packages/web/src/components/charts/CalendarRenderer.tsx`                 | controlMode coalesce + showControls gate                      | VERIFIED  | Lines 120-122; gate is `controlMode === "advanced" && ...`               |
| `packages/web/src/components/charts/CalendarRenderer.spec.tsx`            | describe "smart mode (Phase 97)" with 4 tests P97-1..P97-4   | VERIFIED  | Lines 1167-1242; all 4 tests present including backward-compat lock      |

---

### Key Link Verification

| From                                          | To                                     | Via                                              | Status  | Details                                                                      |
| --------------------------------------------- | -------------------------------------- | ------------------------------------------------ | ------- | ---------------------------------------------------------------------------- |
| CalendarConfigPanel.tsx                       | calendarBin.ts                         | `import { SMART_SCALE_TO_PAIR, SMART_SCALES }`   | WIRED   | Lines 31-33; both imported and used (handleSmartScaleChange, toggleAllowedScale, Time scale select JSX) |
| Smart Time-scale select onChange              | patch({ smartScale, domain, subdomain }) | `SMART_SCALE_TO_PAIR[scale]`                    | WIRED   | Line 369-371 (handleSmartScaleChange); SMART_SCALE_TO_PAIR[scale] looked up |
| CalendarRenderer.tsx viewer control bar guard | cfg.controlMode                        | `controlMode === "advanced" && ...`              | WIRED   | Lines 120-122; single expression gates showControls boolean                  |

---

### Requirements Coverage

| Requirement        | Source Plan   | Description                                                                     | Status    | Evidence                                                                                          |
| ------------------ | ------------- | ------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------- |
| CALSMART-V119-01   | 97-01, 97-02  | Designer can switch between advanced and smart UI; absent config → advanced     | SATISFIED | controlMode field + panel branch (Plan 01); CalendarRenderer gate + backward-compat test (Plan 02) |
| CALSMART-V119-02   | 97-01, 97-02  | Smart mode auto-maps month/week/day/hour → correct domain+subdomain pair        | SATISFIED | SMART_SCALE_TO_PAIR in calendarBin.ts; handleSmartScaleChange writes pair; isValidCombo test loop  |
| CALSMART-V119-03   | 97-01         | Designer can restrict which smart options appear; ≥1 enforced; config-time only | SATISFIED | allowedSmartScales field; toggleAllowedScale ≥1 guard; spec Test S8; no viewer live dropdown       |

All three requirement IDs from PLAN frontmatter are accounted for. REQUIREMENTS.md confirms all three marked `[x] Complete` for Phase 97.

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| — | — | None | — | — |

Checked: no TODO/FIXME/PLACEHOLDER comments in modified files; no `return null` / `return {}` stubs; no console.log-only handlers; no raw hex (theme-guard green); no invented classNames (all classNames in Phase 97 JSX are pre-existing: `ds-field`, `ds-field-label`, `ds-select`, `config-group-label`, `config-toggle`, `accent-checkbox`).

---

### Invariant Check Results

- **FRONTEND-ONLY confirmed:** All four phase commits touch only `packages/web/src/` — zero `packages/server/` diffs.
- **AggregatedWidgetRenderer stays sole materialize trigger:** CalendarRenderer.tsx import lines contain no `materializeFilter`, `dropFilterView`, or `fromSwap` (grep on import lines: empty result). Mentions in file-level comments are expected and preserved.
- **No fromSwap import:** Confirmed by import-line grep and by Test 0 / Test 22 in CalendarRenderer.spec.tsx (static source invariants, both green).
- **Theme tokens only:** `npx vitest run src/styles/theme-guard.spec.ts` — 132/132 passed. One existing `style={{ color: "var(--danger)" }}` is a CSS variable, not a hex literal.
- **No invented classNames:** All Phase 97 JSX classes verified against the plan's allowlist.

---

### Test Gate Results

| Gate | Result | Notes |
| ---- | ------ | ----- |
| `npx tsc --noEmit` (packages/web) | CLEAN | No output = zero errors |
| `npx vitest run calendarBin.spec.ts` | 100% | 121 tests across 3 spec files run together |
| `npx vitest run CalendarConfigPanel.spec.tsx` | 100% | Included in above run |
| `npx vitest run CalendarRenderer.spec.tsx` | 100% | Included in above run; 49 CalendarRenderer tests pass |
| `npx vitest run` (full web suite) | 130/130 files, 3020/3020 tests | Pre-existing unhandled-promise errors in InfoCardRenderer and unrelated specs are the known TD-V16-TEST-ISOLATION set; no Phase 97 failures |
| `npx vitest run src/styles/theme-guard.spec.ts` | 132/132 | Green |

---

### Human Verification Required

None. All phase-97 behaviors are programmatically verified:

- Mapping correctness is unit-tested (calendarBin.spec.ts smart-scale describe).
- Config UI branching is tested in CalendarConfigPanel.spec.tsx (Tests S1-S10).
- Viewer control-bar suppression is tested in CalendarRenderer.spec.tsx (Tests P97-1..P97-4).
- Backward-compat is locked by Test P97-3 (explicit comment in spec).

The only behavior that is visually oriented (designer sees a "Time scale" dropdown instead of two dropdowns) is fully covered by the aria-label assertions in the spec — no additional visual human verification is needed for a code-change this scoped.

---

## Summary

Phase 97 goal is **fully achieved**. The SMART_SCALE_TO_PAIR mapping is the single source of truth in calendarBin.ts, test-locked against isValidCombo. CalendarConfigPanel carries all three new optional fields with advanced-safe defaults and a mode-branched UI (smart mode shows Time-scale select + allowed-scales checkboxes with ≥1 enforcement; advanced mode shows original Domain+Subdomain dropdowns). CalendarRenderer gates the viewer control bar to advanced mode only. Absent controlMode coalesces to "advanced" at both the panel and renderer, making existing calendars byte-identical. All three CALSMART-V119-0x requirements are satisfied. All test gates pass. Zero server-side changes.

---

_Verified: 2026-06-30T16:00:00Z_
_Verifier: Claude (gsd-verifier)_
