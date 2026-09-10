# Phase 106: Display-Mode Persistence - Context

**Gathered:** 2026-07-09
**Status:** Ready for planning

<domain>
## Phase Boundary

Persist a per-dashboard filter display mode (`topbar` vs `panel`) server-side, return it on dashboard load to every viewer, and default to top bar so unconfigured dashboards stay byte-identical to today. This is the milestone's ONLY server touch.

In scope: the `dashboards` schema migration, the `Dashboard` DTO field (server + web type), reading it on load, and accepting it on the existing dashboard PATCH (validated, existing permission). Out of scope: the designer TOGGLE UI (Phase 110) and the panel/top-bar RENDER switch that consumes the mode (Phase 107).
</domain>

<decisions>
## Implementation Decisions

### Storage shape — dedicated scalar column (user's explicit choice)
- Add `filter_display_mode TEXT` to the `dashboards` table via a NEW PRAGMA-`table_info(dashboards)`-guarded `ALTER TABLE dashboards ADD COLUMN` block in `db.ts`, mirroring the v1.18 `filter_scope` / `cb_config` nullable-TEXT migration pattern exactly.
- `NULL` = unconfigured = default `topbar` (mirrors how `filter_scope` NULL = accept-all default). Do NOT add a general `config` JSON blob to dashboards this phase.
- Allowed values: `'topbar'` | `'panel'`. (Panel = right side; locked in milestone questioning.)

### Default + backward-compat (FSET-V120-03)
- Absent/NULL → treated as `topbar`. An existing dashboard with no value behaves byte-identically to today.
- The DTO returned to clients ALWAYS coalesces to a concrete value (`'topbar'` | `'panel'`) — the client never sees `null` (keeps Phase 107's mode switch simple). Whether the DB stores `NULL` vs an explicit `'topbar'` for the default is Claude's discretion; the wire value is always concrete.

### API surface (FSET-V120-02 — persist + shared with all viewers)
- Add `filter_display_mode` to the `Dashboard` DTO returned by `GET /api/dashboards` and `GET /api/dashboards/:id`, so every viewer receives the designer's choice on load.
- Extend the existing `PATCH /api/dashboards/:id` allow-list (the `updateDashboard` function in `db.ts`) to accept `filter_display_mode`, VALIDATED to `'topbar'|'panel'` (reject others with 400). Keep the existing `DASHBOARDS_EDIT` permission gate — NO new permission.
- Mirror the DTO field into the WEB api-client `Dashboard` type + fetch mapping so Phases 107/110 can read it. This phase adds the TYPE + data flow only — NO UI, NO render switch, NO store wiring beyond what's needed to carry the field.

### Testing (server BOTH-stack)
- Server supertests in BOTH auth modes (password + oidc) for: migration idempotency (re-run safe), PATCH accepts valid mode + rejects invalid (400), GET returns the field (default `topbar` when unset), permission gate unchanged (DASHBOARDS_EDIT). Server vitest is SET-BASED ⊆ TD-V16-TEST-ISOLATION (never a fixed pass-count); run materialize/TTL-adjacent specs with the dev-.env-leak neutralized if needed.
- Web `tsc` clean for the DTO type addition.

### Claude's Discretion
- Store `NULL` vs explicit `'topbar'` for the default in the DB (DTO coalesces either way).
- Exact validation error shape/message.
- Whether the web change is only a type addition or also a thin api-client mapping line (both acceptable; no UI either way).
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Persistence precedent (mirror this)
- `packages/server/src/db.ts` — `dashboards` CREATE TABLE (~line 15, currently name/description/timestamps, NO config column); the PRAGMA-`table_info`-guarded `ALTER TABLE … ADD COLUMN` blocks (sessions ~302, dashboard_layers ~327); the v1.18 `filter_scope TEXT` add (~368-370) + `cb_config`/`track_config` nullable-TEXT columns (~107-111) — the exact pattern to copy for `dashboards.filter_display_mode`. Also the `updateDashboard` function (PATCH allow-list).
- `packages/server/src/types.ts` — `Dashboard` type (line 1); `filter_scope: string | null` on `DashboardLayer` (line 95) as the nullable-field precedent.
- `packages/server/src/index.ts` — `PATCH /api/dashboards/:id` (line 794, gated by `PERMISSIONS.DASHBOARDS_EDIT`); `GET /api/dashboards` (780) + create (787); the layer PATCH filter_scope handling (~1009) as the "TOP-LEVEL column, never inside config" precedent.

### v1.20 research
- `.planning/research/ARCHITECTURE.md` — persistence design (dedicated column mirroring filter_scope; the one server touch).
- `.planning/research/STACK.md` — the storage-shape analysis (column vs blob) and dashboards-has-no-config-column finding.

### v1.18 precedent
- `.planning/milestones/v1.18-ROADMAP.md` — the `filter_scope` migration + DTO + PATCH wiring this phase mirrors.

### Gates
- `CLAUDE.md` — test gates (server `tsc` clean; server vitest SET-BASED ⊆ TD-V16-TEST-ISOLATION; supertests in BOTH auth modes for server routes; web `tsc` clean).
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- The PRAGMA-guarded ALTER migration idiom in `db.ts` (used for sessions, dashboard_layers) — copy it for a `dashboards` block.
- `filter_scope` (dashboard_layers) is the exact nullable-TEXT top-level-column precedent: migration + DTO field + PATCH allow-list + "never inside config" handling.
- The existing `updateDashboard` allow-list function + `PATCH /api/dashboards/:id` route (DASHBOARDS_EDIT) — extend, don't add a new route.

### Established Patterns
- Nullable TEXT column, NULL = default/unconfigured (filter_scope, cb_config, track_config).
- Server routes tested with supertests in BOTH auth modes; server vitest is set-based (⊆ TD-V16-TEST-ISOLATION), never a fixed pass-count.
- Dev `.env` leaks into server vitest — run with the dev override neutralized if TTL/materialize specs falsely redden.

### Integration Points
- `dashboards` table (db.ts) + `Dashboard` DTO (types.ts) + dashboard GET/PATCH (index.ts) + web api-client `Dashboard` type. Consumed by Phase 107 (render switch) + Phase 110 (toggle UI).
</code_context>

<specifics>
## Specific Ideas

- Wire shape endorsed:
  ```
  ALTER TABLE dashboards ADD COLUMN filter_display_mode TEXT;  -- NULL = 'topbar'
  DashboardDto: { ..., filter_display_mode: 'topbar' | 'panel' }   // coalesced, never null on the wire
  ```
</specifics>

<deferred>
## Deferred Ideas

Surfaced when the user noted more dashboard-level settings are likely — captured for the roadmap backlog, NOT built here:
- **Per-dashboard custom CSS** — dashboard-scoped style customization. Its own future phase; would reuse v1.16's brand-CSS sanitizer (postcss-safe-parser) + the XSS/sanitization handling established for app-level custom CSS.
- **Alternate per-dashboard layouts** — different dashboard layout options beyond the current react-grid-layout. Its own future feature.
- **Revisit column-vs-blob** — if/when the dashboard-settings area grows (the two above), a future phase can decide whether to keep adding typed columns or introduce a `dashboards.config` JSON blob (absorbing `filter_display_mode`). Deliberately deferred; this phase uses a dedicated column per the user's explicit choice.
</deferred>

---

*Phase: 106-display-mode-persistence*
*Context gathered: 2026-07-09*
