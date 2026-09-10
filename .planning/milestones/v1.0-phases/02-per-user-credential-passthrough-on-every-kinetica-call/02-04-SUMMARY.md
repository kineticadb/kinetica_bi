---
phase: 02-per-user-credential-passthrough-on-every-kinetica-call
plan: "04"
subsystem: api
tags: [kinetica, wms, per-user-credentials, tdd, integration-tests, binary-passthrough, audit-log]

# Dependency graph
requires:
  - "02-02: kineticaWms helper with per-user creds, typed errors, audit log"
  - "02-03: Route refactor pattern established (Phase 2 boundary: typed errors → 502)"
provides:
  - "kinetica_bi/server/src/index.ts: GET /api/wms routed through kineticaWms(req, queryString, { route: 'GET /api/wms' })"
  - "kinetica_bi/server/tests/routes.wms.spec.ts: 8 integration tests — happy path (binary passthrough), per-user auth header, 401/403/5xx/network → 502, audit log op:WMS no-bbox-leakage, unauthenticated → 401"
affects:
  - "02-05: POST /api/views/:id/materialize is the only remaining Kinetica call site to refactor"
  - "02-06: module-const deletion; remaining kineticaUser/kineticaPassword refs are 4 lines (declarations + requireConfig + materialize)"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "WMS refactor pattern: kineticaWms(req as AuthedRequest, queryString, { route }) — GET-shaped binary response, helper throws on error so route never streams a 4xx/5xx body"
    - "Binary passthrough: response.headers.get('content-type') forwarded, Buffer.from(await response.arrayBuffer()) sent via res.send(buffer)"
    - "Phase 2 boundary preserved on WMS: typed helper errors → 502 JSON; Phase 3 narrows to 401-REAUTH/403/502"

key-files:
  created:
    - "kinetica_bi/server/tests/routes.wms.spec.ts"
  modified:
    - "kinetica_bi/server/src/index.ts"

key-decisions:
  - "kineticaWms imported alongside kineticaSqlHelper on the same import line from ./kinetica (single import surface)"
  - "No kineticaUser/kineticaPassword in GET /api/wms handler; console.error('WMS proxy error') deleted — helper owns logging"
  - "4 remaining kineticaUser/kineticaPassword refs in index.ts (lines 51-52 declarations, line 69 requireConfig, line 275 materialize) — plan acceptance criteria said 3 but that was a count error (plan did not account for the 2 declaration lines separately from requireConfig); functionally correct"

# Metrics
duration: 3min
completed: 2026-04-28
---

# Phase 02 Plan 04: WMS Route Refactor Summary

**GET /api/wms refactored to use kineticaWms helper with per-user credentials; binary tile passthrough preserved; 8 new integration tests verify per-user auth, binary response, audit op:WMS, and no query-string leakage**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-04-28T15:34:09Z
- **Completed:** 2026-04-28T15:36:41Z
- **Tasks:** 1 (TDD: RED test file + GREEN refactor in index.ts)
- **Files created:** 1, **modified:** 1

## Accomplishments

### Task 1: Refactor GET /api/wms to use kineticaWms helper + integration tests

**index.ts changes:**

- Added `kineticaWms` to the existing import: `import { kineticaSql as kineticaSqlHelper, kineticaWms } from "./kinetica"`
- Replaced inline WMS handler body (fetch with admin creds + raw non-ok passthrough) with:
  ```typescript
  const queryString = new URLSearchParams(req.query as Record<string, string>).toString();
  const response = await kineticaWms(req as AuthedRequest, queryString, { route: "GET /api/wms" });
  const contentType = response.headers.get("content-type");
  if (contentType) res.setHeader("Content-Type", contentType);
  const buffer = Buffer.from(await response.arrayBuffer());
  return res.send(buffer);
  ```
- Deleted `console.error("WMS proxy error", error)` — helper owns logging
- Error catch: typed helper errors → `res.status(502).json({ error: "Failed to reach Kinetica WMS", detail: error.message })`

**routes.wms.spec.ts (8 tests):**

| Test | What it verifies |
|------|----------------|
| Forwards user creds + binary passthrough | Per-user Basic auth, Content-Type forwarded, PNG bytes returned |
| Per-user auth NOT from env var | Temporarily sets KINETICA_USERNAME; confirms session creds used instead |
| 401 → 502 | Kinetica 401 never passed through to client |
| 403 → 502 | Kinetica 403 never passed through to client |
| 5xx → 502 | Kinetica 500 → 502 boundary preserved |
| Network throw → 502 | fetch rejection → 502 |
| Audit op:WMS, no bbox | Audit log contains `"op":"WMS"`, does not contain `bbox=`/`99,99,100,100`/`width=` |
| No session → 401 | Phase 1 requireAuth behavior preserved |

## Task Commits

1. **TDD RED: Failing tests for WMS route** — `a5545b0`
2. **TDD GREEN: GET /api/wms refactor** — `ba88df9`

## Test Count Delta vs Plan 03 Baseline

| Baseline (Plan 03) | New (this plan) | Total |
|--------------------|----------------|-------|
| 184 | +8 (routes.wms.spec.ts) | **192** |

Phase 1's 56-test green baseline: preserved.

## Remaining kineticaUser/kineticaPassword References in index.ts

| Line | Site | Plan to migrate |
|------|------|----------------|
| 51 | `const kineticaUser = ...` declaration | Plan 06 (deletion) |
| 52 | `const kineticaPassword = ...` declaration | Plan 06 (deletion) |
| 69 | requireConfig guard | Plan 06 (narrowing) |
| 275 | POST /api/views/:id/materialize handler | Plan 05 |

Total: **4 lines** (grep -c returns 4). Plan 04 acceptance criteria said 3, but that was a counting error in the plan spec — it omitted the 2 declaration lines from the count. The refactor is complete and correct; all 4 remaining references are accounted for by Plans 05-06.

## Deviations from Plan

### Auto-fixed Issues

None.

### Minor discrepancy: acceptance criteria "exactly 3" vs actual 4 references

**Found during:** Acceptance criteria verification
**Issue:** Plan 04's acceptance criteria stated `grep -c "kineticaUser\|kineticaPassword"` should return 3 after this plan (2 in requireConfig + 1 in materialize). Actual count is 4 because the 2 declaration lines (51-52) are also counted by grep. Plan 03 SUMMARY documented 5 references before Plan 04; removing the WMS reference (1) leaves 4.
**Not a bug:** The WMS handler is correctly refactored. All remaining references are expected and will be removed by Plans 05-06.
**Impact:** Zero — plan's stated intent ("no kineticaUser/kineticaPassword in WMS handler") is fully met.

---

**Total deviations:** 0 auto-fixed
**Impact on plan:** Plan executed exactly as written. Minor count discrepancy in plan's acceptance spec; functionally correct.

## Self-Check: PASSED

- [x] `routes.wms.spec.ts` exists and all 8 tests pass
- [x] `index.ts` imports `kineticaWms`: `grep -c "kineticaWms" src/index.ts` → 2 (import + call)
- [x] GET /api/wms calls `kineticaWms(req`: `grep -c "kineticaWms(req" src/index.ts` → 1
- [x] No admin creds in WMS handler: `grep -c "kineticaUser\|kineticaPassword" src/index.ts` among WMS lines → 0
- [x] `arrayBuffer` preserved: `grep -n "arrayBuffer" src/index.ts` → present in WMS handler
- [x] `setHeader` preserved: `grep -n "setHeader" src/index.ts` → present in WMS handler
- [x] `WMS proxy error` deleted: `grep -c "WMS proxy error" src/index.ts` → 0
- [x] Full suite: `npx vitest run` → 192/192 passed (0 failures, 15 files)
- [x] Build: `npm run build` → exits 0
- [x] RED commit: `a5545b0`
- [x] GREEN commit: `ba88df9`

---
*Phase: 02-per-user-credential-passthrough-on-every-kinetica-call*
*Completed: 2026-04-28*
