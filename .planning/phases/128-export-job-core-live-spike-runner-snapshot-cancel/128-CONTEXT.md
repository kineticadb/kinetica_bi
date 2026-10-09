# Phase 128: Export Job Core — Live Spike, Runner, Snapshot & Cancel - Context

**Gathered:** 2026-10-06
**Status:** Ready for planning

<domain>
## Phase Boundary

The server-side engine for a background CSV export, with no routes and no UI:

1. A **live spike** against the real Kinetica instance settles how the job pages a large, stable result set: `options.paging_table` or a job-private snapshot view + OFFSET + composite `ORDER BY`. A written decision is approved at a checkpoint **before** the runner is built.
2. A **batch-loop runner** writes an exact, filter-snapshotted CSV to a temp file. It has the same columns, column order and sort as the records table, and is never held whole in memory.
3. **Formula-injection hardening**, applied identically to the new server writer and the existing client `escapeCsvField`.
4. A **cancel primitive** that stops the loop, deletes the partial file and leaves a terminal status in SQLite.
5. **Session-bound credentials**, re-derived before every batch. The job fails closed when the session is gone.

Requirements: EXPRT-V126-04, 05, 07, 16.

**Not in this phase:**
- Routes, Range download, history and ownership checks: Phase 129.
- TTL sweep, boot reconciliation and admin env caps: Phase 130.
- Trigger dialog, progress UI, filename, raw/formatted toggle and gzip checkbox: Phase 131.

The runner must leave room for Phase 131's raw/formatted choice and gzip option, but does not build their UI.

</domain>

<decisions>
## Implementation Decisions

### Live spike
- **D-01 — The executor runs the spike itself** with the dev credentials in `packages/server/.env` (`KINETICA_URL`/`KINETICA_USERNAME`/`KINETICA_PASSWORD`), via a small `tsx` script. The evidence goes to `128-SPIKE-NOTES.md` (precedent: `.planning/phases/18-spatial-spike-and-endpoint/18-SPIKE-NOTES.md`, `37-cb-track-wms-spike/37-SPIKE-NOTES.md`). The spike plan **ends in a `checkpoint:human-verify`**: the operator approves the mechanism before any runner plan executes.
- **D-02 — The spike pages a large existing table, read-only.** The executor picks the largest readable table in the instance (≥50k rows, so multi-batch paging really happens) and records its name and row count in the notes. It creates no tables in the operator's schemas. A job-private snapshot view needed to *test* the OFFSET path is allowed, and must be dropped afterwards.
- **D-03 — Prefer `paging_table` if it holds.** Choose it when, live, it returns every row exactly once across pages (count + dedupe check), `has_more_records` is the exhaustion signal, it stays readable for a long job (sized via `paging_table_ttl`), and it can be cleaned up. Otherwise fall back to snapshot view + OFFSET + composite ORDER BY (D-05). The notes must record, for whichever paths were tried: the time per batch, the row-exactness result, how Kinetica-side objects are cleaned up, and the confirmed `max_get_records_size`.
- **D-04 — Fold in the open Phase 127 items** using the same script and table:
  - (a) whether row order is stable across split `kineticaSql` calls with no unique ORDER BY;
  - (b) what happens when `KINETICA_MAX_RECORDS_PER_CALL` is set above the server's `max_get_records_size` (Phase 127 D-11, unit-tested only).
  Record each as verified or refuted. If (a) is refuted, note the impact on Phase 127's split-call path in the notes, as a follow-up. Do not silently fix it here.

### Stable order and exactness
- **D-05 — If the OFFSET path is chosen and the widget's sort isn't unique,** append every other exported column as a silent tiebreak: `ORDER BY <user sort>, <remaining exported columns in order>`. Only exact-duplicate rows stay ambiguous, and they are identical, so that is harmless. No refusing and no warnings. (With `paging_table` the result is computed once, so no tiebreak is needed.)
- **D-06 — No sort on the records table:** the export uses whatever order the snapshot yields; the on-screen order is arbitrary too. The OFFSET path may add an all-columns ORDER BY internally purely for page stability.
- **D-07 — Self-check:** `COUNT(*)` the snapshot once at the start and store it as `total_rows`, which Phase 131's progress also needs. At the end, `rows_written` must equal it. **On a mismatch the job FAILS** (error_code `row_mismatch`) and never completes with a silently wrong file.
- **D-08 — Columns:** exactly the records table's visible columns in on-screen order. This mirrors `handleDownloadCsv` (`columnOrder` if non-empty, else `effectiveColumns`, at `WidgetRenderer.tsx:~2045`). Hidden columns are excluded.

### Formula-injection rule (EXPRT-V126-04)
- **D-09 — Neutralise by prefixing a single quote `'`** (the OWASP rule). It runs before the existing RFC-4180 quoting, so `=1+1` becomes `'=1+1`, and `=a,b` becomes `"'=a,b"`.
- **D-10 — Trigger characters:** a leading `=`, `+`, `-`, `@`, TAB (`\t`) or CR (`\r`).
- **D-11 — Purely numeric values are exempt.** A JS number, or a string matching a strict numeric pattern (e.g. `-5`, `-3.14`, `+1e6`), is written unchanged, so negative numbers stay numeric on re-import. Only text like `-2+3` or `=HYPERLINK(...)` gets the prefix.
- **D-12 — One function for every field, header names included.** The client (`packages/web/src/lib/csvExport.ts`) and the server port (new `packages/server/src/lib/csvExport.ts`) apply the **same** rule. Both need tests: `=1+1`, `=HYPERLINK("x")`, `@SUM(A1)`, `-2+3` and a leading-tab string come out neutralised; `-5`, `+1e6` and `-3.14` come out unchanged. Each test title must be new, so the check fails before the work is done (see CLAUDE.md).

### Failure, cancel and status
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

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Milestone research and requirements
- `.planning/research/SUMMARY.md` — the open pagination disagreement ("Gaps to Address"), pitfalls 2–4, 7 and 10, and component sketch (runner, `export_jobs`, `lib/exportSql.ts`)
- `.planning/research/PITFALLS.md` — paging_table recommendation, backpressure, per-batch credential re-derivation, formula injection
- `.planning/research/ARCHITECTURE.md` — snapshot view + OFFSET alternative, server-side SQL rebuild from persisted widget config
- `.planning/research/STACK.md` — zero-new-dependency stack (`node:stream/promises`, `node:zlib`)
- `.planning/REQUIREMENTS.md` — EXPRT-V126-04, 05, 07, 16
- `.planning/ROADMAP.md` — Phase 128 success criteria 1–5

### Phase 127 (prior decisions this phase builds on)
- `.planning/phases/127-row-limit-ceiling-caller-audit-heatmap-truncation-fix/127-CONTEXT.md` — D-01..D-03, D-10, D-11 (per-query and per-call limits, has_more_records paging, misconfiguration warning)
- `.planning/phases/127-row-limit-ceiling-caller-audit-heatmap-truncation-fix/127-CALLER-AUDIT.md` — caller classification
- `.planning/phases/127-row-limit-ceiling-caller-audit-heatmap-truncation-fix/127-VERIFICATION.md` — what was and wasn't verified live

### Code
- `packages/server/src/kinetica.ts` — `kineticaSql` (~232+), `getRowLimitConfig`, batch-splitting loop and `has_more_records` handling (~330-370)
- `packages/server/src/lib/materializedView.ts:31` — `createOrReplaceMaterialized` (snapshot path)
- `packages/server/src/db.ts:326` — `table_sync_history` schema/CRUD precedent
- `packages/server/src/sessionStore.ts:193` — `getSession(sid)`; `:265`/`:269` `deleteSession`/`deleteSessionsForUser`; `:281-290` `.unref()` sweep precedent
- `packages/server/src/index.ts:238-261` — `wipeSessionsOnModeChange` boot pattern (precedent only; reconciliation itself is Phase 130)
- `packages/web/src/lib/csvExport.ts` — `escapeCsvField`/`rowsToCsv` to harden and port
- `packages/web/src/components/charts/WidgetRenderer.tsx:2029+` — `handleDownloadCsv`: column list, ORDER BY, `customWhere`, FROM-source assembly the export must reproduce

### Project rules
- `CLAUDE.md` — verifiable acceptance criteria (a grep must fail before the work), server test gate is set-based (`TD-V16-TEST-ISOLATION`)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `kineticaSql` + `getRowLimitConfig()` (Phase 127): already splits by `maxRecordsPerCall` and pages on `has_more_records`. The runner passes its own explicit `extra.limit` per batch.
- `createOrReplaceMaterialized`: snapshot creation if the OFFSET path wins.
- `escapeCsvField`/`rowsToCsv`: the source for the server port. Both get the D-09..D-12 rule.
- `sessionStore.getSession(sid)`: returns null on a missing or expired session. This is the per-batch fail-closed check.

### Established Patterns
- SQLite tables with CHECK-constrained status and CRUD in `db.ts` (`table_sync_history`).
- Env knobs read once with positive-int validation (`readRowLimitEnv` in `kinetica.ts`).
- Per-request credentials: `kineticaSql` derives auth from `req`. The background job has no `req`, so credential derivation must be factored out without caching secrets.
- Spike-then-checkpoint phases (18, 37, 68.2).

### Integration Points
- New `export_jobs` table and runner module. No routes yet: Phase 129 wires trigger, status, cancel and download over this phase's primitives (`startExport`, `cancelExport`, a status read).
- The client `csvExport.ts` change affects the existing in-browser download immediately.

</code_context>

<specifics>
## Specific Ideas

- Operator preference, as in Phase 127: never trust a short page and never truncate silently. Here that becomes "a wrong row count fails the job".
- Formula guard: OWASP single-quote prefix, numeric values exempt.

</specifics>

<deferred>
## Deferred Ideas

- If the spike refutes row-order stability across split `kineticaSql` calls (D-04a), the fix to Phase 127's split-call path is a follow-up item, not Phase 128 scope.

</deferred>

---

*Phase: 128-export-job-core-live-spike-runner-snapshot-cancel*
*Context gathered: 2026-10-06*
