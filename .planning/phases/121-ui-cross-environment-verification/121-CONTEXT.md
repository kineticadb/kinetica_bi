# Phase 121: UI + Cross-Environment Verification - Context

**Gathered:** 2026-09-17
**Status:** Ready for planning

<domain>
## Phase Boundary

The operator can export a dashboard from one environment and import it into another entirely from the
app, and the imported dashboard renders identically to the original.

**In scope:** DXIM-V124-01 (export from the UI), DXIM-V124-03 (import from the UI), DXIM-V124-10
(the import report surfaced to the operator) — plus the cross-environment round-trip that proves the
milestone.

**NOT in scope:** changing the export format or the import semantics. Phases 119 and 120 settled
those. If this phase finds a defect in either, that is a FINDING to report, not a redesign to
undertake here.

## Read this before planning: all three requirements are ALREADY marked Complete

v1.24 reads **11/11 requirements complete**. Phases 119 and 120 closed every one, including this
phase's three, on automated evidence plus one operator export.

**But the milestone's actual purpose has never been demonstrated.** The operator's words were:
*"This is valuable to move dashboards across environments."* Nothing has yet moved between two
environments. Phase 120's entire test suite imports into **one database** — which proves reference
remapping and proves nothing about portability.

So this phase is not a formality on top of finished work. **It is the first real test of the
feature's premise.** If the round-trip fails, requirements that currently read Complete must be
REOPENED — say so plainly rather than treating green checkboxes as settled.

</domain>

<decisions>
## Implementation Decisions

### The three reference kinds that have never run outside a fixture

Carried forward from Phases 119 and 120, and the single most important input to this phase's UAT:

| Kind | Status |
|---|---|
| REF-1 `tableId` | live-verified (operator export, Phase 119) |
| REF-3 `sourceMapWidgetId` | live-verified |
| REF-6 `includedLayerIds` | live-verified |
| REF-8 `options[].actions[].target` + legacy | live-verified |
| `dashboard_tables` union edge | live-verified |
| **REF-2 `dynamicViewId`** | **FIXTURE-ONLY — never seen live** |
| **REF-4 scalar `metricId`** | **FIXTURE-ONLY — never seen live** |
| **REF-5 `metrics[].metricId`** | **FIXTURE-ONLY — never seen live** |

The operator's Phase 119 export contained no dynamic views and no custom metrics, so those three kinds
have only ever been exercised by tests written from the SAME inventory as the implementation they test.
**That is the likeliest hiding place for a remapping bug in this entire milestone.**

**Therefore the UAT must require a dashboard that uses a custom metric AND a dynamic view.** If the
operator does not already have one, the walkthrough should say so and ask them to build one — an
approval obtained without exercising those kinds leaves them unproven, and the plan should refuse to
call that a full pass.

### What "renders identically" means — define it before testing it

ROADMAP criterion 3 says the imported dashboard must reproduce the original "with all visualizations
rendering the same data". Criterion 4 goes further: **every interactive feature must still work —
drill-down, filters, map layers, and any standalone Legend binding** — because those are what actually
exercise the remapped references at runtime.

A dashboard that *loads* proves very little. A widget pointing at the wrong table renders perfectly
well; it just shows the wrong numbers. **The UAT must compare against the source, not merely confirm
the target looks plausible.**

### Import report (DXIM-V124-10) must surface what the operator accepted risk on

Phase 120 built `MetricConflict` carrying the label, the table, both expressions, and an
operator-facing message. That exists because of a decision the operator made explicitly: when a target
metric shares a label but differs in expression, **import reuses the target's definition and the
imported widget then computes something different than it did in the source.** The report is the ONLY
signal.

**So the UI must not reduce the report to "Import succeeded."** Tables matched vs created, metrics
created, any metric conflicts, and any `layerFilterWidened` warning all have to reach the operator.

### Claude's Discretion

- Where the export and import controls live in the dashboard UI, and their exact labels.
- How the import report is presented (modal, inline panel, toast + detail).
- Whether import is reachable from the dashboard list, a settings surface, or both.
- File-picker mechanics and client-side validation before upload.

</decisions>

<canonical_refs>
## Canonical References

### What this phase exposes
- `packages/server/src/lib/dashboardExport.ts` — the envelope; `GET /api/dashboards/:id/export`
- `packages/server/src/lib/dashboardImport.ts` — validation, resolution, `applyDashboardImport`,
  and the report types (`MetricConflict`, `layerFilterWidened`)
- `POST /api/dashboards/import` — gated on `dashboards:create` AND `datasets:manage`
- `packages/server/src/index.ts` — the 400 `MALFORMED_JSON` / 413 `PAYLOAD_TOO_LARGE` branches

### The evidence and its limits
- `.planning/phases/119-export/119-04-SUMMARY.md` — the operator's export, and the 5/8 vs 3/8 split
- `.planning/phases/120-import/120-05-SUMMARY.md` — the one-database limitation, stated explicitly
- `.planning/phases/120-import/120-CONTEXT.md` §"Custom-metric label conflict" — the operator decision
  and why the report entry is load-bearing

### Requirements & scope
- `.planning/REQUIREMENTS.md` — DXIM-V124-01/-03/-10 are this phase; **all already marked Complete**
- `.planning/ROADMAP.md` §"Phase 121" — goal and the 4 success criteria

### Project conventions (binding)
- `CLAUDE.md` — **UI conventions: NEVER invent a className; reuse `global.css`; no hardcoded hex,
  theme tokens only.** This is the first WEB work in this milestone, so these apply again.
  AND §"Writing verifiable acceptance criteria".
- Note `theme-guard.spec.ts` allowlists `global.css` and asserts `hasHex === true` for allowlisted
  files — **it never checks absence**, so any hardcoded colour there passes every automated gate.
  Any new styling needs human verification in BOTH themes (`TD-V123-THEMEGUARD-HOLE`).

</canonical_refs>

<code_context>
## Existing Code Insights

### This is the first WEB work in v1.24
Phases 119 and 120 were server-only. The web gates return: `cd packages/web && npx tsc --noEmit`
clean, `npx vitest run` 100%, `npx vitest run src/styles/theme-guard.spec.ts` green. **The web suite
is stable** — the v1.23 fix (`cde63ae`) took it from 0-of-4 clean runs to 4-of-4, and every Phase 118
verification passed first time.

### Reusable Assets
- `DashboardsPage.tsx` — the dashboard list with its per-row action buttons (Open / View / Edit /
  Delete / Manage access). The natural home for an Export action.
- There is **no download precedent in this codebase** (Phase 119 research: `Content-Disposition`,
  `res.download`, `res.attachment` all zero hits before this milestone). The client side is likewise
  new ground — establish the pattern deliberately.
- `multer` exists server-side for uploads (v1.16 branding logo). Whether the import route takes
  multipart or a JSON body was Phase 120's call — check what it actually implemented.
- `useApiQuery` — the established fetch-with-loading/error hook.

### Established Patterns
- CLAUDE.md's button vocabulary: `btn-primary btn-sm` + `ghost-sm` inside `ds-actions`; settings pages
  may use the `roles-btn-save`/`roles-btn-cancel` pattern. **Match the closest existing component
  rather than inventing.**
- Permission-gated UI: the import control should respect the same `dashboards:create` +
  `datasets:manage` pairing the route enforces, so the button is not offered to someone who will be
  refused.

### Known hazards
- **theme-guard cannot see colour literals in `global.css`** — human eyes in both themes are the only
  guard on new styling.
- **Self-falsifying acceptance criteria** — 30+ across Phases 115-120, the dominant cause being a plan
  anchoring a grep on prose the plan itself mandates in a comment. All five Phase 120 waves caught one.
  `grep -c` counts LINES, not occurrences.
- **`gsd-tools state advance-plan` / `roadmap update-plan-progress` cannot parse this project's
  STATE.md / ROADMAP.md formats** — every Phase 119 and 120 wave hit this and fell back to manual
  edits. Expect it.

</code_context>

<specifics>
## Specific Ideas

- The operator has already exported dashboard 4 ("Test Dashboard", 7 widgets, 4 layers, 3 tables) by
  pasting a URL. They found the file readable and approved it. That dashboard is a known-good export
  subject — but it has **no custom metric and no dynamic view**, which is precisely the gap this
  phase must close.
- The operator hit a real friction point in Phase 119: the checkpoint said "`http://localhost:<your
  port>/...`" and they reasonably used the port they browse the app on (5173, Vite) rather than the
  API port (4000). **A UI button removes that class of problem entirely** — which is part of this
  phase's value, not incidental.

</specifics>

<deferred>
## Deferred Ideas

- **DXIM-F1** bulk multi-dashboard export/import · **DXIM-F2** server-to-server migration without a
  file · **DXIM-F3** exporting access grants for same-environment cloning · **DXIM-F4** dry-run
  preview · **DXIM-F5** re-import over an existing dashboard.
- Re-testing the server's `TD-V16-TEST-ISOLATION` attribution — this milestone spent two phases in
  server code without doing it; still worth doing, still not this phase.

</deferred>

---

*Phase: 121-ui-cross-environment-verification*
*Context gathered: 2026-09-17*
