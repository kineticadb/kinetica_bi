# Requirements: Kinetica BI — v1.17 Chart Number Formatting

**Defined:** 2026-06-26
**Core Value:** Click-through data exploration — users drill into chart elements and the entire dashboard filters to that slice of data, enabling fast iterative analysis without writing SQL.

> v1.17 makes large numbers readable: an SI "smart abbreviation" number format (k/M/G/T) added to the v1.15 client column-display formatter + Column Format editor, plus a hybrid per-widget Y-axis number-format option on timeline + line charts. **Frontend-only**; `d3-format` is already a web dep; reuse the v1.15 `column-display-config` formatter (no duplicated logic).

## v1 Requirements

### Smart Abbreviation Number Format (FMT)

- [ ] **FMT-V117-01**: A "smart abbreviation" number format is available as a choice in the client column-display number formatter — SI prefixes via d3-format `~s` (k / M / G / T; e.g. 1,234,567 → "1.2M"), honoring the existing configurable decimals control. Pure client formatting; never alters the SQL sent to Kinetica; invalid/empty input falls back to the raw value (v1.15 formatter contract).
- [ ] **FMT-V117-02**: The Column Format editor UI exposes the SI smart-abbreviation option alongside the existing number formats, with the same live preview on a sample value, and it persists per-column in `column_display_config` exactly like the other formats.

### Chart Y-Axis Number Format (AXIS)

- [ ] **AXIS-V117-01**: The timeline and line chart config panels each expose a Y-axis number-format control that reuses the column number-format options (including the new SI smart-abbreviation).
- [ ] **AXIS-V117-02**: The Y-axis number format defaults to the bound value column's display-config formatter and can be overridden per-widget (hybrid); clearing the per-widget override falls back to the column default.
- [ ] **AXIS-V117-03**: The resolved Y-axis formatter is applied to the Y-axis **tick labels** in `TimelineRenderer` and the line chart renderer (recharts `tickFormatter`); chart tooltips and data labels are NOT changed by the per-widget Y-axis override (they retain their existing v1.15 column-config behavior).

### Verification (VERIFY)

- [ ] **VERIFY-V117-01**: The milestone is proven via green automated gates (frontend vitest 100% from `packages/web`; web `tsc` clean; theme-guard green; server unaffected — flag any server diff) AND a blocking live operator walk-through (SI abbreviation chosen in the Column Format editor applies across the existing column-config surfaces; per-widget Y-axis override visible on timeline + line; default-from-bound-column behavior confirmed; ticks-only scope confirmed — tooltips unchanged), with any gaps fixed in-session via repro-test-driven closure and re-walked to PASS.

## Future Requirements (deferred)

- **AXIS-V2-01**: Per-widget number formatting on other chart types (bar, pie, numeric-line variants beyond the two in scope).
- **FMT-V2-01**: Financial-style abbreviation (K/M/B/T with a thousands grouping convention) as an alternative to SI prefixes, if a customer asks.
- **AXIS-V2-02**: Independent X-axis / secondary-axis number formatting.

## Out of Scope

| Feature | Reason |
|---------|--------|
| Financial K/M/B/T abbreviation | Operator chose SI prefixes (k/M/G/T via d3 `~s`) for v1.17; financial style deferred (FMT-V2-01). |
| Per-widget Y-axis format on chart types other than timeline + line | Scope is the two chart types where the gap was reported; others deferred (AXIS-V2-01). |
| Changing tooltip / data-label formatting via the per-widget Y-axis control | Decision (2026-06-26): the per-widget Y-axis override is **ticks-only**; tooltips keep their existing v1.15 column-config behavior. |
| Any server-side / SQL formatting | Formatting is pure client-side per the v1.15 model; no server change expected. |

## Traceability

Mapped to phases during roadmap creation (2026-06-26). Phase numbering continues from v1.16 (ended at Phase 84).

| Requirement | Phase | Status |
|-------------|-------|--------|
| FMT-V117-01 | Phase 85 | Pending |
| FMT-V117-02 | Phase 85 | Pending |
| AXIS-V117-01 | Phase 86 | Pending |
| AXIS-V117-02 | Phase 86 | Pending |
| AXIS-V117-03 | Phase 86 | Pending |
| VERIFY-V117-01 | Phase 87 | Pending |

**Coverage:**
- v1 requirements: 6 total
- Mapped to phases: 6 (100%)
- Unmapped: 0 ✓

---
*Requirements defined: 2026-06-26*
*Last updated: 2026-06-26 after v1.17 roadmap creation (Phases 85-87, 6/6 mapped)*
</content>
