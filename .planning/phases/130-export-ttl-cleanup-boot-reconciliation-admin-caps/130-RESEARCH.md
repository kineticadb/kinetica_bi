# Phase 130: Export TTL Cleanup, Boot Reconciliation & Admin Caps - Research

**Researched:** 2026-10-07
**Domain:** Node/Express + better-sqlite3 background-job lifecycle (expiry sweep, boot reconciliation, env-driven caps). No new libraries.
**Confidence:** HIGH (all findings are from reading this repo's code plus the installed express 4.22.2 / send 0.19.2 sources; no external library is introduced)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Expiry & retention**
- **D-01: Default expiry is 24 hours**, overridable via env (e.g. `EXPORT_TTL_HOURS`, positive-int validated like other knobs).
- **D-02: The clock starts when the export finishes** (`finished_at`), not when it was started. A long export still gets the full window after completing.
- **D-03: One clock for all terminal rows.** Failed, cancelled and session-ended rows (which have no file) expire on the same window as complete ones, so history shows recent failures with their reason until they expire.
- **D-04: A download in progress finishes before deletion.** The sweep skips a file with an open download and removes it on a later tick. A new download request after expiry gets the normal refusal (404/410, matching Phase 129's O-1). The sweep must never delete a file mid-download. This live race is ROADMAP criterion 3, a `checkpoint:human-verify` with a deliberately slow, held-open download spanning a forced sweep.

**Restart behaviour**
- **D-05: Interrupted jobs are marked failed at boot.** Any `queued`/`running` row becomes `failed` with `error_code = 'server_restarted'` and a message like "Export stopped: the server restarted. Start it again." The partial file is deleted. Nothing is auto-restarted.
- **D-06: Leftover `_kbi_exp_` Kinetica views are left to their TTL.** Boot makes no Kinetica calls and introduces no service credential. Views expire via `EXPORT_VIEW_TTL_MINUTES` (default 60).
- **D-07: Orphan files: delete only our own names.** At boot, remove files in `EXPORT_DIR` matching `<uuid>.csv`, `<uuid>.csv.gz` or `<uuid>…part` that have no corresponding live/complete row. Any other file in the directory is left alone and logged. Never wipe the directory wholesale.
- **D-08: Boot logging is one summary line**, e.g. `export reconcile: 2 interrupted jobs failed, 3 orphan files removed`. Nothing is logged when there's nothing to do.

**Cap defaults & enforcement**
- **D-09: The per-user concurrency cap defaults to 2** (env, e.g. `EXPORT_MAX_CONCURRENT_PER_USER`). It counts the user's `queued` + `running` jobs, matched case-insensitively like Phase 129 ownership.
- **D-10: Over the concurrency cap, refuse immediately.** The start route returns 429 with the cap message and creates nothing. No queueing.
- **D-11: Row and file-size caps are off by default.** They are unlimited unless the admin sets e.g. `EXPORT_MAX_ROWS` / `EXPORT_MAX_FILE_MB`.
- **D-12: The row cap fails before writing.** After `COUNT(*)` on the snapshot, if `total_rows` > cap, the job fails at once with a cap `error_code` and message. It never writes a truncated file (consistent with Phase 128's "never silently wrong").
- **D-13: The file-size cap stops mid-write.** When bytes on disk pass the cap, the job stops, fails with a cap `error_code`, and the partial file is deleted (Phase 128 D-13: only complete files exist).
- **D-14: The size cap measures bytes on disk.** With gzip ticked, that is the compressed size: the cap protects disk.

**Cap messages**
- **D-15: Messages show both the export's size and the limit**, e.g. "This export has 12,400,000 rows; the limit is 10,000,000."
- **D-16: The remedy is filtering.** Row/size messages end with "Add filters to narrow it down and try again." The size message also suggests compressing (.csv.gz) when gzip was off.
- **D-17: The concurrency message gives the count and what to do:** "You already have 2 exports running. Wait for one to finish or cancel one, then try again."
- **D-18: Caps are visible in advance in the export dialog (Phase 131).** Phase 130 exposes the active cap values to the client (alongside the existing `csvInBrowserMaxRows` / `maxRowsPerQuery` client-config fields, `index.ts:458`). Unset caps are sent as null/absent. Phase 131's dialog shows them, e.g. "Limits: 10,000,000 rows · 2 GB · 2 at a time". Phase 130 builds no UI.

### Claude's Discretion
- Exact env var names and units (hours vs minutes for TTL, MB vs bytes for size), validation via the `readPositiveIntEnv` idiom.
- Whether to add an `expires_at` column or compute expiry from `finished_at` + TTL. A schema change must remain `CREATE TABLE IF NOT EXISTS`-compatible or use a guarded ALTER.
- Sweep interval and implementation (`.unref()`'d `setInterval`, per the `sessionStore` precedent) and how open downloads are tracked (e.g. an in-memory open-download refcount around `res.download`).
- Exact `error_code` names for caps (e.g. `row_cap`, `size_cap`) and for restart (`server_restarted`).
- Where the concurrency check lives (route vs `startExport`). Whichever is chosen must be race-safe against two simultaneous starts.

### Deferred Ideas (OUT OF SCOPE)
- Showing the caps in the export dialog, including an early "this export is over the row cap" warning: Phase 131 UI. Phase 130 provides the values only.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| EXPRT-V126-14 | Export jobs/files expire on a schedule; restart leaves no stuck job or orphan file; sweep never deletes an open download | Sections 1-4 (computed expiry, sync sweep + download refcount, boot reconcile in the bootstrap IIFE, orphan regex rule) |
| EXPRT-V126-15 | Admin env caps (rows, file size, concurrent per user); user told why; cap values visible to client | Sections 5-8 (cap in `startExport`, row cap after COUNT, counting Transform, message builders, `/me` seam) |
</phase_requirements>

## Summary

Everything this phase needs is a small, synchronous extension of existing seams; no library is required. The decisive facts: (a) `startExport` (`exportRunner.ts:178-211`) and every `better-sqlite3` call are synchronous, so a check-then-insert for the concurrency cap inside `startExport` is atomic within the single Node process with no extra locking; (b) the download route's gate chain (`exportRoutes.ts:132-141`: owner -> complete -> `resolveServableExportFile` which uses `statSync`) is a single synchronous segment, so if the refcount increment is placed in that same segment and the sweep is itself fully synchronous (no `await` between "is it downloading?" and `rmSync`/`deleteExportJob`), the sweep/download race has no window at all, independent of POSIX unlink semantics; (c) boot reconciliation must live in the `NODE_ENV !== "test"` bootstrap IIFE (`index.ts:3287-3313`), NOT inside `createApp()`, because every route spec calls `createApp()` (via `buildTestApp`) while jobs from earlier tests can still be in flight, and `createApp()` would run per test.

Expiry should be **computed** (`finished_at + TTL`), not stored: no schema change, `EXPDB-ddl` (`tests/db.exportJobs.spec.ts:53-62`, exact 17-column list) stays valid, and changing `EXPORT_TTL_HOURS` applies retroactively. The sweep filters in SQL with `finished_at <= datetime('now', '-N hours')` (both sides are SQLite `YYYY-MM-DD HH:MM:SS` UTC strings, `db.ts:372-374`), and `toExportJobDto` derives `expiresAt` in JS.

Caps: concurrency check inside `startExport` (throws a typed `ExportCapError`, route maps to 429); row cap right after `setExportJobTotalRows` (`exportRunner.ts:270`) and before the header probe/`createWriteStream`; size cap via a counting `Transform` placed AFTER the gzip stage and before the file sink inside `writeCsv`, erroring the pipeline so the existing catch (`:296-299`) deletes `.part` and the `finalizeExportJob` write-once guard still applies. `/api/auth/me` gains ONE nested object; the web `fetchMe` builds its return value field-by-field (`client.ts:286-300`) so a new field is silently dropped unless mapped.

**Primary recommendation:** Add three small server modules/areas (`lib/exportCaps.ts` for env getters + message builders, `lib/exportCleanup.ts` for download tracker + `runExportSweepOnce` + `startExportSweep` + `reconcileExportsOnBoot`, plus 4 tiny db.ts query helpers), wire reconcile+sweep in the bootstrap IIFE only, and keep all clock/size logic computed, not stored.

## Standard Stack

No new dependencies. Existing and sufficient:

| Library | Version (installed) | Purpose | Why |
|---------|---------|---------|-----|
| express | 4.22.2 | `res.download` -> `send` | Existing; download path unchanged |
| send | 0.19.2 | Range/206/416, `fs.createReadStream` | Existing |
| better-sqlite3 | existing | sync DB: makes check-then-insert atomic | Existing |
| node:stream `Transform` | builtin | byte-counting stage for size cap | Standard; avoids polling `bytesWritten` |
| vitest + supertest | ^4.1.5 / ^7.2.2 | tests | Existing |

Versions verified from `node_modules` (`express 4.22.2`, `send 0.19.2`).

## Architecture Patterns

### Recommended structure (new/changed files)
```
packages/server/src/
├── lib/exportCaps.ts        # NEW: env getters (ttl, caps), formatters, message builders, ExportCapError/RowCapError/SizeCapError
├── lib/exportCleanup.ts     # NEW: download tracker, runExportSweepOnce, startExportSweep, reconcileExportsOnBoot, removeExportFiles
├── lib/exportRunner.ts      # EDIT: concurrency check in startExport; row cap after COUNT; size cap via writeCsv opts; catch branches
├── lib/exportJobAccess.ts   # EDIT: expiresAt in DTO; isExportExpired
├── exportRoutes.ts          # EDIT: 429 mapping; expired -> 410; refcount around res.download
├── db.ts                    # EDIT: 4 query helpers (no schema change)
└── index.ts                 # EDIT: /me exportLimits; IIFE calls reconcile (before listen) + startExportSweep (after listen)
```
Circularity note: `exportJobAccess.ts` already imports `getExportDir` from `exportRunner`; keep new env getters in `exportCaps.ts` (imports nothing from runner) so `exportJobAccess`, `exportRunner` and `exportCleanup` can all import it without a cycle. `exportCleanup` imports `exportFilePaths` from runner and db helpers.

### 1. Open-download tracking (D-04) — refcount keyed by job id

Evidence: route at `exportRoutes.ts:132-165`. `send` (node_modules/send/index.js:789-799) does an async `stat` then `fs.createReadStream` and registers `onFinished(res, cleanup)`; express' `res.download` callback is also driven by `on-finished`. So "open" spans from route entry until the response closes.

```typescript
// lib/exportCleanup.ts
const openDownloads = new Map<string, number>();
export const isExportDownloading = (id: string): boolean => (openDownloads.get(id) ?? 0) > 0;
export function trackExportDownload(id: string, res: import("express").Response): void {
  openDownloads.set(id, (openDownloads.get(id) ?? 0) + 1);
  let released = false;
  const release = () => {
    if (released) return;               // idempotent: 'close' may follow 'finish'
    released = true;
    const n = (openDownloads.get(id) ?? 1) - 1;
    if (n <= 0) openDownloads.delete(id); else openDownloads.set(id, n);
  };
  res.once("close", release);           // fires on completion AND client abort / socket destroy
}
```
Route placement: immediately after `resolveServableExportFile` returns non-null and BEFORE `res.download(...)` (same synchronous segment as the gates). Do NOT decrement in the `res.download` callback; `res.once('close')` alone is sufficient and cannot leak on aborted connections (Node emits `close` on the ServerResponse when the underlying connection terminates or the response completes). `Map` is deleted at 0, so no unbounded growth.

Why no race: the Express handler runs `loadOwnedJob` -> status check -> `statSync` -> `trackExportDownload` in one JS turn. The sweep runs in a different turn. Sweep is fully synchronous (`rmSync` + sync DB), so either (i) sweep ran first: row/file gone, handler sees 404 (row deleted) or 410; or (ii) handler ran first: count > 0, sweep skips. No third interleaving exists. Keep it that way: **never `await` inside the sweep between the `isExportDownloading` check and the delete** (this is the invariant to put in a code comment and a test).

Unlink-mid-stream (POSIX): an already-open fd keeps serving after unlink on Linux/macOS (PITFALLS.md Pitfall 9 states the same); only NEW opens fail. The one residual gap is send's stat->open window (ENOENT -> existing `410` branch at `exportRoutes.ts:151`), and the refcount closes it. On Windows deleting an open file fails (EBUSY/EPERM); deployment targets are POSIX, but `rmSync` in the sweep must be wrapped in try/catch per job so one failure does not abort the tick (it retries next tick anyway).

Range resume after expiry: add an expiry gate in the download route after the `complete` check and before the file resolve: `if (isExportExpired(job)) return res.status(410).json(GONE);`. This enforces "TTL means no longer OFFERED" separately from physical deletion (PITFALLS Pitfall 9, bullet 2), so an expired-but-unswept row also refuses, and a Range resume of a download whose first request was in flight at expiry gets 410 (matches D-04 "normal refusal"). After the sweep deletes the row, the same request gets 404 via `loadOwnedJob`. An in-flight stream is unaffected (already past the gate).

### 2. Expiry model (D-01..D-03) — RECOMMEND: compute, do not add a column

- db.ts migration pattern exists (guarded `ALTER TABLE ... ADD COLUMN` via `PRAGMA table_info`, e.g. `db.ts:395-410, 467-471`), so a column IS feasible. But it would change `EXPDB-ddl` (exact 17-column `toEqual`, `tests/db.exportJobs.spec.ts:53-62`), require backfilling existing rows, and freeze the TTL at finish time (an env change would not apply to existing rows).
- Computed: `expiresAt = finished_at + EXPORT_TTL_HOURS` — zero schema change, `EXPDB-ddl` untouched, retroactive env changes. Cost: sweep filters by a SQL expression (cheap; table is tiny; `idx_export_jobs_user` is by user, a scan is fine).
- SQL for sweep: `SELECT * FROM export_jobs WHERE status NOT IN ('queued','running') AND finished_at IS NOT NULL AND finished_at <= datetime('now', ?)` with param `` `-${hours} hours` `` (hours is a validated positive integer, so safe to interpolate into the param string). `finalizeExportJob` always sets `finished_at` (`db.ts:986-987`) for every terminal status, so D-03's single clock needs no per-status logic.
- JS side (DTO): SQLite string has no `Z`; parse as `new Date(s.replace(" ", "T") + "Z")`. Add to `exportJobAccess.ts`:
  ```typescript
  export const exportExpiresAt = (job: Pick<ExportJob,"finishedAt">): string | null =>
    job.finishedAt ? new Date(Date.parse(job.finishedAt.replace(" ", "T") + "Z") + getExportTtlHours() * 3_600_000).toISOString() : null;
  export const isExportExpired = (job: Pick<ExportJob,"finishedAt">): boolean => {
    const e = exportExpiresAt(job); return e !== null && Date.parse(e) <= Date.now();
  };
  ```
- Phase 131 seam: the comment at `exportJobAccess.ts:21` says "Phase 130 adds `expiresAt`". Recommend adding `expiresAt: string | null` to `ExportJobDto` now (it is what the download gate needs anyway). This breaks `lib.exportJobAccess.spec.ts:82` (`Object.keys(dto).sort()` exact list) — update that spec in the same plan.

### 3. Sweep (D-04)

- Precedent: `sessionStore.ts:279-293` `startSessionSweep` — `setInterval(..., 60*60*1000)`, try/catch with "do NOT clearInterval" comment, `handle.unref()`.
- Interval: **5 minutes** constant (`EXPORT_SWEEP_INTERVAL_MS = 5 * 60_000`, exported). TTL granularity is hours, so 5 min is ample and keeps "skipped due to open download" retries prompt. No extra env knob (avoid knob sprawl). Also call `runExportSweepOnce()` once synchronously right after boot reconcile, so rows that expired during downtime go immediately.
- Export both `runExportSweepOnce(): { deleted: number; skippedOpen: number }` (pure, sync) and `startExportSweep(): NodeJS.Timeout` (interval wrapper, `.unref()`, try/catch, logs only when `deleted > 0`).
- Sweep body per expired row: `if (isExportDownloading(id)) { skipped++; continue; }` then `removeExportFiles(job)` (the 4 `exportFilePaths` + the guarded `file_path` basename check, exactly the DELETE route logic at `exportRoutes.ts:112-117`; extract that to a shared helper and have the DELETE route call it) then `deleteExportJob(id)`; per-row try/catch. Files first, row second, so a failed unlink leaves the row for retry. Active (`queued`/`running`) rows are never selected, so live `.part` files are never touched by the sweep.
- Test strategy: drive `runExportSweepOnce()` directly (deterministic, no timers) for all behaviour; backdate by SQL (`UPDATE export_jobs SET finished_at = datetime('now','-2 days') WHERE id=?`). One tiny test of `startExportSweep` using `vi.useFakeTimers()` + `advanceTimersByTime(5*60_000)` mirroring `tests/sessionStore.sweep.spec.ts:33-42`, with `afterEach(() => vi.useRealTimers())` and `clearInterval(handle)`. The web "fake-timer leak" memory is about cross-file contamination under parallel scheduling in web vitest; the server config uses `isolate: true` (`vitest.config.ts`) and the existing sweep spec already uses fake timers safely, so risk is low; the `afterEach useRealTimers` + clearInterval hygiene is still required and sufficient.

### 4. Boot reconciliation (D-05..D-08)

Where: `index.ts:3287-3313` bootstrap IIFE:
```
const app = await createApp();
reconcileExportsOnBoot();            // NEW: before listen, after createApp (db is ready, sessions wiped)
app.listen(port, ...);
startSessionSweep();
startExportSweep();                  // NEW: after listen; first tick via runExportSweepOnce() inside
```
Why not inside `createApp()` next to `wipeSessionsOnModeChange` (`index.ts:239-262`): `createApp()` is called by `tests/helpers/app.ts:buildTestApp` per test and by `exportRoutesSmoke.ts:90` (`NODE_ENV=test`, line 31) — a reconcile there would `failed`-mark every in-flight `queued/running` job of a concurrently running test/smoke, and run more than once per process. The IIFE runs exactly once in production and never under `NODE_ENV=test`. The bootstrap regex (`tests/bootstrap.spec.ts:62`) requires the gate block to contain `app.listen` then `startSessionSweep()` then a `}`; adding calls before `app.listen` and after `startSessionSweep()` (but NOT adding a nested `{ }` block between them) keeps it passing; add a second structural assertion that the same block contains `reconcileExportsOnBoot()` and `startExportSweep()` (those names read 0 today).
Defence-in-depth: `reconcileExportsOnBoot` should skip rows whose id is live in the runner (`controllers`/`runs` maps, export a `isExportRunLive(id)` from `exportRunner.ts`) so a stray call can never fail a genuinely running job.

Algorithm (all sync):
1. Interrupted jobs: `SELECT id FROM export_jobs WHERE status IN ('queued','running')`; for each: `finalizeExportJob(id,'failed',{errorCode:'server_restarted', errorMessage: EXPORT_SERVER_RESTARTED_MESSAGE})` (guarded; its `WHERE status IN ('queued','running')` makes it idempotent), then `exportFilePaths(id)` `rmSync({force:true})`. Message: "Export stopped: the server restarted. Start it again." (D-05).
2. Orphan files: `readdirSync(getExportDir(), {withFileTypes:true})` (ENOENT -> nothing to do, do NOT create the dir). Own-name regex: `/^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.csv(?:\.gz)?(?:\.part)?$/i` (reuse `EXPORT_UUID_RE` pieces). Keep iff a row exists with `status='complete'` AND `path.basename(row.filePath) === dirent.name`; every other regex match is an orphan (covers `.part` of jobs just failed in step 1, files of failed/cancelled/deleted rows, files of rows already swept). Only `dirent.isFile()` (a symlink or directory is never removed or followed); no recursion; never `rmSync` a directory.
3. Safety against a misconfigured `EXPORT_DIR` (e.g. pointed at `/tmp` or home): the strict uuid-named regex is the primary protection (a real directory will not contain `<uuid>.csv`); additionally refuse to scan when `path.resolve(dir)` is the filesystem root. Unrecognised files are counted and left alone.
4. Logging (D-08): a single `console.log("[export] reconcile: N interrupted jobs failed, M orphan files removed")` only if `N+M > 0`. D-07 also says other files are "logged": emit ONE separate `console.warn("[export] reconcile: left K unrecognised file(s) in EXPORT_DIR untouched")` only when K>0 (a distinct condition from D-08's "nothing to do"; flagged for the planner as a reading of D-07/D-08, not a conflict).
Return `{ failed, orphansRemoved, unrecognised }` for tests.

ROADMAP criterion 2 wording ("every temp file without a corresponding non-terminal job row") is satisfied: after step 1 no non-terminal row exists, so every `.part` is removed.

### 5. Concurrency cap (D-09/D-10) — put it IN `startExport`

Race-safety evidence: `startExport` (`exportRunner.ts:178-211`) has no `await`; `buildExportPlan`, `insertExportJob`, and a new `SELECT COUNT(*)` are all synchronous better-sqlite3 calls; `run()` is only invoked after the insert. Node executes JS single-threaded, so two HTTP requests cannot interleave inside it. Check-then-insert is therefore atomic in one process (the app is a single Node process with a local SQLite file; a multi-process deployment would not be covered by the in-process model, but neither would the rest of the runner: `controllers`/`runs` are in-memory). Putting it in the route would also work but any other caller of `startExport` would bypass the cap; the runner is the single choke point.

Implementation: after `buildExportPlan` (so spec errors stay 400 first) and before `insertExportJob`:
```typescript
const cap = getExportMaxConcurrentPerUser();            // default 2
const active = countActiveExportJobsForUser(username);  // db.ts: SELECT COUNT(*) FROM export_jobs WHERE lower(username)=lower(?) AND status IN ('queued','running')
if (active >= cap) throw new ExportCapError("concurrency_cap", concurrencyCapMessage(active));
```
`ExportCapError` carries `code` and `message`. Route (`exportRoutes.ts:96-110` catch): `if (e instanceof ExportCapError) return res.status(429).json({ error: e.message, code: e.code });` — same `{error, code}` shape Phase 129 uses for 400s (`bad()` at :46, and `res.status(400).json({ error: e.message, code: e.code })` at :107). Nothing is created or stored for a refused start (D-10).
Provable test: with a stubbed fetch whose first batch never resolves (the `installStub(N, hold)` helper in `tests/routes.exports.spec.ts:50-80`), set `EXPORT_MAX_CONCURRENT_PER_USER=1` and call `startExport` twice back-to-back synchronously for the same user: first returns, second throws `ExportCapError`; `SELECT COUNT(*) FROM export_jobs` equals 1. A route-level variant fires two `POST /api/exports` via `Promise.all` (both reach the handler's sync segment serially) and asserts exactly one 202 and one 429. Case-insensitive: start as `Alice`, then `alice` -> second refused. Cap does not count terminal rows (finish/cancel the first, third start succeeds).

### 6. Row cap and size cap (D-12/D-13/D-14) — hook points

Row cap: in `run()` immediately after `setExportJobTotalRows(jobId, total)` (`exportRunner.ts:270`), before the header probe and before `fs.createWriteStream(partPath)` (`:291`). (`fs.mkdirSync` at :241 has already run but no file is created.)
```typescript
const rowCap = getExportMaxRows();                     // number | null
if (rowCap !== null && total > rowCap) throw new RowCapError(total, rowCap);
```
Size cap: extend `writeCsv` opts (`exportRunner.ts:49-69`) with `maxBytes?: number` and insert a counting Transform AFTER gzip, immediately before the sink (so it counts bytes headed to disk, D-14):
```typescript
function byteCap(max: number, onExceed: (n: number) => Error): Transform {
  let n = 0;
  return new Transform({
    transform(chunk, _enc, cb) {
      n += chunk.length;
      if (n > max) return cb(onExceed(n));   // error -> pipeline destroys all stages and rejects
      cb(null, chunk);
    },
  });
}
// pipeline(src, ...(gzip ? [createGzip()] : []), ...(maxBytes ? [byteCap(...)] : []), sink, { signal })
```
Why Transform over `sink.bytesWritten` polling in `onBatch`: batch granularity (up to `min(maxRowsPerQuery,maxRecordsPerCall)` = 20,000 rows per batch, `exportRunner.ts:100-103`) allows large overshoot; the Transform is exact per chunk, includes gzip's final flush chunk, and aborts through the same pipeline error path. Exactly `cap` bytes passes; strictly more fails.
Failure path: the pipeline rejects with the `SizeCapError`; the existing catch (`:295-299`) removes `.part`/final, then new branches (placed BEFORE the generic `internal_error` else, after the `AbortError` check) call `finalizeExportJob(jobId,'failed',{rowsWritten,errorCode:'row_cap'|'size_cap',errorMessage})`. `finalizeExportJob`'s write-once guard (`db.ts:976-999`) stays authoritative if a user cancel races. The `finally` still drops the snapshot view. `SizeCapError` must NOT have `name === "AbortError"` (else the catch labels it "cancelled"; the check is `signal.aborted || e?.name === "AbortError"` at :300).
Error codes (verified to read 0 today, see section 10): `row_cap`, `size_cap`, `server_restarted` (stored in `error_code`), and `concurrency_cap` (response `code` only; no row is created).

### 7. Messages (D-15..D-17)
Build in `lib/exportCaps.ts` as pure functions (unit-testable without a DB):
- Counts: `n.toLocaleString("en-US")` (Node ships full ICU; deterministic regardless of server locale because the locale is explicit). Pass `"en-US"` always.
- Size limit display: env is whole **MB**, converted to bytes as `mb * 1024 * 1024`. Display: `mb % 1024 === 0 ? `${mb/1024} GB` : `${mb.toLocaleString("en-US")} MB``. (Document MB = MiB; matches "2 GB" example in D-18.)
- `rowCapMessage(total, cap)`: "This export has 12,400,000 rows; the limit is 10,000,000. Add filters to narrow it down and try again."
- `sizeCapMessage({capMb, rowsWritten, total, gzip})`: total file size is unknowable at abort time, so D-15's "export's size" is expressed as progress: "This export is larger than the 2 GB limit (it passed the limit after 3,100,000 of 12,400,000 rows). Add filters to narrow it down and try again." plus, when `gzip` false, " You can also compress it (.csv.gz) to make the file smaller." (D-16.) Flag to planner: this reading of D-15 for the size cap (rows reached / total rows, not a byte total) is a necessary interpretation; if the operator wants an estimate ("about 5 GB") that needs extrapolation and should be an explicit decision.
- `concurrencyCapMessage(count)`: `You already have ${count} export${count===1?"":"s"} running. Wait for one to finish or cancel one, then try again.` (D-17; uses the actual active count, which equals the cap when the cap is the limiting factor.)
Constructed at the point of throw/finalize: concurrency in `startExport`; row/size messages in the runner catch from error-class fields (the size error carries nothing but the cap; `rowsWritten` and `total` come from `getExportJob(jobId)` there, `gzip` from `options`).

### 8. Client config seam (D-18)
- Server: `/api/auth/me` at `index.ts:458`. Existing values are boot-time consts at createApp() top (`index.ts:213-215`, AP-5 "read once"). Add one nested field to keep the response tidy:
  `exportLimits: { maxRows: number|null, maxFileMb: number|null, maxConcurrentPerUser: number }` computed once at createApp() top from the shared getters in `exportCaps.ts` (so unit tests set env before `buildTestApp()`). Always present; unset caps are explicit `null` (stable shape for 131). TTL is also useful to the dialog/history: include `ttlHours` (cheap; 131's history shows expiry per row via DTO `expiresAt`, so optional — recommend omit to keep scope minimal).
- Server spec ripple: `tests/auth.routes.spec.ts:383` and `:395` use `toEqual` on the entire `/me` body (exact fields) and WILL fail once `exportLimits` is added; update both to include `exportLimits: { maxRows: null, maxFileMb: null, maxConcurrentPerUser: 2 }` (setup.ts blanks the env, see Pitfall 6). `tests/auth.me.rowLimits.spec.ts` reads single fields and is unaffected; add a sibling spec for the new field with env set.
- Web: `MeResponse` type (`packages/web/src/api/client.ts:253`) and `fetchMe` which builds its result field by field with defaults (`client.ts:286-300`) — a field not mapped there is SILENTLY DROPPED. Add `exportLimits` to the type and to the mapper with a defensive default (`{maxRows:null,maxFileMb:null,maxConcurrentPerUser:2}` for an older server). Store: add `exportLimits` to `AuthState` + initial state + the `set({...})` in `bootstrap` (`packages/web/src/store/auth.ts:15-61`). Web specs: `auth.spec.ts` asserts individual fields (no whole-state `toEqual`), so adding fields does not break it; add one default test and one bootstrap test mirroring `RLME-store-default` / `RLME-store-bootstrap` (`auth.spec.ts:99-114`). No UI (Phase 131 renders).

### 9. Human-verify for ROADMAP criterion 3 (held-open download spanning a forced sweep)
Use the 129-04 smoke infrastructure: `src/spikes/exportRoutesSmoke.ts` runs `createApp()` + `listen(0)` in-process with `NODE_ENV=test`, in-memory SQLite, temp EXPORT_DIR (lines 29-33, 90-91). Because DB and module state are in-process, the sweep can be forced by importing it directly (no env hacks, no tiny-TTL knob needed). Add step R8 to that script (`npm run export-routes-smoke`):
1. Run a real export to `complete` (existing steps R1-R2 produce one) and record `id`, `sha`, `fileBytes`.
2. Open `GET /api/exports/:id/download` with `node:http`, a tiny `highWaterMark`, and call `res.pause()` after the first chunk so the server's send stream is blocked by backpressure (the held-open download). Use a file larger than the loopback socket buffers (several MB) so the stream cannot drain into kernel buffers; if the smoke table is too small, state it and rely on step 3's direct evidence.
3. Assert `isExportDownloading(id) === true` (imported from `../lib/exportCleanup`), then backdate: `db.prepare("UPDATE export_jobs SET finished_at = datetime('now','-3 days') WHERE id = ?").run(id)`, then call `runExportSweepOnce()`.
4. Assert: sweep result `skippedOpen >= 1`; file still exists; row still exists. Then `res.resume()`, read to end, assert sha256 equals the recorded one (download completed intact despite the sweep).
5. After the response closes, `await sleep(50)`, call `runExportSweepOnce()` again: file and row now gone. A fresh `GET .../download` now returns 404 (and with the row present but expired, before the sweep, 410). Report as `R8 sweep-vs-open-download`.
Human steps: operator runs the smoke and reads the R8 line plus the evidence string (`open=true skipped=1 file_kept=true sha_match=true after_close_deleted=true new_get=404`). Optional manual variant against a running dev server with `curl --limit-rate 50k -o /dev/null` on a large export while backdating `finished_at` through the `sqlite3` CLI and waiting for a 5-minute tick is possible but needs waiting for the tick; the in-process smoke is the recommended, repeatable procedure. This stays a `checkpoint:human-verify` per ROADMAP; the automated unit tests (refcount skip, sync-invariant) only cover the structural precondition, and the plan should say so rather than claim the live race is automatically proven.

### Anti-Patterns to Avoid
- **Reconcile inside `createApp()`**: fails in-flight jobs of other tests/smoke, runs repeatedly (see section 4).
- **Awaiting inside the sweep** between the open-download check and delete: reopens the race that the sync design eliminates.
- **Decrementing the refcount only in the `res.download` callback**: callback is skipped/odd on aborted streams; use `res.once("close")`.
- **Stored `expires_at`**: freezes TTL at finish time and breaks `EXPDB-ddl`.
- **Polling `bytesWritten` per batch for the size cap**: overshoots by up to one 20k-row batch.
- **Wiping `EXPORT_DIR`**: only exact `<uuid>.csv[.gz][.part]` regular files.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Terminal-state write at boot / on cap failure | Raw `UPDATE export_jobs SET status=...` | `finalizeExportJob` (`db.ts:976`) | Write-once guard prevents overwriting a concurrent cancel/complete |
| File removal set for a job | New path-building logic | `exportFilePaths` + the guarded `file_path` basename check (extract from DELETE route) | Already handles all four suffixes and path-traversal guard |
| Env parsing | A new parser | Existing idiom (`readPositiveIntEnv` at `index.ts:187`; runner's warn-once getter at `exportRunner.ts:82-96`); generalise the latter to `readExportPositiveInt(name, def)` and keep `getExportViewTtlMinutes` behaviour identical | Consistent fallback+warn |
| Size counting | Re-`stat` loops or `bytesWritten` polling | A `Transform` after gzip | Exact, backpressure-safe, aborts via pipeline |
| Range/resume/416 | Custom handling | `res.download` -> send (unchanged) | Phase 129 already verified |

## Common Pitfalls

### Pitfall 1: Sweep deletes a file during an open download
**Goes wrong:** Row+file removed while a client streams/resumes. **Avoid:** refcount set in the route's sync segment; sweep sync; sweep skips and retries next tick. **Warning:** sweep log shows a delete for an id with an open count.

### Pitfall 2: Refcount leak on aborted connections
**Goes wrong:** Decrement only on success -> file never swept. **Avoid:** `res.once("close")` with idempotent release; test by destroying the client socket mid-download then asserting `isExportDownloading(id) === false` after a tick.

### Pitfall 3: SQLite datetime vs JS dates
`finished_at` is `datetime('now')` UTC with no `Z` and 1-second resolution (`db.ts:372-374`). Compare in SQL (`datetime('now', '-N hours')`) and parse with explicit `Z` in JS. `new Date("2026-10-07 10:00:00")` would be parsed as LOCAL time.

### Pitfall 4: Reconcile failing live jobs in tests/smoke
Mitigation: IIFE-only call + `isExportRunLive` skip.

### Pitfall 5: Cap error mislabelled as cancel
`SizeCapError`/`RowCapError` must not set `name = "AbortError"`; the catch checks `signal.aborted || name === "AbortError"` first (`exportRunner.ts:300`). If the user cancels at the same moment the pipeline error might still win; `finalizeExportJob` is write-once so the first terminal write is authoritative (acceptable, document).

### Pitfall 6: Dev `.env` leaking into server vitest (MEMORY: dev-env-leaks-into-server-vitest)
`env.ts` dotenv loads `packages/server/.env`. Add to `tests/setup.ts` next to `EXPORT_DIR`/`EXPORT_VIEW_TTL_MINUTES` (lines 38-40): `process.env.EXPORT_TTL_HOURS = ""; EXPORT_MAX_ROWS = ""; EXPORT_MAX_FILE_MB = ""; EXPORT_MAX_CONCURRENT_PER_USER = "";` and make the getters treat `""` as unset. Otherwise a dev override of `EXPORT_MAX_CONCURRENT_PER_USER=1` falsely fails route specs that start two exports.

### Pitfall 7: Existing route specs that start >2 exports per user
With default cap 2, any existing spec that starts three concurrent exports for one user (e.g. concurrency/hold scenarios in `routes.exports*.spec.ts`, `lib.exportRunner*.spec.ts`) would newly 429. The executor must run the existing export specs after adding the cap and either finish jobs between starts or raise the cap via env in those specs. Verify by running the full export spec set (see Validation).

### Pitfall 8: Typo disables a cap silently
Invalid `EXPORT_MAX_ROWS=10M` falls back (idiom) to the default, which for caps is "unlimited" plus a one-time warn. This is fail-open. Acceptable and consistent with the project idiom; mention it in `.env.example` comments.

### Pitfall 9: `/me` exact-shape specs
`auth.routes.spec.ts:383,395` break (section 8). Web `fetchMe` silently drops unmapped fields.

### Pitfall 10: Orphan rule must not delete a complete job's file
Keep iff row is `complete` AND basename matches `file_path`; use exact name compare, not job-id-only compare (a `.csv.part` for a complete job is an orphan; a `.csv` for a failed job is an orphan).

## Code Examples

### Env getters (exportCaps.ts)
```typescript
const warned = new Set<string>();
function readInt(name: string): number | null {          // null = unset/invalid
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    if (!warned.has(`${name}=${raw}`)) { warned.add(`${name}=${raw}`); console.warn(`[export] ${name} must be a positive integer (got: ${JSON.stringify(raw)}); ignoring`); }
    return null;
  }
  return n;
}
export const getExportTtlHours = () => readInt("EXPORT_TTL_HOURS") ?? 24;
export const getExportMaxRows = () => readInt("EXPORT_MAX_ROWS");               // null = unlimited
export const getExportMaxFileMb = () => readInt("EXPORT_MAX_FILE_MB");          // null = unlimited
export const getExportMaxConcurrentPerUser = () => readInt("EXPORT_MAX_CONCURRENT_PER_USER") ?? 2;
```

### db.ts helpers (no schema change)
```typescript
export const countActiveExportJobsForUser = (username: string): number =>
  (db.prepare("SELECT COUNT(*) AS n FROM export_jobs WHERE lower(username) = lower(?) AND status IN ('queued','running')").get(username) as { n: number }).n;
export const listActiveExportJobs = (): ExportJob[] =>
  db.prepare("SELECT * FROM export_jobs WHERE status IN ('queued','running')").all().map(mapExportJob);
export const listExpiredExportJobs = (ttlHours: number): ExportJob[] =>
  db.prepare("SELECT * FROM export_jobs WHERE status NOT IN ('queued','running') AND finished_at IS NOT NULL AND finished_at <= datetime('now', ?)").all(`-${ttlHours} hours`).map(mapExportJob);
export const listCompleteExportFileNames = (): Set<string> => /* SELECT file_path WHERE status='complete' -> basenames */;
```

### Boot wiring (index.ts IIFE)
Insert `reconcileExportsOnBoot();` between `const app = await createApp();` and `app.listen(...)`, and `startExportSweep();` after `startSessionSweep();` (no new braces between them; keeps the bootstrap regex green).

## State of the Art

| Old | Current | Impact |
|-----|---------|--------|
| In-memory-only job state (PITFALLS Pitfall 6) | SQLite registry (Phase 128) + boot reconcile (this phase) | Restart no longer strands rows/files |
| Fixed-clock TTL delete (PITFALLS Pitfall 9) | Refuse-new at expiry (410) + physical delete gated on no open download | No mid-download delete |

## Open Questions

1. **Size-cap message "export's size" (D-15)**
   - Known: total file size is unknown when the cap trips mid-write.
   - Recommendation: state limit + rows reached/total (section 7). Surface to operator at plan review if a byte estimate is wanted.
2. **Unrecognised-file warning vs D-08 "one summary line"**
   - Recommendation: one extra `console.warn` only when unrecognised files exist (D-07 says "logged").
3. **Sliding expiry extension on resume (PITFALLS Pitfall 9 bullet 3)**
   - Not in CONTEXT.md decisions (D-02 fixes the clock at `finished_at`); treat as out of scope. Do not implement.
4. **Download of an expired-but-unswept row returns 410 (not 404)**
   - Consistent with CONTEXT D-04 "404/410"; after the sweep deletes the row it is 404. Both satisfy the decision.

## Validation Architecture

(`workflow.nyquist_validation` not set to false; section included.)

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest ^4.1.5 + supertest ^7.2.2 (server); vitest (web) |
| Config file | `packages/server/vitest.config.ts` (include `tests/**/*.spec.ts`, `setupFiles ./tests/setup.ts`, `isolate: true`) |
| Quick run command | `cd packages/server && npx vitest run tests/lib.exportCleanup.spec.ts tests/lib.exportCaps.spec.ts tests/lib.exportRunner.caps.spec.ts` |
| Export suite | `cd packages/server && npx vitest run tests/lib.exportRunner tests/routes.exports tests/db.exportJobs tests/lib.exportJobAccess tests/auth.routes.spec.ts tests/auth.me tests/bootstrap.spec.ts` |
| Full suite command | `cd packages/server && npm run test:gate` (SET-BASED; never assert a fixed pass count) plus `npx tsc --noEmit`; web: `cd packages/web && npx tsc --noEmit && npx vitest run src/store/auth.spec.ts` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| EXPRT-V126-14 | Sweep deletes expired terminal rows+files (all statuses, D-03); keeps unexpired | unit | `npx vitest run tests/lib.exportCleanup.spec.ts -t "EXPSWEEP-"` | Wave 0 |
| EXPRT-V126-14 | Sweep skips job with open download, deletes after release | unit | same `-t "EXPSWEEP-open-download"` | Wave 0 |
| EXPRT-V126-14 | Refcount released on client abort (socket destroy) | integration (supertest/http) | `npx vitest run tests/routes.exports.download.spec.ts -t "EXPSWEEP-abort-release"` | extend existing |
| EXPRT-V126-14 | Expired-unswept download -> 410; swept -> 404 | route | `npx vitest run tests/routes.exports.download.spec.ts -t "EXPSWEEP-expired-410"` | extend existing |
| EXPRT-V126-14 | Boot reconcile fails queued/running with `server_restarted`, removes partials, orphan rule keeps complete file, ignores foreign/symlink/dir, one summary log | unit (temp dir) | `npx vitest run tests/lib.exportCleanup.spec.ts -t "EXPBOOT-"` | Wave 0 |
| EXPRT-V126-14 | Reconcile is in the bootstrap IIFE only | structural | `npx vitest run tests/bootstrap.spec.ts -t "EXPBOOT-iife"` | extend existing |
| EXPRT-V126-14 | Live: sweep never deletes held-open download | checkpoint:human-verify | `npm run export-routes-smoke` step R8 | smoke edit |
| EXPRT-V126-15 | Concurrency cap: two sync starts, one passes; case-insensitive; terminal not counted; route 429 shape | unit+route | `npx vitest run tests/lib.exportRunner.caps.spec.ts -t "EXPCAP-conc"` | Wave 0 |
| EXPRT-V126-15 | Row cap fails after COUNT, no file written, message | unit | `-t "EXPCAP-row"` | Wave 0 |
| EXPRT-V126-15 | Size cap (gz and non-gz) aborts, `.part` gone, `size_cap`, message hints gzip only when off | unit | `-t "EXPCAP-size"` | Wave 0 |
| EXPRT-V126-15 | Message builders (formatting, plural) | unit | `npx vitest run tests/lib.exportCaps.spec.ts` | Wave 0 |
| EXPRT-V126-15 | `/me` exposes `exportLimits` | route | `npx vitest run tests/auth.me.exportLimits.spec.ts` | Wave 0 |
| EXPRT-V126-15 | Web `fetchMe`/store carry `exportLimits` | web unit | `cd packages/web && npx vitest run src/store/auth.spec.ts` | extend existing |

Mutation-probe habit (as in `routes.exports.spec.ts` header): after green, break each guard (remove refcount check, drop `isExportExpired`, drop the cap compare, move reconcile into createApp) and confirm the matching test goes red.

### Sampling Rate
- Per task commit: quick run command + `cd packages/server && npx tsc --noEmit`
- Per wave merge: export suite + `npm run test:gate`
- Phase gate: full set-based gate green, web tsc + auth spec green, theme-guard untouched (no UI), then the R8 human-verify

### Wave 0 Gaps
- [ ] `tests/lib.exportCleanup.spec.ts` (sweep, tracker, reconcile; temp EXPORT_DIR via `fs.mkdtempSync`)
- [ ] `tests/lib.exportCaps.spec.ts` (getters, formatters, messages)
- [ ] `tests/lib.exportRunner.caps.spec.ts` (concurrency/row/size using the stubbed-fetch helper from `routes.exports.spec.ts:50`)
- [ ] `tests/auth.me.exportLimits.spec.ts`
- [ ] Update: `tests/setup.ts` (blank 4 new env vars), `tests/auth.routes.spec.ts:383,395`, `tests/lib.exportJobAccess.spec.ts:82` (DTO keys, if `expiresAt` added), `tests/bootstrap.spec.ts` (new structural test), `src/spikes/exportRoutesSmoke.ts` (R8), `packages/server/.env.example` (document 4 envs), web `client.ts`/`store/auth.ts`/`auth.spec.ts`
- Framework install: none needed

## Candidate grep anchors (CLAUDE.md rule: verified to read 0 today across `packages/server/src`, `packages/server/tests`, `packages/web/src`)

Run on 2026-10-07; each count was 0:
`EXPORT_TTL_HOURS`, `EXPORT_MAX_ROWS`, `EXPORT_MAX_FILE_MB`, `EXPORT_MAX_CONCURRENT_PER_USER`, `EXPORT_SWEEP_INTERVAL` (reserved name if ever used), `row_cap`, `size_cap`, `server_restarted`, `concurrency_cap`, `runExportSweepOnce`, `reconcileExportsOnBoot` (the grep for the shorter `reconcileExports` also read 0), `exportLimits`-style names `exportCaps` (0), `beginExportDownload` (0; note the recommended tracker name `trackExportDownload`/`isExportDownloading` has not been grepped, re-verify before writing the criterion), `maxExportRows` (0).
DO NOT use as anchors (already noisy): `expires_at` (67 hits) and `expiresAt` (404 hits) — unrelated session/TTL code. If an `expiresAt` anchor is needed use the compound `exportExpiresAt` or the test title prefix `EXPSWEEP-` (re-verify 0 before use).
Test-title prefixes to adopt (re-verify 0 before committing a criterion): `EXPSWEEP-`, `EXPBOOT-`, `EXPCAP-`.
Non-grep requirements to route to `checkpoint:human-verify`: ROADMAP criterion 3 (live held-open download); legibility of messages in the (Phase 131) UI.

## Sources

### Primary (HIGH confidence) — repo code read directly
- `packages/server/src/exportRoutes.ts:1-166` (routes, download gate chain, 129 error shapes)
- `packages/server/src/lib/exportRunner.ts:1-352` (`startExport` :178, `run` :222+, COUNT :266-270, pipeline :291, catch :295-)
- `packages/server/src/lib/exportJobAccess.ts` (DTO seam, `resolveServableExportFile`)
- `packages/server/src/db.ts:358-379, 391-520, 905-1004` (schema, migration pattern, export job helpers)
- `packages/server/src/sessionStore.ts:279-293`; `packages/server/src/index.ts:187-215, 239-262, 458, 3287-3313`
- `packages/server/tests/{bootstrap,db.exportJobs,auth.routes,lib.exportJobAccess,setup,routes.exports,sessionStore.sweep}.spec.ts`
- `packages/web/src/api/client.ts:253,286-300`, `packages/web/src/store/auth.ts`, `packages/web/src/store/auth.spec.ts`
- `node_modules/express/lib/response.js` (4.22.2), `node_modules/send/index.js` (0.19.2): `onFinished`, `createReadStream` lifecycle
- `.planning/research/PITFALLS.md` Pitfalls 6 and 9; `.planning/ROADMAP.md` Phase 130 criteria; `.planning/STATE.md` "For Phase 130"

### Secondary / Tertiary
- Node `ServerResponse` 'close' semantics and POSIX unlink-with-open-fd behaviour are standard platform behaviour (from training knowledge, consistent with PITFALLS.md Pitfall 9); MEDIUM. The design deliberately does not depend on it (refcount + sync sweep), and the R8 smoke verifies it live.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH (no new libs; versions read from node_modules)
- Architecture: HIGH (every hook point cited with file:line; sync-atomicity argument follows from the code)
- Pitfalls: HIGH for repo-specific ones (spec ripples verified by grep); MEDIUM for socket-buffer behaviour in the R8 smoke (file size must exceed kernel buffers)

**Research date:** 2026-10-07
**Valid until:** 2026-11-06 (stable internal code; revalidate line numbers if Phases 131 edits land first)
