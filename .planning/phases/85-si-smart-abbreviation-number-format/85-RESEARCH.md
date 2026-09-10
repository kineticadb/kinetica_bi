# Phase 85: SI Smart-Abbreviation Number Format — Research

**Researched:** 2026-06-26
**Domain:** d3-format SI, columnFormatter.ts extension, ColumnFormatEditorModal UI
**Confidence:** HIGH — all findings sourced directly from the live codebase and verified d3-format behavior

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| FMT-V117-01 | SI "smart abbreviation" (d3 `~s`, k/M/G/T) added to the column-display formatter; honors existing decimals control; never throws; raw-value fallback | New `FormatSpecSI` variant slots cleanly into `FormatSpec` union + `buildFormatter` switch; decimals maps to d3 precision; confirmed no surface bypass |
| FMT-V117-02 | Column Format editor exposes SI option with live preview + per-column `column_display_config` persistence | New `<option value="si">` in kind picker; `defaultSpecForKind("si")` case; `<SIControls>` sub-component; preview uses existing `SAMPLE_NUMBER = 1234567.891`; save path unchanged |
</phase_requirements>

---

## Summary

Phase 85 is a **pure extension** of the v1.15 column-formatting foundation. The existing `columnFormatter.ts` `FormatSpec` union gets one new member (`FormatSpecSI`), `buildFormatter` gets one new case, and the `ColumnFormatEditorModal` gets one new option in the kind picker and a corresponding `<SIControls>` sub-component. Every render surface (records table, chart tooltips, axis labels, map info popups) consumes `resolveFormatter` from `columnDisplayConfigStore`, which delegates to `buildFormatter` — so a new `kind:"si"` propagates to all surfaces automatically with zero per-surface wiring.

`d3-format` is already installed (`^3.1.2` in `packages/web/package.json`). The SI specifier is already imported via `import { format as d3Format } from "d3-format"` in `columnFormatter.ts`. No new dependency is needed.

**Primary recommendation:** Add `kind:"si"` to `FormatSpec`, implement `buildSIFormatter` using `d3Format(\`.\${spec.decimals + 1}~s\`)`, add the editor option + controls, and extend the existing spec tests.

---

## Integration Points

### 1. `packages/web/src/lib/columnFormatter.ts` — FormatSpec Union

**Current union (line 43):**
```typescript
export type FormatSpec = FormatSpecNumber | FormatSpecDate | FormatSpecD3 | FormatSpecNone;
```

**New member to add:**
```typescript
export type FormatSpecSI = {
  kind: "si";
  decimals: number;   // 0..N — maps to d3 precision via decimals + 1
};
```

The `FormatSpec` union becomes:
```typescript
export type FormatSpec = FormatSpecNumber | FormatSpecDate | FormatSpecD3 | FormatSpecNone | FormatSpecSI;
```

The `defaultFormatKind` function returns `FormatSpec["kind"]` — adding `"si"` to the union broadens the return type. `defaultFormatKind` only returns `"number"` | `"date"` | `"none"` (never `"si"` by default — correct, SI is opt-in).

**Exhaustiveness guard in `buildFormatter` (line 237-240):**
```typescript
default: {
  const _exhaustive: never = spec;   // TypeScript will catch unhandled kinds at compile time
  void _exhaustive;
  return (v: unknown) => v;
}
```
The existing exhaustiveness guard means TypeScript will error if `kind:"si"` is added to the union without a corresponding case in the switch — this enforces the complete implementation and confirms tsc as the correctness gate.

### 2. d3-Format Specifier for SI — Decimals Mapping

**Key nuance (CRITICAL for planner):** d3's `s` format type uses **significant digits** (total precision), NOT decimal places. The `~` flag trims trailing zeros.

**Mapping formula:** `decimals → d3 precision = decimals + 1`

Reason: For numbers in the k/M/G/T range with a single integer digit before the SI prefix, `precision = decimal_places + 1` gives the expected decimal count for the typical case. The `~` flag ensures no trailing zeros (e.g. `1.0M` → `1M` when decimals=1 and integer part has no fractional residue, but `1.2M` stays `1.2M`).

**Verified behavior (live d3-format 3.1.2 on codebase):**

| Operator's `decimals` | d3 specifier | `1,234,567` | `1,234,567,890` | `12,345,678` |
|---|---|---|---|---|
| 0 | `.1~s` | `1M` | `1G` | `10M` |
| 1 | `.2~s` | `1.2M` | `1.2G` | `12M` |
| 2 | `.3~s` | `1.23M` | `1.23G` | `12.3M` |
| 3 | `.4~s` | `1.235M` | `1.235G` | `12.35M` |

**Operator's stated examples confirmed:** `1,234,567 → "1.2M"` (decimals=1 → `.2~s`); `3,400,000,000 → "3.4G"` (decimals=1 → `.2~s`).

**Known limitation to document in code:** When the number has more than one integer digit in the SI-scaled form (e.g. 12,345,678 scales to 12.3M — two integer digits), the decimal count may be one fewer than requested (`.2~s` → "12M" not "12.3M"). This is inherent to significant-digit formatting and is the accepted behavior; operators should understand `decimals` is "approximately N decimal places" for large numbers.

**Edge cases (all verified):**
- Zero: `.2~s(0)` → `"0"` — no prefix, correct
- Negative: `.2~s(-1234567)` → `"−1.2M"` — d3 uses Unicode minus `−`, not ASCII `-`
- Sub-kilo (100–999): `.2~s(500)` → `"500"`, `.2~s(999)` → `"1k"` — rounds up, correct
- Sub-unit (0.001234): `.2~s(0.001234)` → `"1.2m"` (SI milli) — this is correct SI behavior for small numbers (unlikely in a BI context but handled gracefully)
- Non-numeric input: guard with `isNaN(n)` → return raw value (same pattern as `buildNumberFormatter` and `buildD3Formatter`)

**The SI formatter implementation:**
```typescript
function buildSIFormatter(spec: FormatSpecSI): (v: unknown) => string | unknown {
  const d3Spec = `.${ spec.decimals + 1 }~s`;
  return (v: unknown): string | unknown => {
    if (v === null || v === undefined) return v;
    const n = typeof v === "number" ? v : Number(v);
    if (isNaN(n)) return v;
    try {
      return d3Format(d3Spec)(n);
    } catch {
      return v;  // invalid spec → raw value, never throw
    }
  };
}
```

Add to `buildFormatter` switch (before the `default` exhaustiveness case):
```typescript
case "si":
  return buildSIFormatter(spec);
```

### 3. `packages/web/src/components/ColumnFormatEditorModal.tsx` — Editor Integration

**Format kind picker (lines 385-397):** Currently has 4 `<option>` entries. Add a 5th:
```tsx
<option value="si">Smart abbreviation (k / M / G / T)</option>
```

**`defaultSpecForKind` function (lines 51-63):** Add:
```typescript
case "si":
  return { kind: "si", decimals: 1 };  // default: 1 decimal place → .2~s → "1.2M"
```

**Kind-specific controls block (lines 400-418):** Add after the `{spec.kind === "d3" && ...}` block:
```tsx
{spec.kind === "si" && (
  <SIControls
    spec={spec as FormatSpecSI}
    onChange={onSpecChange}
  />
)}
```

**New `<SIControls>` sub-component** (mirrors `NumberControls` pattern):
```tsx
function SIControls({
  spec,
  onChange,
}: {
  spec: FormatSpecSI;
  onChange: (s: FormatSpec) => void;
}): JSX.Element {
  return (
    <div className="config-group">
      <div className="config-group-label">Smart abbreviation</div>
      <div className="ds-field">
        <label className="ds-field-label">Decimal places</label>
        <input
          type="number"
          min={0}
          value={spec.decimals}
          onChange={(e) => {
            const v = Math.max(0, parseInt(e.target.value, 10) || 0);
            onChange({ ...spec, decimals: v });
          }}
          aria-label="Decimal places"
        />
      </div>
      <div className="config-hint">
        e.g. 1,234,567 → 1.2M · 3,400,000,000 → 3.4G
        Uses SI prefixes (k / M / G / T). Decimal places = approx. significant digits after the prefix.
      </div>
    </div>
  );
}
```

**Live preview:** The editor's `computePreview` (line 261-265) already calls `buildFormatter(spec)(sample)` — and `SAMPLE_NUMBER = 1234567.891` will produce "1.2M" (with decimals=1) automatically. No change needed to the preview mechanism.

**Import needed:** Add `FormatSpecSI` to the named imports at line 22-27:
```typescript
import {
  buildFormatter,
  type FormatSpec,
  type FormatSpecNumber,
  type FormatSpecDate,
  type FormatSpecD3,
  type FormatSpecSI,  // ADD
} from "../lib/columnFormatter";
```

**Persistence path:** Unchanged. `handleSave` calls `upsertColumnDisplayConfig(table.id, col, label, wc.spec)` — the `wc.spec` is whatever `FormatSpec` is in working state, including the new `{ kind:"si", decimals:N }`. The API client sends `format_spec` as JSON (line 1517 in `client.ts`). The server stores it as a JSON blob in `column_display_config.format_spec` (TEXT column, no server-side type validation). The store's `upsertColumn` stores it as-is. Round-trip is fully transparent.

### 4. Render Surface Propagation — No Extra Wiring Required

All render surfaces reach `buildFormatter` exclusively via `resolveFormatter` in `columnDisplayConfigStore`:

```typescript
// columnDisplayConfigStore.ts (line ~137)
export const resolveFormatter = (tableId: number, columnName: string): (v: unknown) => string | unknown => {
  const spec = /* getState().configs[tableId]?.columns[columnName]?.format_spec */;
  return spec ? buildFormatter(spec) : (v) => v;
};
```

**Confirmed surfaces (all via `resolveFormatter` or `ColumnFormatTooltip` → `resolveFormatter`):**

| Surface | File | How formatter is consumed |
|---------|------|--------------------------|
| Records table — cell values | `WidgetRenderer.tsx:2341` | `resolveFormatter(tableId, col)` |
| Chart axis tick labels | `WidgetRenderer.tsx:1133` | `resolveFormatter(tableId, metricColumn)(v)` |
| Bar value labels | `WidgetRenderer.tsx:1380` | `resolveFormatter(tableId, metricColumn)(entry.value)` |
| Chart tooltips (bar, pie, line…) | `ColumnFormatTooltip.tsx:88` | `resolveFormatter(tableId, metricColumn)` |
| Timeline tooltip | `TimelineRenderer.tsx:606` | via `<ColumnFormatTooltip>` |
| NumericLine tooltip | `NumericLineRenderer.tsx:568` | via `<ColumnFormatTooltip>` |
| Map info popup — KV values | `InfoSelectionView.tsx:481` | `resolveFormatter(activeLayer.table_id, col)(value)` |
| Map info popup — template | `InfoSelectionView.tsx:463` | `resolveFormatter(activeLayer.table_id, col)(value)` |

**Conclusion:** Adding `kind:"si"` to `buildFormatter` propagates to every one of these surfaces for free. **No per-surface wiring changes are needed for FMT-V117-01.**

**No bypass risk found:** There is no surface that formats column values independently of `buildFormatter`/`resolveFormatter`. The map layers legend (`LayersLegendPanel`) is permanently excluded from column formatting (locked by a guard test from v1.15 Phase 77, COLAPPLY-V115-04) — this is correct and unchanged.

### 5. Existing Test Files to Extend

| File | What to add |
|------|-------------|
| `packages/web/src/lib/columnFormatter.spec.ts` | New `describe("buildFormatter / kind:si")` block: verify `1234567 → "1.2M"` (decimals=1), `3.4G` (decimals=1), decimals=0 → "1M", decimals=2 → "1.23M"; null/undefined passthrough; non-numeric → raw value; negative → "−1.2M"; zero → "0" |
| `packages/web/src/components/ColumnFormatEditorModal.spec.tsx` | Add test for switching kind to "si" shows decimal places input; live preview shows "1.2M" for SAMPLE_NUMBER with decimals=1; Save persists `{ kind:"si", decimals:1 }` |

**No new spec files needed.** Both existing files follow the established test patterns (vitest + @testing-library/react for the modal, pure vitest for the lib).

---

## Architecture Patterns

### Adding a FormatSpec Variant (established v1.15 pattern)

1. Add `FormatSpecXxx` type to `columnFormatter.ts` (co-located with other type defs)
2. Add `| FormatSpecXxx` to `FormatSpec` union — TypeScript exhaustiveness guard in `buildFormatter` will immediately flag the unimplemented case
3. Add `buildXxxFormatter` internal function
4. Add `case "xxx": return buildXxxFormatter(spec);` to `buildFormatter` switch
5. Add `case "xxx": return { kind: "xxx", ...defaults }` to `defaultSpecForKind` in `ColumnFormatEditorModal.tsx`
6. Add `<option value="xxx">` to the kind picker
7. Add `{spec.kind === "xxx" && <XxxControls .../>}` to the kind-controls block
8. Add `XxxControls` sub-component (mirrors NumberControls / DateControls / D3Controls)
9. Add `type FormatSpecXxx` to modal imports
10. Extend `columnFormatter.spec.ts` + `ColumnFormatEditorModal.spec.tsx`

### CSS Conventions (CLAUDE.md)

- `<SIControls>` uses `config-group` + `config-group-label` + `ds-field` + `ds-field-label` — all existing classes, no new class names
- `config-hint` class is used in `D3Controls` (line 596) — reuse for the SI hint text
- No hex colors; theme tokens only; no new CSS file needed

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead |
|---------|-------------|-------------|
| SI prefix formatting (k/M/G/T) | Custom if/else on value magnitude | `d3Format(".N~s")` — already imported |
| SI precision → decimal mapping | Lookup table | Formula: `d3Spec = \`.\${decimals + 1}~s\`` |
| New store/API changes | Nothing needed | `column_display_config` persists any `FormatSpec` JSON transparently |

---

## Common Pitfalls

### Pitfall 1: Confusing d3 `s` precision with decimal places
**What goes wrong:** Using `d3Format(\`.\${decimals}s\`)` directly (no +1 offset) — this gives one fewer decimal than intended for the common case (e.g. decimals=1 → `.1s` → "1M" not "1.2M").
**How to avoid:** Formula is `precision = decimals + 1` → `d3Spec = \`.\${spec.decimals + 1}~s\``.

### Pitfall 2: Forgetting the `~` (trim) flag
**What goes wrong:** `.2s(1000000)` → "1.0M" (has trailing zero). `.2~s(1000000)` → "1M".
**How to avoid:** Always use `~s` not bare `s`. The operator's example "1.2M" implies trimming is desired.

### Pitfall 3: TypeScript exhaustiveness guard as a blocker
**What goes wrong:** Adding `FormatSpecSI` to the union without adding the switch case → TypeScript compile error at `const _exhaustive: never = spec` in `buildFormatter`.
**How to avoid:** This is a feature — add the case before running `tsc`.

### Pitfall 4: Inventing new CSS class names
**What goes wrong:** Writing `className="si-controls"` in `SIControls` — this has no CSS backing and silently renders as unstyled (theme-guard won't catch it; tsc won't catch it; vitest won't catch it).
**How to avoid:** Use only `config-group` / `config-group-label` / `ds-field` / `ds-field-label` / `config-hint` — all proven existing classes from the other Controls sub-components.

### Pitfall 5: Adding SI option to `defaultFormatKind` return
**What goes wrong:** Returning `"si"` from `defaultFormatKind` for numeric columns — would change the default kind for all numeric columns to SI, breaking existing behavior.
**How to avoid:** `defaultFormatKind` must NOT return `"si"`. It is only an editor hint for the initial selection; SI is opt-in only.

---

## Code Examples

### Verified d3-format SI behavior (confirmed against d3-format 3.1.2)
```typescript
import { format as d3Format } from "d3-format";

d3Format(".2~s")(1234567)     // "1.2M"   ← operator's example
d3Format(".2~s")(3400000000)  // "3.4G"   ← operator's example
d3Format(".1~s")(1234567)     // "1M"     ← decimals=0
d3Format(".3~s")(1234567)     // "1.23M"  ← decimals=2
d3Format(".2~s")(0)           // "0"
d3Format(".2~s")(-1234567)    // "−1.2M"  ← Unicode minus
d3Format(".2~s")(999)         // "1k"     ← rounds up to next prefix
d3Format(".2~s")(500)         // "500"    ← no prefix below 1k threshold
```

### Exhaustiveness guard (currently in columnFormatter.ts:237-240)
```typescript
default: {
  const _exhaustive: never = spec;  // will catch missing "si" case at compile time
  void _exhaustive;
  return (v: unknown) => v;
}
```

---

## State of the Art

| v1.15 baseline | v1.17 Phase 85 addition | Impact |
|---|---|---|
| `FormatSpec` = 4 kinds (number/date/d3/none) | Add 5th kind: `si` | Union extension; all consumers auto-updated via switch exhaustiveness |
| Kind picker: 4 options | Add "Smart abbreviation" 5th option | Editor-only change |
| `defaultSpecForKind` handles 4 kinds | Add `"si"` case | Needed for `handleKindChange` |

---

## Open Questions

1. **d3 Unicode minus for negative values**
   - What we know: `d3Format(".2~s")(-1234567)` → `"−1.2M"` uses Unicode minus `U+2212`, not ASCII hyphen `-`
   - What's unclear: Whether the operator's downstream consumers (table cells, tooltip text) handle Unicode minus correctly — almost certainly yes (it's a display string, not parsed back)
   - Recommendation: Accept d3's Unicode minus as-is; note in code comment

2. **Sub-kilo SI micro/milli behavior**
   - What we know: `.2~s(0.001234)` → `"1.2m"` (milli); `.2~s(0.000001234)` → `"1.2µ"` (micro)
   - What's unclear: Whether BI operators expect SI micro/milli for very small values or prefer raw number
   - Recommendation: Accept d3 behavior (full SI scale); for BI data values like 0.001 this is correct. If operators later dislike it, a custom filter for values >= 1 can be added, but do NOT add this in Phase 85.

---

## Sources

### Primary (HIGH confidence)
- Direct codebase read: `packages/web/src/lib/columnFormatter.ts` — exact `FormatSpec` union, `buildFormatter`, all types
- Direct codebase read: `packages/web/src/components/ColumnFormatEditorModal.tsx` — kind picker, controls pattern, `defaultSpecForKind`, live preview mechanism, save path
- Direct codebase read: `packages/web/src/components/charts/ColumnFormatTooltip.tsx`, `WidgetRenderer.tsx`, `TimelineRenderer.tsx`, `NumericLineRenderer.tsx`, `InfoSelectionView.tsx` — confirmed all formatter consumption points
- Direct codebase read: `packages/web/src/store/columnDisplayConfigStore.ts` — confirmed `resolveFormatter` is the single gateway
- Live d3-format 3.1.2 execution (`node_modules/d3-format`) — all SI format outputs verified against the installed package
- `packages/web/package.json` — confirmed `"d3-format": "^3.1.2"` present; no new dep needed
- `.planning/config.json` — `nyquist_validation: false` (Validation Architecture section omitted)

### Secondary (MEDIUM confidence)
- `.planning/MILESTONES.md` v1.15 entry — confirmed formatter contract ("never throws → raw-value fallback"; percent preset appends literal `%` NOT d3 ×100)
- `.planning/STATE.md` v1.17 scope — confirmed "REUSE the v1.15 formatter lib — NO duplicated formatting logic"
- `.planning/REQUIREMENTS.md` FMT-V117-01/02 — confirmed operator's examples (1,234,567 → "1.2M", 3.4G)

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — d3-format already installed, version verified live
- Architecture: HIGH — codebase read directly; all integration points confirmed
- Pitfalls: HIGH — derived from live d3 output + existing code patterns
- Propagation claim: HIGH — exhaustive grep of all `resolveFormatter`/`buildFormatter`/`ColumnFormatTooltip` consumers; no bypass found

**Research date:** 2026-06-26
**Valid until:** Stable (formatter lib is internal; d3-format 3.x is stable; no expiry concern within v1.17 scope)
