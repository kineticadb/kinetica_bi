# Stack Research

**Domain:** Server-side bulk CSV export (streaming, resumable, gzip) from a GPU database REST API + Recharts line-chart multi-series
**Researched:** 2026-10-01
**Confidence:** MEDIUM-HIGH (Kinetica REST semantics DOC-VERIFIED against docs.kinetica.com/7.1; one server default value and the KiFS permission model are WebSearch-synthesized/MEDIUM — flagged below; Node/Express/Recharts claims DOC-VERIFIED or confirmed directly against this repo's installed versions)

## Recommended Stack

**Bottom line: zero new npm dependencies.** Every capability this milestone needs — batched Kinetica reads, streaming CSV assembly, gzip, resumable Range downloads, an in-process job with cancel/TTL-cleanup, and Recharts multi-series — is reachable with Node builtins, Express's existing `send`-backed response methods, and code already in this repo (`kineticaSql`, `escapeCsvField`, `sessionStore`'s sweep pattern). This matches the project's established pattern (v1.21-v1.25 shipped with no new deps).

### Core Technologies (already in the repo — no version change needed)

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| `node:stream/promises` `pipeline()` | builtin (stable since Node 15; this repo runs Node v24.14.1) | Compose Kinetica-page source → CSV-line transform → optional gzip → file write, with automatic backpressure and single-point error/cancel propagation | DOC-VERIFIED (Node.js official `zlib`/streams docs): `pipeline()` "applies backpressure and rejects if reading, compression, or writing fails" — exactly the cancel + partial-file-cleanup behavior the milestone requires. Destroying the pipeline on cancel stops the Kinetica fetch loop AND the file write together. |
| `node:zlib` `createGzip()` | builtin | Optional `.csv.gz` output | DOC-VERIFIED Node.js `zlib` docs — standard `pipeline(source, createGzip(), fs.createWriteStream(...))` composition. No compression-level tuning needed beyond zlib's default. |
| Express `res.download(path, filename, options)` | 4.19.2 (already installed) | Serve the finished export file as a named, resumable attachment | DOC-VERIFIED (Express response API docs): `res.download` forwards to `res.sendFile`, which delegates to the `send` module — Range/If-Range/conditional-GET support is native and has been stable since Express 4.14.0 (2016), well before this repo's 4.19.2. `res.download` ALSO sets `Content-Disposition: attachment; filename="..."` automatically from the second argument — gives the operator-chosen filename AND Range-resumability in one call, no manual header code. |
| `kineticaSql()` (`packages/server/src/lib/kinetica.ts`) | existing, modified | Per-user-credential batched `/execute/sql` reads | Already carries the per-request `Authorization` header, typed-error classification (`KineticaAuthError`/`KineticaPermissionError`/`KineticaUpstreamError`), and audit logging this export MUST preserve. The only change needed is making `limit`/`offset` and the hardcoded hardcoded `limit: 1000` (line 186→187) caller-overridable via `options.extra`, which the type already supports (`extra?: Record<string, unknown>` merges into the body) — i.e., the export loop calls `kineticaSql(req, sql, { route, op: "SQL", extra: { offset, limit: 20000 } })` without touching the function's shape. |

### Supporting Libraries — none to add

| Library considered | Version | Verdict | Why not added |
|---|---|---|---|
| `csv-stringify` (the `csv` npm family) | 6.x | **Do not add** | It's a solid, stream-native library, but this export only ever flattens one SQL result shape (scalar columns, no nested objects, no alternate dialects) — exactly what the repo's existing `packages/web/src/lib/csvExport.ts` (`escapeCsvField`/`rowsToCsv`, 18 lines, zero deps, RFC-4180-ish comma/quote/CR/LF escaping) already does correctly and has been tested in production since the v1.x FK4 CSV-download feature. **Port it verbatim into `packages/server/src/lib/csvExport.ts`** (same function, same tests) rather than introduce a second CSV-writing implementation that can drift from the client's escaping rules over time. Reconsider only if a future requirement needs BOM/Excel-locale handling or multi-row flattening — neither is in scope. |
| Any job queue (`bullmq`, `bull`, `agenda`, `node-cron`) | — | **Do not add** | `grep` across `packages/server/src` found zero existing usage of `worker_threads`, `child_process`, or any queue library — the only precedent for a long-running background task is `sessionStore.ts`'s `setInterval(...).unref()` TTL sweep for session cleanup. A queue library's real value (multi-process workers, durable Redis-backed retry, cron scheduling) solves problems this feature doesn't have: the export runs as the **requesting user's own per-request Kinetica credentials** (Basic or Bearer, built fresh per-request by `buildAuthHeader`), so a detached worker process would need to persist and later replay that user's live credential — a privilege/credential-lifetime problem the architecture has so far deliberately avoided. Model the export job as an in-process async function tracked by a SQLite row (status/rows/bytes/expires_at), cancelled via `AbortController`, cleaned up via a second `setInterval().unref()` sweep mirroring `sweepExpiredSessions()`. |
| `fast-csv`, `papaparse` (server-side) | — | **Do not add** | Same reasoning as `csv-stringify` — papaparse is a browser-oriented parser, `fast-csv` solves the same already-solved problem. |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| Existing `vitest` / `tsc` gates | Server + web test gates | No new tooling — the export job's SQLite table is a plain schema addition under the existing `better-sqlite3` migration pattern, not a new dependency. |

## Installation

```bash
# No install step. Every recommendation above is either a Node builtin,
# an already-installed package (express, better-sqlite3, recharts), or
# a straight port of existing first-party code
# (packages/web/src/lib/csvExport.ts -> packages/server/src/lib/csvExport.ts).
```

## Kinetica REST — bulk-read semantics (the part the current bug violates)

### `/execute/sql` (used today via `kineticaSql`)

| Param | Default | Min | Max | Notes |
|---|---|---|---|---|
| `offset` | 0 | 0 | MAX_INT | "number of initial results to skip" — DOC-VERIFIED https://docs.kinetica.com/7.1/api/rest/execute_sql_rest/ |
| `limit` | **-9999 (`END_OF_SET`)** | — | — | `-9999` means "the maximum number of results allowed by the server" — i.e. Kinetica's own true default is NOT 1000; the current codebase's hardcoded `limit: 1000` (kinetica.ts line ~187) is an app-introduced ceiling with no basis in the Kinetica default. DOC-VERIFIED same URL. |
| server ceiling | **`max_get_records_size`** (General config section) | — | — | Whatever `limit` is requested, Kinetica never returns more than this server-configured value per single `/execute/sql` or `/get/records` call. DOC-VERIFIED name + description: https://docs.kinetica.com/7.1/config/ ("Maximum number of records that data retrieval requests such as /get/records and /aggregate/groupby will return per request"). **Default value: commonly cited as 20000** — this is MEDIUM confidence only (WebSearch-synthesized across multiple independent results; the live config-page fetch in this session did not render the default-value column of that table). This happens to be exactly the batch size this milestone already picked — plausibly not a coincidence, but **verify the actual deployed value** (ask the Kinetica admin, or query `/show/system/properties`) rather than hardcode-assume it. |
| continuation signal | `has_more_records` (output field) | — | — | DOC-VERIFIED https://docs.kinetica.com/7.1/feature_overview/execute_sql_feature_overview/. **Use this, not "rows returned < limit requested,"** to decide whether paging is done — a deployment whose `max_get_records_size` is lower than the requested `limit` will silently return a short page that is NOT the end of the result set. That exact "short page read as exhausted" shape is today's bug (`WidgetRenderer.tsx`'s export loop treats a short 1000-row page as "view exhausted" when it asked for 5000) — don't reintroduce the same failure mode at a different batch size. |
| encoding | `binary` (Avro) default; `json` (Avro JSON) also supported | — | — | `kineticaSql` already sends `encoding: "json"` — unchanged, keep it. |
| stable ordering across pages | **not documented either way for `/execute/sql`** | — | — | ASSUMED (not found stated explicitly; `/get/records` docs *do* warn that concurrent table mutation can change paged results between calls, which is the same underlying risk). The milestone's own "OFFSET paging needs a stable order" hazard is correct and necessary: the export SQL must carry a deterministic `ORDER BY` over a unique column (or combination), identical on every page request, or increasing `offset` can repeat/skip rows if anything in the table changes mid-export. |

### `/get/records` and `/get/records/fromcollection` — considered, not needed

Same `offset`/`limit`/`max_get_records_size`/`has_more_records` contract as `/execute/sql` (DOC-VERIFIED https://docs.kinetica.com/content/api/rest/get_records_rest), plus `geojson`/`arrow` encodings this app has no use for. **Not recommended for this feature**: the app's entire read path (filters, dynamic views, materialize, discovery) already goes through `/execute/sql` via `kineticaSql()`/`kineticaShowTable()`, carrying the per-user-credential + audit + typed-error plumbing this export must not bypass. Switching the export to `/get/records` would mean either re-implementing that plumbing for a second endpoint or running a raw table scan that loses the SQL `WHERE`/view the widget is built on. Stay on `/execute/sql`.

## Kinetica's native export (`EXPORT TABLE ... INTO FILE`) — considered, not recommended for this feature

| Aspect | Finding | Confidence |
|---|---|---|
| Formats | Delimited text (CSV/PSV/TSV, `uncompressed` or `gzip`) or Parquet (`snappy` default) | DOC-VERIFIED https://docs.kinetica.com/7.1/sql/export/ |
| Destination | KiFS (`kifs://...` path) or an external sink (Azure/GCS/HDFS/S3) or a JDBC target table — **not** an arbitrary local filesystem path on the app server | DOC-VERIFIED same URL |
| Retrieval | KiSQL or a JDBC client can download KiFS files directly; the REST equivalent is `/download/files`, whose response returns `file_data` as **an array of bytes embedded in the JSON response body** (plus `read_offsets` for partial reads) — i.e. it is not an HTTP-streamed, Range-capable transfer; the whole requested slice comes back as one JSON payload the app would then have to decode and re-stream itself | DOC-VERIFIED https://docs.kinetica.com/content/tools/kifs_api, https://docs.kinetica.com/7.1/api/rest/download_files_rest/ |
| Permissions | KiFS access is directory-scoped (`directory_read`/`directory_write`), granted per user or role via `/grant/permission/directory`; **only a `system_admin` can create a directory** in the first place | MEDIUM confidence — WebSearch-synthesized, corroborated by two independent query result sets, but not cross-checked against a primary doc page in this session |
| Version introduced | Not found in the pages fetched this session — **GAP**, not resolved | — |
| **Verdict** | **Do not build the export on this path.** It requires standing, admin-provisioned directory ACLs (the opposite of "automatically private to whichever user happens to run an export"), has no native TTL/expiry concept, and its one REST retrieval mechanism (`/download/files`) is JSON-wrapped rather than streamed — so the app gains no memory or Range-resumability benefit over simply paging `/execute/sql` itself, while taking on an extra round trip (EXPORT, then poll/list KiFS, then fetch-as-JSON) and an admin-provisioning dependency this milestone's "per-user privacy, env-config TTL, deploy-time cap" requirements don't need. Keep the whole export in the app tier: page `/execute/sql` with the existing per-user credential, assemble CSV in Node, write to an app-owned temp directory, serve via Express. | |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| Hardcoding `limit: 1000` (or any single magic number) and trusting `rows_returned === limit` to detect "more pages exist" | This is the root cause of the current bug and the shape a wrong fix could reproduce at a larger number | Request `limit: 20000` but branch continuation on the `has_more_records` response field; treat any returned-rows count as informational |
| `os.tmpdir()` for the export's temp file | Often backed by a small/ephemeral volume (e.g. `tmpfs` capped by RAM) unsuited to potentially GB-scale exports; also harder to apply the deploy-time size cap and TTL sweep the app owns against a shared system directory | A dedicated, env-configured directory alongside the existing `DB_PATH` convention (e.g. `EXPORT_TEMP_DIR`, default `./data/exports`), following the same "tuning knob read once at boot, default + warn on invalid" pattern as `DEFAULT_VIEW_TTL_MINUTES` etc. in `.env.example` |
| Kinetica's `EXPORT TABLE ... INTO FILE` + KiFS + `/download/files` | Admin-provisioned directory ACLs, no HTTP streaming/Range on retrieval (JSON-wrapped byte array), no native per-user-private/TTL semantics | App-tier paging of `/execute/sql` + Node streams, as above |
| A job-queue library (BullMQ/Bull/Agenda) or `worker_threads`/`child_process` | No existing precedent in this codebase; real value (multi-process durability, Redis, cron) is unneeded; persisting a user's live Kinetica credential into a detached worker is a privilege-lifetime risk the current per-request-credential architecture avoids | In-process async function + SQLite job-status row + `AbortController` for cancel + `setInterval().unref()` sweep, mirroring `sessionStore.ts`'s existing TTL-sweep pattern |
| `csv-stringify`/`fast-csv` for this export | Solves a problem (nested objects, alternate dialects, large ecosystem of options) this flat-scalar-column export doesn't have; the repo already has a correct, tested, zero-dep escaper | Port `packages/web/src/lib/csvExport.ts`'s `escapeCsvField`/`rowsToCsv` into `packages/server/src/lib/csvExport.ts` |
| Hand-rolling HTTP Range parsing | Error-prone (multi-range requests, `If-Range`, partial-content status codes, `Accept-Ranges` advertisement) | `res.download(path, filename, options)` — forwards to `res.sendFile`/`send`, which has handled this natively and correctly since Express 4.14 (2016) |

## Stack Patterns by Variant

**If the deployed `max_get_records_size` turns out to be below 20,000:**
- Nothing breaks — the export loop keeps paging on `has_more_records` regardless of how many rows each page actually contains. The only cost is more round trips per export. Do not hardcode an assumption that each page returns exactly the requested `limit`.

**If gzip is requested (`.csv.gz`):**
- Insert `zlib.createGzip()` into the same `pipeline()` between the CSV-line transform and the file write — no separate code path, no separate temp file for the uncompressed version.
- `res.download()`'s Range/`send` support works identically on a `.csv.gz` file — Range operates on raw file bytes regardless of what's inside them, so resumable download doesn't change based on the gzip choice.

**If a per-table unique key doesn't exist for a deterministic `ORDER BY`:**
- Fall back to the table's full column list as a composite order key (stable as long as no two rows are fully identical, which is already true of the exported row set by definition) rather than skipping `ORDER BY` — an unordered paged scan is the one thing the Kinetica docs' own `/get/records` warning (results can differ between calls if the table is mutated) and this milestone's own named hazard both agree is unsafe.

## Version Compatibility

| Package | Version (confirmed in this repo) | Notes |
|---|---|---|
| `express` | 4.19.2 (`packages/server/package.json`) | `res.download`/`res.sendFile` Range support unchanged since 4.14.0 (2016) — no bump needed. |
| `recharts` | declared `^2.10.3`, **resolved 2.15.4** (confirmed via `node_modules/recharts/package.json`) | Both the multi-series `<Line>`-per-dataKey pattern and the `XAxis interval` fix are available on this installed version — no bump needed. |
| Node runtime | v24.14.1 (local) | `node:stream/promises` `pipeline()` has been stable since Node 15 — no constraint. |

### Recharts: the two concrete fixes this milestone needs

1. **Multi-series Group By.** `WidgetRenderer.tsx` already renders one `<Bar dataKey={sk}>` per series column (~lines 1154-1172) driven by `ChartConfigPanel.tsx`'s existing N-column "Group By Columns" builder (~lines 824-890). Recharts has no per-chart-type limit on child count — mirror the exact same per-dataKey loop with `<Line dataKey={sk}>` instead of `<Bar>`; no library change, this is a pure component-structure port.
2. **Dropped/colliding x-axis tick labels.** DOC-VERIFIED (recharts.github.io `/api/XAxis`, recharts guide): `interval` accepts `0` (render every tick, may overlap visually), a positive integer `N` (render every Nth tick), or `"preserveStart"`/`"preserveEnd"`/`"preserveStartEnd"` (auto-skip while always keeping the end ticks). Confirmed by `grep` that neither the bar chart's category `XAxis` (`WidgetRenderer.tsx` ~line 1133) nor the line chart's `XAxis` (~lines 1339, 1366) currently sets `interval` at all — so Recharts falls back to its own internal auto-skip heuristic, which is the documented cause of "silently drops a colliding label." Add `interval={0}` (every category shown, matching the milestone's explicit requirement) to the line chart's `XAxis`; note the tradeoff is overlapping text at high category counts, so check whether the bar chart already has any label-angle/height handling worth mirroring rather than introducing a second, inconsistent treatment.
3. **Legend naming.** Not a stack question — it's that the legend currently reads the data key literal (`value`) instead of the configured metric's display name; fix is a `name` prop on each `<Line>`/`<Bar>` (Recharts has supported `name` on series components throughout the 2.x line), not a version or dependency change.

## Sources

- https://docs.kinetica.com/7.1/api/rest/execute_sql_rest/ — `/execute/sql` offset/limit/END_OF_SET semantics (DOC-VERIFIED)
- https://docs.kinetica.com/content/api/rest/get_records_rest — `/get/records` offset/limit/max_get_records_size/encoding (DOC-VERIFIED)
- https://docs.kinetica.com/7.1/api/rest/get_records_fromcollection_rest/index.html — confirmed same contract for the `fromcollection` variant (link only, not separately fetched)
- https://docs.kinetica.com/7.1/config/ — `max_get_records_size` config parameter name + description (DOC-VERIFIED name/description; default value of 20000 is MEDIUM/WebSearch-synthesized, not shown in this fetch)
- https://docs.kinetica.com/7.1/feature_overview/execute_sql_feature_overview/ — `has_more_records`/`paging_table` pagination pattern (DOC-VERIFIED)
- https://docs.kinetica.com/7.1/sql/export/ — `EXPORT TABLE ... INTO FILE` formats/compression/destinations (DOC-VERIFIED)
- https://docs.kinetica.com/content/tools/kifs_api — KiFS REST endpoint list including `/download/files` (DOC-VERIFIED)
- https://docs.kinetica.com/7.1/api/rest/download_files_rest/ — `/download/files` returns `file_data` as JSON-embedded bytes, not a stream (DOC-VERIFIED)
- KiFS directory-level `directory_read`/`directory_write` permission model, `system_admin`-only directory creation — MEDIUM confidence, WebSearch-synthesized from Kinetica security-concepts search results, not independently re-fetched from a primary page this session
- https://nodejs.org/api/zlib.html — `createGzip()` + `pipeline()` composition and backpressure guarantees (DOC-VERIFIED, official Node docs)
- `node:stream/promises` `pipeline()` availability since Node 15 — WebSearch-sourced community reference, consistent with official Node streams docs; this repo runs Node v24.14.1 so not a binding constraint either way
- https://expressjs.com/en/5x/api/response/ — `res.download`/`res.sendFile` Range support, `Content-Disposition` auto-set from `filename` arg, `acceptRanges` option (DOC-VERIFIED; behavior confirmed stable since Express 4.14.0, this repo runs 4.19.2)
- Repo-internal, read directly this session: `packages/server/src/lib/kinetica.ts` (hardcoded `limit: 1000`, per-user credential + audit plumbing), `packages/server/src/sessionStore.ts` (existing `setInterval(...).unref()` TTL-sweep precedent — no queue library anywhere in `packages/server/src`), `packages/server/.env.example` (the "tuning knob, read once at boot" env-var convention to extend for export caps), `packages/web/src/lib/csvExport.ts` (the escaper to port server-side), `packages/web/src/components/charts/WidgetRenderer.tsx` + `node_modules/recharts/package.json` (confirmed installed Recharts 2.15.4, confirmed no `interval` prop set on any category `XAxis` today)

---
*Stack research for: server-side bulk CSV export + Recharts line-chart multi-series (Kinetica BI v1.26)*
*Researched: 2026-10-01*
