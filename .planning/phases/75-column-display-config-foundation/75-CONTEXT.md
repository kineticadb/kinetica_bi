# Phase 75: Column Display Config Foundation - Context

**Gathered:** 2026-06-19
**Status:** Ready for planning

<domain>
## Phase Boundary

Persist a GLOBAL per-table column display config (custom label + format spec, keyed by `table_id` + `column_name`) server-side with CRUD endpoints; build a PURE client-side formatter library; and build a client store + helpers (`resolveLabel`, `resolveFormatter`) that load a table's config. This is the FOUNDATION reused by the editor UI (Phase 76) and every render surface (Phase 77).

**In scope:** the server table + CRUD, the pure formatter lib, the client store/helpers, the `d3-format` web dependency.
**NOT in scope (later phases):** the editor UI (Phase 76); applying labels/formatting at render surfaces — records-table, chart tooltips/axes/series, map popups (Phase 77). The map layers legend is permanently EXCLUDED from formatting.

**Locked upstream (do NOT re-litigate):** config is GLOBAL per-table (not per-dashboard); formatting is CLIENT-SIDE ONLY and never constructs or mutates the SQL sent to Kinetica.

</domain>

<decisions>
## Implementation Decisions

### Format menu & options (the operator-facing formatting catalog)
- **Numbers — full set:** thousands separator (on/off), fixed decimal places (0–N), currency (with configurable symbol), percent, AND an advanced **d3-format string** escape hatch for anything the presets don't cover.
- **Dates/timestamps:** a short list of **common presets** (e.g. `2026-06-19`, `Jun 19, 2026`, `06/19/2026`, a with-time variant `… HH:mm`, optionally relative) PLUS a **custom date-pattern** string escape hatch.
- **Currency:** operator-configurable symbol/prefix, default `$`, placed BEFORE the number.
- **Percent:** appends `%` and does **NOT** multiply by 100 (a stored `42` renders `42%`, treating the value as already a percentage).
  - ⚠️ **Planner note:** d3-format's native `%` type DOES multiply by 100. So the percent **PRESET** must NOT be implemented via d3's `%` type — use a `%`-suffixed numeric format (e.g. format the number then append `%`) to avoid surprise ×100 scaling. The **advanced d3 escape-hatch** field, by contrast, passes the operator's string straight to d3-format with raw d3 semantics (so a power user typing `.1%` there WILL get ×100 — that's expected for the escape hatch).

### Write-gating
- **Writes (create/update/delete)** gated by **`datasets:manage`** (`PERMISSIONS.DATASETS_MANAGE`) — the same gate as `/api/tables` CRUD (`index.ts:2077/2085/2092`). The config is per-table and the Phase 76 editor lives in the Tables area, so table managers manage display config. No new permission, no seed change, no web byte-parity work (admin + designer already hold it).
- **Reads ungated** — any authenticated viewer can read a table's display config so render surfaces (Phase 77) resolve labels/formatters regardless of the viewer's role.

### Formatter edge behavior (pure lib — never throws, never crashes a render)
- **Type mismatch** (spec says `number` but value is null/empty/non-numeric string) → return the **raw value unchanged** (never `NaN`).
- **Null/undefined values** → **pass through as-is** (do NOT coerce to `''` or a placeholder). Each render surface decides how to display blanks.
- **Invalid/unparseable d3-format string or custom date pattern** → wrap in try/catch, **fall back to the raw value**, never throw, never apply a surprise default. (The Phase 76 live preview is where operators catch bad patterns.)
- **Empty/absent spec** → identity passthrough. (Consistent with the COLCFG-V115-02 locked rule.)

### Config CRUD granularity & client store
- **Per-column upsert:** each `(table_id, column_name)` row is created/updated/deleted independently (per-column write + per-column delete). The read endpoint returns ALL rows for a `table_id`. The Phase 76 editor saves only changed columns; smaller payloads; natural row granularity.
- **Client store:** **fetch-per-table, cached by `table_id`, version-bumped on edit** — mirroring the existing `filterViewStore` / `dynamicViewStore` Zustand patterns. Load a table's full config on demand (when a dashboard/widget using that table renders); render surfaces read from cache via `resolveLabel(col) → label ?? rawName` and `resolveFormatter(col) → fn ?? identity`.

### Claude's Discretion
- Exact `format_spec` JSON schema (discriminated union by kind: `number` | `date` | `d3` advanced | `none`) — store as a JSON-in-TEXT column following the `dashboard_dynamic_views.columns_json` precedent.
- Exact preset list contents and labels for dates (pick sensible common ones).
- Store file layout, version-counter naming, and selector shapes (mirror existing stores).
- Endpoint URL shapes and request/response DTOs.
- Default format-kind inference from `inferDataTypeFromColumn` (number→number, datetime→date, else→none/string).

</decisions>

<specifics>
## Specific Ideas

- Follow the `dashboard_dynamic_views` table for the storage pattern: a `columns_json TEXT` JSON-in-TEXT column is the established precedent for structured per-row config; `format_spec` should be the analogous TEXT-JSON column.
- Mirror `filterViewStore` / `dynamicViewStore` for the client store (on-demand per-table load + version bump on mutation) — the operator/team is familiar with that pattern from v1.3/v1.6.
- The `datasets:manage` gate keeps display-config management co-located with table management in the operator's mental model.

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Server — table + CRUD + gating
- `packages/server/src/db.ts` — `SCHEMA_DDL`; add `column_display_config` table. Storage precedent: `dashboard_dynamic_views` (`db.ts:119`) with its `columns_json TEXT` JSON-in-TEXT pattern.
- `packages/server/src/index.ts:2077` / `:2085` / `:2092` — `/api/tables` POST/PATCH/DELETE gated by `requirePermission(PERMISSIONS.DATASETS_MANAGE)`; the gating + CRUD pattern to mirror for column-config writes.
- `packages/server/src/lib/permissions.ts` — `PERMISSIONS.DATASETS_MANAGE` (`"datasets:manage"`); the write-gate. No catalog change needed.
- `packages/server/src/rbac.ts` — `requirePermission` factory (imported at `index.ts:108`).

### Web — formatter lib + types + store
- `packages/web/src/lib/columnTypes.ts:85` — `inferDataTypeFromColumn(colName, columns)` → `"number" | "boolean" | "datetime" | "string" | "null"`; drives default format-kind per column. `TableDto.columns` is `Record<string,string>` (column → Kinetica DATA_TYPE).
- `d3-format` — NEW dependency in `packages/web` only; the numeric formatter + advanced escape hatch use it. Pure lib — zero server/SQL coupling. (Use Context7 `mcp__plugin_context7_context7__*` for current d3-format API when planning.)
- Existing store precedents for the client config store: `filterViewStore` (v1.3) and `dynamicViewStore` (v1.6) — on-demand load + version-bump-on-mutation Zustand pattern.

### Requirements
- `.planning/REQUIREMENTS.md` — COLCFG-V115-01 (server CRUD, global per-table), COLCFG-V115-02 (pure formatter, invalid/empty→raw), COLCFG-V115-03 (store + resolveLabel/resolveFormatter fallbacks).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `dashboard_dynamic_views` table + its CRUD/`columns_json` handling — storage + JSON-in-TEXT template for `column_display_config`.
- `requirePermission(PERMISSIONS.DATASETS_MANAGE)` — drop-in write-gate, already used by `/api/tables`.
- `inferDataTypeFromColumn` (`columnTypes.ts:85`) — reuse to pick the default format kind per column.
- `filterViewStore` / `dynamicViewStore` — Zustand store shape (per-key cache + version counter) to mirror for the column-config store.

### Established Patterns
- JSON config persisted as a `TEXT` column (not normalized sub-tables) — `columns_json`, `template_sql` precedent.
- Mutation routes gated via `requirePermission(...)`; read routes for viewer-facing data left ungated (render surfaces need them).
- Pure client libs live under `packages/web/src/lib/` and are fully unit-tested with no store/DOM/SQL imports (e.g. `dynamicViewName.ts`, `calendarBin.ts`).

### Integration Points
- `db.ts` SCHEMA_DDL (new table; `CREATE TABLE IF NOT EXISTS` covers fresh + existing installs).
- `index.ts` CRUD endpoints (read ungated; write `datasets:manage`).
- `packages/web/package.json` — add `d3-format`.
- New `packages/web/src/lib/<formatter>.ts` (pure) + new client store + helpers — consumed by Phase 76 editor and Phase 77 render surfaces.

</code_context>

<deferred>
## Deferred Ideas

- **Conditional / value-based formatting** (color scales, thresholds on cell values) — out of scope for v1.15 (static label + value-format only); already in REQUIREMENTS "Out of Scope".
- **Per-dashboard (per dashboard+table) formatting overrides** — config is GLOBAL per-table this milestone; per-dashboard overrides deferred (REQUIREMENTS "Out of Scope").
- **Editor UI** (Phase 76) and **applying at render surfaces** (Phase 77) — explicitly later phases; do not build here.

</deferred>

---

*Phase: 75-column-display-config-foundation*
*Context gathered: 2026-06-19*
