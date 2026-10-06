# Phase 128: Export Job Core — Live Spike, Runner, Snapshot & Cancel - Research

**Researched:** 2026-10-06
**Domain:** Node/Express background job over Kinetica `/execute/sql`; SQLite job registry; streaming CSV; spreadsheet formula-injection hardening
**Confidence:** MEDIUM-HIGH (all code-level claims verified against the checkout with file:line; Kinetica paging/MV semantics are doc-verified only and are exactly what the spike must confirm live)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Live spike**
- **D-01 — The executor runs the spike itself** with the dev credentials in `packages/server/.env` (`KINETICA_URL`/`KINETICA_USERNAME`/`KINETICA_PASSWORD`), via a small `tsx` script. The evidence goes to `128-SPIKE-NOTES.md` (precedent: `.planning/phases/18-spatial-spike-and-endpoint/18-SPIKE-NOTES.md`, `37-cb-track-wms-spike/37-SPIKE-NOTES.md`). The spike plan **ends in a `checkpoint:human-verify`**: the operator approves the mechanism before any runner plan executes.
- **D-02 — The spike pages a large existing table, read-only.** The executor picks the largest readable table in the instance (≥50k rows, so multi-batch paging really happens) and records its name and row count in the notes. It creates no tables in the operator's schemas. A job-private snapshot view needed to *test* the OFFSET path is allowed, and must be dropped afterwards.
- **D-03 — Prefer `paging_table` if it holds.** Choose it when, live, it returns every row exactly once across pages (count + dedupe check), `has_more_records` is the exhaustion signal, it stays readable for a long job (sized via `paging_table_ttl`), and it can be cleaned up. Otherwise fall back to snapshot view + OFFSET + composite ORDER BY (D-05). The notes must record, for whichever paths were tried: the time per batch, the row-exactness result, how Kinetica-side objects are cleaned up, and the confirmed `max_get_records_size`.
- **D-04 — Fold in the open Phase 127 items** using the same script and table:
  - (a) whether row order is stable across split `kineticaSql` calls with no unique ORDER BY;
  - (b) what happens when `KINETICA_MAX_RECORDS_PER_CALL` is set above the server's `max_get_records_size` (Phase 127 D-11, unit-tested only).
  Record each as verified or refuted. If (a) is refuted, note the impact on Phase 127's split-call path in the notes, as a follow-up. Do not silently fix it here.

**Stable order and exactness**
- **D-05 — If the OFFSET path is chosen and the widget's sort isn't unique,** append every other exported column as a silent tiebreak: `ORDER BY <user sort>, <remaining exported columns in order>`. Only exact-duplicate rows stay ambiguous, and they are identical, so that is harmless. No refusing and no warnings. (With `paging_table` the result is computed once, so no tiebreak is needed.)
- **D-06 — No sort on the records table:** the export uses whatever order the snapshot yields; the on-screen order is arbitrary too. The OFFSET path may add an all-columns ORDER BY internally purely for page stability.
- **D-07 — Self-check:** `COUNT(*)` the snapshot once at the start and store it as `total_rows`, which Phase 131's progress also needs. At the end, `rows_written` must equal it. **On a mismatch the job FAILS** (error_code `row_mismatch`) and never completes with a silently wrong file.
- **D-08 — Columns:** exactly the records table's visible columns in on-screen order. This mirrors `handleDownloadCsv` (`columnOrder` if non-empty, else `effectiveColumns`, at `WidgetRenderer.tsx:~2045`). Hidden columns are excluded.

**Formula-injection rule (EXPRT-V126-04)**
- **D-09 — Neutralise by prefixing a single quote `'`** (the OWASP rule). It runs before the existing RFC-4180 quoting, so `=1+1` becomes `'=1+1`, and `=a,b` becomes `"'=a,b"`.
- **D-10 — Trigger characters:** a leading `=`, `+`, `-`, `@`, TAB (`\t`) or CR (`\r`).
- **D-11 — Purely numeric values are exempt.** A JS number, or a string matching a strict numeric pattern (e.g. `-5`, `-3.14`, `+1e6`), is written unchanged, so negative numbers stay numeric on re-import. Only text like `-2+3` or `=HYPERLINK(...)` gets the prefix.
- **D-12 — One function for every field, header names included.** The client (`packages/web/src/lib/csvExport.ts`) and the server port (new `packages/server/src/lib/csvExport.ts`) apply the **same** rule. Both need tests: `=1+1`, `=HYPERLINK("x")`, `@SUM(A1)`, `-2+3` and a leading-tab string come out neutralised; `-5`, `+1e6` and `-3.14` come out unchanged. Each test title must be new, so the check fails before the work is done (see CLAUDE.md).

**Failure, cancel and status**
- **D-13 — The partial file is deleted on ANY non-complete ending:** cancel, failure or session expiry. Only complete, closed files ever exist on disk. The SQLite row keeps the status, `rows_written`, `error_code` and message.
- **D-14 — Logout or expiry is detected at the next batch check.** Before every batch the runner re-derives credentials via `sessionStore.getSession(sid)`. If the session is missing or expired, it stops without starting another batch. At most one in-flight batch (≤ the per-call size) finishes on credentials already issued. Logout does **not** call into the runner, so the auth routes stay decoupled.
- **D-15 — Statuses: `queued` / `running` / `complete` / `failed` / `cancelled` / `session_expired`.** Session expiry is its own terminal status, as the operator chose over folding it into `failed`. Other failure reasons go in an `error_code` column (`kinetica_error`, `row_mismatch`, …) plus a readable message. The status column is CHECK-constrained, as `table_sync_history` is.
- **D-16 — Session-ended message:** "Export stopped: your session ended. Sign in and start it again."
- **D-17 — Never persist credentials** in the job row or on disk. The row stores the session id (or what the lookup needs), not tokens or passwords.

### Claude's Discretion
- Exact SQLite schema, column names and indexes for `export_jobs` (following `table_sync_history`), and whether it lives in `db.ts`.
- Module layout (`lib/exportSql.ts`, `lib/exportRunner.ts`, `lib/csvExport.ts`) and how the runner calls Kinetica without an Express `req`. `kineticaSql(req, sql, options)` takes a request today, so it needs a credential-shaped variant or adapter.
- How filter state reaches the job (`combinationKey` vs a full filter snapshot) and how the SQL is rebuilt server-side from the persisted widget config rather than from client-sent SQL (the research recommends the dynamic-view-preview trust model, not `/api/sql` passthrough).
- The batch size (default from `KINETICA_MAX_RECORDS_PER_CALL`), the progress write frequency, the temp directory and on-disk naming (the job id, never the user's display name).
- The streaming implementation (`pipeline()`, backpressure / `'drain'`) and a memory-bounded test at a large synthetic row count.
- Hooks for Phase 131: raw/formatted values and an optional gzip stage. Leave seams; don't build the UI.

### Deferred Ideas (OUT OF SCOPE)
- If the spike refutes row-order stability across split `kineticaSql` calls (D-04a), the fix to Phase 127's split-call path is a follow-up item, not Phase 128 scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| EXPRT-V126-04 | A cell beginning with `=`,`+`,`-`,`@` cannot execute as a formula, on BOTH download paths. Gap: `escapeCsvField` quotes only on `"`, `,`, CR, LF. | §Formula rule: the exact current function (`csvExport.ts:15-18`), the single-function design, strict numeric regex, parity-spec trick (server test imports the web module directly), anchors verified 0 today. |
| EXPRT-V126-05 | Background export has exactly the rows, columns, column order, sort the table shows, filters fixed at start (snapshot semantics). | §Filter state to the job, §SQL assembly (`handleDownloadCsv` dissected), §Snapshot semantics (MV refresh default OFF), §Spike protocol, §Runner loop with `total_rows` self-check. |
| EXPRT-V126-07 | User can cancel; partial file deleted. | §Cancel primitive: AbortController registry + `pipeline({signal})` + `.part` file + guarded terminal UPDATE. |
| EXPRT-V126-16 | Session end (logout/expiry) stops the job fail-closed, never on stale creds. | §Credentials: `getSession` per batch, absolute expiry (no sliding), URL-mismatch check, widen `kineticaSql`'s param type (type-only). |
</phase_requirements>

## Summary

The code-level picture is clear and mostly favourable. **`kineticaSql` only ever reads `req.user.{credentialType, creds.username, creds.password, creds.token}` and `req.requestId`** (`kinetica.ts:78-84`, `:259-267`) — nothing else from Express. A background job can therefore call it unchanged if its first parameter type is widened from `AuthedRequest` to `Pick<AuthedRequest, "user" | "requestId">` (a type-only change, zero runtime change) and the runner builds that small object from `getSession(sid)` immediately before each batch, using it for exactly one batch and discarding it. `createOrReplaceMaterialized` (`lib/materializedView.ts:30`) only forwards `req` to `kineticaSql`, so it needs the same one-line type widening. No credentials are cached or persisted; the job row holds `sid` + `username` only.

The records table's SQL is simple and fully reproducible server-side: `SELECT <cols|*> FROM <comboView ?? dvView ?? table> [WHERE (customWhere)] [ORDER BY sortField DIR]`. Two facts change the plan versus CONTEXT: (1) the **filter combination registry stores only `viewName`**, not the filters (`filterCombinationStore.ts:36-45`), and `combinationKey` is an 8-hex djb2 hash (`viewNaming.ts:44-50`) — lossy and not reversible, and the combination view lives only `DEFAULT_VIEW_TTL_MINUTES` (default **5**, `index.ts:198`) and is dropped by `DELETE /api/filter/materialize` when the user changes filters. So **the job must NOT read from the live combination view**; it must carry a filter snapshot (the same `{filters, spatialFilters, spatialTarget, dynamicViewId}` payload `POST /api/filter/materialize` already validates, `api/client.ts:945-962`) and build its OWN job-private `CREATE MATERIALIZED VIEW` from the base table/dv view via the existing trusted builders (`composeWhereClause`, `buildServerWhereClause`). (2) **The records table has no "hidden columns" concept** — `columnOrder` is just `cfg.columns` (IDENT_RE-filtered) or the response keys of `SELECT *` (`WidgetRenderer.tsx:2127, 2201-2203`). D-08's "hidden columns excluded" is automatically satisfied by "export exactly `cfg.columns`"; when `cfg.columns` is empty the header comes from the first batch's `column_headers`.

Pagination: per Kinetica docs, a `paging_table` named in `options` is created when the result exceeds one response, is returned-from without re-evaluating the query on later calls, and must be cleared by the caller; `paging_table_ttl` (-1 = no timeout) self-expires it. Materialized views default to `REFRESH OFF` (static snapshot). Plain `CREATE VIEW` is a "virtual table" (re-evaluated; **no** snapshot guarantee — inference, spike can cheaply confirm). Everything about stability/ordering/cleanup is unverified live and is the spike's job; this document gives the spike a concrete request-shape script and decision matrix.

**Primary recommendation:** Plan order = (1) formula-hardened `csvExport.ts` client+server with parity spec (independent, can run in Wave 1 parallel to the spike); (2) spike script + `128-SPIKE-NOTES.md` + `checkpoint:human-verify`; (3) after approval: `export_jobs` table + `lib/exportSql.ts` + `lib/exportRunner.ts` (job-private snapshot MV + chosen paging mechanism, `pipeline()` streaming to `<jobId>.csv.part` then rename, guarded terminal-state UPDATE, per-batch `getSession`).

## Standard Stack

### Core (zero new dependencies — confirmed against `packages/server/package.json`)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node built-ins `node:stream`, `node:stream/promises`, `node:fs`, `node:crypto` | Node v24.14.1 locally | Streaming CSV writer, `pipeline()` with AbortSignal, `randomUUID` job ids | No dependency; backpressure + error propagation built in |
| `better-sqlite3` | ^12.8.0 (installed) | `export_jobs` registry | Already the only DB; `table_sync_history` precedent (`db.ts:326`) |
| `vitest` | ^4.1.5 (installed) | Specs | Existing harness (`vitest.config.ts`: `tests/**/*.spec.ts`, `isolate: true`, `setupFiles: ./tests/setup.ts`) |
| `tsx` | ^4.7.0 (installed) | Spike script runner | Precedent: `npm run schema-fingerprint-spike` → `tsx src/spikes/...ts` (`package.json:13-17`) |
| `dotenv` | ^16.4.5 (installed) | Spike loads `packages/server/.env` | Precedent `schemaFingerprintSpike.ts:56-58` (`dotenv.config()` from cwd = `packages/server`) |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| In-process async job | BullMQ/agenda | Explicitly rejected by milestone research (single Node process, no Redis) |
| `csv-stringify` | — | Not needed; formula guard must be identical to the client function anyway |
| Adapter object cast to `AuthedRequest` | Widen param type to `Pick<AuthedRequest,"user"\|"requestId">` | **Use the widening** (type-only, no cast, tests that pass `{user:{...}} as unknown as AuthedRequest` keep compiling) |

**Installation:** none. **Version verification:** no new packages; Node/vitest/tsx versions read from checkout (`node -v` → v24.14.1; `package.json:45-47`).

## Architecture Patterns

### Recommended Project Structure
```
packages/server/src/
├── lib/csvExport.ts        # NEW  escapeCsvField (hardened) + rowsToCsv + csvLine helper (server port)
├── lib/exportSql.ts        # NEW  pure: ExportSpec + persisted widget config -> {snapshotDdl, countSql, batchSql, columns}
├── lib/exportRunner.ts     # NEW  startExport / cancelExport / getExport; in-memory Map<jobId, AbortController>
├── lib/exportJobsDb.ts?    # OR add CRUD to db.ts next to table_sync_history (db.ts is the established home; db.ts:812-875)
├── db.ts                   # + CREATE TABLE IF NOT EXISTS export_jobs (inside SCHEMA_DDL) + CRUD
├── kinetica.ts             # type-only: param type -> KineticaPrincipal
├── lib/materializedView.ts # type-only: req type -> KineticaPrincipal
└── spikes/exportPagingSpike.ts   # NEW  + "export-paging-spike" npm script
packages/web/src/lib/csvExport.ts # harden escapeCsvField (same rule)
packages/server/tests/  lib.csvExport.spec.ts, lib.csvExport.parity.spec.ts, db.exportJobs.spec.ts,
                        lib.exportSql.spec.ts, lib.exportRunner.spec.ts, lib.exportRunner.memory.spec.ts
```

### Pattern 1: Credential-shaped principal (EXPRT-V126-16)
**What:** `kineticaSql` reads only `req.user!.credentialType` (`kinetica.ts:255`), `req.user?.creds?.username` (`:249`), `buildAuthHeader` reads `credentialType`+`creds.*` (`:78-84`), `req.requestId` (`:250`). Sessions hold `{secret, credentialType, idToken, kineticaUrl, expiresAt}` (`sessionStore.ts:58-68`); `requireAuth` maps them to `req.user` at `auth.ts:186-198` — password mode puts `secret` in `creds.password`, OIDC mode in `creds.token`. **No OIDC refresh exists** (grep for refresh_token in `src/` → none); OIDC access-token expiry is enforced inside `getSession` (`sessionStore.ts:~232-243`, 30 s skew), so a dead token returns `null` → fail closed.
**Design:**
```typescript
// kinetica.ts (type-only widening)
export type KineticaPrincipal = Pick<AuthedRequest, "user" | "requestId">;
export const kineticaSql = async (req: KineticaPrincipal, sql: string, options: KineticaSqlOptions) => { ... }

// lib/exportRunner.ts
const principalFor = (sid: string): { principal: KineticaPrincipal } | { dead: true } => {
  const s = getSession(sid);                               // null if missing/expired/decrypt-fail/oidc-token-exp (it also deletes the row)
  if (!s) return { dead: true };
  if (s.kineticaUrl !== process.env.KINETICA_URL) { deleteSession(sid); return { dead: true }; } // mirrors loadSessionForRequest auth.ts:132-138
  return { principal: { requestId: randomUUID(), user: {
      sub: s.username, sid: s.sid, credentialType: s.credentialType,
      creds: { username: s.username,
               password: s.credentialType === "password" ? s.secret : "",
               token:    s.credentialType === "oidc"     ? s.secret : "" } } } };
};
// Source: mirrors auth.ts:186-198 verbatim
```
Rules: call `principalFor` **before every Kinetica call** (COUNT, each batch, snapshot DDL, cleanup DROPs); never store the principal on a job object/closure that outlives one call; do **not** call `touchSession` (it only updates `last_used_at`; `expires_at` is absolute — `sessionStore.ts:262`, so an export cannot extend a session, which is the desired fail-closed behaviour). Also map a `KineticaAuthError` thrown mid-batch to `session_expired`.
**Cleanup after session death:** the snapshot MV/paging table cleanup (`DROP TABLE IF EXISTS`) needs credentials that no longer exist. Therefore every Kinetica-side object MUST carry a TTL (`USING TABLE PROPERTIES (TTL = n)` / `paging_table_ttl`) as the safety net, and best-effort drop is skipped (log) when the session is gone. Phase 130 owns sweeping orphans; Phase 128 must name objects with a recognisable prefix (`_kbi_exp_<jobIdShort>`) so 130 can find them. **Planner: add this to the spike's cleanup question** ("is TTL-expiry of an MV/paging table verified live?").

### Pattern 2: Filter state to the job = filter SNAPSHOT, not `combinationKey`
Evidence:
- Registry entry = `{viewName, expiresAt, materializing, materializeVersion, refCount, dashboardId, sourceType, sourceId}` — **no filters** (`filterCombinationStore.ts:36-45`).
- `combinationKey` is `hashKey8(...)` = djb2 truncated to 8 hex (`viewNaming.ts:44-50`); view name `_kbi_filt_u<user>_d<dash>_t<tableId>_s<sid8>_c<hash8>` (`:112-130`). Name only; collision-prone, not reversible.
- Combination view TTL = `DEFAULT_VIEW_TTL_MINUTES` default 5 (`index.ts:198`), sliding via a *mounted-tab* keepalive (`hooks/useViewKeepAlive.ts`); `DELETE /api/filter/materialize` (`index.ts:1455`) drops it when filters change. A multi-minute export reading it would break mid-job or silently change.
- `POST /api/filter/materialize` already accepts and validates exactly the needed shape (`index.ts:1274-1340`: `filters: ActiveFilter[]`, `spatialFilters`, `spatialTarget`, `dynamicViewId`; rejects spatial on dv path; 501 for WKB; pair-completeness) and builds the WHERE via trusted builders (`composeWhereClause` `spatialWhereClause.ts:194`; `buildServerWhereClause` `whereClause.ts:86`, which escapes string literals).
**Recommendation:** `ExportSpec = { widgetId, sortField?, sortDir?, filters: ActiveFilter[], spatialFilters?, spatialTarget? }`. Phase 131's client sends the same resolved args its orchestrator already sends to `materializeFilter`. The server loads the **persisted** widget (`getWidget(id)`, `db.ts:606`; `widgets.config` JSON) and takes `table`/`tableId`/`dynamicViewId`/`columns`/`customWhere` from it — never from the request. Ownership/dashboard access checks are Phase 129; Phase 128's `startExport` takes `dashboardId` from the widget row. Reuse (extract if needed) the validation steps of the materialize handler into `lib/exportSql.ts` rather than duplicating; do not call the route.
Trust model = dynamic-view preview (`index.ts:1884-1960`): table ref from `getTable(id)` DB row (`schema.name`), user-controlled pieces only enter through the escaping builders or IDENT_RE-validated identifiers, executed under the user's own Kinetica creds. `customWhere` is raw SQL from persisted config — same trust as today's client path (`customWhere.ts:5`: "raw SQL is trusted per VIZSQL out-of-scope"); executing it under the user's creds adds no privilege.

### Pattern 3: SQL assembly (what `handleDownloadCsv` does, `WidgetRenderer.tsx:2029-2100`)
| Piece | Client source | Server rebuild |
|---|---|---|
| FROM | `comboEntry.viewName` (table path: `?? ""` → falls to `table`; dv path: `comboViewName \|\| recordsDvViewName`) `:2040-2043` | **Not used.** Table path: `schema.name` from `getTable(cfg.tableId)`. Dv path: `buildDynamicViewName({userId: username, dashboardId, dynamicViewId})` (`lib/dynamicViewName.ts:22-24`, `_kbi_dv_u<user>_d<dash>_<id>`) — requires the dv's own MV to exist (as in materialize handler `index.ts:1343-1357`); fail `kinetica_error`/clear message if missing. |
| WHERE (filters) | implicit via combo view | `composeWhereClause(filters, spatialFilters, spatialTarget)` (table) / `buildServerWhereClause(filters)` (dv; columns-only) — evaluated ONCE into the snapshot MV |
| `cw` | `whereCustomWhere(cfg.customWhere)` → ` WHERE (<p>)`, or `""` (`customWhere.ts:34-37`) | Apply **inside the snapshot MV** together with filters: `WHERE (<filterWhere>) AND (<customWhere>)`. Beware: client applies `cw` as `WHERE` *on top of* a combo view; equivalent. If no filters: only `WHERE (<cw>)` or none. |
| columns | `columnOrder.length>0 ? columnOrder : effectiveColumns`; `colsClause = cols.join(", ") \|\| "*"` (`:2045-2046`); `columnOrder` is set from `effectiveColumns` or first-row keys (`:2203`); `effectiveColumns = safeColumns = cfg.columns.split(",").trim().filter(IDENT_RE)` (`:1913-1914, 2127`) | same: `cfg.columns` split + `IDENT_RE = /^[a-zA-Z_][a-zA-Z0-9_.]*$/` (`:1909`). Empty → `SELECT *`; header = first batch `column_headers`. |
| ORDER BY | `sortField && IDENT_RE.test(sortField) ? " ORDER BY f DIR"` (`:2047-2050`); `sortField` is **interactive client state** initialised from `cfg.sortField`/`cfg.sortDirection` (`:1915-1916, 1997-1998`) | Must be sent by client in `ExportSpec` (`sortField`, `sortDir`), validated with the same `IDENT_RE` and `dir ∈ {asc,desc}`. If absent, fall back to persisted `cfg.sortField`. |
| LIMIT/OFFSET | `LIMIT ${limit} OFFSET ${offset}` inside the SQL (`:2062`) | Runner uses request-level `extra.{limit,offset}` (kineticaSql supports it, `kinetica.ts:261-267`) with **no** LIMIT in SQL |
Pitfall: `ORDER BY sortField` where `sortField` ∉ selected columns is legal against the base relation but the snapshot MV must therefore be `SELECT * FROM <source> WHERE ...` (as the combination views do, `index.ts:1445`) — never `SELECT <cols>` — so the export query `SELECT <cols> FROM <mv> ORDER BY <sort>` can sort on any column exactly like the client does.

### Pattern 4: Runner loop (shape; mechanism pending spike)
```
startExport(spec, {sid, username}) -> insert row 'queued' -> void run(jobId).catch(finalizeFailed)  // never an unhandled rejection
run:
  mark running(started_at)
  principal0 <- principalFor(sid)            // dead -> session_expired
  snapshot  : createOrReplaceMaterialized({view:`_kbi_exp_${id8}`, sqlBody:`SELECT * FROM ${src} WHERE ...`, ttl: EXPORT_VIEW_TTL_MINUTES, op:"MATERIALIZE", route:"export"})
  total_rows: SELECT COUNT(*) AS total FROM snapshot  -> store (D-07)
  open `${dir}/${jobId}.csv.part` (mode 0o600); pipeline(Readable.from(rowChunks()), [gzip?], ws, {signal})
  rowChunks (async generator):
     yield header line (from cfg.columns or first batch column_headers)
     loop: assertNotAborted(); principal <- principalFor(sid) (dead -> throw SessionEnded)
           r <- kineticaSql(principal, batchSql, {route, op:"SQL", extra:{limit: batch, offset, [options:{paging_table,...}]}})
           rows = transpose(r)               // column-major {column_headers, column_1..N} -> rows
           offset += rows.length             // advance by ACTUAL count, never by requested limit (Phase 127 lesson, kinetica.ts:331-335)
           yield csv lines; update rows_written (once per batch)
           stop when has_more_records === false (or rows.length === 0) -- NEVER on a short page
  finally: rename .part -> .csv ONLY if rows_written === total_rows else fail row_mismatch; always drop MV/paging table (best-effort, TTL safety net)
```
- Batch size = `min(getRowLimitConfig().maxRecordsPerCall, maxRowsPerQuery)` (`kinetica.ts:~196-199`; **kineticaSql clamps `extra.limit` to `maxRowsPerQuery` at `:261-263` and splits by `maxRecordsPerCall`**, so passing a bigger limit is silently split — the runner should pass `limit = min(...)` so one `postPage` ≈ one batch and cancel/session checks happen at batch granularity). Env is read per call (`getRowLimitConfig`), dev `.env` leaks (`KINETICA_MAX_*` commented at `.env:63-65`; see MEMORY "Dev .env leaks into server vitest" — `tests/setup.ts:27-29` pins `""` for these).
- Result shape: `encoded` is column-major `{column_headers: string[], column_1: [...], ...}` (`kinetica.ts:~200-215` `NON_DATA_KEYS`, `rowCount`; documented consumer `index.ts:1960-1980`). Transpose with `column_headers.length`, positional `column_${i+1}`. kineticaSql returns the merged object plus `has_more_records` / `total_number_of_records` (`kinetica.ts:~340-352`).
- Final `rows_written === total_rows` check else `row_mismatch` (D-07). Note a COUNT taken on the snapshot MV is exact only because the MV is static (REFRESH OFF default, docs) — this is the real snapshot guarantee; verify in spike (insert is not allowed in read-only spike; document by doc + the identical-count-across-two-reads check).

### Pattern 5: Streaming writer with backpressure
Use `Readable.from(asyncGenerator)` → `pipeline()` from `node:stream/promises` with `{ signal }`. `pipeline` handles `'drain'` backpressure, error propagation and destroys all streams on abort; the generator's `finally` runs on early termination. Do **not** hand-write `ws.write()`/`once(ws,'drain')` loops. Phase 131 seam: `pipeline(src, ...(gzip ? [createGzip()] : []), ws, {signal})` and a `mapRow(row, columns) => unknown[]` option (raw default; formatted later). Line format must be byte-identical to client `rowsToCsv`: `\r\n` **between** lines, **no trailing CRLF**, no BOM (`csvExport.ts:28-34`) — emit `(first ? "" : "\r\n") + line`.
File lifecycle (D-13): write `<jobId>.csv.part`, `rename` to `<jobId>.csv` only on verified success; on any other ending `fs.rm(part, {force:true})`. Directory: new env `EXPORT_DIR` (operator prefers env config — MEMORY "prefers-env-config"), default `path.join(path.dirname(DB_PATH), "exports")`-style (`db.ts:500` `defaultDbPath`), tests use `fs.mkdtempSync(os.tmpdir()/kbi-exp-)`. Never use the user's display name on disk (CONTEXT).

### Pattern 6: Cancel + terminal-state discipline
- `Map<jobId, AbortController>`; `cancelExport(id)` → `controller.abort()`; runner catches `AbortError` → delete `.part`, best-effort DROP, finalize `cancelled`.
- **All terminal writes go through one `finalize(id, status, fields)` with `UPDATE ... WHERE id=? AND status IN ('queued','running')`** and check `changes`; otherwise cancel-after-complete (or session-expiry racing cancel) overwrites the real outcome. Precedent for guarded single-statement writes: `db.ts:826-837`.
- kineticaSql has no `AbortSignal` (fetch at `kinetica.ts:271`), so cancel latency ≤ one in-flight batch + the check at the next loop top — same granularity as D-14. Optional additive: accept `signal?` in `KineticaSqlOptions` and pass to `fetch`; not required.
- Cancel of a job not in the Map (e.g. server restarted): mark `cancelled`/delete file — Phase 130 reconciliation owns the boot case; expose a helper.

### Pattern 7: `export_jobs` schema (follow `table_sync_history`, `db.ts:326-335`)
```sql
CREATE TABLE IF NOT EXISTS export_jobs (
  id TEXT PRIMARY KEY,                       -- randomUUID(); also the on-disk file stem
  username TEXT NOT NULL,                    -- owner (Phase 129 ownership check)
  sid TEXT NOT NULL,                         -- session lookup key ONLY; never creds (D-17)
  dashboard_id INTEGER, widget_id INTEGER,   -- no FK: deleting a widget must not cascade away history
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK(status IN ('queued','running','complete','failed','cancelled','session_expired')),
  error_code TEXT, error_message TEXT,
  total_rows INTEGER, rows_written INTEGER NOT NULL DEFAULT 0,
  file_path TEXT, file_bytes INTEGER,
  spec_json TEXT NOT NULL,                   -- the ExportSpec (filters snapshot) for audit/Phase 131 history
  options_json TEXT,                         -- raw/formatted + gzip seam (Phase 131)
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  started_at TEXT, finished_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_export_jobs_user ON export_jobs (username, created_at DESC);
```
Migration: it is a NEW table, so `CREATE TABLE IF NOT EXISTS` in `SCHEMA_DDL` alone covers fresh + existing DBs; **no PRAGMA-guarded ALTER** (explicit comment `db.ts:~321-324`). Table-count assertions in existing specs all use `toContain` (`db.rbacMigration.spec.ts:70-74`, `db.smoke.spec.ts:20-26`), so adding a table ripples nothing. CRUD: add next to `insertTableSyncHistoryEntry` (`db.ts:~812`); `db` is module-singleton (`db.ts:500-501`) and `createDb(":memory:")` for isolated tests. Order by `rowid`/`created_at`+id — `datetime('now')` has 1 s resolution (see `db.ts` comment) so don't order by `created_at` alone.

### Anti-Patterns to Avoid
- Reading from the live combination view / using `combinationKey` as filter state (stale, TTL 5 min, droppable, lossy).
- `SELECT <cols>` in the snapshot MV (breaks `ORDER BY` on non-selected sort column).
- Breaking the loop on `rows.length < limit` (Phase 127 root cause of the silent 1,000-row file, `WidgetRenderer.tsx:2068-2071`).
- Advancing OFFSET by the requested limit instead of rows received.
- Capturing `req`/creds in a long-lived closure, or `touchSession` from the job.
- Sending client-provided SQL (`/api/sql` passthrough). Note `/api/sql` forwards arbitrary `options` as `extra` (`index.ts:2915-2925`): that is exactly why the job must not reuse that route's trust model.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Backpressure/abort/cleanup of a write pipeline | manual `write()`/`'drain'` loops | `stream/promises.pipeline` + `Readable.from(asyncGen)` + `signal` | Handles drain, error, destroy, generator `finally` |
| WHERE from filters | string concat | `composeWhereClause` / `buildServerWhereClause` | Escapes literals (`escapeKineticaStringLiteral`, `whereClause.ts:63`); spatial OR-chain already tested |
| Snapshot DDL + race retry | raw CREATE | `createOrReplaceMaterialized` (`lib/materializedView.ts:30`) | Has the TM/SMc:1078 "Could not find the table" retry; adds TTL |
| Retry/typed Kinetica errors + audit | new fetch wrapper | `kineticaSql` (widened type) | Auth/permission/upstream classification (`kinetica.ts:~100-135`), audit lines without SQL or auth |
| Row-limit env parsing | new env reader | `getRowLimitConfig()` (`kinetica.ts:~176-181`) | Already positive-int validated + warned |
| Session validity | own expiry logic | `getSession(sid)` | Does expiry, decrypt-fail, OIDC token-exp in one call and deletes dead rows |
| CSV quoting + formula guard | second implementation with different rules | one function, ported identically + parity spec | D-12 |

## Common Pitfalls

### Pitfall 1: Spike script payload is not production-parity
**What goes wrong:** Phase 18's spike got HTTP 400 on every probe: `Value: '' not a valid parameter. Valid values are: binary, json, geojson, arrow` because `runSql` omitted `encoding`, `request_schema_str`, `data`, `options`, `offset` (`18-SPIKE-NOTES.md:14-18`).
**How to avoid:** Send the full body `{statement, encoding:"json", request_schema_str:"", data:[], options:{...}, offset, limit}` exactly like `kinetica.ts:271-285`; or call `kineticaSql` itself via a synthetic principal for the D-04 probes and raw `fetch` only where the raw envelope is needed (paging_table name).

### Pitfall 2: `paging_table` output only visible in the raw body
`kineticaSql` returns the merged `encoded` + `has_more_records` + `total_number_of_records`, but **drops `paging_table` / `result_table_list`** (`kinetica.ts:~340-352`; `body` is internal). If the caller supplies the paging-table name itself (recommended: `_kbi_exp_pg_<id8>`), the name is known without reading it back. Spike must still capture the raw `data_str` once to prove the actual name/schema Kinetica gave it (docs: output `paging_table` "Valid when has_more_records is true") and **that no paging table is created when the result fits in one response** (docs: created "when the output has more records than are in the response") → cleanup must be `DROP TABLE IF EXISTS`.
**Option placement:** kineticaSql sends `options: {}` then spreads `restExtra` (`kinetica.ts:278-284`), so `extra: { options: { paging_table: "...", paging_table_ttl: "60" } }` REPLACES the options object wholesale. Option values are strings in Kinetica's REST schema (use `"60"`, not `60`) — verify live.

### Pitfall 3: `has_more_records` as exhaustion signal vs `END_OF_SET`
Docs: `limit` may be `END_OF_SET (-9999)` = "maximum allowed by the server"; `kineticaSql`'s clamp (`isPositiveInt`, `:261-263`) rejects non-positive limits, so a sentinel can't be passed through it. Use explicit positive limits (CONTEXT/STATE: "export job always passes its own explicit extra.limit").

### Pitfall 4: Deep OFFSET re-executes and re-sorts the whole query each batch
Without a paging table, each batch re-runs `SELECT ... ORDER BY ...` (`results_caching` defaults **true** — docs; may mask or cause stability — record it). 1M rows / 20k = 50 batches, each sorting up to 1M rows. The spike MUST record time-per-batch at offset 0, mid, and last for the OFFSET path; if it grows materially, that is a hard argument for `paging_table`.

### Pitfall 5: `max_get_records_size` may differ from the env default
Docs: "maximum number of records the database will serve for a given data retrieval call. Max allowed 1000000", runtime-modifiable. Read live with `SHOW SYSTEM PROPERTIES WITH OPTIONS ('properties' = 'max_get_records_size')` (may need admin rights; fall back to the empirical probe: ask limit=100000 and observe returned count + `has_more_records`). Phase 127 D-11's warning path (`kinetica.ts:~215-226, 356-360`) only logs; verify it (D-04b) by setting `process.env.KINETICA_MAX_ROWS_PER_QUERY` and `KINETICA_MAX_RECORDS_PER_CALL` high inside the spike process (both are read per call).

### Pitfall 6: Row order across split `kineticaSql` calls (D-04a)
`kinetica.ts:~327-329` states order stability without a unique ORDER BY is undocumented. Spike: read the same table (a) in one call with a large limit, (b) as N split calls (via `kineticaSql` with `maxRecordsPerCall`=small), (c) repeated 3×; compare the sequences by a cheap fingerprint (running hash of a PK/all-columns tuple) and report identical/not. Refuted → follow-up note only (Deferred).

### Pitfall 7: Precision/format of values in JSON encoding
Long/timestamp values arrive as JSON numbers (epoch ms for timestamps; `JSON.parse` loses >2^53 integers). The raw export is what the server gets; "formatted" is Phase 131. Note in SPIKE-NOTES one sample of each column type so Phase 131 knows. (LOW confidence — not verified here.)

### Pitfall 8: Orphaned Kinetica objects when the session dies or the process crashes
See Pattern 1. Always TTL the MV (`USING TABLE PROPERTIES (TTL = n)` is what `createOrReplaceMaterialized` emits, `:31`) and `paging_table_ttl`. Choose job-view TTL ≥ max expected export duration (new env `EXPORT_VIEW_TTL_MINUTES`, default e.g. 60) — NOT `DEFAULT_VIEW_TTL_MINUTES` (5).

### Pitfall 9: Formula guard changes existing byte output
Existing client tests contain no value starting with `=+-@`/tab (`csvExport.spec.ts:9-79`), and the only other consumer of `rowsToCsv` is `WidgetRenderer.tsx:2077`; `WidgetRenderer.spec.tsx` only asserts SQL text (`:2626-2628`), no CSV body. Safe. Header names go through the same function (D-12): a column literally named `-x` gets `'-x` — accepted by decision.

## Code Examples

### Formula guard (D-09..D-12) — identical in web and server
```typescript
// Strict numeric: optional sign, digits with optional fraction (or leading dot), optional exponent.
const NUMERIC_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
const FORMULA_LEAD = /^[=+\-@\t\r]/;

export function escapeCsvField(value: unknown): string {
  let s = value == null ? "" : String(value);
  const isNumeric = typeof value === "number" || NUMERIC_RE.test(s);
  if (!isNumeric && FORMULA_LEAD.test(s)) s = "'" + s;       // BEFORE quoting
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
// '=1+1' -> "'=1+1"   '=a,b' -> "\"'=a,b\""   '-5' -> '-5'   '+1e6' -> '+1e6'   '-2+3' -> "'-2+3"
// "\tx" -> "'\tx" (TAB is not in the quoting regex; fine)   "\rx" -> "\"'\rx\"" (quoted by CR rule)
```
Number edge: `typeof value === "number"` with `NaN`/`Infinity` → `String` gives "NaN"/"Infinity" (no trigger char); `-Infinity` starts with `-` and is not NUMERIC_RE → prefixed; acceptable. `BigInt` leads stringify to digits.
Parity spec trick (no cross-package code sharing, precedent: tests already parse `packages/web/src/lib/columnTypes.ts`, `lib.columnTypeClass.spec.ts:21`, `lib.schemaApply.spec.ts:272-294`): server test imports `../../web/src/lib/csvExport` (pure module, zero imports) and runs one shared vector table against BOTH implementations; `tsconfig.json` `include: ["src"]` means tests aren't type-checked by `tsc --noEmit`, and vitest doesn't care about rootDir.

### Spike script request shapes (`packages/server/src/spikes/exportPagingSpike.ts`, `npm run export-paging-spike`)
```typescript
import dotenv from "dotenv"; dotenv.config();                       // cwd = packages/server (schemaFingerprintSpike.ts:56-58)
const post = (statement: string, extra: Record<string, unknown> = {}) =>
  fetch(`${KINETICA_URL}/execute/sql`, { method: "POST",
    headers: { "Content-Type": "application/json",
               Authorization: "Basic " + Buffer.from(`${U}:${P}`).toString("base64") },
    body: JSON.stringify({ statement, encoding: "json", request_schema_str: "", data: [],
                           options: {}, offset: 0, limit: 20000, ...extra }) })   // full parity (Pitfall 1)
  .then(r => r.json());
// envelope: body.data_str (JSON string) -> .json_encoded_response (JSON string, column-major) ,
//           .has_more_records, .total_number_of_records, .paging_table, .result_table_list
// A. paging_table path
await post(`SELECT * FROM ${BIG}`, { limit: 20000, offset: 0,
  options: { paging_table: PG, paging_table_ttl: "30" } });          // then offset += rows.length until has_more_records === false
// B. cleanup: await post(`DROP TABLE IF EXISTS ${PG}`)  (also try /clear/table if DROP is refused)
// C. snapshot MV path (allowed, must be dropped): CREATE MATERIALIZED VIEW _kbi_exp_spike AS (SELECT * FROM BIG) USING TABLE PROPERTIES (TTL = 10)
//    then SELECT COUNT(*) ; paged SELECT ... ORDER BY <composite> with request-level offset/limit; DROP TABLE IF EXISTS _kbi_exp_spike
// D. plain view probe: CREATE VIEW (virtual) -> compare plan/behaviour; confirms "no snapshot" (docs only call it a "virtual table")
// E. max_get_records_size: SHOW SYSTEM PROPERTIES WITH OPTIONS ('properties' = 'max_get_records_size'); else empirical limit=100000 probe
// F. D-04a/b via kineticaSql with synthetic principal { user:{credentialType:"password", creds:{username,password,token:""}, sub, sid:"spike"} }
```
Row-exactness check for A and C: total rows read == `COUNT(*)`; dedupe by a fingerprint set (use PK if one exists else hash of all columns; duplicate rows are legitimately identical so compare multiset counts, not set size); record `has_more_records` per page and that the LAST page is `false`; record ms per batch (first/mid/last).
Decision matrix to put in `128-SPIKE-NOTES.md` (checkpoint artifact): paging_table passes iff {exact rows, last `has_more_records=false`, readable after ≥ TTL-sized delay (re-read page 2 after waiting), DROP works, name captured}. Else OFFSET+composite ORDER BY with MV snapshot.

### Memory-bounded test (vitest, deterministic — no heap sampling flake)
```typescript
// lib.exportRunner.memory.spec.ts — drive the real writer with a lazy 1,000,000-row generator into a SLOW sink.
let produced = 0, consumed = 0, maxLag = 0;
async function* rows() { for (let i = 0; i < 1_000_000; i++) { produced++; yield [i, "x".repeat(40)]; } }
const sink = new Writable({ highWaterMark: 64 * 1024,
  write(chunk, _e, cb) { consumed += chunk.length; maxLag = Math.max(maxLag, produced_bytes_est - consumed); setImmediate(cb); } });
// assert: rows were pulled lazily (produced - rowsDrained stays under a few thousand), not 1M buffered;
//        and (optionally) process.memoryUsage().heapUsed delta < ~100MB with a generous bound.
```
Prefer asserting laziness (`produced` never more than N rows ahead of what the sink has accepted) over absolute heap numbers; add the heap bound as a loose secondary assert only. Run time target < 5 s (use 200k–1M tiny rows).

### Runner unit test harness (precedent `tests/kinetica.rowLimit.spec.ts:1-45`)
`vi.stubGlobal("fetch", …)` returning `respond({column_headers:[...], column_1:[...]}, {has_more_records: true|false, total_number_of_records: n})`; real sessions via `createSession({username,secret,kineticaUrl: process.env.KINETICA_URL})` (`tests/helpers/db.ts:15`) and `deleteSession(sid)` to simulate logout between batches; assert (a) no fetch occurs after the session is deleted, (b) status `session_expired`, (c) `.part`/`.csv` absent, (d) no `Authorization` value appears in any DB row (`SELECT * FROM export_jobs` serialised must not contain the secret). Fake session expiry by `createSession` + manual `UPDATE sessions SET expires_at = datetime('now','-1 minute')`.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Client LIMIT/OFFSET loop, 5,000-row pages, whole CSV in a Blob (`WidgetRenderer.tsx:2054-2085`) | Server job: snapshot + streamed file | This milestone | Browser holds no rows; cancel/progress possible |
| Envelope `limit: 1000` hard-coded | Phase 127: `KINETICA_MAX_ROWS_PER_QUERY`/`KINETICA_MAX_RECORDS_PER_CALL` + `has_more_records` paging | Phase 127 | Runner passes explicit limit |
| `escapeCsvField` quotes on `",\r\n` only | + OWASP `'` prefix, numeric exempt | Phase 128 | Applies to the existing browser download immediately |

**Deprecated/outdated:** `.planning/codebase/TESTING.md` ("No testing framework detected", dated 2026-03-23) is stale — vitest is installed and ~100 server specs exist. Do not trust it.

## Open Questions

1. **Does `paging_table` need `has_more_records=true` to materialise, and is it reusable across *different* `offset` calls with the same name when later calls pass the same SQL?** Docs say yes ("If the specified paging table exists, the records … returned without re-evaluating the query"). Spike A answers it live.
2. **Can `DROP TABLE <paging_table>` (SQL) clean it, or must `/clear/table` be used?** Docs only say the caller must clear it and give no syntax. Spike B.
3. **Does ORDER BY inside the paged statement affect paging-table creation cost/ordering?** Spike: run A with and without a user sort.
4. **TTL expiry of a MV/paging table when the session is dead** — unverified; needed for crash/logout safety. Spike can create with `TTL = 1` and re-check after ~70 s (or note as "doc-only").
5. **`SHOW SYSTEM PROPERTIES` permission for the BI user** — may be denied; fallback = empirical probe.
6. **Which table is ≥50k rows and readable?** Executor discovers via `SELECT table_name, ... FROM INFORMATION_SCHEMA...` / `/show/table` size; record name + count (D-02).
7. **No `hidden columns`:** CONTEXT D-08 mentions them but the records table has none (see Summary). Planner: implement as "exactly `cfg.columns`" — flag to the operator at the spike checkpoint if they believe hidden columns exist (display-config store `columnDisplayConfigStore` affects formatting, not column set — not verified in depth).
8. **Column-less widgets (`SELECT *`):** column order = Kinetica schema order from `column_headers`; verify first-batch headers equal on-screen order (the client derives it from the same response keys, `WidgetRenderer.tsx:2203`).

## Validation Architecture

> `.planning/config.json` not read for the flag; treated as enabled (key absent assumed).

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest ^4.1.5 (server and web) |
| Config file | `packages/server/vitest.config.ts` (include `tests/**/*.spec.ts`, `setupFiles ./tests/setup.ts`, `isolate: true`); web: existing config in `packages/web` |
| Quick run (server) | `cd packages/server && npx vitest run tests/lib.csvExport.spec.ts tests/lib.csvExport.parity.spec.ts tests/db.exportJobs.spec.ts tests/lib.exportSql.spec.ts tests/lib.exportRunner.spec.ts tests/lib.exportRunner.memory.spec.ts` |
| Quick run (web) | `cd packages/web && npx vitest run src/lib/csvExport.spec.ts` |
| Full suite | server: `cd packages/server && npm run test:gate` (SET-BASED, `scripts/test-gate.mjs`); `npx tsc --noEmit` both packages; web: `npx vitest run` + `npx vitest run src/styles/theme-guard.spec.ts` |

**Known-failing set (TD-V16-TEST-ISOLATION):** recorded in `packages/server/scripts/test-gate.mjs:36-45` (`KNOWN_FAILING` Map — `auth.oidc`, `auth.routes`, `boot.hardening`, `boot.wipe`, `bootstrap`, `oidc.module`, `db.smoke`, `routes.wms`) plus a *rotating* contamination set that is allowed iff the file passes when re-run alone (gate logic header, `test-gate.mjs:3-23`); STATE.md:179,243 records which files rotated. Gate rule for this phase: new specs must pass in isolation AND in the full run; never assert a pass-count. (ROADMAP.md:157 notes the contamination attribution itself is under suspicion; not this phase's job.) Dev `.env` leak: `DEFAULT_VIEW_TTL_MINUTES=3` — the gate script blanks it; `tests/setup.ts:27-29` blanks the row-limit envs. If the runner introduces new env knobs (`EXPORT_DIR`, `EXPORT_VIEW_TTL_MINUTES`), pin them in `tests/setup.ts` too.

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| EXPRT-V126-04 | `=1+1`, `=HYPERLINK("x")`, `@SUM(A1)`, `-2+3`, `\tx` neutralised; `-5`, `+1e6`, `-3.14` unchanged; headers too; quoting after prefix | unit (web + server) | `npx vitest run tests/lib.csvExport.spec.ts` / `src/lib/csvExport.spec.ts` | ❌ Wave 0 (server file new; web spec extended) |
| EXPRT-V126-04 | client === server for the same vector table | parity | `npx vitest run tests/lib.csvExport.parity.spec.ts` | ❌ Wave 0 |
| EXPRT-V126-05 | SQL built from persisted widget config: columns/order/ORDER BY/customWhere/dv-vs-table FROM, `SELECT *` snapshot, IDENT_RE rejection, tiebreak ORDER BY (if OFFSET) | unit | `npx vitest run tests/lib.exportSql.spec.ts` | ❌ Wave 0 |
| EXPRT-V126-05 | multi-batch loop: offset advances by rows received; stops on `has_more_records=false` not short page; `rows_written===total_rows`; `row_mismatch` fail; output equals web `rowsToCsv` byte-for-byte | unit (fetch stub) | `npx vitest run tests/lib.exportRunner.spec.ts` | ❌ Wave 0 |
| EXPRT-V126-05 | snapshot semantics live (count stable, exact rows) | **live spike** (manual, checkpoint) | `npm run export-paging-spike` → `128-SPIKE-NOTES.md` | ❌ Wave 0 |
| EXPRT-V126-07 | cancel mid-run: loop stops, `.part` and final file absent, row `cancelled`, MV drop attempted; cancel after complete does not overwrite | unit | `npx vitest run tests/lib.exportRunner.spec.ts -t cancel` | ❌ Wave 0 |
| EXPRT-V126-16 | session deleted / expired between batches: no further fetch, `session_expired`, message D-16, file removed; no secret in DB row | unit | `npx vitest run tests/lib.exportRunner.spec.ts -t session` | ❌ Wave 0 |
| (D-15) | status CHECK constraint rejects unknown status; table exists on fresh + reopened DB | unit | `npx vitest run tests/db.exportJobs.spec.ts` | ❌ Wave 0 |
| (memory) | 1M-row lazy stream with slow sink stays bounded | unit | `npx vitest run tests/lib.exportRunner.memory.spec.ts` | ❌ Wave 0 |
| (UX) | "stopped" message wording shown to user | manual-only (Phase 131 UI) | — | n/a |

### Test-title anchors (CLAUDE.md "grep must fail before the work") — verified 0 hits today
Repo-wide grep (`packages/server/src`, `packages/server/tests`, `packages/web/src`) on 2026-10-06 returned **0** for: `FORMULA-`, `neutralizeFormula`, `export_jobs`, `exportRunner`, `session_expired`, `row_mismatch`, `paging_table`, `startExport`, `cancelExport`, `128-SPIKE`. Use titles beginning `FORMULA-eq:`, `FORMULA-plus:`, `FORMULA-at:`, `FORMULA-minus-text:`, `FORMULA-tab:`, `FORMULA-numeric-exempt:`, `FORMULA-header:`, `FORMULA-quote-order:`, `PARITY-…`, `RUNNER-…`, `CANCEL-…`, `SESSION-…`. **Do NOT use `exportSql` as an anchor** — it already occurs 2× as a local variable in `WidgetRenderer.spec.tsx:2626-2628`; anchor on the file path `lib/exportSql` instead (grep `-l "lib/exportSql"` → 0 today; re-run before committing the criterion). Behavioural criteria that cannot be grep-proven ("cancel feels immediate", message legibility) go to `checkpoint:human-verify`.

### Sampling Rate
- **Per task commit:** the single spec file touched (< 10 s each).
- **Per wave merge:** quick-run list above + `npx tsc --noEmit` both packages.
- **Phase gate:** `npm run test:gate` (server) + web `npx vitest run` + theme-guard green; plus `128-SPIKE-NOTES.md` exists and operator-approved before runner plans execute.

### Wave 0 Gaps
- [ ] `packages/server/src/lib/csvExport.ts` + `tests/lib.csvExport.spec.ts` + `tests/lib.csvExport.parity.spec.ts`
- [ ] extend `packages/web/src/lib/csvExport.spec.ts` (current titles at `:9-79`; none start with `FORMULA-`)
- [ ] `tests/db.exportJobs.spec.ts` (mkTempDbPath pattern from `db.syncHistory.spec.ts:~38-52`; or `createDb(":memory:")`)
- [ ] `tests/lib.exportSql.spec.ts`, `tests/lib.exportRunner.spec.ts`, `tests/lib.exportRunner.memory.spec.ts`
- [ ] `src/spikes/exportPagingSpike.ts` + `"export-paging-spike": "tsx src/spikes/exportPagingSpike.ts"` in `packages/server/package.json`
- [ ] Framework install: none needed

## Sources

### Primary (HIGH confidence — read directly from checkout)
- `packages/server/src/kinetica.ts` (credential use `:78-84,249-267`; paging loop `:~327-360`; row-limit config `:~176-199`)
- `packages/server/src/sessionStore.ts` (`getSession` `:~193-258`, `touchSession` `:262`, `deleteSession` `:265`), `auth.ts:20-45,120-200`
- `packages/server/src/lib/materializedView.ts`, `viewNaming.ts`, `db.ts:326-350,806-875,500-501`, `index.ts:198,1274-1455,1884-1960,2915-2925`
- `packages/web/src/components/charts/WidgetRenderer.tsx:1909-1916,1960-2000,2029-2100,2127,2188-2203`; `lib/csvExport.ts`; `lib/customWhere.ts`; `store/filterCombinationStore.ts:36-45`; `api/client.ts:940-1010`
- `packages/server/scripts/test-gate.mjs`, `tests/setup.ts`, `tests/helpers/db.ts`, `tests/kinetica.rowLimit.spec.ts`
- Kinetica docs `/execute/sql` (7.2): https://docs.kinetica.com/7.2/api/rest/execute_sql_rest/ and https://docs.kinetica.com/content/api/rest/execute_sql_rest.md — `paging_table`, `paging_table_ttl`, `has_more_records`, `total_number_of_records`, `paging_table` output, `results_caching`, `limit`/`END_OF_SET`, caller must clear paging tables
- Kinetica system properties: https://docs.kinetica.com/7.2/sql/system_properties/ — `SHOW SYSTEM PROPERTIES WITH OPTIONS ('properties'=...)`, `max_get_records_size` (max 1,000,000, runtime-modifiable)
- Kinetica CREATE MATERIALIZED VIEW: https://docs.kinetica.com/7.2/sql/ddl/create-materialized-view/ — default `REFRESH OFF`, no auto-refresh on source change

### Secondary (MEDIUM)
- https://docs.kinetica.com/7.2/sql/ddl/create-view/ — view described only as a "virtual table"; re-evaluation-per-query and lack of snapshot guarantee is **inferred**, not stated (spike D confirms)
- Phase 18 / 122 spike notes (format + lessons): `.planning/phases/18-spatial-spike-and-endpoint/18-SPIKE-NOTES.md`, `.planning/phases/122-schema-diff-table-missing-detection/122-SPIKE-NOTES.md`

### Tertiary (LOW)
- Default value of `max_get_records_size` (20,000) is repo/milestone-asserted, not confirmed from a rendered config table; spike must read it live.
- Whether the MV TTL reliably self-expires orphan objects and whether DROP TABLE works on paging tables: undocumented → spike.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — zero new deps, all verified in checkout.
- Architecture (credentials, SQL assembly, filter-snapshot, schema, cancel, streaming): HIGH for facts (file:line), MEDIUM for design choices (not yet exercised).
- Kinetica paging/MV/cleanup semantics: MEDIUM (docs) → deliberately gated by the spike + checkpoint.
- Pitfalls: HIGH for repo-derived, MEDIUM for Kinetica-derived.

**Research date:** 2026-10-06
**Valid until:** 2026-11-05 (code facts stable; re-verify line numbers if `kinetica.ts`/`WidgetRenderer.tsx` change before planning)
