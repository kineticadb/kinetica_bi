// Phase 139 (AISAFE-V20-04): the ONLY place an AI dynamic-view spec becomes SQL. Identifiers are double-quoted and alias-qualified; aliases t0..tN are generated here, never model text; values go through buildServerWhereClause. Output is a saved-dv template over the literal {view} token (Keep-compatible).
import {
  checkAiDvSpec,
  aiDvIsAggregated,
  aiDvOutputNames,
  coerceAiFilterItem,
  aiFilterDataTypeOf,
  isAiNumericColumnType,
  AI_DV_NUMERIC_AGG_FNS,
  AI_DV_DATE_BUCKETS,
  type AiDvSpec,
  type AiDvOutputColumn,
} from "@kinetica-bi/shared";
import { buildServerWhereClause, type ActiveFilter } from "./whereClause";
import { assertIdentifier } from "./columnGuard";

export type AiDvTable = { tableId: number; ref: string; columns: readonly { name: string; type?: string }[] }; // ref = "schema.name" (identifiers already checked by liveSchema)
export type AiDvLimits = { maxRecords: number; maxJoins: number };
export type AiDvMissing = { from: number; tableId: number; column: string };
export type AiDvValidation = { ok: true } | { ok: false; reasons: string[]; missing: AiDvMissing[] };

const MAX_REASONS = 10;

type Kind = "ts" | "date" | "time" | "none";
function dateKind(type: string | undefined): Kind {
  const t = type?.toLowerCase().replace(/\(.*\)/, "").trim();
  if (t === "timestamp" || t === "datetime") return "ts";
  if (t === "date") return "date";
  if (t === "time") return "time";
  return "none";
}

export function validateAiDvSpec(spec: AiDvSpec, tables: readonly AiDvTable[], limits: AiDvLimits): AiDvValidation {
  const joins = spec.joins ?? [];
  if (tables.length !== 1 + joins.length) throw new Error("tables must be [base, ...joins]");

  const reasons: string[] = [];
  const missing: AiDvMissing[] = [];
  const push = (r: string) => {
    if (!reasons.includes(r)) reasons.push(r);
  };

  // 1. spec shape
  for (const r of checkAiDvSpec(spec)) push(r);

  // column lookup; records a missing entry once per (from, column)
  const find = (from: number, column: string): { name: string; type?: string } | undefined => {
    const t = tables[from];
    if (!t) return undefined; // out-of-range `from` is already a shape reason
    const c = t.columns.find((x) => x.name === column);
    if (!c) {
      push(`column \`${column}\` not found on ${t.ref}`);
      if (!missing.some((m) => m.from === from && m.column === column)) missing.push({ from, tableId: t.tableId, column });
    }
    return c;
  };

  // 2. joins
  if (joins.length > limits.maxJoins) push(`a view can join at most ${limits.maxJoins} tables`);
  joins.forEach((j, i) => {
    j.on.forEach((k) => {
      const l = find(k.leftFrom ?? 0, k.left);
      const r = find(i + 1, k.right);
      if (!l || !r) return;
      const lk = aiFilterDataTypeOf(l.type);
      const rk = aiFilterDataTypeOf(r.type);
      if (lk === "unfilterable") push(`column ${k.left} can't be a join key`);
      if (rk === "unfilterable") push(`column ${k.right} can't be a join key`);
      if (lk === "unfilterable" || rk === "unfilterable") return;
      if (lk !== "unknown" && rk !== "unknown" && lk !== rk) push(`join ${i + 1}: ${k.left} and ${k.right} have different types`);
    });
  });

  // 3. columns
  for (const c of spec.columns ?? []) find(c.from ?? 0, c.column);
  const gcols = (spec.groupBy ?? []).map((g) => ({ g, col: find(g.from ?? 0, g.column) }));
  const acols = (spec.aggregates ?? []).map((a) => ({ a, col: a.column !== undefined ? find(a.from ?? 0, a.column) : undefined }));

  // 4. types
  for (const { g, col } of gcols) {
    if (!col || !g.bucket) continue;
    const k = dateKind(col.type);
    if (k === "none") push(`column ${g.column} is not a date or time column`);
    else if (k === "time") push(`column ${g.column} is a time of day and can't be bucketed`);
    else if (k === "date" && !(AI_DV_DATE_BUCKETS as readonly string[]).includes(g.bucket)) {
      push(`column ${g.column} is a date; use day, week, month or year`);
    }
  }
  for (const { a, col } of acols) {
    if (!col) continue;
    if ((AI_DV_NUMERIC_AGG_FNS as readonly string[]).includes(a.fn) && isAiNumericColumnType(col.type) !== true) {
      push(`column ${a.column} is not numeric`);
    }
  }

  // 5. filters (typed coercion per live column type, same as 138)
  for (const f of spec.filters ?? []) {
    const col = find(f.from ?? 0, f.column);
    if (!col) continue;
    const { from: _from, ...item } = f;
    const r = coerceAiFilterItem(item, col.type);
    if (!r.ok) push(r.reason);
  }

  // limit ceiling
  if (spec.limit !== undefined && spec.limit > limits.maxRecords) {
    push(`limit ${spec.limit} is over the ${limits.maxRecords}-row ceiling`);
  }

  return reasons.length === 0 ? { ok: true } : { ok: false, reasons: reasons.slice(0, MAX_REASONS), missing };
}

export const AI_DV_BUCKET_UNITS = { minute: "MINUTE", hour: "HOUR", day: "DAY", week: "WEEK", month: "MONTH", year: "YEAR" } as const;
export type AiDvCompiled = { template: string; columns: AiDvOutputColumn[]; aggregated: boolean; maxRecords: number };
export class AiDvCompileError extends Error {
  constructor(public readonly reasons: string[]) {
    super(reasons[0] ?? "invalid dynamic view");
    this.name = "AiDvCompileError";
  }
}

const q = (ident: string): string => {
  assertIdentifier(ident, "column");
  return `"${ident}"`;
};
const assertRef = (ref: string): string => {
  for (const seg of ref.split(".")) assertIdentifier(seg, "table");
  return ref;
};

/**
 * joinRefs[i] overrides the FROM ref of joins[i] for the SESSION materialize (a joined table's current filter view, D-07/D-22).
 * Omit it for the persisted/Keep template, which always joins raw schema.table (D-21 known difference, logged for Phase 141).
 *
 * NOTE: APPROX_MEDIAN / APPROX_PERCENTILE are APPROXIMATE (Kinetica 7.2 docs: within about 2%).
 * GROUP BY / materialized-view / GPU behaviour of these forms is operator-UAT U1-U3.
 */
export function compileAiDvSpec(
  spec: AiDvSpec,
  tables: readonly AiDvTable[],
  limits: AiDvLimits,
  opts?: { joinRefs?: readonly (string | undefined)[] },
): AiDvCompiled {
  const v = validateAiDvSpec(spec, tables, limits);
  if (!v.ok) throw new AiDvCompileError(v.reasons);

  const colOf = (from: number, column: string) => tables[from].columns.find((c) => c.name === column);
  const ref = (from: number, column: string) => `t${from}.${q(column)}`;
  const aggregated = aiDvIsAggregated(spec);
  const names = aiDvOutputNames(spec);

  const selectParts: string[] = [];
  const groupExprs: string[] = [];
  const columns: AiDvOutputColumn[] = [];

  if (!aggregated) {
    (spec.columns ?? []).forEach((c, i) => {
      const from = c.from ?? 0;
      selectParts.push(`${ref(from, c.column)} AS ${q(names[i])}`);
      columns.push({ name: names[i], type: colOf(from, c.column)?.type ?? "unknown" });
    });
  } else {
    (spec.groupBy ?? []).forEach((g, i) => {
      const from = g.from ?? 0;
      const base = ref(from, g.column);
      const expr = g.bucket ? `DATE_TRUNC('${AI_DV_BUCKET_UNITS[g.bucket]}', ${base})` : base;
      groupExprs.push(expr);
      selectParts.push(`${expr} AS ${q(names[i])}`);
      columns.push({ name: names[i], type: g.bucket ? "datetime" : (colOf(from, g.column)?.type ?? "unknown") });
    });
    const off = spec.groupBy?.length ?? 0;
    (spec.aggregates ?? []).forEach((a, i) => {
      const from = a.from ?? 0;
      const col = a.column !== undefined ? ref(from, a.column) : undefined;
      let expr: string;
      let type = "double";
      switch (a.fn) {
        case "count":
          expr = col ? `COUNT(${col})` : "COUNT(*)";
          type = "long";
          break;
        case "count_distinct":
          expr = `COUNT(DISTINCT ${col})`;
          type = "long";
          break;
        case "sum":
          expr = `SUM(${col})`;
          break;
        case "avg":
          expr = `AVG(${col})`;
          break;
        case "min":
        case "max":
          expr = `${a.fn.toUpperCase()}(${col})`;
          type = colOf(from, a.column as string)?.type ?? "unknown";
          break;
        case "median":
          expr = `APPROX_MEDIAN(${col})`;
          break;
        case "percentile":
          expr = `APPROX_PERCENTILE(${col}, ${String(Number(a.p))})`;
          break;
      }
      selectParts.push(`${expr} AS ${q(names[off + i])}`);
      columns.push({ name: names[off + i], type });
    });
  }

  let sql = `SELECT ${selectParts.join(", ")} FROM {view} AS t0`;
  (spec.joins ?? []).forEach((j, i) => {
    const joinRef = assertRef(opts?.joinRefs?.[i] ?? tables[i + 1].ref);
    const on = j.on.map((k) => `${ref(k.leftFrom ?? 0, k.left)} = ${ref(i + 1, k.right)}`).join(" AND ");
    sql += ` ${j.type === "inner" ? "INNER" : "LEFT"} JOIN ${joinRef} AS t${i + 1} ON ${on}`;
  });

  if ((spec.filters?.length ?? 0) > 0) {
    const mapped: ActiveFilter[] = (spec.filters ?? []).map((f) => {
      const from = f.from ?? 0;
      const { from: _from, ...item } = f;
      const r = coerceAiFilterItem(item, colOf(from, f.column)?.type);
      if (!r.ok) throw new AiDvCompileError([r.reason]); // unreachable: validated above
      return {
        column: ref(from, f.column),
        value: (r.item.value ?? null) as ActiveFilter["value"],
        dataType: r.item.dataType,
        operator: r.item.operator,
        addedAt: 0,
      };
    });
    sql += ` WHERE ${buildServerWhereClause(mapped)}`;
  }
  if (groupExprs.length > 0) sql += ` GROUP BY ${groupExprs.join(", ")}`;
  if ((spec.sort?.length ?? 0) > 0) {
    sql += ` ORDER BY ${(spec.sort ?? []).map((s) => `${q(s.by)} ${s.dir === "desc" ? "DESC" : "ASC"}`).join(", ")}`;
  }
  if (spec.limit !== undefined) sql += ` LIMIT ${Math.trunc(Number(spec.limit))}`;

  // maxRecords is the materialize threshold (D-04/D-12); spec.limit only adds a LIMIT.
  return { template: sql, columns, aggregated, maxRecords: limits.maxRecords };
}
