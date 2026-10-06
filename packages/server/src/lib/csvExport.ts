/**
 * Server CSV writer (Phase 128). Pure, import-free port of packages/web/src/lib/csvExport.ts.
 */
// EXPRT-V126-04 (Phase 128): OWASP CSV-injection rule. KEEP IDENTICAL to packages/server/src/lib/csvExport.ts —
// tests/lib.csvExport.parity.spec.ts (server) runs one vector table against both.
const CSV_NUMERIC_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
const CSV_FORMULA_LEAD_RE = /^[=+\-@\t\r]/;

/**
 * Escapes a single cell value for RFC-4180-ish CSV.
 * - null/undefined → "" (empty, unquoted)
 * - text with a leading = + - @ TAB or CR gets a leading single quote (formula-injection guard,
 *   applied BEFORE quoting, to headers too); JS numbers and strict-numeric strings are exempt
 * - field containing comma, double-quote, CR, or LF → wrapped in double quotes;
 *   embedded `"` doubled
 * - plain field (no special chars) → returned as-is, unquoted
 * - non-string (number/boolean) → String()-coerced first, then escaped
 */
export function escapeCsvField(value: unknown): string {
  let s = value == null ? "" : String(value);
  const isNumeric = typeof value === "number" || typeof value === "bigint" || CSV_NUMERIC_RE.test(s);
  if (!isNumeric && CSV_FORMULA_LEAD_RE.test(s)) s = "'" + s; // BEFORE quoting (D-09)
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/** Assembles rows into CSV: header + rows joined by "\r\n", no trailing CRLF, no BOM. */
export function rowsToCsv(rows: Record<string, unknown>[], columns: string[]): string {
  const lines: string[] = [columns.map(escapeCsvField).join(",")];
  for (const row of rows) {
    lines.push(columns.map((c) => escapeCsvField(row[c])).join(","));
  }
  return lines.join("\r\n");
}

/** One CSV record (no line terminator). Plan 128-05's streaming writer emits header and rows through this so its
 *  bytes equal web rowsToCsv: records are joined by "\r\n", no trailing CRLF, no BOM. */
export function csvLine(values: readonly unknown[]): string {
  return values.map(escapeCsvField).join(",");
}
