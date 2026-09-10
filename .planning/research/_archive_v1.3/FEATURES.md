# Feature Research: v1.3 Unified Dashboard Filtering

**Domain:** Server-side materialized-view filtering for a Kinetica-backed BI dashboard
**Researched:** 2026-05-06
**Confidence:** HIGH for feature categories and UX patterns (well-established BI tool conventions); MEDIUM for Kinetica-specific interaction behavior (some requires operator spike — see STACK.md S1–S4)

---

## Scope Boundary

v1.2 shipped: `useFilterStore`, drill-down click handlers on all 6 chart types, filter bar with chips + dismiss + Clear All, per-Cell `fillOpacity` dim-peers, `widget-table-row-active` row-tint, ImageWMS N-layer maps, dashboard-switch + logout reset.

v1.3 adds ONLY what server-side materialized views enable or require. This research covers those new surfaces exclusively. Everything from v1.2 is carried forward unchanged unless explicitly reworked.

---

## Feature Landscape

### Table Stakes (Users Expect These)

Features that users of a BI drill-down tool assume will work. Missing = product feels broken.

| Feature | Why Expected | Complexity | v1.2 Dependency | Notes |
|---------|--------------|------------|-----------------|-------|
| **Per-widget loading indicator during materialize** | Every BI tool (Tableau, Looker, Superset, Metabase) shows a per-widget spinner while a query executes. With v1.2's client-side WHERE, the loading state already existed (`setLoading(true)` in `AggregatedWidgetRenderer`). v1.3 adds a server round-trip (materialize) before the chart query — users will notice a ~200ms–2s gap where charts show stale data with no feedback. They expect a visible "working" state. | LOW | `AggregatedWidgetRenderer` `loading` state already exists; extend to cover materialize phase | Dual-phase loading: (1) materialize in-flight, (2) chart query in-flight. Both must be covered. |
| **Filter chips stay visible during materialize** | The filter bar must not disappear or reset when a materialize is in progress. Users expect the chip to appear immediately on click, then charts update afterward. v1.2 already does this (chip appears from `addFilter` dispatch; chart reload is async). | LOW | v1.2 filter bar chip rendering unchanged | Chips come from `useFilterStore.filters`, not from server state — no change needed here. |
| **Charts update to filtered data after materialize** | Core value proposition of the feature. Charts and maps must re-render using view-scoped data, not raw table data, when a filter is active. This is the primary reason v1.3 exists — v1.2's WHERE injection worked for charts but not maps. | MEDIUM | `AggregatedWidgetRenderer` FROM-swap replaces `injectWhereClause`; `MapChartRenderer` LAYERS-swap replaces QUERY param | The FROM-swap is simpler and safer than WHERE injection: no SQL regex parsing, no escaping. |
| **Map tiles narrow to filtered data** | v1.2 maps never filtered (TD-V12-01 — QUERY param had no effect). Users who added a bar chart filter and saw the map unchanged will consider this broken until v1.3 fixes it. The expectation is already set by v1.2 shipping the feature incompletely. | MEDIUM | Closes TD-V12-01; replaces `wmsUrlBuilder.ts` QUERY/`_v` params with LAYERS view-name swap | Dependent on STACK.md Spike S1: WMS LAYERS must accept view names. |
| **Silent re-materialize on TTL expiry** | Standard pattern in Tableau and Looker: if a session-scoped cache expires and the user clicks something, the tool re-runs the query silently. Users do not expect to see an error for a server-side expiry they had no control over. Hard errors on expiry are a UX regression — the user's filter is still visible in the chip bar, which makes a data error confusing. | MEDIUM | Uses existing `AbortController` pattern from v1.2; adds optimistic `expiresAt` timestamp tracking (see STACK.md recommendation) | Optimistic `expiresAt` check before each chart query is simpler than reactive error handling. |
| **No-filter state uses raw table (no overhead)** | When no filters are active, every BI tool queries the source table directly — no intermediate layer. The v1.3 architecture locks this: `filters === []` → skip materialize, use raw table. Violating this would add latency on zero-filter dashboard loads, which users would notice. | LOW | `clearFilters` path in `useFilterStore` already fires; v1.3 adds DROP TABLE on clear | Server must DROP the view on `clearFilters`; client must revert `FROM <view>` back to `FROM <table>`. |
| **Multiple filters on the same table AND across tables** | v1.2 already supports multi-filter (10-cap per table, `Record<tableId, ActiveFilter[]>`). v1.3 must not regress this. Each `(user, session, dashboard, table)` tuple gets its own view — two tables on one dashboard get two views. | LOW | `useFilterStore` `Record<number, ActiveFilter[]>` shape unchanged; one view per tableId | View name includes `tableId` component (`_kbi_filt_u<u>_d<d>_t<t>_s<s>`). |
| **Clear All resets to raw table with no latency** | Clearing all filters must immediately revert charts to full-table queries. The user taps Clear All, chips disappear, and charts reload from the raw table — not from a lingering view. | LOW | `clearFilters` dispatch unchanged; v1.3 adds server `DROP TABLE IF EXISTS <viewName>` | DROP is fire-and-forget on the client (don't block chart reload waiting for DROP to confirm). |

### Differentiators (What View-Based Filtering Unlocks)

Features that are not possible (or not correct) with v1.2's client-side WHERE injection. These are the reasons v1.3 is worth building.

| Feature | Value Proposition | Complexity | v1.2 Dependency | Notes |
|---------|-------------------|------------|-----------------|-------|
| **Map tile filtering actually works** | v1.2 attempted WMS QUERY-based map filtering and it silently failed. v1.3's LAYERS swap to a materialized view is the architecturally correct approach for Kinetica WMS — the server renders tiles from whatever object is named in LAYERS. Users can now click a bar chart slice and see the map zoom to only the matching points. This closes the most visible v1.2 gap. | MEDIUM | Extends `MapChartRenderer` Effect 3; removes QUERY/`_v` from `wmsUrlBuilder.ts` | Requires Spike S1 to be run before Phase 1 lock. |
| **Big-Number widgets show filtered totals correctly** | With v1.2's WHERE injection, `SELECT COUNT(*) FROM table WHERE pickup_zone = 'East Village'` works. But if a query has subqueries, CTEs, or complex aggregations, WHERE injection can fail or produce wrong results. With v1.3's FROM swap, the widget's existing SQL runs unchanged against a view that IS the filtered dataset — `SELECT COUNT(*) FROM _kbi_filt_u1_d2_t3_s4abc` is always correct regardless of SQL complexity. | LOW | `AggregatedWidgetRenderer` BigNumber renderer unchanged; only SQL source changes | This is a correctness gain, not a new feature — but users notice when numbers are wrong. |
| **Aggregations on the filtered set are server-side** | v1.2 queries the raw table with a WHERE clause and lets Kinetica do the aggregation in one pass. v1.3 is equivalent (the view's WHERE runs at materialize time; subsequent queries run against the view). The difference: the filter is guaranteed correct even for queries that v1.2's `injectWhereClause` regex could mis-handle (e.g., queries with an existing WHERE clause, or subqueries). | LOW | Dead code deleted: `injectWhereClause`, `buildWhereClause`, `escapeKineticaStringLiteral`, `buildEqualityFilter` | Correctness gain. Users on complex query widgets were silently getting wrong results with v1.2. |
| **Filter state survives widget re-configuration** | With v1.2, clearing/changing a widget's SQL would change the injected WHERE targets. With v1.3, the view is table-scoped — any widget pointing at the same table automatically benefits from the same view. Users can edit a widget's config without losing the active filter context. | LOW | `useFilterStore` is already table-keyed; v1.3 extends this to the view name being table-keyed too | No new user-facing feature — just a correctness improvement that prevents confusing filter loss. |
| **Materialize loading state is distinguishable from query loading** | When a materialize takes 1–2s (large table, complex filter expression), users should know the system is "processing" rather than seeing a blank chart. A subtle "filtering..." badge or spinner on affected widgets distinguishes "view is being built server-side" from "chart is loading data". This pattern is used by Looker's "refreshing" badge on tiles that are re-running queries. | MEDIUM | `AggregatedWidgetRenderer` has a `loading` boolean state; needs a `materializing` boolean state added | This is a UX upgrade over v1.2 which showed the same "Loading..." for all states. |
| **Separate filter views per concurrent user** | Two data engineers on the same dashboard each get their own view — `(userId, sessionId, dashboardId, tableId)` composite key means their filter states never cross. v1.2's WHERE injection was already per-user (client-side state is never shared), but maps were broken. v1.3 makes this correct end-to-end including maps. | LOW | v1.2 `useFilterStore` was already client-local; v1.3 adds server isolation for views | Not a visible user-facing feature, but a correctness guarantee that prevents production incidents. |

### Anti-Features (Explicitly Excluded from v1.3)

Features that seem like natural extensions of materialized-view filtering but should be deferred. Each has a specific rationale.

| Feature | Why It Seems Desirable | Why Excluded from v1.3 | What to Do Instead | Complexity if Built |
|---------|------------------------|------------------------|-------------------|---------------------|
| **Shareable filter URLs (encode active filters in query string)** | Analysts want to share a filtered view with colleagues — "look at just East Village pickups". Seems natural alongside server-side views that already persist for 5 minutes. | Filter state is tied to `sessionId` — the view name includes the session component, so a URL with encoded filter params would create a new view for the recipient under their session anyway. Implementing shareable state requires: (1) URL encoding of filter params, (2) on-load filter restoration, (3) re-materialize on first page load, (4) handling expired or permission-mismatched URLs. This is a v2 feature requiring its own architecture. | Defer to v2. Users can screenshot or share the filter bar chip text verbally. | HIGH |
| **Filter state persistence across page refresh** | Users lose filters on F5. Seems annoying, especially if materialization takes 1–2s to rebuild. | The view expires in 5 minutes of inactivity (sliding TTL). Persisting filter state in `localStorage` or `sessionStorage` would require: (1) serialization of `ActiveFilter[]` per table, (2) re-materialize on mount, (3) handling the case where the persisted filter references a column that no longer exists. This is disproportionate complexity for v1.3. The audience is internal data engineers who understand session concepts. | Defer to v2. The 5-minute sliding TTL means active users keep their views alive; only idle users lose state on refresh, which is acceptable. | MEDIUM |
| **Undo/Redo for filter changes** | Power users want to step back through filter history ("undo the pickup_zone filter"). Undo/redo is a common ask in Excel-like tools. | Undo requires a filter history stack. Each undo fires a new materialize. This is straightforward conceptually but requires careful state management (history stack in Zustand, each entry being a full `Record<tableId, ActiveFilter[]>` snapshot). It is not a blocker for v1.3's core goal — making filtering correct. | Defer to v2. The filter bar's × dismiss and Clear All are sufficient for v1.3. Users can re-click different elements. | MEDIUM |
| **Cross-dashboard filter inheritance** | "Apply my current filter to the other dashboard I switch to." Multi-dashboard filter propagation. | The `useFilterStore.reset()` on dashboard switch is an intentional design decision locked in v1.2. Cross-dashboard filter inheritance would require global (not dashboard-scoped) filter state, which creates ambiguous UX when dashboards have different table associations. Reversing the reset decision mid-stream would be a significant scope expansion. | Defer to v2 if the team finds the dashboard-switch reset frustrating in practice. | HIGH |
| **Persistent filter snapshots (saved filter sets)** | "Save this filter combination as 'Morning Rush' for future use." | Requires: named filter set storage in SQLite, a Save Filter UI, a Load Filter UI, and materialize-on-load. This is essentially a "view management" feature that is outside v1.3's transient-view scope. Saved, named views already partially exist in the pre-v1.3 `dashboard_table_views` SQLite table (the persisted view CRUD workflow) — but integrating the two models needs deliberate design. | Defer to v2. The existing persisted views infrastructure (`POST /api/views/:id/materialize`) already handles durable views — connect the two in v2. | HIGH |
| **Filter expiry toast / countdown** | Show "Your filter expires in 4:30" or a toast when the view is about to expire. | The 5-minute sliding TTL means views expire only on user inactivity. An active user querying charts will never see the view expire. A countdown for idle users adds UI complexity (timer component, expiry state) for a state the user will not encounter in normal use. Silent re-materialize on the next filter event is the correct handling for edge cases. | No replacement needed. Implement silent re-materialize (table-stakes item above). | MEDIUM |
| **Materialize progress bar (% complete)** | For very large tables (>100M rows), a 1–2s materialize might take 5–10s. A progress indicator would reassure users. | Kinetica's `CREATE OR REPLACE MATERIALIZED VIEW` is a synchronous DDL statement — the SQL proxy blocks until Kinetica returns. There is no incremental progress signal from Kinetica's HTTP API. A fake progress bar (like GitHub's old top bar) would require careful calibration and still be misleading. | A simple "filtering..." spinner per widget is sufficient for v1.3. If materialize latency becomes a real problem (>3s regularly), optimize the DDL or add a streaming endpoint in v2. | HIGH |
| **View warm-up / pre-materialize on dashboard load** | Pre-build views for "likely" filters when the dashboard opens, to reduce first-click latency. | Predicting which filters users will apply requires either ML or query history. Without prediction, pre-materializing all possible column values for all tables on dashboard load would be prohibitively expensive. | No replacement. Accept that the first filter click after a cold dashboard load incurs the materialize latency. 200ms–2s is acceptable for a deliberate user action. | HIGH |

---

## Feature Dependencies

```
[TTL expiry detection] ──requires──> [optimistic expiresAt timestamp from materialize endpoint]
                                          └──requires──> [POST /api/filter/materialize returns expiresAt]

[Map tile filtering works] ──requires──> [Spike S1: WMS LAYERS accepts view name]
                                              └──requires──> [operator verification against deployed Kinetica]

[FROM-swap in chart queries] ──requires──> [useFilterViewStore: { [tableId]: viewName | null }]
                                                └──requires──> [materialize endpoint returns viewName]

[Silent re-materialize on expiry] ──requires──> [expiresAt in filterViewStore]
                                                     └──requires──> [FROM-swap logic checks expiresAt before query]

[No-filter state reverts to raw table] ──requires──> [clearFilters drops view server-side]
                                                           └──requires──> [DELETE /api/filter/materialize or filters:[] convention]

[v1.2 carryover: dim-peers, row-tint, chips] ──unchanged──> [no dependency on v1.3 view mechanism]

[Dead code deletion] ──conflicts-with──> [v1.2 AggregatedWidgetRenderer injectWhereClause path]
    (injectWhereClause, buildWhereClause, escapeKineticaStringLiteral, buildEqualityFilter)
    └── These cannot coexist with v1.3 FROM-swap. Deletion is atomic with FROM-swap landing.
```

### Dependency Notes

- **TTL expiry detection requires expiresAt from the server:** The client cannot know Kinetica's TTL expiry without the server telling it when the view was created. The materialize endpoint must return `{ viewName, expiresAt: number }` (epoch ms). The client stores `expiresAt` in `useFilterViewStore` alongside `viewName` and checks it before issuing chart queries.

- **Map tile filtering requires Spike S1 to pass:** If `LAYERS=<view_name>` does not work in Kinetica WMS, the map filtering feature cannot ship in v1.3. The spike must be run before Phase 1 is locked. If S1 fails, map filtering becomes a v2 item and maps revert to unfiltered tiles (which is the v1.2 status quo — not a regression).

- **Dead code deletion is atomic with FROM-swap:** `injectWhereClause` and the new FROM-swap are mutually exclusive filter paths. Both cannot exist simultaneously without introducing a branching condition that would be confusing and fragile. The deletion must happen in the same phase as the FROM-swap introduction.

- **useFilterViewStore (new) pairs with useFilterStore (existing):** `useFilterStore` holds `{ [tableId]: ActiveFilter[] }` — the user's filter intent. `useFilterViewStore` (new in v1.3) holds `{ [tableId]: { viewName: string, expiresAt: number } | null }` — the server's materialized view state. These are two separate slices. `useFilterStore` drives when to materialize; `useFilterViewStore` drives what name to put in FROM/LAYERS.

---

## Filter UX Lifecycle: State Machine

This documents the full lifecycle that v1.3's features must cover, as a state machine. Roadmap phases should map to these states.

```
STATE: Unfiltered
  - Charts query FROM <raw_table>
  - Maps render LAYERS=<raw_table>
  - Filter bar: hidden
  - viewName in useFilterViewStore: null

  EVENT: user clicks chart element
    → dim-peers transient (v1.2 fillOpacity, unchanged)
    → chip appears in filter bar (useFilterStore.addFilter, unchanged)
    → debounce timer starts (300ms, same as v1.2 LayersModal pattern)

  TRANSITION: Unfiltered → Materializing

STATE: Materializing
  - Charts show "filtering..." indicator (new in v1.3)
  - Maps show "filtering..." indicator (new in v1.3)
  - Filter bar: chip visible (already rendered)
  - viewName in useFilterViewStore: null (materialize not complete yet)

  EVENT: debounce fires, POST /api/filter/materialize returns { viewName, expiresAt }
    → useFilterViewStore.setView(tableId, { viewName, expiresAt })

  TRANSITION: Materializing → Filtered

  EVENT: materialize fails (Kinetica permission error or upstream error)
    → show error toast "Filter could not be applied"
    → remove chip from useFilterStore
    → remain in Unfiltered state

STATE: Filtered
  - Charts query FROM <viewName>
  - Maps render LAYERS=<viewName>
  - Filter bar: chip(s) visible
  - viewName in useFilterViewStore: non-null with expiresAt

  EVENT: user clicks another chart element (same or different column/table)
    → useFilterStore.addFilter (replace or append)
    → debounce fires again
    → new POST /api/filter/materialize with all current filters
    → TRANSITION: Filtered → Materializing (then back to Filtered)

  EVENT: user clicks × on chip (removeFilter) or Clear All (clearFilters)
    → useFilterStore.removeFilter / clearFilters
    → if filters now empty: DELETE /api/filter/materialize (fire-and-forget)
    → useFilterViewStore.clearView(tableId)
    → TRANSITION: Filtered → Unfiltered

  EVENT: expiresAt reached (detected before next chart query)
    → re-POST /api/filter/materialize silently
    → TRANSITION: Filtered → Materializing (then back to Filtered)

  EVENT: chart query returns Kinetica "table not found" error (view already expired)
    → catch error, clear viewName from useFilterViewStore
    → re-materialize immediately (no user prompt)
    → TRANSITION: Filtered → Materializing

  EVENT: user switches dashboard
    → useFilterStore.reset() (unchanged from v1.2)
    → useFilterViewStore.reset()
    → fire-and-forget DELETE for any active views
    → TRANSITION: Filtered → Unfiltered

  EVENT: user logs out
    → useFilterStore.reset() (unchanged from v1.2)
    → useFilterViewStore.reset()
    → fire-and-forget DELETE for any active views
    → TRANSITION: Filtered → Unfiltered

  EVENT: page refresh (F5)
    → All client state lost (useFilterStore, useFilterViewStore reset to defaults)
    → View in Kinetica persists until 5-min TTL expires (TTL is sliding — view is idle, will expire)
    → TRANSITION: Filtered → Unfiltered (client-side); view drops naturally in Kinetica

  EVENT: browser tab close
    → Same as page refresh — no cleanup needed
    → View drops via Kinetica TTL
    → No client-side lifecycle hook needed
```

---

## In-Flight Indicator: What To Show (BI Tool Patterns)

**Research basis:** Tableau, Looker, Superset, and Metabase all follow the same basic pattern for server-side query execution UX. Confidence: HIGH (well-documented from training data; cross-validated against observed tool behavior).

### The Pattern

All major BI tools apply indicators per widget, not page-level. A page-level spinner (full overlay) is used only for initial dashboard load, not for incremental filter changes. The rationale: users want to see which widgets are affected by the filter, and they want to see that the un-affected widgets are still readable.

**Tableau:** Shows a loading spinner overlay on each view (worksheet) that is re-querying. The view maintains its previous data visible under the spinner (stale data + spinner). This is the "stale data with refreshing badge" pattern.

**Looker:** Shows a spinning indicator on each tile's top-right corner while the query runs. Tile content stays visible (stale). Once the query completes, the tile swaps to new data. Looker also has a "Running" label in the filter bar.

**Superset:** Shows a per-chart loading skeleton (gray animated placeholder) that replaces chart content during loading. This is the "blank slate" pattern — stale data is NOT shown; charts go blank, then fill.

**Metabase:** Shows a spinner overlay on each card while re-querying. Stale data visible behind the spinner.

### Recommendation for v1.3

Use **stale data + per-widget "filtering..." overlay** (Tableau/Looker pattern), not Superset's blank skeleton.

Rationale:
1. The v1.2 code currently replaces chart content with a full "Loading..." placeholder (Superset pattern). This means charts go blank on every filter — the user cannot see what the previous data was while waiting. For v1.3's 200ms–2s materialize window, showing stale data is more informative.
2. Two visual phases: (a) "filtering..." during materialize (new) and (b) "loading..." during chart query (existing). These can be unified as a single overlay with different text, or handled as one `materializing || loading` boolean.
3. For maps: OpenLayers ImageWMS naturally shows the previous tile while the new tile loads. No additional spinner needed for maps beyond the existing loading state.

**Simplest correct implementation:** Add a `materializing` boolean to `useFilterViewStore` per tableId. When `materializing === true`, show a `"filtering..."` badge in the widget card header (not a full overlay — the chart content stays visible beneath it). When the materialize completes and the chart re-queries, the existing `loading` boolean covers the chart query phase.

---

## TTL Expiry UX: Recommendation

**Pattern context:** The 5-minute sliding TTL means a view expires only if the user has been idle for 5 minutes. An active analyst clicking charts every 30 seconds will never hit expiry. The expiry case is: user opens dashboard, applies filter, gets called into a meeting, comes back 10 minutes later, and clicks something.

**Recommended behavior:**
1. Optimistic expiry check before each chart query: `if (Date.now() >= expiresAt) → re-materialize first`.
2. Reactive catch: if a chart query returns "table not found" (view already expired), catch that specific error, re-materialize, then retry the query.
3. No user-facing message for either path — silent re-materialize, same as how Tableau handles cache expiry.
4. The filter chips stay visible throughout — the user's filter intent (in `useFilterStore`) is never wiped by a server-side expiry event.

**Do not show:** A countdown timer, an expiry toast, or a "filter expired" error. These patterns appear in some older enterprise BI tools (Business Objects, older SSRS) and are widely considered UX regressions. Modern tools handle expiry silently.

---

## New State Reset Triggers (v1.3 Introduces These)

v1.2 had two reset triggers: dashboard switch + logout. v1.3 adds new implicit triggers from the server-side state model.

| Trigger | Client Action | Server Action | User Sees |
|---------|---------------|---------------|-----------|
| Dashboard switch | `useFilterStore.reset()` + `useFilterViewStore.reset()` | Fire-and-forget DELETE for active views | Filter bar clears, charts reload from raw table |
| Logout | `useFilterStore.reset()` + `useFilterViewStore.reset()` | Fire-and-forget DELETE for active views | Same as v1.2 |
| Page refresh (F5) | All stores reset on mount | No explicit DROP needed — view expires via Kinetica TTL | User returns to unfiltered state; view self-cleans in Kinetica |
| Browser tab close | All stores reset (tab context destroyed) | No explicit DROP needed — TTL handles cleanup | No action needed |
| 5-min idle (new) | No client action needed | Kinetica auto-drops the view | User sees stale-but-correct charts until next filter interaction, which triggers re-materialize |
| Kinetica restart (hypothetical) | Views are in-memory in Kinetica — restart drops all views | No explicit client action | Same as idle expiry — re-materialize on next filter event |

**Key insight:** Page refresh and tab close do NOT need explicit server-side cleanup code. Kinetica's TTL is the authoritative cleanup mechanism for orphaned views. The server does not need to track which views are active in SQLite — view names are deterministically computable from `(userId, sessionId, dashboardId, tableId)`. The in-memory approach from STACK.md (optional server-side Map for the session) is sufficient.

---

## Concurrent User Behavior: v1.3 Scope

v1.2 confirmed: separate views per user (view name includes `userId` + `sessionId` components). Two engineers on the same dashboard get completely isolated filter states.

**For v1.3, this means:**
- Shareable filter URLs are NOT needed (confirmed anti-feature above — different sessions get different views)
- Dashboard URL has no filter state encoded — navigating to the URL always starts unfiltered
- This is the correct behavior for an internal team BI tool; it is not a limitation to document as a gap

**v2 considerations (not for v1.3):**
- Shareable filter state would require encoding filter params in the URL (not view names) and re-materializing on the recipient's session load
- Dashboard bookmarks with saved filter sets would use the existing persisted views infrastructure

---

## MVP Definition for v1.3

### Must Ship (Closes v1.2 Gaps + Enables Correct Filtering)

- [x] `POST /api/filter/materialize` endpoint: create-or-replace view scoped to `(userId, sessionId, dashboardId, tableId)` with `TTL = 5`; return `{ viewName, expiresAt }`
- [x] `DELETE /api/filter/materialize` endpoint: drop view on clearFilters; fire-and-forget on dashboard switch / logout
- [x] `useFilterViewStore` Zustand slice: `{ [tableId]: { viewName, expiresAt, materializing } | null }`
- [x] `AggregatedWidgetRenderer`: FROM-swap using `viewName`; `materializing` loading phase; optimistic `expiresAt` check
- [x] `MapChartRenderer`: LAYERS-swap using `viewName` when filtered; QUERY + `_v` params removed from `wmsUrlBuilder.ts`
- [x] Dead code deletion: `injectWhereClause`, `buildWhereClause`, `escapeKineticaStringLiteral`, `buildEqualityFilter` (all in `filterStore.ts`; verify no other callers before deletion)
- [x] Per-widget "filtering..." indicator during materialize phase (visual badge or text, not full overlay)
- [x] Silent re-materialize on TTL expiry (optimistic + reactive fallback)
- [x] Test fixture for filter visual verification (low-cardinality / spatially-spread dataset — closes TD-V12-04)

### Deferred to v2 (Out of Scope — see Anti-Features)

- Shareable filter URLs
- Filter state persistence across page refresh
- Undo/redo filter history
- Cross-dashboard filter inheritance
- Saved/named filter sets
- Materialize progress bar
- View warm-up / pre-materialize

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Map tile filtering via LAYERS swap | HIGH (closes v1.2 visible gap) | MEDIUM | P1 |
| FROM-swap in chart queries | HIGH (correctness for all charts) | MEDIUM | P1 |
| Per-widget materializing indicator | MEDIUM (UX feedback during 200ms–2s wait) | LOW | P1 |
| Silent re-materialize on TTL expiry | MEDIUM (prevents mysterious errors) | MEDIUM | P1 |
| No-filter state uses raw table | HIGH (performance on cold load) | LOW | P1 |
| Dead code deletion (injectWhereClause etc.) | MEDIUM (code hygiene, prevents future confusion) | LOW | P1 |
| useFilterViewStore Zustand slice | HIGH (enables all v1.3 features) | LOW | P1 |
| Separate server endpoint (POST /api/filter/materialize) | HIGH (core primitive) | MEDIUM | P1 |
| Test fixture for verification | MEDIUM (closes TD-V12-04, enables visual QA) | LOW | P1 |
| Shareable filter URLs | LOW (internal tool, team doesn't share filters today) | HIGH | P3 |
| Undo/redo | LOW (Clear All + dismiss covers most cases) | MEDIUM | P3 |
| Cross-dashboard filter inheritance | LOW (reset-on-switch is correct UX for this tool) | HIGH | P3 |

---

## Sources

- Codebase: `kinetica_bi/src/store/filterStore.ts` — v1.2 filter state model, dead code targets identified
- Codebase: `kinetica_bi/src/components/charts/WidgetRenderer.tsx` — v1.2 `AggregatedWidgetRenderer` loading/error state pattern; FROM-swap integration point
- `.planning/PROJECT.md` — v1.3 locked architecture, target features, dead code list
- `.planning/MILESTONES.md` — v1.2 deliverables (carryover), TD-V12-01 / TD-V12-04 scope
- `.planning/research/STACK.md` — Kinetica DDL syntax, TTL semantics (sliding, minutes), spike requirements S1–S4
- Tableau filter UX patterns — per-view spinner + stale data (training data, HIGH confidence for general pattern)
- Looker tile query UX patterns — per-tile refreshing indicator (training data, HIGH confidence for general pattern)
- Superset chart loading UX patterns — per-chart skeleton placeholder (training data, HIGH confidence for general pattern)
- BI tool expiry handling conventions — silent re-query, no countdown timer (training data, HIGH confidence for principle)

---
*Feature research for: Kinetica BI v1.3 Unified Dashboard Filtering*
*Researched: 2026-05-06*
