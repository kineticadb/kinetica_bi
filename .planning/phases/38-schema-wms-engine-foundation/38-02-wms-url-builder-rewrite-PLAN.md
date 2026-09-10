---
phase: 38-schema-wms-engine-foundation
plan: 02
type: execute
wave: 2
depends_on:
  - 38-01
files_modified:
  - kinetica_bi/src/lib/wmsUrlBuilder.ts
  - kinetica_bi/src/lib/wmsUrlBuilder.spec.ts
  - kinetica_bi/src/api/client.ts
  - kinetica_bi/src/components/charts/MapChartRenderer.tsx
autonomous: true
requirements:
  - SCHEMA-V17-03
  - SCHEMA-V17-04
  - SCHEMA-V17-05
gap_closure: false

must_haves:
  truths:
    - "SC3: wmsUrlBuilder.buildWmsParams for a classbreak layer emits colors as 8-char AARRGGBB (not 6-char RRGGBB); a regression spec locks this format so the bug cannot silently re-appear."
    - "wmsUrlBuilder emits STYLES=cb_raster (Lane C) when cb_config is configured — NEVER STYLES=classbreak (Lane B is documented in 37-SPIKE-NOTES.md only; not used in production code)."
    - "Per the operator-confirmed CB_RASTER + comma-separated POINTCOLORS/POINTSIZES/POINTSHAPES model, wmsUrlBuilder emits Lane C param names verbatim from 37-SPIKE-NOTES.md ## Decision (no CB_POINTCOLOR_N indexed naming, no CB_BREAK_POINT_N)."
    - "Track block is APPENDED additively after the render-mode branch, gated on `trackConfig.enabled === true && (renderMode === \"raster\" || renderMode === \"classbreak\")`; legacy widgets (trackConfig === undefined OR enabled !== true) produce IDENTICAL WMS URLs to pre-v1.7 (backward-compat snapshot locks this)."
    - "Under STYLES=cb_raster, TRACK_* params are emitted comma-separated with length matching CB_VALS length; under STYLES=raster, TRACK_* params are single-value (per 37-SPIKE-NOTES.md ## Decision DOTRACKS+TRACK_* matrix)."
    - "DashboardLayerDto on the frontend mirrors the server-side DashboardLayer extension byte-for-byte (cb_config + track_config raw JSON strings) so the form UI in Phase 39+40 round-trips."
    - "MapChartRenderer.lastEmittedParamsRef fingerprint covers cb_config + track_config JSON so style edits trigger updateParams re-fire (no silent cache-bust misses)."
  artifacts:
    - path: "kinetica_bi/src/lib/wmsUrlBuilder.ts"
      provides: "Lane C cb_raster branch keyed on coalesceCbConfig(layer.cb_config); 8-char AARRGGBB via normalizeAARRGGBB; STYLES_BY_MODE.classbreak swap to cb_raster; new Track block appended; buildWmsParams signature accepts layer.cb_config + layer.track_config indirectly via per-layer wrapper"
      contains: "POINTCOLORS"
    - path: "kinetica_bi/src/lib/wmsUrlBuilder.spec.ts"
      provides: "Regression specs for: 8-char color emission lock, Lane C param-name set, cb_config-null → raster fall-through, Track block comma-sep under cb_raster + single-value under raster, backward-compat URL snapshot for legacy trackConfig===undefined widgets"
      contains: "AARRGGBB"
    - path: "kinetica_bi/src/api/client.ts"
      provides: "DashboardLayerDto extended with cb_config: string | null + track_config: string | null mirroring server DashboardLayer; updateLayer Pick<> extended"
      contains: "cb_config: string | null"
    - path: "kinetica_bi/src/components/charts/MapChartRenderer.tsx"
      provides: "lastEmittedParamsRef fingerprint includes cb_config + track_config JSON so style edits via PATCH coalesce to updateParams re-fire"
      contains: "cb_config"
  key_links:
    - from: "kinetica_bi/src/lib/wmsUrlBuilder.ts line 146-149 STYLES_BY_MODE"
      to: "kinetica_bi/src/lib/wmsUrlBuilder.ts new cb_raster branch"
      via: "classbreak key value swapped from 'classbreak' to 'cb_raster' so params.STYLES emits cb_raster when renderMode === 'classbreak'"
      pattern: 'classbreak: "cb_raster"'
    - from: "kinetica_bi/src/lib/cbConfig.ts coalesceCbConfig (from Plan 38-01)"
      to: "kinetica_bi/src/lib/wmsUrlBuilder.ts cb_raster branch"
      via: "wmsUrlBuilder calls coalesceCbConfig(layer.cb_config) at branch entry"
      pattern: "coalesceCbConfig"
    - from: "kinetica_bi/src/lib/colorHex.ts normalizeAARRGGBB"
      to: "kinetica_bi/src/lib/wmsUrlBuilder.ts POINTCOLORS comma-sep emission"
      via: "breaks.map(b => normalizeAARRGGBB(b.color, 'FF000000')).join(',')"
      pattern: "normalizeAARRGGBB"
    - from: "kinetica_bi/src/api/client.ts DashboardLayerDto"
      to: "kinetica_bi/server/src/types.ts DashboardLayer (Plan 38-01 extension)"
      via: "byte-parity raw JSON strings on the wire (cb_config + track_config)"
      pattern: "cb_config: string | null"
    - from: "kinetica_bi/src/components/charts/MapChartRenderer.tsx lastEmittedParamsRef fingerprint"
      to: "wmsUrlBuilder param emission"
      via: "JSON.stringify of params dict already covers all wmsUrlBuilder output; ADD layer.cb_config + layer.track_config to the per-layer fingerprint key so PATCH-coalesced edits trigger updateParams"
      pattern: "lastEmittedParamsRef"

key_links:
  - ".planning/phases/38-schema-wms-engine-foundation/38-CONTEXT.md (locked decisions — STYLES always cb_raster, hard cutover, NO read-shim for legacy config.classbreaks[], normalizeAARRGGBB re-use)"
  - ".planning/phases/37-cb-track-wms-spike/37-SPIKE-NOTES.md ## Decision (CANONICAL — Lane C param-name set verbatim: STYLES=cb_raster + CB_ATTR + CB_VALS + POINTCOLORS + POINTSIZES + POINTSHAPES + SHAPELINEWIDTHS + SHAPELINECOLORS + SHAPEFILLCOLORS; TRACK_* matrix under raster vs cb_raster)"
  - "kinetica_bi/src/lib/wmsUrlBuilder.ts:25 (normalizeAARRGGBB import — already in scope)"
  - "kinetica_bi/src/lib/wmsUrlBuilder.ts:146-149 (STYLES_BY_MODE map — swap classbreak value from 'classbreak' to 'cb_raster')"
  - "kinetica_bi/src/lib/wmsUrlBuilder.ts:325-340 (current classbreak branch — DELETE; replace with cb_raster branch reading from coalesceCbConfig(layer.cb_config))"
  - "kinetica_bi/src/lib/cbConfig.ts (Plan 38-01 output — type contracts + coalesceCbConfig consumed by this plan's wmsUrlBuilder rewrite)"
  - "kinetica_bi/src/api/client.ts:454-476 (DashboardLayerDto — extend with cb_config + track_config to mirror server-side from Plan 38-01)"
  - "kinetica_bi/src/components/charts/MapChartRenderer.tsx:574 + :1110-1195 (lastEmittedParamsRef fingerprint — extend per-layer key to include cb_config + track_config JSON)"
  - "kinetica_bi/src/lib/wmsUrlBuilder.spec.ts:115-155 (existing per-mode branch test layout — add new describe block for cb_raster + Track)"
---

<objective>
Replace the legacy `STYLES=classbreak` Lane A branch in `wmsUrlBuilder.ts` with the operator-confirmed `STYLES=cb_raster` Lane C path keyed on `cb_config`, fix the 6-char color bug as a natural side-effect (`normalizeAARRGGBB`), append the new Track block per the 37-SPIKE-NOTES.md DOTRACKS+TRACK_* matrix, extend the frontend `DashboardLayerDto` to mirror Plan 38-01's server type extension, and extend `MapChartRenderer.lastEmittedParamsRef` so style edits trigger tile re-render.

Purpose: SCHEMA-V17-03 + SCHEMA-V17-04 + SCHEMA-V17-05. Hard cutover from legacy `config.cbColumn` / `config.classbreaks[]` — those fields stay in MapWidgetConfig type for back-compat but are no longer READ by wmsUrlBuilder.

Output: wmsUrlBuilder emits Lane C verbatim from 37-SPIKE-NOTES.md ## Decision; regression specs lock 8-char color format + Lane C param names + Track block matrix + legacy backward-compat URL snapshot.
</objective>

<execution_context>
@/Users/rydelpereira/.claude/get-shit-done/workflows/execute-plan.md
@/Users/rydelpereira/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/REQUIREMENTS.md
@.planning/phases/38-schema-wms-engine-foundation/38-CONTEXT.md
@.planning/phases/37-cb-track-wms-spike/37-SPIKE-NOTES.md
@.planning/phases/38-schema-wms-engine-foundation/38-01-SUMMARY.md
@kinetica_bi/src/lib/cbConfig.ts
@kinetica_bi/src/lib/colorHex.ts

<interfaces>
<!-- Locked Lane C param-name set from 37-SPIKE-NOTES.md ## Decision (CANONICAL). -->
<!-- Phase 38-02 wmsUrlBuilder emits these names verbatim — no Lane A (CB_POINTCOLOR_N indexed) and no Lane B (CB_POINTCOLORS under STYLES=classbreak) production code paths. -->

<!-- REQUIREMENTS.md naming supplant lock: SCHEMA-V17-03's `CB_*` prefix naming in
     pre-update REQUIREMENTS.md was supplanted by 37-SPIKE-NOTES.md § Decision § CB
     param-name set locked per render mode. Phase 38 emits Lane C: CB_ATTR / CB_VALS /
     POINTCOLORS / POINTSIZES / POINTSHAPES / SHAPELINEWIDTHS / SHAPELINECOLORS /
     SHAPEFILLCOLORS under STYLES=cb_raster (canonical naming locked). REQUIREMENTS.md
     SCHEMA-V17-03 was updated in this revision to use Lane C names. -->

Lane C param-name set under STYLES=cb_raster (37-SPIKE-NOTES.md lines 268-277):
```
STYLES=cb_raster
CB_ATTR=<column>
CB_VALS=<comma-separated values; supports <other> verbatim>
POINTCOLORS=<comma-separated 8-char AARRGGBB>          // normalizeAARRGGBB(b.color, "FF000000")
POINTSIZES=<comma-separated integers, optional>
POINTSHAPES=<comma-separated shape names, optional>
SHAPELINEWIDTHS=<comma-separated integers, optional>
SHAPELINECOLORS=<comma-separated 8-char AARRGGBB, optional>
SHAPEFILLCOLORS=<comma-separated 8-char AARRGGBB, optional>
X_ATTR=<config.lonColumn>                                // existing spatial branch — unchanged
Y_ATTR=<config.latColumn>                                // existing spatial branch — unchanged
```

Track block matrix from 37-SPIKE-NOTES.md ## Decision (lines 301-322):

Under STYLES=raster (single-value emission — renderMode === "raster"):
```
DOTRACKS=TRUE
TRACK_ID_ATTR=<column, default TRACKID>
TRACK_ORDER_ATTR=<column, default TIMESTAMP>
TRACKHEADCOLORS=<single 8-char AARRGGBB>
TRACKLINECOLORS=<single 8-char AARRGGBB>
TRACKHEADSIZES=<single integer>
TRACKLINEWIDTHS=<single integer>
TRACKMARKERSHAPES=<single shape name>
```

Under STYLES=cb_raster (comma-separated emission, N = cb_config.breaks.length — renderMode === "classbreak"):
```
DOTRACKS=TRUE
TRACK_ID_ATTR=<column>
TRACK_ORDER_ATTR=<column>
TRACKHEADCOLORS=<N comma-separated 8-char AARRGGBB>
TRACKLINECOLORS=<N comma-separated 8-char AARRGGBB>
TRACKHEADSIZES=<N comma-separated integers>
TRACKLINEWIDTHS=<N comma-separated integers>
TRACKMARKERSHAPES=<N comma-separated shape names>
```

Frontend DashboardLayerDto extension (kinetica_bi/src/api/client.ts:454-476) — byte-parity with Plan 38-01 server type:
```typescript
// v1.7 Phase 38 (SCHEMA-V17-01/02): classbreak + track config JSON columns.
// Raw JSON strings on the wire — frontend deserializes via lib/cbConfig.ts
// coalesceCbConfig() at consumer sites (wmsUrlBuilder + future Phase 39 form).
cb_config: string | null;
track_config: string | null;
```

updateLayer Pick<> extension (kinetica_bi/src/api/client.ts:498-518):
```typescript
| "cb_config"
| "track_config"
```

TrackConfig type (NEW — declared inline in wmsUrlBuilder.ts since this is the first consumer; Phase 40 form UI may extract to lib/trackConfig.ts if needed):
```typescript
export type TrackConfig = {
  enabled: boolean;
  trackIdAttr?: string;       // default "TRACKID" when emitted
  trackOrderAttr?: string;    // default "TIMESTAMP" when emitted
  headColor?: string;         // 8-char AARRGGBB; single-value under raster, comma-sep under cb_raster (expanded to N)
  trailColor?: string;        // single-value or comma-sep (N)
  headSize?: number;
  trailSize?: number;         // NOTE: spec uses trailSize, emitted as TRACKLINEWIDTHS (yes the name mismatch is locked by 38-CONTEXT.md domain shape)
  lineWidth?: number;         // optional; same emission column as trailSize when both present — prefer trailSize for legacy compat
  headShape?: string;
};

export function coalesceTrackConfig(raw: string | null): TrackConfig {
  if (raw === null) return { enabled: false };
  try { return JSON.parse(raw) as TrackConfig; } catch { return { enabled: false }; }
}
```

buildWmsParams signature extension — the existing function accepts MapWidgetConfig only; for Lane C + Track we ALSO need access to the layer row's raw cb_config + track_config strings. ADD a new optional 5th param `layerJsonFields?: { cb_config: string | null; track_config: string | null }`. Callers from MapChartRenderer Effects 2+3 pass it (typed via DashboardLayerDto subset). When undefined, the cb_raster branch is suppressed (raster fallback) — preserves backward compat with any 2-arg legacy test caller.

MapChartRenderer fingerprint extension (kinetica_bi/src/components/charts/MapChartRenderer.tsx:1110 + 1193-1195):
```typescript
// Existing line 1110: lastEmittedParamsRef.current.set(layer.id, JSON.stringify(wmsParams));
// Existing line 1193-1195: const fingerprint = JSON.stringify(wmsParams); if (last === fingerprint) continue; ...
//
// EXTEND the fingerprint by appending the layer's raw JSON strings — when cb_config or
// track_config changes via PATCH-coalesce (Phase 39 auto-save debounce), the fingerprint
// shifts and updateParams re-fires even though wmsParams may not have computed yet (race).
const fingerprint = JSON.stringify({ p: wmsParams, c: layer.cb_config, t: layer.track_config });
```
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: wmsUrlBuilder rewrite — STYLES_BY_MODE swap + Lane C cb_raster branch + Track block + 8-char color fix + buildWmsParams signature extension</name>
  <files>kinetica_bi/src/lib/wmsUrlBuilder.ts, kinetica_bi/src/lib/wmsUrlBuilder.spec.ts</files>
  <read_first>
    - kinetica_bi/src/lib/wmsUrlBuilder.ts:1-360 (FULL FILE — understand the 4-case LAYERS precedence, spatial mode branch, render-mode branch structure; the cb_raster branch will SLOT IN at the same indent level as the existing renderMode === "classbreak" branch, REPLACING it)
    - kinetica_bi/src/lib/wmsUrlBuilder.ts:25 (`import { normalizeAARRGGBB } from "./colorHex";` — already in scope; raster + heatmap branches use it for SHAPE colors)
    - kinetica_bi/src/lib/wmsUrlBuilder.ts:27 (RenderMode type — stays at 4 values per 38-CONTEXT.md; Phase 39 form filters in the picker)
    - kinetica_bi/src/lib/wmsUrlBuilder.ts:80-97 (MapWidgetConfig — note legacy `cbColumn` / `cbBreakType` / `classbreaks?` fields STAY in the type for back-compat; this plan stops READING them but does NOT delete them)
    - kinetica_bi/src/lib/wmsUrlBuilder.ts:146-149 (STYLES_BY_MODE map — change `classbreak: "classbreak"` → `classbreak: "cb_raster"`)
    - kinetica_bi/src/lib/wmsUrlBuilder.ts:325-340 (CURRENT classbreak branch — Lane A naming `CB_COLUMN_NAME` / `CB_BREAK_POINT_N` / `CB_POINTCOLOR_N`; ALL OF THIS DELETED in this plan)
    - kinetica_bi/src/lib/wmsUrlBuilder.spec.ts:1-50 + :115-180 (existing test layout — describe blocks per concern; ADD new describe blocks for Lane C cb_raster + Track + 8-char color regression + backward-compat snapshot)
    - kinetica_bi/src/lib/cbConfig.ts (Plan 38-01 output — coalesceCbConfig + isCbConfigConfigured + CbConfig + CbBreak shapes consumed here)
    - kinetica_bi/src/lib/colorHex.ts (normalizeAARRGGBB signature: `(hex: string | undefined, fallback: string = "FFFFFFFF") => string` returning 8-char uppercase)
    - .planning/phases/37-cb-track-wms-spike/37-SPIKE-NOTES.md ## Decision (lines 251-323 — VERBATIM Lane C param-name set + TRACK_* matrix; copy these into the new code paths verbatim)
    - .planning/phases/38-schema-wms-engine-foundation/38-CONTEXT.md §"STYLES decision logic" + §"Track block in wmsUrlBuilder" + §"6-char color bug fix" (locked code shape)
  </read_first>
  <behavior>
    Lane C cb_raster branch (replacing the deleted classbreak branch):
    - When renderMode === "classbreak" AND layerJsonFields?.cb_config is set AND coalesceCbConfig(cb_config) yields isCbConfigConfigured === true: emit STYLES=cb_raster + CB_ATTR=<cfg.attr> + CB_VALS=<comma-sep cfg.breaks[].value> + POINTCOLORS=<comma-sep normalizeAARRGGBB(b.color, "FF000000")>; conditionally emit POINTSIZES / POINTSHAPES / SHAPELINEWIDTHS / SHAPELINECOLORS / SHAPEFILLCOLORS comma-sep only when AT LEAST ONE break has the corresponding field (skip emission when all are undefined to keep the URL clean).
    - When renderMode === "classbreak" AND cb_config is null OR isCbConfigConfigured === false: fall through to raster-equivalent param set (STYLES_BY_MODE will still emit "cb_raster" but no CB_* params → Kinetica renders as plain cb_raster which is functionally raster without CB; existing legacy widgets with config.classbreaks[] but no cb_config render as raster-like since wmsUrlBuilder does NOT read config.classbreaks[]).
    - 8-char color regression: a CbBreak with color "112233" (6-char) emits "FF112233" in POINTCOLORS (normalizeAARRGGBB fallback FF prefix).
    - `<other>` keyword: a CbBreak with value === "<other>" emits the LITERAL string "<other>" in CB_VALS (no URL encoding done by this builder — caller URLSearchParams handles that).
    Track block:
    - When trackConfig?.enabled === true AND renderMode === "raster": emit DOTRACKS=TRUE + TRACK_ID_ATTR (default "TRACKID") + TRACK_ORDER_ATTR (default "TIMESTAMP") + single-value TRACK_* params from track_config.
    - When trackConfig?.enabled === true AND renderMode === "classbreak" AND isCbConfigConfigured: emit DOTRACKS=TRUE + TRACK_ID_ATTR + TRACK_ORDER_ATTR + COMMA-SEPARATED TRACK_* params expanded to N = cb_config.breaks.length (replicate the single value N times, e.g. headColor "FFFF0000" with 3 breaks → TRACKHEADCOLORS="FFFF0000,FFFF0000,FFFF0000").
    - When trackConfig === undefined OR enabled !== true OR renderMode === "heatmap": NO Track block params emitted (backward-compat snapshot).
    Backward-compat:
    - Legacy widget config with no cb_config (null) + no track_config (null) + renderMode === "raster": URL bit-identical to the pre-v1.7 raster URL (snapshot regression spec).
    - Legacy widget with renderMode === "classbreak" + config.classbreaks[] populated but cb_config === null: NO CB_* params emitted; STYLES=cb_raster (per STYLES_BY_MODE swap) but the tile renders as raster-equivalent.
  </behavior>
  <action>
    Edit `kinetica_bi/src/lib/wmsUrlBuilder.ts`:

    (A) Add imports at top (after line 25 `normalizeAARRGGBB` import):

    ```typescript
    import { coalesceCbConfig, isCbConfigConfigured, type CbConfig, type CbBreak } from "./cbConfig";
    ```

    (B) Add `TrackConfig` type + `coalesceTrackConfig` helper inline (between line 28 ClassbreakBreak type and line 30 PointShape type). Locked shape:

    ```typescript
    // v1.7 Phase 38 (SCHEMA-V17-01): track styling config carried in dashboard_layers.track_config
    // (raw JSON TEXT). Phase 40 form UI populates this; wmsUrlBuilder reads via
    // coalesceTrackConfig(layer.track_config) at the Track block (gated on enabled === true).
    // NO separate lib/trackConfig.ts module — single consumer (wmsUrlBuilder) for now;
    // Phase 40 may extract if a second consumer surfaces.
    export type TrackConfig = {
      enabled: boolean;
      trackIdAttr?: string;       // default "TRACKID" when omitted at emission time
      trackOrderAttr?: string;    // default "TIMESTAMP" when omitted at emission time
      headColor?: string;         // 8-char AARRGGBB
      trailColor?: string;        // 8-char AARRGGBB
      headSize?: number;
      trailSize?: number;         // emitted as TRACKLINEWIDTHS
      lineWidth?: number;         // alias for trailSize; trailSize takes precedence when both set
      headShape?: string;
    };

    /** Parse raw track_config JSON. Returns { enabled: false } on null or parse failure. */
    export function coalesceTrackConfig(raw: string | null): TrackConfig {
      if (raw === null) return { enabled: false };
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && "enabled" in parsed) {
          return parsed as TrackConfig;
        }
        return { enabled: false };
      } catch {
        return { enabled: false };
      }
    }
    ```

    (C) Change `STYLES_BY_MODE` at line 146-149 — swap `classbreak` value:

    ```typescript
    // STYLES values per render mode — from 11-SPIKE-NOTES.md "STYLES values per render mode" table +
    // 37-SPIKE-NOTES.md ## Decision (Phase 37 Lane C lock: STYLES=cb_raster is the production CB
    // emission path; STYLES=classbreak Lane B remains in 37-SPIKE-NOTES.md as documentation only).
    // raster/heatmap confirmed in GetCapabilities XML + GetMap probe.
    // cb_raster: confirmed by Phase 37 Lane C probes — distinct from baseline (15597 vs 27384 bytes).
    // contour: NOT in GetCapabilities XML but returns HTTP 200 on GetMap probe (dead code path —
    //   RenderMode type keeps the value but Phase 39 form picker filters to 3 user-facing modes).
    const STYLES_BY_MODE: Record<RenderMode, string> = {
      raster: "raster",
      heatmap: "heatmap",
      classbreak: "cb_raster",   // v1.7 Phase 38 (SCHEMA-V17-03): single CB path = Lane C
      contour: "contour",
    };
    ```

    (D) Extend `buildWmsParams` signature — add a new optional 5th parameter `layerJsonFields?: { cb_config: string | null; track_config: string | null }`:

    Replace the existing overload signatures (line 189-198) with:

    ```typescript
    export function buildWmsParams(
      config: MapWidgetConfig,
      materializeVersion: number | undefined,
    ): Record<string, string>;
    export function buildWmsParams(
      config: MapWidgetConfig,
      materializeVersion: number | undefined,
      dynamicViewEntry: DynamicViewEntryInput | undefined,
      dynamicViewVersion: number | undefined,
    ): Record<string, string> | null;
    export function buildWmsParams(
      config: MapWidgetConfig,
      materializeVersion: number | undefined,
      dynamicViewEntry: DynamicViewEntryInput | undefined,
      dynamicViewVersion: number | undefined,
      // v1.7 Phase 38 (SCHEMA-V17-03/04): raw cb_config + track_config JSON strings from the
      // layer row. Phase 38-02 reads them via coalesceCbConfig + coalesceTrackConfig at the
      // render-mode + Track branches. When undefined (legacy 2-arg / 4-arg callers from
      // Phase 16 + Phase 35), cb_raster branch suppresses CB_* emission and Track block
      // does not fire — backward-compat preserved.
      layerJsonFields: { cb_config: string | null; track_config: string | null },
    ): Record<string, string> | null;
    ```

    Update the implementation signature line 199-206:

    ```typescript
    export function buildWmsParams(
      config: MapWidgetConfig,
      materializeVersion: number | undefined,
      dynamicViewEntry?: DynamicViewEntryInput,
      dynamicViewVersion?: number,
      layerJsonFields?: { cb_config: string | null; track_config: string | null },
    ): Record<string, string> | null {
    ```

    (E) DELETE lines 325-340 (the existing `} else if (config.renderMode === "classbreak") { ... }` block — ALL of it including CB_COLUMN_NAME / CB_BREAK_TYPE / CB_BREAK_POINT_N / CB_POINTCOLOR_N).

    REPLACE with the new Lane C cb_raster branch — slot it in BETWEEN the heatmap `}` (around line 324) and the existing contour `} else if (config.renderMode === "contour") {`:

    ```typescript
      } else if (config.renderMode === "classbreak") {
        // v1.7 Phase 38 (SCHEMA-V17-03/04/05): Lane C cb_raster emission per
        // 37-SPIKE-NOTES.md ## Decision. STYLES is already "cb_raster" via
        // STYLES_BY_MODE swap. Hard cutover lock: NO read of legacy config.cbColumn
        // / config.cbBreakType / config.classbreaks[] — those fields remain on
        // MapWidgetConfig for back-compat but are NEVER read here.
        //
        // 6-char color bug fix (SCHEMA-V17-05): POINTCOLORS emitted via
        // normalizeAARRGGBB(b.color, "FF000000") — same conformance as raster +
        // heatmap branches. Legacy 6-char break colors become FF + RRGGBB.
        //
        // <other> keyword (Phase 37 OQ-3 PASS): wmsUrlBuilder emits breaks[].value
        // verbatim into CB_VALS — caller URLSearchParams handles encoding.
        const cb = layerJsonFields ? coalesceCbConfig(layerJsonFields.cb_config) : null;
        if (cb && isCbConfigConfigured(cb)) {
          params.CB_ATTR = cb.attr;
          params.CB_VALS = cb.breaks.map((b: CbBreak) => String(b.value)).join(",");
          params.POINTCOLORS = cb.breaks.map((b: CbBreak) => normalizeAARRGGBB(b.color, "FF000000")).join(",");
          // Optional per-break fields — emit only when at least one break has the field set
          // (keeps URL clean for the common case where operator hasn't touched advanced params).
          if (cb.breaks.some((b: CbBreak) => b.pointSize !== undefined)) {
            params.POINTSIZES = cb.breaks.map((b: CbBreak) => String(b.pointSize ?? 4)).join(",");
          }
          if (cb.breaks.some((b: CbBreak) => b.pointShape !== undefined)) {
            params.POINTSHAPES = cb.breaks.map((b: CbBreak) => b.pointShape ?? "circle").join(",");
          }
          if (cb.breaks.some((b: CbBreak) => b.shapeLineWidth !== undefined)) {
            params.SHAPELINEWIDTHS = cb.breaks.map((b: CbBreak) => String(b.shapeLineWidth ?? 1)).join(",");
          }
          if (cb.breaks.some((b: CbBreak) => b.shapeLineColor !== undefined)) {
            params.SHAPELINECOLORS = cb.breaks.map((b: CbBreak) => normalizeAARRGGBB(b.shapeLineColor, "FF000000")).join(",");
          }
          if (cb.breaks.some((b: CbBreak) => b.shapeFillColor !== undefined)) {
            params.SHAPEFILLCOLORS = cb.breaks.map((b: CbBreak) => normalizeAARRGGBB(b.shapeFillColor, "FF000000")).join(",");
          }
        }
        // If cb_config is null OR not configured, NO CB_* params emit. STYLES=cb_raster
        // still emits (per STYLES_BY_MODE swap); Kinetica renders as raster-equivalent.
        // Legacy v1.2 classbreak widgets with config.classbreaks[] but no cb_config
        // hit this branch and render as raster (hard cutover lock from 38-CONTEXT.md).
      } else if (config.renderMode === "contour") {
    ```

    (F) Append the Track block AFTER the render-mode branch (after the contour `}` near line 350, BEFORE `return params;`):

    ```typescript
      // v1.7 Phase 38 (SCHEMA-V17-04): Track block — append additively. Gated on
      // trackConfig.enabled === true AND render mode raster|classbreak (heatmap excluded
      // per 37-SPIKE-NOTES.md ## Decision — Track + heatmap was not probed; out of scope).
      //
      // Under STYLES=raster (renderMode === "raster"): single-value TRACK_* params.
      // Under STYLES=cb_raster (renderMode === "classbreak"): N comma-separated TRACK_*
      // params where N = cb_config.breaks.length (operator-confirmed comma-sep model
      // per Phase 37 SPIKE-V17-05 + 37-SPIKE-NOTES.md ## Decision lines 312-322).
      //
      // Backward-compat lock: trackConfig === undefined OR enabled !== true → NO Track
      // params emit; URL byte-identical to pre-v1.7 (regression spec locks).
      if (layerJsonFields?.track_config) {
        const tc = coalesceTrackConfig(layerJsonFields.track_config);
        if (tc.enabled && (config.renderMode === "raster" || config.renderMode === "classbreak")) {
          params.DOTRACKS = "TRUE";
          params.TRACK_ID_ATTR = tc.trackIdAttr ?? "TRACKID";
          params.TRACK_ORDER_ATTR = tc.trackOrderAttr ?? "TIMESTAMP";

          const isCb = config.renderMode === "classbreak";
          // Under cb_raster, expand to N = breaks.length matching CB_VALS; under raster, N = 1.
          const cb = isCb && layerJsonFields ? coalesceCbConfig(layerJsonFields.cb_config) : null;
          const n = isCb && cb && isCbConfigConfigured(cb) ? cb.breaks.length : 1;
          const expand = (v: string): string => Array.from({ length: n }, () => v).join(",");

          if (tc.headColor !== undefined) {
            params.TRACKHEADCOLORS = expand(normalizeAARRGGBB(tc.headColor, "FFFF0000"));
          }
          if (tc.trailColor !== undefined) {
            params.TRACKLINECOLORS = expand(normalizeAARRGGBB(tc.trailColor, "FF0000FF"));
          }
          if (tc.headSize !== undefined) {
            params.TRACKHEADSIZES = expand(String(tc.headSize));
          }
          // trailSize takes precedence over lineWidth when both set; emit as TRACKLINEWIDTHS.
          const lineWidthVal = tc.trailSize ?? tc.lineWidth;
          if (lineWidthVal !== undefined) {
            params.TRACKLINEWIDTHS = expand(String(lineWidthVal));
          }
          if (tc.headShape !== undefined) {
            // 37-SPIKE-NOTES.md OQ-9 — Phase 40 emits TRACKMARKERSHAPES per Kinetica 7.1 docs;
            // TRACKHEADSHAPES alternate-naming question deferred to Phase 43 UAT.
            params.TRACKMARKERSHAPES = expand(tc.headShape);
          }
        }
      }
    ```

    Edit `kinetica_bi/src/lib/wmsUrlBuilder.spec.ts` — APPEND a new top-level describe block at the END of the file:

    ```typescript
    // ─── v1.7 Phase 38 (SCHEMA-V17-03/04/05) — Lane C cb_raster + Track block + 8-char color ───

    describe("buildWmsParams — Lane C cb_raster (SCHEMA-V17-03)", () => {
      const baseConfig = {
        tableId: 1,
        tableRef: "schema.table",
        spatialMode: "latlon" as const,
        lonColumn: "lon",
        latColumn: "lat",
        renderMode: "classbreak" as const,
      };

      it("emits STYLES=cb_raster (not STYLES=classbreak) when cb_config is configured", () => {
        const cbConfigJson = JSON.stringify({
          attr: "fare_amount",
          valsType: "numeric",
          breaks: [{ value: 10, color: "FF112233" }, { value: 25, color: "FF445566" }],
        });
        const params = buildWmsParams(
          baseConfig,
          undefined,
          undefined,
          undefined,
          { cb_config: cbConfigJson, track_config: null },
        );
        expect(params).not.toBeNull();
        expect(params!.STYLES).toBe("cb_raster");
      });

      it("emits CB_ATTR + CB_VALS + POINTCOLORS verbatim from cb_config.breaks", () => {
        const cbConfigJson = JSON.stringify({
          attr: "fare_amount",
          valsType: "numeric",
          breaks: [
            { value: 10, color: "FF112233" },
            { value: 25, color: "FF445566" },
            { value: 50, color: "FF7788AA" },
          ],
        });
        const params = buildWmsParams(baseConfig, undefined, undefined, undefined, { cb_config: cbConfigJson, track_config: null });
        expect(params!.CB_ATTR).toBe("fare_amount");
        expect(params!.CB_VALS).toBe("10,25,50");
        expect(params!.POINTCOLORS).toBe("FF112233,FF445566,FF7788AA");
      });

      it("emits the literal <other> keyword in CB_VALS (no auto-injection, no rewriting)", () => {
        const cbConfigJson = JSON.stringify({
          attr: "payment_type",
          valsType: "categorical",
          breaks: [
            { value: "cash", color: "FF112233" },
            { value: "credit", color: "FF445566" },
            { value: "<other>", color: "FF7788AA" },
          ],
        });
        const params = buildWmsParams(baseConfig, undefined, undefined, undefined, { cb_config: cbConfigJson, track_config: null });
        expect(params!.CB_VALS).toBe("cash,credit,<other>");
      });

      it("emits POINTSIZES / POINTSHAPES / SHAPELINEWIDTHS / SHAPELINECOLORS / SHAPEFILLCOLORS only when at least one break sets them", () => {
        const cbConfigJson = JSON.stringify({
          attr: "x",
          valsType: "numeric",
          breaks: [
            { value: 1, color: "FF000000", pointSize: 4, pointShape: "circle" },
            { value: 2, color: "FFFFFFFF", pointSize: 6 },  // no pointShape — default "circle"
          ],
        });
        const params = buildWmsParams(baseConfig, undefined, undefined, undefined, { cb_config: cbConfigJson, track_config: null });
        expect(params!.POINTSIZES).toBe("4,6");
        expect(params!.POINTSHAPES).toBe("circle,circle");
        expect(params!.SHAPELINEWIDTHS).toBeUndefined();  // no break sets it
        expect(params!.SHAPELINECOLORS).toBeUndefined();
        expect(params!.SHAPEFILLCOLORS).toBeUndefined();
      });

      it("does NOT emit Lane A indexed names (CB_POINTCOLOR_1 / CB_BREAK_POINT_1) or Lane B param CB_POINTCOLORS", () => {
        const cbConfigJson = JSON.stringify({ attr: "x", valsType: "numeric", breaks: [{ value: 1, color: "FF000000" }] });
        const params = buildWmsParams(baseConfig, undefined, undefined, undefined, { cb_config: cbConfigJson, track_config: null });
        // Lane A naming gone:
        expect(Object.keys(params!).find((k) => k.startsWith("CB_POINTCOLOR_"))).toBeUndefined();
        expect(Object.keys(params!).find((k) => k.startsWith("CB_BREAK_POINT_"))).toBeUndefined();
        expect(params!.CB_COLUMN_NAME).toBeUndefined();
        expect(params!.CB_BREAK_TYPE).toBeUndefined();
        // Lane B naming also absent (we emit Lane C POINTCOLORS, not Lane B CB_POINTCOLORS):
        expect(params!.CB_POINTCOLORS).toBeUndefined();
      });

      it("falls through to no CB_* emission when cb_config is null (hard cutover — no read-shim for legacy config.classbreaks[])", () => {
        // Even though the legacy config has classbreaks[], wmsUrlBuilder must NOT read it.
        const legacyConfig = {
          ...baseConfig,
          cbColumn: "fare_amount",
          cbBreakType: "numerical" as const,
          classbreaks: [{ value: 10, color: "FF112233" }, { value: 25, color: "FF445566" }],
        };
        const params = buildWmsParams(legacyConfig, undefined, undefined, undefined, { cb_config: null, track_config: null });
        expect(params!.STYLES).toBe("cb_raster");   // STYLES_BY_MODE swap
        expect(params!.CB_ATTR).toBeUndefined();
        expect(params!.CB_VALS).toBeUndefined();
        expect(params!.POINTCOLORS).toBeUndefined();
        expect(params!.CB_POINTCOLORS).toBeUndefined();
      });
    });

    describe("buildWmsParams — 8-char AARRGGBB color regression lock (SCHEMA-V17-05)", () => {
      it("emits 8-char AARRGGBB POINTCOLORS even when input color is 6-char RRGGBB", () => {
        const cbConfigJson = JSON.stringify({
          attr: "x",
          valsType: "numeric",
          breaks: [{ value: 1, color: "112233" }],   // 6-char (legacy bug input)
        });
        const params = buildWmsParams(
          { tableId: 1, tableRef: "s.t", spatialMode: "latlon", lonColumn: "lon", latColumn: "lat", renderMode: "classbreak" },
          undefined, undefined, undefined,
          { cb_config: cbConfigJson, track_config: null },
        );
        expect(params!.POINTCOLORS).toBe("FF112233");   // normalized — NOT "112233"
        expect(params!.POINTCOLORS.length).toBe(8);
      });

      it("preserves 8-char AARRGGBB POINTCOLORS verbatim when input is already 8-char", () => {
        const cbConfigJson = JSON.stringify({
          attr: "x",
          valsType: "numeric",
          breaks: [{ value: 1, color: "FF112233" }],
        });
        const params = buildWmsParams(
          { tableId: 1, tableRef: "s.t", spatialMode: "latlon", lonColumn: "lon", latColumn: "lat", renderMode: "classbreak" },
          undefined, undefined, undefined,
          { cb_config: cbConfigJson, track_config: null },
        );
        expect(params!.POINTCOLORS).toBe("FF112233");
      });
    });

    describe("buildWmsParams — Track block (SCHEMA-V17-04)", () => {
      const baseConfig = {
        tableId: 1,
        tableRef: "s.t",
        spatialMode: "latlon" as const,
        lonColumn: "lon",
        latColumn: "lat",
      };

      it("under STYLES=raster: emits single-value TRACK_* params when trackConfig.enabled === true", () => {
        const trackJson = JSON.stringify({
          enabled: true,
          trackIdAttr: "TRACKID",
          trackOrderAttr: "TIMESTAMP",
          headColor: "FFFF0000",
          trailColor: "FF0000FF",
          headSize: 8,
          trailSize: 2,
          headShape: "circle",
        });
        const params = buildWmsParams(
          { ...baseConfig, renderMode: "raster" },
          undefined, undefined, undefined,
          { cb_config: null, track_config: trackJson },
        );
        expect(params!.DOTRACKS).toBe("TRUE");
        expect(params!.TRACK_ID_ATTR).toBe("TRACKID");
        expect(params!.TRACK_ORDER_ATTR).toBe("TIMESTAMP");
        expect(params!.TRACKHEADCOLORS).toBe("FFFF0000");
        expect(params!.TRACKLINECOLORS).toBe("FF0000FF");
        expect(params!.TRACKHEADSIZES).toBe("8");
        expect(params!.TRACKLINEWIDTHS).toBe("2");
        expect(params!.TRACKMARKERSHAPES).toBe("circle");
      });

      it("under STYLES=cb_raster: emits N comma-separated TRACK_* params matching cb_config.breaks.length", () => {
        const cbConfigJson = JSON.stringify({
          attr: "x",
          valsType: "numeric",
          breaks: [{ value: 1, color: "FF000000" }, { value: 2, color: "FFFFFFFF" }, { value: 3, color: "FF112233" }],
        });
        const trackJson = JSON.stringify({
          enabled: true,
          headColor: "FFFF0000",
          trailColor: "FF0000FF",
          headSize: 8,
        });
        const params = buildWmsParams(
          { ...baseConfig, renderMode: "classbreak" },
          undefined, undefined, undefined,
          { cb_config: cbConfigJson, track_config: trackJson },
        );
        expect(params!.DOTRACKS).toBe("TRUE");
        expect(params!.TRACKHEADCOLORS).toBe("FFFF0000,FFFF0000,FFFF0000");
        expect(params!.TRACKLINECOLORS).toBe("FF0000FF,FF0000FF,FF0000FF");
        expect(params!.TRACKHEADSIZES).toBe("8,8,8");
      });

      it("NO Track params emitted when trackConfig.enabled === false", () => {
        const trackJson = JSON.stringify({ enabled: false, headColor: "FFFF0000" });
        const params = buildWmsParams(
          { ...baseConfig, renderMode: "raster" },
          undefined, undefined, undefined,
          { cb_config: null, track_config: trackJson },
        );
        expect(params!.DOTRACKS).toBeUndefined();
        expect(params!.TRACKHEADCOLORS).toBeUndefined();
      });

      it("NO Track params emitted under STYLES=heatmap even when enabled (Track gated to raster|classbreak only)", () => {
        const trackJson = JSON.stringify({ enabled: true, headColor: "FFFF0000" });
        const params = buildWmsParams(
          { ...baseConfig, renderMode: "heatmap" },
          undefined, undefined, undefined,
          { cb_config: null, track_config: trackJson },
        );
        expect(params!.DOTRACKS).toBeUndefined();
      });
    });

    describe("buildWmsParams — backward-compat URL snapshot (legacy widgets pre-v1.7)", () => {
      it("a raster-mode widget with no cb_config + no track_config + no layerJsonFields arg produces identical URL to pre-v1.7", () => {
        // Legacy 2-arg signature (Phase 16 callers) — layerJsonFields undefined.
        const params = buildWmsParams(
          { tableId: 1, tableRef: "s.t", spatialMode: "latlon", lonColumn: "lon", latColumn: "lat", renderMode: "raster", pointColor: "FFFF3838", pointSize: 4 },
          undefined,
        );
        expect(params!.STYLES).toBe("raster");
        expect(params!.POINTCOLORS).toBe("FFFF3838");
        expect(params!.POINTSIZES).toBe("4");
        // No CB_* params:
        expect(params!.CB_ATTR).toBeUndefined();
        expect(params!.CB_VALS).toBeUndefined();
        // No Track params:
        expect(params!.DOTRACKS).toBeUndefined();
      });

      it("legacy classbreak widget with config.classbreaks[] but cb_config===null: NO CB_* emit (hard cutover lock)", () => {
        const params = buildWmsParams(
          {
            tableId: 1, tableRef: "s.t", spatialMode: "latlon", lonColumn: "lon", latColumn: "lat",
            renderMode: "classbreak",
            cbColumn: "fare_amount", cbBreakType: "numerical",
            classbreaks: [{ value: 10, color: "112233" }, { value: 25, color: "445566" }],
          },
          undefined, undefined, undefined,
          { cb_config: null, track_config: null },
        );
        expect(params!.STYLES).toBe("cb_raster");   // STYLES_BY_MODE swap (renders as raster-equivalent without CB_*)
        // No CB_* params (the legacy classbreaks[] is IGNORED):
        expect(params!.CB_ATTR).toBeUndefined();
        expect(params!.CB_VALS).toBeUndefined();
        expect(params!.POINTCOLORS).toBeUndefined();
      });
    });

    describe("buildWmsParams — `_mv` cache-bust preservation (SCHEMA-V17-03 explicit requirement)", () => {
      it("LAYERS param contains the `_mv` cache-bust suffix when materializeVersion is supplied (v1.3 logic survived the rewrite)", () => {
        // 4-arg call (Phase 16 + Phase 35 caller shape) with materializeVersion=42.
        // The v1.3 Phase 13 `_mv` suffix logic must still emit on the LAYERS param so
        // the tile fetch URL changes when filter materialization version bumps.
        const params = buildWmsParams(
          { tableId: 1, tableRef: "schema.nyctaxi", spatialMode: "latlon", lonColumn: "lon", latColumn: "lat", renderMode: "raster" },
          42,
          undefined,
          undefined,
        );
        expect(params).not.toBeNull();
        // The `_mv` cache-bust signature MUST appear in the LAYERS param (or wherever
        // wmsUrlBuilder routes it under the 4-case LAYERS precedence — any LAYERS
        // value containing `_mv` is a PASS on this lock).
        expect(params!.LAYERS).toMatch(/_mv/);
      });

      it("NO Track params emitted when track_config is null (legacy widget pre-v1.7)", () => {
        // SCHEMA-V17-04 backward-compat lock: legacy widget where track_config is
        // explicitly null (PRAGMA-migrated row with no Phase 40 form input yet) must
        // produce ZERO Track params — bit-identical to pre-v1.7 raster URLs.
        const params = buildWmsParams(
          { tableId: 1, tableRef: "s.t", spatialMode: "latlon", lonColumn: "lon", latColumn: "lat", renderMode: "raster" },
          undefined,
          undefined,
          undefined,
          { cb_config: null, track_config: null },
        );
        expect(params!.DOTRACKS).toBeUndefined();
        // No TRACK_* keys at all:
        const trackKeys = Object.keys(params!).filter((k) => k.startsWith("TRACK"));
        expect(trackKeys).toEqual([]);
      });
    });
    ```
  </action>
  <verify>
    <automated>cd kinetica_bi &amp;&amp; grep -q 'classbreak: "cb_raster"' src/lib/wmsUrlBuilder.ts &amp;&amp; grep -q "coalesceCbConfig" src/lib/wmsUrlBuilder.ts &amp;&amp; grep -q "normalizeAARRGGBB(b.color" src/lib/wmsUrlBuilder.ts &amp;&amp; grep -q "DOTRACKS" src/lib/wmsUrlBuilder.ts &amp;&amp; grep -q "TRACKHEADCOLORS" src/lib/wmsUrlBuilder.ts &amp;&amp; grep -q "materializeVersion" src/lib/wmsUrlBuilder.ts &amp;&amp; grep -q "_mv" src/lib/wmsUrlBuilder.ts &amp;&amp; grep -q "track_config is null" src/lib/wmsUrlBuilder.spec.ts &amp;&amp; grep -q "_mv" src/lib/wmsUrlBuilder.spec.ts &amp;&amp; ! grep -q "CB_POINTCOLOR_" src/lib/wmsUrlBuilder.ts &amp;&amp; ! grep -q "CB_BREAK_POINT_" src/lib/wmsUrlBuilder.ts &amp;&amp; ! grep -q "CB_COLUMN_NAME" src/lib/wmsUrlBuilder.ts &amp;&amp; ! grep -q "CB_BREAK_TYPE" src/lib/wmsUrlBuilder.ts &amp;&amp; npx tsc --noEmit &amp;&amp; npx vitest run src/lib/wmsUrlBuilder.spec.ts --reporter=verbose</automated>
  </verify>
  <acceptance_criteria>
    - `grep -q 'classbreak: "cb_raster"' kinetica_bi/src/lib/wmsUrlBuilder.ts` returns 0 (STYLES_BY_MODE swap landed).
    - `grep -q "coalesceCbConfig" kinetica_bi/src/lib/wmsUrlBuilder.ts` returns 0 (Plan 38-01 helper consumed).
    - `grep -q "normalizeAARRGGBB(b.color" kinetica_bi/src/lib/wmsUrlBuilder.ts` returns 0 (8-char color fix landed — SCHEMA-V17-05).
    - `grep -q "POINTCOLORS" kinetica_bi/src/lib/wmsUrlBuilder.ts` returns 0 (Lane C emission landed).
    - `grep -q "DOTRACKS" kinetica_bi/src/lib/wmsUrlBuilder.ts` AND `grep -q "TRACKHEADCOLORS" kinetica_bi/src/lib/wmsUrlBuilder.ts` AND `grep -q "TRACK_ID_ATTR" kinetica_bi/src/lib/wmsUrlBuilder.ts` AND `grep -q "TRACKMARKERSHAPES" kinetica_bi/src/lib/wmsUrlBuilder.ts` all return 0 (Track block landed — SCHEMA-V17-04).
    - Lane A naming gone: `! grep -q "CB_POINTCOLOR_" kinetica_bi/src/lib/wmsUrlBuilder.ts` AND `! grep -q "CB_BREAK_POINT_" kinetica_bi/src/lib/wmsUrlBuilder.ts` AND `! grep -q "CB_COLUMN_NAME" kinetica_bi/src/lib/wmsUrlBuilder.ts` AND `! grep -q "CB_BREAK_TYPE" kinetica_bi/src/lib/wmsUrlBuilder.ts` (all four legacy names DELETED from production code path).
    - Hard cutover lock: `! grep -q "config.classbreaks" kinetica_bi/src/lib/wmsUrlBuilder.ts` (NO read of legacy config.classbreaks[] anywhere in production code; the field stays in MapWidgetConfig type only).
    - Hard cutover lock: `! grep -q "config.cbColumn" kinetica_bi/src/lib/wmsUrlBuilder.ts` (NO read of legacy config.cbColumn).
    - `grep -q "TrackConfig" kinetica_bi/src/lib/wmsUrlBuilder.ts` returns 0 (inline TrackConfig type + coalesceTrackConfig helper added).
    - `grep -q "STYLES=cb_raster" kinetica_bi/src/lib/wmsUrlBuilder.spec.ts || grep -q '"cb_raster"' kinetica_bi/src/lib/wmsUrlBuilder.spec.ts` returns 0 (new specs added).
    - `cd kinetica_bi &amp;&amp; npx vitest run src/lib/wmsUrlBuilder.spec.ts --reporter=verbose` reports 0 failures (all existing + new specs green).
    - `cd kinetica_bi &amp;&amp; npx tsc --noEmit` exits 0.
    - **`_mv` cache-bust preservation (SCHEMA-V17-03 explicit requirement):** `grep -q 'materializeVersion' kinetica_bi/src/lib/wmsUrlBuilder.ts` returns 0 (cache-bust param symbol preserved after the rewrite).
    - **`_mv` literal preservation:** `grep -q '_mv' kinetica_bi/src/lib/wmsUrlBuilder.ts` returns 0 (string literal preserved; existing v1.3 `_mv` LAYERS-suffix logic survived the rewrite).
  </acceptance_criteria>
  <done>
    wmsUrlBuilder.ts emits Lane C cb_raster verbatim from 37-SPIKE-NOTES.md ## Decision; 8-char AARRGGBB color emission locked by regression spec; Track block emits single-value under raster + comma-sep under cb_raster matching CB_VALS length; legacy backward-compat URL snapshot proves trackConfig===undefined widgets produce identical URLs. Hard cutover lock honored — no read-shim for legacy fields.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: MapChartRenderer lastEmittedParamsRef fingerprint extension</name>
  <files>kinetica_bi/src/components/charts/MapChartRenderer.tsx</files>
  <read_first>
    - kinetica_bi/src/components/charts/MapChartRenderer.tsx:560-580 (find existing lastEmittedParamsRef definition — line 574)
    - kinetica_bi/src/components/charts/MapChartRenderer.tsx:1100-1115 (Effect 2 — line 1110 where construction-time fingerprint is seeded via JSON.stringify(wmsParams))
    - kinetica_bi/src/components/charts/MapChartRenderer.tsx:1185-1205 (Effect 3 — lines 1193-1195 fingerprint compare + updateParams call)
    - .planning/phases/38-schema-wms-engine-foundation/38-CONTEXT.md §"lastEmittedParamsRef fingerprint" (locked extension shape)
    - kinetica_bi/src/components/charts/MapChartRenderer.tsx for buildWmsParams call sites — Effects 2 + 3 currently call buildWmsParams(config, materializeVersion, dynamicViewEntry, dynamicViewVersion) → add 5th arg `{ cb_config: layer.cb_config, track_config: layer.track_config }` at each call site
  </read_first>
  <behavior>
    - When cb_config changes on a layer (via Phase 39 form auto-save → store update), the per-layer fingerprint stored in lastEmittedParamsRef shifts → Effect 3's compare yields a miss → imageWmsSource.updateParams fires → Kinetica re-renders the tile.
    - When track_config changes on a layer, same flow.
    - When ONLY non-WMS layer fields change (e.g. position reorder, info_template edit), the fingerprint does NOT shift (since position + info_template are not in the JSON-encoded fingerprint inputs).
    - Construction-time seeding (line ~1110) and edit-time compare (line ~1193-1195) both use the SAME fingerprint formula — single source of truth for the per-layer key.
  </behavior>
  <action>
    Edit `kinetica_bi/src/components/charts/MapChartRenderer.tsx`:

    (A) Update Effect 2 buildWmsParams call at line ~1107-1110 area — currently passes 4 args, ADD the 5th `layerJsonFields` arg:

    Locate the existing call (e.g. `const wmsParams = buildWmsParams(widgetConfigForLayer, materializeVersion, dvEntry, dvVersion);`) and change to:

    ```typescript
    const wmsParams = buildWmsParams(
      widgetConfigForLayer,
      materializeVersion,
      dvEntry,
      dvVersion,
      // v1.7 Phase 38 (SCHEMA-V17-03/04): pass raw cb_config + track_config JSON
      // so wmsUrlBuilder's cb_raster + Track branches can read them via coalesceCbConfig
      // + coalesceTrackConfig. Both null for legacy/pre-v1.7 layers → no CB_* / Track emit.
      { cb_config: layer.cb_config, track_config: layer.track_config },
    );
    ```

    And update the construction-time fingerprint seed at the line that does `lastEmittedParamsRef.current.set(layer.id, JSON.stringify(wmsParams));` — change to:

    ```typescript
    // v1.7 Phase 38: extend fingerprint with raw cb_config + track_config strings so
    // PATCH-coalesced style edits (Phase 39 + 40 form auto-save) trigger updateParams
    // even when the resulting wmsParams object happens to byte-match (e.g. operator
    // changes a label that doesn't surface in the URL — fingerprint catches it).
    const fingerprint = JSON.stringify({ p: wmsParams, c: layer.cb_config, t: layer.track_config });
    lastEmittedParamsRef.current.set(layer.id, fingerprint);
    ```

    (B) Update Effect 3 buildWmsParams call + fingerprint at line ~1190-1196 — the same change:

    Locate the existing call inside the loop, change to:

    ```typescript
    const wmsParams = buildWmsParams(
      widgetConfigForLayer,
      materializeVersion,
      dvEntry,
      dvVersion,
      { cb_config: layer.cb_config, track_config: layer.track_config },
    );
    // ... null-skip handling unchanged ...
    const fingerprint = JSON.stringify({ p: wmsParams, c: layer.cb_config, t: layer.track_config });
    if (lastEmittedParamsRef.current.get(layer.id) === fingerprint) continue;
    lastEmittedParamsRef.current.set(layer.id, fingerprint);
    ```

    Run grep to enumerate ALL buildWmsParams call sites in MapChartRenderer (some Effects may have multiple) — add the 5th arg + extend the fingerprint at every site that currently does fingerprint compare/seed. The two-arg variant exists for legacy callers but MapChartRenderer always has access to `layer` so all call sites here should use the 5-arg form.
  </action>
  <verify>
    <automated>cd kinetica_bi &amp;&amp; grep -q "layer.cb_config" src/components/charts/MapChartRenderer.tsx &amp;&amp; grep -q "layer.track_config" src/components/charts/MapChartRenderer.tsx &amp;&amp; grep -q "p: wmsParams" src/components/charts/MapChartRenderer.tsx &amp;&amp; npx tsc --noEmit &amp;&amp; npx vitest run src/components/charts/MapChartRenderer.spec.tsx --reporter=verbose 2>&amp;1 | tail -30 || npx tsc --noEmit</automated>
  </verify>
  <acceptance_criteria>
    - `grep -q "layer.cb_config" kinetica_bi/src/components/charts/MapChartRenderer.tsx` returns 0 (5th arg landed at buildWmsParams call sites).
    - `grep -q "layer.track_config" kinetica_bi/src/components/charts/MapChartRenderer.tsx` returns 0.
    - `grep -q "p: wmsParams" kinetica_bi/src/components/charts/MapChartRenderer.tsx` returns 0 (extended fingerprint shape — keyed object literal `{ p, c, t }`).
    - All buildWmsParams call sites in MapChartRenderer.tsx pass 5 args (count: `grep -c "buildWmsParams(" kinetica_bi/src/components/charts/MapChartRenderer.tsx` matches the count of `layer.cb_config` references in the same file — every call site has the layerJsonFields arg).
    - `cd kinetica_bi && npx tsc --noEmit` exits 0 (the 5-arg overload signature added in Task 1 covers these call sites).
    - Existing MapChartRenderer specs continue to pass: `cd kinetica_bi && npx vitest run src/components/charts/MapChartRenderer.spec.tsx --reporter=verbose` returns 0 failures (if the spec file exists; if not, full suite via `npx vitest run` must remain green).
  </acceptance_criteria>
  <done>
    Fingerprint extension landed — PATCH-coalesced edits to cb_config or track_config trigger imageWmsSource.updateParams re-fire. Frontend tsc passes clean. No silent cache-bust misses for Phase 39 + 40 form auto-save.
  </done>
</task>

<task type="auto">
  <name>Task 3: Frontend DashboardLayerDto extension + updateLayer Pick&lt;&gt; extension (mirrors Plan 38-01 server type)</name>
  <files>kinetica_bi/src/api/client.ts</files>
  <read_first>
    - kinetica_bi/src/api/client.ts:454-476 (DashboardLayerDto — already extends info_* + dynamic_view_id; add cb_config + track_config with comment block matching Plan 38-01 server type)
    - kinetica_bi/src/api/client.ts:498-518 (updateLayer Pick&lt;&gt; — extend with two new keys after dynamic_view_id)
    - .planning/phases/38-schema-wms-engine-foundation/38-01-SUMMARY.md (Plan 38-01 server-side DashboardLayer extension — byte-parity with this DTO)
    - .planning/phases/38-schema-wms-engine-foundation/38-CONTEXT.md §"DTO + CRUD extension" (byte-parity lock)

    **Wave-2 parallel-edit coordination:** Plan 38-03's Task 3 also modifies
    `kinetica_bi/src/api/client.ts` at a different location (quantileFn export appended near
    end-of-file). The executor MUST apply THIS task (38-02 Task 3 — DashboardLayerDto
    extension at top-of-file, ~line 454-476 + updateLayer Pick&lt;&gt; ~line 498-518) BEFORE
    38-03 Task 3 (quantileFn export at end-of-file) to avoid merge conflicts. Both edits
    land additively; no overwrites. If the executor reads the current file state immediately
    before writing, sequential application is safe.
  </read_first>
  <action>
    Edit `kinetica_bi/src/api/client.ts`:

    (A) DashboardLayerDto block (line 454-476) — locate the `dynamic_view_id: number | null;` line. AFTER that line and BEFORE `created_at: string;`, APPEND:

    ```typescript
      // v1.7 Phase 38 (SCHEMA-V17-01/02): classbreak + track config JSON columns mirroring
      // the server-side DashboardLayer extension byte-for-byte. Raw JSON strings on the wire;
      // frontend deserializes via lib/cbConfig.ts coalesceCbConfig() at consumer sites (Phase
      // 38-02 wmsUrlBuilder cb_raster branch + Phase 39 form UI). NULL = "not yet configured";
      // legacy widgets render as raster because wmsUrlBuilder coalesces null → EMPTY_CB_CONFIG
      // and gates Lane C emission on isCbConfigConfigured.
      cb_config: string | null;
      track_config: string | null;
    ```

    (B) updateLayer Pick<> tuple (line 498-518) — locate `| "dynamic_view_id"` and APPEND two new entries on new lines after it:

    ```typescript
        | "cb_config"
        | "track_config"
    ```
  </action>
  <verify>
    <automated>cd kinetica_bi &amp;&amp; grep -q "cb_config: string | null" src/api/client.ts &amp;&amp; grep -q "track_config: string | null" src/api/client.ts &amp;&amp; grep -q '"cb_config"' src/api/client.ts &amp;&amp; grep -q '"track_config"' src/api/client.ts &amp;&amp; npx tsc --noEmit</automated>
  </verify>
  <acceptance_criteria>
    - `grep -q "cb_config: string | null" kinetica_bi/src/api/client.ts` returns 0 (DashboardLayerDto extended).
    - `grep -q "track_config: string | null" kinetica_bi/src/api/client.ts` returns 0.
    - `grep -q '| "cb_config"' kinetica_bi/src/api/client.ts` returns 0 (updateLayer Pick<> extended).
    - `grep -q '| "track_config"' kinetica_bi/src/api/client.ts` returns 0.
    - Byte-parity check: the comment block above the two new fields in client.ts mentions "byte-parity" or "mirroring the server-side" (so future readers see the lock).
    - `cd kinetica_bi && npx tsc --noEmit` exits 0 (no client.ts type errors).
    - Full frontend vitest suite remains green: `cd kinetica_bi && npx vitest run --reporter=verbose 2>&1 | tail -10` shows 0 failures (mainly to catch any test that imports DashboardLayerDto and constructs a literal without the new fields — those tests need updates).
  </acceptance_criteria>
  <done>
    DashboardLayerDto + updateLayer Pick<> mirror Plan 38-01 server-side extension byte-for-byte. Frontend tsc passes clean. Phase 39 form UI now has typed access to layer.cb_config + layer.track_config end-to-end.
  </done>
</task>

</tasks>

<verification>
End-to-end checks for Plan 38-02:

1. wmsUrlBuilder Lane C emission: `cd kinetica_bi && npx vitest run src/lib/wmsUrlBuilder.spec.ts --reporter=verbose` reports 0 failures across:
   - Existing Phase 11/16/35 specs (no regression)
   - New SCHEMA-V17-03 cb_raster branch specs (6+ cases)
   - New SCHEMA-V17-05 8-char color regression spec (2 cases)
   - New SCHEMA-V17-04 Track block specs (4 cases)
   - New backward-compat URL snapshot specs (2 cases)
2. Hard cutover lock: `! grep -q "CB_POINTCOLOR_\|CB_BREAK_POINT_\|CB_COLUMN_NAME\|CB_BREAK_TYPE\|config.classbreaks\|config.cbColumn" kinetica_bi/src/lib/wmsUrlBuilder.ts` returns 0 (Lane A naming + legacy field reads all DELETED from production code).
3. Frontend tsc clean: `cd kinetica_bi && npx tsc --noEmit` exits 0.
4. Frontend full vitest stays green: `cd kinetica_bi && npx vitest run --reporter=verbose 2>&1 | tail -10` reports 0 failures.
5. Fingerprint extension: `grep -c "p: wmsParams, c: layer.cb_config, t: layer.track_config" kinetica_bi/src/components/charts/MapChartRenderer.tsx` returns ≥2 (Effect 2 seed + Effect 3 compare).
6. DashboardLayerDto byte-parity with server: `grep -c "cb_config: string | null" kinetica_bi/src/api/client.ts kinetica_bi/server/src/types.ts` returns 2.
</verification>

<success_criteria>
- wmsUrlBuilder.ts emits STYLES=cb_raster + CB_ATTR + CB_VALS + POINTCOLORS (Lane C) keyed on cb_config; legacy classbreak field-reads gone (SCHEMA-V17-03).
- Track block emits DOTRACKS + TRACK_* params per the 37-SPIKE-NOTES.md matrix: single-value under raster, comma-sep length N under cb_raster (SCHEMA-V17-04).
- 8-char AARRGGBB color emission locked via normalizeAARRGGBB + regression spec (SCHEMA-V17-05).
- Backward-compat URL snapshot proves trackConfig === undefined widgets produce identical URLs to pre-v1.7.
- DashboardLayerDto + updateLayer Pick<> mirror Plan 38-01 server type byte-for-byte.
- MapChartRenderer fingerprint catches PATCH-coalesced cb_config + track_config edits.
- Frontend tsc + frontend vitest both clean.
- ROADMAP Phase 38 SC3 (8-char color regression lock) satisfied by this plan's exit.
</success_criteria>

<output>
After completion, create `.planning/phases/38-schema-wms-engine-foundation/38-02-SUMMARY.md` documenting:
- STYLES_BY_MODE swap (`classbreak: "cb_raster"`)
- Lane C cb_raster branch shape (CB_ATTR / CB_VALS / POINTCOLORS / optional per-break params)
- TrackConfig inline type + coalesceTrackConfig helper rationale (single consumer; Phase 40 extracts if 2nd consumer surfaces)
- buildWmsParams 5th arg `layerJsonFields` overload + call-site updates in MapChartRenderer
- Fingerprint extension formula `{ p: wmsParams, c: layer.cb_config, t: layer.track_config }`
- DashboardLayerDto byte-parity with server
- Test counts (new wmsUrlBuilder spec cases: 6 Lane C + 2 color + 4 Track + 2 backward-compat = 14 new specs)
- Hard cutover lock verification (grep results for absence of Lane A naming + legacy field reads)
</output>
