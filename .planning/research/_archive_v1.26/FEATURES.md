# Feature Research

**Domain:** BI dashboard large-data export (background export jobs) + multi-series line charts
**Researched:** 2026-10-01
**Confidence:** MEDIUM — patterns are consistent across every tool surveyed (Tableau, Power BI, Looker, Metabase, Superset, Grafana), but none of their docs/source were read directly via Context7; all findings are WebSearch, cross-checked against 2+ independent sources per claim. Treat row-limit numbers as illustrative precedent, not a target to copy.

## Feature Landscape

### Table Stakes (Users Expect These)

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Export reproduces exactly what the widget shows (same filters, dynamic view, `customWhere`, column order/sort) | Every tool surveyed treats this as non-negotiable — Tableau's "Full Data" export explicitly carries "all active filters, parameters and context filters in the view"; a mismatch between what's on screen and what's in the file is the #1 trust-breaker for a BI export. | MEDIUM | PROJECT.md already names this as a known hazard — `handleDownloadCsv`'s assembly logic (`WidgetRenderer.tsx:1957-1980`) is the spec to port server-side, not redesign. |
| A background job for exports that exceed a small in-browser threshold | Universal pattern once data exceeds ~tens of thousands of rows: Superset added `export_streaming` + Celery workers specifically because in-process CSV generation OOMs/timeouts; Metabase's docs distinguish "smaller results download immediately" vs "larger exports process in the background." | MEDIUM | This is literally the milestone's headline feature — batched reads, temp file, no whole-file-in-memory. |
| Progress indicator while the job runs | Users abandon or distrust exports with no feedback once they take more than a few seconds — every async-export implementation surveyed (Zoho Analytics bulk export API, Rails/ActiveJob exporters, Odoo's async export addon) exposes a job id + poll/stream progress. | MEDIUM | Needs a known total (see Differentiators note on `COUNT(*)`) or must gracefully degrade to an indeterminate spinner + row counter when the total is unknown/expensive. |
| Cancel an in-progress export | Table stakes once a job is async and can run for minutes — leaving a disk-filling job with no stop button is actively hostile given this app's per-user disk/TTL design. | LOW–MEDIUM | PROJECT.md already scopes "cancel, which deletes the partial file" — straightforward: mark job cancelled, next batch-write checks the flag, unlink the temp file. |
| File-size / row caps, with the cap enforced AND communicated | Every major tool caps exports and tells the user when they hit it: Power BI shows "Data exceeds the limit" and caps CSV at 150k rows (XLSX differs — see Differentiators/gotcha below); Metabase defaults to ~1,048,575 rows and makes it configurable via `MB_DOWNLOAD_ROW_LIMIT`; Looker's "All Results" scheduled delivery is gated behind an explicit permission precisely because unlimited exports are a deliberate privilege, not a default. | LOW | PROJECT.md already scopes this as a deploy-time env var (admin cap), consistent with the operator's stated preference for env config over a settings UI. Silent truncation (the CURRENT bug) is the one universally-condemned pattern — always show "capped at N rows" or similar, never degrade silently. |
| A download affordance that survives the job finishing while the user is elsewhere in the app | If the export runs in the background, the trigger-and-retrieve points must differ — a toast/notification plus a persistent place to find it (export history), not just the original widget's download button, since the user may have navigated away or closed the dashboard. | MEDIUM | This is why "export history list" (below) isn't a nice-to-have differentiator here — it's required by the async nature of the job itself, same conclusion Zoho/Power BI's own async export APIs reach (job id → poll status → fetch link). |
| Sensible, collision-resistant default filename, operator-overridable | Already true of the existing client-side `buildCsvFilename` helper; every tool lets the user rename on download or at minimum generates a descriptive default (widget/question title + timestamp). | LOW | Carry the existing `buildCsvFilename(widget.title, date)` convention into the server-side job; add a user-supplied override field in the export request. |

### Differentiators (Competitive Advantage)

| Feature | Value Proposition | Complexity | Notes |
|---------|--------------------|------------|-------|
| Resumable download via HTTP Range | None of the surveyed consumer BI tools (Tableau/Power BI/Looker/Metabase/Superset/Grafana) expose Range-resumable export downloads as a documented feature — this is closer to a file-hosting/CDN pattern (`Accept-Ranges`, `Range`, `206 Partial Content`, `Content-Range`) than a BI-export pattern. It's a genuine differentiator for a GPU-database BI tool whose exports can be very large and whose network environment (enterprise VPNs, long-haul links) makes dropped connections likely. | MEDIUM | Standard HTTP semantics (`Accept-Ranges: bytes`, serve `206` on a `Range` request against the stable temp file) — not exotic, but it means the temp file must be addressable by a stable id/ETag for the lifetime of its TTL, and the route must NOT regenerate the file on each GET. |
| Percent-complete progress with ETA, backed by an upfront `COUNT(*)` | Needs a known total to be a true percentage, not just a spinner. `COUNT(*)` on the same filtered view before streaming batches is the standard way other tools derive this (Zoho's async bulk export reports `percentComplete`; generic job-progress guidance is "define a total, then increment" — e.g. Rails exporters call `total_progress` to set the denominator before incrementing). | LOW–MEDIUM | **Decision point for the operator:** a `COUNT(*)` against a transient materialized view adds one more query and one more place the view's TTL/liveness matters (same hazard already flagged — "export reads from transient filter views"). If `COUNT(*)` is cheap on Kinetica (GPU-accelerated, likely true), do it and show rows-written/total + %. If it's ever expensive on huge unfiltered tables, fall back to "N rows written so far" (no %, no ETA) rather than paying for two full scans. Either way, mark any ETA as an estimate — this is explicitly called out as good practice in async-job UX guidance. |
| Export history list (re-download until expiry) | Lets a user return to a long-running or already-completed export without re-triggering it, and is the natural answer to "where do I get my file" once the job is async. Precedent: Power BI's "Get Export To File Status" API exposes an `expirationTime` on the generated file URL; enterprise export-history screens (seen across several non-BI dashboard products, e.g. a 7-day retention window with a capped multi-select re-download) converge on the same shape — a list of {name, requested-at, status, expires-at, re-download}. | MEDIUM | This list is also the natural home for showing cancel/in-progress/failed jobs, not just completed ones — one table for the full async lifecycle, which also satisfies "per-user privacy" (query scoped to the requesting user's own jobs) cheaply. |
| Optional gzip (`.csv.gz`) | Reduces transfer size/time for very large text exports; CSV compresses extremely well (often 80-90%+). Not something the surveyed consumer BI tools expose as a checkbox (they mostly compress for XLSX container format or not at all), making this a Kinetica-BI-specific choice suited to large GPU-scale exports. | LOW | Single-file gzip stream is simpler to implement AND simpler for the resumable-Range feature than a zip archive (gzip is not natively seekable without added framework, but as a plain whole-file download with Range support on the compressed bytes it works the same as any other static file — no need to support Range *inside* the gzip semantically, just byte-range the compressed stream). **This is why gzip (not zip) is the right call**, see Anti-Features below. |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|------------------|-------------|
| Zip as the compression format instead of gzip | "Zip is more universally recognized by end users than .gz" | Zip-with-resumable-range is materially harder: a naive whole-archive zip isn't trivially Range-resumable mid-write the way a flat gzip/plain-CSV stream is, and zip adds a second format decision (single entry vs archive metadata) for one file that never needed a container. No surveyed BI tool's CSV export path uses zip for a single-table export. | Single-file `.csv.gz` (or uncompressed `.csv`) with the operator choosing gzip on/off; recommend the client-side unzip-on-open education is one line of UI copy, not a feature. |
| Exporting formatted/display values (number formats, column display labels) as the default or only option | Users looking at a nicely formatted table naturally expect "what I see" in the file | Every source checked makes the same split: styling/number-format/date-format is explicitly *not* carried into CSV/XLSX raw exports in most tools ("style information such as metric display format... is not exported to Excel and CSV files"); baking formatted strings (thousands separators, currency symbols, re-labeled values) into raw export data corrupts downstream re-import/analysis — numbers become non-numeric strings. This app specifically has a per-column display-config feature (`column_display_config`, per SUMMARY/v1.25 history) that reformats values for on-screen display only. | **Decision point for the operator:** default the export to raw underlying values (what the SQL returns), with formatted/display-label export as an explicit opt-in checkbox if desired at all — don't silently apply display formatting to exported numeric/date columns. Flag this as a scope decision since the app's display-config feature is unusually rich compared to the tools surveyed. |
| Unlimited exports with no admin cap by default | "Power users want everything" | Universally gated behind an explicit admin-granted permission in every enterprise tool surveyed (Looker's `download_without_limit` / `schedule_without_limit`, Power BI's hard 150k CSV / 30k XLSX ceiling that requires a different tool — Paginated Reports — to lift) — an uncapped default is how a dashboard app accidentally becomes a denial-of-service vector against its own disk and the source database. | Keep the deploy-time admin cap (already scoped) as a hard ceiling with no UI override, matching the operator's stated preference for env config over a settings UI. |
| Live/streaming re-query if filters change mid-export | "The export should reflect the latest data" | This is the "snapshot vs. live" question every batched/paged export system hits: OFFSET-based paging without a frozen snapshot can repeat or skip rows if the underlying data (or the filtered view) changes between batches (already flagged in PROJECT.md as the "OFFSET paging needs a stable order" hazard). Re-querying filters mid-export compounds this — the exported rows could straddle two different filter states, which is worse than a slightly-stale-but-internally-consistent file. | **Decision point for the operator:** the export should be a snapshot of the filter state *at trigger time* — either pin/extend the existing materialized view for the job's duration, or materialize a job-private snapshot up front, and use a stable unique-key `ORDER BY` for paging (not a changing dataset's natural order). Do not let the live widget's filters influence an export already in flight. |
| A "live progress" push channel (WebSocket/SSE) as a hard requirement | Feels modern, matches some generic async-job UX guidance (Server-Sent Events pattern) | Adds real-time infrastructure (a push channel, connection lifecycle, reconnect handling) for a feature where simple polling of a job-status endpoint every few seconds is functionally indistinguishable to the user and vastly simpler to build, test, and reason about given this app's existing REST-based architecture (no existing SSE/WebSocket infra per the codebase). | Poll `/api/exports/:id` on an interval from the export-history UI; reserve SSE/WebSocket for a future milestone if polling proves too chatty. |

## Feature Dependencies

```
Fix 1,000-row kineticaSql ceiling (server)
    └──requires──> Audit every other /api/sql caller for the same ceiling
                       (PROJECT.md: "blast radius must be audited, not assumed")

Server-side background export job
    └──requires──> Fix 1,000-row ceiling (job's batched reads hit the same wall)
    └──requires──> Stable ORDER BY key for OFFSET paging (snapshot semantics)
    └──requires──> Keep-alive-or-snapshot strategy for the transient filter view
    └──requires──> Per-user temp-file storage + TTL cleanup sweep
    └──requires──> Per-user concurrent-job limit (disk/Kinetica-connection safety)

Export progress UI
    └──requires──> Background export job (nothing to show progress of otherwise)
    └──enhances──> COUNT(*) upfront (turns "rows written" into "% + ETA")

Cancel
    └──requires──> Background export job
    └──requires──> Partial-file cleanup path shared with TTL cleanup sweep

Resumable download (HTTP Range)
    └──requires──> Background export job producing a STABLE file at a stable path/id
    └──conflicts──> Regenerating/overwriting the file on each GET (must not happen)

Export history list
    └──requires──> Background export job (job records: id, user, filename, status, expiry)
    └──enhances──> Cancel (surfaces an in-progress job's cancel control)
    └──enhances──> Resumable download (re-download entry point)

Optional gzip
    └──enhances──> Background export job (orthogonal; compress the same batched stream)
    └──conflicts──> Zip-as-archive (two different container decisions; pick one)

Operator-chosen filename
    └──enhances──> Export history list (what's shown per row)
    └──requires──> Existing buildCsvFilename default-naming convention (reuse, don't replace)

Admin cap on rows/size (env var)
    └──requires──> Background export job (cap is enforced during batched writes)
    └──conflicts──> Any UI control for raising the cap (operator preference: env-only)

Per-user privacy / temp-file isolation
    └──requires──> Background export job + per-user Kinetica credentials already in request context
    └──requires──> Export history list scoped to requesting user (query filter, not client-side hiding)

Line chart multi-column Group By
    └──requires──> Existing bar-chart "Group By Columns" builder (ChartConfigPanel.tsx ~824-890,
                       usesMultiColumnGroupBy / MAX_BAR_GROUP_BY_COLUMNS) — extend its gating flags
                       to the line chart type rather than duplicating the builder
    └──enhances──> All-x-axis-labels-shown fix (interval={0} on Recharts XAxis) — same
                       rendering surface, but logically independent of the Group-By change
    └──enhances──> Legend-named-after-metric fix — independent Recharts config fix

Legend named after metric
    └──conflicts──> Default Recharts legend behavior (reads the data key literally, e.g. "value") 
                       — must explicitly pass a name prop/formatter, not rely on the default
```

### Dependency Notes

- **Background export job requires fixing the 1,000-row ceiling first:** the job's own batched 20k-row reads from Kinetica go through the same `kineticaSql` helper (`packages/server/src/kinetica.ts:187`, hardcoded `limit: 1000`) that currently truncates the existing CSV download. Building the job on top of the unfixed helper just moves the truncation bug server-side instead of fixing it.
- **Resumable download requires a stable file, not a stable *request*:** HTTP Range resumability only works if re-requesting the same URL/id returns byte-identical content from the same file on disk — this constrains the job's completion state to "file is written, now immutable until TTL" rather than any design where completion triggers on-the-fly regeneration.
- **Line-chart Group By should extend the bar chart's existing builder, not fork it:** the codebase already has a generalized `usesMultiColumnGroupBy` / `requiresGroupBy` gate in `ChartConfigPanel.tsx` with per-chart-type label wording (`labelFor`) and a shared `MAX_BAR_GROUP_BY_COLUMNS` cap — the three line-chart asks (multi-series, all-labels-shown, legend-named-after-metric) are three independent, separable changes and should probably ship as such; only the first one touches the shared builder.
- **Raw-vs-formatted export values conflicts with nothing structurally, but is a REQUIRED operator decision**, not an engineering default to assume — see Anti-Features above. The roadmap should not proceed past the export-job phase without this being settled, since it changes what the SQL SELECT clause / post-processing step looks like.
- **Snapshot semantics (filter-state-at-trigger-time) conflicts with any design that re-reads the live widget's filter store mid-export** — the job should capture its own SQL/view reference once, at trigger time, and never consult the live UI state again.

## MVP Definition

### Launch With (v1 — this milestone, v1.26)

Minimum viable product per PROJECT.md's own target-features list — all of these are already scoped, not optional:

- [ ] Fix the 1,000-row ceiling in `kineticaSql` (and audit other callers) — nothing else in this milestone works without it
- [ ] Server-side background export job: batched (20k-row) reads, streamed to a temp file, batched writes never holding the whole result in memory
- [ ] Progress while it runs (at minimum: rows written so far; % + ETA if `COUNT(*)` proves cheap)
- [ ] Cancel (deletes the partial file)
- [ ] Resumable download via HTTP Range
- [ ] Optional gzip
- [ ] Operator-chosen filename
- [ ] Export history list (list + re-download until expiry)
- [ ] Deploy-time admin cap on rows/size (env var, no settings UI)
- [ ] Per-user temp-file privacy + TTL cleanup sweep
- [ ] Per-user concurrent-export-job limit
- [ ] Line chart: multi-column Group By (port of the bar chart's builder), all x-axis labels shown, legend named after the metric

### Add After Validation (v1.x)

Features to add once the above is live and the operator has seen it run against real large exports:

- [ ] Raw-vs-formatted export toggle, if the operator decides formatted export has real demand beyond v1's raw-only default — trigger: a user specifically asks for display-formatted numbers/labels in the CSV
- [ ] Top-N + "Other" collapsing for the line chart's new multi-series Group By, if operators pick high-cardinality group-by columns and get illegible 20+-line charts — trigger: real usage shows this happening (see Open Questions)
- [ ] Export-progress push channel (SSE/WebSocket) instead of polling — trigger: polling interval proves too chatty or progress feels laggy at scale

### Future Consideration (v2+)

- [ ] Scheduled/recurring exports (email delivery, cron-like) — every surveyed tool (Looker Scheduler, Power BI subscriptions) treats this as a distinct, heavier feature layered on top of on-demand export; defer until on-demand large export is proven stable
- [ ] Export of a full *dashboard* (multiple widgets) rather than one records-table at a time — out of scope per PROJECT.md's goal statement, which is scoped to "every row a records table shows"
- [ ] Cross-format exports (XLSX, JSON) beyond CSV/CSV.gz — PROJECT.md's target list only names CSV + gzip; XLSX in particular has its own row ceilings and formatting complexity in every tool surveyed (Power BI's own 150k/30k CSV-vs-XLSX split exists partly because XLSX has structural row limits independent of any app-level cap)

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|----------------------|----------|
| Fix 1,000-row ceiling (server + audit) | HIGH | LOW–MEDIUM | P1 |
| Background batched export job | HIGH | HIGH | P1 |
| Progress indicator | HIGH | MEDIUM | P1 |
| Cancel | MEDIUM | LOW–MEDIUM | P1 |
| Resumable download (Range) | MEDIUM | MEDIUM | P1 |
| Export history list | HIGH | MEDIUM | P1 |
| Deploy-time admin cap | MEDIUM | LOW | P1 |
| TTL cleanup + per-user privacy | HIGH (risk mitigation) | LOW–MEDIUM | P1 |
| Per-user concurrency limit | MEDIUM (risk mitigation) | LOW | P1 |
| Optional gzip | MEDIUM | LOW | P1 |
| Operator-chosen filename | LOW–MEDIUM | LOW | P1 |
| Line chart multi-column Group By | HIGH | MEDIUM | P1 |
| Line chart all-labels-shown fix | MEDIUM | LOW | P1 |
| Line chart legend-named-after-metric | LOW–MEDIUM | LOW | P1 |
| Raw-vs-formatted export toggle | MEDIUM (unknown until operator decides) | LOW–MEDIUM | P2 |
| Top-N + "Other" for line-chart series | MEDIUM | MEDIUM | P2/P3 |
| Scheduled/recurring export | LOW (not requested) | HIGH | P3 |

**Priority key:**
- P1: Must have for launch (matches PROJECT.md's explicit target-features list)
- P2: Should have, add when possible
- P3: Nice to have, future consideration

## Competitor Feature Analysis

| Feature | Tableau | Power BI | Looker | Metabase | Superset | Grafana | Our Approach |
|---------|---------|----------|--------|----------|----------|---------|--------------|
| Row cap on export | No hard cap in Desktop "Export All"; Server/Cloud admin-configurable max | Hard: 30k (XLSX... actually 150k XLSX / 30k CSV per source — see note) | Default 5k display, up to 50k w/ admin raise; unlimited only via `download_without_limit`/`schedule_without_limit` permission | ~1,048,575 rows default, raised via `MB_DOWNLOAD_ROW_LIMIT` (admin env-style config) | 50k default via `ROW_LIMIT`/`SQL_MAX_ROW` config | 500 rows default on table CSV export (config-dependent) | Deploy-time env var admin cap on rows **and** file size, no UI override — matches operator's standing env-over-UI preference |
| Async/background for large exports | Not documented as a distinct async mode | "Export to File" status API is explicitly async (job id + status + `expirationTime`) | Scheduler-based delivery is inherently async/off-UI-thread | "Smaller results download immediately... larger exports process in the background" | Celery-backed async for large exports; streaming export endpoint exists | Not async — direct inspect/download of already-queried panel data | Always-async background job for exports above the small-in-browser threshold (this milestone replaces the old synchronous client-side loop) |
| History / re-download | Not documented | Export-to-file status API includes an expiring URL, but no persistent user-facing history UI found | Scheduled delivery has its own history, but ad-hoc downloads do not | Not documented as a feature | Not documented as a feature | Not documented as a feature | **Differentiator**: persistent export-history list, user-scoped, until expiry — none of the 6 tools surveyed clearly expose this for ad-hoc (non-scheduled) exports |
| Resumable (HTTP Range) download | Not found | Not found | Not found | Not found | Not found | Not found | **Differentiator** — no surveyed BI tool documents this; treat as a genuine value-add worth the engineering cost given this app's large-export use case |
| Raw vs. formatted export values | Raw-only in "Full Data" export; crosstab export mirrors the view's own formatting | Supports both ("summarized data" visual export vs "underlying data" raw export are separate options) | Not deeply explored in this pass | Not deeply explored in this pass | Not deeply explored in this pass | Raw data by default | **Operator decision required** — default to raw per the anti-feature note above; most tools that do offer a formatted option make it an explicit second mode, not the default |
| Line chart multi-series via Group By | Standard ("color" shelf / multiple measures) | Standard (legend field) | Standard (pivot field) | Standard ("multiple series" doc exists) | Standard | Standard | Port the existing bar-chart Group By Columns builder — not a novel UI pattern, just closing a gap the bar chart already solved |
| Top-N + "Other" collapsing for many series | Yes, via Top N filter | Yes | Partial | Partial | Partial ("long tail" explicitly named as a UX failure mode without it) | No | Not in this milestone's explicit scope (PROJECT.md doesn't mention it) — flagged as a P2/P3 follow-up, not launch-blocking, since cardinality in practice may be low for this app's typical Group By columns |

## Sources

- [Metabase: Exporting results](https://www.metabase.com/docs/latest/questions/exporting-results) — default ~1,048,575-row CSV export limit, `MB_DOWNLOAD_ROW_LIMIT`
- [Metabase docs/exporting-results.md (GitHub)](https://github.com/metabase/metabase/blob/master/docs/questions/exporting-results.md)
- [Metabase issue #66683 — MB_DOWNLOAD_ROW_LIMIT not respected](https://github.com/metabase/metabase/issues/66683)
- [Metabase: Charts with multiple series](https://www.metabase.com/docs/latest/dashboards/multiple-series)
- [Apache Superset discussion #33530 — handling 10M+ row exports](https://github.com/apache/superset/discussions/33530)
- [Apache Superset: Export SQL query results to CSV with streaming](https://superset.apache.org/developer-docs/6.1.0/api/export-sql-query-results-to-csv-with-streaming/)
- [Apache Superset issue #3139 — SQL Lab CSV download row limit set to 1000](https://github.com/apache/superset/issues/3139)
- [Google Cloud docs: Overview of Looker connector requirements, limits, and feature support](https://docs.cloud.google.com/looker/docs/studio/limits-of-the-looker-connector)
- [Google Cloud docs: What are all the row limits in Looker?](https://docs.cloud.google.com/looker/docs/best-practices/row-limits-in-looker)
- [Microsoft Learn: Export Data From a Power BI Visualization](https://learn.microsoft.com/en-us/power-bi/visuals/power-bi-visualization-export-data)
- [Microsoft Learn: Reports — Get Export To File Status REST API](https://learn.microsoft.com/en-us/rest/api/power-bi/reports/get-export-to-file-status) — `expirationTime` field on async export status
- [Tableau Help: Export Data from Tableau Desktop](https://help.tableau.com/current/pro/desktop/en-us/save_export_data.htm)
- [TheBricks: How to Export Data in Tableau](https://www.thebricks.com/resources/guide-how-to-export-data-in-tableau) — "Full Data... Export All" has no hard row limit; admin-configurable server-side max
- [Grafana Community: Export to csv is missing rows](https://community.grafana.com/t/export-to-csv-is-missing-rows/40061)
- [Grafana issue #93068 — Table Export to CSV: Export more than 500 rows](https://github.com/grafana/grafana/issues/93068)
- [Freddie Mac help: How to View and Download Export History](https://help.sf.freddiemac.com/help/lcla_html5/view_dwnld_export.htm) — 7-day retention, capped multi-select re-download pattern
- [Wrike: BI Export in Wrike](https://help.wrike.com/hc/en-us/articles/360019094414-BI-Export-in-Wrike) — 7-day expiring download links
- [Qualtrics: Exporting Data from CX Dashboards](https://www.qualtrics.com/support/vocalize/sharing-dashboards/exporting-data-from-vocalize/) — raw vs. visualized export distinction, style/number-format not carried into CSV/XLSX
- [Zoho Analytics: Export Data (Asynchronous) API](https://www.zoho.com/analytics/api/v2/bulk-api/export-data-async.html) — job id + `percentComplete` pattern
- [server-sent-events.com: Progress Streaming for Long-Running Jobs](https://www.server-sent-events.com/real-time-application-patterns/progress-streaming-for-long-running-jobs/) — `done/total/pct/stage/etaS` fields pattern
- [key2consulting: PowerShell — How to Display Job Progress](https://key2consulting.com/powershell-how-to-display-job-progress/) — progress bars need a defined denominator; specific counts beat bare percentages
- [http.dev: Accept-Ranges](https://http.dev/accept-ranges) — Range-resumable download header semantics
- [Lightdash issue #13561 — "set my series to an `other` group when there are too many groups"](https://github.com/lightdash/lightdash/issues/13561) — long-tail group-by cardinality explicitly named as a UX failure mode; Top-N + "Other" as the standard fix
- [Recharts GitHub issue #498 — `<XAxis>` preserveStartEnd tick behavior](https://github.com/recharts/recharts/issues/498) and [Recharts XAxis API docs](https://recharts.github.io/en-US/api/XAxis/) — confirms `interval={0}` is the correct fix to force every tick/label to render, matching PROJECT.md's stated bug ("Recharts' default tick interval silently drops a colliding x-axis label")
- Codebase: `packages/web/src/components/charts/WidgetRenderer.tsx` (~1939-2030, existing `handleDownloadCsv`), `packages/server/src/kinetica.ts:187` (hardcoded `limit: 1000`), `packages/web/src/components/charts/ChartConfigPanel.tsx` (~824-890, existing bar-chart Group By Columns builder) — read directly to ground complexity/dependency estimates, not inferred

---
*Feature research for: BI large-export background jobs + multi-series line chart*
*Researched: 2026-10-01*
