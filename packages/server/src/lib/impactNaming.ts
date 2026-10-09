/**
 * impactNaming.ts — turns a `ColumnRef`'s bare `(recordKind, recordId, recordLabel)` into the
 * operator-facing label Phase 126 renders VERBATIM.
 *
 * This module is PURE: it reads only already-loaded rows the caller has fetched (widgets, layers,
 * dynamic views, custom metrics, dashboards) — no db, no express, no fetch.
 *
 * The governing principle, quoted from 124-CONTEXT.md § "Naming — the report nudges the operator to
 * fix their naming rather than papering over it": the report NUDGES the operator to fix their
 * naming rather than silently compensating. So an id is a DISAMBIGUATOR (a title collides within
 * its own dashboard) and a FALLBACK (a record has no name at all) — never the default — and it never
 * appears without an advisory explaining why and what to do about it.
 *
 * The wording lives HERE, not in the rendering layer: prose invented downstream drifts and softens.
 * One source, consistent everywhere — Phase 126 renders `displayLabel` and advisory `message`
 * verbatim, never re-worded or re-assembled.
 *
 * `dashboard_layers` has NO name column: a layer's name is `config.name`, a JSON field, and may be
 * absent — so layers hit the missing-name path more often than widgets do (verified 2026-09-23: all
 * 74 widgets are titled, but several real layers carry no `config.name`).
 */

import type { ColumnRefRecordKind, ColumnRefsInput } from "./columnRefs";

/** The two advisory kinds this report ever raises. */
export type ImpactAdvisoryKind = "unnamed-record" | "ambiguous-name";

/** A naming advisory. `message` is report-ready prose the UI renders VERBATIM — never re-worded,
 *  never re-assembled downstream. Locked in 124-CONTEXT.md: the advisory appears BOTH on the
 *  individual finding and once, summarised, at report level. */
export type ImpactAdvisory = { kind: ImpactAdvisoryKind; message: string };

export type RecordNaming = {
  /** The record's own name, exactly as stored. "" when it carries none. */
  name: string;
  /** The dashboard this record lives on. null for table-scoped records (custom metrics and
   *  column-format rules belong to a TABLE, not a dashboard). */
  dashboardName: string | null;
  /** The composed operator-facing label. Rendered VERBATIM by Phase 126. */
  displayLabel: string;
  advisories: ImpactAdvisory[];
};

export type DashboardNameRow = { id: number; name: string };

export type NamingContext = {
  /** dashboard id -> name. A dashboard id absent from this map renders as `dashboard <id>`. */
  dashboardNames: Record<number, string>;
  /** namingKey() values whose name collides inside its own group. */
  ambiguous: ReadonlySet<string>;
  /** namingKey() value -> owning dashboard id. Absent for table-scoped records. */
  dashboardOf: Record<string, number>;
};

/** The operator-facing noun per record kind. A single file-local map, used everywhere so the
 *  wording cannot diverge. */
const RECORD_NOUN: Record<ColumnRefRecordKind, string> = {
  widget: "widget",
  layer: "map layer",
  customMetric: "custom metric",
  dynamicView: "dynamic view",
  tableView: "saved filter view",
  columnDisplayConfig: "column-format rule",
};

/** Plural forms for the report-level summary and the collision advisory. */
const RECORD_NOUN_PLURAL: Record<ColumnRefRecordKind, string> = {
  widget: "widgets",
  layer: "map layers",
  customMetric: "custom metrics",
  dynamicView: "dynamic views",
  tableView: "saved filter views",
  columnDisplayConfig: "column-format rules",
};

/** `${recordKind}|${recordId}` — `recordId` may be `null`, which stringifies to `"null"` and is
 *  only ever reached by `columnDisplayConfig`. */
export function namingKey(recordKind: ColumnRefRecordKind, recordId: number | null): string {
  return `${recordKind}|${recordId}`;
}

/** Per-record-kind name-source, group-id and dashboard-scoped-ness readers, used only by
 *  `buildNamingContext` below. Each entry corresponds to one row of the group-key table reproduced
 *  in the SUMMARY. `isDashboardScoped` is false for `customMetric` (grouped by `table_id`, but it
 *  belongs to a TABLE, not a dashboard — `dashboardOf` must stay absent for it, or its `table_id`
 *  would be misread as a dashboard id downstream). `columnDisplayConfig` is DELIBERATELY absent
 *  entirely: its key is `(table_id, column_name)`, unique by construction, and it has no id to
 *  append even if it were not — it is never ambiguous. */
function collectNameGroups(input: ColumnRefsInput): {
  recordKind: ColumnRefRecordKind;
  recordId: number;
  name: string;
  groupId: number;
  isDashboardScoped: boolean;
}[] {
  const rows: {
    recordKind: ColumnRefRecordKind;
    recordId: number;
    name: string;
    groupId: number;
    isDashboardScoped: boolean;
  }[] = [];

  for (const w of input.widgets) {
    rows.push({
      recordKind: "widget", recordId: w.id, name: w.title, groupId: w.dashboard_id,
      isDashboardScoped: true,
    });
  }
  for (const l of input.layers) {
    const name = typeof l.config?.name === "string" ? (l.config.name as string) : "";
    rows.push({
      recordKind: "layer", recordId: l.id, name, groupId: l.dashboard_id, isDashboardScoped: true,
    });
  }
  for (const dv of input.dynamicViews) {
    rows.push({
      recordKind: "dynamicView", recordId: dv.id, name: dv.name, groupId: dv.dashboard_id,
      isDashboardScoped: true,
    });
  }
  for (const tv of input.tableViews) {
    rows.push({
      recordKind: "tableView", recordId: tv.id, name: tv.view_name, groupId: tv.dashboard_id,
      isDashboardScoped: true,
    });
  }
  for (const m of input.customMetrics) {
    rows.push({
      recordKind: "customMetric", recordId: m.id, name: m.label, groupId: m.table_id,
      isDashboardScoped: false,
    });
  }

  return rows;
}

export function buildNamingContext(
  input: ColumnRefsInput,
  dashboards: DashboardNameRow[],
): NamingContext {
  const dashboardNames: Record<number, string> = Object.fromEntries(
    dashboards.map((d) => [d.id, d.name]),
  );

  const rows = collectNameGroups(input);

  const dashboardOf: Record<string, number> = {};
  // groupKey -> count of NON-EMPTY names sharing it, per record kind. An empty name is never
  // counted toward a collision — two unnamed records are two unnamed records, not an ambiguity.
  const collisionCounts = new Map<string, number>();
  const memberKeys = new Map<string, string[]>();

  for (const row of rows) {
    const key = namingKey(row.recordKind, row.recordId);
    if (row.isDashboardScoped) dashboardOf[key] = row.groupId;

    if (row.name === "") continue;
    const groupKey = `${row.recordKind}|${row.groupId}|${row.name}`;
    collisionCounts.set(groupKey, (collisionCounts.get(groupKey) ?? 0) + 1);
    const members = memberKeys.get(groupKey) ?? [];
    members.push(key);
    memberKeys.set(groupKey, members);
  }

  const ambiguous = new Set<string>();
  for (const [groupKey, count] of collisionCounts) {
    if (count < 2) continue;
    for (const key of memberKeys.get(groupKey) ?? []) ambiguous.add(key);
  }

  return { dashboardNames, ambiguous, dashboardOf };
}

export function resolveRecordName(
  ref: { recordKind: ColumnRefRecordKind; recordId: number | null; recordLabel: string },
  ctx: NamingContext,
): RecordNaming {
  const { recordKind, recordId, recordLabel } = ref;
  const noun = RECORD_NOUN[recordKind];
  const key = namingKey(recordKind, recordId);
  const dashId = ctx.dashboardOf[key];
  const hasDashboard = Object.prototype.hasOwnProperty.call(ctx.dashboardOf, key);
  const dashboardName = hasDashboard ? ctx.dashboardNames[dashId] ?? null : null;
  const dashClause = hasDashboard
    ? ctx.dashboardNames[dashId] !== undefined
      ? ` on dashboard "${ctx.dashboardNames[dashId]}"`
      : ` on dashboard ${dashId}`
    : "";

  if (recordKind === "columnDisplayConfig") {
    return {
      name: recordLabel,
      dashboardName,
      displayLabel: `column-format rule for "${recordLabel}"`,
      advisories: [],
    };
  }

  if (recordLabel === "") {
    return {
      name: recordLabel,
      dashboardName,
      displayLabel: `${noun} ${recordId} (no name)${dashClause}`,
      advisories: [
        {
          kind: "unnamed-record",
          message:
            `This ${noun} has no name, so the report can only identify it by its id (${recordId}). ` +
            `Name it and re-run this check to see it by name.`,
        },
      ],
    };
  }

  if (ctx.ambiguous.has(key)) {
    return {
      name: recordLabel,
      dashboardName,
      displayLabel: `${noun} "${recordLabel}" (id ${recordId})${dashClause}`,
      advisories: [
        {
          kind: "ambiguous-name",
          message:
            `Two or more ${RECORD_NOUN_PLURAL[recordKind]}${dashClause || " on this table"} are ` +
            `named "${recordLabel}", so the report appends the id (${recordId}) to tell them apart. ` +
            `Rename one and re-run this check to see them by name alone.`,
        },
      ],
    };
  }

  return {
    name: recordLabel,
    dashboardName,
    displayLabel: `${noun} "${recordLabel}"${dashClause}`,
    advisories: [],
  };
}

/**
 * The report-level half of the locked BOTH-places rule (124-CONTEXT.md). Finding-level advisories
 * alone risk the pattern going unnoticed across twenty findings; a report-level line alone leaves
 * the operator guessing which findings it refers to. So the same fact is stated in both places,
 * and both strings are composed HERE so they cannot drift apart.
 *
 * Counts BY KIND from the already-composed per-record advisories. It never parses a `message` —
 * `kind` is the machine-readable field precisely so prose stays free to change.
 *
 * Deterministic output order: ambiguous-name, then unnamed-record. A kind with a zero count is
 * OMITTED, never emitted with a count of 0.
 *
 * The caller's contract: pass ONE advisory per affected RECORD, not one per finding. A widget that
 * appears under three changed columns is one unnamed record, not three — Plan 124-03 de-duplicates
 * by `namingKey(recordKind, recordId)` before calling this. The test "ADVISORY: the summary counts
 * records, and repeated advisories from one record count once" pins this function's half of that
 * contract (it counts exactly what it is given); Plan 124-03's own `GROUPING:` tests pin the
 * caller's half.
 */
export function summariseAdvisories(all: ImpactAdvisory[]): ImpactAdvisory[] {
  const counts: Record<ImpactAdvisoryKind, number> = {
    "ambiguous-name": 0,
    "unnamed-record": 0,
  };
  for (const a of all) counts[a.kind] += 1;

  const out: ImpactAdvisory[] = [];
  if (counts["ambiguous-name"] > 0) {
    const n = counts["ambiguous-name"];
    out.push({
      kind: "ambiguous-name",
      message:
        `${n} ${n === 1 ? "record" : "records"} could not be named unambiguously — ` +
        `rename ${n === 1 ? "it" : "them"} and re-run this check to see exactly which.`,
    });
  }
  if (counts["unnamed-record"] > 0) {
    const n = counts["unnamed-record"];
    out.push({
      kind: "unnamed-record",
      message:
        `${n} ${n === 1 ? "record has" : "records have"} no name — ` +
        `name ${n === 1 ? "it" : "them"} and re-run this check so the report can identify ` +
        `${n === 1 ? "it" : "them"} without ids.`,
    });
  }
  return out;
}
