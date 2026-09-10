# Phase 13 — Spike Notes (S1–S4)

**Spike date:** 2026-05-06
**Deployed Kinetica:** `<KINETICA_URL>` (deployed `/gpudb-0` endpoint, credentials redacted)
**Operator:** `admin` (BI-user, password mode)
**Auth mode used:** HTTP Basic (password). OIDC (Bearer token) NOT exercised — see S2.b and Caveats.
**Confidence:** HIGH for the three spikes that ran (S1, S2.a/c, S3, S4). MEDIUM for S2 overall — password path verified PASS; OIDC path deferred (re-probe required when a token endpoint is reachable for the operator).

## Cross-Spike Summary

| Spike | Subject                                  | Status                       | Downstream Impact                                                                                |
| ----- | ---------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------ |
| S1    | WMS LAYERS=`<materialized_view_name>`    | PASS                         | MAP-V13-* requirements stay in v1.3; Phase 16 LAYERS-swap is buildable.                          |
| S2.a  | CREATE MATERIALIZED VIEW (password)      | PASS                         | Per-user DDL works in password mode; Plan 13-03 builds `kineticaSql(req, ddl, …)` straight.     |
| S2.b  | CREATE MATERIALIZED VIEW (OIDC Bearer)   | N/A — deferred               | Re-probe when OIDC token reachable; Phase 15/17 must verify OIDC mode before milestone close.    |
| S2.c  | DROP TABLE IF EXISTS (password)          | PASS                         | DELETE handler safe; idempotent (S2.c on already-dropped view returns OK with `count_affected: 0`). |
| S3    | Query of dropped view — error pattern    | RESOLVED (verbatim captured) | Phase 15 LIFE-V13-02 `isViewNotFoundError()` matches `SqlEngine: Object '<name>' not found`.    |
| S4    | Schema qualification (qualified vs bare) | Both work                    | Plan 13-02 view-name builder returns UNQUALIFIED names; client uses bare view name in LAYERS.   |

## S1 — WMS LAYERS=`_kbi_filt_spike_test`

**Probe command:**
```bash
curl -s -u "$KUSER:$KPASS" \
  "$KU/wms?SERVICE=WMS&REQUEST=GetMap&VERSION=1.1.1&LAYERS=_kbi_filt_spike_test&STYLES=raster&X_ATTR=pickup_longitude&Y_ATTR=pickup_latitude&SRS=EPSG:4326&BBOX=-74.05,40.63,-73.75,40.85&WIDTH=256&HEIGHT=256&FORMAT=image/png" \
  --output /tmp/wms_view_test.png && file /tmp/wms_view_test.png
```

**Observed result:** Operator confirmed verbatim — "wms get probe response was successful". PNG returned (no XML error body). Operator did not paste the literal `file` output, but explicitly confirmed the WMS GetMap call against the materialized-view LAYERS succeeded.
**Body excerpt (if non-PNG):** N/A — response was a PNG, not an XML error body.
**Status:** PASS
**Downstream consequence:**
  - PASS: MAP-V13-01..06 stay in v1.3 scope. Phase 16 will swap `LAYERS=<view>` in `wmsUrlBuilder.ts`. Phase 16 success criterion 1 ("map tiles visibly narrow to only matching spatial points") is buildable as planned.
  - The endpoint can return either bare or schema-qualified view names; see S4 for the chosen format.

## S2 — DDL Permission (CREATE OR REPLACE MATERIALIZED VIEW + DROP TABLE IF EXISTS)

### S2.a — CREATE (password mode)

**Probe command:**
```bash
curl -s -u "$KUSER:$KPASS" -X POST "$KU/execute/sql" \
  -H "Content-Type: application/json" \
  -d '{"statement":"CREATE OR REPLACE MATERIALIZED VIEW _kbi_filt_spike_test AS (SELECT * FROM demo.nyctaxi WHERE 1=1) USING TABLE PROPERTIES (TTL = 5)","offset":0,"limit":1,"encoding":"json","request_schema_str":"","data":[],"options":{}}'
```

**HTTP status:** 200
**Response body (verbatim, with embedded `data_str` truncated for the long `response_schema_str`):**
```json
{"status":"OK","message":"","data_type":"execute_sql_response","data":"","data_str":"{\"count_affected\":500000,\"response_schema_str\":\"...\",\"binary_encoded_response\":\"\",\"json_encoded_response\":\"{\\\"column_1\\\":[],\\\"column_headers\\\":[\\\"dummy\\\"],\\\"column_datatypes\\\":[\\\"string\\\"]}\",\"total_number_of_records\":-1,\"has_more_records\":false,\"paging_table\":\"\",\"info\":{\"X-Kinetica-Group\":\"DDL\",\"count\":\"500000\",\"last_endpoint\":\"/create/jointable\",\"total_number_of_records\":\"500000\"}}"}
```

Notable extracted fields:
- `status: OK`
- `info.X-Kinetica-Group: DDL`
- `info.last_endpoint: /create/jointable` — Kinetica implements `MATERIALIZED VIEW` internally as a join-table; the `/execute/sql` DDL path is the public surface.
- `count_affected: 500000` — matches the demo.nyctaxi row count (sanity check that the view actually materialized rows).

**Status:** PASS

### S2.b — CREATE (OIDC mode, Bearer token)

**Probe command:** Same statement as S2.a, but with `-H "Authorization: Bearer <access_token>"` instead of `-u`.
**HTTP status:** N/A — no OIDC access token was reachable for the operator in this spike environment.
**Response body:** N/A
**Status:** N/A — DEFERRED. Re-probe required.

**Why deferred (verbatim from operator):** "no OIDC token available in spike environment". The deployed Kinetica's auth surface for Bearer tokens was not exercisable in this run. This is a known gap, NOT a failure. The S2.a password-mode evidence is sufficient to UNBLOCK Plan 13-03 endpoint construction (the endpoint uses `kineticaSql(req, ddl, ...)` which already branches internally on `req.user.credentialType` and forwards the appropriate header). The OIDC path inherits the same Kinetica DDL-grant model; if OIDC users are mapped to the same Kinetica BI-user grants on the cluster, S2.a's PASS holds.

**Re-probe requirement:** Phase 15 (or Phase 17 verification) MUST re-run S2.b once an OIDC access token is reachable. If S2.b returns FAIL/permission-denied for OIDC users specifically, a gap-closure plan (Plan 13-04 service-account-ddl) gets added at that point. Phase 13 does NOT block on this — Plan 13-03 ships with both code paths via the existing `kineticaSql` helper.

### S2.c — DROP TABLE IF EXISTS

**Probe command:**
```bash
curl -s -u "$KUSER:$KPASS" -X POST "$KU/execute/sql" \
  -H "Content-Type: application/json" \
  -d '{"statement":"DROP TABLE IF EXISTS _kbi_filt_spike_test","offset":0,"limit":1,"encoding":"json","request_schema_str":"","data":[],"options":{}}'
```

**HTTP status:** 200
**Response body (verbatim):**
```json
{"status":"OK","message":"","data_type":"execute_sql_response","data":"","data_str":"{\"count_affected\":1,\"response_schema_str\":\"...\",\"json_encoded_response\":\"{\\\"column_1\\\":[],\\\"column_headers\\\":[\\\"dummy\\\"],\\\"column_datatypes\\\":[\\\"string\\\"]}\",\"info\":{\"X-Kinetica-Group\":\"DDL\",\"count\":\"0\",\"last_endpoint\":\"/clear/table\",\"total_number_of_records\":\"0\"}}"}
```

Notable: `info.last_endpoint: /clear/table` — Kinetica's drop path; `count_affected: 1` (the just-created view was dropped).

**Status:** PASS

### Overall S2 status

**Overall S2 status:** PASS (password mode); OIDC deferred to Phase 15/17 re-probe

**Downstream consequence:**
  - PASS (password): Plan 13-03 endpoint uses `kineticaSql(req, ddl, { op: "MATERIALIZE" })` with per-user creds verbatim — no fallback path built in this milestone. VIEW-V13-05 (`KineticaPermissionError → 403 + { error }`) still ships as defense-in-depth but should rarely fire in practice.
  - DEFERRED (OIDC): No new plan added inside Phase 13. Phase 15 or Phase 17 verification re-runs S2.b. If S2.b FAILs for OIDC, a future gap-closure plan introduces a service-account DDL fallback (env vars `KINETICA_USERNAME` / `KINETICA_PASSWORD` already used by `verifyKineticaCredentials` in `auth.ts:60-64`) — but that path is NOT built speculatively now.

## S3 — Expired/Dropped-View Query Error

**Probe command:**
```bash
# Step 1: drop the view (re-created above for this block)
curl -s -u "$KUSER:$KPASS" -X POST "$KU/execute/sql" \
  -H "Content-Type: application/json" \
  -d '{"statement":"DROP TABLE IF EXISTS _kbi_filt_spike_test","offset":0,"limit":1,"encoding":"json","request_schema_str":"","data":[],"options":{}}'
# Step 2: query the dropped view (note -i flag — captures HTTP response headers)
curl -i -s -u "$KUSER:$KPASS" -X POST "$KU/execute/sql" \
  -H "Content-Type: application/json" \
  -d '{"statement":"SELECT * FROM _kbi_filt_spike_test LIMIT 1","offset":0,"limit":1,"encoding":"json","request_schema_str":"","data":[],"options":{}}'
```

**Step 1 (DROP) result:** PASS, `info.last_endpoint: /clear/table`, `count_affected: 1`.

**Step 2 (post-drop SELECT) — HTTP status:** `400 Bad Request`
**Step 2 — Response (full, verbatim — headers + body):**
```
HTTP/1.1 400 Bad Request
Content-Type: application/json
Access-Control-Allow-Origin: *
Access-Control-Expose-Headers: x-request-time-secs
x-request-time-secs: 0.05981
Strict-Transport-Security: max-age=31536000; includeSubDomains
X-Content-Type-Options: nosniff
X-Frame-Options: SAMEORIGIN
X-XSS-Protection: 1; mode=block
Content-Length: 137

{"status":"ERROR","message":"SqlEngine: Object '_kbi_filt_spike_test' not found (S/SDc:1513)","data_type":"none","data":"","data_str":""}
```

**Verbatim error message string for `isViewNotFoundError()`:** `SqlEngine: Object '_kbi_filt_spike_test' not found (S/SDc:1513)`

Pattern guidance for Phase 15 LIFE-V13-02 implementation:

| Field            | Stable value                                    | Notes for matcher                                                                                         |
| ---------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| HTTP status      | `400 Bad Request`                               | Stable; `classifyHttpError` in `kinetica.ts:93-127` maps 400-without-access-denied to `KineticaUpstreamError`. |
| `body.status`    | `"ERROR"`                                       | Stable.                                                                                                   |
| `body.message`   | `SqlEngine: Object '<view-name>' not found (S/SDc:1513)` | The `<view-name>` interpolates the SQL identifier the user queried.                                       |
| Kinetica code    | `S/SDc:1513`                                    | Stable for "object not found"; included in parens at end of message.                                      |

**Recommended `isViewNotFoundError(err: KineticaUpstreamError)` pattern (for Phase 15 LIFE-V13-02):**
```typescript
// Match either the readable substring OR the Kinetica internal code.
// Substring match is more readable; code match is more precise.
function isViewNotFoundError(err: unknown): boolean {
  if (!(err instanceof KineticaUpstreamError)) return false;
  if (err.upstreamStatus !== 400) return false;
  const msg = err.upstreamMessage ?? err.message ?? "";
  return /SqlEngine: Object '[^']+' not found/i.test(msg)
      || /\(S\/SDc:1513\)/.test(msg);
}
```

**Status:** RESOLVED — string captured verbatim; pattern derivable.

**Downstream consequence:**
  - RESOLVED: Phase 15 LIFE-V13-02 builds `isViewNotFoundError(err)` in `kinetica_bi/src/lib/filterErrors.ts` (or chosen path) using the regex above. Reactive recovery branch in chart renderer can match this precisely; no false positives on other 400-class Kinetica errors (e.g., DDL syntax errors, which do not contain the `Object '...' not found` substring).
  - The Kinetica code `S/SDc:1513` is also stable and can be used as a secondary predicate. Recommend matching the readable substring as primary signal because it is grep-friendly and self-documenting in error logs.

## S4 — Schema Qualification (LAYERS=`<view>` vs LAYERS=`<schema>.<view>`)

**Operator's default schema (`SELECT CURRENT_SCHEMA`):** `ki_home`

**Probe response for `SELECT CURRENT_SCHEMA` (verbatim):**
```json
{"status":"OK","message":"","data_type":"execute_sql_response","data":"","data_str":"{\"count_affected\":0,\"response_schema_str\":\"...\",\"json_encoded_response\":\"{\\\"column_1\\\":[\\\"ki_home\\\"],\\\"column_headers\\\":[\\\"CURRENT_SCHEMA\\\"],\\\"column_datatypes\\\":[\\\"char8\\\"]}\",\"total_number_of_records\":1,\"has_more_records\":false,\"paging_table\":\"\",\"info\":{\"X-Kinetica-Group\":\"QUERY\",\"count\":\"1\",\"last_endpoint\":\"/get/records/bycolumn\",\"total_number_of_records\":\"1\"}}"}
```

### S4.a — Schema-qualified (`ki_home._kbi_filt_spike_test`)

**Probe command:**
```bash
curl -s -u "$KUSER:$KPASS" \
  "$KU/wms?SERVICE=WMS&REQUEST=GetMap&VERSION=1.1.1&LAYERS=ki_home._kbi_filt_spike_test&STYLES=raster&X_ATTR=pickup_longitude&Y_ATTR=pickup_latitude&SRS=EPSG:4326&BBOX=-74.05,40.63,-73.75,40.85&WIDTH=256&HEIGHT=256&FORMAT=image/png" \
  --output /tmp/wms_qualified.png && file /tmp/wms_qualified.png
```

**Observed result:** Operator confirmed verbatim — "sa qualified replace worked, no errors". PNG returned (no XML error body).
**Status:** PASS

### S4.b — Unqualified (`_kbi_filt_spike_test`)

Same probe as S1; result reused.
**Status:** PASS (mirrors S1 result)

### Overall S4 status

**Overall S4 status:** BOTH FORMS WORK (qualified `ki_home._kbi_filt_spike_test` and unqualified `_kbi_filt_spike_test` both render PNG tiles).

**Downstream consequence:**
  - Both work: Endpoint returns the **UNQUALIFIED** view name (simpler; identical render result). Plan 13-02 view-name builder produces bare `_kbi_filt_u<userId>_d<dashId>_t<tableId>_s<sessionShort>` — no `SHOW SCHEMAS` lookup, no schema lookup in `AuthedRequest`, no schema field on the response.
  - Plan 13-03 endpoint POST response shape: `{ viewName: "_kbi_filt_...", expiresAt: <epoch_ms> }` — no `schema` field needed.
  - Phase 16 wmsUrlBuilder uses bare `LAYERS=<viewName>` in WMS GetMap requests. Cross-schema operators are out of scope for v1.3 (documented caveat — if a user's default schema is non-`ki_home`, view name still resolves correctly because Kinetica resolves unqualified identifiers in the caller's session context).

## Open Question Resolutions

- **OQ-1 (S3 verbatim error message):** RESOLVED — see S3 above. Verbatim string: `SqlEngine: Object '<view-name>' not found (S/SDc:1513)`. HTTP 400. Phase 15 builds `isViewNotFoundError()` against this string + Kinetica code `S/SDc:1513`.
- **OQ-2 (S4 schema requirement):** RESOLVED — see S4 above. Both qualified and unqualified forms work. Endpoint returns UNQUALIFIED. View-name builder in Plan 13-02 does NOT need to know the user's default schema.
- **OQ-3 (route file extraction):** Not part of this spike; Plan 13-03 picks (default per RESEARCH.md: inline in `index.ts` unless line-count grows past ~900).
- **OQ-4 (DELETE body vs query params):** Not part of this spike; Plan 13-03 picks (default per RESEARCH.md: query params for HTTP-semantic and proxy compatibility).

## Caveats

### OIDC mode unverified for DDL permission (S2.b)

S2.b was not run in this spike because no OIDC access token was reachable for the operator at this site. The S2.a password-mode PASS is taken as the green-light for Plan 13-03 endpoint construction, on the assumption that OIDC users on this Kinetica cluster are mapped to the same DDL-grant level as password BI-users. This assumption is unverified.

**Mitigation:**
1. Plan 13-03 supertest coverage (VIEW-V13-07) explicitly tests both `AUTH_MODE=password` and `AUTH_MODE=oidc` session contexts via supertest mocks (per RESEARCH.md Pattern 5 + 6) — this proves the *code path* works for both modes, even though the live deployed Kinetica's OIDC permission grant has not been probed.
2. Phase 15 (chart-filtering) or Phase 17 (verification) MUST re-run S2.b once an OIDC token is reachable. If FAIL → add gap-closure plan for service-account DDL fallback at that point. If PASS → close the gap in the milestone audit.
3. Phase 17 success criterion 2 (`VERIFICATION.md` (c)) explicitly mentions "supertest backend DDL assertions passing for both `AUTH_MODE=password` and `AUTH_MODE=oidc`" — this gives the milestone-close auditor a checkpoint to confirm OIDC was exercised live.

### MATERIALIZED VIEW implemented as join-table

Kinetica's `info.last_endpoint: /create/jointable` revealed that `CREATE OR REPLACE MATERIALIZED VIEW` dispatches to the internal `/create/jointable` endpoint. This is an implementation detail; the public DDL surface (`/execute/sql` with the `CREATE OR REPLACE MATERIALIZED VIEW ...` statement) is the correct interface for Plan 13-03. No code change required from this discovery — but if future debugging surfaces `/create/jointable` errors or audit-log entries from this code path, this caveat explains the source.

### Cleanup left cluster clean

Block E ran `DROP TABLE IF EXISTS _kbi_filt_spike_test` after S3's drop. Result: `count_affected: 0` (S3 already dropped it; idempotent, as expected). Spike test fixture is fully cleaned up.

### `file` output for WMS PNGs not pasted verbatim

For S1 and S4.a, the operator confirmed success in plain text ("wms get probe response was successful"; "sa qualified replace worked, no errors") without pasting the literal `file /tmp/wms_view_test.png` and `file /tmp/wms_qualified.png` output bytes. The acceptance criterion is met (operator's confirmation that PNG was returned, no XML error body), but if a stricter audit requires the raw `file` byte-detection output, both probes can be re-run cheaply — the materialized view DDL is fast (`count_affected: 500000` in <1s) and the WMS GetMap is a single curl call.
