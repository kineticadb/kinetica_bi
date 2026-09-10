# Phase 86: Chart Y-Axis Number Format (Timeline + Line) — Research

**Researched:** 2026-06-26
**Domain:** Recharts YAxis tickFormatter, TimelineConfig/NumericLineConfig type extension, FormatSpec reuse, hybrid default resolution
**Confidence:** HIGH — all findings sourced directly from the live codebase; no external research required

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| AXIS-V117-01 | Timeline + line config panels each expose a Y-axis number-format control reusing column number-format options (incl. SI) | Add `yAxisFormat?: FormatSpec` to `TimelineConfig` + `NumericLineConfig`; add a format-kind picker + per-kind controls section to each config panel's OPTIONS block — reuse the `SIControls`/`NumberControls` sub-component pattern already in `ColumnFormatEditorModal.tsx` |
| AXIS-V117-02 | Y-axis format defaults to the bound value column's display-config formatter; per-widget override clears back to that default | `resolveFormatter(tableId, metrics[0].column)` is the default when `yAxisFormat` is absent/cleared; per-widget `yAxisFormat` present → use `buildFormatter(yAxisFormat)` instead; clearing = deleting the field from config (patch with `yAxisFormat: undefined`) |
| AXIS-V117-03 | Resolved formatter applied to Y-axis tick labels only via `tickFormatter`; tooltips and data labels NOT changed | The value axes (`<YAxis type="number" ...>` in horizontal, `<XAxis type="number" ...>` in vertical) get a `tickFormatter` prop; the `<Tooltip content={<ColumnFormatTooltip .../>}/>` and any data labels retain the unmodified `resolveFormatter` path — these are fully separate code paths |
</phase_requirements>

---

## Summary

Phase 86 is a **pure extension** of two existing chart config panels + renderers, reusing the `FormatSpec` type and `buildFormatter` function already shipped in v1.15/Phase 85. No new libraries are needed, no server changes, and no new CSS classes are required.

The central insight is that `TimelineRenderer` and `NumericLineRenderer` already have well-structured value-axis JSX with no `tickFormatter` prop today — adding one is a single-prop addition per axis element. The hybrid default requires one new `useMemo` per renderer that resolves `resolveFormatter(tableId, metrics[0].column)` when no per-widget override is set.

The only architectural decision the planner must make is whether to extract a `FormatSpecEditor` shared sub-component or inline-copy the picker + controls in each config panel. The lowest-churn call is extraction — both panels need identical UI, and the existing `SIControls`/`NumberControls`/`DateControls`/`D3Controls` sub-components in `ColumnFormatEditorModal.tsx` are already self-contained and can be extracted with no logic change.

**Primary recommendation:** Add `yAxisFormat?: FormatSpec` to both config types, add a shared `FormatSpecEditor` sub-component (extracted from `ColumnFormatEditorModal.tsx`), wire it into both config panels' OPTIONS sections, and add a `tickFormatter` to each value axis in both renderers.

---

## Integration Points (exact files and patterns)

### 1. The Two Charts in Scope

Both charts were confirmed as the v1.14 Phase 72 group-by precedent subjects:

| Role | Timeline | NumericLine |
|------|----------|-------------|
| Config panel | `packages/web/src/components/charts/TimelineConfigPanel.tsx` | `packages/web/src/components/charts/NumericLineConfigPanel.tsx` |
| Config type | `TimelineConfig` (exported, line 31) | `NumericLineConfig` (exported, line 27) |
| Renderer | `packages/web/src/components/charts/TimelineRenderer.tsx` | `packages/web/src/components/charts/NumericLineRenderer.tsx` |
| Config panel spec | `packages/web/src/components/charts/TimelineConfigPanel.spec.tsx` | `packages/web/src/components/charts/NumericLineConfigPanel.spec.tsx` |
| Renderer spec | `packages/web/src/components/charts/TimelineRenderer.spec.tsx` | `packages/web/src/components/charts/NumericLineRenderer.spec.tsx` |

### 2. Widget Config Type Extension — the v1.14 groupByColumn Precedent

The exact pattern to follow (from `TimelineConfig`, line 36):

```typescript
groupByColumn?: string;  // Phase 72: optional group-by dimension. Non-empty → single-metric series-split.
```

The new field follows the same optional pattern:

```typescript
// In TimelineConfig (TimelineConfigPanel.tsx, after groupByColumn line 36):
yAxisFormat?: FormatSpec;  // Phase 86: per-widget Y-axis tick formatter override. Absent → bound column default.

// In NumericLineConfig (NumericLineConfigPanel.tsx, after groupByColumn line 32):
yAxisFormat?: FormatSpec;  // Phase 86: per-widget Y-axis tick formatter override. Absent → bound column default.
```

Both config panels use the same `patch(partial)` pattern for emitting changes:
```typescript
// TimelineConfigPanel.tsx, line 171
const patch = (partial: Partial<TimelineConfig>) => {
  onChange({ ...(config as Record<string, unknown>), ...partial });
};
// NumericLineConfigPanel.tsx mirrors this at line 160
```

Clearing the override = `patch({ yAxisFormat: undefined })`. Since `undefined` properties are dropped on JSON serialization, this round-trips cleanly — an absent `yAxisFormat` in the persisted config will read as `undefined` in the renderer, triggering the column-default path.

**Import needed for both config panels:**
```typescript
import { type FormatSpec } from "../../lib/columnFormatter";
```

### 3. Widget Config Persistence — Existing PATCH Chain

Widget config is persisted via `updateWidget` in `packages/web/src/api/client.ts` (line 493):
```typescript
export const updateWidget = async (
  id: number,
  attrs: Partial<Pick<WidgetDto, "title" | "type" | "position" | "config">>
): Promise<WidgetDto>
```
The `config` field is an opaque `Record<string, unknown>` JSON blob. The server stores it as-is and returns it on widget load. Adding `yAxisFormat?: FormatSpec` to `TimelineConfig`/`NumericLineConfig` adds nothing to the server (confirmed FRONTEND-ONLY). The field round-trips transparently — the renderers cast `widget.config` to `Partial<TimelineConfig>` and read `cfg.yAxisFormat`.

### 4. Hybrid Default Resolution (AXIS-V117-02)

**resolveFormatter signature** (from `columnDisplayConfigStore.ts`, line 137):
```typescript
export const resolveFormatter = (tableId: number, columnName: string): (v: unknown) => string | unknown
```
It is a pure `getState()`-based function (not a hook) — callable anywhere, including inside `useMemo`.

**Resolution rule:**
```typescript
// In each renderer, compute the Y-axis tick formatter once:
const yAxisTickFormatter = useMemo(() => {
  if (cfg.yAxisFormat) {
    // Per-widget override present: use it directly via buildFormatter.
    return buildFormatter(cfg.yAxisFormat);
  }
  // No override: fall back to the bound column's display-config formatter.
  // Uses the first metric's column as the "primary Y-axis" column.
  if (tableId !== undefined && metricColumn !== "") {
    return resolveFormatter(tableId, metricColumn);
  }
  // No table / no metric: identity (renders raw value).
  return (v: unknown) => String(v ?? "");
}, [cfg.yAxisFormat, tableId, metricColumn, configVersion]);
```

The `configVersion` subscription is ALREADY wired in both renderers (lines 133–134 in TimelineRenderer, lines 122–123 in NumericLineRenderer) and causes re-renders when column display config changes. Including it in the `useMemo` dep array ensures the fallback formatter refreshes when the column's store entry changes.

**Imports needed for each renderer:**
```typescript
import { buildFormatter } from "../../lib/columnFormatter";
import { resolveFormatter } from "../../store/columnDisplayConfigStore";
```
`useColumnDisplayConfigStore` and `resolveFormatter` are already imported in both renderers (Phase 77 wiring). Only `buildFormatter` is new.

**Multi-metric decision (PLANNER FLAG):** When ungrouped, the chart can have 1–4 metrics each with its own Y-axis. The research recommendation is: **use `metrics[0].column` as the "primary" Y-axis column for the default fallback, applying the same formatter to ALL value axes**. Rationale: a single per-widget override is defined and a single column drives it; applying different column-formatters per-axis (one per metric) is technically possible but adds complexity and the requirement says "the bound value column" (singular). The planner must decide whether to accept this single-formatter-all-axes rule or implement per-metric resolution. The recommendation is to accept single-formatter — it is the simpler and consistent path.

### 5. Applying tickFormatter to Value Axes ONLY (AXIS-V117-03)

**Timeline renderer — value axes (horizontal layout):**

Grouped mode (lines 538–546 in `TimelineRenderer.tsx`) — single `<YAxis>`:
```tsx
<YAxis
  key={AXIS_IDS[0]}
  type="number"
  yAxisId={AXIS_IDS[0]}
  width={60}
  stroke={X_AXIS_COLOR}
  tick={{ fill: X_AXIS_COLOR, fontSize: 11 }}
  tickFormatter={yAxisTickFormatter}   // ADD
/>
```

Ungrouped mode (lines 562–571) — one `<YAxis>` per metric:
```tsx
return (
  <YAxis
    key={AXIS_IDS[i]}
    type="number"
    yAxisId={AXIS_IDS[i]}
    orientation={AXIS_ORIENTATIONS[i]}
    width={60}
    stroke={toCssColor(m.color)}
    tick={tickStyle}
    tickFormatter={yAxisTickFormatter}   // ADD
  />
);
```

**Timeline renderer — vertical layout** uses `<XAxis type="number" ...>` for the value axis (lines 529–536 for grouped, lines 551–559 for ungrouped). These also get `tickFormatter={yAxisTickFormatter}`.

The pattern is identical in `NumericLineRenderer.tsx` (grouped YAxis at lines 499–506, ungrouped YAxis at lines 524–533, vertical XAxis variants at lines 491–498 and 513–522).

**Tooltip path (stays untouched):** Both renderers use:
```tsx
<Tooltip
  {...RECHARTS_TOOLTIP_PROPS}
  content={<ColumnFormatTooltip tableId={tableId} groupByColumn={groupByColumn} metricColumn={metricColumn} />}
/>
```
`ColumnFormatTooltip` calls `resolveFormatter(tableId, metricColumn)` independently — it has NO knowledge of `yAxisFormat` and receives NO new props. The Y-axis `tickFormatter` prop and the tooltip's formatter are completely separate code paths. No change to `ColumnFormatTooltip.tsx`.

**Bucket (category) axis is untouched:** The `<XAxis type="category" dataKey="bucket" ...>` (horizontal) and `<YAxis type="category" dataKey="bucket" ...>` (vertical) already have their own `tickFormatter` (the `bucketFormatter` function). They are never touched by this change.

### 6. Reusing the Format Options UI (AXIS-V117-01)

**The existing controls in `ColumnFormatEditorModal.tsx` (confirmed shipped by Phase 85):**
- `SIControls` (lines 616–645): decimal-places input + config-hint
- `NumberControls` (lines 455–520): thousands-sep, decimals, currency, percent checkboxes + inputs
- `DateControls` (lines 521–571): preset select + custom pattern input
- `D3Controls` (lines 572–611): raw d3 specifier input

**Recommended approach: extract a shared `FormatSpecEditor` sub-component.**

The config panels need the kind picker + per-kind controls (no label field, no Save button, no live preview from the modal's preview mechanism). The modal's kind picker is at lines 387–401 and the controls block is at lines 403–427. The sub-components themselves are already self-contained.

Create `packages/web/src/components/charts/FormatSpecEditor.tsx`:
```typescript
// Shared between TimelineConfigPanel and NumericLineConfigPanel (Phase 86).
// Renders: kind picker select + per-kind controls (no label, no save, no preview).
import { type FormatSpec, type FormatSpecNumber, type FormatSpecDate, type FormatSpecD3, type FormatSpecSI } from "../../lib/columnFormatter";
// NumberControls, DateControls, D3Controls, SIControls extracted from ColumnFormatEditorModal.tsx

export function FormatSpecEditor({
  spec,
  onChange,
}: {
  spec: FormatSpec;
  onChange: (s: FormatSpec) => void;
}): JSX.Element { ... }
```

The `*Controls` sub-components can be moved from `ColumnFormatEditorModal.tsx` into the new file and re-exported, with `ColumnFormatEditorModal.tsx` importing them back (zero behavioral change). CSS classes used: `ds-field`, `ds-field-label`, `ds-select`, `config-group`, `config-group-label`, `config-hint` — ALL confirmed present in `global.css`.

**Alternative (inline duplication):** Copy the kind picker + controls JSX into each config panel file. Simpler upfront but adds ~100 lines per file and creates a maintenance divergence for future format kind additions. Not recommended.

**Lowest-churn path for the planner:** extract + re-import in the same wave (no behavioral change to the modal). The extraction is mechanical: cut the 4 sub-component functions and the `defaultSpecForKind` helper from the modal, paste into `FormatSpecEditor.tsx`, re-export them, add one import line to the modal.

**Clear override (AXIS-V117-02):** The Y-axis control needs a "Use column default" reset option — a "None / Use column default" choice as the first option in the kind picker (value `undefined` or an explicit sentinel), distinct from the existing `"none"` kind which means "no formatting". The planner should decide whether to represent "no override" as a missing `yAxisFormat` field (cleanest, uses `undefined`) or a dedicated sentinel kind. Recommendation: use `undefined` (field absent) as the cleared state, and render a leading "— Use column default —" `<option value="">` that calls `patch({ yAxisFormat: undefined })` when selected.

### 7. Existing Test Files to Extend

| File | What to add |
|------|-------------|
| `packages/web/src/components/charts/TimelineConfigPanel.spec.tsx` | Add test: Y-axis format select renders in OPTIONS section; changing kind calls `onChange` with `yAxisFormat` set; clearing to "Use column default" calls `onChange` with `yAxisFormat: undefined` |
| `packages/web/src/components/charts/NumericLineConfigPanel.spec.tsx` | Same as above for NumericLine |
| `packages/web/src/components/charts/TimelineRenderer.spec.tsx` | Add test: when `yAxisFormat: { kind:"si", decimals:1 }` is in widget config, the YAxis elements receive a `tickFormatter` prop; `tickFormatter(1234567)` returns `"1.2M"`; tooltip path unchanged |
| `packages/web/src/components/charts/NumericLineRenderer.spec.tsx` | Same as above for NumericLine |

No new spec files needed. The renderer specs already stub `recharts`, `runSql`, `listColumnDisplayConfig`, and both stores (lines 15–82 in TimelineRenderer.spec.tsx).

---

## Architecture Patterns

### v1.14 groupByColumn Threading Pattern (the exact precedent)

1. Add `yAxisFormat?: FormatSpec` to the config type (mirrors `groupByColumn?: string`)
2. Read it in the config panel: `const yAxisFormat = cfg.yAxisFormat ?? undefined;`
3. Render a format-kind picker + per-kind controls in OPTIONS, below existing toggles
4. `patch({ yAxisFormat: newSpec })` / `patch({ yAxisFormat: undefined })` for clear
5. Read it in the renderer: `const yAxisFormat = cfg.yAxisFormat;`
6. Compute `yAxisTickFormatter` via `useMemo`; add `tickFormatter={yAxisTickFormatter}` to value-axis JSX
7. Renderer imports `buildFormatter` (new) + already has `resolveFormatter` + `configVersion`

### CSS Conventions

Use ONLY existing classes — all confirmed present in `global.css`:
- Section header: `<div className="config-group-label">Y-AXIS FORMAT</div>`
- Field wrapper: `<div className="ds-field">`
- Field label: `<span className="ds-field-label">Format kind</span>`
- Select: `className="ds-select"`
- Hint text: `<div className="config-hint">...</div>`

Do NOT invent new class names. Theme tokens only (no raw hex in any component file).

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead |
|---------|-------------|-------------|
| Y-axis number formatting | Custom magnitude-check / if-else | `buildFormatter(spec)` from `columnFormatter.ts` — handles all 5 kinds incl. SI |
| Column-default lookup | Manual store read | `resolveFormatter(tableId, colName)` from `columnDisplayConfigStore.ts` |
| Format-kind UI | New picker component from scratch | Extract `SIControls` / `NumberControls` / etc. from `ColumnFormatEditorModal.tsx` into shared `FormatSpecEditor.tsx` |
| Config persistence | New PATCH endpoint | `updateWidget(id, { config: {...} })` already handles the entire config blob; `yAxisFormat` round-trips as JSON transparently |

---

## Common Pitfalls

### Pitfall 1: Adding tickFormatter to the BUCKET axis instead of the VALUE axis
**What goes wrong:** Adding `tickFormatter={yAxisTickFormatter}` to `<XAxis dataKey="bucket">` (horizontal) or `<YAxis dataKey="bucket">` (vertical) — the time/numeric bucket axis, not the metric value axis.
**How to avoid:** The value axes are identified by `type="number"` (never `type="category"`). There are exactly two patterns in each renderer: `<YAxis type="number" yAxisId="m0" ...>` (horizontal) and `<XAxis type="number" xAxisId="m0" ...>` (vertical). Only these get `tickFormatter`.

### Pitfall 2: Adding tickFormatter to the GROUPED axis with the wrong color
**What goes wrong:** In vertical grouped layout the value axis is `<XAxis type="number" xAxisId="m0" orientation="bottom" stroke={X_AXIS_COLOR} ...>` — this is still the value/metric axis and needs the formatter.
**How to avoid:** Apply `tickFormatter` to EVERY element that has `type="number"`, across all 4 variants (horizontal grouped, horizontal ungrouped, vertical grouped, vertical ungrouped) in both renderers. That's 4 sites per renderer, 8 total.

### Pitfall 3: Forgetting to include `configVersion` in the yAxisTickFormatter useMemo deps
**What goes wrong:** When the operator updates the column's display config in the Column Format Editor, `configVersion` bumps and forces a re-render, but if `configVersion` is not in the `useMemo` dep array the `yAxisTickFormatter` stays stale (using the old column formatter as the default).
**How to avoid:** Both renderers already track `configVersion` (it is used via `void configVersion` to force re-render). Include it as a dep in the `yAxisTickFormatter` useMemo.

### Pitfall 4: Inventing a new CSS class name for the Y-axis format section
**What goes wrong:** Writing `className="y-axis-format-section"` — silently unstyled; passes all test gates; only visible in the UI.
**How to avoid:** Use `config-group-label` for section headers and `ds-field` / `ds-select` for the picker — identical to the existing OPTIONS section in both config panels.

### Pitfall 5: Using the `"none"` FormatSpec kind as "no override"
**What goes wrong:** Storing `{ kind: "none" }` as `yAxisFormat` when the operator clears the override — this will NOT fall back to the column's display-config formatter; `buildFormatter({ kind:"none" })` returns an identity function, which is the same as "no format" but bypasses `resolveFormatter`.
**How to avoid:** "No override" = `yAxisFormat: undefined` (field absent from config). The config panel must patch `{ yAxisFormat: undefined }` on clear. In the renderer: `if (cfg.yAxisFormat)` correctly gates on a non-undefined, non-null value.

### Pitfall 6: Modifying ColumnFormatTooltip
**What goes wrong:** Passing `yAxisFormat` to `ColumnFormatTooltip` or modifying its `fmt` resolution — this would break AXIS-V117-03 (tooltips must stay on the column-config path).
**How to avoid:** `ColumnFormatTooltip.tsx` receives NO new props in this phase. The per-widget Y-axis override is purely a renderer-internal `tickFormatter`. Confirm in code review that `ColumnFormatTooltip.tsx` is not modified.

---

## Code Examples

### Exact YAxis tickFormatter wiring (TimelineRenderer, horizontal ungrouped — line 562-574)
```tsx
// BEFORE (no tickFormatter):
return (
  <YAxis
    key={AXIS_IDS[i]}
    type="number"
    yAxisId={AXIS_IDS[i]}
    orientation={AXIS_ORIENTATIONS[i]}
    width={60}
    stroke={toCssColor(m.color)}
    tick={tickStyle}
  />
);

// AFTER (add tickFormatter):
return (
  <YAxis
    key={AXIS_IDS[i]}
    type="number"
    yAxisId={AXIS_IDS[i]}
    orientation={AXIS_ORIENTATIONS[i]}
    width={60}
    stroke={toCssColor(m.color)}
    tick={tickStyle}
    tickFormatter={yAxisTickFormatter}
  />
);
```

### Hybrid formatter resolution (add near top of renderer render section)
```typescript
// Phase 86: Y-axis tick formatter — per-widget override OR bound column default.
const yAxisTickFormatter = useMemo(() => {
  if (cfg.yAxisFormat) {
    return (v: unknown) => String(buildFormatter(cfg.yAxisFormat!)(v) ?? v);
  }
  if (tableId !== undefined && metricColumn !== "") {
    const fmt = resolveFormatter(tableId, metricColumn);
    return (v: unknown) => String(fmt(v) ?? v);
  }
  return (v: unknown) => String(v ?? "");
}, [cfg.yAxisFormat, tableId, metricColumn, configVersion]);
```

Note: Recharts `tickFormatter` receives a raw value (number) and must return a string. Wrap the formatter output with `String(... ?? v)` to guarantee a string return.

### Config panel: Y-axis format section (insert into OPTIONS block, below the last toggle)
```tsx
{/* Y-Axis Format — Phase 86 */}
<div className="config-group-label" style={{ marginTop: 16 }}>
  Y-AXIS FORMAT
</div>
<FormatSpecEditor
  spec={yAxisFormat ?? null}
  onChange={(s) => patch({ yAxisFormat: s ?? undefined })}
/>
```

---

## State of the Art

| Current (no Phase 86) | After Phase 86 | Notes |
|----------------------|----------------|-------|
| YAxis tick labels render raw numbers (e.g. 1234567) | YAxis ticks format per per-widget spec or column default (e.g. "1.2M") | Applies to both timeline + numericline |
| `TimelineConfig` / `NumericLineConfig` have no format field | Both configs gain `yAxisFormat?: FormatSpec` | Optional, backward-compat |
| Tooltips use `resolveFormatter` via `ColumnFormatTooltip` | Tooltips unchanged | Separate code path confirmed |
| No shared FormatSpecEditor component | New `FormatSpecEditor.tsx` extracted from `ColumnFormatEditorModal.tsx` | Zero behavioral change to the modal |

---

## Open Questions / Planner Decisions

1. **Multi-metric formatter (DECISION REQUIRED)**
   - What we know: ungrouped timeline/numericline can have 1–4 metrics on alternating axes; the requirement says "the bound value column" (singular); a per-widget `yAxisFormat` is also singular
   - What's unclear: should ungrouped multi-metric charts apply the same formatter to all Y-axes, or resolve per-metric from the column's display config?
   - Recommendation: **single formatter applied to all value axes** (AXIS-V117-02 says "bound value column", implying one; per-metric formatter would need a different config shape). Flag this rule in the config panel hint: "Applied to all Y-axis metrics."

2. **`FormatSpecEditor` extraction scope (DECISION REQUIRED)**
   - What we know: `SIControls`, `NumberControls`, `DateControls`, `D3Controls`, `defaultSpecForKind` are currently private functions in `ColumnFormatEditorModal.tsx`
   - What's unclear: whether to extract ALL controls or only the ones in scope for Y-axis (number + SI are the relevant ones; date + d3 are technically valid but unlikely for metric axes)
   - Recommendation: **extract all 4 controls + full kind picker** — this is more complete, consistent with the column editor, and avoids a partial extraction that would need revisiting for AXIS-V2-01. The "Use column default" option maps to `spec === null/undefined`.

3. **Width of the value-axis YAxis after adding tickFormatter (LOW RISK)**
   - What we know: current `width={60}` was set before SI formatting (max "60.0" → 4 chars); SI output "1.2M" (4 chars) fits; but "−1.23G" (6 chars) might clip
   - What's unclear: whether the existing `width={60}` is sufficient for all SI output lengths
   - Recommendation: bump to `width={64}` for all value axes when a formatter is active — or accept that the width may need a small visual adjustment on first use (not a blocker for Phase 86 correctness).

---

## Sources

### Primary (HIGH confidence)
- Direct codebase read: `packages/web/src/components/charts/TimelineConfigPanel.tsx` — exact `TimelineConfig` type, `patch()` pattern, OPTIONS section structure
- Direct codebase read: `packages/web/src/components/charts/NumericLineConfigPanel.tsx` — exact `NumericLineConfig` type, parallel structure to Timeline
- Direct codebase read: `packages/web/src/components/charts/TimelineRenderer.tsx` — all YAxis/XAxis elements, tooltip path, configVersion wiring, metricColumn variable, import patterns
- Direct codebase read: `packages/web/src/components/charts/NumericLineRenderer.tsx` — same as above
- Direct codebase read: `packages/web/src/store/columnDisplayConfigStore.ts` — exact `resolveFormatter` signature + semantics
- Direct codebase read: `packages/web/src/components/charts/ColumnFormatTooltip.tsx` — confirmed tooltip uses separate `resolveFormatter` call, no `yAxisFormat` in its contract
- Direct codebase read: `packages/web/src/components/ColumnFormatEditorModal.tsx` — `SIControls`, `NumberControls`, `DateControls`, `D3Controls` confirmed shipped (Phase 85); `defaultSpecForKind` includes `"si"` case; kind picker has all 5 options
- Direct codebase read: `packages/web/src/api/client.ts` — `updateWidget` PATCH route confirmed; config field is opaque JSON blob
- Direct codebase read: `packages/web/src/styles/global.css` — `config-group`, `config-group-label`, `config-hint`, `ds-field`, `ds-field-label`, `ds-select`, `config-toggle` all confirmed present
- Direct codebase read: `.planning/config.json` — `nyquist_validation: false` (Validation Architecture section omitted per spec)

### Secondary (MEDIUM confidence)
- `.planning/STATE.md` v1.14 section — Phase 72 group-by pattern confirmed as the threading precedent for optional config fields
- `.planning/phases/85-si-smart-abbreviation-number-format/85-RESEARCH.md` — `FormatSpecSI` type, `buildFormatter` switch pattern, `SIControls` code confirmed shipped
- `.planning/REQUIREMENTS.md` AXIS-V117-01/02/03 — ticks-only scope, hybrid default, no-tooltip-change all confirmed in requirements

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — recharts already in use; d3-format already installed; no new deps
- Architecture: HIGH — all integration points located in live code; exact line numbers provided
- Pitfalls: HIGH — derived from reading the exact code paths; no speculation
- Tooltip separation: HIGH — `ColumnFormatTooltip.tsx` is a separate component with its own `resolveFormatter` call; confirmed no shared state with `tickFormatter`

**Research date:** 2026-06-26
**Valid until:** Stable for this milestone scope (Phase 86 is FRONTEND-ONLY; no external API changes)
