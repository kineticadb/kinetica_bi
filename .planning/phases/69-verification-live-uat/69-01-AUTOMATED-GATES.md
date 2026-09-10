---
automated_gates_ref: "69-01"
phase: 69-verification-live-uat
recorded_on: "2026-06-18T13:37:56Z"
commit: "0a9d9f8"
overall_verdict: ALL PASS
week_anchor_spike: NOT-RUN(REAUTH_REQUIRED)
---

# Phase 69: SC1 Automated Gate Results

**Recorded:** 2026-06-18T13:37:56Z
**HEAD commit:** 0a9d9f8
**Operator:** RPereira@kinetica.com
**Purpose:** Evidence record for SC1 of the v1.13 milestone-gate verification (Calendar Heatmap). Consumed by 69-02 §0 (UAT preconditions) and 69-03 (compiled verification).

---

## Gate Results

| Gate | Command | Result | Numbers / Notes |
|------|---------|--------|-----------------|
| frontend_vitest | `cd packages/web && npx vitest run` | PASS | 2373/2373 tests, 104/104 files, 0 failures — meets >= 2373 / >= 104 baseline |
| web_tsc | `cd packages/web && npx tsc --noEmit -p tsconfig.json` | PASS | Clean — zero errors, no output, exit 0 |
| server_tsc | `cd packages/server && npx tsc --noEmit -p tsconfig.json` | PASS | Clean — zero errors, no output, exit 0 |
| server_vitest_setgate | `cd packages/server && npx vitest run` | PASS | 8 failed files / 53 passed (61 total); 50 test failures, 847 passed, 1 skipped; failing-file set IDENTICAL to Phase 64 baseline (TD-V16-TEST-ISOLATION) |
| locked_invariants_reassert | (part of frontend_vitest) | PASS | theme-guard.spec.ts (no raw hex in CalendarRenderer/CalendarConfigPanel) + CalendarRenderer.spec.tsx Test 0 (no materializeFilter/dropFilterView/fromSwap) both GREEN in the full suite |
| targeted_v113_calendar_specs | `cd packages/web && npx vitest run [8 files]` | PASS | 211/211 tests, 8/8 files, 0 failures |
| source_tree_clean_guard | `git status --porcelain -- packages/server packages/web` + `git diff --name-only` | PASS | Empty output — source tree clean; `git diff --name-only -- packages/server` EMPTY (zero server source diff — v1.13 is frontend-only) |
| week_anchor_spike | `curl POST /api/sql DATE_TRUNC('week', …)` | NOT-RUN | Server up; SQL probe returned `REAUTH_REQUIRED` — recorded NOT-RUN, never blocks (see below). NOT a pass/fail gate. |

---

## Gate Detail

### Gate 1 — Frontend vitest (deterministic, 100% bar)

**Command:** `cd packages/web && npx vitest run` (run FROM `packages/web` — NOT `--root` from repo root, per the TEST CWD PITFALL)

**Observed output (tail):**
```
 Test Files  104 passed (104)
      Tests  2373 passed (2373)
   Start at  09:24:00
   Duration  42.56s (transform 21.98s, setup 63.22s, import 40.08s, tests 76.75s, environment 342.11s)
```

Note: The suite emits intentional negative-path console errors from `DashboardContext.spec.tsx` ("useDashboardContext must be used inside DashboardContext.Provider" — renders the consumer outside its provider on purpose) and jsdom navigation warnings. These are expected — the suite is fully green.

**Verdict:** PASS — 2373/2373 tests, 104/104 files, 0 failures. Count meets the >= 2373 / >= 104 baseline established at 69-CONTEXT. No regressions.

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

**Verdict:** PASS — clean (zero errors). v1.13 is frontend-only — server source untouched — so this is expected to be unchanged from the Phase 64 baseline.

---

### Gate 4 — Server vitest SET-BASED gate

**Command:** `cd packages/server && npx vitest run`

**Observed output (summary):**
```
 Test Files  8 failed | 53 passed (61)
      Tests  50 failed | 847 passed | 1 skipped (898)
```

**Failing test FILES (8):**

| Failing file | In Phase 64 baseline / TD-V16-TEST-ISOLATION? |
|---|---|
| `tests/auth.oidc.spec.ts` | YES — auth.oidc |
| `tests/auth.routes.spec.ts` | YES — auth.routes |
| `tests/boot.hardening.spec.ts` | YES — boot.hardening |
| `tests/boot.wipe.spec.ts` | YES — boot.wipe |
| `tests/bootstrap.spec.ts` | YES — bootstrap |
| `tests/db.smoke.spec.ts` | YES — db.smoke |
| `tests/oidc.module.spec.ts` | YES — oidc.module |
| `tests/routes.wms.spec.ts` | YES — routes.wms |

**IDENTICAL-set check:** Observed failing-file set {auth.oidc, auth.routes, boot.hardening, boot.wipe, bootstrap, db.smoke, oidc.module, routes.wms} = Phase 64 baseline set {auth.oidc, auth.routes, boot.hardening, boot.wipe, bootstrap, db.smoke, oidc.module, routes.wms} — TRUE (identical, no file outside the set).

**Verdict:** PASS — v1.13 is frontend-only, so the server source is byte-unchanged and the failing-file set must match the Phase 64 baseline exactly. It does — not just as a subset but with byte-identical numbers (8 failed | 53 passed (61); 50 failed | 847 passed | 1 skipped (898)) to 64-01. Zero new server regressions. The exact failing test-COUNT is irrelevant per the set-based gate policy — only the file set matters, and it is identical.

---

### Gate 5 — Locked Invariants Re-Assertion (inside the green frontend suite)

The two locked v1.13 invariants are NOT separate scripts — they are spec files inside the frontend vitest suite (Gate 1). A green suite re-asserts both.

| Invariant | Spec file | Mechanism | Result |
|---|---|---|---|
| No raw hex in calendar files | `src/styles/theme-guard.spec.ts` | Recursively scans `src/components/**/*.tsx` for raw hex; `CalendarRenderer.tsx` and `CalendarConfigPanel.tsx` are NOT on the color-authoring allowlist, so any raw hex would fail | GREEN (in 104/104) |
| No materialize / no fromSwap | `src/components/charts/CalendarRenderer.spec.tsx` Test 0 (static invariant) | `readFileSync` of the renderer source; asserts import lines do NOT match `/materializeFilter\|dropFilterView\|fromSwap/` | GREEN (in 104/104; also in Gate 6) |

**Verdict:** PASS — both invariant specs are part of the green frontend suite. theme-guard proves "no raw hex in CalendarRenderer/CalendarConfigPanel" (theme-tokens-only). CalendarRenderer Test 0 proves the sole-materialize-trigger + no-fromSwap invariants (AggregatedWidgetRenderer remains the sole materialize trigger; CalendarRenderer resolves FROM before building SQL, never via fromSwap).

---

### Gate 6 — Targeted v1.13 CALENDAR spec group (the calendar chain under test)

**Command:**
```
cd packages/web && npx vitest run \
  src/lib/calendarBin.spec.ts \
  src/lib/buildCalendarSql.spec.ts \
  src/lib/calendarColorScale.spec.ts \
  src/lib/calendarGapFill.spec.ts \
  src/lib/calendarLayout.spec.ts \
  src/lib/calendarBuckets.spec.ts \
  src/components/charts/CalendarConfigPanel.spec.tsx \
  src/components/charts/CalendarRenderer.spec.tsx
```

**Observed output (summary):**
```
 Test Files  8 passed (8)
      Tests  211 passed (211)
   Start at  09:36:04
   Duration  2.50s
```

**Per-file breakdown:**

| File | Covers | Result |
|------|--------|--------|
| `src/lib/calendarBin.spec.ts` | computeCellBounds half-open buckets + valid-combo / DATE_TRUNC-unit / LIMIT constants | PASS |
| `src/lib/buildCalendarSql.spec.ts` | two-level DATE_TRUNC builder; FROM resolved before string | PASS |
| `src/lib/calendarColorScale.spec.ts` | computeDomain + 5-bucket quantize + palette resolver | PASS |
| `src/lib/calendarGapFill.spec.ts` | **68.2 regression** — per-group gap-fill: in-range grey, out-of-range blank; format-agnostic bucket-key lookup (4f4ef7c) | PASS |
| `src/lib/calendarLayout.spec.ts` | block layout + WEEK_START + **week×hour punchcard (0a9d9f8)** | PASS |
| `src/lib/calendarBuckets.spec.ts` | enumerateGroupBuckets all 8 combos incl. leap; **anchor-agnostic inferWeekAnchorDow (90c8f3b)** | PASS |
| `src/components/charts/CalendarConfigPanel.spec.tsx` | dependent domain/subdomain, cap, Display section toggles (344c274) | PASS |
| `src/components/charts/CalendarRenderer.spec.tsx` | Test 0 static invariant + fetch/FROM-precedence + drill + reactive color domain | PASS |

**Verdict:** PASS — 8/8 files, 211/211 tests, all-green. The v1.13 calendar chain under test is verified, including the three 68.2 regression suites (per-group gap-fill, week×hour punchcard, anchor-agnostic week inference — CALUX-V113-03).

---

### Gate 7 — Source-tree clean guard

**Command:** `git status --porcelain -- packages/server packages/web` and `git diff --name-only -- packages/server` / `-- packages/web`

**Observed output:** *(no output — empty for all three)*

**Verdict:** PASS — working tree shows zero changes in `packages/server` or `packages/web`. Critically, `git diff --name-only -- packages/server` is EMPTY — server source is untouched, confirming v1.13 is frontend-only. Phases 65–68.2 are all committed. This Phase 69 verification produces DOCS only (in `.planning/`, which is gitignored locally).

---

### Gate 8 — Best-effort week-anchor spike (NEVER blocks)

**Commands:**
```
curl -s http://localhost:4000/api/health
curl -s -X POST http://localhost:4000/api/sql -H "Content-Type: application/json" \
  -d '{"sql": "SELECT DATE_TRUNC('"'"'week'"'"', TIMESTAMP '"'"'2024-01-01 00:00:00'"'"') AS wk"}'
```

**Observed output:**
```
# health
{"status":"ok","service":"kinetica-bi-backend","version":"0.1.0"}
# spike
{"error":"Authentication required.","code":"REAUTH_REQUIRED"}
```

**Interpretation:** The server is up, but the SQL probe requires an authenticated session and returned `REAUTH_REQUIRED`. A session cannot be obtained without reading `packages/server/.env` credentials, which is security-prohibited (same barrier as Phase 65-02 / 68.2-02). `packages/server/.env` was NOT read, printed, echoed, or committed.

**Result:** `NOT-RUN(REAUTH_REQUIRED)`.

**Why this does not block:** `inferWeekAnchorDow` (90c8f3b) infers the Kinetica week anchor empirically from the returned data, making the literal DATE_TRUNC('week') anchor moot — the renderer handles a Monday-ISO or Sunday anchor identically. CALUX-V113-03 is functionally complete regardless of the spike outcome. The spike is recorded for evidence but is NOT a pass/fail gate.

---

## Server Vitest SET-BASED Gate — Detailed Set Verification

The exact failing test-COUNT is irrelevant per the set-based gate policy established in TD-V16-TEST-ISOLATION. Only the FILE SET matters. v1.13 is frontend-only, so the set must match the Phase 64 baseline EXACTLY (not merely as a subset).

**Policy statement:** Gate passes iff: {failing test files at HEAD} = {Phase 64 baseline failing-file set}. Any file OUTSIDE that set = a new server regression = RED.

**Phase 64 baseline failing set:**
`{auth.oidc, auth.routes, boot.hardening, boot.wipe, bootstrap, db.smoke, oidc.module, routes.wms}`

**Observed failing file set at HEAD 0a9d9f8:**
`{auth.oidc, auth.routes, boot.hardening, boot.wipe, bootstrap, db.smoke, oidc.module, routes.wms}`

**Identical-set check result:** EQUAL — TRUE. The full summary line (8 failed | 53 passed (61); 50 failed | 847 passed | 1 skipped (898)) is byte-identical to 64-01.

**No failures outside the baseline set.** v1.13 touched zero server source files (Gate 7 confirms `git diff --name-only -- packages/server` is empty), so zero server-side regressions are possible — confirmed.

---

## overall_verdict: ALL PASS

All deterministic SC1 gates pass:

- **frontend_vitest:** 2373/2373 tests, 104/104 files, 0 failures (>= 2373 / >= 104 baseline met, 100% green, run from `packages/web`)
- **web_tsc:** clean (exit 0, zero errors) — `cd packages/web && npx tsc --noEmit -p tsconfig.json`
- **server_tsc:** clean (exit 0, zero errors) — `cd packages/server && npx tsc --noEmit -p tsconfig.json`
- **server_vitest_setgate:** 8 failing files = Phase 64 baseline set EXACTLY (byte-identical summary); no regressions outside the known-flaky set; exact failing count irrelevant per set-based policy
- **locked_invariants_reassert:** theme-guard.spec.ts (no raw hex) + CalendarRenderer Test 0 (no materialize/no fromSwap) both green in the full suite
- **targeted_v113_calendar_specs:** 211/211 tests, 8/8 files (incl. 68.2 per-group gap-fill / week×hour punchcard / anchor-agnostic regression suites)
- **source_tree_clean_guard:** `packages/server` + `packages/web` tree clean; `git diff --name-only -- packages/server` EMPTY (frontend-only confirmed); this phase produces DOCS only

The week-anchor spike is recorded `NOT-RUN(REAUTH_REQUIRED)` — it is NOT a pass/fail gate, and `inferWeekAnchorDow` makes the anchor empirically moot, so it does NOT block the milestone close.

The v1.13 Calendar Heatmap automated evidence is green. SC1 is satisfied. This record is ready for consumption by 69-02 §0 (UAT preconditions) and 69-03 (compiled verification).

---

*Gates run: 2026-06-18T13:37:56Z*
*Runner: Claude (gsd-executor) on behalf of RPereira@kinetica.com*
