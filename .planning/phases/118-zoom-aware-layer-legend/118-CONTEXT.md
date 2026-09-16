# Phase 118: Zoom-Aware Layer Legend - Context

**Gathered:** 2026-09-16
**Status:** Ready for planning

<domain>
## Phase Boundary

The layers panel makes it obvious which layers are actually drawing on the map at the current zoom,
distinguishes zoom-inactive from operator-hidden, and shows the zoom range that would bring a dimmed
layer back.

**In scope:** ZLGND-V123-01 … ZLGND-V123-07.

**NOT in scope:** changing zoom-range CONFIGURATION (`ZoomRangeSlider`, `KineticaWmsLayerForm` are
untouched); auto-zooming the map to a layer's range (`ZLGND-F1`); a live zoom readout in the panel
header (`ZLGND-F2`, considered and not chosen); config-time warnings about unsatisfiable ranges
(`ZLGND-F3`). No server changes — everything needed is already client-side.

**The operator's words, verbatim:**

> *"Lets make it more apparent which are the active layers on the layers panel. There are
> configurations for each layer to show at different zoom levels but as you zoom in and out you
> cannot tell which layer is actively being shown on the map. It would be nice to know which is the
> active one and all the layers that are not active on the current zoom level should be clear."*

The panel today describes the **configuration**. This phase makes it describe the **map**.

</domain>

<decisions>
## Implementation Decisions

### Locked by the operator (2026-09-16)

**1. Distinct treatments for the two "not drawing" reasons.**
- Eye-off (operator toggled it) keeps **today's existing `hidden` styling** — unchanged.
- Zoom-inactive gets its **own** dimmed treatment, visually distinct from both active and eye-off.
- Rationale, in the operator's framing: one state you chose, one that resolves itself by zooming.
  Rendering them identically would replace one ambiguity with another. **Do not collapse these.**

**2. Zoom-limited rows show their configured range** (e.g. "zoom 8-14").
- The data is already in `layer.config`; this turns "why is this faded" into an actionable fact.
- Rejected alternatives, both offered and declined: dim with no explanation (leaves the user
  guessing — the original complaint); a single live-zoom readout in the panel header (one number, but
  you would still have to open each layer's config to learn its range).

### The semantics trap — get this wrong and the feature is worse than nothing

`MapChartRenderer.tsx:185-215` (`applyZoomRangeToLayer`) documents that **the wire format is
INCLUSIVE while OpenLayers' `minZoom` is EXCLUSIVE**:

```
internalMin = userMin - 1      // config [3,10] means "show at 3,4,…,10"
internalMax = userMax          // OL: visible when zoom > minZoom && zoom <= maxZoom
undefined   → -Infinity / Infinity   // no constraint
```

A panel that re-derives "is this in range?" from the raw config will be **off by one at the
boundary** and will confidently mark a layer active at a zoom where the map is not drawing it.
**That is worse than no indicator**, because it is silently wrong rather than absent.

`ZLGND-V123-05` exists to make this a requirement rather than an implementation detail. The
derivation must match `applyZoomRangeToLayer`'s translation — **prefer deriving from the same helper
(or a shared extraction of it) over re-implementing the rule.** Research should establish whether OL
exposes the effective state directly (e.g. `layer.getVisible()` combined with resolution/zoom
constraints) so the panel can read truth rather than recompute it.

### Two consumers, and only one of them has a map

`LayersLegendPanel` is rendered by **two** components:

1. **`MapChartRenderer.tsx:2428`** — inside the map. Has `widgetId`, has the live OL view.
2. **`LegendRenderer.tsx:129`** — the Phase 42 standalone Legend *widget*, a dashboard tile that
   **mirrors a chosen map widget's legend**. It has NO map of its own, but it DOES know which map it
   mirrors via `widget.config.sourceMapWidgetId`.

Because `mapCurrentViewStore` is keyed by `widgetId`, the standalone legend can read its source map's
live zoom. **But the source map may not be mounted** (different dashboard, deleted widget, or simply
not rendered), in which case there is no live zoom for it.

**Locked:** when live zoom is unavailable, the standalone legend **degrades to today's appearance** —
no zoom indication at all, rather than guessing or showing everything as inactive. A confidently
wrong panel is the failure mode this phase exists to prevent. That is `ZLGND-V123-06`.

`LegendRenderer.tsx` already documents an "orphan state" for three cases (no `sourceMapWidgetId`,
bound widget deleted, bound widget not a map). **Unavailable-zoom is a FOURTH state and is different
from all three** — the binding is valid, the map simply is not currently mounted. Do not fold it into
the existing orphan UI.

### Layers with no configured range

`ZLGND-V123-07`: a layer with neither `minZoom` nor `maxZoom` is always drawing, so it must render
**exactly as it does today** — no new styling, no range chip, no dimming. Most layers are likely in
this category, so a regression here would be highly visible.

### Claude's Discretion

- The exact visual treatment for zoom-inactive (opacity, a badge, a muted row) — subject to the
  theme-token constraint below.
- Where the "is drawing at this zoom" predicate lives (shared lib, extraction from
  `applyZoomRangeToLayer`, or read from OL) — as long as `ZLGND-V123-05` holds.
- The range chip's exact copy and format ("zoom 8-14", "8-14", "z8-14").
- How the panel subscribes to live zoom without re-rendering on every mouse-move — note
  `mapCurrentViewStore` publishes on `moveend`, not continuously, which should make this cheap.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these.**

### The semantics that must not be re-derived wrongly
- `packages/web/src/components/charts/MapChartRenderer.tsx` **:185-215** — `applyZoomRangeToLayer`,
  the inclusive→exclusive translation and the `undefined` → ±Infinity fallback. This is the source of
  truth for "is this layer drawing".
- `packages/web/src/components/charts/MapChartRenderer.tsx` :1500-1545 — the two call sites that
  apply the range to real OL layers.

### The panel and its two consumers
- `packages/web/src/components/LayersLegendPanel.tsx` — the shared panel; note the existing
  `visible` flag and `hidden` class already used for eye-off.
- `packages/web/src/lib/resolveLegendLayers.ts` **:64** — `visible` is `config.visible !== false`,
  i.e. the OPERATOR's preference only. Zoom activity is a NEW, orthogonal axis.
- `packages/web/src/components/charts/LegendRenderer.tsx` — the standalone Legend widget, the second
  consumer, with its `sourceMapWidgetId` binding and its documented 3-case orphan state.

### Live zoom
- `packages/web/src/store/mapCurrentViewStore.ts` — per-`widgetId` live `{center, zoom}`, published on
  mount and every `moveend` (Phase 111, ungated). Reset on logout and dashboard switch.

### Requirements & scope
- `.planning/REQUIREMENTS.md` — ZLGND-V123-01..07 and the two locked operator decisions
- `.planning/ROADMAP.md` §"Phase 118" — goal and the 7 success criteria

### Project conventions (binding)
- `CLAUDE.md` — UI conventions (**never invent a className**; reuse `global.css`; **no hardcoded
  hex**, theme tokens only) AND §"Writing verifiable acceptance criteria".

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets — everything this phase needs already exists
- **`mapCurrentViewStore`** already gives live zoom per widget, on mount + `moveend`. No new plumbing.
- **`applyZoomRangeToLayer`** already encodes the correct range semantics. Extracting a predicate from
  it is likely cheaper and safer than writing a new one.
- **`LayersLegendPanel`** already renders per-layer rows and already has a two-state visual vocabulary
  (`visible` / `hidden`). This phase adds a third state, it does not restructure the panel.
- **`ResolvedLegendLayer`** (`lib/resolveLegendLayers.ts`) is the existing per-layer view-model and the
  natural place for a zoom-activity field.

### Established Patterns
- `MapChartRenderer` already consumes `mapCurrentViewStore` — the subscription pattern to mirror is in
  that file.
- `LegendRenderer` documents its subscription discipline explicitly (primitive selector `legendKey`,
  PITFALL S-02, imperative `getState()` inside `useMemo`). **Follow it; do not add a broad selector
  that re-renders the tile on unrelated store writes.**

### Integration Points
- `lib/resolveLegendLayers.ts` — where a `zoomActive` field would naturally be computed, IF the live
  zoom can be threaded in. Note it is currently zoom-agnostic and shared by both consumers.
- `components/LayersLegendPanel.tsx` — the rendering.
- `packages/web/src/styles/global.css` — any new styling. **theme-guard exempts this file WHOLESALE
  from its hex scan** (`ZLGND-V123-07` / criterion 7), so a hardcoded colour here passes every
  automated gate and fails only in front of a human. This is precisely how Phase 114's
  `.onboarding-banner` light-mode defect shipped. Use tokens, and route both themes to human checks.

### Known hazards from this codebase
- **theme-guard's `global.css` blind spot** — see above. The single highest-risk aspect of this phase.
- **StrictMode double-invoke** — any one-shot ref must be set inside an effect.
- **Sync-after-async spec sites** — ~105 candidates exist suite-wide; do not introduce new ones.
  Prefer `await findBy*` when asserting on content that arrives in a later commit.
- **Toothless acceptance criteria** — TWENTY-ONE occurred across Phases 115-117, mostly from plans
  anchoring a grep on prose the plan itself mandated in a comment. Anchor on symbols the work
  introduces; run every grep before writing it down; `grep -c` counts LINES, not occurrences.

</code_context>

<specifics>
## Specific Ideas

- The operator's phrase *"all the layers that are not active on the current zoom level should be
  clear"* — "clear" read in context as *visually de-emphasised / faded*, not *removed*. Removing rows
  as you zoom would make the panel jump around and hide configuration the operator is trying to
  understand. Confirm this reading at UAT.
- This came from real use: the operator configures per-layer zoom ranges, then cannot tell which
  layer is responsible for what is on screen. The feature's success test is whether that question
  becomes answerable at a glance.

</specifics>

<deferred>
## Deferred Ideas

- **`ZLGND-F1`** — click a zoom-limited row to zoom the map into that layer's range. A natural
  follow-on once the range is visible.
- **`ZLGND-F2`** — live zoom readout in the panel header. Offered and declined in favour of per-row ranges.
- **`ZLGND-F3`** — config-time warning when a layer's zoom range cannot be satisfied by the map's own
  min/max zoom.

</deferred>

---

*Phase: 118-zoom-aware-layer-legend*
*Context gathered: 2026-09-16*
