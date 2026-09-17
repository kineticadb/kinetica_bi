# Phase 121: UI + Cross-Environment Verification - Research

**Researched:** 2026-09-17
**Domain:** Web-only (React + Vite + zustand). No new library, no server-format change. This phase
wires existing server endpoints (Phase 119 export, Phase 120 import) into the dashboard UI, and then
runs the one thing that has never actually happened: a file that leaves one environment and enters
another.
**Confidence:** HIGH on everything grounded in direct code read (the import route's request contract,
the export route's response contract, `DashboardsPage.tsx`'s existing markup, `global.css`'s class
vocabulary, CORS config). MEDIUM on the download mechanism recommendation (no precedent exists in this
codebase — the choice is reasoned from the CORS/dev-vs-prod facts, not copied from an established
pattern). LOW/explicitly-flagged on anything claiming the cross-environment round trip itself can be
automated — it cannot, and this document says so rather than dressing a UAT up as a test.

## Summary

Phase 120's import route (`POST /api/dashboards/import`) takes a **plain JSON body**, not multipart —
there is no `multer` involvement anywhere in this route. The client must `JSON.parse` the chosen
`.json` file and POST the parsed object with `Content-Type: application/json`, exactly like every
other mutating call in `client.ts`. This resolves Q1 with certainty (direct route read), which in turn
resolves most of Q2 and Q4 (no `FormData`, no file-upload boilerplate needed — just `File.text()` +
`JSON.parse` + `apiFetch`).

Export (`GET /api/dashboards/:id/export`) is a same-route-shape GET that returns the file body directly
with a `Content-Disposition: attachment` header. There is genuinely no download precedent in this
codebase, and one real hazard was found: **`Content-Disposition` is not in the CORS
`exposedHeaders` list**, so `response.headers.get('content-disposition')` returns `null` for a
cross-origin `fetch` (true in dev, where `API_BASE` is `localhost:4000` against the SPA's
`localhost:5173`). The fix is not to expose the header — it's to not need it: the client already has
the dashboard's `id` and `name` in `DashboardDto` at the point the user clicks Export, so the filename
can be derived client-side without ever reading the response header. The recommended flow is:
`apiFetch` the export URL → `response.blob()` → `URL.createObjectURL` → a synthetic `<a download>`
click → `revokeObjectURL`. This is a same-origin `blob:` URL by construction, so `download` is honored
by every browser regardless of whether `API_BASE` is cross-origin (dev) or same-origin behind nginx
(docker/prod) — one code path, no environment branching.

The import report (`ImportReport`, `packages/server/src/lib/dashboardImport.ts`) is a rich object —
tables/metrics matched vs created, `MetricConflict[]` (which the operator explicitly accepted risk on),
`strippedReferences`, and `warnings` (including the `layerFilterWidened` case). A UI that shows
"Import succeeded" and discards this object throws away the only signal for a real, load-bearing risk
the operator already agreed to take. The recommended presentation is a modal (reusing the exact
`.modal-overlay`/`.modal-content`/`.modal-header`/`.modal-body`/`.modal-section-title` vocabulary
`DashboardAccessModal.tsx` already uses) with one section per report field, metric conflicts rendered
with the `.error` class (the existing "needs attention" signal) and their full operator-facing
`message` string verbatim — never summarized.

Every UI control this phase adds has an existing class to match: `DashboardsPage.tsx`'s per-row
`.ds-actions` span already holds `btn-primary btn-sm` / `ghost-sm` / `ghost-sm ghost-danger`; a new
Export button is a `ghost-sm` sibling in that same span. Import has no row to live in (there is no
dashboard yet) — it belongs next to "+ New Dashboard" in the page-level `ChartCard actions` slot, and
CLAUDE.md's own rule ("primary in an action pair uses `btn-primary btn-sm`, not bare `btn-primary`")
means **that existing button's class must change** when Import is added beside it, wrapped in
`ds-actions`. The file input itself needs no new class at all: `.ds-field input` in `global.css`
already styles any `<input>` inside a `.ds-field` wrapper, `type="file"` included — wrapping the picker
in the same `<div className="ds-field"><span className="ds-field-label">…</span><input type="file"
.../></div>` shape used everywhere else in the app costs zero new CSS.

**Primary recommendation:** JSON-body POST for import, blob+synthetic-anchor for export download,
reuse `.ds-actions`/`ghost-sm`/`.modal-*`/`.ds-field` verbatim, and treat the cross-environment round
trip as a mandatory `checkpoint:human-verify` — because it provably cannot be simulated in `jsdom`, and
Phase 120's own SUMMARY says outright that nothing has proven portability yet.

## User Constraints (from CONTEXT.md)

### Locked Decisions
*(CONTEXT.md has no `## Decisions` section header as such — its normative content lives under
`<decisions>`, reproduced here verbatim.)*

**The three reference kinds that have never run outside a fixture** — REF-2 `dynamicViewId`, REF-4
scalar `metricId`, REF-5 `metrics[].metricId` are FIXTURE-ONLY, never seen live. **The UAT must require
a dashboard that uses a custom metric AND a dynamic view.** If the operator does not already have one,
the walkthrough must say so and ask them to build one — an approval obtained without exercising those
kinds leaves them unproven, and the plan should refuse to call that a full pass.

**What "renders identically" means** — ROADMAP criterion 3 requires all visualizations to render the
same DATA, and criterion 4 requires every interactive feature (drill-down, filters, map layers, any
standalone Legend binding) to still work. A dashboard that merely *loads* proves very little — a widget
pointing at the wrong table renders perfectly well, it just shows wrong numbers. The UAT must compare
against the source, not merely confirm the target looks plausible.

**Import report (DXIM-V124-10) must surface what the operator accepted risk on** — `MetricConflict`
carries label, table, both expressions, and a message, because the operator explicitly decided that a
label-matching-but-expression-differing metric REUSES the target's definition, silently changing what
the imported widget computes. The report is the ONLY signal. The UI must not reduce the report to
"Import succeeded." Tables matched vs created, metrics created, any metric conflicts, and any
`layerFilterWidened` warning all have to reach the operator.

### Claude's Discretion
- Where the export and import controls live in the dashboard UI, and their exact labels.
- How the import report is presented (modal, inline panel, toast + detail).
- Whether import is reachable from the dashboard list, a settings surface, or both.
- File-picker mechanics and client-side validation before upload.

### Deferred Ideas (OUT OF SCOPE)
DXIM-F1 bulk multi-dashboard export/import · DXIM-F2 server-to-server migration without a file ·
DXIM-F3 exporting access grants for same-environment cloning · DXIM-F4 dry-run preview · DXIM-F5
re-import over an existing dashboard. Re-testing the server's `TD-V16-TEST-ISOLATION` attribution —
still not this phase.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-------------------|
| DXIM-V124-01 | A dashboard can be exported to a downloaded file from the dashboard UI, gated on the appropriate existing permission | Q2/Q4 below: the blob+synthetic-anchor download mechanism, no new permission — export already gates on `canViewDashboard` (same as the five sibling per-dashboard GETs), so the UI control's visibility should mirror that (always offered when the dashboard is visible at all — there is no separate "export" permission to gate on) |
| DXIM-V124-03 | Importing that file into another environment recreates the dashboard — re-verified here by an actual cross-environment UAT | Q1 (exact request contract) + Q5 (second-environment recommendation + the `checkpoint:human-verify` framing) |
| DXIM-V124-10 | Import reports what it did, surfaced to the operator | Q3 below: the `ImportReport`/`MetricConflict` shape and the modal presentation that cannot collapse it to "succeeded" |

## Q1 — The import route's exact request contract

**Confirmed by direct read of `packages/server/src/index.ts:809-842` and
`packages/server/src/lib/dashboardImport.ts`:**

- Route: `POST /api/dashboards/import`.
- Body: **plain JSON**, parsed by the global `app.use(express.json({ limit: "1mb" }))` middleware
  (`index.ts:146`). There is **no `multer` anywhere near this route** — `multer` exists in this
  codebase only for `POST /api/branding/logo` (the v1.16 logo upload), a completely separate route.
  `validateImportFile(req.body)` (`dashboardImport.ts:98`) receives the parsed body directly; nothing
  in the validator or the route reads `req.file` or a multipart field.
- Content-Type the client must send: `application/json`. Field name: **none** — the entire request
  body IS the export envelope (`{ schemaVersion, dashboard, widgets, layers, dynamicViews, tables,
  customMetrics, dashboardTableIds, ... }`), not a field wrapping it.
- Size limit: 1 MB, enforced by the body-parser BEFORE the route runs. Exceeding it produces a 413
  with `code: "PAYLOAD_TOO_LARGE"` (handled in the shared error middleware, `index.ts:3007-3012`), not
  a route-level check.
- Malformed JSON (a truncated/hand-edited file) produces a 400 with `code: "MALFORMED_JSON"`
  (`index.ts:3000-3005`) — again from the body-parser's own error, before the route runs.
- A structurally-invalid-but-valid-JSON body (e.g. a missing `widgets` array) produces a 400 from
  `validateImportFile` itself, with `code: "IMPORT_MALFORMED"` or `"UNSUPPORTED_SCHEMA_VERSION"` and a
  human-readable `message` (e.g. `Import file is malformed: widgets must be an array (got undefined).`).
- Success: **201**, body `{ data: { ...report, preflightDangling: result.dangling } }` — the full
  `ImportReport` (see Q3) spread at the top level of `data`, plus one extra field
  (`preflightDangling: DanglingReference[]`) carrying Tier-2 validation's own dangling-reference list
  (recomputed from the file, never trusted from the file's self-reported count).
- Mid-import failure (a thrown error inside the transaction, which rolls back): **422**, body
  `{ error: "Import failed partway through and was rolled back. No dashboard, widgets, layers or
  table entries were created.", code: "IMPORT_FAILED" }`.

**Client-side implication:** the import helper is the simplest possible shape in `client.ts` — read the
chosen `File` via `file.text()`, `JSON.parse` it client-side (so a non-JSON file fails fast with a
clear client-side message before ever hitting the network — see Q4), then:
```typescript
const response = await apiFetch(`${API_BASE}/api/dashboards/import`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: fileText,          // the ALREADY-JSON text — no need to re-stringify after parsing
});
if (!response.ok) await throwForStatus(response, "Failed to import dashboard");
const json = await response.json();
return json.data as ImportReportDto;   // includes preflightDangling
```
Sending `fileText` directly (not `JSON.stringify(JSON.parse(fileText))`) avoids a redundant
parse/stringify round trip — the file's bytes ARE already valid JSON once `JSON.parse` succeeded
client-side for the pre-flight message check; re-serializing changes nothing but wastes CPU on a
1 MB-capped payload. (Client-side `JSON.parse` is still worth doing FIRST, thrown away, purely so a
non-JSON file gets an immediate, unambiguous client-side error rather than a round trip to learn the
same thing from the server's `MALFORMED_JSON` branch.)

### Gating: `dashboards:create` AND `datasets:manage` — both confirmed

`index.ts:809-812`:
```typescript
app.post(
  "/api/dashboards/import",
  ...requirePermission(PERMISSIONS.DASHBOARDS_CREATE),
  ...requirePermission(PERMISSIONS.DATASETS_MANAGE),
  (req, res) => { ... }
);
```
Both permissions are real, existing constants (`packages/server/src/lib/permissions.ts:20,35`:
`DASHBOARDS_CREATE: "dashboards:create"`, `DATASETS_MANAGE: "datasets:manage"`). No new permission is
added anywhere in this milestone (confirmed: `git log` / REQUIREMENTS.md's Locked Decisions both state
this explicitly).

**Client-side gate:** `DashboardsPage.tsx` already does exactly this pattern for four other buttons —
```typescript
const hasPermission = useAuthStore((s) => s.hasPermission);
const canCreate = hasPermission(PERMISSIONS.DASHBOARDS_CREATE);   // already exists, line 122
```
The Import button's visibility condition is simply
`hasPermission(PERMISSIONS.DASHBOARDS_CREATE) && hasPermission(PERMISSIONS.DATASETS_MANAGE)` — an AND,
mirroring the route's own AND-gate exactly, so the control is never offered to a user who would be
refused. `packages/web/src/test/seedAuthStore.ts`'s `seedDesignerStore()` already grants BOTH
permissions (designer has full dashboard lifecycle + `DATASETS_MANAGE`); `seedAnalystStore()` grants
NEITHER (`[PERMISSIONS.DASHBOARDS_VIEW]` only) — these two existing seed helpers are a ready-made
positive/negative test fixture pair, no new seed helper needed.

**Export's gate is different and looser, by design — do not conflate the two.** `GET
/api/dashboards/:id/export` (`index.ts:939-950`) gates on `canViewDashboard(username, id)` only (the
same check the five sibling per-dashboard GETs use) — there is no `dashboards:create`/`datasets:manage`
pairing on export, and the code comment explicitly states no additional permission is added because
"`dashboards:view` has zero enforcement call sites in this file and `canViewDashboard` IS the control."
The Export button's visibility condition should therefore be unconditional (rendered for every row the
operator can already see in the list — if they can see the dashboard, `canViewDashboard` already
passed on the server for the initial `GET /api/dashboards` list filter at `index.ts:784-789`).

## Q2 — Client-side download (new ground)

### The dev/prod origin split, confirmed
- **Dev:** `API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:4000"` (`client.ts:7`); Vite
  serves the SPA on `:5173` (`vite.config.ts: server.port = 5173`) with **no dev proxy configured** —
  `vite.config.ts` has no `server.proxy` block. So in dev, every API call (including export) is
  genuinely cross-origin.
- **Prod/docker:** `docker/nginx.conf` proxies `location /api/ { proxy_pass http://127.0.0.1:4000; }`
  on the SAME origin nginx itself serves the SPA from (`docker/README.md`: web + server containers
  share a network namespace; the operator opens one URL, e.g. `http://localhost:8080`). So in prod,
  export is same-origin.

### The CORS finding (genuine hazard, not hypothetical)
`index.ts:140-145`:
```typescript
app.use(
  cors({
    origin: corsOrigins.length ? corsOrigins : true,
    credentials: true
  })
);
```
No `exposedHeaders` option is set. By the Fetch spec, a cross-origin response only exposes a small
allow-list of headers to client-side JS (`Content-Type`, `Content-Length`, a few others) **unless the
server explicitly lists more in `Access-Control-Expose-Headers`**. `Content-Disposition` is NOT on the
default allow-list. **In dev, `response.headers.get('content-disposition')` will return `null`.** This
is a real, verifiable-today gap — not a guess (the CORS call site above is the entire configuration;
there is no second `cors()` call or per-route override anywhere in `index.ts`).

**Recommendation: do not rely on reading this header at all, in either environment.** The client
already has everything needed to name the file without it — `DashboardDto.id` and `DashboardDto.name`
are already loaded into `DashboardsPage`'s `dashboards` state array before the Export button is even
rendered. A tiny client-side helper mirroring `exportFileName`'s slug logic (or simply
`` `dashboard-${dash.id}-${dash.name}.json` `` slugified the same allow-list way) produces an
equivalent, correct filename with zero dependency on a header the browser may not expose. This also
sidesteps ever needing to touch the CORS config — which would be an actual (if small) server-side
change, and the constraints forbid touching export/import semantics. **Filed as a finding, not
addressed by this phase:** a future phase could add `exposedHeaders: ["Content-Disposition"]` to make
the server-computed filename authoritative cross-origin; not required for this phase to succeed.

### The recommended download mechanism — one code path, works in both origins
```typescript
export const downloadDashboardExport = async (dashboard: Pick<DashboardDto, "id" | "name">): Promise<void> => {
  const response = await apiFetch(`${API_BASE}/api/dashboards/${dashboard.id}/export`);
  if (!response.ok) await throwForStatus(response, "Failed to export dashboard");
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = exportFileNameForClient(dashboard);   // client-side mirror of server's slug rule
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};
```
Why this is the least-machinery approach that is ALSO origin-agnostic:
- `apiFetch` already sends `credentials: "include"` (`client.ts:59`) — the session cookie travels
  regardless of origin, exactly as every other authenticated call in this file already relies on.
- A `blob:` URL is **always** same-origin to the page that created it, in every browser, regardless of
  where the underlying bytes came from. This is what makes the `download` attribute reliable — a plain
  `<a href="http://localhost:4000/...">` pointing directly at a cross-origin URL has the `download`
  attribute **ignored by Chrome/Firefox for cross-origin targets**, which in dev would silently
  degrade into a full-page navigation away from the SPA (exactly the friction the operator already hit
  once in Phase 119, per CONTEXT.md's "Specifics" section, when they pasted a raw URL using the wrong
  port). The blob approach removes this failure mode entirely — no origin-dependent branching, no
  `target="_blank"` fallback needed.
- `apiFetch`'s own JSON-peeking for 401/403 (`client.ts:60-94`) does `response.clone().json()` — this
  is safe to call before `.blob()` because `clone()` gives the download call its own independent
  stream; nothing here conflicts with the existing 401/403 side-channel logic.

### Does `apiFetch`/`throwForStatus` handle non-JSON responses?
**Checked directly (`client.ts:100-121`).** `throwForStatus` is only invoked on the `!response.ok`
branch, and it already handles a non-JSON body gracefully: it tries `response.clone().json()` first,
and on a JSON-parse failure falls back to `response.text()` (`client.ts:108-111`). The **success**
path (`response.ok === true`) is never touched by `throwForStatus`, and `apiFetch` itself never calls
`.json()` on a 2xx response (only the 401/403 branches peek, and only via `.clone()`). So calling
`.blob()` on a successful export response is safe and requires no change to `apiFetch`.

## Q3 — Surfacing the import report (DXIM-V124-10)

### The exact shape (`dashboardImport.ts:462-479`)
```typescript
export type ImportReport = {
  dashboardId: number;
  dashboardName: string;
  widgetsCreated: number;
  layersCreated: number;
  dynamicViewsCreated: number;
  tablesMatched: TableResolution[];      // { oldId, newId, schema, name, tableRef }
  tablesCreated: TableResolution[];
  metricsMatched: MetricResolution[];    // { oldId, newId, tableId, tableRef, label }
  metricsCreated: MetricResolution[];
  metricConflicts: MetricConflict[];     // MetricResolution & { existingExpression, importedExpression, message }
  strippedReferences: { from: string; kind: RefKind; id: number }[];
  warnings: string[];   // includes the layerFilterWidened sentence, skipped-dv/-layer/-metric notes
};
```
Plus the route wraps it: `{ data: { ...report, preflightDangling: DanglingReference[] } }`.

### Why the `MetricConflict.message` string must be shown verbatim
`dashboardImport.ts:443` constructs it deliberately with full detail:
> `Custom metric "Revenue" on schema.tablename already exists in this environment with a DIFFERENT
> expression. Imported widgets now use the EXISTING definition (SUM(amount)); the file's definition
> (SUM(amount) * 1.1) was NOT applied.`

The code comment directly above (`dashboardImport.ts:386-401`) states the policy was **locked by the
operator** and that "a bare 'matched: Revenue' would hide exactly the risk the operator agreed to
take." Any UI that shows only `metricConflicts.length` or a generic "N conflicts" count without this
message text fails the requirement's actual intent, even though it would technically be "surfacing
the conflicts." **Recommendation: render every `MetricConflict.message` string in full, one per row,
never truncated or summarized to a count.**

### Recommended presentation — reuse the existing modal vocabulary exactly
`DashboardAccessModal.tsx` (`packages/web/src/components/DashboardAccessModal.tsx:125-179`) is the
closest existing component: same domain (dashboard-scoped, list-of-rows-in-sections, opened from a
`ds-actions` button, closed via an explicit "Close" `ghost-sm` button). Its exact class shape:
```tsx
<div className="modal-overlay" onClick={onClose}>
  <div className="modal-content" onClick={(e) => e.stopPropagation()}>
    <div className="modal-header">
      <span className="modal-title">Import report: {report.dashboardName}</span>
      <button className="ghost-sm" onClick={onClose}>Close</button>
    </div>
    <div className="modal-body">
      <h3 className="modal-section-title">Tables</h3>
      <div className="datasets-table">
        {report.tablesMatched.map((t) => <div key={t.newId} className="ds-row" style={{gridTemplateColumns: "1fr auto"}}>
          <span>{t.tableRef}</span><span className="muted">matched</span>
        </div>)}
        {report.tablesCreated.map((t) => <div key={t.newId} className="ds-row" style={{gridTemplateColumns: "1fr auto"}}>
          <span>{t.tableRef}</span><span className="muted">created</span>
        </div>)}
      </div>
      <h3 className="modal-section-title modal-section-title-spaced">Custom metrics</h3>
      {/* metricsMatched / metricsCreated, same ds-row shape */}
      {report.metricConflicts.length > 0 && (
        <>
          <h3 className="modal-section-title modal-section-title-spaced">Metric conflicts — review before trusting these widgets</h3>
          {report.metricConflicts.map((c) => (
            <div key={c.newId} className="error" style={{marginBottom: "8px"}}>{c.message}</div>
          ))}
        </>
      )}
      {report.warnings.length > 0 && (
        <>
          <h3 className="modal-section-title modal-section-title-spaced">Warnings</h3>
          {report.warnings.map((w, i) => <div key={i} className="muted">{w}</div>)}
        </>
      )}
    </div>
  </div>
</div>
```
Every class above (`modal-overlay`, `modal-content`, `modal-header`, `modal-title`, `modal-body`,
`modal-section-title`, `modal-section-title-spaced`, `datasets-table`, `ds-row`, `ghost-sm`, `error`,
`muted`) is already defined in `global.css` and already used by `DashboardAccessModal.tsx` — **zero new
classes needed for the report modal.**

**Note on `.error`'s own hex:** `global.css:1098-1100` defines `.error { color: #ef4444; }` — a
pre-existing hardcoded hex, not introduced by this phase. Reusing it is consuming an existing class,
not "hardcoding hex" in new work, so it does not trip CLAUDE.md's rule for NEW code — but it IS exactly
the kind of thing `theme-guard.spec.ts` cannot see (it only asserts `hasHex === true` for allowlisted
files, never checks absence), so a human should still eyeball the conflict rows in both themes as part
of the phase's own visual check, alongside the new modal generally.

## Q4 — Where the controls belong, using existing vocabulary

### Export — per-row, in the existing `.ds-actions` span
`DashboardsPage.tsx:268-290` (list view, row markup):
```tsx
<span className="ds-actions">
  <button className="btn-primary btn-sm" onClick={...}>Open</button>
  <button className="ghost-sm" onClick={...}>View</button>
  {canEdit && <button className="ghost-sm" onClick={...}>Edit</button>}
  {canDelete && <button className="ghost-sm ghost-danger" onClick={handleDelete}>Delete</button>}
  {canManageAccess && <button className="ghost-sm" onClick={...}>Manage access</button>}
</span>
```
Export slots in as one more unconditional `ghost-sm` sibling (no permission gate needed — see Q1):
`<button className="ghost-sm" onClick={() => downloadDashboardExport(dash)}>Export</button>`.

### Import — page-level, next to "+ New Dashboard" — and that button's class must change
Current code (`DashboardsPage.tsx:238-244`):
```tsx
actions={
  canCreate ? (
    <button className="btn-primary" onClick={() => setView({ mode: "create" })}>
      + New Dashboard
    </button>
  ) : undefined
}
```
This is currently a STANDALONE primary (bare `btn-primary`, large). CLAUDE.md is explicit: **"Primary
in an action pair (next to a secondary button): `btn-primary btn-sm`... Plain `btn-primary` next to
`ghost-sm` is the WRONG, mismatched-height combo."** Adding an Import button beside it makes this a
pair, so the existing button's class must change to `btn-primary btn-sm`, both wrapped in `ds-actions`:
```tsx
actions={
  <div className="ds-actions">
    {canCreate && (
      <button className="btn-primary btn-sm" onClick={() => setView({ mode: "create" })}>
        + New Dashboard
      </button>
    )}
    {canImport && (
      <button className="ghost-sm" onClick={() => setShowImportModal(true)}>
        Import dashboard
      </button>
    )}
  </div>
}
```
where `canImport = hasPermission(PERMISSIONS.DASHBOARDS_CREATE) && hasPermission(PERMISSIONS.DATASETS_MANAGE)`
(Q1). This is a genuine, intentional, in-scope UI change to an EXISTING element, not scope creep — it
follows directly from CLAUDE.md's own stated rule for exactly this situation. **Flag this explicitly
in the plan** so it isn't mistaken for an unrelated/incidental diff by whoever reviews it.

### The file picker — zero new classes
The only existing file-input precedent, `LogoUploader.tsx` (`packages/web/src/components/settings/`),
uses a `.logo-uploader-input` class that is **defined in `BrandingSettingsPage.css`**, a component-local
stylesheet imported ONLY by `BrandingSettingsPage.tsx` (`import "./BrandingSettingsPage.css"` — a
side-effect import, not a module DashboardsPage.tsx currently pulls in). Reaching across into another
page's private CSS file for one class would be a cross-component coupling smell CLAUDE.md doesn't
license, and DashboardsPage.tsx has no CSS file of its own to add a page-local equivalent into (unlike
`RolesPage.css`, which exists for exactly this purpose on that page).

**Recommendation: don't hide the file input at all — there is a simpler, already-generic fit.**
`global.css:1024-1065` styles `.ds-field input` for ANY `<input>` inside a `.ds-field` wrapper
(`type="file"` included — the selector has no type qualifier). The same shape used everywhere else in
the app for a labeled input:
```tsx
<div className="ds-field">
  <span className="ds-field-label">Import file</span>
  <input type="file" accept="application/json" onChange={handleFileChosen} />
</div>
```
costs **zero new CSS** and matches an existing pattern exactly, rather than inventing a class OR
reaching into another component's stylesheet. This is genuinely the least-machinery option, not a
compromise — native file inputs are already interactive without a "Choose file" trigger-button
wrapper (that pattern in `LogoUploader.tsx` exists because it ALSO needs to show an image preview
swatch, which the import case does not).

## Q5 — Test infrastructure and the UAT shape

### Existing spec coverage of `DashboardsPage`
Three files: `DashboardsPage.spec.tsx`, `DashboardsPage.panel.spec.tsx`,
`DashboardsPage.urlsync.spec.tsx`. All three follow the same mocking pattern
(`DashboardsPage.spec.tsx:73-102`):
```typescript
vi.mock("../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client")>();
  return { ...actual, listDashboards: vi.fn(() => Promise.resolve([])), /* etc. */ };
});
```
i.e. spread the REAL module, override only the specific functions a given spec needs to control. A new
spec file covering Export/Import would add `downloadDashboardExport: vi.fn()` /
`importDashboardFile: vi.fn(() => Promise.resolve(mockReport))` to its own `vi.mock` call — **no
existing spec file needs to change** unless it currently renders a dashboard row for a permission
level that would now also see the new buttons (the three existing files' current mocks return `[]`/
zero rows or a fixed dashboard set that doesn't currently assert against the row's exact button list,
so this is a plan-time thing to verify per file, not assumed safe).

### Baseline (run this session, 2026-09-17)
- `cd packages/web && npx tsc --noEmit` → clean, zero output.
- `cd packages/web && npx vitest run` → **176 test files passed (176), 4025 tests passed (4025)**.
- `cd packages/web && npx vitest run src/styles/theme-guard.spec.ts` → **1 file passed, 150 tests
  passed**.

`seedDesignerStore()`/`seedAnalystStore()` (`packages/web/src/test/seedAuthStore.ts`) already give a
ready-made positive/negative permission-gating fixture pair for the Import button (designer has BOTH
`DASHBOARDS_CREATE` and `DATASETS_MANAGE`; analyst has neither) — no new seed helper needed.

### What jsdom CAN and CANNOT prove about the download
**Can:** that `downloadDashboardExport` calls `fetch`/`apiFetch` with the right URL and credentials
mode; that on a 2xx response it calls `URL.createObjectURL` with a Blob and sets `a.download` to the
expected filename; that on a non-2xx response it throws via `throwForStatus` with the right message.
`URL.createObjectURL`/`revokeObjectURL` and `HTMLAnchorElement.click()` are all mockable/spy-able in
jsdom (jsdom implements `createObjectURL` as a stub that doesn't error, and `.click()` on a detached
anchor is a no-op dispatch that doesn't throw).
**Cannot:** whether the browser's OWN download manager actually writes a file to disk, what filename
the OS-level save dialog shows, or whether the file is byte-identical to what a human opens afterward.
This is a browser/OS boundary jsdom does not model. **Honest framing for the plan: the download
MECHANISM (fetch → blob → anchor → click) is unit-testable; that a human's Downloads folder actually
receives a correctly-named `.json` file is not, and must be the operator checkpoint's own explicit
confirmation, not something a grep or a jsdom assertion can stand in for.**

### What the UAT must ask the operator to do concretely
CONTEXT.md is explicit that REF-2/-4/-5 must be exercised live, not assumed. The walkthrough should not
assume the operator already knows how — it should say, concretely:
- **A custom metric (REF-4/-5):** open a dashboard's widget config panel for any table-backed chart,
  add a custom metric via the existing custom-metrics editor (`CustomMetricsEditorModal.tsx` — Phase 99
  METRIC-V119-01/02), give it a distinct label/expression, and use it on at least one widget (a scalar
  `metricId` reference exercises REF-4; if the metric is used inside a widget's `metrics[]` array — e.g.
  a multi-series chart — that additionally exercises REF-5).
- **A dynamic view (REF-2):** open the Dynamic Views modal (`DynamicViewsModal.tsx`, reachable from the
  dashboard's existing "Dynamic Views" button) for one of the dashboard's tables, create a view with a
  `{view}`-templated filter SQL, and bind at least one layer or widget to it via the layer's "Data
  Source" picker (LayersModal) so `dynamicViewId` is actually written into a widget/layer config, not
  just left as an unused dv definition.
- The dashboard used for the round trip should ideally be a NEW one built specifically to carry both
  (rather than retrofitting dashboard 4, "Test Dashboard," which the operator already approved without
  either — CONTEXT.md's own framing is that the ABSENCE of these two things in that prior export is
  precisely the gap this phase must close).

### Two environments — recommendation, with explicit tradeoffs

**Recommended: two independent `docker run` pairs (per `docker/README.md`), on two different host
ports, each with its own SQLite file.**
```
docker run -d --name kbi-server-a -p 4000:4000 -e DB_PATH=/data/a.db ... kinetica-bi-server
docker run -d --name kbi-web-a --network container:kbi-server-a kinetica-bi-web
# second pair, different host port + DB_PATH:
docker run -d --name kbi-server-b -p 4001:8080 -e DB_PATH=/data/b.db ... kinetica-bi-server
docker run -d --name kbi-web-b --network container:kbi-server-b kinetica-bi-web
```
(Exact port numbers/volume mounts are the plan's job to pin down against the real `Dockerfile`, not
research's — this shape is confirmed correct from `docker/README.md`'s documented run commands; the
`-p` host-port mapping and `DB_PATH`/`PORT` env vars are the two axes of genuine separation, both
independently confirmed: `defaultDbPath = process.env.DB_PATH || .../data/kinetica.db` and
`port = process.env.PORT || 4000`, `packages/server/src/db.ts:424` / `index.ts:3025`.)
**What this proves:** two genuinely separate processes, separate SQLite files, separate id spaces,
each behind its own same-origin nginx (so the download mechanism is exercised in its PRODUCTION
config, not just dev) — the operator opens two browser tabs (`localhost:4000`/`:4001` or whatever ports
are chosen) and the export/import genuinely crosses a process + database boundary.
**What it does NOT prove:** a real network boundary (both containers run on the same host/Docker
daemon) or a different OS/architecture. Given the milestone's own language — "move dashboards across
ENVIRONMENTS," never "across machines" or "across networks" — this is judged sufficient; the
CONTEXT/ROADMAP language nowhere requires crossing a physical host boundary.

**Lighter fallback, if docker images aren't readily buildable in the operator's setup: two `tsx watch`
server processes + one restarted Vite dev server.**
```
# Terminal A:
cd packages/server && DB_PATH=./data/env-a.db PORT=4000 npm run dev
# Terminal B (after exporting from A):
cd packages/server && DB_PATH=./data/env-b.db PORT=4001 npm run dev
# Web: restart Vite with VITE_API_URL pointed at whichever port is "current" —
# Vite inlines import.meta.env.VITE_API_URL at dev-server START, so switching requires
# a restart, not just an env var change while it's running.
cd packages/web && VITE_API_URL=http://localhost:4001 npm run dev
```
**What this proves:** the same process+database separation as the docker option (two `better-sqlite3`
files, two independent id spaces). **What it does NOT prove:** the docker/nginx same-origin routing
path Q2 analyzed — this fallback stays in the dev cross-origin configuration throughout, so it verifies
the CORS-aware blob-download code path but not the nginx same-origin one. **Tradeoff, stated plainly:**
lighter to set up, but proves one fewer thing than the docker option. Recommend docker as primary,
this as the fallback if docker is impractical for the operator to stand up twice.

**What NEITHER option proves, and what the plan must not claim:** genuinely distinct machines, a real
network hop, a different SQLite version/architecture, or a different Kinetica cluster. The milestone's
own decisions never asked for that; this is not a compromise from a higher bar, just an honest boundary
statement.

### Routing this to the operator, not to an automated grep
**This is the single clearest CLAUDE.md "verifiable acceptance criteria" case in this phase.** No grep,
no jsdom assertion, no vitest test can establish that a file exported from one running server process
and imported into a genuinely different one — with different pre-existing ids in its own database —
renders the same charts with the same numbers and the same working drill-down/filter/map-layer
interactions. The plan should express this as a `type="checkpoint:human-verify" gate="blocking"` task
(the exact tag `119-04-PLAN.md` already used for the Phase 119 operator export checkpoint), with:
1. The concrete custom-metric + dynamic-view creation steps above.
2. The concrete two-environment setup (docker primary / dev fallback).
3. An explicit side-by-side comparison instruction: open BOTH dashboards, compare every widget's
   RENDERED DATA (not just presence), and exercise drill-down / filter / map-layer / Legend binding
   on the IMPORTED copy specifically.
4. An explicit instruction to paste/attach the import report (Q3's modal) as part of the approval
   record, the same way Phase 119-04's SUMMARY recorded the operator's actual downloaded file contents
   rather than taking a self-report at face value.
5. An explicit statement, carried into the SUMMARY regardless of outcome, that a FAIL here means
   DXIM-V124-03/-10 (and DXIM-V124-01, transitively, since it's this checkpoint's precondition) must be
   REOPENED in REQUIREMENTS.md — not silently re-approved with a caveat. This directly implements
   CONTEXT.md's own framing ("If the round-trip fails, requirements that currently read Complete must
   be REOPENED — say so plainly").

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Reading a file's contents in the browser before upload | A custom `FileReader` wrapper | `File.text()` (already a native async method; no `FileReader` boilerplate needed for text content) | Simpler, already-async, no event-listener plumbing |
| Triggering a browser download | A new "download helper" library or `res.download`-style server change | `Blob` + `URL.createObjectURL` + synthetic `<a download>` (Q2) | Zero dependencies, works identically cross-origin and same-origin, no server change needed |
| A "file is valid JSON" pre-check | A hand-rolled JSON structural validator on the client | `JSON.parse` (throws synchronously on malformed JSON) + let the SERVER's `validateImportFile` do the actual structural/Tier-1 checks | The server is already the single source of truth for what a valid export file looks like (Phase 120); duplicating that logic client-side would create a second thing to keep in sync with schema changes |
| Permission-gating the Import button | A new client-side permission constant or a new server permission | The two EXISTING `PERMISSIONS.DASHBOARDS_CREATE`/`PERMISSIONS.DATASETS_MANAGE` constants, ANDed exactly as the route already ANDs them | No new RBAC permission is in scope (constraint), and the route's own gate is the ground truth to mirror |

**Key insight:** every piece of this phase's client-side surface is a thin wrapper around an
already-fully-specified server contract (Phase 119/120) and an already-fully-specified UI vocabulary
(`global.css` + existing components). The discipline this phase actually needs is restraint — resist
adding a file-upload library, a toast-notification library, or a new CSS file where the existing
`.ds-field`/`.modal-*`/`.ds-actions` shapes already fit.

## Common Pitfalls

### Pitfall 1: Assuming the import route takes multipart because `multer` exists in the codebase
**What goes wrong:** building a `FormData`-based `importDashboardFile` client helper (mirroring
`uploadBrandLogo`) that the server rejects, because the JSON body-parser (`express.json`) never
receives a parseable body from a multipart POST.
**Why it happens:** `multer` genuinely exists in this codebase (v1.16 branding logo), and CONTEXT.md
itself flags this as an open question rather than settling it — it would be reasonable to guess wrong
without reading the route.
**How to avoid:** this document confirms it directly from `index.ts:809-842` — plain JSON body, no
`multer` import anywhere near this route.
**Warning signs:** a 400 `MALFORMED_JSON` from the server on every import attempt, or `req.body` being
`{}`/`undefined` server-side despite the client believing it sent a file.

### Pitfall 2: Reading `Content-Disposition` for the download filename
**What goes wrong:** `response.headers.get('content-disposition')` silently returns `null` in dev
(cross-origin), producing a filename of `null` or an unhandled exception, while working fine in a
manual same-origin prod test — a bug that only reproduces in one of the two environments the plan is
supposed to be proving parity across.
**Why it happens:** the server DOES set the header (`index.ts:945`); it's invisible to client JS only
because of the missing `exposedHeaders` CORS config, which isn't obvious without checking the CORS call
site directly.
**How to avoid:** derive the filename client-side from data already in hand (Q2) — never depend on
reading this header.
**Warning signs:** downloads that work when manually tested against a docker/prod build but fail (or
silently misname the file) under `npm run dev`.

### Pitfall 3: Treating a green vitest suite as proof the round trip works
**What goes wrong:** shipping this phase on the strength of `npx vitest run` passing, without ever
running the actual two-environment UAT, because "the UI wires up correctly" and "the import route
works" are both independently well-tested by Phases 119-121's automated suites.
**Why it happens:** every other requirement in this milestone up to this point WAS closed on automated
evidence — it's the path of least resistance to assume this one can be too.
**How to avoid:** CONTEXT.md states outright that all three of this phase's requirements are "ALREADY
marked Complete" on automated evidence alone, and that this is exactly the trap — "nothing has yet
moved between two environments." The `checkpoint:human-verify` task (Q5) is not optional scaffolding;
it is the actual proof this phase exists to produce.
**Warning signs:** a plan or SUMMARY that reports "gates green" as the closing evidence without a
distinct, explicit operator sign-off referencing the SPECIFIC two-environment round trip and the
specific custom-metric/dynamic-view dashboard used.

## Acceptance Criteria — every grep proposed, with its CURRENT count (run 2026-09-17)

Per CLAUDE.md's "Writing verifiable acceptance criteria," every anchor below was actually run against
the current tree before being proposed, from `packages/web`:

| Proposed criterion (anchors a symbol THIS phase introduces) | Command | Current count |
|---|---|---|
| `downloadDashboardExport` appears in `client.ts` after the work | `grep -c "downloadDashboardExport" src/api/client.ts` | **0** (file/symbol doesn't exist yet) |
| `importDashboardFile` (or chosen name) appears in `client.ts` | `grep -c "importDashboardFile" src/api/client.ts` | **0** |
| An import-report presentation component exists | `grep -rc "ImportReportModal" src` (or whatever name the plan settles on) | **0** |
| The literal button label "Import dashboard" appears in `DashboardsPage.tsx` | `grep -c "Import dashboard" src/components/DashboardsPage.tsx` | **0** |
| The literal button label "Export" appears in `DashboardsPage.tsx` | `grep -c "Export" src/components/DashboardsPage.tsx` | **0** |
| `MetricConflict` type is consumed client-side | `grep -rc "MetricConflict" src` | **0** |
| `metricConflicts` field is read client-side | `grep -rc "metricConflicts" src` | **0** |

**Caution carried forward from the 30+ self-falsifying criteria across Phases 115-120:** the exact
literal string chosen for a button label or export name is a PLAN-TIME decision (CLAUDE.md CONTEXT.md
grants discretion over "their exact labels") — whichever label the plan actually picks, re-run the
`grep -c` for that EXACT string against the current tree in the same breath as writing the criterion,
per CLAUDE.md's rule, rather than trusting the counts recorded here if the final label differs from
what's shown above. These seven are reported as of THIS research pass, on the literal names research
proposed as EXAMPLES — the planner must re-verify against whatever names the plan actually commits to.

**Mutation-probe candidates, not grep-based, for the plan to consider (mirroring Phase 120's 39/39
pattern):**
- Delete the `MetricConflict` rendering branch in the report modal → a spec asserting the conflict
  message text is visible should redden.
- Delete the `canImport` AND-condition (leave only one of the two permission checks) → a spec seeded
  with `seedAnalystStore()` (neither permission) plus a store with ONLY `DATASETS_MANAGE` should
  redden if the button renders when it shouldn't.
- Skip the `URL.revokeObjectURL` call → not spec-discriminable in jsdom (no observable leak signal
  there); this one is honestly better caught by code review than a mutation probe — say so in the plan
  rather than forcing a probe that can't discriminate.

## Sources

### Primary (HIGH confidence — direct code read, this session)
- `packages/server/src/index.ts:130-160, 780-950, 2985-3017` — CORS config, body-parser config, the
  export route, the import route, the shared error-middleware body-parser branches.
- `packages/server/src/lib/dashboardImport.ts` (full file, 670 lines) — `validateImportFile`,
  `resolveTables`, `resolveCustomMetrics`, `ImportReport`/`MetricConflict` types, `applyDashboardImport`.
- `packages/server/src/lib/dashboardExport.ts` (full file, 141 lines) — `buildDashboardExport`,
  `exportFileName`'s slug algorithm.
- `packages/server/src/lib/permissions.ts:18-82` — `PERMISSIONS.DASHBOARDS_CREATE`/`DATASETS_MANAGE`
  constants and the `requirePermission` composition.
- `packages/web/src/components/DashboardsPage.tsx:1-300` — the list view, its `ds-actions` row markup,
  existing permission-gated buttons, the `ChartCard actions` slot.
- `packages/web/src/components/DashboardAccessModal.tsx:120-180` — the canonical modal shape to reuse
  for the import report.
- `packages/web/src/components/settings/LogoUploader.tsx` +
  `packages/web/src/components/settings/BrandingSettingsPage.css:369-383` — the only existing file-input
  precedent, and why its specific hidden-input class is NOT directly reusable from DashboardsPage.
- `packages/web/src/api/client.ts` (read to line 1247 of 1675 — `apiFetch`, `throwForStatus`,
  `uploadBrandLogo`'s multipart pattern, `updateBrandConfig`'s JSON pattern, `toAbsoluteAssetUrl`).
- `packages/web/src/styles/global.css` (targeted greps) — `.ds-actions`, `.ghost-sm`, `.ghost-danger`,
  `.btn-sm`, `.btn-primary`, `.ds-field`/`.ds-field-label`/`.ds-select`, `.modal-*`, `.error`, `.muted`.
- `packages/web/src/test/seedAuthStore.ts` — `seedDesignerStore`/`seedAnalystStore` permission fixtures.
- `packages/web/src/components/DashboardsPage.spec.tsx:1-120` — the established `vi.mock("../api/client")` pattern.
- `docker/nginx.conf`, `docker/README.md`, `packages/web/vite.config.ts` — same-origin (prod) vs
  cross-origin (dev) confirmation.
- `packages/server/src/db.ts:424`, `packages/server/src/index.ts:3025` — `DB_PATH`/`PORT` env-var
  confirmation for the two-environment recommendation.
- `.planning/REQUIREMENTS.md:31-42, 107-119` and `.planning/ROADMAP.md:49, 98-107` — the phase's
  requirements, their current (automated-only) closure state, and the four success criteria.
- `.planning/phases/119-export/119-04-SUMMARY.md`, `.planning/phases/120-import/120-05-SUMMARY.md` —
  the operator's actual Phase 119 export (5/8 reference kinds live) and Phase 120's explicit statement
  that cross-environment portability is unproven.
- `.planning/config.json` — `workflow.nyquist_validation: false` (Validation Architecture section
  correctly omitted from this document).
- Commands actually run this session: `cd packages/web && npx tsc --noEmit` (clean),
  `npx vitest run` (176 files / 4025 tests passed), `npx vitest run src/styles/theme-guard.spec.ts`
  (150 tests passed), and the seven `grep -c` counts in the Acceptance Criteria section above.

### Secondary / Tertiary
None used — every claim in this document traces to a direct code read or a command actually run in
this session. No WebSearch/Context7 lookups were needed: this phase introduces no new library, and the
relevant facts (route contracts, CORS config, CSS classes) are all internal to this codebase.

## Metadata

**Confidence breakdown:**
- Import request contract (Q1): HIGH — read directly, unambiguous.
- Export/download mechanism (Q2): MEDIUM — the recommendation is reasoned from confirmed facts (CORS
  config, dev/prod origin split, `apiFetch`'s actual behavior), but there is no existing download
  precedent in this codebase to point to as "this is how we already do it here."
- Import report presentation (Q3): HIGH for the DATA shape (direct code read); MEDIUM for the exact
  visual layout (a recommendation, matched to an existing component's pattern, not a rule from
  CONTEXT.md — CONTEXT.md explicitly leaves presentation to discretion).
- UI control placement (Q4): HIGH — every class cited was grepped and confirmed present in
  `global.css`, and the existing button markup was read directly.
- Cross-environment verification (Q5): HIGH on what jsdom can/cannot prove and on the docker/dev-env
  mechanics (both confirmed from files read); the two-environment RECOMMENDATION itself is a judgment
  call stated with its tradeoffs explicit, not a fact.

**Research date:** 2026-09-17
**Valid until:** This phase's server-side contract (Q1) is stable indefinitely (Phases 119/120 are
CLOSED and this phase may not change their format/semantics, per the constraints). The CSS-class
inventory (Q4) is valid until `global.css` next changes meaningfully — recommend re-grepping the
specific classes cited here at plan time if more than a few days elapse, since other in-flight work on
this branch (`docker/README.md`, `ChartConfigPanel.tsx`, etc. — see `git status`) touches adjacent
files.
