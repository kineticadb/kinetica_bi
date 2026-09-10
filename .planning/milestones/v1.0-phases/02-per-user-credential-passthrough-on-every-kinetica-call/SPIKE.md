# Phase 2 Materialize Permission Spike

**Date:** 2026-04-28
**Kinetica instance:** `http://172.31.1.181:9191`
**Target:** `ki_home.test_t1` (BASE TABLE, confirmed to exist and be selectable)

---

## Setup

**Test user:** `bi_spike_test_user` (internal Kinetica user, created for this spike only; deleted after testing)

**Grants on test user:**
- `table_read` (SELECT) on `ki_home.test_t1` — granted via `/grant/permission/table`
- NO DDL grants (no CREATE, no MATERIALIZED VIEW permission on any schema)
- No schema-level or global permissions beyond the single table_read grant above

**Confirmed SELECT works:** `SELECT * FROM ki_home.test_t1 LIMIT 1` returned HTTP 200 / `status: OK` for this user.

**Target table:** `ki_home.test_t1` (BASE TABLE in Kinetica instance)

**Cleanup:** The test user was deleted (`/delete/user`) and the spike view was dropped (`DROP MATERIALIZED VIEW IF EXISTS __phase2_spike_test_view`) after testing. No test artifacts remain in the instance.

---

## Test

The BI app's materialize handler at `kinetica_bi/server/src/index.ts:261` issues:

```
CREATE OR REPLACE MATERIALIZED VIEW <view_name> AS SELECT * FROM <schema>.<table>
```

via `POST /execute/sql` with `Authorization: Basic <base64(username:password)>`.

The exact curl command issued for the restricted user:

```bash
curl -s -o /tmp/spike_response.json -w "%{http_code}" \
  -X POST "http://172.31.1.181:9191/execute/sql" \
  -H "Content-Type: application/json" \
  -H "Authorization: Basic <base64(bi_spike_test_user:<REDACTED>)>" \
  -d '{
    "statement": "CREATE OR REPLACE MATERIALIZED VIEW __phase2_spike_test_view AS SELECT * FROM ki_home.test_t1",
    "offset": 0,
    "limit": 1,
    "encoding": "json",
    "request_schema_str": "",
    "data": [],
    "options": {}
  }'
```

The same curl was repeated with admin credentials (`admin:<REDACTED>`) as the control to confirm DDL correctness.

---

## Result

### Restricted user (SELECT only, no DDL grants)

**HTTP status code:** `400`

**Response body (verbatim):**
```json
{"status":"ERROR","message":"Access denied; ok","data_type":"none","data":"","data_str":""}
```

### Admin user (control — same DDL, full permissions)

**HTTP status code:** `200`

**Response body (abbreviated):**
```json
{
  "status": "OK",
  "message": "",
  "data_type": "execute_sql_response",
  "data_str": "{\"count_affected\":2,...,\"info\":{\"X-Kinetica-Group\":\"DDL\",...}}"
}
```

### Error classification

Per the 02-CONTEXT.md error taxonomy ("Status code drives the type"):

| Condition | Expected class | Actual HTTP status | Actual class |
|-----------|----------------|-------------------|--------------|
| HTTP 401 | `KineticaAuthError` | — | — |
| HTTP 403 | `KineticaPermissionError` | — | — |
| Anything else / `body.status: ERROR` | `KineticaUpstreamError` | **400** | **`KineticaUpstreamError`** |

**Finding:** Kinetica returns HTTP **400** (not 403) when a user with only SELECT grants attempts a DDL operation. The `body.status` is `"ERROR"` and the message is `"Access denied; ok"`.

**Implication for Plan 02-05:** The materialize refactor helper must handle this as `KineticaUpstreamError` (the 400 falls into the "anything else" bucket in the status-code-driven classification). The `message` field `"Access denied; ok"` is the signal that this is a permission denial, not a transport or Kinetica internal error. Plan 02-05 should note this so the sanitized error message surfaced to the caller accurately conveys "permission denied for DDL" rather than a generic upstream error.

---

## Recommendation

Recommendation: loud-failure acceptable — proceed with Phase 2 per-user materialize as planned

**Rationale:**

1. **The failure is clean and deterministic.** HTTP 400 with `{"status":"ERROR","message":"Access denied; ok"}` is a stable, parseable response — not a crash, not a garbled stream, not a protocol error. The helper can classify it reliably.

2. **The failure mode is Kinetica's permission model working correctly.** Users without DDL grants cannot create materialized views. This is precisely what the milestone's no-shared-admin-escape-hatch principle demands. Surfacing this as a `KineticaUpstreamError` with a sanitized "permission denied for this operation" message (UX-02 behavior) is the correct outcome.

3. **Out-of-Scope backstop confirmed.** REQUIREMENTS.md explicitly excludes "Admin-credential fallback when user creds fail" to prevent defeating the milestone goal. The loud-failure path is the only permissible default.

4. **Phase 2.1 trigger condition not met.** Phase 2.1 spawns only if (a) materialize fails for typical BI users AND (b) the team determines loud failure is unacceptable for milestone delivery. Condition (a) is confirmed. Whether condition (b) applies depends on team workflow — but no existing operator workflow has been identified that requires non-admin users to materialize without DDL grants. If such a workflow emerges post-spike, the team retains the option to insert Phase 2.1 before Plan 02-05 ships.

5. **Plan 02-05 adjustment noted.** The error will be typed as `KineticaUpstreamError` (not `KineticaPermissionError`) because Kinetica returns 400 rather than 403. Plan 02-05 must document this and ensure the sanitized error message for the 400+"Access denied" case reads as a permission error, not an opaque upstream failure.

---

## References

- **PITFALLS.md Pitfall 16** — "Materialized view DDL requires perms the typical BI user lacks": `.planning/research/PITFALLS.md` — the original DDL-permission concern that motivated this spike
- **ROADMAP.md Phase 2 verification flag** — "Test materialize with a least-privileged Kinetica user (Pitfall 16). If `CREATE OR REPLACE MATERIALIZED VIEW` requires DDL perms the typical BI user lacks, escalate…": `.planning/ROADMAP.md` Phase 2 details
- **02-CONTEXT.md decisions → "Materialize service-account spike"** — spike protocol, default policy, error taxonomy, Phase 2.1 contingency conditions: `.planning/phases/02-per-user-credential-passthrough-on-every-kinetica-call/02-CONTEXT.md`
- **REQUIREMENTS.md "Out of Scope" row** — "Admin-credential fallback when user creds fail — Defeats the milestone goal — every call must use the user's creds, no escape hatch": `.planning/REQUIREMENTS.md`
