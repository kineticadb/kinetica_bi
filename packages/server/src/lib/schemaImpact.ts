/**
 * schemaImpact.ts — turn a Phase 122 `SchemaCheckResult` ("diff" outcome) plus Phase 123's
 * `ColumnRef` findings into `ImpactReport`, the report an operator reads and acts on.
 *
 * PURE.
 * -----
 * No `db`, no `express`, no `fetch`, no Kinetica call — this module only composes
 * already-computed values the caller (Plan 124-04's route) supplies.
 *
 * THIS IS A CONTRACT.
 * --------------------
 * Phase 125 persists `ImpactReport` verbatim in sync history and Phase 126 renders it — both are
 * planned against the text of this module before either is implemented further. Every field is
 * therefore JSON-safe (no `Map`, `Set`, function or class instance anywhere in the exported shape)
 * and the output is byte-stable: no `localeCompare`, no `Date`, no locale-dependent ordering
 * anywhere in this file. Phase 125's persisted history would otherwise churn between machines that
 * disagree about collation, for identical input — the same discipline `schemaDiff.ts` and
 * `columnRefs.ts` already state in their own sort comments.
 *
 * SEVERITY IS COMPUTED FROM THE TYPE CLASS, NEVER FROM THE BASE ALONE.
 * ----------------------------------------------------------------------
 * See `columnTypeClass.ts`'s header for why a base-only rule grades a `timestamp -> bigint` retype
 * harmless (both bases involve `long`) when it is one of the most breaking changes this report can
 * describe. `classifyFingerprint`/`severityForRetype` are the only place that decision is made;
 * this module never re-derives it.
 *
 * CERTAINTY PROSE LIVES HERE, RENDERED VERBATIM.
 * ------------------------------------------------
 * The wording that decides whether an operator trusts a finding is too important to be invented in
 * the rendering layer, where it can drift or soften across a re-render — 124-CONTEXT.md locks this.
 * One source (`certaintyProse`, below), consistent everywhere.
 */

import type { ColumnFingerprint } from "./schemaFingerprint";
import type { SchemaCheckResult } from "./schemaDiff";
import type {
  ColumnRef,
  ColumnRefMatch,
  ColumnRefRecordKind,
  ColumnRefSite,
  ColumnRefTableScope,
  ColumnRefsInput,
  RefConfidence,
} from "./columnRefs";
import { collectColumnRefs } from "./columnRefs";
import type { ColumnTypeClass, ImpactSeverity } from "./columnTypeClass";
import {
  ADDED_SEVERITY,
  REMOVED_SEVERITY,
  classifyFingerprint,
  severityForRetype,
} from "./columnTypeClass";
import type { DashboardNameRow, ImpactAdvisory, NamingContext } from "./impactNaming";
import { buildNamingContext, namingKey, resolveRecordName, summariseAdvisories } from "./impactNaming";

// Re-exported so Phase 125/126 have ONE import site for the whole report vocabulary.
export type { ImpactSeverity, ImpactAdvisory };

// -------------------------------------------------------------------------------------------
// The ImpactReport contract. Phase 125 persists this; Phase 126 renders it. Reproduced verbatim
// in 124-03-SUMMARY.md before either of those phases is planned further.
// -------------------------------------------------------------------------------------------

/** Which diff group a column came from. Severity is a function of this plus, for a retype, the
 *  type-class flip test in columnTypeClass.ts. */
export type ImpactChangeKind = "removed" | "retyped" | "added";

/** One reference SITE inside one record. Granularity is inherited from ColumnRef: one entry per
 *  site, not one per text match (the matches live inside). */
export type ImpactReference = {
  site: ColumnRefSite;
  path: string;
  /** The machine-readable tier, straight from ColumnRef. */
  confidence: RefConfidence;
  tableScope: ColumnRefTableScope;
  /** Report-ready prose the UI renders VERBATIM. Locked in 124-CONTEXT.md: the tier AND the
   *  prose, one source, so the wording cannot drift or soften in the rendering layer. */
  certainty: string;
  /** Matched line, 1-based line number and 0-based in-line offset, per free-SQL match. Empty for
   *  value-equality sites. */
  matches: ColumnRefMatch[];
};

/** One record affected by one column's change. ALL of that record's reference sites for that
 *  column are grouped here — a widget that matches through both a structured field AND its own
 *  config.sql appears ONCE, with two references. Grouping by record is REQUIRED, not optional
 *  (124-CONTEXT.md, carried from Phase 123). */
export type ImpactRecord = {
  recordKind: ColumnRefRecordKind;
  /** null ONLY for a column-format rule, whose key is (table_id, column_name). */
  recordId: number | null;
  /** The record's own name, "" when it carries none. */
  name: string;
  dashboardName: string | null;
  /** The composed operator-facing label, rendered VERBATIM. Title + dashboard name by default;
   *  the id appears only as a disambiguator or a fallback, and never without an advisory. */
  displayLabel: string;
  /** Naming advisories for THIS record. Also summarised once at report level. */
  advisories: ImpactAdvisory[];
  references: ImpactReference[];
  /** Present ONLY on a widget that carries a frozen `config.drillDownColumnType` for this column,
   *  and ONLY under a BREAKING retype (SSYNC-V125-12, ROADMAP criterion 4). Absent otherwise —
   *  never `null`, never an empty object. */
  staleDrillDownType?: { frozenType: string; message: string };
};

/** One changed column, with every record that references it. */
export type ImpactColumn = {
  column: string;
  changeKind: ImpactChangeKind;
  /** The rendered stored type (formatFingerprint). null for an ADDED column. */
  storedType: string | null;
  /** The rendered live type. null for a REMOVED column. */
  liveType: string | null;
  /** The stored/live type CLASS. null on the side that does not exist. */
  storedClass: ColumnTypeClass | null;
  liveClass: ColumnTypeClass | null;
  /** One-line, report-ready explanation of the change. Rendered VERBATIM. */
  summary: string;
  /** Empty for an ADDED column, by design — an added column breaks nothing. */
  records: ImpactRecord[];
};

export type ImpactSection = { severity: ImpactSeverity; columns: ImpactColumn[] };

export type ImpactReport = {
  v: 1;
  /** Fully-qualified table name, echoing SchemaCheckResult.table. */
  table: string;
  tableId: number;
  /** "changes" -> at least one column changed. "no_changes" -> the check ran and found nothing.
   *  A report being ABSENT from the response is what "not yet run / not applicable" looks like —
   *  Phase 126 therefore distinguishes all three states. */
  outcome: "changes" | "no_changes";
  /** ALWAYS exactly three, ALWAYS breaking, changed, harmless. An empty section has an empty
   *  `columns` array; it is never an omitted key. */
  sections: ImpactSection[];
  /** The report-level half of the locked BOTH-places naming rule. */
  advisorySummary: ImpactAdvisory[];
  /** What this report deliberately does NOT check. Rendered VERBATIM. */
  knownGaps: string[];
};

/** The wire shape of GET /api/tables/:id/schema-check once Plan 124-04 wires this in.
 *  `impact` is attached ONLY to the "diff" outcome. */
export type SchemaCheckResponse = SchemaCheckResult & { impact?: ImpactReport };

/**
 * Certainty prose, keyed off confidence tier and table scope. Criterion 5 requires free-SQL
 * findings to read as *possibly* affected rather than confirmed; the word "confirmed" therefore
 * appears ONLY in the `exact` branch.
 */
export function certaintyProse(
  column: string,
  path: string,
  confidence: RefConfidence,
  tableScope: ColumnRefTableScope,
): string {
  let base: string;
  if (confidence === "exact") {
    base = `confirmed — this record stores the column in its \`${path}\` field.`;
  } else if (confidence === "low-confidence") {
    base =
      `possibly affected — \`${column}\` is a short or common name, so this text match in ` +
      `\`${path}\` is more likely than most to be a false positive.`;
  } else {
    base =
      `possibly affected — \`${path}\` mentions \`${column}\`, but the match is text-based and ` +
      `may be a false positive.`;
  }
  if (tableScope === "unresolved") {
    base +=
      ` This record's own table could not be determined, so it is reported for every table that ` +
      `changes.`;
  }
  return base;
}

/**
 * The one recorded KNOWN GAP (124-CONTEXT.md's deferred item): `dynamicView.columns_json[].type`
 * is a SECOND frozen type cache alongside a widget's `drillDownColumnType`, and a retype leaves it
 * stale in exactly the same way. It does not fit the severity model cheaply — unlike
 * `drillDownColumn`, `columnRefs.ts` enumerates no site for `columns_json[].type` (only
 * `columns_json[].name`), so surfacing it would mean writing a traversal that module deliberately
 * does not provide. Recorded here, rendered verbatim by Phase 126, rather than silently ignored.
 */
export const COLUMNS_JSON_TYPE_GAP =
  "Dynamic views cache their own column list with a frozen type (`columns_json[].type`). That is " +
  "a second frozen type cache, alongside a widget's `drillDownColumnType`, and a retype leaves it " +
  "stale in the same way. This report does NOT check it.";

/**
 * SSYNC-V125-12 / ROADMAP criterion 4. `ChartConfigPanel.tsx` freezes the column's type into
 * `config.drillDownColumnType` at SAVE time (69 widget configs carry it today). A retype leaves
 * that value stale, and NOTHING errors — the widget keeps filtering with the old type until
 * someone reopens its config and re-picks the column. That silence is precisely why this report
 * exists, so the stale value is surfaced verbatim next to the live class.
 *
 * Only a BREAKING retype is flagged. A `changed` retype (int -> double, char8 -> char32) leaves the
 * frozen CLASS correct, so flagging it would be noise.
 *
 * This is a FILTER over findings collectColumnRefs already produced, not a new traversal
 * (124-RESEARCH.md §3.1): the `widget.config.drillDownColumn` site is already enumerated, and the
 * frozen value is read off the widget row already present in ColumnRefsInput.
 */
const STALE_DRILL_DOWN_SITE: ColumnRefSite = "widget.config.drillDownColumn";

function staleDrillDownFor(
  refsForRecord: ColumnRef[],
  recordKind: ColumnRefRecordKind,
  recordId: number | null,
  severity: ImpactSeverity,
  changeKind: ImpactChangeKind,
  liveClass: ColumnTypeClass | null,
  widgets: ColumnRefsInput["widgets"],
): { frozenType: string; message: string } | undefined {
  if (recordKind !== "widget") return undefined;
  if (severity !== "breaking" || changeKind !== "retyped") return undefined;
  if (!refsForRecord.some((r) => r.site === STALE_DRILL_DOWN_SITE)) return undefined;
  const widget = widgets.find((w) => w.id === recordId);
  const frozen = widget?.config?.["drillDownColumnType"];
  if (typeof frozen !== "string" || frozen === "") return undefined;
  return {
    frozenType: frozen,
    message:
      `This widget's drill-down is frozen at type "${frozen}", but the column is now ` +
      `${liveClass}. It keeps filtering with the stale type until someone reopens its config ` +
      `and re-picks the column — nothing errors in the meantime.`,
  };
}

export type ImpactInput = {
  /** Must be the "diff" outcome. The caller (Plan 124-04) does not call this for the other two. */
  check: Extract<SchemaCheckResult, { outcome: "diff" }>;
  tableId: number;
  refsInput: ColumnRefsInput;
  dashboards: DashboardNameRow[];
};

// Byte-stable ascending sort, mirroring schemaDiff.ts's byColumnAscending. Deliberately NOT
// localeCompare — Phase 125 persists this and a locale-dependent order produces spurious history
// churn between machines for identical input.
function byColumnAscending(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function buildImpactReport(input: ImpactInput): ImpactReport {
  const { check, tableId, refsInput, dashboards } = input;

  // Step 1: walked columns are removed + retyped ONLY. Added columns are deliberately excluded
  // (124-CONTEXT.md discretion #2 / locked_design item 4) — a pre-existing reference to a name
  // that has just started existing describes something already broken and now FIXED.
  const walkedColumns = [
    ...check.removed.map((r) => r.column),
    ...check.retyped.map((r) => r.column),
  ];

  // Step 2: ONE collectColumnRefs call, no per-column loop.
  const refs: ColumnRef[] =
    walkedColumns.length === 0 ? [] : collectColumnRefs(refsInput, { tableId, columns: walkedColumns });

  // Step 3.
  const ctx: NamingContext = buildNamingContext(refsInput, dashboards);

  // Step 4: group by column, preserving collectColumnRefs's byte-stable order.
  const byColumn: Record<string, ColumnRef[]> = {};
  for (const ref of refs) {
    (byColumn[ref.column] ??= []).push(ref);
  }

  // De-duplicate advisories by namingKey(recordKind, recordId) across the WHOLE report — a widget
  // appearing under three changed columns counts once (124-02's caller-side half of the contract).
  const seenAdvisoryRecords = new Set<string>();
  const advisoryAccumulator: ImpactAdvisory[] = [];

  function buildRecordsFor(
    column: string,
    changeKind: ImpactChangeKind,
    severity: ImpactSeverity,
    liveClass: ColumnTypeClass | null,
  ): ImpactRecord[] {
    const columnRefs = byColumn[column] ?? [];

    // Group by namingKey(recordKind, recordId), preserving first-seen order — which is already
    // byte-stable because collectColumnRefs sorted `refs` before we grouped them by column above.
    const order: string[] = [];
    const groups = new Map<string, ColumnRef[]>();
    for (const ref of columnRefs) {
      const key = namingKey(ref.recordKind, ref.recordId);
      if (!groups.has(key)) {
        groups.set(key, []);
        order.push(key);
      }
      groups.get(key)!.push(ref);
    }

    const records: ImpactRecord[] = [];
    for (const key of order) {
      const group = groups.get(key)!;
      const first = group[0];
      const naming = resolveRecordName(
        { recordKind: first.recordKind, recordId: first.recordId, recordLabel: first.recordLabel },
        ctx,
      );

      if (!seenAdvisoryRecords.has(key)) {
        seenAdvisoryRecords.add(key);
        advisoryAccumulator.push(...naming.advisories);
      }

      const references: ImpactReference[] = group.map((r) => ({
        site: r.site,
        path: r.path,
        confidence: r.confidence,
        tableScope: r.tableScope,
        certainty: certaintyProse(column, r.path, r.confidence, r.tableScope),
        matches: r.matches,
      }));

      const record: ImpactRecord = {
        recordKind: first.recordKind,
        recordId: first.recordId,
        name: naming.name,
        dashboardName: naming.dashboardName,
        displayLabel: naming.displayLabel,
        advisories: naming.advisories,
        references,
      };

      const stale = staleDrillDownFor(
        group,
        first.recordKind,
        first.recordId,
        severity,
        changeKind,
        liveClass,
        refsInput.widgets,
      );
      if (stale) record.staleDrillDownType = stale;

      records.push(record);
    }
    return records;
  }

  const allColumns: { severity: ImpactSeverity; column: ImpactColumn }[] = [];

  // Step 5: removed columns — always REMOVED_SEVERITY ("breaking").
  for (const r of check.removed) {
    const storedClass = classifyFingerprint(r.stored);
    const records = buildRecordsFor(r.column, "removed", REMOVED_SEVERITY, null);
    allColumns.push({
      severity: REMOVED_SEVERITY,
      column: {
        column: r.column,
        changeKind: "removed",
        storedType: r.storedType,
        liveType: null,
        storedClass,
        liveClass: null,
        summary: `The column \`${r.column}\` is gone from the table. Its stored type was ${r.storedType}.`,
        records,
      },
    });
  }

  // Step 6: retyped columns.
  for (const r of check.retyped) {
    const severity = severityForRetype(r.stored, r.live);
    const storedClass = classifyFingerprint(r.stored);
    const liveClass = classifyFingerprint(r.live);
    const summary =
      severity === "breaking"
        ? `The column \`${r.column}\` changed from ${r.storedType} to ${r.liveType}. That moves it from the ${storedClass} type class to ${liveClass}, which is what the app branches on — dependents can break.`
        : `The column \`${r.column}\` changed from ${r.storedType} to ${r.liveType}. It stays in the ${storedClass} type class, so nothing in the app misbehaves, but the data meaning moved.`;
    const records = buildRecordsFor(r.column, "retyped", severity, liveClass);
    allColumns.push({
      severity,
      column: {
        column: r.column,
        changeKind: "retyped",
        storedType: r.storedType,
        liveType: r.liveType,
        storedClass,
        liveClass,
        summary,
        records,
      },
    });
  }

  // Step 7: added columns — always ADDED_SEVERITY ("harmless"), NOT ref-walked, records: [].
  for (const a of check.added) {
    const liveClass = classifyFingerprint(a.live);
    allColumns.push({
      severity: ADDED_SEVERITY,
      column: {
        column: a.column,
        changeKind: "added",
        storedType: null,
        liveType: a.liveType,
        storedClass: null,
        liveClass,
        summary: `The column \`${a.column}\` is new (${a.liveType}). Nothing can be broken by it — it only needs to become selectable in the config panels.`,
        records: [],
      },
    });
  }

  // Step 9: partition into exactly three sections, fixed order, columns sorted byte-ascending.
  const bySeverity: Record<ImpactSeverity, ImpactColumn[]> = { breaking: [], changed: [], harmless: [] };
  for (const { severity, column } of allColumns) {
    bySeverity[severity].push(column);
  }
  const severityOrder: ImpactSeverity[] = ["breaking", "changed", "harmless"];
  for (const severity of severityOrder) {
    bySeverity[severity].sort((a, b) => byColumnAscending(a.column, b.column));
  }
  const sections: ImpactSection[] = severityOrder.map((severity) => ({
    severity,
    columns: bySeverity[severity],
  }));

  return {
    v: 1,
    table: check.table,
    tableId,
    outcome: check.hasChanges ? "changes" : "no_changes",
    sections,
    advisorySummary: summariseAdvisories(advisoryAccumulator),
    knownGaps: [COLUMNS_JSON_TYPE_GAP],
  };
}
