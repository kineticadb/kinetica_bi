import type { Shape } from "../store/spatialFilterStore";
import type { FilterSelectionConfig } from "../types/filterSelection";
import { SPATIAL_DRAWS_SENTINEL } from "../components/charts/filterSourceTypes";

// Pure: all-or-nothing spatial acceptance per visualization.
//
// Accept-all (cfg undefined OR sourceMode "all") → all shapes (v1.5/v1.17-identical).
// Allowlist + SPATIAL_DRAWS_SENTINEL present → all shapes. Otherwise → [].
//
// Shapes carry no per-shape sourceWidgetId, so there is NO per-shape selection —
// the sentinel is a single per-viz "accepts spatial draws" toggle.
//
// Never mutates inputs. Returns a slice() so callers cannot mutate the store array.
// Mirrors the accept-all / allowlist pattern of resolveFilterSet.ts (Phase 88).
export function resolveSpatialShapes(
  cfg: FilterSelectionConfig | undefined,
  allShapes: Shape[],
): Shape[] {
  if (cfg === undefined || cfg.sourceMode === "all") return allShapes.slice();
  // allowlist mode: accept spatial only when the sentinel is in the list
  const accepts = cfg.allowedSourceWidgetIds.includes(SPATIAL_DRAWS_SENTINEL);
  return accepts ? allShapes.slice() : [];
}
