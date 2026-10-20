// Phase 139 (D-02/D-03): the dynamic-view threshold decision, shared by the saved route and the AI ad-hoc route.
// Source gate first (unchanged, strict >=); the output preflight runs ONLY for aggregated templates (or AI joins) so
// non-aggregated saved templates never pay for an extra query. Output rule is `<=` (operator wording) - one-row
// difference from the source rule is intentional.

export function isTableNotFoundError(err: unknown): boolean {
  const msg = (err as Error)?.message ?? "";
  // Kinetica returns several distinct error codes for "object/table doesn't exist":
  //   - TM/SMc:1078: Table Manager miss (filter-view CREATE OR REPLACE race; persistent table lookup).
  //   - S/SDc:1513: SELECT against a materialized view that doesn't exist.
  //   - Bare prose variants for Kinetica versions without a code suffix.
  return (
    msg.includes("TM/SMc:1078") ||
    msg.includes("S/SDc:1513") ||
    /Could not find the table/i.test(msg) ||
    /Object\s+'[^']*'\s+not\s+found/i.test(msg)
  );
}

/** Decode a column-major COUNT(*) result. Kinetica returns column_1: [N]. */
export function decodeCountResult(result: Record<string, unknown> | null): number {
  const col = result?.["column_1"] as unknown[] | undefined;
  const cell = Array.isArray(col) ? col[0] : undefined;
  return typeof cell === "number" ? cell : typeof cell === "string" ? Number(cell) : 0;
}

export function isAggregatedTemplate(templateSql: string): boolean {
  const stripped = templateSql
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ");
  return /\bGROUP\s+BY\b/i.test(stripped) || /\bDISTINCT\b/i.test(stripped) || /\bLIMIT\s+\d+\s*;?\s*$/i.test(stripped);
}

export type ThresholdInput = {
  maxRecords: number;
  sourceCount: number;
  sourceKind: "filter" | "base";
  aggregated: boolean;
  hasJoins?: boolean;
};
export type OverReason = "exceeds_max_records" | "no_filter";
export type ThresholdDecision = { kind: "materialize" } | { kind: "preflight" } | { kind: "over"; reason: OverReason };

const reasonOf = (k: "filter" | "base"): OverReason => (k === "filter" ? "exceeds_max_records" : "no_filter");

export function decideThreshold(i: ThresholdInput): ThresholdDecision {
  if (i.maxRecords <= 0) return { kind: "materialize" };
  if (i.sourceCount < i.maxRecords) return i.hasJoins ? { kind: "preflight" } : { kind: "materialize" };
  return i.aggregated ? { kind: "preflight" } : { kind: "over", reason: reasonOf(i.sourceKind) };
}

export function decideAfterPreflight(i: {
  maxRecords: number;
  outputCount: number;
  sourceKind: "filter" | "base";
}): { kind: "materialize" } | { kind: "over"; reason: OverReason } {
  if (i.maxRecords <= 0 || i.outputCount <= i.maxRecords) return { kind: "materialize" };
  return { kind: "over", reason: reasonOf(i.sourceKind) };
}

export function buildOutputCountSql(body: string, maxRecords: number): string {
  if (!Number.isInteger(maxRecords) || maxRecords < 0) throw new Error("maxRecords must be a non-negative integer");
  return `SELECT COUNT(*) FROM (SELECT 1 AS kbi_x FROM (${body}) AS kbi_q LIMIT ${maxRecords + 1}) AS kbi_c`;
}
