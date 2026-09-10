# Phase 70: Numeric `<other>` Catch-All Bucket - Context

**Gathered:** 2026-06-18
**Status:** Ready for planning
**Source:** Orchestrator-authored (autonomous run; user pre-approved all edits, requirements well-defined)

<domain>
## Phase Boundary

Extend the existing class-break `<other>` catch-all bucket (shipped for CATEGORICAL columns in v1.7 Phase 39) to NUMERIC class-break columns. Numeric class-break CB_VALS currently emits `lo:hi,lo:hi` ranges and has NO way to express a catch-all; Kinetica supports a literal `<other>` token appended after the numeric ranges (`1:3,3:5,<other>`). This phase makes the `<other>` bucket available and DEFAULT-ON for numeric class-break configs, emitted correctly into the WMS `CB_VALS` param, with its own per-break color shown in the form and legend.

FRONTEND-ONLY (`packages/web`). Zero server diff expected — `cb_config` already round-trips through the existing PATCH route; this only changes how the numeric branch serializes and which UI is shown. Flag any server diff as a deviation.

Covers requirements: **CBOTHER-V114-01, CBOTHER-V114-02, CBOTHER-V114-03**.
</domain>

<decisions>
## Implementation Decisions (LOCKED)

### `<other>` emission for numeric CB_VALS
- The `<other>` catch-all is represented exactly like the categorical one: a `CbBreak` with `value === "<other>"` (the form already identifies it this way). It is always the LAST break in `breaks[]`.
- The WMS numeric `CB_VALS` builder must emit the literal `<other>` for that break instead of a `min:max` range. Mirror the existing identification check `b.value === "<other>"`.
- Result for a numeric config with breaks [1:3, 3:5, <other>]: `CB_VALS=1:3,3:5,<other>` (URLSearchParams handles `%3Cother%3E` encoding — do NOT pre-encode).
- The per-break color array (`POINTCOLORS`) and any other optional arrays (POINTSIZES/POINTSHAPES/SHAPELINE*/SHAPEFILL*) must stay positionally aligned with `CB_VALS` — the `<other>` break contributes its color/style in the same position, exactly as categorical already does (no special-casing needed there; categorical already emits the `<other>` break's color positionally).

### Default-ON for NEW/edited numeric configs ONLY (no retroactive injection)
- When an operator creates a new numeric class-break config or switches a column to numeric (the `typeChanged && newValsType` path), `includeOtherBucket` defaults to `true` and an `<other>` row is appended — mirroring the categorical column-change rule at `CbConfigForm.tsx:228-240`.
- **Preservation invariant:** an already-saved numeric layer whose stored `cb_config` has NO `<other>` row and NO `includeOtherBucket` flag must render EXACTLY as before. This is satisfied automatically as long as: (a) `coalesceCbConfig` does NOT inject `<other>` (it must not — `EMPTY_CB_CONFIG` has no `includeOtherBucket` and the coalescer passes the parsed shape through verbatim), and (b) the WMS builder only emits `<other>` when an `<other>` break actually exists in `breaks[]`. Do NOT auto-inject `<other>` in the read path or the builder.
- Editing an existing config does NOT silently flip the flag on load — default-on applies at config creation / column-change time, not at render/parse time.

### Form UX (mirror categorical)
- Surface the `<other>` bucket toggle for NUMERIC mode, not only categorical. Today the toggle (`CbConfigForm.tsx:660-668`) is inside the `{cbConfig.valsType === "categorical" && ...}` block at line 639. It must also appear for numeric (default checked for new numeric configs).
- The `onToggleOtherBucket` handler (`CbConfigForm.tsx:256-271`) already appends a `{value:"<other>"}` row on ON and filters it out on OFF — reuse it for numeric. (It builds the row via `createDefaultBreak("categorical", ...)` then overrides `value:"<other>"`; the `valsType` arg only affects the unused min/max — acceptable, but the planner may pass the real `valsType` for cleanliness.)
- The numeric `<other>` row already renders as a read-only `cb-other-chip` (the chip check at `CbConfigForm.tsx:842` precedes the numeric min/max branch), so the row shows no min/max inputs and keeps its color swatch + advanced panel. Verify this renders correctly for numeric; no new chip code expected.
- The "NULL values will not appear in the map" hint (currently categorical-only at line 669) should also show for numeric when the toggle is OFF (the `<other>` bucket is what catches out-of-range/uncovered values).

### Validation
- Numeric break validation (the `min < max` / finite-number checks, ~`CbConfigForm.tsx:505-546`) MUST whitelist the `<other>` row (it has no min/max), exactly as categorical validation whitelists it. The `<other>` row must not raise "Min must be less than Max" or empty-range errors.

### `<other>` row color default
- The `<other>` row gets the next sequential `PALETTE_COLORS[index % len]` color at creation (same as `createDefaultBreak`), so it has a distinct legend/map color out of the box. Operator can recolor it.

### Claude's Discretion
- Exact spec-test file placement and count (extend existing `CbConfigForm.spec.tsx` + `wmsUrlBuilder.spec.tsx`).
- Whether to pass `cbConfig.valsType` vs `"categorical"` into `createDefaultBreak` inside `onToggleOtherBucket` (cosmetic — min/max unused for the chip row).
- Any small legend label nicety (e.g. defaulting the `<other>` row `label` to "Other") — optional, not required by the SCs.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Class-break config shape + helpers
- `packages/web/src/lib/cbConfig.ts` — `CbConfig`/`CbBreak` types, `includeOtherBucket?` flag (line 67), `coalesceCbConfig` (must NOT inject `<other>`), `createDefaultBreak`, `PALETTE_COLORS`. The doc comment on `CbBreak.value` (lines 21-26) already notes `<other>` keyword support.

### WMS param emission (the core change)
- `packages/web/src/lib/wmsUrlBuilder.ts:372-414` — the `classbreak` branch. The numeric vs categorical `CB_VALS` ternary is at **lines 392-395**: numeric maps to `${b.min ?? 0}:${b.max ?? 0}` (this is where `<other>` must emit the literal token instead). Categorical at line 395 already emits `value` verbatim — this is the reference behavior.

### Form UI (the toggle + row rendering)
- `packages/web/src/components/charts/CbConfigForm.tsx`:
  - Column-change / type-change rule with categorical-only `<other>` auto-append: **lines 222-253**.
  - `onToggleOtherBucket` handler: **lines 256-271**.
  - Categorical-gated `<other>` toggle + NULL hint: **lines 638-675** (gate at 639, toggle at 660, hint at 669).
  - `<other>` chip rendering (already valsType-agnostic): **lines 842-848**.
  - Numeric min/max validation (must whitelist `<other>`): around **lines 505-546** (planner: confirm exact lines).
- `packages/web/src/styles/global.css:2202` — `.cb-other-chip` style (already exists).

### Reference precedent
- v1.7 Phase 39 shipped the categorical `<other>` (CB-V17-04). This phase is its numeric mirror — follow the same shape, just emit the literal token in the numeric branch and surface the toggle for numeric.
</canonical_refs>

<specifics>
## Specific Ideas

- Kinetica numeric CB_VALS with catch-all, from the docs: `1:3,3:5,<other>` (URL-encoded `1:3,3:5,%3Cother%3E`). Emit the raw `<other>`; URLSearchParams encoding is downstream.
- A targeted regression test should assert: numeric config with an `<other>` break → `CB_VALS` ends with `,<other>` and `POINTCOLORS` has the matching count (N ranges + 1 for `<other>`); and that a numeric config WITHOUT an `<other>` break emits no `<other>` token (preservation).
</specifics>

<deferred>
## Deferred Ideas

None — phase scope is fully captured. (Retroactive application to already-saved numeric layers is explicitly OUT OF SCOPE per REQUIREMENTS.md.)
</deferred>

---

*Phase: 70-numeric-other-bucket*
*Context gathered: 2026-06-18 (autonomous orchestrator run)*
