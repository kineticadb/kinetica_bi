---
phase: 02-per-user-credential-passthrough-on-every-kinetica-call
plan: "06"
subsystem: api
tags: [kinetica, module-const-removal, requireConfig, phase-2-milestone, cleanup]

# Dependency graph
requires:
  - "02-03: kineticaSql/kineticaWms helpers implemented"
  - "02-04: WMS + discovery routes refactored to per-user creds"
  - "02-05: materialize refactored — 0 inline admin-credential fetches remain in any route handler"
provides:
  - "kinetica_bi/server/src/index.ts: module-const-free — kineticaUser and kineticaPassword deleted; requireConfig reads process.env inline"
affects:
  - "Phase 3 (ADMN-01/02/03): requireConfig narrowing and KINETICA_USERNAME/PASSWORD env-var deletion — Phase 2 hands off index.ts in this clean state"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "requireConfig reads process.env.KINETICA_USERNAME / KINETICA_PASSWORD inline (not via module-scope consts) — identical runtime behaviour; Phase 3 ADMN-02 narrows further"
    - "Module-const deletion as mechanical enforcement: removing the const forces TypeScript to surface any missed call site as a compile error"

key-files:
  created: []
  modified:
    - "kinetica_bi/server/src/index.ts"

key-decisions:
  - "Module consts deleted in Phase 2 (not Phase 3) to mechanically enforce Success Criterion 3 via TypeScript compile errors at every missed site"
  - "requireConfig behaviour unchanged: still validates KINETICA_URL + KINETICA_USERNAME + KINETICA_PASSWORD and returns 500 if any missing — Phase 3 ADMN-02 narrows it to KINETICA_URL only after env vars are removed under ADMN-01/03"
  - ".env.example left untouched: KINETICA_USERNAME and KINETICA_PASSWORD remain listed for Phase 3 ADMN-03 to delete alongside the global error middleware"

# Metrics
duration: 1min
completed: 2026-04-28
---

# Phase 02 Plan 06: Delete kineticaUser/kineticaPassword module consts Summary

**Phase 2 milestone boundary closed: const kineticaUser and const kineticaPassword deleted from index.ts; requireConfig inlined to process.env; git grep returns zero matches; 205/205 tests pass; TypeScript build clean**

## Performance

- **Duration:** ~1 min
- **Started:** 2026-04-28T15:44:00Z
- **Completed:** 2026-04-28T15:45:00Z
- **Tasks:** 1
- **Files created:** 0, **modified:** 1

## Accomplishments

### Task 1: Delete module consts and inline requireConfig env reads + verify zero matches + full regression

**index.ts changes:**

Deleted 4 lines:
```typescript
// DELETED:
const kineticaUser = process.env.KINETICA_USERNAME;
const kineticaPassword = process.env.KINETICA_PASSWORD;
```

Modified requireConfig to inline env reads (behaviour identical):
```typescript
// BEFORE:
const requireConfig = (req: Request, res: Response, next: NextFunction) => {
  const kineticaUrl = process.env.KINETICA_URL;
  if (!kineticaUrl || !kineticaUser || !kineticaPassword) {
    return res.status(500).json({
      error: "Missing KINETICA_URL, KINETICA_USERNAME, or KINETICA_PASSWORD environment variables."
    });
  }
  return next();
};

// AFTER:
const requireConfig = (req: Request, res: Response, next: NextFunction) => {
  if (!process.env.KINETICA_URL || !process.env.KINETICA_USERNAME || !process.env.KINETICA_PASSWORD) {
    return res.status(500).json({
      error: "Missing KINETICA_URL, KINETICA_USERNAME, or KINETICA_PASSWORD environment variables."
    });
  }
  return next();
};
```

Same error message, same 500 status, same env-var set checked — behaviour is identical.

## Task Commits

1. **refactor(02-06): delete kineticaUser/kineticaPassword module consts; inline requireConfig env reads** — `aa4fdd8`

## Test Count Delta vs Plan 05 Baseline

| Baseline (Plan 05) | New (this plan) | Total |
|--------------------|----------------|-------|
| 205 | +0 | **205** |

No new tests — this plan is a deletion+inline. The build + full suite serve as verification.

## Phase 2 Success Criteria Status (all 5)

| # | Criterion | Status |
|---|-----------|--------|
| 1 | A restricted-permission user sees only granted schemas/tables/columns | SATISFIED (02-03 CRED-06 integration tests) |
| 2 | A user without SELECT on table X via /api/sql gets Kinetica permission error → 502 | SATISFIED (02-03 KineticaPermissionError → 502 test) |
| 3 | `git grep -n "kineticaUser\|kineticaPassword\|Buffer.from(\`\${" index.ts` returns zero | SATISFIED (this plan — consts deleted; grep confirms zero matches) |
| 4 | Every Kinetica call emits one audit log line with username, route, outcome, no SQL bodies | SATISFIED (02-02 audit log + per-route audit assertions in 02-03/04/05) |
| 5 | Materialize, discovery, WMS continue to work for admin-equivalent user | SATISFIED (happy-path tests in 02-03/04/05) |

## Phase 2 Milestone Note

Phase 2 ships. CRED-01..06 + OBS-01 satisfied. Phase 3 owns ADMN-01..04 + UX-01..03.

All 5 Kinetica call sites now route through `kineticaSqlHelper`/`kineticaWms` with per-user credentials from `req.user.creds`. No inline admin-credential fetch remains anywhere in `index.ts`. Module-level const capture is gone — any future call site must pass `req` or read `process.env` directly, which is conspicuous enough to fail code review.

## Acceptance Criteria Verification

| Check | Command | Result |
|-------|---------|--------|
| Module consts deleted | `grep -cE '^const kineticaUser\|^const kineticaPassword' src/index.ts` | 0 |
| Zero grep matches in index.ts | `git grep -nE '\bkineticaUser\b\|\bkineticaPassword\b' src/index.ts` | 0 matches |
| Zero grep matches in server/src/ | `git grep -nE '\bkineticaUser\b\|\bkineticaPassword\b' server/src/` | 0 matches |
| requireConfig has inlined KINETICA_USERNAME | `grep -c "process.env.KINETICA_USERNAME" src/index.ts` | 1 |
| requireConfig has inlined KINETICA_PASSWORD | `grep -c "process.env.KINETICA_PASSWORD" src/index.ts` | 1 |
| All 5 call sites use helpers | `grep -cE 'kineticaSqlHelper\(' src/index.ts` = 5; `kineticaWms(req` = 1 | 6 total (>= 5) |
| TypeScript build clean | `npm run build` | Exit 0 |
| Full test suite | `npx vitest run` | 205/205 passed |
| .env.example has KINETICA_USERNAME | `grep -c KINETICA_USERNAME .env.example` | 1 |
| .env.example has KINETICA_PASSWORD | `grep -c KINETICA_PASSWORD .env.example` | 1 |

## Deviations from Plan

None — plan executed exactly as written.

The edit was precisely 4 lines removed from index.ts (2 const declarations + 1 blank line grouping + the `const kineticaUrl` local variable inside requireConfig replaced with an inline check). Net diff: 1 insertion, 5 deletions.

---

**Total deviations:** 0 auto-fixed
**Impact on plan:** Plan executed exactly as written.

## Self-Check: PASSED

- [x] `const kineticaUser` deleted: `grep -cE '^const kineticaUser' src/index.ts` returns 0
- [x] `const kineticaPassword` deleted: `grep -cE '^const kineticaPassword' src/index.ts` returns 0
- [x] `git grep` zero matches in index.ts: confirmed
- [x] `git grep` zero matches in server/src/: confirmed
- [x] `requireConfig` has `process.env.KINETICA_USERNAME` inlined: grep -c returns 1
- [x] `requireConfig` has `process.env.KINETICA_PASSWORD` inlined: grep -c returns 1
- [x] All 5+1 helper call sites present (5 kineticaSqlHelper + 1 kineticaWms)
- [x] `npm run build` exits 0
- [x] `npx vitest run`: 205/205 passed (16 files, 0 failures)
- [x] `.env.example` still contains KINETICA_USERNAME and KINETICA_PASSWORD: grep -c returns 1 each
- [x] Commit: `aa4fdd8`

---
*Phase: 02-per-user-credential-passthrough-on-every-kinetica-call*
*Completed: 2026-04-28*
