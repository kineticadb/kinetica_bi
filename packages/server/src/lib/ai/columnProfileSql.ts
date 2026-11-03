// Phase 140 (D-06): pure SQL builders/parsers for get_column_profile. Identifiers are interpolated unquoted like
// topValuesSql/columnStatsSql; the CALLER must pass identifiers vetted by `assertIdentifier` and present in the
// user-credentialed live probe (133 S1). Top values reuse buildTopValuesSql from lib/topValuesSql (n = PROFILE_TOP_N).

export const PROFILE_TOP_N = 10;
export const isProfileMinMaxType = (t: string | undefined): boolean =>
  typeof t === "string" && /^(tinyint|smallint|int|integer|long|bigint|float|double|real|decimal|numeric|timestamp|datetime|date|time)\b/i.test(t.trim());
export const isProfileTopValuesType = (t: string | undefined): boolean =>
  typeof t === "string" && /^(string|varchar|char|text)/i.test(t.trim());

export function buildColumnProfileSql(a: { schema: string; table: string; column: string; minMax: boolean }): string {
  const from = a.schema === "" ? a.table : `${a.schema}.${a.table}`;
  const c = a.column;
  const mm = a.minMax ? `, MIN(${c}) AS mn, MAX(${c}) AS mx` : "";
  return `SELECT COUNT(*) AS n, COUNT(${c}) AS nn, COUNT(DISTINCT ${c}) AS nd${mm} FROM ${from}`;
}

const col = (enc: unknown, k: string): unknown[] | undefined => {
  const v = enc && typeof enc === "object" ? (enc as Record<string, unknown>)[k] : undefined;
  return Array.isArray(v) ? v : undefined;
};

export function parseColumnProfileResponse(
  enc: unknown,
  minMax: boolean,
): { rowCount: number; nonNullCount: number; distinctCount: number; min?: string | number; max?: string | number } {
  const c1 = col(enc, "column_1"), c2 = col(enc, "column_2"), c3 = col(enc, "column_3");
  if (!c1 || !c2 || !c3 || c1.length === 0) throw new Error("malformed column-profile response");
  const out: { rowCount: number; nonNullCount: number; distinctCount: number; min?: string | number; max?: string | number } = {
    rowCount: Number(c1[0]), nonNullCount: Number(c2[0]), distinctCount: Number(c3[0]),
  };
  if (minMax) {
    const pick = (v: unknown): string | number | undefined =>
      typeof v === "number" || typeof v === "string" ? v : undefined;
    const mn = pick(col(enc, "column_4")?.[0]);
    const mx = pick(col(enc, "column_5")?.[0]);
    if (mn !== undefined) out.min = mn;
    if (mx !== undefined) out.max = mx;
  }
  return out;
}

export function parseTopValuesWithCounts(enc: unknown): { value: string; count: number }[] {
  const vals = col(enc, "column_1"), cnts = col(enc, "column_2");
  if (!vals || !cnts) throw new Error("malformed top-values response");
  const out: { value: string; count: number }[] = [];
  vals.forEach((v, i) => {
    if (v === null || v === undefined) return;
    out.push({ value: String(v), count: Number(cnts[i]) });
  });
  return out;
}
