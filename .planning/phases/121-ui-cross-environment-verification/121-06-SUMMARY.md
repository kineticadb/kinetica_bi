---
phase: 121-ui-cross-environment-verification
plan: 06
subsystem: ui
tags: [react, zustand, custom-metrics, gap-closure, mutation-testing]

# Dependency graph
requires:
  - phase: 121-05
    provides: applyLiveMetricExpr / isMetricsHydrated (liveMetricSql.ts + customMetricsStore.ts) —
      the fail-closed resolver this plan wires into the renderer, unchanged
provides:
  - AggregatedWidgetRenderer resolving a custom metric's expression LIVE (via applyLiveMetricExpr)
    instead of the text frozen into widget.config.sql at Apply time — closes DXIM-V124-10
  - WidgetRenderer.customMetric.spec.tsx — 9 LIVEMETRIC- tests + a fromSwap-order structural-
    precondition spy, proving cross-environment, single-environment-edit, suspend, orphan,
    identity, no-fetch, FROM-swap-composition, scalar and dv-bound behaviours
affects: [121-07 (checkpoint:human-verify — live two-environment operator UAT closing DXIM-V124-10)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Renderer-owned hydration effect gated on isCustomSelection(metricId) && tableId !==
      undefined — mirrors TimelineRenderer.tsx:156-163 byte-for-byte, including its silent
      .catch(() => {}) swallow (see Issues Encountered)"
    - "Suspend-not-fallback render gate: {kind:'pending'} renders the SAME widget-placeholder/
      Loading... markup as the pre-existing dv-pending gate — zero new CSS"
    - "Spy-on-real-implementation as a mutation-probe technique: when a pure string equality
      check on final output cannot discriminate call ORDER (because neither operand contains the
      one token — FROM — that would make order observable), wrap the real fromSwap with vi.fn()
      and assert its call argument directly. Proves the structural precondition instead of an
      output side-effect that happens to coincide across orderings for the realistic fixture set."

key-files:
  created:
    - packages/web/src/components/charts/WidgetRenderer.customMetric.spec.tsx
  modified:
    - packages/web/src/components/charts/WidgetRenderer.tsx

key-decisions:
  - "Two of the six mutation probes (M4, M6) did not redden their named test on the FIRST
    fixture attempt. Per CLAUDE.md/the plan's own mutation-probe rule ('if a probe does not
    redden, strengthen the test — never weaken the probe'), both tests were strengthened rather
    than the probes altered. See 'Mutation Probe Results' below for the full derivation of why
    each original fixture was toothless and what was changed."
  - "LIVEMETRIC-orphan-uses-frozen-sql was rewritten to go through a REAL pending -> ready
    transition (deferred listCustomMetrics promise) instead of pre-seeding the store
    synchronously before render. Pre-seeding made metricsPending false for the ENTIRE test, so
    the pending->ready dep-array requirement (M4's actual target) was never exercised — the test
    passed regardless of whether metricsPending was in Effect 2's dep array."
  - "LIVEMETRIC-fromswap-composes gained a second assertion: a vi.fn() wrapper around the REAL
    fromSwap (delegating to the actual implementation, so behavior is unchanged) asserting its
    first argument already carries the resolved metric expression. Proven algebraically (see
    Issues Encountered) that for the project's actual fromSwap (a plain non-paren-aware regex)
    and replaceValueSelectItem (a depth-aware positional swap), reversing the two operations
    produces a BYTE-IDENTICAL final query for any metric expression that does not itself contain
    a literal FROM token — which is every custom metric expression this product's UI can produce
    (arithmetic aggregate expressions, never subqueries). A pure output-string assertion is
    therefore structurally incapable of discriminating this reordering; the call-argument spy is."
  - "seedMetric() test helper mocks listCustomMetrics to resolve the SAME row being seeded into
    the store synchronously, because AggregatedWidgetRenderer's hydration effect (correctly,
    per Task 1) always calls loadConfig on mount regardless of whether the store already looks
    hydrated — an unconditional re-fetch resolving to the default [] would otherwise clobber a
    pre-seeded fixture out from under the test shortly after mount."

requirements-completed: [DXIM-V124-10]

# Metrics
duration: 55min
completed: 2026-09-18
---

# Phase 121 Plan 06: Live Custom-Metric SQL Resolution — Renderer Wiring Summary

**`AggregatedWidgetRenderer` now resolves a bound custom metric's expression through `applyLiveMetricExpr` before `fromSwap`, hydrating the metrics store itself and suspending (not flashing stale data) while unhydrated — closing the actual defect behind DXIM-V124-10.**

## Performance

- **Duration:** 55 min
- **Started:** 2026-09-18T14:56:00Z (approx, first Read)
- **Completed:** 2026-09-18T15:14:00Z
- **Tasks:** 2
- **Files modified:** 2 (1 modified, 1 created)

## Accomplishments

- `WidgetRenderer.tsx` `AggregatedWidgetRenderer`: frozen `cfg.sql` read replaced with a
  `useMemo(() => applyLiveMetricExpr(storedSql, metricId, tableId), [..., customMetricsConfigVersion])`,
  a dedicated `loadConfig` hydration effect gated on `isCustomSelection(metricId) && tableId !==
  undefined`, a `metricsPending` suspend gate in both Effect 2 and the render body, and
  `metricsPending` added to Effect 2's dep array (load-bearing, not cosmetic — see hazards).
- All 125 pre-existing `WidgetRenderer.spec.tsx` tests pass **unmodified** — `git diff --numstat`
  on that file is empty, confirming the change is inert for every real-column widget.
- `WidgetRenderer.customMetric.spec.tsx` (370 lines, new file): 9 `LIVEMETRIC-` tests covering
  cross-environment resolution, single-environment live edit, suspend-before-hydration, orphan
  fallback, non-custom identity/no-fetch, FROM-swap composition (plus a structural-precondition
  spy), bignumber scalar shape, and dv-bound resolution.
- 6/6 mutation probes (M1-M6) reddened their named test — two required strengthening the test
  after the original fixture proved unable to discriminate (see Mutation Probe Results).

## Task Commits

1. **Task 1: Resolve the custom-metric expression live in AggregatedWidgetRenderer** - `c3f6e3c` (feat)
2. **Task 2: WidgetRenderer.customMetric.spec.tsx — the cross-environment proof** - `3d57772` (test)

**Plan metadata:** (this commit, appended after SUMMARY)

## Files Created/Modified

- `packages/web/src/components/charts/WidgetRenderer.tsx` — `AggregatedWidgetRenderer`: added the
  `applyLiveMetricExpr` import, the `storedSql`/`metricId` split, the hydration effect, the
  `liveMetric` memo, the `metricsPending` suspend gate (Effect 2 + render body), and the
  `metricsPending` dep-array entry. +50 lines, 0 removed beyond the single frozen-read line it
  replaced.
- `packages/web/src/components/charts/WidgetRenderer.customMetric.spec.tsx` — new spec, 370
  lines, 9 `it()` blocks, all `LIVEMETRIC-` prefixed.

## Decisions Made

See `key-decisions` in frontmatter for the two strengthened mutation-probe tests and the
`seedMetric` helper rationale. Additionally:

- Kept `sql` as the downstream variable name after the memo (per the plan's explicit
  instruction) so the ~40 pre-existing references in Effect 2 and the render chain needed zero
  changes — this is also *why* the 125-test invariant held with a 50-line diff.
- The render gate for `metricsPending` was placed immediately after the `!sql?.trim()` early
  return and before `isOrphanDynamicView`, reusing `widget-placeholder` + literal `Loading...`
  verbatim — confirmed via `grep -c widget-placeholder` increasing by exactly 1 (20 -> 21) and
  zero diff under `packages/web/src/styles`.

## Deviations from Plan

### Auto-fixed Issues

None — Task 1's action block was followed as specified; no bugs, missing functionality, or
blocking issues were found in the implementation itself.

### Test-strengthening (mutation probes, not implementation deviations)

These are not code deviations — the implementation matches the plan's `<action>` block exactly.
Two of the six *test* fixtures in the plan's mutation-probe table needed strengthening once run
against the implementation, per the plan's own explicit instruction ("If a probe does not
redden, strengthen the test — never weaken the probe"):

**1. M4 (`LIVEMETRIC-orphan-uses-frozen-sql`) — pre-seeded fixture never exercised the
pending -> ready transition**
- **Found during:** Task 2, mutation probe pass (removing `metricsPending` from Effect 2's dep
  array, as M4 specifies)
- **Issue:** The original test called `useCustomMetricsStore.getState().setConfig(TABLE_ID, [])`
  *before* `render()`, so `isMetricsHydrated(tableId)` was already `true` at first render.
  `metricsPending` was `false` for the entire test — the pending -> ready flip M4 targets never
  occurred, so removing the dep had no observable effect and the test passed unchanged.
- **Fix:** Rewrote the test to leave the store unhydrated at mount and resolve
  `listCustomMetrics` via a manually-controlled deferred promise (the same technique already used
  by `LIVEMETRIC-suspend-no-query-before-hydration`), so the widget genuinely suspends first and
  then transitions to the orphan-resolved state after the fetch resolves to `[]`.
- **Verification:** With M4 applied (dep removed), the strengthened test times out waiting for
  `runSql` to be called (the widget suspends forever, as the hazard describes) — confirmed
  reddening, no collateral. With the dep restored, the test passes.
- **Committed in:** `3d57772` (Task 2 commit — the strengthened version is the only version ever
  committed; no separate "toothless" commit exists in history).

**2. M6 (`LIVEMETRIC-fromswap-composes`) — pure output-string equality cannot discriminate
resolution order for this project's `fromSwap`**
- **Found during:** Task 2, mutation probe pass (moving metric resolution to
  `applyLiveMetricExpr(fromSwap(storedSql, view), ...)`, as M6 specifies)
- **Issue:** Algebraic derivation (also verified empirically): `fromSwap` (a plain,
  non-paren-aware `\bFROM\s+[\w.]+` regex, see `fromSwap.ts`) and `replaceValueSelectItem` (a
  depth-aware positional swap that locates the select-list/FROM boundary independent of the
  table identifier's text) produce a **byte-identical final query string** under either
  operation order, for any metric expression and table name that do not themselves contain a
  literal `FROM` token. Every realistic custom-metric expression in this product (arithmetic over
  aggregates, e.g. `AVG(x) * 50.111111`) meets that condition, so the M6 mutation is a genuine
  behavioral no-op against a pure output-equality assertion — the original test passed unchanged
  under the mutation.
  (Separately, and out of scope for this plan: a hypothetical custom metric expression
  *containing* a subquery with its own `FROM` — which the current UI has no way to author — would
  actually be `fromSwap`-unsafe under **either** ordering, since `fromSwap`'s first-match regex
  has no paren-depth awareness at all. That is a pre-existing, narrower limitation of `fromSwap`
  itself, not something this plan's ordering choice creates or fixes; it is not filed as a new
  tech-debt item because it requires a metric-expression shape the product cannot currently
  produce.)
- **Fix:** Added a `vi.mock("../../lib/fromSwap", ...)` that wraps the REAL implementation in
  `vi.fn()` (delegating to it — behavior for every other test is unchanged) so
  `LIVEMETRIC-fromswap-composes` can assert the **structural precondition** directly: `fromSwap`'s
  first call argument must already carry the resolved metric expression (i.e., resolution ran
  first). This is the CLAUDE.md-sanctioned pattern for an otherwise-unprovable-by-output
  requirement — "Expressing the structural precondition ... is the honest pattern."
- **Verification:** With M6 applied, the strengthened assertion fails (fromSwap is called with
  the frozen, unresolved string) while the final-query-string assertion still passes — confirming
  the new assertion is the one carrying the discriminating power. No collateral on other tests.
- **Committed in:** `3d57772` (Task 2 commit).

---

**Total deviations:** 0 implementation deviations. 2 test fixtures strengthened during mutation
probing, both documented above with the algebraic/empirical reasoning for why the original
fixture could not discriminate. Per CLAUDE.md, this is reported rather than silently absorbed:
the underlying implementation was correct throughout; only the PROOF needed sharpening.
**Impact on plan:** Zero scope creep — no production code was touched to satisfy either
strengthened test.

## Issues Encountered

**INHERITED RISK (not fixed, per explicit plan instruction): a failed hydration fetch suspends
the widget forever.** The hydration effect added in Task 1 ends in
`useCustomMetricsStore.getState().loadConfig(tableId).catch(() => {})` — copied byte-for-byte
from `TimelineRenderer.tsx:156-163`, per the plan's explicit requirement. If that fetch REJECTS
(network error, 5xx, server restarted mid-session), `setConfig` never fires, `isMetricsHydrated`
stays `false`, and the widget suspends in `Loading...` **indefinitely, with no error surfaced and
no retry**. This is not introduced by this plan — the identical swallow already ships for
Timeline/NumericLine/Calendar widgets and for `BarRenderer`'s own pre-existing
`loadConfig(tableId)` call at `WidgetRenderer.tsx:905-907`. Per the plan's hazards section, no
retry/error-banner/fallback was invented here; this record carries the risk forward rather than
losing it. Recommended follow-up (not filed as a new TD id by this plan — flagging for 121-07 or
a future phase to formalize): a shared `.catch` idiom across all `loadConfig`-calling hydration
effects that surfaces a retry affordance, mirroring the existing dv-error retry button pattern
already in this same file.

No other issues — the implementation matched the plan's `<action>` block exactly, and both test
gaps identified during mutation probing were resolved by strengthening tests, not by changing
production code or weakening probes.

## Mutation Probe Results (M1-M6)

All six probes were applied to `/tmp/WidgetRenderer.tsx.bak` deltas (a saved-off backup of the
Task-1-complete file), run against `WidgetRenderer.customMetric.spec.tsx`, then reverted —
verified byte-identical via `diff` against the backup after each revert.

| # | Deliberate break | Named test | Result | Collateral |
|---|---|---|---|---|
| M1 | `useMemo` returns `storedSql` always (delete the `applyLiveMetricExpr` call) | `LIVEMETRIC-XENV-target-expression` | **REDDENED** | 5 others also reddened (singleenv-edit-refetches, suspend-no-query, fromswap-composes, bignumber-scalar, dv-bound-resolves) — expected, since every metric-bound fixture depends on live resolution |
| M2 | Delete the `if (metricsPending) return;` gate from Effect 2 | `LIVEMETRIC-suspend-no-query-before-hydration` | **REDDENED** | none |
| M3 | Gate the hydration effect on `tableId !== undefined` only (drop `isCustomSelection`) | `LIVEMETRIC-noncustom-no-metric-fetch` | **REDDENED** | none |
| M4 | Remove `metricsPending` from Effect 2's dep array | `LIVEMETRIC-orphan-uses-frozen-sql` | **REDDENED** (after strengthening — see Deviations) | none |
| M5 | Remove `customMetricsConfigVersion` from the `useMemo` dep array | `LIVEMETRIC-singleenv-edit-refetches` | **REDDENED** | 2 others also reddened (suspend-no-query, orphan-uses-frozen-sql) — expected: both also rely on the memo recomputing after a configVersion-driven hydration transition |
| M6 | Move the resolution AFTER `fromSwap` (`applyLiveMetricExpr(fromSwap(storedSql, view), ...)`) | `LIVEMETRIC-fromswap-composes` | **REDDENED** (after strengthening — see Deviations) | none |

6/6 probes reddened their named test. M4 and M6 required strengthening the FIXTURE (not the
implementation, not the probe definition) before they could discriminate — full derivation in
"Deviations from Plan" above.

## Test Gates (real numbers)

- `cd packages/web && npx tsc --noEmit` → **clean** (0 errors)
- `cd packages/web && npx vitest run` → **181 files / 4100 tests / 0 failed** (baseline after
  121-05 was 180 files / 4091 tests; this plan added exactly 1 new file —
  `WidgetRenderer.customMetric.spec.tsx` — contributing 9 tests; 4091 + 9 = 4100, exactly as
  expected)
- `cd packages/web && npx vitest run src/components/charts/WidgetRenderer.spec.tsx` → **125
  passed, 0 failed**; `git diff --numstat` on that file is **empty**
- `cd packages/web && npx vitest run src/styles/theme-guard.spec.ts` → **152/152**
- `cd packages/server && npx tsc --noEmit` → **clean** (0 errors; server untouched)
- `git diff --numstat HEAD -- packages/server` → **empty**
- `git diff --numstat HEAD -- packages/web/src/styles` → **empty**
- `grep -c widget-placeholder packages/web/src/components/charts/WidgetRenderer.tsx` → **21**,
  vs. **20** at `git show HEAD~2` (the pre-Task-1 baseline) — exactly +1, matching the single new
  `metricsPending` render gate

## Widget-type coverage (stated plainly, per CLAUDE.md's "no dressed-up rigor" rule)

- **Exercised directly by a test:** `bar` (7 of the 9 `LIVEMETRIC-` tests), `bignumber` (1 test,
  `LIVEMETRIC-bignumber-scalar`, proving the scalar/no-group-by SQL shape also resolves live).
- **Covered by construction, not by a dedicated per-type test:** `line`, `pie`, `scatter`,
  `table`, `heatmap` — all seven `AggregatedWidgetRenderer`-served types share the exact same SQL
  resolution path up to the `switch (widget.type)` dispatch at `WidgetRenderer.tsx:788-806`, which
  this plan does not touch. Stated explicitly rather than implied, per CLAUDE.md's guidance on
  not dressing an unproven claim as verified.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

`AggregatedWidgetRenderer` now resolves custom-metric expressions live for all seven widget types
it serves, closing the version seam with `TimelineRenderer`/`NumericLineRenderer`/
`CalendarRenderer` and fixing both the cross-environment import symptom and the confirmed
single-environment staleness bug from the same root cause. DXIM-V124-10's requirement-level proof
(`LIVEMETRIC-XENV-target-expression`) is in place: the executed query string is asserted with a
full-string `toBe` to carry the TARGET environment's expression.

**Not automatically verifiable, and deliberately NOT attempted here** (per the plan's own
`<verification>` section): that the import report's `metricConflicts` sentence now reads TRUE
against a LIVE two-environment Kinetica round trip. No automated test in this repository renders
a chart against a live database. This is Plan 121-07's `checkpoint:human-verify` — the same live
environments (`:4000`/`:5173` env A, `:4001`/`:5174` env B) that reproduced the original defect in
121-04 are still available for that check, per STATE.md.

No blockers. STATE.md / ROADMAP.md / REQUIREMENTS.md / the defect doc were NOT touched by this
plan, per the ownership rule — 121-07 owns those updates and the final DXIM-V124-10 closure
decision.

---
*Phase: 121-ui-cross-environment-verification*
*Completed: 2026-09-18*

## Self-Check: PASSED

- FOUND: packages/web/src/components/charts/WidgetRenderer.tsx (modified, diff confirmed)
- FOUND: packages/web/src/components/charts/WidgetRenderer.customMetric.spec.tsx
- FOUND: commit c3f6e3c (Task 1)
- FOUND: commit 3d57772 (Task 2)
