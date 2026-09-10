---
phase: 112-map-default-view-apply-on-load
verified: 2026-09-10T13:29:30Z
status: passed
score: 6/6 must-haves verified (truths); 4/4 requirement IDs satisfied; MAPVIEW-V121-04 (cross-phase) also closed out
---

# Phase 112: Map Default View — Apply on Load Verification Report

**Phase Goal:** A map widget opens at its designer-chosen default view instead of always at the world view — without resurrecting auto-fit-to-data (deliberately removed in Phase 12-02).
**Verified:** 2026-09-10T13:29:30Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A map with a saved defaultView opens already at that exact zoom/centre, baked into `new OlView({...})` at construction — no world-view frame to flash | VERIFIED | `resolveInitialView(widgetConfig` at `MapChartRenderer.tsx:485`, `new OlView(` at `:1057` (485 < 1057, only 1 call site of each). No `setCenter`/`setZoom`/`.fit(` anywhere in the file. `.animate(` count = 3, none touching the initial view (lines 2272 Effect 9b sync-apply, 2403/2410 zoom toolbar). Test H1 asserts `opts.center`/`opts.zoom` exactly; Test H3 asserts `setCenter`/`setZoom`/`fit`/`animate` were NOT called and `_syncStoreState.publish` NOT called. Operator confirmed live in browser (Check 1: PASS, no flash at low or street-level zoom). |
| 2 | A map with NO saved defaultView opens byte-identically to today: `center [0,0]`, `zoom 2` | VERIFIED | `WORLD_VIEW_CENTER = [0,0]`, `WORLD_VIEW_ZOOM = 2` in `mapInitialView.ts`. Literal `center: [0, 0]` is absent from `MapChartRenderer.tsx` (grep = 0). `mapInitialView.spec.ts` A1/A2 assert `resolveInitialView({})` and `{defaultView: undefined}` both → `{center:[0,0], zoom:2}` via `toEqual` (full payload, not "didn't throw"). `MapChartRenderer.spec.tsx` H2 asserts the full OlView payload `toMatchObject({projection:"EPSG:3857", center:[0,0], zoom:2})`. Operator confirmed (Check 2: PASS). |
| 3 | A stored defaultView that is unusable (non-finite, zoom outside 0..28, malformed centre) falls back to the world view — never throws, never renders blank | VERIFIED | `mapInitialView.ts` has zero `throw` statements (grep confirmed). `mapInitialView.spec.ts` A5 runs an 11-case `it.each` matrix (NaN/Infinity centre & zoom, zoom -1 and 28.1, 1-/3-element arrays, non-array, null, string zoom) each asserting `not.toThrow()` AND `toEqual(world view)`. Boundaries 0 and 28 are inclusive-accepted (A6). `MapChartRenderer.spec.tsx` H5 renders a live widget with `zoom: 40` and asserts the constructor payload fell back to `[0,0]`/`2` without the render throwing. |
| 4 | The exact unrounded fractional zoom and EPSG:3857 centre survive a JSON persistence round-trip | VERIFIED | `mapInitialView.spec.ts` A7 does `JSON.parse(JSON.stringify({defaultView: saved}))` then asserts `resolveInitialView(...)` returns the exact fractional zoom (12.437, `toBe`, not `toBeCloseTo`) and exact centre. `MapChartRenderer.spec.tsx` H6 does the same round-trip at the full-widget level (`JSON.parse(JSON.stringify(makeWidget({defaultView: NYC})))`) and asserts the OlView constructor payload matches exactly. Operator confirmed the real-browser path (Check 3: PASS — hard reload AND full tab close/reopen). |
| 5 | Two map widgets on one dashboard with different saved defaults each open at their own view (per-widget config, never dashboard-keyed) | VERIFIED | `MapChartRenderer.spec.tsx` H4 renders two distinct `<MapChartRenderer>` instances (ids 10/11) with different `defaultView` (NYC/LONDON) in one `act`, asserts `OlView` called exactly twice, and asserts `mock.calls[0][0]` and `mock.calls[1][0]` are two DIFFERENT payloads matching each widget's own saved values — not the same object twice. `resolveInitialView` reads `config.defaultView` via `getDefaultView`, never `dashboardId` (grep for `dashboardId`/`mapViewportSyncStore` in the diff = 0). Operator confirmed live, including with `Sync map viewport` enabled on both maps (Check 4: PASS — both sync-off and sync-on reloads). |
| 6 | No imperative view mutation is introduced; `.animate(` count unchanged at 3; no spurious moveend fires at mount | VERIFIED | `setCenter`/`setZoom`/`.fit(` counts in `MapChartRenderer.tsx` = 0. `.animate(` count = 3 (Effect 9b sync-apply + 2 `MapZoomToolbar` handlers — unchanged from baseline). H3 additionally asserts `_syncStoreState.publish` was not called on mount. |

**Score:** 6/6 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/web/src/lib/mapInitialView.ts` | `resolveInitialView()` single source of truth, exports `resolveInitialView`, `WORLD_VIEW_CENTER`, `WORLD_VIEW_ZOOM`, ≥30 lines | VERIFIED | 65 lines. All three exports present. Goes through `getDefaultView` (2 occurrences: import + call), zero raw `config.defaultView` reads, zero `ol/proj`/`transform(`/`toFixed`/`Math.round`, zero `throw`. |
| `packages/web/src/lib/mapInitialView.spec.ts` | Unit coverage: passthrough, absent-default, zoom-0 edge, invalid matrix, JSON round-trip, fresh-object return, ≥60 lines | VERIFIED | 72 lines, 19 tests (8 named cases + 11-case `it.each` matrix), all pass (confirmed by running `npx vitest run`). |
| `packages/web/src/components/charts/MapChartRenderer.tsx` | Component-scope `initialView` const consumed by the single `new OlView({...})` site | VERIFIED | `const initialView = resolveInitialView(widgetConfig as Partial<MapWidgetConfig>)` at line 485; consumed at `center: initialView.center` / `zoom: initialView.zoom` inside the sole `new OlView(` call at line 1057. |
| `packages/web/src/components/charts/MapChartRenderer.spec.tsx` | Phase 112 describe block asserting OlView payload for present/absent/invalid defaults, two-widget independence, reload round-trip | VERIFIED | `describe("MapChartRenderer — Phase 112 initial view from config.defaultView")` block at line 6564 with tests H1-H6, all named with their REQ-ID, all passing. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `mapInitialView.ts` | `mapInfoConfig.ts` | `import { getDefaultView }` | WIRED | `getDefaultView` imported and called exactly once inside `resolveInitialView`; zero raw `config.defaultView` reads. |
| `MapChartRenderer.tsx` | `mapInitialView.ts` | `resolveInitialView(widgetConfig...)` at component scope | WIRED | Import at line 84, call at line 485. `MapChartRenderer.tsx` does NOT import `getDefaultView` directly (grep = 0) — the helper is the sole read path, as required. |
| `MapChartRenderer.tsx` | `ol/View` | `center: initialView.center` / `zoom: initialView.zoom` inside `new OlView({...})` | WIRED | Confirmed at lines 1057-1064; ordering (485 < 1057) is structural and re-confirmed live in this session. |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| MAPVIEW-V121-02 | 112-01, 112-02 | A map with a saved default view opens at that zoom and center | SATISFIED | Truths 1, 4, 5, 6 above; H1/H3/H6 tests; operator Check 1 PASS. `.planning/REQUIREMENTS.md` line 11 = `[x]`, traceability row = Complete. |
| MAPVIEW-V121-03 | 112-01 | A map with no saved default view opens exactly as today | SATISFIED | Truth 2 above; H2 test; operator Check 2 PASS. `.planning/REQUIREMENTS.md` line 12 = `[x]`, traceability row = Complete. |
| MAPVIEW-V121-05 | 112-01, 112-02 | A saved default view survives a dashboard reload | SATISFIED | Truth 4 above; A7/H6 tests (unit + component-level JSON round-trip); operator Check 3 PASS (real hard-reload + tab close/reopen). `.planning/REQUIREMENTS.md` line 14 = `[x]`, traceability row = Complete. |
| MAPVIEW-V121-06 | 112-01, 112-02 | Each map widget's default view is independent of other map widgets on the same dashboard | SATISFIED | Truth 5 above; H4 test (two distinct payloads, not the same object); operator Check 4 PASS (incl. viewport-sync-on reload). `.planning/REQUIREMENTS.md` line 15 = `[x]`, traceability row = Complete. |

**Cross-phase loose end — MAPVIEW-V121-04 (assigned to Phase 111, was "In Progress"):**
Judged NOW COMPLETE and updated in `.planning/REQUIREMENTS.md` (checkbox line 13 → `[x]`; traceability row 62 → "Complete (world-view fallback landed in Phase 112; operator-verified 2026-09-10)"). Reasoning: Phase 111 built the clear mechanism (`MapConfigPanel.tsx` line ~184, `delete next.defaultView`); the requirement's remaining half — "returning that map to the world view" — needed this phase's absent-default fallback path (Truth 2, H2), which is verified both automatically and by the operator's Check 2 in a real browser on 2026-09-10 ("clearing does not move the open map" / "opened at the world view on this reload" — PASS). Both halves of the requirement (clear the field; the map opens at the world view on next load) are now proven. No ambiguity remains.

No orphaned requirements: all four Phase-112 REQ-IDs from `REQUIREMENTS.md`'s traceability table (`MAPVIEW-V121-02/-03/-05/-06`) appear in plan 112-01's `requirements` frontmatter; 112-02 additionally re-declares `-02/-05/-06` (its human-verification role for those three) and correctly omits `-03` (no human check needed for the absent-default path). `MAPVIEW-V121-01` and `-04` are correctly Phase 111's, not claimed here.

### Anti-Patterns Found

None. Scanned all four phase files for `TODO|FIXME|XXX|HACK|PLACEHOLDER` (the one hit, `TRANSPARENT_PLACEHOLDER`, is a pre-existing, unrelated tile-loading constant, not phase 112 code) and for stub patterns (`return null`, `return {}`, empty handlers) — none found in the phase's code paths. `resolveInitialView` is a genuine total function, not a stub.

### Live Gate Re-Run (this verification session, not trusted from SUMMARY alone)

```
cd packages/web && npx tsc --noEmit                                    -> clean, exit 0
cd packages/web && npx vitest run                                      -> 162 files / 3666 tests, 0 failed
cd packages/web && npx vitest run src/styles/theme-guard.spec.ts       -> 150/150, 0 failed
cd packages/web && npx vitest run MapChartRenderer.spec.tsx mapInitialView.spec.ts -> 239/239, 0 failed
```
Counts match both 112-01-SUMMARY.md and 112-02-SUMMARY.md exactly (no drift). The 401/`ReauthRequiredError` console noise from `InfoPopup.spec.tsx` is pre-existing and unrelated to this phase's scope (unawaited `columnDisplayConfigStore.loadConfig` in an unrelated test) — does not affect the 0-failed count.

### Scope / No-New-UI Audit

- `git diff --stat` across the phase's commit range (`7be47c2^..affb0f6`) touches exactly 6 files: the 4 declared in `112-01-PLAN.md` frontmatter plus 2 documented collateral one-line mock fixes (`WidgetRenderer.spec.tsx`, `actionEngine.canary.spec.tsx` — both missing `getDefaultView` in their independent `mapInfoConfig` mocks, logged as Rule-3 fixes in `112-01-SUMMARY.md`).
- New `className` occurrences in the diff: 0. New hex colors in the diff: 0.
- `mapViewportSyncStore`/`isSyncDrivenRef`/`dashboardId` touches in `MapChartRenderer.tsx`'s diff: 0 — the Phase 104 sync store is genuinely untouched.
- Phase 111's artifacts (`MapConfigPanel.tsx`, `mapCurrentViewStore.ts`, `mapViewFormat.ts`, `mapViewportSyncStore.ts`) are not touched by this phase's diff.

### Toothless-Criterion Audit (per verifier brief)

Three of the plan's own grep-based acceptance criteria were pre-flagged and handled by the executor as documented in `112-01-SUMMARY.md`: `id: 11` (14 pre-existing occurrences before the work), `mock.calls[1][0]` (4 pre-existing), and `Test G:` (6 pre-existing, spanning unrelated `describe` blocks reusing that letter). All three were either replaced with a criterion that read 0 before the work (`LONDON`, `H4:`) or verified by the substantive assertion instead (`expect(lastMockView.animate).not.toHaveBeenCalled()` count 1→2, confirmed in this session). No further toothless criteria were found on inspection of the remaining acceptance criteria in either plan — the rest (line-number orderings, exact grep counts for `setCenter`/`.animate(`/`center: [0, 0]`, file/test counts) are all genuinely 0 or a specific non-trivial number before the phase's work and would fail if the work were reverted.

### Human Verification Required

None outstanding. The phase's one genuinely non-automatable property — visible no-flash on first paint, real browser reload/tab-restart survival, and live two-map independence with/without viewport sync — was routed to `112-02`'s blocking `checkpoint:human-verify` and resolved by the operator's explicit "approved" verdict on 2026-09-10 (recorded verbatim, per-check, in `112-02-SUMMARY.md`), not self-approved. This verification confirms the CODE backing those four checks (constructor-time application, zero imperative mutators, per-widget independence, JSON round-trip fidelity) rather than re-demanding the same human testing.

### Gaps Summary

None. All six derived observable truths are verified against the actual codebase (not SUMMARY claims — re-run independently in this session), all four artifacts pass all three levels (exist, substantive, wired), all three key links are wired, all four of this phase's REQ-IDs are accurate in `REQUIREMENTS.md`, and the cross-phase loose end (MAPVIEW-V121-04) has been judged complete and the traceability doc updated accordingly. No anti-patterns, no scope creep, no weakened or deleted tests, no toothless acceptance criteria remaining unaddressed.

---

_Verified: 2026-09-10T13:29:30Z_
_Verifier: Claude (gsd-verifier)_
