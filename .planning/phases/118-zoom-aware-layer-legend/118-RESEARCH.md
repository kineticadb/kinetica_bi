# Phase 118: Zoom-Aware Layer Legend - Research

**Researched:** 2026-09-16
**Domain:** Internal codebase archaeology (OpenLayers zoom/resolution semantics + two-consumer React state threading). No external library research needed — zero new dependencies, no server changes.
**Confidence:** HIGH (all claims verified by reading the actual source and, where behavioral, cross-checked against an existing passing spec)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions (operator, 2026-09-16)

1. **Distinct treatments for the two "not drawing" reasons.**
   - Eye-off (operator toggled it) keeps today's existing `hidden` styling — unchanged.
   - Zoom-inactive gets its own dimmed treatment, visually distinct from both active and eye-off.
   - Rationale: one state you chose, one that resolves itself by zooming. Rendering them
     identically would replace one ambiguity with another. **Do not collapse these.**

2. **Zoom-limited rows show their configured range** (e.g. "zoom 8-14").
   - The data is already in `layer.config`; this turns "why is this faded" into an actionable
     fact. Rejected: dim with no explanation; a single live-zoom readout in the panel header
     (`ZLGND-F2`).

### The semantics trap (verbatim from CONTEXT.md, verified below in Q1)

`MapChartRenderer.tsx:185-215` (`applyZoomRangeToLayer`) documents that the wire format is
INCLUSIVE while OpenLayers' `minZoom` is EXCLUSIVE: `internalMin = userMin - 1`, `internalMax =
userMax`, `undefined` → ±Infinity. A panel that re-derives "is this in range?" from raw config
will be off-by-one at the boundary and confidently wrong. **Prefer deriving from the same helper
(or a shared extraction of it) over re-implementing the rule.**

### Two consumers, only one has a map

1. `MapChartRenderer.tsx:2428` — inside the map. Has `widgetId`, has the live OL view.
2. `LegendRenderer.tsx:129` — the Phase 42 standalone Legend widget. No map of its own, but knows
   which map it mirrors via `widget.config.sourceMapWidgetId`. **Locked:** when that map's live
   zoom is unavailable, the standalone legend degrades to today's appearance — no zoom indication
   at all (`ZLGND-V123-06`). This is a FOURTH state, distinct from the 3 existing orphan triggers
   (`sourceMapWidgetId` undefined / bound widget deleted / bound widget not a map) — the binding
   is valid here, the map simply isn't mounted right now.

### Layers with no configured range

`ZLGND-V123-07`: a layer with neither `minZoom` nor `maxZoom` is always drawing — renders exactly
as today, no new styling, no chip.

### Claude's Discretion

- Exact visual treatment for zoom-inactive (opacity, badge, muted row) — subject to the
  theme-token constraint.
- Where the "is drawing at this zoom" predicate lives (shared lib / extraction from
  `applyZoomRangeToLayer` / read from OL) — as long as `ZLGND-V123-05` holds.
- The range chip's exact copy/format ("zoom 8-14", "8-14", "z8-14").
- How the panel subscribes to live zoom without re-rendering on every mouse-move — note
  `mapCurrentViewStore` publishes on `moveend`, not continuously.

### Deferred Ideas (OUT OF SCOPE)

- **`ZLGND-F1`** — click a zoom-limited row to zoom the map into that layer's range.
- **`ZLGND-F2`** — live zoom readout in the panel header (declined in favor of per-row ranges).
- **`ZLGND-F3`** — config-time warning when a layer's zoom range cannot be satisfied by the map's
  own min/max zoom.

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-------------------|
| ZLGND-V123-01 | Panel visually distinguishes drawing vs. not-drawing layers | Q4: new `--zoom-inactive` block modifier class, additive to the existing `visible`/`hidden` vocabulary |
| ZLGND-V123-02 | Zoom-inactive visually distinct from eye-off (never look the same) | Q4: distinct opacity value + `var(--warning)` left-border accent, vs. plain `.hidden` opacity; precedence rule recommended so the two never combine ambiguously |
| ZLGND-V123-03 | Zoom-limited row shows its configured range | Q4: reuse `.layers-legend-panel-mode-chip` (currently dead CSS/unused) or a sibling `--zoom-chip`, same token-based look |
| ZLGND-V123-04 | Live update on zoom, no reload/re-open | Q2: scoped `mapCurrentViewStore` selector, same pattern as `MapConfigPanel.tsx:160`; test harness in `MapChartRenderer.spec.tsx` already simulates `moveend` |
| ZLGND-V123-05 | Panel's "currently drawing" must match OL exactly, including inclusive/exclusive translation | Q1: extract a shared predicate from `applyZoomRangeToLayer`'s exact formula; do NOT copy the codebase's OTHER, already-divergent zoom-gate (`isLayerVisibleAtCurrentZoom`, MapChartRenderer.tsx:1790) |
| ZLGND-V123-06 | Standalone Legend degrades gracefully when live zoom unavailable | Q2/Q3: `mapCurrentViewStore.views[id]` is `undefined` (never a stale entry) when unmounted; threading `zoom: number \| undefined` through `resolveLegendLayers` makes "unknown" degrade identically to "no range configured" (ZLGND-07) with no extra branch |
| ZLGND-V123-07 | No-range layer renders exactly as today | Q3: `zoomActive`/`zoomRange` fields are `undefined` unless a range is configured AND zoom is known — existing rendering path is untouched otherwise |

</phase_requirements>

## Summary

This phase is pure internal-codebase work: no new library, no server change, and every piece of
data the feature needs already exists (`layer.config.minZoom/maxZoom`, `mapCurrentViewStore`'s
live per-widget zoom, and `applyZoomRangeToLayer`'s already-correct translation formula). The risk
is entirely in **not re-deriving the zoom-range comparison** and in **getting the two-consumer
threading right** for the case where a map isn't mounted.

I found a genuinely important, previously-undocumented fact: the codebase **already contains a
second, independent, INCORRECT re-implementation** of "is this layer in zoom range" at
`MapChartRenderer.tsx:1790-1798` (`isLayerVisibleAtCurrentZoom`, used to gate the info-click
fan-out). It uses the raw inclusive bounds (`zoom >= minZoom && zoom <= maxZoom`) instead of
`applyZoomRangeToLayer`'s translated bounds (`zoom > minZoom-1 && zoom <= maxZoom`). These two
formulas agree at integer zoom but **diverge at fractional zoom** — e.g. for `minZoom: 3`, OL
already draws the layer at zoom 2.9 (`2.9 > 2` is true) while the info-click gate says it is not
visible there. This is exactly the "option (c)" trap CONTEXT.md warned about, and it is *already
in production* for a different feature. Do not copy it. Extract from `applyZoomRangeToLayer`
instead (Q1).

**Primary recommendation:** Extract the inclusive→OL-bounds math out of `applyZoomRangeToLayer`
into a tiny pure function, use it both to set OL's `minZoom`/`maxZoom` (unchanged behavior) and to
compute a new `zoomActive`/`zoomRange` pair inside `resolveLegendLayers` (given an optional
`zoom: number | undefined` third argument). Thread live zoom into both consumers via the exact
scoped-selector pattern `MapConfigPanel.tsx` already uses against `mapCurrentViewStore` — no new
listeners, no new store.

## Q1 — Determining "is this layer actually drawing right now?"

### The ground truth: `applyZoomRangeToLayer` (MapChartRenderer.tsx:202-218)

```typescript
// INCLUSIVE userMin → EXCLUSIVE internal: subtract 1. When undefined → -Infinity.
const nextMinZoom = config.minZoom === undefined ? -Infinity : config.minZoom - 1;
// INCLUSIVE userMax → INCLUSIVE internal: pass through. When undefined → Infinity.
const nextMaxZoom = config.maxZoom === undefined ? Infinity : config.maxZoom;
```
OL then treats the layer as visible when `zoom > nextMinZoom && zoom <= nextMaxZoom` (OL's own
`minZoom`-exclusive/`maxZoom`-inclusive convention — this half of the contract is OL's, not this
codebase's, and is not independently re-verifiable here without reading OL's source, but it is the
documented, load-bearing assumption the existing, passing `applyZoomRangeToLayer.spec.ts` already
encodes and asserts against).

### Boundary behavior, verified against `applyZoomRangeToLayer.spec.ts`'s existing assertions

For `config = { minZoom: 3, maxZoom: 10 }` → `nextMinZoom = 2`, `nextMaxZoom = 10`:

| zoom | `zoom > 2` | `zoom <= 10` | Drawing? |
|------|-----------|--------------|----------|
| 2.9  | true      | true         | **YES** — surprising: nominally "below 3", but the map draws it |
| 3    | true      | true         | YES |
| 10   | true      | true         | YES |
| 10.5 | true      | false        | NO |

The zoom=2.9 result is not a hypothetical edge case — `mapCurrentViewStore.ts:34` explicitly
documents `zoom` as "fractional OL zoom, UNROUNDED (111-CONTEXT.md lock)", and `MapChartRenderer`
constructs its `OlView` with no `constrainResolution`/snap option (`MapChartRenderer.tsx:1057-1064`),
so scroll-wheel and pinch zoom produce real fractional values in normal use. The existing spec file
independently corroborates the shape of this behavior: `applyZoomRangeToLayer.spec.ts`'s
"single-zoom-level visibility" test for `{minZoom:5, maxZoom:5}` asserts OL bounds `(4, 5]` and
comments "Layer visible when 4 < z <= 5, i.e. ONLY at z=5" — that comment is itself slightly
imprecise for continuous zoom (z=4.5 is also inside `(4,5]`), which underscores how easy it is to
accidentally think in integers here. **Any predicate the panel uses must reproduce this fractional
behavior exactly, not an integer-rounded approximation.**

### Three approaches evaluated

**(a) Read truth directly from the OL layer object.** Rejected — not just risky but structurally
impossible for one of the two mandatory consumers. Two independent blockers:
1. `LegendRenderer.tsx` (2nd consumer) has no map and no OL instance at all — there is nothing to
   read truth from.
2. Even for `MapChartRenderer` itself, eye-off layers never get an OL layer object in the first
   place — `includedLayers` (MapChartRenderer.tsx:580-599) filters `config.visible === false`
   layers out **before** any `ImageLayer` is constructed, so `imageLayersRef` (the internal
   `Map<number, ImageLayer>`, MapChartRenderer.tsx:833) has no entry to query for a hidden layer.
   Reading "truth from OL" would only ever work for the subset of layers already known to be
   eye-on, which is exactly the subset that doesn't need OL's help to disambiguate.

**(b) Extract a shared predicate from `applyZoomRangeToLayer`.** Recommended. Works identically
for both consumers because it operates on plain data (`{minZoom?, maxZoom?}` + a zoom number), not
an OL instance. Guarantees `ZLGND-V123-05` by construction (one formula, one place it's defined).

**(c) Re-implement the comparison in the panel/lib.** Rejected, backed by hard evidence: the
codebase already did this once, for a different feature (info-click gating,
`MapChartRenderer.tsx:1790-1798`), and got the translation wrong at fractional boundaries (see
Summary). That existing bug is out of this phase's scope to fix (not one of ZLGND-01..07, and
fixing it would touch the info-click feature's own test coverage) — but it is the single strongest
piece of evidence for why CONTEXT.md's warning about option (c) is not theoretical.

### Recommended extraction

Add a small pure function — suggested name **`isLayerActiveAtZoom`** (avoid `isLayerVisibleAt*`,
which collides in spirit with the existing, differently-behaved `isLayerVisibleAtCurrentZoom`):

```typescript
// Suggested: packages/web/src/lib/resolveLegendLayers.ts (or a new lib/zoomActivity.ts)
export function isLayerActiveAtZoom(
  config: { minZoom?: number; maxZoom?: number },
  zoom: number,
): boolean {
  const min = config.minZoom === undefined ? -Infinity : config.minZoom - 1;
  const max = config.maxZoom === undefined ? Infinity : config.maxZoom;
  return zoom > min && zoom <= max;
}
```

Then refactor `applyZoomRangeToLayer` to call the SAME min/max derivation (e.g. extract a
`toOlZoomBounds(config)` helper that both `applyZoomRangeToLayer` and `isLayerActiveAtZoom` call),
so there is exactly one place the `-1` translation is written. This is the literal implementation
of CONTEXT.md's "prefer deriving from the same helper (or a shared extraction of it)".

**Placement note:** `resolveLegendLayers.ts` currently has zero dependency on
`MapChartRenderer.tsx` (import direction is one-way: `MapChartRenderer.tsx` imports
`resolveLegendLayers` from `../../lib/resolveLegendLayers`, not the reverse). Putting the shared
math in `lib/` and having `MapChartRenderer.tsx`'s `applyZoomRangeToLayer` import it preserves this
direction — do not introduce the reverse import (`lib/resolveLegendLayers.ts` importing from
`MapChartRenderer.tsx`, which is where `applyZoomRangeToLayer` and the current
`applyZoomRangeToLayer.spec.ts` both live today).

## Q2 — Threading live zoom to both consumers

### `mapCurrentViewStore` — exact behavior on "unavailable"

```typescript
// mapCurrentViewStore.ts
type State = {
  views: Record<number, MapCurrentView | undefined>; // keyed by widget.id
  publish: (widgetId: number, view: MapCurrentView) => void;
  clear: (widgetId: number) => void;
  reset: () => void;
};
```

- **Never mounted this session** → `views[id]` was never set → reading it returns `undefined`
  (plain JS object property access on a missing key).
- **Mounted, then unmounted** → `MapChartRenderer`'s Effect 9c cleanup calls
  `useMapCurrentViewStore.getState().clear(widget.id)` unconditionally
  (`MapChartRenderer.tsx:2312-2317`), which `delete`s the key — **not** a stale/sentinel value.
- **Dashboard switch or logout** → `reset()` wipes the entire `views` record to `{}`
  (`App.tsx:298`, `DashboardsPage.tsx:727`).

There is no code path that leaves a stale-but-present entry for a widget that is no longer
rendering. `s.views[widgetId]` is `undefined` in every "unavailable" scenario — this is HIGH
confidence, verified by reading both the store and every call site of `publish`/`clear`/`reset`.

### `MapChartRenderer` (consumer 1) — cheapest reactive subscription

`MapChartRenderer` already **publishes** its own zoom into `mapCurrentViewStore` on every
`moveend` + on mount (Effect 9c, `MapChartRenderer.tsx:2297-2318`) but does not currently
**subscribe** back to it. `MapConfigPanel.tsx:160-162` already establishes the exact scoped-primitive
pattern to mirror for reading it back:

```typescript
// MapConfigPanel.tsx:160-162 — the pattern to copy
const currentView = useMapCurrentViewStore((s) =>
  widgetId === undefined ? undefined : s.views[widgetId]
);
```

For the legend, subscribe to a **primitive number**, not the object, so React only re-renders when
the number actually changes reference-inequality-free:

```typescript
const currentZoom = useMapCurrentViewStore((s) => s.views[widget.id]?.zoom);
```

Because `views[widget.id]` only changes on `moveend`/mount (never continuously), this satisfies the
CONTEXT discretion note "should make this cheap" without any debouncing or throttling of your own.
Add `currentZoom` to the `resolvedLegendLayers` `useMemo` dependency array
(`MapChartRenderer.tsx:781`) alongside the existing `legendKey`/`includedLayerIdsForLegend`/etc.

**Do not** read `mapRef.current.getView().getZoom()` imperatively inside that `useMemo` — a ref
read is not reactive and would freeze the legend's zoom-activity at whatever it was on the render
that happened to run, never updating live. The store subscription is what makes it reactive; this
is not optional plumbing, it's the mechanism `ZLGND-V123-04` depends on.

### `LegendRenderer` (consumer 2) — same pattern, sourced from `sourceMapWidgetId`

`sourceMapWidgetId` is already resolved and validated for orphan-detection
(`LegendRenderer.tsx:44-74`). Reuse it verbatim for the store lookup:

```typescript
const currentZoom = useMapCurrentViewStore((s) =>
  sourceMapWidgetId === undefined ? undefined : s.views[sourceMapWidgetId]?.zoom
);
```

When the bound map is mounted, this is a live, reactive number. When it isn't (different dashboard
— though in practice a `sourceMapWidgetId` always refers to a widget on the SAME dashboard, since
`widgets` comes from the same `useDashboardContext()`; more realistically: the map widget exists in
`widgets` but its `MapChartRenderer` hasn't mounted/has been removed from the DOM), it is
`undefined` — no code branch needed to detect this explicitly.

### The "fourth state" — confirmed, and it needs no dedicated UI

CONTEXT.md's framing is correct: `isOrphan` (LegendRenderer.tsx:73-74) stays `false` — the binding
is valid — while `currentZoom` is `undefined`. This is exactly the same shape as `ZLGND-V123-07`'s
"no range configured" case once threaded through `resolveLegendLayers` (Q3): both result in
`zoomActive`/`zoomRange` being `undefined` for every layer, which is defined to mean "render
exactly as today." **No new orphan-state branch, no new message, no new component** is needed in
`LegendRenderer.tsx` for this — the existing 3-case orphan UI is untouched, and the 4th case is
handled entirely by resolveLegendLayers receiving `zoom: undefined`. This is the cleanest possible
resolution of `ZLGND-V123-06` and is worth calling out explicitly to whoever plans this, since it's
easy to over-build a dedicated "zoom unavailable" banner that the locked decision explicitly does
not want ("degrades to today's appearance").

## Q3 — Where the zoom-activity field belongs

Recommend **extending `resolveLegendLayers` itself** with an optional third parameter, rather than
computing it in each consumer's own `useMemo` (the pattern currently used for `dvStatus`, which is
enriched by each caller AFTER calling `resolveLegendLayers`, not inside it — see
`MapChartRenderer.tsx:706-774` and `LegendRenderer.tsx:90-106`).

Why diverge from the `dvStatus` precedent here: `dvStatus` needs a **store read**
(`useDynamicViewStore.getState().views`) that only the caller has a reactive trigger for
(`dynamicViewsKey`). Zoom activity needs no store read — it's a pure function of
`(layer.config, zoom)`, and `zoom` is already a plain argument. Putting it inside
`resolveLegendLayers` means:
- One function, one set of unit tests (`resolveLegendLayers.spec.ts` already has a 10-case
  precedent — "Test 1".."Test 10" — extend with "Test 11+" for zoom cases), instead of duplicating
  the same three-way precedence logic (no-range / unknown-zoom / known) in two `useMemo` bodies.
- `LayersLegendPanel.tsx` stays a near-pure renderer of already-resolved flags (matches its
  `PANEL-V17-01` "no internal store subscriptions" discipline, and its existing division of labor
  where it only ever reads flags off `ResolvedLegendLayer`, never derives them).

```typescript
// Recommended shape (lib/resolveLegendLayers.ts)
export function resolveLegendLayers(
  storeLayers: DashboardLayerDto[],
  includedLayerIds: number[] | undefined,
  zoom?: number, // NEW, optional — undefined when caller has no live zoom (ZLGND-06)
): ResolvedLegendLayer[] { /* ... */ }

export type ResolvedLegendLayer = {
  layer: DashboardLayerDto;
  visible: boolean;
  dvStatus?: DvLayerStatus;
  filterSummary?: { appliedCount: number; totalCount: number };
  // NEW:
  zoomRange?: { minZoom?: number; maxZoom?: number }; // present iff layer.config has minZoom OR maxZoom
  zoomActive?: boolean; // present iff zoomRange is present AND `zoom` was known — ZLGND-05/06/07
};
```

Per-layer derivation:
```
const minZoom = (layer.config as {minZoom?:number}).minZoom;
const maxZoom = (layer.config as {maxZoom?:number}).maxZoom;
const hasRange = minZoom !== undefined || maxZoom !== undefined;
zoomRange = hasRange ? { minZoom, maxZoom } : undefined;
zoomActive = hasRange && zoom !== undefined ? isLayerActiveAtZoom({minZoom,maxZoom}, zoom) : undefined;
```

This single shape satisfies all three range-related requirements with no per-consumer branching:
- **ZLGND-07** (no range): `zoomRange` and `zoomActive` both `undefined` → today's appearance.
- **ZLGND-06** (range configured, zoom unknown): `zoomRange` defined, `zoomActive` `undefined` →
  MUST also render as today's appearance (see Q4 precedence note — chip visibility should key off
  `zoomActive !== undefined`, not merely `zoomRange !== undefined`, or the standalone legend would
  show a NEW chip in exactly the case the locked decision forbids new UI).
- **ZLGND-05** (range configured, zoom known): `zoomActive` is `true`/`false`, computed by the one
  shared predicate.

`MapChartRenderer.tsx` passes its own `currentZoom` (Q2); `LegendRenderer.tsx` passes its own
`currentZoom` (which may be `undefined`) — both call sites pass through unchanged otherwise.

## Q4 — Rendering and styling

### Existing states in `LayersLegendPanel.tsx` / `global.css`

| State | Class | Effect | global.css lines |
|---|---|---|---|
| Eye-off | `.layers-legend-panel-layer-block.hidden` | children opacity `0.45`; eye icon itself opacity `0.4` | 4083-4093 |
| dv non-materialized | `.layers-legend-panel-layer-block--stale` | children opacity `0.55`; eye disabled, cursor `not-allowed` | 4095-4106 |
| dv status pill | `.layers-legend-panel-dv-badge` (+ `--error` modifier) | colored pill, amber/red **raw `rgba()`** literals (not tokens) — pre-existing, not this phase's problem, but a pattern NOT to copy | 4111-4142 |
| render-mode chip | `.layers-legend-panel-mode-chip` | **DEAD CSS** — class exists in `global.css` (4145-4155) with a token-based look (`--chip-bg`/`--border`/`--muted`), but `LayersLegendPanel.tsx` no longer renders it. 6 spec assertions (`LayersLegendPanel.spec.tsx` "Test 2/3/4/5/13/15") explicitly assert `container.querySelector(".layers-legend-panel-mode-chip")` is `null` — comment: "Mode chip removed — render mode is no longer surfaced in the legend." | 4145-4155 |

Both `.hidden` and `--stale` can already coexist on the same block (they're independent boolean
modifiers, `MapChartRenderer.tsx`/`LayersLegendPanel.tsx:242`); the CSS cascade currently resolves
that combination in `--stale`'s favor purely by source order (its rule for
`.layers-legend-panel-layer-name` opacity comes after `.hidden`'s in `global.css`, same
specificity). **This is a real, pre-existing landmine for adding a third modifier**: if
`--zoom-inactive` is added as an independent third boolean class, a layer that is simultaneously
eye-off (or stale) AND zoom-inactive will have its final look decided by CSS source order, which is
fragile and easy to get backwards without noticing in a code review.

**Recommendation — precedence, computed in JS, not CSS:** only surface the new zoom-inactive
treatment when the layer is not already eye-off and not already stale:
```
const showZoomInactive = visible && !stale && zoomActive === false;
```
This keeps `ZLGND-V123-02`'s "must not look the same as eye-off" trivially true (they're now
mutually exclusive classes) and avoids relying on CSS cascade order to resolve a 3-way combination
nobody asked for. This precedence rule is not explicitly stated in CONTEXT.md — flag it for
planner/operator confirmation, but it is the only reading consistent with "Eye-off styling is
unchanged" (a stale/hidden layer already reads as "not on the map" for its own reason; stacking a
second, different-colored dimming on top of it would recreate exactly the ambiguity this phase
exists to remove).

### New class recommendation

`.layers-legend-panel-layer-block--zoom-inactive` — follows the exact existing naming convention
(`--stale` is the sibling precedent). Suggested declaration, all token-based, zero new hex:

```css
.layers-legend-panel-layer-block--zoom-inactive .layers-legend-panel-layer-name,
.layers-legend-panel-layer-block--zoom-inactive .layers-legend-panel-break-row {
  opacity: 0.65; /* distinct from .hidden's 0.45 and --stale's 0.55 */
}
.layers-legend-panel-layer-block--zoom-inactive .layers-legend-panel-layer {
  border-left: 2px solid var(--warning); /* color cue, not just brightness — colorblind-safer than opacity alone */
}
```
`--warning` (`#f59e0b` dark / `#d97706` light, `global.css:21`/`:130`) is already a themed token
with both variants defined; it is currently used in exactly one place in the whole stylesheet
(`global.css:154`), so this is not overloading an already-busy semantic, and it reads as
"resolvable/actionable" rather than `--danger` (error) or `--muted` (permanently off).

### Range chip

**Recommend reusing `.layers-legend-panel-mode-chip` verbatim** (it is currently unused, token-based,
and sits in exactly the right visual slot — the per-layer header row, next to the layer name) rather
than inventing a new class. This is the more literal reading of CLAUDE.md's "never invent a
className for something that already exists" — a small muted informational chip in this exact
location already exists in the stylesheet; it happens to be dead code today. Update its doc comment
(currently "Render-mode chip mirrors .layer-row-badge exactly per research") to reflect the new
purpose in the same commit. The 6 existing spec assertions that check this class is absent all use
fixtures with no configured zoom range, so they remain correctly green (no range → no chip, exactly
as ZLGND-07 requires) — verify this explicitly as a regression check rather than assuming it.

**Chip visibility condition — recommend `zoomActive !== undefined && zoomRange !== undefined`**
(i.e. render the chip whenever the range is configured AND the current zoom is known, regardless of
whether the layer is currently active or inactive). Rationale: the operator's locked wording is "A
zoom-limited layer shows its configured range" (unconditioned on active/inactive), and always
showing it avoids a flicker where the chip appears/disappears as the operator zooms across the
boundary — which would be a distracting UI change at exactly the moment they're trying to read the
panel. **This is Claude's-discretion territory** (CONTEXT.md explicitly defers "the range chip's
exact copy and format" to discretion, though not explicitly whether to gate on active vs.
inactive) — flag as an open decision for the plan/UAT, with this as the recommended default. The
alternative (chip only when `zoomActive === false`) is a one-line condition change if the operator
prefers less visual noise on already-active rows.

Format: "zoom 8-14" reads most naturally against the operator's own verbatim phrasing in
CONTEXT.md's example. For an open-ended range (`minZoom` only, or `maxZoom` only), mirror
`LayersLegendPanel.tsx`'s existing `breakDisplayText` open-bound convention (`≥`/`<`) for
consistency: e.g. "zoom ≥ 8" / "zoom < 14".

### theme-guard exemption — confirmed precisely

`theme-guard.spec.ts:37-62`'s `ALLOWLIST` contains `"../styles/global.css"` (line 57). The hex-guard
test loop (`theme-guard.spec.ts:100-124`) treats an allowlisted file as: *"expected to contain at
least one hex literal; if it contains zero, the allowlist entry is stale."* It never asserts zero
hex for an allowlisted file. This means **any new hex literal added anywhere in `global.css`
(not just inside `:root` token blocks) passes this test unconditionally** — confirmed, HIGH
confidence, read directly from the assertion logic, not inferred from a comment. This is exactly
the mechanism CONTEXT.md/STATE.md describe as "how Phase 114's `.onboarding-banner` light-mode
defect shipped." The **structural** guard (px/ms literals for font-size/border-radius/
padding/margin/gap) has NO such allowlist for `global.css` and will fail on a literal px value in
those specific properties — but `border-left`/`opacity` are not in that regex's property list, so
the recommended CSS above needs no `theme-guard-ignore` pragma.

**No grep or vitest assertion can verify "visually distinct enough" or "readable in both themes."**
Per CLAUDE.md's acceptance-criteria discipline, this is a `checkpoint:human-verify` item: view the
zoom-inactive row next to an eye-off row and a stale row, in both `data-theme="dark"` and
`data-theme="light"`, and confirm they read as three different things. The only automatable
precondition is structural: the new class exists, its declaration contains no `#`-hex literal (a
targeted grep on the new CSS block, not the whole file, since the whole-file guard is neutered),
and its opacity/border values differ numerically from `.hidden`/`--stale`.

## Q5 — Test infrastructure

### Existing coverage of files this phase will touch

| File | Current tests | Notes |
|---|---|---|
| `applyZoomRangeToLayer.spec.ts` | 8 (`it(`) | Pure-function spec, no OL import, minimal stub layer — the pattern to mirror for a new `isLayerActiveAtZoom`/`toOlZoomBounds` spec |
| `resolveLegendLayers.spec.ts` | 10 (`"Test 1"`.."Test 10"`) | Natural home for new zoom-threading tests ("Test 11" onward) |
| `LayersLegendPanel.spec.tsx` | 39 (`it(`) | Mix of `"Test N"` and prose titles; 6 of these (`Test 2/3/4/5/13/15`) assert `.layers-legend-panel-mode-chip` is `null` — MUST stay green if that class is reused for the range chip |
| `LegendRenderer.spec.tsx` | 13 (`"Test 1"`.."Test 11"` + 2 lettered) | **Does NOT currently mock `mapCurrentViewStore` at all** (confirmed via grep — zero hits) — this is a Wave 0 gap, not an existing harness to extend |
| `MapChartRenderer.spec.tsx` | 6680 lines total (not counted per-test; file already exceeds typical size) | **Already fully mocks `mapCurrentViewStore`**, including a mutable `.views` record (lines 535-552) — this is the harness to extend, not build |

### How existing tests simulate zoom / OL view state (harness to reuse)

`MapChartRenderer.spec.tsx` already has everything needed:
- `lastMockView` / the mocked `ol/Map`'s `view.getZoom: vi.fn(() => 10)` (line 192) — mutate via
  `.mockReturnValue(newZoom)` mid-test.
- `capturedMoveendHandlers` + `fireAllMoveend()` (lines 138-139) — fires every registered
  `moveend` handler, including the Effect 9c publish handler that writes into the mocked
  `_currentViewState.views`. This is the exact mechanism to simulate "operator zooms, panel
  updates live" for `ZLGND-V123-04` without needing any new mocking infrastructure.
- The mock store's `.views` record (line 538) can also be pre-populated directly before `render()`
  for tests that don't need to exercise the publish path itself — precedent at lines 6380,
  6503-6504, 6566-6567 (`NYC`/`LONDON` fixtures).

`LegendRenderer.spec.tsx` needs the **simpler** `MapConfigPanel.spec.tsx` mock pattern added (lines
44-50 of that file) — a bare selector-read mock, no `publish`/`clear` needed since `LegendRenderer`
never writes to the store, only reads:

```typescript
const _currentViewState = { views: {} as Record<number, {center:[number,number]; zoom:number} | undefined> };
vi.mock("../../store/mapCurrentViewStore", () => ({
  useMapCurrentViewStore: (selector: (s: any) => any) => selector(_currentViewState),
}));
```

### Where new tests belong

- `resolveLegendLayers.spec.ts`: zoom threading — no range/undefined zoom/known-active/known-inactive
  cases (pure function, cheapest to test exhaustively here).
- `applyZoomRangeToLayer.spec.ts` (or a new adjacent pure-function spec if the predicate is
  extracted to its own file): confirm `isLayerActiveAtZoom`/`toOlZoomBounds` agrees with
  `applyZoomRangeToLayer`'s existing 8 assertions at the same boundary values (this IS the
  `ZLGND-V123-05` proof — a shared-source mutation probe, not a grep, is the right guard here: if
  someone changes the `-1` translation in one place and not the other, this test must redden).
- `LayersLegendPanel.spec.tsx`: new visual-state tests for the `--zoom-inactive` class + chip
  presence/absence + the precedence rule (zoom-inactive suppressed when also hidden/stale).
- `LegendRenderer.spec.tsx`: the Wave 0 mock (above) + a new "Test 12"-style case for "bound map's
  zoom unavailable → renders as if no range configured" (`ZLGND-V123-06`).
- `MapChartRenderer.spec.tsx`: a live-update test using `fireAllMoveend()` + a changed
  `getZoom()` mock return value, asserting `resolvedLegendLayers`/rendered DOM reflects the new
  zoom (`ZLGND-V123-04`).

### Baseline (measured this session)

```
cd packages/web && npx tsc --noEmit   → exit 0, clean
cd packages/web && npx vitest run     → 175 files passed (175), 3990 tests passed (3990), ~190s wall
```
100% green, matches the last recorded milestone baseline (v1.22 VERIFICATION: "web vitest 175
files / 3990 tests"). No `theme-guard.spec.ts` regression re-run needed separately — it's part of
the 3990.

## Standard Stack

No new stack. Zero new dependencies (constraint, confirmed nothing in the requirements needs one).
Everything is existing internal modules:

| Module | Role |
|---|---|
| `packages/web/src/components/charts/MapChartRenderer.tsx` | `applyZoomRangeToLayer` (source of truth for the translation), Effect 9c (publishes live zoom), the in-map legend call site |
| `packages/web/src/lib/resolveLegendLayers.ts` | Shared per-layer view-model — recommended home for the new `zoomActive`/`zoomRange` derivation |
| `packages/web/src/components/LayersLegendPanel.tsx` | Pure presentational renderer — gains a new modifier class + chip, no new store coupling |
| `packages/web/src/components/charts/LegendRenderer.tsx` | 2nd consumer — gains one new scoped selector, no new orphan branch |
| `packages/web/src/store/mapCurrentViewStore.ts` | Already-built live-zoom-per-widget store (Phase 111) — read-only for this phase, no changes needed to the store itself |

## Architecture Patterns

### Pattern: scoped primitive selector against a shared store (established, Phase 111/MapConfigPanel)

```typescript
// The ONE pattern to copy for both consumers — a primitive read, not the object.
const currentZoom = useMapCurrentViewStore((s) => s.views[someWidgetId]?.zoom);
```
Using `?.zoom` (a `number | undefined` primitive) rather than the whole `MapCurrentView` object
avoids re-rendering on an object-identity change that doesn't matter (there isn't one here since
`publish` always creates a new object, but the number is the actual dependency you care about, and
keeping the `useMemo` dependency array a primitive is the established convention throughout this
file — `legendKey`, `filterVersion`, `shapesKey` are all primitives, never object/array references).

### Pattern: derive-once, enrich-in-caller vs. derive-once-in-shared-function

Two valid precedents coexist in this codebase for "attach computed per-layer info to
`ResolvedLegendLayer`": `dvStatus`/`filterSummary` are enriched by EACH caller after calling
`resolveLegendLayers` (because they need store reads only the caller has a reactive trigger for);
`visible` itself is computed INSIDE `resolveLegendLayers` (because it's a pure function of the
layer's own config, no store needed). Zoom activity is a pure function of `(config, zoom)` with
`zoom` passed in as a plain argument — it matches the `visible` shape, not the `dvStatus` shape.
Recommend following the `visible` precedent (compute inside `resolveLegendLayers`), documented in
Q3 above.

### Anti-Pattern to avoid

- **Re-deriving the zoom-range comparison independently, even "just to be safe."** The codebase
  already has a cautionary tale of exactly this (`isLayerVisibleAtCurrentZoom`,
  `MapChartRenderer.tsx:1790-1798`) diverging from the OL-applied truth at fractional zoom. One
  formula, one place (Q1).
- **Reading `mapRef.current.getView().getZoom()` imperatively inside a `useMemo`.** Not reactive —
  will not satisfy `ZLGND-V123-04`. Always go through the store's scoped selector.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---|---|---|---|
| "Is this layer in its configured zoom range right now?" | A fresh comparison against raw `layer.config.minZoom/maxZoom` | Extract `applyZoomRangeToLayer`'s existing translation into a shared predicate | Two independent implementations of this exact comparison already exist in this codebase, and they disagree at fractional zoom — a third independent one is how a FOURTH divergent answer gets shipped |
| "Get the live zoom of a specific map widget" | A new store, a new ref-forwarding prop, or a DOM query | `mapCurrentViewStore` (Phase 111), already always-on, already keyed by `widget.id` | Purpose-built for exactly this; adding a second mechanism risks two sources of truth for the same number |
| "Show a small muted informational chip on a legend row" | A new CSS class + new tokens | `.layers-legend-panel-mode-chip` (currently unused, already token-based) | Reuse per CLAUDE.md; the class already exists in the exact right visual slot |

**Key insight:** this phase's entire risk surface is re-derivation. Every primitive it needs
(the translation formula, the live zoom, the chip styling slot) already exists somewhere in this
codebase; the work is wiring, not invention.

## Common Pitfalls

### Pitfall 1: Off-by-one at the zoom boundary from re-deriving the range check
**What goes wrong:** A panel-local `zoom >= minZoom && zoom <= maxZoom` check (the raw inclusive
reading of the wire format) disagrees with what OL actually draws at the boundary and at fractional
zoom values just below `minZoom`.
**Why it happens:** The wire format documentation itself reads naturally as "inclusive both ends,"
and it's easy to translate that literally without remembering OL's asymmetric exclusive-min
convention.
**How to avoid:** Extract from `applyZoomRangeToLayer`, don't re-read the doc comment and
re-implement (Q1).
**Warning signs:** A new predicate that doesn't subtract 1 anywhere.

### Pitfall 2: A stale-looking "unavailable zoom" being mistaken for "zoom-inactive"
**What goes wrong:** If `zoomActive` were defaulted to `false` instead of `undefined` when zoom is
unknown, the standalone Legend widget would show EVERY zoom-limited layer as dimmed/inactive the
moment its source map isn't mounted — the exact "confidently wrong" failure `ZLGND-V123-06` exists
to prevent.
**Why it happens:** `false` is a tempting default for "not proven active."
**How to avoid:** Three-state, not boolean-with-a-default: `undefined` (unknown/not-configured) vs.
`true`/`false` (known). Never coerce unknown to `false`.
**Warning signs:** A ternary or `??` that collapses "zoom unknown" into "inactive."

### Pitfall 3: CSS cascade order deciding a 3-way visual conflict nobody designed
**What goes wrong:** Adding a third independent boolean modifier class alongside the existing
`.hidden`/`--stale` pair means a layer that satisfies two of the three conditions gets whichever
CSS rule happens to appear later in `global.css` — an accident of file order, not a decision.
**How to avoid:** Compute a single mutually-exclusive display state in JS (hidden > stale >
zoom-inactive > active) before choosing which class(es) to apply, per the precedence recommendation
in Q4.

### Pitfall 4: Treating `global.css`'s theme-guard pass as proof of correct theming
**What goes wrong:** `global.css` is on the hex-guard's `ALLOWLIST` (theme-guard.spec.ts:57) — new
raw hex anywhere in the file passes automatically. A green test suite proves nothing about whether
the new zoom-inactive/chip styling is actually token-based or actually legible in both themes.
**How to avoid:** Use `var(--warning)`/`var(--chip-bg)`/`var(--border)`/`var(--muted)` by
inspection, not by trusting the test; route "does it look right in both themes" to a
`checkpoint:human-verify`.

## Code Examples

### The formula to extract (verified against the existing, passing spec)
```typescript
// Source: packages/web/src/components/charts/MapChartRenderer.tsx:202-218
export function applyZoomRangeToLayer(
  imageLayer: import("ol/layer/Image").default<any>,
  config: { minZoom?: number; maxZoom?: number },
): void {
  const nextMinZoom = config.minZoom === undefined ? -Infinity : config.minZoom - 1;
  const nextMaxZoom = config.maxZoom === undefined ? Infinity : config.maxZoom;
  if (imageLayer.getMinZoom() !== nextMinZoom) imageLayer.setMinZoom(nextMinZoom);
  if (imageLayer.getMaxZoom() !== nextMaxZoom) imageLayer.setMaxZoom(nextMaxZoom);
}
```

### The scoped-selector pattern to copy for both consumers
```typescript
// Source: packages/web/src/components/charts/MapConfigPanel.tsx:160-162
const currentView = useMapCurrentViewStore((s) =>
  widgetId === undefined ? undefined : s.views[widgetId]
);
```

### The DIVERGENT pattern that must NOT be copied
```typescript
// Source: packages/web/src/components/charts/MapChartRenderer.tsx:1790-1798
// NOTE: does not subtract 1 from minZoom — disagrees with applyZoomRangeToLayer at
// fractional zoom. Kept as-is (out of this phase's scope), but must not be the
// template for the new legend predicate.
const isLayerVisibleAtCurrentZoom = (layer: DashboardLayerDto): boolean => {
  if (currentZoom === undefined) return false;
  const cfg = layer.config as Partial<MapWidgetConfig>;
  const min = cfg.minZoom ?? -Infinity;
  const max = cfg.maxZoom ?? Infinity;
  return currentZoom >= min && currentZoom <= max;
};
```

## State of the Art

Not applicable in the usual "library version" sense — this is a same-repo, same-version internal
consistency problem, not an ecosystem-currency one. The one relevant "old approach → current
approach" is internal:

| Old approach | Current/recommended approach | Impact |
|---|---|---|
| Zoom-range visibility encoded only in `applyZoomRangeToLayer` (OL-facing) and separately, incorrectly, in `isLayerVisibleAtCurrentZoom` (info-click-facing) | A single shared predicate, consumed by both existing call sites AND the new legend derivation | Closes the door on a third divergent implementation; does not itself fix the existing info-click divergence (out of scope) |

## Open Questions

1. **Precedence when a layer is both eye-off/stale AND zoom-inactive.**
   - What we know: `.hidden` and `--stale` can already combine today; CONTEXT.md doesn't address a
     third state combining with either.
   - What's unclear: whether the operator wants zoom-inactive suppressed (my recommendation) or
     layered visually on top of eye-off/stale.
   - Recommendation: suppress (compute a single mutually-exclusive display state in JS) — see Q4.
     Confirm at UAT if there's any operator expectation otherwise.

2. **Should the zoom-range chip show only when inactive, or always when configured?**
   - What we know: the operator's locked wording ("zoom-limited rows show their configured range")
     doesn't explicitly condition this on active/inactive.
   - What's unclear: whether always-showing is "actionable fact" or "visual noise" on already-active
     rows, in the operator's eyes.
   - Recommendation: always-show when zoom is known (Q4) — one-line change either way if UAT
     disagrees.

3. **The pre-existing `isLayerVisibleAtCurrentZoom` divergence — fix now or log as tech debt?**
   - What we know: it's real, verified, and affects the info-click fan-out at fractional zoom near
     a layer's `minZoom` boundary.
   - What's unclear: whether it's ever been observed in practice (fractional zoom exactly in the
     `(minZoom-1, minZoom)` window is a narrow target) — no evidence of an operator-reported bug.
   - Recommendation: **do not fix in this phase** — it's not one of ZLGND-01..07, touching it would
     require new coverage in the info-click feature's own (large) test surface, and this phase's
     scope is explicitly the legend, not the info-click gate. Log as a tech-debt item for the
     phase's closeout notes: `TD-ZLGND-INFOZOOM` — `isLayerVisibleAtCurrentZoom`
     (`MapChartRenderer.tsx:1790`) uses raw inclusive bounds instead of the `-1`-translated OL
     bounds; diverges from `applyZoomRangeToLayer` at fractional zoom just below `minZoom`.

## Acceptance Criteria — Grep-Based Candidates (run BEFORE writing them into a plan)

Per CLAUDE.md: a grep criterion is only meaningful if it reads 0 (or fails) before the work. All of
the below were run this session against the current tree (`packages/web/src`, pre-implementation).
`grep -c` counts LINES, not occurrences — noted where relevant.

| Candidate grep | Current count | Usable as a 0→N criterion? |
|---|---|---|
| `grep -rn "isLayerActiveAtZoom" src \| wc -l` | 0 | Yes — new symbol name, introduced by this phase |
| `grep -rn "zoomActive" src \| wc -l` | 0 | Yes — new field name |
| `grep -rn "zoomRange" src \| wc -l` | 0 | Yes — new field name |
| `grep -rn "layers-legend-panel-layer-block--zoom-inactive" src \| wc -l` | 0 | Yes — new class name, but prefer a mutation probe (below) for the behavior it gates, not just presence of the string |
| `grep -rn "isLayerVisibleAtCurrentZoom" src \| wc -l` | 2 (both in `MapChartRenderer.tsx`: the definition + its one call site) | NOT usable as a "this phase introduced X" anchor — it already exists; only useful as a "did NOT change" regression check if the plan chooses to leave it alone |
| `grep -c "layers-legend-panel-mode-chip" src/components/LayersLegendPanel.spec.tsx` | 6 (lines) | Only usable as a "still exactly 6, all still asserting null OR now some assert non-null for zoom-limited fixtures" — a bare `≥1`/`=6` count proves nothing on its own; assert the SPECIFIC new test titles instead |
| `grep -c "^\s*--warning:" src/styles/global.css` | 2 (one per theme block, pre-existing) | Not a "this phase added it" anchor — the token already exists; do not use it as evidence of new work |

**Recommended anchors for the actual plan** (all currently 0, verified above): `isLayerActiveAtZoom`,
`zoomActive`, `zoomRange`, `layers-legend-panel-layer-block--zoom-inactive`. Prefer pairing each
structural-existence grep with a **mutation probe** for the behavioral criteria that matter most
(per CLAUDE.md's explicit preference where a guard genuinely matters):
- Break `isLayerActiveAtZoom`'s `-1` translation (e.g. remove the `- 1`) → the extracted predicate's
  own spec (mirroring `applyZoomRangeToLayer.spec.ts`'s boundary cases) must redden. This is the
  real proof of `ZLGND-V123-05`, not a grep for the function's existence.
- Force `resolveLegendLayers` to treat `zoom === undefined` as `zoomActive: false` instead of
  `undefined` → `LegendRenderer.spec.tsx`'s new "zoom unavailable degrades to today's appearance"
  test must redden. This is the real proof of `ZLGND-V123-06`.

## Sources

### Primary (HIGH confidence — read directly from this repository)
- `packages/web/src/components/charts/MapChartRenderer.tsx:160-1560, 2260-2330` — `applyZoomRangeToLayer`,
  `includedLayers` filtering, `isLayerVisibleAtCurrentZoom`, Effect 9c publish, `legendKey`/`resolvedLegendLayers` useMemo
- `packages/web/src/components/LayersLegendPanel.tsx` (full file) — existing visual-state vocabulary
- `packages/web/src/lib/resolveLegendLayers.ts` (full file) — current shape of the shared view-model
- `packages/web/src/lib/resolveLegendLayers.spec.ts` (full file) — existing test pattern/count
- `packages/web/src/components/charts/applyZoomRangeToLayer.spec.ts` (full file) — existing boundary
  assertions, used to verify the zoom=2.9/3/10/10.5 table above
- `packages/web/src/components/charts/LegendRenderer.tsx` (full file) — orphan-state logic, `sourceMapWidgetId`
- `packages/web/src/components/charts/LegendRenderer.spec.tsx` — confirmed zero `mapCurrentViewStore` mock present
- `packages/web/src/store/mapCurrentViewStore.ts` (full file) — `views`/`publish`/`clear`/`reset` semantics
- `packages/web/src/components/charts/MapConfigPanel.tsx:140-178` — scoped-selector precedent pattern
- `packages/web/src/components/charts/MapConfigPanel.spec.tsx:1-70` — the simpler mock pattern to copy for `LegendRenderer.spec.tsx`
- `packages/web/src/components/charts/MapChartRenderer.spec.tsx:130-560` — existing OL mock, `fireAllMoveend` harness, `mapCurrentViewStore` mock
- `packages/web/src/styles/global.css:4000-4232` — all existing legend-panel CSS, `--warning`/`--chip-bg`/`--border`/`--muted` token definitions (lines 5-141)
- `packages/web/src/styles/theme-guard.spec.ts` (full file) — confirmed exact ALLOWLIST mechanism for `global.css`
- `packages/web/src/lib/wmsUrlBuilder.ts:60-79` — `MapWidgetConfig.minZoom/maxZoom` type + doc comment
- `packages/web/src/api/client.ts:622-666` — `DashboardLayerDto.config: Record<string, unknown>` shape
- `packages/web/src/hooks/useLayerVisibilityToggle.ts` (full file) — confirms eye-toggle mechanism (filters layer OUT of `includedLayers`, does not use OL `setVisible`)
- Commands run this session: `cd packages/web && npx tsc --noEmit` (exit 0), `npx vitest run` (175 files / 3990 tests passed), assorted `grep -rn`/`grep -c` counts reported inline above

### Secondary / Tertiary
None — no external sources were needed for this phase; everything is internal-codebase
verification.

## Metadata

**Confidence breakdown:**
- Standard stack: N/A (no new stack) — HIGH confidence that no new dependency is needed, confirmed by reading all touched files
- Architecture (Q1-Q3 threading/predicate design): HIGH — every claim traced to a specific file/line and, where behavioral, cross-checked against an existing passing spec
- Pitfalls: HIGH — Pitfall 1 is not theoretical, it's a verified pre-existing divergent implementation in this exact codebase
- Styling recommendations (Q4 specific opacity/border values, chip reuse): MEDIUM — token usage and theme-guard mechanics are HIGH confidence; the exact visual treatment is a judgment call flagged for human-verify, not a fact

**Research date:** 2026-09-16
**Valid until:** No external dependency to go stale; valid until `MapChartRenderer.tsx`,
`resolveLegendLayers.ts`, `LayersLegendPanel.tsx`, `LegendRenderer.tsx`, or `mapCurrentViewStore.ts`
are next modified by another phase (check before use if any of those five files show diffs in
`.planning/STATE.md` after this date).
