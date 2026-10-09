/**
 * schemaApply.ts — the APPLY side of v1.25 Schema Sync.
 *
 * WHY THIS MODULE EXISTS
 * -----------------------
 * Phases 122, 123 and 124 deliberately wrote NOTHING: they detect, diff and report.
 * `tables.columns_fingerprint` gained a read-only accessor in Phase 122 and no setter
 * anywhere in the tree. That ends here. This module owns the two pure decisions the apply
 * depends on, and Plan 125-03's `applySchemaSync` — the transaction that actually writes —
 * lands here beside them.
 *
 * What lives here:
 *   - `isStaleAgainst` / `SCHEMA_APPLY_STALE_MESSAGE` — the optimistic-concurrency refusal.
 *     Apply re-reads Kinetica and REFUSES if reality moved after the operator's report was
 *     built, so the operator never applies something they did not see (125-CONTEXT.md,
 *     locked).
 *   - `renderColumnType` / `renderColumnsMap` / `TYPE_NAMING_REFINEMENTS` — the renderer
 *     that turns a precise fingerprint into the `tables.columns` string every config panel
 *     reads, WITHOUT re-flattening the type information this milestone exists to preserve.
 *   - `applySchemaSync` (Plan 125-03) — the transaction wiring `setTableSchemaSnapshot` and
 *     `insertTableSyncHistoryEntry` together.
 *
 * PURITY, precisely. Everything ABOVE the Plan 125-03 banner near the bottom of this file is
 * pure — no `db`, no `express`, no `fetch` — and is independently testable as such.
 * `applySchemaSync` below that banner is NOT pure: it imports `db` at VALUE level, the way
 * `dashboardImport.ts` does, because a transaction cannot be expressed any other way. That
 * makes this module a deliberate exception to the "pure libs compute, routes stay thin" rule
 * that `schemaDiff.ts` and `schemaImpact.ts` follow strictly — the WRITE still lives in a lib
 * rather than in the route, so the route stays thin, but the lib is no longer pure.
 */

import {
  canonicalFingerprintJson,
  formatFingerprint,
  parseFingerprintSnapshot,
  serializeFingerprintSnapshot,
  type ColumnFingerprint,
  type ColumnFingerprintMap,
} from "./schemaFingerprint";
import { diffResult } from "./schemaDiff";
import { buildImpactReport, type ImpactReport } from "./schemaImpact";
import {
  db,
  getTable,
  getTableColumnsFingerprint,
  insertTableSyncHistoryEntry,
  listDashboards,
  loadColumnRefsInput,
  setTableSchemaSnapshot,
  type SyncChangeset,
} from "../db";

/**
 * The operator-facing refusal. Rendered VERBATIM by Phase 126.
 *
 * It does NOT name which column moved, deliberately: the remedy is to re-run the check,
 * which produces the precise, current list with its full impact report -- naming a stale
 * subset here would invite acting on it.
 */
export const SCHEMA_APPLY_STALE_MESSAGE =
  "Kinetica's columns changed again after this report was built, so applying it would store " +
  "a snapshot you have not seen. Nothing was written. Re-run the check to see the current " +
  "state, then apply that.";

/**
 * True when `live` differs from the map the report was built from, in ANY column's base or
 * refinements, or in the set of columns present. Column ORDER is not a difference.
 *
 * This is the whole optimistic-concurrency mechanism, and it is a WHOLE-MAP comparison, not
 * a digest. There is no prior optimistic-concurrency precedent in this codebase, so the
 * choice is recorded here rather than inferred:
 *
 *   - The client ECHOES the map. `SchemaCheckResult` already carries `live:
 *     ColumnFingerprintMap` on BOTH the `diff` and `baseline_required` outcomes, so the
 *     client is handing back something it already holds verbatim. That costs nothing new:
 *     no field added to the check response, no hashing mirrored into `packages/web`, and
 *     nothing for a future reader to keep in sync across the package boundary.
 *   - A DIGEST was the alternative. It is smaller on the wire, but it has to be MINTED
 *     somewhere: either the check route grows a new response field (a change to a contract
 *     two shipped phases and Phase 126 are planned against, for a payload problem that does
 *     not exist -- the widest table in the dev database is 251 columns, roughly 20 KB
 *     against express.json's 1 MB limit) or `packages/web` grows a second implementation of
 *     this canonical form plus a hash, which is a mirror that can drift silently and whose
 *     drift presents as "apply keeps saying my report is stale".
 *   - Comparing canonical JSON strings also has no collision surface at all, which a hash,
 *     however unlikely, does.
 *
 * The cost of echoing is a larger request body and nothing else.
 */
export function isStaleAgainst(
  reportedLive: ColumnFingerprintMap,
  live: ColumnFingerprintMap
): boolean {
  return canonicalFingerprintJson(reportedLive) !== canonicalFingerprintJson(live);
}

/**
 * Property markers that NAME the column's type outright, in precedence order (most
 * specific first). When one is present it is emitted BARE, replacing the base entirely.
 *
 * Everything else -- char/int widths and anything unrecognised -- goes through
 * formatFingerprint, which produces `base(marker,...)`. That is safe because the web's
 * normalizeType strips the parenthetical: `string(char4)` -> `string`, `int(int8)` -> `int`,
 * both of which land in the same class the old INFORMATION_SCHEMA value did, while the
 * width itself is now PRESERVED in the stored map instead of being destroyed the way
 * `character(256)` destroyed it for char1, char4 and char16 alike.
 */
const TYPE_NAMING_REFINEMENTS: readonly string[] = [
  // Temporal, from DATETIME_TYPES. Emitted bare because normalizeType would strip the
  // parenthetical off `long(timestamp)` and leave `long`, which is a member of
  // NUMERIC_TYPES -- so the config panels would classify a TIMESTAMP column as a NUMBER.
  // That is precisely the flattening showTableTypes.ts exists to undo, and precisely the
  // trap classifyFingerprint was written to avoid one layer up (124-01). Reintroducing it
  // here would put it in the WRITE path, where it is durable rather than transient.
  "timestamp",
  "datetime",
  "date",
  "time",
  // Boolean, from BOOLEAN_TYPES.
  "boolean",
  "bool",
  // Spatial. Emitted bare for the OTHER web branch: isColumnDrillDownSafe excludes
  // {wkt, wkb, bytes, blob, text, point, geometry, geography} by normalized name (PITFALL
  // D-01). `string(wkt)` normalizes to `string`, which is NOT excluded -- so rendering a
  // geometry column through formatFingerprint would silently admit it to the drill-down
  // picker, where equality filters on geometry are exactly what D-01 exists to prevent.
  "wkt",
  "wkb",
];

/**
 * KNOWN GAP, carried deliberately rather than papered over.
 *
 * Kinetica's /show/table exposes no marker for an unrestricted-length string column. Such a
 * column fingerprints as {base:"string", refinements:[]} and therefore renders "string",
 * where INFORMATION_SCHEMA reported "text" -- a member of the web's
 * EXCLUDED_DRILLDOWN_TYPES. So after an apply, a column that INFORMATION_SCHEMA called
 * `text` becomes selectable in the drill-down picker, where it was excluded before.
 *
 * This is over-inclusion, which columnTypes.ts's own D-01 comment already names as the
 * acceptable direction ("conservative pass-through for unknown types ... over-exclusion
 * would hide valid columns"). It is stated here, and in this phase's SUMMARY, rather than
 * discovered later. `text` appears in the dev database's current tables.columns vocabulary,
 * so this is a real case, not a hypothetical one.
 */
export const SCHEMA_APPLY_TEXT_WIDTH_GAP =
  "Kinetica's /show/table carries no marker for an unrestricted-length string column, so " +
  "a column INFORMATION_SCHEMA reported as `text` is stored as `string` after an apply and " +
  "becomes selectable in the drill-down picker. This report does NOT detect that case.";

/** Render ONE fingerprint into the tables.columns vocabulary. */
export function renderColumnType(fp: ColumnFingerprint): string {
  const markers = new Set(fp.refinements.map((r) => r.toLowerCase()));
  for (const named of TYPE_NAMING_REFINEMENTS) {
    if (markers.has(named)) return named;
  }
  return formatFingerprint(fp);
}

/**
 * Render a whole live fingerprint map into the Record<string,string> that `tables.columns`
 * stores and every config panel reads. Key order follows the input map (Kinetica's ordinal
 * order), which is what the panels already present.
 */
export function renderColumnsMap(live: ColumnFingerprintMap): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of Object.keys(live)) out[name] = renderColumnType(live[name]);
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// Plan 125-03 — the WRITE. Everything above this line is pure; everything below is not.
// ═══════════════════════════════════════════════════════════════════════════════════════

/**
 * The apply's four outcomes.
 *
 *   "applied"      -- the snapshot was replaced. `kind` says whether this established a first
 *                     precise baseline or applied a real changeset. `recorded` is ALWAYS true
 *                     here; it is a field rather than an implication so Phase 126 renders the
 *                     fact instead of re-deriving it.
 *   "no_changes"   -- live already matches the stored snapshot. NOTHING was written: no row
 *                     update, no updated_at bump, no history entry. An apply that changed
 *                     nothing wrote nothing worth remembering, and recording it would consume
 *                     one of the 20 capped slots for no information (125-CONTEXT.md).
 *   "stale"        -- Kinetica moved after the report was built. NOTHING was written.
 *   "table_missing"-- the registered table id does not exist locally. NOTHING was written.
 *
 * NOTE what is NOT here: there is no outcome for "refused because the change is breaking",
 * and no input that could ask for one. SSYNC-V125-15 is a property of this union's shape,
 * not of a branch inside it -- the operator decides with the report in front of them, and
 * "stale" is the only refusal that exists.
 */
export type SchemaApplyResult =
  | {
      outcome: "applied";
      kind: "baseline" | "diff";
      table: string;
      tableId: number;
      recorded: true;
      historyId: number;
      /** How many older entries this apply pushed out of the 20-entry cap. */
      droppedThisApply: number;
      /** The map written to tables.columns, echoed so the caller need not re-read. */
      columns: Record<string, string>;
      changeset: SyncChangeset | null;
      message: string;
    }
  | { outcome: "no_changes"; table: string; tableId: number; message: string }
  | { outcome: "stale"; table: string; tableId: number; message: string }
  | { outcome: "table_missing"; table: string; tableId: number; message: string };

/**
 * The operator-facing outcome strings, alongside SCHEMA_APPLY_STALE_MESSAGE above. All four
 * are rendered VERBATIM by Phase 126, which is planned against this exact text.
 */
export const SCHEMA_APPLY_BASELINE_MESSAGE =
  "Baseline established. This table's snapshot predated precise type capture, so there was " +
  "nothing to compare against -- the live column set is now stored exactly, and the next " +
  "check can report type changes.";

export const SCHEMA_APPLY_NO_CHANGES_MESSAGE =
  "Nothing to apply -- the stored snapshot already matches Kinetica. No history entry was " +
  "recorded, because nothing changed.";

export const SCHEMA_APPLY_TABLE_MISSING_MESSAGE =
  "That registered table no longer exists in this app, so there is nothing to apply to.";

export const schemaApplyDiffMessage = (c: SyncChangeset): string =>
  `Applied. The stored snapshot now matches Kinetica: ${c.added.length} added, ` +
  `${c.removed.length} removed, ${c.retyped.length} retyped. The changeset and the impact ` +
  `report as it stood are kept in this table's sync history.`;

/**
 * applySchemaSync -- v1.25 Phase 125 (SSYNC-V125-13/-14/-15/-16/-17).
 *
 * THE ONLY WRITE PATH in v1.25. Phases 122-124 carried acceptance criteria proving they
 * wrote nothing; this is where that ends.
 *
 * TOUCHES ONE ROW. `tables` for the id given, plus an append to `table_sync_history`.
 * No widget, layer, custom metric or column-format rule is ever read for WRITING here --
 * `loadColumnRefsInput` and `listDashboards` are SELECTs feeding the report, nothing more.
 * Auto-repair is SSYNC-F1, deferred at milestone level; ROADMAP criterion 2 enforces it.
 *
 * THE REPORT IS REBUILT HERE, NOT ACCEPTED FROM THE CLIENT. The caller hands back only the
 * fingerprint map its report was built FROM, so the staleness check can run; the report
 * stored in history is then composed server-side from the freshly re-read live map. That is
 * what makes the locked guarantee actually hold -- a history entry can never record a report
 * that fails to describe what was written -- and it keeps a client from persisting arbitrary
 * text into an audit record.
 *
 * NO OVERRIDE EXISTS, BY CONSTRUCTION (SSYNC-V125-15). There is no parameter, body field,
 * query flag or branch that lets a caller override, bypass or push past a breaking change --
 * no force flag, in other words -- and there is no "the findings must be acknowledged first"
 * step either. An apply carrying removals and retypes runs exactly like one carrying only
 * additions. The operator decides with the report in front of them; the only refusal in this
 * function is staleness, which is about what the operator SAW, not about how bad the change
 * is.
 *
 * ONE TRANSACTION, following applyDashboardImport (v1.24). The snapshot update, the history
 * insert and the cap sweep either all land or none do.
 *
 * THIS MODULE IS THEREFORE NOT PURE, unlike schemaDiff.ts and schemaImpact.ts: it imports
 * `db` at VALUE level. `renderColumnsMap`, `renderColumnType`, `isStaleAgainst` and
 * `canonicalFingerprintJson` above remain pure and independently testable; only this
 * function touches the database.
 */
export function applySchemaSync(input: {
  tableId: number;
  /** Schema-qualified name, as the check reports it. */
  table: string;
  /** Freshly re-read from Kinetica by the caller. */
  live: ColumnFingerprintMap;
  /** The map the operator's report was built from, echoed back by the client. */
  reportedLive: ColumnFingerprintMap;
  /** Username, matching rbac_audit's actor precedent. */
  actor: string;
}): SchemaApplyResult {
  // 1. Unknown table id. `insertTableSyncHistoryEntry` THROWS `FOREIGN KEY constraint
  //    failed` on an unknown tableId (better-sqlite3 enforces FKs by default -- measured in
  //    125-01), so this must be checked before anything else, not relied on to fail late.
  const existing = getTable(input.tableId);
  if (!existing) {
    return {
      outcome: "table_missing",
      table: input.table,
      tableId: input.tableId,
      message: SCHEMA_APPLY_TABLE_MISSING_MESSAGE,
    };
  }

  // 2. Optimistic concurrency. This runs BEFORE anything is computed and long before the
  //    transaction opens, so a stale apply provably performs zero writes rather than
  //    relying on a rollback to undo them.
  if (isStaleAgainst(input.reportedLive, input.live)) {
    return {
      outcome: "stale",
      table: input.table,
      tableId: input.tableId,
      message: SCHEMA_APPLY_STALE_MESSAGE,
    };
  }

  // 3. The stored snapshot. null means no precise baseline -- an old-format row or a corrupt
  //    payload; Phase 122 treats both identically and so does this.
  const stored = parseFingerprintSnapshot(getTableColumnsFingerprint(input.tableId));

  let kind: "baseline" | "diff";
  let changeset: SyncChangeset | null = null;
  let report: ImpactReport | null = null;

  if (stored === null) {
    // 4a. Baseline. No changeset and no report exist to record, because there was nothing
    //     comparable to diff against -- that is what a baseline IS (122-CONTEXT.md).
    kind = "baseline";
  } else {
    const diff = diffResult(input.table, stored, input.live);
    // `diffResult` ALWAYS returns the "diff" arm -- the `outcome !== "diff"` half narrows the
    // SchemaCheckResult union for TypeScript and nothing else. Do not go hunting for the
    // case that produces the other outcomes here; there isn't one.
    if (diff.outcome !== "diff" || !diff.hasChanges) {
      return {
        outcome: "no_changes",
        table: input.table,
        tableId: input.tableId,
        message: SCHEMA_APPLY_NO_CHANGES_MESSAGE,
      };
    }
    kind = "diff";
    changeset = {
      v: 1,
      added: diff.added.map((a) => ({ column: a.column, liveType: a.liveType })),
      removed: diff.removed.map((r) => ({ column: r.column, storedType: r.storedType })),
      retyped: diff.retyped.map((r) => ({
        column: r.column,
        storedType: r.storedType,
        liveType: r.liveType,
      })),
    };
    report = buildImpactReport({
      check: diff,
      tableId: input.tableId,
      refsInput: loadColumnRefsInput(input.tableId),
      dashboards: listDashboards().map((d) => ({ id: d.id, name: d.name })),
    });
  }

  // 5. Both halves of the snapshot, BOTH derived from the freshly re-read live map -- never
  //    from the client's echoed one. The two serialisers are NOT interchangeable:
  //    `canonicalFingerprintJson` is equality-only and is never stored; the stored form is
  //    `serializeFingerprintSnapshot` (125-02-SUMMARY.md).
  const columns = renderColumnsMap(input.live);
  const fingerprintJson = serializeFingerprintSnapshot(input.live);

  // 6. One transaction. Snapshot update + history insert + the insert's own cap sweep all
  //    land together or not at all.
  const txn = db.transaction(() => {
    setTableSchemaSnapshot(input.tableId, columns, fingerprintJson);
    return insertTableSyncHistoryEntry({
      tableId: input.tableId,
      actor: input.actor,
      kind,
      changeset,
      report,
    });
  });
  const { id: historyId, dropped } = txn();

  return {
    outcome: "applied",
    kind,
    table: input.table,
    tableId: input.tableId,
    recorded: true,
    historyId,
    droppedThisApply: dropped,
    columns,
    changeset,
    message:
      kind === "baseline" ? SCHEMA_APPLY_BASELINE_MESSAGE : schemaApplyDiffMessage(changeset!),
  };
}
