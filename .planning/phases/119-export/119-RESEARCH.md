# Phase 119: Export - Research

**Researched:** 2026-09-16
**Domain:** Server-side (Express + better-sqlite3) dependency-graph serialization; no new library — this is entirely bespoke domain logic over an existing schema.
**Confidence:** HIGH (every claim below is grounded in direct code inspection of this repo — `db.ts`, `index.ts`, and every web config panel/renderer that writes into `widgets.config` or `dashboard_layers.filter_scope` — not training-data guesses about a generic "export feature")

## User Constraints (from CONTEXT.md)

### Locked Decisions
1. **Transport is a JSON file.** Environments may be network-isolated; a file can be reviewed, diffed, version-controlled, or attached to a ticket. (Download/upload UI is Phase 121; this phase only produces the bytes.)
2. **Access grants are excluded** — the operator's framing: access "can be different on different environments". `dashboard_access_grants` must not appear in the export.
3. **Custom metrics travel.** Widgets reference `custom_metrics.id`, and `db.ts` states that id is deliberately load-bearing — *"an opaque autoincrement key so Phase 100 widget references survive label/expression edits"*. A widget whose metric did not travel loses its metric silently.
4. **Column display config does NOT travel.** It is per-table and shared across every dashboard using that table; importing it would silently change how OTHER dashboards render in the target environment. The target's existing formatting choices are deliberate.

### The dependency walk must be derived, not hand-listed
ROADMAP criterion 5 is deliberate: the exported set must be produced by walking the graph, not a hand-maintained list of tables to dump. Reference kinds live INSIDE serialized JSON config rather than in FK columns. **This research's Q1 answer below adds FIVE more such kinds beyond the three named in CONTEXT.md/ROADMAP** — see the "reference kind nobody mentioned" callouts.

### Runtime state must NOT travel
`dashboard_table_views` is materialized-view bookkeeping tied to a specific cluster + TTL lifecycle and must not export.

### Format versioning
The export file carries a schema version field. What import does with an unrecognized version is Phase 120's decision, but the field must exist now.

### Claude's Discretion
- The exact JSON shape and field names.
- Whether the export is a new route or an extension of an existing dashboards route.
- Whether the walk is an explicit graph traversal or an ordered series of queries, provided the result is derived from references, not a hard-coded entity list.
- File naming for the download.

### Deferred Ideas (OUT OF SCOPE)
DXIM-F1 bulk export of multiple dashboards · DXIM-F2 server-to-server migration · DXIM-F3 exporting access grants for same-environment cloning · DXIM-F4 dry-run preview · DXIM-F5 re-import over an existing dashboard. Re-testing `TD-V16-TEST-ISOLATION` attribution (deferred, not this phase's job).

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-------------------|
| DXIM-V124-01 | A dashboard can be exported to a JSON file containing everything needed to recreate it elsewhere | Q1 reference inventory (below) is the completeness argument; Q4 recommends the envelope shape |
| DXIM-V124-02 | The export includes every widget with its full configuration | Q1 confirms `widgets.config` travels as a parsed object, byte-identical, no server-side interpretation needed beyond enumerating referenced entities |
| DXIM-V124-08 | Access grants are NOT exported | Q2/Q3 confirm `dashboard_access_grants` is never read by the export query set; Q3 confirms the export payload is not more sensitive than existing ungated reads (`GET /api/tables`, `GET /api/tables/:id/custom-metrics`) so excluding grants is a pure omission, not a security gate |
</phase_requirements>

## Summary

Export is a **pure-read, single-connection, no-Kinetica-round-trip** operation: every table it touches (`dashboards`, `widgets`, `dashboard_layers`, `dashboard_dynamic_views`, `tables`, `custom_metrics`) is local SQLite, already has a `list*`/`get*` accessor in `db.ts`, and `better-sqlite3` is synchronous — so a single `buildDashboardExport(dashboardId)` function can assemble the whole payload with no transaction and no `requireConfig` (that middleware only guards Kinetica-touching routes; export needs none).

The hard part is completeness, and it is harder than CONTEXT.md's own list. CONTEXT.md names three JSON-embedded reference kinds (`tableId`, `sourceMapWidgetId`, custom-metric refs). Direct inspection of every chart config panel and renderer in `packages/web/src/components/charts/` found **five more**, none of which appear in any planning document to date:

1. `widgets.config.dynamicViewId` (Calendar/Timeline/NumericLine widgets) → `dashboard_dynamic_views.id`
2. `widgets.config.metrics[].metricId` (Timeline/NumericLine — **array**, not scalar) → `custom_metrics.id`
3. `widgets.config.includedLayerIds` (Map widget — **array**) → `dashboard_layers.id[]`
4. `widgets.config.filterSelection.allowedSourceWidgetIds` (every chart widget with a Filter Scope section — v1.18) → mix of `widgets.id` and a **non-id sentinel string** (`SPATIAL_DRAWS_SENTINEL`) that must NOT be remapped
5. `widgets.config.options[].actions[].target` (RadioGroup widget, v1.11/v1.20.2) → **polymorphic**: `{kind:"widget"|"layer"|"dynamicView", id}`, plus a legacy singular `action` field that a naive walk restricted to `actions[]` (plural) would silently skip

Additionally, `dashboard_layers.filter_scope` (a DB column, not nested JSON, but itself JSON-as-TEXT) carries the *same* `allowedSourceWidgetIds` shape as #4 — a sixth site, on a different table.

And one non-JSON finding: `dashboard_tables` (the join table) is an **explicit, independent edge** from `dashboards` — a table can be associated with a dashboard (visible in the "Datasets" tab, drives the Views workflow) without any widget/layer/dv yet referencing it. A walk that only follows widget/layer/dv → table references will silently drop such tables from the export. The correct table set is the **union** of dashboard_tables-associated tables and referenced-table ids.

**Primary recommendation:** implement the walk as an explicit, ordered sequence of pure functions over the already-existing DTOs (reuse `listWidgets`, `listDashboardLayers`, `listDashboardDynamicViews`, `listDashboardTables`, `getTable`, `getCustomMetric`) — not a generic recursive JSON walker. The reference kinds are few, known, and each has a distinct type-dependent extraction rule (scalar vs array vs polymorphic vs sentinel-excluded); a generic "walk all JSON looking for numbers" approach would both over-match (false positives on ordinary numeric config values like `page_size`, `opacity`) and under-match (the legacy `action` singular field, which isn't inside `actions[]`). Route: **extend the dashboards resource family** with `GET /api/dashboards/:id/export`, gated identically to every other per-dashboard GET route (`canViewDashboard` + 404-collapse) — **no new permission needed and none of the speculated `dashboards:create`/`datasets:manage` composition applies to export** (that composition was speculated in REQUIREMENTS.md for *import*, Phase 120's problem).

## Q1 — Complete Reference Inventory

### Method
Started at `dashboards`, walked every table with a `dashboard_id`/`table_id`/`source_table_id` FK in `db.ts`, then grepped the **entire** `packages/web/src/components/charts/` tree plus `lib/actionAllowList.ts`, `lib/widgetAction.ts`, `lib/radioGroupConfig.ts`, `types/filterSelection.ts`, and every `definitions/*.ts` chart-type registration for every field written into `config` that is typed or named as an id. Verified each with the actual read-site code (renderer or `resolveMetricExpr`/`getFieldLocation`-style helper), not just the write-site.

### Column-level (FK / soft-FK) references

| Source | Target | Persisted as | Travels? | Remap on import? |
|---|---|---|---|---|
| `widgets.dashboard_id` | `dashboards.id` | DB column, hard FK | Yes (owned child) | Yes — new dashboard id |
| `dashboard_layers.dashboard_id` | `dashboards.id` | DB column, hard FK | Yes | Yes |
| `dashboard_dynamic_views.dashboard_id` | `dashboards.id` | DB column, hard FK | Yes | Yes |
| `dashboard_tables.dashboard_id` / `.table_id` | `dashboards.id` / `tables.id` | DB column, hard FK (join row) | **Yes — independent edge, see below** | Yes (table_id) |
| `dashboard_layers.table_id` | `tables.id` | DB column, **soft FK (no REFERENCES)** — comment: "layers survive table deletion" | Yes | Yes |
| `dashboard_layers.dynamic_view_id` | `dashboard_dynamic_views.id` | DB column, nullable, **soft FK** — comment: "layer survives dv deletion" | Yes (when non-null) | Yes |
| `dashboard_dynamic_views.source_table_id` | `tables.id` | DB column, hard FK | Yes | Yes |
| `custom_metrics.table_id` | `tables.id` | DB column, hard FK | Yes, for exported metrics only | Yes |
| `dashboard_table_views.dashboard_id`/`table_id` | — | DB column | **No — runtime** (see Q2) | n/a |
| `dashboard_access_grants.dashboard_id` | — | DB column | **No — operator-excluded** (DXIM-V124-08) | n/a |
| `column_display_config.table_id` | `tables.id` | DB column | **No — operator-locked, shared per-table state** | n/a |

**`dashboard_tables` finding (not previously named in any planning doc):** `POST /api/dashboards/:id/layers` (`index.ts:953`) does **not** validate that `table_id` is a member of `dashboard_tables` — a layer can reference any table id directly. Conversely, a table can be added to `dashboard_tables` (via `DashboardsPage.tsx handleAddTable`, which also auto-creates a `dashboard_table_views` placeholder) with **no widget or layer referencing it yet**. These are two independent edges from the same dashboard. **The referenced-table set for export must be the UNION of:** (a) `dashboard_tables` membership, (b) every `widgets.config.tableId`, (c) every `dashboard_layers.table_id`, (d) every `dashboard_dynamic_views.source_table_id`. A walk that only follows (b)-(d) will silently drop tables the designer explicitly associated but hasn't wired into a widget yet.

### JSON-embedded references (the crux of the phase)

All fields below live inside `widgets.config` (a `TEXT` column, already returned **parsed** as `Record<string, unknown>` by `mapWidget()` in `db.ts`) unless noted. Field names are camelCase and consistent across every chart type — confirmed zero `config.table_id` (snake_case) sites; always `config.tableId`.

| Field | Shape | Target entity | Where used (component) | Travels? | Remap on import? |
|---|---|---|---|---|---|
| `config.tableId` | `number` | `tables.id` | ChartConfigPanel (bar/pie/line/scatter/records/bignumber/heatmap), DataFilterConfigPanel, TimelineConfigPanel, NumericLineConfigPanel, CalendarConfigPanel | Yes | Yes |
| `config.tableRef` | `string` "schema.name" | *(not an id — self-describing)* | same panels as `tableId` | Yes (pass-through) | **No** — Phase 120 matches tables by `schema.name` anyway; this string is redundant with the matched id, not a foreign key |
| `config.dynamicViewId` | `number \| undefined` | `dashboard_dynamic_views.id` | **CalendarConfigPanel, TimelineConfigPanel** (NumericLineConfigPanel declares the field, "future-compat", not yet wired to a picker but still round-trips through persisted config) | Yes | Yes — ⚠ new reference kind, not named in CONTEXT.md/ROADMAP |
| `config.sourceMapWidgetId` | `number` | another `widgets.id` | LegendConfigPanel / LegendRenderer | Yes | Yes (already known) |
| `config.metricId` | `number \| undefined` (scalar) | `custom_metrics.id` | ChartConfigPanel (single-metric charts), CalendarConfigPanel | Yes | Yes |
| `config.metrics[].metricId` | `number \| undefined`, **array element** | `custom_metrics.id` | TimelineConfigPanel, NumericLineConfigPanel (multi-metric charts) | Yes | Yes — ⚠ array traversal required; a walk that only checks a scalar `metricId` key misses this |
| `config.includedLayerIds` | `number[] \| undefined` | `dashboard_layers.id[]` | MapConfigPanel / MapChartRenderer / LegendRenderer (legend also reads a bound map widget's `includedLayerIds`) | Yes | Yes — ⚠ array; empty array/undefined is a **sentinel meaning "all layers"**, not "no layers" — must be preserved verbatim, not "expanded" |
| `config.filterSelection.allowedSourceWidgetIds` | `(number \| string)[] \| undefined` | mix of `widgets.id` **and** the literal sentinel string `SPATIAL_DRAWS_SENTINEL` | ChartConfigPanel, CalendarConfigPanel, TimelineConfigPanel, NumericLineConfigPanel (i.e. every widget type with a "Filter Scope" section, v1.18 FSCOPE-V118-01) | Yes | Yes for numeric entries **only** — the sentinel string must pass through unchanged, never treated as an id |
| `config.options[].actions[].target` (RadioGroup) | `{ kind: "widget" \| "layer" \| "dynamicView", id: number }` | polymorphic — dispatches to `widgets.id`, `dashboard_layers.id`, or `dashboard_dynamic_views.id` depending on `kind` | RadioGroupConfigPanel / `lib/radioGroupConfig.ts` / `lib/widgetAction.ts` | Yes | Yes — ⚠ polymorphic remap keyed on `kind`; **also** a legacy singular `config.options[].action` field (pre-Phase-60.2 persisted blobs) carries the identical shape and is normalized only via `getOptionActions()` — a walk that greps `actions\[` and ignores singular `action` silently drops legacy widgets' targets |

**Not a reference (verified, to close off false leads):** the RadioGroup action's `configPatch: Record<string, unknown>` payload (the *values* being patched, e.g. `renderMode`, `opacity`, `metric` column name, `page_size`) was checked against the full allow-list in `lib/actionAllowList.ts` (`WIDGET_ALLOW_LIST`, `LAYER_ALLOW_LIST`, `DYNAMIC_VIEW_ALLOW_LIST`) — **no allow-listed field is itself an id**. Only `target.id` needs remapping; `configPatch` never does. This closes off a plausible but wrong recursion (worrying that a patch might itself contain nested ids).

**Not a reference (verified):** `dashboard_layers.cb_config` and `dashboard_layers.track_config` (JSON-as-TEXT columns, same "opaque blob" shape as `filter_scope`) — grepped `lib/cbConfig.ts` and `lib/trackConfig.ts` for any `Id`-suffixed field: zero matches. These are pure style/threshold config (colors, breakpoints keyed by column value) and travel byte-identical with **no remapping** — worth stating explicitly because a hand-maintained "check the JSON columns on dashboard_layers" list would otherwise have to guess which of the THREE JSON-as-TEXT columns on that table (`cb_config`, `track_config`, `filter_scope`) actually carries ids. Only `filter_scope` does.

**Not a reference (verified):** `dashboard_dynamic_views.columns_json` (`{name, type}[]`), `tables.columns` (`Record<columnName, type>`), `custom_metrics.format_spec` / `column_display_config.format_spec` (the `FormatSpec` discriminated union in `lib/columnFormatter.ts` — checked all five variants, no id field in any of them). None of these carry ids.

### Column-level reference not embedded in JSON, but on a JSON column (sixth site)

| Field | Shape | Target | Travels? | Remap? |
|---|---|---|---|---|
| `dashboard_layers.filter_scope` | JSON-as-TEXT, parsed to `FilterSelectionConfig` (identical shape to widget's `filterSelection`) | `widgets.id[]` (+ sentinel) | Yes | Yes, same rule as widget `filterSelection` |

## Q2 — Runtime vs Durable State

Checked every table for cluster-specific names, TTLs, statuses, or session state, beyond the two already named:

| Table | Travels? | Reason |
|---|---|---|
| `dashboard_table_views` | **No** | `view_name`, `status` ('pending'/'created'/'error'), `error_message` — a specific Kinetica cluster's materialized filter-view bookkeeping with a TTL lifecycle (`updateViewStatus`/`updateViewFilter`). Confirmed by the schema comment and by `db.ts`'s own `filter_clause`/`status` shape. |
| `dashboard_dynamic_views` | **Yes — durable, not runtime** | This is the one CONTEXT.md flagged as "the interesting case." `template_sql`, `max_records`, `name`, `source_table_id` are all durable DEFINITION fields the operator authored (mirrors a saved query). `columns_json` is cached column metadata refreshed on Preview/Save — durable cache, not cluster-specific identity (no view name, no cluster-specific materialized-view handle is stored here; `buildDynamicViewName()` computes the actual Kinetica view name **at runtime**, per the schema comment at `db.ts:120-121`, and is never persisted). So the *definition* travels in full; there is no runtime half to strip. |
| `sessions` | No | Encrypted per-user Kinetica credentials + cookie session state — has no dashboard FK at all, out of scope by construction. |
| `dashboard_access_grants` | No | Operator-excluded (DXIM-V124-08). |
| `column_display_config` | No | Operator-locked (shared per-table, not per-dashboard — has no `dashboard_id` at all; it's keyed by `table_id` alone). |
| `custom_metrics` | Yes (referenced subset) | Definitional (label + SQL expression), not runtime. Confirmed no TTL/status/cluster fields. |
| `dashboard_tables` | Yes | Pure association row (`dashboard_id`, `table_id`, `created_at`) — no runtime fields. |

**No additional runtime tables found** beyond `dashboard_table_views`. `sessions`, `rbac_*`, `known_users`, `brand_config` have no dashboard FK and are out of scope by construction (not walked from `dashboards` at all).

## Q3 — Permissions

**Finding that overturns the REQUIREMENTS.md speculation:** `PERMISSIONS.DASHBOARDS_VIEW` (`"dashboards:view"`) exists in the catalog and is mapped to every built-in role, but **`requirePermission(PERMISSIONS.DASHBOARDS_VIEW)` is never called anywhere in `index.ts`** (grep confirms zero call sites). Every existing per-dashboard **GET** route instead uses the established idiom:

```ts
// index.ts:876-880 (widgets), :915-919 (tables), :946-950 (layers), :1040-1044 (views),
// :1584-1586 (dynamic-views) — five existing sites, all byte-identical in shape
const username = (req as AuthedRequest).user!.creds.username;
if (!getDashboard(id) || !canViewDashboard(username, id)) {
  return res.status(404).json({ error: "Dashboard not found." });
}
```

`canViewDashboard()` (`lib/dashboardAccessDb.ts`) already implements exactly the composition REQUIREMENTS.md was speculating about: bypass check on `dashboards:manage_access` (admin/designer/custom bypass roles), then direct user grant, then role grant, else false (private-by-default). **This is the correct answer to Q3: compose nothing new — mirror the five existing sibling GET routes verbatim.** `GET /api/dashboards/:id/export` needs no `requirePermission()` call at all beyond the global `app.use("/api", requireAuth)` wall already mounted above all dashboard routes; the `canViewDashboard` 404-collapse **is** the access control, and it is the identical control every other per-dashboard read already uses.

**Non-leak property confirmed:** the same 404-for-both-cases pattern must be used for export, i.e. `if (!getDashboard(id) || !canViewDashboard(username, id)) return res.status(404)...` — never split into a 404 (not found) + 403 (found but denied), which would let an unauthorized user learn a dashboard id exists.

**Why the REQUIREMENTS.md-speculated `dashboards:create` + `datasets:manage` composition does NOT apply here:** that combination was speculated for **import** (Phase 120 — creating dashboards and possibly table registry rows), not export. Export creates nothing and needs only read/view access. Conflating the two would over-gate export (e.g. blocking an analyst who can view a dashboard from exporting the exact same data they can already see via `GET .../widgets`, `.../layers`, etc.) for no security benefit.

**Confirmed non-escalation:** the export payload discloses nothing beyond what's already reachable today by any authenticated user with **zero** dashboard-specific permission: `GET /api/tables` (line 2348, `requireAuth` only — no gate) lists every table + columns in the system; `GET /api/tables/:tableId/custom-metrics` (line 2421, `requireAuth` only) lists every metric for any table id. So bundling tables/metrics into an export gated at dashboard-view level is **strictly less exposed** than what's already ungated.

**Ripple avoided:** since no new permission is introduced, none of the four known ripple sites are touched — verified counts, current state:
- `packages/server/tests/lib.permissions.spec.ts:53` — `expect(ALL_PERMISSIONS.length).toBe(18)`
- `packages/server/tests/lib.permissions.spec.ts:144` — "admin has exactly 18 permissions"
- `packages/server/tests/db.rbacMigration.spec.ts:178` — "admin role maps to exactly 18 permissions"
- `packages/web/src/components/RolesPage.spec.tsx:141` — "renders 18 permission checkboxes in 6 group sections"

A plan that adds a permission MUST touch all four; a plan that doesn't need to (this one) should explicitly say so in its acceptance criteria so a reviewer isn't left wondering whether the ripple was missed vs. genuinely avoided.

## Q4 — Format and Versioning

**Re-embed JSON-as-TEXT columns as parsed JSON, not raw text.** Argument: every accessor this phase would call already hands back parsed objects — `mapWidget()` parses `config`, `mapDashboardLayer()` parses `config` and `filter_scope` (only `cb_config`/`track_config` remain raw strings, which is fine since they carry no ids). Phase 120 has to rewrite ids **inside** these blobs; doing that against a live JS object (`widget.config.tableId = newId`) is trivial and safe, whereas string-level regex rewriting of a serialized JSON blob risks corrupting escaped characters or colliding with an unrelated substring (e.g. a numeric id appearing inside an unrelated string value). Recommend export literally reuses `listWidgets`/`listDashboardLayers`/`listDashboardDynamicViews`/`getTable`/`getCustomMetric` — the same functions the existing GET routes already call — rather than writing new SQL. This also means **zero schema change and zero new DB accessor logic** is needed; export is assembly + dedup over existing reads.

**Version field: a plain incrementing integer**, not semver. Recommend a top-level `schemaVersion: 1`. Reasoning: Phase 120 only needs "do I understand this shape or not" — an integer comparison (`version > SUPPORTED_MAX` → reject) is simpler than semver-range parsing, and this codebase already uses plain sequential integers for its own forward-compat mechanism (the PRAGMA-guarded `ALTER TABLE` migration blocks in `db.ts` are conceptually the same "each version knows how to read/upgrade the previous one" pattern). The internal action-engine's `ALLOW_LIST_VERSION = "v2"` string tag is a *different* kind of versioning (an internal contract between two modules shipped together, not a long-lived interchange file) — not a precedent to copy here.

**Provenance recommendation:** include `exportedAt` (ISO-8601 UTC timestamp) at minimum. **Do NOT include** hostname, `KINETICA_URL`, DB path, or the exporting username — the file may be attached to a support ticket or committed to a repo outside the org's trust boundary, and any of those would leak infra topology or identify an individual. An app-name + app-semver-version field (`generator: {app: "kinetica-bi", version: "..."}`) is optional/low-value here: `GET /api/health` already hardcodes a stale, unsynced `"version": "0.1.0"` rather than reading `package.json`, so there is no existing "read the real app version at runtime" pattern in this codebase to reuse, and introducing one (ESM JSON import, `resolveJsonModule` considerations) is more machinery than the requirement needs. Recommend keeping provenance to `schemaVersion` + `exportedAt` only, and treating a richer `generator` block as optional planner discretion, not a requirement.

**Pretty-print the JSON** (`JSON.stringify(payload, null, 2)`), not minified — CONTEXT.md's own rationale for the file format is "can be reviewed, diffed, version-controlled, or attached to a ticket," which a minified single-line blob defeats.

## Q5 — Route Shape and Delivery

**Extend the dashboards resource family**: `GET /api/dashboards/:id/export`, placed alongside the existing sibling GETs (`.../widgets`, `.../tables`, `.../layers`, `.../views`, `.../dynamic-views`) in `index.ts`, using the identical `getDashboard(id) + canViewDashboard` 404-collapse (see Q3). This is more consistent with the existing REST-nesting convention in this codebase than a standalone top-level route, and it means the route slots into the same file, same auth wall, same style as everything around it — zero new middleware to design.

**No `requireConfig`** — that middleware exists solely to guard routes that make a live Kinetica connection (`if (!process.env.KINETICA_URL) return 500`). Export never touches Kinetica; every table it reads is local SQLite. Applying `requireConfig` here would be a copy-paste error, not a requirement.

**Delivery:** `res.setHeader("Content-Disposition", 'attachment; filename="..."')` + `res.setHeader("Content-Type", "application/json")` + `res.send(JSON.stringify(payload, null, 2))`. (Using `res.json()` after `res.attachment()` also works, but explicit `send` avoids Express re-deriving `Content-Type` from the attachment filename's extension, which is not guaranteed to be `.json` if the operator later wants a different suggested name.) Filename suggestion: server may propose something like `dashboard-${slugify(name)}-${id}-export.json` — Phase 121 owns the actual browser download UX and may override it, but the route contract (this phase) should return a sensible default so `curl -O` / a raw browser navigation produces a usable filename.

**Precedent check — none exists for downloads.** Grepped the entire server source for `Content-Disposition`, `res.download`, `res.attachment`: **zero hits.** `multer` (already a dependency, `^2.2.0`) is exclusively an **upload** precedent (`POST /api/branding/logo`, v1.16 Phase 81) — irrelevant to export (a GET with no request body). `GET /api/branding/logo` is the closest existing "serve bytes" precedent but is deliberately **inline** (`<img src>`, no `Content-Disposition`) — the opposite intent from a download. This means Q5's delivery mechanism is new territory for this codebase, but it is standard Express (`res.setHeader` + `res.send`), needs **zero new dependency**, and is low-risk.

## Q6 — Test Infrastructure

**Reusable fixtures confirmed, no new test infra needed:**
- `packages/server/tests/helpers/app.ts` — `buildTestApp()` → `supertest` agent against `createApp()`. Every route spec in this repo uses it.
- `packages/server/tests/helpers/db.ts` — `createAdminSession()` returns `{ sid, cookie }` via the bootstrap-admin short-circuit (no `user_roles` row needed); the analyst-session idiom (`seedAnalystSession`, no `user_roles` row → analyst fallback) is inlined per-spec (see `tests/routes.custom-metrics.spec.ts:57-63`) and should be copied verbatim, not re-abstracted.
- Standard `beforeEach(() => db.exec("DELETE FROM sessions"))` cleanup pattern used by every route spec touching auth.

**A close structural precedent to model the new spec on:** `tests/routes.custom-metrics.spec.ts` — same shape of concern (per-table/per-dashboard resource, admin-vs-analyst permission behavior, JSON round-trip assertions, explicit "permission catalog parity" checks at the bottom of the file). Recommend the new `tests/routes.dashboard-export.spec.ts` mirror its structure.

**Server suite is SET-BASED — current exact state as of this research (2026-09-16), full run:**
```
Full run: 963/1018 tests passed; 9 file(s) failing.
Known-failing (allowed, 8): tests/auth.oidc.spec.ts, tests/auth.routes.spec.ts,
  tests/boot.hardening.spec.ts, tests/boot.wipe.spec.ts, tests/bootstrap.spec.ts,
  tests/db.smoke.spec.ts, tests/oidc.module.spec.ts, tests/routes.wms.spec.ts
Not on the known list (1): tests/routes.filter-materialize.spec.ts -> PASSES alone
  (TD-V16-TEST-ISOLATION contamination, allowed)
GATE PASSED.
```
A plan's acceptance criteria for the server gate MUST be phrased as **"`node scripts/test-gate.mjs` exits 0"** (or "GATE PASSED" in its output) — **never** "N/N tests pass" or any fixed count; both the total (1018) and the known-failing set will drift as this phase adds spec files, and the isolation-only failure is expected to vary run-to-run by design.

**Baselines also confirmed clean, same session:**
- `cd packages/server && npx tsc --noEmit` → clean (zero output).
- `cd packages/web && npx tsc --noEmit` → clean (zero output).
- `cd packages/web && npx vitest run` → **176 files / 4025 tests, all passed** (matches `STATE.md`'s recorded v1.23 baseline exactly — no drift since the last shipped milestone).

**Recommended shape for the highest-value test (per CLAUDE.md acceptance-criteria discipline and the phase's own risk profile):** a single "kitchen sink" integration test that seeds one dashboard exercising **every** reference kind found in Q1 in one fixture, then asserts completeness — not just "the response is 200":

1. Seed: 1 dashboard; a bar widget with `tableId` + `metricId`; a map widget with `includedLayerIds` naming 2 layers; a legend widget with `sourceMapWidgetId` pointing at the map widget; a numericline widget with `metrics[].metricId` (array) AND `filterSelection.allowedSourceWidgetIds` naming a sibling widget id **and** the literal `SPATIAL_DRAWS_SENTINEL` string; a calendar widget with `dynamicViewId`; a radiogroup widget with three actions whose targets are `{kind:"widget"}`, `{kind:"layer"}`, `{kind:"dynamicView"}` respectively; 2 layers (one table-bound, one dv-bound) where the dv-bound layer's `filter_scope.allowedSourceWidgetIds` names yet another widget; 1 dynamic view; 1 custom metric (referenced) + 1 sibling custom metric on the same table that NO widget references; 1 table associated via `dashboard_tables` but referenced by nothing; 1 `dashboard_access_grants` row; 1 `column_display_config` row; 1 `dashboard_table_views` row.
2. Assert **inclusion**: every widget id present; both layers present with `cb_config`/`track_config`/`filter_scope` preserved verbatim; the dynamic view present; the referenced custom metric present; **all four** distinct tables present (widget-referenced, layer-referenced, dv-source, and the dashboard_tables-only orphan — this specifically proves the union-of-sources finding, not just the widget-derived subset).
3. Assert **exclusion** (the mutation-probe half — each should currently, before the work, be trivially true of an EMPTY response, so each needs a positive seed to be meaningful): the unreferenced sibling custom metric is **absent** from `customMetrics` (proves "referenced only," not "all metrics for any touched table"); the access-grant's distinctive `grantee` string does not appear anywhere in the serialized JSON; the `column_display_config` row's distinctive `label` does not appear; the `dashboard_table_views` row's distinctive `view_name` does not appear.
4. Mutation probe: assert the exported legend widget's `sourceMapWidgetId` equals the ORIGINAL map widget's id exactly (proves export does no remapping — Phase 120's job) — then, as a probe that the assertion itself discriminates, temporarily corrupt the fixture's expected id in a throwaway copy of the test and confirm it fails, per the mutation-probe standard set by Phase 118 (26/26 firing).

## Grep-Based Acceptance Criteria (run BEFORE any code, all currently 0 as required by CLAUDE.md)

All of the following candidate anchor symbols were checked with the exact commands below, run 2026-09-16 against the current tree (`git status` shows unrelated in-flight heatmap work in `packages/web`, none of it touching `packages/server` — server tree is clean relative to `HEAD`):

| Candidate symbol | Command | Current count | Verdict |
|---|---|---|---|
| `exportDashboard` | `grep -rn "exportDashboard" packages/server/src packages/web/src packages/server/tests \| wc -l` | 0 | Safe anchor — the work introduces this |
| `DashboardExport` | same pattern | 0 | Safe |
| `buildDashboardExport` | same pattern | 0 | Safe |
| `EXPORT_SCHEMA_VERSION` | same pattern | 0 | Safe |
| `schemaVersion` | same pattern | 0 | Safe |
| `walkDashboardGraph` | same pattern | 0 | Safe (only if the planner adopts this exact function name — pick ONE real symbol the plan actually introduces, do not pre-commit to a name the plan might not use) |
| `dashboards/:id/export` | same pattern | 0 | Safe — confirms no existing route collides with the proposed path |
| `routes.dashboard-export.spec.ts` (file existence) | `test -f packages/server/tests/routes.dashboard-export.spec.ts` | absent | Safe — new file |
| `ALL_PERMISSIONS.length).toBe(18)` (ripple-avoidance proof) | `grep -c "toBe(18)" packages/server/tests/lib.permissions.spec.ts` | 2 (lines 53, 144) | **Use as a "still 18, unchanged" NEGATIVE-space check** — a plan proving no new permission was added should assert this STILL passes post-change, not that it newly appears |
| "renders 18 permission checkboxes" | `grep -c "renders 18 permission checkboxes" packages/web/src/components/RolesPage.spec.tsx` | 1 | Same — assert it still passes unchanged, do not treat "1" as something the plan creates |

**Guidance for the planner:** do not anchor on `Content-Disposition` or `res.setHeader` — both already occur multiple times in `index.ts` for unrelated routes (branding), so a criterion like `grep -c "Content-Disposition"` would not discriminate the new route from existing ones. Anchor instead on the literal route path string (`/api/dashboards/:id/export` or whatever final path is chosen) or on a newly-introduced function/constant name, verified absent first exactly as done above.

## Sources

### Primary (HIGH confidence — direct code inspection, this repo, 2026-09-16)
- `packages/server/src/db.ts` (full file) — schema DDL, soft-FK comments, all `map*`/`list*`/`get*`/`create*` accessors
- `packages/server/src/index.ts` (full route table + lines 440-1046, 2421-2490) — every dashboard/widget/layer/dynamic-view/custom-metric route, the branding upload/logo-serve precedent, `requireConfig` definition
- `packages/server/src/rbac.ts`, `packages/server/src/lib/permissions.ts`, `packages/server/src/lib/dashboardAccessDb.ts`, `packages/server/src/lib/rbacDb.ts` — permission catalog, `canViewDashboard` resolution order
- `packages/server/scripts/test-gate.mjs` — SET-BASED gate mechanics and current `KNOWN_FAILING` map
- `packages/server/tests/helpers/{app,db}.ts`, `packages/server/tests/routes.custom-metrics.spec.ts` — reusable test fixtures and structural precedent
- `packages/web/src/api/client.ts` — `DashboardDto`, `TableDto`, `WidgetDto`, `DashboardLayerDto`, `DynamicViewRow` wire shapes
- `packages/web/src/components/charts/{ChartConfigPanel,CalendarConfigPanel,TimelineConfigPanel,NumericLineConfigPanel,MapConfigPanel,LegendConfigPanel,LegendRenderer,RadioGroupConfigPanel,MapChartRenderer,DataFilterConfigPanel}.tsx` and `definitions/*.ts` — every widget-config id-reference site
- `packages/web/src/lib/{customMetricSql,radioGroupConfig,widgetAction,actionAllowList,cbConfig,trackConfig,columnFormatter}.ts`, `packages/web/src/types/filterSelection.ts` — field shapes, allow-list contents, FormatSpec variants (verified no ids)
- `.planning/phases/119-export/119-CONTEXT.md`, `.planning/REQUIREMENTS.md`, `.planning/ROADMAP.md` §Phase 119/120 — locked decisions and scope boundary

### Secondary / Tertiary
None used — no WebSearch or Context7 lookups were needed; this phase has zero third-party library surface (no new dependency, per constraint) and the entire problem is internal to this codebase.

## Metadata

**Confidence breakdown:**
- Reference inventory (Q1): HIGH — every entry verified against both a write-site and a read-site in the actual source, not inferred from naming
- Runtime-vs-durable (Q2): HIGH — every table in the schema was checked, not just the two named in CONTEXT.md
- Permissions (Q3): HIGH — verified by grepping for actual `requirePermission()` call sites, not by reading the permission catalog in isolation
- Format/route (Q4/Q5): HIGH on what NOT to do (no precedent, no new dependency needed); MEDIUM on the exact field-naming bikeshed (explicitly Claude's Discretion per CONTEXT.md)
- Test infra (Q6): HIGH — gates actually run this session, exact current counts reported, not estimated

**Research date:** 2026-09-16
**Valid until:** ~30 days, or immediately upon the next phase touching `widgets.config` shapes (a new chart type or a new config-panel field could introduce a 9th reference kind — re-grep `components/charts/` before trusting this inventory once v1.25+ work lands)
