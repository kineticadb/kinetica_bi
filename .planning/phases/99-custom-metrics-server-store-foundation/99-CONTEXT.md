# Phase 99: Custom Metrics — Server + Store Foundation - Context

**Gathered:** 2026-06-30
**Status:** Ready for planning

<domain>
## Phase Boundary

Build the server + client foundation for per-table custom metrics: a `custom_metrics` SQLite table (label + SQL aggregate expression + optional default format), full CRUD endpoints, and a client zustand store that loads/exposes a table's metrics. This is the foundation Phase 100 (Tables-area editor + metric-picker integration) consumes — NO editor UI and NO picker integration in this phase. Mirrors the v1.15 `column_display_config` pattern across both stacks.

Covers: METRIC-V119-01 (server-persistence portion only — the Tables-area authoring UI is Phase 100), METRIC-V119-02.

</domain>

<decisions>
## Implementation Decisions

### Metric identity / key model
- **Stable opaque id.** Primary key is a generated `id` (SQLite `INTEGER PRIMARY KEY AUTOINCREMENT`); `table_id` is a separate indexed column. Widgets (Phase 100) reference the metric by `id`, so editing a metric's label/expression never orphans a widget reference.
- CRUD route verbs follow from id-keying: `POST /api/tables/:tableId/custom-metrics` (create, server generates id), `PUT /api/tables/:tableId/custom-metrics/:id` (update), `DELETE /api/tables/:tableId/custom-metrics/:id`, `GET /api/tables/:tableId/custom-metrics` (list per table). (This is the ONE deliberate divergence from column_display_config's pure PUT-upsert-by-name — a custom metric has no natural key.)

### Metric fields
- Each metric stores: `id`, `table_id`, `label` (display string), `expression` (raw SQL aggregate, e.g. `SUM(revenue)/SUM(cost)`), `format_spec` (**optional** default number format — reuse the v1.15 `FormatSpec` union, stored JSON-as-TEXT, NULL = none), `created_at`, `updated_at`.
- `format_spec` is the optional default display format a metric carries; reuse `packages/web/src/lib/columnFormatter.ts` `FormatSpec` + `buildFormatter`. NULL/absent → no metric-level format (render surfaces fall back to the existing column-format system / identity).

### Validation + constraints (write)
- Require **non-empty `label`** AND **non-empty `expression`** (trim-checked) → 400 on violation.
- **Unique label per table:** `UNIQUE(table_id, label)` constraint; server rejects a duplicate label on the same table (409 / clear error). (Rename to an existing label is also rejected.)
- **NO SQL parsing / no aggregate-shape enforcement / no sandbox** — the expression is trusted raw SQL bounded by the user's own Kinetica creds (REQUIREMENTS out-of-scope row). The expression is NOT validated for being an aggregate; a bad expression simply fails at widget read time (surfaced there in Phase 100, not here).

### CRUD + store shape (mirror column_display_config exactly)
- **Server:** `GET` is ungated (`requireAuth` only — analysts can read metrics to use them); `POST` / `PUT` / `DELETE` gated by `...requirePermission(PERMISSIONS.DATASETS_MANAGE)` (the spread-array middleware pattern). **NO new RBAC permission** — reuse `datasets:manage`; byte-parity permission catalog unchanged on both stacks (assert via the existing parity check). DB layer mirrors the `list/get/upsert/delete` + `map*` (JSON parse on read) functions in `db.ts`.
- **Client store** (`customMetricsStore`, mirroring `columnDisplayConfigStore`): keyed by `table_id`; `setConfig(tableId, rows)` REPLACE semantics; monotonic `configVersion` bumped on every mutation (incl. byte-identical payloads — Pitfall 5); `removeMetric` strict no-op when absent (no ref change, no version bump); `loadConfig(tableId)` fetch+setConfig; `reset()` hard-set to empty (wired into the dashboard lifecycle reset chain like the v1.15 store). Expose a selector that returns a table's metrics for consumers (Phase 100 picker + editor).
- **API client + types:** add `listCustomMetrics` / `createCustomMetric` / `updateCustomMetric` / `deleteCustomMetric` to `packages/web/src/api/client.ts`; `CustomMetricRow` type mirrored server (`packages/server/src/types.ts`) ↔ web.

### Test gates (this is the milestone's only server-touching phase besides 94-style work)
- Server: supertests in BOTH auth modes (password + oidc) via the JWT-cookie idiom (admin 200, analyst 403 on writes, ungated GET, create→update→delete lifecycle, unique-label rejection, format_spec JSON round-trip); server `tsc` clean; server vitest SET-BASED ⊆ TD-V16-TEST-ISOLATION (NEVER a fixed pass-count).
- Client: web vitest 100% from `packages/web`; web `tsc` clean; theme-guard green (foundation phase adds store/types/api — no new components/CSS expected).

### Claude's Discretion
- id type detail (autoincrement INTEGER vs uuid TEXT) — autoincrement INTEGER recommended (matches SQLite idioms here); planner decides.
- Exact route path segment (`custom-metrics`), DB function names, store/selector names.
- Whether `format_spec` reuses the exact `FormatSpec` union as-is or a thin alias.

</decisions>

<specifics>
## Specific Ideas

- "The tables need a way to add a custom metric to each table. These custom metrics need to be selectable in the visualizations which configure metrics." (The selectable-in-pickers half is Phase 100; this phase persists + exposes them.)
- A custom metric = a labeled SQL aggregate expression (e.g. `SUM(revenue)/SUM(cost)`), applied with no further aggregation wrapper at use time (Phase 100).

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.** No external specs/ADRs — the canonical source is the v1.15 `column_display_config` implementation to mirror:

### Requirements
- `.planning/REQUIREMENTS.md` §"Custom Metrics per Table (METRIC)" — METRIC-V119-01 (server portion here) / -02; + the "New RBAC permission for custom metrics" Out-of-Scope row (reuse `datasets:manage`) and "Sandboxing / parsing of user SQL" row.
- `.planning/ROADMAP.md` §"Phase 99: Custom Metrics — Server + Store Foundation" — goal, invariant, 4 success criteria.

### Precedent to mirror (v1.15 column_display_config — from codebase scout)
- `packages/server/src/db.ts` §~237–246 (table DDL), §~882–936 (`mapColumnDisplayConfig` JSON-parse-on-read + `list/get/upsert/delete` functions).
- `packages/server/src/index.ts` §~2369–2398 (GET ungated, PUT/DELETE `requirePermission(DATASETS_MANAGE)`).
- `packages/server/src/rbac.ts` §~44–72 (`requirePermission` spread-array middleware) + `packages/server/src/lib/permissions.ts` §~18–37 (`PERMISSIONS.DATASETS_MANAGE`, NO new permission).
- `packages/server/tests/routes.column-display-config.spec.ts` (dual-auth JWT-cookie test idiom: `createAdminSession`, `seedAnalystSession`, admin-200/analyst-403, lifecycle, round-trip).
- `packages/web/src/store/columnDisplayConfigStore.ts` (store shape: keyed by table_id, setConfig REPLACE, configVersion, strict-no-op remove, loadConfig, reset).
- `packages/web/src/api/client.ts` §~1571–1611 (`ColumnDisplayConfigRow` type + list/upsert/delete client fns) and `packages/server/src/types.ts` §~105–112 (server row type).
- `packages/web/src/lib/columnFormatter.ts` §~22–48 (`FormatSpec` union + `buildFormatter`) — reused for the optional `format_spec`.
- `packages/web/src/lib/permissions.ts` §~10–29 (byte-parity catalog).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets (mirror these)
- **DB layer:** `db.ts` SCHEMA_DDL block + the four `column_display_config` CRUD functions + `map*` JSON-parse helper — copy the shape for `custom_metrics` (PK `id` AUTOINCREMENT, `table_id` indexed, `UNIQUE(table_id, label)`, `format_spec` TEXT-JSON nullable).
- **Routes:** `index.ts` column-display-config block — copy GET-ungated / write-gated structure; adapt verbs to POST(create)/PUT:id/DELETE:id.
- **Permission middleware:** `rbac.ts` `requirePermission(PERMISSIONS.DATASETS_MANAGE)` spread-array.
- **Server spec:** `routes.column-display-config.spec.ts` — copy the dual-auth idiom + assertions; add unique-label-rejection + id-lifecycle cases.
- **Client store:** `columnDisplayConfigStore.ts` — copy verbatim shape; adapt to id-keyed metric rows + a list-per-table selector.
- **Types + API client:** `types.ts` row type + `client.ts` CRUD fns — mirror.
- **Formatter:** `columnFormatter.ts` `FormatSpec`/`buildFormatter` for the optional default format.

### Established Patterns
- JSON-as-TEXT storage (parse on read, null-guard). Upsert/idempotency + monotonic store `configVersion`. Reset wired into the dashboard lifecycle cleanup chain (App.tsx / DashboardsPage.tsx) like the v1.15 store.
- Byte-parity permission catalog server↔web; NO new permission introduced.

### Integration Points
- New `custom_metrics` table in `db.ts` SCHEMA_DDL + CRUD fns; new routes in `index.ts`; new `customMetricsStore` + reset wiring; new API client fns + shared row type. Phase 100 consumes the store selector (picker) + the editor writes via the API client.

### Invariants
- `AggregatedWidgetRenderer` stays the SOLE materialize trigger — custom metrics are config CRUD + (in Phase 100) a read-time SQL fragment, NEVER a new materialize path. NO new RBAC permission. Server set-based test gate ⊆ TD-V16-TEST-ISOLATION.

</code_context>

<deferred>
## Deferred Ideas

- **Tables-area editor UI + metric-picker integration** — that's Phase 100 (the next phase), not this foundation. Do NOT build UI here.
- Row-level computed columns (non-aggregate) — METRIC-V2-01 (future milestone).
- Per-dashboard custom-metric overrides — METRIC-V2-02 (v1.19 is global per-table).

</deferred>

---

*Phase: 99-custom-metrics-server-store-foundation*
*Context gathered: 2026-06-30*
