import type { ActiveFilter } from "../store/filterStore";
import type { Shape } from "../store/spatialFilterStore";

// Sentinel for the empty resolved set: "no view needed — read raw FROM".
// Never stored in the combination registry; never collides with a real hash
// (a real hash always contains a ";"-joined segment list after the source prefix).
export const NOFILTER_SENTINEL = "NOFILTER";

// Stable, deterministic dedup key for a resolved filter set + source identity.
// Order-independent (filters are sorted by column then operator before joining;
// shapes are sorted by wkt ascending before joining).
// Excludes the volatile `addedAt`, `id`, `label`, `measurement` fields from shapes.
// Pure — no randomness, no Date, no crypto.
//
// The optional 4th `shapes?` param is fully backward-compatible: all existing
// 3-arg callers (Phase 88+) produce byte-identical output when shapes is absent/empty.
// `comboShortHash`/djb2 is UNCHANGED — it operates on the final string so spatial
// content flows through automatically.
export function stableComboHash(
  sourceType: "table" | "dv",
  sourceId: number,
  filters: ActiveFilter[],
  shapes?: Pick<Shape, "wkt">[],
): string {
  // Column segments (sorted by column then operator — existing Phase-88 behavior)
  const sorted = [...filters].sort((a, b) => {
    const c = a.column.localeCompare(b.column);
    if (c !== 0) return c;
    return (a.operator ?? "eq").localeCompare(b.operator ?? "eq");
  });
  const colSegments = sorted.map(
    (f) => `${f.column}|${f.operator ?? "eq"}|${JSON.stringify(f.value)}`,
  );

  // Spatial segments (order-independent — sort copy by wkt ascending; only wkt is geometry-identity)
  // slice() before sort() avoids mutating the caller's array.
  const spatialSegments =
    shapes && shapes.length > 0
      ? shapes
          .slice()
          .sort((a, b) => a.wkt.localeCompare(b.wkt))
          .map((s) => s.wkt)
      : [];

  // NOFILTER sentinel: fires only when BOTH column and spatial segments are empty
  if (colSegments.length === 0 && spatialSegments.length === 0) {
    return `${sourceType}:${sourceId}:${NOFILTER_SENTINEL}`;
  }

  // Combine: column segments first, then spatial segments (prefixed with "s:")
  // ";s:" delimiter keeps spatial segments distinct from column segments
  // (column segments always contain "|"; WKT polygons never contain "|").
  const allSegments =
    colSegments.length > 0
      ? colSegments.join(";") +
        (spatialSegments.length > 0 ? ";s:" + spatialSegments.join(";s:") : "")
      : "s:" + spatialSegments.join(";s:");

  return `${sourceType}:${sourceId}:${allSegments}`;
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
