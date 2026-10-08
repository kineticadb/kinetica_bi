// Phase 130 EXPRT-V126-14/15 — export env knobs, cap messages and cap errors. Imports nothing from
// exportRunner/exportJobAccess/exportCleanup so all three can import it without a cycle.

export const EXPORT_DEFAULT_TTL_HOURS = 24;
export const EXPORT_DEFAULT_MAX_CONCURRENT_PER_USER = 2;

const warned = new Set<string>();

/** Positive-integer env reader. Unset / "" / whitespace -> null silently; invalid -> warn once per name+value, null. */
function readPositiveInt(name: string, fallbackNote: string, max = Number.MAX_SAFE_INTEGER): number | null {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return null;
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n <= 0 || n > max) {
    const key = `${name}=${raw}`;
    if (!warned.has(key)) {
      warned.add(key);
      console.warn(`[export] ${name} must be a positive integer${max < Number.MAX_SAFE_INTEGER ? ` up to ${max}` : ""} (got: ${JSON.stringify(raw)}); ${fallbackNote}`);
    }
    return null;
  }
  return n;
}

const NOTE_TTL = "falling back to default 24";
const NOTE_CONC = "falling back to default 2";
const NOTE_CAP = "ignoring it (no limit)";

// 10 years. Beyond this, finished_at + TTL overflows the JS Date range and toISOString() throws on every job DTO.
export const EXPORT_MAX_TTL_HOURS = 87_600;
export const getExportTtlHours = (): number =>
  readPositiveInt("EXPORT_TTL_HOURS", NOTE_TTL, EXPORT_MAX_TTL_HOURS) ?? EXPORT_DEFAULT_TTL_HOURS;
export const getExportMaxRows = (): number | null => readPositiveInt("EXPORT_MAX_ROWS", NOTE_CAP);
export const getExportMaxFileMb = (): number | null => readPositiveInt("EXPORT_MAX_FILE_MB", NOTE_CAP);
export const getExportMaxConcurrentPerUser = (): number =>
  readPositiveInt("EXPORT_MAX_CONCURRENT_PER_USER", NOTE_CONC) ?? EXPORT_DEFAULT_MAX_CONCURRENT_PER_USER;

export const exportMbToBytes = (mb: number): number => mb * 1024 * 1024;

export const formatExportCount = (n: number): string => n.toLocaleString("en-US");
export const formatExportSizeLimit = (mb: number): string =>
  mb % 1024 === 0 ? `${mb / 1024} GB` : `${formatExportCount(mb)} MB`;

export const EXPORT_CAP_REMEDY = "Add filters to narrow it down and try again.";
export const EXPORT_COMPRESS_HINT = "You can also compress it (.zip) to make the file smaller.";
export const EXPORT_SERVER_RESTARTED_MESSAGE = "Export stopped: the server restarted. Start it again.";

export const rowCapMessage = (total: number, cap: number): string =>
  `This export has ${formatExportCount(total)} rows; the limit is ${formatExportCount(cap)}. ${EXPORT_CAP_REMEDY}`;

// "about": rowsAtCut counts rows handed to the stream, which runs a buffer ahead of the bytes on disk (zip/stream buffering).
export const sizeCapMessage = (a: { capMb: number; rowsAtCut: number; totalRows: number | null; compressed: boolean }): string =>
  `This export passed the ${formatExportSizeLimit(a.capMb)} size limit after about ${formatExportCount(a.rowsAtCut)}${
    a.totalRows === null ? "" : ` of ${formatExportCount(a.totalRows)}`
  } rows. ${EXPORT_CAP_REMEDY}` + (a.compressed ? "" : ` ${EXPORT_COMPRESS_HINT}`);

export const concurrencyCapMessage = (count: number): string =>
  `You already have ${count} export${count === 1 ? "" : "s"} running. Wait for one to finish or cancel one, then try again.`;

// NEVER name these "AbortError": the runner catch treats that name as a user cancel.
export class ExportCapError extends Error {
  readonly code = "concurrency_cap" as const;
  constructor(message: string) {
    super(message);
    this.name = "ExportCapError";
  }
}

export class RowCapError extends Error {
  constructor(readonly total: number, readonly cap: number) {
    super(`row cap ${total}/${cap}`);
    this.name = "RowCapError";
  }
}

export class SizeCapError extends Error {
  constructor(readonly maxBytes: number, readonly rowsAtCut: number) {
    super(`size cap ${maxBytes} bytes`);
    this.name = "SizeCapError";
  }
}

export type ExportLimits = { maxRows: number | null; maxFileMb: number | null; maxConcurrentPerUser: number };

export const getExportLimits = (): ExportLimits => ({
  maxRows: getExportMaxRows(),
  maxFileMb: getExportMaxFileMb(),
  maxConcurrentPerUser: getExportMaxConcurrentPerUser(),
});
