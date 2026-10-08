# Requirements: Kinetica BI — v1.26 Large Exports & Fixes

**Defined:** 2026-10-01
**Core Value:** Click-through data exploration — users drill into chart elements and the entire dashboard filters to that slice of data, enabling fast iterative analysis without writing SQL.

**Research:** `.planning/research/SUMMARY.md` (+ STACK, FEATURES, ARCHITECTURE, PITFALLS). Two researcher disagreements are deliberately left OPEN for a live spike, not settled here: the pagination mechanism (Kinetica `options.paging_table` vs a job-private snapshot view + OFFSET + composite ORDER BY), and Kinetica's `limit` sentinel / `max_get_records_size` on the real deployment.

## v1 Requirements

### Row limit & CSV safety

- [x] **EXPRT-V126-01**: A records-table CSV download contains every matching row up to the widget's CSV row cap (default 100,000), not 1,000. Root cause: `kineticaSql` hardcodes `limit: 1000` (`packages/server/src/kinetica.ts:186`) and the client loop reads the short page as exhaustion.
- [x] **EXPRT-V126-02**: Every app query that asks for more than 1,000 rows gets them — e.g. a heatmap with Result limit 5,000 draws the full grid — audited caller by caller; no caller that relied on the 1,000 cap as an implicit safety net starts returning unbounded results.
- [x] **EXPRT-V126-03**: When a heatmap's result really is truncated, the truncation warning appears. Today it compares returned rows to the REQUESTED limit, so any Result limit above 1,000 is silently short with no warning (`HeatmapRenderer.tsx:285-306`).
- [x] **EXPRT-V126-04**: A cell beginning with `=`, `+`, `-` or `@` cannot execute as a formula when the CSV is opened in a spreadsheet, on BOTH download paths. Pre-existing gap: `escapeCsvField` (`packages/web/src/lib/csvExport.ts`) quotes only on `"`, `,`, CR, LF.

### Background export

- [x] **EXPRT-V126-05**: When a download exceeds the in-browser row cap, the user can start a background export instead. It contains exactly the rows, columns, column order and sort the records table shows, with filters fixed at the moment it starts (snapshot semantics).
- [x] **EXPRT-V126-06**: While an export runs, the user sees its progress (rows written).
- [x] **EXPRT-V126-07**: The user can cancel a running export; its partial file is deleted.
- [x] **EXPRT-V126-08**: The user can name the file before starting (default: widget title + timestamp); any name is made safe for the filesystem and the `Content-Disposition` header, and a non-ASCII name survives.
- [x] **EXPRT-V126-09**: The user chooses raw values (real column names, unformatted values) or formatted values (display labels and number formats from Format columns).
- [x] **EXPRT-V126-10**: The user can tick "Compress (.zip)"; it is off by default. (Changed from ".csv.gz" in UAT 2026-10-08: macOS Archive Utility rejected .gz; CONTEXT D-07a.)
- [x] **EXPRT-V126-11**: A finished export downloads resumably — a dropped connection continues where it stopped rather than restarting. Only a complete, closed file is ever served.
- [x] **EXPRT-V126-12**: The user can see a list of their recent exports (name, status, rows, size, expiry), re-download any until it expires, and delete them.
- [x] **EXPRT-V126-13**: Only the user who started an export can see, download, cancel or delete it; export ids are unguessable and every route checks ownership.
- [x] **EXPRT-V126-14**: Exports and their files are deleted after a deploy-configured expiry; a server restart leaves no export stuck "running" and no orphaned files; cleanup never deletes a file mid-download.
- [x] **EXPRT-V126-15**: An admin can cap rows per export, file size, and concurrent exports per user through env config (not a settings UI); the user is told when a cap stops their export.
- [x] **EXPRT-V126-16**: If the user's session ends (logout or expiry), a running export stops with a clear failure state rather than hanging, and never runs on stale credentials.
- [x] **EXPRT-V126-17**: Anyone who can view the dashboard can export, wherever the widget's CSV toggle is enabled — no new RBAC permission.

### Line chart

- [ ] **LINE-V126-01**: The line chart has the bar chart's Group By Columns builder; a second column draws one line per value (e.g. one line per `payment_type`).
- [ ] **LINE-V126-02**: Every x-axis category label is shown, never silently dropped.
- [ ] **LINE-V126-03**: The legend shows the metric's name, not `value`.
- [ ] **LINE-V126-04**: Clicking a point on a multi-series line chart drills down the same way the multi-series bar chart does.

## v2 Requirements

Deferred to a future milestone. Tracked but not in this roadmap.

- **EXPRT-F1**: Export the data behind aggregated charts (bar/line/pie), not only records tables
- **EXPRT-F2**: Scheduled / recurring exports
- **EXPRT-F3**: Notify (email or in-app) when a long export finishes
- **EXPRT-F4**: Admin view of all users' exports and disk usage
- **CFGSQL-F1**: Remove persisted `config.sql` (generate chart SQL at render time) — previously named as the v1.26 candidate, moved out at milestone open

## Out of Scope

| Feature | Reason |
|---------|--------|
| Kinetica native `EXPORT TABLE … INTO FILE` / KiFS | `/download/files` returns file bytes embedded in a JSON response (no streaming, no Range resume) and KiFS needs admin-provisioned directory grants — conflicts with resumable download and per-user privacy |
| zip / xlsx output | gzip covers the size need for a single table; zip adds no benefit and complicates Range resume; xlsx has row limits below the target sizes |
| Exports shared between users | Per-user privacy is a requirement (EXPRT-V126-13) |
| A job-queue library / worker processes | Exports run on the requesting user's live Kinetica session, which cannot be persisted for a separate worker; in-process with an `unref()` sweep matches the existing `sessionStore.ts` precedent |
| A new npm dependency | Node builtins (`stream.pipeline`, `zlib`) and Express `res.download` (Range-capable) cover everything |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| EXPRT-V126-01 | Phase 127 — Row-Limit Ceiling, Caller Audit & Heatmap Truncation Fix | Complete |
| EXPRT-V126-02 | Phase 127 — Row-Limit Ceiling, Caller Audit & Heatmap Truncation Fix | Complete |
| EXPRT-V126-03 | Phase 127 — Row-Limit Ceiling, Caller Audit & Heatmap Truncation Fix | Complete |
| EXPRT-V126-04 | Phase 128 — Export Job Core — Live Spike, Runner, Snapshot & Cancel | Complete |
| EXPRT-V126-05 | Phase 128 (engine) → 129 (routes) → 131 (user-facing) | Complete |
| EXPRT-V126-06 | Phase 131 — Client Export UI — Trigger Dialog, Progress & History | Complete |
| EXPRT-V126-07 | Phase 128 (engine) → 129 (routes) → 131 (user-facing) | Complete |
| EXPRT-V126-08 | Phase 131 — Client Export UI — Trigger Dialog, Progress & History | Complete |
| EXPRT-V126-09 | Phase 131 — Client Export UI — Trigger Dialog, Progress & History | Complete |
| EXPRT-V126-10 | Phase 131 — Client Export UI — Trigger Dialog, Progress & History | Complete |
| EXPRT-V126-11 | Phase 129 — Export Routes — Resumable Download, History & Privacy | Complete (proxy-path resume not exercised — see STATE) |
| EXPRT-V126-12 | Phase 131 — Client Export UI — Trigger Dialog, Progress & History | Complete |
| EXPRT-V126-13 | Phase 129 — Export Routes — Resumable Download, History & Privacy | Complete |
| EXPRT-V126-14 | Phase 130 — Export TTL Cleanup, Boot Reconciliation & Admin Caps | Complete |
| EXPRT-V126-15 | Phase 130 — Export TTL Cleanup, Boot Reconciliation & Admin Caps | Complete |
| EXPRT-V126-16 | Phase 128 — Export Job Core — Live Spike, Runner, Snapshot & Cancel | Complete |
| EXPRT-V126-17 | Phase 129 — Export Routes — Resumable Download, History & Privacy | Complete |
| LINE-V126-01 | Phase 132 — Line Chart Multi-Series Group By | Pending |
| LINE-V126-02 | Phase 132 — Line Chart Multi-Series Group By | Pending |
| LINE-V126-03 | Phase 132 — Line Chart Multi-Series Group By | Pending |
| LINE-V126-04 | Phase 132 — Line Chart Multi-Series Group By | Pending |

**Coverage:**
- v1 requirements: 21 total
- Mapped to phases: 21
- Unmapped: 0 ✓

---
*Requirements defined: 2026-10-01*
*Last updated: 2026-10-08 after Phase 131 (EXPRT-V126-05..10, -12 complete; live UAT V1-V13 passed; Compress is .zip)*
