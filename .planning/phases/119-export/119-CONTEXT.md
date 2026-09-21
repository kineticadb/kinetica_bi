# Phase 119: Export - Context

**Gathered:** 2026-09-16
**Status:** Ready for planning

<domain>
## Phase Boundary

A dashboard and everything needed to recreate it elsewhere serialize to a single versioned JSON file.

**In scope:** DXIM-V124-01 (the file), DXIM-V124-02 (all widgets with full config), DXIM-V124-08
(access grants excluded).

**NOT in scope:** consuming the file — id remapping, table matching, atomicity and the import report
are all **Phase 120**, which is the milestone's highest-risk phase. The UI (download button, upload)
is **Phase 121**. This phase produces the artifact and nothing else.

**Read the format decision as load-bearing.** Phase 120 can only be as correct as the export is
complete. Anything omitted here becomes a silently-broken widget there, and the failure surfaces in
a different environment from the one that caused it.

</domain>

<decisions>
## Implementation Decisions

### Locked by the operator (2026-09-16)

1. **Transport is a JSON file.** Environments may be network-isolated; a file can be reviewed,
   diffed, version-controlled, or attached to a ticket. (The download/upload UI is Phase 121; this
   phase only has to produce the bytes.)
2. **Access grants are excluded** — the operator's framing: access "can be different on different
   environments". `dashboard_access_grants` must not appear in the export.
3. **Custom metrics travel.** Widgets reference `custom_metrics.id`, and `db.ts` states that id is
   deliberately load-bearing — *"an opaque autoincrement key so Phase 100 widget references survive
   label/expression edits"*. A widget whose metric did not travel loses its metric silently.
4. **Column display config does NOT travel.** It is per-table and shared across every dashboard using
   that table; importing it would silently change how OTHER dashboards render in the target
   environment. The target's existing formatting choices are deliberate.

### The dependency walk must be derived, not hand-listed

ROADMAP criterion 5 is deliberate: the exported set must be produced by **walking the graph**, not by
a hand-maintained list of tables to dump. The reason is that three reference kinds live INSIDE
serialized JSON config rather than in FK columns:

- `widgets.config.tableId` → `tables.id`
- `widgets.config.sourceMapWidgetId` → **another widget's id** (standalone Legend widget, v1.7 Phase 42)
- widget config → `custom_metrics.id`

A hand-maintained list goes stale the first time a new widget type adds a reference. A walk that
starts from the dashboard and follows references stays correct by construction.

**This phase's job is to establish that walk and prove it is complete** — including proving a widget
referencing a custom metric pulls that metric into the export.

### Runtime state must NOT travel

`dashboard_table_views` is materialized-view bookkeeping (view names, status, error messages) tied to
a specific Kinetica cluster and a specific TTL lifecycle. Exporting it would carry dead references
into an environment where those views do not exist. Research should check for other runtime-ish
tables with the same property rather than assuming this is the only one.

### Format versioning

An export file outlives the code that wrote it — someone will import a file produced three releases
ago. The file carries a schema version field (ROADMAP criterion 2). **What import does with an
unrecognised version is Phase 120's decision**, but the field must exist now, because it cannot be
added retroactively to files already in the wild.

### Claude's Discretion

- The exact JSON shape and field names.
- Whether the export is a new route or an extension of an existing dashboards route.
- Whether the walk is implemented as an explicit graph traversal or as an ordered series of queries,
  provided the result is derived from references rather than a hard-coded entity list.
- File naming for the download (Phase 121 surfaces it, but the server may suggest it).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these.**

### The schema and its traps
- `packages/server/src/db.ts` — every table definition. Note in particular:
  - `dashboard_layers.table_id` is a **soft FK** (no `REFERENCES`) — deliberate, so layers survive
    table deletion. It still needs remapping on import.
  - `custom_metrics` — `UNIQUE(table_id, label)`, and the comment explaining why `id` is load-bearing.
  - `dashboard_table_views` — RUNTIME state, must not export.
  - `dashboard_access_grants` — excluded by operator decision.

### Requirements & scope
- `.planning/REQUIREMENTS.md` — DXIM-V124-01/-02/-08 are this phase; the "Decisions deferred to
  research" section names the permission question and the "what else must travel" question as this
  phase's open items
- `.planning/ROADMAP.md` §"Phase 119" — goal and the 5 success criteria; §"Phase 120" for what
  consumes this

### Project conventions (binding)
- `CLAUDE.md` — §"Writing verifiable acceptance criteria", and the SERVER test gate: `npx tsc
  --noEmit` clean, and server vitest is **SET-BASED** — failing files must be a subset of the known
  `TD-V16-TEST-ISOLATION` set; **never assert a fixed pass-count**.
- `packages/server/scripts/test-gate.mjs` — the set-based gate itself, and its rationale.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `packages/server/src/index.ts` — existing dashboard routes to mirror for shape, auth middleware,
  and error handling. Note `GET /api/dashboards` is permission-filtered server-side.
- `packages/server/src/rbac.ts` — `requirePermission` middleware. **Existing permissions
  (`dashboards:view`, `dashboards:create`, `datasets:manage`) should be composed rather than adding a
  new one** — see the ripple warning below.
- `better-sqlite3` is synchronous, which makes a consistent multi-table read straightforward.

### Established Patterns
- Routes answer `404` identically for "not found" and "not permitted" on per-dashboard resources
  (`index.ts:879/918/949/1043`) — v1.10's deliberate non-leak design. An export route must not become
  the one endpoint that reveals which dashboard ids exist.
- JSON-as-TEXT columns are the norm (`widgets.config`, `dashboard_layers.config`,
  `column_display_config.format_spec`, `custom_metrics.format_spec`). Export has to decide whether to
  re-embed them as parsed JSON or pass the text through — a decision with consequences for Phase 120's
  reference rewriting.

### Integration Points
- `packages/server/src/index.ts` — the new route.
- `packages/server/src/db.ts` — read paths; **no schema change should be needed for export**. If
  research concludes otherwise, say so loudly: it would change the milestone's risk profile.

### Known hazards
- **Adding an RBAC permission ripples.** A new permission breaks count assertions across `rbacDb`,
  `rbacMigration`, web `permissions`, and `RolesPage` specs, and needs `permissionGroups` wiring.
  Compose existing permissions unless genuinely impossible.
- **Server vitest is SET-BASED.** Do not assert a fixed pass-count; failing files must be ⊆ the known
  `TD-V16-TEST-ISOLATION` set. A plan that demands "0 failures" on the server suite is wrong.
- **Self-falsifying acceptance criteria** — ~28-32 across Phases 115-118, dominant cause being a plan
  mandating a code comment containing the very token its own grep counts. Anchor on symbols the work
  introduces; run every grep before writing it down; `grep -c` counts LINES, not occurrences.

</code_context>

<specifics>
## Specific Ideas

- The operator's purpose, verbatim: *"This is valuable to move dashboards across environments."* The
  success test is a real dashboard moving between two real environments (Phase 121) — not a
  round-trip within one database, which would mask exactly the id-collision and table-matching bugs
  the milestone exists to handle.
- The operator explicitly accepted that access grants differ per environment, and explicitly asked
  for new ids. Both are constraints, not preferences.

</specifics>

<deferred>
## Deferred Ideas

- **DXIM-F1** bulk export of multiple dashboards · **DXIM-F2** server-to-server migration ·
  **DXIM-F3** exporting access grants for same-environment cloning · **DXIM-F4** dry-run preview ·
  **DXIM-F5** re-import over an existing dashboard.
- Re-testing the server's `TD-V16-TEST-ISOLATION` attribution. This milestone touches server code
  heavily, making it a good opportunity — but it is not this phase's job.

</deferred>

---

*Phase: 119-export*
*Context gathered: 2026-09-16*
