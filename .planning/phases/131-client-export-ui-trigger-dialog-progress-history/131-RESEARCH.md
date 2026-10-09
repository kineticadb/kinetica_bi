# Phase 131: Client Export UI — Trigger Dialog, Progress & History - Research

**Researched:** 2026-10-07
**Domain:** React/zustand client UI over an existing Express/SQLite export-job server; small server additions (name, formatted values)
**Confidence:** HIGH (all findings verified against repo source at the cited lines; two items flagged MEDIUM/LOW below)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
(D-01..D-18, copied verbatim in substance from 131-CONTEXT.md; the planner MUST read 131-CONTEXT.md itself for exact wording)

- **D-01** Dialog appears only when the download would exceed the in-browser cap (`totalCount` > `csvDownloadRowCap`, already clamped by `csvInBrowserMaxRows`). Small tables keep the one-click in-browser download.
- **D-02** Partial in-browser download kept as a ghost-button "Download first N rows now" (N = in-browser cap) next to the primary "Start export".
- **D-03** Unknown `totalCount` (loading or failed) opens the dialog.
- **D-04** Exports use the saved widget only (saved config + current filters + the table's current sort); never runtime widget-action overrides. When an override is active the dialog shows a short note. Sending overrides to the server is deferred.
- **D-05** Default name "<widget title> YYYY-MM-DD HHmm" local time. Name field editable, any text accepted. Extension (`.csv` / `.csv.gz`) added automatically, not part of the editable name. Server makes it filesystem- and `Content-Disposition`-safe; non-ASCII must download intact.
- **D-06** Raw and formatted both offered; default RAW. Formatted = display labels and number formats from Format columns (`columnDisplayConfig`).
- **D-07** "Compress (.csv.gz)" checkbox, off by default.
- **D-08** Limits shown in advance from `useAuthStore().exportLimits` (only caps that are set; MiB, GB when `maxFileMb % 1024 === 0`). When `totalCount` > `maxRows`, show the row-cap message (mirror server `rowCapMessage`) and DISABLE Start.
- **D-09** Other refusals shown inline, verbatim; Start stays enabled; 429 `concurrency_cap` / 400 / 403 / 404 from `POST /api/exports` shown inside the dialog, which stays open. No pre-check of the running count.
- **D-10** Progress in the dialog ("1,240,000 of 5,000,000 rows" + Cancel); closing the dialog does NOT stop the export.
- **D-11** Completion: dialog open -> Download button; dialog closed -> toast `Export "<name>" is ready` with a Download action while the user is in the app. Failures show server `errorMessage` verbatim in dialog or error toast.
- **D-12** Poll `GET /api/exports/:id` every 5 s while a tracked job is non-terminal. Stop at terminal status, when the dialog's job is no longer tracked, and on unmount.
- **D-13** Reload / new tab: tracking is via the Exports page; no "ready" toast re-attached.
- **D-14** New top-level "Exports" page, sidebar right after Datasets, every signed-in user, no permission, no badge.
- **D-15** Lists all the user's exports newest first, across dashboards, until expiry, from `GET /api/exports`; each row shows dashboard/widget name.
- **D-16** Columns: Name · Status · Rows (live while running) · Size · Started · Expires (relative, from DTO `expiresAt`). Failed rows show `errorMessage` under the status.
- **D-17** Actions: running/queued Cancel; complete Download + Delete; failed/cancelled/session-ended Delete. Delete confirms. Page polls (5 s) only while it has a non-terminal row.
- **D-18** Dialog links to the page ("See all exports").

### Claude's Discretion
- Name storage: new `export_jobs` column vs `options_json`, and sanitising rules (EXPDB-ddl asserts exact column list; guarded ALTER pattern exists in `db.ts`).
- How "formatted" is applied server-side: load column display config server-side; dv-bound widgets with no `tableId` fall back to raw and say so.
- Component structure, modal markup (reuse `modal-overlay`/`modal-content`/`modal-header`/`modal-body`), the polling hook, the toast action API.
- Exact copy beyond strings fixed in CONTEXT/UI-SPEC.
- How the dialog detects an active widget-action override for the D-04 note.

### Deferred Ideas (OUT OF SCOPE)
- Sending widget-action overrides with an export (server validates and applies them).
- A running-exports badge on the sidebar item.
- Re-attaching "ready" toasts after a page reload.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| EXPRT-V126-05 (user-facing half) | Export equals what the table shows | Section "Start request mapping": exact client derivation of filters/spatial/sort identical to the orchestrator's resolution |
| EXPRT-V126-06 | Trigger dialog above the in-browser cap | "Trigger branch"; existing-test breakage list |
| EXPRT-V126-07 (user-facing half) | Progress + cancel | "Tracker / polling design", "Cancel semantics" |
| EXPRT-V126-08 | User-supplied name -> Content-Disposition | "Name storage + sanitising" |
| EXPRT-V126-09 | Raw vs formatted values | "Formatted values" (port `columnFormatter` to server, row-mapper seam) |
| EXPRT-V126-10 | Gzip option | Already supported by server `options.gzip`; dialog checkbox only |
| EXPRT-V126-12 | History list: re-download until expiry, delete | "Exports page", DTO additions, download mechanics |
</phase_requirements>

## Summary

The server is almost complete: `POST /api/exports` already takes the filter/spatial/sort spec and `options.gzip`; the DTO already carries progress and `expiresAt`. Four server gaps must be closed in this phase, and the research found two that CONTEXT/UI-SPEC did not anticipate: (1) the DTO has NO dashboard/widget name (D-15 needs one) and (2) the route currently rejects every `options.format` except `"raw"` (`exportRoutes.ts:73`). Name storage should go in `options_json` (no schema change, EXPDB-ddl untouched). Formatted values require porting `columnFormatter.ts` (d3-format based, pure) to the server, adding `d3-format` to `packages/server/package.json` AND the lockfile (production does `npm ci`).

On the client, the hardest part is correctness of the start request: the records table does not hold its filters; it only reads a materialized view NAME from `filterCombinationStore`. The export must re-derive the exact filter set the orchestrator used (`resolveFilterSet` + `resolveSpatialShapes` + `aggregateSpatialTargetsByTable`), reading `filterStore.filters[tableId]` (or `dvFilters[dvId]` for dv-bound). That derivation is specified below.

Three UI-SPEC details need correction/attention: the download URL MUST be prefixed with `API_BASE` (UI-SPEC's bare `/api/exports/:id/download` breaks in local dev where the API is :4000 and Vite has no proxy); a bare `window.location.assign` to an endpoint that can return JSON 4xx will replace the SPA with a JSON page (use a cheap `Range: bytes=0-0` preflight through `apiFetch`); and six existing `WidgetRenderer.spec.tsx` tests click Download and will change behaviour under D-01/D-03.

**Primary recommendation:** Build server additions first (name in `options_json`, `format: "formatted"` via a ported formatter applied in `run()`, DTO `name`/`dashboardName`/`widgetTitle`), then a pure client lib (`exportRequest.ts`, `exportTracker.ts`), then `ExportDialog`, `ExportsPage`, nav wiring, toast action, and last the live checkpoint.

## Standard Stack

No new client libraries. One new server dependency.

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| react / zustand / vitest / RTL | existing | UI, tracker store, tests | Project stack; zustand auto-reset mock in `src/test/setup.ts` |
| `@fortawesome/free-solid-svg-icons` | ^7.2.0 (installed) | `faDownload` for the nav item | Verified: `typeof faDownload === "object"` in the installed package |
| `d3-format` | 3.1.2 (verified `npm view`, 2026-10-07; already in web deps `^3.1.2`, root node_modules) | Server-side number formatting identical to web | Same lib the web formatter uses; guarantees identical output |
| `@types/d3-format` | ^3.0.4 (web already has it) | Server tsc (`moduleResolution: Node`) | Needed for `tsc --noEmit` on server |
| `content-disposition` 0.5.4 / `express` 4.x | existing | `res.download` RFC 5987 | Verified by execution (below) |

**Installation (server):**
```bash
npm install -w @kinetica-bi/server d3-format
npm install -w @kinetica-bi/server -D @types/d3-format
# MUST commit the updated package-lock.json: Dockerfile runs `npm ci --omit=dev` (Dockerfile:19) and fails on a lock/package.json mismatch.
```

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Port formatter to server | Client sends already-formatted rows | Impossible: server streams the file; client never sees the rows |
| Port formatter to server | Server imports `packages/web/src/lib/columnFormatter.ts` | `rootDir: "src"` in server tsconfig forbids it; established pattern is a duplicated file + parity spec (`tests/lib.csvExport.parity.spec.ts`) |
| `options_json.name` | New `export_jobs.name` column via guarded ALTER | Column is cleaner for querying but forces edits to EXPDB-ddl (`tests/db.exportJobs.spec.ts:57-66` exact column list), `mapExportJob`, `insertExportJob`, `EXPDB-insert-get toEqual`. Nothing queries by name. Use options_json. |

## Architecture Patterns

### Recommended Project Structure
```
packages/server/src/
├── lib/columnFormatter.ts        # NEW: port of web columnFormatter (buildFormatter only; drop defaultFormatKind/columnTypes import)
├── lib/exportName.ts             # NEW (or inside exportJobAccess.ts): sanitizeExportName / exportFileBase
├── lib/exportJobAccess.ts        # EDIT: parseExportOptions, toExportJobDto (+name, dashboardName, widgetTitle), exportDownloadName(name seam)
├── lib/exportRunner.ts           # EDIT: ExportOptions {format?: "raw"|"formatted"; gzip?; name?}; formatted mapper in run()
└── exportRoutes.ts               # EDIT: accept options.name + format "formatted"
packages/web/src/
├── lib/exportRequest.ts          # NEW pure: buildExportRequest(), defaultExportName(), exportLimitsHint(), relativeExpiry(), formatBytes()
├── lib/exportDownload.ts         # NEW: startExportDownload(id) preflight + location.assign (mockable seam)
├── store/exportTracker.ts        # NEW: module-level poller + tiny zustand store of tracked jobs
├── hooks/useExportsList.ts       # NEW: page polling hook
├── components/ExportDialog.tsx   # NEW
├── components/ExportsPage.tsx    # NEW
├── api/client.ts                 # EDIT: ExportJobDto + 5 helpers + exportDownloadUrl
├── store/toast.ts, components/Toast.tsx   # EDIT: optional action
├── components/Sidebar.tsx, App.tsx        # EDIT: nav + Page union + switch + ReturnTo whitelist
└── components/charts/WidgetRenderer.tsx   # EDIT: trigger branch + dialog mount in RecordsTableRenderer
```

### Pattern 1: Start request mapping (EXPRT-V126-05) — HIGH
**What:** `POST /api/exports` body accepted today (`exportRoutes.ts:55-84`):
`{ widgetId: positive int, filters?: object[] (<=200), spatialFilters?: object[] (<=200), spatialTarget?: object|null, sortField?: string|null, sortDir?: "asc"|"desc", options?: { gzip?: boolean, format?: "raw" } }`. 202 `{data: ExportJobDto}`. Errors: 400 `{error, code:"invalid_export_request"|<ExportSpecErrorCode>}`, 403 CSV disabled, 404 `{error:"Widget not found."}`, 429 `{error, code:"concurrency_cap"}`.

Server semantics that the client mapping must respect (`lib/exportSql.ts`):
- `spatialFilters` and `spatialTarget` MUST be sent together or neither (`:117-119` -> 400 `invalid_filter`); `spatialTarget.tableId` must equal the widget's `tableId` (`:122`); dv path (`cfg.dynamicViewId` is a number, checked FIRST at `:104`) rejects any spatial (`:109`).
- Filter columns are IDENT_RE-validated; sort field IDENT_RE-validated; `spec.sortField` empty/absent falls back to saved `cfg.sortField`/`cfg.sortDirection` (`:162-174`).
- Columns = `cfg.columns` (IDENT_RE-filtered, in order) or all columns; `customWhere` from saved config is applied server-side. The table also applies `cw` (customWhere) so they agree.

**Client derivation (put in pure `lib/exportRequest.ts`, called inside `RecordsTableRenderer`)** — this mirrors `useCombinationOrchestrator.ts:229-262` (table path) and `:296-330` (dv path), the source of the view the table actually reads:

```typescript
// Source: useCombinationOrchestrator.ts:229-262, resolveFilterSet.ts, resolveSpatialShapes.ts, spatialTargets.ts
const cfg = widget.config;                       // effectiveWidget config (includes overlay; see D-04 note)
const filterSelection = cfg.filterSelection as FilterSelectionConfig | undefined;
const dvId = cfg.dynamicViewId as number | undefined;
let filters: ActiveFilter[]; let spatialFilters; let spatialTarget;
if (typeof dvId === "number") {                  // server checks dv FIRST, so client must too
  const dvScopeDisabled = useAuthStore.getState().dvFilterScopeDisabled;       // orchestrator :215
  const sel = dvScopeDisabled ? undefined : filterSelection;
  filters = resolveFilterSet(sel, useFilterStore.getState().dvFilters[dvId] ?? []);
  // NO spatial on dv path (server 400s on it)
} else {
  const all = useFilterStore.getState().filters[tableId] ?? [];
  filters = resolveFilterSet(filterSelection, all);
  const shapes = resolveSpatialShapes(filterSelection, useSpatialFilterStore.getState().shapes);
  const target = aggregateSpatialTargetsByTable(widgets).get(tableId);       // widgets from useDashboardContext()
  if (shapes.length > 0 && target) {            // orchestrator :540 spatialArgs gate: BOTH or neither
    spatialFilters = shapes.map((s) => ({ id: s.id, wkt: s.wkt }));
    spatialTarget = target;
  }
}
body = {
  widgetId: widget.id,
  filters, ...(spatialFilters && { spatialFilters, spatialTarget }),
  ...(sortField && { sortField, sortDir }),     // RecordsTableRenderer state (WidgetRenderer.tsx:1996-1997)
  options: { gzip, format, name },
};
```

Notes:
- `recordsTableFilters` in `RecordsTableRenderer` (`WidgetRenderer.tsx:1961`) is the UNRESOLVED per-table list; do NOT send it directly, it ignores per-widget `filterSelection` scope. Read at click time via `getState()` (S-02 pattern), not via subscriptions.
- `RecordsTableRenderer` already destructures `useDashboardContext()` (`:1957`); add `widgets` to that destructure.
- Memory "filtering badges read combination store": the table's view name comes from `filterCombinationStore`, but the combination store holds NO filter values (`CombinationEntry` has only viewName/expiresAt/etc., `filterCombinationStore.ts:42-51`). Re-deriving from `filterStore` + the same pure resolvers is the only correct source. A spec must assert that a widget with `filterSelection` allow-list sends only the allowed filters.
- `ActiveFilter` objects are JSON-serialized as-is (a `Date` becomes an ISO string) — identical to `materializeFilter` which already sends them (`client.ts:1012-1018`). Extra keys (`sourceWidgetId`, `operator`) are ignored by the server builders. Cap: 200 filters (`MAX_FILTERS`); `FILTER_CAP_PER_TABLE` in the client is lower, so no clamp needed.
- Sort: always send the current `sortField`/`sortDir` state (initial state already derives from `cfg.sortField`). Send nothing if `sortField` is "" (server falls back to saved config, which is also empty-or-equal).
- A dv-bound widget whose dv is not `materialized` for this user will fail at the snapshot step (source view missing). Guard in the dialog: if `dynamicViewId` set and `recordsDvStatus !== "materialized"`, show an inline `config-hint`/`export-error` "The data view is not ready yet." and disable Start (LOW-risk addition; discretionary copy).

### Pattern 2: Trigger branch (D-01/D-02/D-03) — HIGH
`handleDownloadCsv` is at `WidgetRenderer.tsx:2029`; the footer button at `:2451-2458` (`onClick={handleDownloadCsv}`, `disabled={exporting}`).
- Change ONLY the button's `onClick` to `handleDownloadClick`:
  ```typescript
  const handleDownloadClick = () => {
    if (totalCount === null || totalCount > csvDownloadRowCap) { setExportDialogOpen(true); return; }
    void handleDownloadCsv();
  };
  ```
  `totalCount` is `number | null` (`:2000`); `null` covers loading, failed and `!table` cases (`:2229-2231`). `csvDownloadRowCap` is `:2009`. Keep `handleDownloadCsv` untouched: the dialog's "Download first N rows now" button calls it (after closing the dialog) so the existing "Downloaded the first N of M rows" toast text is preserved.
- Stale-count caveat: while the combination view is materializing, the count effect returns early (`:2243-2244`) and `totalCount` keeps its PREVIOUS value, so Download can pick the wrong branch for a moment. Acceptable (same staleness the readout "of N" has); mention in the dialog only if cheap. Do not try to fix.
- Mount: render `{exportDialogOpen && <ExportDialog .../>}` at the end of `RecordsTableRenderer`'s returned tree (inside the root `<div>`; modal is `position: fixed` overlay). Pass props: `widget`, `totalCount`, `csvDownloadRowCap`, `tableId`, `dynamicViewId`, `buildRequest` (closure using current `sortField`/`sortDir`), `onPartialDownload`, `overrideActive`, `onClose`, `onNavigateExports`.

### Pattern 3: Widget-action override detection (D-04) — HIGH
`WidgetRenderer.tsx:346-349`: `widgetOverlay = useWidgetActionStore((s) => s.widgetOverrides[widget.id] ?? null)`; it is shallow-merged into `config` and `RecordsTableRenderer` receives the MERGED `effectiveWidget` (`:357-358`). Detect inside `RecordsTableRenderer` with the same selector and a primitive result:
```typescript
const overrideActive = useWidgetActionStore((s) => Object.keys(s.widgetOverrides[widget.id] ?? {}).length > 0);
```
(`widget.id` is identical for the merged widget.) **Finding for the planner:** the allow-list for a `records` widget contains only `page_size` (`lib/actionAllowList.ts:117-122`) and the table reads `cfg.pageSize` (camelCase, `:1918`), so today an override can never change exported content (and may not even change the table). D-04's note is still locked and cheap; implement it as specified but do not build logic around it. Note also the export's saved `cfg` is read server-side, so overlay-derived `cfg` values are never sent anyway.

### Pattern 4: Name storage + sanitising (EXPRT-V126-08) — HIGH
**Store in `options_json`** as `name` (string). `startExport` already persists `JSON.stringify(options)` (`exportRunner.ts:240`); `ExportOptions` is `{format?: "raw"; gzip?: boolean}` (`:54`). Changes:
1. `ExportOptions = { format?: "raw" | "formatted"; gzip?: boolean; name?: string }`.
2. Route (`exportRoutes.ts:72-77`): validate `options.name` is a string if present (400 `options.name must be a string.`), `options.format` in `{"raw","formatted"}` (update message `'options.format must be "raw" or "formatted".'`; the existing test at `routes.exports.spec.ts:184` uses `"pretty"`, still invalid). Normalise via `sanitizeExportName` (below) and store the cleaned display name; do NOT reject long names, truncate to 200 code points.
3. `toExportJobDto` adds `name: string | null` parsed from `optionsJson` (same safe-parse as `parseGzip`; generalise into `parseExportOptions(s)`). Old jobs from Phases 128-130 have no name -> `null`; client falls back to `Export <createdAt local>`.
4. `exportDownloadName` signature widens to `Pick<ExportJob,"id"|"createdAt"|"filePath"> & {optionsJson?: string|null}`; existing test `EXPACC129-name` (`lib.exportJobAccess.spec.ts:102`) passes no `optionsJson` and keeps the legacy `export-YYYY-MM-DD-<id8>.csv` default -> stays green.

**Two functions, two jobs** (display name is kept human; filename is made safe at download time):
```typescript
// display name stored + shown in DTO: control chars removed, trimmed, collapsed whitespace, <=200 code points; empty -> undefined (not stored)
export function sanitizeExportName(raw: unknown): string | undefined;
// filename base used by Content-Disposition (without extension): further rules below; empty after rules -> undefined -> legacy default
export function exportFileBase(name: string | undefined): string | undefined;
```
Rules for `exportFileBase` (the extension `.csv`/`.csv.gz` is appended by `exportDownloadName`, chosen from `filePath` as today):
- Unicode NFC normalise.
- Replace `/ \ : * ? " < > |` and ALL control chars (`\u0000-\u001f`, `\u007f`-`\u009f`) with `-`. **Required** because `content-disposition@0.5.4` calls `path.basename()` on the name: verified by execution, `"a/b\\c.csv"` -> `filename="b\\c.csv"` (silently drops `a/`), and a name with NUL/LF yields `filename="a?b?c.csv"; filename*=UTF-8''a%00b%0Ac.csv`.
- Remove bidi/format controls (`‎‏‪-‮⁦-⁩`, `﻿`): RTL-override spoofing of the extension.
- Collapse runs of whitespace to one space; trim spaces AND leading/trailing dots (hidden file / Windows trailing-dot).
- Strip a trailing `.csv` / `.csv.gz` (case-insensitive) once so "report.csv" does not become `report.csv.csv`.
- Cap at 150 code points (leaves room for `.csv.gz`; percent-encoded `filename*` is at most ~9 bytes per code point = ~1.4 KB, far below Node's 16 KB header limit).
- Windows reserved device names (`CON`, `NUL`, `COM1`...): append `_`. Cheap, optional.
- Empty result -> legacy default `export-YYYY-MM-DD-<id8>`.

Non-ASCII verified (executed against the installed content-disposition): `"Résumé – 数据.csv"` -> `attachment; filename="Résumé ? ??.csv"; filename*=UTF-8''R%C3%A9sum%C3%A9%20%E2%80%93%20%E6%95%B0%E6%8D%AE.csv`. `res.download` therefore needs no custom encoding (confirmed also by 129-RESEARCH line 46/209). Quotes and `;` in the name are escaped by the library; they remain in the display name but are not in `/\:*?"<>|`... the quote IS in the replace set, so filenames never contain `"`.

Default name is built CLIENT-side (D-05): `${widget.title.trim() || "Export"} ${YYYY}-${MM}-${DD} ${HH}${mm}` local time, zero-padded. Put it in `lib/exportRequest.ts` as a pure function taking a `Date` (testable with a fixed date).

### Pattern 5: Formatted values (EXPRT-V126-09) — HIGH on storage/semantics, MEDIUM on the port's date/timezone parity
**What "display labels and number formats" means concretely** (verified at `WidgetRenderer.tsx:2386` and `:2438-2440`): table header = `resolveLabel(tableId, col)` (= `label ?? col`); cell = `String(resolveFormatter(tableId, col)(value) ?? "")` where the formatter is `buildFormatter(format_spec)` (identity if no spec). So formatted export = header row of labels + each cell passed through the column's formatter.

**Server storage:** table `column_display_config` (`db.ts:249`), read with `listColumnDisplayConfig(tableId)` (`db.ts:1385`, returns `{column_name,label,format_spec(parsed JSON)}`). Client reads the same via `GET /api/tables/:tableId/column-display-config` (`index.ts:2721`). No server formatter exists; `format_spec` is deliberately opaque server-side (`types.ts:105-108`).

**Port:** copy `packages/web/src/lib/columnFormatter.ts` to `packages/server/src/lib/columnFormatter.ts` keeping `buildFormatter` + `normalizeToMs` + the format-spec types; drop `defaultFormatKind` and the `./columnTypes` import (server rootDir cannot import web). Add `tests/lib.columnFormatter.parity.spec.ts` modelled on `tests/lib.csvExport.parity.spec.ts` (imports `../../web/src/lib/columnFormatter` and the server copy; runs one vector table through both: number/currency/percent/d3/si/date presets/custom/none, null, NaN-string, negative numbers, epoch-seconds vs ms, ISO string). Date formatting is hand-rolled UTC, no timezone dependency, so parity is exact.

**Apply in the runner's seam** (`exportRunner.ts:51-54` comment; `run()` `:321-347`). Keep TWO header arrays: `header` (real names, used by `buildBatchRequest` ORDER BY tie-break `exportSql.ts:218`) and `outHeader` (labels) passed to `writeCsv`. Wrap rows after `transpose`:
```typescript
// inside run(), after `header` is resolved (plan.columns or probe)
const fmt = options.format === "formatted" ? await loadFormatPlan(plan, header) : null; // sync read of listColumnDisplayConfig
const outHeader = fmt ? header.map((c, j) => fmt.labels[j]) : header;
async function* batches() { ... const rows = transpose(r); offset += rows.length;
  yield fmt ? rows.map((row) => row.map((v, j) => fmt.fns[j](v))) : rows; ... }
const written = await writeCsv(batches(), outHeader, ...);
```
- `tableId` = `getWidget(plan.widgetId)?.config.tableId` when `typeof === "number"`. This mirrors the web exactly (it keys on `cfg.tableId`, `WidgetRenderer.tsx:1966`/`:2438`), regardless of whether the widget is also dv-bound. If absent -> `fmt = null` (raw fallback). Load once at run start (a config edit mid-run is not applied, consistent with the snapshot).
- Build per-column functions once: `fns[j] = buildFormatter(cfgByName[header[j]]?.format_spec)`, `labels[j] = cfgByName[header[j]]?.label ?? header[j]`. `buildFormatter` never throws; guard `format_spec` with try/catch anyway (opaque JSON from DB).
- **Formula-injection guard MUST still apply:** formatted values still go through `csvLine` -> `escapeCsvField` (`csvExport.ts:20-24`), including the header labels. Effects, verified: `d3-format` renders negatives with U+2212 (`"−1,234.50"`, executed in `packages/web`), which is NOT in `CSV_FORMULA_LEAD_RE`, so formatted negatives are not prefixed with `'`. But a formatted string that is not "strictly numeric" and starts with `= + - @ TAB CR` WILL get a leading `'` (e.g. a custom currency symbol `+`, a label `=Total`, or an ASCII `-` produced by a `d3` spec using `.minus`). That is the intended behaviour (OWASP); do NOT bypass `csvLine`/add a formatted-mode exemption. Document in the dialog? No; but unit-test it (a label starting with `=` is exported as `'=...`).
- **Quirk to document, not fix:** formatted numeric cells become STRINGS like `1,234.50` or `$5.00` (not numeric for Excel). A comma inside forces RFC-4180 quoting, handled by `escapeCsvField`.
- Size cap/row count unaffected (rows count unchanged). `byteCap` counts post-format bytes, fine.
- Formatting cost: one closure call per cell; 10M rows x ~10 cols is ~1e8 d3 calls. d3-format is fast but measure in the live smoke (a formatted export of >=1M rows should be timed against raw). Flag as the one performance risk (MEDIUM).

**dv-bound widget fallback (no `tableId`):** server falls back to raw silently (defence). Client should DISABLE the "Formatted values" radio when `tableId === undefined` and show a `config-hint` under it: "Not available for this widget: it has no dataset with column formats." (discretionary copy, not in UI-SPEC; satisfies "fall back to raw and say so" without a post-hoc surprise). Default is raw, so no state is lost.

### Pattern 6: Toast action (UI-SPEC) — HIGH
Current API: `showToast(message, kind = "info")` with a hard 5000 ms timeout and a 5 s `kind::message` dedup window (`store/toast.ts:12-33`); `Toast.tsx` renders `toast-message` + `toast-dismiss` only. Minimal change:
```typescript
export type ToastAction = { label: string; onClick: () => void };
export type Toast = { id: number; message: string; kind: ToastKind; action?: ToastAction };
showToast: (message: string, kind?: ToastKind, action?: ToastAction) => void;
// lifetime: const ttl = action ? 15000 : 5000;  and add `action` to the toast object.
```
Render in `Toast.tsx` between `toast-message` and `toast-dismiss`: `{t.action && <button type="button" className="ghost-sm" onClick={() => { t.action!.onClick(); dismiss(t.id); }}>{t.action.label}</button>}`. Existing callers pass two args; `useToastStore.setState({ showToast: mock })` patterns in specs stay valid. Dedup key stays `kind::message`; two different exports with the same name within 5 s would be suppressed — include nothing extra (names carry a timestamp by default).
Existing `.toast` has `max-width: 360px` and `align-items:center` flex, so a `ghost-sm` fits; verify visually (dark + light) in the checkpoint. Note `toast-error`/`toast-permission` borders use `rgba()` already (pre-existing; theme-guard doesn't flag).

### Pattern 7: Tracker / polling design (D-10..D-13) — HIGH
UI-SPEC requires a module-level tracker (a dialog that closes, or navigation to the Exports page, unmounts `RecordsTableRenderer`).
- `store/exportTracker.ts`: a zustand store `{ jobs: Record<string, ExportJobDto & {name}> , dialogJobId: string|null }` plus module-private `timers: Map<id, timeout>`. API: `trackExport(dto)`, `untrackExport(id)`, `stopAllExportTracking()`, `setDialogJob(id|null)`. Use a `setTimeout` chain (schedule the next poll only after the previous `fetch` settles), NOT `setInterval`, so slow responses never overlap. Interval constant `EXPORT_POLL_MS = 5000` exported for tests.
- On each poll result: update store; if status terminal -> clear timer, remove tracking, and if `dialogJobId !== id` fire the toast (`complete`: `Export "<name>" is ready` kind `info` + action `Download`; `failed`/`session_expired`: `errorMessage` verbatim kind `error`; `cancelled`: none). If the dialog is open for that id, the dialog renders the terminal state itself (no toast).
- Errors: 404 -> untrack silently (deleted from the Exports page); 401 -> stop (apiFetch dispatches `UNAUTHORIZED_EVENT` on REAUTH); network error -> keep polling (next tick), no toast spam.
- `stopAllExportTracking()` MUST be called in the `status === "unauthenticated"` effect in `App.tsx` (`:245`, the canonical logout cleanup block) so no timer outlives the session. Add a one-line comment there.
- zustand mock (`vi.mock("zustand")`) resets the store between tests but NOT module timers: tests must call `stopAllExportTracking()` in `afterEach`.
- Exports page: separate hook `useExportsList` (own `setTimeout` chain, only while the loaded list has a queued/running row, cleared on unmount, first-load `loading` only, later polls update in place). Do NOT use `useApiQuery` for polling: its `refetch` sets `loading=true` (flash, `hooks/useApiQuery.ts:25-28`). Page and tracker may both poll the same running job; bounded by the concurrency cap (default 2), acceptable.
- Fake-timer pitfalls (memory + `src/test/setup.ts:62-66`): the global `afterEach` already does `vi.useRealTimers()`; still set `vi.useFakeTimers()` inside each `beforeEach`/test, never at file scope. With RTL + fake timers use `await act(async () => { await vi.advanceTimersByTimeAsync(5000); })`; do not combine `waitFor` (needs real timers) with fake timers — assert after `advanceTimersByTimeAsync`. `configure({ asyncUtilTimeout: 5000 })` is global.

### Pattern 8: Download mechanics (item 8) — HIGH on auth, recommendation on UX
- **Auth:** session cookie `kbi_session` is `httpOnly`, `sameSite: "lax"`, `secure` only in production, `path: "/"` (`auth.ts:104-110`). Dev: web `localhost:5173`, API `http://localhost:4000` (`client.ts:8`; `vite.config.ts` has NO proxy). Ports do not change "site", so a top-level GET navigation to `http://localhost:4000/api/exports/:id/download` sends the cookie (and Lax permits cross-site top-level GETs anyway). Prod: SPA built with `VITE_API_URL=""` (`Dockerfile:9`) and nginx proxies `/api/` same-origin. The server route is behind `app.use("/api", requireAuth)` (`index.ts:678`). So a navigation download IS authenticated in dev and prod. (MEDIUM-HIGH: derived from cookie attributes + browser SameSite rules; confirm in the live checkpoint with a real browser.)
- **UI-SPEC correction:** the href/URL MUST be `${API_BASE}/api/exports/${id}/download`. A bare `/api/...` resolves against the Vite origin in dev and returns `index.html` (same bug the branding logo hit, `client.ts:11-17`). Add `exportDownloadUrl(id)` to `api/client.ts`.
- **Error pages:** a successful response is `Content-Disposition: attachment` (page stays put), but 401/404/409/410/416 are JSON bodies that a navigation would RENDER, replacing the SPA. Recommended `startExportDownload(id)` in `lib/exportDownload.ts`:
  1. `const r = await apiFetch(url, { headers: { Range: "bytes=0-0" } })` (server supports Range, `exportRoutes.ts:152` via send; `bytes=0-0` is a CORS-safelisted Range value so no extra preflight in dev). Read nothing; `r.body?.cancel()`.
  2. `r.status === 206 || r.ok` -> `window.location.assign(url)`; otherwise `showToast(<server error text from JSON>, "error")` and trigger a list refresh (the file may be expired). 401 flows through `apiFetch`'s REAUTH event.
  Cost: one 1-byte request. Alternative (hidden iframe) hides failures silently; rejected. If the planner prefers zero extra requests, the minimum is gating the button on `expiresAt > now` and accepting the rare JSON-page navigation (not recommended).
  Wrap `window.location.assign` inside `lib/exportDownload.ts` and `vi.mock` that module in component specs (jsdom's `window.location.assign` is not spy-able).
- Download controls are `<button>`s per UI-SPEC acceptance anchors (not `<a>`).

### Pattern 9: Exports page + nav (item 7) — HIGH
- `App.tsx`: `type Page` at `:34`; add `"exports"`. THREE places must be updated, one is easy to miss: the page render switch (`:639-647`), the ReturnTo whitelist (`:418-427`; add `parsed.page === "exports"` or an OIDC re-auth sends the user to dashboards), and nothing in URL sync (Page is not URL-addressed; only `?dashboard=`/`?table=` are). The "datasets"-only guards at `:108`, `:350-357`, `:446` need no change. Sidebar: `nav` array `Sidebar.tsx:23-30`; insert `{ label: "Exports", key: "exports", icon: faDownload }` right after Datasets, with no `permission` field; add `faDownload` to the import block (`:3-12`). The `onSelect` handler (`App.tsx:603-612`) does `setPage(key as Page)` so no change.
- **Navigation from the dialog ("See all exports") has no existing mechanism:** `RecordsTableRenderer` is deep in `DashboardsPage`; `setPage` lives in App. Precedent for cross-tree signalling is `window.dispatchEvent(new CustomEvent(...))` (`client.ts:22`, `App.tsx:405`). Recommended: export `NAVIGATE_EXPORTS_EVENT = "kbi:navigate-exports"` from `api/client.ts` (or `lib/exportNav.ts`), dispatch from the dialog, and add an `App.tsx` `useEffect` listener that calls `setPage("exports"); setDashboardViewMode("list")`. Respect the branding leave-guard (`App.tsx:605-609`) by routing through the same `onSelect` path if cheap; otherwise note: the guard only matters when `page === "branding"`, which cannot be the source (the dialog lives on dashboards).
- Page mirrors `DatasetsPage.tsx:187-243` exactly (see UI-SPEC). **Gap in D-15/UI-SPEC "dashboard · widget" line:** the DTO has only `widgetId`/`dashboardId` (`exportJobAccess.ts:24-38`). Resolve names on the SERVER in `toExportJobDto`: `getWidget(job.widgetId)?.title`, `getDashboard(job.dashboardId)?.name` (both are sync SQLite point lookups, null-safe because exports outlive deleted widgets, no FK). Add DTO fields `dashboardName: string|null`, `widgetTitle: string|null`. This changes `EXPACC129-dto-keys` (`lib.exportJobAccess.spec.ts:84-95`, exact key list) — update it to the new sorted list (`name`, `dashboardName`, `widgetTitle` added) in the same commit. Client renders "{dashboardName ?? "Deleted dashboard"} · {widgetTitle ?? "Deleted widget"}".
- Client helpers in `api/client.ts` (all via `apiFetch` + `throwForStatus`, following `listColumnDisplayConfig` at `:1689`): `startExport(body)`, `getExportJob(id)`, `listExportJobs()`, `cancelExportJob(id)`, `deleteExportJob(id)` (204 -> no JSON), `exportDownloadUrl(id)`. `startExport` must preserve `code` for the 429: `throwForStatus` throws a plain `Error(message)`, which is sufficient because the dialog shows `error.message` verbatim (D-09); no code branching needed. Types: mirror `ExportJobDto` (+ the three new fields).
- Cancel on a job that just finished returns 409 `{error:"Export is not running.", status}`: treat as "refresh", not as an error.

### Anti-Patterns to Avoid
- **Sending `recordsTableFilters` or the combo view name** as the export filter source (ignores `filterSelection`, view names are per-user materializations). Derive via the resolvers.
- **`useApiQuery` for polling** (flashes the loading state).
- **`setInterval` for polling** (overlapping requests when slow).
- **Bypassing `csvLine` for formatted values** (loses the formula guard).
- **Inventing CSS classes**: UI-SPEC adds exactly four; verify with a class-token script (UI-SPEC acceptance anchor) since nothing else catches undefined classes (CLAUDE.md, memory css-bugs-evade-tests).
- **Hardcoded hex/rgba** in new CSS (`color-mix` with tokens only, as UI-SPEC does).
- **Reading `track_config`-style fields off the wrong object**: not relevant here; but do read `tableId` from `cfg` (merged config) like the table does.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Non-ASCII `Content-Disposition` | custom `filename*` encoder | `res.download(path, name)` (content-disposition 0.5.4) | Verified by execution; handles quotes/CRLF; only basename + control-char cleanup is ours |
| Range/resume/If-Range | custom byte serving | existing route (`send@0.19.2`) | Phase 129 verified (R4 206, sha256 match) |
| Number/date formatting | new formatter | port of `columnFormatter.ts` + `d3-format` | Output must equal what the table shows |
| CSV escaping + formula guard | per-mode escaping | `csvLine`/`escapeCsvField` | Parity-tested with web (`CSVPARITY-*`) |
| Filter resolution | re-implementing scope rules | `resolveFilterSet`, `resolveSpatialShapes`, `aggregateSpatialTargetsByTable` | Same functions the orchestrator uses; any re-implementation drifts |
| Modal | new overlay system | `modal-overlay`/`modal-content`/... + Escape listener pattern from `ColumnFormatEditorModal.tsx:152-159` | UI-SPEC locked |
| Page table | new grid | `datasets-table`/`ds-header`/`ds-row` + `exports-table` override | UI-SPEC locked |

**Key insight:** every hard part of this phase is "make the client/server agree with something that already exists" (table content, table formatting, CSV bytes, download resume). Reuse the existing pure resolvers/formatters and add parity specs rather than new logic.

## Common Pitfalls

### Pitfall 1: Six existing WidgetRenderer specs change behaviour (D-01/D-03)
**What goes wrong:** `WidgetRenderer.spec.tsx` tests click `screen.getByText("Download")` right after the button appears, before the count resolves (`totalCount === null`) — D-03 now opens the dialog. Verified locations: `:2607-2610` ("export issues SELECT..."), `:2648-2650` (`rlcsvSetup`, used by RLCSV-*), `:2709-2711` (RLCSV-progress), `:2811-2815` (abort-on-unmount). Additionally `RLCSV-ceiling-clamp` (cap 3, count 10) and `RLCSV-cap-message` (cap 2, count 10) have `totalCount > cap` and now open the dialog instead of downloading.
**How to avoid:** in the planner's test task, first `await waitFor(() => screen.getByText(/of \d+/))` (the `Showing 1–N of M` readout) before clicking Download; rewrite the two over-cap tests to click Download -> dialog -> "Download first N rows now" and keep their toast assertions (`"Downloaded the first 3 of 10 rows"`). Run `npx vitest run src/components/charts/WidgetRenderer.spec.tsx` after the trigger change BEFORE building the dialog to see exactly which fail.
**Warning signs:** "Unable to find text Download" or unexpected `role="dialog"`.

### Pitfall 2: Production `npm ci` fails if the server lockfile isn't updated
Adding `d3-format` to `packages/server/package.json` without `package-lock.json` regenerated breaks the Docker `proddeps` stage (`Dockerfile:16-19`). Commit the lockfile with the dependency. Verify with `npm ci --dry-run` or `npm ls d3-format -w @kinetica-bi/server`.

### Pitfall 3: Navigation download replaces the SPA on error
See Pattern 8. Test: preflight returns 410 -> toast, no `location.assign`.

### Pitfall 4: `content-disposition` takes `basename`
A name like `Q1/Q2 report` downloads as `Q2 report.csv`. Sanitise `/`, `\` BEFORE `res.download`; unit-test with path separators (executed check: `"a/b\\c.csv"` -> `b\\c.csv`).

### Pitfall 5: Spatial filters/target "together or neither"
Send `spatialFilters` without `spatialTarget` (or vice-versa) -> 400 `invalid_filter`. Replicate the orchestrator's gate (`shapes.length > 0 && target`) and never send spatial for dv-bound widgets.

### Pitfall 6: dv precedence mismatch
Server checks `cfg.dynamicViewId` first; if the client took the table path for a widget that has both, filters would come from the wrong store. Mirror server precedence.

### Pitfall 7: Zustand mock does not clear module timers
Tracker/list hook timers survive between tests -> cross-test polling noise. `stopAllExportTracking()` in `afterEach`; also pair with the existing global `vi.useRealTimers()`.

### Pitfall 8: Cancel is eventually consistent
`cancelExport` aborts and the run finalizes `cancelled` in its catch (`exportRunner.ts:360`); an in-flight Kinetica call can delay it (up to the fetch timeout, per STATE.md accepted trade-off). The cancel route returns the DTO with status still `running`. UI must show "Cancelling…" until the poll reports `cancelled` (UI-SPEC), and Cancel must not be re-enabled meanwhile.

### Pitfall 9: ReturnTo whitelist
Forgetting `"exports"` in the OIDC ReturnTo allow-list (`App.tsx:418-427`) silently dumps the user on Dashboards after re-auth.

### Pitfall 10: Name in `options_json` is user text in a JSON blob
Safe (JSON.stringify) but `toExportJobDto` must keep returning only `name`, never raw `optionsJson`. The privacy spec asserts no `sid`/spec/path leak (`EXPACC129-dto-keys`).

### Pitfall 11: Limits hint always has "n at a time"
`maxConcurrentPerUser` defaults to 2 (never null, `exportLimits.ts:5`), so the hint line always renders; "omit entirely if no cap is set" in UI-SPEC effectively never triggers. Fine; spec the line for `{maxRows:null,maxFileMb:null,maxConcurrentPerUser:2}` -> "Limits: 2 at a time".

### Pitfall 12: Count is a stale/best-effort number
`totalCount > maxRows` disables Start (D-08) but the server re-checks against the real snapshot COUNT (`exportRunner.ts:319`) and fails the job with `row_cap`; both paths show the same text. Do not treat the client check as authoritative.

## Code Examples

### Server: formatted plan helper (sketch)
```typescript
// exportRunner.ts — Source: web WidgetRenderer.tsx:2386,2438-2440 semantics; db.ts:1385 listColumnDisplayConfig
import { listColumnDisplayConfig } from "../db";
import { buildFormatter } from "./columnFormatter";

function loadFormatPlan(widgetId: number, header: string[]) {
  const tableId = getWidget(widgetId)?.config?.tableId;
  if (typeof tableId !== "number") return null;           // dv-bound / no dataset: raw fallback
  const byName = new Map(listColumnDisplayConfig(tableId).map((r) => [r.column_name, r]));
  return {
    labels: header.map((c) => byName.get(c)?.label ?? c),
    fns: header.map((c) => { try { return buildFormatter(byName.get(c)?.format_spec as never); } catch { return (v: unknown) => v; } }),
  };
}
```

### Server: DTO additions (sketch)
```typescript
// exportJobAccess.ts
const parseOptions = (s: string | null): { gzip?: boolean; format?: string; name?: string } => {
  try { const o = JSON.parse(s ?? "{}"); return o && typeof o === "object" ? o : {}; } catch { return {}; }
};
// toExportJobDto: name: typeof o.name === "string" && o.name ? o.name : null,
//   dashboardName: job.dashboardId == null ? null : getDashboard(job.dashboardId)?.name ?? null,
//   widgetTitle:   job.widgetId == null ? null : getWidget(job.widgetId)?.title ?? null,
export const exportDownloadName = (job: Pick<ExportJob, "id"|"createdAt"|"filePath"> & { optionsJson?: string|null }): string => {
  const ext = job.filePath?.endsWith(".csv.gz") ? ".csv.gz" : ".csv";
  const base = exportFileBase(parseOptions(job.optionsJson ?? null).name) ?? `export-${job.createdAt.slice(0, 10)}-${job.id.slice(0, 8)}`;
  return base + ext;
};
```
Route call site is `exportRoutes.ts:152`: `exportDownloadName(job)` already passes the full `ExportJob`, so no route change is needed for the seam.

### Client: relative expiry (UI-SPEC table)
```typescript
export const relativeExpiry = (expiresAt: string | null, now = Date.now()): string => {
  if (!expiresAt) return "—";
  const ms = Date.parse(expiresAt) - now;
  if (ms <= 0) return "Expired";
  const min = Math.floor(ms / 60000), h = Math.floor(ms / 3600000), d = Math.floor(ms / 86400000);
  return d >= 1 ? `in ${d} d` : h >= 1 ? `in ${h} h` : min >= 1 ? `in ${min} min` : "in under 1 min";
};
```

### Client: limits hint (mirrors `exportCaps.ts:formatExportSizeLimit`)
```typescript
const size = (mb: number) => (mb % 1024 === 0 ? `${mb / 1024} GB` : `${mb.toLocaleString("en-US")} MB`);
// parts: maxRows ? `${maxRows.toLocaleString()} rows`, maxFileMb ? size(maxFileMb), `${n} at a time`; join " · "; prefix "Limits: "
// Row-cap message: copy template EXACTLY from exportCaps.ts:rowCapMessage:
// `This export has ${total.toLocaleString("en-US")} rows; the limit is ${cap.toLocaleString("en-US")}. Add filters to narrow it down and try again.`
```
Use `"en-US"` explicitly for the row-cap message so the client string equals the server's `formatExportCount` (`toLocaleString("en-US")`); UI-SPEC says bare `toLocaleString()`, which varies by browser locale. Recommend `en-US` for the message and limits hint, locale default elsewhere.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| In-browser CSV of up to the cap | Background server job + resumable download | v1.26 (Phases 128-130) | This phase adds the UI over it |
| `dashboardExport.ts` ASCII slug filename | `res.download` RFC 5987 | Phase 129 | Name seam is just the `name` arg |

**Deprecated/outdated:** none relevant.

## Open Questions

1. **Does `exportDownloadName`'s legacy default still apply when no name is stored?**
   - Known: old jobs have no name; the existing spec asserts the legacy default.
   - Recommendation: keep legacy default for null/empty names (as sketched). Client falls back to "Export <local date>" for display.

2. **Is there a >=1M-row table for the live checkpoint?**
   - Known: Phase 128-130 smokes used `demo.nyctaxi` at 500k rows (STATE.md).
   - Unclear: whether a >=1M table exists. Recommendation: operator names one; else create a scratch table (see Live Checkpoint) with `UNION ALL` of nyctaxi (LOW confidence that Kinetica accepts it in a CTAS on this instance; operator to confirm syntax).

3. **D-04 note vs reality:** records overrides are limited to `page_size`, so the note will rarely/never show meaningful info. Locked decision; implement cheaply. Planner may mention this in the plan so the verifier does not demand a live repro of an override affecting content.

4. **Dashboard/widget names in the DTO** (D-15) required an unplanned server change; resolved above (server-side lookup). If the planner prefers not to change the DTO key set, the alternative is client-side lookup from a dashboards list, which would need an extra fetch and does not work for deleted widgets. Recommendation stays server-side.

5. **Formatted-export throughput** at 10M rows is unmeasured. Measure during the live checkpoint; if slow, precompute per-column fast paths (skip identity columns by checking `format_spec == null || kind === "none"`, which the sketch should do: do not call `buildFormatter` for those columns at all).

## Validation Architecture

> `.planning/config.json` has `workflow.nyquist_validation: false`; this section is included only because the orchestrator requested a test strategy explicitly.

### Test Framework
| Property | Value |
|----------|-------|
| Web | vitest + jsdom + RTL, `packages/web/vitest.config.ts`, setup `src/test/setup.ts` (zustand auto-reset mock, global `vi.useRealTimers()` afterEach) |
| Server | vitest, set-based gate `packages/server/scripts/test-gate.mjs`; route specs use `buildTestApp` + stubbed global `fetch` (`tests/routes.exports.spec.ts:46-79`) |
| Quick run (web) | `cd packages/web && npx vitest run src/components/ExportDialog.spec.tsx src/components/ExportsPage.spec.tsx src/store/exportTracker.spec.ts src/lib/exportRequest.spec.ts` |
| Quick run (server) | `cd packages/server && npx vitest run tests/routes.exports.spec.ts tests/lib.exportJobAccess.spec.ts tests/lib.columnFormatter.parity.spec.ts tests/lib.exportRunner.spec.ts` |
| Full suite | web: `npx tsc --noEmit && npx vitest run && npx vitest run src/styles/theme-guard.spec.ts`; server: `npx tsc --noEmit && npm run test:gate` |

### Phase Requirements -> Test Map
| Req | Behavior | Type | Automated command / spec | Exists? |
|-----|----------|------|--------------------------|---------|
| -05 | Request body equals table content: scoped filters, spatial together-or-neither, dv no spatial, sort | unit | `src/lib/exportRequest.spec.ts` (EXPREQ-*) | Wave 0 |
| -06 | Trigger: count<=cap in-browser; count>cap or null -> dialog; partial button runs `handleDownloadCsv` | component | `WidgetRenderer.spec.tsx` (edit 6 tests + add EXPTRIG-*) | exists, edit |
| -06 | Dialog form/progress/terminal states; over maxRows disables Start; 429 verbatim, stays open | component | `src/components/ExportDialog.spec.tsx` | Wave 0 |
| -07 | Poll 5 s, stops on terminal/untrack/logout; toast only when dialog closed | unit (fake timers) | `src/store/exportTracker.spec.ts` | Wave 0 |
| -07 | Toast action renders, calls handler, 15 s lifetime | unit/component | `src/store/toast.spec.ts` (new) + `Toast` render test | Wave 0 |
| -08 | name sanitising (separators, control, bidi, length, empty, `.csv` suffix); non-ASCII `filename*`; stored in options; DTO `name` | unit + route | `tests/lib.exportJobAccess.spec.ts` (edit `dto-keys`, add EXPNAME-*), `tests/routes.exports.spec.ts` (download header) | exists, edit |
| -09 | formatted header labels + cell formats; guard still applies; dv/no-tableId raw; route accepts `formatted` | unit + route | `tests/lib.exportRunner.spec.ts` (EXPFMT-*), `tests/lib.columnFormatter.parity.spec.ts`, `routes.exports.spec.ts` | Wave 0 / edit |
| -10 | gzip checkbox sends `options.gzip` | component | `ExportDialog.spec.tsx` | Wave 0 |
| -12 | Page: states, actions per status, delete confirm, polling only with active rows, newest first | component | `src/components/ExportsPage.spec.tsx` | Wave 0 |
| -12 | Nav: Exports item after Datasets, no permission; page renders; ReturnTo accepts "exports" | component | `Sidebar.spec.tsx`/`App` spec (edit) | check existing |
| -12 | Download: preflight 206 -> `assign`; 410 -> toast, no assign | unit | `src/lib/exportDownload.spec.ts` | Wave 0 |
| UI | class tokens exist in global.css | script | class-token check (UI-SPEC acceptance anchor) | Wave 0 |
| UI | light/dark, layout, focus return, toast legibility, button heights | manual | `checkpoint:human-verify` | n/a |

### Grep anchors verified to read 0 TODAY (CLAUDE.md rule; re-run before writing the criterion)
| Anchor | Today |
|--------|-------|
| `grep -c "action" packages/web/src/store/toast.ts` | 0 |
| `grep -c '"exports"' packages/web/src/App.tsx` | 0 |
| `grep -c "Exports" packages/web/src/components/Sidebar.tsx` | 0 |
| `grep -c "api/exports" packages/web/src/api/client.ts` | 0 |
| `grep -c "d3-format" packages/server/package.json` | 0 |
| `grep -c 'format === "formatted"' packages/server/src/lib/exportRunner.ts` | 0 (NOTE: bare `"formatted"` reads 1 today in a comment; do NOT use it) |
| `grep -c "ExportDialog" packages/web/src/components/charts/WidgetRenderer.tsx` | 0 |
| `grep -c "export-progress-fill\|exports-table" packages/web/src/styles/global.css` | 0 (UI-SPEC anchors) |
| `grep -c "faDownload" packages/web/src/components/Sidebar.tsx` | 0 |
| `grep -c "options.name\|rawOpts.name" packages/server/src/exportRoutes.ts` | 0 |
New files that do not exist yet (use `test -f` as a before/after check): `ExportDialog.tsx`, `ExportsPage.tsx`, `store/exportTracker.ts`, `lib/exportRequest.ts`, `lib/exportDownload.ts`, server `lib/columnFormatter.ts`, `lib/exportName.ts`.
Prefer asserting NEW symbols (`sanitizeExportName`, `startExportDownload`, `EXPORT_POLL_MS`, `stopAllExportTracking`) over incidental text. Mutation probes in the Phase 129/130 style are recommended for: name sanitising (remove `/` replacement -> test red), formula guard in formatted mode (route via raw `join(",")` -> test red), `filterSelection` scoping (send unresolved filters -> test red), trigger null-branch (`totalCount === null` removed -> test red).

### Sampling Rate
- **Per task commit:** the quick-run command for the touched side.
- **Per wave merge:** web `tsc` + full `vitest run` + theme-guard; server `tsc` + `test:gate` (SET-BASED: failing files must be a subset of the known `TD-V16-TEST-ISOLATION` set).
- **Phase gate:** all green, then the live checkpoint.

### Wave 0 Gaps
- [ ] `src/lib/exportRequest.spec.ts`, `src/lib/exportDownload.spec.ts`, `src/store/exportTracker.spec.ts`, `src/components/ExportDialog.spec.tsx`, `src/components/ExportsPage.spec.tsx`, toast spec — all new.
- [ ] Server: `tests/lib.columnFormatter.parity.spec.ts` (new), EXPNAME/EXPFMT cases added to existing specs, `EXPACC129-dto-keys` updated.
- [ ] Server `d3-format` dependency + lockfile.
- [ ] Reminder (memory "Dev .env leaks into server vitest"): server specs read `packages/server/.env`; if a new spec depends on `EXPORT_*` env values, set/unset explicitly in `beforeEach`.

## Live Checkpoint Procedure (ROADMAP criterion 5) — proposed

**Environments.** Use TWO setups. (A) Local dev (`npm run dev:server` :4000 + `npm run dev` :5173, `packages/server/.env` KINETICA_URL set) for UI, light/dark, cancel, logout, restart, snapshot isolation. (B) The compose deploy at `http://localhost:8080` (`local-deploy/docker-compose.yml`: nginx :8080 -> 127.0.0.1:4000, same netns; images built from this branch via `./local-deploy/save-images.sh`/docker build) ONLY for the proxy-path resume debt (STATE.md open debt #1), since dev has no proxy. Note `local-deploy/` is git-excluded (memory) — do not recreate it.

1. **>=1M-row export completes & downloads (dev).** Needs a >=1M-row table (Open Question 2). Start export (raw, no gzip) from a records widget; watch progress readout update every ~5 s; on complete click Download; verify `wc -l` = rows+1 (header) and the dialog's "{n} rows · {size}" matches; `sha256` of file stable on re-download. Repeat once with gzip (`gunzip -t`) and once Formatted (header shows labels; a currency column shows `$`).
2. **Name + non-ASCII (dev).** Name `Résumé – 数据 / Q1` -> downloaded filename is `Résumé – 数据 - Q1.csv` (browser-dependent display), not truncated at `/`.
3. **Cancel (dev).** Start, Cancel export in the dialog, wait for "Export cancelled."; confirm `ls $EXPORT_DIR` (default `packages/server/data/exports`) has no `<id>.csv*` or `.part` for that id and the Exports page shows Cancelled with only Delete. Check Kinetica for no leftover `_kbi_exp_<id8>`.
4. **Killed-connection resume.** (B) `curl -c jar -H 'Content-Type: application/json' -d '{"username":..,"password":..}' http://localhost:8080/api/auth/login`; `curl -b jar --limit-rate 2M -o out.csv -H 'Accept-Encoding: gzip' http://localhost:8080/api/exports/<id>/download`, Ctrl-C mid-way, `curl -b jar -C - -o out.csv ...` -> expect 206 and final `sha256` equal to the full download. Also in a browser (Chrome download panel: pause/kill network/resume) in (A). This closes proxy debt #1.
5. **Logout mid-export (dev).** Start a long export, log out (the tracker must stop; check no further `GET /api/exports/<id>` in the Network tab), log back in, Exports page shows `Session ended` with the server's verbatim message, no file on disk, no `_kbi_exp_*` left.
6. **Server restart mid-export (dev).** Start long export, `kill -9` the server process, restart, reload app -> job shows `Failed` + "Export stopped: the server restarted. Start it again."; no `.part`/orphan csv in `EXPORT_DIR`.
7. **Light/dark.** Toggle theme with the dialog (form + progress + terminal), Exports page (all status labels), toast with the Download action open; check progress bar track/fill visibility, `export-error` contrast, `ghost-sm` vs `btn-primary btn-sm` same height in the same `ds-actions` row, table at 1280 px, focus returns to the footer Download button on close.
8. **Cap/limit surfaces (optional, quick):** set `EXPORT_MAX_ROWS=1000` in `.env`, restart, open the dialog on a larger table: hint shows `Limits: 1,000 rows · 2 at a time`, over-cap message visible, Start disabled. Remove after. (`EXPORT_MAX_CONCURRENT_PER_USER` default 2: start 3 quickly -> third shows the 429 text inline.)
9. **Snapshot isolation (needs a writable scratch table; operator consent required, executor never runs DDL/DML itself).** Proposed, to be shown to the operator for approval statement by statement:
   - Choose a scratch schema the operator owns (e.g. `kbi_scratch`; `CREATE SCHEMA IF NOT EXISTS kbi_scratch`).
   - `CREATE TABLE kbi_scratch.exp_iso AS SELECT * FROM demo.nyctaxi` (500k rows ~= 10 s at the measured ~49k rows/s, a workable mutation window; for a longer window add a `UNION ALL` copy). Register it in Datasets (Add dataset) and add a records widget on a throwaway dashboard.
   - Record `SELECT COUNT(*) FROM kbi_scratch.exp_iso` = N0. Start the export; as soon as progress > 0, run in the operator's own SQL client: `DELETE FROM kbi_scratch.exp_iso WHERE <predicate matching ~1000 rows>` and `INSERT INTO kbi_scratch.exp_iso SELECT * FROM kbi_scratch.exp_iso LIMIT 1000`.
   - Expect: job `total_rows` = N0, `rows_written` = N0, CSV has N0 data rows and equals the pre-mutation content (spot-check a deleted row IS present and an inserted duplicate is NOT extra).
   - Cleanup (also operator-approved): `DROP TABLE kbi_scratch.exp_iso`, `DROP SCHEMA kbi_scratch`, delete the dataset registration, the widget and dashboard, delete the export from the Exports page; confirm no `_kbi_exp_*` objects remain. If the operator lacks CREATE TABLE/CREATE MATERIALIZED VIEW rights, record that and mark the item blocked rather than substituting.
10. Report results as a PASS/FAIL table (like `130-06-SUMMARY.md` R1-R10); anything unexercised is written down as debt, not assumed.

## Sources

### Primary (HIGH confidence — repo source, executed checks)
- `packages/server/src/exportRoutes.ts`, `lib/exportSql.ts`, `lib/exportRunner.ts`, `lib/exportJobAccess.ts`, `lib/exportCaps.ts`, `lib/csvExport.ts`, `db.ts` (export_jobs, column_display_config), `auth.ts:97-111` (cookie attrs), `index.ts:678,2721`
- `packages/web/src/components/charts/WidgetRenderer.tsx` (`:346-358`, `:1908-2125`, `:2225-2260`, `:2380-2490`), `hooks/useCombinationOrchestrator.ts`, `lib/resolveFilterSet.ts`, `lib/resolveSpatialShapes.ts`, `lib/spatialTargets.ts`, `lib/columnFormatter.ts`, `store/{toast,columnDisplayConfigStore,filterCombinationStore,widgetActionStore,auth}.ts`, `lib/actionAllowList.ts`, `api/client.ts`, `App.tsx`, `Sidebar.tsx`, `Toast.tsx`, `DatasetsPage.tsx`, `Dockerfile`, `docker/nginx.conf`, `local-deploy/docker-compose.yml`
- Executed locally: `content-disposition` behaviour (non-ASCII, basename, control chars); `d3-format` minus sign U+2212; `faDownload` exists; `npm view d3-format version` = 3.1.2
- `.planning/phases/129-.../129-RESEARCH.md` (res.download, Range), `130-06-SUMMARY.md` (smoke procedure style)

### Secondary (MEDIUM)
- SameSite/top-level-navigation cookie behaviour derived from cookie attributes + standard browser rules (not exercised live; confirm in checkpoint)

### Tertiary (LOW)
- Kinetica CTAS with `UNION ALL` for building a >=1M scratch table (unverified on this instance)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new client deps; one server dep verified against the registry and lockfile mechanics
- Architecture: HIGH — all seams located with line numbers; filter derivation traced through the orchestrator
- Pitfalls: HIGH for code-derived ones (1-9), MEDIUM for navigation-download auth in a real browser, LOW for scratch-table syntax

**Research date:** 2026-10-07
**Valid until:** 30 days (code is stable; re-verify line numbers if `WidgetRenderer.tsx` changes — Phase 132 also edits it, sequenced after)
