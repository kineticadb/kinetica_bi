import type { ActiveFilter } from "../store/filterStore";

// Sentinel for the empty resolved set: "no view needed — read raw FROM".
// Never stored in the combination registry; never collides with a real hash
// (a real hash always contains a ";"-joined segment list after the source prefix).
export const NOFILTER_SENTINEL = "NOFILTER";

// Stable, deterministic dedup key for a resolved filter set + source identity.
// Order-independent (filters are sorted by column then operator before joining).
// Excludes the volatile `addedAt` field. Pure — no randomness, no Date, no crypto.
export function stableComboHash(
  sourceType: "table" | "dv",
  sourceId: number,
  filters: ActiveFilter[],
): string {
  if (filters.length === 0) {
    return `${sourceType}:${sourceId}:${NOFILTER_SENTINEL}`;
  }
  const sorted = [...filters].sort((a, b) => {
    const c = a.column.localeCompare(b.column);
    if (c !== 0) return c;
    return (a.operator ?? "eq").localeCompare(b.operator ?? "eq");
  });
  const segments = sorted.map(
    (f) => `${f.column}|${f.operator ?? "eq"}|${JSON.stringify(f.value)}`,
  );
  return `${sourceType}:${sourceId}:${segments.join(";")}`;
}

// 8-char hex djb2 hash — used ONLY for the Kinetica view-name suffix (_c<hash8>).
// Pure, synchronous, zero-dep. Must match the server-side helper byte-for-byte
// when that is added in Phase 89 (same djb2 recipe).
export function comboShortHash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h) ^ s.charCodeAt(i);
  }
  return (h >>> 0).toString(16).padStart(8, "0").slice(0, 8);
}
