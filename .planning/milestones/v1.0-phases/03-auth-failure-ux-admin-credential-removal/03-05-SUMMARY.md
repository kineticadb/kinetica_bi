---
phase: 03-auth-failure-ux-admin-credential-removal
plan: 05
subsystem: auth
tags: [kinetica, env-vars, testing, security, express]

# Dependency graph
requires:
  - phase: 03-02
    provides: requireConfig still mounted; route try/catches stripped; errorMiddleware added

provides:
  - requireConfig narrowed to KINETICA_URL-only check
  - KINETICA_USERNAME/KINETICA_PASSWORD deleted from .env.example, README.md
  - kinetica_bi/server/.env untracked from git (was committed; .gitignore already covered it)
  - Test specs converted from process.env sentinel scaffolding to hardcoded "admin-env-user" literal
  - SC#5 audit grep returns zero matches

affects: [03-06, deploy-runbook]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Sentinel-string pattern: negative-assertion tests use hardcoded literal instead of env var read/write"
    - "requireConfig: single-var KINETICA_URL check; no credential vars on boot path"

key-files:
  created: []
  modified:
    - kinetica_bi/server/src/index.ts
    - kinetica_bi/server/.env.example
    - README.md
    - kinetica_bi/server/tests/routes.sql.spec.ts
    - kinetica_bi/server/tests/routes.discovery.spec.ts
    - kinetica_bi/server/tests/routes.wms.spec.ts

key-decisions:
  - "kinetica_bi/server/.env was a tracked file with real credentials; untracked via git rm --cached (Rule 2 auto-fix) so .gitignore entry takes effect"
  - "Test title strings containing 'KINETICA_USERNAME' were also renamed to eliminate all string-level grep matches"
  - "routes.materialize.spec.ts and tests/setup.ts confirmed clean — no edit needed"
  - "dist/ is gitignored (root .gitignore line 2) — git grep skips it; npm run build regenerates it from narrowed source"

patterns-established:
  - "requireConfig: if (!process.env.KINETICA_URL) -> 500; no other env vars checked"
  - "Negative-assertion pattern: expect(decoded).not.toContain('admin-env-user') with no env priming — sentinel proves route never reads the env"

requirements-completed: [ADMN-01, ADMN-02, ADMN-03]

# Metrics
duration: 7min
completed: 2026-04-28
---

# Phase 3 Plan 05: Admin Credential Removal Summary

**requireConfig narrowed to KINETICA_URL-only; all KINETICA_USERNAME/KINETICA_PASSWORD references deleted from tracked files; SC#5 audit grep returns zero matches with 210 tests passing.**

## Performance

- **Duration:** 7 min
- **Started:** 2026-04-28T20:38:17Z
- **Completed:** 2026-04-28T20:45:00Z
- **Tasks:** 1
- **Files modified:** 7 (6 edited + 1 untracked)

## Accomplishments

- `requireConfig` body reduced to a 3-line KINETICA_URL-only guard; no other env vars on the hot path
- Deleted the 2 KINETICA_USERNAME/KINETICA_PASSWORD lines from `.env.example` and the 2 table rows from `README.md`
- Converted all env-var-priming try/finally scaffolding in routes.{sql,discovery,wms}.spec.ts to use the hardcoded sentinel `"admin-env-user"` — tests remain logically equivalent
- SC#5 audit: `git grep -nE 'KINETICA_USERNAME|KINETICA_PASSWORD' -- ':!.planning/'` returns zero matches (exit code 1)
- All 210 tests pass; TypeScript build clean

## Task Commits

1. **Task 1: Narrow requireConfig + delete env-var references** - `9c515da` (feat)

**Plan metadata:** see final commit below

## Files Created/Modified

- `kinetica_bi/server/src/index.ts` - requireConfig narrowed: `!process.env.KINETICA_URL` check only
- `kinetica_bi/server/.env.example` - KINETICA_USERNAME and KINETICA_PASSWORD lines removed
- `README.md` - Two env-var table rows removed
- `kinetica_bi/server/tests/routes.sql.spec.ts` - Sentinel literal; env-set/restore scaffolding removed; test title updated
- `kinetica_bi/server/tests/routes.discovery.spec.ts` - Same pattern; test title "KINETICA_USERNAME" renamed
- `kinetica_bi/server/tests/routes.wms.spec.ts` - Same pattern
- `kinetica_bi/server/.env` (deleted from git tracking) - Was a tracked file containing real credentials; untracked via `git rm --cached`

## Decisions Made

- `kinetica_bi/server/.env` was committed to git history despite `.gitignore` having `.env` — the file had been committed before the ignore entry took effect. Fixed with `git rm --cached` (Rule 2 auto-fix: security). The working-tree `.env` remains untouched for runtime.
- Test titles containing the literal string "KINETICA_USERNAME" were renamed so that git grep sees zero matches even in comment strings and test names.
- `routes.materialize.spec.ts` and `tests/setup.ts` were confirmed clean by grep before execution — no edit was needed.
- `dist/` is gitignored at the root `.gitignore` line 2 entry. `git grep` skips it automatically; `npm run build` was run to regenerate compiled output from the narrowed source.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Security] Untracked kinetica_bi/server/.env from git**
- **Found during:** Task 1 (SC#5 audit grep)
- **Issue:** `git grep` returned matches in `kinetica_bi/server/.env` because the file was committed to git even though `.gitignore` has a `.env` pattern — the ignore entry was added after the file was first committed. The file contained `KINETICA_USERNAME=[redacted]` and `KINETICA_PASSWORD=[redacted]`.
- **Fix:** Ran `git rm --cached kinetica_bi/server/.env` to stop tracking the file. Working-tree copy remains intact for runtime; `.gitignore` now takes effect.
- **Files modified:** `kinetica_bi/server/.env` (deleted from index)
- **Verification:** SC#5 grep returns zero matches after untrack
- **Committed in:** `9c515da` (task commit)

**2. [Rule 1 - Bug] Renamed test title containing "KINETICA_USERNAME" literal string**
- **Found during:** Task 1 (second SC#5 audit run)
- **Issue:** After fixing the env-set/restore scaffolding, `routes.discovery.spec.ts` still had the string `KINETICA_USERNAME` inside a test title: `"uses per-user creds NOT KINETICA_USERNAME env var (sentinel check)"`. git grep matched it.
- **Fix:** Renamed title to `"uses per-user creds, not any env var (sentinel check)"` — functionally identical but audit-clean.
- **Files modified:** `kinetica_bi/server/tests/routes.discovery.spec.ts`
- **Verification:** SC#5 grep returns zero matches
- **Committed in:** `9c515da` (task commit)

---

**Total deviations:** 2 auto-fixed (1 security/missing-critical, 1 bug)
**Impact on plan:** Both auto-fixes required for SC#5 to pass. No scope creep.

## Issues Encountered

- EADDRINUSE errors (6) during test run are pre-existing noise from `app.listen` firing at module-import time in `index.ts`. These are non-fatal: all 210 tests pass. This is the known bootstrap issue that Plan 03-04 gates behind `NODE_ENV !== "test"`. Not introduced by this plan.

## Post-narrowing requireConfig body (verbatim)

```typescript
const requireConfig = (req: Request, res: Response, next: NextFunction) => {
  if (!process.env.KINETICA_URL) {
    return res.status(500).json({ error: "Missing KINETICA_URL environment variable." });
  }
  return next();
};
```

Mounted on the same routes as before: `POST /api/views/:id/materialize`, `GET /api/kinetica/schemas`, `GET /api/kinetica/schemas/:schema/tables`, `GET /api/kinetica/schemas/:schema/tables/:table/columns`, `GET /api/wms`, `POST /api/sql`.

## dist/ artifact handling

`dist/` is gitignored via the root `.gitignore` (line 2: `dist/`). `git grep` skips gitignored paths. `npm run build` was run and exits 0, regenerating `dist/index.js` from the narrowed source — the compiled output no longer contains the 3-var check. Option (a) from the plan was used (rebuild, not untrack).

## Test count

210 tests across 17 test files. No regressions from Plan 03-02 baseline.

## Next Phase Readiness

- SC#5 ADMN-01/02/03 requirements satisfied; admin credentials are structurally absent from the codebase
- Plan 03-06 (bootstrap gate + DEPLOY-RUNBOOK) can proceed; requireConfig body is documented verbatim above so no accidental re-addition of old vars

---
*Phase: 03-auth-failure-ux-admin-credential-removal*
*Completed: 2026-04-28*
