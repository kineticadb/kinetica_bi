# Phase 71: SHAPE* Hidden for Lat/Lon Point Layers - Context

**Gathered:** 2026-06-18
**Status:** Ready for planning
**Source:** Orchestrator-authored (autonomous run; user pre-approved all edits, requirements well-defined)

<domain>
## Phase Boundary

SHAPE* WMS style params (SHAPEFILLCOLORS / SHAPELINECOLORS / SHAPELINEWIDTHS) style polygon/line geometry — they do nothing for point (lat/lon) layers. Today they are always shown under raster mode and emitted for any spatial mode (mislabeled "(WKT)"). This phase HIDES the SHAPE* fields in the config UI AND suppresses their WMS emission when `spatialMode === "latlon"`, for BOTH point raster and class-break (cb) raster. Point styling (POINTCOLORS/POINTSIZES/POINTSHAPES/POINTOPACITY) and antialiasing are unaffected.

Precedent: v1.9 Phase 53 already suppresses POINT*/SHAPE* under TRACK mode via `spatialMode !== "track"` gates + `trackContext` prop — this phase adds the analogous `latlon` gate for the SHAPE* subset only.

FRONTEND-ONLY (`packages/web`). Zero server diff expected. Flag any server diff as a deviation.

Covers requirements: **SHAPE-V114-01, SHAPE-V114-02, SHAPE-V114-03**.
</domain>

<decisions>
## Implementation Decisions (LOCKED)

### What "SHAPE*" means here (hide/suppress ONLY these)
- SHAPEFILLCOLORS (+ its alpha control), SHAPELINECOLORS (+ its alpha control), SHAPELINEWIDTHS.
- DO NOT hide/suppress: Point color/alpha/size/opacity/shape (POINT*), Antialiasing, or any classbreak CB_VALS/POINTCOLORS. Points legitimately use POINT* styling.

### SHAPE-V114-01 — Layer-level raster SHAPE* fields (point raster)
- In `KineticaWmsLayerForm.tsx`, the raster-params group renders SHAPE* fields at **lines 1184-1313**: "Shape fill color (WKT)" + "Shape fill alpha" + "Shape line color (WKT)" + "Shape line alpha" + "Shape line width". Wrap exactly these five `<label>` blocks in a `{spatialMode !== "latlon" && ( ... )}` gate.
- The enclosing raster group is already gated `effectiveRenderMode === "raster" && spatialMode !== "track"` (line 1067) — so this only adds the latlon exclusion for the SHAPE* subset. Point color/size/opacity/shape and the Antialiasing toggle (line 1315) stay visible for latlon.
- Optional cleanup: the "(WKT)" label suffix is now accurate (fields only show for wkt/wkb) — leave as-is or keep; not required.

### SHAPE-V114-02 — Per-break SHAPE* advanced fields (cb raster)
- In `CbConfigForm.tsx`, the per-break advanced panel (**lines 957-1064**, gated `!trackContext && expandedRows.has(i)`) contains, in order: Point size, Point shape, **Shape line width**, **Shape line color**, **Shape fill color**. Hide ONLY the last three (the SHAPE* trio at ~lines 990-1064) when in latlon mode. Keep Point size + Point shape (valid for points).
- CbConfigForm has no spatial-mode awareness today; it receives a `trackContext?: boolean` prop (declared at line 74, destructured at line 114, mounted at `KineticaWmsLayerForm.tsx:1418` as `trackContext={spatialMode === "track"}`). Add an analogous prop — name it `hideShapeParams?: boolean` (or `pointContext`) — declared + destructured the same way, and passed from the mount as `hideShapeParams={spatialMode === "latlon"}` (mount block at `KineticaWmsLayerForm.tsx:1406-1420`). Then wrap the SHAPE* trio in `{!hideShapeParams && ( ... )}`.

### SHAPE-V114-03 — Suppress SHAPE* WMS emission for latlon
- In `wmsUrlBuilder.ts`, gate SHAPE* emission on `config.spatialMode !== "latlon"` at BOTH branches:
  - **Raster branch (lines 340-349):** the three `if (config.shapeFillColor !== undefined)` / `shapeLineColor` / `shapeLineWidth` blocks emitting SHAPEFILLCOLORS / SHAPELINECOLORS / SHAPELINEWIDTHS. Keep POINTCOLORS/POINTOPACITY/POINTSIZES/POINTSHAPES/ANTIALIASING unconditional.
  - **Classbreak branch (lines ~405-413):** the three optional `cb.breaks.some(... shapeLineWidth/shapeLineColor/shapeFillColor ...)` blocks emitting SHAPELINEWIDTHS / SHAPELINECOLORS / SHAPEFILLCOLORS. Keep CB_ATTR/CB_VALS/POINTCOLORS/POINTSIZES/POINTSHAPES unconditional.
- This is the leak-prevention requirement: a layer with stale saved `shapeFillColor`/`shapeLineColor`/`shapeLineWidth` values (saved before this change, or after switching the layer to latlon) MUST NOT emit those SHAPE* params once spatialMode is latlon. Hiding the UI fields does NOT clear saved values — so the builder gate is what actually prevents the leak.
- Do NOT delete the saved config values — only gate emission. Switching back to wkt/wkb restores the params from the still-present config values.

### Claude's Discretion
- Exact prop name (`hideShapeParams` vs `pointContext` vs `hideShapeStyleFields`) — pick one and use it consistently. `hideShapeParams` is suggested for clarity.
- Whether to also drop the "(WKT)" suffix from the two color labels now that they're wkt/wkb-only (cosmetic).
- Spec-test placement (extend existing `KineticaWmsLayerForm.spec.tsx`, `CbConfigForm.spec.tsx`, `wmsUrlBuilder.spec.ts`).
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Spatial mode type
- `packages/web/src/lib/columnTypes.ts:242` — `type SpatialMode = "latlon" | "wkt" | "wkb" | "track"`.

### WMS emission (the leak-prevention change — SHAPE-V114-03)
- `packages/web/src/lib/wmsUrlBuilder.ts`:
  - Spatial-mode branch (context): **lines 301-320** (`config.spatialMode === "latlon"` sets X/Y from lon/lat).
  - Raster SHAPE* emission: **lines 340-349** (SHAPEFILLCOLORS/SHAPELINECOLORS/SHAPELINEWIDTHS — gate on `!== "latlon"`).
  - Classbreak SHAPE* emission: **lines ~405-413** (the optional per-break SHAPE* arrays — gate on `!== "latlon"`).

### Layer-form raster SHAPE* fields (SHAPE-V114-01)
- `packages/web/src/components/charts/KineticaWmsLayerForm.tsx`:
  - Raster group gate: **line 1067** (`effectiveRenderMode === "raster" && spatialMode !== "track"`).
  - SHAPE* labels to wrap in `spatialMode !== "latlon"`: **lines 1184-1313** (fill color+alpha, line color+alpha, line width). Antialiasing at **1315** stays.
  - `spatialMode` variable is already in scope in this component (used at line 1067, 1418, etc.).

### CbConfigForm per-break SHAPE* (SHAPE-V114-02) + prop threading
- `packages/web/src/components/charts/CbConfigForm.tsx`:
  - Props type: **line 46** (`type CbConfigFormProps`), `trackContext?: boolean` at **line 74**, destructured at **line 114**.
  - Per-break advanced panel: **lines 957-1064**; the SHAPE* trio (shape line width / shape line color / shape fill color) at **~990-1064** is what to wrap in `!hideShapeParams`. Point size (961) + Point shape (976) stay.
- `packages/web/src/components/charts/KineticaWmsLayerForm.tsx:1406-1420` — CbConfigForm mount; `trackContext={spatialMode === "track"}` at **1418** is the pattern to mirror with `hideShapeParams={spatialMode === "latlon"}`.

### Precedent
- v1.9 Phase 53 (RENDER-V19-02/03): the existing `spatialMode !== "track"` raster gate + `trackContext` prop that suppress POINT*/SHAPE* under track. This phase is the same shape for the latlon SHAPE* subset.
</canonical_refs>

<specifics>
## Specific Ideas

Regression tests should assert:
- `wmsUrlBuilder` with `spatialMode: "latlon"` + a config carrying `shapeFillColor`/`shapeLineColor`/`shapeLineWidth` → result has NO `SHAPEFILLCOLORS`/`SHAPELINECOLORS`/`SHAPELINEWIDTHS` keys (leak prevention). Same for the classbreak branch with per-break shape fields set.
- `wmsUrlBuilder` with `spatialMode: "wkt"` (or "wkb") + the same config → SHAPE* params ARE emitted (no regression for polygon/line layers).
- `KineticaWmsLayerForm` in raster mode: SHAPE* labels absent when `spatialMode==="latlon"`, present when `wkt`; Point color/size still present in both.
- `CbConfigForm`: with `hideShapeParams` (latlon), expanding a break row shows Point size/shape but NOT the shape line/fill fields; without it (wkt), all advanced fields show.
</specifics>

<deferred>
## Deferred Ideas

None — phase scope fully captured.
</deferred>

---

*Phase: 71-shape-params-latlon-hide*
*Context gathered: 2026-06-18 (autonomous orchestrator run)*
