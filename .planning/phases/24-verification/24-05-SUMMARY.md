---
phase: 24-verification
plan: 05
type: gap_closure
gap_closed: GAP-24-01-B
subsystem: ui
tags: [react, useEffect, useRef, MapConfigPanel, info-popup, controlled-input, vitest]

# Dependency graph
requires:
  - phase: 22-config-ui
    provides: MapConfigPanel INFO POPUP section (CONFIG-V14-04) with widthDraft / heightDraft / radiusDraft useState buffers + clamp-on-blur handlers
  - phase: 19-config-schema
    provides: getInfoPopupWidthPx / getInfoPopupHeightPx / getInfoRadiusPx pass-through helpers in kinetica_bi/src/lib/mapInfoConfig.ts
provides:
  - useEffect re-sync hooks for radiusDraft / widthDraft / heightDraft — draft state mirrors widget.config-derived values across re-renders without unmount
  - Mid-type guard pattern: useRef(prior) + `if (draft === String(prior))` predicate prevents external config updates from clobbering an in-progress draft
  - 5 vitest regression specs (W-GAP-24-01-B): width / height / radius read-back of non-default values + rerender re-sync + mid-type guard
affects: [Phase 22 clamp-on-blur pattern — still locked; gsd-verifier re-spawn for 24-VERIFICATION.md gap-closure update]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "useEffect+useRef re-sync pattern: useRef captures prior config-derived value; useEffect re-syncs draft only when draft matches prior (i.e., user is not mid-type). Honors the line-comment promise 'Reset when stored config changes externally' that the original useState initializer alone could not fulfill on re-render-without-remount."
    - "Mid-type guard for controlled-input-with-buffer pattern: predicate `if (draft === String(priorRef.current))` distinguishes 'draft is the prior config echo' (re-sync safe) from 'draft is user-in-progress' (leave alone, clamp-on-blur reconciles)."

key-files:
  created:
    - .planning/phases/24-verification/24-05-SUMMARY.md
  modified:
    - kinetica_bi/src/components/charts/MapConfigPanel.tsx
    - kinetica_bi/src/components/charts/MapConfigPanel.spec.tsx

key-decisions:
  - "FIX B (useEffect re-sync) chosen over FIX A (full controlled-input refactor): the Phase 22 clamp-on-blur pattern is locked in STATE.md as a CONFIG-V14-04 invariant; FIX B is the minimal diff that honors the existing 'Reset when stored config changes externally' line-comment promise without disturbing the locked clamp-on-blur contract. FIX A would have required reshaping every blur handler."
  - "Mid-type guard via useRef(prior) + draft-equality predicate (NOT a separate isTyping boolean flag): the predicate is self-synchronizing — after blur, the clamp handler writes back to setDraft(String(value)) which restores draft = String(prior) until the next user keystroke. No explicit isTyping state needed."
  - "// eslint-disable-next-line react-hooks/exhaustive-deps on each useEffect: deliberate — including widthDraft in the dep array would cause the effect to re-fire on every keystroke (defeating the purpose) and would still need the predicate guard anyway. Dep array is the config-derived value only; the predicate reads the current draft via closure."

patterns-established:
  - "Controlled-input-with-typing-buffer re-sync recipe: (1) useState initializer reads config-derived value; (2) useRef stores prior config-derived value; (3) useEffect on config-derived value re-syncs draft only when draft === String(priorRef.current); (4) blur handler reconciles draft↔config. Use whenever a draft buffer must survive re-renders but yield to external config changes when the user is not typing."

requirements-completed: [VERIFY-V14-01-gap-closure]

# Metrics
duration: ~10min
completed: 2026-05-11
gaps_closed: [GAP-24-01-B]
---

# Phase 24 Plan 05: Gap-Closure — MapConfigPanel Popup-Dim Read-Back

## Gap Closed

**GAP-24-01-B (MEDIUM)** — MapConfigPanel INFO POPUP inputs do not echo back saved `infoPopupWidthPx` / `infoPopupHeightPx`.

Discovered during STEP 24-01/2.2 of the v1.4 UAT. The popup itself rendered at the configured dimensions (200×200 and 1200×1200 both verified live), proving the persisted widget config was intact. However, reopening MapConfigPanel after saving custom width/height showed the locked defaults (360 / 400) instead of the saved values. The same bug shape was latent in the `radiusDraft` input — `useState` initializers identical across all three drafts.

**Root cause:** the three draft `useState` initializers (`radiusDraft`, `widthDraft`, `heightDraft`) only run on the FIRST render. When the parent `ConfigPanel` modal re-renders `MapConfigPanel` with a new `config` prop (operator saves dims, parent re-renders with the new config but does NOT unmount the component), `useState(String(infoPopupWidthPx))` had already captured the initial-render value and the draft state was divorced from `config` forever. The existing line-comment `// Local typing buffer — allows free typing ... Reset when stored config changes externally.` promised behavior the code did not implement: no `useEffect` re-sync existed.

## Approach

**FIX B (useEffect re-sync with mid-type guard)** chosen over **FIX A (full controlled-input refactor)**.

- **Phase 22 STATE.md lock** binds the clamp-on-blur pattern: `radiusDraft` local state enables free typing; `clampRadius` + `handleRadiusBlur` are called on blur only, never on `onChange` (prevents UX jitter during typing). FIX A would have required reshaping every blur handler to drive a fully controlled input — a larger diff than the bug warrants.
- **FIX B is the minimal diff** that honors the line-comment promise: three `useEffect` hooks plus three `useRef`s capturing the prior config-derived value. Each effect re-syncs the draft only when the draft equals `String(priorRef.current)` — i.e., when the user is NOT mid-type. If the draft differs (user typed `12` en route to `1200` and a side-effect re-rendered the parent), the effect leaves the draft alone and the existing clamp-on-blur logic reconciles when the user finally blurs.

The mid-type guard `if (draft === String(priorRef.current))` is self-synchronizing: after blur, the clamp handler writes `setDraft(String(value))`, which restores `draft === String(prior)` until the next user keystroke. No separate `isTyping` boolean is needed.

## Files Changed

| File | Change |
| --- | --- |
| `kinetica_bi/src/components/charts/MapConfigPanel.tsx` | Imported `useEffect, useRef` from react; added three `useRef`+`useEffect` re-sync blocks after the existing `useState` declarations (one each for radius / width / height); augmented existing line-comment to reference the GAP-24-01-B fix below. |
| `kinetica_bi/src/components/charts/MapConfigPanel.spec.tsx` | Appended 5 W-GAP-24-01-B regression specs inside the existing `describe("MapConfigPanel — Phase 22 INFO POPUP section", ...)` block: width read-back, height read-back, radius read-back regression, parent-rerender re-sync, mid-type-guard non-clobber. |

## Test Coverage

| Metric | Before | After |
| --- | --- | --- |
| MapConfigPanel.spec.tsx tests | 18 | 23 |
| Full frontend vitest | 509 / 509 | 514 / 514 |
| `tsc --noEmit` | exit 0 | exit 0 |

All 5 new specs green on the first run. No pre-existing tests modified or broken.

## What Re-Verifies

**STEP 24-01/2.2 popup-resize-config re-walks cleanly when the operator re-tests:**

1. Open MapConfigPanel for a map widget.
2. Set Popup width (px) = 800; Popup height (px) = 1200; click outside to blur.
3. Close MapConfigPanel.
4. Reopen MapConfigPanel for the same widget.
5. The `Popup width (px)` input MUST display `800` (not the default `360`).
6. The `Popup height (px)` input MUST display `1200` (not the default `400`).
7. The popup itself continues to render at the configured 800×1200 size (Phase 22 behavior preserved).

The mid-type guard preserves typing-in-progress across external config updates — if a side-effect updates `infoPopupWidthPx` while the user has typed `12` en route to `1200`, the draft stays `12` and only reconciles on blur.

## Followup

After 24-04 (GAP-24-01-A) + 24-05 (GAP-24-01-B) + 24-06 (GAP-24-02-A) all complete, `gsd-verifier` re-spawns and updates `.planning/phases/24-verification/24-VERIFICATION.md` GAP-24-01-B to `resolution: closed`. The Map Info Popup v1.4 milestone then closes with all three discovered gaps resolved.

## Deviations from Plan

None — plan executed exactly as written. Two minor in-place augmentations:

1. Added `// eslint-disable-next-line react-hooks/exhaustive-deps` comments above each useEffect's dep array. The effects deliberately depend on the config-derived value only (not on the draft state); including `widthDraft` in deps would cause the effect to re-fire on every keystroke and would still need the predicate guard. The eslint-disable preempts a lint warning under stricter configs without changing behavior. Locked decision documented in key-decisions above.
2. Augmented (rather than replaced) the existing line-comment at line 76-77 (`// Local typing buffer — allows free typing ... Reset when stored config changes externally.`) by appending `(see GAP-24-01-B fix below)` so future readers find the cross-reference inline.

## Self-Check: PASSED

- File `kinetica_bi/src/components/charts/MapConfigPanel.tsx` exists with `useState, useEffect, useRef` import: FOUND (line 17)
- File `kinetica_bi/src/components/charts/MapConfigPanel.spec.tsx` exists with 6 GAP-24-01-B occurrences (1 section comment + 5 spec titles): FOUND
- Commit `10721fb` exists: VERIFIED via `git log` (will append SUMMARY commit hash on landing)
- Full frontend vitest 514 / 514 green: VERIFIED
- `tsc --noEmit` exit 0: VERIFIED
