# Project Retrospective

*A living document updated after each milestone. Lessons feed forward into future planning.*

## Milestone: v1.2 — Interactive Dashboards

**Shipped:** 2026-05-06
**Phases:** 4 (Phase 9 → Phase 12) | **Plans:** 24 | **Commits:** 139 (25 `feat()`)

### What Was Built

- **Filter Foundation (Phase 9):** Table-keyed `useFilterStore` Zustand slice with `filterVersion` primitive dep, SQL-safe builder utilities, AbortController-driven in-flight cancellation, lifecycle reset on logout / dashboard switch.
- **Drill-Down (Phase 10):** Click-to-filter across 6 chart types (bar/line/pie/scatter/table/records) with 300ms dim-peers transient, row-tint, first-add toast, interactive filter bar with dismissable chips.
- **Map Chart (Phase 11):** OpenLayers `ImageWMS` map widget with 4 render modes (raster/heatmap/classbreak/contour) × 3 spatial modes (lat-lon/WKT/WKB), capabilities-store boot-discovery, classbreak builder with cardinality-probe gating, and gap-closure plan 11-10 to restore the ChartConfigPanel scaffold.
- **Layers Panel (Phase 12):** Dashboard-scope `dashboard_layers` SQLite registry, two-pane LayersModal (drag-reorder, opacity, classbreak, missing-table state), N-stacked-ImageWMS rendering per map widget with `widget.config.includedLayerIds` multi-select, hard cutover from Phase 11 single-WMS shape via `.widget-map-reconfigure` overlay.

### What Worked

- **Frontend test infra carried over from v1.1.** Vitest + jsdom + RTL + Zustand store-reset shim was already in place from Phase 7 — Phase 9-12 added tests without re-bootstrapping. Net effect: every phase shipped with green tests on day one.
- **PITFALL locks as planning artifact.** Recording M-01..M-08 (map lifecycle, filter invalidation, SRS, geometry params, blur radius units, classbreak cap, URL length, cache control) in roadmap *before* Phase 11 kicked off meant zero relitigation during execution; Plan 12-05's renderer rework explicitly preserved each lock by reference.
- **TDD GREEN cycle for KineticaWmsLayerForm.** Phase 12-02 extracted the form from MapConfigPanel as a pure controlled component with spec written first — caught two contract drift issues (auto-suggest hint visibility, draft `__autoSuggestActive` flag) before the LayersModal consumer was built in 12-04.
- **Wave-based parallelization.** Phase 12 split 6 plans into 4 waves (1: backend+form-extract, 2: client+store, 3: modal+renderer, 4: verify) — ~2.5 hours of wall time vs sequential.
- **Hard cutover decision (LAYER-12).** Rejecting auto-migration for Phase 11→12 widget shape reduced Phase 12 scope by an entire plan; the `.widget-map-reconfigure` overlay was 50 lines of CSS + 10 lines of TSX vs a serialization-format migration with backward-compat tests.

### What Was Inefficient

- **WMS QUERY filter never end-to-end-validated.** Phase 11 spike accepted the param without error and shipped `MAP-04 / FILT-04` as `human_needed`. Phase 12-06 verification revealed Kinetica returns identical tiles regardless of the param. By that point the entire renderer pipeline had been built around a contract that didn't hold. Net cost: Plan 12-07 scoped + spike scaffolding written + reverted; visual gap discovered weeks after the param was committed. **Lesson:** spike output must include a *positive verification signal* (sha1 difference, visible PNG diff), not just "HTTP 200 + no XML error."
- **LAYER-01..13 not in REQUIREMENTS.md.** Phase 12 was scoped via 13 LAYER-* requirement IDs in plan frontmatter but were never added to the milestone's `REQUIREMENTS.md` traceability table — that file ended at the original FILT/DRILL/MAP block. v1.2 closed with 12/12 tracked but ~24 actually delivered. **Lesson:** at phase-planning time, append phase-introduced requirements to `REQUIREMENTS.md` before the plan is finalized.
- **Demo dataset masked verification.** `demo.nyctaxi` at city zoom is too dense to make filter narrowing visually distinguishable. The Phase 11 spike *should* have failed visibly but produced "passed" because the operator couldn't tell. **Lesson:** WMS filter verification needs a low-cardinality / spatially-spread test fixture (TD-V12-04).
- **GAP-12-C3 shipped as RED then superseded mid-cycle.** Plan 12-07 was scoped, executed through its autonomous-portion checkpoint, then operator-aborted in favor of a wholesale filter rework. The reverted commit + superseded markers are clean, but the planning churn (12-07 PLAN.md was a full ~600-line gap-closure plan) was net waste. **Lesson:** when a verification gap surfaces, ask "is this a fix or a redesign?" before scoping the gap-closure plan — a one-paragraph triage memo would have caught this.

### Patterns Established

- **Capability-store boot-discovery pattern.** `useWmsCapabilitiesStore` fetches `?REQUEST=GetCapabilities` on app boot, then UI components read it as a graceful-fallback gate (null → permissive default; populated → restrict to advertised modes/colormaps). Reusable for any future server-driven UI capability negotiation.
- **`columnsKey` primitive dep.** Hashing the columns prop into a primitive string for `useEffect` deps avoids the "array-reference-stable-but-content-changed" trap (PITFALL S-02). Pattern reused per-layer in Phase 12 stale-clear logic.
- **3-effect OL renderer split.** Effect 1 = Map create/dispose. Effect 2 = source attach + load listeners. Effect 3 = filter invalidate. Boundaries are sharp; each effect's deps are minimal and primitive. Phase 12-05's N-layer rework reused the structure verbatim per layer.
- **`KineticaWmsLayerForm` as a pure controlled component.** Form does not auto-suggest, does not own column-staleness logic, does not embed a table picker — caller (LayersModal / MapConfigPanel) provides those. Reusable in two consumers without behavior drift.
- **TDD-RED + TDD-GREEN task pairing in plans.** Phase 12 plans use `<task type="auto" gate="tdd-red">` to write failing specs first, then `<task type="auto" gate="tdd-green">` to implement. Catches contract issues at spec-write time rather than at integration time.
- **Operator-direction supersession over auto-fix.** When GAP-12-C3 surfaced, the natural GSD-flow would be `/gsd:plan-phase 12 --gaps` → execute → close. Instead the operator stepped in mid-cycle to re-scope. The clean revert + superseded-marker pattern (commit `8e60d2c` revert + `87c0063` doc-mark) is reusable for any gap that turns out to need a redesign rather than a fix.

### Key Lessons

1. **Spike output needs positive verification, not absence-of-error.** "HTTP 200, no XML error" is necessary but not sufficient. Spike notes must capture an artifact that proves the param/feature *did something* (sha1 diff, PNG comparison, structured server response, etc.). Phase 11 spike accepted `QUERY` based on absence-of-error and Phase 12 paid for it.
2. **Phase-introduced requirements need to flow into REQUIREMENTS.md before plan finalization.** Plan frontmatter is internal state. The milestone-level traceability table is the audit signal. Drift between them is invisible until milestone close.
3. **Verification fixtures matter as much as code.** `demo.nyctaxi` was wrong for WMS filter verification. A test-fixture decision deserves its own line in the phase plan ("verify against table T with column C of cardinality N").
4. **Scope a gap-closure plan only after a triage decision.** When a RED criterion surfaces, the question isn't "what's the fix?" — it's "is this a fix or a redesign?" Plan 12-07 was scoped at ~600 lines for a problem that turned out to require a redesign; the redesign decision invalidated the entire plan.
5. **Hard cutover beats auto-migration when the new shape is materially different.** Phase 11 widget config (inline) vs Phase 12 (out-of-widget in `dashboard_layers`) was different enough that auto-migrate would have been ~3x the surface area of a reconfigure overlay. The hard-cutover decision freed Phase 12 to ship in 24 hours instead of 72.

### Cost Observations

- **Model mix:** Predominantly Sonnet for execution (gsd-executor default profile); Opus for orchestrator + planning (current session uses Opus 4.7 1M context).
- **Sessions:** ~5-6 sessions across 3 days (2026-05-04 → 2026-05-06).
- **Notable:** Phase 11 had the highest plan count (10) and the longest single-phase planning surface (~2 days of plan + research artifacts before execution); Phase 12 was the tightest (4 days plan-to-ship), benefiting from Phase 11's PITFALL locks already being in place.

---

## Milestone: v1.3 — Unified Dashboard Filtering

**Shipped:** 2026-05-07
**Phases:** 5 (Phase 13 → Phase 17) | **Plans:** 14 + 3 gap-closure cycles | **Commits:** 86

### What Was Built

- **Materialize primitive (Phase 13):** Net-new `POST + DELETE /api/filter/materialize` endpoint with pure `viewNaming.ts` + `whereClause.ts` helpers; stateless (no SQLite rows for transient views); Kinetica 5-min sliding TTL as sole cleanup; view-name format `_kbi_filt_u<userId>_d<dashId>_t<tableId>_s<sessionShort>`; 23/23 supertest green for both auth modes. P1 spikes S1-S4 all resolved before any code landed.
- **useFilterViewStore (Phase 14):** New Zustand slice (per-tableId: `viewName`, `expiresAt`, `materializing`, `materializeVersion`; reference-stable updates; 6 actions) + `materializeFilter` / `dropFilterView` client helpers in `client.ts`. Ships dormant — no production callers until Phase 15.
- **FROM-swap chart filtering (Phase 15):** `AggregatedWidgetRenderer` as sole materialize trigger (300ms debounce, `materializeAbortRef`, `markMaterializing → materializeFilter → setView`); `RecordsTableRenderer` pure consumer; `fromSwap.ts`, `FilteringBadge`, `kineticaErrors.isViewNotFoundError`; dual-path TTL recovery; atomic dead-code deletion of 4 WHERE-injection functions; logout + dashboard-switch snapshot-loop-DROP.
- **LAYERS-swap map filtering (Phase 16):** `wmsUrlBuilder.buildWmsParams` 2-arg LAYERS-swap; `QUERY`/`FILTER_PARAM` deleted; `_v` renamed `_mv` (conditional on `materializeVersion`); `MapChartRenderer` viewsKey selector; `viewExpiry.ts`; `MapFilteringBadge`. Closes TD-V12-01.
- **E2E verification + 3 gap-closure cycles (Phase 17):** Full UAT: 4 flows, 8 chart types, 4 edge cases, TTL recovery (all PASS). Gap closures: pre-materialize double-fire race (17-02), synchronous `markMaterializing` + RecordsTable empty-FROM fallthrough (17-03), FilterBar chip rendering for no-views-row tables (17-04). OIDC S2.b closed by operator live test.

### What Worked

- **Spike-first approach (Phase 13 before all code).** The 4 architectural spikes (S1-S4) ran against the deployed Kinetica instance before a single implementation line was written. S1 confirmed WMS views work; S3 captured the verbatim error string for `isViewNotFoundError`. The endpoint's error handling, view naming, and schema approach were all locked by spike findings — no discovery-during-implementation churn.
- **Atomic single-plan for Phase 16.** The operator locked Phase 16 to a single plan (16-01) covering all 5 internal tasks across 4 waves. With the Phase 15 pure-consumer contract already established and Phase 16's surface area fully defined by that contract, the single-plan approach completed in 11 minutes — the fastest v1.3 phase by wall time.
- **Gap-closure plan numbering within Phase 17 (17-02, 17-03, 17-04).** Three bugs surfaced during UAT but were caught before the operator's attestation walkthrough. Numbering them within the verification phase preserved the chronological record and avoided a full replanning cycle. Each gap-closure was small and targeted (12 new tests, 2 new tests, 1 new test). The verification phase still closed cleanly on the day it started.
- **Pure-consumer pattern for Map + RecordsTable.** Designating `AggregatedWidgetRenderer` as the sole materialize trigger (with module-source grep as a spec assertion in Phase 16) eliminated an entire class of potential race conditions: redundant DDL, cross-table over-fire, duplicate badges. The spec proved the lock held.

### What Was Inefficient

- **Three gap-closure cycles during UAT.** The pre-materialize double-fire race (17-02), synchronous `markMaterializing` issue (17-03), and FilterBar chip rendering bug (17-04) were all caught during UAT — not by the Phase 15/16 test suites. Retrospective question: could a 15-minute manual smoke test after Phase 15 landed have caught these before Phase 17? Probably yes for the double-fire and chip issues; the synchronous `markMaterializing` race was subtler. **Lesson:** Add a pre-UAT manual smoke checklist covering the top-3 race conditions as a template item in the verification phase plan.
- **Backend test suite divergence unnoticed for 4 phases.** TD-V11-04 (OIDC mock divergence, ~60 tests red) and TD-V13-01 (fetch-mock brittleness, ~44 tests red) were latent from commit 22def0a (2026-05-04) through Phases 13-16. Phase 17 was the first milestone-close that ran the full backend suite. **Lesson:** The regression gate should include at minimum a `vitest run` of the full backend suite at each phase close — not just the v1.3-specific spec file. The Phase 15 backend test run only checked `routes.filter-materialize.spec.ts`.
- **`bumpMaterializeVersion` dead action shipped.** The `bumpMaterializeVersion` action was added to `useFilterViewStore` in Phase 14 but had no caller by Phase 16 close (superseded by `setView`'s built-in version bump). It was flagged in Phase 17's "What This Verification Did NOT Cover" section but not removed (verification-only constraint). Small cleanup deferred to v1.4.

### Patterns Established

- **Gap-closure numbering within a verification phase (17-02, 17-03, 17-04).** When UAT surfaces bugs before the operator attestation walkthrough, numbering gap-closures within the current phase (rather than opening a new phase) keeps the history legible, avoids replanning overhead, and closes the phase on the same day. Pattern: `<phase>-<NN>-SUMMARY.md` without a corresponding PLAN.md.
- **`tech_debt` overall_status with carry-over registry.** The 17-VERIFICATION.md frontmatter `gaps:` array with `id`, `severity`, `deferred_to`, and `note` is a reusable pattern for pragmatic-close milestones. The carry-over registry is explicitly linked in MILESTONES.md Known Gaps, STATE.md Blockers, and PROJECT.md Active section — three places future planning reads from.
- **Module-source grep as a spec assertion for architectural locks.** Phase 16 used `?raw` Vite import to read `MapChartRenderer.tsx` source at test time and assert zero writer-method refs to `useFilterViewStore`. This pattern proves a contract that type-checking alone cannot (the module compiles fine regardless of whether it calls setView or not). Reusable wherever a "pure consumer" architectural boundary must be enforced.
- **`clearMaterializing` as a separate action from `clearView`.** Phase 17-02 surfaced the need for a reset of only the `materializing` flag (without clearing `viewName`/`expiresAt`) when a materialize call fails mid-flight. The original `clearView` deleted the entire entry. The gap-closure added `clearMaterializing` as an additive fix. Pattern: Zustand actions should have minimal-surface semantics; don't reuse a delete-key action where a field-set is what's needed.

### Key Lessons

1. **Run the full backend test suite at every phase close, not just the new spec file.** TD-V11-04 and TD-V13-01 were latent for 4 phases (13-16) because the phase-level gate only ran `routes.filter-materialize.spec.ts`. A full `vitest run` at Phase 13 close would have surfaced both issues when they were still fresh context.
2. **A pre-UAT smoke test checklist catches races that unit tests don't cover.** Three gap-closure cycles were needed because the UAT walkthrough was the first end-to-end exercise of the filter lifecycle. A 15-minute smoke test after Phase 15 (before Phase 16 map work) would have been sufficient to catch the double-fire race and chip rendering bug. Add a smoke-test task to the verification phase template.
3. **Spike output must include a positive verification artifact, not just absence-of-error.** (Confirmed from v1.2 lesson.) Phase 13 spike S1 produced a PNG tile response as positive evidence. S3 produced the verbatim error string. Both were directly consumed by implementation code. This is the correct pattern — spikes should produce artifacts that can be pasted into code or tests.
4. **Dual-path TTL recovery (proactive + reactive) with max-1-retry cap is the correct pattern for any client-side server-side-state invalidation.** The proactive check catches the idle-then-return case cheaply. The reactive catch covers the race between check and execution. The max-1-retry cap prevents infinite loops. This three-part pattern should be documented in CONTEXT.md as a reusable approach for any v1.4+ feature that deals with server-side state that can expire.
5. **Backend test mock updates must land atomically with production code changes.** TD-V11-04 exists because commit 22def0a added `new Issuer(meta)` to production code without updating 6 test files. The rule: when you touch a production module, check if any test file has a `vi.mock()` for that module and update it in the same commit. This is a 30-second check that prevents a multi-session debugging session 4 phases later.

### Cost Observations

- **Model mix:** Predominantly Sonnet 4.6 for execution (gsd-executor). Orchestration via user direction.
- **Sessions:** Concentrated — v1.3 shipped in ~2 calendar days (2026-05-06 → 2026-05-07).
- **Notable:** Phase 16 (map-filtering) was the fastest phase at ~11 minutes wall time, enabled by Phase 15's pure-consumer contract locking the interface precisely. Phase 15 (chart-filtering) was the longest at ~274 minutes for 15-02 alone — the most complex single plan in v1.3, covering 6 tasks across materialize trigger, FROM-swap, dead-code deletion, badge component, lifecycle wiring, and test coverage.

---

## Milestone: v1.4 — Map Info Popup

**Shipped:** 2026-05-11
**Phases:** 7 (Phase 18 → Phase 24) | **Plans:** 23 (incl. 3 gap-closure in Phase 24) | **Commits:** 122

### What Was Built

- **Spatial query primitive (Phase 18):** `POST /api/info/query` with `latlon` and `wkt` modes (GEODIST in meters; STXY_DISTANCE in degrees); server-side `pxToGroundDistance` / `pxToGroundDegrees` siblings; `wkb` mode returns HTTP 501 with `TD-V14-WKB-SPIKE` payload. Spike runner preserved at commit `d458408` for future WKB-binary re-run.
- **Config schema (Phase 19):** `dashboard_layers` extended with `info_enabled` / `info_columns` / `info_template` via PRAGMA-guarded idempotent ALTER; map widget config gains optional `infoEnabled` / `infoRadiusPx` / `infoPopupWidthPx` / `infoPopupHeightPx`; pure `mapInfoConfig.ts` ships back-compat getters so v1.3-era widgets read correctly with zero data migration.
- **Info-selection store + lifecycle (Phase 20):** `useInfoSelectionStore` Zustand slice (per-layer `rows` / `columns` / `page` / `hasMore` / `loading` / `error` + `activeLayerId`); 7 actions; `setSelection` preserves prior `loading`, `setError` preserves prior rows, layer-switch resets prior `page` to 0. Lifecycle reset extended from two-store → three-store at `App.tsx` UNAUTHORIZED + `DashboardsPage` `DashboardOpen` cleanup. Ships dormant until Phase 21.
- **Map-click popup (Phase 21):** Pure shared `renderInfoTemplate` helper (`{column_name}` regex sub; no sanitization); `infoQuery` client helper; `InfoPopup.tsx` (sticky header, layer dropdown, template/kv body, Load-more, ESC/click-outside/X dismiss); `MapChartRenderer.tsx` Effect 5 (ol/Overlay mount) + Effect 6 (kill-switch-gated singleclick listener, EPSG:3857→4326 transform, sequential top-down fan-out filtering WKB + `info_enabled=0`, AbortController on re-click, "first hit wins").
- **Config UI (Phase 22):** `KineticaWmsLayerForm` "Info Popup" section (toggle + ChipCombobox column multi-picker + Insert-column picker + CodeMirror HTML editor + missing-table predicate); `MapConfigPanel` "Info Popup" section (toggle + `infoRadiusPx` clamp-on-blur + popup width/height px). 22 new specs.
- **Info Card chart type (Phase 23):** 9th chart type `info-card`; `<InfoCardRenderer />` wraps the shared `<InfoSelectionView />` extracted from `InfoPopup.tsx`; `useLastInfoClickContextStore` replays the most-recent click's spatial context so the card can `infoQuery` without a `mapRef`; reset extended three-store → four-store. **Pure-consumer relaxation:** popup + card share the single-layer dropdown-switch + Load-more fetch path; map click remains the SOLE multi-layer fan-out entry; other chart types still cannot fetch info-queries (XWIDGET-V2-01 deferred).
- **E2E verification + 4-gap closure cycle (Phase 24):** Operator UAT across all 3 spatial modes (Session Fix #1 closed the Kinetica-GEOMETRY/WKB-route sub-case), both auth modes, all 7 Phase 23 session fixes, kill switches, dashboard-switch/logout reset, and TD-V12-04 closure. Four gaps surfaced and closed inline: **GAP-24-01-A** (HIGH, listener-unsubscribe before `removeLayer` — 18387fa), **GAP-24-01-B** (MEDIUM, MapConfigPanel popup-dim re-sync — 10721fb), **GAP-24-02-A** (HIGH, `mountedRef` cleanup-gate guarding async OL callbacks — 7b21520), **GAP-24-06-A** (HIGH, StrictMode regression from 24-06: `mountedRef` re-arm at top of Effect 1 — 543f624). All four with code fixes + regression specs + live operator re-walk attestation.

### What Worked

- **Wave-based execution dominated.** 122 commits across 5 calendar days with 7 phases and 23 plans. Most phases ran 2 parallel-plan waves; Phase 18 used 3 waves; Phase 24 used wave-based gap-closure (waves 1+2 with `--gaps-only`). Wave latency was the dominant cost — token-cheap subagents with paths-only context held orchestrator overhead at ~15%.
- **Inline gap-closure within the verification phase (same pattern as v1.3 Phase 17).** Four UAT gaps in Phase 24 were closed without opening a new phase. Three were caught during the initial UAT walkthrough (-01-A, -01-B, -02-A); the fourth (-06-A) was caught during the operator's post-fix live re-walk and hot-fixed inline. Pattern: open-walk → record gaps → plan gap-closure → execute → re-walk. Total wall-clock for the four-gap closure: ~2 hours including the live re-walk.
- **Hot-fix inline for the StrictMode regression (GAP-24-06-A).** Rather than opening Phase 24-07, the one-line `mountedRef.current = true` fix landed as a follow-up commit under 24-06 with a deviation note in 24-06-SUMMARY. The regression spec (`Test M`) was verified RED without fix before the fix landed (TDD inversion: fix-then-revert-to-confirm-RED-then-restore). Single commit, no new plan ceremony. Right call for a one-line dev-only regression with a clear root cause.
- **Spike-first held line.** Phase 18 spike (`npm run wkb-spike`) landed `NONE_ESCALATE → TECH_DEBT` BEFORE any wkb endpoint code. The endpoint shipped with a 501 path and zero speculative implementation. The Kinetica-GEOMETRY sub-case was discovered later via Session Fix #1 (Phase 23 close-out) and closed live in Phase 24 STEP 24-01/2.1.
- **Phase 23 pure-consumer relaxation documented inline.** When Phase 23's design north star ("card is popup mirrored in a widget") required relaxing the pre-Phase-23 lock ("Info Card never calls `POST /api/info/query` directly"), the relaxation was scoped narrowly (only popup + card via shared view; other widgets still locked-out) and documented in PROJECT.md Key Decisions + STATE.md + REQUIREMENTS.md CARD-V14-02 + plan 23-04. No "where is the lock?" debate in subsequent phases.

### What Was Inefficient

- **GAP-24-06-A was preventable.** The 24-06 spec suite (Tests L/L2/L3) all used bare `render(<MapChartRenderer ... />)` without a `<StrictMode>` wrapper. Tests covered the post-unmount async-callback short-circuit invariant but never exercised the StrictMode mount-cleanup-mount cycle on the same hook state. Adding a `<StrictMode>` wrapper to even one of the L-series tests would have caught the ref-preservation bug at the same test session. **Lesson:** Any ref-based flag pattern (`mountedRef`, `materializeAbortRef`, etc.) needs at least one StrictMode-wrapped test that observes both the cleanup-side flip AND the re-arm. The dev-only manifestation is the failure mode that's easiest to ship without noticing.
- **Initial PROJECT.md state-snapshot at Phase 24 close was incomplete.** When Phase 24 closed with `overall_status: tech_debt` (before gap closure), PROJECT.md was updated to reflect "tech-debt-closed" status. Then gap closure ran, then PROJECT.md was updated again to reflect "passed" status. Two PROJECT.md commits when one would have done — the milestone-close evolution should happen after the final verifier pass, not at the optimistic-close moment. **Lesson:** Defer PROJECT.md evolution until `overall_status: passed` (or a confirmed `pragmatic_close` decision); don't update on intermediate states.
- **122 commits / 5 days is heavy.** ~24 commits per day on average. Some were unavoidable (atomic per-task TDD with RED → fix → docs commits across 7 phases). But Phase 22's three plans were each tiny (≤6 minutes per plan) and could plausibly have been a single combined plan, dropping commit count by ~6. **Lesson:** When plan durations cluster at <10 minutes each and all touch the same surface area, ask whether the plan boundary is buying anything (parallelism? clarity? rollback granularity?) or just adding ceremony.

### Patterns Established

- **`mountedRef` cleanup-gate pattern (Phase 24-06).** New canonical pattern alongside v1.3's `materializeAbortRef`: a `useRef<boolean>(true)` flipped to `false` in Effect 1 cleanup and re-armed to `true` at the top of Effect 1 body. Use to guard async callbacks (XHR `onreadystatechange`, OL event listeners, Promise-resolution post-await sites) against post-unmount setState / DOM-touch. **Re-arm is critical** — React 18 StrictMode preserves `useRef.current` across mount-cleanup-mount; without re-arm, the second mount inherits stale `false`. Document this lesson in any reuse.
- **Hot-fix-as-follow-up-commit under existing plan (vs. new gap-closure plan).** For one-line fixes to a regression introduced by the same plan, in the same session, with a clear root cause and a single regression spec: amend `<plan>-SUMMARY.md` with a "Follow-up Fix" section and ship a single commit. Reserves new gap-closure plans for cross-plan or cross-phase regressions, or fixes that require investigation. The branching call is: "Does this need its own context window?" If yes → new plan. If no → follow-up commit.
- **Session-Fix labeling for cross-phase boundary fixes.** Phase 23 close-out labeled 7 in-session fixes as "Session Fix #1" through "Session Fix #7" (bbox projection, viewName routing, Kinetica-GEOMETRY SQL, single-record nav, popup resize, edge-aware positioning, close-X overlap). These were small fixes spanning Phase 23's surface area that didn't merit their own plan-level entries. Phase 24 verification then went step-by-step through each Session Fix and recorded live-attestation status. Reusable pattern for any verification phase that needs to lock in confidence on small fixes accumulated during the prior phase.
- **`overall_status: tech_debt` → `human_needed` → `passed` lifecycle for verification.** Phase 24 transitioned through three statuses in a single day: initial UAT close with 4 gaps (`tech_debt`), post-spec-verification (`human_needed`), post-live-re-walk (`passed`). The `re_verification` block in VERIFICATION.md frontmatter captured both transitions with timestamps. Reusable pattern: don't collapse intermediate states; let the YAML show the audit trail.

### Key Lessons

1. **`useRef`-based flags need StrictMode-wrapped tests, or they will ship dev-broken.** GAP-24-06-A was a one-line oversight (no re-arm) that broke every WMS map in every dev session for 24 minutes between the 24-06 GREEN landing and the operator's live re-walk. Spec-level confidence is not sufficient for refs that live across React lifecycle boundaries. **Rule:** Any new `useRef<boolean>` whose value flips in cleanup MUST have at least one StrictMode-wrapped regression spec.
2. **Live operator re-walk is mandatory for criterion-3-shaped success criteria.** "Dashboard-switch and logout clear the info selection" was spec-verified via Tests L/L2/L3 + Phase 23 four-store reset code review. Spec-level evidence proved the crash was gone; it did NOT prove the four-store reset fires correctly. Only the live re-walk closed criterion 3. **Rule:** Criteria worded as "operator attests X" need operator-time evidence; no amount of unit testing substitutes.
3. **Phase planning should set the boundary at the smallest surface area worth a separate context window.** Phase 22's three plans were each ≤6 minutes and all touched config UI. Combining them into one plan would have saved ~6 commits and one wave of orchestration. Phase 18's three plans were each 5-25 minutes and each owned a distinct surface (spike, server modules, endpoint) — three plans was right. **Rule:** Ask "does this plan need its own context window?" If the answer is "the prior plan's context covers this fully," it's a candidate for plan-merge.
4. **Two-pass milestone evolution wastes a commit.** Phase 24 closed once with `overall_status: tech_debt` (PROJECT.md updated), then closed again with `passed` after gap closure (PROJECT.md updated again). The first evolution was discarded. **Rule:** Defer PROJECT.md/MILESTONES.md evolution until final status is locked. Use STATE.md for intermediate position; PROJECT.md is for shipped state.
5. **Session-Fix labeling beats opening a new plan for small in-session fixes.** Phase 23 accumulated 7 in-session fixes that didn't need their own plan ceremony. Phase 24 then went step-by-step through each and recorded live-attestation status. Total Phase 24 verification overhead for the 7 Session Fixes: ~30 minutes. Total had each been a separate plan: probably 7 × 15-min planning + 7 × execution = 2+ hours. **Rule:** Reserve plans for surface area worth a separate context window; use Session-Fix labels for small in-session fixes.

### Cost Observations

- **Model mix:** Sonnet 4.6 for execution (gsd-executor, gsd-verifier); Opus 4.7 (1M context) for orchestration. Phase 24 verifier ran twice (initial `human_needed` + final `passed`).
- **Sessions:** Spread across 5 calendar days (2026-05-07 → 2026-05-11). Heavy wave-parallel execution kept individual phases short (most phases <60 minutes wall time).
- **Notable:** Phase 22 was the cheapest at ~12 minutes total across three plans (3 + 3 + 6 min). Phase 24 was the longest at ~3 hours including UAT + 4-gap-closure cycle + live operator re-walk. The hot-fix path (GAP-24-06-A inline) saved ~15 minutes versus a full 24-07 plan-and-execute cycle.

---

## Milestone: v1.5 — Spatial filtering on map

**Shipped:** 2026-05-14
**Phases:** 7 (25–31) | **Plans:** 16 | **Commits:** 104

### What Was Built
Users draw bbox / lasso / circle shapes on map widgets to filter the dashboard to that spatial region. Server-side WHERE composition layers spatial OR-blocks with v1.3 column AND-chains; the materialize pipeline carries the combined WHERE; FilterBar shows spatial chips alongside column chips; per-map config picks the spatial target(s) for shape application. WKB-binary mode is deferred (TD-V14-WKB-SPIKE); UI gates client-side, server returns 501 as defense-in-depth.

### What Worked
- **Phase 25 spike-first pattern**: before writing any SQL builder code, an operator-run spike validated `STXY_WITHIN` (latlon) and `ST_INTERSECTS` (WKT) against the live Kinetica instance. Decision record locked predicate names. Zero rework on the server SQL.
- **3-gate eligibility pattern (config / materialize / server) with a single source of truth (`isSpatialTargetEligible`)** — pre-Phase-26 lock made WKB deferral cheap to enforce everywhere.
- **Dormant-ship for Phase 27 store + Phase 28 target config** — both shipped before any consumer existed. Made later phase merges trivially safe.
- **Goal-backward verifier for each phase** — caught Phase 30's bar-chart-vs-records-table sole-trigger gap during integration with the user's real dashboard (no aggregated widget on the spatial-target table).

### What Was Inefficient
- **Live UAT skipped this cycle**: source-only attestation closed Phase 31. Cheaper now, but defers risk of a production-only bug to v1.6's interactive testing.
- **Heavy follow-up polish cycle (Day 4)** after core code landed Day 3. Several rounds of `<sysreminder>`-driven small tweaks (toolbar sizing, sidebar collapsibility, color alpha, FA icon sweep, bignumber, info-popup default radius). Possible mitigation in v1.6: surface "UX polish punch-list" earlier in the cycle so it can be batched.
- **Two false-restart moments on "Data Source dropdown removal"** — operator changed mind, full revert + re-apply. Cleaner to gate ambiguous-scope changes with a quick AskUserQuestion before edits.
- **Vitest worker pool thrash** during a long debugging session — accidentally orphaned multiple `tsx watch` instances + vitest fork workers that consumed cache state and caused spurious `document is not defined` failures across the entire frontend suite. `rm -rf node_modules/.vitest` + `pkill vitest` restored. Operator-facing: be aware that long-running watchers + repeated single-file vitest runs can drift.

### Patterns Established
- **Operator-driven mid-cycle gap-closure without formal Phase 31.x** — 5 fixes landed inline during the polish cycle (WKT picker, autoSuggest, records-table trigger, drawend singleclick, Kinetica race retry). Mirrors v1.3's 17-02 / 17-03 / 17-04 inline closures but without the formal sub-phase numbering. Faster; tradeoff is less audit trail.
- **Retry on specific Kinetica error codes** (TM/SMc:1078 → DROP+CREATE fallback). Pattern is reusable for future Kinetica-server-quirk workarounds.
- **AARRGGBB color storage with legacy 6-char normalization on emit** — backward-compatible color-with-alpha contract. Reusable for any other color params we add.
- **Lock-relaxation pattern**: v1.3's "sole materialize trigger lives on AggregatedWidget" was relaxed in Phase 30 follow-up so RecordsTable also fires. Documented the relaxation in PROJECT.md / MILESTONES.md so it's not seen as undocumented drift.

### Key Lessons
- Spike runners pay for themselves. Phase 25's `spatialPredicateSpike.ts` saved one round trip of "actually that predicate doesn't work, let me check the spike notes." Continue this pattern for any Kinetica-feature integration in v1.6.
- Source-only verification is a defensible close when (a) the automated suites are comprehensive and (b) operator has been exercising the build interactively. It's not a defensible close on a feature the operator has never touched.
- The "sole-X invariant" patterns from v1.3 (sole materialize trigger, sole DDL caller) are convenient but fragile. v1.5 needed to relax one of them. Future locks should declare extension points explicitly so relaxation is cheaper.
- Per-color alpha (AARRGGBB) is preferable to a separate POINTOPACITY when Kinetica supports it natively — one knob, one render.

### Cost Observations
- Model mix: heavy Opus for planning + verification, Sonnet for execution.
- Sessions: ~3 (Day 1 plan + Days 2–3 execution + Day 4 polish).
- Notable: Phase 30's plan checker caught 4 blockers + 2 warnings on first pass. The revision loop ran exactly once. Plan-time investment paid off.

---

## Milestone: v1.8 — Roles & Permissions (RBAC)

**Shipped:** 2026-06-06
**Phases:** 9 (46-51 incl. 3 inserted) | **Plans:** 22 | **Commits:** 63 | **Timeline:** 2 days

### What Was Built
App-level RBAC: 16-permission catalog, built-in + custom roles with union semantics, server-authoritative route guards with an explicitly protected analyst-passthrough boundary, role-aware self-healing UI, Users/Roles management pages with last-admin + escalation safeguards, dual-sink audit, profile + logout.

### What Worked
- **Goal-backward verification caught real issues every phase**: the checker loop fixed an inverted-grep acceptance criterion (46), replaced a nondeterministic pass-count test gate with a set-based failing-file gate (47), and forced an automated test for the OIDC boot warning (46).
- **Set-based regression gate** (failing files ⊆ known-flaky list) made progress measurable despite TD-V16's nondeterministic suite (620-677 passing run-to-run).
- **Same-phase test migration** (createAdminSession with guards in 47; seedAuthStore with gating in 48) prevented the suite-collapse failure mode research predicted.
- **Operator pre-UAT walking** found 5 fix rounds (logout missing, table layout, UTC times, light-mode theming, login-shape) BEFORE the formal gate — inserted decimal phases (50.1-50.3) absorbed them cleanly without derailing the roadmap.
- **First full formal close**: live 5-persona UAT + zero gaps + TRUE 100% green frontend — breaking the v1.2-v1.7 pragmatic-close streak.

### What Was Inefficient
- **vitest doesn't type-check** (esbuild transform): executors' green test gates masked tsc breakage twice (Phase 50 req.user casts; v1.7-era spec-type errors). Build/tsc gates must run alongside test gates — now standard.
- **Light-mode was never exercised during development** — 3 of the 5 operator fix rounds were theming. The UAT checklist now has a standing light-mode pass (§2.4); a CSS-variable lint would catch non-existent token refs mechanically (v1.9 candidate).
- **Phase 48 widened /me but not the login response** — the two auth entry points drifted. Lesson: when widening a response shape, grep for every endpoint returning the same entity.

### Patterns Established
- Decimal-phase insertions for operator-reported pre-gate fixes (50.1/50.2/50.3) with root-cause-in-CONTEXT before planning
- Self-contained vi.hoisted mocks for new specs so they stay out of the contaminated shared-mock pool
- rbac_seed_history once-only seeding (operator edits survive; catalog additions land exactly once)
- Client/server permission-string byte-parity mirror with an independently-hardcoded spec

### Key Lessons
- Server is the sole authority; UI mirrors are UX only (no client-side last-admin counting) — eliminated drift bugs by construction.
- "Analyst-passthrough" classification was the highest-risk decision of the milestone; positive reachability assertions (not absence-of-guards) made it durable.

### Cost Observations
- Model mix: opus planners, sonnet researchers/checkers/executors/verifiers
- Heavy phases: 47 (route inventory + 21-spec migration), 48 (gating + spec migration)
- Notable: orchestrator-level fixes (plan frontmatter patches, test-gate redesign, tsc catches) avoided several full revision-agent round-trips

## Milestone: v1.9 — Better Track Rendering

**Shipped:** 2026-06-08
**Phases:** 3 (52-54) | **Plans:** 12 + 7 gap-closure | **Commits:** 35 | **Timeline:** 3 days

### What Was Built
Track rendering as a first-class, discoverable workflow: a selectable spatial mode (auto-suggested on track column shape) driving typed x/y/trackID/ordering pickers, render-mode narrowing to Raster + Class Break, a full 8-param TRACK_* style surface with alpha color pickers + per-break categorical CB coloring, and end-to-end live verification. v1.7's auto-detect sub-section + override checkbox deleted.

### What Worked
- **Repro-test-driven gap closure** — every one of the 9 UAT-found gaps got a failing RED reproduction test before the fix, so each closure was provably the right fix, not a plausible guess. Frontend stayed 100% green throughout.
- **Reading the actual server code on demand** — when filtering "didn't work," reading `spatialWhereClause.ts` in full established the server was correct and redirected the hunt to the real (frontend) cause, avoiding a wasteful server rewrite. **Zero server diffs across the entire milestone.**
- **3-mode wire contract held under a widened form union** — widening the form `SpatialMode` to include `"track"` while keeping SpatialTarget + server at 3 modes (track→latlon at every boundary) meant no server migration for a frontend-discoverability feature.
- **Un-deferring on operator feedback** — per-break categorical CB track coloring was scoped to v2.0, but the operator's live walk-through showed it was load-bearing for the feature to feel done; re-opened into 54-07 and shipped.

### What Was Inefficient
- **The `track_config` top-level footgun cost 4 of 9 gaps** — consumers kept reading `config.track_config` (silently `undefined`) instead of `layer.track_config`. The same bug recurred at isConfigComplete, buildSpatialColumns (×3 call sites), and the spatial-target path. A single early "grep `config.track_config` as a smell" pass would have caught the whole class. Now captured in memory.
- **Parallel executors clobbered ROADMAP.md twice** — two Phase 53 waves raced on the shared (gitignored, so unrecoverable) planning file, truncating it; reconstructed manually both times. Lesson: assign shared-doc updates to exactly ONE plan per wave, or run small waves serially. Captured in memory.
- **Live UAT surfaced a long tail of defects a synthetic gate missed** — track rendering touches WMS param emission, OL source creation, info-query, and spatial-filter triggering; only a real operator clicking through the deployed instance exercised all four. The automated gates were green while the feature was visibly broken.

### Patterns Established
- Thread `track_config`/`cb_config` as explicit params from `layer.<field>` (mirror `buildWmsParams`' `layerJsonFields`) — never read off `layer.config`.
- Dashboard-scope materialize orchestrator hook for map-only dashboards (`useMapOnlySpatialMaterialize`) that respects the sole-trigger invariant via skip-logic + the existing in-flight Promise cache — mirrors the Phase 35 dynamic-view chain precedent.
- One plan owns ROADMAP/STATE updates per parallel wave; spot-check `wc -l ROADMAP.md` after each wave.

### Key Lessons
- When a feature "doesn't work end-to-end," verify the data shape at the boundary FIRST (is the field even populated?) before suspecting logic — the silent-undefined class hides as logic bugs.
- A passing automated suite is necessary, not sufficient, for a cross-cutting rendering feature; budget for a live walk-through and treat its gaps as part of the milestone, not afterthoughts.

### Cost Observations
- Model mix: opus orchestration + gap diagnosis, sonnet executors/verifier
- Heavy work: the 7 sequential gap-closure plans (54-04..54-10) during live UAT, each a small repro→fix→re-walk loop
- Notable: reading server source to *rule out* a cause saved a likely-multi-hour server rewrite; the expensive part was the human-in-the-loop walk-through latency, not tokens

## Milestone: v1.10 — Per-Dashboard View Permissions

**Shipped:** 2026-06-10
**Phases:** 3 (55-57) | **Plans:** 7 + live UAT checkpoint | **Timeline:** 2 days

### What Was Built
Per-dashboard view access on top of the global `dashboards:view`: grant a dashboard to specific users and/or roles (union semantics), admin/designer bypass via the new `dashboards:manage_access` permission, private-by-default, server-authoritative list filter + 404 open-gating, a `DashboardAccessModal` reached from a gated list-row button, and a no-access panel. Revised the v1.8 shared-workspace decision.

### What Worked
- **Clean phase seam (server → UI → verify)** — Phase 55 shipped a tested server contract (`canViewDashboard`, grant API) with ZERO web changes; Phase 56 consumed it with ZERO server changes. Each phase verified independently (7/7, 6/6) and the verifier re-ran gates rather than trusting SUMMARYs.
- **Locking enforcement semantics in discuss-phase paid off** — the 4 Phase-55 decisions (404-not-403, gate-scoped-routes-only, bypass-via-permission, pre-provisioning) meant the planner and executor never had to guess; the plan-checker confirmed each in code.
- **Bypass-via-permission (not role names)** — keying bypass on holding `manage_access` is the "if you can administer it you can see it" pattern; it auto-handles custom roles and avoids hardcoded role checks. Clean and future-proof.
- **Reusing the existing 404 guard for denial** — collapsing access-denial into the existing `if (!getDashboard(id)) return 404` path hid existence with one code path and zero new error surface.
- **Live UAT caught a non-bug fast** — the "revoke didn't work" report turned out to be a visual mis-read (lingering username) + a re-scoped §1.3 (no URL routing), not a defect. Pinning the symptom with targeted questions BEFORE spinning a 57.x gap plan avoided wasted work.

### What Was Inefficient
- **§1.3 was scripted against a feature that doesn't exist** — the UAT doc assumed dashboard URL deep-linking; the app has none. The CONTEXT noted "no URL routing" but the success-criterion wording (inherited from the roadmap) still said "direct navigation," so the operator hit an untestable step. Lesson: when a roadmap SC references a capability, confirm it exists during discuss-phase and re-scope the SC then, not at UAT time.
- **The dashboard list never refetches in-session** (useApiQuery `[]` deps) — surfaced as a candidate cause during the revoke investigation. It wasn't the actual bug, but it's a latent UX gap (a revoked dashboard lingers in the list until a hard reload). Logged, not fixed (revoke enforcement still holds on open).

### Patterns Established
- App-level resource ACL layered on the v1.8 RBAC: a grant table + a `canView*` resolver mirroring `getEffectivePermissions`/`getEffectiveRoles`, bypass via a dedicated permission, private-by-default falling out of "no grants ⇒ only bypass."
- Verification phase as its own phase (55→56→57) with the live walk-through as a blocking human checkpoint — same shape as v1.9 Phase 54; now a repeatable milestone-close template.

### Key Lessons
- Confirm a referenced capability EXISTS before writing a UAT step against it (the URL-routing miss).
- For "X didn't work" live reports, pin the exact failure mode before assuming a code bug — the code + tests were correct; the report was an observation error.

### Cost Observations
- Model mix: opus orchestration + planning, sonnet executors/checkers/verifier.
- Notable: the divergent-remote merge (an independent docker/k3s deploy track + tags pushed mid-milestone) was handled at completion time — caught by a rejected push, integrated via a clean merge (one auto-resolved `client.ts` overlap), re-gated, then pushed. Surfacing the divergence to the operator before altering history avoided a force-push mistake.

## Milestone: v1.11 — Programmable Widgets (Cross-Widget Control)

**Shipped:** 2026-06-15 | **Phases:** 7 (58, 58.1, 59, 60, 60.1, 60.2, 61) | frontend-only

### What Was Built
Generic serializable widget-action engine ({target, configPatch} + zod + versioned allow-list, 3 target kinds, decoupled from filter/materialize) → Radio Dashboard Control widget (transient session-only overlay, reload-resets-to-default) → full-form side-by-side layer editor (reuse `KineticaWmsLayerForm`) → multi-target options (option-level switch-replace) → MCP seam doc → live UAT.

### What Worked
- **Day-0 canary for the #1 risk.** The read-once-at-mount trap (prior GAP-24-01-A lineage) was closed by a mounted-renderer re-render canary built in Phase 58 — the engine was proven live-reactive before any UI existed.
- **Gap-found → fix-inline → regression-lock.** Both live-UAT gaps (GAP-61-01 legend, GAP-61-02 eye-toggle) and ~8 post-pause UI bugs were fixed inline with a repro/regression test each, not deferred to tech debt. The milestone gate held.
- **Asking before reversing locked decisions.** When the operator wanted the full-form editor (vs the narrow first cut) and multi-target, those were surfaced as scoped decisions (AskUserQuestion) before building — avoided guessing on contract-level changes (allow-list relaxation, full-config snapshot).

### What Was Inefficient
- **Built the wrong thing once (60.1 narrow editor).** The first layer-editor cut shipped + verified, then the operator clarified they wanted the full form — a full re-plan + re-execute. A mockup/clarify pass before 60.1 would have saved a cycle.
- **Stale gates / scope creep across a long tail.** The 61 walk paused, then 48 commits (60.1/60.2 + polish + theming) landed before it resumed — required refreshing the gate record and re-walking §1/§2. Pulling RADIOUX/RADIOMULTI into the milestone mid-flight grew the verification surface.
- **One subagent died on an API socket error mid-plan (60.2-02)** — recovered by assessing the partial commit + spawning a continuation; cost a detour.

### Patterns Established
- **Static guard tests as drift prevention** — the theme hex-guard (`theme-guard.spec.ts`) follows the existing `actionEngineDecoupling` source-grep precedent: turn an "operator catches it in screenshots" class of bug into a CI failure.
- **Control-keyed overlay store** — `setControlContribution(controlId, …)` + `deriveOverlays()` made multi-target (60.2) a near-free extension; wholesale per-control replace gives option-level switch-replace for free (vs a per-target merge that strands stale targets).
- **`.planning` tracking reality** — REQUIREMENTS.md + STATE.md are tracked on the shared origin; ROADMAP/PROJECT/MILESTONES/archives are gitignored/local. At milestone close, did NOT delete the tracked REQUIREMENTS.md (its archive is local-only → deleting would lose it for teammates); left it for `/gsd:new-milestone` to refresh.

### Key Lessons
- For UI-heavy reuse, clarify "narrow subset vs full component" with a mockup BEFORE planning — it's a contract-level choice.
- A verification gate that pauses is a liability: changes pile up and invalidate prior attestations. Either finish the walk promptly or expect a refresh + re-walk.
- Native form controls (radios) need explicit global theming — browser defaults (blue) bypass token-based theming silently.

### Cost Observations
- Model mix: opus (orchestration/planning/this long interactive session) + sonnet (executors/checkers/verifier).
- Notable: a single long interactive session carried the milestone — many small operator-reported UI bugs fixed conversationally with full-suite gating per fix, plus the formal GSD phase machinery (plan→check→execute→verify) for 60.1/60.2.

## Milestone: v1.12 — Drill-Down on Dynamic-View-Backed Widgets

**Shipped:** 2026-06-16
**Phases:** 4 (62, 63, 63.1, 64) | **Plans:** 10

### What Was Built
A bug-fix-as-feature: drilling a dv-backed chart/table/map now filters the dynamic view's own data (not the source table), dv-isolated. Server extended `POST/DELETE /api/filter/materialize` to build `FROM <dv_view> WHERE <filter>` (no new route). Client added dv-scoped filter slices (un-collidable with table ids), dv-aware drill dispatch, a filtered-dv read-path FROM-swap in chart + records renderers, kind-scoped API cache keys, removable dv-name chips, and lifecycle reset. A gap-closure phase (63.1) extended the FROM-swap to the WMS map render path.

### What Worked
- **Root-cause-first scoping.** The bug was diagnosed precisely (source-table keying + dv read-path gate) before any milestone work, so the phase split (server / client / verify) was clean and each phase had a sharp boundary.
- **Wave sequencing to protect shared docs.** Ran "parallel" waves sequentially when plans shared the tracked `.planning` STATE/ROADMAP — avoided the known parallel-executor clobber.
- **The verification phase earned its keep.** Phase 64's live UAT caught a real gap (map layer) that all the automated gates (2133/2133 green at the time) missed — exactly the class of defect human walk-throughs exist for.

### What Was Inefficient
- **Read-path coverage was incomplete on the first pass.** Phase 63 wired the filtered-dv FROM-swap into the chart/records `WidgetRenderer` but missed the `MapChartRenderer` WMS path — a separate consumer. Cost a gap-closure phase (63.1). Recorded as a memory: when adding a filter/dv read-path, enumerate ALL consumer render paths up front.

### Patterns Established
- **dv-scoped parallel store slices** (`dvFilters`/`dvViews` keyed by dynamicViewId) sit alongside the tableId-keyed maps rather than re-keying — lower risk, keeps the table path byte-unchanged. Kind-scoped API cache keys (`:dv<id>` vs `:t<id>`) prevent same-numeric-id collapse.
- **Map WMS is a distinct read-path.** Filter/dv FROM-swaps must wire MapChartRenderer (two `buildWmsParams` call sites + a dedicated subscription key) in addition to WidgetRenderer; the map is a pure consumer (reads the materialized view, never triggers materialize).

### Key Lessons
- A green test suite is necessary but not sufficient — a UAT walk that reproduces the *original* user-reported scenario across *every* widget type (incl. maps) is what actually closes a bug-fix milestone.
- When a read-path feature lands, grep for every place that resolves the view name, not just the one in the reported repro.

### Cost Observations
- Model mix: opus (orchestration/planning), sonnet (executors/checkers/verifiers).
- Notable: tight plan→check→execute→verify cycles per phase; the gap-closure phase (63.1) ran the full cycle in one pass and landed in ~5 min of executor time. One long interactive session carried the whole milestone including the live UAT loop.

## Milestone: v1.13 — Calendar Heatmap Visualization

**Shipped:** 2026-06-18
**Phases:** 7 (65, 66, 67, 68, 68.1, 68.2, 69) | **Plans:** 22

### What Was Built
A new `calendar` chart type: a Superset-style Calendar Heatmap rendering a metric aggregated over a timestamp column as color-scaled grids across 8 domain×subdomain combinations (GitHub-style wrapped blocks + continuous strip), with per-group date-range gap-fill, anchor-agnostic week handling, click-to-drill that applies a BETWEEN filter propagating dashboard-wide (incl. WMS map tiles) with a human-readable chip, and dv-isolated drilling for dv-backed calendars. Pure SQL builder + cell-bounds foundation (Phase 65) before the renderer; FRONTEND-ONLY with zero server diff (rode the existing `/api/sql` + `/api/filter/materialize`).

### What Worked
- **SQL-builder-before-renderer.** Phase 65 shipped a pure, fully-tested `buildCalendarSql` + `computeCellBounds` (half-open buckets, FROM resolved before string) ahead of any UI — the renderer built on a correct, unit-tested bucketing foundation instead of debugging SQL through the DOM.
- **Near-clone of TimelineRenderer.** Modeling CalendarRenderer on the existing timeline read-path (filter-aware re-fetch, appliedBand→appliedCell, no fromSwap) kept the new widget consistent and let the locked invariants (sole-materialize-trigger, theme-tokens-only) ride existing CI gates (theme-guard + static-grep) rather than new bespoke checks.
- **The verification phase earned its keep again.** Live UAT surfaced both rendering-correctness gaps (phantom week columns, all-grey, week×hour shape — fixed in 68.2) and dv/filter UX gaps (over-threshold infinite-loading, flicker, OFF-refetch — fixed in 69), none of which a green 2373-test suite caught.

### What Was Inefficient
- **High live-review bug density on the matrix.** The 8-combo matrix surfaced a cluster of layout/gap-fill defects (checkbox layout → week×day phantom columns → all-grey → anchor → punchcard) that arrived as a rapid chat-fix sequence (344c274/4f4ef7c/90c8f3b/0a9d9f8) and forced two inserted phases (68.1, 68.2). A wider up-front matrix of unit fixtures (every domain×subdomain × leap/short-month/anchor edge) would have caught most before the live walk.
- **dv-not-materialized parity was missed until UAT.** CalendarRenderer had no render-body `dvStatus` gate, so an un-generated dv MV spun forever — a parity case WidgetRenderer already handled. Enumerate the reference renderer's *render-body* status gates, not just its fetch effect, when cloning.

### Patterns Established
- **Repro-test-driven in-session gap-closure on a milestone gate.** The 3 Phase-69 gaps were fixed under the same UAT (RED repro spec → fix → re-walk PASS, commit `d60f3b1`) rather than spun into a separate decimal phase — appropriate when the gaps form one coherent file-local cluster. Recorded against the verification record's chat-fix table (verify-in-place, no backfilled plan docs).
- **Neutralize-deps-when-off.** A respond-to-filters=OFF widget collapses its filter-aware effect deps to constants so filter-store churn cannot re-fetch — a reusable shape for "this widget ignores dashboard filters."
- **Empirical-inference disposition closes an unverifiable spike.** CALUX-V113-03's live week-anchor clause closed via `inferWeekAnchorDow` (anchor inferred from data → anchor-agnostic), making the auth-gated NOT-RUN `DATE_TRUNC('week')` spike non-blocking.

### Key Lessons
- When cloning a renderer, diff BOTH the fetch effect AND the render-body status gates of the reference — the missing dv-status gate (GAP-69-01) was a render-body omission, invisible in the fetch logic.
- "Update in place, don't blank" — gate the full Loading placeholder on initial-load-only (`loading && data.length === 0`); blanking on every re-fetch reads as flicker.
- A matrix feature wants a matrix of fixtures before the live walk; the live walk should confirm, not discover, combo-shape correctness.

### Cost Observations
- Model mix: opus (orchestration/planning + this verification/close-out session), sonnet (executors/checkers/verifiers).
- Notable: the live-UAT loop carried a dense fix cycle — two inserted phases (68.1/68.2) for rendering correctness, then three in-session repro-test-driven dv/filter fixes during the Phase 69 walk itself, all landing before the verification record compiled `passed`.

## Milestone: v1.14 — Class-Break & Chart Config Refinements

**Shipped:** 2026-06-19
**Phases:** 4 (70, 71, 72, 73) | **Plans:** 6

### What Was Built
Three targeted FRONTEND-ONLY refinements: a numeric `<other>` catch-all bucket for class-break `CB_VALS` (default-on for new/edited only, preservation-locked); SHAPE* fields hidden for lat/lon point layers in both UI spots + suppressed in WMS emission (leak-prevention); and an optional group-by dimension on the Timeline + Numeric-Line charts (single-metric N-series, top-12 cap, palette-cycled colors, ungrouped byte-identical). Plus five review-gap fixes / one feature surfaced during the live walk-through (numeric `<other>` legend label, grouped Color-palette picker, standalone-Legend↔in-map-legend overlay sync, calendar week-anchor drill correctness, Radio "Toggle buttons" style). Zero server diff across all 19 commits.

### What Worked
- **CONTEXT-first, opus-planned, sonnet-executed per phase.** The orchestrator scouted each feature against the live code (exact file:line pointers in CONTEXT.md) before planning, so the planner produced tightly-scoped plans and the executors landed them in 1 attempt each. The independent, well-understood scope (every feature mirrored an existing pattern — categorical `<other>`, track-mode SHAPE* suppression, bar/line group-by) made research unnecessary and kept the cycle fast.
- **The plan-checker caught the recurring stale-test class twice (70, 71) before execution.** Pre-existing specs that asserted the OLD behavior under default configs (numeric-toggle-absent, SHAPE*-always-emitted) would have failed the suite gate; the checker flagged them as blockers and the planner added explicit migration steps. By Phase 72 the planner pre-empted them unprompted.
- **The live walk-through paid off — again.** Five real gaps the 2451-test suite never caught surfaced in operator review (legend "0 – 0", grouped single-color confusion, legend↔map drift, the 66k-vs-7 calendar count mismatch), each fixed in-session repro-test-driven and re-walked PASS.

### What Was Inefficient
- **Two cross-component bugs were latent from earlier milestones, found only by eye.** The standalone-Legend overlay desync (GAP-61-01 fix applied to the map but never the standalone legend) and the calendar week-anchor drill (hardcoded Monday vs Kinetica's actual `DATE_TRUNC('week')`) both predated v1.14. A "two read-paths of the same data must share a helper" audit (now enforced via shared `lib/applyLayerOverrides.ts`) would have caught the legend one at v1.11.
- **The calendar week-anchor risk was explicitly deferred (CALUX-V2-03) rather than closed** — it then resurfaced as a user-visible count mismatch. The Phase 68.2 `inferWeekAnchorDow` fix made *rendering* anchor-agnostic but the *drill* (`computeCellBounds`) still hardcoded Monday; the two halves of one concern were fixed in different sessions.

### Patterns Established
- **Shared-helper-for-twin-read-paths.** When two surfaces render the same derived data (in-map legend vs standalone Legend; map WMS vs legend), route both through ONE helper (`applyLayerOverrides`, `resolveLegendLayers`) so a fix to one can't skip the other — the GAP-61-01 divergence lesson, now structural.
- **Trust the server's bucket key, don't re-derive it.** `computeCellBounds('week')` now treats Kinetica's `DATE_TRUNC('week')` output as the authoritative bucket start (`[start, start+7d)`) instead of re-anchoring to an assumed weekday — anchor-agnostic by construction.
- **Opt-in config defaults preserve existing widgets.** Every new option this milestone (`<other>` default-on for new/edited-only, SHAPE* hide gated on latlon, group-by clearable, radio `displayStyle` default "radio") defaults to the pre-existing behavior, so no deployed dashboard silently changes.

### Key Lessons
- A "fix applied to read-path A" should always ask "is there a read-path B of the same data?" — both legend desync and the calendar anchor were single-side fixes that left their twin stale.
- Deferring a correctness risk (week anchor) to a v2 backlog item doesn't make it stop being a bug; the rendering-side fix gave false confidence while the drill-side stayed wrong.
- The session's whole back-half was operator-review-driven inline fixes (5 fixes + 1 feature after the 3 planned features) — the live walk remains the highest-yield bug filter, and repro-test-driven in-session fixes kept each one regression-locked.

### Cost Observations
- Model mix: opus (orchestration/planning + all in-session review fixes + this close-out), sonnet (phase executors/checkers/verifiers).
- Notable: phases 70-72 ran fully autonomously (user pre-authorized 70-72 without input) — plan→check→revise→execute→verify per phase, with the checker's stale-test catches handled by targeted revisions, not replans. The review-and-fix back-half (legend label, palette, legend-sync, calendar-anchor, radio-buttons) was a tight conversational loop with the operator.

## Milestone: v1.15 — Column Formatting & View Lifecycle

**Shipped:** 2026-06-22
**Phases:** 6 (74–79) | **Plans:** 11 | **Commits:** 31

### What Was Built
Client-side per-table column display config (custom labels + value formatting) applied across records-table, chart tooltips/axes/series, and map info popups (layers legend excluded); env-configurable materialized-view TTL defaults; and a dashboard-level keep-alive touch that holds idle views alive. Server: `column_display_config` table + per-column CRUD; env-driven TTL consts replacing the hardcoded `TTL=5`. Web: pure `columnFormatter` lib (+`d3-format`), `columnDisplayConfigStore`, `ColumnFormatEditorModal`, shared `ColumnFormatTooltip`, `useViewKeepAlive`.

### What Worked
- **Mid-discussion scope pivot saved the most work.** Phase 74 was planned as a runtime app-settings store/UI/permission; the operator chose deploy-time env vars instead during discuss-phase. Folding that in early (vs building then ripping out) collapsed the phase ~80% and avoided the exact RBAC/seed/byte-parity infra the milestone didn't need.
- **Foundation-first sequencing.** Phase 75 (pure formatter lib + store + server config) let the editor (76) and apply-at-surfaces (77) build on a tested base; the shared `ColumnFormatTooltip` meant the tooltip fix reached every chart type at once.
- **Phases 75–78 ran autonomously** (operator pre-authorized) — discuss→research(where useful)→plan→check→execute→verify per phase.

### What Was Inefficient
- **Green gates ≠ correct UI.** Six operator-found UAT gaps shipped past plan-check + vitest + verifier: missing CSS (modal rendered as a flat list), a baseline-seeding bug (default-None could never be Saved), two DataFilter issues (load-race + popover clipping), and three label/format consistency gaps. All were invisible to jsdom (no layout) and to theme-guard (scans only `src/components/`, not `src/styles/`).
- **Verification criteria drifted from the pivot.** Phase 79's SC-3 + VERIFY-V115-01 still described the dropped app-settings permission flow until corrected at completion time — milestone-overview text needs the same pivot edit the phase entry got.

### Patterns Established
- **Render-surface fixes need a visual check, not just green tests** — grep that every `className` token resolves to a defined rule, or run/screenshot the app. (Saved as a memory.)
- **Operator-found UAT gaps fixed as follow-up commits under the verification phase** (Criterion 5), each with a repro/regression test — extends the v1.4 "hot-fix-as-follow-up" lesson to a full milestone's worth of UI polish.
- **Portal popovers out of widgets** — react-grid-layout's `transform` + `overflow:hidden` clips even `position:fixed`; the only reliable escape is `createPortal` to `document.body`.

### Key Lessons
1. **Catch scope pivots in discussion, not implementation** — the env-var pivot was the single highest-leverage decision of the milestone.
2. **A pure-lib + store foundation makes downstream phases cheap and consistent** — one shared tooltip/formatter, wired in many places.
3. **theme-guard's `src/components/`-only scan is a real blind spot** — shared styles in `src/styles/global.css` and missing-class references are unguarded; visual verification covers what static gates can't.
4. **When a phase's premise changes, sweep ALL its downstream verification text** (phase entry + milestone overview + requirement wording), not just the obvious spot.

### Cost Observations
- Model mix: opus (orchestration/planning + all in-session UAT fixes + this close-out), sonnet (phase researchers/planners/checkers/executors/verifiers).
- Notable: phases 75–78 ran autonomously; the verification half (79) was a tight operator UAT loop — most of the milestone's *correctness* value came from that loop, not the autonomous build.

## Milestone: v1.16 — White-Label Theming

**Shipped:** 2026-06-26
**Phases:** 5 (Phase 80 → Phase 84) | **Plans:** 13 | **Commits:** 70

### What Was Built

- **Token foundation + Aurora (Phase 80):** full structural token vocabulary (color/type/space/radius/elevation/motion) for dark + light, all existing styles migrated off literals, two-tier accent rule, the distinctive Aurora default theme, chart palette via `getComputedStyle`, theme-guard extended to structural literals.
- **Brand server (Phase 81):** `brand_config` singleton table, 18th permission `branding:manage` (reads unauthenticated), multer logo upload (MIME/magic-byte/SVG-sanitize), PostCSS AST custom-CSS sanitizer run before storage.
- **Client pipeline (Phase 82):** zustand brand store, inline `<head>` FOUC guard from a localStorage cache, BroadcastChannel cross-tab propagation, logo/name/favicon wiring.
- **Admin UI (Phase 83):** single settings page — color pickers + live WCAG badges, curated fonts, five feel levers, live preview, Save/Reset, custom-CSS editor, optional dark-logo + favicon.
- **Verification (Phase 84):** green gates both stacks + a blocking 14-scenario operator walk-through, 14/14 PASS.

### What Worked

- **A dedicated verification phase caught real, ship-blocking bugs that all green gates missed.** Two of them (Test 10 whole-stylesheet wipe, Test 14 reachable branding page) passed tsc + vitest + theme-guard yet were user-visible failures. The live walk-through is where they surfaced.
- **Reusing established precedents kept the server work cheap.** `brand_config` mirrored v1.15's `column_display_config`; the 18th permission mirrored `dashboards:manage_access`; logo serving mirrored existing asset routes.

### What Was Inefficient

- **Invented CSS class names shipped silently broken.** Phase-83 components used `ds-btn*` classes that resolve to no CSS — they pass tsc, vitest, and theme-guard (none validate that a className maps to defined CSS) and render as browser-default chrome. Cost a full round of in-session button-restyling during UAT. Now documented in `CLAUDE.md`.
- **Several UAT gaps were CSS/UX-only and only catchable visually** (records-table font size, multi-select padding, calendar legend, info-popup opacity). The automated gates are blind to all of them.

### Patterns Established

- **CSS bugs evade every automated gate — verify new UI visually, not just on green tests.** Undefined classes, wrong token sizes, and opacity bugs all pass tsc/vitest/theme-guard. (Memory: `css-bugs-evade-tests-and-theme-guard`.)
- **Client permission gates need 3 layers, not just a hidden nav link:** restore-path guard, an effect that resets on mid-session permission loss, and a render-branch check. The server 403 is necessary but not sufficient for UX.
- **Tolerant parsing for user-supplied content.** A strict parser in a `catch → ""` discards everything on one syntax error; `postcss-safe-parser` recovers per-rule so only the bad part is stripped. Same principle applies to any user-content sanitizer.

### Key Lessons

1. **Adding a permission ripples across many specs.** The 18th permission broke count assertions in rbacDb/rbacMigration/web-permissions/RolesPage specs and needed permissionGroups wiring. Budget for the ripple when adding RBAC permissions. (Memory: `adding-permission-ripples-across-specs`.)
2. **Theme-aware assets can't be auto-recolored if they're opaque uploads.** The inline default logo themes via `var(--accent)`, but customer `<img>` uploads can't — which is why BRANDUI-06 (optional dark-logo override) and BRANDUI-07 (dedicated favicon) emerged mid-milestone during UAT.
3. **Operator-found UAT gaps are best fixed in-session with a regression test each**, then re-walked — same hot-fix-as-follow-up discipline established in v1.4, now proven across a 14-test walk-through.

### Cost Observations

- Model mix: predominantly opus (planning + execution + verification).
- Sessions: multi-session (paused/resumed across Phases 81→84 + a long UAT-polish tail).
- Notable: the UAT-polish tail (many small CSS/UX corrections) consumed disproportionate turns relative to feature execution — reinforces front-loading a visual-design pass before verification.

## Milestone: v1.17 — Chart Number Formatting

**Shipped:** 2026-06-27
**Phases:** 3 (Phase 85 → Phase 87) | **Plans:** 3 | **Commits:** 32

### What Was Built

- **SI smart-abbreviation format (Phase 85):** `FormatSpecSI` in `columnFormatter.ts` (d3 `` `.${decimals+1}~s` ``), surfaced in the Column Format editor; propagates to all column-config surfaces via the single `resolveFormatter → buildFormatter` gateway.
- **Per-widget Y-axis format (Phase 86):** shared `FormatSpecEditor` extracted; `yAxisFormat?` config field + hybrid resolution (override → bound-column default → identity, `configVersion`-reactive) applied to value-axis ticks only on timeline + line.
- **Bar chart format + verification (Phase 87):** generalized a `formatSpec` ConfigField type → bar got the same control; content-sized value axis; semantic axis titles (follow data on flip). Operator UAT 6/6.

### What Worked

- **Reusing the v1.15 single-formatter gateway paid off massively.** Phase 85 added one `FormatSpec` kind and it propagated to 8 render surfaces with ZERO per-surface wiring — the verification just had to confirm the gateway, not touch each surface.
- **Generalizing rather than special-casing.** When the bar chart needed the Y-axis option (a UAT addition), promoting it to a reusable `formatSpec` ConfigField type (vs a bespoke panel) made it a ~3-line registry change.

### What Was Inefficient

- **A long UAT-polish tail dominated the milestone.** The 3 feature plans were small; the bulk of the work (and commits: 16 of 32) was operator-found polish during Phase-87 UAT — chart fill, spacing, fonts, login tokens, chips, tooltip sizing. Most of these are recurring CSS/density issues that a visual-design pass (or a shared chart-chrome spec) would have caught up front.
- **The recharts container-fill bug took several iterations** to pin to the flexbox `min-height:auto` default — guessing at wrappers (height:100% → absolute-inset) before the DOM measurement (container 185 = body 205 − 20 padding) revealed it was a flex height-resolution issue, fixed with `min-height:0`.

### Patterns Established

- **recharts ResponsiveContainer needs `min-height:0` on its flex-item ancestor** (the default `min-height:auto` collapses percentage-height charts). Applies to every chart widget.
- **Chart axis titles must be semantic (category/value), not physical (X/Y)** — bind them to the data so orientation flips move them correctly.
- **Size value axes to their formatted tick labels** (`estimateValueAxisWidth`) since recharts 2.x has no `width:"auto"` — short SI labels reclaim plot space.
- **A DOM measurement beats guessing for layout bugs** — one `clientHeight` comparison settled multiple rounds of wrapper speculation.

### Key Lessons

1. **When two charts share a renderer but only one misbehaves, measure the DOM before changing code** — the fill bug looked renderer-specific but was a shared flexbox issue.
2. **Off-scale literals hide in inline styles** (tooltip `fontSize:13`, login `--accent-2` focus) — theme-guard doesn't scan TSX numeric props, so these slip through gates; a visual pass catches them.
3. **Frontend-only milestones still benefit from the full verify-work loop** — every gap here was visual/CSS, invisible to tsc/vitest/theme-guard.

### Cost Observations

- Model mix: predominantly opus.
- Sessions: single long session (plan → execute → verify → extended UAT-polish tail).
- Notable: feature execution was cheap (3 small plans); verification + polish was ~5× the cost — consistent with v1.16's tail. A reusable "chart chrome / density" spec would amortize this across future chart work.

## Milestone: v1.18 — Per-Visualization Filter Selection

**Shipped:** 2026-06-30
**Phases:** 10 (88–96 incl. 93.5) | **Plans:** 20 | **Commits:** 71

### What Was Built
Per-visualization filter selection: each chart widget, WMS map layer, and dv-backed widget picks which active filters it applies via a source-widget allow-list (self-filter + spatial-draws sources). One Kinetica view per UNIQUE filter combination (deduped, ref-counted, DROP-at-0, env-bounded with all-filters fallback). Spatial draws folded into the combination model; deploy-time DISABLE_DV_FILTER_SCOPE flag; on-widget "N of M filters" badge + per-layer legend indicator + "All filters (limit)" fallback badge. Default accept-all byte-identical to v1.17.

### What Worked
- **Phase-by-phase byte-identical gate (COMBO-V118-04).** Building the engine (88–92) under a "default accept-all == v1.17" correctness gate before any user-visible config meant the risky read-path migration landed invisibly and safely.
- **Research pass before the novel phases (90, 92, 93.5, 94).** The combination-orchestrator, both read-path wirings, and spatial fold-in were each de-risked by a researcher mapping exact edit points first.
- **Decimal-phase insertion (93.5).** When the operator expanded scope to fold spatial into the combination model mid-milestone, inserting Phase 93.5 (vs renumbering) kept the roadmap clean.
- **Live UAT caught what gates could not.** All 6 gaps + 2 scope additions surfaced only in the operator walk-through — none were caught by green automated gates.

### What Was Inefficient
- **Two read-path/store migrations left stragglers.** The v1.18 move to filterCombinationStore orphaned the legacy filterViewStore that FilteringBadge/MapFilteringBadge still read → stuck "Filtering…" badges. The original ceiling fix touched the combo store but the badge read a *different* store, so the bug survived one fix cycle. Lesson reinforced: when migrating a read path, grep ALL consumers of the old store.
- **Badge reflected configured intent, not the ceiling-fallback reality** — required a second pass (compare actual bound hash vs configured hash).
- **Dev .env leaked into server vitest** (DEFAULT_VIEW_TTL_MINUTES=3) and looked like a v1.18 regression during the final gate; cost investigation time to prove environmental.

### Patterns Established
- **stableComboHash + resolveFilterSet/resolveSpatialShapes** pure-function core, reused by orchestrator AND badge/legend.
- **Sole-materialize-trigger invariant** extended: the orchestrator is the only table+dv materialize trigger (RecordsTableRenderer migrated in; no legacy island).
- **Badge fallback detection** via vizToHash(actual) ≠ configuredHash.

### Key Lessons
1. **A read-path migration is not done until every consumer of the old store moves.** Badges/indicators/spinners are easy to miss because they pass green unit tests against the old store.
2. **Operator UAT is the real verification for interactive features.** Schedule generous in-session gap-closure; expect scope refinements (self-filter, legend indicator) to emerge from the walk.
3. **A developer .env loads into server vitest (env.ts dotenv.config).** Suspect it before assuming a regression when materialize/TTL specs go red.

### Cost Observations
- Model mix: orchestration on opus (1M); executors/researchers/checkers on sonnet.
- UAT-driven gap closure (3 plans + 4 follow-up hot-fix commits) was the bulk of the tail.

## Milestone: v1.19 — Visualization Customization

**Shipped:** 2026-07-08
**Phases:** 8 (97–104) | **Plans:** 19 | **Commits:** ~65

### What Was Built
Per-visualization control over data + presentation without touching the shared filter/materialize engine: calendar smart time-granularity dropdown (auto domain+subdomain); per-viz custom raw-SQL WHERE ANDed into each widget's own read query (never a new materialize path; map/WMS excluded); custom per-table metrics (server-persisted labeled SQL aggregate, Tables-area editor, metric-picker integration, no extra aggregation wrapper); smart/logarithmic Y-axis on line/timeline/bar; multi-column bar group-by (clustered vs stacked, env-capped); and — added post-verification — synchronized map viewports (per-dashboard, echo-loop-guarded, default OFF).

### What Worked
- **Byte-identical backward-compat gate per feature.** Every feature shipped with an "absent config == prior behavior" regression lock (VIZSQL-V119-03, YAXIS-V119-04, BARGRP-V119-04, MAPSYNC-V119-06), so existing dashboards were provably untouched.
- **Sole-materialize-trigger invariant held via static grep** across all features — the custom WHERE is applied within the existing read query, never a new materialize.
- **Foundation-then-UI split for custom metrics (99 → 100)** kept the server table+CRUD independently verifiable before the authoring UI + picker landed.
- **Live UAT again caught what gates couldn't** — the info-popup regression surfaced only when an operator put 2+ maps on one dashboard.

### What Was Inefficient
- **A phase added AFTER the verification phase forced a re-verification.** Phase 104 was inserted post-103; closing the milestone required re-running 103's gates to cover the final 8-phase count. Lesson: a verification phase is only final if no feature phase follows it.
- **The dev `.env` leak bit again.** Server vitest had to be run with `DEFAULT_VIEW_TTL_MINUTES=""` to neutralize the dev override before the set-based gate read true; without it, materialize/TTL specs falsely reddened (same trap as v1.15/v1.18).
- **Duplicated layer-name logic diverged.** The Info Card's dropdown used its own `layerNameFor` that forgot the `config.name` check the map popup / legend used, so the same layer read differently on two surfaces — a copy-paste-drift bug fixed by aligning to the canonical resolver.

### Patterns Established
- **Per-widget scoping for shared global chart stores.** `infoSelectionStore` gained `activeWidgetId` so multi-map dashboards don't clobber each other — the general lesson: a dashboard-global singleton needs a per-widget owner key once more than one widget renders it.
- **Min-size + CSS `min-width`/`min-height` scroll region** for "don't shrink below readable" chart sizing (bar Min Bar Size).

### Key Lessons
1. **Don't put a feature phase after the milestone's verification phase** — or budget a re-verification when you do.
2. **A dashboard-global store must be scoped by the owning widget the moment a second instance can mount.** The multi-map info-popup bug was latent from v1.4 and only appeared with 2+ maps.
3. **The dev `.env` leaks into server vitest** — run set-based gates with the dev overrides unset (recurring; now thrice-confirmed).

### Cost Observations
- Milestone closed out via live UAT gap-fixing (info popup) + two out-of-scope UI extras (bar Min Bar Size, aggregated Data Table) folded in during the same session.

## Milestone: v1.20 — Filter Panel

**Shipped:** 2026-08-27
**Phases:** 8 (105–110 incl. inserted 109.1 / 109.2) | **Plans:** 12 | **Commits:** 71

### What Was Built
A presentation layer over the existing filter system: a per-dashboard collapsible right-side filter panel (designer-chosen via a `canEdit`-gated Settings modal that flips the surface live), one shared `FilterChip` replacing all three prior top-bar chip implementations, per-chip remove / per-group clear / collapsed rail + count badge, a global clear-all that mutates INPUT stores only and lets the orchestrator ref-count DROP the views, and filter→widget mapping ("applies to N widgets" + hover-ring + click-scroll-flash) derived from a pure reverse-map lib that inverts the real resolvers across both read paths. Two inserted phases wired Calendar / Timeline / Numeric Line into the filter-scope engine so their config UI actually does something. One server touch in the whole milestone: `dashboards.filter_display_mode`.

### What Worked
- **Deriving the applies-to map by INVERTING the real resolvers** instead of reimplementing scope logic. The panel's count and the actual read paths cannot disagree, because one is computed from the other's inverse.
- **Locking "source of truth = INPUT stores, never the derived combination store" in the milestone scope doc before any code.** That single sentence pre-empted the `FilteringBadge` permanent-staleness class of bug for every new surface.
- **Making the panel an in-flow flex sibling** rather than a fixed overlay — reflow came free from RGL's existing ResizeObserver, no layout math.
- **Consolidating three chip implementations into one component while adding the fourth surface.** Parity stopped being something to maintain.
- **Inserting 109.1/109.2 mid-milestone when the gap was found**, before verification, rather than shipping a config UI that silently did nothing.

### What Was Inefficient
- **Tracking docs drifted from reality and nobody noticed for six weeks.** The ROADMAP phase table said Phase 109 was "0/? Not started" while its own checklist line and its `109-01-SUMMARY.md` / `109-VERIFICATION.md` said complete; the table had no rows at all for the inserted 109.1/109.2; `STATE.md` sat at `status: unknown`. All of it surfaced only when someone asked "what's left?".
- **Gate evidence went stale between capture and use.** `110-GATES.md` was captured 2026-07-12; by the time the operator walked the UAT, two commits had landed and the recorded 152 files / 3371 tests no longer described the tree. Re-running was cheap — but trusting the file would have attested the wrong thing.
- **A dead store kept a whole read path silently wrong for a milestone.** Phase 91/92 moved the map read path to the combination model but left `filterViewStore.setView` with no callers; the info click still read that store, resolved an empty view name, and fell through to the BASE TABLE. Every automated gate passed the entire time, and two `POPUP-V14` dv tests were passing *because* of the bug (their `beforeEach` never reset the combination-store mock).
- **Verification-phase gates ran before two more commits landed** — the same "no feature work after the verification phase" lesson v1.19 recorded, in a milder form.

### Patterns Established
- **One shared resolver per read-path decision, returning everything every caller needs.** `lib/resolveLayerViewName` returns `materializeVersion` the info paths don't use, specifically so the WMS sites can adopt it and end the duplication.
- **Per-theme defaults as data on one registry entry, not as separate entries.** The basemap work started with two OSM rows (plain + dark) and collapsed to one row with a `{light, dark}` default-CSS pair — the theme is not a different basemap.
- **Operator-facing CSS as an allow-listed declaration block forwarded through CSS custom properties.** Values are CSSOM-validated per property, a bad value degrades to the `var()` fallback, and nothing reaches a stylesheet where a selector could break out.
- **OL per-layer `className` to isolate a layer's canvas** so a CSS filter hits the basemap alone — with the variant class on our own wrapper, because OL reuses a container only while `container.className === layer.getClassName()`.

### Key Lessons
1. **When a read path migrates to a new store, grep for every remaining reader of the old one — and delete the old writers.** A store nobody writes but somebody reads fails silently and passes every gate.
2. **A test's `beforeEach` must reset every store the code under test can read, not every store it reads today.** Two dv tests passed only because the info path ignored a store it should have been reading; the fix broke them, which is exactly what should have happened.
3. **Re-run gate evidence at the moment you attest it.** A gates file is a claim about a specific tree, not a durable property of the project.
4. **Ask "what's remaining?" periodically.** Six weeks of tracking-doc drift cost nothing to fix and would have cost real confusion at archive time.
5. **Third-party freebies expire.** CARTO's basemaps went from anonymous to watermarked with no code change on our side; the fix was one env var, but only because the tile URLs lived in one place.

### Cost Observations
- Model mix: single-session close-out on opus (1M) — gate re-runs, the info-click fix, and archival in one context.
- Notable: the info-click bug was found by the operator asking a one-line question ("what table is the info click using?"), not by any gate. Cheapest bug-finding tool in the milestone.

## Cross-Milestone Trends

### Process Evolution

| Milestone | Phases | Plans | Key Change |
|-----------|--------|-------|------------|
| v1.0 | 3 | 16 | Initial GSD workflow on this codebase; established phase / plan / verify cadence |
| v1.1 | 5 | 19 | Frontend test infra (Vitest + jsdom + RTL + Zustand store-reset shim) added in Phase 7; per-call audit log convention; structured boot logs |
| v1.2 | 4 | 24 | Wave-based parallelization in plan execution; capability-store boot-discovery pattern; PITFALL-locks-as-planning-artifact discipline; first operator-directed mid-cycle supersession (GAP-12-C3) |
| v1.3 | 5 | 14+3 gap-closure | Spike-first approach before all code; gap-closure numbering within verification phase (17-02/03/04); module-source grep as spec assertion for architectural locks; `tech_debt` carry-over registry pattern |
| v1.4 | 7 | 20+3 gap-closure | Hot-fix-as-follow-up-commit pattern (GAP-24-06-A); `mountedRef` cleanup-gate joins `materializeAbortRef` as canonical async-guard primitive; Session-Fix labeling for small in-session fixes; `overall_status` three-state lifecycle (`tech_debt` → `human_needed` → `passed`); pure-consumer relaxation documented inline at Phase 23 |
| v1.20 | 8 (incl. 2 inserted) | 12 | Mid-milestone phase insertion when a config UI was found to be inert (109.1/109.2); gate evidence RE-RUN at attestation time rather than trusted from capture; one shared read-path resolver returning every caller's needs so duplication can be retired |

*Rows for v1.5–v1.19 were never backfilled into this table; see each milestone's section above.*

### Cumulative Quality

| Milestone | Tests at close | Codebase LOC | Audit status |
|-----------|----------------|--------------|--------------|
| v1.0 | 211 | ~10k | tech_debt (19/19; 5 deferred) |
| v1.1 | 337 (server) + 35 (frontend) | ~12.5k | passed (21/21; 4 informational TD) |
| v1.2 | 343+ (server stable; frontend grew across 9-12) | ~14.2k | informal close (12/12 tracked; 4 known gaps; no formal audit) |
| v1.3 | 312/417 backend (104 pre-existing red: TD-V11-04 ~60, TD-V13-01 ~44) + 347/347 frontend | ~16k | pragmatic_close (33/34; 1 partial VERIFY-V13-01; 3 known gaps) |
| v1.4 | 523/523 frontend (across 34 test files; +176 new specs incl. 16 GAP-cycle regressions) | ~17.5k (frontend; +23,669/-245 across 113 files in v1.4 range) | pragmatic_close/passed (19/20; 1 Deferred → TD-V14-WKB-SPIKE → v1.5; 4 UAT gaps closed inline) |
| v1.5 | 775/775 frontend + 50/50 server materialize specs (104 pre-existing red carry from v1.3: TD-V11-04, TD-V13-01) | ~18.5k (frontend; +104 commits, 16 plans across 7 phases) | pragmatic_close/source-only (live UAT skipped; 5 inline gap closures; 3 carry-overs incl. TD-V14-WKB-SPIKE, map-only-trigger, TD-V15-LIVE-UAT) |
| v1.20 | 3439/3439 frontend (154 files) + server SET-BASED ⊆ TD-V16-TEST-ISOLATION | +6358/−491 across 56 files in `packages/` (71 commits) | passed (SC1–SC4 attested; operator UAT 8/8 PASS, zero gaps; 19/19 requirements) |

*Rows for v1.6–v1.19 were never backfilled into this table; see each milestone's section above.*

### Top Lessons (Verified Across Milestones)

1. **Spike output drives architecture decisions; spike output that's only "no error" is a trap.** v1.0 spike on Kinetica permission denial taxonomy (commit `2f81b7d`) produced positive evidence ("HTTP 400 + 'access denied' body" → KineticaPermissionError). v1.2 Phase 11 WMS spike produced absence-of-evidence and shipped a partially-working contract. v1.3 Phase 13 spikes produced PNG tiles (S1), verbatim error strings (S3), and DDL execution evidence (S2) — all consumed directly by implementation code. Confirmed × 3 milestones.
2. **Documenting PITFALLS as planning artifacts (M-01..M-08, C-01..C-07, V13-P-*, etc.) prevents relitigation.** Established v1.1 (Phase 5 OIDC PITFALLS); reused heavily in v1.2 (M-* locks across Phases 11+12); locked explicitly in v1.3 Phase 16 with byte-for-byte preservation comments. Confirmed × 3 milestones.
3. **Per-call audit log + structured boot log catch operational issues that tests miss.** v1.1 added both; both surfaced real issues in 2026-05-04 dev deployment (consent loop, RFC 9207 iss-check) that would have been invisible without structured logging. v1.3's TTL recovery was designed around the verbatim Kinetica error string — the "structured output" principle applies to upstream errors too, not just internal logs.
4. **Frontend Zustand store-reset shim is a foundational test-infra investment.** Stood up in v1.1 Phase 7; every v1.2 phase used it. v1.3 added a second store (`useFilterViewStore`) that relied on the same shim from day one. Without it, inter-test state bleed in `filterViewStore.spec.ts` would have produced flaky results from Phase 14 onward. Confirmed × 3 milestones.
5. **Hard-cutover decisions beat auto-migration when new shape is materially different from old.** v1.0: hard cutover for sessions table schema. v1.2: hard cutover for Phase 11→12 widget shape. v1.3: hard cutover for WHERE-injection → materialized-view approach (4 deleted functions, 0 migration path). All three shipped faster than migration-based alternatives.
6. **Test mock updates must land atomically with production code changes.** (New lesson established v1.3.) TD-V11-04 exists because `new Issuer(meta)` was added to `oidc.ts` in commit 22def0a without updating 6 test files. The fix is a 30-second check: when touching a production module, grep for `vi.mock(` on that module path and update any mocks in the same commit. A latent failure that takes 4 phases to surface costs significantly more than the check would have.
7. **Run the full test suite — including backend — at every phase close, not just the new spec file.** (New lesson established v1.3.) Both TD-V11-04 and TD-V13-01 were latent for 4 phases because the phase gate only ran the v1.3-specific spec. A full `vitest run` at Phase 13 close would have surfaced both issues immediately.
8. **`useRef`-based flags whose value flips in cleanup MUST have at least one StrictMode-wrapped regression spec.** (New lesson established v1.4 via GAP-24-06-A.) React 18 StrictMode preserves `.current` across mount-cleanup-mount; without re-arm at the top of the effect body, second mounts inherit stale post-cleanup values. The dev-only manifestation is the failure mode that's easiest to ship without noticing — production tests appear green, then dev breaks the moment anyone reloads. Applies to all async-guard patterns: `mountedRef`, `materializeAbortRef`, `infoQueryAbortRef`, `sourceListenerCleanupRef`, future siblings.
10. **A store nobody writes but somebody still reads fails SILENTLY and passes every gate.** (New lesson established v1.20.) Phase 91/92 migrated the map read path to the combination model and left `filterViewStore.setView` with zero callers; the info click kept reading that store, resolved an empty view name, and fell through to the base table for an entire milestone. When migrating a read path, grep for every remaining reader of the old store and delete the old writers in the same change. Corollary: a test `beforeEach` must reset every store the code under test *can* read — two dv tests were passing precisely because the info path ignored a store it should have been reading.
11. **Gate evidence is a claim about a specific tree, not a durable project property.** (New lesson established v1.20.) `110-GATES.md` was captured six weeks before the operator walked the UAT; two commits landed in between, so the recorded file/test counts described a tree that no longer existed. Re-running at attestation time cost minutes. Related: ask "what's remaining?" periodically — six weeks of ROADMAP/STATE drift (a completed phase listed as "Not started", inserted phases missing from the table, `status: unknown`) surfaced only when someone asked.

9. **Hot-fix-as-follow-up-commit beats new gap-closure plan for one-line fixes with clear root causes.** (New lesson established v1.4 via GAP-24-06-A.) When a regression is one-line, in-session, with a clear root cause and a single regression spec, ship it as a follow-up commit under the existing plan's SUMMARY rather than opening a new plan. Reserve new plans for cross-plan/cross-phase regressions or fixes requiring investigation. The branching call: "Does this need its own context window?"
