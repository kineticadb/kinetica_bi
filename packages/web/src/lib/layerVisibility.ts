/**
 * Effective layer visibility derivation.
 *
 * A WMS layer is only effectively visible when BOTH:
 *   1. The operator's preference (`layer.config.visible !== false`) says ON, AND
 *   2. The layer's data source resolves to a non-null + non-empty identifier.
 *
 * "Source" means whichever of these the layer is bound to:
 *   - Dynamic view (`layer.dynamic_view_id != null`) → the dynamic-view row in the
 *     dashboard's `dynamicViews` list. Invalid when the dv row is missing (orphan
 *     binding after a delete) or its `name` is null/empty string.
 *   - Table (`layer.table_id`) → the `TableDto` in the dashboard's associated
 *     tables. Invalid when the table row is missing (deleted upstream) or its
 *     `schema.name` projection is empty.
 *
 * When the source is invalid, the layer is auto-hidden from the WMS stack: no
 * tile request is fired, no broken-image placeholder shows. The operator's
 * `config.visible` preference is preserved verbatim — it just doesn't render
 * until the source is rebound.
 *
 * Consumers:
 *   - `MapChartRenderer.includedLayers` filter (src/components/charts/MapChartRenderer.tsx)
 *   - `LayersModal` eye-toggle visual state (src/components/LayersModal.tsx)
 *
 * Keep both consumers calling this single helper so the visible-vs-hidden
 * decision stays in lockstep across the renderer and the operator UI.
 */

import type { DashboardLayerDto, DynamicViewRow, TableDto } from "../api/client";

/**
 * True when the layer has a resolvable, non-empty data source. A `false` return
 * means the layer's WMS LAYERS param would be unusable (empty / null / orphan)
 * and the layer must be auto-hidden regardless of operator visibility preference.
 */
export const hasValidSource = (
  layer: DashboardLayerDto,
  tables: ReadonlyArray<TableDto>,
  dynamicViews: ReadonlyArray<DynamicViewRow>,
): boolean => {
  if (layer.dynamic_view_id != null) {
    const dv = dynamicViews.find((d) => d.id === layer.dynamic_view_id);
    if (!dv) return false;
    return dv.name != null && dv.name !== "";
  }
  const table = tables.find((t) => t.id === layer.table_id);
  if (!table) return false;
  // schema may be optional in some Kinetica setups; an empty `name` is the
  // failure condition. Treat null/empty `schema` as "use bare name" — matches
  // existing `${schema}.${name}` callsite behavior.
  if (!table.name || table.name === "") return false;
  return true;
};

/**
 * Effective visibility = operator preference AND source validity. The single
 * source of truth both for whether the WMS layer renders AND for whether the
 * LayersModal eye-toggle shows in the "on" visual state.
 */
export const isLayerEffectivelyVisible = (
  layer: DashboardLayerDto,
  tables: ReadonlyArray<TableDto>,
  dynamicViews: ReadonlyArray<DynamicViewRow>,
): boolean => {
  const userWantsVisible =
    (layer.config as { visible?: boolean })?.visible !== false;
  if (!userWantsVisible) return false;
  return hasValidSource(layer, tables, dynamicViews);
};
