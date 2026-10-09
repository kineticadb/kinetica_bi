# Phase 133 Spike Decision Record

**How to read:** one section per spike in the D-15 template. S2 and S3 were run autonomously in plan 133-07. S1 and S7 were run live by the operator as a non-admin user in plan 133-08. All spikes must be reviewed at the D-15 checkpoint before Phases 134/135.

---

## S1 — Session-only dynamic views

**Question:** Can an AI-proposed dynamic view be materialized and used (count, filter view over it, WMS tile, TTL expiry, drop) as the non-admin user WITHOUT a `dashboard_dynamic_views` row?

**Method:** (1) Code half: `createOrReplaceMaterialized` (`lib/materializedView.ts`) takes `{req, view, sqlBody, ttl, route, op}` with no row dependency; the route-level blockers are `POST /api/dynamic-view/materialize` (loads the dv row, names from `row.id`), the dv branch of `/api/filter/materialize` (requires `dvRow`) and `buildFilterViewName` (requires `tableId` or `dynamicViewId`). Sketch: ad-hoc branch taking a server-held structured spec, a session-bound name `_kbi_ai_u<user>_s<sid8>_<n>`, prefix-validated `adHocViewName`. (2) Operator live half (`src/spikes/adhocDvSpike.ts`, plan 133-08) as the non-admin user: create ad-hoc view, `SELECT COUNT(*)`, filter view over it, WMS tile against filter view, wait past TTL (sliding?), `DROP TABLE IF EXISTS`.

**Result:** ALL PASS. Live run 2026-10-09 by the operator as `uat_analyst` (confirmed NON-ADMIN, D-12) against http://172.31.0.22:8082/gpudb-0, source `demo.nyctaxi`, `adhocDvSpike.ts --wait-ttl`:

```
S1.1 create ad-hoc view: PASS
S1.2 count ad-hoc view: PASS - n=1000
S1.3 view-of-view filter: PASS - n=464
S1.4 WMS GetMap: PASS - HTTP 200 content-type=image/png bytes=1367
S1.5a LIMIT 0 column_headers: PASS - headers=["vendor_id","pickup_datetime","dropoff_datetime","passenger_count","trip_distance"]...
S1.5b LIMIT 1 column_headers: PASS
S1.5c INFORMATION_SCHEMA.COLUMNS: PASS - rows=20 keys=["column_1","column_headers","column_datatypes"]
S1.6 TTL reaped: PASS - gone: HTTP 400 SqlEngine: Object '_kbi_spike_zq3snq_dv' not found (TTL = 1 min, waited 150 s)
S1.7 drop spike views: PASS
```

**Decision:** (D-13) S1.1 + S1.3 + S1.4 all PASS, so the **ad-hoc inline path (ARCHITECTURE option B)** is viable for a non-admin user. NO Keep-only fallback; AIACT-V20-07 is unchanged (no rewording). TTL behaviour (S1.6): view was reaped after its 1 min TTL (observed gone within 150 s); sliding vs fixed expiry was not distinguished. Phase 139 input: still call DROP on session end, TTL is the safety net.

**Fallback:** Not triggered. (Would have been: AI dvs materialize only on Keep; Phase 139 shrinks.)

**Consequence for later phases:** Phase 139 may build the ad-hoc materialize branch with a session-bound prefix-validated name and no `dashboard_dynamic_views` row. Phase 139 should keep a per-session view cap (see S7: grants do not constrain the user).

**Confidence:** HIGH (measured live as non-admin). Sliding-vs-fixed TTL untested.

### S1 → Dv column source decision

`LIMIT 0`. Exact SQL for plan 133-09: `SELECT * FROM <view> LIMIT 0`, read `column_headers` (returned all 5 expected names on S1.5a). `LIMIT 1` and `INFORMATION_SCHEMA.COLUMNS` also work as fallbacks (the latter returns keys `column_1`, `column_headers`, `column_datatypes`, i.e. not a plain COLUMN_NAME shape).

---

## S2 — Streaming (POST + SSE) on :4000

**Question:** Does a POST whose response is `text/event-stream`, read by a fetch ReadableStream client, stream incrementally through the real Express middleware stack, and how do cookie auth, the 1 MB body limit, client abort and mid-stream session revocation behave?

**Method:** `packages/server/src/spikes/sseSpike.ts` boots a tiny Express app using `express.json({limit:"1mb"})`, `cookieParser()`, the real `requireAuth`, and a JSON 413 handler mirroring errorMiddleware; `POST /spike/stream` sets `Content-Type: text/event-stream`, `Cache-Control: no-cache, no-transform`, `X-Accel-Buffering: no`, calls `res.flushHeaders()`, writes a `: ping` comment and 3 `data:` events 500 ms apart. Node `fetch` + `response.body.getReader()` client on an ephemeral port (not :4000 itself, same middleware). No Kinetica/provider calls. Re-run: `cd packages/server && DB_PATH=:memory: SESSION_ENCRYPTION_KEY=<64 hex> AUTH_SECRET=<16+ chars> KINETICA_URL=https://kinetica.test:9191 npx tsx src/spikes/sseSpike.ts`.

**Result:** all checks PASS (run 2026-10-09, ms since script start / request):

| Check | Outcome |
|---|---|
| C1 incremental delivery | PASS. Data events received at 505 / 1005 / 1505 ms after request (gaps 500, 500), not batched at the end |
| C2 cookie auth on POST | PASS. No cookie: 401 `{"error":"Authentication required.","code":"REAUTH_REQUIRED"}` (74 ms). With cookie: 200 `text/event-stream`, `x-accel-buffering: no` (92 ms) |
| C3 >1 MB body | PASS. 413 `application/json` `{"error":"Payload too large","code":"PAYLOAD_TOO_LARGE"}` before any stream header (87 ms) |
| C4 client abort | PASS. `AbortController.abort()` after event 1; server `res.on("close")` fired 5 ms later |
| C5 session revoked mid-stream | Stream CONTINUED: 6/6 events delivered after `deleteSession` at event 2 (requireAuth runs only at request start). A new POST afterwards is 401 (C5b) |
| C6 heartbeat | PASS. `: ping\n\n` arrived as an intact chunk at 5 ms |

Verbatim DECISION-RECORD excerpt:
```
C1: PASS — data event receive times(ms since request)=[505,1005,1505] gaps=[500,500]
C4: PASS — client abort -> server res 'close' observed after 5ms
C5: PASS — session deleted after event 2; stream delivered 6/6 events (continues=true)
```

**nginx finding (D-11, recorded from `docker/nginx.conf`, verification deferred to Phase 137):** `gzip on` with `gzip_types text/css application/javascript application/json image/svg+xml` and a `location /api/` block with no buffering directives. `text/event-stream` is not in `gzip_types`, so gzip is not today's blocker; `proxy_buffering` (default on) is. The deploy stream location needs `proxy_buffering off; proxy_cache off; proxy_read_timeout 300s; gzip off; proxy_http_version 1.1; proxy_set_header Connection "";` and the response keeps `X-Accel-Buffering: no`. Not tested through :8080 here.

**Decision:** Use SSE over POST, read client-side with fetch ReadableStream (not EventSource, which cannot POST). Send a `: ping` heartbeat (~15 s) for idle proxies. Because a stream outlives its session (C5), cap stream duration at `AI_TIMEOUT_MS` and re-check the session (`getSession(sid)`) before each emitted op.

**Fallback:** NDJSON over POST or job polling (export-job precedent) if the deployed proxy path cannot be made to stream.

**Consequence for later phases:** Phase 137 builds the streaming endpoint with the headers above, abort handling via `res.on("close")` (not `req.on("close")`), per-op session re-check, and must verify through nginx on :8080 and add the nginx stream-location directives. AIPRV-V20-01: `AI_TIMEOUT_MS` bounds the whole stream; client abort is observable server-side promptly so provider calls can be cancelled.

**Confidence:** HIGH for Express behaviour (measured); MEDIUM for the nginx path (not exercised).

---

## S3 — Per-widget-type validators

**Question:** Can per-type zod validators be derived from the chart registry (`fields[]` + `defaultConfig`) for all 16 widget types?

**Method:** `packages/web/src/spikes/s3Validators.spike.spec.ts` (skipped unless `RUN_SPIKES=1`; `S3_REPORT_PATH=<file>` also writes the JSON since vitest setup swallows console). `registerAllChartTypes()`, then per `getAllChartTypes()` entry derive a zod object from `fields[]` (text/textarea/color -> string, number/range -> number with min/max, boolean, select -> enum of option values, formatSpec/colorRules -> unknown), `.passthrough()`. Scored: fields count, defaultConfig keys not covered by a field, binding keys outside fields, accepts defaultConfig, rejects a tampered copy, addable, custom panel, customWhere / color. Not done: validation against real saved `widgets.config` rows.

**Result:** derive-for-all: FAIL. 8 of 16 types have `fields: []` (config lives in a CustomConfigPanel).

| type | fields | defaultConfig keys not in fields | binding keys outside fields | accepts default | rejects tampered | addable | custom panel | customWhere | color fields |
|---|---|---|---|---|---|---|---|---|---|
| bar | 15 | groupByColumns | groupByColumns | yes | yes | yes | no | yes | color |
| line | 10 | groupByColumns | groupByColumns | yes | yes | yes | no | yes | color |
| pie | 12 | none | none | yes | yes | yes | no | yes | color1-color6 |
| scatter | 8 | none | none | yes | yes | NO | no | yes | color |
| table | 4 | groupByColumns | groupByColumns | yes | n/a (no number/select) | yes | no | yes | barColor |
| bignumber | 11 | none | none | yes | yes | yes | no | yes | color |
| heatmap | 15 | limit, groupByColumns | groupByColumns | yes | yes | yes (as measured) | no | yes | none |
| map | 0 | title, basemapLight, basemapDark | none | yes | n/a | yes | yes | no | none |
| records | 9 | none | none | yes | yes | yes | no | yes | none |
| info-card | 0 | none | none | yes | n/a | yes | no | no | none |
| legend | 0 | none | none | yes | n/a | yes | yes | no | none |
| datafilter | 0 | filterFields | none | yes | n/a | yes | yes | no | none |
| timeline | 0 | timeCol, metrics, maxIntervals, showLegend, showTooltip, vertical, colorTheme, dateFormatOverride | none | yes | n/a | yes | yes | no | none |
| numericline | 0 | xField, metrics, maxBuckets, showLegend, showTooltip, vertical, colorTheme | none | yes | n/a | yes | yes | no | none |
| radiogroup | 0 | orientation, options | none | yes | n/a | yes | yes | no | none |
| calendar | 0 | timeCol, metricColumn, aggregation, domain, subdomain, colorTheme, layoutMode, showDomainSubdomainControls, controlMode, smartScale, allowedSmartScales | aggregation | yes | n/a | yes | yes | no | none |

Notes: "accepts default" is trivially true for `fields: []` types because the derived schema is empty passthrough, so it proves nothing for them. Binding keys (`metric`, `aggregation`, `dimension`, `tableId`) are not in `defaultConfig` for the generic types; they are written by ChartConfigPanel's generic data-binding section, outside `fields[]`. Heatmap measured `addable` true here although research expected false; the AI subset excludes it regardless.

**Decision:** (D-14) derive-for-all: FAIL. Named v2.0 AI widget-type subset: **bar, line, pie, table, bignumber, records** (generic-field types whose validators derive cleanly, plus a small hand-written binding-key table covering `groupByColumns`, metric, aggregation, dimension). `map` is flagged separately: it is the main AI target but its config is custom (fields empty), so it would need a hand-written validator if Phase 136 requires it. The subset is for the operator to approve at the 133-10 checkpoint. scatter, heatmap and the 7 other custom-panel types are out of the AI subset.

**Fallback:** hand-written validators for any additional type (map first), using the same catalogue shape.

**Consequence for later phases:** `packages/shared` cannot import the registry (React/web-only), so Phase 136 ships a hand-maintained or generated type catalogue in packages/shared plus a web-side drift test that regenerates from the registry and compares. `customWhere` is AI-blocked (raw SQL predicate); `color` fields are theme-token only for AI ops.

**Confidence:** MEDIUM-HIGH (registry measured; real saved configs not sampled).

---

## S7 — Kinetica capabilities as the non-admin user

**Question:** What can the non-admin Kinetica user do: create materialized views, enforce a statement timeout, enforce read-only by grants, and run EXPLAIN for cost preflight?

**Method:** Operator-run `src/spikes/kineticaCapsSpike.ts` (plan 133-08), non-destructive, own `_kbi_spike_*` objects only: (1) `CREATE OR REPLACE MATERIALIZED VIEW _kbi_spike_<rand> ... TTL = 2` in default schema and with `current_schema`, recording exact denial text; (2) statement timeout: `/execute/sql` options list has no per-statement timeout; run a slow query with and without client AbortSignal and see if the server keeps executing; (3) attempt DELETE / INSERT / DROP TABLE / ALTER / CREATE TABLE and record which are denied by grants alone; (4) does `EXPLAIN <select>` work and return a usable row estimate.

**Result:** run 2026-10-09 as `uat_analyst` (NON-ADMIN), same instance. Run 1 used the original harness; the final run used `--skip-slow` after harness edits (see 133-08-SUMMARY).

Run 1 (original harness, killed by operator): S7.1a create view PASS; S7.2 baseline `SELECT 1` 49 ms; S7.2a slow query FAIL (elapsed 300652 ms, `fetch failed`, unbounded self-join too heavy); S7.2b client abort after 2 s returned in 2002 ms (AbortError), `SELECT 1` afterwards 68 ms. GAdmin Running Jobs showed the `uat_analyst` `SELECT COUNT(*) FROM demo.nyctaxi a, demo.nyctaxi b` jobs still "dispatched" (elapsed 198-501 s) after the abort AND after the script was killed. Operator: "Cancelling a query does not stop the request in Kinetica. You have to explicitly kill the job." S7.2c (`options.timeout`) was NOT tested; assume no server-side timeout.

Final run (`--skip-slow`):
```
S7.1a create view (default schema): PASS
S7.1b create view (current_schema): SKIPPED - SPIKE_SCHEMA unset
S7.2 abort/timeout: SKIPPED (answered by run 1 + operator)
S7.3a CREATE TABLE scratch: PASS
S7.3b DELETE source (WHERE 1 = 0): DENIED - HTTP 400 SqlEngine: Sub-queries are not allowed in DELETE statement  (engine/syntax refusal, NOT a grant denial -> inconclusive)
S7.3c INSERT source (WHERE 1 = 0): PASS - ALLOWED by grants (0 rows inserted)
S7.3d ALTER: SKIPPED
S7.4 EXPLAIN: PASS - plan rows (ID, ENDPOINT, INPUT_TABLES, OUTPUT_TABLE, DEPENDENCIES); no cost/row estimate
S7.5 as-given vendor_id: PASS ["vendor_id"]; UPPER unquoted: PASS ["VENDOR_ID"]; UPPER quoted "VENDOR_ID": PASS ["VENDOR_ID"]
S7.6a list jobs while query runs: PASS - still running after 570 ms; max own jobs visible=1; sample=82616:uat_analyst:/* kbi-spike-3kittv */ SELECT COUNT(*) ...
S7.6b find tagged job: PASS - job_id=82616 via field "query_text" after 570 ms
S7.6c cancel own job (/admin/alter/jobs): PASS - {"job_ids":[82616],"action":"cancel","status":["Job marked for cancellation."],"info":{}}
S7.6d job gone after cancel: PASS - not listed
S7.cleanup: PASS
```
Not exercised: S7.1b (non-default schema), S7.2c (`options.timeout`), S7.3d (ALTER), a genuine grant-based DELETE denial.

**Decision:**
- Create materialized views as non-admin: works in the default schema (S7.1a). Non-default schema untested.
- Read-only by grants: NO. The user can CREATE TABLE and INSERT into the source, so Phase 140's guarded SELECT must be FULLY app-side (statement allow-list + row cap + per-session view cap), not reliant on a read-only Kinetica role. The DELETE refusal was an engine syntax error, not evidence of a grant.
- Server-side timeout: none found. Client abort does NOT stop the Kinetica job (Operator-verified; jobs keep running after abort and after the client process dies). A client AbortSignal only frees the app side.
- EXPLAIN: works but gives no cost or row estimate, so it is NOT usable as a cost preflight for 139/140. Use row cap and LIMIT wrapping instead.
- **Job-cancel decision (operator design, verified S7.6):** every AI/app cancel path that runs Kinetica SQL must tag the statement with a unique comment (e.g. `/* kbi:<user>:<request-id> */`), find it in `/admin/show/jobs` via `query_text`, and cancel via `/admin/alter/jobs {job_ids, action:"cancel"}`. A non-admin can do this for its own jobs.

**Fallback:** App-side guard + row cap + per-session view cap + client abort (from research summary), plus tag/find/cancel for real cancellation.

**Consequence for later phases:**
- Phase 137 (AIWID-V20-04 cancel) and Phase 140 (query tool) MUST use the tag -> find -> cancel path; abort alone leaves the job running on the GPU cluster.
- Phase 140 SQL guard is fully app-side; no reliance on grants.
- Phases 139/140 cannot use EXPLAIN as a cost gate.
- **NEW TECH DEBT (for the 133-10 checkpoint, not fixed here):** v1.26 export cancel (`cancelExport` in `packages/server/src/lib/exportRunner.ts:272`) only calls `ac.abort()`, so it likely leaves Kinetica jobs running after a user cancels an export. Needs the same tag/find/cancel treatment.

**Confidence:** HIGH for cancel mechanics, EXPLAIN, INSERT-allowed, and case folding (measured); MEDIUM for timeout absence (`options.timeout` untested).

### S7 → Column-name case folding

Kinetica column resolution is case-INSENSITIVE even when quoted (as-given `vendor_id`, unquoted `UPPER`, and quoted `"VENDOR_ID"` all resolved, with output header case following the query text). Our 133 exact-match column guard is therefore stricter than Kinetica: it stands, because snapshot names are canonical. It may reject a differently-cased name that Kinetica would accept, which is safe.

---

## Summary of decisions

| Spike | Decision | Fallback taken? | Consequence (phase number: change) |
|---|---|---|---|
| S1 session-only dvs | Ad-hoc inline path viable as non-admin (S1.1/1.3/1.4 PASS); dv column source = `SELECT * FROM <view> LIMIT 0` | No | 139: ad-hoc materialize branch, session-bound prefix-validated name, no `dashboard_dynamic_views` row, per-session view cap, DROP on session end (TTL is safety net) |
| S2 streaming | SSE over POST, fetch ReadableStream, `: ping` heartbeat ~15 s, cap at `AI_TIMEOUT_MS`, per-op session re-check | No (NDJSON/polling held in reserve) | 137: build stream endpoint, `res.on("close")` abort, verify through nginx :8080 and add stream-location directives |
| S3 validators | Derive-for-all FAILS (8/16 types have `fields: []`); named subset below | Yes (hand-written validators for extra types, map first) | 136: hand-maintained/generated catalogue in packages/shared + web-side drift test; `customWhere` AI-blocked |
| S7 Kinetica caps | Non-admin can create MVs (default schema); NOT read-only by grants; no server timeout; EXPLAIN has no cost estimate; tag/find/cancel works | Yes (fully app-side guard) | 137/140: tag -> find -> `/admin/alter/jobs` cancel; 140: SQL guard fully app-side, row cap + LIMIT, no EXPLAIN gate |

- **S3 v2.0 AI widget-type subset (for approval, verbatim):** bar, line, pie, table, bignumber, records. `map` flagged separately (main AI target, custom config; needs a hand-written validator if Phase 136 requires it). scatter, heatmap and the 7 other custom-panel types are out.
- **AIACT-V20-07 wording flag:** S1 did NOT fall back, so no rewording is proposed. (If the operator disagrees, the fallback wording would be: "The AI can propose a dynamic view; it goes live after Keep".)
- **S7 Phase 140 stance:** guarded SELECT is fully app-side (statement allow-list, row cap, per-session view cap); no reliance on Kinetica grants (user can CREATE TABLE and INSERT); abort alone does not stop a job, so cancel uses tag/find/cancel. Results are from the NON-admin `uat_analyst`.
- **S2 nginx:** `proxy_buffering off; proxy_cache off; proxy_read_timeout 300s; gzip off; proxy_http_version 1.1; proxy_set_header Connection "";` on the stream location is deferred to Phase 137 and verified there.
- **dv column-guard note (133-09):** on the dv path of `POST /api/filter/materialize` a rejected request costs one read-only column lookup per dv per TTL window (cached, invalidated on re-materialize/drop); never the DDL. This deviates from roadmap 133 criterion 1 ("no SQL executed") and needs approval (A5).
- **Tech debt (new):** v1.26 `cancelExport` (`packages/server/src/lib/exportRunner.ts:272`) only calls `ac.abort()`; the Kinetica job keeps running (S7.6). Default: log as tech debt.

---

## Checkpoint (D-15)

Status: awaiting operator review (plan 133-10)
