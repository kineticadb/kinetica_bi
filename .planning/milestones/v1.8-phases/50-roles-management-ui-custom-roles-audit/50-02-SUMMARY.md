---
phase: 50-roles-management-ui-custom-roles-audit
plan: 02
subsystem: frontend
tags: [rbac, roles-management, react, vitest, tdd, sqlite, permissions]

# Dependency graph
requires:
  - phase: 50-01
    provides: "escalation guards + audit handlers; POST/PUT/DELETE /api/roles handlers already in index.ts"
  - phase: 49-users-management-ui
    provides: "UsersPage precedent (CSS idioms, fetch-on-mount, toast pattern, seedAuthStore helpers)"
provides:
  - "GET /api/roles extended with holders_count (COUNT from user_roles per role)"
  - "client.ts: updateRolePermissions, createRole, deleteRole wrappers with {ok, error} verbatim pattern"
  - "RoleDto extended with holders_count field"
  - "RolesPage.tsx: two-pane role-list + permission matrix, draft/Save, dirty guard, inline create/delete"
  - "RolesPage.css: two-pane flex layout matching UsersPage/DynamicViewsModal idioms"
  - "RolesPage.spec.tsx: 12 tests covering all ROLES-V18-01..04 and SAFE-V18-02 UX mirror behaviors"
affects:
  - 50-03-users-page-retrofit
  - 51-verification-live-uat

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "TDD: RED commit then GREEN commit per task; 1 RED test + 3 GREEN commits"
    - "NOUN_TO_GROUP constant: maps 16 permission nouns to 5 display groups (Dashboards/Design/Users/Roles/Audit)"
    - "SAFE-V18-02 UX mirror: admin-role lock for non-admin viewer + unheld-perm disabled with tooltip — server remains authoritative"
    - "verbatim error pattern: {ok, error?} from all three new client wrappers surfaces server 400/409 inline + toast"
    - "holders_count: trivial SELECT COUNT(*) per role in GET /api/roles map; powers delete-blocked UX"

key-files:
  created:
    - packages/web/src/components/RolesPage.tsx
    - packages/web/src/components/RolesPage.css
    - packages/web/src/components/RolesPage.spec.tsx
  modified:
    - packages/server/src/index.ts
    - packages/web/src/api/client.ts
    - packages/server/tests/routes.management.spec.ts
    - packages/web/src/components/UsersPage.spec.tsx

key-decisions:
  - "aria-label={perm} added to each permission checkbox for reliable test queries via getByRole"
  - "vi.clearAllMocks() in beforeEach: ensures updateRolePermissions call count resets between tests (mockResolvedValue alone preserves history)"
  - "Built-in Save always triggers window.confirm in test context; jsdom confirm() returns false by default, so toggle+Save tests must mock confirm"
  - "NOUN_TO_GROUP constant defined at module scope (not derived at render time) — 5 categories, 9 noun keys; pure-prefix split would yield 9 groups"
  - "holders_count added as SELECT COUNT(*) per role in GET /api/roles (not stored; computed on read) — powers delete-disabled UX without schema change"

# Metrics
duration: 11min
completed: 2026-06-06
---

# Phase 50 Plan 02: Roles Management UI Summary

**Two-pane RolesPage with 16-permission matrix (5 groups), draft/Save, dirty guard, inline create/delete, SAFE-V18-02 UX mirrors, and holders_count on GET /api/roles — all covered by 12-test TDD spec**

## Performance

- **Duration:** ~11 min
- **Started:** 2026-06-06T12:05:13Z
- **Completed:** 2026-06-06T12:16:24Z
- **Tasks:** 3
- **Files modified:** 7

## Accomplishments

- GET /api/roles now returns `holders_count` (SELECT COUNT(*) from user_roles) on every role; powers delete-blocked UX in the left pane
- Three client wrappers added (updateRolePermissions, createRole, deleteRole) mirroring the assignRole/revokeRole `{ok, error}` verbatim pattern
- RolesPage.tsx: two-pane layout with left role list (built-in badges, custom delete controls disabled when holders_count>0, inline [+ New role] form with slug validation) and right permission matrix (16 checkboxes in NOUN_TO_GROUP 5 groups, draft staging, Save with built-in confirm, dirty guard on role switch)
- SAFE-V18-02 UX mirrors: admin role shown locked for non-admin viewer with disabled checkboxes + "Only admins can modify the admin role." notice; any unheld permission disabled with "You can only grant permissions you hold." tooltip
- RolesPage.spec.tsx: 12 tests all green; frontend gate at 1539/1540 (1 known-red DashboardsPage, no regression)

## Task Commits

1. **Task 1: holders_count on GET /api/roles + client wrappers (TDD)**
   - `5debd72` test(50-02): add failing test for holders_count on GET /api/roles
   - `c5627b4` feat(50-02): holders_count on GET /api/roles + createRole/deleteRole/updateRolePermissions client wrappers

2. **Task 2: RolesPage two-pane component + permission matrix + draft/Save + dirty guard**
   - `15dd23b` feat(50-02): RolesPage two-pane component + permission matrix + draft/Save + dirty guard

3. **Task 3: Inline custom-role create + delete + RolesPage.spec.tsx**
   - `a411782` feat(50-02): inline custom-role create + delete + RolesPage.spec.tsx

## Files Created/Modified

- `packages/web/src/components/RolesPage.tsx` — named export `RolesPage`; NOUN_TO_GROUP + GROUP_ORDER constants; full two-pane render with all UX mirrors; 295 lines
- `packages/web/src/components/RolesPage.css` — two-pane flex layout, built-in badge, delete button, inline create form, permission matrix group headers, save footer
- `packages/web/src/components/RolesPage.spec.tsx` — 12 tests: matrix count, toggle+Save full-set, built-in confirm, cancel aborts, admin-lock, unheld-disable, bad-slug blocked, reserved-name blocked, valid slug calls API, holders_count>0 disables delete, delete enabled + calls API, dirty guard
- `packages/server/src/index.ts` — GET /api/roles handler extended with `holders_count` via SELECT COUNT(*) per role
- `packages/web/src/api/client.ts` — RoleDto.holders_count added; updateRolePermissions, createRole, deleteRole wrappers
- `packages/server/tests/routes.management.spec.ts` — holders_count assertion added to GET /api/roles test suite
- `packages/web/src/components/UsersPage.spec.tsx` — MOCK_ROLES fixtures updated with holders_count: 0 to satisfy extended RoleDto type

## Decisions Made

- aria-label={perm} added to permission checkboxes (accessibility + vitest getByRole queries)
- vi.clearAllMocks() in beforeEach prevents call-count bleed between tests
- jsdom window.confirm defaults to false; built-in role tests must explicitly mock confirm with true/false
- NOUN_TO_GROUP constant is the single source of truth for grouping (not derived from the 9 noun prefixes)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing] aria-label on permission checkboxes**
- **Found during:** Task 3 (writing RolesPage.spec.tsx)
- **Issue:** Checkboxes had no accessible name — `getByRole("checkbox", { name: /dashboards:create/ })` would fail
- **Fix:** Added `aria-label={perm}` to each checkbox input in RolesPage.tsx
- **Files modified:** packages/web/src/components/RolesPage.tsx
- **Committed in:** a411782 (Task 3 feat commit)

**2. [Rule 1 - Bug] window.confirm returns false in jsdom**
- **Found during:** Task 3 spec debugging
- **Issue:** jsdom's window.confirm() returns false by default; test for toggle+Save on a built-in role was silently aborted by the confirm guard before ever calling updateRolePermissions
- **Fix:** All tests that exercise Save on a built-in role now mock window.confirm → true (or false if testing the cancel path); vi.clearAllMocks() added to beforeEach to prevent call-count bleed
- **Files modified:** packages/web/src/components/RolesPage.spec.tsx
- **Committed in:** a411782 (Task 3 feat commit)

**3. [Rule 2 - Missing] UsersPage.spec.tsx MOCK_ROLES missing holders_count**
- **Found during:** Task 1 (after extending RoleDto)
- **Issue:** TypeScript error TS2345: existing MOCK_ROLES fixtures in UsersPage.spec.tsx missing the new required field
- **Fix:** Added `holders_count: 0` to all 4 MOCK_ROLES entries
- **Files modified:** packages/web/src/components/UsersPage.spec.tsx
- **Committed in:** c5627b4 (Task 1 feat commit)

---

**Total deviations:** 3 auto-fixed (Rules 1+2 — test accessibility, jsdom behavior, type fixture)
**Impact on plan:** Test-only or type-only fixes; no production behavior affected.

## Verification Results

- `npm run test:server -- routes.management.spec.ts`: 65/65 passed (holders_count assertion green)
- `npm run test -- --run RolesPage`: 12/12 passed
- `npm run test` (full frontend): 1539/1540 (1 known-red DashboardsPage — TD-V17-DASHPAGE-SPEC; no regression)
- TypeScript: no new errors (pre-existing DataFilterConfigPanel + App.spec.tsx errors unaffected)
- `grep -q "Only admins can modify the admin role" RolesPage.tsx`: OK
- `grep -q "You can only grant permissions you hold" RolesPage.tsx`: OK

## Self-Check: PASSED

Files verified:
- packages/web/src/components/RolesPage.tsx: exists (295+ lines)
- packages/web/src/components/RolesPage.css: exists
- packages/web/src/components/RolesPage.spec.tsx: exists
- packages/web/src/api/client.ts: holders_count + 3 wrappers present
- packages/server/src/index.ts: holders_count COUNT query present
- Commits 5debd72, c5627b4, 15dd23b, a411782: all in git log

## Next Phase Readiness

- RolesPage is DORMANT (not wired into App.tsx/routes) — 50-03 adds the route and sidebar entry
- All server authority for role mutations was established in 50-01; this plan is pure UI
- 50-03 (Users Page retrofit) can consume the same createRole/deleteRole/updateRolePermissions wrappers if needed

---
*Phase: 50-roles-management-ui-custom-roles-audit*
*Completed: 2026-06-06*
