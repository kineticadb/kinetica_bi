/**
 * Phase 12: LayersModal — two-pane dashboard-scope layer manager.
 *
 * Pattern: mirrors TablePickerModal / VisualizationPickerModal (DashboardsPage.tsx:616-643)
 * for the modal-overlay/portal shell. Larger (.modal-layers max-width 900px) per CONTEXT.md.
 *
 * Right pane composition:
 *   1. Table dropdown (this file) — patches top-level layer.table_id; runs autoSuggestSpatialMode
 *      and clears stale spatial cols when the table changes. This is the ONLY UI surface
 *      that changes a layer's table binding after creation; without it the missing-table
 *      badge would be unactionable.
 *   2. KineticaWmsLayerForm (Plan 12-02) — receives `columns` already filtered to the chosen table.
 *
 * Auto-save: parent owns the debounce + PATCH dispatcher. This component receives
 * onPatch(layerId, patch) and calls it on every form-field / dropdown / slider change. The
 * parent debounces + fires updateLayer(...) after 300ms.
 *
 * Drag-reorder: native HTML5 (draggable + onDragStart/onDragOver/onDrop). On drop,
 * compute the new orderedIds and call onReorder. Parent calls reorderLayers(...) and
 * updates the store.
 *
 * Delete confirm: inline (replace trash icon with [Delete layer] [Keep layer] buttons).
 *
 * Per-layer opacity: lives in the right-panel OPACITY group (moved out of the
 * row so the layer name has room). 0-100 range slider bound to
 * layer.config.POINTOPACITY. Plan 05's renderer applies it via imageLayer.setOpacity(val/100).
 */

import { useState, useEffect, useRef, useMemo } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faEye,
  faEyeSlash,
  faGripVertical,
  faCopy,
  faTrash,
} from "@fortawesome/free-solid-svg-icons";
import KineticaWmsLayerForm from "./charts/KineticaWmsLayerForm";
import { autoSuggestSpatialMode } from "../lib/columnTypes";
import { isLayerEffectivelyVisible, hasValidSource } from "../lib/layerVisibility";
import type { DashboardLayerDto, DynamicViewRow, TableDto } from "../api/client";

type LayersModalProps = {
  layers: DashboardLayerDto[];
  associatedTables: TableDto[];
  /**
   * Phase 35 (DV-V16-13): dashboard's dynamic-view list, threaded down from
   * DashboardOpen via the orchestrator hook. Plan 35-06 will pass this through
   * to KineticaWmsLayerForm for the per-layer "Data Source" picker (three
   * optgroups: Tables / Views / Dynamic Views). This plan only ships the prop
   * conduit — picker JSX is Plan 35-06's territory. Optional with empty-array
   * default so existing call sites + spec fixtures compile unchanged.
   */
  dynamicViews?: DynamicViewRow[];
  onClose: () => void;
  onCreate: () => void;               // parent posts blank layer
  onDelete: (layerId: number) => void;
  onDuplicate: (layerId: number) => void;
  onPatch: (layerId: number, patch: Partial<DashboardLayerDto>) => void;
  onReorder: (orderedIds: number[]) => void;
};

export default function LayersModal({
  layers,
  associatedTables,
  // dynamicViews threaded from DashboardOpen — consumed by the Data Source picker
  // (Plan 35-06) and by `formColumns` derivation when a layer is dv-bound (post-VERIFY fix).
  dynamicViews = [],
  onClose,
  onCreate,
  onDelete,
  onDuplicate,
  onPatch,
  onReorder,
}: LayersModalProps): JSX.Element {
  const [selectedId, setSelectedId] = useState<number | null>(layers[0]?.id ?? null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const draggingIdRef = useRef<number | null>(null);
  const [, forceUpdate] = useState(0);

  // Auto-select the first layer (or newly added blank layer) when layers change
  useEffect(() => {
    if (selectedId === null && layers.length > 0) {
      setSelectedId(layers[0].id);
    }
    // If selected layer was deleted, fall back to first or null
    if (selectedId !== null && !layers.find((l) => l.id === selectedId)) {
      setSelectedId(layers[0]?.id ?? null);
    }
  }, [layers, selectedId]);

  // ESC key handler
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const selectedLayer = layers.find((l) => l.id === selectedId) ?? null;

  // Auto-derived layer name: `{sourceName} — {renderMode}` with `(2)`, `(3)` suffixes for duplicates.
  // Phase 35 post-VERIFY fix: when the layer is dv-bound, sourceName is the dynamic-view's
  // operator-chosen name (NOT the underlying source table's name). Falls back to the table
  // name when dv-bound but the dv is missing from the list (orphan) or when table-bound.
  const layerName = (layer: DashboardLayerDto): string => {
    // Operator-set display name (config.name) wins — same value the legend shows.
    const custom = (layer.config as { name?: string }).name;
    if (typeof custom === "string" && custom.trim().length > 0) return custom;
    let sourceName: string;
    if (layer.dynamic_view_id != null) {
      const dv = dynamicViews.find((d) => d.id === layer.dynamic_view_id);
      sourceName = dv ? dv.name : "(deleted dynamic view)";
    } else {
      const table = associatedTables.find((t) => t.id === layer.table_id);
      sourceName = table
        ? table.schema
          ? `${table.schema}.${table.name}`
          : table.name
        : "(unset table)";
    }
    const renderMode = (layer.config as { renderMode?: string }).renderMode ?? "raster";
    const baseName = `${sourceName} — ${renderMode}`;
    const earlier = layers.filter((l, idx) => {
      if (idx >= layers.indexOf(layer)) return false;
      let ln: string;
      if (l.dynamic_view_id != null) {
        const ldv = dynamicViews.find((d) => d.id === l.dynamic_view_id);
        ln = ldv ? ldv.name : "(deleted dynamic view)";
      } else {
        const lt = associatedTables.find((t) => t.id === l.table_id);
        ln = lt ? (lt.schema ? `${lt.schema}.${lt.name}` : lt.name) : "(unset table)";
      }
      const lrm = (l.config as { renderMode?: string }).renderMode ?? "raster";
      return `${ln} — ${lrm}` === baseName;
    });
    return earlier.length === 0 ? baseName : `${baseName} (${earlier.length + 1})`;
  };

  // Drag-reorder helpers
  const onDragStart = (e: React.DragEvent, layerId: number) => {
    draggingIdRef.current = layerId;
    e.dataTransfer.effectAllowed = "move";
    forceUpdate((n) => n + 1);
  };
  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };
  const onDrop = (e: React.DragEvent, targetLayerId: number) => {
    e.preventDefault();
    const draggingId = draggingIdRef.current;
    if (draggingId === null || draggingId === targetLayerId) {
      draggingIdRef.current = null;
      forceUpdate((n) => n + 1);
      return;
    }
    const sourceIdx = layers.findIndex((l) => l.id === draggingId);
    const targetIdx = layers.findIndex((l) => l.id === targetLayerId);
    if (sourceIdx < 0 || targetIdx < 0) {
      draggingIdRef.current = null;
      forceUpdate((n) => n + 1);
      return;
    }
    const next = layers.slice();
    const [moved] = next.splice(sourceIdx, 1);
    next.splice(targetIdx, 0, moved);
    onReorder(next.map((l) => l.id));
    draggingIdRef.current = null;
    forceUpdate((n) => n + 1);
  };

  // Resolve column list for the right-pane form.
  // Phase 35 fix (post-VERIFY): when the layer is dv-bound, the column shape MUST come
  // from the dynamic-view's `columns_json` — NOT the source table's columns. A dv's SELECT
  // can project completely different columns (aggregations, renames, derived expressions)
  // than the source table. Using source-table columns would surface wrong options in:
  //   - Spatial column pickers (KineticaWmsLayerForm:437 `getValidSpatialColumns`)
  //   - Info-popup column multi-picker (KineticaWmsLayerForm:454-460 ChipCombobox)
  //   - Classbreak builder (KineticaWmsLayerForm:200 `cbEligibleColumns`)
  // all of which consume the same `columns` prop.
  //
  // Fallback when columns_json is null (operator never ran Preview in DynamicViewsModal):
  // empty list. Mirrors the ChartConfigPanel locked behavior — dropdowns appear empty,
  // signaling the operator to Preview the dv. We deliberately do NOT fall back to the
  // source table's columns: those are guaranteed-wrong for an aggregating dv, and silent
  // wrong-data is worse than empty.
  const formColumns = useMemo<{ name: string; type: string }[]>(() => {
    if (!selectedLayer) return [];
    // DV-bound branch
    if (selectedLayer.dynamic_view_id != null) {
      const dv = dynamicViews.find((d) => d.id === selectedLayer.dynamic_view_id);
      if (!dv || dv.columns_json === null) return [];
      // Post-VERIFY type fix: server `mapDashboardDynamicView` ships a PARSED array on
      // the wire. The original type said string. Accept either at runtime.
      const raw: unknown = typeof dv.columns_json === "string"
        ? (() => {
            try {
              return JSON.parse(dv.columns_json);
            } catch {
              return null;
            }
          })()
        : dv.columns_json;
      if (
        Array.isArray(raw) &&
        raw.every(
          (c) =>
            c !== null &&
            typeof c === "object" &&
            typeof (c as { name?: unknown }).name === "string" &&
            typeof (c as { type?: unknown }).type === "string",
        )
      ) {
        return raw as { name: string; type: string }[];
      }
      return [];
    }
    // Table-bound branch (existing behavior)
    const table = associatedTables.find((t) => t.id === selectedLayer.table_id);
    if (!table) return [];
    return Object.entries(table.columns).map(([name, type]) => ({ name, type }));
  }, [selectedLayer, associatedTables, dynamicViews]);

  const isTableMissing = (layer: DashboardLayerDto) =>
    !associatedTables.find((t) => t.id === layer.table_id);

  // Handle table-dropdown change in right pane: patch top-level table_id +
  // reset stale spatial columns + run autoSuggestSpatialMode against the new table's columns.
  // Phase 35 (DV-V16-13): table_id change ALSO clears dynamic_view_id (mutual exclusion);
  // dv pick keeps table_id (= sourceTableId) and the picker just updates dynamic_view_id.
  const handleTableChange = (newTableId: number) => {
    if (!selectedLayer) return;
    const newTable = associatedTables.find((t) => t.id === newTableId);
    const newColumns = newTable
      ? Object.entries(newTable.columns).map(([name, type]) => ({ name, type }))
      : [];
    const suggestedMode = autoSuggestSpatialMode(newColumns);
    // Clear stale spatial columns so the form doesn't show invalid values
    const cleared = { ...selectedLayer.config } as Record<string, unknown>;
    delete cleared.latColumn;
    delete cleared.lonColumn;
    delete cleared.wktColumn;
    delete cleared.wkbColumn;
    const nextConfig: Record<string, unknown> = {
      ...cleared,
      spatialMode: suggestedMode,
    };
    // Plan 35-01 "key" in attrs discriminant: { dynamic_view_id: null } is the explicit-clear.
    onPatch(selectedLayer.id, {
      table_id: newTableId,
      dynamic_view_id: null,
      config: nextConfig,
    });
  };

  // Phase 35 (DV-V16-13) — onDataSourceChange callback for KineticaWmsLayerForm's new
  // "Data Source" picker (three optgroups: Tables / Dynamic Views). The picker single-selects
  // and emits a top-level DashboardLayerDto patch describing the new binding.
  // - Picking a TABLE → re-uses handleTableChange (autoSuggest + clear stale columns + null dv).
  // - Picking a DV → set dynamic_view_id; keep table_id = dv.source_table_id (research finding
  //   #4 lock — schema NOT NULL constraint preserved without migration). Spatial columns ARE
  //   reset and autoSuggest re-runs against the dv's columns_json — because the dv's SELECT
  //   can project different columns than the source table, stale lonColumn/latColumn/wktColumn/
  //   wkbColumn values may not exist in the dv shape. Mirrors handleTableChange's clear path.
  //   When columns_json is null (Preview never ran), spatialMode falls back to autoSuggest's
  //   default and the picker dropdowns will be empty until operator Previews the dv.
  const handleDataSourceChange = (patch: { table_id: number; dynamic_view_id: number | null }) => {
    if (!selectedLayer) return;
    if (patch.dynamic_view_id === null) {
      handleTableChange(patch.table_id);
      return;
    }
    // Resolve dv columns_json → autoSuggest against the dv shape (fall back to [] when null).
    // Post-VERIFY type fix: accept both parsed array AND legacy string shape.
    const dv = dynamicViews.find((d) => d.id === patch.dynamic_view_id);
    let dvColumns: { name: string; type: string }[] = [];
    if (dv?.columns_json != null) {
      const raw: unknown = typeof dv.columns_json === "string"
        ? (() => {
            try {
              return JSON.parse(dv.columns_json as string);
            } catch {
              return null;
            }
          })()
        : dv.columns_json;
      if (
        Array.isArray(raw) &&
        raw.every(
          (c) =>
            c !== null &&
            typeof c === "object" &&
            typeof (c as { name?: unknown }).name === "string" &&
            typeof (c as { type?: unknown }).type === "string",
        )
      ) {
        dvColumns = raw as { name: string; type: string }[];
      }
    }
    const suggestedMode = autoSuggestSpatialMode(dvColumns);
    const cleared = { ...selectedLayer.config } as Record<string, unknown>;
    delete cleared.latColumn;
    delete cleared.lonColumn;
    delete cleared.wktColumn;
    delete cleared.wkbColumn;
    const nextConfig: Record<string, unknown> = {
      ...cleared,
      spatialMode: suggestedMode,
    };
    onPatch(selectedLayer.id, {
      table_id: patch.table_id,
      dynamic_view_id: patch.dynamic_view_id,
      config: nextConfig,
    });
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content modal-layers"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div className="modal-title">Map Layers</div>
          <button className="ghost-sm" onClick={onClose}>Close</button>
        </div>
        <div className="layers-modal-body">
          <div className="layers-modal-left">
            <div className="layer-list">
              {layers.map((l) => {
                // Post-VERIFY (Phase 35 follow-up): effective visibility is the
                // user's preference AND a valid source (non-empty / non-null table
                // or dynamic-view binding). When the source is invalid, the eye
                // icon visually shows OFF regardless of `config.visible` — the
                // operator's preference is preserved in storage, but the WMS layer
                // is auto-hidden (single source of truth shared with
                // MapChartRenderer.includedLayers).
                const userVisible =
                  (l.config as { visible?: boolean }).visible !== false;
                const sourceValid = hasValidSource(l, associatedTables, dynamicViews);
                const visible = isLayerEffectivelyVisible(
                  l,
                  associatedTables,
                  dynamicViews,
                );
                const isActive = l.id === selectedId;
                const isConfirming = confirmDeleteId === l.id;
                return (
                  <div
                    key={l.id}
                    className={`layer-row${isActive ? " active" : ""}`}
                    onClick={() => setSelectedId(l.id)}
                    draggable
                    onDragStart={(e) => onDragStart(e, l.id)}
                    onDragOver={onDragOver}
                    onDrop={(e) => onDrop(e, l.id)}
                    style={
                      draggingIdRef.current === l.id
                        ? { opacity: 0.5 }
                        : undefined
                    }
                  >
                    <span className="layer-row-drag" aria-hidden="true">
                      <FontAwesomeIcon icon={faGripVertical} />
                    </span>
                    <button
                      type="button"
                      // Icon reflects EFFECTIVE state (off when source is invalid)
                      // but the toggle flips the OPERATOR'S preference. Clicking
                      // an auto-hidden layer's eye records the operator's intent
                      // so once they rebind a valid source, the layer comes back.
                      className={`layer-row-eye${visible ? "" : " hidden"}${
                        userVisible && !sourceValid ? " auto-disabled" : ""
                      }`}
                      aria-label={
                        !sourceValid
                          ? "Layer auto-hidden — source missing"
                          : visible
                          ? "Hide layer"
                          : "Show layer"
                      }
                      title={
                        userVisible && !sourceValid
                          ? "Auto-hidden because the layer's table or dynamic view is missing. Rebind a valid source to show this layer."
                          : undefined
                      }
                      onClick={(e) => {
                        e.stopPropagation();
                        // Flip the OPERATOR'S preference (userVisible), NOT the
                        // derived `visible` — that way the click is reversible
                        // and the saved intent is preserved across source changes.
                        onPatch(l.id, {
                          config: { ...l.config, visible: !userVisible },
                        });
                      }}
                    >
                      <FontAwesomeIcon icon={visible ? faEye : faEyeSlash} />
                    </button>
                    <span className="layer-row-name">{layerName(l)}</span>
                    {isTableMissing(l) && (
                      <span className="layer-row-badge error">
                        Table removed &mdash; reconfigure
                      </span>
                    )}
                    <div className="layer-row-actions">
                      {isConfirming ? (
                        <>
                          <button
                            type="button"
                            className="layer-row-btn danger"
                            onClick={(e) => {
                              e.stopPropagation();
                              onDelete(l.id);
                              setConfirmDeleteId(null);
                            }}
                          >
                            Delete layer
                          </button>
                          <button
                            type="button"
                            className="layer-row-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              setConfirmDeleteId(null);
                            }}
                          >
                            Keep layer
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="layer-row-btn"
                            aria-label="Duplicate layer"
                            onClick={(e) => {
                              e.stopPropagation();
                              onDuplicate(l.id);
                            }}
                          >
                            <FontAwesomeIcon icon={faCopy} />
                          </button>
                          <button
                            type="button"
                            className="layer-row-btn danger"
                            aria-label="Delete layer"
                            onClick={(e) => {
                              e.stopPropagation();
                              setConfirmDeleteId(l.id);
                            }}
                          >
                            <FontAwesomeIcon icon={faTrash} />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="layer-list-add">
              <button className="btn-primary" type="button" onClick={onCreate}>
                + Add layer
              </button>
            </div>
          </div>
          <div className="layers-modal-right">
            {selectedLayer ? (
              <>
                {/* Phase 35 (DV-V16-13): the per-layer TABLE picker that previously lived here
                    has been REPLACED by a unified "Data Source" picker rendered INSIDE
                    KineticaWmsLayerForm (single-select with Tables + Dynamic Views optgroups).
                    The form receives the layer DTO + associatedTables + dynamicViews + the
                    onDataSourceChange callback below. Mutual exclusion is enforced at picker
                    level — operator can't bind both a table AND a dv simultaneously. */}
                {/* Layer name — operator-settable display name stored in config.name.
                    Pure presentation: shown in this list + the in-map/standalone legend
                    (LayersLegendPanel reads config.name). Not emitted as a WMS param. */}
                <div className="config-group">
                  <label className="ds-field">
                    <span className="ds-field-label">Layer name</span>
                    <input
                      type="text"
                      aria-label="Layer name"
                      placeholder="e.g. Pickups (Class Break)"
                      value={(selectedLayer.config as { name?: string }).name ?? ""}
                      onChange={(e) => {
                        onPatch(selectedLayer.id, {
                          config: { ...selectedLayer.config, name: e.target.value },
                        });
                      }}
                    />
                  </label>
                </div>
                {/* Opacity slider — moved out of the layer row so the row name has space.
                    Bound to layer.config.POINTOPACITY; MapChartRenderer applies it via
                    imageLayer.setOpacity(val / 100) on every config change. */}
                <div className="config-group">
                  <div className="config-group-label">OPACITY</div>
                  <div className="layer-opacity-row">
                    <input
                      type="range"
                      min="0"
                      max="100"
                      className="layer-opacity-slider"
                      aria-label="Layer opacity"
                      value={
                        (selectedLayer.config as { POINTOPACITY?: number })
                          .POINTOPACITY ?? 100
                      }
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        onPatch(selectedLayer.id, {
                          config: { ...selectedLayer.config, POINTOPACITY: val },
                        });
                      }}
                    />
                    <span className="layer-opacity-value">
                      {(selectedLayer.config as { POINTOPACITY?: number })
                        .POINTOPACITY ?? 100}
                      %
                    </span>
                  </div>
                </div>
                <KineticaWmsLayerForm
                  // cb_config + track_config are TOP-LEVEL DashboardLayerDto columns
                  // (v1.7 Phase 38), NOT nested config keys — same precedent as info_*
                  // below. Merge them IN so CbConfigForm/TrackSubSection (which read/write
                  // config.cb_config / config.track_config) see the persisted values, and
                  // split them back OUT to top-level onPatch fields on change. Without this
                  // the forms bury cb_config in the config blob and wmsUrlBuilder (which
                  // reads layer.cb_config) never sees it → no CB_*/TRACK_* params emit.
                  config={{
                    ...selectedLayer.config,
                    cb_config: selectedLayer.cb_config,
                    track_config: selectedLayer.track_config,
                  }}
                  columns={formColumns}
                  onChange={(nextConfig) => {
                    const {
                      cb_config,
                      track_config,
                      ...rest
                    } = nextConfig as Record<string, unknown>;
                    onPatch(selectedLayer.id, {
                      config: rest,
                      cb_config: (cb_config as string | null) ?? null,
                      track_config: (track_config as string | null) ?? null,
                    });
                  }}
                  // v1.4 Phase 22 (CONFIG-V14-03): info_* are TOP-LEVEL DashboardLayerDto columns,
                  // NOT nested config keys. Route them via the existing onPatch flow (300ms debounce
                  // and updateLayer's Pick<> already accepts these per Phase 19).
                  infoEnabled={selectedLayer.info_enabled}
                  infoColumns={selectedLayer.info_columns}
                  infoTemplate={selectedLayer.info_template}
                  onChangeInfoConfig={(patch) => onPatch(selectedLayer.id, patch)}
                  tableMissing={isTableMissing(selectedLayer)}
                  // Phase 35 (DV-V16-13): per-layer Data Source picker inputs.
                  layer={selectedLayer}
                  associatedTables={associatedTables}
                  dynamicViews={dynamicViews}
                  onDataSourceChange={handleDataSourceChange}
                />
              </>
            ) : (
              <div className="layers-modal-empty">
                <div style={{ fontWeight: 600 }}>
                  Select a layer to configure
                </div>
                <div>Click a layer in the list, or add a new one.</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
