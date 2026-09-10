# Phase 111: Map Default View — Capture & Save - Context

**Gathered:** 2026-09-09
**Status:** Ready for planning

<domain>
## Phase Boundary

A designer captures a map widget's exact current view (zoom + center) and persists it as that widget's default, or clears a previously saved one — from the map's own config panel.

**In scope:** MAPVIEW-V121-01 (capture & save), MAPVIEW-V121-04 (clear).
**NOT in scope:** applying the saved default when a map loads — that is Phase 112 (MAPVIEW-V121-02/-03/-05/-06). Phase 111 writes the config field; Phase 112 reads it.

</domain>

<decisions>
## Implementation Decisions

### Verifying what gets saved (the area discussed)

The driving fact: `.modal-overlay` is `position: fixed; inset: 0` with `rgba(0, 0, 0, 0.78)`, so **the map is completely hidden while its config modal is open**. The designer frames a view, opens config, and then cannot see what they are about to save. Every decision below follows from that.

- **The control MUST show the view it would capture, live.** Not a bare button. Something of the form `Set as default — zoom 12.4 · 40.71°N, 74.01°W`. Blind-saving behind an opaque overlay was explicitly rejected.
- **Human-readable coordinates.** Degrees with hemisphere (`40.71°N, 74.01°W`), not raw EPSG:3857 metres. The whole point is that a person can tell at a glance whether they framed New York or the Atlantic. OL holds the centre in EPSG:3857, so this needs an `ol/proj` transform to EPSG:4326 for DISPLAY — `transform` is already imported and used in `MapChartRenderer.tsx`.
- **When a default already exists, show BOTH values** — the saved default and the pending replacement — so the overwrite is visible before it happens. There is no undo; the previous value is gone once replaced. Roughly:
  ```
  Current default: zoom 8 · 40.7°N, 74.0°W
  [ Set as default — zoom 12.4 · 41.2°N, 73.8°W ]
  ```
- **Store the exact fractional OL zoom** (e.g. `12.437`); **display it rounded** (`zoom 12.4`). Reopening reproduces precisely the framed view; the readout stays tidy. Do NOT round the stored value to 1dp or to whole zoom levels — both were considered and rejected.

**Consequence for the mechanism (this is the phase's flagged unknown, now constrained):** the panel needs a **continuous** read of the live view of the *specific* map being configured — not merely a value sampled at click time — because the readout updates before any click. Storage format (EPSG:3857 vs 4326) is Claude's call; only the DISPLAY format is fixed above.

### Claude's Discretion

The user reviewed these and chose not to constrain them. Follow existing panel conventions:

- **Control placement & wording** — recommendation on the table was its own `DEFAULT VIEW` group adjacent to the existing `VIEWPORT SYNC` section. Exact section and button label are open.
- **Save confirmation** — note the both-values readout already provides passive confirmation: the "Current default" line changes on save. An additional toast/label-flip may be unnecessary. Config auto-saves silently everywhere else in this panel.
- **Clear affordance** — always-visible Clear vs only-when-set, and what the readout reads when nothing is saved (e.g. "No default — opens at world view").
- Storage shape of the saved value inside the widget `config` blob.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

No external specs, ADRs or design docs exist for this phase — this project keeps its decisions in the planning docs rather than a `docs/` tree. The authoritative references are:

### Requirements & scope
- `.planning/REQUIREMENTS.md` — MAPVIEW-V121-01 and -04 are this phase; §"Implementation constraints carried into planning" items 1 and 2 are binding
- `.planning/ROADMAP.md` §"Phase 111" — goal, success criteria, and the research flag
- `.planning/PROJECT.md` §"Current Milestone: v1.21" — locked scope decisions and known integration constraints

### Project conventions (binding)
- `CLAUDE.md` — UI conventions. Reuse existing utility classes from `packages/web/src/styles/global.css`; NEVER invent a className (an invented class renders unstyled and still passes tsc, vitest and theme-guard). Buttons: `btn-primary btn-sm` + `ghost-sm` inside `<div className="ds-actions">`. No hardcoded hex — theme tokens only.
- `.planning/codebase/CONVENTIONS.md` — fuller code-style picture

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `ol/proj` `transform` — already imported and used in `MapChartRenderer.tsx`; needed to convert EPSG:3857 → EPSG:4326 for the lat/lon readout. Already mocked in the map specs (`vi.mock("ol/proj")`), so tests have a precedent.
- `packages/web/src/styles/global.css` — `ds-field`, `ds-field-label`, `config-group`, `config-group-label`, `config-hint`, `btn-primary btn-sm`, `ghost-sm`, `ds-actions`. Everything this control needs already exists.
- `mapViewportSyncStore.ts` — a working example of publishing `{center, zoom}` from `MapChartRenderer` on `moveend`. Reuse the PATTERN, not the store (see below).

### Established Patterns
- **Map config auto-saves.** 300ms debounce, no explicit Save button (PROJECT.md key decision, v1.2). `MapConfigPanel` persists via `onChange({...config, key: value})`.
- **`MapConfigPanel` has NO buttons today** — every control is a checkbox, select or number input. This control would be the first, so it must adopt the `ds-actions` + `btn-primary btn-sm` / `ghost-sm` convention from CLAUDE.md rather than inventing styling.
- Panel sections in order: `BASEMAP`, `LAYERS`, `INFO POPUP`, `MAP CONTROLS`, `VIEWPORT SYNC`, `SHAPE DISPLAY`, `SPATIAL FILTER TARGETS`.

### Integration Points
- `MapChartRenderer.tsx:1038` — the OL `View` is constructed with hardcoded `center: [0, 0], zoom: 2`. Phase 112 changes this; Phase 111 does not.
- `MapChartRenderer.tsx:805` — the OL map lives in a private `mapRef`, local to the component instance. Nothing outside can currently reach it.
- `MapConfigPanel.tsx:79` — `MapConfigPanel({ config, onChange, tables }: ConfigPanelProps)`.
  **CORRECTION (2026-09-09, from Phase 111 research):** an earlier draft of this file
  claimed `ConfigPanelProps` carries no widget id and that plumbing was required. That
  was WRONG — it came from a truncated grep. `ConfigPanelProps.widgetId?: number` exists
  at `registry.ts:97` (added in Phase 109.1 / FSCOPE-V120-04) and is ALREADY threaded:
  `DashboardsPage.tsx:1558` → `ChartConfigPanel.tsx:611` → the CustomConfigPanel slot.
  `MapConfigPanel` only has to destructure a prop it already receives. Note it is
  OPTIONAL (`?`), so the panel must handle `undefined`. No prop-chain work is needed.

### The flagged unknown — narrowed, not solved
`mapViewportSyncStore` is NOT reusable as the source of the live view:
1. It publishes **only when the per-map "Sync viewport" toggle is ON** (default off, MAPSYNC-V119-06) — so for most maps it holds nothing.
2. It is keyed by **`dashboardId`, not `widgetId`** — a single last-writer-wins broadcast slot. On a dashboard with two maps it would return the wrong map's view.

A per-`widgetId`, always-on path to the live view is needed. The sync store's publish-on-`moveend` pattern (`MapChartRenderer` Effect 9a) is the right shape to copy. **RESOLVED at research time — see `111-RESEARCH.md`.** The widget id was never the hard part (it is already threaded, see correction above); the missing piece is a store to publish into.

</code_context>

<specifics>
## Specific Ideas

- The originating request: *"Can we have the user zoom into somewhere and then click the config and say set current zoom level as default zoom level."* Note the user said "zoom level" but described zooming **into somewhere** — hence zoom AND centre, locked at milestone scoping.
- Backlog phrasing (`.claude/rpToDos.txt`): *"map needs a way to configure the initial zoom level for the map"*.

</specifics>

<deferred>
## Deferred Ideas

- **A "set default view" button on the map's own toolbar** (rather than in config) would remove the hidden-map problem entirely. Out of scope: MAPVIEW-V121-01 specifies the control lives in the map's config. Worth revisiting if the readout proves insufficient in UAT.
- **Dashboard-level default view** applied to every map at once — already captured as MAPVIEW-F2 in REQUIREMENTS.md Future.
- **Auto-fit-to-data as an alternative default** — MAPVIEW-F1. Deliberately removed in Phase 12-02; not being resurrected here.

</deferred>

---

*Phase: 111-map-default-view-capture-save*
*Context gathered: 2026-09-09*
