# Phase 126: Datasets UI, Access Gating & Operator Verification - Context

**Gathered:** 2026-09-28
**Status:** Ready for planning

<domain>
## Phase Boundary

The operator drives check → report → apply → history from the Datasets page, gated by permission,
and confirms against a real Kinetica table that the report tells the truth.

This is the LAST phase of v1.25 and the first with UI work. Phases 122-125 shipped the entire
server side: the diff, the 40-site column reference registry, the impact report, the apply
transaction, the sync history, and four routes. **Nothing in this phase invents server behaviour.**
It renders what exists and adds the client-side permission gate.

Requirements owned: SSYNC-V125-01, SSYNC-V125-18, SSYNC-V125-19.

</domain>

<decisions>
## Implementation Decisions

### Permission gating — REQUIREMENT AMENDMENT, read this first

**Decision: the UI gates on `datasets:manage` AND `dashboards:manage_access` — matching the
server exactly.**

SSYNC-V125-19 as written says the feature requires "the same permission that governs dataset
management today", singular. That is **no longer accurate** and the requirement text is being
amended rather than reinterpreted. All four routes require BOTH permissions
(`packages/server/src/index.ts:2500-2501`, `:2577-2578`, `:2664-2665`, `:2682-2683`). The second
permission was added deliberately in Phase 124 to close an RBAC exposure the plan checker found;
it is not an accident to paper over.

Gating on `datasets:manage` alone would show controls to a user who then gets a 403 — the exact
UI/API disagreement criterion 4 exists to prevent.

**Amend SSYNC-V125-19's text in `.planning/REQUIREMENTS.md` as part of this phase**, explicitly,
in its own commit, stating that the double-gate shipped in Phase 124/125. Do NOT silently satisfy
the old wording. (This project has already been bitten once by a discuss-phase decision that
narrowed explicit requirement wording; it surfaced only at live UAT.)

- Controls are ABSENT, not disabled, for a user lacking either permission.
- Precedent for the client-side AND-gate: `packages/web/src/components/DashboardsPage.tsx:130-132`,
  which gates Import on `DASHBOARDS_CREATE && DATASETS_MANAGE` and documents the AND in a comment.
- `DatasetsPage.tsx` does NO client-side permission gating today — it renders "Permission denied"
  reactively from a server 403 (`:171-174`, `:431-434`). The reactive path stays as a backstop;
  the absence gate is new work.

### Flow shape

- **One per-table modal, staged in place:** check → report → apply → history.
- Mirror `ColumnFormatEditorModal` / `CustomMetricsEditorModal`, which `DatasetsPage.tsx` already
  opens per table at `:279` and `:285`. Same entry-point shape, same open/close wiring.
- One entry point per Datasets row, not two.

### Impact report presentation

- **Full list, breaking findings first.** No progressive disclosure, no summary-counts-first view.
- Ordering is already locked from Phase 124: by severity, then by column. Do not re-sort by
  dashboard — that was considered and rejected here because it conflicts with the shipped ordering.
- The cap is 20 findings and the report says so when it truncates; render that verbatim.

### Apply confirmation

- **A single Apply button, always enabled.** The report is in front of the operator; clicking
  Apply IS the explicit confirmation.
- No second confirm dialog, no type-the-table-name guard. This follows the milestone's standing
  decision that applying is never blocked and the operator decides with the report visible
  (SSYNC-V125-15, enforced server-side by the absence of any force parameter).

### Stale refusal (HTTP 409)

- Render `SCHEMA_APPLY_STALE_MESSAGE` **verbatim**, plus a **Re-check** button that re-runs the
  check in place so the operator lands on a fresh report without reopening the modal.
- Do NOT auto-re-check silently — the operator must see that reality moved under them.

### Sync history

- Row shows **timestamp · actor · counts** (e.g. `2026-09-28 14:02 · rpereira · 1 added, 2 removed`).
- **Expanding** a row reveals the full changeset and the impact report as it stood at that moment.
- **Delete per row with NO confirm dialog** — an entry is an audit note, not data.
- Cap notice: a line above the list, shown **only when `droppedCount > 0`** —
  "Showing the 20 most recent. N older entries were dropped." The route already returns both
  `droppedCount` and `cap`; **read `cap` from the response, never hardcode 20.**

### Verbatim strings — non-negotiable

Six operator-facing strings were approved at Phase 125's blocking checkpoint on 2026-09-28 and are
pinned in `125-04-SUMMARY.md` § "The six operator-facing strings". Render them **verbatim**; do not
paraphrase, re-case, or re-punctuate. `schemaApplyDiffMessage` is a FUNCTION taking the changeset;
the other constants are strings.

Two have special handling:
- **`SCHEMA_APPLY_TABLE_MISSING_MESSAGE` is UNREACHABLE over HTTP.** The route 404s before
  `applySchemaSync` runs. **Do NOT build a UI branch for it** — nothing can produce it. Operator
  decision: it stays as a library contract only.
- **`SCHEMA_APPLY_TEXT_WIDTH_GAP` must be rendered after an apply** (ROADMAP Phase 126 success
  criterion 6, added by operator decision at the same checkpoint). Unconditional — NOT gated on
  whether the table actually had a `text` column, because the server does not track the pre-apply
  vocabulary and building that detection was offered and declined.

### Operator verification checkpoint (criterion 5) — all four cases selected

Against a real Kinetica table, blocking:
1. **All four column drift cases** — add, drop, rename, retype — confirming the report names the
   right widgets, layers, metrics and format rules and misses none.
2. **Drop the whole table** — confirm the app reports table-not-found rather than erroring or
   showing stale columns.
3. **Apply, then verify the config panels** offer the live columns. This is SSYNC-V125-13's second
   clause, which **no automated test in Phase 125 could prove** — it is `packages/web` behaviour
   verified there only by a hardcoded mirror, never an execution.
4. **History survives a server restart** — entry and its report still present and readable.

Expect `table_missing` on most registered tables: five of the nine have been dropped from Kinetica
(recorded in Phase 124's carried gaps). That is correct behaviour, not a defect.

### Claude's Discretion

- Exact modal width, spacing, and stage transitions.
- Loading and empty states within the modal.
- How the expanded history detail is laid out.
- Whether the apply result uses the existing toast store or renders in the modal.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### The strings and contracts this phase renders
- `.planning/phases/125-apply-sync-history/125-04-SUMMARY.md` — the six approved operator-facing
  strings, verbatim, with file:line; the route contracts; the checkpoint outcome and its two decisions
- `.planning/phases/125-apply-sync-history/125-03-SUMMARY.md` — `applySchemaSync` signature and the
  four `SchemaApplyResult` outcomes; NOTE its `CORRECTION` block
- `.planning/phases/125-apply-sync-history/125-02-SUMMARY.md` — `renderColumnsMap` / staleness
  primitives and the THREE gaps carried (text→string, un-probed BOOLEAN marker, precedence divergence)
- `.planning/phases/125-apply-sync-history/125-01-SUMMARY.md` — history accessor shapes; `cap` and
  `droppedCount` are returned, never hardcoded
- `.planning/phases/125-apply-sync-history/125-VERIFICATION.md` — what was and was NOT verified

### Server surface being rendered
- `packages/server/src/index.ts:2498-2543` — schema-check route
- `packages/server/src/index.ts:2575+` — schema-apply route
- `packages/server/src/index.ts:2663+`, `:2681+` — sync-history read and per-entry delete
- `packages/server/src/lib/schemaApply.ts` — the six strings live here; source wins over any doc
- `packages/server/src/lib/schemaImpact.ts` — `ImpactReport` shape, severity ordering, the 20 cap

### UI conventions — MANDATORY
- `./CLAUDE.md` § "UI Conventions" — canonical button classes, `ds-actions`, `ds-field`,
  `config-group`; **never invent a class name**, never hardcode hex
- `packages/web/src/styles/global.css` — `.modal-overlay` `:825`, `.modal-content` `:834`,
  `.modal-header` `:849`, `.modal-title` `:857`, `.modal-body` `:863`, `.modal-section-title` `:868`;
  tokens `--danger` `:20`, `--warning` `:21`, `--success` `:22`, `--muted` `:17`
- `packages/web/src/styles/theme-guard.spec.ts` — fails the build on raw hex in components

### Precedents to mirror
- `packages/web/src/components/ColumnFormatEditorModal.tsx` + `CustomMetricsEditorModal.tsx` — the
  per-table modal shape Datasets already opens; neither has its own CSS file (both use `global.css`)
- `packages/web/src/components/DashboardsPage.tsx:130-132` — the client-side AND-gate precedent
- `packages/web/src/components/RolesPage.tsx` / `RolesPage.css` — closest settings-page component

### Requirements and roadmap
- `.planning/REQUIREMENTS.md` — SSYNC-V125-01 `:22`, -18 `:48`, -19 `:52`. **-19 is being amended.**
- `.planning/ROADMAP.md` § "Phase 126" — six success criteria; criterion 6 was added 2026-09-28

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `ColumnFormatEditorModal` / `CustomMetricsEditorModal`: the per-table modal pattern, already
  wired into `DatasetsPage.tsx` at `:279` / `:285`. Copy the open/close and table-binding shape.
- `global.css` modal classes (`.modal-overlay`/`.modal-content`/`.modal-header`/`.modal-body`):
  no new modal chrome needs inventing.
- `useToastStore` (`packages/web/src/store/toast.ts`, kinds `permission` | `info` | `error`):
  available for the apply result if the modal is not the right place.
- `PERMISSIONS.DATASETS_MANAGE` and `DASHBOARDS_MANAGE_ACCESS` in `packages/web/src/lib/permissions.ts`.

### Established Patterns
- **No design-system component library.** Plain elements with `global.css` utility classes, and
  **no build check that a className resolves to real CSS** — an invented class silently renders
  unstyled and still passes tsc, vitest AND theme-guard. Grep `global.css` before naming anything.
- **No severity/badge classes exist yet.** `--danger` / `--warning` / `--success` tokens exist, but
  there is no `.badge` or `.severity-*` class. New classes will be needed; define them in
  `global.css` alongside the existing ones, never as inline hex.
- `--success` is currently an alias for `--accent` (brand violet), NOT a distinct green. If
  severity needs three visually distinct colours, that must be decided deliberately.
- Light-mode overrides live in a second `:root` block (`:120+`). theme-guard only flags `#hex` —
  it does NOT catch `rgba()` overlays or a wrong token, both of which have shipped light-mode bugs
  here before. Hand-audit both themes.

### Integration Points
- `DatasetsPage.tsx` (511 lines) — the row-level entry point, and where the absence gate goes.
- `DatasetsPage.tsx:390-398` `handleTableChange` — the existing live-columns caller
  (`fetchKineticaColumns`), the closest thing to the new check call.
- `packages/web/src/api/client.ts` — where the four new route callers belong.

### Constraint carried from Phase 125
`packages/web` has been at **ZERO diff** for the whole milestone — every server phase asserted it.
This phase is where that budget is spent. Nothing in `packages/server` should need to change; if
the UI appears to need a server change, that is a signal to re-read the route contracts first.

</code_context>

<specifics>
## Specific Ideas

- The history list is a **durable worklist the operator works through while fixing dashboards** —
  explicitly not "a modal they have to screenshot". That framing drives the expand-for-detail row
  and the no-confirm delete: entries get ticked off as they are dealt with.
- On widget naming, from an earlier decision: where two widgets share a name, fall back to the id
  but tell the operator to name their widgets and re-run the report, and say plainly when a widget
  has no name at all.
- v1.24's operator checkpoint found FOUR defects that `tsc`, `vitest` and `theme-guard` all passed —
  one whose signature was a side-by-side comparison PASSING. Criterion 5 is not a formality.

</specifics>

<deferred>
## Deferred Ideas

- **Conditional text-gap warning** — showing `SCHEMA_APPLY_TEXT_WIDTH_GAP` only when the table
  actually had a `text` column. Offered and declined for this phase: the server does not track the
  pre-apply vocabulary, so it needs new detection work. Revisit only if the unconditional caveat
  proves noisy in practice.
- **Relaxing the server's double permission gate** so SSYNC-V125-19's original wording holds.
  Considered and rejected — it reopens the RBAC exposure Phase 124's plan checker found. Would need
  that finding re-examined first.
- **Correcting the two stale `foreign_keys` PRAGMA comments** in `db.ts` (`:231`, `:583`) — see
  `.planning/defect-stale-foreign-keys-pragma-comments.md`. Documentation-only; out of scope here.

</deferred>

---

*Phase: 126-datasets-ui-access-gating*
*Context gathered: 2026-09-28*
