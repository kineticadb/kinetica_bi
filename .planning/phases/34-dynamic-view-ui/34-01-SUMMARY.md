---
phase: 34-dynamic-view-ui
plan: 01
subsystem: api
tags: [codemirror, lang-sql, error-handling, throwForStatus, tdd, vitest]

# Dependency graph
requires:
  - phase: 33-dynamic-view-store
    provides: 7 dynamic-view client helpers (createDynamicView, previewDynamicView, etc.) — Phase 34-01 fixes their shared throwForStatus error-message path
provides:
  - "@codemirror/lang-sql@^6.10.0 dependency installed (resolved 6.10.0) — unblocks Plan 34-03 SQL editor"
  - "throwForStatus preserves server-extracted error message in generic 4xx/5xx throw path (preserves verbatim message for non-401/403/502 status codes)"
  - "Byte-exact regression tests for verbatim {view} token error surfacing (createDynamicView + previewDynamicView)"
  - "Generic regression tests locking-in the new throwForStatus contract via runSql (JSON body, text body, empty body)"
affects: [34-02-modal-shell-and-left-list, 34-03-form-and-preview, 34-04-save-and-wiring, all-future-helpers-using-throwForStatus]

# Tech tracking
tech-stack:
  added: ["@codemirror/lang-sql@^6.10.0"]
  patterns: ["TDD RED → GREEN for error-handling fixes", "Byte-exact .toBe(...) instead of .toMatchObject regex for error-message assertions (avoids vitest false-positive surface)"]

key-files:
  created: []
  modified:
    - kinetica_bi/package.json
    - kinetica_bi/package-lock.json
    - kinetica_bi/src/api/client.ts
    - kinetica_bi/src/api/client.spec.ts

key-decisions:
  - "throwForStatus fix applied centrally (Pitfall 1 resolution from 34-RESEARCH.md) — single-line change benefits all 30+ helpers, not just dynamic-view ones."
  - "Replaced existing buggy test using vitest .toMatchObject({ message: /regex/ }) which passes vacuously — switched to .toBe(verbatim-string) for byte-exact assertion. Locks in the CONTEXT.md 'server-only {view} validation' contract."
  - "Generic regression block added in new describe('throwForStatus generic 4xx/5xx error preservation') — uses runSql as a vehicle (already imported) to lock in JSON/text/empty body branches independent of any specific helper."

patterns-established:
  - "Pattern: New regression specs for cross-helper error contracts use a low-dependency carrier (runSql) rather than every individual helper, plus per-helper byte-exact tests for the user-facing surfaces."
  - "Pattern: For string-equality assertions in vitest, prefer try/catch + expect(actualMessage).toBe(...) over .rejects.toMatchObject({ message: /regex/ }) — the latter is a known false-positive surface."

requirements-completed: [DV-V16-09, DV-V16-10]

# Metrics
duration: 5min
completed: 2026-05-15
---

# Phase 34 Plan 01: dependency-and-client-fix Summary

**Installed @codemirror/lang-sql@6.10.0 and fixed throwForStatus to preserve verbatim server error messages on non-401/403/502 status codes (unblocks Phase 34 modal's {view}-token error surfacing).**

## Performance

- **Duration:** 5 min
- **Started:** 2026-05-15T02:17:51Z
- **Completed:** 2026-05-15T02:23:06Z
- **Tasks:** 2
- **Files modified:** 4 (package.json, package-lock.json, client.ts, client.spec.ts)

## Accomplishments

- `@codemirror/lang-sql@^6.10.0` installed (exact resolved version: **6.10.0**, published 2025-09-16). Module loadable from `kinetica_bi/`; `require('@codemirror/lang-sql').sql` returns a function. tsc clean.
- `throwForStatus` in `kinetica_bi/src/api/client.ts:79` no longer discards the extracted server error message in the generic 4xx/5xx throw path. Server messages like `"Dynamic view template must contain a {view} token."` now surface verbatim to operators (per locked CONTEXT.md "server-only {view} validation" decision).
- Replaced existing buggy test in `client.spec.ts:453-463` — was `.toMatchObject({ message: /template_sql must contain/ })` which passed vacuously against `"Failed to create dynamic view: 400"`. Now uses `.toBe("Dynamic view template must contain a {view} token.")` byte-exact.
- Added 3 new regression tests + 1 parallel `previewDynamicView` test, locking the new contract for JSON-body / text-body / empty-body branches.
- `client.spec.ts`: **40 → 44 passing** (added 4 new tests; replaced 1 buggy test with byte-exact equivalent).
- Full frontend `tsc --noEmit` exits 0.

## Task Commits

Each task was committed atomically:

1. **Task 1: Install @codemirror/lang-sql dependency** — `9efdb9f` (chore)
2. **Task 2: Fix throwForStatus + add regression tests (TDD)**
   - `40ad129` (test) — RED: 5/44 failing on baseline throwForStatus
   - `1db7601` (fix) — GREEN: one-line change at client.ts:79+, all 44/44 passing

## Files Created/Modified

- `kinetica_bi/package.json` — Added `"@codemirror/lang-sql": "^6.10.0"` to `dependencies` (single-line additive).
- `kinetica_bi/package-lock.json` — npm-managed; updated to reflect resolved tree.
- `kinetica_bi/src/api/client.ts` — Replaced final line of `throwForStatus` (line 79). Old: `throw new Error(\`${fallbackMessage}: ${response.status}\`);` → New: `throw new Error(message);` with 4-line comment explaining the preserve-message contract. 401/403/502 branches above unchanged.
- `kinetica_bi/src/api/client.spec.ts` — Added `runSql` import; replaced 1 buggy test (createDynamicView 400 verbatim); added 1 parallel test (previewDynamicView 400 verbatim); added 3-test describe block (`throwForStatus generic 4xx/5xx error preservation`) for JSON/text/empty body branches.

## Decisions Made

- **Centralized fix** vs Phase-34-local workaround: chose the centralized one-line `throwForStatus` fix per 34-RESEARCH.md Pitfall 1 recommendation. Backward-compatible because `message` defaults to `fallbackMessage` when the server gives no JSON body. Future helpers benefit automatically; no per-helper duplication of 400-handling.
- **Byte-exact assertion** via `try/catch + expect(actualMessage).toBe(...)` instead of `.rejects.toMatchObject({ message: /regex/ })` — vitest's `toMatchObject` with regex on a property is a documented false-positive surface; byte-exact assertion is the only way to lock the exact server contract.
- **runSql as test vehicle** for the generic 4xx/5xx describe block — already imported and used at `client.ts:142`, fallback message `"SQL request failed"` is unambiguous, and runSql doesn't have its own 4xx test currently. Locks the contract once, benefits the whole client.

## Deviations from Plan

None. Plan executed exactly as written.

The plan anticipated one minor wrinkle ("Test c.c.second should already PASS — text branch already preserves the message"), but inspection of the original `throwForStatus` showed both the JSON and text branches were equally affected — the final `throw new Error(\`${fallbackMessage}: ${response.status}\`)` discarded ALL extracted messages, not just JSON ones. So all 5 new assertions were RED on baseline (not 4 as the plan predicted), then all GREEN after the one-line fix. No deviation in approach — just a tighter test coverage outcome than planned.

## Issues Encountered

**1. Stash-pop preserved pre-existing repo modifications (not caused by this plan)**

While running `npx vitest run` (full frontend suite) for the cross-check, I observed:
- 1 failed test file (2 failing tests inside it) in `kinetica_bi/src/components/DynamicViewsModal.spec.tsx` (`showToastSpy is not a spy` errors)
- Original tsc errors in `DynamicViewsModal.spec.tsx` against `TableDto` / `ToastKind`

Both files (`DynamicViewsModal.tsx` and `DynamicViewsModal.spec.tsx`) are **pre-existing Phase 34-02 work-in-progress** — neither is in the `<files_modified>` frontmatter for Plan 34-01. The commit `0bbd3bd test(34-02): add failing spec for DynamicViewsModal shell + left list + delete` predates this plan execution. Per the SCOPE BOUNDARY rule in execute-plan, these are not caused by this plan's changes and are deferred to Plan 34-02.

After completing Task 2, re-running `tsc --noEmit` came back clean (the prior tsc errors appear to have been from a transient state during the test run). The full vitest result: **847 tests passing + 2 failing**, where the 2 failures are entirely within the out-of-scope `DynamicViewsModal.spec.tsx` and unrelated to throwForStatus.

**For Plan 34-02:** Reconcile the pre-existing untracked `DynamicViewsModal.tsx` and modified `.spec.tsx` files — they should integrate cleanly with this plan's throwForStatus fix (the modal can now surface verbatim server messages).

## User Setup Required

None — no external service configuration required for this plan.

## Next Phase Readiness

- **Plan 34-02 (modal shell + left list):** Ready. `@codemirror/lang-sql` available though not directly imported until 34-03. Pre-existing 34-02 work-in-progress files (already on disk) should integrate cleanly.
- **Plan 34-03 (form + preview):** Ready. CodeMirror SQL editor unblocked; verbatim 400 error surfacing locked in via `throwForStatus` fix.
- **Plan 34-04 (save + wiring):** Ready. Save-flow's 400-error inline display will now correctly show server's verbatim error string instead of `"Failed to create dynamic view: 400"`.
- **No blockers introduced.**

## Self-Check: PASSED

- **Files claimed:**
  - `kinetica_bi/package.json` — FOUND, has `"@codemirror/lang-sql": "^6.10.0"` (verified via grep)
  - `kinetica_bi/package-lock.json` — FOUND, contains `@codemirror/lang-sql` entry
  - `kinetica_bi/src/api/client.ts` — FOUND, contains `throw new Error(message);`
  - `kinetica_bi/src/api/client.spec.ts` — FOUND, 4 occurrences of verbatim string, 44/44 passing
- **Commits claimed:**
  - `9efdb9f` — FOUND in git log
  - `40ad129` — FOUND in git log
  - `1db7601` — FOUND in git log
- **Verification commands:**
  - `node -e "console.log(typeof require('@codemirror/lang-sql').sql)"` → `function`
  - `grep -q "throw new Error(message);" kinetica_bi/src/api/client.ts` → exit 0
  - `cd kinetica_bi && npx vitest run src/api/client.spec.ts` → 44/44 passing
  - `cd kinetica_bi && npx tsc --noEmit` → exit 0

---

*Phase: 34-dynamic-view-ui*
*Completed: 2026-05-15*
