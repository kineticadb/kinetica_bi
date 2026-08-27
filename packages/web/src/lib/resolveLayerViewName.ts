/**
 * Shared FROM-target resolution for a map layer's READ paths.
 *
 * A map layer is rendered by WMS tiles and queried by the info click. Both must
 * read the SAME Kinetica view, or the operator clicks a filtered tile and gets
 * records from a different (unfiltered) row set. Before this helper the two
 * paths resolved independently and drifted: the WMS path moved to the v1.18
 * combination model (Phase 92 READ-V118-02 / Phase 94 FSCOPE-V118-03) while the
 * info paths still read the pre-v1.18 `filterViewStore.views[tableId]`, which
 * Phase 91 stopped populating (`setView` has no callers; `markMaterializing`
 * only ever writes `viewName: ""`). The info click therefore always fell through
 * to `FROM <schema>.<table>` — the BASE TABLE, unfiltered.
 *
 * Precedence mirrors the WMS build sites in MapChartRenderer verbatim:
 *
 *   dv-bound layer
 *     1. dv COMBINATION entry (`vizToHash["l:<id>"]` → registry, not materializing,
 *        non-empty viewName) — the dv narrowed by the active filters.
 *     2. raw dv entry (`dynamicViewStore.views[dvId]`, status "materialized").
 *     3. otherwise → "skip-dv-not-materialized": the caller must NOT query, or the
 *        server would silently read the source table for a dv-bound layer.
 *
 *   table-bound layer
 *     4. table COMBINATION entry (`vizToHash["l:<id>"]` → registry, non-expired,
 *        non-empty viewName) — the filter/spatial combination view.
 *     5. otherwise → viewName undefined; the server falls through to
 *        `FROM <schema>.<table>`, correct ONLY when nothing is filtering the layer.
 *
 * NOFILTER hashes are never in the registry (see stableComboHash), so a
 * `:NOFILTER` hash is treated as "no view" rather than looked up.
 *
 * `materializing` is deliberately NOT disqualifying on the table path: the
 * combination store preserves a prior viewName across a refresh so tiles keep
 * showing the previously-filtered rows, and the info click must agree with what
 * is on screen.
 *
 * `materializeVersion` is returned for parity with the WMS `_mv` cache-buster so
 * the WMS build sites can adopt this helper and end the duplication; the info
 * paths ignore it.
 */
import type { DashboardLayerDto } from "../api/client";
import { useFilterCombinationStore } from "../store/filterCombinationStore";
import type { CombinationEntry } from "../store/filterCombinationStore";
import { useDynamicViewStore } from "../store/dynamicViewStore";
import { NOFILTER_SENTINEL } from "./stableComboHash";
import { isViewExpired } from "./viewExpiry";

export type ResolvedLayerView =
  | { kind: "view"; viewName: string | undefined; materializeVersion: number | undefined }
  | { kind: "skip-dv-not-materialized" };

/** The layer's combination entry, or undefined when absent / NOFILTER. */
function combinationEntryForLayer(layerId: number): CombinationEntry | undefined {
  const state = useFilterCombinationStore.getState();
  const hash = state.vizToHash[`l:${layerId}`];
  if (!hash || hash.endsWith(`:${NOFILTER_SENTINEL}`)) return undefined;
  return state.registry[hash];
}

export function resolveLayerViewName(layer: DashboardLayerDto): ResolvedLayerView {
  if (layer.dynamic_view_id != null) {
    // 1. dv combination view (dv narrowed by active filters) wins over the raw dv.
    const dvCombo = combinationEntryForLayer(layer.id);
    if (dvCombo && !dvCombo.materializing && dvCombo.viewName) {
      return {
        kind: "view",
        viewName: dvCombo.viewName,
        materializeVersion: dvCombo.materializeVersion,
      };
    }
    // 2. raw dv view.
    const dvEntry = useDynamicViewStore.getState().views[layer.dynamic_view_id];
    if (dvEntry?.status === "materialized" && dvEntry.viewName) {
      return { kind: "view", viewName: dvEntry.viewName, materializeVersion: undefined };
    }
    // 3. dv-bound but nothing materialized — the caller must skip this layer.
    return { kind: "skip-dv-not-materialized" };
  }

  // 4. table combination view.
  const combo = combinationEntryForLayer(layer.id);
  if (combo && !isViewExpired(combo) && combo.viewName) {
    return { kind: "view", viewName: combo.viewName, materializeVersion: combo.materializeVersion };
  }
  // 5. no active view → server reads the source table.
  return { kind: "view", viewName: undefined, materializeVersion: undefined };
}
