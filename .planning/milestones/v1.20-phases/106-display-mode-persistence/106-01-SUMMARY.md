---
phase: 106-display-mode-persistence
plan: 01
subsystem: api
tags: [sqlite, express, dashboards, dto, filter-display-mode]

# Dependency graph
requires: []
provides:
  - "dashboards.filter_display_mode TEXT column (PRAGMA-guarded idempotent migration)"
  - "Dashboard DTO field filter_display_mode: 'topbar' | 'panel' (mapDashboard coalesces NULL -> 'topbar')"
  - "Validated PATCH /api/dashboards/:id filter_display_mode allow-list (400 on invalid, DASHBOARDS_EDIT gate unchanged)"
  - "Web DashboardDto.filter_display_mode field + widened updateDashboard attrs Pick"
affects: [107-panel-shell-reflow-xor-switch, 110-designer-settings-ui]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "PRAGMA table_info(dashboards)-guarded idempotent ALTER TABLE ADD COLUMN (mirrors sessions/dashboard_layers/filter_scope precedent)"
    - "Key-in-attrs discriminant in updateDashboard preserves-vs-sets the coalesced DTO value"

key-files:
  created:
    - packages/server/tests/routes.dashboard-display-mode.spec.ts
  modified:
    - packages/server/src/db.ts
    - packages/server/src/types.ts
    - packages/server/src/index.ts
    - packages/web/src/api/client.ts

key-decisions:
  - "Dedicated scalar TEXT column (not a JSON config blob) per user's explicit locked decision"
  - "DB stores NULL for unconfigured; DTO always coalesces to a concrete 'topbar'|'panel' on the wire"
  - "Reused existing DASHBOARDS_EDIT permission; no new RBAC permission added"

patterns-established:
  - "v1.20 Phase 106 dashboards migration block placed after dashboard_layers filter_scope block, before seedRbac call in db.ts"

requirements-completed: [FSET-V120-02, FSET-V120-03]

# Metrics
duration: 10min
completed: 2026-07-09
---

# Phase 106 Plan 01: Display-Mode Persistence Summary

**Dedicated `dashboards.filter_display_mode` SQLite column (PRAGMA-guarded idempotent migration) + coalesced DTO field + validated PATCH allow-list, mirrored into the web `DashboardDto` type.**

## Performance

- **Duration:** 10 min
- **Started:** 2026-07-09T11:36:32-04:00
- **Completed:** 2026-07-09T11:46:48-04:00
- **Tasks:** 3 completed
- **Files modified:** 5 (1 created, 4 modified)

## Accomplishments
- `dashboards.filter_display_mode TEXT` column added via a new PRAGMA-`table_info`-guarded idempotent `ALTER TABLE` block, mirroring the v1.18 `filter_scope` migration exactly.
- `mapDashboard` coalesces NULL/anything-not-`'panel'` to `'topbar'` so every `GET /api/dashboards` (list), `POST` create, and `PATCH` response returns a concrete wire value — unconfigured dashboards stay byte-identical to today (FSET-V120-03).
- `updateDashboard` allow-list extended with the key-in-attrs discriminant (mirroring the `filter_scope` preserve-vs-set logic) so an unrelated PATCH preserves the current mode.
- `PATCH /api/dashboards/:id` validates `filter_display_mode` before calling `updateDashboard`, returning 400 on anything other than `'topbar'`/`'panel'`, while keeping the existing `DASHBOARDS_EDIT` gate unchanged.
- New BOTH-auth-mode supertest file proves default `'topbar'`, PATCH `'panel'` round-trip via the GET list (there is no GET-by-id route), reject-invalid-400, and preserve-on-unrelated-PATCH in password mode, plus an OIDC smoke test — fully green in isolation.
- Web `DashboardDto` mirrors the field (type + `updateDashboard` attrs Pick widened) so Phases 107/110 can read/set it; no UI, store, or render-switch changes.

## Task Commits

Each task was committed atomically:

1. **Task 1: Server persistence — migration + DTO + validated PATCH allow-list** - `b4be28a` (feat)
2. **Task 2: Server supertests — BOTH auth modes** - `d51936a` (test)
3. **Task 3: Web api-client — DashboardDto field + updateDashboard attrs** - `eeae3e3` (feat)

_Note: no TDD tasks required multiple commits per task; each task landed as a single atomic commit._

## Files Created/Modified
- `packages/server/src/db.ts` - New PRAGMA-guarded idempotent `dashboards.filter_display_mode` ALTER block; `mapDashboard` coalesce; `updateDashboard` allow-list extension
- `packages/server/src/types.ts` - `Dashboard.filter_display_mode: "topbar" | "panel"` field
- `packages/server/src/index.ts` - `PATCH /api/dashboards/:id` validates `filter_display_mode`, 400 on invalid, `DASHBOARDS_EDIT` gate unchanged
- `packages/server/tests/routes.dashboard-display-mode.spec.ts` - BOTH-auth-mode supertests (5 tests: default, round-trip, reject-invalid, preserve, oidc smoke)
- `packages/web/src/api/client.ts` - `DashboardDto.filter_display_mode` field + widened `updateDashboard` attrs Pick

## Decisions Made
- Dedicated scalar column over a JSON `config` blob — per the phase's locked user decision (deferred blob-vs-column revisit to a future phase if dashboard-settings area grows).
- DB nullable / DTO always-concrete split: store `NULL` for "unconfigured" in SQLite, but never let clients see `null` — keeps Phase 107's mode switch simple (per CONTEXT.md discretion).
- No new GET-by-id route added; round-trip verification uses the existing `GET /api/dashboards` list + `.data.find()`, matching the documented route reality.

## Deviations from Plan

None - plan executed exactly as written. All four db.ts/types.ts/index.ts edits, the five-test supertest spec, and the two-line web client change matched the plan's exact code blocks.

## Issues Encountered
- Running the full server vitest suite (post-Task-2) showed 9 failing files including one not previously seen (`routes.column-display-config.spec.ts` timeout) alongside the documented OIDC-issuer-mock / db.smoke-drift / routes.wms failures. To confirm this wasn't caused by the new spec, the new spec file was temporarily moved out and the full suite re-run: the baseline (without the new file) still failed 8 files with a *different* file mix (`routes.dashboard-access.spec.ts` and `routes.info-query.spec.ts` failing instead of `layers.spec.ts` / the column-display-config timeout) — confirming this is pre-existing non-deterministic cross-test contamination (TD-V16-TEST-ISOLATION), not a regression introduced by this plan. The new spec file was restored and re-verified green in isolation before committing.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Phase 107 (Panel Shell + Reflow + XOR Switch + Chips) can now read `dashboard.filter_display_mode` from the web `DashboardDto` to drive its top-bar-vs-panel render switch.
- Phase 110 (Designer Settings UI) can PATCH `filter_display_mode` via the widened `updateDashboard(id, { filter_display_mode })` client call — no further server work needed.
- No blockers. Server + web `tsc` are both clean; the only server-touching plan in v1.20 is complete.

---
*Phase: 106-display-mode-persistence*
*Completed: 2026-07-09*

## Self-Check: PASSED

All created/modified files verified present on disk; all three task commit hashes (b4be28a, d51936a, eeae3e3) verified present in git log.
