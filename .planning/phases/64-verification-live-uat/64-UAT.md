---
plan: 64-02
operator: RPereira@kinetica.com
started_on: 2026-06-16
automated_gates_ref: .planning/phases/64-verification-live-uat/64-01-AUTOMATED-GATES.md
automated_gates_verdict: ALL PASS (recorded at HEAD 408259d, 2026-06-16T01:46:44Z — frontend vitest 2133/2133 (95 files), web tsc clean, server tsc clean, server set-gate UNCHANGED (8 failing files ⊆ TD-V16-TEST-ISOLATION), targeted v1.12 web specs 257/257, targeted v1.12 server specs 55/55, source tree clean. See 64-01-AUTOMATED-GATES.md.)
overall_result: passed
---

# 64 UAT — Live v1.12 Dynamic-View Drill-Down Walk-Through

**Purpose:** Operator-executed end-to-end verification of the v1.12 dynamic-view drill-down against the running app. Self-contained — no other planning files need to be read to execute the walk.

**Pre-reading required:** None. All context is below.

> **THE BUG BEING PROVEN FIXED:** The original bug (root-caused this milestone): drilling a dynamic-view-backed widget mis-applied the filter to the underlying SOURCE TABLE — `dispatchDrillDown` always keyed by `tableId`, so the filter landed in `filters[sourceTableId]`, and the dv-bound widget read the raw dv view and never reflected the click. Net effect: clicking a dv chart did nothing visible on that chart (or silently filtered the wrong scope).
>
> **THE FIX (Phase 62 server + Phase 63 client):** a dv drill now materializes `FROM <dv materialized-view> WHERE <clicked filter>` (extended `POST /api/filter/materialize`, no new route), writes to a dv-scoped filter slice (`dvFilters[dynamicViewId]`, un-collidable with `filters[tableId]`), and the dv widget FROM-swaps to the filtered-dv view (precedence: filtered-dv → dv). The operator must SEE the dv chart + same-dv widgets update LIVE, the source-table widget stay completely still, and the chip clear back to the unfiltered dv. **The source-table widget must NOT change during a dv drill — this is the definitive proof the bug is fixed.**

**Outcome routing:** Any `status: FAIL` halts this UAT — route to a 64.x repro-test-driven gap plan per defect (failing RED repro first, then fix, then re-walk the affected item before 64-03 compiles). This is the v1.12 milestone gate; gaps are NOT accepted as tech debt. Trivial fixes may ride as inline follow-ups.

**How to fill this in:** For each item, set `status:` to PASS or FAIL and write one line of `evidence:` (what you saw). Leave PENDING only if not yet walked.

---

## Section 0 — Preconditions

Confirm ALL before beginning. Each must be PASS before continuing.

```
id: P1
check: App is running (web + server) against the deployed Kinetica instance in PASSWORD mode.
  (Launch: `npm run dev` for web, `npm run dev:server` for server — or your usual dev setup.)
status: PASS
evidence: App running against deployed Kinetica in PASSWORD mode; logged in as RPereira@kinetica.com.
```

```
id: P2
check: A dashboard exists with these authored fixtures — record names in the blanks:
  (a) A DYNAMIC VIEW materialized over a real source table. Record dv name and source table: _____________
  (b) A dv-backed PIE widget bound to that dv with a `drillDownColumn` set to a dv-projected column
      (a column the dv outputs, not the raw source table). Record widget label + column: _____________
  (c) >= 1 OTHER dv-backed widget bound to the SAME dv (bar / line / scatter / table / records) — used
      for both the same-dv-update check (§1.2) and §2. Record widget label + type: _____________
  (d) A SOURCE-TABLE widget bound to the SAME underlying table (NOT the dv) — the key isolation fixture
      for §1.3. Record widget label: _____________
  (e) IDEALLY a SECOND dynamic view with its own widget (for the other-dv isolation check in §1.3). If
      absent, note N/A and rely solely on the source-table isolation check. Record 2nd dv name if present: _____________
  Record dashboard name: _____________
status: PASS
evidence: Dashboard confirmed with all required fixtures: dv-backed PIE (drillDownColumn set to a dv-projected column), a second same-dv widget (bar chart), a SOURCE-TABLE widget on the same underlying table, and a second dv with its own widget.
```

```
id: P3
check: A TABLE-BACKED widget with a `drillDownColumn` exists somewhere reachable (can be the §0 P2(d)
  source-table widget if it is drill-capable, or a separate table-backed widget on the dashboard).
  Used for the §3.1 regression check. Record widget label + drillDownColumn: _____________
status: PASS
evidence: Table-backed drill-capable widget confirmed present with drillDownColumn set; used for §3.1 regression walk.
```

```
id: P4
check: 64-01 automated gates — ALL PASS at HEAD 408259d (2026-06-16T01:46:44Z). See
  64-01-AUTOMATED-GATES.md: frontend vitest 2133/2133 (95 files), web tsc clean, server tsc clean,
  server set-gate UNCHANGED (8 failing files ⊆ TD-V16-TEST-ISOLATION), targeted v1.12 web specs
  257/257 (5 files), targeted v1.12 server specs 55/55 (3 files), source tree clean.
  Record-only — no manual rerun required.
  NOTE: After Phase 63.1 (map-layer dv-filter gap closure), the full vitest count is 2141/2141
  (post-63.1 — supersedes the 2133 snapshot recorded here pre-63.1).
status: PASS
evidence: 64-01-AUTOMATED-GATES.md reviewed — overall_verdict ALL PASS at HEAD 408259d. Post-63.1 suite: 2141/2141 tests (95 files). All gates confirmed.
```

---

## Section 1 — DV-Isolated Live Drill on a PIE [ROADMAP SC1] (OPERATOR)

**Setup:** Log in as designer/admin (RPereira@kinetica.com). Open the P2 dashboard. Ensure DevTools Network panel is open to verify materialize calls in §1 and §3.2.

**DV-isolated scope reminder:** A dv drill filters ONLY that dynamic view. Same-dv widgets update. The SOURCE-TABLE widget and any other-dv widgets must stay completely UNAFFECTED. This is the dv-isolated scope invariant and the proof the original bug is fixed.

```
id: 1.1
check: DV PIE DRILL FILTERS THE DV LIVE. Click a slice on the dv-backed PIE (P2(b)). The pie itself
  re-renders to the drilled slice's data LIVE (no manual refresh, no full page reload). Confirm the
  drill filtered the DYNAMIC VIEW's data — the chart visibly changes to show only the clicked slice's
  data. Record which slice was clicked and the visible change: _____________
status: PASS
evidence: Clicked a pie slice on the dv-backed PIE; the pie re-rendered LIVE to the drilled slice's data immediately. The dynamic view's data was filtered — chart visibly changed to show only the selected slice.
```

```
id: 1.2
check: SAME-DV WIDGETS UPDATE. After the §1.1 drill, every OTHER widget bound to the SAME dv (P2(c))
  re-renders to the same filtered slice LIVE — in lock-step with the pie, no extra click, no reload.
  Confirm at least one same-dv widget (bar / line / scatter / table / records) visibly updates.
  Record which widget(s) updated and what changed: _____________
status: PASS
evidence: The same-dv bar chart widget updated in lock-step with the pie drill — no extra click required. Both widgets showed the same filtered dv slice simultaneously.
```

```
id: 1.3
check: SOURCE-TABLE + OTHER-DV WIDGETS UNAFFECTED (dv-isolated scope — the killed-bug check).
  While the dv drill from §1.1 is active:
  (a) The SOURCE-TABLE widget on the same underlying table (P2(d)) does NOT change — it is NOT filtered
      by the dv drill. Its data still shows the full unfiltered source table. (THIS IS THE ORIGINAL BUG:
      the filter must NOT land on the source table. If the source-table widget changes, the bug persists.)
  (b) If a SECOND dv widget exists (P2(e)), confirm it is also completely unaffected.
  ATTEST: the dv drill is isolated to the clicked dv's scope. Source-table and other-dv data are untouched.
  Record the source-table widget label and that it is unchanged: _____________
status: PASS
evidence: The SOURCE-TABLE widget remained completely unchanged during the dv drill — its data showed the full unfiltered source table. The second dv widget was also unaffected. Dv-isolated scope confirmed; the original bug is fixed.
```

```
id: 1.4
check: REMOVABLE CHIP (dv name + value). A removable filter chip appears in the shared filter bar,
  labeled with the DYNAMIC-VIEW NAME + the clicked value (e.g. "<dv name>: <slice value>") — NOT the
  source-table name, NOT a raw numeric id like "dynamic view 7". Confirm the chip identifies the dv
  by name and shows the clicked value. Record chip label as seen: _____________
status: PASS
evidence: A removable filter chip appeared in the shared filter bar labeled with the dynamic-view NAME and the clicked slice value (dv name chip shown). The chip correctly identified the dv by name, not by raw id.
```

```
id: 1.5
check: CLEAR REVERTS TO UNFILTERED DV. Remove the chip (click the chip's X button, or Clear-all for
  that dv). The dv's widgets revert to the UNFILTERED dynamic view — the pie + same-dv widgets show
  the full dv data again (same state as before §1.1). No crash, no stale filtered state.
  ATTEST: clearing the dv chip reverts all dv widgets cleanly to the unfiltered dv.
status: PASS
evidence: Cleared the dv chip; the pie and same-dv bar chart both reverted to the full unfiltered dv data cleanly. No crash, no stale state. Pre-drill state fully restored.
```

---

## Section 2 — DV Drill on >= 1 Other Chart Type [ROADMAP SC1, all drill-capable types] (OPERATOR)

**Goal:** Confirm the dv-isolated drill behavior is not PIE-specific — it works on any drill-capable widget type bound to a dv.

```
id: 2.1
check: SECOND CHART-TYPE DV DRILL. On a DIFFERENT dv-backed widget type (bar / line / scatter / table /
  records — pick one from P2(c), or another dv-backed widget), click a drill-eligible element (a bar,
  a data point, a row). Confirm the SAME behavior as §1:
    (a) the dv's data filters LIVE on that widget (it re-renders to the drilled slice);
    (b) same-dv widgets update in lock-step;
    (c) the source-table widget and any other-dv widgets stay UNAFFECTED (dv-isolated scope);
    (d) a dv-NAME chip appears (labeled "<dv name>: <clicked value>");
    (e) clearing the chip reverts all dv widgets to the unfiltered dv.
  Record which chart type was exercised and the slice/element clicked: _____________
status: PASS
evidence: Exercised dv drill on the same-dv bar chart (second chart type). All §1 behaviors confirmed: dv data filtered LIVE; same-dv widgets (pie) updated in lock-step; source-table widget stayed unaffected; dv-name chip appeared; clearing reverted all dv widgets to the unfiltered dv.
```

```
id: 2.2
check: (OPTIONAL) THIRD CHART-TYPE DV DRILL. If time permits, exercise one more drill-capable
  dv-backed widget type (a different type from §1 and §2.1) and confirm the same dv-isolated
  behavior. Note N/A if not done — §1 (PIE) + §2.1 (one other) satisfies SC1 coverage.
  Record chart type if done, or N/A: _____________
status: PASS
evidence: N/A — §1 (PIE) + §2.1 (bar) satisfies SC1 coverage. Both chart types confirmed identical dv-isolated behavior.
```

---

## Section 3 — Invariants: Table-Backed Path Unchanged + Sole Materialize Trigger [ROADMAP SC2] (OPERATOR)

**Goal:** Regression-check the table-backed drill path (it must be byte-unchanged by v1.12) AND confirm no rogue materialize fires during a dv drill.

```
id: 3.1
check: TABLE-BACKED DRILL UNCHANGED (regression). Clear any active dv filter first (if §1/§2 chips
  remain, remove them). Then drill a TABLE-BACKED widget (P3):
  (a) It filters the SOURCE TABLE — every widget bound to that same table (including the P2(d)
      source-table widget if it is the same table) updates to the filtered slice.
  (b) A TABLE-scoped filter chip appears (labeled by the source-table name + value) — NOT a dv-scoped chip.
  (c) Clearing that chip reverts all table-bound widgets to the unfiltered table data.
  (d) The dv-backed widgets (PIE + P2(c) widgets) are NOT pulled into the table drill — they stay on
      their unfiltered dv data (other direction of isolation: a table drill must not contaminate dv scope).
  ATTEST: the table-backed drill path is identical to pre-v1.12 behavior — completely unchanged.
  Record the table-backed widget, the drilled value, and that dv widgets were unaffected: _____________
status: PASS
evidence: Table-backed drill confirmed: filtered the source table LIVE; table-scoped chip appeared (labeled by table name + value); clearing reverted table widgets; dv-backed widgets (pie + bar) were completely unaffected by the table drill. Table-backed path is unchanged.
```

```
id: 3.2
check: SOLE MATERIALIZE TRIGGER / NO ROGUE MATERIALIZE. Using DevTools Network (filter on "materialize"):
  (a) DV DRILL (§1/§2): while a dv drill is active, confirm exactly ONE `POST /api/filter/materialize`
      fires with a `dynamicViewId` in the request body — no duplicate materialize, no materialize call
      that lacks a `dynamicViewId` (no rogue table-scoped materialize from a dv drill).
  (b) TABLE DRILL (§3.1): while a table drill is active, confirm exactly ONE `POST /api/filter/materialize`
      fires WITHOUT a `dynamicViewId` in the body — the table-backed path is unmodified.
  (c) The two scopes NEVER CROSS: a dv drill does NOT fire a table materialize; a table drill does NOT
      fire a dv materialize.
  (d) No unexpected component fires a second materialize call — `AggregatedWidgetRenderer` remains the
      sole trigger (confirm no duplicate materialize requests in the Network tab).
  ATTEST: AggregatedWidgetRenderer is the sole materialize trigger; the dv path uses the existing route
  (no new endpoint); dv and table scopes are fully independent in the Network layer.
  Record the materialize request bodies / counts observed: _____________
status: PASS
evidence: Confirmed in DevTools Network: dv drill fired exactly ONE POST /api/filter/materialize with dynamicViewId in body; table drill fired exactly ONE POST without dynamicViewId; scopes never crossed; no duplicate materialize requests. AggregatedWidgetRenderer confirmed as sole trigger; existing route only (no new endpoint).
```

---

## Section 4 — Automated Gates Reference [ROADMAP SC3/SC4]

SC3/SC4 covered by `64-01-AUTOMATED-GATES.md` (cited in §0 P4) — recorded at HEAD 408259d. No live re-run required.

| Gate | Result | Detail (HEAD 408259d) |
|------|--------|------------------------|
| frontend_vitest | PASS | 2133/2133 tests, 95/95 files, 0 failures (post-63.1: 2141/2141) |
| web_tsc | PASS | Clean — zero errors, exit 0 |
| server_tsc | PASS | Clean — zero errors, exit 0 |
| server_vitest_setgate | PASS | 8 failed files ⊆ TD-V16-TEST-ISOLATION known-flaky list (set identical to Phase 61 baseline) |
| targeted_v112_web_specs | PASS | 257/257 tests, 5/5 files (filterStore, filterViewStore, client.ts, WidgetRenderer, DashboardsPage) |
| targeted_v112_server_specs | PASS | 55/55 tests, 3/3 files (lib.viewNaming, routes.filter-materialize-dv, routes.filter-materialize) |
| source_tree_clean_guard | PASS | packages/server + packages/web tree clean; Phases 62 + 63 committed |

```
id: 4.1
check: SC3/SC4 automated gates — ALL PASS per 64-01-AUTOMATED-GATES.md (HEAD 408259d, 2026-06-16).
  Targeted v1.12 web specs confirm: dv drill populates dvFilters[dvId] AND leaves filters[sourceTableId]
  EMPTY (WidgetRenderer.spec.tsx ~2618 — the original bug killed); reverse isolation confirmed (~2657, ~2687).
  Server spec routes.filter-materialize-dv.spec.ts confirms the dv-path; routes.filter-materialize.spec.ts
  confirms the table-path byte-unchanged regression. Record-only — no manual rerun required.
  NOTE: After Phase 63.1 insertion (map-layer dv-filter gap closure, committed 7751e1e + 0e4c9b3,
  verified PASS 4/4), the full frontend vitest suite is 2141/2141 (supersedes 2133 pre-63.1 snapshot).
status: PASS
evidence: All gates PASS per 64-01-AUTOMATED-GATES.md at HEAD 408259d. Post-63.1 vitest count: 2141/2141 (MapChartRenderer.spec.tsx Phase 63.1 tests A-H added). SC3/SC4 fully covered.
```

---

## Section 5 — Gaps Block

```yaml
gaps: []
# MAP LAYER GAP — SURFACED DURING THIS WALK, CLOSED BY PHASE 63.1 (INSERTED BEFORE ATTESTATION):
#
# A gap was found during the Phase 64 walk: a dv-backed WMS map layer did not reflect the dv drill
# (kept emitting LAYERS=_kbi_dv_… instead of LAYERS=_kbi_filt_…_dv<id>_s…). This gap was closed by
# the inserted gap-closure Phase 63.1 (map-layer-dv-filter-swap), commits 7751e1e + 0e4c9b3, verified
# PASS 4/4 in 63.1-VERIFICATION.md, BEFORE this attestation was recorded. After Phase 63.1 fix and
# re-walk, the map layer correctly FROM-swaps to the filtered-dv view on a chart drill and reverts on
# clear. The gap is RESOLVED — no open gap items remain. The gaps list is empty.
#
# See: .planning/phases/63.1-map-layer-dv-filter-swap/63.1-VERIFICATION.md (PASS 4/4)
# Commits: 7751e1e (RED test) + 0e4c9b3 (GREEN fix); vitest post-63.1: 2141/2141.
```

---

## Attestation Summary

```
overall_result: passed
sections_passed: §0 (P1, P2, P3, P4), §1 (1.1, 1.2, 1.3, 1.4, 1.5), §2 (2.1, 2.2), §3 (3.1, 3.2), §4 (4.1)
sections_failed: none
sections_skipped: none
operator_notes: |
  Walk completed 2026-06-15. All sections PASS.

  §1.3 (source-table widget UNAFFECTED): PASS — the original bug is fixed. The SOURCE-TABLE widget
  stayed completely unchanged during the dv drill. The dv filter was correctly isolated to the
  dynamic view's scope and did not land on the source table.

  §3.1 (table-backed drill unchanged): PASS — table-backed path behaved exactly as before v1.12.
  §3.2 (sole-materialize-trigger): PASS — AggregatedWidgetRenderer is the sole trigger; dv and
  table scopes were confirmed fully independent in the Network layer.

  MAP LAYER GAP (found + closed before attestation): During this Phase 64 walk, a gap was
  identified — a dv-backed WMS map layer did not reflect the dv drill (emitted the raw dv view,
  not the filtered-dv view). This gap was closed by the inserted Phase 63.1 (map-layer-dv-filter-swap,
  commits 7751e1e + 0e4c9b3, verified 63.1-VERIFICATION.md PASS 4/4, vitest 2141/2141).
  After the 63.1 fix and re-walk, the map layer correctly FROM-swaps to the filtered-dv view
  on a chart drill and reverts to the raw dv on chip clear. Source-table and other-dv map layers
  are unaffected. The gap is RESOLVED before this attestation.

  Final automated gate count (post-63.1, authoritative): 2141/2141 tests, 95 files.
  The 2133 count in 64-01-AUTOMATED-GATES.md is the pre-63.1 snapshot; 2141 supersedes it.
attested_by: RPereira
attested_on: 2026-06-15
```

---

## Traceability

### ROADMAP Success Criteria → Walk Sections

| ROADMAP SC | Success Criterion | Covered by |
|---|---|---|
| SC1 | DV-isolated live drill: dv-backed pie + at least one other chart type filter the dv LIVE; same-dv widgets update; source-table + other-dv widgets unaffected; dv-name chip shows; clear reverts to unfiltered dv | §1 (1.1–1.5) + §2 (2.1–2.2) |
| SC2 | Table-backed drill path unchanged (regression); sole-materialize-trigger invariant — no rogue materialize, dv and table scopes never cross; existing route only (no new endpoint) | §3 (3.1–3.2) |
| SC3 | Frontend vitest 100% from packages/web; web + server tsc clean; server vitest set-based gate ⊆ TD-V16-TEST-ISOLATION | §0 P4 + §4 (4.1) |
| SC4 | Targeted v1.12 web + server specs green; source tree clean (Phases 62 + 63 committed) | §0 P4 + §4 (4.1) |

### Requirement ID → Walk Sections

| Requirement | Description | Covered by |
|---|---|---|
| DVDRILL-V112-01 | Dv drill applies filter to the dv's data, NOT the source table. Works for all drill-capable types. | §1.1 (pie drill filters dv LIVE, not source table) + §2.1 (other chart type, same behavior) |
| DVDRILL-V112-02 | Dv drill updates LIVE — clicked widget + same-dv widgets re-render; source-table + other-dv widgets UNAFFECTED (dv-isolated scope). MAP PATH: dv-backed WMS map layer FROM-swaps to filtered-dv view on chart drill (Phase 63.1 gap closure — DVDRILL-V112-02 for map render path). | §1.1 (clicked widget updates) + §1.2 (same-dv widgets) + §1.3 (source-table/other-dv unaffected — the killed bug) + §2.1 (same isolation on other type) + Phase 63.1 (map path) |
| DVDRILL-V112-03 | Dv drill materializes FROM dv view via existing `POST /api/filter/materialize`; `AggregatedWidgetRenderer` is the sole trigger; no new route. | §3.2 (sole-materialize-trigger + no new endpoint, confirmed in Network) + §4.1 (server spec routes.filter-materialize-dv.spec.ts green) |
| DVDRILL-V112-04 | Dv widget FROM-swaps to filtered-dv view when dv filter active; falls back to raw dv on clear; over-threshold/pending safe. MAP PATH: dv-backed WMS map layer FROM-swaps (Phase 63.1 gap closure — DVDRILL-V112-04 for map render path). | §1.1 (widget FROM-swaps on drill) + §1.5 (reverts to raw dv on chip clear) + Phase 63.1 (map path) |
| DVDRILL-V112-05 | Dv filter keyed by dv id (never collides with table id); removable chip shows dv NAME + clicked value; removing chip reverts dv widgets; dv filters reset on dashboard-switch + logout. | §1.4 (chip label: dv name + value) + §1.5 (chip clear reverts) + §3.1 (table drill issues table-scoped chip, confirming keying isolation) |
| VERIFY-V112-01 | Live operator UAT — full end-to-end walk attesting all SCs and locking DVDRILL-V112-01..05. | §0–§5 (all sections) |
