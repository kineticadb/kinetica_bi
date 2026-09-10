---
phase: 02-per-user-credential-passthrough-on-every-kinetica-call
plan: "02"
subsystem: api
tags: [kinetica, helper, typed-errors, audit-log, per-user-credentials, tdd]

# Dependency graph
requires:
  - "02-01: SPIKE.md — HTTP 400 (not 403) is Kinetica's DDL-permission-denial signal"
  - "01-04: req.user.creds shape from requireAuth (Phase 1 output)"
provides:
  - "kinetica_bi/server/src/kineticaErrors.ts: KineticaAuthError, KineticaPermissionError, KineticaUpstreamError"
  - "kinetica_bi/server/src/kinetica.ts: kineticaSql, kineticaWms — req-aware helpers with per-user creds, audit log, typed errors"
  - "kinetica_bi/server/src/auth.ts: req.requestId populated via randomUUID() in requireAuth Step 10"
  - "4 spec files: kinetica.errors.spec.ts, kinetica.sql.spec.ts, kinetica.wms.spec.ts, kinetica.audit.spec.ts — 100 tests"
affects:
  - "02-03 through 02-06: call sites can now import kineticaSql / kineticaWms from ./kinetica and trust the contract"
  - "03-XX: global error middleware can catch KineticaAuthError / KineticaPermissionError / KineticaUpstreamError"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "classifyHttpError: 401 → KineticaAuthError, 403 → KineticaPermissionError, 400+/access denied|permission/i body → KineticaPermissionError, else → KineticaUpstreamError"
    - "Dual-channel logging: single-line JSON audit to console.log (no SQL body, no WMS qs, no auth header); raw upstream detail to console.error"
    - "Object.setPrototypeOf(this, new.target.prototype) in Error subclasses — required for instanceof checks in TypeScript compiled output"
    - "classifyHttpError reads response body for 400 path — Response.json() called once, result reused to avoid double-read on 400 + access-denied"
    - "emitAudit has FIXED field ordering in JSON.stringify spread — guaranteed by explicit key enumeration (not ...fields spread) to prevent extra fields leaking"

key-files:
  created:
    - "kinetica_bi/server/src/kineticaErrors.ts"
    - "kinetica_bi/server/src/kinetica.ts"
    - "kinetica_bi/server/tests/kinetica.errors.spec.ts"
    - "kinetica_bi/server/tests/kinetica.sql.spec.ts"
    - "kinetica_bi/server/tests/kinetica.wms.spec.ts"
    - "kinetica_bi/server/tests/kinetica.audit.spec.ts"
  modified:
    - "kinetica_bi/server/src/auth.ts"
    - "kinetica_bi/server/tests/auth.requireAuth.spec.ts"

key-decisions:
  - "request_id attachment: extend requireAuth (not sibling middleware) — co-locates with req.user enrichment, single mental model for authenticated-request population, avoids one-line middleware file"
  - "classifyHttpError reads body for HTTP 400 to detect /access denied|permission/i (SPIKE.md finding) — trusts body only on 400 since 401/403 are unambiguous by status alone"
  - "emitAudit uses explicit key enumeration in JSON.stringify (not spread) to guarantee no extra fields can leak into the audit record"
  - "KineticaUpstreamError.message for 200+ERROR body never includes raw body.message — sanitized to 'Kinetica returned ERROR' to prevent upstream internals from reaching callers"
  - "console.error receives [kinetica] prefix + route + upstream detail; never includes Authorization header value or password"

# Metrics
duration: 5min
completed: 2026-04-28
---

# Phase 02 Plan 02: Helper Module + Typed Errors + Audit Log Summary

**Per-request kinetica helpers (kineticaSql, kineticaWms) with typed error classes, 400+access-denied KineticaPermissionError detection, audit log emitter, and 100 new unit tests; req.requestId plumbed through requireAuth**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-04-28T11:21:10Z (approx)
- **Completed:** 2026-04-28T11:26:10Z
- **Tasks:** 3 (TDD: typed errors, auth.ts extension, helper module + 3 spec files)
- **Files created:** 6, **modified:** 2

## Accomplishments

### Task 1: Typed error classes (kineticaErrors.ts)

Three typed error classes exported from `kineticaErrors.ts` (52 lines):
- `KineticaAuthError` — `status=401` (fixed), `upstreamStatus` from constructor
- `KineticaPermissionError` — `status=403` (fixed), `upstreamStatus` accepts 400 (Kinetica DDL-denial)
- `KineticaUpstreamError` — `status=502` (fixed), `upstreamStatus` optional (undefined for network throws)

Each uses `Object.setPrototypeOf(this, new.target.prototype)` to preserve instanceof chain in compiled TypeScript.

`kinetica.errors.spec.ts`: 31 tests covering instanceof, name, fixed status, upstreamStatus, message preservation, sanitization contract, cross-class distinguishability, and the explicit 400+access-denied case from the 02-01 spike.

### Task 2: req.requestId plumbing in auth.ts

- Added `import { randomUUID } from "node:crypto"` to auth.ts
- Extended `AuthedRequest` type with `requestId?: string`
- `requireAuth` Step 10 success path: `req.requestId = randomUUID()` set after `req.user` and before `touchSession`
- `auth.requireAuth.spec.ts`: extended Step 10 test with UUID regex assertion; added new test confirming two consecutive invocations produce distinct IDs
- Phase 1 regression: all 56 original tests still pass

### Task 3: kinetica.ts helper module + 3 spec files

`kinetica.ts` (301 lines) exports `kineticaSql` and `kineticaWms`:

**Error classification (`classifyHttpError`):**
- HTTP 401 → `KineticaAuthError(msg, 401)`
- HTTP 403 → `KineticaPermissionError(msg, 403)`
- HTTP 400 + `body.message` matches `/access denied|permission/i` → `KineticaPermissionError(msg, 400)`
- HTTP 400 + other body → `KineticaUpstreamError(msg, 400)`
- Any other non-OK → `KineticaUpstreamError(msg, status)`

**Audit log (`emitAudit`):**
Single-line JSON to `console.log`:
```json
{"ts":"...","request_id":"...","username":"alice","route":"POST /api/sql","op":"SQL","outcome":"success","status":200,"duration_ms":12}
```
Field set is exactly 8 keys — no extras possible (explicit key enumeration, not spread).
No SQL body, no WMS query string, no Authorization header.
Raw upstream detail → `console.error` only.

**Body-parse:** Reuses `index.ts:355-364` pattern (`body.data_str` → `json_encoded_response` → JSON.parse).

**Spec files (100 tests total across 4 files):**

| File | Tests | Coverage |
|------|-------|---------|
| `kinetica.errors.spec.ts` | 31 | instanceof, status, upstreamStatus, sanitization, cross-class |
| `kinetica.sql.spec.ts` | 32 | happy path, auth header, 401/403/400+access-denied/500/network/ERROR body, extra merge, sanitization |
| `kinetica.wms.spec.ts` | 15 | happy path, auth header, query string passthrough, 401/403/500/network |
| `kinetica.audit.spec.ts` | 22 | field set, outcome mapping 6 paths, no-SQL-leak, no-WMS-qs-leak, no-password-leak, console call counts |

## Task Commits

1. **Task 1: Typed error classes + tests** - `ae30f18`
2. **Task 2: req.requestId in requireAuth + tests** - `6da881b`
3. **Task 3: kinetica.ts helper + 3 spec files** - `57025d6`

## Test Count Delta vs Phase 1 Baseline

| Baseline | New (this plan) | Total |
|----------|----------------|-------|
| 56 (Phase 1) + 2 (Task 2 requestId) = 58 | 100 (Tasks 1+3 new specs) | **157** |

Phase 1's 56-test green baseline: preserved.

## Key Contracts Established for Plans 02-03 through 02-06

```typescript
// Import surface for call-site refactors:
import { kineticaSql, kineticaWms, type KineticaSqlOptions, type KineticaWmsOptions } from "./kinetica";
import { KineticaAuthError, KineticaPermissionError, KineticaUpstreamError } from "./kineticaErrors";

// Usage:
const data = await kineticaSql(req, sql, { route: "POST /api/sql", op: "SQL" });
const img = await kineticaWms(req, queryString, { route: "GET /api/wms" });
```

`req.requestId` is populated by `requireAuth` for every authenticated request.

## Deviations from Plan

None — plan executed exactly as written. The 400+access-denied rule was already incorporated into the frontmatter before execution began (per the orchestrator's pre-execution update from the 02-01 spike).

---

**Total deviations:** 0 auto-fixed
**Impact on plan:** Plan executed exactly as written.

## Self-Check

Files exist and exports verified at commit time. See acceptance criteria checks below.

## Self-Check: PASSED

- [x] `kineticaErrors.ts` exports 3 classes: `grep -E "^export class" kinetica_bi/server/src/kineticaErrors.ts | wc -l` → 3
- [x] `kinetica.ts` exports `kineticaSql` and `kineticaWms`: `grep -E "^export const" kinetica_bi/server/src/kinetica.ts | wc -l` → 2
- [x] `kinetica.ts` has zero KINETICA_USERNAME/PASSWORD refs: grep returns 0
- [x] `kinetica.ts` >= 120 lines: 301 lines
- [x] `kineticaErrors.ts` <= 80 lines: 52 lines
- [x] `auth.ts` contains `randomUUID`, `requestId`, and `req.requestId = randomUUID()`
- [x] All 4 spec files pass: `npx vitest run tests/kinetica.errors.spec.ts tests/kinetica.sql.spec.ts tests/kinetica.wms.spec.ts tests/kinetica.audit.spec.ts` → 100/100
- [x] Full suite: `npx vitest run` → 157/157 passed (0 failures)
- [x] Build clean: `npm run build` exits 0
- [x] `index.ts` untouched: `git diff --stat HEAD kinetica_bi/server/src/index.ts` → empty
- [x] Task 1 commit: `ae30f18`
- [x] Task 2 commit: `6da881b`
- [x] Task 3 commit: `57025d6`

---
*Phase: 02-per-user-credential-passthrough-on-every-kinetica-call*
*Completed: 2026-04-28*
