# Phase 17: verification - Context

**Gathered:** 2026-05-07
**Status:** Ready for planning

<domain>
## Phase Boundary

End-to-end verification phase that closes the v1.3 milestone. Two deliverables:

1. **Low-cardinality / spatially-spread Kinetica test fixture** (VERIFY-V13-01) — closes TD-V12-04. The v1.2 fixture problem (`demo.nyctaxi` masks filter visibility at city zoom) gets a purpose-built table where filtering visibly narrows tiles and chart points to the naked eye.
2. **`17-VERIFICATION.md` end-to-end report** (VERIFY-V13-02) — closes TD-V12-01. Documents PASS / FAIL / DEFERRED per criterion across:
   - (a) Chart filter click → chart narrows → map tiles narrow → Clear All → both revert to raw-table data
   - (b) TTL expiry recovery (proactive `expiresAt` check + reactive `isViewNotFoundError` catch + max-1-retry cap)
   - (c) Backend supertest coverage citation (existing Phase 13 + Phase 15 specs; both AUTH_MODE=password and AUTH_MODE=oidc with stubbed sessions)
   - (d) Frontend vitest coverage citation (FROM-swap + LAYERS-swap + store + lifecycle reset specs from Phase 14/15/16)
   - Plus all four Phase 16 deferred human-needed checks: visual filter narrowing, network-tab WMS URL inspection, same-name re-materialize cache-bust (`_mv` increments), v1.2 lifecycle preservation in StrictMode dev build

**Phase 17 is the v1.3 milestone-close phase.** It writes the artifact that `/gsd:audit-milestone` will consume.

**Out of scope for Phase 17:**

- Net-new code features. Phase 17 verifies what Phases 13–16 built; it does not add filter/render/lifecycle capabilities. (Inline gap-fix plans are an exception — see "Gap-handling protocol" below.)
- OIDC S2.b live DDL re-probe — explicitly **skipped** in this verification cycle. Documented as DEFERRED in VERIFICATION.md with no manufactured fallback evidence. v1.3 milestone closes `passed` (OIDC DDL is auth-deployment-readiness, not v1.3 feature scope).
- Permanent test fixture — fixture is temporary (created at start of UAT, dropped after report is written). Repo gets the DDL/INSERT script as a reference artifact only if planner judges it cheap to commit; not a hard deliverable.
- Phase 11 single-WMS widget shape — `.widget-map-reconfigure` overlay (Phase 12 LAYER-12 hard cutover) stays untouched; not exercised in UAT.
- Service-account DDL fallback path — Phase 13 SPIKE-V13-02.a PASSed for password mode; no service-account path was speculatively built. Phase 17 does not re-evaluate this.
- Records-table-only-on-tableId-X gap-closure (V13-LIMIT-01) and map-only-on-tableId-X gap-closure — these are *observed and documented* in UAT, not *fixed* in Phase 17. Accepted limitations per Phase 15/16 locks.
- Tile pixel-byte automated diffing — visual screenshot evidence is sufficient; no headless OL+Kinetica probe.
- `bumpMaterializeVersion` action removal — flagged for tech-debt cleanup at Phase 17 close (no caller emerged across Phases 14/15/16); Phase 17 itself does not delete it.

</domain>

<decisions>
## Implementation Decisions

### Plan staging (user-locked: 1 atomic plan)

- **Single plan, single deliverable**: `17-01-PLAN.md` covers fixture creation + UAT walkthrough + VERIFICATION.md report writing. Mirrors Phase 16's atomic-single-plan choice.
- Verification phase has natural sequencing (fixture → UAT → report) but no breaking signature changes that demand multi-plan separation. Each task within the plan should land green; the plan as a whole closes the v1.3 milestone before audit.
- Internal commit boundary inside the plan (planner's discretion): may produce multiple atomic commits (e.g., one for fixture artifact if any is committed, one for VERIFICATION.md, one for STATE.md / ROADMAP.md / REQUIREMENTS.md updates).

### Gap-handling protocol (user-locked: fix inline)

- **If UAT surfaces a real bug or gap (not just a Phase 16 deferred-check confirmation):** add a follow-up plan inside Phase 17 (e.g., `17-02-PLAN.md`, `17-03-PLAN.md`) to close the gap before milestone close. Mirrors v1.2 Phase 12 pattern (12-07 was added for GAP-12-C3, then superseded once filtering rework was scoped).
- **Do NOT defer real bugs to v1.3.1 / v2.** Keep v1.3 closure clean; surface gap in VERIFICATION.md, fix it, re-verify, then close.
- **Do NOT use `/gsd:insert-phase 16.X`** to handle UAT-surfaced bugs — they belong in Phase 17 because Phase 17 is the verification phase. An insert-phase only makes sense if the bug requires a foundation Phase 17 itself can't deliver.
- Phase 16 deferred-check items (visual narrowing, network-tab inspection, `_mv` cache-bust runtime, StrictMode lifecycle) are NOT "gaps" — they are exactly what Phase 17 UAT is designed to verify. They run as part of the standard walkthrough.

### Test fixture sourcing (user-locked: synthetic CREATE TABLE on Kinetica)

- **Source:** Synthetic CREATE TABLE + INSERT script (or CTAS from a row-generator) run by the operator against deployed Kinetica using BI-user creds. Full control over cardinality + spatial spread; reproducible from a script if the table is dropped. No reliance on existing demo datasets that may have density-masking issues.
- **Cardinality target:** **5–10 distinct values** on the filter column. Sweet spot: each value has enough rows to be visible on the map at default dashboard zoom; filtering to one value removes ~80–95% of points (unambiguous to the naked eye). Examples: vendor codes (3–5), category buckets (8), regions/states (10).
- **Persistence:** **Temporary table** — operator creates at start of UAT, drops after VERIFICATION.md is written. Keeps Kinetica clean. The DDL/INSERT script may or may not be committed to repo at planner's discretion; if committed, suggested location is `kinetica_bi/server/scripts/test-fixtures/v13-filter-fixture.sql` (reference only, not auto-run).
- **Spatial spread:** **Continental US scale, ~500–2000 points.** Spread across CONUS so points are visible at default dashboard zoom (no clustering into a single pixel). Few enough that filtering one category clearly removes a chunk. Suggested data shape: lat/lon coordinates for synthetic "stations" or "events", one categorical column (e.g., `category` ∈ {A, B, C, D, E, F, G, H} for ~8 cardinality), optional measure columns to feed bar/line/pie/scatter aggregations.
- **Schema-qualification:** Per Phase 13 spike S4 PASS, both qualified and unqualified work; planner should follow the existing `<schema>.<table>` convention used by `demo.nyctaxi` and the rest of the app. Operator's default schema is `ki_home` (per STATE.md).
- **Column shape (planner's discretion):** lat/lon as separate REAL columns is the simplest path (matches Phase 11 latlon spatial mode). WKT or WKB columns are over-engineering for the fixture.

### UAT walkthrough scope (user-locked: full coverage)

**All four user flows must be exercised:**

1. **Chart drill → Clear All (single-table dashboard)** — bar/line/pie/scatter/table chart on the test fixture: click element, verify chip + filtering badge + chart narrows; click × / Clear All; verify revert. Covers FILT-V13-01..05 + DRILL-* carry-forward.
2. **Map drill verification — LAYERS swap + tile narrow** — dashboard with map widget on the test fixture: apply filter via a co-located chart, verify map tiles visibly narrow, Network tab confirms `LAYERS=_kbi_filt_<…>&_mv=<n>` while filtered and `LAYERS=<schema.table>` (no `_mv`) after Clear All. **Closes Phase 16 deferred 4 human-needed checks. Closes TD-V12-01.**
3. **Multi-widget on same table (chart + map + records-table)** — single tableId backing chart + map + records table on one dashboard. Verifies single materialize from `AggregatedWidgetRenderer` feeds all 3 widgets — no 2N redundant DDL. Closes VSTORE-V13-02 / FILT-V13 lock at the runtime level.
4. **Lifecycle resets — logout + dashboard switch** — apply filter, switch dashboards, verify view DROPped (Network tab shows DELETE) + state cleared. Apply filter, log out, verify same. Covers LIFE-V13-03..05.

**All four edge-case / accepted-limitation scenarios must be observed and documented:**

- **V13-LIMIT-01** — records-table-only on tableId X (no AggregatedWidgetRenderer on that table). Verify materialize never fires; raw-table query happens. Document as **accepted limitation** in VERIFICATION.md, NOT a regression. Surfaces here per Phase 15 lock.
- **Map-only on tableId X** — dashboard with a map widget on tableId X but no chart on that table. Map renders `LAYERS=<table>` permanently — no materialize trigger. Document as **accepted limitation** parallel to V13-LIMIT-01. Surfaces here per Phase 16 lock.
- **Multi-table A/B isolation** — dashboard with widgets on tables A and B. Filter on A: only A widgets re-query the view; B widgets unchanged. Verifies the per-tableId scoping that was the v1.3 architectural goal (PITFALL C-02 lock).
- **Empty-state widgets / zero-widget dashboards** — dashboard with no widgets, or widgets with no associated table. Verify no errors in console, no spurious materialize calls, lifecycle reset still fires on switch / logout.

**All registered chart types must be exercised:**

- 8 chart types total: **bar, line, pie, scatter, table, records-table, big-number, map**.
- Each must be config'd against the test fixture and walked through the chart-drill flow (or, for big-number, observe FROM-swap on materialized-view query).
- Ensures FROM-swap landed cleanly across every chart renderer touch site, not just the one Claude tested locally. Worth the ~30 extra UAT minutes.

**Pixel proof for "tiles visibly narrow" (Phase 16 Truth 1 visual-side closure):**

- **Before/after screenshots required.** Operator takes one screenshot of the map widget *before* applying a filter and one *after*; embeds both in VERIFICATION.md or links to `.planning/phases/17-verification/screenshots/`.
- **Unambiguous PASS/FAIL evidence.** Closes TD-V12-04 with reproducible artifact.
- Optional: alongside screenshots, a Network-tab WMS URL excerpt showing `LAYERS=<view>&_mv=<n>` (filtered) vs `LAYERS=<schema.table>` (cleared). Strengthens the report.
- No tile pixel-byte automated probe — out of scope.

### TTL expiry verification (user-locked: shortcut paths preferred over real waits)

- **Proactive (LIFE-V13-01):** **DevTools mutate `expiresAt` to past timestamp.** Operator opens DevTools, runs `useFilterViewStore.getState().setView(tableId, { ..., expiresAt: Date.now() - 1000 })` to fake expiry, triggers a chart re-render (e.g., chart row click), confirms re-materialize fires + chart still renders. Fast (sub-second per test); deterministic; precise. Document the exact DevTools sequence in VERIFICATION.md so the test is reproducible.
- **Reactive (LIFE-V13-02):** **Manual `DROP TABLE` via Kinetica.** Apply filter so view exists. Operator runs `DROP TABLE _kbi_filt_<…>` directly against Kinetica (Workbench / SQL tab / curl). Click chart again — verify error path catches `isViewNotFoundError`, re-materializes silently, chart updates. Closest to production behavior; deterministic; no client mocking. Document the verbatim Kinetica error string match in the report (matches Phase 13 spike S3 capture).
- **Max-1-retry cap (Pitfall 3 lock):** **DROP twice in rapid succession.** Operator applies filter, DROPs view via Kinetica (recovery 1: re-materialize succeeds, retry succeeds). Within ~1 second, DROPs view again, clicks chart (recovery 2: re-materializes, but if retry's chart query also returns view-not-found, fall through to raw `FROM <table>`). Verify chart falls through silently — no infinite loop, no error toast. Exercises the `retryRef` pattern Phase 15 locked.
- **OIDC TTL exercise:** **NOT REQUIRED.** Per user lock — TTL behavior is Kinetica-side; the auth-mode-specific path (Bearer vs Basic) only affects materialize call success, not TTL semantics. Once we accept (per OIDC S2.b decision below) that OIDC DDL is architecturally validated by Phase 13 supertest coverage, TTL recovery inherits.

### OIDC S2.b deferred re-probe (user-locked: explicit DEFERRED + milestone passed)

- **Skip the live re-probe.** Phase 17 does NOT run CREATE OR REPLACE MATERIALIZED VIEW + DROP via deployed AUTH_MODE=oidc against real Kinetica with OIDC trust. Documented as DEFERRED in `17-VERIFICATION.md`.
- **No manufactured fallback evidence.** VERIFICATION.md does NOT cite Phase 13 supertest mock coverage as a substitute for the live probe. Be honest about what was vs. wasn't tested. The deferred item stands as a single explicit gap on the report.
- **Milestone tag = `passed`.** v1.3 milestone close uses architectural separation as the rationale: OIDC DDL probing is *auth-deployment-readiness* (DBA configures OIDC trust at deploy time; BI app sends bearer tokens), NOT v1.3 *feature scope*. The v1.3 architectural primitive (server-side transient materialized view) works in both auth modes by inheriting v1.0/v1.1 typed-error + per-user-creds machinery. The OIDC re-probe is a production-deploy gate item, tracked alongside other v1.0/v1.1 deploy items (e.g., TD-V11-03 RFC 9207 iss-check workaround).
- **Tracking:** VERIFICATION.md flags the deferred item; PROJECT.md "Active" or backlog gets a single-line entry; `MILESTONES.md` v1.3 entry notes it under Known Gaps. Reuses the v1.0 / v1.1 known-gap pattern.
- **If user later changes mind:** a separate gap-closure plan (or a v1.3.1 / pre-deploy probe) handles it. NOT a Phase 17 concern.

### VERIFICATION.md structure (Claude's Discretion — recommended template)

Planner picks final shape; recommended template (combining `12-VERIFICATION.md` + `16-VERIFICATION.md` precedents):

- **Frontmatter** — `phase: 17-verification`, `verified_at`, `overall_status: passed | tech_debt`, `criteria_status` (per-criterion PASS/FAIL/DEFERRED), `gaps:` (UAT-surfaced + accepted limitations + OIDC deferred)
- **Verdict** — one-line summary of close status
- **Walkthrough Log** — narrative of UAT session (ties to the running app on `npm run dev`)
- **Per-Criterion Status** — table of (a)/(b)/(c)/(d) success criteria with PASS/FAIL/DEFERRED + evidence link
- **Per-Flow Status** — table of the 4 user flows × 4 edge cases × 8 chart types (or matrix collapse where evidence is shared)
- **Phase 16 Deferred Checks** — explicit closure of the 4 human-needed items from `16-VERIFICATION.md` frontmatter
- **TTL Recovery Section** — proactive + reactive + max-1-retry walkthroughs with DevTools/Kinetica commands documented
- **Test Coverage Citation** — links/counts for supertest backend coverage (Phase 13 + Phase 15) and vitest frontend coverage (Phase 14/15/16)
- **Open Gaps + Accepted Limitations** — V13-LIMIT-01, map-only-on-tableId-X, OIDC S2.b deferred (with rationale)
- **Tech Debt (Informational)** — `bumpMaterializeVersion` removal candidate; `widget.config.layerName` legacy fallback removal candidate; any UAT-surfaced minor items

### Claude's Discretion

- Whether to commit the fixture DDL/INSERT script to the repo. Planner picks based on script size + reuse value. If committed, suggested path: `kinetica_bi/server/scripts/test-fixtures/v13-filter-fixture.sql` (or similar; matches existing scripts/ convention if any exists). Not committed = operator-local only.
- Exact column shape of the synthetic table (lat/lon vs WKT vs WKB). Recommend lat/lon for simplicity (matches Phase 11 default spatial mode).
- Exact filter-column semantics (categorical strings vs ints vs enum-like). Recommend short strings (e.g., `'A'..'H'`) for human-readable chip text in the filter bar.
- Whether to use Kinetica's row-generator function (e.g., `generate_series` analog) or hand-crafted INSERTs. Either works; row-generator is more compact.
- Number of dashboards to set up for UAT (one big shared dashboard vs separate per-flow dashboards). Recommend per-flow dashboards for clean before/after screenshots.
- Whether screenshot artifacts go in `.planning/phases/17-verification/screenshots/` (committed) or operator-local only (not committed; VERIFICATION.md describes them in prose). Recommend committed for reproducibility; ignore if screenshot byte size is a repo-bloat concern.
- Whether to add `aria-busy` / a11y polish observations to VERIFICATION.md as a side-finding (Phase 15/16 left as Claude's Discretion). Optional — not gating.
- Whether to surface the `bumpMaterializeVersion` removal recommendation as a Phase-17-internal task (delete unused code) or as a tech-debt item carried to v1.3 backlog. Recommend backlog — Phase 17 is verification-only.
- Whether VERIFICATION.md cites specific commit hashes / line-number evidence (16-VERIFICATION.md style) or stays narrative-first (12-VERIFICATION.md style). Recommend hybrid: narrative walkthroughs + per-criterion table with evidence pointers.
- Whether to record the UAT browser/OS/dev-server config in VERIFICATION.md frontmatter (matches v1.0 milestone audit conventions). Recommend yes — small overhead, helps future reproducers.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### v1.3 milestone (project-level)

- `.planning/PROJECT.md` § "Current Milestone: v1.3 Unified Dashboard Filtering" — Locked architecture; FROM-swap + LAYERS-swap target features; v1.2 dead-code list; two-store split rationale; deferred items table
- `.planning/REQUIREMENTS.md` § "Verification" — VERIFY-V13-01..02 full specs
- `.planning/REQUIREMENTS.md` § Traceability — Phase 17 mapping (2 requirements)
- `.planning/REQUIREMENTS.md` § "Out of Scope" — items the verification report should NOT chase (filter persistence across refresh, undo/redo, materialize progress streaming, etc.)
- `.planning/ROADMAP.md` § Phase 17 — Goal + 2 success criteria
- `.planning/STATE.md` — Phase 13/14/15/16 lockdowns; spike findings; Phase 17 scope notes
- `.planning/MILESTONES.md` v1.0 / v1.1 / v1.2 entries — known-gap pattern Phase 17 mirrors for v1.3 close

### Phase 16 inheritance (deferred-check closure — MANDATORY READ)

- `.planning/phases/16-map-filtering/16-VERIFICATION.md` § frontmatter `human_verification:` — the 4 deferred checks Phase 17 UAT closes (visual narrowing, network-tab WMS URLs, `_mv` cache-bust, StrictMode lifecycle)
- `.planning/phases/16-map-filtering/16-VERIFICATION.md` § "Required Artifacts" — 9 artifacts already verified at code level; Phase 17 confirms runtime behavior
- `.planning/phases/16-map-filtering/16-CONTEXT.md` § "Out of scope for Phase 16" — items routed here (E2E verification + low-card fixture + OIDC S2.b)
- `.planning/phases/16-map-filtering/16-VERIFICATION.md` § "Recommendation" — "Proceed to Phase 17 UAT. No re-execution of Phase 16 needed."

### Phase 15 inheritance (chart-side filter pipeline + accepted limitations)

- `.planning/phases/15-chart-filtering/15-VERIFICATION.md` (if present) — chart FROM-swap evidence; Phase 17 inherits the validated pipeline
- `.planning/phases/15-chart-filtering/15-CONTEXT.md` § "OIDC S2.b DDL re-probe (user-locked migration)" — original deferral to Phase 17
- `.planning/phases/15-chart-filtering/15-CONTEXT.md` § Records-table-only-on-tableId-X — V13-LIMIT-01 accepted limitation surfacing here
- `.planning/phases/15-chart-filtering/15-CONTEXT.md` § "Reactive recovery max 1 retry" — `retryRef` pattern; pitfall 3 lock that UAT exercises via DROP-twice
- `kinetica_bi/src/lib/kineticaErrors.ts` § `isViewNotFoundError` — verbatim regex Phase 17 reactive UAT confirms (`/SqlEngine: Object '[^']+' not found/i` + `S/SDc:1513`)

### Phase 14 inheritance (store + helper plumbing)

- `.planning/phases/14-filter-view-store/14-CONTEXT.md` § "Store shape" — `FilterViewEntry` shape (`viewName`, `expiresAt`, `materializing`, `materializeVersion`, `dashboardId`)
- `kinetica_bi/src/store/filterViewStore.ts` — Phase 17 UAT mutates `expiresAt` via DevTools; the `setView` action is the entry point

### Phase 13 inheritance (endpoint contract + spike findings)

- `.planning/phases/13-spikes-and-endpoint/13-CONTEXT.md` § Spike findings — S1 PASS, S2.a PASS (password), **S2.b DEFERRED → Phase 17 ownership**, S3 verbatim error capture, S4 BOTH WORK
- `.planning/phases/13-spikes-and-endpoint/13-SPIKE-NOTES.md` § all sections — Phase 17 may append S2.b "skipped — auth-deployment-readiness item" entry if planner wants single-source spike record
- `kinetica_bi/server/src/index.ts:667-728` — `POST` + `DELETE /api/filter/materialize` reference impl (UAT exercises both)
- `kinetica_bi/server/src/lib/viewNaming.ts` — view-name regex `/^_kbi_filt_u\w+_d\d+_t\d+_s\w{8}$/` Phase 17 UAT confirms in Network tab

### Phase 12 verification-template precedent (MANDATORY READ for VERIFICATION.md authoring)

- `.planning/phases/12-dashboard-layers-panel/12-VERIFICATION.md` — narrative-first walkthrough format; per-criterion table with PASS / SUPERSEDED markers; "Follow-up Fixes Shipped During Verification" section pattern; "Open Gap" section pattern; "Recommended Next Step" routing
- `.planning/phases/16-map-filtering/16-VERIFICATION.md` — frontmatter-rich format with `criteria_status:` map + `human_verification:` array; observable-truths table; required-artifacts table; key-link-verification table; requirements-coverage table

Phase 17's recommended template combines both: narrative walkthrough log (12 style) + structured criteria/artifacts tables (16 style).

### Codebase maps

- `.planning/codebase/CONVENTIONS.md` — TypeScript strict, camelCase, 2-space indent, NO path aliases, no formatter (matters only if planner commits the fixture script)
- `.planning/codebase/STRUCTURE.md` — `kinetica_bi/server/scripts/` (if exists) for fixture script placement; `.planning/phases/17-verification/screenshots/` for screenshot artifacts
- `.planning/codebase/STACK.md` — Kinetica DDL syntax (`USING TABLE PROPERTIES (TTL = 5)`, sliding TTL semantics); naming constraints (200 chars max)
- `.planning/codebase/TESTING.md` — outdated (pre-vitest); ignore. Current state: server vitest@^4.1.5 + supertest (~337 tests), frontend vitest+jsdom+RTL+Zustand reset shim (~35 tests post-Phase 14; Phase 16 closed at 332/332 frontend+shared)

### Existing code (mandatory read before writing UAT runbook)

- `kinetica_bi/src/components/charts/MapChartRenderer.tsx` — Effects 1–4 lifecycle; Network-tab evidence target (the WMS GetMap URL the renderer emits is what UAT asserts on)
- `kinetica_bi/src/components/charts/WidgetRenderer.tsx` — `AggregatedWidgetRenderer` materialize trigger (the only POST `/api/filter/materialize` call site); `RecordsTableRenderer` FROM-swap consumer
- `kinetica_bi/src/store/filterViewStore.ts` — `useFilterViewStore` actions (Phase 17 DevTools console runs `useFilterViewStore.getState().setView(...)` to mutate `expiresAt`)
- `kinetica_bi/src/store/filterStore.ts` — `useFilterStore` chip state (UAT validates chip add/remove via Filter Bar interactions)
- `kinetica_bi/src/api/client.ts:570-612` — `materializeFilter` + `dropFilterView` helpers (Network tab evidence: `POST /api/filter/materialize` and `DELETE /api/filter/materialize` round-trips)
- `kinetica_bi/src/App.tsx:40-44` — logout reset (UAT exercises by clicking Logout)
- `kinetica_bi/src/components/DashboardsPage.tsx` § DashboardOpen cleanup — dashboard-switch reset (UAT exercises by switching dashboards mid-filter)
- `kinetica_bi/src/components/MapFilteringBadge.tsx` (Phase 16) + `kinetica_bi/src/components/FilteringBadge.tsx` (Phase 15) — badge presence is part of UAT visual evidence
- `kinetica_bi/server/src/index.ts:667-728` — backend endpoints UAT hits via the running app

### v1.3 research (commit `e68080f`)

- `.planning/research/SUMMARY.md` — synthesized stack + pitfalls + architecture overview
- `.planning/research/PITFALLS.md` § V13-P-* — Phase 17 verifies the pitfalls held in production:
  - V13-P-01 (no optimistic setView)
  - V13-P-02 (separate materialize AbortController)
  - V13-P-03 (proactive expiresAt — Phase 17 proactive UAT)
  - V13-P-04 (reactive isViewNotFoundError + retry — Phase 17 reactive UAT + DROP-twice cap)
  - V13-P-09 (multi-tab last-write-wins — accepted; not exercised in UAT unless trivial)
  - V13-P-12 (DDL permission failure UX — UAT confirms toast routing if DDL denial happens)

### v1.0 / v1.1 / v1.2 anti-pattern locks (still apply — UAT confirms preserved)

- **AP-1**: View-name state lives ONLY in `useFilterViewStore` — UAT spot-checks via DevTools (no `useState` shadow copies in renderers)
- **AP-2**: Map tile fetches and SQL chart fetches are independent lifecycles — UAT confirms tile updates don't trigger redundant SQL refetches
- **AP-3**: Server-side WHERE only — UAT confirms zero `WHERE` clauses in chart-query SQL (FROM-swap is the entire mechanism)
- **AP-4**: `tableId` is `number`, persisted at config-save time
- **C-02 / S-02**: Hot widgets scope selectors to `views[tableId]` — UAT cross-table A/B isolation flow validates this
- **PITFALL M-01..M-08** (Phase 11/12): preserved verbatim in MapChartRenderer — UAT StrictMode dev-build check confirms no double-mount, blank-tile flash, ResizeObserver `updateSize` fires
- **Pitfall 1..4** (Phase 12 layers): preserved verbatim — addLayer/removeLayer (no dispose), filter-version-bumps-all-layers, opacity single source of truth, XHR+arraybuffer+base64 imageLoadFunction

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- **Phase 12 + Phase 16 VERIFICATION.md templates** — Phase 17 inherits both formats. Planner combines: 12-style narrative walkthrough + 16-style frontmatter + structured tables.
- **Phase 11 SPIKE-NOTES precedent** (`11-SPIKE-NOTES.md`) — format model for any S2.b skip-rationale entry the planner adds to `13-SPIKE-NOTES.md`. (Optional; Phase 17's primary artifact is VERIFICATION.md.)
- **`useFilterViewStore`** — Phase 17 UAT uses DevTools to mutate `views[tableId].expiresAt` for proactive recovery test. Snapshot pattern: `useFilterViewStore.getState().setView(tableId, { viewName, expiresAt: Date.now() - 1000, materializeVersion, dashboardId })`. Reference-stable updates ensure the next render picks up the mutation.
- **`isViewNotFoundError`** (`kinetica_bi/src/lib/kineticaErrors.ts`) — Phase 17 reactive UAT triggers this path by manually DROP-ing the view via Kinetica then clicking the chart. The error-path catches the verbatim Phase 13 spike S3 string.
- **Kinetica Workbench / SQL tab / curl** — operator's tool for the manual `DROP TABLE _kbi_filt_<…>` reactive UAT test. Whatever operator already uses for ad-hoc Kinetica SQL is fine.
- **`npm run dev` (frontend on :5173) + `cd server && npm run dev` (backend on :4000)** — UAT runs against the dev server; matches Phase 12 verification environment.
- **DevTools Network tab** — primary evidence-capture mechanism for `LAYERS=<view>&_mv=<n>` vs `LAYERS=<schema.table>` (no `_mv`) checks; for `POST /api/filter/materialize` round-trips; for `DELETE /api/filter/materialize` lifecycle DROPs.
- **DevTools Console** — for the proactive `expiresAt` mutation step (no UI surface).
- **DevTools StrictMode dev build** — `npm run dev` already runs in StrictMode (Vite default for React 18); UAT confirms no double-mount of OL Map / no blank-tile flash on filter clear.
- **Existing supertest coverage** — `kinetica_bi/server/tests/routes.filter.materialize.spec.ts` (Phase 13) covers POST + DELETE under both AUTH_MODE values with stubbed sessions. Phase 17 cites this; does not extend.
- **Existing vitest coverage** — Phase 14/15/16 specs (filterViewStore.spec.ts, WidgetRenderer.spec.tsx, MapChartRenderer.spec.tsx, wmsUrlBuilder.spec.ts, MapFilteringBadge.spec.tsx, viewExpiry.spec.ts, etc.) cover store + FROM-swap + LAYERS-swap + lifecycle reset. Phase 17 cites this; does not extend.
- **Total counts at Phase 17 start:** server ~337 supertest, frontend 332/332 vitest (per Phase 16 close). Phase 17 should leave both green; ideally identical counts (verification-only phase).

### Established Patterns

- **Verification artifact location:** `.planning/phases/<phase>/<padded>-VERIFICATION.md`. Phase 17 = `.planning/phases/17-verification/17-VERIFICATION.md`.
- **Walkthrough log style:** Narrative + per-criterion table (Phase 12 idiom). Mixed with frontmatter status maps (Phase 16 idiom).
- **Follow-up fixes during verification:** If UAT surfaces real bugs, fix inline with new commits + a "Follow-up Fixes Shipped During Verification" section in VERIFICATION.md (Phase 12 idiom). Phase 17 may produce 17-02-PLAN.md for in-phase gap closure (per Gap-handling protocol above).
- **Screenshot artifact convention:** No prior precedent; recommend `.planning/phases/17-verification/screenshots/` if committed. Filename pattern: `<flow>-<state>.png` (e.g., `map-filter-before.png`, `map-filter-after.png`).
- **Test fixture script (if committed):** `kinetica_bi/server/scripts/test-fixtures/<name>.sql` — convention is planner's call; no existing scripts/ subdirectory in repo. Operator-local only is the simpler default.
- **`commit_docs` workflow:** Per `gsd-tools.cjs init phase-op`, Phase 17 commits CONTEXT.md / VERIFICATION.md / STATE.md / ROADMAP.md / REQUIREMENTS.md updates as docs commits.

### Integration Points

- **Phase 17 produces zero new src/ code** in the happy path — verification-only. Planner does NOT touch:
  - Renderers (MapChartRenderer, WidgetRenderer)
  - Stores (filterStore, filterViewStore, dashboardLayersStore)
  - Endpoints (server/src/index.ts, kineticaSql, viewNaming, whereClause)
  - Components (DashboardsPage, App, FilteringBadge, MapFilteringBadge, LayersModal)
  - URL builders (wmsUrlBuilder)
  - Anti-pattern locks (V13-P-*, M-*, C-*, AP-*)
  - **EXCEPTION:** if UAT surfaces a real bug, an inline 17-NN-PLAN.md handles the fix per Gap-handling protocol.
- **Phase 17 produces these artifacts:**
  - `.planning/phases/17-verification/17-CONTEXT.md` (this file)
  - `.planning/phases/17-verification/17-RESEARCH.md` (planner-driven; optional)
  - `.planning/phases/17-verification/17-01-PLAN.md` (the verification plan)
  - `.planning/phases/17-verification/17-VERIFICATION.md` (THE deliverable)
  - `.planning/phases/17-verification/17-01-SUMMARY.md` (post-execution summary)
  - `.planning/phases/17-verification/screenshots/*.png` (optional, planner's discretion)
  - `kinetica_bi/server/scripts/test-fixtures/v13-filter-fixture.sql` (optional, planner's discretion)
- **Phase 17 updates these existing artifacts:**
  - `.planning/STATE.md` — Phase 17 progress + milestone-close prep
  - `.planning/ROADMAP.md` — Phase 17 status `[x]` + completed-on date
  - `.planning/REQUIREMENTS.md` — VERIFY-V13-01 + VERIFY-V13-02 status `Complete`
  - `.planning/PROJECT.md` — milestone close evolve (post `/gsd:audit-milestone`, not Phase 17 itself)

### Critical: existing convention notes (carry-forward)

- **No new code unless UAT-surfaced gap**: Phase 17 is verification-only. The Gap-handling protocol allows inline fix plans, but the default expectation is zero src/ touches.
- **Test fixture is temporary**: drop after VERIFICATION.md is written. The DDL/INSERT script (if committed to repo) is reference material, NOT auto-run by CI.
- **DevTools-driven proactive TTL test**: VERIFICATION.md must include the verbatim Console snippet so the test is reproducible later. Sample: `useFilterViewStore.getState().setView(<tableId>, { viewName: "<existing>", expiresAt: Date.now() - 1000, materializeVersion: <existing>, dashboardId: <existing> })`.
- **Manual DROP TABLE for reactive TTL test**: VERIFICATION.md must include the exact Kinetica SQL (e.g., `DROP TABLE _kbi_filt_uadmin_d3_t7_s1234abcd;`) — operator copies this for repeat runs.
- **Network tab as PASS evidence**: VERIFICATION.md prose references the URL substring (e.g., "WMS request URL contained `LAYERS=_kbi_filt_<...>&_mv=2` while filtered, `LAYERS=demo.fixture_v13` no `_mv` after Clear All").
- **Screenshots as PASS evidence**: VERIFICATION.md embeds (or links) before/after PNGs of the map widget. Side-by-side comparison closes Truth 1.
- **OIDC re-probe is NOT exercised**: explicit DEFERRED entry in VERIFICATION.md gaps section. Do NOT cite Phase 13 supertest mock coverage as substitute.

</code_context>

<specifics>
## Specific Ideas

- **One atomic plan, one milestone close** — explicit user choice. Verification phase has natural sequencing but no signature breaking change demanding multi-plan separation. Mirrors Phase 16's atomic-plan choice.
- **Fix UAT-surfaced bugs inline** — explicit user choice. Mirrors v1.2 Phase 12 follow-up-fixes pattern (e.g., commits `dfb12ca`, `d89769d`, `be5acc6`, `478d8d3`, `d7b84ab` shipped DURING verification). Bugs found during UAT are real bugs; fix and re-verify in the same phase.
- **Synthetic CREATE TABLE on Kinetica** — operator-controlled, reproducible from a script, full control over cardinality + spread. Avoids the v1.2 fixture problem (`demo.nyctaxi` density-masks filter visibility at city zoom).
- **Cardinality 5–10, ~500–2000 points, continental US** — sweet spot for naked-eye visibility. Each filter value owns ~10–20% of points; filtering removes a clearly visible chunk.
- **Temporary fixture, dropped after report** — explicit user choice. Keep Kinetica clean. Script (if committed) is the persistence; the DB row is ephemeral.
- **All 4 user flows + all 4 edge cases + all 8 chart types** — comprehensive UAT. The ~30-extra-minute cost is bought for full FROM-swap-across-renderers confidence.
- **Before/after screenshots required** — closes the v1.2 visual-evidence gap (TD-V12-04). Reproducible later from the committed PNGs.
- **DevTools mutate `expiresAt` for proactive TTL test** — explicit user choice. Sub-second test cycle vs 5-minute real wait. Document the verbatim console command in VERIFICATION.md.
- **Manual DROP TABLE for reactive TTL test** — explicit user choice. Closest to production behavior; tests the actual `isViewNotFoundError` regex match end-to-end. Document the verbatim Kinetica SQL in VERIFICATION.md.
- **Double-DROP for max-1-retry cap test** — explicit user choice. Exercises the `retryRef` pattern Phase 15 locked. Validates fall-through-to-raw-table-on-second-failure behavior.
- **Skip OIDC live re-probe; explicit DEFERRED in VERIFICATION.md** — explicit user choice. Be honest: the live probe wasn't run, no fallback evidence is fabricated. The deferred item is a single explicit gap.
- **Milestone tag = `passed`** — explicit user choice. Architectural separation: OIDC DDL is auth-deployment-readiness, not v1.3 feature scope. The pattern matches v1.0 / v1.1 deferred items (security-flagged TD-V11-03 doesn't block v1.1's `passed` close either).
- **Don't manufacture OIDC fallback evidence** — explicit user instruction. Do NOT cite Phase 13 supertest mock coverage in lieu of the live probe. Treat as a real gap with milestone-close-acceptable severity.

</specifics>

<deferred>
## Deferred Ideas

- **OIDC S2.b live DDL re-probe against deployed Kinetica with OIDC trust** — DEFERRED to v1.3 production-deploy gate / v1.3.1 / a separate auth-deployment-readiness audit. NOT manufactured as Phase 13 supertest mock coverage. Tracked as a single-line known-gap in VERIFICATION.md and PROJECT.md backlog.
- **Permanent test fixture in repo + auto-loaded by CI / dev-startup** — out of scope for Phase 17. Fixture is temporary; DDL script (if committed) is reference material only. Future improvement: a test-fixtures setup script that boots a low-card spread fixture for any local dev / vitest integration test.
- **Automated WMS tile pixel-byte diff** — out of scope. Visual screenshot evidence is sufficient. Future investment: headless OL+Kinetica probe that asserts byte-difference on filter activation. Useful for regression testing but disproportionately complex for v1.3 close.
- **`bumpMaterializeVersion` action removal** — flagged for tech-debt cleanup at Phase 17 close. No caller emerged across Phases 14/15/16 (Phase 14 ships the action; Phase 15 doesn't use it; Phase 16 doesn't use it because `setView` auto-bump covers cache-bust). VERIFICATION.md notes the dead action; removal is a separate cleanup commit (not Phase 17 scope).
- **`widget.config.layerName` legacy fallback removal** — flagged for tech-debt cleanup. Phase 16 left it as-is; Phase 17 inherits the deferral. Removal is a separate cleanup commit.
- **V13-LIMIT-01 (records-table-only on tableId X) gap-closure** — accepted limitation per Phase 15 lock. Phase 17 *observes* and *documents* but does not *fix*. Future scope only if UAT shows users hit it routinely.
- **Map-only on tableId X (parallel to V13-LIMIT-01) gap-closure** — accepted limitation per Phase 16 lock. Phase 17 observes + documents. Future scope.
- **Phase 11 single-WMS widget shape walkthrough** — `.widget-map-reconfigure` overlay (Phase 12 LAYER-12 hard cutover) is not exercised in Phase 17 UAT. Existing widgets matching that shape are out of v1.3 verification scope.
- **`TESTING.md` codebase map refresh** — currently stale (pre-vitest). Phase 17 does not refresh; future codebase-map regen via `/gsd:map-codebase`.
- **Vite proxy entry for `/api → :4000`** — TD-V11-01; pre-existing v1.1 deferral. Not Phase 17 scope.
- **Pre-deploy security-flagged item TD-V11-03** (RFC 9207 iss-check workaround in `oidc.ts`) — not Phase 17 scope; tracked separately as production-deploy gate.
- **`/gsd:audit-milestone` execution itself** — Phase 17 produces VERIFICATION.md as input to milestone audit; the audit run + PROJECT.md milestone evolve happens AFTER Phase 17 closes. Recommended next-step: `/gsd:audit-milestone` after Phase 17 SUMMARY commits.
- **Multi-tab same-user same-session last-write-wins exercise (V13-P-09)** — accepted pitfall. Phase 17 may spot-check via two browser tabs but doesn't gate on it; UAT-optional.
- **`aria-busy` / a11y polish observations** — Phase 15/16 left as Claude's Discretion; Phase 17 may surface findings as side-notes in VERIFICATION.md but doesn't gate on a11y per phase scope.
- **Filter persistence across page refresh / shareable filter URLs / filter snapshots** — explicitly v2 / out-of-scope per REQUIREMENTS.md "Out of Scope" table. Phase 17 must not chase these even if a user mid-UAT asks "wouldn't it be nice if...".
- **`bumpMaterializeVersion` callers for reactive WMS recovery** — explicitly rejected in Phase 16 discussion. Phase 17 does not revisit.

</deferred>

---

*Phase: 17-verification*
*Context gathered: 2026-05-07*
