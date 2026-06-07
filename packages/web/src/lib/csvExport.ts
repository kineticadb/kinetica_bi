/**
 * csvExport.ts — Pure CSV helpers (no React, no DOM, no app imports).
 * FK4 — Add Configurable CSV Download to Records Table.
 */

/**
 * Escapes a single cell value for RFC-4180-ish CSV.
 * - null/undefined → "" (empty, unquoted)
 * - field containing comma, double-quote, CR, or LF → wrapped in double quotes;
 *   embedded `"` doubled
 * - plain field (no special chars) → returned as-is, unquoted
 * - non-string (number/boolean) → String()-coerced first, then escaped
 */
export function escapeCsvField(value: unknown): string {
  const s = value == null ? "" : String(value);
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
