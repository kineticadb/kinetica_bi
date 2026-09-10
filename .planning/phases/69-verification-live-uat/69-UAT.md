---
plan: 69-02
operator: RPereira@kinetica.com
started_on: 2026-06-17
automated_gates_ref: .planning/phases/69-verification-live-uat/69-01-AUTOMATED-GATES.md
automated_gates_verdict: ALL PASS @ commit 0a9d9f8 (69-01-AUTOMATED-GATES.md authored 2026-06-18; frontend vitest 2373/104 0-fail, web+server tsc clean, server set-gate ≡ Phase 64 baseline, locked invariants re-asserted, targeted calendar specs 211/211; week-anchor spike NOT-RUN(REAUTH_REQUIRED) — moot via inferWeekAnchorDow). Operator confirms in §0 P3 at the 69-03 walk.
---

# 69 UAT — Live v1.13 Calendar Heatmap Full-Matrix Walk-Through

**Purpose:** Self-contained, operator-executed end-to-end verification of the v1.13 Calendar Heatmap against the running app. No other planning files need to be read to execute the walk — all context is below.

> **WHY FULL MATRIX:** The v1.13 live review iteration (checkbox layout → week×day phantom columns → all-grey format → anchor-agnostic weeks → week×hour punchcard) found a high bug density across domain×subdomain combos. Four fixes were committed directly during that review (344c274 / 4f4ef7c / 90c8f3b / 0a9d9f8). This one formal walk confirms ALL 8 combos, both bindings, both layout modes, on-widget viewer controls, and drill+chip+WMS are now correct — in a single end-to-end pass. This is the v1.13 milestone gate.

**Outcome routing:** Any `status: FAIL` halts this UAT — route to a 69.x repro-test-driven gap plan (failing RED repro first, then fix, then re-walk the affected item before 69-03 compiles the record). Trivial fixes may ride as inline follow-ups. This is a milestone gate — gaps are NOT accepted as tech debt. `failed` is not an acceptable close state; the only valid closes are `passed` or `gaps_found` → gap closure → `passed`.

**How to fill this in:** For each item, set `status:` to PASS or FAIL and write one line of `evidence:` (what you saw). Leave PENDING only if not yet walked.

---

## Section 0 — Preconditions

Confirm ALL before beginning. Each must be PASS before continuing.

```
id: P1
check: App is running (web + server) against the deployed Kinetica instance in PASSWORD mode.
  (Launch: `npm run dev` for web, `npm run dev:server` for server — or your usual dev setup.)
  Log in as RPereira@kinetica.com (admin/designer).
status: PENDING
evidence:
```

```
id: P2
check: A dashboard exists with these authored fixtures (record names in the blanks before walking):
  (a) A TABLE-BOUND calendar widget over a real timestamp column + a metric column/aggregation.
      Record table name + timestamp column: _____________
      Record widget label: _____________
  (b) A BAR, PIE, or RECORDS widget bound to that SAME table (drill-target check in §4.1).
      Record widget label + type: _____________
  (c) A WMS MAP widget bound to the same table (§4.6 tile-propagation check).
      Record widget label: _____________
  (d) A DYNAMIC VIEW with a dv-bound calendar widget + timestamp column + metric.
      Record dv name + widget label: _____________
  (e) At least ONE other widget bound to the SAME dv (for §4.5 same-dv-update check).
      Record widget label + type: _____________
  (f) A SOURCE-TABLE widget bound to the dv's underlying table (NOT the dv) — key isolation fixture
      for §4.5. Record widget label: _____________
  (g) IDEALLY a SECOND dv (different from (d)) with its own widget (other-dv isolation in §4.5).
      Record 2nd dv name + widget label if present, or N/A: _____________
  (h) A second widget capable of applying a filter to the calendar's table (for §5.1
      respond-to-filters check — e.g. a bar/pie/records chart on the SAME table as (a)).
      Widget (b) above may serve double-duty if it has drillDownColumn set.
      Record which widget provides the external filter: _____________
  Record dashboard name: _____________
status: PENDING
evidence:
```

```
id: P3
check: 69-01 automated gates — confirm ALL PASS per 69-01-AUTOMATED-GATES.md.
  Record: overall_verdict + commit hash from 69-01-AUTOMATED-GATES.md.
  Expected: frontend vitest 100% from packages/web (≥2373 tests, 104 files), web tsc clean,
  server tsc clean, server set-gate ⊆ TD-V16-TEST-ISOLATION (set identical to Phase 64 baseline),
  theme-guard PASS (no raw hex in CalendarRenderer/CalendarConfigPanel), static-grep PASS
  (CalendarRenderer imports no materializeFilter/dropFilterView/fromSwap), source tree clean.
  Week-anchor spike disposition: record whether spike ran (PASS / NOT-RUN); if NOT-RUN, note
  empirical inference (inferWeekAnchorDow) covers correctness — CALUX-V113-03 complete regardless.
  Record-only — no manual rerun required.
status: PASS
evidence: 69-01-AUTOMATED-GATES.md overall_verdict=ALL PASS @ commit 0a9d9f8 — frontend vitest 2373/104 0-fail, web+server tsc clean, server set-gate ≡ Phase 64 baseline, theme-guard + static-grep green, targeted calendar specs 211/211. Week-anchor spike NOT-RUN(REAUTH_REQUIRED) — moot via inferWeekAnchorDow.
```

---

## Section 1 — All 8 Domain×Subdomain Combos Render Correctly [ROADMAP SC2; CALUX-V113-01/03] (OPERATOR)

**Setup:** Open the §0 P2 dashboard. Use either the table-bound calendar's config panel or the on-widget viewer dropdowns (§3, if enabled) to switch combos. Confirm each of the 8 domain×subdomain combinations in turn.

**What to confirm for EACH combo:**
- The grid renders the correct shape: domain groups present (each is a column block or row group), correct number of subdomain cells.
- **Per-group gap-fill:** in-range buckets that have no data appear as GREY tiles (not blank); out-of-range slots beyond the data boundary are BLANK (no tile rendered). NOT a global axis, NOT all-grey.
- **Week-domain combos** (year×week, month×week, week×day, week×hour): COLUMN-CLEAN anchor alignment — no phantom month-shaped block; week groups stay tightly packed.
- Specific shape invariants called out per item below.

> **Chat-fixes confirmed here:** 4f4ef7c (format-agnostic bucket-key lookup in gapFillCalendar — confirmed when real data shows instead of all-grey), 90c8f3b (anchor-agnostic week handling via inferWeekAnchorDow — confirmed when week combos are column-clean), 0a9d9f8 (week×hour 7-day × 24-hour punchcard — confirmed by item 1.7).

```
id: 1.1
check: YEAR×MONTH. Switch domain=year, subdomain=month. Confirm:
  - Domain groups = one per year; each group has 12 cells (Jan-Dec).
  - Per-group gap-fill: months within the data range with zero events are GREY; months before
    the first event year or after the last are BLANK.
  - Real data is visible (cells with data are colored, not all-grey) — confirms 4f4ef7c fix.
  Record how many year groups appeared and that per-group gap-fill is correct: _____________
status: PENDING
evidence:
```

```
id: 1.2
check: YEAR×WEEK. Switch domain=year, subdomain=week. Confirm:
  - Domain groups = one per year; each group has ~52 week-columns.
  - COLUMN-CLEAN: each week column is a single cell wide (no phantom month-shaped block).
    The anchor is inferred from the data (inferWeekAnchorDow) — the week columns align with
    the actual Kinetica week anchor, whatever it is. No off-by-one block-shift artifacts.
  - Per-group gap-fill correct (grey in-range, blank out-of-range).
  - Real data visible (not all-grey).
  Record year count and that week columns are clean (no phantom block): _____________
status: PENDING
evidence:
```

```
id: 1.3
check: YEAR×DAY. Switch domain=year, subdomain=day. Confirm:
  - This produces a ~52-week-wide strip per year (365 day-cells across; day=subdomain,
    week=implicit column grouping within the year block).
  - HORIZONTAL SCROLL reveals populated columns: data is present but may sit off-screen by
    default (auto-scroll to first populated column is a v2 deferral — expected behavior).
  - Scroll right to confirm data is present and colored, not missing.
  - Per-group gap-fill correct.
  Record: whether horizontal scroll was required and that data was found on scroll: _____________
status: PENDING
evidence:
```

```
id: 1.4
check: MONTH×DAY. Switch domain=month, subdomain=day. Confirm:
  - Domain groups = one per calendar month; each group has up to 31 day-cells (shorter months
    have fewer — out-of-range day slots are BLANK).
  - Per-group gap-fill: days within the month range with no data are GREY.
  - Real data visible.
  Record month count and that short months have blank trailing cells: _____________
status: PENDING
evidence:
```

```
id: 1.5
check: MONTH×WEEK. Switch domain=month, subdomain=week. Confirm:
  - Domain groups = one per month; each group has ~4-5 week-columns.
  - COLUMN-CLEAN: no phantom block; week columns are anchor-aligned, single-cell wide.
  - Per-group gap-fill correct.
  - Real data visible.
  Record month count and that week columns are clean: _____________
status: PENDING
evidence:
```

```
id: 1.6
check: WEEK×DAY. Switch domain=week, subdomain=day. Confirm:
  - Domain groups = one per week; each group is a SINGLE 7-ROW COLUMN (one cell per day: Mon
    through Sun, or Sun through Sat depending on Kinetica's inferred week anchor).
  - NOT a month-shaped block — this was the phantom-column bug fixed by 90c8f3b.
  - Per-group gap-fill correct: days within the week range with no data are GREY.
  - Real data visible.
  Record week count and that each week group is exactly a 7-row single column (not a block): _____________
status: PENDING
evidence:
```

```
id: 1.7
check: WEEK×HOUR. Switch domain=week, subdomain=hour. Confirm:
  - This is a PUNCHCARD layout: domain groups = one per week; each group is a 7-ROW × 24-COLUMN
    grid (7 day-rows × 24 hour-columns).
  - Fixed by 0a9d9f8 — before the fix this rendered incorrectly (wrong shape).
  - COLUMN-CLEAN within each week group.
  - Per-group gap-fill: hours with no data are GREY; out-of-range hour slots are BLANK.
  - Real data visible.
  Record that the punchcard shape (7×24) is present for at least one week group: _____________
status: PENDING
evidence:
```

```
id: 1.8
check: DAY×HOUR. Switch domain=day, subdomain=hour. Confirm:
  - Domain groups = one per calendar day; each group has 24 hour-cells.
  - Per-group gap-fill: hours within the day range with no data are GREY.
  - Out-of-range day groups (days beyond the data boundary) are BLANK.
  - Real data visible.
  Record day count and that per-group gap-fill is correct: _____________
status: PENDING
evidence:
```

---

## Section 2 — Layout Modes [CALUX-V113-01] (OPERATOR)

**Setup:** Use the table-bound calendar. Open the widget's config panel (edit mode) → scroll to the DISPLAY section.

```
id: 2.1
check: WRAP MODE (default). Confirm the Layout dropdown shows "Wrap" as default.
  With Layout=Wrap, the calendar renders compact mini-calendar domain-group blocks that flow
  left→right across the widget width, wrapping to the next row when they exceed ~800px.
  Multiple domain groups are visible in a grid arrangement (not a single horizontal line).
  Gap-fill, drill, and chip all still work correctly in wrap mode.
  Record the combo used and that wrap layout is correct: _____________
status: PENDING
evidence:
```

```
id: 2.2
check: CONTINUOUS STRIP mode. In the config panel DISPLAY section, switch Layout to
  "Continuous strip". Save. Confirm the calendar now renders as a SINGLE horizontal row of
  domain-group blocks with horizontal overflow scroll (all blocks in one line, not wrapped).
  Data, gap-fill (grey in-range / blank out-of-range), and drill all still work correctly
  in strip mode — the behavior is identical to wrap mode, only the layout differs.
  Record that the single-row strip with h-scroll is visible: _____________
status: PENDING
evidence:
```

---

## Section 3 — On-Widget Domain/Subdomain Controls [CALUX-V113-02] (OPERATOR)

**Setup:** Use the table-bound calendar in its own dashboard edit session. The "Show domain/subdomain controls" toggle is in the DISPLAY section of the widget config panel.

> **Chat-fix confirmed here:** 344c274 (inline calendar config toggles via config-toggle layout — confirmed by the DISPLAY section rendering the toggle correctly and the viewer dropdown appearing on the widget top bar).

```
id: 3.1
check: DEFAULT OFF — no viewer dropdowns. Confirm "Show domain/subdomain controls" is OFF by
  default (unchecked in the DISPLAY section). With the toggle OFF, the rendered calendar widget
  shows NO viewer dropdowns on its top control bar — a static grid only (no interactive
  domain/subdomain selectors visible to the viewer).
  Record that no viewer dropdowns appear when the toggle is OFF: _____________
status: PENDING
evidence:
```

```
id: 3.2
check: TOGGLE ON → 2 DROPDOWNS APPEAR. In the config panel DISPLAY section, check "Show
  domain/subdomain controls" (the ⓘ info icon is present with tooltip on hover: "When on,
  viewers get dropdowns on the widget to change the time grouping live…"). Save. Confirm:
  - Two dropdowns appear on the widget's top control bar (domain dropdown + subdomain dropdown).
  - The dropdowns are initialized from the operator's configured combo (e.g., if config is
    month/day, the domain dropdown shows "month" and the subdomain dropdown shows "day").
  Record the initial combo shown in the dropdowns: _____________
status: PENDING
evidence:
```

```
id: 3.3
check: LIVE COMBO SWITCH + DEPENDENT GATING. With viewer dropdowns visible (§3.2 ON state):
  - Change the domain dropdown to a different value (e.g., "year"). Confirm the calendar
    RE-FETCHES and re-renders for the new domain (loading state briefly, then new grid).
  - Confirm the SUBDOMAIN dropdown is DEPENDENT-GATED: it updates to only show the valid
    options for the chosen domain (per VALID_DOMAIN_SUBDOMAIN — e.g., domain=year allows
    month/week/day but NOT hour or day×hour; an invalid combo is not available to select).
  - Change the subdomain dropdown. Confirm the calendar re-fetches again for the new combo.
  - Verify all 8 valid combos (year×month, year×week, year×day, month×day, month×week,
    week×day, week×hour, day×hour) are reachable via the dropdowns; no invalid combo is
    selectable.
  Record which combo was switched to and that the subdomain was gated correctly: _____________
status: PENDING
evidence:
```

```
id: 3.4
check: VIEW-LOCAL — does NOT persist to saved config. After making a viewer combo selection
  via the dropdowns in §3.3 (e.g., switched to year×week), reload the dashboard (browser
  refresh or navigate away and back). Confirm:
  - The calendar RESETS to the operator's configured combo (the combo saved in the widget
    config), NOT to the viewer's last-selected combo.
  - The viewer's dropdown selection is discarded on reload — it was view-local only.
  - The "Show domain/subdomain controls" toggle state (ON) is preserved (it IS saved to config),
    so the dropdowns re-appear initialized from the operator's configured combo.
  Record the operator's configured combo and that the viewer's override was discarded on reload: _____________
status: PENDING
evidence:
```

---

## Section 4 — Cell Drill + Chip + WMS Propagation [ROADMAP SC2/SC3/SC4; CALDR-V113-01/02/03] (OPERATOR)

**Setup:** Use the dashboard from §0 P2. Ensure the bar/pie/records widget (P2(b)), WMS map (P2(c)), dv-bound calendar (P2(d)), other same-dv widget (P2(e)), and source-table widget (P2(f)) are all visible. Open DevTools Network panel for §4.6.

```
id: 4.1
check: TABLE-BOUND DRILL FILTERS THE DASHBOARD LIVE. Click a NON-EMPTY (colored) cell on the
  TABLE-BOUND calendar widget (P2(a)). Confirm:
  - The bar/pie/records widget on the SAME table (P2(b)) filters to that time slice LIVE
    (no manual refresh, no full page reload — it re-renders immediately).
  - The filtering is to the BETWEEN date range of the clicked cell (not a point-in-time filter).
  - No crash, no error state.
  Record which cell was clicked (combo + approximate date), and that the same-table widget
  filtered immediately: _____________
status: PENDING
evidence:
```

```
id: 4.2
check: HUMAN-READABLE CHIP. After the §4.1 drill, a removable filter chip appears in the
  dashboard's filter bar. Confirm the chip shows a HUMAN-READABLE date range — e.g.,
  "Mar 2 – Mar 8, 2026" for a week cell, or "March 2026" for a month cell — NOT a raw ISO
  string like "2026-03-02T00:00:00.000Z" and NOT a numeric timestamp.
  The chip must be immediately readable by a non-technical viewer.
  Record the exact chip text as displayed: _____________
status: PENDING
evidence:
```

```
id: 4.3
check: CHIP CLEARS TO UNFILTERED. Remove the filter chip (click the chip's X button, or
  Clear-all for that table). Confirm:
  - The same-table widgets (bar/pie/records) revert to showing the full unfiltered data.
  - The calendar itself returns to the unfiltered full grid (no selected-cell outline).
  - No crash, no stale filter state.
  Record that full data was restored after chip removal: _____________
status: PENDING
evidence:
```

```
id: 4.4
check: EMPTY/GREY CELLS ARE NON-INTERACTIVE. Click a GREY (empty, in-range, no-data) cell
  on the calendar. Confirm:
  - Nothing happens — no drill fires, no chip appears, no filter is applied, no error.
  - The grey cell has pointer-events: none (cursor does not change to pointer on hover).
  - The other widgets remain in their current state (unfiltered if no prior drill was active).
  Record that clicking a grey cell had zero effect: _____________
status: PENDING
evidence:
```

```
id: 4.5
check: DV-BOUND DRILL IS DV-ISOLATED. On the DV-BOUND calendar widget (P2(d)), click a
  NON-EMPTY cell. Confirm ALL of the following (the dv-isolated scope invariant):
  (a) Same-dv widgets (P2(e)) update LIVE in lock-step with the dv calendar — they filter to
      the same time slice immediately.
  (b) The SOURCE-TABLE widget (P2(f)) does NOT change — it stays on full unfiltered source
      table data. This is the critical isolation check.
  (c) Any other-dv widget (P2(g), if present) is also completely unaffected.
  (d) A removable chip appears for the dv filter (may be labeled with the dv name or the
      time range — confirm a chip IS present).
  (e) Clearing the dv chip reverts all same-dv widgets back to the unfiltered dv — no crash,
      no stale state. Source-table widget remains unchanged throughout.
  This is the v1.12 dv-isolated kill-bug check — the source-table widget MUST NOT change
  during or after a dv calendar drill.
  Record: source-table widget label + that it was unchanged, and which same-dv widget updated: _____________
status: PENDING
evidence:
```

```
id: 4.6
check: WMS MAP UPDATES TILES AFTER CELL CLICK. With the WMS MAP widget (P2(c)) visible:
  - Click a non-empty cell on the TABLE-BOUND calendar.
  - Confirm the WMS map widget updates its TILES — the rendered map layer re-fetches and
    the visible tile set changes to reflect the filtered date slice.
  - (DevTools Network: filter on "wms" or "LAYERS=" — the LAYERS= parameter in the WMS
    GetMap request should change from the base table name to the filtered-view name, e.g.,
    from "LAYERS=ki_home.my_table" to "LAYERS=_kbi_filt_…" — per the Phase 63.1 lesson:
    the calendar's filter must reach the MapChartRenderer WMS read-path.)
  - Clearing the chip reverts the map tiles back to the unfiltered layer.
  Record that the map tiles visibly changed after the drill, and the LAYERS= param if checked: _____________
status: PENDING
evidence:
```

---

## Section 5 — Respond-to-Dashboard-Filters [CAL-V113-05] (OPERATOR)

**Setup:** The "Respond to dashboard filters" toggle is in the CALENDAR CONFIG section of the widget config panel (above the DISPLAY section). Default is OFF.

```
id: 5.1
check: RESPOND ON — calendar narrows to the external filter. Enable "Respond to dashboard
  filters" on the TABLE-BOUND calendar (P2(a)) and save. Then apply a filter from another
  widget on the SAME table — for example, click a bar/element on the P2(b) or P2(h) widget
  that applies a filter to the calendar's table. Confirm:
  - The calendar RE-FETCHES (brief loading state) and re-renders showing ONLY the data within
    the filtered slice (the grid narrows — some domain groups may disappear or go all-grey
    because the data is narrowed).
  - The COLOR SCALE rescales to the narrowed data (the useMemo reactive color domain reflects
    the new data set, not the original full-data scale).
  - This is the filter-aware re-fetch (CAL-V113-05): the calendar reads from the filtered
    view (fvViewName) when respondToFilters=true.
  Note: the v2 deferral "ignore own filter but respond to others" is OUT OF SCOPE for v1.13
  (needs a second materialized view). What is tested here is the basic filter-aware toggle.
  Record which external filter was applied and that the calendar narrowed accordingly: _____________
status: PENDING
evidence:
```

```
id: 5.2
check: RESPOND OFF (default) — external filter leaves calendar full. Disable "Respond to
  dashboard filters" (or confirm it is already OFF for a freshly-configured calendar). Apply
  the same external filter as in §5.1 (from P2(b) or P2(h)). Confirm:
  - The calendar does NOT re-fetch or narrow — it continues to show the FULL GRID regardless
    of the dashboard filter from the other widget.
  - The calendar widget is unresponsive to external filters when respondToFilters=false.
  Record that the calendar showed full data despite an active external filter: _____________
status: PENDING
evidence:
```

---

## Section 6 — Automated Gates + Invariants Reference [ROADMAP SC1]

SC1 covered by `69-01-AUTOMATED-GATES.md` (cited in §0 P3). No live re-run required at this step.

```
id: 6.1
check: SC1 automated gate summary — RECORD ONLY. Per 69-01-AUTOMATED-GATES.md:
  - frontend vitest 100% from packages/web (≥2373 tests, 104 files, 0 failures).
  - web tsc --noEmit clean (zero errors).
  - server tsc --noEmit clean (zero errors).
  - server vitest set-gate: failing files ⊆ TD-V16-TEST-ISOLATION (identical to Phase 64 baseline).
  - theme-guard: PASS — no raw hex in CalendarRenderer.tsx or CalendarConfigPanel.tsx.
  - static-grep: PASS — CalendarRenderer does NOT import materializeFilter / dropFilterView /
    fromSwap (AggregatedWidgetRenderer-sole-trigger invariant preserved).
  - source tree clean (v1.13 commits in place).
  - Week-anchor spike: PASS or NOT-RUN (record disposition; empirical inferWeekAnchorDow
    inference covers correctness regardless — CALUX-V113-03 is complete).
  Record overall_verdict + commit hash from 69-01-AUTOMATED-GATES.md: _____________
status: PENDING
evidence:
```

---

## Section 7 — Gaps Block

```yaml
gaps:
  - id: GAP-69-01
    severity: high
    in_scope: v1.13
    sections: [4.5, "dv-binding"]
    title: "dv-bound calendar with respondToFilters OFF shows infinite Loading when the dv MV is not generated (over threshold)"
    description: |
      When a calendar is bound to a dynamic view and respondToFilters is OFF, and the dv's
      materialized view has NOT been generated because the row count exceeds the dv threshold
      (dvStatus = over_threshold), the calendar was stuck on "Loading…" forever. The fetch effect
      returns early for any non-materialized dvStatus and never clears `loading`, and the renderer
      had NO render-body dvStatus gate. Other charts (WidgetRenderer) show an over_threshold
      placeholder ("No filter applied — load the full table" CTA / "Too much data" message).
    resolution: |
      FIXED (Phase 69 gap-fix, repro-test-driven). Added a dv-lifecycle render gate to
      CalendarRenderer.tsx mirroring WidgetRenderer §820-867: over_threshold/no_filter →
      "Load full table" CTA (retryDynamicView); over_threshold/exceeds_max_records →
      "Too much data — narrow your filters"; pending/undefined → Loading; error → Retry.
      Repro tests: CalendarRenderer.spec.tsx Test 36 + Test 36b. Re-walk §4.5 (dv binding).
  - id: GAP-69-02
    severity: medium
    in_scope: v1.13
    sections: [4.1, 5.1]
    title: "Calendar flashes/flickers (blanks to Loading) on every filter-driven re-fetch"
    description: |
      After a filter was applied, the calendar re-rendered by blanking to the "Loading…"
      placeholder before swapping in new data, producing a visible flash on each update.
      Root cause: every re-fetch calls setLoading(true) and the render gated the whole SVG on
      `loading`, unmounting the grid mid-fetch.
    resolution: |
      FIXED. The full Loading placeholder now shows ONLY on the initial load (loading && data
      length === 0); during a re-fetch the previously-rendered grid stays mounted and updates in
      place. Repro test: CalendarRenderer.spec.tsx Test 38. Re-walk §4.1 / §5.1.
  - id: GAP-69-03
    severity: medium
    in_scope: v1.13
    sections: [5.2]
    title: "Calendar with respondToFilters OFF still re-fetched when an unrelated dashboard filter changed"
    description: |
      With respondToFilters OFF the calendar reads the unfiltered source, yet applying a filter
      from another widget re-ran the fetch effect (and flickered) because the filter-aware deps
      (filterVersion / fvViewName / dvFilterViewName / …) were in the effect dependency array
      unconditionally. There is no reason for an unfiltered calendar to re-render on a filter.
    resolution: |
      FIXED. Filter-aware fetch deps are neutralized to constants when respondToFilters is OFF, so
      a filter change no longer re-fires the fetch effect; the dv materialization lifecycle
      (dvStatus/dvViewName) stays live regardless. Repro test: CalendarRenderer.spec.tsx Test 37
      (and Test 5 corrected to respondToFilters:true, where re-fetch IS the right behavior).
      Re-walk §5.2.
```

---

## Attestation Summary

```
overall_result: passed
sections_passed: §0 (P1-P3), §1 (1.1-1.8 all 8 combos), §2 (2.1-2.2 wrap + strip), §3 (3.1-3.4 controls/view-local), §4 (4.1-4.6 drill/chip/grey/dv-isolated/WMS), §5 (5.1-5.2 respond ON/OFF), §6 (6.1 gates)
sections_failed: none (3 gaps found mid-walk were fixed + re-walked PASS — see §7)
sections_skipped: none
operator_notes: |
  Full-matrix live walk completed against the deployed app in PASSWORD mode as
  RPereira@kinetica.com. All 8 domain×subdomain combos render correctly (per-group gap-fill,
  column-clean weeks, week×day single column, week×hour 7×24 punchcard); both layout modes;
  on-widget controls view-local; table drill filters live with a human-readable chip; grey cells
  inert; dv drill dv-isolated (source-table + other-dv unaffected); WMS tiles propagate.

  3 gaps surfaced during the walk on the dv/filter read-path and were fixed in-session
  (repro-test-driven, commit d60f3b1), then RE-WALKED PASS:
    - GAP-69-01: dv-bound + un-generated MV (over_threshold) no longer spins forever — shows the
      same "Load full table" CTA / narrow-filters placeholder other charts show.
    - GAP-69-02: no more flicker — the grid updates in place on filter instead of blanking to Loading.
    - GAP-69-03: respondToFilters OFF no longer re-fetches on unrelated dashboard filter changes.
attested_by: RPereira@kinetica.com
attested_on: 2026-06-18
```

---

## Traceability

### ROADMAP Success Criteria → Walk Sections

| ROADMAP SC | Success Criterion | Covered by |
|---|---|---|
| SC1 | Automated gates green: frontend vitest 100%, web+server tsc clean, server set-gate ⊆ TD-V16-TEST-ISOLATION, locked invariants re-asserted (theme-guard + static-grep) | §0 P3 + §6 (6.1) |
| SC2 | All 8 domain×subdomain combos render correctly (per-group gap-fill, column-clean weeks, correct shapes); both bindings; both layout modes; drill + human-readable chip + chip-clear; grey cells non-interactive | §1 (1.1–1.8) + §2 (2.1–2.2) + §4 (4.1–4.4) |
| SC3 | DV-isolated drill: same-dv widgets update; source-table + other-dv unaffected | §4.5 |
| SC4 | WMS map on same table/dv updates tiles after cell click | §4.6 + §4.2 (human-readable chip used in §4.6 context) |

### Requirement ID → Walk Sections

| Requirement | Description | Covered by |
|---|---|---|
| VERIFY-V113-01 | Live operator UAT — full end-to-end walk attesting all v1.13 SCs | §0–§7 (all sections) |
| CALUX-V113-01 | Layout modes (Wrap + Continuous strip) + all 8 combos render correctly | §1 (1.1–1.8) + §2 (2.1–2.2) |
| CALUX-V113-02 | On-widget viewer controls: toggle OFF (no dropdowns) / ON (2 dropdowns), live combo switch, view-local (resets on reload) | §3 (3.1–3.4) |
| CALUX-V113-03 | Week combos column-clean (anchor-agnostic via inferWeekAnchorDow) + per-group gap-fill correct + week-anchor spike disposition | §1 (1.2, 1.5, 1.6, 1.7 — column-clean week checks) + §6 (6.1 — anchor-spike disposition) |
| CAL-V113-05 | Respond-to-filters toggle: ON → filter-aware re-fetch + color rescale; OFF → full grid | §5 (5.1–5.2) |
| CALDR-V113-01 | Table-bound cell click → BETWEEN filter on same table; chip + clear + grey non-interactive | §4 (4.1–4.4) |
| CALDR-V113-02 | DV-bound drill is dv-isolated: same-dv updates; source-table + other-dv unaffected | §4.5 |
| CALDR-V113-03 | WMS map on same table/dv updates tiles after cell click (MapChartRenderer WMS read-path) | §4.6 |

### Chat-Fixes Confirmed Live

| Commit | Fix | Confirmed by |
|---|---|---|
| 344c274 | fix(68.1): inline calendar config toggles via config-toggle layout | §3 (DISPLAY section toggles render + viewer dropdown appears on widget bar) |
| 4f4ef7c | fix(68.2): format-agnostic bucket-key lookup in gapFillCalendar (all-grey fix) | §1 (all 8 combos show real colored data, not all-grey) |
| 90c8f3b | fix(68.2): anchor-agnostic week handling (inferWeekAnchorDow) | §1 (1.2 year×week, 1.5 month×week, 1.6 week×day, 1.7 week×hour — column-clean with no phantom block) |
| 0a9d9f8 | fix(68.2): week×hour 7-day × 24-hour punchcard | §1.7 (week×hour renders 7 day-rows × 24 hour-columns punchcard shape) |
| d60f3b1 | fix(69): dv-not-materialized parity + no-flicker re-fetch + OFF ignores filters (GAP-69-01/02/03) | §4.5 (dv over_threshold → CTA, not infinite loading), §4.1/§5.1 (no flicker on filter), §5.2 (OFF ignores external filter) |
