# Phase 133 Spike Decision Record

**How to read:** one section per spike in the D-15 template. S2 and S3 were run autonomously in plan 133-07. S1 and S7 are PENDING the operator run in plan 133-08. All spikes must be reviewed at the D-15 checkpoint before Phases 134/135.

---

## S1 — Session-only dynamic views

**Question:** Can an AI-proposed dynamic view be materialized and used (count, filter view over it, WMS tile, TTL expiry, drop) as the non-admin user WITHOUT a `dashboard_dynamic_views` row?

**Method:** (1) Code half: `createOrReplaceMaterialized` (`lib/materializedView.ts`) takes `{req, view, sqlBody, ttl, route, op}` with no row dependency; the route-level blockers are `POST /api/dynamic-view/materialize` (loads the dv row, names from `row.id`), the dv branch of `/api/filter/materialize` (requires `dvRow`) and `buildFilterViewName` (requires `tableId` or `dynamicViewId`). Sketch: ad-hoc branch taking a server-held structured spec, a session-bound name `_kbi_ai_u<user>_s<sid8>_<n>`, prefix-validated `adHocViewName`. (2) Operator live half (`src/spikes/adhocDvSpike.ts`, plan 133-08) as the non-admin user: create ad-hoc view, `SELECT COUNT(*)`, filter view over it, WMS tile against filter view, wait past TTL (sliding?), `DROP TABLE IF EXISTS`.

**Result:** PENDING — operator run in plan 133-08

**Decision:** PENDING — operator run in plan 133-08. Rule (D-13): all green means ad-hoc inline path; any of {create denied for non-admin, view-of-view filter fails, WMS cannot render the view} means "AI dvs go live only after Keep" and AIACT-V20-07 is flagged for rewording.

**Fallback:** PENDING — operator run in plan 133-08 (expected: AI dvs materialize only on Keep; Phase 139 shrinks).

**Consequence for later phases:** PENDING — operator run in plan 133-08

**Confidence:** PENDING (code facts HIGH, live behaviour unknown)

### S1 → Dv column source decision

Does `SELECT * FROM <view> LIMIT 0` return `column_headers`? If not, `LIMIT 1`; if not, `INFORMATION_SCHEMA.COLUMNS`. Feeds the dv column guard. PENDING — operator run in plan 133-08

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

**Result:** PENDING — operator run in plan 133-08

**Decision:** PENDING — operator run in plan 133-08

**Fallback:** App-side guard + row cap + per-session view cap + client abort (from research summary).

**Consequence for later phases:** PENDING — operator run in plan 133-08 (decides whether Phase 140's read-only SELECT can lean on a read-only Kinetica role).

**Confidence:** PENDING

### S7 → Column-name case folding

Does Kinetica fold column-name case (so the column guard must compare case-insensitively)? PENDING — operator run in plan 133-08

---

## Checkpoint (D-15)

Status: awaiting operator review (plan 133-10)
