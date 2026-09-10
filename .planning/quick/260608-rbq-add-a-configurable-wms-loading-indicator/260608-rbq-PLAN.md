---
phase: quick-260608-rbq
plan: 01
type: tdd
wave: 1
depends_on: []
files_modified:
  - packages/web/src/lib/mapInfoConfig.ts
  - packages/web/src/lib/mapInfoConfig.spec.ts
  - packages/web/src/lib/wmsUrlBuilder.ts
  - packages/web/src/components/charts/MapConfigPanel.tsx
  - packages/web/src/components/charts/MapConfigPanel.spec.tsx
  - packages/web/src/components/charts/MapChartRenderer.tsx
  - packages/web/src/components/charts/MapChartRenderer.spec.tsx
  - packages/web/src/styles/global.css
autonomous: true
requirements: [RBQ-01]
user_setup: []

must_haves:
  truths:
    - "A legacy map widget (no showLoadingIndicator field) shows the loading badge while a WMS image layer is loading tiles (default ON)"
    - "Firing imageloadstart on a visible WMS source shows the top-center 'Loading…' badge; firing imageloadend (loading map back to empty) hides it"
    - "With showLoadingIndicator:false the badge NEVER appears even while a source is mid-load"
    - "The config panel renders a 'Show loading indicator' checkbox in MAP CONTROLS, checked by default, and toggling it writes showLoadingIndicator to widget config"
    - "Removing a layer mid-load clears its loading bit and detaches the imageloadstart listener (no leak, indicator can hide)"
  artifacts:
    - path: "packages/web/src/lib/mapInfoConfig.ts"
      provides: "DEFAULT_SHOW_LOADING_INDICATOR + getShowLoadingIndicator (default true)"
      contains: "getShowLoadingIndicator"
    - path: "packages/web/src/lib/wmsUrlBuilder.ts"
      provides: "showLoadingIndicator?: boolean on MapWidgetConfig"
      contains: "showLoadingIndicator"
    - path: "packages/web/src/components/charts/MapConfigPanel.tsx"
      provides: "MAP CONTROLS 'Show loading indicator' checkbox, default-checked"
      contains: "Show loading indicator"
    - path: "packages/web/src/components/charts/MapChartRenderer.tsx"
      provides: "loadingByLayerRef + isMapLoading state + imageloadstart listener + top-center badge"
      contains: "widget-map-loading-badge"
    - path: "packages/web/src/styles/global.css"
      provides: ".widget-map-loading-badge wrapper class (top-center, theme tokens)"
      contains: "widget-map-loading-badge"
  key_links:
    - from: "ImageWMS source imageloadstart"
      to: "loadingByLayerRef + setIsMapLoading"
      via: "handleTileLoadStart through queueMicrotask defer"
      pattern: "imageloadstart"
    - from: "isMapLoading && getShowLoadingIndicator(widgetConfig)"
      to: ".widget-map-loading-badge JSX overlay sibling to widget-map-canvas"
      via: "conditional render in widget-map return"
      pattern: "widget-map-loading-badge"
    - from: "sourceListenerCleanupRef cleanup closure"
      to: "source.un(imageloadstart) + loadingByLayerRef.delete + recompute"
      via: "per-layer cleanup closure (covers REMOVE loop + over-threshold + unmount)"
      pattern: "imageloadstart.*as never"
---

<objective>
Add a configurable, in-map WMS loading indicator to map widgets. A small top-center "Loading…" badge appears whenever ANY visible/configured WMS (ImageWMS) layer in the widget is loading tiles, and disappears once all layers finish. The indicator is map-configurable via a MAP CONTROLS checkbox and DEFAULTS ON (legacy widgets with the field absent get it).

Purpose: Operators currently get no feedback while WMS tiles fetch — on slow Kinetica queries the map looks frozen. This adds clear, non-blocking visual feedback without any server change.

Output: A new `showLoadingIndicator` config field (default true), a per-layer loading-state tracker wired through the existing ImageWMS source listeners with the SAME cleanup + mountedRef + queueMicrotask discipline as the existing imageloaderror/imageloadend handlers, a top-center React-overlay badge, and full vitest coverage. Frontend-only (packages/web); zero server changes; no new npm deps.
</objective>

<execution_context>
@/Users/rydelpereira/.claude/get-shit-done/workflows/execute-plan.md
@/Users/rydelpereira/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md

Precedent — quick-260608-j5k added two opt-in OL map-control toggles (showScaleBar / showFullscreenButton) using EXACTLY the pattern this plan mirrors for the config field + getter + config-panel checkbox + specs. The ONLY behavioral differences from j5k: (a) default is TRUE not false, and (b) the consumer is a React-overlay badge driven by source events, not an OL control.

<interfaces>
<!-- Contracts the executor needs. Use these directly — no codebase exploration required. -->

From packages/web/src/lib/wmsUrlBuilder.ts — MapWidgetConfig already carries the j5k opt-in fields at the bottom; add the new field beside them:
```typescript
// quick-260608-j5k: opt-in OpenLayers map controls. Both DEFAULT FALSE ...
showScaleBar?: boolean;
showFullscreenButton?: boolean;
// >>> ADD HERE <<<
```

From packages/web/src/lib/mapInfoConfig.ts — existing getter pattern to mirror EXACTLY (default-resolver):
```typescript
export const DEFAULT_INFO_ENABLED = true;
export function getInfoEnabled(config: Pick<MapWidgetConfig, "infoEnabled">): boolean {
  return config.infoEnabled ?? DEFAULT_INFO_ENABLED;
}
// j5k precedent (default FALSE — ours is TRUE):
export const DEFAULT_SHOW_SCALE_BAR = false;
export function getShowScaleBar(config: Pick<MapWidgetConfig, "showScaleBar">): boolean {
  return config.showScaleBar ?? DEFAULT_SHOW_SCALE_BAR;
}
```

From packages/web/src/components/charts/MapChartRenderer.tsx — the EXISTING per-source listener attach site (~1214) and its cleanup closure (~1221). The new imageloadstart handler joins these two:
```typescript
const handleTileError = () => {
  if (!mountedRef.current) return;
  queueMicrotask(() => {
    if (!mountedRef.current) return; // re-check after task boundary
    setTileLoadError(/* ... */);
    /* ... */
  });
};
const handleTileLoadEnd = () => {
  if (!mountedRef.current) return;
  queueMicrotask(() => {
    if (!mountedRef.current) return;
    setTileLoadError(null);
    setErrorOverlayDismissed(true);
  });
};
source.on("imageloaderror", handleTileError);
source.on("imageloadend", handleTileLoadEnd);
// per-layer cleanup closure — invoked by BOTH the Effect 2 REMOVE loop, the
// over-threshold removal path, AND Effect 1's unmount cleanup. `as never` casts
// mirror OL's source.un typing pattern used throughout this file.
sourceListenerCleanupRef.current.set(layer.id, () => {
  source.un("imageloaderror" as never, handleTileError as never);
  source.un("imageloadend" as never, handleTileLoadEnd as never);
});
```

From packages/web/src/components/charts/MapChartRenderer.tsx — JSX overlay siblings to the OL canvas (V15-P-17 lock: React overlay, NOT ol/control). The badge goes here, AFTER `<div ref={containerRef} className="widget-map-canvas" />`, alongside MapZoomToolbar / MapDrawToolbar:
```jsx
<div ref={containerRef} className="widget-map-canvas" />
<MapZoomToolbar ... />
<MapDrawToolbar ... />
// >>> badge goes among these overlay siblings <<<
```
The `widgetConfig` variable (Record<string, unknown>, derived at ~432) is the config to pass to getShowLoadingIndicator — cast `widgetConfig as MapWidgetConfig`, same as the existing getInfoPopupWidthPx / getLegendPanelEnabled calls in this JSX.

From packages/web/src/components/charts/MapChartRenderer.spec.tsx — the source-event firing seam. The ImageWMS mock's `.on()` captures EVERY event into `tileLoadListeners[event]` (generic — imageloadstart is ALREADY captured, no mock edit needed). Fire events like the existing error/end tests do:
```typescript
import { act } from ...;
const ImageWmsCtor = (await import("ol/source/ImageWMS")).default as any;
// fire a source event:
await act(async () => {
  tileLoadListeners["imageloadstart"]?.forEach((fn) => fn());
});
// queueMicrotask defer means setState lands after a microtask — `await act` flushes it.
```
`.un()` is a bare `vi.fn()` on the mock; assert detach via `source.un.mock.calls` events (mirror Test K at ~922-960 which checks `events.toContain("imageloaderror")`).
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Config field + default-true getter (mirror j5k)</name>
  <files>packages/web/src/lib/wmsUrlBuilder.ts, packages/web/src/lib/mapInfoConfig.ts, packages/web/src/lib/mapInfoConfig.spec.ts</files>
  <behavior>
    - getShowLoadingIndicator({}) → true (field absent → default ON; legacy widgets)
    - getShowLoadingIndicator({ showLoadingIndicator: undefined }) → true
    - getShowLoadingIndicator({ showLoadingIndicator: true }) → true
    - getShowLoadingIndicator({ showLoadingIndicator: false }) → false
  </behavior>
  <action>
    RED first — add the spec cases to mapInfoConfig.spec.ts under a new `describe("getShowLoadingIndicator (quick-260608-rbq — default-ON map loading indicator)")` block, mirroring the existing getShowScaleBar describe block VERBATIM in structure (4 cases above). Import getShowLoadingIndicator + DEFAULT_SHOW_LOADING_INDICATOR. Run — MUST fail to compile/resolve (symbols don't exist yet). Commit: `test(quick-260608-rbq): add failing getShowLoadingIndicator default-true spec`.

    GREEN:
    1. In wmsUrlBuilder.ts, add to MapWidgetConfig immediately AFTER the j5k `showFullscreenButton?: boolean;` line:
       `// quick-260608-rbq: opt-in in-map WMS loading indicator. DEFAULT TRUE (legacy widgets`
       `// with the field absent get the indicator ON). Not a WMS param — consumed only by`
       `// MapChartRenderer's badge render via getShowLoadingIndicator in lib/mapInfoConfig.ts.`
       `showLoadingIndicator?: boolean;`
    2. In mapInfoConfig.ts, after the j5k getShowFullscreenButton block, add:
       `/** Default for showLoadingIndicator — DEFAULT TRUE: legacy widgets (field absent) get the indicator ON. */`
       `export const DEFAULT_SHOW_LOADING_INDICATOR = true;`
       plus `getShowLoadingIndicator(config: Pick<MapWidgetConfig, "showLoadingIndicator">): boolean` returning `config.showLoadingIndicator ?? DEFAULT_SHOW_LOADING_INDICATOR;` — structurally identical to getInfoEnabled (the only default-TRUE precedent). Add a one-line JSDoc noting consumed by MapChartRenderer badge render.
    Run spec — MUST pass. Commit: `feat(quick-260608-rbq): add showLoadingIndicator config field + default-true getter`.
  </action>
  <verify>
    <automated>cd packages/web && npx vitest run src/lib/mapInfoConfig.spec.ts</automated>
  </verify>
  <done>getShowLoadingIndicator exported, returns true when field absent/undefined/true and false only when explicitly false; mapInfoConfig.spec.ts new block green; tsc clean.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: MAP CONTROLS checkbox (default-checked)</name>
  <files>packages/web/src/components/charts/MapConfigPanel.tsx, packages/web/src/components/charts/MapConfigPanel.spec.tsx</files>
  <behavior>
    - Renders a checkbox labelled "Show loading indicator" inside the MAP CONTROLS group
    - With config lacking showLoadingIndicator → checkbox is CHECKED (default ON)
    - With config.showLoadingIndicator:false → checkbox is unchecked
    - Toggling the (default-checked) checkbox off fires onChange with objectContaining({ showLoadingIndicator: false })
  </behavior>
  <action>
    RED first — in MapConfigPanel.spec.tsx, mirror the j5k `describe("MapConfigPanel — quick-260608-j5k MAP CONTROLS checkboxes")` block at ~200. Add a sibling describe `MapConfigPanel — quick-260608-rbq loading indicator checkbox` with the 3 cases above (default-checked; explicit-false unchecked; toggle writes showLoadingIndicator:false). Use `screen.getByLabelText("Show loading indicator")`. NOTE default is CHECKED so the toggle test clicks it to produce `false` (opposite of j5k's false-default tests which click to produce true). Run — MUST fail (checkbox not in DOM). Commit: `test(quick-260608-rbq): add failing MapConfigPanel loading-indicator checkbox spec`.

    GREEN:
    1. Import getShowLoadingIndicator alongside the existing getShowScaleBar/getShowFullscreenButton import.
    2. Add a derived const beside the j5k ones (~115): `const showLoadingIndicator = getShowLoadingIndicator({ showLoadingIndicator: widgetCfg.showLoadingIndicator });`
    3. In the existing MAP CONTROLS `config-group` (the `{/* ─── MAP CONTROLS (quick-260608-j5k) ── */}` block at ~397), add a THIRD `<label className="config-toggle">` AFTER the fullscreen one, EXACTLY mirroring the showScaleBar/showFullscreenButton checkbox markup: `aria-label="Show loading indicator"`, `checked={showLoadingIndicator}`, `onChange={(e) => onChange({ ...config, showLoadingIndicator: e.target.checked })}`, visible text "Show loading indicator".
    Run spec — MUST pass. Commit: `feat(quick-260608-rbq): add MAP CONTROLS loading-indicator checkbox (default on)`.
  </action>
  <verify>
    <automated>cd packages/web && npx vitest run src/components/charts/MapConfigPanel.spec.tsx</automated>
  </verify>
  <done>"Show loading indicator" checkbox renders in MAP CONTROLS, checked by default (no field), unchecked when explicitly false, onChange writes showLoadingIndicator; spec green; tsc clean.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Per-layer loading tracker + top-center badge + listener cleanup</name>
  <files>packages/web/src/components/charts/MapChartRenderer.tsx, packages/web/src/components/charts/MapChartRenderer.spec.tsx, packages/web/src/styles/global.css</files>
  <behavior>
    - Firing imageloadstart on a constructed visible source shows the badge: `screen.getByText(/Loading/i)` present (after `await act`)
    - Firing imageloadend (returning the loading map to empty) hides the badge: queryByText(/Loading/i) null
    - With widget config showLoadingIndicator:false, firing imageloadstart does NOT show the badge (queryByText null even mid-load)
    - Toggling a layer visible:true→false (Effect 2 REMOVE) calls source.un with "imageloadstart" (no listener leak) — assert via source.un.mock.calls events, mirroring Test K
  </behavior>
  <action>
    RED first — in MapChartRenderer.spec.tsx add a `describe("quick-260608-rbq: WMS loading indicator")` block with the 4 behavior cases above. Use the existing source-event firing seam: `tileLoadListeners["imageloadstart"]?.forEach((fn) => fn())` inside `await act(async () => { ... })` (the queueMicrotask defer means setState lands after a microtask — `await act` flushes it). For the leak test, mirror Test K (~922-960): flip the single layer's config.visible true→false via rerender, then assert `source.un.mock.calls` map(c=>c[0]) `.toContain("imageloadstart")`. The ImageWMS mock `.on()` ALREADY captures imageloadstart generically (no mock edit). Run — MUST fail. Commit: `test(quick-260608-rbq): add failing renderer loading-indicator specs`.

    GREEN — modify MapChartRenderer.tsx, preserving ALL lifecycle invariants (M-01 dispose lock, GAP-24-01-A per-layer listener cleanup, GAP-24-02-A mountedRef guards, the mandatory microtask-defer-on-image-events pitfall):
    1. Refs/state (~670-752): add `const loadingByLayerRef = useRef<Map<number, boolean>>(new Map());` near sourceListenerCleanupRef, and `const [isMapLoading, setIsMapLoading] = useState(false);` near the other local state (e.g. beside hasOverThresholdLayers).
    2. At the per-source attach site (~1203, alongside handleTileError/handleTileLoadEnd) add a `handleTileLoadStart` and a small `recomputeLoading()` helper used by all three handlers:
       - `recomputeLoading`: `const next = Array.from(loadingByLayerRef.current.values()).some(Boolean); setIsMapLoading(next);` — call this INSIDE the queueMicrotask block (NOT synchronously) and AFTER re-checking mountedRef.
       - `handleTileLoadStart`: `if (!mountedRef.current) return;` then `loadingByLayerRef.current.set(layer.id, true);` then `queueMicrotask(() => { if (!mountedRef.current) return; recomputeLoading(); });` — the microtask defer is MANDATORY (OL fires image events synchronously during the render commit; synchronous setState corrupts the OL/React DOM tree → app blanks; same rationale as the handleTileError comment at ~1174-1184). Add a comment citing that pitfall.
       - In handleTileLoadEnd's existing queueMicrotask block: also `loadingByLayerRef.current.set(layer.id, false);` then `recomputeLoading();` (keep the existing setTileLoadError(null)/setErrorOverlayDismissed(true) calls).
       - In handleTileError's existing queueMicrotask block: also `loadingByLayerRef.current.set(layer.id, false);` then `recomputeLoading();` (keep existing behavior — a failed load is no longer "loading").
    3. Attach: add `source.on("imageloadstart", handleTileLoadStart);` next to the existing two `source.on(...)` calls (~1214).
    4. Cleanup closure (~1221, the `sourceListenerCleanupRef.current.set(layer.id, () => {...})`): add `source.un("imageloadstart" as never, handleTileLoadStart as never);` (match `as never` cast style), then `loadingByLayerRef.current.delete(layer.id);` then `recomputeLoading();` — so a layer removed mid-load (Effect 2 REMOVE loop, over-threshold removal, AND unmount all call this closure) clears its bit and lets the indicator hide. NOTE: recomputeLoading is defined per-layer in this closure scope; call it directly (it reads loadingByLayerRef.current which is shared) — but guard the setState inside it; on the unmount path mountedRef is already false so wrap the closure's recompute in `if (mountedRef.current) recomputeLoading();` to avoid a post-unmount setState warning.
    5. Effect 1 unmount cleanup (~947-951, alongside `imageLayersRef.current.clear();` etc.): add `loadingByLayerRef.current.clear();`.
    6. JSX badge — add a React-overlay sibling AFTER `<div ref={containerRef} className="widget-map-canvas" />` and among the MapZoomToolbar/MapDrawToolbar siblings (V15-P-17 lock — React overlay, NOT ol/control). Render ONLY when `isMapLoading && getShowLoadingIndicator(widgetConfig as MapWidgetConfig)`:
       ```jsx
       {isMapLoading && getShowLoadingIndicator(widgetConfig as MapWidgetConfig) && (
         <div className="widget-map-loading-badge" role="status" aria-live="polite">
           <span className="widget-filtering-spinner" aria-hidden="true" />
           <span>Loading…</span>
         </div>
       )}
       ```
       Import getShowLoadingIndicator at the top (the file already imports getInfoEnabled etc. from ../../lib/mapInfoConfig).
    7. CSS — in global.css, after the `.widget-filtering-spinner` / `@keyframes filtering-spin` block (~2522-2533), add `.widget-map-loading-badge` (top-center overlay). Mirror the `.map-over-threshold-overlay` token usage but anchor top-center and use the locked tokens:
       ```css
       .widget-map-loading-badge {
         position: absolute;
         top: 8px;
         left: 50%;
         transform: translateX(-50%);
         display: inline-flex;
         align-items: center;
         gap: 6px;
         padding: 4px 10px;
         background: var(--map-surface);
         border: 1px solid var(--border);
         border-radius: 6px;
         color: var(--text);
         font-size: 12px;
         font-weight: 500;
         z-index: 100;
         pointer-events: none;   /* never blocks map interaction */
         white-space: nowrap;
       }
       ```
       Reuse the existing `.widget-filtering-spinner` for the spinner (DO NOT redefine it). Use `var(--accent)` for the spinner border tint ONLY if a distinct accent spinner is wanted — otherwise the inherited `--muted` spinner is fine and light-mode-safe. Theme tokens only (no hardcoded colors) — light mode is covered automatically because `--map-surface`, `--border`, `--text` all have `[data-theme="light"]` overrides.
    Run spec — MUST pass. Commit: `feat(quick-260608-rbq): wire imageloadstart loading tracker + top-center indicator badge`.
  </action>
  <verify>
    <automated>cd packages/web && npx vitest run src/components/charts/MapChartRenderer.spec.tsx</automated>
  </verify>
  <done>imageloadstart shows the top-center "Loading…" badge; imageloadend hides it; showLoadingIndicator:false suppresses it mid-load; the imageloadstart listener is detached by the cleanup closure (source.un called with "imageloadstart"); loadingByLayerRef cleared on unmount; new spec block green; existing MapChartRenderer tests still green.</done>
</task>

</tasks>

<verification>
- `cd packages/web && npx tsc --noEmit` clean (no new type errors).
- `cd packages/web && npx vitest run` — full frontend suite stays 100% green (was 1688/1688; the 3 new describe blocks add tests, none regress).
- Manual sanity (not gating): a legacy widget config with no showLoadingIndicator shows the badge during a slow WMS load; unchecking the MAP CONTROLS checkbox hides it; corners stay clear (badge is top-center).
- Lifecycle invariants preserved: imageloadstart goes through the SAME mountedRef guard + queueMicrotask defer + per-layer cleanup closure as imageloaderror/imageloadend (no synchronous setState on image events; no listener leak; loadingByLayerRef cleared on unmount and per-layer-remove).
</verification>

<success_criteria>
- `showLoadingIndicator?: boolean` on MapWidgetConfig; `getShowLoadingIndicator` defaults TRUE.
- MAP CONTROLS "Show loading indicator" checkbox, checked by default, writes the field.
- Top-center `.widget-map-loading-badge` (theme tokens, pointer-events:none, aria-live polite) shows iff `isMapLoading && getShowLoadingIndicator(widgetConfig)`.
- Per-layer boolean map (loadingByLayerRef) tracks loading; recomputed inside microtask on start/end/error and on per-layer cleanup; cleared on unmount.
- imageloadstart listener attached + detached symmetrically with the existing two (no leak).
- tsc clean; frontend vitest 100% green; zero server changes; no new npm deps.
</success_criteria>

<output>
After completion, create `.planning/quick/260608-rbq-add-a-configurable-wms-loading-indicator/260608-rbq-SUMMARY.md`
</output>
