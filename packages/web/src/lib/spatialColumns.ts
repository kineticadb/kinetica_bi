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
  /** TRACKFIX-V19-07 (GAP-54-08): track_config is a TOP-LEVEL DashboardLayerDto column,
   *  NOT a key inside layer.config. Callers must thread layer.track_config here so the
   *  track branch can resolve xCol/yCol. When provided (non-undefined), this value takes
   *  precedence over any cfg.track_config (type-asserted fallback). When undefined, falls
   *  back to cfg.track_config for backward compatibility with existing tests that pass
   *  track_config on the cfg object directly. */
  trackConfigJson?: string | null,
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
  //
  // TRACKFIX-V19-07: When trackConfigJson is provided (non-undefined), it takes precedence
  // over cfg.track_config — the caller passes layer.track_config (the top-level DTO field).
  // When undefined, fall back to cfg.track_config (type-asserted) for backward compat.
  if (cfg.spatialMode === "track") {
    const rawTrackConfig =
      trackConfigJson !== undefined
        ? trackConfigJson
        : (cfg as { track_config?: string | null }).track_config ?? null;
    const tc = coalesceTrackConfig(rawTrackConfig);
    if (!tc.xCol || !tc.yCol) return null;
    return { lonCol: tc.xCol, latCol: tc.yCol };
  }
  return null;
}
