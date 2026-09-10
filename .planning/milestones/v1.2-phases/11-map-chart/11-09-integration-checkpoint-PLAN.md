---
phase: 11-map-chart
plan: 09
type: execute
wave: 5
depends_on:
  - 11-06
  - 11-08
files_modified: []
autonomous: false
requirements:
  - MAP-01
  - MAP-02
  - MAP-03
  - MAP-04
  - FILT-04
must_haves:
  truths:
    - "User has end-to-end verified all five Phase 11 success criteria against deployed Kinetica"
    - "WMS tiles render in correct geographic position for all configured spatial modes (latlon + WKT + WKB if data is available)"
    - "Switching render modes preserves pan/zoom; filter changes invalidate tiles instantly without rebuilding the Map"
    - "Network tab confirms Cache-Control: no-store on every /api/wms response"
    - "Navigating away from a dashboard with a map and back leaves no leaked OL Map instances or duplicate tile fetches"
  artifacts:
    - path: ".planning/phases/11-map-chart/11-VERIFICATION.md"
      provides: "Goal-backward verification report — each of 5 success criteria marked GREEN/RED with evidence"
      contains: "## Success Criterion"
  key_links:
    - from: "Phase 11 completion gate"
      to: ".planning/phases/11-map-chart/11-VERIFICATION.md"
      via: "human-verified evidence per success criterion"
      pattern: "GREEN|RED"
---

<objective>
Single-checkpoint plan that gates Phase 11 completion on end-to-end manual verification. Every Phase 11 success criterion from `ROADMAP.md §11` is exercised against the deployed Kinetica + the just-built MapChartRenderer + MapConfigPanel. Success criteria that automated tests cannot fully cover (geographic correctness of rendered tiles, no-leak on unmount, browser cache headers in Network tab) need a human's eyes — that's this plan.

Purpose: Phase 11 is shipping a new chart type with hardware-rendering (Kinetica's GPU WMS) that no jsdom-based test can validate. The checkpoint converts every implicit "it works" claim into either a recorded GREEN observation or a discovered RED gap that triggers `/gsd:plan-phase 11 --gaps`.

Output: A signed `11-VERIFICATION.md` with each of the five success criteria marked GREEN (verified) or RED (gap found, with diagnostic detail).
</objective>

<execution_context>
@/Users/rydelpereira/.claude/get-shit-done/workflows/execute-plan.md
@/Users/rydelpereira/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/11-map-chart/11-CONTEXT.md
@.planning/phases/11-map-chart/11-UI-SPEC.md
@.planning/phases/11-map-chart/11-SPIKE-NOTES.md
</context>

<tasks>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 1: End-to-end map-widget verification</name>
  <files>.planning/phases/11-map-chart/11-VERIFICATION.md</files>
  <action>
    This is a CHECKPOINT task — Claude does not execute it autonomously. Claude's role: open the dev server, present the verification protocol from `<how-to-verify>` to the user, and STOP. The user runs the protocol and writes `.planning/phases/11-map-chart/11-VERIFICATION.md` with the GREEN/RED verdict per success criterion. Claude resumes only when the user types "approved" or "issues" per the resume signal contract.

    Concrete steps Claude DOES perform:
    1. Print the `<how-to-verify>` content to the user.
    2. Confirm the dev server can start (`cd kinetica_bi/server && npm run dev` and `cd kinetica_bi && npm run dev` — return commands without running them in the background; the user runs them).
    3. Block on the resume signal.
    4. After "approved": commit `.planning/phases/11-map-chart/11-VERIFICATION.md` and the SUMMARY.md.
    5. After "issues": commit `11-VERIFICATION.md` and STOP — surface gap details to the orchestrator so it can re-route to `/gsd:plan-phase 11 --gaps`.
  </action>
  <read_first>
    - .planning/ROADMAP.md (Phase 11 § "Success Criteria" — five criteria; each must be GREEN before checkpoint approval)
    - .planning/phases/11-map-chart/11-CONTEXT.md ("Decisions" — for context on every UX decision being verified)
    - .planning/phases/11-map-chart/11-UI-SPEC.md ("Copywriting Contract" — exact copy strings to verify in the live UI)
    - .planning/phases/11-map-chart/11-SPIKE-NOTES.md (the WMS param-name lockfile — confirm tiles render correctly with these locked names)
    - All 11-XX-SUMMARY.md files from prior plans (state of what was built and any documented caveats)
  </read_first>
  <what-built>
    Phase 11 is fully built across plans 11-01 through 11-08:
    - GetCapabilities spike + /api/wms Cache-Control: no-store header (11-01)
    - getValidSpatialColumns + autoSuggestSpatialMode helpers (11-02)
    - /api/wms/capabilities endpoint + frontend store + boot wiring (11-03)
    - wmsUrlBuilder.ts pure builder for all 4 render modes × 3 spatial modes (11-04)
    - ol@^10.5.0 installed; definitions/map.ts replaced; .widget-map-* + .config-* CSS classes (11-05)
    - bboxHelper.ts + MapChartRenderer.tsx + WidgetRenderer wire (11-06)
    - MapConfigPanel.tsx shell with spatial/render/basemap pickers (11-07)
    - MapConfigPanel.tsx mode-specific param groups + cardinality probe + classbreak builder (11-08)

    Map widget is in the live UI as a new chart type with a CustomConfigPanel.
  </what-built>
  <how-to-verify>
    Start the dev environment:
    ```bash
    cd kinetica_bi/server && npm run dev   # backend on :4000
    cd kinetica_bi && npm run dev          # frontend on :5173
    ```
    Open http://localhost:5173 and authenticate.

    **Pre-check: Capabilities probe**
    1. Open DevTools → Network tab.
    2. Confirm a request to `/api/wms/capabilities` fires once on app boot. Expected: 200 response with JSON body containing `renderModes`, `colormaps`, `spatialModes`, `srs`, `source` fields.
    3. Confirm response header `Cache-Control: private, max-age=300`.

    **Success Criterion 1 — Map widget can be added and configured with all three spatial-column modes**
    Need a Kinetica table with at least one of: (a) lat/lon numeric columns, (b) a WKT geometry column, (c) a Kinetica geometry/wkb column. (Pick whichever is available; ideally test all three.)

    1. Create a new dashboard. Add a `Map` widget. Open its config.
    2. Confirm `MapConfigPanel` renders with the three pickers (SPATIAL MODE, RENDER MODE, BASEMAP).
    3. Confirm the auto-suggest hint `Auto-detected from column types` appears below the SPATIAL MODE radios on first open.
    4. Pick lat/lon mode → pick lat + lon columns → pick render mode = raster → Apply.
    5. **Verify:** WMS tiles render on the map in the correct geographic position over the OSM basemap. Pan/zoom to confirm tiles are aligned with the basemap (NOT offset — M-03 lock would cause increasing offset with zoom).
    6. If WKT or WKB columns are available, repeat with those modes.
    7. Mark **Criterion 1: GREEN** if tiles align; **RED** with screenshot if offset.

    **Success Criterion 2 — All four render modes selectable; switching preserves pan/zoom**
    1. With map rendering at, say, zoom 8 over a specific region, open config.
    2. Switch render mode raster → heatmap → Apply.
    3. **Verify:** Tiles update to heatmap style, but pan/zoom position is unchanged. The OL Map is the same instance (no flicker, no remount).
    4. Repeat for raster → classbreak (configure 2-3 break rows first; pick a low-cardinality column) and raster → contour.
    5. Open DevTools → React DevTools (or use console). Confirm `MapChartRenderer` re-renders but the underlying OL Map ref is stable across the four switches.
    6. Mark **Criterion 2: GREEN** if pan/zoom preserved across all four mode switches; **RED** if any mode loses position.

    **Success Criterion 3 — Filter changes invalidate WMS tiles immediately + no stale tiles**
    1. Configure the map alongside another chart on the same `tableId` (e.g. a bar chart from a previous phase's drill-down work).
    2. Click a bar in the bar chart to apply a filter for that table.
    3. **Verify:** Within < 1 second, the map's WMS tiles refetch (Network tab shows new `/api/wms?...&_v=<filterVersion>` requests with a new `_v` cache-buster value).
    4. **Verify:** The map's previously-loaded tiles are replaced (not blended/overlaid). The new tiles reflect the filtered data.
    5. **Verify:** Active filter chip in the filter bar shows the filter (Phase 10 work).
    6. Click "Clear all" or × on the chip. Map refetches again with no filter.
    7. Mark **Criterion 3: GREEN** if tile refetch fires + new `_v` value + no stale-tile artifacts; **RED** if tiles persist or fail to refetch.

    **Success Criterion 4 — Map cleanup on unmount: no memory leak, no duplicate tile requests**
    1. With a map widget on Dashboard A, navigate to Dashboard B (no map). Then back to Dashboard A.
    2. **Verify (Memory):** In DevTools → Memory, take a heap snapshot. Search for retained `Map` instances from `ol/Map`. Should see exactly ONE (the currently-mounted instance), not multiples.
    3. **Verify (Network):** Each tile load fires exactly once per visible tile per mount. No duplicate tile requests.
    4. **Verify (DevTools → Console):** Add a temporary `console.log("MapChartRenderer mount", widget.id)` in the mount effect (revert before commit). On dashboard switch + back, expect EXACTLY ONE log line per mount cycle (not two — M-01 StrictMode lock validates the mapRef guard works).
    5. Repeat the navigate-away-and-back cycle 5 times. Heap snapshot still shows ≤ 1 retained Map (allowing 1 short-lived instance that's pending GC).
    6. Mark **Criterion 4: GREEN** if no retained instances accumulate; **RED** with heap-snapshot screenshot if leak observed.

    **Success Criterion 5 — Cache-Control: no-store on /api/wms responses (post-filter-change)**
    1. With a map rendered, apply a filter (Criterion 3 setup).
    2. In DevTools → Network, click any `/api/wms` request that fired DURING the filter change.
    3. **Verify:** Response Headers include `Cache-Control: no-store`.
    4. Sample 3-5 different /api/wms requests — every one should have the header.
    5. Disable the network throttle (if you had one), apply another filter, and check the new request again.
    6. Mark **Criterion 5: GREEN** if header is present on every sampled response; **RED** with sample-request screenshot if any response is missing it.

    **UI-SPEC.md spot-check:**
    - Open the map config modal. Verify these EXACT strings appear:
      - `SPATIAL MODE`, `Latitude / Longitude pair`, `WKT geometry column`, `Kinetica geometry column`
      - `RENDER MODE`, `Raster (point markers)`, `Heatmap (density)`, `Classbreak (categorical)`, `Contour (lines)`
      - `RASTER PARAMS`, `Point color`, `Point size`, `Point opacity`
      - `HEATMAP PARAMS`, `Colormap`, `Blur radius (Kinetica map units)`
      - `CLASSBREAK PARAMS`, `Break column`, `+ Add break`, `Break 1`
      - `CONTOUR PARAMS`, `Contour color`, `Smooth contours`, `Bandwidth (Kinetica map units)`
      - `BASEMAP`, `OpenStreetMap`, `CartoDB Voyager`, `CartoDB Dark Matter`
    - Trigger an empty-config map widget: confirm `Configure spatial columns to render the map` overlay copy.
    - Force a tile error (e.g. set Network throttle to Offline briefly, observe overlay): confirm `Failed to load map tiles` + `Tiles could not be fetched from Kinetica. Check your filter or retry.` + Retry button.

    **Capture findings:**
    Write `.planning/phases/11-map-chart/11-VERIFICATION.md` with this structure:

    ```markdown
    # Phase 11 — End-to-End Verification

    **Verification date:** <ISO>
    **Verifier:** <user>
    **Deployed Kinetica:** <KINETICA_URL with creds redacted>

    ## Success Criterion 1: Map widget renders with each spatial-column mode
    Status: GREEN | RED
    Evidence: <observation, screenshot path if applicable>

    ## Success Criterion 2: All four render modes; mode switch preserves pan/zoom
    Status: GREEN | RED
    Evidence: ...

    ## Success Criterion 3: Filter changes invalidate tiles; no stale tiles
    Status: GREEN | RED
    Evidence: ...

    ## Success Criterion 4: Cleanup on unmount; no leak; no duplicate tile fetches
    Status: GREEN | RED
    Evidence: <heap snapshot screenshot path; mount log count>

    ## Success Criterion 5: Cache-Control: no-store on /api/wms responses
    Status: GREEN | RED
    Evidence: <Network tab screenshot path; sample of 3+ requests>

    ## UI-SPEC.md copy check
    Status: PASS | FAIL
    Evidence: <which strings rendered exactly; which had drift>

    ## Caveats / Follow-ups
    <Any minor issues that don't block Phase 11 but should be noted; e.g.
     "POINTOPACITY at 0% renders fully transparent points which is hard to see — UX tweak needed in v1.3">
    ```

    If any criterion is RED, type "issues" in your resume signal AND describe the gaps so the orchestrator can re-route to `/gsd:plan-phase 11 --gaps`.

    If all five are GREEN, type "approved" to allow phase completion.
  </how-to-verify>
  <acceptance_criteria>
    - User has executed every step under "How to Verify" against deployed Kinetica.
    - `.planning/phases/11-map-chart/11-VERIFICATION.md` exists with all five `## Success Criterion` sections.
    - Each section has `Status: GREEN` or `Status: RED` (no missing/blank statuses).
    - If any RED: at least one diagnostic note (file path to screenshot, or text description of the gap) is present in that section.
  </acceptance_criteria>
  <resume-signal>Type "approved" if all 5 success criteria are GREEN. Type "issues" + a brief description of the RED gaps so the orchestrator can re-route to gap closure.</resume-signal>
  <verify>
    <automated>test -f .planning/phases/11-map-chart/11-VERIFICATION.md && grep -c "## Success Criterion" .planning/phases/11-map-chart/11-VERIFICATION.md | awk '$1 >= 5 {exit 0} {exit 1}'</automated>
  </verify>
  <done>11-VERIFICATION.md is committed; user's resume signal is "approved" or "issues"; all 5 success criteria addressed.</done>
</task>

</tasks>

<verification>
- 11-VERIFICATION.md exists with all 5 Success Criterion headings.
- Each criterion has a recorded GREEN or RED status.
- User has explicitly approved or flagged issues for gap closure.
</verification>

<success_criteria>
- All five Phase 11 success criteria from ROADMAP.md verified against deployed Kinetica.
- UI-SPEC.md copy contract verified by spot-check.
- Phase 11 either approved (proceed to Phase 12) or RED gaps documented for `/gsd:plan-phase 11 --gaps` re-routing.
</success_criteria>

<output>
After completion, create `.planning/phases/11-map-chart/11-09-SUMMARY.md` summarizing:
- Five-criterion verdict (5 GREEN / 4 GREEN + 1 RED / etc.)
- Any RED gaps and their diagnostic notes
- UI-SPEC copy spot-check result
- Caveats / follow-ups for v1.3 backlog
- Resume signal recorded
</output>
