# Phase 101: Smart / Logarithmic Y-Axis - Context

**Gathered:** 2026-07-01
**Status:** Ready for planning

<domain>
## Phase Boundary

Add a per-widget Y-axis scale mode — Zero-based / Smart / Logarithmic — to the LINE (numeric-line), TIMELINE, and BAR charts, applied via recharts `domain`/`scale` axis props. Pure render-config, mirroring the v1.17 per-widget `yAxisFormat` pattern. Scoped to line / timeline / bar only (pie / calendar excluded → deferred YAXIS-V2-01). No SQL/materialize change.

Covers: YAXIS-V119-01 (mode picker), YAXIS-V119-02 (smart = non-zero data range), YAXIS-V119-03 (log scale), YAXIS-V119-04 (absent → unchanged).

</domain>

<decisions>
## Implementation Decisions

### Default / absent-config behavior (byte-identical — the key decision)
- The config field is OPTIONAL (`yAxisScale?`). When **absent**, the renderer emits **NO `domain`/`scale` props** — exactly as today — so every existing widget is BYTE-IDENTICAL (bar stays zero-based, line/timeline stay recharts-auto/data-derived). This is the literal guarantee for YAXIS-V119-04.
- IMPORTANT context (why absent ≠ a single uniform default): the CURRENT Y-axis default differs by chart — **bar** renders zero-based (`[0,'auto']`), **line/timeline** render data-derived (recharts auto). So there is NO single "default mode" that is byte-identical across all three; the byte-identical guarantee is achieved by emitting no props when unconfigured, NOT by defaulting everything to one mode.
- The dropdown's displayed effective default for an unconfigured widget SHOULD reflect that chart's current mode (bar → "Zero-based", line/timeline → "Smart"), but selecting a mode explicitly is what activates props. (Whether to show a synthetic "default" label vs the effective mode is Claude's discretion — the hard rule is: absent → no props.)

### The three explicit modes (recharts props when the field IS set)
- **Zero-based:** `domain={[0, 'auto']}`. (On bar this equals the current absent behavior → byte-identical; on line/timeline it forces a 0 baseline — a deliberate user choice.)
- **Smart:** `domain={['auto', 'auto']}` — recharts nice/rounded/padded non-zero bounds (does not force 0). Applied uniformly to ALL value axes.
- **Logarithmic:** `scale="log"` + `domain={[<smallest positive data value>, 'auto']}` (or dataMax) + `allowDataOverflow={true}`. See log edge-case rule below.

### Multi-axis application
- The single per-widget `yAxisScale` applies UNIFORMLY to every value axis. Timeline and numeric-line have per-metric value axes (multi-metric ungrouped) — all of them get the same domain/scale treatment. Bar has one value axis (which becomes the X axis in horizontal layout — apply to whichever axis is the value axis).

### Logarithmic edge cases (zero / negative data)
- Log is undefined at ≤ 0. Since there's no SQL change, data can contain zeros/negatives.
- **Clamp the log domain lower bound to the smallest POSITIVE value in the resolved chart data** (compute at render), with `allowDataOverflow={true}` so recharts doesn't re-expand it; non-positive points clip/fall off rather than blanking the whole chart.
- If there is NO positive data at all, degrade gracefully (fall back to the widget's normal/empty render rather than a hard crash) — planner picks the concrete fallback.

### Control placement + label
- A `<select>` labeled **"Y-axis scale"** placed right AFTER the v1.17 `yAxisFormat` control in each config surface: `TimelineConfigPanel` (after ~line 577-584), `NumericLineConfigPanel` (after ~line 542-549), and BAR via a registry `ConfigField` in `definitions/bar.ts` (after the `yAxisFormat` field, rendered by the generic ChartConfigPanel `FieldRenderer`). Options: Zero-based / Smart / Logarithmic. Reuse existing `ds-select` / config conventions; NO invented classNames.

### Config model
- Add optional `yAxisScale?: "zero" | "smart" | "log"` (concrete union-value naming is Claude's discretion) to `TimelineConfig` (TimelineConfigPanel.tsx) and `NumericLineConfig` (NumericLineConfigPanel.tsx) types, and as a `select` field + defaultConfig entry in `definitions/bar.ts`. Optional → absent coalesces to the no-props path.

### Claude's Discretion
- Exact union value strings; whether "smart" is `['auto','auto']` vs `['auto','auto']`-with-explicit-padding; the shared helper that maps mode → recharts axis props (recommended: one pure helper consumed by all 3 renderers to avoid drift, mirroring how v1.17 centralized the tick formatter).
- The exact positive-min computation + the no-positive-data fallback for log.
- Whether the dropdown shows a synthetic "Default (current)" entry vs the chart's effective mode.

</decisions>

<specifics>
## Specific Ideas

- User's framing: "smart y axis option does not have to show 0 but instead uses the scope of the data to calculate the y axis min and max values. Another y axis option should also be to use logarithmic."
- Applies to line chart, timeline chart, AND bar chart (confirmed during milestone questioning).

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.** No external specs — canonical source is the v1.17 `yAxisFormat` precedent to mirror:

### Requirements
- `.planning/REQUIREMENTS.md` §"Smart / Logarithmic Y-Axis (YAXIS)" — YAXIS-V119-01/02/03/04.
- `.planning/ROADMAP.md` §"Phase 101" — goal, invariant (pure render-config; line/timeline/bar only), 4 success criteria.

### v1.17 yAxisFormat precedent to mirror (from codebase scout)
- `TimelineConfigPanel.tsx` — `TimelineConfig` type (~41-56, `yAxisFormat?` at ~47) + the `FormatSpecEditor` control placement (~577-584).
- `NumericLineConfigPanel.tsx` — `NumericLineConfig` type (~37-51, `yAxisFormat?` at ~43) + control (~542-549).
- `definitions/bar.ts` — registry `ConfigField[]` incl. the `yAxisFormat` formatSpec field (~25) + `defaultConfig` (~30-44).
- `TimelineRenderer.tsx` — `yAxisTickFormatter` useMemo (~162-175) + `<YAxis>` elements (single-metric ~606-614, multi-metric ~633-642). Current: no `domain`/`scale` props.
- `NumericLineRenderer.tsx` — `yAxisTickFormatter` (~151-164) + `<YAxis>` (~572-580, ~599-608). Current: no `domain`/`scale`.
- `WidgetRenderer.tsx` (bar path) — `valueAxisTickFormatter` (~945-959) + `<YAxis>` vertical (~990) / `<XAxis type="number">` horizontal (~984). Current: no explicit `domain`/`scale` (bar defaults zero-based).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- The v1.17 `yAxisFormat` wiring is the exact template: optional config field → config-panel control after it → renderer reads `cfg.yAxisScale` and applies to the same `<YAxis>`/`<XAxis>` elements the tick formatter already targets.
- Recommend a single pure helper (e.g. `yAxisScaleProps(mode, data)` → `{ domain?, scale?, allowDataOverflow? }`) consumed by all 3 renderers, mirroring how the tick formatter was centralized — one source of truth, unit-testable.

### Established Patterns
- Optional config field coalescing (absent → legacy path); `configVersion`-reactive renderer recompute.
- recharts `<YAxis>`/`<XAxis type="number">`; `domain`/`scale`/`allowDataOverflow` props. Bar value axis flips to X in horizontal layout.

### Integration Points
- Config: `TimelineConfig` + `NumericLineConfig` types + `definitions/bar.ts` field/default.
- Panels: scale-mode `<select>` after the `yAxisFormat` control in Timeline/NumericLine panels; bar via generic FieldRenderer.
- Renderers: spread the helper's props onto every value-axis element in TimelineRenderer, NumericLineRenderer, and the bar `<YAxis>`/`<XAxis>` in WidgetRenderer.

### Invariants
- Pure render-config — `AggregatedWidgetRenderer` stays SOLE materialize trigger; no SQL/materialize change. Absent config → NO axis props → byte-identical (criterion 4). Line/timeline/bar only. Theme tokens only; reuse existing classNames.

</code_context>

<deferred>
## Deferred Ideas

- Smart / log Y-axis on pie / calendar / other chart types — YAXIS-V2-01 (future).
- Per-axis independent scale modes for multi-metric charts (v1.19 = one uniform per-widget mode).
- X-axis / dual-axis scale controls — out of scope.

</deferred>

---

*Phase: 101-smart-logarithmic-y-axis*
*Context gathered: 2026-07-01*
