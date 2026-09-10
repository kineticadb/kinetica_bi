---
plan: 51-01
run_timestamp: "2026-06-06T23:06:48Z"
run_completed: "2026-06-06T23:15:00Z"
executor: claude-sonnet-4-6
---

# 51-01 Automated Gates Report

Run against commit `7ff8eb6` (fix(51-01): correct stale button-order assertion).
All gates run from repo root `/Users/rydelpereira/Documents/projects/kinetica_bi`.

---

## frontend_vitest

result: PASS

**Command:** `npm run test -- --run`
**Output summary:**

```
 Test Files  78 passed (78)
      Tests  1568 passed (1568)
   Start at  19:07:15
   Duration  17.16s
```

**Verdict:** 1568/1568 tests pass. 100% green. TD-V17-DASHPAGE-SPEC (button-order) is closed — the renamed test now passes asserting `Tables → Dynamic Views → Map Layers`.

---

## frontend_tsc

result: PASS

**Command:** `npx -w packages/web tsc --noEmit`
**Output summary:** No output (zero errors).

**Verdict:** Frontend TypeScript compilation is clean. No type errors. (Note: Phase 50 report mentioned pre-existing debt in DataFilterConfigPanel.spec.tsx and App.spec.tsx — neither appeared in this run, confirming they were already resolved.)

---

## server_tsc

result: PASS

**Command:** `npx -w packages/server tsc --noEmit`
**Output summary:** No output (zero errors).

**Verdict:** Server TypeScript compilation is clean. No type errors.

---

## rbac_spec_groups

result: PASS

**Command:** Each group run individually: `npm run test:server -- <group>`

| Spec File | Tests Passed | Result |
|---|---|---|
| lib.permissions.spec.ts | 15/15 | PASS |
| db.rbacMigration.spec.ts | 22/22 | PASS |
| db.rbacAudit.spec.ts | 9/9 | PASS |
| lib.rbacDb.spec.ts | 16/16 | PASS |
| boot.rbacAdminWarning.spec.ts | 4/4 | PASS |
| routes.rbac.spec.ts | 5/5 | PASS |
| routes.guards.spec.ts | 8/8 | PASS |
| routes.management.spec.ts | 65/65 | PASS |
| auth.login-rbac.spec.ts | 3/3 | PASS |

**Total:** 147/147 tests across 9 deterministic RBAC groups (includes auth.login-rbac per post-plan note).

**Verdict:** All 9 RBAC deterministic spec groups are green. `boot.rbacAdminWarning.spec.ts` serves as automated proxy for OIDC bootstrap-warning check; manual boot confirmation is on the 51-02 UAT checklist.

---

## server_vitest_setgate

result: PASS

**Command:** `npm run test:server`
**Output summary:**

```
 Test Files  8 failed | 50 passed (58)
      Tests  50 failed | 785 passed | 1 skipped (836)
```

**Failing files (8):**
1. `auth.oidc.spec.ts`
2. `auth.routes.spec.ts`
3. `boot.hardening.spec.ts`
4. `boot.wipe.spec.ts`
5. `bootstrap.spec.ts`
6. `db.smoke.spec.ts`
7. `oidc.module.spec.ts`
8. `routes.wms.spec.ts`

**Known-flaky list (TD-V16-TEST-ISOLATION, 13 named ceiling):**
`auth.oidc.spec.ts`, `auth.routes.spec.ts`, `boot.hardening.spec.ts`, `boot.wipe.spec.ts`, `bootstrap.spec.ts`, `db.smoke.spec.ts`, `errorMiddleware.spec.ts`, `kinetica.creds.routes.spec.ts`, `oidc.module.spec.ts`, `routes.discovery.spec.ts`, `routes.materialize.spec.ts`, `routes.sql.spec.ts`, `routes.wms.spec.ts`

**Set membership check:**
- `auth.oidc.spec.ts` — IN known-flaky list
- `auth.routes.spec.ts` — IN known-flaky list
- `boot.hardening.spec.ts` — IN known-flaky list
- `boot.wipe.spec.ts` — IN known-flaky list
- `bootstrap.spec.ts` — IN known-flaky list
- `db.smoke.spec.ts` — IN known-flaky list
- `oidc.module.spec.ts` — IN known-flaky list
- `routes.wms.spec.ts` — IN known-flaky list

**Failing files ⊆ known-flaky list: YES**

**Verdict:** All 8 failing files are members of the TD-V16-TEST-ISOLATION known-flaky set. No new failing files introduced. Gate PASSES.

---

## builds

result: PASS

**Frontend build (`npm run build`):**
```
dist/index.html                     1.09 kB │ gzip:   0.57 kB
dist/assets/index-C_wrKK04.css     71.49 kB │ gzip:  12.80 kB
dist/assets/index-BCAditWi.js   1,993.77 kB │ gzip: 599.90 kB │ map: 9,749.55 kB
✓ built in 6.86s
```
Note: chunk size warning is a pre-existing advisory (not an error); build exits 0.

**Server build (`npm run build:server`):**
```
> @kinetica-bi/server@0.1.0 build
> tsc -p tsconfig.json
```
No output beyond script invocation = zero errors, exit 0.

**Verdict:** Both production builds complete clean.

---

## gate_summary

| Gate | Result | Evidence |
|---|---|---|
| frontend_vitest | PASS | 1568/1568 tests, 78 files, 0 failures |
| frontend_tsc | PASS | Zero errors, clean output |
| server_tsc | PASS | Zero errors, clean output |
| rbac_spec_groups | PASS | 147/147 tests across 9 deterministic groups |
| server_vitest_setgate | PASS | 785 passed; 8 failing files ⊆ 13-file known-flaky set (TD-V16-TEST-ISOLATION) |
| builds | PASS | Frontend built in 6.86s; server tsc exits 0 |

**Overall: ALL GATES PASS**

VERIFY-V18-01 evidence is complete. Phase 51-03 VERIFICATION compiler may consume this file.
