# Architecture Research — v1.26 Large Exports & Fixes

**Domain:** Integration of (1) a 1,000-row Kinetica envelope ceiling fix, (2) a server-side
background CSV export job, and (3) line-chart multi-series Group By, into the existing
Kinetica BI monorepo (`packages/server` Express+better-sqlite3 ESM, `packages/web` React+Vite+
zustand+Recharts).
**Researched:** 2026-10-01
**Confidence:** HIGH for all file:line claims (read directly from the current `feat/schema-sync`
checkout). MEDIUM for the Kinetica `/execute/sql` `limit`/`offset` *semantics* claims (no official
doc found in-repo, and live calls were out of scope for this research — flagged explicitly below).
No live Kinetica calls were made; `packages/server/.env` was not read.

A sibling researcher already wrote `.planning/research/FEATURES.md` for this milestone (feature
landscape / competitor analysis). This file is the code-level integration trace it references —
read together, not standalone.

---

## 1. The 1,000-row ceiling's blast radius

### The mechanism

`packages/server/src/kinetica.ts:160-194` (`kineticaSql`) POSTs to `/execute/sql` with a body
built as:

```
body: JSON.stringify({
  statement: sql,
  offset: 0,
  limit: 1000,            // line 187 — hardcoded
  encoding: "json",
  request_schema_str: "",
  data: [],
  options: {},
  ...(options.extra ?? {}),   // line 192 — spread LAST, so extra.limit/extra.offset
                              // silently override the hardcoded top-level fields above
}),
```

**Critical finding: the override mechanism already exists and is already proven in production.**
Because `options.extra` is spread *after* the hardcoded `offset`/`limit` keys, any caller that
passes `extra: { limit: N }` already gets `N` instead of `1000` — no change to `kinetica.ts`
itself is required for a caller that knows its own ceiling. Three call sites already do this:
`index.ts:1190` (`extra: { limit: 1 }`), `index.ts:2374` and `:2398` (`extra: { limit: 50 }`,
spatial info-query). The comment at `index.ts:2368-2370` spells out the distinction explicitly:
*"The SQL itself has LIMIT 50 OFFSET `<page*50>`; the kineticaSql `extra.limit` is the Kinetica
request envelope's limit (distinct from the SQL LIMIT clause)."* That distinction — envelope
`limit` vs. SQL-text `LIMIT` — is the whole bug: a SQL `LIMIT 5000` does nothing if the envelope
caps the response at 1000 rows regardless.

`POST /api/sql` (`index.ts:2904-2915`) passes the **client's own request body** straight through
as `extra`: `extra: options` where `options` is whatever `{ sql, options }` the client sent. So a
client (or a future export job) *can already* override the limit per-call today, simply by
sending `{ sql, options: { limit: N } }` to the existing route — the plumbing is live, just
unused by any current web caller.

### Every caller, and whether it needs >1000 rows

**Via `kineticaSqlHelper` (server-internal, `index.ts` call sites):** `1187` (DDL — no row data),
`1493`/`2023`/`2158`/`2190` (`DROP TABLE IF EXISTS` — no row data), `1553`/`1604`/`1636`
(RBAC-adjacent, not Kinetica-row-shaped — confirmed no `extra` needed), `1921` (`SELECT 1 ...
LIMIT 0` dynamic-view-preview probe — 0 rows), `1947` (dynamic-view preview,
`SELECT * FROM (...) LIMIT ${sampleLimit}`, `sampleLimit` from client `body.sample_limit`, only
validated `> 0` at `index.ts:1897` — **no upper bound**, so an operator requesting a >1000-row
preview sample would be silently truncated with no warning; low priority since previews are UX
samples, not data-correctness-critical, but technically in-scope), `2046`/`2071` (`COUNT(*)` —
single row, safe), `2371`/`2395` (`POST /api/info/query`, spatial map popup, explicit
`extra: { limit: 50 }` already set — safe), `2809`/`2820`/`2832` (discovery: schemas/tables/
columns lists — could theoretically exceed 1000 in a very large Kinetica install, edge case, not
flagged by PROJECT.md), `2909` (`POST /api/sql` passthrough — inherits whatever the caller sends).

**Via `runSql` (web client, `packages/web/src/api/client.ts:299-316`, which POSTs to
`/api/sql` with `options` passed straight through as `body.options`):** every current call site
passes `options` as `undefined` or `{}` — none override the limit today:
- `WidgetRenderer.tsx:657` — `AggregatedWidgetRenderer`'s chart query (bar/line/pie/heatmap/data
  table). Chart "Result limit" dropdown values are `[5,10,25,50,100,250,500]`
  (`ChartConfigPanel.tsx:957`) for non-heatmap charts — **all safely under 1000.**
- **Heatmap is the one already-broken exception.** `ChartConfigPanel.tsx:36`:
  `HEATMAP_LIMITS = [250, 500, 1000, 2500, HEATMAP_CELL_LIMIT]` where
  `HEATMAP_CELL_LIMIT = 5000` (`packages/web/src/lib/heatmapGrid.ts:56`). A heatmap's own SQL
  `LIMIT` clause can already ask for up to 5000 rows, but the query runs through the same
  `runSql(sqlToRun, undefined, ...)` call at `WidgetRenderer.tsx:657` with no `extra.limit` — so
  Kinetica silently returns at most 1000 rows for any Result Limit choice of 1000/2500/5000.
  **Worse: this is invisible today.** `HeatmapRenderer.tsx:285-306` computes
  `truncated = data.length >= cellLimit` — comparing the *actual returned row count* against the
  *requested* cell limit, not against the real server-side cap. For Result Limit = 2500,
  `data.length` tops out at 1000 (< 2500), so `truncated` is `false` and **no warning is shown** —
  the grid silently renders an incomplete heatmap with the "truncated" banner suppressed. This is
  a confirmed, pre-existing, silent-data-loss bug exposed by this ceiling, not merely "stops too
  early" like the CSV case.
- `WidgetRenderer.tsx:1991` — the CSV export loop (`handleDownloadCsv`). Requests pages of 5000
  (`PAGE = 5000` at `:1982`), server returns ≤1000, `rows.length < limit` (`:1995`) reads as "view
  exhausted" after one short page → the documented bug.
- `WidgetRenderer.tsx:2115` (records-table page fetch) and `:2188` (`COUNT(*)`) — `pageSize`
  defaults to 25 (`WidgetRenderer.tsx:1862`, `Math.max(1, Number(cfg.pageSize) || 25)`) and has no
  UI control exposing a value anywhere near 1000 — **safe today**, though there is no upper-bound
  guard if an operator hand-edited `pageSize` in a widget's JSON config.
- `TimelineRenderer.tsx`, `NumericLineRenderer.tsx`, `CalendarRenderer.tsx`,
  `CalendarConfigPanel.tsx` — all grouped/bucketed queries (one row per time-bucket×series), bounded
  by the visible date range and `MAX_SERIES = 12` (`lib/groupedSeries.ts:23`) — safe in practice.
- `hooks/useViewKeepAlive.ts:97` — `SELECT 1 FROM <view> LIMIT 1` — 1 row, safe (this is a touch
  read, not a data read).

**`kineticaWms`** (`kinetica.ts:367-434`) is a completely separate code path (GET `/wms`, no
`/execute/sql` body, no `limit`/`offset` fields at all) — **not in the blast radius.**

**`kineticaShowTable`** (`kinetica.ts:283-358`, POST `/show/table`) also has its own body shape
with no `limit`/`offset` — used by schema-discovery and v1.25 schema-sync column checks — **not
in the blast radius.** Schema sync's column-diff work reads table/column *metadata*, not row data.

### Kinetica `/execute/sql` limit semantics — what is and isn't documented in-repo

No file under `.planning/` or `packages/server/src` documents Kinetica's `limit`/`offset`
semantics authoritatively (e.g., whether `-9999` or `0` means "unlimited", or what the maximum
accepted value is). `.planning/research/_archive_v1.6/STACK.md:276` and `:480` explicitly record
*"No documented maximum SQL statement length found... HTTP body is JSON"* for a related but
different question (statement length, not row-limit semantics) — there is no equivalent note for
row-limit sentinels. **This is a gap, not a verified fact: do not assume `-9999` or any other
sentinel works without a spike against the real instance** (explicitly out of scope for this
research per the task's quality gate).

### Safe fix recommendation

Given the override mechanism is proven and already in production use (three existing
`extra: { limit: N }` call sites), the lowest-risk fix is **not** a single global "unlimited"
flip. Recommend:

1. **Raise the hardcoded default** in `kinetica.ts:187` from `1000` to a value that covers every
   *existing* caller's maximum observed ask without `extra.limit` (heatmap's `HEATMAP_CELL_LIMIT`
   of `5000` is the largest) — e.g. `5000` or `10000`. This one-line change silently fixes the
   heatmap truncation bug and the dynamic-view-preview `sample_limit` edge case for free, with no
   per-caller changes, while still bounding the still-open, client-trusted `POST /api/sql`
   passthrough (`index.ts:2904-2915`) against an accidental unbounded `SELECT *` pulling millions
   of rows into Node memory in one response.
2. **The new export job must never rely on that default.** It should always pass an explicit
   `extra: { limit: <batchSize> }` (e.g. `20000`, per PROJECT.md) on every batched read, exactly
   mirroring the existing `extra: { limit: 50 }` precedent at `index.ts:2374`/`:2398` — this makes
   the job's row-count intent explicit and independent of whatever the shared default is tuned to
   later.
3. **Do not use a `-9999`/"unlimited" sentinel without a live spike first** — its semantics are
   unverified in this codebase and in the research performed so far.

---

## 2. What the export must reproduce

### `handleDownloadCsv` today (`WidgetRenderer.tsx:1957-2031`)

Reads (all computed once per call, imperatively, not via React state):
- **FROM source** (`:1963-1971`): reads `useFilterCombinationStore.getState()` directly
  (`vizToHash[recordsVizKey]` → `registry[hash]`), exactly mirroring the page-fetch effect's
  resolution logic at `:2105-2110`. For a dynamic-view-bound widget (`dynamicViewId !== undefined`),
  prefers the combo-store's dv-combination view, falling back to the raw dv view
  (`recordsDvViewName`); for a table-bound widget, uses the combo entry's `viewName` or `""`.
  `fromSourceCsv = effectiveViewNameCsv || table` — i.e. base registered table name is the final
  fallback.
- **Columns** (`:1974-1975`): `columnOrder` (the live on-screen column order, a `useState` set by
  the page-fetch effect at `:2121`) if non-empty, else `effectiveColumns` (the widget's configured
  column list). Joined into a `SELECT` clause, or `*` if empty.
- **customWhere** (`:1867`, computed once per render): `whereCustomWhere(cfg.customWhere)` →
  `" WHERE (<predicate>)"` or `""` — a raw-SQL fragment that is **designer-authored and persisted
  in `widgets.config` JSON at design time** (`ChartConfigPanel.tsx`), not user-request-time input.
- **Sort** (`:1976-1979`): `sortField`/`sortDir` (React state, user-adjustable column-header
  click), validated against `IDENT_RE` (`:1853`, `/^[a-zA-Z_][a-zA-Z0-9_.]*$/`) before being
  spliced into `ORDER BY`.
- **Pagination**: client-side loop, `PAGE = 5000` per request, `OFFSET` advances by
  `rows.length` actually returned (`:1994`) — i.e. it already tolerates short pages gracefully in
  principle, it's just that the *ceiling* makes every page short.

### Can the server rebuild this from `(widgetId + current filter state)`, or must the client send resolved SQL?

**Key finding: there is no server-side registry of "which materialized view is widget X's dashboard
currently reading."** `useFilterCombinationStore` and `useDynamicViewStore` are pure
**browser-side zustand stores** (`packages/web/src/store/filterCombinationStore.ts`,
`dynamicViewStore.ts`) — the server never persists "widget 42 → view
`_kbi_filt_u...c1a2b3c4`" anywhere; it only ever receives `(dashboardId, tableId, filters[],
combinationKey)` at materialize-time (`POST /api/filter/materialize`, `index.ts:1259+`) and
computes the view name **deterministically** from those inputs plus `req.user.sid`
(`buildFilterViewName`, `lib/viewNaming.ts`) — it never stores the mapping. So the server *can*
rebuild the exact same view name as the browser did, but **only if given the same inputs the
browser used** (`combinationKey` — an 8-hex-char hash the client already computes via
`stableComboHash`/`comboShortHash`, mirrored server-side by `hashKey8`,
`lib/viewNaming.ts:27-40` — explicitly documented as needing to be "byte-for-byte identical" across
stacks). A pure `widgetId`-only request cannot recover "which filters are currently active in this
browser tab" — that is genuinely ephemeral client state, not recoverable from any server-side
source of truth today.

**What the server *can* and should own, independent of the client:** `customWhere`, the column
list, and the configured sort — these are all already persisted in SQLite on the `widgets` row
(`db.ts:606`, `getWidget(id)`) and set at design time, not request time. Reading them server-side
(instead of trusting a client-sent column list / WHERE fragment) is strictly safer and DRYer for
a job whose provenance should be auditable in the job-history row (`"exported widget 42"`, not an
opaque SQL blob).

**Recommendation — split the trust boundary cleanly:**
- Export-trigger request = `{ widgetId, filename?, gzip?, currentFilters | combinationKey }`.
  The server loads `widget.config` from SQLite via `getWidget(widgetId)` for `customWhere`,
  columns, and sort (same source `ChartConfigPanel`/`RecordsTableRenderer` already read) and
  resolves the FROM source the same way `index.ts:1915-1933` (dynamic-view preview) already does:
  probe `SELECT 1 FROM <expected-view-name> LIMIT 0`; on `isTableNotFoundError`, fall back to the
  base table reference. This reuses an **existing, already-shipped precedent** for
  "server-composed SQL from structured ids," not raw client SQL.
- This is **distinct from, and safer than,** the *other* existing precedent in this codebase:
  `POST /api/sql` (`index.ts:2904-2915`) already accepts fully-formed, client-authored SQL and
  executes it under the requesting user's own Kinetica credentials, scoped by whatever that
  user's Kinetica grants allow (`buildAuthHeader`, `kinetica.ts:73-79`). That precedent proves
  "trust the client's SQL, scoped to their own DB grants" is an **accepted** trust model in this
  app for synchronous, in-request-lifetime queries — but a background job that persists a
  replayable spec and writes a file to disk unattended is a meaningfully larger blast radius than
  one more synchronous `/execute/sql` round trip, so reconstructing from a known-safe
  `widgetId` + structured filter state (mirroring `/api/filter/materialize`'s existing contract,
  not `/api/sql`'s) is the recommended design, not a new one.

### `customWhere`/`IDENT_RE`/column-major-decode need a server-side port

None of `IDENT_RE` (`WidgetRenderer.tsx:1853`), `whereCustomWhere`
(`packages/web/src/lib/customWhere.ts:34-37`), or the column-major→row-major decode
(`parseKineticaResponse`, `WidgetRenderer.tsx:243`, which duplicates logic already inline
server-side at `index.ts:2405-2419` for `POST /api/info/query`) exist server-side as reusable
modules. There is **no shared package** in this monorepo (`package.json` workspaces are only
`packages/server` and `packages/web`, confirmed via root `package.json:6-7`) — cross-stack
byte-identical logic is **intentionally duplicated** per-side already (see `lib/viewNaming.ts:27-31`'s
explicit comment that `hashKey8` must match the web's `comboShortHash` byte-for-byte). Porting
`IDENT_RE` + `whereCustomWhere` + the column-major decode into a new
`packages/server/src/lib/exportSql.ts` (or similar) is a small, pure, independently-testable task
that follows this established duplication pattern rather than fighting it.

---

## 3. Transient view lifecycle

**TTL enforcement is entirely Kinetica-native, not a server sweep.** `materializedView.ts:31-54`
(`createOrReplaceMaterialized`) emits `CREATE OR REPLACE MATERIALIZED VIEW ... USING TABLE
PROPERTIES (TTL = <n>)` — Kinetica itself expires the view after `n` minutes of inactivity
(a **sliding** TTL, per `index.ts:1443`'s comment `// TTL (sliding)` and the extensive design
notes in `useViewKeepAlive.ts:1-24`). `DEFAULT_VIEW_TTL_MINUTES` is read once at boot
(`index.ts:198`, `readPositiveIntEnv("DEFAULT_VIEW_TTL_MINUTES", 5)` — default **5 minutes**).

**There is no server-side sweeper for materialized views** — unlike sessions, which do have one
(`sessionStore.ts:280-291`, `startSessionSweep`, hourly `setInterval`, `.unref()`'d so test runners
exit cleanly). View liveness is maintained *purely* by reads resetting Kinetica's sliding TTL,
which is exactly why `hooks/useViewKeepAlive.ts` (246 lines, browser-only) exists: a per-dashboard
timer fires a no-op `SELECT 1 FROM <viewName> LIMIT 1` touch read (`:97`) roughly
`ttlKeepaliveLeadMinutes` (`index.ts:199`, default 1 min) before each view's `expiresAt`, on the
documented *assumption* that a read resets the TTL — the module's own comments (`:17-20`) say this
was "confirmed live in Phase 79" but is still flagged "best-effort."

**Implication for the export job:** the job runs server-side and may well outlive the triggering
browser tab (the "export history list" requirement implies exactly this — re-download after
navigating away). It **cannot** depend on `useViewKeepAlive`, which only runs while a dashboard
component is mounted in a browser. Two designs were considered:

- *(Rejected)* Let the job's own batched reads double as keep-alive touches, relying on the
  "reads reset TTL" premise. Risk: on a very large export, OFFSET-depth scan cost can grow
  batch-over-batch; if any single batch takes longer than the remaining TTL window, the view can
  expire *during* a read that would otherwise have renewed it — a race the live dashboard's
  shorter, decoupled touch-read doesn't have to worry about at the same scale.
- **(Recommended) Materialize a job-private snapshot view at trigger time**, reusing
  `createOrReplaceMaterialized` (`materializedView.ts:31-54`) with (a) a **new, job-scoped naming
  convention** distinct from `buildFilterViewName`'s user+session+dashboard+table+combinationKey
  scheme (so it can't be dropped out from under the job by an unrelated filter change or
  `DELETE /api/filter/materialize` call), and (b) a **TTL sized to the job's expected duration**
  (e.g. `max(DEFAULT_VIEW_TTL_MINUTES, configured export timeout)`), not the dashboard default.
  This fully decouples the export from the live dashboard's filter churn and from
  `useViewKeepAlive`'s assumptions, and gives OFFSET-paging **true snapshot semantics for free**
  (the private view is immutable for the job's lifetime) — directly addressing PROJECT.md's
  "OFFSET paging needs a stable order" hazard. The job should explicitly `DROP TABLE IF EXISTS` its
  private view on completion/cancel/failure (mirroring the existing explicit-drop pattern at
  `index.ts:1493`, `:2023`, `:2158`, `:2190`), rather than waiting out its TTL.
- **Stable sort tiebreaker:** `sortField`/`sortDir` are a single, operator-chosen, not-necessarily-
  unique column. Recommend `ORDER BY <sortField>, <all remaining exported columns>` as a cheap
  deterministic composite tiebreaker — no new Kinetica feature required, and acceptable as a known
  edge case (duplicate full-row ties) in the same spirit this codebase already accepts elsewhere
  (`lib/barGroupedSeries.ts:30-32`'s explicit "accepted known edge-case" note on its own separator
  collision). Since the export job reads an immutable private snapshot (point above), this is
  sufficient — the data literally cannot shift between batches.

---

## 4. Job + file design within this codebase

### Job registry: SQLite, following the `table_sync_history` precedent

`db.ts` already has the exact shape of precedent needed: `CREATE TABLE IF NOT EXISTS
table_sync_history (... kind TEXT NOT NULL CHECK(kind IN ('baseline','diff')) ...)`
(`db.ts:326-336`), created via the same `ensureDir`/`CREATE TABLE IF NOT EXISTS` pattern used for
every other table in `SCHEMA_DDL` (`db.ts:20-...`). Recommend a new `export_jobs` table following
this exact style: `id`, `username` (scoping — mirrors `table_sync_history`'s free-text `actor`
column, `db.ts:329`), `widget_id`, `dashboard_id`, `status` with a `CHECK(status IN (...))`
constraint (mirroring the `kind` CHECK), `filename`, `gzip`, `rows_written`, `total_rows`
(nullable — `COUNT(*)` may be skipped if expensive), `file_path`, `file_size_bytes`, `created_at`,
`started_at`, `completed_at`, `expires_at`, `error_message`. List/status/download routes should
filter `WHERE username = ?` (the requesting user, from `AuthedRequest.user.creds.username`) for
per-user privacy — the filesystem itself provides no isolation (Node owns every file regardless of
which app-user "owns" it in the data model); privacy is enforced by the route's `WHERE`, not disk
permissions.

### In-memory piece: per-job `AbortController`, not persisted

The durable SQLite row cannot carry a live `AbortController` across a server restart, and
shouldn't try. Recommend a module-level `Map<jobId, AbortController>` (new
`lib/exportRunner.ts` or similar) — this mirrors the existing client-side pattern at
`WidgetRenderer.tsx:1943` (`exportAbortRef`), just server-side and keyed by job id instead of one
ref per component instance. **On boot, reconcile stale `running` rows** — any `export_jobs` row
left `status='running'` from a crashed/killed process should flip to `failed`/`interrupted` before
`app.listen()`, mirroring the existing `wipeSessionsOnModeChange()` boot-time-reconciliation
pattern (`index.ts:230-241`, which runs "before `app.listen()` so the server never serves a request
that could resurrect" stale state).

### Per-user credentials for a job that outlives the triggering request

`AuthedRequest.user.creds` (`auth.ts:26-35`) only exists for the lifetime of the HTTP request that
carried it. **Do not cache `creds` (password or OIDC access token) in the long-lived job map** —
that would mean holding a live secret in server memory for the job's full duration, unnecessarily
widening the secret's exposure window. Recommend storing only the session id (`sid`) on the job,
and re-deriving `{ credentialType, creds }` fresh before each Kinetica call via
`sessionStore.getSession(sid)` (`sessionStore.ts:193`) — exactly what `requireAuth` itself does per
request (`auth.ts:140`, `:168`). This has two good properties for free: (a) it **fails closed** —
`getSession` returns `null` and deletes the row on expiry (`auth.ts:140`'s comment), so a job whose
session has since expired or been logged out naturally stops being able to authenticate, matching
PROJECT.md's "must not outlive or escape that user's authorization" hazard; (b) it needs no new
secret-handling code path, just a different call site for the same existing function.

**Two session-lifetime hazards to flag, not fix in this phase:**
- Sessions have a **fixed 8-hour expiry** set at creation (`sessionStore.ts:91`,
  `datetime('now', '+8 hours')`; `auth.ts:11`, `TOKEN_TTL_SECONDS = 60*60*8`) —
  `touchSession` only bumps `last_used_at`, **never** `expires_at` (`sessionStore.ts`, comment
  `"never expires_at (Pitfall P5)"`). A job starting near the end of an 8-hour session window can
  be cut off mid-export; this should surface as a distinct job failure state
  ("session expired"), not a silent hang or generic error.
- **No OIDC token-refresh logic exists anywhere in `auth.ts`** (confirmed by grep — no `refresh`
  keyword in the file). An OIDC access token can expire independently of, and potentially before,
  the session cookie's own 8-hour clock, producing a `KineticaAuthError` mid-batch. Same
  "surface as a job failure, don't silently hang" handling applies; a token-refresh fix is out of
  scope for this milestone.

### RBAC permission — recommend reusing `dashboards:view`, not adding a new permission

Today's inline CSV download has **no RBAC permission gate** at all — `enableCsvDownload`
(`WidgetRenderer.tsx:1940`) is a per-widget *designer* config toggle, not an RBAC permission; the
button renders for anyone who can already view the dashboard (`WidgetRenderer.tsx:2366-2371`).
`lib/permissions.ts:1-4` documents that "adding a permission requires a release" and the current
catalog has exactly 18 entries (`:18-37`) with hardcoded counts/expectations rippling through
`rbacDb.ts`, `rbacSeed.ts`'s `DEFAULT_ROLE_MAPPINGS`, and the web's
`permissionGroups.ts` (`NOUN_TO_GROUP`/`GROUP_ORDER`/`PERMISSION_DESCRIPTIONS`, all requiring a
matching new entry) plus `RolesPage` specs — a real, multi-file ripple for a genuinely new
permission. Since the export job doesn't change *who* can already see/export a widget's data (same
exposure as today's inline button, same `dashboards:view` implicit gate), recommend gating the new
export routes on the **same requirement the dashboard already needs**, not a new permission —
governance over "who can run huge exports" is already scoped by PROJECT.md as the env-var admin
cap (rows/file-size), not a new role capability. Flag this as an explicit decision point for
the roadmap author, since it's a product call, not purely technical.

### Env config pattern

`index.ts:186-197` defines `readPositiveIntEnv(name, def)` — read **once at boot** inside
`createApp()` (comment: `"ARCHITECTURE AP-5 — never re-read process.env per-route"`), warn+fallback
(not fail-fast) on an invalid value, used for `DEFAULT_VIEW_TTL_MINUTES` (`:198`),
`TTL_KEEPALIVE_LEAD_MINUTES` (`:199`), `MAX_COMBINATION_VIEWS_PER_TABLE` (`:204`),
`MAX_BAR_GROUP_BY_SERIES` (`:209`) — this is the established tuning-knob idiom; boolean flags use a
plain `=== "true"` string compare instead (`DISABLE_DV_FILTER_SCOPE`, `:214`). Recommend new export
knobs follow this exact pattern (read once, warn+fallback, not DB/UI-backed) — matches the
project's own standing operator preference for env config over a runtime settings store:
`EXPORT_ROW_CAP`, `EXPORT_FILE_SIZE_CAP_MB`, `EXPORT_TTL_MINUTES`,
`EXPORT_MAX_CONCURRENT_PER_USER`, `EXPORT_BATCH_SIZE` (default `20000` per PROJECT.md).

### Temp dir location

No existing on-disk temp-file precedent exists in this server — the only current file-upload
handling (`multer`, `index.ts:362-363`) uses `multer.memoryStorage()` (in-memory, never touches
disk) for branding logo uploads. The closest structural precedent is `db.ts:13-18`'s `ensureDir`
helper (`fs.mkdirSync(dir, { recursive: true })`, skipped for `:memory:`) paired with
`db.ts:500`'s default path convention: `process.env.DB_PATH || path.join(process.cwd(), "data",
"kinetica.db")`. Recommend a new `EXPORT_TEMP_DIR` env var defaulting to
`path.join(process.cwd(), "data", "exports")`, created at boot with the same `ensureDir`-style
guard. `fs`/`path` are already imported in `db.ts:1-3` — no new dependency required.

### Serving the file (download, Range-resumable)

Express `4.19.2` is already a dependency (`packages/server/package.json`); its built-in
`res.sendFile()` (via the `send` package Express bundles) **already implements `Range`/
`Accept-Ranges`/`206 Partial Content` handling natively** — no manual Range-header parsing is
required. This is genuinely new ground for this server (the only existing file-send precedent is
`res.send(buffer)` whole-buffer sends at `index.ts:515`, `:969`, `:2877` — none use `sendFile` or
stream a file from disk today), but it is a small, well-contained addition, not a novel subsystem:
`res.sendFile(absoluteFilePath, { headers: { "Content-Disposition": ... } })` on a GET route gated
by the same per-user `WHERE username = ?` ownership check as the job-status route. The existing
`Content-Disposition: attachment; filename="..."` pattern used for dashboard export
(`index.ts:965`) is the precedent to reuse for the filename header.

### Graceful shutdown

**No `SIGTERM`/`SIGINT` handling exists anywhere in the server** (confirmed: zero matches
grepping the whole `packages/server/src` tree). The only shutdown-adjacent precedent is
`sessionStore.ts:290`'s `.unref()` on its sweep interval, which lets the process exit cleanly in
tests/dev without an explicit handler. This milestone's boot-time reconciliation step (flip stale
`running` rows to `failed` on next boot, see above) covers the "server crashed mid-export" case
without needing a shutdown hook at all. A `SIGTERM` handler (cancel in-flight jobs cleanly,
close temp file handles) would be genuinely new code for this server — recommend treating it as
optional/defer-able unless the roadmap specifically wants "don't leave half-written files on a
clean restart" as a hard requirement; the TTL sweep + boot reconciliation already provide a safety
net.

---

## 5. Line chart multi-series Group By

### What already exists and is directly reusable

`ChartConfigPanel.tsx:352`: `usesMultiColumnGroupBy = isBar || isTable || isHeatmap` — **line is
currently excluded**. `isBar`/`isHeatmap` are defined at `:346`/`:351`; adding `isLine = widgetType
=== "line"` and including it in this gate is the single flag-level change needed to expose the
N-column builder UI (`:828-897`) to the line chart. `MAX_BAR_GROUP_BY_COLUMNS` (`:356`,
`isHeatmap ? 2 : 6`) already applies generically — line would get the same 6-column cap as bar.
The builder's per-chart-type label wording (`labelFor`, `:837-842`) and hint text
(`:893-899`) already branch on `isBar`/`isHeatmap` vs. a generic fallback — line falls into the
generic `"Group column ${idx+1}"` / table-style hint today and should get its own bar-style wording
("Primary group (x-axis)" / "Series dimension N") since its SQL semantics (one category axis + N
series columns) match bar's, not the table's.

`isMultiColumnBarGroupBy(config)` (`lib/barGroupedSeries.ts:16-19`, `Array.isArray(groupByColumns)
&& length >= 2`) and `toBarPivotInput` (`:34-48`, maps flat SQL rows → `{bucket, series, value}`
using col1 as bucket and `col2..N` joined by `" / "` as the series key) are **pure, chart-type-
agnostic** functions — nothing bar-specific in their logic despite the filename. `selectTopSeries`
and `pivotSeriesRows` (`lib/groupedSeries.ts:56-76`, `:93-127`) are already shared between
Timeline/NumericLine (grouped time-series) and Bar (`BarRenderer`, `WidgetRenderer.tsx:973-977`) —
the same three functions are the correct reuse target for Line, no new pivot logic needed.

### What `LineRenderer` (`WidgetRenderer.tsx:1255-1387`) currently lacks, mapped to `BarRenderer`'s existing multi-series branch (`:967-1004`, `:1150-1161`, `:1039-1056`)

| Need | BarRenderer precedent (already shipped) | LineRenderer today |
|---|---|---|
| Pivot config → series | `:969` `multiSeries = isMultiColumnBarGroupBy(config)`; `:973` `toBarPivotInput`; `:974-977` `selectTopSeries`/`pivotSeriesRows` → `chartData` | None — `groupByColumn` only feeds drill-down target resolution (`:1273`, `:1305-1307`), never pivots rows |
| N series elements | `:1150-1161`, `top.series.map(sk => <Bar dataKey={sk} name={sk} fill={seriesColors[i]} .../>)` | Single hardcoded `<Line dataKey={y} .../>` (`:1375-1382`) / `<Area dataKey={y} .../>` (`:1348-1356`) |
| Truncation note ("top N of M series") | `:1215-1219`, `multiSeries && top.truncated` banner | None |
| Drill-down on a series column | `:1039-1056`, explicit `multiSeries` branch: drills on `payload["bucket"]` / `groupByColumns[0]` **only** — the series dimension is deliberately NOT drillable, same accepted limitation as single-column | None — would need the identical branch ported in, same accepted limitation |
| Legend name for a custom metric | `:961-963`, `isCustomSelection(metricId) ? resolveMetricLabel(...) : resolveLabel(...)` feeds `metricLabel`, used in the `name` prop | `:1355`/`:1381`: `name={(config.yFieldLabel) || (resolveLabel(...)) || y}` — **never calls `resolveMetricLabel`/`isCustomSelection`**, so a custom-metric-backed line chart falls through to the bare dataKey `y` (often literally `"value"`) — this is the standalone legend bug PROJECT.md names, independent of the multi-series work |
| All x-axis labels shown | N/A (bar doesn't tick-collide the same way) | `<XAxis dataKey={x} .../>` at `:1339`/`:1366` has no `interval` prop — Recharts' default auto-skips colliding ticks; fix is `interval={0}` on both (Area and Line chart variants), per Recharts' own `XAxis` API and the documented tick-interval behavior (see FEATURES.md Sources) |

**Build note:** the multi-series pivot/series-element/drill-down work and the "all labels shown" /
"legend name" fixes are logically independent (FEATURES.md's dependency graph already says this)
— they can land as separate, individually-testable changes inside the same `LineRenderer`
function, in any order, but **all three touch `WidgetRenderer.tsx`**, the same file the export
job's `RecordsTableRenderer`/`handleDownloadCsv` work also lives in (`:1849-2230` vs.
`LineRenderer` at `:1255-1387` — different line ranges, same file). This is a file-level
collision risk for parallel executors (per the project's own recorded lesson about parallel
executors clobbering shared files), not a logical dependency — the roadmap should either
sequence the line-chart phase and the export-job phase, or assign both to one plan/executor if
run in the same window.

---

## Suggested Build Order

1. **Fix the 1,000-row ceiling + blast-radius audit** (`kinetica.ts:187`; raise the default,
   confirmed-safe per the proven `extra.limit` override precedent). Fixes the heatmap silent-
   truncation bug as a side effect. Nothing else in the export job can be correctness-tested
   without this landing first — nothing downstream depends on anything it doesn't already have.

2. **Export-job foundation, pure/offline-testable pieces first:**
   a. Port `IDENT_RE` + `whereCustomWhere` + the column-major row decode into a new server-side
      `lib/exportSql.ts` (pure, no Kinetica/Express dependency — mirrors the existing
      `lib/viewNaming.ts`-style cross-stack duplication, independently unit-testable).
   b. `export_jobs` SQLite table + `db.ts` CRUD (mirrors `table_sync_history`; pure persistence,
      no Kinetica dependency, testable with `:memory:` db like existing `db.ts` tests).
   c. Job-private snapshot materialize/drop helper (wraps `createOrReplaceMaterialized`) +
      deterministic composite `ORDER BY` builder.
   d. The batch-loop runner (in-memory `Map<jobId, AbortController>`, SQLite progress updates,
      explicit `extra.limit` per batch) — composes (a)+(b)+(c), build/test last among the
      "engine" pieces since it's the riskiest and most novel part of this milestone.
   e. Routes: trigger / history list / status-poll / Range-aware download (`res.sendFile`) /
      cancel — thin wiring over (d).
   f. TTL cleanup sweep (mirrors `startSessionSweep`'s `.unref()`'d interval) + boot-time
      reconciliation of stale `running` rows (mirrors `wipeSessionsOnModeChange`'s
      before-`app.listen()` pattern).
   g. Env knobs (`readPositiveIntEnv` style) + `EXPORT_TEMP_DIR` (mirrors `db.ts`'s `ensureDir`).

3. **Client: export-trigger + history UI.** Depends on (2e)'s routes existing. Decide (product
   call, not purely technical) whether the existing small in-browser `handleDownloadCsv` loop is
   retired in favor of always routing through the new job, or kept as a fast-path for small
   tables — either way this is additive UI work, not a blocker for anything else.

4. **Line chart multi-series Group By** — fully independent of steps 1-3 logically (touches
   `ChartConfigPanel.tsx` + a different line-range of `WidgetRenderer.tsx`'s `LineRenderer`). Can
   run in parallel with step 2/3 from a dependency standpoint, but **shares `WidgetRenderer.tsx`**
   with step 3's export-trigger UI wiring — sequence the two or assign to one plan to avoid a
   same-file collision.

---

## Sources

- `packages/server/src/kinetica.ts` (full file read) — `kineticaSql`/`kineticaShowTable`/
  `kineticaWms`, lines 160-434
- `packages/server/src/index.ts` — route bodies at 186-241 (env config + boot reconciliation
  pattern), 1187-1946 (filter/dynamic-view materialize + preview), 2330-2420 (spatial info-query
  envelope-limit precedent), 2780-2920 (discovery routes + `/api/sql` passthrough), 3255-3293
  (startup, no graceful shutdown)
- `packages/server/src/lib/materializedView.ts` (full file) — `createOrReplaceMaterialized`
- `packages/server/src/lib/viewNaming.ts` (header + `hashKey8`/sanitize, lines 1-60)
- `packages/server/src/lib/permissions.ts` (full file) — permission catalog + ripple surface
- `packages/server/src/sessionStore.ts` — session row shape (58-91), `startSessionSweep` (280-291)
- `packages/server/src/auth.ts` — `AuthedRequest` shape (26-35), `TOKEN_TTL_SECONDS` (11)
- `packages/server/src/db.ts` — `ensureDir`/`SCHEMA_DDL` (1-18, 320-365), `defaultDbPath` (500)
- `packages/web/src/components/charts/WidgetRenderer.tsx` (targeted reads) — `handleDownloadCsv`
  (1957-2031), `RecordsTableRenderer` fetch effects (1849-2230), `BarRenderer` multi-series
  (932-1221), `LineRenderer` (1255-1387), `resolveAggregatedDrillTarget` (911-926)
- `packages/web/src/components/charts/ChartConfigPanel.tsx` — Group By builder (339-360, 828-963)
- `packages/web/src/lib/barGroupedSeries.ts`, `groupedSeries.ts`, `heatmapGrid.ts`,
  `customWhere.ts` (all full files read)
- `packages/web/src/components/charts/HeatmapRenderer.tsx` (265-335) — truncation-detection bug
- `packages/web/src/hooks/useViewKeepAlive.ts` (full file) — client-side TTL keep-alive design
- `packages/web/src/api/client.ts` (280-316) — `runSql`
- Root `package.json` (workspaces) — confirms no shared package between `server`/`web`
- `.planning/research/FEATURES.md` (this milestone, sibling research) — feature landscape /
  competitor analysis, cross-referenced throughout
- `.planning/PROJECT.md` (current milestone section) and `CLAUDE.md` — scope and conventions
- No live Kinetica calls made; `packages/server/.env` not read (per task constraints). Kinetica
  `/execute/sql` `limit`/`offset` sentinel semantics (e.g. "unlimited" values) are **unverified** —
  flagged explicitly in §1, not asserted as fact.

---
*Architecture research for: Kinetica BI v1.26 Large Exports & Fixes*
*Researched: 2026-10-01*
