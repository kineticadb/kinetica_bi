// Phase 131: pure, import-free export formatting helpers. Server specs (131-04) import this file for text parity,
// so it must have NO runtime imports (type-only imports allowed).

export type ExportJobStatus = "queued" | "running" | "complete" | "failed" | "cancelled" | "session_expired";

export const EXPORT_CAP_REMEDY = "Add filters to narrow it down and try again.";

export const formatExportCount = (n: number): string => n.toLocaleString("en-US");

export const formatExportSizeLimit = (mb: number): string =>
  mb % 1024 === 0 ? `${mb / 1024} GB` : `${formatExportCount(mb)} MB`;

export const exportRowCapMessage = (total: number, cap: number): string =>
  `This export has ${formatExportCount(total)} rows; the limit is ${formatExportCount(cap)}. ${EXPORT_CAP_REMEDY}`;

export const exportLimitsHint = (l: {
  maxRows: number | null;
  maxFileMb: number | null;
  maxConcurrentPerUser: number | null;
}): string | null => {
  const parts: string[] = [];
  if (l.maxRows) parts.push(`${formatExportCount(l.maxRows)} rows`);
  if (l.maxFileMb) parts.push(formatExportSizeLimit(l.maxFileMb));
  if (l.maxConcurrentPerUser) parts.push(`${l.maxConcurrentPerUser} at a time`);
  return parts.length === 0 ? null : `Limits: ${parts.join(" · ")}`;
};

const pad2 = (n: number): string => String(n).padStart(2, "0");

export const defaultExportName = (widgetTitle: string | null | undefined, d: Date): string =>
  `${(widgetTitle ?? "").trim() || "Export"} ${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}${pad2(d.getMinutes())}`;

export const exportFileName = (name: string, compress: boolean): string =>
  `${name.trim()}${compress ? ".zip" : ".csv"}`;

export const relativeExpiry = (expiresAt: string | null, now: number = Date.now()): string => {
  if (expiresAt === null) return "—";
  const ms = Date.parse(expiresAt) - now;
  if (!(ms > 0)) return "Expired";
  const d = Math.floor(ms / 86_400_000);
  if (d >= 1) return `in ${d} d`;
  const h = Math.floor(ms / 3_600_000);
  if (h >= 1) return `in ${h} h`;
  const min = Math.floor(ms / 60_000);
  if (min >= 1) return `in ${min} min`;
  return "in under 1 min";
};

export const formatExportBytes = (bytes: number | null): string => {
  if (bytes === null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 ** 3) return `${Math.round(bytes / 1024 ** 2)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1).replace(/\.0$/, "")} GB`;
};

// SQLite datetime('now') strings are UTC "YYYY-MM-DD HH:MM:SS" (no T/Z); new Date(s) would read them as LOCAL time.
export const parseExportTimestamp = (s: string): Date =>
  /Z$|[+-]\d\d:?\d\d$/.test(s) ? new Date(s) : new Date(s.replace(" ", "T") + "Z");

const STATUS_LABELS: Record<ExportJobStatus, string> = {
  queued: "Queued",
  running: "Running",
  complete: "Complete",
  failed: "Failed",
  cancelled: "Cancelled",
  session_expired: "Session ended",
};

export const exportStatusLabel = (s: ExportJobStatus): string => STATUS_LABELS[s] ?? s;

export const isTerminalExportStatus = (s: ExportJobStatus): boolean =>
  s === "complete" || s === "failed" || s === "cancelled" || s === "session_expired";

export const exportDisplayName = (j: { name: string | null; createdAt: string }): string =>
  j.name && j.name.trim() ? j.name : `Export ${parseExportTimestamp(j.createdAt).toLocaleString()}`;
