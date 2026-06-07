/**
 * Phase 23 P03 Task 1: shared SpatialColumns derivation helper.
 *
 * Extracted verbatim from MapChartRenderer.tsx so both popup-wrapped surfaces
 * (MapChartRenderer click-fan-out) and Plan 23-03's InfoSelectionView (dropdown
 * switch + Load-more on-demand fetch) build the SpatialColumns argument for
 * `infoQuery` from a layer config the same way.
 *
 * Pure helper — no side effects, no store access. Mirrors lib/wmsUrlBuilder.ts
 * + lib/mapInfoConfig.ts conventions: server-shape contract type imported from
 * api/client; thin per-mode coercion; null result when the config is incomplete.
 *
 * All three modes are now live. 'wkb' (UI: "Kinetica geometry column") shares
 * STXY_DISTANCE with 'wkt'; the only payload difference is which key carries
 * the column name (wkbCol vs wktCol).
 */

import type { SpatialColumns } from "../api/client";
import type { MapWidgetConfig } from "./wmsUrlBuilder";
import { coalesceTrackConfig } from "./trackConfig";

export function buildSpatialColumns(
  cfg: Partial<MapWidgetConfig>,
): SpatialColumns | null {
  if (cfg.spatialMode === "latlon") {
    if (!cfg.lonColumn || !cfg.latColumn) return null;
    return { lonCol: cfg.lonColumn, latCol: cfg.latColumn };
  }
  if (cfg.spatialMode === "wkt") {
    if (!cfg.wktColumn) return null;
    return { wktCol: cfg.wktColumn };
  }
  if (cfg.spatialMode === "wkb") {
    if (!cfg.wkbColumn) return null;
    return { wkbCol: cfg.wkbColumn };
  }
  // Phase 52: track mode translates to latlon columns at the info-popup boundary.
  // The track layer stores x/y column names inside track_config (via coalesceTrackConfig).
  // buildSpatialColumns translates to { lonCol, latCol } so downstream info-query consumers
  // receive the standard latlon contract without needing to know about track_config.
  if (cfg.spatialMode === "track") {
    const tc = coalesceTrackConfig((cfg as { track_config?: string | null }).track_config ?? null);
    if (!tc.xCol || !tc.yCol) return null;
    return { lonCol: tc.xCol, latCol: tc.yCol };
  }
  return null;
}
