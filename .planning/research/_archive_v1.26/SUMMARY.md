# Project Research Summary

**Project:** Kinetica BI
**Domain:** BI dashboard large-data export (server-side background export jobs, streamed/resumable/gzip) over a GPU-database REST API, plus a Recharts multi-series line-chart fix
**Milestone:** v1.26 Large Exports & Fixes
**Researched:** 2026-10-01
**Confidence:** MEDIUM-HIGH overall — all codebase/file:line claims are HIGH (read directly from `feat/schema-sync`); Kinetica server-side semantics are mixed HIGH (doc-verified) and MEDIUM/unverified (flagged explicitly below, with researcher disagreement that is **not** resolved here)

> **Correction to STACK.md:** the Kinetica client file researchers cite as `packages/server/src/lib/kinetica.ts` is actually **`packages/server/src/kinetica.ts`** (no `lib/` segment). The hardcoded `limit: 1000` is at line ~186-187. All four research files and this summary should be read with that correction in mind; ARCHITECTURE.md already uses the correct path.

## Executive Summary

This milestone fixes a real, confirmed data-loss bug (CSV export silently stops at 1,000 rows because `kineticaSql`'s request envelope hardcodes `limit: 1000` independent of any SQL `LIMIT`) and builds the first background job subsystem this codebase has ever had, so a user can export up to a million rows without the browser holding them in memory, losing them to a dropped connection, or being silently truncated. All four researchers agree the right shape: no new npm dependencies (Node streams, Express's existing `res.download`/`res.sendFile` Range support, and the repo's own `escapeCsvField`/`rowsToCsv` cover everything needed); an in-process async job tracked by a new SQLite `export_jobs` table (mirroring the existing `table_sync_history` precedent) with an `AbortController` map for cancel, not a job-queue library; and a job-private materialized-view snapshot (or equivalent stable-pagination mechanism) so OFFSET paging can't repeat/skip rows under concurrent writes. A second, independent piece of work ports the bar chart's existing multi-column Group By builder to the line chart and fixes two small, well-understood Recharts defaults (`interval={0}` on the x-axis, a `name` prop on each series) — low-risk, well-precedented work that collides with the export job only at the file level (`WidgetRenderer.tsx`), not logically.

The recommended approach is deliberately conservative about the one new piece of infrastructure this app has never had (a server-outliving-the-request job): credentials are re-derived per-batch from the session store rather than cached, job state is durable in SQLite with boot-time reconciliation of stale "running" rows (mirroring `wipeSessionsOnModeChange`), and the row-limit fix is scoped as an audited, caller-by-caller change rather than a single global default bump — because the 1,000-row cap is currently acting as an *accidental* query governor for callers nobody wrote with it in mind, and lifting it carelessly risks reproducing the same silent-truncation bug one layer up (which ARCHITECTURE.md's research independently found has *already happened* once, in the heatmap renderer — see below).

The main risks are: (1) Kinetica's own pagination/snapshot mechanics are not verified against the live deployed instance in this research (two researchers propose genuinely different mechanisms — see Open Decisions) and need a pre-build spike; (2) this is the first long-running, credential-holding, crash-recoverable background job in the codebase, so every durability/security property (stale-row reconciliation, no-persisted-secrets, owner-checked routes, race-safe TTL cleanup) has to be designed from scratch rather than copied; (3) a pre-existing, previously-unknown silent-truncation bug in the heatmap renderer and a pre-existing CSV-formula-injection gap in the client-side export were both surfaced by this research and should be folded into this milestone's scope, not treated as separate future tickets.

## Key Findings

### Recommended Stack

Zero new dependencies. The entire capability set — batched Kinetica reads, streaming CSV assembly, optional gzip, resumable Range downloads, an in-process cancellable job, and Recharts multi-series lines — is reachable with Node builtins and packages already installed.

**Core technologies:**
- `node:stream/promises` `pipeline()` (Node builtin) — composes the Kinetica-page source → CSV-transform → optional gzip → file-write chain with automatic backpressure and single-point cancel/error propagation. DOC-VERIFIED against Node's own streams docs.
- `node:zlib` `createGzip()` (Node builtin) — optional `.csv.gz` output, inserted into the same `pipeline()`.
- Express `res.download()` / `res.sendFile()` (already 4.19.2) — serves the finished file with native `Range`/`Accept-Ranges`/`206 Partial Content` support and `Content-Disposition` auto-set from the filename argument; no manual Range parsing needed. Stable since Express 4.14.0 (2016).
- `kineticaSql()` (`packages/server/src/kinetica.ts`) — reused, not replaced. Its `options.extra` passthrough already overrides the hardcoded envelope `limit`/`offset` today (three existing call sites prove this), so the export job's batched reads need no change to the function's shape, only explicit `extra: { limit: 20000 }` per call.
- Port (not reimplement) `packages/web/src/lib/csvExport.ts`'s `escapeCsvField`/`rowsToCsv` into a new `packages/server/src/lib/csvExport.ts` — avoids a second, potentially drifting CSV-escaping implementation.

**Explicitly rejected additions:** `csv-stringify`/`fast-csv`/`papaparse` (solve problems — nested objects, alternate dialects — this flat-scalar export doesn't have); any job-queue library (BullMQ/Bull/Agenda) or `worker_threads`/`child_process` (no existing precedent, and persisting a user's live Kinetica credential into a detached worker is a privilege-lifetime risk the current per-request-credential architecture deliberately avoids); Kinetica's own `EXPORT TABLE ... INTO FILE` + KiFS path (admin-provisioned directory ACLs, no HTTP streaming/Range on retrieval — `/download/files` returns bytes JSON-wrapped, not streamed — no native per-user-private/TTL semantics).

### Expected Features

Cross-referenced against Tableau, Power BI, Looker, Metabase, Superset, and Grafana (WebSearch-synthesized, MEDIUM confidence, 2+ sources per claim).

**Must have (table stakes) — all already scoped in PROJECT.md:**
- Export reproduces exactly what the widget shows (same filters/dynamic view/`customWhere`/column order/sort)
- Background job once data exceeds a small in-browser threshold (every surveyed tool draws this line)
- Progress indicator while the job runs
- Cancel, which deletes the partial file
- A cap (row/size), enforced **and communicated** — silent truncation is the one universally condemned pattern (and is exactly today's bug)
- A durable way to retrieve the file once the job finishes while the user is elsewhere (export history list) — not optional once the job is async
- Sensible, collision-resistant, operator-overridable default filename

**Should have (differentiators) — none of the 6 surveyed tools document these for ad-hoc exports:**
- Resumable HTTP Range download — a genuine differentiator; no surveyed consumer BI tool exposes this
- Percent-complete progress with ETA, backed by an upfront `COUNT(*)` — degrade to "N rows written" if `COUNT(*)` proves expensive
- Persistent, user-scoped export history list with re-download until expiry
- Optional gzip (not zip — see Anti-Features)

**Defer (v2+):**
- Raw-vs-formatted export value toggle (ship raw-only first; see Open Decisions)
- Top-N + "Other" collapsing for high-cardinality line-chart series
- Export-progress push channel (SSE/WebSocket) instead of polling
- Scheduled/recurring exports; cross-format exports (XLSX/JSON); full-dashboard export

**Anti-features to actively avoid:** zip-as-container (harder to make Range-resumable than flat gzip, no surveyed tool uses it for single-table export); defaulting to formatted/display values in the raw export (corrupts downstream re-import — numbers become non-numeric strings); an uncapped default (every enterprise tool gates "unlimited" behind an explicit admin grant); re-querying live filters mid-export (must snapshot at trigger time, never re-consult live UI state).

### Architecture Approach

The 1,000-row ceiling's fix is a one-line change with a wide, already-partially-mapped blast radius: `kineticaSql`'s `options.extra` override mechanism is already proven in production (three existing call sites), so most callers are already safe or trivially made safe; the new export job should never rely on the shared default anyway, always passing its own explicit `extra.limit`. The export job itself is new infrastructure end to end: a `export_jobs` SQLite table (mirroring `table_sync_history`), an in-memory `Map<jobId, AbortController>` for the live/cancel-only state (not persisted, reconciled from durable "running" rows on boot), credentials re-derived per-batch from `sessionStore.getSession(sid)` rather than cached (so the job fails closed if the session has expired/been revoked), and a job-private materialized-view snapshot (reusing `createOrReplaceMaterialized`) rather than depending on the browser-only `useViewKeepAlive` mechanism, which cannot run once the triggering tab is gone. The server should rebuild the SQL to export from the widget's own persisted `config` (customWhere, columns, sort — already in SQLite) plus a client-supplied `combinationKey`/filter state, rather than trusting client-sent raw SQL — reusing the existing dynamic-view-preview precedent (`SELECT 1 FROM <view> LIMIT 0` probe + fallback), not the looser `POST /api/sql` passthrough trust model.

**Major components:**
1. **`lib/exportSql.ts`** (new, pure) — ports `IDENT_RE`, `whereCustomWhere`, and the column-major row decode server-side; independently unit-testable, no Kinetica/Express dependency.
2. **`export_jobs` SQLite table + CRUD** (new, in `db.ts`) — durable job registry: id, username, widget/dashboard id, status (CHECK-constrained), filename, gzip flag, rows_written, total_rows (nullable), file_path, file_size_bytes, timestamps, expires_at, error_message.
3. **Job-private snapshot + batch-loop runner** (new, `lib/exportRunner.ts` or similar) — materializes a job-scoped view at trigger time (TTL sized to expected job duration, not the dashboard default), pages it with an explicit `extra.limit` batch size and a deterministic composite `ORDER BY`, streams CSV rows through `pipeline()` (+ optional gzip) to a temp file, updates SQLite progress per batch, respects write-stream backpressure.
4. **Routes** (trigger / history-list / status-poll / Range-aware download via `res.sendFile` / cancel) — thin wiring over the runner, each gated by an owner (`WHERE username = ?`) check, opaque (UUID) job ids, and the existing RFC-5987-aware Content-Disposition pattern.
5. **TTL sweep + boot-time reconciliation** — mirrors `sessionStore.ts`'s `.unref()`'d sweep interval and `wipeSessionsOnModeChange`'s before-`app.listen()` pattern; sweep must not delete a file an active download holds open (race-safety).
6. **Line chart multi-series** (independent subsystem, same `WidgetRenderer.tsx`/`ChartConfigPanel.tsx` files) — adds `isLine` to the existing `usesMultiColumnGroupBy` gate, reuses `toBarPivotInput`/`selectTopSeries`/`pivotSeriesRows` (already chart-type-agnostic), ports the `BarRenderer`'s per-series-dataKey render loop and truncation banner, adds `interval={0}` to both line/area `XAxis`, and wires `resolveMetricLabel`/`isCustomSelection` into the `name` prop (today's legend-name bug).

### Critical Pitfalls

1. **"Raise the limit" is a blast-radius change, not a one-line fix** — the 1,000-row cap is an *accidental* query governor for callers that never added their own SQL `LIMIT`. Audit every `runSql`/`kineticaSqlHelper` call site (classify: has own SQL LIMIT / already pins `extra.limit` / neither-needs-fixing) *before* touching the shared default; prefer giving only the new export job its own explicit `extra.limit` over bumping the global default at all.
2. **Reinventing OFFSET pagination when it's unverified against a live Kinetica instance** — PITFALLS.md recommends Kinetica's `options.paging_table`/`paging_table_ttl` mechanism (query once, cache server-side, `has_more_records` as the authoritative exhaustion signal) instead of raw re-queried OFFSET/LIMIT, which can repeat/skip rows under concurrent writes and re-executes the query every batch. **This conflicts with ARCHITECTURE.md's recommendation** (job-private snapshot view + OFFSET) — see Open Decisions; both researchers agree a spike against the real instance is required before committing either way.
3. **The frontend-only view-keepalive has no server analog** — `useViewKeepAlive.ts` is explicitly scoped to a mounted dashboard tab; a server job that outlives the request needs either a `paging_table`-style one-time read or its own job-private snapshot — it cannot assume the live view stays warm.
4. **Unbounded buffering defeats "never held whole in memory"** — easy to satisfy on paper while still accumulating a batch (or the whole export) into one in-memory string/array before writing; must respect `writeStream.write()`'s boolean return and await `'drain'`, and must be verified with a large-synthetic-row memory-bounded test, not just a small functional test (this codebase has zero prior streaming-to-disk precedent to copy from).
5. **gzip + HTTP Range is only valid on a complete, closed file** — never serve Range (or any) reads against a file the job hasn't finished and closed; gzip once at finalize, never per-download.
6. **No existing job-registry precedent — in-memory-only state is lost on crash/restart** — durable SQLite status transitions + boot-time sweep of stale "running" rows to a terminal state are required, not optional.
7. **Credentials captured at job start can outlive the user's authorization** — re-derive `{credentialType, creds}` fresh per batch via `sessionStore.getSession(sid)`, never cache/persist raw credentials; fail closed on expired/revoked sessions.
8. **Guessable export ids / Content-Disposition injection / path traversal** — opaque (UUID) job ids, owner check on every route, on-disk filename always the job's own id (never the operator's chosen display name), dual `filename=`/`filename*=UTF-8''...` headers (the repo's existing `exportFileName()` allow-list slugify is the *wrong* pattern to copy here — it would silently mangle the operator's chosen name, defeating the feature).
9. **Cleanup sweeper races an in-progress download (TOCTOU unlink)** — track active-reader/last-accessed state per job row; don't hard-delete on a fixed clock tick regardless of activity.
10. **CSV/formula injection** — `=`/`+`/`-`/`@`-prefixed cell values execute as formulas in Excel on open. **Confirmed as a pre-existing gap**: `packages/web/src/lib/csvExport.ts`'s `escapeCsvField` only quotes on `"`/`,`/CR/LF — it has no formula-injection guard today, in the existing client-side download, independent of this milestone's new server path. Both paths need the fix at the same shared serialization layer.
11. **Line chart sparse-pivot gap-vs-zero ambiguity** — a sparse multi-series pivot (missing x/series combinations) must make an explicit `connectNulls` choice (gap vs. bridge vs. zero-coerce), not inherit whatever Recharts' internal default does; this is a `checkpoint:human-verify` item against a deliberately uneven dataset, not a grep-provable requirement.

## Implications for Roadmap

Based on combined research, suggested phase structure:

### Phase 1: Fix the row-limit ceiling + caller audit
**Rationale:** Nothing downstream (export job correctness, heatmap bug fix) can be tested without this landing first, and it's the lowest-risk, most self-contained change — but ONLY if the audit is a first-class deliverable, not an afterthought (Pitfall 1).
**Delivers:** A written classification of every `runSql`/`kineticaSqlHelper`/`kineticaSql` call site (safe / needs-explicit-limit), a raised default informed by that audit (candidate: 5,000-10,000, covering the heatmap's existing `HEATMAP_CELL_LIMIT=5000` ask), and the newly-discovered heatmap truncation-detection bug fixed as part of the same change (`HeatmapRenderer.tsx`'s `truncated` check compares against the *requested* limit, not the real server cap — currently suppresses the truncation banner silently for Result Limit choices of 1000/2500/5000).
**Addresses:** PROJECT.md's explicit "blast radius must be audited, not assumed" hazard; FEATURES.md's "silent truncation is the one universally condemned pattern."
**Avoids:** Pitfall 1 (blast-radius change masquerading as a one-liner).

### Phase 2: Export-job foundation (pure/offline-testable pieces)
**Rationale:** The riskiest, most novel subsystem in this milestone — no prior precedent in this codebase for streaming-to-disk, long-running credential use, or a durable job registry. Build and test the pure pieces (SQL-fragment port, SQLite schema, snapshot/ORDER BY helpers) before the actual batch-loop runner, per ARCHITECTURE.md's suggested build order.
**Delivers:** `lib/exportSql.ts` (ported `IDENT_RE`/`whereCustomWhere`/column-major decode), `export_jobs` SQLite table + CRUD, job-private snapshot materialize/drop helper, deterministic composite `ORDER BY` builder — all independently unit-testable, no Kinetica/Express dependency yet.
**Uses:** `kineticaSql`'s existing `extra` override mechanism; `materializedView.ts`'s `createOrReplaceMaterialized`; `db.ts`'s `table_sync_history`/`ensureDir` patterns.
**Implements:** Architecture components 1 and 2 above.

### Phase 3: Batch-loop runner + credential/session design (spike-gated)
**Rationale:** This is the one open architectural decision research could not resolve live (OFFSET+snapshot vs. `paging_table`) — treat it as a spike-first phase, in this repo's own established style (precedent: `122-SPIKE-NOTES.md`), before committing to either loop shape.
**Delivers:** A verified (against the real Kinetica instance) pagination/snapshot mechanism, the actual batch-fetch → CSV-transform → gzip → write-stream `pipeline()`, backpressure-respecting writes, per-batch credential re-derivation via `sessionStore.getSession(sid)` (never cached), a memory-bounded test at a large synthetic row count, and explicit, non-silent failure handling for mid-job session/token expiry.
**Addresses:** PROJECT.md's "export reads from transient filter views" and "must not outlive or escape that user's authorization" hazards.
**Avoids:** Pitfalls 2, 3, 4, 7.

### Phase 4: Routes, history list, Range-resumable download, cancel
**Rationale:** Thin wiring over Phase 3's runner; this is where the security/UX surface (owner checks, filename encoding, Range gating) concentrates, so it should be its own reviewable unit.
**Delivers:** Trigger/status-poll/download/cancel/history-list routes; opaque UUID job ids with owner checks on every route; dual `filename=`/`filename*=` Content-Disposition; Range serving gated strictly on job status == complete; a test asserting a Range request against a `"running"` job 409s/404s.
**Addresses:** FEATURES.md's "download affordance survives the job finishing while the user is elsewhere" requirement; the resumable-download differentiator.
**Avoids:** Pitfalls 5, 8.

### Phase 5: TTL cleanup, boot-time reconciliation, env knobs, per-user concurrency cap
**Rationale:** Depends on the job registry (Phase 2) and routes (Phase 4) existing; bundling "durability of the whole subsystem across restarts and over time" into one phase keeps the server-restart/race-condition testing coherent.
**Delivers:** `.unref()`'d TTL sweep (race-aware — skips rows with recent access/open handles), boot-time sweep of stale "running" rows to a terminal state (mirrors `wipeSessionsOnModeChange`), new env knobs (`EXPORT_ROW_CAP`, `EXPORT_FILE_SIZE_CAP_MB`, `EXPORT_TTL_MINUTES`, `EXPORT_MAX_CONCURRENT_PER_USER`, `EXPORT_BATCH_SIZE`) following the `readPositiveIntEnv` idiom, `EXPORT_TEMP_DIR` with `ensureDir`.
**Addresses:** PROJECT.md's "disk and concurrency... required, not optional" hazard.
**Avoids:** Pitfalls 6, 9.

### Phase 6: Shared CSV-serialization hardening (formula injection)
**Rationale:** A pre-existing gap in the client-side export (`escapeCsvField` has no `=`/`+`/`-`/`@` guard today), surfaced by this research, not purely new-feature work — but it must be fixed at the same shared layer the server path is porting from, so it belongs in its own small, explicit phase rather than being silently inherited (or silently skipped) by the port.
**Delivers:** Formula-injection prefixing applied identically in `packages/web/src/lib/csvExport.ts` and the new server-side `packages/server/src/lib/csvExport.ts`; a test asserting a cell value of `=1+1`/`=HYPERLINK(...)` round-trips as literal text on both paths.
**Addresses:** PITFALLS.md Pitfall 10 (confirmed pre-existing, not hypothetical).
**Avoids:** Silent Excel RCE/exfil vector shipping unnoticed in either export path.

### Phase 7: Client export-trigger + history UI
**Rationale:** Depends on Phase 4's routes existing. Product decision needed (not purely technical): retire the existing small in-browser `handleDownloadCsv` loop in favor of always routing through the job, or keep it as a fast path for small tables.
**Delivers:** Trigger UI, progress/ETA display (with an explicit "preparing/querying" phase distinct from "writing rows" if `COUNT(*)`-backed progress is used), cancel button, export history list UI (using existing `global.css` canonical classes — `btn-primary btn-sm`, `ghost-sm`, `ds-actions`, per CLAUDE.md's UI conventions).
**Addresses:** FEATURES.md's progress/cancel/history-list table-stakes features.
**Avoids:** CSS-bugs-evade-tests pitfall (per repo memory) — verify new UI visually, not just `tsc`/`vitest`/theme-guard green.

### Phase 8: Line chart multi-series Group By (independent track)
**Rationale:** Fully independent of Phases 1-7 logically — touches `ChartConfigPanel.tsx` and a different line-range of `WidgetRenderer.tsx`'s `LineRenderer` than the export work touches. Can run in parallel from a dependency standpoint, **but shares `WidgetRenderer.tsx` with Phase 7's export-trigger UI wiring** — sequence the two phases or assign both to one plan/executor to avoid a same-file collision (per the repo's own recorded "parallel executors clobber shared files" lesson).
**Delivers:** `isLine` added to `usesMultiColumnGroupBy`; per-series `<Line dataKey={sk}>` render loop reusing `toBarPivotInput`/`selectTopSeries`/`pivotSeriesRows`; truncation banner; `interval={0}` on both line/area `XAxis`; `resolveMetricLabel`/`isCustomSelection` wired into the series `name` prop; an explicit, tested `connectNulls` choice verified against a deliberately sparse synthetic dataset plus a `checkpoint:human-verify` for actual visual correctness.
**Addresses:** PROJECT.md's line-chart target features (multi-series, all-labels-shown, legend-named-after-metric).
**Avoids:** Pitfall 11 (sparse-pivot gap-vs-zero ambiguity shipping as an unexamined Recharts default).

### Phase Ordering Rationale

- Row-limit fix must land first — it's a correctness precondition for everything else and is independently valuable (fixes the heatmap bug as a side effect) with no new infrastructure risk.
- The export-job foundation is sequenced pure-code-first, spike-gated-pagination-decision second, routes/security third, durability-over-time fourth — this follows ARCHITECTURE.md's explicit suggested build order and isolates the one unresolved architectural question (pagination mechanism) into its own reviewable, spike-first phase rather than letting it block the schema/pure-logic work that doesn't depend on it.
- CSV-formula-injection hardening is pulled into its own phase specifically because it's a *discovered*, pre-existing gap (not originally scoped), and PITFALLS.md flags the risk of it being silently inherited (or silently skipped) during the client→server port — an explicit phase with its own acceptance test prevents that.
- Line-chart work is logically independent but file-colliding with the export-trigger UI phase — sequence or co-assign, per both ARCHITECTURE.md and the repo's own recorded parallel-executor lesson.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 3 (batch-loop runner):** needs a live spike against the real Kinetica instance to resolve the unverified `paging_table`/OFFSET-snapshot disagreement (see Open Decisions) before the batch loop's shape can be finalized — `/gsd:research-phase` or an explicit spike task, not standard-pattern planning.
- **Phase 4 (routes/Range download):** Range + gzip + TOCTOU-safe serving interactions are well-documented in general HTTP terms but have zero precedent in this codebase; worth a focused design pass even though the HTTP semantics themselves are standard.

Phases with standard patterns (skip research-phase):
- **Phase 1 (row-limit fix):** the override mechanism already exists and is proven in production; this is an audit-and-apply task, not a design question.
- **Phase 2 (SQLite schema/pure helpers):** directly mirrors `table_sync_history`/`ensureDir`/existing duplication-pattern precedents already in the codebase.
- **Phase 5 (TTL/env knobs):** directly mirrors `sessionStore.ts`'s sweep and `wipeSessionsOnModeChange`'s boot-reconciliation patterns, plus the established `readPositiveIntEnv` env-knob idiom.
- **Phase 6 (formula-injection fix):** a well-documented, standard OWASP mitigation (prefix `=`/`+`/`-`/`@` cells) — small, mechanical.
- **Phase 8 (line chart):** the bar chart's Group By builder is an existing, shipped precedent to port, not a novel design.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | MEDIUM-HIGH | Node/Express/Recharts claims are DOC-VERIFIED or directly confirmed against this repo's installed versions. Kinetica's `/execute/sql` `limit`/`offset`/`has_more_records` contract is DOC-VERIFIED against docs.kinetica.com/7.1. The `max_get_records_size` *default value* (commonly cited as 20000) is MEDIUM — WebSearch-synthesized, not confirmed from a rendered config-table fetch. KiFS permission model is MEDIUM (WebSearch-synthesized, not independently re-fetched from a primary doc page). |
| Features | MEDIUM | Consistent across 6 surveyed tools (Tableau/Power BI/Looker/Metabase/Superset/Grafana), 2+ independent sources per claim, but no tool's docs/source were read directly via Context7 — all WebSearch. Row-limit numbers cited are illustrative precedent, not targets. |
| Architecture | HIGH for file:line claims (read directly from the live checkout). MEDIUM for Kinetica `limit`/`offset` *semantics* (no official doc found in-repo at the time of this research pass; no live Kinetica calls made; `packages/server/.env` not read). |
| Pitfalls | HIGH — codebase-grounded (read `kinetica.ts`, `index.ts`, `WidgetRenderer.tsx`, `materializedView.ts`, `permissions.ts`, `dashboardExport.ts`, `useViewKeepAlive.ts` directly), plus one externally-verified fact (Kinetica's own pagination model via official docs, fetched 2026-10-01) not independently re-verified against this specific deployed instance. |

**Overall confidence:** MEDIUM-HIGH — the codebase-integration picture is unusually solid (all four researchers read the actual files, not just inferred from descriptions); the remaining uncertainty is concentrated entirely in Kinetica server-side behavior that no researcher could verify live.

### Gaps to Address

- **Unresolved disagreement — pagination/snapshot mechanism.** STACK.md and PITFALLS.md independently surface Kinetica's `options.paging_table`/`paging_table_ttl` mechanism (doc-verified: query once, cache server-side, read via `has_more_records`) as the documented, purpose-built way to page a single large result set without re-executing the query or depending on the source view staying alive. ARCHITECTURE.md, working from the same doc-verified `/execute/sql` default (`limit: -9999`/`END_OF_SET`) but without independently surfacing `paging_table`, instead recommends a job-private materialized-view snapshot + plain OFFSET + a deterministic composite `ORDER BY` tiebreaker. **Both are internally consistent and address the same hazard (stable snapshot semantics for a long-running paged read) by different mechanisms — this synthesis does not pick between them.** PITFALLS.md explicitly frames this as a spike item (precedent: `122-SPIKE-NOTES.md`) and so does ARCHITECTURE.md's recommendation to "not use a sentinel without a live spike first." Resolve via a live spike against the real Kinetica instance during Phase 3 planning, before committing the batch-loop's architecture.
- **Unresolved — `max_get_records_size` default value and actual deployed value.** STACK.md cites "commonly cited as 20000" as MEDIUM-confidence/WebSearch-synthesized, not confirmed from a rendered doc table. Verify the actual deployed value (ask the Kinetica admin, or query `/show/system/properties`) rather than hardcode-assume it when sizing `EXPORT_BATCH_SIZE`.
- **Unverified — Kinetica `limit`/`offset` sentinel semantics in general.** No file in this repo documents whether `-9999` or any other sentinel is safe to rely on; ARCHITECTURE.md explicitly flags this as "a gap, not a verified fact." Do not design around an "unlimited" sentinel without a live spike.
- **Unverified — stable row ordering across pages for `/execute/sql`.** Not documented either way by Kinetica; assumed unsafe without an explicit, unique `ORDER BY`, consistent with `/get/records`' documented warning about concurrent-mutation effects on paged results.
- **Operator decisions required** — collected from all four research files, none resolved by this synthesis (all are product/policy calls, not technical ones):
  1. **Raw vs. formatted export values.** All researchers recommend raw-only as the default/launch scope (matching every surveyed BI tool's convention), with a formatted-value toggle deferred to v1.x — but this is the operator's call to make explicit before the export SQL/post-processing step is built, since it changes the SELECT clause shape.
  2. **Snapshot/pagination mechanism** (see above) — a spike-informed technical decision, but the *tradeoffs* (extra Kinetica-side query cost paid once vs. OFFSET's deep-page slowdown; `paging_table_ttl` sizing) have operator/ops implications worth a conscious sign-off.
  3. **RBAC: reuse `dashboards:view`/existing implicit gate vs. add a new `EXPORTS_CREATE`/`EXPORTS_MANAGE` permission.** ARCHITECTURE.md recommends reusing the existing implicit gate (no new exposure vs. today's ungated inline CSV button); PITFALLS.md's Security Mistakes table recommends an explicit new permission gated on create *and* download. These are in tension — flag explicitly for the operator, since either choice has a real ripple cost (a new permission means `rbacDb`/`rbacMigration`/web `permissions` mirror/`RolesPage` spec counts/`permissionGroups` wiring, per this repo's own recorded "adding a permission ripples across specs" lesson).
  4. **Filename policy — dual-header round-trip vs. allow-list slugify.** Settled by research (dual `filename=`/`filename*=UTF-8''...` is correct; the existing `exportFileName()` allow-list pattern is explicitly the *wrong* one to copy here), but confirm the operator actually wants arbitrary-unicode filenames preserved (the feature's stated intent) rather than a simpler sanitized name, since it's a small but real scope choice.
  5. **Admin cap enforcement point and defaults.** PROJECT.md scopes this as env-only, no settings UI (consistent with the operator's standing preference, per repo memory) — confirm the specific default values for `EXPORT_ROW_CAP`/`EXPORT_FILE_SIZE_CAP_MB`/`EXPORT_MAX_CONCURRENT_PER_USER` before Phase 5, since research only establishes the *pattern*, not the numbers.
  6. **Retire vs. keep the existing small in-browser `handleDownloadCsv` loop** once the background job exists (ARCHITECTURE.md Phase/Step 3 note) — a product call on whether small exports get a synchronous fast path or always route through the new job.
  7. **gzip on/off default and whether it's user-chosen per export or always-on** — research only establishes gzip-once-at-finalize is required if offered; whether it's offered as a checkbox or always applied is unresolved.
- **Newly discovered, previously-unscoped bug — heatmap silent truncation.** ARCHITECTURE.md's blast-radius trace found that `HeatmapRenderer.tsx`'s truncation-detection logic (`truncated = data.length >= cellLimit`) compares the *actual returned row count* against the *requested* cell limit, not the real server-side cap. Because the heatmap's own Result Limit choices (1000/2500/5000) already exceed the current 1000-row ceiling, any choice above 1000 is **already silently short today, with the truncation banner incorrectly suppressed** (`data.length` tops out at 1000, which is `< cellLimit` for any requested limit above 1000, so `truncated` evaluates `false`). This is a confirmed, pre-existing, silent-data-loss defect, structurally identical in spirit to the CSV bug that motivated this milestone. Recommend folding its fix into Phase 1 (it's fixed for free by raising the shared default and auditing/fixing the truncation-detection comparison itself) rather than filing it as a separate future bug.
- **Newly discovered, previously-unscoped gap — CSV formula injection in the existing client export.** `packages/web/src/lib/csvExport.ts`'s `escapeCsvField` has no guard against `=`/`+`/`-`/`@`-leading cell values (Excel/spreadsheet formula injection) — this is a pre-existing gap in *today's* client-side download, not a new-feature concern introduced by the server-side export. PITFALLS.md recommends fixing it at the shared serialization layer, applied identically to both the existing client path and the new server path (Phase 6 above).

## Sources

### Primary (HIGH confidence)
- `packages/server/src/kinetica.ts` (full file read directly) — `kineticaSql`/`kineticaShowTable`/`kineticaWms`, hardcoded `limit: 1000` at ~line 186-187, `extra` spread-last override mechanism, per-request credential model
- `packages/server/src/index.ts` (targeted reads) — env-config boot pattern, filter/dynamic-view materialize + preview, spatial info-query envelope-limit precedent (`extra: { limit: 50 }`), discovery routes, `/api/sql` passthrough, session GC sweep ordering, no graceful-shutdown handling
- `packages/web/src/components/charts/WidgetRenderer.tsx` (targeted reads) — `handleDownloadCsv` (existing client CSV export loop), `BarRenderer`/`LineRenderer`, `RecordsTableRenderer` fetch effects
- `packages/web/src/components/charts/ChartConfigPanel.tsx` — existing bar-chart Group By Columns builder
- `packages/web/src/lib/barGroupedSeries.ts`, `groupedSeries.ts`, `heatmapGrid.ts`, `customWhere.ts`, `csvExport.ts` (full files read)
- `packages/web/src/components/charts/HeatmapRenderer.tsx` — truncation-detection bug
- `packages/web/src/hooks/useViewKeepAlive.ts` (full file) — confirmed frontend-only, dashboard-mount-scoped
- `packages/server/src/lib/materializedView.ts`, `lib/viewNaming.ts`, `lib/permissions.ts`, `lib/dashboardExport.ts`, `sessionStore.ts`, `auth.ts`, `db.ts` (full/targeted reads)
- `.planning/PROJECT.md` (v1.26 milestone section) — goal, target features, known hazards as stated by the team
- `CLAUDE.md` — UI conventions, test-gate conventions
- https://docs.kinetica.com/7.1/api/rest/execute_sql_rest/ — `/execute/sql` offset/limit/`END_OF_SET`/`has_more_records`/`paging_table` semantics (DOC-VERIFIED)
- https://docs.kinetica.com/content/api/rest/get_records_rest — `/get/records` contract (DOC-VERIFIED)
- https://nodejs.org/api/zlib.html — `createGzip()`/`pipeline()` backpressure guarantees (DOC-VERIFIED)
- https://expressjs.com/en/5x/api/response/ — `res.download`/`res.sendFile` Range support (DOC-VERIFIED)

### Secondary (MEDIUM confidence)
- `docs.kinetica.com/7.1/config/` — `max_get_records_size` parameter name/description DOC-VERIFIED; default value (20000) MEDIUM/WebSearch-synthesized
- KiFS `directory_read`/`directory_write` permission model — WebSearch-synthesized, not independently re-fetched from a primary page
- Feature-landscape competitor analysis (Tableau/Power BI/Looker/Metabase/Superset/Grafana) — all WebSearch, 2+ sources per claim, full source list in FEATURES.md
- RFC 5987 `filename*=` encoding, OWASP CSV/formula-injection mitigation, Node stream backpressure semantics — standard engineering fact, not independently re-verified via a fresh source this session

### Tertiary (LOW confidence)
- Kinetica `/execute/sql` sentinel (`-9999`) behavior when actually sent to a live instance — asserted by docs but explicitly flagged as unverified-in-this-codebase by ARCHITECTURE.md; needs a live spike, not implementation-time assumption
- Stable row ordering across pages for `/execute/sql` under concurrent writes — not documented either way, inferred unsafe by analogy to `/get/records`'s documented warning

---
*Research completed: 2026-10-01*
*Ready for roadmap: yes — with Phase 3 (batch-loop pagination mechanism) and the RBAC-permission question flagged as requiring a decision/spike before detailed phase planning finalizes their acceptance criteria*
