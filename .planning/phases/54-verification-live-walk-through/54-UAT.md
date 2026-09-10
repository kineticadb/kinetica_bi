---
plan: 54-02
operator: RPereira@kinetica.com
started_on: 2026-06-07
automated_gates_ref: .planning/phases/54-verification-live-walk-through/54-01-AUTOMATED-GATES.md
automated_gates_verdict: ALL PASS (commit d05d453, 2026-06-07 — frontend 1614/1614 green, tsc clean on both packages, server set-gate pass, track-spec group 297/297, builds exit 0)
---

# 54 UAT — Live Track-Rendering Walk-Through

**Purpose:** Operator-executed end-to-end verification of the Phase 52/53 track-layer flow against the running app. This document is self-contained — no other planning files need to be read to execute the walk.

**Pre-reading required:** None. All context is below.

**Outcome routing:** Any `status: FAIL` item halts this UAT. The orchestrator spins a 54.x inline fix plan; the walk is repeated from the failed section before 54-03 (compiler) may proceed.

---

## Section 0 — Preconditions

Operator confirms ALL of the following BEFORE beginning the walk. Each item must be PASS before continuing.

```
id: P1
check: App is running — `npm run dev` (web) + `npm run dev:server` (server) from the repo root
status: PASS
evidence: App running, confirmed by operator before walk
```

```
id: P2
check: demo.track table is registered in Kinetica with columns X (DOUBLE), Y (DOUBLE), TRACKID (VARCHAR), TIMESTAMP (BIGINT) — exact types, case-insensitive names
status: PASS
evidence: demo.track table present with correct column schema
```

```
id: P3
check: A dashboard with a map widget exists in the app (to add or open a layer on demo.track)
status: PASS
evidence: Dashboard with map widget available
```

```
id: P4
check: All 54-01 automated gates recorded PASS — frontend 1614/1614 green, tsc clean, server set-gate, track-spec group 297/297, builds exit 0 (see header above)
status: PASS
evidence: See 54-01-AUTOMATED-GATES.md header — automated record, no manual confirmation needed.
```

---

## Section 1 — Spatial Mode + Auto-Suggest + Column Pickers  [ROADMAP SC2]

**Setup:** Open the layer configuration panel on the `demo.track` table. This can be done by adding a new map layer from the dashboard or opening an existing layer configured on demo.track.

```
id: 1.1
check: The spatial mode is auto-suggested as Track. The auto-suggest fires because the table has the TRACKID + x + y + TIMESTAMP column shape (case-insensitive match). Confirm "Track" is shown as the spatial mode without manually selecting it.
status: PASS
evidence: Track auto-suggested correctly on demo.track open
```

```
id: 1.2
check: Four typed column pickers appear in the layer config: x, y, track ID, ordering. All four pickers are visible.
status: PASS
evidence: All four pickers visible — x, y, track ID, ordering
```

```
id: 1.3
check: DOUBLE-PRECISION CHECK (the 5e3514b fix). Open the x picker — confirm the DOUBLE column X is listed and selectable. Open the y picker — confirm the DOUBLE column Y is listed and selectable.
  IMPORTANT: Before commit 5e3514b, DOUBLE columns were invisible in the numeric column pickers and only int columns appeared. Both X and Y MUST appear now. If either picker shows an empty list or shows only int columns, this is a FAIL.
status: PASS
evidence: X and Y DOUBLE columns visible and selectable in both x and y pickers
```

```
id: 1.4
check: Defaults are pre-filled at auto-suggest time — track ID defaults to TRACKID, ordering defaults to TIMESTAMP (case-insensitive match). x and y are pre-filled from the track-shape match. Confirm all four fields are pre-filled without any manual selection.
status: PASS
evidence: All four fields pre-filled: x=X, y=Y, trackID=TRACKID, ordering=TIMESTAMP
```

```
id: 1.5
check: No lock-in. Switch the spatial mode to a different value (e.g. lat/lon), confirm it switches cleanly (no error, no stale pickers). Then switch back to Track — confirm the four pickers and defaults return. Return the mode to Track before proceeding to Section 2.
status: PASS
evidence: Mode switch to lat/lon and back to Track worked cleanly; pickers and defaults restored
```

---

## Section 2 — Track + Raster  [ROADMAP SC2 + SC3 + SC4]

**Setup:** Spatial mode is Track (from Section 1). Open the render-mode picker.

```
id: 2.1
check: The render-mode picker lists ONLY Raster and Class Break. Heatmap is ABSENT from the list — not greyed out, not disabled — absent. Select Raster.
status: PASS
evidence: Re-walk 2026-06-07 (after 54-04 fix): Render picker narrowing confirmed — Heatmap absent. Track+Raster saves and WMS requests fire correctly. Track tiles render on map.
```

```
id: 2.2
check: After selecting Raster, confirm the TRACK STYLE section is present. It must contain: head color, head size, head shape, trail color, line width.
  Also confirm the RASTER PARAMS group (pointColor / pointSize / pointShape / shapeline / shapefill) is ABSENT. These fields must not be visible — not collapsed, not greyed — absent.
status: PASS
evidence: Re-walk 2026-06-07 (after 54-04 fix + 54-05 suppression fix + 54-06 full 8-param surface): TRACK STYLE section present with all 8 controls (head color/size/shape, track line color/width, track marker color/shape/size); RASTER PARAMS group absent. Form surface and rendering both confirmed correct.
```

```
id: 2.3
check: COLOR PICKER WITH ALPHA. On the head color control, confirm it is a proper color picker — a native color swatch + AARRGGBB hex field + a separate alpha control (not just a raw text input). Pick a distinct head color and adjust the alpha to a non-default value (e.g. ~80%).
  Repeat on the trail color control with a different color and a different alpha value.
  Confirm both controls accept and display the chosen color + alpha.
status: PASS
evidence: Re-walk 2026-06-07 (after 54-04 render fix + 54-06 full param surface): Color pickers functional; chose distinct head + track line colors with custom alpha values. Tiles rendered and visually reflected both colors + alpha. End-to-end confirmed.
```

```
id: 2.4
check: Save the layer. Confirm the map tiles render the track. The rendered tiles must visibly reflect the chosen head and trail colors (including the alpha you set in 2.3). If tiles do not render or the colors are not reflected, this is a FAIL.
status: PASS
evidence: Re-walk 2026-06-07 (after 54-04 fix): Track layer saves, WMS requests fire on zoom/pan, tiles render visibly. Head and line colors (with alpha) reflected correctly on rendered tiles. GAP-54-01 resolved. Re-attested post-54-06: full 8 TRACK_* params confirmed in WMS request; POINT*/SHAPE* params absent from request (GAP-54-05 resolved).
```

---

## Section 3 — Track + Class Break  [ROADMAP SC4]

**Setup:** The track layer from Section 2 is open in the config panel. Switch the render mode to Class Break.

```
id: 3.1
check: After switching to Class Break, confirm BOTH the CB break builder AND the TRACK STYLE section are shown simultaneously. Neither should be hidden or collapsed by default.
  Under classbreak: the 3 per-track-color controls (head color, track line color, track marker color) are HIDDEN — breaks define color. The shape/size controls and track line width remain visible. The CB column picker, method, auto-suggest, N slider, color theme, and per-break color pickers are all present in the CB builder.
status: PASS
evidence: Re-walk 2026-06-08 (after 54-07 per-break-color emission + form color gating): CB builder and TRACK STYLE section both appear. Per-track-color controls (head/line/marker color+alpha) are correctly hidden under classbreak — per-break CB colors drive TRACKHEADCOLORS/TRACKLINECOLORS/TRACKMARKERCOLORS. Shape/size and line width controls remain visible. CB builder (column picker, method, auto-suggest, color theme, per-break color pickers) all present. GAP-54-07 / TRACKFIX-V19-06 resolved.
```

```
id: 3.2
check: Confirm the per-break advanced [▸] chevron panels are absent. In track context, there must be no per-break point/shape advanced fields — no expandable chevron per break row.
status: PASS
evidence: Re-walk 2026-06-08 (after 54-07): Per-break advanced chevrons absent in track+classbreak context. CB color pickers present and editable per break. Advanced point/shape panels correctly suppressed.
```

```
id: 3.3
check: Configure at least one class break (e.g. set a value threshold or category). Keep the track head/trail colors from Section 2. Save the layer. Confirm the map tiles render the track under Class Break mode. Tracks render with per-break categorical coloring — each break produces a distinct color on track segments.
status: PASS
evidence: Re-walk 2026-06-08 (operator attestation 2026-06-08): Configured class break with distinct per-break colors. Saved layer. WMS requests fire. Track tiles render with categorical per-break coloring. TRACKHEADCOLORS/TRACKLINECOLORS/TRACKMARKERCOLORS emit the comma-separated per-break color list. GAP-54-02 / TRACKFIX-V19-06 resolved.
```

---

## Section 4 — Silent Heatmap→Raster Coercion  [ROADMAP SC4 / RENDER-V19-01]

**Setup:** Locate or simulate a layer whose persisted renderMode is heatmap. Then set its spatial mode to Track.

**Note:** If no stale-heatmap layer is available in the current environment, mark this item SKIPPED with a note — the automated coercion spec (KineticaWmsLayerForm.spec.tsx in track-spec group, 54-01 gate) already covers this behavior. This item is the live confirmation only.

```
id: 4.1
check: When a layer with persisted renderMode=heatmap has its spatial mode set to Track, the render mode silently shows Raster. There must be NO error message, NO toast notification, NO confirm dialog. The coercion is silent. If any UI feedback (toast, dialog, error banner) appears on the coercion, this is a FAIL.
status: SKIPPED
evidence: No stale-heatmap layer available in the operator's current environment. Automated coercion spec in 54-01 gate (track-spec group 297/297 green) covers this behavior.
```

---

## Section 5 — Color Round-Trip Persistence  [ROADMAP SC3 / COLOR-V19-01]

**Setup:** Use the track layer saved in Section 2 or Section 3 (the one with custom head + trail colors and custom alpha values).

```
id: 5.1
check: Close the layer config panel and reopen it (or navigate away and back to the dashboard, then reopen the layer). Confirm that the previously chosen head color + alpha and trail color + alpha are persisted and shown in the color controls exactly as set. The 8-char AARRGGBB value (including the leading AA alpha byte) must round-trip faithfully through save and reload. If colors reset to default or alpha is lost, this is a FAIL.
status: PASS
evidence: Head and trail colors with alpha persisted correctly on reopen. AARRGGBB round-trip confirmed.
```

---

## Section 6 — No-Regression: Normal Latlon / WKT Layer  [guard]

**Setup:** Add or open a map layer on a non-track table (any table that is NOT demo.track and that uses latlon or WKT spatial mode).

```
id: 6.1
check: The layer configures exactly as before Phase 52/53. Specifically:
  (a) The render-mode picker still offers Heatmap (latlon layers are NOT narrowed — Heatmap must be present).
  (b) Under Raster mode, the RASTER PARAMS group (pointColor / pointSize / pointShape / shapeline / shapefill) is shown.
  (c) There is NO TRACK STYLE section anywhere in the config panel.
  If any of (a), (b), or (c) fails, this is a regression and a FAIL.
status: PASS
evidence: (a) Heatmap present in latlon render-mode picker. (b) RASTER PARAMS group shown under Raster. (c) No TRACK STYLE section present. All three sub-checks pass.
```

```
id: 6.2
check: Save the latlon/WKT layer and confirm it renders unchanged on the map (tiles appear as expected for that table). No visual regression from pre-Phase-52/53 behavior.
status: PASS
evidence: Latlon WMS layer renders correctly, tiles appear. No regression observed.
```

---

## Section 7 — Post-Walk Findings (Gap Closure)

Post-walk gaps found after the initial 2026-06-07 walk were closed via plans 54-04 through 54-10. Live re-walk conducted 2026-06-08.

### Track Info Popup (GAP-54-08 / TRACKFIX-V19-07)

```
id: 7.1
check: Clicking a track point on the map fires POST /api/info/query and returns records in the info popup. No "Failed to fetch info" toast when clicking track tiles.
status: PASS
evidence: Operator re-walk 2026-06-08: Clicking track point on rendered tiles fires POST /api/info/query (confirmed in DevTools Network tab). Info popup displays track point data. GAP-54-08 / TRACKFIX-V19-07 resolved via plan 54-08 (buildSpatialColumns now accepts track_config as 2nd arg; all 3 call sites threaded).
```

### Track Spatial Filter — Map-Only Materialize (GAP-54-09 + GAP-54-10 / TRACKFIX-V19-08 + V19-09)

```
id: 7.2
check: Drawing a shape on a map-only track table (no chart/records widget on that table) fires exactly ONE POST /api/filter/materialize. Track tiles re-render narrowed to the drawn shape. Clearing the shape fires the drop call and tiles return to full extent.
status: PASS
evidence: Operator attestation 2026-06-08 (RPereira@kinetica.com): Map-only spatial filtering fires exactly one materialize and narrows the track to the drawn shape; clear drops it. GAP-54-09 (track spatial-target translation) + GAP-54-10 (map-only trigger hook) both resolved.
```

```
id: 7.3
check: SOLE-TRIGGER REGRESSION: A table that has both a map widget AND a chart/records widget still fires exactly ONE POST /api/filter/materialize (from the chart/records widget, not doubled by the new map-only hook).
status: PASS
evidence: Operator attestation 2026-06-08 (RPereira@kinetica.com): Sole-trigger regression case holds — one POST fired for table with chart/records widget. Phase 30 invariant preserved.
```

---

## Section 8 — Gaps Block

```yaml
gaps:
  - id: GAP-54-01
    severity: blocking
    in_scope: v1.9
    sections: [2.1, 2.2, 2.3, 2.4, 3.3]
    title: Track WMS layer never renders — no WMS request fires
    resolution: RESOLVED — Plan 54-04 (TRACKFIX-V19-01): merged layer.track_config into isConfigComplete input at MapChartRenderer Effect 2 call site (~line 1037). Operator re-walk 2026-06-07: §2 PASS, WMS requests fire, track tiles render.

  - id: GAP-54-02
    severity: major
    in_scope: v1.9
    sections: [3.1, 3.2, 3.3]
    title: Track + Class Break does not colorize tracks per-break categorically
    resolution: RESOLVED — Plan 54-07 (TRACKFIX-V19-06): TRACKHEADCOLORS/TRACKLINECOLORS/TRACKMARKERCOLORS now emit per-break color list from cb.breaks[].color under track+classbreak. UI color controls gated on effectiveRenderMode !== "classbreak". Operator re-walk 2026-06-08: §3 PASS, categorical coloring confirmed on rendered tiles.

  - id: GAP-54-03
    severity: minor
    in_scope: v1.9
    sections: [3.1]
    title: No form controls for TRACKLINECOLOR + TRACKLINEWIDTH track-line styling
    resolution: RESOLVED — Plan 54-05 (TRACKFIX-V19-02): trail==line clarification (trailColor→TRACKLINECOLORS, trailSize→TRACKLINEWIDTHS). Controls relabelled to "Track line color" and "Track line width" in TRACK STYLE section. Plan 54-06 completed full 8-param surface with all controls present.

  - id: GAP-54-04
    severity: minor
    in_scope: deferred
    sections: []
    title: Legend panel shows "Layer {id}" instead of layer name — affects all unnamed layers
    resolution: OPEN — Explicitly deferred to a separate post-milestone quick task. NOT a v1.9 blocker. Root: LayersLegendPanel.tsx ~213-218 fallback path. Pre-existing issue, not track-specific.

  - id: GAP-54-05
    severity: major
    in_scope: v1.9
    sections: [2.4]
    title: Point/shape params (POINTCOLORS/POINTOPACITY/POINTSIZES/POINTSHAPES/SHAPEFILLCOLORS/SHAPELINECOLORS/SHAPELINEWIDTHS) not suppressed under track mode
    resolution: RESOLVED — Plan 54-06 (TRACKFIX-V19-04): 7 delete params.* calls inside the enabled-track block in wmsUrlBuilder.ts. Runs after DOTRACKS set, regardless of raster or classbreak lane.

  - id: GAP-54-06
    severity: major
    in_scope: v1.9
    sections: [2.2, 2.4]
    title: Full 8 TRACK_* params not surfaced in UI or emitted (missing marker controls + OQ-9 TRACKHEADSHAPES misnaming)
    resolution: RESOLVED — Plan 54-06 (TRACKFIX-V19-05): Extended TrackConfig with markerColor/markerShape/markerSize; added 3 marker controls (color/shape/size) to TRACK STYLE; fixed OQ-9 misnaming (headShape now emits TRACKHEADSHAPES, markerShape emits TRACKMARKERSHAPES as distinct param); updated TRACK_DEFAULTS to Kinetica doc defaults.

  - id: GAP-54-07
    severity: major
    in_scope: v1.9
    sections: [3.1, 3.3]
    title: Categorical per-break track coloring does not render — tracks show single uniform color under Class Break
    resolution: RESOLVED — Plan 54-07 (TRACKFIX-V19-06): per-break colorList() helper uses cbColors.join(',') when CB configured; form gates 3 color control pairs on effectiveRenderMode !== "classbreak". Operator re-walk 2026-06-08: per-break colors confirmed on rendered track tiles.

  - id: GAP-54-08
    severity: major
    in_scope: v1.9
    sections: [7.1]
    title: Track info popup fails — "Failed to fetch info" toast, no network call
    resolution: RESOLVED — Plan 54-08 (TRACKFIX-V19-07): buildSpatialColumns extended with optional trackConfigJson 2nd param; threaded layer.track_config at all 3 call sites (MapChartRenderer info fan-out, InfoSelectionView handleLayerSwitch, InfoSelectionView loadNextPage). Operator re-walk 2026-06-08: info popup fires + returns records.

  - id: GAP-54-09
    severity: major
    in_scope: v1.9
    sections: [7.2]
    title: Draw-to-filter on track-shaped table no-ops — target stored as spatialMode:"track" fails isSpatialTargetEligible
    resolution: RESOLVED — Plan 54-09 (TRACKFIX-V19-08): displayMode coercion for legacy spatialMode:"track" rows + changeMode repopulation of lonCol/latCol from isTrackTable. SpatialTarget type and isSpatialTargetEligible byte-unchanged. Operator re-walk 2026-06-08: draw-to-filter filters track layer correctly.

  - id: GAP-54-10
    severity: major
    in_scope: v1.9
    sections: [7.2, 7.3]
    title: Map-only table (no chart/records widget) never triggers spatial materialize
    resolution: RESOLVED — Plan 54-10 (TRACKFIX-V19-09): useMapOnlySpatialMaterialize dashboard-scope hook mounted in DashboardOpen; NON_TRIGGER_TYPES allow-list preserves Phase 30 sole-trigger invariant. Operator attestation 2026-06-08: exactly one materialize fires; sole-trigger regression holds.
```

---

## Attestation Summary

```
overall_result: passed
sections_passed: §1 (1.1, 1.2, 1.3, 1.4, 1.5), §2 (2.1, 2.2, 2.3, 2.4), §3 (3.1, 3.2, 3.3), §5 (5.1), §6 (6.1, 6.2), §7 (7.1, 7.2, 7.3)
sections_failed: none
sections_skipped: §4 (4.1) — no stale-heatmap layer available; automated spec covers it
operator_notes: |
  Initial walk 2026-06-07: §1/§5/§6 PASS; §2/§3 FAIL on WMS never firing (GAP-54-01 CRITICAL).
  Gap-closure chain (plans 54-04 through 54-10) resolved all blocking gaps.
  Re-walk 2026-06-08:
    §1 (spatial mode + auto-suggest + DOUBLE x/y pickers + defaults): PASS — unchanged.
    §2 (Track+Raster): PASS — WMS fires, tiles render, full 8 TRACK_* params emitted, POINT*/SHAPE* suppressed.
    §3 (Track+Class Break): PASS — CB builder + TRACK STYLE correct; per-break categorical coloring renders on tiles.
    §5 color round-trip: PASS — unchanged.
    §6 latlon/WKT no-regression: PASS — unchanged.
    Post-walk §7: track info-popup PASS (54-08); track spatial filtering incl. map-only PASS (54-09 + 54-10).
  GAP-54-04 (legend "Layer N" names): OPEN — deferred to post-milestone quick task; explicitly NOT a v1.9 blocker.
  All other gaps (01, 03, 05, 06, 07, 08, 09, 10) RESOLVED.
attested_by: RPereira@kinetica.com
attested_on: 2026-06-08
```

---

## Traceability

| ROADMAP SC | Requirement | Covered by sections |
|---|---|---|
| SC2 | End-to-end track config — auto-suggest, defaults incl. DOUBLE x/y visible, both render modes | §1 + §2 + §3 |
| SC3 | Color picker exercised with alpha; saved tiles reflect chosen colors | §2 + §5 |
| SC4 | Track+Raster: TRACK STYLE only; Track+CB: CB builder + track params, per-break advanced hidden; heatmap not offered | §2 + §3 + §4 |

| Requirement ID | Description | Sections |
|---|---|---|
| VERIFY-V19-01 | Live operator walk-through — configure a track layer end-to-end via the new flow | §0–§8 (all) |
| RENDER-V19-01 | Silent heatmap→raster coercion when spatial mode switched to Track | §4 |
| COLOR-V19-01 | AARRGGBB color + alpha round-trip persistence | §2.3, §5 |

| Fix from commit | What it fixed | Attested by |
|---|---|---|
| 5e3514b | DOUBLE columns now visible in x/y numeric column pickers (were invisible, only int columns showed) | §1.3 |
| 138f5dc + 3916896 | GAP-54-01: track layers render — isConfigComplete gate now merges track_config correctly | §2, §3 |
| 54-05 commits | GAP-54-03: Track line color + Track line width controls relabelled and confirmed | §2.2 |
| cd51d4d + 23490d6 | GAP-54-05/06: suppression of 7 point/shape params + full 8 TRACK_* emission + OQ-9 fix | §2, §3 |
| 56d2d16 + 9b20ad2 + 7b51653 | GAP-54-07: per-break track color emission + form color gating | §3 |
| 70991f5 + 00d9ec7 | GAP-54-08: track info popup — buildSpatialColumns 2nd-arg threading | §7.1 |
| b8fea4b + f589dd9 | GAP-54-09: track spatial-target translation at all MapConfigPanel paths | §7.2 |
| fff2859 + 071acb8 + 5b7a8d6 | GAP-54-10: useMapOnlySpatialMaterialize hook — map-only materialize trigger | §7.2, §7.3 |

## Gap-Closure Routing

| Gap ID | Severity | Owner | Status |
|--------|----------|-------|--------|
| GAP-54-01 | blocking (CRITICAL) | 54-04 | RESOLVED — Plan 54-04 (TRACKFIX-V19-01) |
| GAP-54-02 | major | 54-07 | RESOLVED — Plan 54-07 (TRACKFIX-V19-06) |
| GAP-54-03 | minor | 54-05/06 | RESOLVED — Plans 54-05 (label) + 54-06 (full surface) |
| GAP-54-04 | minor | post-milestone quick task | OPEN — deferred; not a v1.9 blocker |
| GAP-54-05 | major | 54-06 | RESOLVED — Plan 54-06 (TRACKFIX-V19-04) |
| GAP-54-06 | major | 54-06 | RESOLVED — Plan 54-06 (TRACKFIX-V19-05) |
| GAP-54-07 | major | 54-07 | RESOLVED — Plan 54-07 (TRACKFIX-V19-06) |
| GAP-54-08 | major | 54-08 | RESOLVED — Plan 54-08 (TRACKFIX-V19-07) |
| GAP-54-09 | major | 54-09 | RESOLVED — Plan 54-09 (TRACKFIX-V19-08) |
| GAP-54-10 | major | 54-10 | RESOLVED — Plan 54-10 (TRACKFIX-V19-09) |
