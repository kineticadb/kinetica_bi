# Phase 97: Calendar Smart Domain Control - Context

**Gathered:** 2026-06-30
**Status:** Ready for planning

<domain>
## Phase Boundary

Add a config + render layer to the calendar widget that lets a designer expose a single "smart" time-granularity dropdown (month / week / day / hour) which auto-maps to the correct domain+subdomain pair — offered as an ALTERNATIVE to (not a replacement of) the existing advanced two-dropdown (domain + subdomain) UI. Config + render only; no new SQL or materialize path. Existing two-dropdown calendars must keep their current behavior byte-identically.

Covers: CALSMART-V119-01 (mode toggle), CALSMART-V119-02 (smart→pair mapping), CALSMART-V119-03 (restrict selectable options).

</domain>

<decisions>
## Implementation Decisions

### Mode toggle + config shape
- Add `controlMode: "advanced" | "smart"` to `CalendarConfig` (in `CalendarConfigPanel.tsx`), default `"advanced"`.
- Absent field coalesces to `"advanced"` — existing calendars are byte-identical (backward-compat, locked by test per success criterion 4).
- The config panel swaps its grouping UI by mode: `advanced` → the current two-dropdown (domain + subdomain) UI; `smart` → the single "Time scale" dropdown.

### Smart granularity model + mapping
- Smart mode shows ONE dropdown labeled **"Time scale"** with options: Month / Week / Day / Hour.
- Each smart option maps to a domain+subdomain pair (all already valid combos in `VALID_DOMAIN_SUBDOMAIN`):
  - month → year / month
  - week → month / week
  - day → month / day
  - hour → day / hour
- Selecting a smart option sets the calendar's effective `domain` + `subdomain` via this mapping. (The mapping table is the single source of truth — planner decides whether to persist derived domain/subdomain or derive at render; the existing renderer consumes domain+subdomain.)

### Selectable-options restriction (CALSMART-V119-03)
- The designer can restrict WHICH Time-scale options the picker offers. Store the allowed set (e.g. `allowedSmartScales` over `"month" | "week" | "day" | "hour"`).
- Default: all four allowed. Minimum: at least one must remain allowed (UI enforces ≥1).
- **Config-time only** — the restriction governs which options appear in the DESIGNER's Time-scale picker; there is NO viewer-facing live smart dropdown this phase. (CALSMART-V119-03's "viewer/selectable" wording is interpreted as "configurable" — the smart control is a config-time simplification, not a live viewer switcher.)

### Viewer interaction
- Smart mode is **fixed at config time** — the calendar renders at the chosen granularity; viewers do not get a live smart dropdown.
- The existing `showDomainSubdomainControls` (v1.13 viewer-live grouping dropdowns) remains an ADVANCED-mode feature only; in smart mode it is hidden/ignored (no live viewer grouping control). Keeps the two modes cleanly separated.

### Backward-compat + edge cases
- Advanced mode (the default) is unchanged and byte-identical — guarded by an explicit test (success criterion 4).
- `layoutMode` (wrap / strip) continues to apply in smart mode; finer granularities (e.g. hour → day/hour) render through the existing layout path with no special-casing.

### Claude's Discretion
- Exact field naming (`controlMode`, `smartScale`, `allowedSmartScales`) and whether the mapping persists derived domain/subdomain vs derives at render.
- Precise control layout/placement within the config panel (mirror the existing domain/subdomain field block + the OPTIONS/DISPLAY section pattern).
- Whether the "Time scale" picker is a `<select>` and the allowed-options restriction is a checkbox group vs multi-select — match existing `ds-select` / config-group conventions.

</decisions>

<specifics>
## Specific Ideas

- "Smart" control should SIMPLIFY the common case — one dropdown instead of two — while the advanced two-dropdown UI stays available for power users (both options present).
- Dropdown label is "Time scale" (not "Granularity" or "Zoom level").

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

No external specs/ADRs for this phase — requirements are fully captured in the decisions above and the v1.13 calendar implementation. The canonical sources are the existing calendar code (see Existing Code Insights below) plus:

### Requirements
- `.planning/REQUIREMENTS.md` §"Calendar Smart Domain Control (CALSMART)" — CALSMART-V119-01/02/03.
- `.planning/ROADMAP.md` §"Phase 97: Calendar Smart Domain Control" — goal, invariant, 4 success criteria.

### Prior milestone context (calendar v1.13 decisions referenced in STATE.md)
- `.planning/STATE.md` §"Phase 68.1-02 Decisions" and §"Phase 68.1-03 Decisions" — the view-local override pattern (`effDomain`/`effSubdomain`), `showDomainSubdomainControls` default-OFF, `layoutMode` wrap/strip, the DISPLAY section + `config-group-label` UI pattern, and the no-`fromSwap`-in-CalendarRenderer rule.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/lib/calendarBin.ts` — `CalendarDomain`, `CalendarSubdomain` types; `VALID_DOMAIN_SUBDOMAIN` (all four smart mappings are already valid combos); `isValidCombo()`. The smart→pair mapping table should align with these.
- `src/components/charts/CalendarConfigPanel.tsx` — `CalendarConfig` type (lines ~43–56), `DEFAULT_CALENDAR_CONFIG` (~58–68), the domain/subdomain dropdown UI + `handleDomainChange` (dependent-reset logic ~line 351), and the DISPLAY section (`layoutMode` / `showDomainSubdomainControls` toggles ~lines 540–560). New `controlMode` + smart UI slot in here.
- `src/components/charts/CalendarRenderer.tsx` — already coalesces `domain`/`subdomain` from config with defaults and has the view-local override pattern (`effDomain`/`effSubdomain`). Consumes domain+subdomain regardless of how they're set.
- `src/components/charts/definitions/calendar.ts` — chart-type definition; `defaultConfig` spreads `DEFAULT_CALENDAR_CONFIG`. New optional fields must have safe defaults so existing widgets coalesce to advanced.

### Established Patterns
- Optional config fields with `?? DEFAULT_CALENDAR_CONFIG.x` coalescing (so absent = legacy behavior) — exactly how `layoutMode` / `showDomainSubdomainControls` were added in v1.13 Phase 68.1.
- `patch({ ... })` to update config; dependent-field reset on change (domain change resets subdomain to first valid).
- Theme-tokens-only styling; `ds-select` / `config-group` / `config-group-label` UI conventions.

### Integration Points
- `CalendarConfig` type + `DEFAULT_CALENDAR_CONFIG` — add `controlMode`, smart-scale selection, and `allowedSmartScales` (all optional, advanced-safe defaults).
- Config panel render branch keyed on `controlMode`.
- Renderer reads the resulting domain+subdomain (no new materialize/SQL path — invariant: `AggregatedWidgetRenderer` stays sole materialize trigger; no `fromSwap` in `CalendarRenderer`).

</code_context>

<deferred>
## Deferred Ideas

- Live VIEWER-facing smart granularity switcher (a restricted single dropdown viewers toggle at runtime) — explicitly out of scope; smart mode is config-time only this phase. Revisit if a customer asks for a viewer-facing time-scale switcher.

</deferred>

---

*Phase: 97-calendar-smart-domain-control*
*Context gathered: 2026-06-30*
