---
phase: 134-session-layer-engine-client-no-llm
plan: 10
subsystem: web / action engine / AI session
tags: [gap-closure, overlay-keys, harness, GAP-134-01, GAP-134-02]
requires: [134-01..134-08]
provides: ["allow-list key -> renderer key translation (WIDGET_OVERLAY_KEY_MAP, translateWidgetOverlay)", "harness position feedback"]
affects: [134-09 operator checkpoint]
key-files:
  created:
    - packages/web/src/lib/widgetOverlayKeys.ts
    - packages/web/src/lib/widgetOverlayKeys.spec.ts
    - packages/web/src/lib/aiSession/devHarness.spec.ts
  modified:
    - packages/web/src/components/charts/WidgetRenderer.tsx
    - packages/web/src/components/charts/actionEngine.canary.spec.tsx
    - packages/web/src/lib/aiSession/foldSession.ts
    - packages/web/src/lib/aiSession/foldSession.spec.ts
    - packages/web/src/lib/radioGroupCapture.ts
    - packages/web/src/lib/radioGroupCapture.spec.ts
    - packages/web/src/lib/aiSession/devHarness.ts
decisions:
  - "Allow-list keys stay snake_case (persisted radio/AI contract); translation happens at the WidgetRenderer overlay seam"
metrics:
  tasks: 3
  completed: 2026-10-12
---

# Phase 134 Plan 10: Overlay key translation + harness feedback Summary

Allow-listed map/records patches (show_scale_bar, show_fullscreen, show_popup, page_size) now change what renders, via one shared key map applied at the WidgetRenderer seam (and in foldSession for AI-added widgets); the radio designer capture reads real saved keys; the dev harness prints cursor, turn list and visible AI widgets after every move.

## Commits
- 0334f02 test: failing rendered-effect specs (OVK-1..6, OVK-F1, unit spec)
- 1287c36 fix: translate allow-listed overlay keys (GAP-134-01)
- da93d23 test: radio capture specs use real saved keys (OVK-C1..C3)
- 755eb4d fix: radio capture reads real map/records keys
- 001dcec test: harness feedback specs (HFB-1..5)
- fbf9226 feat: harness reports position
- c1beba6, final follow-up: type-only fixes to devHarness.spec.ts (implicit-any under tsc)

## Red-first evidence
- Task 1 red run: OVK-1..OVK-6 and OVK-F1 all failed against old code (OVK-1: ScaleLine built 1x, expected 0; OVK-2/3/5: never built; OVK-4: singleclick registered; OVK-6: no `LIMIT 50 OFFSET`); the unit spec failed on missing import.
- Task 2 red run: OVK-C1 and OVK-C2 failed. OVK-C3 PASSED before the change (see non-discriminating criteria).
- Task 3 red run: HFB-1..5 all failed.

## Mutation proofs
- WidgetRenderer merge reverted to raw `...widgetOverlay`: OVK-1..OVK-6 all red (6 failed), restored green.
- foldSession reverted to raw `configPatch`: OVK-F1 and FOLD-3 red, restored green.

## Allow-list mismatch audit
| Allow-list field | Real reader key | Status |
|---|---|---|
| map show_scale_bar | showScaleBar | fixed here |
| map show_fullscreen | showFullscreenButton | fixed here |
| map show_popup | infoEnabled | fixed here |
| records page_size | pageSize | fixed here (scope note) |
| chart metric, aggregation | allow-list keyed "chart" but no widget type "chart" exists, so every patch is rejected "no allow-list for target"; renderers read metricColumn and a frozen config.sql | NOT fixed - needs design decision (Phase 136 op kinds) |
| layer opacity (0-1, layer.config) | MapChartRenderer reads config.POINTOPACITY (0-100) | NOT fixed - name AND scale differ; only captureAllowListedSubset's layer opacity read is dead |
| dynamicView enabled | no reader outside widgetActionStore | NOT fixed - dead field until Phase 139 |
| layer renderMode, visible, track_config, cb_config | match real keys | OK |

(Re-confirmed by reading the plan's audit against the code paths touched; not independently re-derived beyond them.)

## Deviations from Plan
1. **[Rule 3 - Blocking] canary spec mocked mapInfoConfig getters as constants** (`getInfoEnabled`/`getShowScaleBar`/`getShowFullscreenButton` always false), which would have made any rendered-effect spec impossible. Made them config-aware (`cfg?.infoEnabled ?? false`, etc.; defaults unchanged). Existing canary specs still pass.
2. **[Rule 1] FOLD-3 updated**: it asserted `config.page_size` on an AI-added records widget; behavior intentionally changed to `pageSize` (translation). Assertion updated.
3. **[Rule 1] Process slip, no impact**: a `git checkout` used to undo a mutation also dropped my then-uncommitted WidgetRenderer edit; I re-applied it before the mutation proof and commit. Final committed state verified by the green runs.
4. Existing A1-A3 canary specs and the existing records fixtures still use `page_size` in saved config (not real); left untouched as out of scope (they only assert store values).

## Non-discriminating / miscounted criteria (reported, code not bent)
- OVK-C3 (map with no real keys captures {}) passes both before and after the change; it is a guard against inventing defaults, not a red-first proof. OVK-C1/C2 carry the red-first proof.
- Task 3 criterion `grep -c "reportPosition(" devHarness.ts >= 4` reads 3: the definition is written `const reportPosition = (action...` which does not match `reportPosition(`. The real intent (definition + run + revert + forward) is met; HFB-1..4 prove each path reports.
- OVK-6 drives the real records SQL effect (runSql mock) in the canary harness; no new infrastructure was needed.

## Gates
- web `npx tsc --noEmit`: clean.
- web full `npx vitest run`: 214 files passed, 1 skipped; 4541 tests passed, 0 failed (run before the final type-only spec fix; devHarness.spec rerun 5/5 after). No parallel-load timeouts observed.
- theme-guard: 160/160 green.
- `npx vite build` ok; `grep -rl __kbiAiHarness dist` and `grep -rl visibleAiWidgets dist` both empty.
- shared: `npx tsc --noEmit` clean, vitest 75 passed. `packages/shared/src/actionAllowList.ts` diff empty.

## Not provable by tests (route to 134-09 operator checkpoint)
Scale bar / fullscreen button / popup visibly toggle in a real browser on `patchWidget(<mapId>, { show_scale_bar: true })` against a map saved without the scale bar; harness console output readable during `revert(-1)`/`forward`.

## Self-Check: PASSED
Created files exist (widgetOverlayKeys.ts, both specs); commits present in git log; STATE/ROADMAP/REQUIREMENTS untouched.
