---
phase: 121-ui-cross-environment-verification
verified: 2026-09-21T10:30:00Z
status: passed
score: 7/7 must-haves verified
---

# Phase 121: UI + Cross-Environment Verification Verification Report

**Phase Goal:** "The operator can export a dashboard from one environment and import it into another
entirely from the app, and the imported dashboard renders identically to the original."
**Verified:** 2026-09-21
**Status:** passed
**Re-verification:** No — initial verification (no prior 121-VERIFICATION.md existed)

## Summary

Phase 121 ran in two parts, both verified against the actual codebase and git history, not just the
SUMMARYs' claims.

**Part 1 (121-01..04, shipped 2026-09-18):** built the export/import client API, the import report
modal, the DashboardsPage wiring, and ran a genuine two-server, two-database operator round trip.
The round trip surfaced four real defects the automated gates could not — three were fixed in-flight
(REF-9 `spatialTargets`, `max_records: 0` rejection, wrong-table custom metrics), and the fourth (a
frozen `config.sql` metric expression, falsifying the import report's own `metricConflicts` sentence)
correctly REOPENED DXIM-V124-10 rather than being waved through.

**Part 2 (121-05..07, shipped 2026-09-21):** fixed the frozen-expression defect in the RENDERER
(`AggregatedWidgetRenderer`), not in import/export, keeping Phases 119/120 closed; proved it with a
full-string SQL assertion; then had the operator re-confirm live in the same two environments before
re-closing DXIM-V124-10.

I independently re-ran every gate this record depends on rather than trusting the SUMMARYs' printed
numbers, and every one matched exactly.

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Operator can export a dashboard to a downloaded file from the UI, permission-gated | ✓ VERIFIED | `DashboardsPage.tsx:308-317` — per-row "Export" `ghost-sm` button calls `downloadDashboardExport(dash)`; gated implicitly by dashboard visibility (no separate permission per plan — matches ROADMAP criterion 1) |
| 2 | Operator can upload/import a file from the UI and see the full report | ✓ VERIFIED | `DashboardsPage.tsx:132,255-257,331-334` — `canImport = canCreate && hasPermission(DATASETS_MANAGE)` AND-gate; `ImportDashboardModal` renders every `MetricConflict.message`/`warnings[]` verbatim (14 `IMPRPT-` tests, `metricConflicts.length` used only as a `>0` guard, never a count) |
| 3 | A real cross-environment round trip (two servers, two DBs) reproduces the dashboard faithfully | ✓ VERIFIED | 121-04-SUMMARY.md: `:4000`/`kinetica.db` → `:4001`/`env-b.db`, 3 imports, 11-row comparison table all PASS/NOT-EXERCISED-and-explained, E1/E2 mechanical checks (env-b.db exists, 2 concurrent `tsx watch`) |
| 4 | Interactive features (drill-down, filters, map layers, Legend) still work on the imported copy | ✓ VERIFIED (with one honestly-recorded exception) | Rows 8-10 of 121-04's comparison table PASS; row 7 (standalone Legend/REF-3) explicitly marked NOT EXERCISED because this dashboard has no Legend widget — carried forward, not hidden |
| 5 | The custom-metric SQL defect found by the round trip is actually fixed in code, not just documented | ✓ VERIFIED | `WidgetRenderer.tsx:411-436,568-569,651,732-736` — `applyLiveMetricExpr` resolves live, before `fromSwap`; gated on `isCustomSelection(metricId) && tableId !== undefined`; suspends (does not fall back) while unhydrated |
| 6 | The fix's own proof is a genuine full-string SQL assertion, not a substring/visual check | ✓ VERIFIED | `WidgetRenderer.customMetric.spec.tsx:177` — `expect(...).toBe(TARGET_SQL)` on the full executed SQL string, explicit comment rejecting `toContain` |
| 7 | The fix is inert for every pre-existing real-column widget and untouched export/import format | ✓ VERIFIED | `WidgetRenderer.spec.tsx` unmodified (`git diff --numstat` between `c3f6e3c~1` and HEAD is empty), still 125 `it(` blocks; `packages/server` carries zero diff across the entire 121-05/06/07 range (`git diff --numstat 1237997^ HEAD -- packages/server` empty) |

**Score:** 7/7 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/web/src/api/client.ts` | `downloadDashboardExport`, `importDashboardFile`, `ImportReportDto` family | ✓ VERIFIED | present, wired into `DashboardsPage.tsx` and `ImportDashboardModal.tsx` |
| `packages/web/src/components/ImportDashboardModal.tsx` | Full report presentation, no invented CSS | ✓ VERIFIED | reuses `modal-overlay`/`ds-actions`/`btn-primary btn-sm`/`ghost-sm` etc.; `global.css` diff empty for this plan |
| `packages/web/src/lib/liveMetricSql.ts` | `applyLiveMetricExpr`, fail-closed parser | ✓ VERIFIED | depth/quote-aware scanner, fail-closed on any unrecognized shape, zero React imports as specified |
| `packages/web/src/components/charts/WidgetRenderer.tsx` (`AggregatedWidgetRenderer`) | live metric resolution wired in, ordered before `fromSwap` | ✓ VERIFIED | `applyLiveMetricExpr` call at :428, `fromSwap(sql, effectiveViewName)` at :651 consumes the already-resolved `sql`; render/effect suspend gates on `metricsPending` present |
| `packages/web/src/components/charts/WidgetRenderer.customMetric.spec.tsx` | ≥250 lines, LIVEMETRIC- full-string proofs | ✓ VERIFIED | 9 `LIVEMETRIC-` tests, `LIVEMETRIC-XENV-target-expression` uses `toBe` against the full SQL string |
| `.planning/REQUIREMENTS.md` | DXIM-V124-01/-03/-10 evidence matches code | ✓ VERIFIED | All three requirements' evidence clauses read accurately against what was actually run/built (checked verbatim) |
| `.planning/defect-frozen-config-sql-metric-expression.md` | Status flipped FIXED with an honest "Fix as shipped" | ✓ VERIFIED | `Status: FIXED 2026-09-21`; records the (b)-over-(a) design decision with concrete code-derived reasons |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `WidgetRenderer.tsx` | `liveMetricSql.ts` | `applyLiveMetricExpr` inside `useMemo` keyed on `customMetricsConfigVersion` | ✓ WIRED | confirmed at lines 419-436 |
| `WidgetRenderer.tsx` | `customMetricsStore.ts` | dedicated `loadConfig` hydration effect | ✓ WIRED | gated `isCustomSelection(metricId) && tableId !== undefined` (line 421), matching the plan's inertness requirement |
| `AggregatedWidgetRenderer` Effect 2 | `fromSwap.ts` | `fromSwap(sql, effectiveViewName)` receives the resolved `sql` | ✓ WIRED | ordering verified directly in source (sql resolved at :436, consumed at :651) |
| `DashboardsPage.tsx` | `client.ts` | `downloadDashboardExport(dash)` / `importDashboardFile` via `ImportDashboardModal` | ✓ WIRED | both call sites confirmed |
| `.planning/REQUIREMENTS.md` | `121-06-SUMMARY.md` | evidence citation for DXIM-V124-10 re-closure | ✓ WIRED | traceability row 116 cites `121-06-SUMMARY.md` |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|--------------|--------|----------|
| DXIM-V124-01 | 121-01, 121-04 | Export produces a file with everything needed to recreate the dashboard | ✓ SATISFIED | Cross-environment export of dashboard 4, 0 danglingReferences, re-verified 2026-09-18 |
| DXIM-V124-03 | 121-01/02/03, 121-04 | Import recreates the dashboard and all visualizations elsewhere | ✓ SATISFIED | Two real servers/DBs, 9 widgets render identically, REF-2/-4/-5 exercised live for the first time |
| DXIM-V124-10 | 121-02, 121-04 (reopened), 121-05/06/07 (re-closed) | Import reports what it did, accurately | ✓ SATISFIED | Reopened honestly when found false for 7 chart types; fixed in the renderer, not import; re-closed on a full-string SQL proof plus a live two-environment operator confirmation. The reopen-then-reclose cycle is left fully visible in REQUIREMENTS.md rather than smoothed over. |

No orphaned requirements found — REQUIREMENTS.md's Phase 121 mapping (DXIM-V124-01/-03/-10) matches exactly what the plans' frontmatter claims.

### Anti-Patterns Found

None. Scanned `client.dashboard-export-import.spec.ts`, `ImportDashboardModal.tsx`, `liveMetricSql.ts`, `WidgetRenderer.customMetric.spec.tsx`, and the modified region of `WidgetRenderer.tsx` for TODO/FIXME/placeholder/empty-implementation patterns — the only match was the literal string `widget-placeholder` (a real, pre-existing CSS class, not a stub marker).

### Gate Re-Verification (run independently, not trusted from SUMMARYs)

| Gate | Command | Result | Matches SUMMARY claim? |
|------|---------|--------|------------------------|
| Web tsc | `cd packages/web && npx tsc --noEmit` | clean | yes |
| Web vitest | `cd packages/web && npx vitest run` | **181 files / 4100 tests / 0 failed** | yes, exact match |
| Web theme-guard | `npx vitest run src/styles/theme-guard.spec.ts` | **152/152** | yes, exact match |
| Server tsc | `cd packages/server && npx tsc --noEmit` | clean | yes |
| Server gate (SET-BASED) | `node scripts/test-gate.mjs` | **GATE PASSED** — same 8 documented failing files (7× TD-V11-04 OIDC + `db.smoke` drift + `routes.wms`) | yes, exact match |
| Server diff across 121-05/06/07 | `git diff --numstat 1237997^ HEAD -- packages/server` | empty | yes |
| Working tree | `git status --porcelain` | clean | n/a |

### Honesty-Requirement Checks

1. **Both SPAs ran under Vite; nginx same-origin path unverified** — still stated plainly in
   `121-04-SUMMARY.md` §"Known limitations" and carried into `ROADMAP.md`'s "Known gaps carried, not
   smoothed over" item (3). Confirmed present, not dropped.
2. **Both servers share one `KINETICA_URL` — metadata portability only** — same location, item (3);
   also stated in the round-trip's own §"The two environments". Confirmed present.
3. **Standalone Legend (REF-3) not re-exercised** — 121-04's comparison table row 7 explicitly says
   "NOT EXERCISED — this dashboard carries no standalone Legend widget"; ROADMAP item (4) repeats it.
   Confirmed present, not silently marked PASS.
4. **`loadConfig(...).catch(() => {})` — a rejected fetch suspends a widget forever** — recorded in
   121-06-SUMMARY.md §"Issues Encountered" (INHERITED RISK), 121-06-PLAN.md's own hazards section,
   121-07-SUMMARY.md §"Still open — recorded, not fixed", and STATE.md's `stopped_at` block. Confirmed
   present in four separate places, explicitly NOT fixed, correctly attributed to the pre-existing
   `TimelineRenderer.tsx` idiom rather than invented by this gap-closure plan.
5. **121-07's "All 4 pass" blanket verdict** — checked `121-07-SUMMARY.md` directly: it states "the
   verdict came as a blanket pass, so no per-check numbers are transcribed here" and explicitly
   rejects inventing plausible per-check figures as "the failure mode CLAUDE.md's verifiable-criteria
   section exists to prevent." Confirmed: no numbers were invented; the table only carries PASS/PASS/
   PASS/PASS with no fabricated readouts.

All five recorded limitations are still honestly present and none were quietly dropped or upgraded.

### Human Verification Required

None outstanding. The phase's own `checkpoint:human-verify` tasks (121-04 Task 1, 121-07's live
re-verification) were already executed by the operator during phase execution, and their verbatim
verdicts are recorded in 121-04-SUMMARY.md and 121-07-SUMMARY.md respectively. This verifier
independently re-ran every mechanically-checkable gate the human checks depended on (tsc, vitest,
theme-guard, server gate, git diffs) and all matched.

### Gaps Summary

No gaps found. Both the artifact-level and requirement-level evidence in `.planning/REQUIREMENTS.md`,
`.planning/ROADMAP.md`, and `.planning/STATE.md` match what the code, tests, and git history actually
show. The one item worth flagging for the record (not a gap, since it is deliberately and repeatedly
disclosed rather than hidden): the milestone's cross-environment claim is metadata portability only —
one shared `KINETICA_URL`, no nginx same-origin path exercised, no second machine. This is stated
consistently across 121-04-SUMMARY.md, ROADMAP.md, and REQUIREMENTS.md, so it does not block a
`passed` verdict — it is exactly the kind of honestly-scoped claim CLAUDE.md's acceptance-criteria
guidance asks for.

One pre-existing, unrelated observation: two empty stray `.planning` directories exist at
`packages/web/.planning/phases/{97-calendar-smart-domain-control}` and
`packages/web/src/.planning/phases/{115-deep-link-authentication-flow,118-zoom-aware-layer-legend}`.
Both contain no files (empty leaf directories only). They predate Phase 121 (from phases 97/115/118),
were not touched or added to by any 121 plan or by this verification, and this report was written
only to the canonical path at repo root, per instructions. Flagging per the standing incident record;
not a Phase 121 defect.

---

_Verified: 2026-09-21_
_Verifier: Claude (gsd-verifier)_
