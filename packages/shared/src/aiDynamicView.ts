// Phase 139 (AISAFE-V20-04): the ONLY shape of an AI dynamic view. No field may ever hold SQL; the server compiles this to a saved-dv-compatible `{view}` template.
import { z } from "zod";
import { AiIdentifierSchema } from "./actionAllowList";
import { AiFilterItemSchema } from "./aiFilter";

export const AI_DV_AGG_FNS = ["count", "count_distinct", "sum", "avg", "min", "max", "median", "percentile"] as const;
export const AI_DV_NUMERIC_AGG_FNS = ["sum", "avg", "median", "percentile"] as const; // need a numeric column
export const AI_DV_BUCKETS = ["minute", "hour", "day", "week", "month", "year"] as const;
export const AI_DV_DATE_BUCKETS = ["day", "week", "month", "year"] as const; // the only buckets allowed on DATE columns
export const AI_DV_JOIN_TYPES = ["inner", "left"] as const;
export const AI_DV_HARD_MAX_JOINS = 4; // schema bound; AI_DV_MAX_JOINS env (default 2) is enforced server-side
export const AI_DV_DEFAULT_MAX_RECORDS = 100000; // web fallback only; AI_DV_MAX_RECORDS env is authoritative
export const AI_DV_NAME_MAX = 80;

const From = z.number().int().min(0).max(AI_DV_HARD_MAX_JOINS); // 0 = base table, i = joins[i-1]
export const AiDvColumnSchema = z
  .object({ from: From.optional(), column: AiIdentifierSchema, as: AiIdentifierSchema.optional() })
  .strict();
export const AiDvGroupBySchema = z
  .object({ from: From.optional(), column: AiIdentifierSchema, bucket: z.enum(AI_DV_BUCKETS).optional(), as: AiIdentifierSchema.optional() })
  .strict();
export const AiDvAggregateSchema = z
  .object({
    fn: z.enum(AI_DV_AGG_FNS),
    from: From.optional(),
    column: AiIdentifierSchema.optional(),
    p: z.number().finite().optional(),
    as: AiIdentifierSchema,
  })
  .strict();
export const AiDvJoinKeySchema = z
  .object({ leftFrom: From.optional(), left: AiIdentifierSchema, right: AiIdentifierSchema })
  .strict();
export const AiDvJoinSchema = z
  .object({
    tableId: z.number().int().positive(),
    type: z.enum(AI_DV_JOIN_TYPES),
    on: z.array(AiDvJoinKeySchema).min(1).max(4),
  })
  .strict();
export const AiDvFilterSchema = AiFilterItemSchema.extend({ from: From.optional() }).strict();
export const AiDvSortSchema = z.object({ by: AiIdentifierSchema, dir: z.enum(["asc", "desc"]) }).strict();

export const AiDvSpecSchema = z
  .object({
    baseTableId: z.number().int().positive(),
    joins: z.array(AiDvJoinSchema).max(AI_DV_HARD_MAX_JOINS).optional(),
    columns: z.array(AiDvColumnSchema).min(1).max(50).optional(),
    filters: z.array(AiDvFilterSchema).max(10).optional(),
    groupBy: z.array(AiDvGroupBySchema).min(1).max(10).optional(),
    aggregates: z.array(AiDvAggregateSchema).min(1).max(20).optional(),
    sort: z.array(AiDvSortSchema).max(5).optional(),
    limit: z.number().int().positive().optional(),
  })
  .strict();
export type AiDvSpec = z.infer<typeof AiDvSpecSchema>;

export const AiDvOutputColumnSchema = z.object({ name: AiIdentifierSchema, type: z.string().max(50) }).strict();
export type AiDvOutputColumn = z.infer<typeof AiDvOutputColumnSchema>;

export function aiDvIsAggregated(spec: AiDvSpec): boolean {
  return (spec.groupBy?.length ?? 0) > 0 || (spec.aggregates?.length ?? 0) > 0;
}

export function aiDvOutputNames(spec: AiDvSpec): string[] {
  if (!aiDvIsAggregated(spec)) return (spec.columns ?? []).map((c) => c.as ?? c.column);
  return [
    ...(spec.groupBy ?? []).map((g) => g.as ?? (g.bucket ? `${g.column}_${g.bucket}` : g.column)),
    ...(spec.aggregates ?? []).map((a) => a.as),
  ];
}

/** Cross-field rules. Reasons are fixed text + indexes + identifier names only, never filter values. */
export function checkAiDvSpec(spec: AiDvSpec): string[] {
  const errors: string[] = [];
  const hasCols = (spec.columns?.length ?? 0) > 0;
  const hasSummary = (spec.groupBy?.length ?? 0) > 0 || (spec.aggregates?.length ?? 0) > 0;
  if (hasCols && hasSummary) errors.push("use columns for a row view, or groupBy/aggregates for a summary, not both");
  else if (!hasCols && !hasSummary) errors.push("a view needs columns, or groupBy and aggregates");

  const joinCount = spec.joins?.length ?? 0;
  const badFrom = new Set<number>();
  for (const list of [spec.columns, spec.groupBy, spec.aggregates, spec.filters]) {
    for (const item of list ?? []) {
      if (item.from !== undefined && item.from > joinCount) badFrom.add(item.from);
    }
  }
  for (const n of badFrom) errors.push(`from ${n} does not match a join (there are ${joinCount})`);

  (spec.joins ?? []).forEach((j, i) => {
    j.on.forEach((k) => {
      if ((k.leftFrom ?? 0) > i) errors.push(`joins.${i}.on: leftFrom must be the base (0) or an earlier join`);
    });
  });

  (spec.aggregates ?? []).forEach((a, i) => {
    if (a.fn !== "count" && a.column === undefined) errors.push(`aggregates.${i}: ${a.fn} needs a column`);
    if (a.fn === "percentile") {
      if (a.p === undefined || !(a.p > 0 && a.p < 100)) {
        errors.push(`aggregates.${i}: percentile needs p between 0 and 100 (exclusive)`);
      }
    } else if (a.p !== undefined) {
      errors.push(`aggregates.${i}: p is only for percentile`);
    }
  });

  const names = aiDvOutputNames(spec);
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const n of names) {
    const l = n.toLowerCase();
    if (seen.has(l) && !dup.has(l)) {
      dup.add(l);
      errors.push(`output name ${l} is used twice`);
    }
    seen.add(l);
  }
  for (const s of spec.sort ?? []) {
    if (!names.includes(s.by)) errors.push(`sort: ${s.by} is not an output column`);
  }
  return errors;
}

const Nonce = z.string().regex(/^[a-f0-9]{8}$/);
export const AiDvMaterializeRequestSchema = z
  .object({
    dashboardId: z.number().int().positive(),
    nonce: Nonce,
    tempId: z.number().int().negative(),
    gen: z.number().int().min(0).max(999),
    spec: AiDvSpecSchema,
    combination_key: z.string().min(1).max(4096).optional(), // base table's dvSourceComboHash (same as saved dvs)
    joinFilterKeys: z.record(z.string().regex(/^\d{1,9}$/), z.string().min(1).max(4096)).optional(), // joined tableId -> its combo hash (D-07/D-22)
  })
  .strict();
export const AiDvDropRequestSchema = z
  .object({
    dashboardId: z.number().int().positive(),
    nonce: Nonce,
    tempId: z.number().int().negative(),
    gen: z.number().int().min(0).max(999),
  })
  .strict();
export type AiDvMaterializeRequest = z.infer<typeof AiDvMaterializeRequestSchema>;
export type AiDvDropRequest = z.infer<typeof AiDvDropRequestSchema>;
export type AiDvMaterializeResponse =
  | { status: "materialized"; view_name: string; row_count: number; expires_at: number; columns: AiDvOutputColumn[]; aggregated: boolean }
  | { status: "over_threshold"; reason: "no_filter"; row_count?: number }
  | { status: "over_threshold"; reason: "exceeds_max_records"; row_count: number }
  | { status: "dropped" };
