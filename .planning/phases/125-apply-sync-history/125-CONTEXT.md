# Phase 125: Apply & Sync History - Context

**Gathered:** 2026-09-24
**Status:** Ready for planning

<domain>
## Phase Boundary

On explicit confirmation, **replace the stored snapshot with the live Kinetica column set and touch
nothing else**, and keep the changeset plus the report as a **durable per-table worklist**.

**This is the FIRST phase in v1.25 that writes.** Phases 122-124 deliberately ship no writer at all:
`tables.columns_fingerprint` has a read-only accessor and no setter anywhere in the tree. Phase 125
adds the first one.

Out of scope: the UI for viewing and clearing history (Phase 126 owns SSYNC-V125-18), and any repair
of affected widgets — the milestone is detect-and-report only.

</domain>

<decisions>
## Implementation Decisions

### Apply re-reads live and REFUSES if reality moved — it never writes what you did not see

**Locked.** Apply re-reads Kinetica, compares against the fingerprint the report was built from, and
if they differ it **stops and tells the operator to re-run the check**.

Rejected alternatives and why:
- *Write whatever is live now*: guarantees an accurate snapshot, but silently applies a change that
  appeared after the operator read the report — and the history entry would then record a report
  that does not describe what was written. Internally inconsistent history is worse than a retry.
- *Write what the report was built from*: what was approved is what lands, but if Kinetica moved on
  the snapshot is stale the moment it is written, which defeats the feature.

Costs one extra Kinetica call and an occasional "someone changed it again" outcome. That is the
right trade: **the operator never applies something they did not see.**

### History is CAPPED at 20 entries per table, and a drop is SAID OUT LOUD

**Locked.** Keep the most recent 20 per table; when an apply pushes an older entry out, the history
**states that older entries were dropped to stay within the cap**.

Note the tension, resolved deliberately: the milestone-level decision was "kept until cleared", and a
cap is in tension with that. The operator chose the cap for bounded growth, and chose to make the
drop visible so nothing vanishes silently. That matches how the impact report reports its own known
gaps rather than hiding them — an operator returning to a worklist must never be left believing they
are seeing everything when they are not.

Context that made the cap worth having: **nothing in this codebase has ever pruned an audit log** —
`rbac_audit` has grown unbounded since v1.8 — and each entry here stores a full impact report, which
on a wide table with many affected records is not small.

### A baseline apply IS recorded; a no-op apply is NOT

**Locked.**
- **Baseline** — establishing the first precise fingerprint on an old-format snapshot is a real
  event. It explains why earlier checks could not diff types (Phase 122's locked
  baseline-before-diff rule), so it belongs in the record even though it carries no changeset.
- **No-op** — an apply that changed nothing wrote nothing worth remembering, and would consume a
  capped slot for no information.

### Each entry records WHO applied it

**Locked.** Store the username, matching `rbac_audit`'s `actor` precedent. The route is
authenticated so it is free to capture; on a shared instance "who applied this and when" is the
first question asked of a worklist; and it is awkward to add retroactively once entries exist.

### Claude's Discretion

- The history table's name, exact column set and indexes — but **follow the `rbac_audit` shape**
  (`id INTEGER PRIMARY KEY AUTOINCREMENT`, `ts TEXT NOT NULL DEFAULT (datetime('now'))`, an actor
  column, JSON payload columns, and indexes on the columns actually queried). Use the established
  `CREATE TABLE IF NOT EXISTS` + additive-`ALTER` migration convention already in `db.ts`.
- How the cap is enforced (delete-on-insert vs a trigger vs a periodic sweep) and how the
  "older entries were dropped" fact is represented — a per-table flag, a count, or a synthetic
  entry. It must survive a restart and be readable by Phase 126.
- Route shape for apply, and whether history reads get their own route or ride along.
- Whether the changeset and the report are separate columns or one payload — but the report must
  round-trip byte-identically, since Phase 124 built it JSON-serialisable with a byte-stable sort
  precisely so it could be persisted here.
- Whether the stale-check comparison is on the whole fingerprint map or a digest of it.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### The contracts this phase persists and applies
- `.planning/phases/124-impact-report/124-03-SUMMARY.md` — the `ImpactReport` contract VERBATIM.
  **This is what gets stored.** It is JSON-serialisable with a byte-stable sort specifically so it
  can be persisted here.
- `packages/server/src/lib/schemaImpact.ts` — the shipped composer
- `packages/server/src/lib/schemaFingerprint.ts` — `parseFingerprintSnapshot` /
  `serializeFingerprintSnapshot`; the `{ base, refinements }` shape being written
- `packages/server/src/lib/schemaDiff.ts` + `122-03-SUMMARY.md` — `SchemaCheckResult`, three outcomes

### Storage conventions to follow
- `packages/server/src/db.ts` — `SCHEMA_DDL`, the `CREATE TABLE IF NOT EXISTS` + additive-`ALTER`
  migration convention (see `column_display_config`, `custom_metrics`, and the PRAGMA-guarded ALTER
  that added `columns_fingerprint` in Phase 122)
- `packages/server/src/db.ts` — the **`rbac_audit` table** (~`:209`): the closest append-only-log
  precedent, and the source of the `actor` decision
- `getTableColumnsFingerprint` — Phase 122's read-only accessor. **Phase 125 adds the first writer
  beside it.**

### Rules inherited from earlier phases that constrain this one
- **Phase 122's baseline-before-diff rule**: a table whose stored snapshot predates precise capture
  reports `baseline_required` and does NOT diff types, because comparing an old lossy value against
  a precise one would report a FALSE retype on the first run of every table. `INFORMATION_SCHEMA`
  reports `character(256)` for char1, char4 and char16 alike — the old snapshots are actively wrong
  about width, not merely imprecise. **Establishing that baseline is an APPLY, not a check, which is
  exactly what this phase owns.** See `122-CONTEXT.md` § "Resolved conflict".
- **Phase 122 writes nothing, ever** — including baselines. That constraint ends here.
- `impact` PRESENCE (not an empty array) distinguishes "no findings" from "not yet run".

### Requirements and criteria
- `.planning/REQUIREMENTS.md` — SSYNC-V125-13, -14, -15, -16, -17
- `.planning/ROADMAP.md` § "Phase 125" — the five success criteria

### Project conventions
- `./CLAUDE.md` — § "Writing verifiable acceptance criteria" and § "Test gates". Server tests are
  SET-BASED: `cd packages/server && node scripts/test-gate.mjs`, **run from `packages/server`**,
  never raw `npx vitest run`, never a fixed pass-count.
- **Anchor prohibition greps to ADDED or CODE lines, never whole files.** Phase 124 produced FOUR
  toothless criteria, every one the same mechanism: a plan mandated doc-comment text, then grepped a
  token that text contains. A warning was given in advance and it recurred four times, so this is a
  rule now, not advice.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `rbac_audit` is the shape to copy: autoincrement id, `ts` defaulting to `datetime('now')`, an
  actor column, JSON payload columns, indexes on what is queried.
- Phase 122's PRAGMA-guarded `ALTER TABLE tables ADD COLUMN columns_fingerprint` is the migration
  precedent for touching an existing table safely.
- `serializeFingerprintSnapshot` already exists for writing the `{"v":1,"columns":{...}}` payload —
  Phase 122 shipped it unused by any writer, for exactly this moment.

### Established Patterns
- Pure libs compute; routes stay thin. The apply transaction belongs in a lib, the route wires it.
- **Atomicity has a precedent worth copying**: `applyDashboardImport` (v1.24) runs all its steps in
  one `db.transaction` and proved it with trigger-induced rollbacks asserting a full row-count
  snapshot is unchanged. Criterion 2 here demands the same kind of proof — only the `tables` row
  changes.

### Integration Points
- Apply surfaces through a route alongside Phase 122's `GET /api/tables/:id/schema-check`, which is
  gated on `datasets:manage` AND `dashboards:manage_access` (widened in Phase 124 because the report
  names records across every dashboard). **A write route should be at least as strict.**
- Phase 126 reads this history for the UI and owns clearing it.

### Reality check for testing
- **Five of the nine registered tables have been dropped from Kinetica**, so most live checks return
  `table_missing` rather than a diff. Expected, not a defect — but it shapes what can be exercised
  live versus what needs fixtures.

</code_context>

<specifics>
## Specific Ideas

- The operator chose a **capped** history while the milestone-level decision had been "kept until
  cleared", and resolved the tension by making the drop **visible** rather than silent. That is the
  same instinct as the naming advisories in Phase 124: tell the operator what the system did rather
  than quietly handling it.

</specifics>

<deferred>
## Deferred Ideas

- **Viewing and clearing history in the UI** — `SSYNC-V125-18`, owned by Phase 126. This phase makes
  the data durable and readable; it does not render it.
- **Auto-repair (`SSYNC-F1`)** — applying updates the snapshot only. No widget, layer, metric or
  format rule is ever rewritten. Milestone-level locked decision, and criterion 2 enforces it.
- **`SSYNC-F3`** (check all tables at once) and **`SSYNC-F6`** (the server-side column-existence
  gate) — still deferred.

</deferred>

---

*Phase: 125-apply-sync-history*
*Context gathered: 2026-09-24*
