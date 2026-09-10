# Phase 35 — Deferred Items

## Out-of-scope tsc errors observed during Plan 35-04 execution

**1. `WidgetRenderer.spec.tsx` references `retryDynamicView` not yet on `DashboardContextValue`**
- **Source commit:** `7d62056` — Plan 35-05 RED test (intentionally failing, awaiting Plan 35-05 GREEN)
- **Error:** `Property 'retryDynamicView' does not exist on type ... DashboardContextProvider`
- **Resolution:** Plan 35-05 GREEN will add `retryDynamicView` to `DashboardContextValue` + Provider props + DashboardsPage wiring.
- **Out of scope for Plan 35-04** (chartconfig-picker only). Not introduced by this plan, not fixable here without architectural drift.

This file accumulates issues discovered but deliberately not fixed during a plan's execution — see `~/.claude/get-shit-done/instructions.md` "SCOPE BOUNDARY" rule.
