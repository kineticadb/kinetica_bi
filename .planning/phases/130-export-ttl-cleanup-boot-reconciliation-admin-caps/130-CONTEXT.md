# Phase 130: Export TTL Cleanup, Boot Reconciliation & Admin Caps - Context

**Gathered:** 2026-10-07
**Status:** Ready for planning

<domain>
## Phase Boundary

Make the export subsystem (Phases 128–129) durable over time and across restarts, and let an admin cap it through env vars alone:

1. **Expiry sweep:** expired export jobs and their files are deleted automatically. The sweep never deletes a file an active download holds open.
2. **Boot reconciliation:** after a restart, no job is stuck `queued`/`running` and no orphan export file is left on disk.
3. **Admin caps (env only, no settings UI):** rows per export, file size, and concurrent exports per user. When a cap stops an export, the user is told why.
4. **Client seam for caps:** the cap values are sent to the browser so Phase 131's export dialog can show them in advance. Phase 130 only exposes the values; Phase 131 renders them.

Requirements: EXPRT-V126-14, EXPRT-V126-15.

**Not in this phase:** the export dialog, progress UI and history UI (Phase 131), and any settings UI for caps (the operator prefers env config).

</domain>

<decisions>
## Implementation Decisions

### Expiry & retention
- **D-01: Default expiry is 24 hours**, overridable via env (e.g. `EXPORT_TTL_HOURS`, positive-int validated like other knobs).
- **D-02: The clock starts when the export finishes** (`finished_at`), not when it was started. A long export still gets the full window after completing.
- **D-03: One clock for all terminal rows.** Failed, cancelled and session-ended rows (which have no file) expire on the same window as complete ones, so history shows recent failures with their reason until they expire.
- **D-04: A download in progress finishes before deletion.** The sweep skips a file with an open download and removes it on a later tick. A new download request after expiry gets the normal refusal (404/410, matching Phase 129's O-1). The sweep must never delete a file mid-download. This live race is ROADMAP criterion 3, a `checkpoint:human-verify` with a deliberately slow, held-open download spanning a forced sweep.

### Restart behaviour
- **D-05: Interrupted jobs are marked failed at boot.** Any `queued`/`running` row becomes `failed` with `error_code = 'server_restarted'` and a message like "Export stopped: the server restarted. Start it again." The partial file is deleted. Nothing is auto-restarted.
- **D-06: Leftover `_kbi_exp_` Kinetica views are left to their TTL.** Boot makes no Kinetica calls and introduces no service credential. Views expire via `EXPORT_VIEW_TTL_MINUTES` (default 60).
- **D-07: Orphan files: delete only our own names.** At boot, remove files in `EXPORT_DIR` matching `<uuid>.csv`, `<uuid>.csv.gz` or `<uuid>…part` that have no corresponding live/complete row. Any other file in the directory is left alone and logged. Never wipe the directory wholesale.
- **D-08: Boot logging is one summary line**, e.g. `export reconcile: 2 interrupted jobs failed, 3 orphan files removed`. Nothing is logged when there's nothing to do.

### Cap defaults & enforcement
- **D-09: The per-user concurrency cap defaults to 2** (env, e.g. `EXPORT_MAX_CONCURRENT_PER_USER`). It counts the user's `queued` + `running` jobs, matched case-insensitively like Phase 129 ownership.
- **D-10: Over the concurrency cap, refuse immediately.** The start route returns 429 with the cap message and creates nothing. No queueing.
- **D-11: Row and file-size caps are off by default.** They are unlimited unless the admin sets e.g. `EXPORT_MAX_ROWS` / `EXPORT_MAX_FILE_MB`.
- **D-12: The row cap fails before writing.** After `COUNT(*)` on the snapshot, if `total_rows` > cap, the job fails at once with a cap `error_code` and message. It never writes a truncated file (consistent with Phase 128's "never silently wrong").
- **D-13: The file-size cap stops mid-write.** When bytes on disk pass the cap, the job stops, fails with a cap `error_code`, and the partial file is deleted (Phase 128 D-13: only complete files exist).
- **D-14: The size cap measures bytes on disk.** With gzip ticked, that is the compressed size: the cap protects disk.

### Cap messages
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

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Milestone & requirements
- `.planning/REQUIREMENTS.md`: EXPRT-V126-14, EXPRT-V126-15
- `.planning/ROADMAP.md`: Phase 130 success criteria 1–4 (criterion 3 is a `checkpoint:human-verify`)
- `.planning/STATE.md`: Phase 128/129 outcome paragraphs, the "do not ship between 129 and 130" note, and the "For Phase 130" note (sweep via `exportFilePaths` + `deleteExportJob`, must not race an open download)
- `.planning/research/PITFALLS.md`: TTL sweep / orphan / restart pitfalls

### Prior phase decisions this builds on
- `.planning/phases/128-export-job-core-live-spike-runner-snapshot-cancel/128-CONTEXT.md`: D-13 (only complete files on disk), D-15 (statuses + `error_code`), D-16 (message style)
- `.planning/phases/128-export-job-core-live-spike-runner-snapshot-cancel/128-SPIKE-NOTES.md`: `_kbi_exp_` naming, view TTL backstop
- `.planning/phases/129-export-routes-resumable-download-history-privacy/129-RESEARCH.md` and `129-0*-SUMMARY.md`: route shapes, O-1 status codes, the `res.download` download path, ownership matching

### Code
- `packages/server/src/lib/exportRunner.ts`: `startExport` (:178), `exportFilePaths`, `SessionEndedError` (:75), env getters (`EXPORT_DIR`, `EXPORT_VIEW_TTL_MINUTES` ~:82-95), the run loop, where row/size caps hook in
- `packages/server/src/exportRoutes.ts`: start route (`startExport(` call ~:96; the concurrency 429 goes here or in the runner), download route (~:143; open-download tracking)
- `packages/server/src/lib/exportJobAccess.ts`: `toExportJobDto` (expiry field seam for 131), ownership helpers
- `packages/server/src/db.ts`: `export_jobs` schema, `deleteExportJob`, `listExportJobsForUser`, `finalizeExportJob`
- `packages/server/src/sessionStore.ts:281`: `.unref()`'d `setInterval` sweep precedent
- `packages/server/src/index.ts:187` (`readPositiveIntEnv`), `:239-262` (`wipeSessionsOnModeChange` boot-before-listen precedent), `:458` (client config fields)

### Project rules
- `CLAUDE.md`: verifiable acceptance criteria (a grep must fail before the work); server test gate is set-based (`npm run test:gate`)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `exportFilePaths` + `deleteExportJob`: the sweep's delete primitives (Phase 129).
- `finalizeExportJob`: guarded write-once terminal update. Boot reconciliation and cap failures should go through it, or match its `WHERE status IN ('queued','running')` guard.
- `readPositiveIntEnv` (`index.ts:187`): the env knob idiom. `exportRunner.ts` has its own getters for `EXPORT_*`.
- The runner's existing failure path already deletes `.part` and writes `error_code` + message, so cap failures reuse it.

### Established Patterns
- Boot work runs before `app.listen()` (`wipeSessionsOnModeChange`).
- Periodic sweeps use an `.unref()`'d interval so they never hold the process open (`sessionStore`).
- `export_jobs` has `created_at`, `started_at`, `finished_at` and no `expires_at`.
- Client config is delivered on the auth/me response (`index.ts:458`).

### Integration Points
- Start route (concurrency cap → 429), runner after COUNT (row cap), runner write loop (size cap), download route (open-download tracking for the sweep), boot (reconcile), auth/me (cap values for Phase 131).

</code_context>

<specifics>
## Specific Ideas

- Message style follows Phase 128 D-16: a short reason, then what to do.
- The operator wants users to know the limits *before* starting, in the export dialog (Phase 131), not only after hitting them.

</specifics>

<deferred>
## Deferred Ideas

- Showing the caps in the export dialog, including an early "this export is over the row cap" warning: Phase 131 UI. Phase 130 provides the values only.

</deferred>

---

*Phase: 130-export-ttl-cleanup-boot-reconciliation-admin-caps*
*Context gathered: 2026-10-07*
