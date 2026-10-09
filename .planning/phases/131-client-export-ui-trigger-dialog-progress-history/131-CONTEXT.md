# Phase 131: Client Export UI — Trigger Dialog, Progress & History - Context

**Gathered:** 2026-10-07
**Status:** Ready for planning

<domain>
## Phase Boundary

The user-facing half of background export, wired to the Phase 128–130 server. From a records widget, the user can:
- start a background export when a download would exceed the in-browser cap;
- name it, choose raw or formatted values, and tick gzip;
- watch progress and cancel;
- manage their exports on a new **Exports** page: re-download until expiry, cancel, delete.

Requirements: EXPRT-V126-06, -08, -09, -10, -12. This phase also completes the user-facing half of EXPRT-V126-05 and -07.

Includes the small server additions the UI needs:
- the user-supplied **name** stored and used for `Content-Disposition` (EXPRT-V126-08, the `exportDownloadName` seam);
- the **formatted** value mode (`ExportOptions.format`, the Phase 128 row-mapper seam).

Ends with the ROADMAP criterion 5 live `checkpoint:human-verify`, which also closes the open debt carried from Phases 128–130.

**Not in this phase:** widget-action overrides in exports (D-04 below, deferred); a sidebar running badge; any settings UI for caps.

</domain>

<decisions>
## Implementation Decisions

### Trigger & Download button
- **D-01: The dialog appears only when the download would exceed the in-browser cap.** For small tables the records footer's Download button keeps today's one-click in-browser download. When `totalCount` > the effective in-browser cap (`csvDownloadRowCap`, already clamped by `csvInBrowserMaxRows`), clicking Download opens the background-export dialog instead.
- **D-02: The partial in-browser download is kept as a secondary choice.** The dialog offers a ghost-button "Download first N rows now" (N = the in-browser cap), clearly labelled as partial, next to the primary "Start export".
- **D-03: Unknown `totalCount`** (still loading, or the count failed): Download **opens the dialog**. When in doubt, take the background route.
- **D-04: Exports use the saved widget only.** An export reflects the saved widget config plus current filters plus the table's current sort, never runtime widget-action overrides (resolves the Phase 128 Q-D follow-up). When an override is active on the widget, the dialog shows a short note saying the export uses the saved widget settings. Sending overrides to the server is deferred.

### Dialog contents & defaults
- **D-05: The default name is "<widget title> YYYY-MM-DD HHmm"** in local time (e.g. "Taxi trips 2026-10-07 1430"). The name field is editable, and any text is accepted. The extension (`.csv` / `.csv.gz`) is added automatically and is not part of the editable name. The server makes it filesystem- and `Content-Disposition`-safe, and a non-ASCII name must download intact (`res.download` already does RFC 5987 `filename*`).
- **D-06: Raw and formatted are both offered; the default is RAW** (operator: "I think raw might be better sometimes"). Raw means real column names and unformatted values. Formatted means display labels and number formats from Format columns (`columnDisplayConfig`).
- **D-07: "Compress (.csv.gz)" is a checkbox, off by default** (requirement).
- **D-07a (operator, 2026-10-08, SUPERSEDES the `.csv.gz` format of D-07):** compression produces a **`.zip`** containing one `<name>.csv`, so it opens by double-click on macOS and Windows. The checkbox stays (off by default) and is relabelled "Compress (.zip)". Found in UAT: macOS Archive Utility on the operator's Mac refuses every `.gz` file, even a 2-line file from the gzip CLI, although the exports were correct gzip. The earlier OS-byte change (0418602) was reverted (c83d138).
- **D-08: Limits are shown in advance, and Start is blocked when over the row limit.** A small hint line lists only the caps that are set, from `useAuthStore().exportLimits`, e.g. "Limits: 10,000,000 rows · 2 GB · 2 at a time" (MiB; GB when `maxFileMb % 1024 === 0`). When `totalCount` > `maxRows`, the dialog shows the row-cap message (numbers plus "Add filters to narrow it down and try again.", matching the server's `rowCapMessage`) and **disables Start**.
- **D-09: Other refusals are shown inline, verbatim.** Start stays enabled. A 429 (`concurrency_cap`) or 400/403/404 from `POST /api/exports` is shown verbatim inside the dialog, which stays open. No pre-check of the running count.

### Progress & completion
- **D-10: Progress shows in the dialog, which can be closed.** After Start, the dialog switches to a progress view: "1,240,000 of 5,000,000 rows" plus a **Cancel** button. Closing the dialog does **not** stop the export: it keeps running and appears on the Exports page.
- **D-11: Completion.** If the dialog is still open, it shows a **Download** button. If it was closed, a toast reads "Export "<name>" is ready" with a Download action, while the user is still in the app. Failures show the server's `errorMessage` verbatim (cap messages, the session-ended message, `server_restarted`, …) in the dialog or an error toast.
- **D-12: Poll every 5 seconds** (operator choice) on `GET /api/exports/:id` while a tracked job is non-terminal. Stop at a terminal status, when the dialog's job is no longer tracked, and on unmount.
- **D-13: Reload or a new tab: tracking is via the Exports page.** The server owns the job, so nothing is lost. After a reload, running jobs show live progress on the Exports page, but no "ready" toast is re-attached.

### Export history (new Exports page)
- **D-14: A new top-level "Exports" page**, in the sidebar right after Datasets, visible to **every signed-in user** with no permission (Phase 129: no new RBAC permission; each user sees only their own). No running-count badge.
- **D-15: It lists all of the user's exports, newest first,** across dashboards, until they expire (24h default), from `GET /api/exports`. Each row shows its dashboard/widget name.
- **D-16: Columns:** Name · Status · Rows (live progress while running) · Size · Started · Expires (relative, e.g. "in 23 h", from DTO `expiresAt`). For failed rows, the failure reason (`errorMessage`) appears under the status.
- **D-17: Actions depend on status.** Running/queued: **Cancel**. Complete: **Download** + **Delete**. Failed/cancelled/session-ended: **Delete**. Delete asks for confirmation. The page polls (5 s, as D-12) only while it has a non-terminal row.
- **D-18:** The dialog links to the page ("See all exports").

### Claude's Discretion
- **Name storage:** a new `export_jobs` column vs `options_json`, and the sanitising rules. Note: the `EXPDB-ddl` spec asserts the exact column list, and a guarded ALTER pattern exists in `db.ts`.
- **How "formatted" is applied server-side:** load the table's column display config server-side, and decide what happens for dv-bound widgets with no `tableId` (fall back to raw and say so).
- Component structure, the modal markup (reuse `modal-overlay`/`modal-content`/`modal-header`/`modal-body`), the polling hook, and the toast action API.
- Exact copy beyond the strings fixed above.
- How the dialog detects an active widget-action override for the D-04 note.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Milestone & requirements
- `.planning/REQUIREMENTS.md`: EXPRT-V126-05..10, -12
- `.planning/ROADMAP.md`: Phase 131 success criteria 1–5 (criterion 5 is the live `checkpoint:human-verify`, including the deferred snapshot-isolation test)
- `.planning/STATE.md`: "Open debt carried forward" and "For Phase 131" notes (DTO `expiresAt`, `exportLimits` in `useAuthStore`, the 429 `{error, code: "concurrency_cap"}` shape, cap `errorCode`s shown verbatim)

### Prior phase decisions
- `.planning/phases/128-export-job-core-live-spike-runner-snapshot-cancel/128-CONTEXT.md` and `128-SPIKE-NOTES.md` (Operator decisions Q-C columns = `cfg.columns`, Q-D overrides)
- `.planning/phases/129-export-routes-resumable-download-history-privacy/129-RESEARCH.md` and `129-0*-SUMMARY.md`: route shapes and status codes (404/409/410/416), `exportDownloadName` seam, `res.download` RFC 5987 behaviour
- `.planning/phases/130-export-ttl-cleanup-boot-reconciliation-admin-caps/130-CONTEXT.md` (D-15..D-18 message and limits decisions) and `130-06-SUMMARY.md`

### Code
- `packages/web/src/components/charts/WidgetRenderer.tsx`: `handleDownloadCsv` (~2029), `csvDownloadRowCap`/`csvInBrowserMaxRows` (~2005-2012), `totalCount` (~2000, ~2270), records footer Download button (~2449), widget-action overrides (~346-349)
- `packages/web/src/components/Sidebar.tsx` (nav array) and `packages/web/src/App.tsx` (`type Page`, the page switch, URL sync ~419-427)
- `packages/web/src/store/auth.ts` (`exportLimits`), `packages/web/src/lib/exportLimits.ts`
- `packages/web/src/store/columnDisplayConfigStore.ts`: display labels and number formats (formatted mode)
- Modal precedent: `packages/web/src/components/ColumnFormatEditorModal.tsx`; page precedent: `packages/web/src/components/RolesPage.tsx` / `DatasetsPage.tsx`
- `packages/web/src/styles/global.css`: `modal-*`, `btn-primary btn-sm` + `ghost-sm` in `ds-actions`, `ghost-sm ghost-danger`, `ds-field`/`ds-select`, `config-group`, `config-hint`
- Server: `packages/server/src/exportRoutes.ts`, `src/lib/exportJobAccess.ts` (`toExportJobDto`, `exportDownloadName`), `src/lib/exportRunner.ts` (`ExportOptions`, the formatted row-mapper seam), `src/lib/exportCaps.ts` (`rowCapMessage`, `formatExportSizeLimit` to mirror client-side), `src/db.ts` (`export_jobs`)

### Project rules
- `CLAUDE.md`: UI conventions (reuse existing classes, no invented class names, no raw hex, theme tokens), verifiable acceptance criteria, test gates
- Memory notes: CSS bugs evade tests and theme-guard (verify UI visually); `rgba` and wrong tokens slip past theme-guard; `wipe`/`.env` leaks into server vitest

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `totalCount` in the records widget: the dialog trigger and the "X of Y" readouts.
- `useAuthStore().exportLimits`: the limits hint (D-08).
- Modal CSS (`modal-overlay`/`modal-content`/…) and existing modal components as patterns.
- `useToastStore().showToast`: the completion and error toasts. Check whether it supports an action button; if not, that's a small addition.
- Server DTO already carries `rowsWritten`, `totalRows`, `fileBytes`, `expiresAt`, `status`, `errorCode`, `errorMessage`, `gzip`.

### Established Patterns
- Pages are a `Page` union in `App.tsx`, plus the Sidebar `nav` array and URL sync.
- UI uses only global.css utility classes. An invented class silently renders unstyled and passes all gates.
- Client API helpers live in `packages/web/src/api/client.ts` (`apiFetch`).

### Integration Points
- Records footer Download → dialog; dialog → `POST /api/exports` (`widgetId`, filters snapshot, sort, options: `gzip`, `format`, `name`); progress → `GET /api/exports/:id`; cancel → `POST /api/exports/:id/cancel`; history → `GET /api/exports`; delete → `DELETE /api/exports/:id`; download → `GET /api/exports/:id/download` (a plain link/navigation so the browser's download manager can resume).

</code_context>

<specifics>
## Specific Ideas

- Raw is the default value mode: "raw might be better sometimes".
- Limits are visible before starting (carried from Phase 130).
- The truncated quick download stays available but is clearly labelled as partial.

</specifics>

<deferred>
## Deferred Ideas

- Sending widget-action overrides with an export (server validates and applies them): a future follow-up.
- A running-exports badge on the sidebar item.
- Re-attaching "ready" toasts after a page reload.

</deferred>

---

*Phase: 131-client-export-ui-trigger-dialog-progress-history*
*Context gathered: 2026-10-07*
