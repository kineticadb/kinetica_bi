// Phase 130 (EXPRT-V126-15, D-18): admin export caps from /api/auth/me. Phase 131's export dialog renders them; no UI here.
export type ExportLimits = { maxRows: number | null; maxFileMb: number | null; maxConcurrentPerUser: number };

export const DEFAULT_EXPORT_LIMITS: ExportLimits = { maxRows: null, maxFileMb: null, maxConcurrentPerUser: 2 };

const posInt = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) && v > 0 ? v : null);

export function normalizeExportLimits(raw: unknown): ExportLimits {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return { ...DEFAULT_EXPORT_LIMITS };
  const o = raw as Record<string, unknown>;
  return {
    maxRows: posInt(o.maxRows),
    maxFileMb: posInt(o.maxFileMb),
    maxConcurrentPerUser: posInt(o.maxConcurrentPerUser) ?? DEFAULT_EXPORT_LIMITS.maxConcurrentPerUser,
  };
}
