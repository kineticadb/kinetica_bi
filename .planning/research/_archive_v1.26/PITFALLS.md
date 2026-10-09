# Pitfalls Research

**Domain:** Server-side background CSV export (streaming, resumable, batched) + global row-limit fix + line-chart multi-series, added to an existing React/Express/SQLite BI app fronting Kinetica.
**Researched:** 2026-10-01
**Confidence:** HIGH (codebase-grounded — read `kinetica.ts`, `index.ts`, `WidgetRenderer.tsx`, `materializedView.ts`, `permissions.ts`, `dashboardExport.ts`, `useViewKeepAlive.ts` directly) with one externally-verified fact (Kinetica's own pagination model, via official docs, below).

## Critical Pitfalls

### Pitfall 1: "Raise the limit" is a blast-radius change, not a one-line fix

**What goes wrong:**
`kineticaSql` (`packages/server/src/kinetica.ts:186-187`) hardcodes `limit: 1000` into the request envelope of **every** `/execute/sql` call. The generic proxy `POST /api/sql` (`index.ts:2904-2915`) forwards the client's `options` body field verbatim as `extra`, which — because of how the body is built (`{ ...defaults, ...(options.extra ?? {}) }`, a shallow spread where same-level keys are fully overwritten, not merged) — already lets a caller override `limit` per-call today (`INFO_QUERY` does exactly this, pinning `extra: { limit: 50 }`, `index.ts:2374`). Bumping the *default* from 1000 to something large (or to Kinetica's own sentinel, see Pitfall 2) changes behavior for **every caller that builds a raw `SELECT`/`SELECT *` with no SQL-level `LIMIT` of its own**, relying — probably unknowingly — on the 1000 envelope cap as an implicit safety net. The records-table main page-fetch, the info/map popup (already pinned to 50, safe), discovery/show-table calls (schema-level, not row dumps, safe), and any ad-hoc `runSql()` call site that omits its own `LIMIT` are the ones at risk. Memory note `track_config is a top-level layer field` and the Phase 126 audit habit ("blast radius... not assumed") both point at the same lesson: a shared low-level helper used everywhere means a change to its default hits call sites nobody read in this phase.

**Why it happens:**
The 1000 cap is currently acting as an *accidental* query governor across the whole app. Nobody wrote "LIMIT 1000" into their SQL on purpose at most call sites — they get it for free from the envelope. Removing that free safety net surfaces every caller that was implicitly depending on it, and the failure mode (a records table or info popup suddenly pulling 500K rows into a browser tab) looks nothing like the fix itself — it will NOT show up by inspecting the export code.

**How to avoid:**
- Before changing the default, `grep -rn "runSql(\|kineticaSql(\|kineticaSqlHelper(" packages/server/src packages/web/src` and classify every call site: (a) has its own SQL `LIMIT`, safe; (b) already passes `extra.limit`/`options.limit`, safe; (c) neither — flagged, needs either an explicit SQL `LIMIT` added or an explicit low `extra.limit` pin before the default changes.
- Prefer **not** touching the global default at all. Give the new export job (and only the export job) its own `extra: { limit: <batchSize>, options: { paging_table, paging_table_ttl } }` per call (see Pitfall 2), and raise the *client-side CSV* fix (`WidgetRenderer.tsx:1987-1999`) by having its SQL always carry an explicit `LIMIT ${limit} OFFSET ${offset}` (it already does) plus an explicit `extra.limit` matching or exceeding it, rather than bumping the shared default every other caller inherits.
- If the default genuinely must rise, do it last, after the audit, with every at-risk call site given its own explicit cap first — so the change is provably a no-op for everyone except the new export path.

**Warning signs:**
- Any `runSql(sql)` or `kineticaSqlHelper(req, sql, {...})` call where `sql` has no `LIMIT` clause and `options.extra`/`extra` has no `limit` key.
- A records-table or map-popup page suddenly rendering far more rows than its configured page size after the limit change ships.

**Phase to address:**
Phase covering "fix the 1,000-row ceiling" — must include the caller audit as an explicit sub-task with its own acceptance criterion (a list of call sites + classification), not just the kinetica.ts edit.

---

### Pitfall 2: Reinventing OFFSET pagination when Kinetica already has a purpose-built, TTL-decoupling mechanism

**What goes wrong:**
The existing CSV loop (`WidgetRenderer.tsx:1987-1999`) re-issues `SELECT ... LIMIT ${limit} OFFSET ${offset}` once per page against the live view, with **no `ORDER BY` at all unless the table happens to have a selected sort column** (`orderBy` is only appended `if (sortField && IDENT_RE.test(sortField))`, `WidgetRenderer.tsx:1977-1980`). Re-running an unordered (or non-uniquely-ordered) query per page against a view whose underlying data can change between calls is exactly the classic OFFSET trap: rows can repeat across pages, be skipped, or (worse) silently change their row count mid-export if the view's TTL expires and re-materializes between batches. Naively porting this same per-batch re-query loop into the new 20k-row-batch server-side job just moves the bug server-side and makes it worse (more batches, more time elapsed, more chances for the view to expire or for a `LIMIT 20000` batch to exceed Kinetica's server-configured `max_get_records_size` and get silently truncated the same way the current 1000-row bug does — an identical bug recurring one layer up if the exhaustion check is naive).
Confirmed against **official Kinetica docs** (`docs.kinetica.com/7.1/api/rest/execute_sql_rest/`, fetched 2026-10-01): `/execute/sql`'s `limit` defaults to `-9999` (`END_OF_SET`), meaning "return the max the server allows," and that server maximum is a deployment-level `max_get_records_size` config value the app does not control and cannot see. Kinetica's own documented pattern for "give me all the rows from one query, across multiple calls, in a stable order, without re-running the query" is **not** re-issuing OFFSET/LIMIT — it is nesting `paging_table` / `paging_table_ttl` inside the request's `options` map on the *first* call (example shape: `{ statement, offset, limit, options: { paging_table: "<name>", paging_table_ttl: <ttl> } }`). The first call executes the query once and caches the full result set server-side under that name, in a fixed order; every subsequent call with the same `paging_table` name is a cheap read of the cached set — no re-execution, no re-dependency on the source view, and the response's `has_more_records` / `total_number_of_records` fields give an authoritative exhaustion signal instead of inferring "done" from `rows.length < limit` (which is the exact inference that hides a `max_get_records_size`-truncated batch).

**Why it happens:**
The current client-side loop was written for a feature (interactive CSV download capped at 100K rows) where correctness-under-concurrent-writes was a lower-stakes, rarely-hit edge case. Porting the same shape to a server-side job that may run for minutes against a table still being written to raises the odds of hitting it, and the shared helper (`kineticaSql`'s `extra` passthrough, see Pitfall 1) already supports the better mechanism — it just isn't used anywhere in this codebase yet, so there is no existing call site to copy from.

**How to avoid:**
- Design the export job's Kinetica calls around `options.paging_table` from the start: first batch call sets `paging_table`/`paging_table_ttl`; all later batches reuse the same name; stop when `has_more_records` is false, not when a batch returns fewer rows than requested.
- Treat this as a **spike item**, in this repo's own established style (see `kinetica.ts:274-281`'s reference to a live-verified `122-SPIKE-NOTES.md`): verify `paging_table` behavior against the real Kinetica instance (including: does it tolerate the source table/view being dropped or TTL-expired after the first call; what `paging_table_ttl` value keeps the cache alive for the longest expected export) before committing the job's architecture to it, since this research could not make live calls to confirm.
- If `paging_table` is unavailable, degrade to the explicit-sort-key OFFSET approach (always append a unique, stable `ORDER BY <column>, <tiebreaker-pk-or-rowid>` — never ship the current "`ORDER BY` only if a sort field happens to be selected" behavior into the export path) AND re-verify each batch's row count against the original query's `COUNT(*)` captured at job start, so a silently truncated batch is detected rather than mistaken for "done."

**Warning signs:**
- Export row count doesn't match the `COUNT(*)` the job captured at start.
- Duplicate or missing rows near page boundaries, worse under concurrent writes to the source table.
- A batch returns exactly `max_get_records_size`-looking round numbers consistently below the requested batch size (symptom of hitting the undocumented server ceiling, same shape as today's 1000-row bug).

**Phase to address:**
The server-side export job core (batching/streaming) phase — this is architectural, decide it before writing the batch loop, not after.

---

### Pitfall 3: The view-keepalive mechanism that exists today is frontend-only and has no server-side analog

**What goes wrong:**
`useViewKeepAlive.ts` is explicit: "FRONTEND-ONLY... Mount: DashboardsPage.tsx." It is a React hook, scheduled with browser timers, that periodically issues `SELECT 1 FROM <viewName> LIMIT 1` to reset Kinetica's sliding TTL on a materialized/filter view **while a dashboard tab is open**. A server-side export job has no dashboard tab, no mounted React tree, and runs for however long the batches take — potentially well past `DEFAULT_VIEW_TTL_MINUTES` (default 5 minutes, `index.ts:198`). If the job's batch loop just re-queries the view's name without anything resetting its TTL, the view can expire mid-export (dropped by Kinetica's TTL, or the app's own materialization churn), and the next batch's `FROM <viewName>` fails outright or — worse — silently resolves against a *different*, newly re-materialized view with the same name holding different data, producing a corrupted export that looks successful.

**Why it happens:**
It's easy to assume "the keepalive is already handled" because the feature exists in the codebase, without noticing the doc comment says FRONTEND-ONLY and is wired to a specific page's mount lifecycle, not to arbitrary long-running server work.

**How to avoid:**
- If adopting `paging_table` (Pitfall 2): only the **first** batch call touches the live view; every subsequent batch reads the cached paging table, so the view's TTL is only a concern for the brief window around job start, not the whole job duration — this is the strongest argument for paging_table over raw OFFSET re-querying for this feature specifically.
- If not: the export job must independently issue its own periodic keepalive read (or re-request materialization) server-side, on its own schedule, decoupled from any browser session — and must do so using the *same user's* credentials the job was started with (see Pitfall 7), since the keepalive read goes through `kineticaSql` same as any other call.
- Either way, the job must handle "view not found" by failing the export with a clear, resumable-from-start error, not by silently reading an empty/different table.

**Warning signs:**
- Export jobs against filter-combination views succeed when small/fast, fail intermittently on large exports that cross the TTL boundary.
- Row counts or content in a completed export don't match the dashboard's on-screen filtered view at the time the export was requested.

**Phase to address:**
Server-side export job core phase, same as Pitfall 2 — these two are really one design decision (paging_table vs. OFFSET+keepalive).

---

### Pitfall 4: Unbounded buffering defeats the entire point of "never held whole in memory"

**What goes wrong:**
The stated goal is a stream-to-temp-file pipeline that never materializes the whole export in memory, batch size 20,000 rows. It's easy to satisfy this on paper while still accidentally buffering: e.g. accumulating all batches into one in-memory array before a single `fs.writeFile`, or using a write stream without respecting its `write()` return value / `drain` event, letting Node's internal buffer grow unbounded if Kinetica responds faster than disk I/O drains. The symptom won't appear in a small manual test (a 50K-row export "works fine" buffered) and only shows up at the scale the feature exists for — a million-row export — exactly when nobody is watching.

**Why it happens:**
Node's `fs.createWriteStream` is easy to use incorrectly-but-functionally: `stream.write(chunk)` always "succeeds" from the caller's perspective even when it returns `false` (buffer full); without checking the return value and awaiting `'drain'`, the caller just keeps calling `write()`, growing the internal buffer. This is a well-known, easy-to-miss Node streaming gotcha, not specific to this codebase, but the codebase has **zero existing precedent for streaming large data to disk** — the only existing file I/O is `multer({ storage: multer.memoryStorage() })` for logo uploads (`index.ts:362-363`), which is deliberately small and in-memory. There is no streaming pattern anywhere in this repo to copy from; this phase is "first of its kind" for the codebase.
There's also a Kinetica-level mirror of the same mistake: fetching all 20,000-row batches back-to-back without pacing against write-side backpressure means the HTTP client to Kinetica can race far ahead of the file writer, buffering whole batches in JS memory between fetch and write.

**How to avoid:**
- Respect `writeStream.write(chunk)`'s boolean return; `await` a `'drain'` listener before issuing the next Kinetica batch fetch when it returns `false`. Pull the next batch only after the previous batch's bytes are confirmed drained/written, i.e. make batch-fetch sequentially dependent on write-drain, not fire-and-forget.
- Convert each batch's rows to CSV incrementally (row-by-row or small-chunk string building), not by building one giant string for the whole batch and definitely not for the whole export, before writing.
- Add a test/benchmark with a large synthetic row count (mocked Kinetica) that asserts peak process memory stays bounded and roughly flat across batch count — a functional "exports 20 rows" test will pass even with a fully-buffered implementation and prove nothing about this pitfall (same shape as this repo's own toothless-grep lesson: write a check that can actually fail).

**Warning signs:**
- Process RSS grows roughly linearly with export size during a large export (should be flat).
- Export "works" at 10K rows in dev, OOMs or degrades badly at 1M rows in the only environment anyone tries it.

**Phase to address:**
Server-side export job core (streaming/batching) phase.

---

### Pitfall 5: gzip + HTTP Range is only valid on a *complete, closed* file — not a file being written

**What goes wrong:**
Two separate, easy-to-conflate behaviors:
1. **Range semantics on gzip are byte-range of the compressed bytes, not the logical CSV.** A client resuming a `.csv.gz` download via `Range: bytes=N-` gets bytes N onward of the *compressed* stream. That's a perfectly valid, correct way to resume a download of a file that will never change again — but it is meaningless/corrupting applied to a file still being appended to by the export job, because gzip's compressed byte stream for "the first 60%" is not a prefix of the compressed byte stream for "the full file" in a way a partial download + continued compression can concatenate cleanly without careful use of flushed gzip members. In practice: **never serve Range reads against a file the export job hasn't finished and closed.**
2. If a download starts (even non-Range) while the job is still writing, and the job later fails/is cancelled, the client has already received a response that *looks* complete (full `Content-Length` sent, connection closed normally) but contains truncated/corrupt CSV — there is no way for the client to know, after the fact, that what it has is partial.

**Why it happens:**
It's tempting to let the download route just `fs.createReadStream(path)` as soon as a job row exists, especially once progress/streaming is already the pattern for ingestion — but "download" and "ingestion" being both long-running makes it easy to forget they must not overlap on the *same file*, and that Range correctness has a hard precondition (file is finished) that isn't enforced by Express/`res` plumbing, only by application logic.

**How to avoid:**
- The download route must check job status is `"complete"` (file fully written and closed) before it will serve *any* bytes, Range or not. A `"running"`/`"cancelled"`/`"failed"` job returns 409/404, never a partial stream.
- Compute `Content-Length` from the **final, closed file's** size on disk (`fs.statSync(path).size`), never from an estimate — and set a strong `ETag`/`Last-Modified` derived from that same finished-file state (e.g. hash or mtime+size) so a `Range` request's `If-Range` validator correctly detects "the underlying file hasn't changed since you started downloading," which matters once cleanup/TTL (Pitfall 9) can delete-and-regenerate.
- gzip: write the `.gz` file complete, once, as part of the job (e.g. pipe CSV writes through a `zlib.createGzip()` into the same write-stream pipeline) — never gzip-on-the-fly during the *download* response if Range support is required, since a fresh gzip stream per download request can't honor arbitrary byte offsets into a previous, independently-compressed representation.
- Advertise `Accept-Ranges: bytes` only once the file is finalized; respond `416` to a Range request against an out-of-bounds offset (e.g. client resuming against a since-regenerated, smaller file).

**Warning signs:**
- A resumed download produces a file that fails `gunzip` integrity check or has garbled content mid-file.
- Downloads started during an in-progress export silently succeed with a truncated row count and no error surfaced anywhere.

**Phase to address:**
Resumable download / Range / gzip phase — explicitly gate it on job-complete state; write a test that asserts the route 409s/404s a Range request against a `"running"` job row.

---

### Pitfall 6: No existing job-registry precedent — in-memory state lost on crash or restart leaves stuck rows and orphaned files

**What goes wrong:**
This app has never had a long-running background job before. The closest existing precedent, the session GC sweep (`index.ts:3265-3276`, kicked off *after* `app.listen` so "any startup error in sessionStore surfaces before we accept traffic"), is a periodic cleanup of *already-persisted* SQLite rows — it has no notion of "job currently in flight that must resume or be marked failed on restart." If export job state (progress, "running" status, which batch it's on) lives only in an in-memory `Map`/registry, a server restart (deploy, crash, OOM from Pitfall 4) loses that registry entirely: the SQLite history row (if one was already written as `"running"`) is now permanently stuck in that state with no process left to finish or fail it, and its partial temp file is now an orphan nothing will ever clean up through the normal "job completed, mark TTL" path.

**Why it happens:**
It's natural to keep the *hot* progress/cancel state (an `AbortController`, a byte-offset counter) in memory for speed/simplicity, since that's how the existing in-browser export's `AbortController` ref works (`exportAbortRef`, `WidgetRenderer.tsx`) — but that pattern was built for a request that dies when the tab closes; a server job must survive the *server* process dying, which the browser-side precedent never had to consider.

**How to avoid:**
- Persist job rows (id, owner, status, started_at, bytes/rows so far, temp file path) to SQLite on every status transition, not just at completion — "running" must be a durable, recoverable state, not inferred from registry presence.
- On boot, before accepting traffic (mirroring the session-store-before-listen ordering already used), sweep any row left in `"running"` from a previous process life and either mark it `"failed"` (simplest, safest given in-flight batch position/paging_table state is NOT recoverable across a process restart) or — if the design supports true resumability — recover from the last durably-recorded offset.
- The cleanup sweeper (Pitfall 9) must additionally cross-reference "running" rows whose process no longer exists (e.g. a `pid`/`instance_id` column, or simply: any row stuck in `"running"` for longer than a generous max-job-duration is treated as orphaned) — otherwise a restart silently produces rows that are *never* GC'd because the sweeper is written to leave "running" jobs alone.

**Warning signs:**
- An export history list shows a row permanently stuck "In progress" after any deploy or server crash.
- Disk usage grows over time from files whose owning history rows show `"running"` forever.

**Phase to address:**
The history/cleanup/TTL phase, but the *durable job-state schema* decision must be made as part of the job-core phase (Pitfall 2/4's phase) since retrofitting durability after building an in-memory-only registry is a rewrite, not a patch.

---

### Pitfall 7: Credentials captured at job start can outlive the user's authorization

**What goes wrong:**
Every Kinetica call in this app is per-request, credential-aware: `buildAuthHeader(req)` reads `req.user!.creds`/`credentialType` fresh off the authenticated request (`kinetica.ts:73-79`). There is no precedent anywhere in the codebase for a Kinetica call that happens **after** the originating HTTP request has already returned a response — which is exactly what a background export job is by definition. The job must capture *something* (a Basic auth pair, or an OIDC bearer token) at the moment the export is kicked off, and then reuse it for every subsequent batch call, potentially minutes later. If the user logs out, their session expires, their OIDC token expires (OIDC access tokens are typically short-lived, e.g. 5–60 minutes), or an admin revokes their Kinetica/app permissions while the job is running, the job may keep using credentials that are no longer valid for that user — either failing confusingly deep into a large export, or (worse, for OIDC) succeeding on a token that should have been rejected, continuing to exfiltrate data on behalf of a user whose access was just pulled.

**Why it happens:**
The entire existing auth model is built around "credentials live on the request, never persisted, never used outside the request's lifetime" (see `kinetica.ts`'s own docstring: "Authorization header from req... never from env vars"). A background job is the first feature that structurally *needs* to break that assumption, and it's easy to solve it the expedient way (stash the Basic/Bearer header string in the in-memory job object) without confronting that this is a materially different trust model from everything else in the app.

**How to avoid:**
- Treat "which credentials does a running job use, and for how long" as an explicit design decision, not an afterthought: options are (a) store only enough to re-derive short-lived credentials (not viable for OIDC bearer tokens without a refresh-token flow this app may not have), (b) accept that OIDC-authenticated exports are bounded by token lifetime and fail gracefully (clear "your session expired mid-export, re-run it" error) rather than silently succeeding or hanging, (c) re-validate the job's owner against current session/permission state at each batch boundary and abort+mark-failed if the user's session is gone or their role no longer has the export permission.
- Never persist raw credentials (password, bearer token) to SQLite in plaintext as part of job-row history — the job's in-memory credential handle should not leak into the durable history row that Pitfall 6 requires (a correctness/durability need) vs. the security need to never persist secrets; resolve by persisting only job *metadata*, keeping the credential handle in memory for the job's lifetime only, and treating "process restarted" (Pitfall 6) as "credential handle is gone too" — which argues for the "mark failed, don't try to resume with stale/absent creds" choice in Pitfall 6.
- RBAC: gate export creation behind an explicit permission (new permission, see Pitfall 8) checked at creation time AND ideally re-checked at completion/download time, not just creation — a role change mid-job should be able to stop a user from retrieving a result their current role wouldn't let them request anymore.

**Warning signs:**
- A long export completes successfully using credentials for a user who logged out or was de-permissioned minutes earlier, with no re-validation anywhere in the code path.
- Any `SELECT`/persisted field that stores a password or bearer token string, anywhere outside the single in-flight request's `req.user`.

**Phase to address:**
Job-core phase for the capture/reuse mechanism design; RBAC/privacy phase for the permission re-check and the "never persist secrets" guard, with an explicit test asserting no credential field appears in the export-history SQLite schema or any serialized job-status JSON.

---

### Pitfall 8: Guessable export ids, path-unsafe filenames, and the RFC 5987 gap — this repo already has the right pattern next door, don't skip it

**What goes wrong:**
Three distinct but related mistakes, all around the new "operator-chosen file name" + "export history, re-downloadable" requirements:
1. **IDOR via sequential/guessable export ids.** If export jobs are identified by an auto-increment SQLite integer exposed in the download URL (`GET /api/exports/:id/download`), any authenticated user can enumerate ids and attempt another user's export. The route MUST check `req.user`'s username against the job row's owner and 403/404 on mismatch — the id itself must never be the only gate, and ideally the id should be a random/opaque token (e.g. `randomUUID()`, already imported in `kinetica.ts`), not a sequential integer, as defense in depth against enumeration even where the owner check is present.
2. **Content-Disposition injection via the operator-chosen filename.** This repo already solved this exact problem once, for dashboard export (`dashboardExport.ts:128-141`): `exportFileName()` is explicit that an **allow-list** slugify (`[^a-z0-9]+ → "-"`) is "what guarantees the returned string can only ever contain `[a-z0-9-.]`... so a dashboard name can never inject a `"`, CR or LF into the `Content-Disposition` header." A naive port of operator-chosen CSV filenames that just does `filename="${userInput}"` without the same allow-list treatment reopens header-injection (a filename like `foo".csv\r\nX-Evil: 1` is attacker-controlled input) that the dashboard-export feature already closed.
3. **The allow-list approach, applied unmodified, mangles exactly the feature this milestone adds.** Unlike `exportFileName()` (which only ever sees dashboard names, an existing, not-user-promised-verbatim string), "an operator-chosen file name" is an explicit new requirement that implies the operator expects to see what they typed — spaces, unicode, mixed case — reflected back, at least in the file as saved by the browser. Slugifying it to `[a-z0-9-]` the same way would technically be safe but would silently violate the feature's own intent. The correct fix is the dual-header pattern: a sanitized ASCII `filename="..."` fallback (safe for old clients) **plus** an RFC 5987 `filename*=UTF-8''<percent-encoded-utf8>` parameter carrying the operator's actual chosen name (browsers that support `filename*` prefer it). Both components still need CR/LF/`"` stripped or percent-encoded out — `filename*`'s percent-encoding naturally neutralizes header injection as long as the encoding step itself isn't skipped for "safe-looking" characters.

**Why it happens:**
The nearest working example in the codebase (`exportFileName`) solves a narrower problem (machine-ish dashboard names, not a user-facing "type whatever filename you want" field) and solves it by refusing to preserve arbitrary input — which is the right call there and the wrong call if copy-pasted verbatim here, because this feature's whole point is preserving the operator's choice.

**How to avoid:**
- Export ids: random/opaque (UUID), not sequential; owner check on every route (download, status, cancel, delete) comparing `req.user.creds.username` to the stored job owner, independent of the id's guessability.
- Filename: strip/reject CR, LF, and `"` outright (never just "allow-list away" the operator's typed name); build both a sanitized-ASCII `filename=` and a correctly percent-encoded `filename*=UTF-8''...` parameter; add a unit test with a filename literally containing `"; evil\r\nX-Injected: 1` and assert the resulting header has no raw CR/LF/quote.
- Keep the underlying **temp file's on-disk name** completely decoupled from the operator's chosen display name — store files by job id (uuid) on disk; the operator's chosen string is purely a `Content-Disposition` display value, never a path component, which also fully closes path traversal (a `../../etc` "filename" never touches the filesystem path at all if the on-disk name is always the job's own uuid).

**Warning signs:**
- Any code path that does `path.join(exportDir, userSuppliedFilename)` instead of `path.join(exportDir, jobId)`.
- A download route that doesn't compare the authenticated user to the job's recorded owner.
- Non-ASCII operator filenames rendering as garbled/stripped names in the browser's save dialog (sign the dual-header pattern was skipped).

**Phase to address:**
Resumable download / history phase — write the owner-check + filename-encoding tests before building the UI around them.

---

### Pitfall 9: Cleanup sweeper races an in-progress or just-starting download (TOCTOU unlink)

**What goes wrong:**
A TTL-based sweeper (required per the milestone) that periodically does "find expired job rows, `fs.unlink` their files, mark row deleted" can race a client that is mid-download (or about to start one, or resuming via Range) of a file whose TTL expires in the same window the sweep runs. Naively, `unlink`-ing a file an open `fs.createReadStream`/response is actively piping from on Linux typically continues to work for *that already-open* file descriptor (POSIX unlink doesn't invalidate open fds) but the file disappears for any *new* request (including a Range-resume) arriving a moment later, producing a confusing "download you just successfully started now 404s on resume" experience, and the DB row may already read "deleted" while bytes are still mid-flight to a client.

**Why it happens:**
TTL sweeps are usually modeled as "is this old enough? delete it" without considering "is anyone using it right now" — there's no existing precedent in this codebase for a resource that is both TTL-cleaned AND actively streamed to a client at the moment of cleanup (the session GC sweep cleans auth rows nobody is mid-request against in the same sense).

**How to avoid:**
- Track an active-download/open-handle count (or last-accessed timestamp) per job row; the sweeper skips/defers any row with a recent access or an open handle, re-checking next sweep cycle rather than hard-deleting on a fixed clock tick regardless of activity.
- Treat TTL as "no longer *offered* for new downloads/resumes past expiry" (route returns 410 Gone for an expired-but-not-yet-physically-swept row) separately from "file physically deleted" (which can lag slightly, gated on no active readers) — these can be the same instant for the common case but must not be conflated in code, or the race window above opens up.
- Extend the expiry of a job row touched by any new resume/download request within a small grace window, rather than deleting strictly on the original creation+TTL clock — consistent with this app's existing sliding-TTL philosophy for materialized views (`DEFAULT_VIEW_TTL_MINUTES`).

**Warning signs:**
- A download or Range-resume intermittently 404s even though the export history list still shows the job.
- Sweeper logs show a delete for a job id concurrently appearing in an active download's access log.

**Phase to address:**
History/TTL-cleanup phase.

---

### Pitfall 10: CSV/formula injection — exporting raw cell values into Excel is an attacker surface, not just an encoding detail

**What goes wrong:**
Any column value beginning with `=`, `+`, `-`, or `@` is interpreted by Excel (and other spreadsheet tools) as the start of a formula when the CSV is opened, not as literal text — `=HYPERLINK(...)`, `=cmd|'/c calc'!A1`-style payloads, or simple chained formulas that exfiltrate other cells, can execute from data a user entered into a Kinetica table (a free-text column, a copy-pasted value, anything upstream of this app's control) the moment someone double-clicks the exported CSV in Excel. This is a well-documented spreadsheet-application pitfall (OWASP calls it "CSV Injection"), not an exotic one, and this app has user-writable/free-text-adjacent surfaces upstream (table data itself is whatever's in Kinetica, entirely outside this app's input validation).

**Why it happens:**
CSV export code typically focuses on *structural* correctness (quoting commas, escaping embedded quotes/newlines) and stops there, because that's what makes the file parse correctly — formula injection is a separate, easy-to-forget concern about what the *spreadsheet application* does with an already-valid CSV cell.

**How to avoid:**
- For any cell value whose first character is `=`, `+`, `-`, `@`, (and `\t`, `\r` as secondary vectors some advisories include), prefix it with a single leading `'` (apostrophe) or a leading space inside the quoted field — the standard mitigation — so spreadsheet apps render it as text, not a formula. Apply this at the same layer that already does CSV quoting/escaping (likely the existing `rowsToCsv`/`csvExport.ts` helper, extended for the new server-side path — check whether the current client-side `rowsToCsv` already does this, since if it doesn't, the *existing* client-side CSV download has the same gap today).
- Apply the mitigation on the server-side export path identically — don't implement CSV serialization twice with the escaping logic only living in one of the two (client download vs. server job).

**Warning signs:**
- A grep of `packages/web/src/lib/csvExport.ts` for any handling of leading `=`/`+`/`-`/`@` characters comes back empty — if so, both the existing feature and the new one inherit the gap.

**Phase to address:**
Whichever phase builds/extends the shared CSV-serialization logic (likely the job-core phase, since it should reuse rather than reimplement the client helper's cell-formatting rules) — verify the *existing* `csvExport.ts` first, since this may be a pre-existing gap the milestone should close regardless of which half of the feature "owns" it.

---

### Pitfall 11: Line chart multi-series — sparse pivots silently read as "flat to zero" instead of "no data for this series here"

**What goes wrong:**
Porting the bar chart's multi-column Group By (`ChartConfigPanel.tsx:824-890`, `groupByColumns`) to the line chart means pivoting rows into one series per distinct group-by value. A records table/time series is very often *sparse* across series — category A has a data point at week 3 but category B doesn't (no rows that week). A bar chart naturally renders "no bar" at that x position for the missing series (visually unambiguous — the bar for B just isn't there, alongside A's bar). A **line** chart connecting points across a sparse x-axis has to make an explicit choice that a bar chart never has to confront: connect A's week-2 point straight to its week-4 point over the missing week 3 (implying "no change happened," which may be false), render a visible gap (break the line), or coerce the missing value to zero (actively misleading if zero is not actually what the missing data means — e.g. a missing day of sales readings is not the same claim as "zero sales that day"). Recharts (already in use per `WidgetRenderer.tsx`'s heatmap/label-interval comments) does not resolve this ambiguity for you — whichever the implementation does by default (likely: Recharts treats a missing data point as `undefined`/`null` in the series array and, depending on `connectNulls`, either breaks or bridges the line) must be a *deliberate* choice, documented, not an accidental default inherited from however the pivot code happens to build each series' array.

**Why it happens:**
The bar-chart-to-line-chart port is naturally framed as "reuse the existing Group By pivot logic," and that pivot logic was written and tested against a chart type where sparseness is visually self-evident — carrying it over unexamined into a chart type where the same sparse pivot produces an ambiguous or actively misleading line is an easy miss, and this is exactly the shape of defect this repo's own CLAUDE.md calls out as its highest-cost known failure mode: visually-wrong rendering that passes `tsc`, `vitest`, and `theme-guard` because none of those gates look at what a chart actually *looks like* (echoing "seven heatmap UI defects pass all gates while rendering visibly broken").

**How to avoid:**
- Decide explicitly (requirements/design time, not implementation time) whether missing series/x-category combinations render as a gap (Recharts `connectNulls={false}`, the default-safer choice for most BI contexts) or are explicitly coerced to zero — and make that a visible, named config choice if both are legitimate for different metrics, not a silent default.
- Treat the resulting chart's correctness as a `checkpoint:human-verify` item per this repo's own written convention for unprovable-by-grep requirements ("the readout is legible," "colours read correctly" are the house examples) — a line chart "looks right" with sparse/missing data is exactly this category: expressible as a structural precondition (e.g. "`connectNulls` is explicitly set, not left at the Recharts default" is grep-able) but the actual visual correctness needs an operator's eyes on a real sparse dataset.

**Warning signs:**
- No test or config exercises a group-by column with uneven x-coverage across its distinct values before shipping.
- `connectNulls` (or equivalent) is absent from the line-series Recharts props entirely — meaning whatever Recharts' internal default is, is shipping unexamined.

**Phase to address:**
Line-chart multi-series phase. Pair the structural/grep-able precondition with an explicit human-verify checkpoint against a deliberately sparse dataset — do not let this phase's acceptance criteria be satisfied by a dense, evenly-spaced synthetic fixture that can never surface the gap-vs-zero question.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|-----------------|------------------|
| Keep export job progress/cancel state in-memory only (`Map`/`AbortController`), skip SQLite persistence of in-flight state | Faster to build, mirrors the existing browser-side `exportAbortRef` pattern | Server restart loses all in-flight jobs with no recovery path (Pitfall 6); stuck "running" rows forever | Never for a feature explicitly scoped around "large, long-running" exports — acceptable only for a deliberately-scoped v0 that's documented as "jobs do not survive a restart" with the sweeper explicitly handling that case, not silently |
| Reuse `exportFileName()`'s allow-list slugify verbatim for operator-chosen CSV filenames | Zero new code, provably safe against header injection (already proven safe for dashboard export) | Silently strips the operator's actual chosen filename content (unicode, spaces, case) — defeats the feature's stated purpose | Never — the feature explicitly promises an operator-chosen name; use the dual filename/filename* pattern instead (Pitfall 8) |
| Raw OFFSET/LIMIT re-querying per batch instead of `paging_table` | No new Kinetica API surface to learn/verify; looks like the client CSV loop already does this | Re-executes the query every batch (more load, more chance of view-expiry mid-export), non-deterministic without an explicit unique sort key (Pitfall 2) | Acceptable only as a documented interim/fallback if `paging_table` is spiked and found unworkable against the real instance — not as the default, unverified choice |
| Gzip on-the-fly per download request rather than once, at job-finalize time | Saves disk space until first download | Makes Range-resume impossible/incorrect (Pitfall 5); redoes CPU work on every re-download from history | Never if resumable Range download of the gzip variant is required (it is, per the milestone) |
| Skip CSV formula-injection escaping on the "obviously internal/analytics" theory that users trust their own data | Less code | A table column populated from any upstream free-text/user-entered source becomes an Excel RCE/exfil vector the moment the CSV is opened | Never |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|-----------------|-------------------|
| Kinetica `/execute/sql` envelope `limit` vs the SQL statement's own `LIMIT` clause | Treating them as one concept; raising one assuming it governs the other | They're independent: the envelope `limit`/`offset` is an executor-level result cap, documented default `-9999` (server max, bounded by `max_get_records_size`); the SQL `LIMIT` is evaluated by the query planner. A batch call needs both to agree on batch size (e.g. SQL `LIMIT 20000` with `extra.limit` also at least 20000, not left at the old default 1000) |
| Kinetica pagination for a single large result set | Re-issuing the full query with a bumped `OFFSET` each time | Use `options.paging_table` (+ `paging_table_ttl`) on the first call; reuse the same name on later calls; stop on `has_more_records === false`, cross-check against `total_number_of_records` (verify live before relying on it structurally — see Pitfall 2) |
| `kineticaSql`'s `extra` passthrough (`kinetica.ts`) | Assuming `extra` only reaches top-level request fields | `extra` is spread at the same level as the default `options: {}` key, so `extra: { options: {...} }` fully replaces the nested options map (shallow spread, not deep merge) — this is how `paging_table`/`paging_table_ttl` must be threaded through the existing helper without modifying its signature |
| Session/credential model (`AuthedRequest`, per-request `req.user.creds`) | Assuming it extends naturally to a job that outlives the request | It doesn't — this is the first feature in the codebase where Kinetica calls happen after the originating request returned; design the capture/expiry/revocation story explicitly (Pitfall 7) |
| The filter-view TTL/keepalive system (`DEFAULT_VIEW_TTL_MINUTES`, `useViewKeepAlive.ts`) | Assuming "keepalive" is already solved because the feature name exists in the codebase | It's frontend-only, tied to a mounted dashboard; a server job needs its own mechanism or must avoid depending on the live view past the first read (Pitfall 3) |
| RBAC permission catalog (`packages/server/src/lib/permissions.ts`) | Adding an export-related capability as a side effect of an existing permission (e.g. piggybacking on `DATASETS_MANAGE` or `DASHBOARDS_VIEW`) to avoid the ripple | A new `PERMISSIONS` entry (e.g. `EXPORTS_CREATE`/`EXPORTS_MANAGE`) is a release-gated, code-defined catalog change per the file's own docstring ("adding a permission requires a release") — budget for the full ripple this repo's memory notes already document: rbacDb/rbacMigration specs, web `permissions` mirror, `RolesPage` spec counts, `permissionGroups` wiring |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|-----------------|
| Deep OFFSET re-querying on a large table | Later batches (high offset) measurably slower than early ones; export throughput degrades over its own lifetime | Use `paging_table` (pays the query cost once) or, if OFFSET must be used, an indexed keyset/seek (`WHERE (sort_col, pk) > (last_sort_val, last_pk)`) instead of `OFFSET N` | Noticeable past tens of thousands of rows into a single export; severe past hundreds of thousands, depending on Kinetica's plan for the underlying view |
| Building the whole CSV string (or whole row array) in memory before writing | Works in dev/small exports; memory climbs linearly with row count in production | Stream batch-by-batch straight to the write stream; respect backpressure (Pitfall 4) | Breaks at whatever row count makes the in-memory string/array approach the available container memory — likely well under the "million rows" target this milestone names |
| Unbounded concurrent export jobs per user or server-wide | Disk fills, Kinetica connection/credential load spikes, multiple large jobs starving each other's I/O | A per-user concurrent-job cap (the milestone already calls this out as "required, not optional") plus a server-wide cap independent of per-user limits (N users each at their individual cap can still exhaust shared disk) | As soon as more than a handful of large jobs run concurrently on modest deploy hardware |
| Excel-unfriendly very wide exports (many columns × many rows) | Export "succeeds" but Excel struggles/truncates on open (Excel has its own row/column/cell-content limits, independent of this app's cap) | Document Excel's own limits (1,048,576 rows, 16,384 columns) relative to the configurable row/size cap so operators aren't surprised the app's cap and Excel's cap are different numbers | Whenever the admin-configured cap is set higher than what the target spreadsheet tool can actually open |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Sequential/integer export ids in the download URL | Any authenticated user enumerates and downloads another user's export (IDOR) | Opaque id (`randomUUID()`) + mandatory owner check on every route touching a job, independent of id guessability |
| Using the operator-supplied filename as (or to build) the on-disk temp file path | Path traversal (`../../`), filesystem corruption/overwrite | On-disk filename is always the job's own internal id; the operator's string is a `Content-Disposition` display value only, never a path component |
| Raw interpolation of the operator filename into the `Content-Disposition` header | Header injection (CRLF/quote), malformed/attacker-influenced response headers | Reuse this repo's own proven allow-list-for-safety pattern (`dashboardExport.ts`) for the ASCII `filename=` fallback, add RFC 5987 `filename*=UTF-8''...` for the real name, strip/encode CR/LF/quote in both |
| No formula-injection escaping on exported cell values | Excel/spreadsheet RCE or data-exfil formulas execute on open | Prefix cells starting with `=`,`+`,`-`,`@` with a neutralizing character at the CSV-serialization layer (apply to both the existing client export and the new server path) |
| Persisting a job's captured Kinetica credentials (password/bearer token) into the durable job-history row | Credential leakage via DB access/backup/logs; the exact kind of secret this app otherwise never persists | Keep credentials in memory only, scoped to the job's process lifetime; persist job *metadata* only; treat process restart as "credentials gone, job must fail/restart," not "recover and keep using stale creds" |
| No RBAC gate (or gating on the wrong/reused permission) on export creation and download | Users without data-export authorization can originate or retrieve bulk data dumps | New, explicit `EXPORTS_*` permission(s) in the code-defined catalog, checked on create AND on download/re-download (not just once at creation) |
| Serving a Range/resume read against a file still being written, or already deleted by the TTL sweeper | Corrupted partial-looking-complete downloads; confusing 404s on legitimate resumes | Gate all serving on job status == complete + file closed; make the sweeper race-aware (Pitfall 9) |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-------------------|
| Export "completes" silently truncated at an undocumented Kinetica `max_get_records_size` ceiling, same shape as today's 1000-row bug one layer up | User believes they have the full dataset; silent data loss, possibly discovered much later (echoes this exact milestone's own origin story) | Compare final row count against a `COUNT(*)` captured at job start; surface a clear warning/error (not a silent success) if they don't match |
| Progress bar shows no useful signal during the (potentially long) first-batch call if using `paging_table` (which pays the full query cost up front) | User thinks the job is "stuck at 0%" when the query is actually still executing against Kinetica | An explicit "preparing/querying" phase distinct from "writing rows," so 0% progress for a while is explained, not alarming |
| Cancel button deletes the partial file but the UI doesn't clearly confirm the credentials/job are fully torn down | User unsure whether cancelling actually stopped server-side work (and spend) | Cancel should be synchronous-feeling: job row transitions to `"cancelled"` and partial file is removed before the cancel request's own response returns, or progress UI clearly shows a brief "cancelling..." transitional state |
| Re-download from history silently 404s once TTL has passed, with no prior warning | User returns to re-grab an export they assumed was still there | Show expiry countdown/date in the history list; a 410-style "this export has expired" message rather than a bare 404 |
| Line chart defaults to connecting across sparse data as if it were continuous | Misreads a gap in the data as "values held steady," a genuinely misleading chart | Default to `connectNulls={false}` (visible gap) unless a metric is explicitly known to be cumulative/fill-forward appropriate |

## "Looks Done But Isn't" Checklist

- [ ] **1,000-row limit fix:** Often missing the caller audit — verify every `runSql`/`kineticaSqlHelper` call site without its own SQL `LIMIT` or `extra.limit` has been explicitly classified, not just the `kinetica.ts` default bumped.
- [ ] **Streaming export:** Often missing actual backpressure handling — verify with a memory-bounded test at a large synthetic row count, not just a "small export succeeds" test.
- [ ] **Resumable download:** Often missing the "only serve Range reads on a finalized file" gate — verify a Range request against a `"running"` job returns 409/404, not a partial stream of a growing file.
- [ ] **Gzip export:** Often missing the "gzip once, at finalize, not per-download" design — verify the `.gz` file byte-identical across repeated downloads/resumes of the same job.
- [ ] **Operator-chosen filename:** Often missing RFC 5987 `filename*=` — verify a unicode/space-containing chosen filename round-trips correctly in a real browser save dialog, not just the ASCII fallback.
- [ ] **Export history:** Often missing the owner check on every route (not just download) — verify status/cancel/delete routes 403/404 for a non-owner, not just the download route.
- [ ] **TTL cleanup:** Often missing the "don't delete what's actively being read" guard — verify a sweep cycle running concurrently with an open download doesn't 404 that same download mid-stream.
- [ ] **Server restart resilience:** Often missing entirely (no prior precedent in this codebase) — verify a `"running"` row surviving a server restart is swept to a terminal state on next boot, not left stuck forever.
- [ ] **Credentials:** Often missing an explicit "what happens on logout/token-expiry mid-job" answer — verify this is a deliberate, tested behavior, not an accidental side effect of however the credential handle happens to be captured.
- [ ] **CSV formula injection:** Often missing on both the existing client export AND the new server path — verify a cell value of `=1+1` or `=HYPERLINK(...)` round-trips as literal text in Excel, on both code paths.
- [ ] **Line chart multi-series:** Often missing an explicit gap-vs-zero decision for sparse series — verify with a deliberately uneven (not perfectly dense) synthetic dataset, and route the visual judgment itself to `checkpoint:human-verify` rather than a grep that can't discriminate.
- [ ] **New RBAC permission:** Often missing the full ripple — verify `rbacDb`/`rbacMigration` specs, the web permissions mirror, `RolesPage` spec counts, and `permissionGroups` wiring are all updated, not just the server-side `requirePermission` call site.
- [ ] **New UI (progress bar, history list, cancel/download buttons):** Often missing real CSS — verify against `global.css`'s existing classes (`btn-primary btn-sm`, `ghost-sm`, `ds-actions`, `ds-field`, `config-group`) rather than inventing new class names, and verify visually (not just `tsc`/`vitest`/theme-guard green) since undefined classes and `rgba()`/wrong-token light-mode bugs pass every automated gate in this codebase.

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|----------------|------------------|
| Default limit raised without full caller audit, a records table/popup now over-fetches | LOW–MEDIUM | Revert the shared default; apply the higher limit only via `extra.limit` scoped to the new export job's own calls; re-run the caller audit before trying again |
| OFFSET-based export produces duplicate/missing rows discovered post-ship | MEDIUM | Re-point the batch loop at `paging_table` (or add an explicit unique sort key + keyset pagination); existing completed exports can't be retroactively fixed — flag affected history rows or force re-export |
| In-memory-only job registry ships, a restart strands "running" rows | LOW | Add the boot-time sweep for stale "running" rows to a terminal state; this is additive and doesn't require touching the job-core logic, but does NOT recover the lost in-flight progress itself |
| Content-Disposition built without RFC 5987 ships, unicode filenames mangle | LOW | Add the `filename*=` parameter alongside the existing `filename=`; no data-model change, pure response-header fix |
| CSV formula-injection escaping missing, discovered after real exports have gone out | MEDIUM–HIGH (depends on whether any exported file was ever opened against untrusted data) | Add the escaping at the shared CSV-serialization layer going forward; cannot retroactively fix already-downloaded files — treat as a forward-fix plus an advisory note if genuinely sensitive data was involved |
| Sweeper deletes a file mid-download | LOW | Add the active-reader/recent-access guard to the sweeper; affected single download simply fails and the user re-triggers from history (if not yet expired) or re-exports |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|-------------------|----------------|
| 1,000-row limit blast radius | "Fix the hardcoded limit" phase | A written, checked-off classification of every `runSql`/`kineticaSqlHelper` call site (safe / needs-explicit-limit) exists before the default changes |
| OFFSET non-determinism / silent server-side truncation one layer up | Server-side export job core phase | A spike confirming `paging_table`/`has_more_records` behavior against the real Kinetica instance; export row count cross-checked against a job-start `COUNT(*)` |
| Frontend-only view keepalive has no server analog | Server-side export job core phase (same decision as above) | Export correctly completes against a filter-combination view whose TTL would otherwise have expired mid-job, verified live |
| Unbounded buffering during streaming | Server-side export job core phase | A memory-bounded test/benchmark at a large synthetic row count, not just a small functional test |
| Gzip + Range incompatibility, partial-file-as-complete | Resumable download / Range / gzip phase | Test asserting Range requests against a `"running"` job are rejected; gzip file is written once at finalize, byte-identical across repeated downloads |
| In-memory job registry lost on restart | Job-core phase for durable schema; history/cleanup phase for the boot-time sweep | A restart mid-job leaves the row in a terminal (not stuck-"running") state after the next boot |
| Credentials outliving session/logout/permission revocation | Job-core phase (capture/reuse design); RBAC/privacy phase (permission re-check, no persisted secrets) | No credential field in the export-history schema or any serialized job status; a logout/permission-revocation mid-job test produces a defined, non-silent outcome |
| Guessable ids / path traversal / Content-Disposition injection | Resumable download / history phase | Opaque ids + owner-check tests on every job route; a header-injection-attempt filename test asserts no raw CR/LF/quote in the response header |
| Cleanup sweeper races an active download | History/TTL-cleanup phase | A concurrent sweep-during-download test doesn't 404/corrupt an in-flight download |
| CSV/formula injection | Shared CSV-serialization work (job-core phase, or a dedicated fix if `csvExport.ts` already lacks it) | A cell value of `=1+1` round-trips as literal text, on both the client and server export paths |
| Line chart sparse-pivot gap vs. zero ambiguity | Line-chart multi-series phase | `connectNulls` (or equivalent) explicitly set and tested against a deliberately sparse synthetic dataset, PLUS a `checkpoint:human-verify` for actual visual correctness |
| New RBAC permission ripple | RBAC/privacy phase | `rbacDb`/`rbacMigration` specs, web permissions mirror, `RolesPage` spec counts, and `permissionGroups` wiring all updated together, not just the server route gate |
| New UI components using invented/wrong CSS classes | Whichever phase ships progress bar / history list / cancel-download UI | Visual check against `global.css`'s existing canonical classes, not just green `tsc`/`vitest`/theme-guard |

## Sources

- `/Users/rydelpereira/Documents/projects/kinetica_bi/packages/server/src/kinetica.ts` (read directly — hardcoded `limit: 1000`, `extra` spread mechanics, per-request credential model, typed error classification)
- `/Users/rydelpereira/Documents/projects/kinetica_bi/packages/server/src/index.ts` (read/grepped — `/api/sql` proxy passthrough, `/api/info/query`'s `extra: { limit: 50 }`, `DEFAULT_VIEW_TTL_MINUTES`, session GC sweep ordering, error middleware, multer memoryStorage precedent, PERMISSIONS usage)
- `/Users/rydelpereira/Documents/projects/kinetica_bi/packages/web/src/components/charts/WidgetRenderer.tsx` (read directly — existing client-side CSV export loop, its missing default `ORDER BY`, `csvDownloadRowCap`, `AbortController` pattern)
- `/Users/rydelpereira/Documents/projects/kinetica_bi/packages/web/src/hooks/useViewKeepAlive.ts` (read directly — confirmed frontend-only, dashboard-mount-scoped keepalive)
- `/Users/rydelpereira/Documents/projects/kinetica_bi/packages/server/src/lib/dashboardExport.ts` (read directly — `exportFileName()`'s allow-list Content-Disposition-injection defense, the existing pattern to build on, not copy verbatim)
- `/Users/rydelpereira/Documents/projects/kinetica_bi/packages/server/src/lib/permissions.ts` (read directly — code-defined permission catalog, "adding a permission requires a release")
- `/Users/rydelpereira/Documents/projects/kinetica_bi/.planning/PROJECT.md` (v1.26 milestone section — goal, target features, known hazards as stated by the team)
- `/Users/rydelpereira/Documents/projects/kinetica_bi/CLAUDE.md` (UI conventions, test-gate conventions, verifiable-acceptance-criteria discipline)
- Repo auto-memory notes (CSS bugs evade tests + theme-guard; theme-guard misses rgba + wrong tokens; adding a permission ripples across specs; GSD subagent tracking gotchas) — used to ground the repo-specific checklist items
- Kinetica official docs, fetched 2026-10-01: [`/execute/sql` REST reference](https://docs.kinetica.com/7.1/api/rest/execute_sql_rest/) — `limit` default `-9999`/`END_OF_SET`, `max_get_records_size` server ceiling, `options.paging_table`/`paging_table_ttl` pagination mechanism, `has_more_records`/`total_number_of_records` response fields (HIGH confidence, official source, not independently live-verified against this deployment's actual Kinetica instance — flagged as a spike item in Pitfall 2)
- General web-platform/security knowledge (not Kinetica- or repo-specific, standard and well-established): HTTP Range/gzip semantics, RFC 5987 `filename*=` encoding, OWASP CSV/formula-injection mitigation, Node stream backpressure/`drain` semantics — MEDIUM-HIGH confidence as general engineering fact, not independently re-verified via a fresh source this session beyond training knowledge

---
*Pitfalls research for: Kinetica BI v1.26 — Large Exports & Fixes*
*Researched: 2026-10-01*
