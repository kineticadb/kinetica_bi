# Phase 129: Export Routes — Resumable Download, History & Privacy - Research

**Researched:** 2026-10-07
**Domain:** Express 4 HTTP routes over the Phase 128 export-job core (ownership, Range download, history, delete)
**Confidence:** HIGH (all findings verified against repo source and installed `send@0.19.2` / `express@4.22.2` / `content-disposition@0.5.4`)

<user_constraints>
## User Constraints (from CONTEXT.md)

There is NO CONTEXT.md for this phase (operator chose to plan without discuss-phase).

### Locked Decisions
None from a CONTEXT.md. Carried-in locked decisions from Phase 128 (STATE.md "Phase 128 outcome", 128-SPIKE-NOTES.md "Operator decisions"):
- Start route input = `widgetId` + the filter payload (validated like `/api/filter/materialize`) + `sortField`/`sortDir`; the server loads the persisted widget (`getWidget`) and never trusts client SQL.
- Q-C: export = exactly the widget's configured columns. Q-D: widget-action overrides are NOT reflected (Phase 131 follow-up).
- No new RBAC permission constant anywhere (success criterion 3).
- EXPRT-V126-05 and -07 are mapped 128 -> 129 -> 131: this phase delivers their ROUTE half; plans may reference them but MUST NOT mark them complete (they complete in Phase 131).

### Claude's Discretion
Everything not listed above (route shapes, status codes, DTO, delete semantics, filename seam). Operator-owned choices are listed in "Open Questions for the Operator" with a recommended default.

### Deferred Ideas (OUT OF SCOPE)
- Filename naming / user-supplied name (EXPRT-V126-08, Phase 131); raw vs formatted (09) and gzip UI (10), Phase 131.
- TTL sweep, boot reconciliation, row/size/concurrency caps (EXPRT-V126-14/15, Phase 130).
- Any client UI (Phase 131).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| EXPRT-V126-11 | Finished export downloads resumably; only a complete, closed file is served | `res.download` -> `send@0.19.2` gives `Accept-Ranges: bytes`, 206, 416, ETag/Last-Modified/If-Range natively. Gate on `status==='complete'` + `.csv`/`.csv.gz` basename + file stat. See Patterns 3-4. |
| EXPRT-V126-13 | Only the starting user can see/download/cancel/delete; ids unguessable; every route checks ownership | `randomUUID()` already used (`exportRunner.ts` startExport). One shared `loadOwnedJob()` guard, 404 on non-owner, used by all 5 id routes. Pattern 2. |
| EXPRT-V126-17 | Anyone who can view the dashboard can export; no new RBAC permission | Gate = `getDashboard(id) && canViewDashboard(username, id)` (the exact precedent at `index.ts:957,970,1015,1681`); routes sit in the requireAuth-only block. Pattern 1. |
| EXPRT-V126-05 (route half only) | Start a background export | `POST /api/exports` calls `startExport`. Do NOT mark complete. |
| EXPRT-V126-07 (route half only) | Cancel a running export | `POST /api/exports/:id/cancel` calls `cancelExport`. Do NOT mark complete. |
</phase_requirements>

## Summary

Phase 128 already delivered every primitive this phase needs; Phase 129 is a thin, security-critical HTTP layer. `startExport({spec,sid,username,options})` is synchronous, returns `{jobId}` and the run proceeds in the background; it already uses `crypto.randomUUID()` for the id (`packages/server/src/lib/exportRunner.ts:164`), so ids are already opaque UUID v4 and NOTHING must change for criterion 2's "opaque" half. `buildExportPlan` (exportSql.ts:82) already IDENT_RE-validates filter columns, spatial columns, sortField and sortDir, resolves the source table/dv from the persisted widget, and throws a typed `ExportSpecError`; the route only needs shape validation (arrays are arrays, `widgetId` is a number) plus authorization, and a mapping from `ExportSpecError.code` to HTTP status.

Authorization: there is no export-specific gate to build. The precedent is `getDashboard(id) && canViewDashboard(username, id)` returning 404 for both "missing" and "not permitted" (`index.ts:957`, `:970`, `:1015`, `:1681`). The start route loads the widget, takes `widget.dashboard_id`, and applies exactly that. `PERMISSIONS` has 18 entries locked by `tests/lib.permissions.spec.ts:33-53`; adding a 19th breaks rbacDb/rbacMigration/web specs (memory: adding-permission-ripples-across-specs), so use none.

Download: Express `res.download(path, name, opts, cb)` -> `sendFile` -> `send@0.19.2` already implements Range (206 `Content-Range`), multi-range collapse, invalid/unsatisfiable Range (416 + `Content-Range: bytes */len`), `If-Range` (ETag or Last-Modified), ETag/Last-Modified, HEAD. The work is NOT Range handling; it is the gate in front of it (owner + `status==='complete'` + file integrity) and the response headers (private cache, filename). `content-disposition@0.5.4` (used internally by `res.download`) already emits RFC 6266/5987 `filename*=UTF-8''...` and neutralises CR/LF/quote, so the Phase 131 name seam is just the `name` argument. NOTE: the ROADMAP calls `dashboardExport.ts` an "RFC-5987-aware precedent"; it is NOT (it ASCII-slugs to `[a-z0-9-.]`, `dashboardExport.ts:133-141`; `grep filename\*` in the repo = 0 hits). Use `res.download`'s built-in encoding instead.

**Primary recommendation:** Add `src/exportRoutes.ts` exporting `registerExportRoutes(app)` (called from `createApp` after `app.use("/api", requireAuth)`), with one `loadOwnedJob(req,res)` guard used by status/cancel/delete/download; start route gated by `canViewDashboard` on the widget's dashboard; download gated on `status==='complete'` and served with `res.download` + `cacheControl:false` + `Cache-Control: private, no-store`. Add one tiny db helper `deleteExportJob`. No new permission, no new dependency.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| express | 4.22.2 installed (`^4.19.2` in package.json) | routes, `res.download` | already the server framework; Range comes from bundled `send@0.19.2` |
| better-sqlite3 | existing | `export_jobs` CRUD (`db.ts:359`, `:905-995`) | Phase 128 registry |
| supertest | ^7.2.2 | route specs | existing server test idiom |
| vitest | existing | specs | existing |

### Supporting
None to install. `node:fs`, `node:path`, `node:crypto` only.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `res.download` | manual `fs.createReadStream` + hand-parsed Range | Never; `send` already handles 206/416/If-Range correctly. |
| 404 for non-owner | 403 | 403 confirms the id exists (existence oracle); UUIDs make it low-risk but 404 matches the project's NOLEAK convention (`routes.dashboard-export.spec.ts` NOLEAK-404). |

**Installation:** none.
**Version verification:** read from `node_modules/express/package.json` (4.22.2), `node_modules/send/package.json` (0.19.2), `node_modules/content-disposition/package.json` (0.5.4) on 2026-10-07.

## Architecture Patterns

### Recommended Project Structure
```
packages/server/src/
├── exportRoutes.ts        # NEW: registerExportRoutes(app) — 6 routes + loadOwnedJob + toExportJobDto
├── lib/exportDownload.ts  # NEW (optional, small): exportDownloadName(job), isServableFile(job) — pure/FS-light seam for Phase 131
├── db.ts                  # + deleteExportJob(id); listExportJobsForUser made case-insensitive
└── index.ts               # + registerExportRoutes(app) after app.use("/api", requireAuth); update ANALYST-PASSTHROUGH comment block (~line 1218)
packages/server/tests/
├── routes.exports.spec.ts           # start/status/list/cancel/delete/privacy/RBAC
└── routes.exports.download.spec.ts  # Range/206/416/If-Range/status gating/missing file
```
Why a separate module: `asyncHandler` and `requireConfig` are defined inside `createApp` (`index.ts:346`, `:354`) so they are not importable; the new routes are small and synchronous except nothing awaits Kinetica (startExport returns immediately), so no asyncHandler is needed. Inline in index.ts is also acceptable (that is the repo convention), but a module keeps index.ts (3000+ lines) from growing and makes the spec target obvious. Planner's call; either satisfies the criteria.

### Phase 128 primitives (exact signatures, with evidence)
| Primitive | Location | Signature / behaviour |
|-----------|----------|----------------|
| `startExport` | `lib/exportRunner.ts:157` | `(args:{spec:ExportSpec; sid:string; username:string; options?:ExportOptions}) => {jobId:string}`. SYNC. Throws `ExportSpecError` synchronously (from `buildExportPlan`) BEFORE any row is inserted. `jobId = randomUUID()` (line 164). Inserts row `status='queued'`, spawns `run()`. Stores `username`, `sid`, `dashboardId`, `widgetId`, `specJson`, `optionsJson`. |
| `ExportOptions` | `exportRunner.ts:~46` | `{ format?: "raw"; gzip?: boolean }` |
| `ExportSpec` | `lib/exportSql.ts:29` | `{widgetId:number; sortField?:string\|null; sortDir?:"asc"\|"desc"; filters?:ActiveFilter[]; spatialFilters?:SpatialFilter[]; spatialTarget?:SpatialTarget\|null}` |
| `ExportSpecError` | `exportSql.ts:47` | `.code` in `widget_not_found \| not_records_table \| invalid_source \| invalid_column \| invalid_sort \| invalid_filter \| unsupported_filter` |
| `cancelExport` | `exportRunner.ts:~196` | `(jobId) => boolean`. Live run: `ac.abort()` -> true (job turns `cancelled` ASYNC when run unwinds). No live run but queued/running row (post-restart): finalizes `cancelled` + removes files -> true. Terminal job -> false. |
| `getExportJob` | `db.ts:934` | `(id) => ExportJob \| undefined` |
| `listExportJobsForUser` | `db.ts:950` | `(username) => ExportJob[]`, newest first. **Exact-case `username = ?`** (see Pitfall 3). |
| `finalizeExportJob` | `db.ts:972` | write-once `(id,status,fields) => boolean`, `WHERE status IN ('queued','running')`. Safe against a deleted row (returns false). |
| `ExportJob` | `db.ts:907` | `{id,username,sid,dashboardId,widgetId,status,errorCode,errorMessage,totalRows,rowsWritten,filePath,fileBytes,specJson,optionsJson,createdAt,startedAt,finishedAt}` |
| `getExportDir` | `exportRunner.ts:82` | `process.env.EXPORT_DIR \|\| <cwd>/data/exports` (read per call). |
| on-disk naming | `exportRunner.ts:~225` | running: `<jobId>.csv.part` (or `.csv.gz.part`); on success `renameSync` to `<jobId>.csv` / `<jobId>.csv.gz`, then `finalizeExportJob('complete', {filePath, fileBytes})`. The finalize happens AFTER rename, so `complete` implies a closed final file. Dir mode 0700, file 0600. |
| `__exportRunForTest` | `exportRunner.ts` | test-only: promise for a live run. |

DB has NO `file_name`/expiry columns; `export_jobs` schema at `db.ts:359-379`. `idx_export_jobs_user (username, created_at DESC)`.

### Pattern 1: Start route gated by the existing dashboard-view gate (zero new permission)
**What:** `POST /api/exports` body `{widgetId, filters?, spatialFilters?, spatialTarget?, sortField?, sortDir?, options?:{gzip?}}`.
**Steps (in order):**
1. `requireAuth` already applied by `app.use("/api", requireAuth)` (`index.ts:673`). Also check `process.env.KINETICA_URL` (the `requireConfig` body, `index.ts:346`) — export needs Kinetica; return 500 like siblings.
2. Shape-validate: `typeof widgetId === "number"` (400 otherwise); `filters`/`spatialFilters` must be arrays if present (else 400 — `buildExportPlan` does `for (const f of filters)` and would throw a TypeError -> 500 on a non-array); each filter must be an object (the plan checks `typeof f.column==='string' && EXPORT_IDENT_RE`); `sortDir` in {asc,desc} if present; `options.gzip` boolean if present; ignore unknown option keys. Optionally cap `filters.length` (e.g. <= 200) since body limit is 1mb (`index.ts:166`).
3. `const widget = getWidget(widgetId)`; missing -> 404 `{error:"Widget not found."}`.
4. `if (!getDashboard(widget.dashboard_id) || !canViewDashboard(username, widget.dashboard_id)) return 404 {error:"Widget not found."}` — SAME body as step 3 so "missing" and "not permitted" are indistinguishable (NOLEAK).
5. Optional (EXPRT-V126-17 "wherever the widget's CSV toggle is enabled"): `if (cfg.enableCsvDownload === false) 403`. Client rule is `cfg.enableCsvDownload !== false` (`WidgetRenderer.tsx:2005`). See Open Question 3.
6. `try { startExport({spec, sid: req.user.sid, username: req.user.creds.username, options}) } catch (e) { if (e instanceof ExportSpecError) map }`. Mapping: `widget_not_found`->404; all others (`not_records_table`, `invalid_source`, `invalid_column`, `invalid_sort`, `invalid_filter`, `unsupported_filter`)->400 `{error: e.message, code: e.code}`. Anything else rethrow (Express 4 sync throw reaches errorMiddleware).
7. Respond `202` `{ data: toExportJobDto(getExportJob(jobId)) }` (or `{jobId}`); the client polls status.

`widget.dashboard_id` is the widget's dashboard (used at `exportSql.ts` plan: `dashboardId: widget.dashboard_id`). The spec's filters come from the client but are only ever escaped by `buildServerWhereClause`/`composeWhereClause`, and every identifier is IDENT_RE-checked inside `buildExportPlan` — the route does not re-implement this. (Note `/api/filter/materialize` itself does NOT IDENT-check columns, debt SSYNC-F6; do not copy it, rely on the plan.)

Username for the job: pass `req.user.creds.username` unmodified (it feeds `buildDynamicViewName({userId: username})` in the dv path, which must match the name the session materialized). Do NOT lowercase it at insert time.

### Pattern 2: One ownership guard for every `:id` route
```typescript
// Source: project convention (404-for-both, index.ts:957) + db.ts getExportJob
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const sameUser = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

function loadOwnedJob(req: AuthedRequest, res: Response): ExportJob | undefined {
  const id = String(req.params.id);
  const job = UUID_RE.test(id) ? getExportJob(id) : undefined;
  if (!job || !sameUser(job.username, req.user!.creds.username)) {
    res.status(404).json({ error: "Export not found." });   // identical for missing / malformed / not-yours
    return undefined;
  }
  return job;
}
```
Identification is by **username (session `creds.username`), not sid**: sessions rotate on every login (`createSession` mints a new sid), and an owner who logs back in must still reach a completed export. `job.sid` is only the runner's credential-lookup key and must never be used for authorization nor returned to clients. Case-insensitive compare matches `canViewDashboard`/`getEffectivePermissions`, which lowercase (`rbacDb.ts:71`, `dashboardAccessDb.ts`); login stores the username as typed (`index.ts:410`), so exact-case comparison would lock a user out after logging in as `Alice` vs `alice`.

### Pattern 3: Download route (status gate + file integrity + native Range)
```typescript
// Source: express/lib/response.js res.download (4.22.2) -> send@0.19.2
app.get("/api/exports/:id/download", (req, res) => {
  const job = loadOwnedJob(req as AuthedRequest, res); if (!job) return;
  // Criterion 4: ONLY complete. Same refusal for a Range request (criterion 1) — do not branch on the Range header.
  if (job.status !== "complete") {
    return res.status(409).json({ error: "Export is not ready to download.", status: job.status });
  }
  const file = job.filePath;
  const ok = file && /^[0-9a-f-]{36}\.csv(\.gz)?$/i.test(path.basename(file)) && !file.endsWith(".part");
  let st: fs.Stats | undefined; try { st = ok ? fs.statSync(file!) : undefined; } catch { /* ENOENT */ }
  if (!st || !st.isFile() || st.size !== job.fileBytes) {
    return res.status(410).json({ error: "This export is no longer available." });
  }
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.download(file!, exportDownloadName(job), { cacheControl: false, dotfiles: "allow" }, (err) => {
    if (err && !res.headersSent) res.status(err.code === "ENOENT" ? 410 : 500).json({ error: "Download failed." });
    // after headers are sent: send already destroyed the stream; nothing to do (client sees a truncated body and may resume with Range)
  });
});
```
Verified `send@0.19.2` behaviour (`node_modules/send/index.js`):
- `Accept-Ranges: bytes` set by default (`acceptRanges` default true; line ~856). Keep default.
- `Range: bytes=N-` -> `206`, `Content-Range: bytes N-(len-1)/len`, `Content-Length` = remaining (lines 645-690).
- Unsatisfiable (`bytes=999999-` beyond size) -> `416` + `Content-Range: bytes */len`. Syntactically invalid or multi-range -> treated as a plain 200 full response (`ranges.length === 1` check); `combine:true` merges overlapping ranges.
- `If-Range` honoured (lines 446-461): quoted ETag compared to the response ETag, else HTTP-date compared to Last-Modified; stale -> full 200 (not 206). ETag is weak `W/"size-mtime"` from `etag(stat)`; `lastModified` and `etag` options default true — KEEP both so a resuming client has a validator; the file is immutable after rename so the validator is stable.
- `If-None-Match`/`If-Modified-Since` -> 304; `If-Match`/`If-Unmodified-Since` fail -> 412.
- HEAD supported (headers only).
- `res.download` sets `Content-Disposition` via `content-disposition` and IGNORES a caller-supplied `Content-Disposition` in `opts.headers` (response.js:582). Content-Type from extension: `.csv` -> `text/csv; charset=UTF-8`; `.csv.gz` -> `application/gzip`. No `Content-Encoding` is set, so browsers do not transparently decompress the gz.
- `cacheControl:false` disables the default `Cache-Control: public, max-age=0`; we set `private, no-store` ourselves. (Per-user data must never be cacheable by a shared proxy.)
- dotfiles: with no `root`, send checks path parts; an `EXPORT_DIR` containing a dot-directory is legacy-"allow" unless the LAST segment starts with "."; `<uuid>.csv` never does. `dotfiles:"allow"` is belt-and-braces.
- ENOENT before the stream opens -> `send` emits error 404; express's `sendfile` passes it to the callback (or `next(err)` if no callback). Provide the callback to return JSON instead of the error page.
- Mid-stream deletion: on POSIX an unlinked-but-open file keeps streaming to completion, so an in-flight download survives a delete. The only real race is stat -> open (milliseconds), handled by the callback above (410). A fresh Range resume after the file is gone -> 410. Phase 130's sweep must still honour "never delete mid-download" (its own checkpoint).

### Pattern 4: Status/list DTO (never leak internals)
`toExportJobDto(job)` returns ONLY: `id, status, widgetId, dashboardId, rowsWritten, totalRows, fileBytes, errorCode, errorMessage, createdAt, startedAt, finishedAt, gzip` (derive from `optionsJson`). NEVER return `sid`, `filePath`, `username`, `specJson`/`optionsJson` raw. Keep it one function so Phase 130 (add `expiresAt`) and Phase 131 (add `name`) extend a single seam. History requirement text (EXPRT-V126-12, Phase 131) lists name/status/rows/size/expiry; the 129 list route (`GET /api/exports`) supplies the data and ownership filtering — EXPRT-V126-13's "see" = list + status are owner-only.

### Pattern 5: Route table (recommended)
| Method + path | Behaviour | Success | Refusals |
|---|---|---|---|
| `POST /api/exports` | validate, widget -> canViewDashboard, `startExport` | 202 `{data: dto}` | 400 shape/ExportSpecError, 404 widget missing/not viewable, 500 no KINETICA_URL |
| `GET /api/exports` | `listExportJobsForUser` (case-insensitive) -> dtos | 200 `{data:[dto]}` | — |
| `GET /api/exports/:id` | status | 200 `{data: dto}` | 404 |
| `POST /api/exports/:id/cancel` | queued/running -> `cancelExport`; | 202 `{data: dto}` (status flips to `cancelled` async; client polls) | 404; 409 if already terminal |
| `DELETE /api/exports/:id` | see Pattern 6 | 204 | 404 |
| `GET /api/exports/:id/download` | Pattern 3 | 200 / 206 | 404 (not owner), 409 (not complete), 410 (file gone), 416 |

Route ids are `:id` UUIDs only; the static `GET /api/exports` must not collide with `/:id`. Place these in the requireAuth-only region and add them to the "ANALYST-PASSTHROUGH BOUNDARY" comment (`index.ts:1218-1257`) — an analyst (dashboards:view only) must reach them.

### Pattern 6: Delete semantics
- Terminal job (`complete|failed|cancelled|session_expired`): `fs.rmSync(job.filePath,{force:true})` if set (plus defensively the 4 known suffixes under `getExportDir()` for that id — `filePaths` is private in exportRunner; either export it or recompute), then new `deleteExportJob(id)` (`DELETE FROM export_jobs WHERE id = ?`), respond 204.
- Active job (`queued|running`): call `cancelExport(id)` then `deleteExportJob(id)` and return 204. Safe because the runner's guarded writes tolerate a missing row (`finalizeExportJob` -> false; `updateExportJobProgress/setExportJobTotalRows` are no-op UPDATEs; the "finalize returned false -> `rmSync(finalPath)`" branch at `exportRunner.ts:~262` cleans a just-renamed file; catch path `rmSync`s part+final). Alternative default (stricter): 409 "Cancel it first". See Open Question 2.
- Deleting a file while the owner is downloading it is acceptable (POSIX keeps the open fd valid); it is the owner's own action. The TTL sweep (Phase 130) is the race that matters.
- Must be idempotent-safe: second DELETE -> 404.

### Anti-Patterns to Avoid
- **Trusting `job.filePath` blindly:** assert basename matches `<uuid>.csv(.gz)` and not `.part`, and stat size === `fileBytes`.
- **Branching on `Range` to decide "running job refused":** the status gate already refuses ALL requests for non-complete jobs; do not add a Range-specific code path (it would be untested surface).
- **Adding a permission / `requirePermission` on these routes:** none. A test should assert analyst can use them.
- **403 for non-owner / separate error for missing vs not-yours:** use identical 404 bodies.
- **Serving by `job.sid` ownership:** sid rotates.
- **Returning the DB row directly:** leaks `sid`, `filePath`, `specJson`.
- **Using `res.sendFile` with a client-supplied path:** the path comes only from the DB row.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Range / 206 / 416 / If-Range / ETag | custom stream slicing | `res.download` (send@0.19.2) | edge cases: multi-range, suffix ranges `bytes=-N`, off-by-one, If-Range semantics |
| RFC 5987 filename encoding | custom `filename*=` builder | `res.download(path, name)` (content-disposition@0.5.4) | verified: `Zürich 日本.csv` -> `filename="Zürich ??.csv"; filename*=UTF-8''Z%C3%BCrich%20%E6%97%A5%E6%9C%AC.csv`; CR/LF/quote encoded in `filename*`, replaced by `?` in the fallback |
| Dashboard access check | new permission/gate | `canViewDashboard` (`lib/dashboardAccessDb.ts`) | the project's single control for "can view" |
| Identifier/SQL safety of the spec | route-level SQL building/regex | `buildExportPlan` (`exportSql.ts:82`) | already IDENT_RE + escaped builders; route only does shape checks |
| Job id generation | counters | `randomUUID()` (already used) | unguessable |

**Key insight:** every hard part (runner, plan validation, Range, header encoding, access check) already exists; the phase's risk is wiring order and the authorization/privacy envelope, not new mechanisms.

## Common Pitfalls

### Pitfall 1: Sync `ExportSpecError`/TypeError escaping as 500
**What goes wrong:** `startExport` throws synchronously; `filters` as a non-array object crashes `for...of`.
**How to avoid:** shape-check arrays in the route; wrap `startExport` in try/catch mapping `ExportSpecError` -> 400/404. Express 4 does catch sync throws, but you would return a generic 500.
**Warning signs:** a spec with `filters: "x"` returning 500.

### Pitfall 2: Existence oracle via different 404/403 bodies
**How to avoid:** widget-missing and widget-not-viewable return byte-identical responses; export missing/malformed/not-yours identical. Test with deep-equal on status+body (mirror NOLEAK-404 in `routes.dashboard-export.spec.ts`).

### Pitfall 3: Case-sensitive ownership / list
**What goes wrong:** `listExportJobsForUser` uses `username = ?` (`db.ts:950`) while sessions store the username as typed; user logs in as `Alice`, later `alice`, history appears empty and `loadOwnedJob` (if exact) 404s their own export.
**How to avoid:** compare lowercased everywhere; change the list query to `WHERE lower(username) = lower(?)` (existing 128 specs use one case and still pass). Keep the stored value as typed (dv view-name derivation needs it).

### Pitfall 4: Serving while the row is `complete` but the file is gone (or a `.part`)
**How to avoid:** Pattern 3 gate: status + basename regex + stat + size equality; callback handles ENOENT -> 410. Phase 128's guarantee (rename before finalize) means `complete` implies a closed file; the extra checks are defence-in-depth against Phase 130 sweep and manual file removal.

### Pitfall 5: Default `Cache-Control: public, max-age=0` and weak validators on private data
**How to avoid:** `cacheControl:false` + explicit `private, no-store`. Keep ETag/Last-Modified for resume; `no-store` does not stop `Range`/`If-Range` resumption by a download manager/browser within one download (resumption uses the validator the client already holds).

### Pitfall 6: Reverse proxy / compression stripping Range
**What goes wrong:** a proxy that buffers or re-compresses can drop 206. The app itself has no `compression` middleware (grep: none in `package.json`/`index.ts`). Deployment-level; MEDIUM confidence; note for the verifier, not a unit-testable item.

### Pitfall 7: Mutating `.planning` bookkeeping
Memory: gsd-tools corrupts planning docs; do all STATE/ROADMAP/REQUIREMENTS edits by hand, and assign shared-doc updates to ONE plan (memory: parallel executors clobber ROADMAP). For this phase: REQUIREMENTS 11/13/17 -> Complete; 05/07 stay "In progress — engine 128, routes 129, completes 131".

### Pitfall 8: Executors mark multi-phase requirements complete early
Memory: gsd-subagent-tracking-gotchas. State explicitly in each plan: "do not mark EXPRT-V126-05/07 complete".

## Code Examples

### Supertest Range against a hand-seeded completed export (no Kinetica needed)
```typescript
// Source: pattern from tests/lib.exportRunner.cancel.spec.ts (insertExportJob/finalizeExportJob, EXPORT_DIR mkdtemp) + routes.dashboard-export.spec.ts (session/cookie)
const id = randomUUID();
insertExportJob({ id, username: "alice", sid: "x", dashboardId: dash.id, widgetId: w.id, specJson: "{}", optionsJson: null });
markExportJobRunning(id);
const filePath = path.join(dir, `${id}.csv`);
fs.writeFileSync(filePath, "a,b\r\n1,2\r\n3,4");
finalizeExportJob(id, "complete", { rowsWritten: 2, filePath, fileBytes: fs.statSync(filePath).size });

const r = await agent.get(`/api/exports/${id}/download`).set("Cookie", cookie).set("Range", "bytes=5-");
expect(r.status).toBe(206);
expect(r.headers["content-range"]).toBe(`bytes 5-${size - 1}/${size}`);
expect(r.headers["accept-ranges"]).toBe("bytes");
expect(r.text).toBe(full.slice(5));
// unsatisfiable
expect((await agent.get(...).set("Range", "bytes=9999-")).status).toBe(416);
// If-Range with a stale validator -> 200 full body
// gz: use .buffer(true).parse(binaryParser) to compare bytes
```
Cookie helper: `jwt.sign({sub, sid, v:1}, process.env.AUTH_SECRET, {expiresIn:"8h"})` -> `kbi_session=<token>` (see `tests/helpers/db.ts createAdminSession`; analyst via `createSession({username, secret, kineticaUrl})` + `addDashboardGrant(dashId,"user",username)` as in `routes.dashboard-export.spec.ts`).

### Minimal Content-Disposition seam
```typescript
// lib/exportDownload.ts — Phase 131 swaps the body (user-supplied name from options_json) without touching the route
export const exportDownloadName = (job: Pick<ExportJob, "id" | "createdAt" | "optionsJson" | "filePath">): string => {
  const ext = job.filePath?.endsWith(".gz") ? ".csv.gz" : ".csv";
  return `export-${job.createdAt.slice(0, 10)}-${job.id.slice(0, 8)}${ext}`;   // ASCII, header-safe
};
```

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| client-side CSV build capped at 100k rows | server job + file + Range download | this milestone |
| `dashboardExport.ts` ASCII slug filename | `res.download(path,name)` with content-disposition 0.5.4 (UTF-8 `filename*`) | non-ASCII names (Phase 131) work with no custom code |

**Deprecated/outdated:** the ROADMAP phrase "RFC-5987-aware precedent" for `dashboardExport.ts` is inaccurate (see Summary); do not plan to "reuse" an encoder from it.

## Open Questions for the Operator

(No CONTEXT.md; each has a recommended default the planner may adopt or route to a checkpoint.)

1. **Status code for download of a non-complete job**
   - Recommended default: `409 Conflict` `{error, status}` for queued/running/failed/cancelled/session_expired (Range or not); `410 Gone` when complete but the file is missing/size-mismatched; `404` for non-owner.
   - Alternative: `404` for everything non-servable (less informative to the UI).
2. **DELETE on a running job**
   - Recommended default: cancel-then-delete in one call (204). Alternative: 409 "cancel first" (stricter, two-step UI). Either is safe given the runner's guarded writes.
3. **Enforce the widget's `enableCsvDownload` toggle server-side?**
   - EXPRT-V126-17 says "wherever the widget's CSV toggle is enabled". Recommended default: YES, reject `cfg.enableCsvDownload === false` with 403 `{error:"CSV download is disabled for this widget."}` (client rule is `!== false`, `WidgetRenderer.tsx:2005`). Alternative: UI-only (server permissive; any dashboard viewer could export a widget whose author disabled download).
4. **Re-check dashboard access at download/list time?**
   - Recommended default: NO — ownership by the starter is the requirement (EXPRT-V126-13); access is checked at start. Alternative: also require `canViewDashboard` on `job.dashboardId` for download, so a revoked grant stops downloads (costs: dashboard deletion leaves orphaned jobs unreachable until Phase 130 TTL; no FK on `dashboard_id`).
5. **Accept `options.gzip` on the start route now?**
   - Recommended default: yes, validated boolean pass-through (runner already supports it; Phase 131 adds only the UI checkbox). Alternative: omit until Phase 131.
6. **Per-user rate/concurrency cap now?**
   - Recommended default: NONE in 129 (ROADMAP gives it to Phase 130, EXPRT-V126-15). Risk: between 129 and 130 a viewer can start unbounded concurrent exports (each makes a Kinetica MV + holds a session-bound run). Do not release the milestone between them; no code in 129.
7. **File display name seam**
   - Recommended default: `exportDownloadName(job)` as above (`export-<date>-<id8>.csv[.gz]`); Phase 131 replaces with the user-supplied name (likely stored in `options_json`; a `file_name` column is NOT needed in 129).

## Rate/Concurrency boundary
ROADMAP Phase 130 criterion 4 owns "per-user concurrent-export cap (env vars only)" and its depends-on explicitly says routes (129) are "to be capped". Phase 129 adds no caps. Verified: no `EXPORT_MAX_*` anywhere today.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest + supertest 7.2 (server) |
| Config file | `packages/server/vitest.config.ts` (`include: tests/**/*.spec.ts`, `setupFiles: tests/setup.ts`, `isolate: true`) |
| Quick run command | `cd packages/server && npx vitest run tests/routes.exports.spec.ts tests/routes.exports.download.spec.ts` |
| Full suite command | `cd packages/server && npm run test:gate` (set-based; `scripts/test-gate.mjs`) and `npx tsc --noEmit` |

Test-gate semantics (`scripts/test-gate.mjs`): runs the full suite; failures in `KNOWN_FAILING` (OIDC issuer-mock specs, `db.smoke`, `routes.wms`) are allowed; any other failing file is re-run alone — passes alone = contamination (allowed, reported), fails alone = REAL failure. Never assert a pass-count. New specs must pass in isolation; do NOT add them to KNOWN_FAILING. `tests/setup.ts` pins `EXPORT_DIR=""`, `DB_PATH=:memory:`, so each spec sets `process.env.EXPORT_DIR = mkdtemp(...)` in `beforeEach` and resets to `""` in `afterEach` (pattern: `lib.exportRunner.cancel.spec.ts:70,84`). Because the DB is a module singleton per spec file, `beforeEach` should `DELETE FROM export_jobs; DELETE FROM sessions; ...` (see `routes.dashboard-export.spec.ts` beforeEach).

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| EXPRT-V126-11 | Range on complete -> 206 + Content-Range, from offset; `bytes=-N` suffix; 416 on out-of-range; stale If-Range -> 200; Accept-Ranges present | integration | `npx vitest run tests/routes.exports.download.spec.ts` | Wave 0 |
| EXPRT-V126-11 | Range/plain GET on queued/running/failed/cancelled/session_expired -> 409, never bytes; `.part` on disk never served | integration | same | Wave 0 |
| EXPRT-V126-11 | complete row + file deleted -> 410 (no crash); size mismatch -> 410 | integration | same | Wave 0 |
| EXPRT-V126-11 | gz job served as `application/gzip` byte-identical; non-ASCII/hostile name header has no raw CR/LF/quote | integration | same | Wave 0 |
| EXPRT-V126-13 | non-owner gets 404 on status/cancel/delete/download, byte-identical to missing id and malformed id; list shows only own; owner after re-login (new sid) still downloads; username case-variant owner OK | integration | `npx vitest run tests/routes.exports.spec.ts` | Wave 0 |
| EXPRT-V126-13 | ids are UUID v4 (`/^[0-9a-f-]{36}$/`) from `POST` response | integration | same | Wave 0 |
| EXPRT-V126-17 | analyst with ONLY a dashboard grant (no manage_access) can POST + download end-to-end (fetch stubbed like `installStub` in `lib.exportRunner.cancel.spec.ts`); analyst WITHOUT a grant gets 404 identical to missing widget; `PERMISSIONS` still 18 keys, none matching /export/i | integration | same | Wave 0 |
| EXPRT-V126-05 (route half) | POST validates (non-array filters 400, bad IDENT column 400, bad sortDir 400, non-records widget 400, missing widget 404) | integration | same | Wave 0 |
| EXPRT-V126-07 (route half) | cancel running -> 202 then job `cancelled`, no file; cancel terminal -> 409 | integration | same | Wave 0 |
| delete | terminal: file + row removed, 204, then 404; running: cancel+delete leaves no row and no file after run unwinds (`await __exportRunForTest`) | integration | same | Wave 0 |

Hand-seed completed jobs with `insertExportJob` + `markExportJobRunning` + `finalizeExportJob` + a real file in the mkdtemp `EXPORT_DIR` for download tests (no Kinetica); use the `installStub` fetch pattern only for the one start->complete->download end-to-end test.

### Sampling Rate
- **Per task commit:** `cd packages/server && npx vitest run tests/routes.exports.spec.ts tests/routes.exports.download.spec.ts && npx tsc --noEmit`
- **Per wave merge:** also `npx vitest run tests/db.exportJobs.spec.ts tests/lib.exportRunner.*.spec.ts tests/lib.permissions.spec.ts tests/routes.dashboard-export.spec.ts`
- **Phase gate:** `npm run test:gate --workspace @kinetica-bi/server` green + `tsc --noEmit` clean (web gates unaffected; no web change in this phase)

### Wave 0 Gaps
- [ ] `packages/server/tests/routes.exports.spec.ts` — start/status/list/cancel/delete/privacy/RBAC
- [ ] `packages/server/tests/routes.exports.download.spec.ts` — Range/206/416/If-Range/status gating/missing file
- [ ] db helper test for `deleteExportJob` and case-insensitive `listExportJobsForUser` (extend `tests/db.exportJobs.spec.ts`)
- Framework install: none.

### Honest limits (route to `checkpoint:human-verify`, per CLAUDE.md)
- A real browser/`curl -C -` resume of a multi-hundred-MB file through the actual deployment proxy (Pitfall 6) is not provable by supertest; recommend one manual `curl -r 0-99 ... ; curl -C -` smoke against the dev server with a completed export from `npm run export-runner-smoke`-style data. This is the only unprovable item; everything else is automatable.
- The "never deletes mid-download" race is Phase 130's checkpoint, not this phase's.

## Candidate grep anchors (CLAUDE.md rule) — each verified to read 0 BEFORE work

Verified 2026-10-07 across `packages/server/src`, `packages/server/tests`, `packages/web/src` (`grep -rnF`):

| Anchor | Today | Use |
|--------|-------|-----|
| `/api/exports` | 0 | route path literal; `grep -c '"/api/exports' src/exportRoutes.ts` >= 6 after |
| `exports/:id` | 0 | route param form |
| `deleteExportJob` | 0 | new db helper (src + spec) |
| `toExportJobDto` | 0 | DTO seam |
| `exportDownloadName` | 0 | filename seam |
| `loadOwnedJob` | 0 | ownership guard |
| `registerExportRoutes` | 0 | wiring |
| test title prefix `EXPRT129-` (e.g. `EXPRT129-range-206:`) | 0 (`EXPRT129` = 0) | spec titles |
| files `tests/routes.exports.spec.ts`, `tests/routes.exports.download.spec.ts`, `src/exportRoutes.ts` | do not exist | `ls` |

NON-discriminating (do NOT use as acceptance criteria): `EXPRT-V126-11/13/17` as grep strings read 0 in `src`/`tests` today but will also appear in plan/summary docs; `export_jobs` already has 21 hits; the word `export` is in permissions.ts/rbacDb.ts (7 and 6 hits, all `export const`); `Range`, `206`, `Content-Disposition` already appear elsewhere. The "no new permission" criterion is a regression guard: `lib.permissions.spec.ts:33-53` (18 entries) passes both before and after, so it cannot prove the feature; the DISCRIMINATING proof is the behavioural test "analyst with grant-only starts and downloads" (404/absent today, 202/200 after). Also assert structurally that no `requirePermission(` appears on any `/api/exports` registration (reads 0 before and after — say so, pair it with the behavioural test).

## Sources

### Primary (HIGH confidence)
- Repo source (read 2026-10-07): `packages/server/src/lib/exportRunner.ts`, `lib/exportSql.ts`, `db.ts:359-379,905-995`, `index.ts` (673, 346, 954-975, 1218-1340, 1665-1690), `lib/dashboardAccessDb.ts`, `lib/permissions.ts`, `rbac.ts`, `auth.ts`, `lib/dashboardExport.ts:133-141`, `tests/helpers/*`, `tests/lib.exportRunner.cancel.spec.ts`, `tests/routes.dashboard-export.spec.ts`, `scripts/test-gate.mjs`, `tests/setup.ts`, `vitest.config.ts`
- `node_modules/send/index.js` (0.19.2) — Range/416/If-Range/ETag/dotfiles/ENOENT code paths read directly
- `node_modules/express/lib/response.js` (4.22.2) `res.sendFile`, `res.download`
- `node_modules/content-disposition` 0.5.4 — executed locally for non-ASCII and CRLF/quote names
- `.planning/REQUIREMENTS.md`, `STATE.md` (Phase 128 outcome), `ROADMAP.md` Phase 129-131, project memory notes

### Secondary / Tertiary
- None needed (no external web lookups; all behaviour verified from installed code).

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — nothing new; versions read from node_modules
- Architecture: HIGH — mirrors existing precedents with file:line evidence
- Pitfalls: HIGH for code-derived ones; MEDIUM for proxy/deployment Range behaviour (Pitfall 6)

**Research date:** 2026-10-07
**Valid until:** 2026-11-06 (stable; re-verify only if express/send are bumped)
