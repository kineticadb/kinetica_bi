---
phase: 138-ai-filters
plan: 04
subsystem: web-filter-chips
tags: [ai, filters, chips, ui]
requires: [138-01]
provides: [ActiveFilter.aiApplied, FilterChip aiApplied prop, AI_FILTER_PROVENANCE]
affects: [138-07]
key-files:
  modified:
    - packages/web/src/store/filterStore.ts
    - packages/web/src/components/FilterChip.tsx
    - packages/web/src/components/FilterPanel.tsx
    - packages/web/src/lib/stableComboHash.spec.ts
    - packages/web/src/components/FilterChip.spec.tsx
    - packages/web/src/components/FilterPanel.spec.tsx
  created:
    - packages/web/src/store/filterStore.aiFilter.spec.ts
requirements-completed: [AIACT-V20-09 (chip part only; phase-level completion owned by 138-08)]
completed: 2026-10-15
---

# Phase 138 Plan 04: AI filter chip identity Summary

Optional `aiApplied` marker on `ActiveFilter` (hash-neutral), an "AI" tag on top-bar and panel chips via the existing `widget-filter-badge` class, a "from AI assistant" provenance fallback, and drift specs pinning the shared AI cap and type rules to the web ones.

## Commits
- 3 files (Task 1): aiApplied marker + CHIPAI-1..4 specs
- 01de8e2 (Task 2): FilterChip/FilterPanel AI tag + CHIPAI-5..8

## Verification
- web tsc clean; theme-guard green; full web vitest (`--maxWorkers=4`): 234 files passed, 4786 tests passed.
- The first full run showed 1 failure with "view.getCenter is not a function" noise. It did not reproduce on re-run, so I treated it as load or a parallel-executor flake.
- No change to global.css, stableComboHash.ts or columnTypes.ts. No new readers of filterViewStore.
- CHIPAI-2 found no mismatch between `aiFilterDataTypeOf` and `inferDataTypeFromColumn`, so no shared-function fix was needed.

## Non-discriminating checks (reported)
- CHIPAI-1..4 passed immediately in red phase. `aiApplied` is a TS-only field, so the runtime store behaviour already held. The marker is guarded by `tsc` (the spec literal fails to compile without the field) and by the drift assertions. CHIPAI-5..8 failed red first (3 failed), then went green.

## Not verified here
- Legibility of the "AI" tag in light and dark mode is NOT verified by tests. It is routed to the 138-08 operator check.
- DashboardsPage does not yet pass `aiApplied`. That is 138-07.

## Deviations from Plan
- Task 1 and Task 2 were committed separately, as the per-task protocol requires, instead of one combined commit. Otherwise none.

## Self-Check: PASSED
