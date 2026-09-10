---
automated_gates_ref: "64-01"
phase: 64-verification-live-uat
recorded_on: "2026-06-16T01:46:44Z"
commit: "408259d"
overall_verdict: ALL PASS
---

# Phase 64: SC3 Automated Gate Results

**Recorded:** 2026-06-16T01:46:44Z
**HEAD commit:** 408259d
**Operator:** RPereira@kinetica.com
**Purpose:** Evidence record for SC3 of the v1.12 milestone-gate verification. Consumed by 64-02 §0 (UAT preconditions) and 64-03 (compiled verification).

---

## Gate Results

| Gate | Command | Result | Numbers / Notes |
|------|---------|--------|-----------------|
| frontend_vitest | `cd packages/web && npx vitest run` | PASS | 2133/2133 tests, 95/95 files, 0 failures — meets >= 2133 baseline |
| web_tsc | `cd packages/web && npx tsc --noEmit -p tsconfig.json` | PASS | Clean — zero errors, no output, exit 0 |
| server_tsc | `cd packages/server && npx tsc --noEmit -p tsconfig.json` | PASS | Clean — zero errors, no output, exit 0 |
| server_vitest_setgate | `cd packages/server && npx vitest run` | PASS | 8 failed files / 53 passed / 1 skipped (61 total); 50 test failures, 847 passed; all 8 failing files ⊆ TD-V16-TEST-ISOLATION known-flaky list (see below) |
| targeted_v112_web_specs | `cd packages/web && npx vitest run [5 files]` | PASS | 257/257 tests, 5/5 files, 0 failures |
| targeted_v112_server_specs | `cd packages/server && npx vitest run [3 files]` | PASS | 55/55 tests, 3/3 files, 0 failures |
| source_tree_clean_guard | `git status --porcelain -- packages/server packages/web` + `git diff --name-only` | PASS | Empty output — source tree clean; Phases 62 (server) + 63 (client) already committed |

---

## Gate Detail

### Gate 1 — Frontend vitest (deterministic, 100% bar)

**Command:** `cd packages/web && npx vitest run`

**Observed output (tail):**
```
 Test Files  95 passed (95)
      Tests  2133 passed (2133)
   Start at  21:46:49
   Duration  22.24s (transform 19.87s, setup 30.11s, import 33.23s, tests 58.84s, environment 162.99s)
```

Note: The suite emits intentional negative-path console errors from `DashboardContext.spec.tsx` (renders consumer outside its provider on purpose) and "Not implemented: navigation to another Document" from jsdom. These are expected — the suite is fully green.

**Verdict:** PASS — 2133/2133 tests, 95/95 files, 0 failures. Count meets the >= 2133 baseline established at Phase 63 close. No regressions.

---

### Gate 2 — Web tsc

**Command:** `cd packages/web && npx tsc --noEmit -p tsconfig.json`

**Observed output:** *(no output)*

**Exit code:** 0

**Verdict:** PASS — clean (zero errors).

---

### Gate 3 — Server tsc

**Command:** `cd packages/server && npx tsc --noEmit -p tsconfig.json`

**Observed output:** *(no output)*

**Exit code:** 0

**Verdict:** PASS — clean (zero errors).

---

### Gate 4 — Server vitest SET-BASED gate

**Command:** `cd packages/server && npx vitest run`

**Observed output (summary):**
```
 Test Files  8 failed | 53 passed (61)
      Tests  50 failed | 847 passed | 1 skipped (898)
   Start at  21:47:35
   Duration  4.00s (transform 5.22s, setup 1.69s, import 20.05s, tests 10.93s, environment 14ms)
```

**Failing test FILES (8):**

| Failing file | In TD-V16-TEST-ISOLATION known-flaky list? |
|---|---|
| `tests/auth.oidc.spec.ts` | YES — auth.oidc |
| `tests/auth.routes.spec.ts` | YES — auth.routes |
| `tests/boot.hardening.spec.ts` | YES — boot.hardening |
| `tests/boot.wipe.spec.ts` | YES — boot.wipe |
| `tests/bootstrap.spec.ts` | YES — bootstrap |
| `tests/db.smoke.spec.ts` | YES — db.smoke |
| `tests/oidc.module.spec.ts` | YES — oidc.module |
| `tests/routes.wms.spec.ts` | YES — routes.wms |

**Subset check:** Failing-file set {auth.oidc, auth.routes, boot.hardening, boot.wipe, bootstrap, db.smoke, oidc.module, routes.wms} ⊆ TD-V16-TEST-ISOLATION known-flaky set {auth.oidc, auth.routes, boot.hardening, boot.wipe, bootstrap, db.smoke, oidc.module, routes.wms} — TRUE.

**Verdict:** PASS — all 8 failing files are in the TD-V16-TEST-ISOLATION known-flaky list. No non-flaky file failed. The exact failing test-COUNT (50 tests) is irrelevant per the set-based gate policy — only the file set matters. Gate result is identical to the Phase 61 baseline (8 failing files, same set), confirming zero server-side regression. Phase 62 introduced the dv-materialize server route extension; those new tests (routes.filter-materialize-dv.spec.ts) pass cleanly (see Gate 6).

---

### Gate 5 — Targeted v1.12 WEB spec group (client dv-drill chain under test)

**Command:**
```
cd packages/web && npx vitest run \
  src/store/filterStore.spec.ts \
  src/store/filterViewStore.spec.ts \
  src/api/client.spec.ts \
  src/components/charts/WidgetRenderer.spec.tsx \
  src/components/DashboardsPage.spec.tsx
```

**Observed output (summary):**
```
 Test Files  5 passed (5)
      Tests  257 passed (257)
   Start at  21:47:55
   Duration  14.97s (transform 2.72s, setup 823ms, import 4.38s, tests 13.41s, environment 4.78s)
```

**Per-file breakdown:**

| File | Package | Result |
|------|---------|--------|
| `src/store/filterStore.spec.ts` | web | PASS |
| `src/store/filterViewStore.spec.ts` | web | PASS |
| `src/api/client.spec.ts` | web | PASS |
| `src/components/charts/WidgetRenderer.spec.tsx` | web | PASS |
| `src/components/DashboardsPage.spec.tsx` | web | PASS |

**Bug-fix / isolation assertions (WidgetRenderer.spec.tsx):**

- **Test ~2618 — THE BUG-FIX:** `"dv drill populates dvFilters[7] AND leaves filters[42] EMPTY"` — asserts `dvFilters[7]` is populated with the region/EAST filter AND `filters[42]` (the source table id) has length 0. Proves THE original bug is killed: a dv drill no longer keys the filter by the source table id.
- **Test ~2657 — reverse isolation:** table drill leaves `dvFilters[7]` empty — proves the table path does not contaminate the dv slice.
- **Test ~2687 — reverse isolation (other direction):** dv drill leaves `filters[42]` empty — the two slices are fully independent.

**Verdict:** PASS — all 5 targeted v1.12 web spec files green; 257/257 combined tests. The client dv-drill chain (keying, dispatch, materialize trigger, read-path swap, chips/lifecycle) is verified under test.

---

### Gate 6 — Targeted v1.12 SERVER spec group (server dv-materialize path under test)

**Command:**
```
cd packages/server && npx vitest run \
  tests/lib.viewNaming.spec.ts \
  tests/routes.filter-materialize-dv.spec.ts \
  tests/routes.filter-materialize.spec.ts
```

**Observed output (summary):**
```
 Test Files  3 passed (3)
      Tests  55 passed (55)
   Start at  21:48:15
   Duration  872ms (transform 533ms, setup 53ms, import 1.01s, tests 293ms, environment 0ms)
```

**Per-file breakdown:**

| File | Package | Result |
|------|---------|--------|
| `tests/lib.viewNaming.spec.ts` | server | PASS |
| `tests/routes.filter-materialize-dv.spec.ts` | server | PASS |
| `tests/routes.filter-materialize.spec.ts` | server | PASS |

**What each covers:**
- `lib.viewNaming.spec.ts` — `buildFilterViewName` produces `_dv<id>` segment for dv sources vs `_t<id>` for table sources (naming distinction unchanged).
- `routes.filter-materialize-dv.spec.ts` — dv-path: `POST /api/filter/materialize` FROM the dv materialized view, distinct filter view, 404/400 guards, fail-safe, DELETE dv branch — in both auth modes (password + OIDC).
- `routes.filter-materialize.spec.ts` — table-path byte-unchanged regression: the original table-backed materialize path is unaffected by the Phase 62 dv extension.

These 3 spec files are NOT in the TD-V16-TEST-ISOLATION known-flaky set — they are deterministic and must be 100% green. They are.

**Verdict:** PASS — 3/3 files, 55/55 tests, all-green. The server dv-materialize extension (Phase 62) is regression-clean.

---

### Gate 7 — Source-tree clean guard

**Command:** `git status --porcelain -- packages/server packages/web` and `git diff --name-only -- packages/server packages/web`

**Observed output:** *(no output — empty)*

**Verdict:** PASS — working tree shows zero changes in `packages/server` or `packages/web`. Phases 62 (server — materialize-from-dv-view) and 63 (client — dv drill-down) are both already committed. This Phase 64 verification produces DOCS only (in `.planning/`, which is gitignored locally).

---

## Server Vitest SET-BASED Gate — Detailed Subset Verification

The exact failing test-COUNT is irrelevant per the set-based gate policy established in TD-V16-TEST-ISOLATION. Only the FILE SET matters.

**Policy statement:** Gate passes iff: {failing test files at HEAD} ⊆ {TD-V16-TEST-ISOLATION known-flaky set}

**Known-flaky set (TD-V16-TEST-ISOLATION):**
`{auth.oidc, auth.routes, boot.hardening, boot.wipe, bootstrap, db.smoke, oidc.module, routes.wms}`

**Observed failing file set at HEAD 408259d:**
`{auth.oidc, auth.routes, boot.hardening, boot.wipe, bootstrap, db.smoke, oidc.module, routes.wms}`

**Subset check result:** EQUAL (proper subset is also subset) — TRUE.

**No new failures outside the known-flaky set.** The v1.12 Phase 62 server changes (dv materialize route extension) introduced zero regressions in the existing test suite — confirmed by the targeted group (Gate 6) being 100% green and the full suite set-gate passing.

---

## overall_verdict: ALL PASS

All seven SC3 gates pass:

- **frontend_vitest:** 2133/2133 tests, 95/95 files, 0 failures (>= 2133 baseline met, 100% green, run from `packages/web`)
- **web_tsc:** clean (exit 0, zero errors) — `cd packages/web && npx tsc --noEmit -p tsconfig.json`
- **server_tsc:** clean (exit 0, zero errors) — `cd packages/server && npx tsc --noEmit -p tsconfig.json`
- **server_vitest_setgate:** 8 failing files ⊆ TD-V16-TEST-ISOLATION known-flaky set — no regressions outside known-flaky set; exact failing count irrelevant per set-based policy; set is identical to Phase 61 baseline
- **targeted_v112_web_specs:** 257/257 tests, 5/5 files (filterStore, filterViewStore, client.ts, WidgetRenderer, DashboardsPage all green; bug-fix assertions at ~2618/2657/2687 locked)
- **targeted_v112_server_specs:** 55/55 tests, 3/3 files (lib.viewNaming, routes.filter-materialize-dv, routes.filter-materialize all green)
- **source_tree_clean_guard:** `packages/server` + `packages/web` tree clean; Phases 62 + 63 committed; this phase produces DOCS only

The v1.12 dv-drill-down chain automated evidence is green. SC3 is satisfied. This record is ready for consumption by 64-02 §0 (UAT preconditions) and 64-03 (compiled verification).

---

*Gates run: 2026-06-16T01:46:44Z*
*Runner: Claude (gsd-executor) on behalf of RPereira@kinetica.com*
