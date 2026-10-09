/**
 * csvExport.ts — Pure CSV helpers (no React, no DOM, no app imports).
 * FK4 — Add Configurable CSV Download to Records Table.
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

/**
 * Assembles rows into a CSV string.
 * - First line is the header (column names, each passed through escapeCsvField)
 * - Each data row emits ONLY the given columns, in the given order
 * - Lines joined with "\r\n"
 */
export function rowsToCsv(rows: Record<string, unknown>[], columns: string[]): string {
  const lines: string[] = [columns.map(escapeCsvField).join(",")];
  for (const row of rows) {
    lines.push(columns.map((c) => escapeCsvField(row[c])).join(","));
  }
  return lines.join("\r\n");
}

/**
 * Sanitizes a string for use as a filename part.
 * Replaces illegal/awkward characters (/ \ : * ? " < > | and control chars and
 * whitespace runs) with "-", collapses repeated "-", trims leading/trailing "-".
 * Returns "table" if the result is empty.
 */
export function sanitizeFilenamePart(raw: string): string {
  return (
    raw
      .replace(/[/\\:*?"<>|\x00-\x1f]/g, "-")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "table"
  );
}

/**
 * Builds a timestamped CSV filename.
 * Format: `${sanitizeFilenamePart(titleOrTable)}-YYYYMMDD-HHmmss.csv`
 * Uses LOCAL time, zero-padded.
 */
export function buildCsvFilename(titleOrTable: string, now: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const year = now.getFullYear();
  const month = pad(now.getMonth() + 1);
  const day = pad(now.getDate());
  const hours = pad(now.getHours());
  const minutes = pad(now.getMinutes());
  const seconds = pad(now.getSeconds());
  return `${sanitizeFilenamePart(titleOrTable)}-${year}${month}${day}-${hours}${minutes}${seconds}.csv`;
}
