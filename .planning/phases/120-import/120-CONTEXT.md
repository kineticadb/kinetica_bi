# Phase 120: Import - Context

**Gathered:** 2026-09-16
**Status:** Ready for planning

<domain>
## Phase Boundary

An export file recreates the dashboard in a target environment with fresh ids, every intra-file
reference remapped, tables matched by `schema.name`, and nothing left behind if it fails.

**In scope:** DXIM-V124-03, -04, -05, -06, -07, -09, -10, -11.

**NOT in scope:** the UI. Download/upload buttons, surfacing the import report to the operator, and
the cross-environment round-trip are all **Phase 121**. This phase delivers the endpoint and the
correctness.

**This is the milestone's highest-risk phase and the ROADMAP says so explicitly.** Phase 119 produced
an artifact whose correctness is checkable by reading it. Phase 120's failures are the opposite:

> **A missed reference does not error. It silently points at a pre-existing record in the target
> environment** — the wrong table, the wrong metric, or an unbound legend — and the dashboard renders
> confidently wrong data. The operator has no signal that anything went wrong.

That asymmetry should drive the plan's testing strategy. "Import succeeded" proves almost nothing;
"every reference resolves to a newly-created record" is the actual claim.

</domain>

<decisions>
## Implementation Decisions

### Locked by the operator

1. **Always new ids.** The operator's words: *"New dashboards and visualization ids should be used in
   case there is already an existing dashboard with the old id or visualization ids."* Import never
   reuses an id from the file. Importing a file whose ids collide with existing records must succeed
   and must leave those existing records untouched (DXIM-V124-04).
2. **Tables match by `schema.name`** — reuse an existing registry entry, create when missing, never
   duplicate for the same `schema.name` (DXIM-V124-06). Import reports which were matched vs created.
3. **Custom metrics travel and are created if absent**, matched by label where already present
   (DXIM-V124-07). Widgets reference them by id; a metric that does not arrive is a silently broken
   widget.
4. **Access grants are NOT imported** (DXIM-V124-08, closed in Phase 119). The imported dashboard
   starts with the target environment's own access rules.
5. **Column display config does NOT travel** — it is shared per-table across every dashboard in the
   target, and importing it would silently change how OTHER dashboards render.

### The eight reference kinds — established and verified three times

From Phase 119's research, confirmed independently by the plan checker and by a third audit sweep:

| # | Reference | Shape | Trap |
|---|---|---|---|
| REF-1 | `widgets.config.tableId` | scalar | — |
| REF-2 | `widgets.config.dynamicViewId` | scalar | **fixture-only, never seen live** |
| REF-3 | `widgets.config.sourceMapWidgetId` | scalar → **another widget** | ordering: target must exist first |
| REF-4 | custom-metric scalar `metricId` | scalar | **fixture-only, never seen live** |
| REF-5 | `widgets.config.metrics[].metricId` | **array of objects** | **fixture-only, never seen live** |
| REF-6 | `widgets.config.includedLayerIds` | **array** | **empty array = SENTINEL meaning ALL LAYERS**, not none |
| REF-7 | `widgets.config.filterSelection.allowedSourceWidgetIds` | **array** | **mixes widget ids with the STRING `__spatial_draws__`**, which must NOT be remapped or coerced |
| REF-8 | `widgets.config.options[].actions[].target` | polymorphic `{kind, id}` | **plus a LEGACY singular `options[].action`** field |

Plus a sixth SITE carrying the REF-7 shape: **`dashboard_layers.filter_scope`** (DB column, JSON-as-TEXT).

**Phase 119 built the walk as a deliberately separate pure module — `packages/server/src/lib/dashboardExportRefs.ts` — precisely so this phase's remapper consumes the SAME inventory.** Do not write a second list of reference kinds. If the remapper needs a different traversal shape, extend or reuse that module rather than forking it; two lists will drift, and the drift is invisible.

### Coverage limitation carried in from Phase 119 — plan around it

The operator's live export exercised **5 of 8** kinds (REF-1, -3, -6, -8, plus the `dashboard_tables`
union edge). **REF-2, REF-4 and REF-5 have only ever existed in fixtures** — the operator's dashboard
had no dynamic views and no custom metrics.

Those three are therefore the likeliest place for a remapping bug to hide, because nothing outside a
test has ever exercised them. **Weight the testing accordingly**, and make sure Phase 121's UAT can
cover them — which may mean asking the operator to build a dashboard that uses a custom metric and a
dynamic view before the round-trip.

### Atomicity

DXIM-V124-09 requires that a failure partway through leaves nothing behind — no dashboard, no
widgets, no layers, no stray table entries. `better-sqlite3` is synchronous and supports
transactions; the natural implementation is a single transaction around the whole import. **The test
that matters induces a failure mid-import and asserts the database is unchanged**, not one that
merely checks the happy path rolls forward.

### Claude's Discretion

- Route shape (`POST /api/dashboards/import` assumed) and whether the file arrives as a multipart
  upload (`multer` precedent exists, v1.16 Phase 81) or a JSON body.
- The report's exact shape, provided it names the new dashboard id, tables matched vs created, and
  metrics created (DXIM-V124-10).
- Validation strategy for DXIM-V124-11 — how strictly to check a hand-edited file, and what the
  rejection message says.
- What import does with an unrecognised `schemaVersion`. Phase 119 deliberately left this to 120.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these.**

### What this phase consumes
- `packages/server/src/lib/dashboardExportRefs.ts` — **the shared inventory. Reuse it; do not fork it.**
- `packages/server/src/lib/dashboardExport.ts` — the envelope shape being consumed
- `packages/server/tests/routes.dashboard-export.spec.ts` — the kitchen-sink fixture exercising all
  eight kinds; the natural basis for a round-trip test
- `.planning/phases/119-export/119-RESEARCH.md` — the full reference inventory with write-sites
- `.planning/phases/119-export/119-04-SUMMARY.md` — the operator verdict and the 5/8 vs 3/8 coverage split

### Requirements & scope
- `.planning/REQUIREMENTS.md` — DXIM-V124-03..07, -09..11 are this phase; -01/-02/-08 closed in 119
- `.planning/ROADMAP.md` §"Phase 120" — goal, the research flag, and the 7 success criteria

### Project conventions (binding)
- `CLAUDE.md` — §"Writing verifiable acceptance criteria", and the SERVER gate: `npx tsc --noEmit`
  clean, and server vitest is **SET-BASED** — failing files must be ⊆ the known
  `TD-V16-TEST-ISOLATION` set. **NEVER assert a fixed server pass-count.**
- `packages/server/scripts/test-gate.mjs`

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `packages/server/src/lib/dashboardExportRefs.ts` — the walk, as a pure module. This phase's whole
  design rests on reusing it.
- `better-sqlite3` is synchronous with real transaction support — atomicity is straightforward.
- `multer` exists (v1.16 Phase 81 branding logo, magic-byte validated) if the file arrives multipart.
- The db accessors (`createDashboard`, `createWidget`, `createTable`, `createDashboardLayer`,
  `createDashboardDynamicView`, `createCustomMetric`, `addDashboardTable`) — Phase 119's plans
  verified these signatures verbatim against `db.ts`.

### Established Patterns
- **The non-leak 404.** Per-dashboard GET routes collapse "not found" and "not permitted" into an
  identical 404. Import CREATES rather than reads, so the property may not apply directly — but the
  plan should state what it does about permissions rather than leaving it implicit. Note
  `PERMISSIONS.DASHBOARDS_VIEW` is CATALOGUED BUT NEVER ENFORCED; the plausible gate here is
  `dashboards:create` + `datasets:manage`, **both of which already exist.**
- **Adding an RBAC permission ripples** across `rbacDb`, `rbacMigration`, web `permissions` and
  `RolesPage` spec count assertions, and needs `permissionGroups` wiring. Compose existing permissions.

### Integration Points
- `packages/server/src/index.ts` — the new route.
- `packages/server/src/db.ts` — **no schema change should be needed.** If one is, say so loudly.

### Known hazards
- **Server vitest is SET-BASED.** A plan demanding "0 failures" on the server suite is wrong.
- **`gsd-tools` `state advance-plan` and `roadmap update-plan-progress` CANNOT parse this project's
  STATE.md / ROADMAP.md formats** — all four Phase 119 waves hit this and fell back to manual edits in
  the existing style. Expect it; do not fight it; disclose it.
- **Self-falsifying acceptance criteria** — 30+ across Phases 115-119. The dominant cause is a plan
  mandating a code comment containing the very token its own grep counts. All three Phase 119 code
  waves tripped one and caught it by RUNNING the greps before committing. Anchor on symbols the work
  introduces; `grep -c` counts LINES, not occurrences.

</code_context>

<specifics>
## Specific Ideas

- The operator's purpose, verbatim: *"This is valuable to move dashboards across environments."* The
  real proof is Phase 121's round-trip between two environments — an import into the SAME database
  would mask both the id-collision and the table-matching behaviour this phase exists to get right.
- A round-trip test (export the kitchen-sink fixture → import it → export the result → compare) is
  the natural high-value automated check, but note it proves self-consistency, not correctness
  against a foreign environment. Both are worth having; only one is worth calling proof.

</specifics>

<deferred>
## Deferred Ideas

- **DXIM-F1** bulk multi-dashboard files · **DXIM-F2** server-to-server migration · **DXIM-F3**
  exporting access grants for same-environment cloning · **DXIM-F4** dry-run preview showing what an
  import would change · **DXIM-F5** re-import over an existing dashboard (update in place).
- Re-testing the server's `TD-V16-TEST-ISOLATION` attribution while this milestone is in server code.

</deferred>

---

*Phase: 120-import*
*Context gathered: 2026-09-16*
