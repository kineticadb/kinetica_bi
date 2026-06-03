// Phase 11: Classbreak column cardinality probe (M-06)
// CONTEXT.md "Decisions § Classbreak" — session-cached per ${tableId}:${cbColumn}

import { runSql } from "../api/client";

const cache = new Map<string, number>();

export function __resetCardinalityCacheForTest(): void {
  cache.clear();
}

type CardinalityResult = { data: { n?: number[] } } | { n?: number } | Record<string, unknown>;

export async function probeCardinality(
  tableRef: string,
  column: string,
  signal?: AbortSignal
): Promise<number> {
  const cacheKey = `${tableRef}:${column}`;
  const cached = cache.get(cacheKey);
  if (cached !== undefined) return cached;

  // AP-3 NOTE: column is a schema-validated identifier, not user data; safe to interpolate.
  // Do NOT use this pattern for user values — those go through escapeKineticaStringLiteral.
  const sql = `SELECT COUNT(DISTINCT ${column}) AS n FROM ${tableRef}`;

  try {
    const result = await runSql<CardinalityResult>(sql, undefined, signal);
    // Defensive parse: Kinetica columnar shape OR row-major shape
    const r: any = result;
    const count = Number(r?.data?.n?.[0] ?? r?.n ?? r?.data?.[0]?.n);
    if (!Number.isFinite(count) || count < 0) {
      throw new Error(`probeCardinality: unparseable count from ${tableRef}.${column}`);
    }
    cache.set(cacheKey, count);
    return count;
  } catch (err) {
    // Clear cache so retry can re-fetch (do NOT cache failures)
    cache.delete(cacheKey);
    throw err;
  }
}
