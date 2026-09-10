---
status: complete
phase: heatmap-widget
source: [git commits efb60e6, c2be348, 3f9ac14, f8f2e00, 1fca2ea (no SUMMARY.md — built outside GSD)]
started: 2026-09-08T00:00:00Z
updated: 2026-09-08T00:00:00Z
---

## Current Test

[testing complete]

## Scope note

These tests deliberately cover ONLY what the automated suite cannot reach.
3546 unit/component tests already pin the grid maths, colour ramp, measured
geometry, SQL contract and widget routing. What no test can judge: whether it
actually renders in a browser, whether the colours read correctly in light and
dark, whether the real ResizeObserver reflows it, and whether it genuinely sits
on the shared filter/aggregation path in a live dashboard.

## Tests

### 1. Heatmap is offered in the visualization picker
expected: Heatmap appears in the add-visualization list with icon "HM"
result: pass

### 2. Config panel shows axis-shaped group-by
expected: An "Axes" group with "X Axis" and "Y Axis" slots; "+ Add column" disabled at 2; Metric + Aggregation present
result: pass
note: |
  Operator configured VENDOR_ID x payment_type with AVG(passenger_count)
  successfully, so the axis-shaped group-by path works end to end. The
  2-column CAP itself was not explicitly exercised (unit-tested only).

### 3. It draws a grid
expected: Coloured cell matrix filling the widget, both axes' tick labels, vertical legend with high/low values
result: pass
note: |
  Screenshot confirms: 5x5 matrix filling the widget, y ticks (YCAB/CMT/DDS/
  NYC/VTS), rotated x ticks (Cash/Credit/No Charge/Unknown/Dispute), vertical
  legend 1.2 -> 2.098, unpopulated intersections rendered as distinct dark
  empty cells rather than as zero. High values red (reverseColors default).

### 4. Tooltip on hover
expected: Hovering a cell shows both axis values, the metric label (e.g. AVG(col)), the formatted value and a percentage
result: issue
reported: "Screenshot shows the tooltip clipped above the widget: only 'AVG(passenger_count): 1.2' and '%: 57.2%' are readable. The two axis-value lines (VENDOR_ID, payment_type) are cut off outside the card, and the remainder overlaps the panel header instead of sitting near the hovered cell."
severity: major
observed_by: claude (from operator screenshot, not a verbal report)
resolution: fixed in 79694f1 — collision flip below the cell when there is no room above; 3 regression tests. RE-TESTED PASS ("tool tip is readable"), but re-testing surfaced test 15 (scrolled grid).

### 5. Reflow on resize
expected: Resizing the widget refills the grid; x labels rotate when cells narrow; no clipping or dead space
result: pass

### 6. Colour reads correctly in light AND dark mode
expected: Ramp encodes magnitude, high values red by default, legend matches cells, all text legible in both themes
result: pass

### 7. Dashboard filters re-query the heatmap
expected: Applying a filter (or drilling from another widget) makes the heatmap re-query and visibly change
result: pass

### 8. Appearance options take effect
expected: Colour theme, Reverse, Normalize Across (x/y), Show Values, Show Legend, X/YScale Interval all change the render
result: pass
operator_confirmed: \"8, 10, 11 pass\"

### 9. Truncation notice on an over-cap grid
expected: A pair of axes exceeding 5000 intersections shows the truncation warning rather than a silently holed grid
result: pass
note: Operator screenshot shows the notice firing correctly at the chosen 250 limit, naming 250 (not the 5000 cap).

### 10. Unconfigured and empty states
expected: Fewer than 2 axes shows the "Pick two Group By columns" prompt; a non-numeric metric shows "No numeric values to plot"
result: pass
operator_confirmed: \"8, 10, 11 pass\"

### 14. Truncation notice is compact
expected: The notice is one short line, not a wrapped paragraph stealing grid height
result: issue
reported: "Can we make this notification smaller and more concise?"
severity: cosmetic
resolution: fixed in 43e4903 — one 10px line "Truncated to the top N cells", full guidance moved to the title attribute.

### 15. Tooltip works on a scrolled grid
expected: Hovering a cell shows the tooltip regardless of how far the plot is scrolled
result: issue
reported: "if the chart has more data that cant fit on view I scroll down and the tooltip does not display then"
severity: major
resolution: fixed in 43e4903 — tooltip subtracts the scroll container's offset on both axes; collision flip now computed from the cell's VISIBLE position.

### 13. Column display format applies to the axes
expected: A column formatted as Date in "Format columns" renders formatted axis ticks; Display label used in the tooltip; dense axis stays readable
result: pass (re-tested after fix)
operator_confirmed: "dates are readable / axis is legible / its in chronolgical bottom to top"
reported: "the y axis seems cluttered and why is it not applying the datetime format to the column? pickup_datetime has date format set"
severity: major
resolution: fixed in 3b16ac7 — 5 defects: axis ticks now use resolveFormatter, tooltip uses resolveLabel, valueFormat falls back to the metric column as its hint promised, labels auto-thin, date axis sorts chronologically. Plus a numeric-string epoch coercion bug found by the new tests. 14 regression tests. AWAITING OPERATOR RE-TEST.

### 16. Axis bucketing (trunc + cycle)
expected: Truncate collapses near-duplicate timestamp rows into real day rows; Day of week x Hour of day gives the classic cycle heatmap; bucket ignored on a text column
result: pass
operator_confirmed: "these pass now"
note: |
  Confirms the one genuinely unverified piece — EXTRACT(HOUR|DOW|MONTH FROM col)
  IS supported by this Kinetica instance, and DOW numbers from 0=Sunday (no
  literal "7" appeared in the weekday labels). Stale "unverified" comment
  corrected in 78deefb.

### 17. Legend bounded on a scrolling grid
expected: Ramp capped at the visible height, both end-labels inside the widget
result: pass (implicit — operator continued testing on scrolling grids without recurrence)
note: Fixed in 99fdab0. Not separately confirmed in words.

### 11. Survives save + reload
expected: Saving the dashboard and reloading restores the heatmap with its config intact
result: pass
operator_confirmed: \"8, 10, 11 pass\"

### 12. "Result limit" control is honest for heatmap
expected: The Result limit field either affects the query or is not shown
result: issue
reported: "I dont know what the limit is for if by default it limits to 5000" — field shows 100, generated SQL shows LIMIT 5000
severity: major
found_during: ad hoc, while setting up test 9 (truncation)
resolution: fixed in 79694f1 — heatmap-specific limit ladder (250/500/1000/2500/5000) defaulting to the cap, SQL uses the operator's choice, notice reads the effective limit; 11 regression tests. RE-TESTED PASS: "i see all the results limits 250 to 5000 in the config".

## Summary

total: 17
passed: 16
issues: 7
pending: 0
skipped: 0
note: |
  All 7 issues fixed and committed. Remaining pending: 8 (appearance options),
  10 (unconfigured/empty states), 11 (save + reload). Tests 14 (compact notice)
  and 15 (scrolled tooltip) were fixed and are believed good but were never
  confirmed in words — the operator's next report moved to the legend instead.

## Gaps

- truth: "Hovering a cell shows both axis values, the metric label, the formatted value and a percentage"
  status: failed
  reason: "Operator screenshot shows the tooltip clipped above the widget — only the metric and % lines are readable; the two axis-value lines are cut off and the box overlaps the panel header."
  severity: major
  test: 4
  root_cause: |
    HeatmapRenderer.tsx:372-373. `py` is the hovered cell's TOP edge
    (line 269: `py: y`), so a top-row cell gives py === PAD === 8 and
    `top: Math.max(0, hover.py - 8)` evaluates to 0. `transform:
    translate(-50%, -100%)` then shifts the box up by its own full height
    AFTER that clamp, placing its top at ~ -height — entirely outside the
    container, where the widget card clips it. The Math.max(0, ...) guard is
    inert because it constrains the pre-transform origin, not the painted box.
    Affects every cell in the top row (and partially the second row) at any
    widget size; worse for short widgets where cellH is small.
  artifacts:
    - path: "packages/web/src/components/charts/HeatmapRenderer.tsx"
      issue: "tooltip `top` clamp cannot account for the -100% translate, so a top-row hover paints above the container"
  missing:
    - "Flip the tooltip BELOW the hovered cell when there is not room above (collision flip), e.g. anchor to py + cellH with translate(-50%, 0) once py is under the tooltip's height"
    - "Regression test: hover a TOP-ROW cell and assert the painted box stays within the container (the existing tooltip tests hover a cell where the overflow does not show)"
  debug_session: ""


- truth: "The Result limit control either affects the heatmap query or is not shown"
  status: failed
  reason: "Operator: 'I dont know what the limit is for if by default it limits to 5000'. The select reads 100 and is labelled 'Maximum number of groups to return', but the generated SQL is LIMIT 5000 — the control is inert for heatmap."
  severity: major
  test: 12
  root_cause: |
    ChartConfigPanel.tsx:402-411. The heatmap branch replaces the operator's
    baseLimit with the constant HEATMAP_CELL_LIMIT (`isHeatmap ?
    HEATMAP_CELL_LIMIT : baseLimit`) to stop the shared 100-row default from
    silently holing a grid — 7 days x 24 hours is already 168 intersections.
    But the "Result limit" field that it overrides is still rendered, still
    defaults to 100, and still claims to cap the result, so the UI contradicts
    the SQL it generates.

    SECOND-ORDER: HeatmapRenderer's truncation notice tests
    `data.length >= HEATMAP_CELL_LIMIT` against the CONSTANT. That is only
    correct while the limit is hardcoded. Any fix that makes the field
    effective must also make the notice compare against the EFFECTIVE limit,
    or a lowered limit will truncate the grid with no warning — the exact
    failure the notice exists to prevent.
  artifacts:
    - path: "packages/web/src/components/charts/ChartConfigPanel.tsx"
      issue: "heatmap overrides baseLimit with a constant while still rendering the Result limit control that sets baseLimit"
    - path: "packages/web/src/components/charts/HeatmapRenderer.tsx"
      issue: "truncation notice threshold is the constant, not the limit actually used by the query"
  missing:
    - "Decide: hide Result limit for heatmap, or repoint it (heatmap-specific default + options) and use the chosen value capped at HEATMAP_CELL_LIMIT"
    - "If made effective: renderer must read the effective limit (config.limit) for the truncation threshold"
    - "Test: the ChartConfigPanel heatmap SQL tests currently assert LIMIT === HEATMAP_CELL_LIMIT and will need updating"
  debug_session: ""

- truth: "A column's stored display format and label apply to the heatmap axes, and a dense axis stays readable"
  status: failed
  reason: "Operator: 'the y axis seems cluttered and why is it not applying the datetime format to the column? pickup_datetime has date format set'"
  severity: major
  test: 13
  root_cause: |
    HeatmapRenderer.tsx referenced columnDisplayConfigStore ZERO times, unlike
    every other renderer (TimelineRenderer, NumericLineRenderer, InfoSelectionView
    all subscribe to configVersion and call resolveFormatter/resolveLabel). Five
    distinct consequences: raw axis ticks; raw column names in the tooltip and
    aria-label; the valueFormat hint's promised metric-column fallback never
    implemented; no label thinning, so N labels drew into N sub-font-height rows;
    and a date axis ordered by metric value, because rows arrive ORDER BY value
    DESC and orderAxis keeps first-seen order for non-numeric values.

    A sixth surfaced while fixing: buildHeatmapGrid String()-coerces axis keys,
    so a numeric timestamp becomes "1700000000000", which normalizeToMs cannot
    parse — both ordering and formatting silently no-opped for the likely-common
    case of SQL returning epoch numbers.
  artifacts:
    - path: "packages/web/src/components/charts/HeatmapRenderer.tsx"
      issue: "no columnDisplayConfigStore subscription; raw ticks/labels; no thinning; hint-promised fallback missing"
    - path: "packages/web/src/lib/heatmapGrid.ts"
      issue: "orderAxis had no date mode; axis keys are strings that normalizeToMs cannot read"
  missing: []
  resolution: "fixed in 3b16ac7"
  debug_session: ""

## Deferred (not defects — feature requests)

- truth: "A high-cardinality timestamp axis is bucketable (by hour / day / month)"
  status: deferred
  reason: |
    Even fully formatted and thinned, a raw per-second timestamp is a poor
    heatmap axis: 250 distinct instants make 250 one-cell rows. The classic
    day-of-week x hour-of-day heatmap needs the SQL to GROUP BY a derived
    bucket (EXTRACT/DATE_TRUNC), which is a new capability in the config panel,
    not a bug in the renderer. Operator can work around it today by picking a
    lower-cardinality column or a dynamic view that pre-buckets.
  severity: enhancement
