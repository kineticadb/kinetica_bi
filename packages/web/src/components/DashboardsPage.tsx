import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faXmark, faGear } from "@fortawesome/free-solid-svg-icons";
import {
  listDashboards,
  createDashboard,
  updateDashboard,
  deleteDashboard,
  listDashboardTables,
  addDashboardTable,
  removeDashboardTable,
  listTables,
  listWidgets,
  createWidget,
  updateWidget,
  deleteWidget,
  listViews,
  createView,
  DashboardDto,
  TableDto,
  WidgetDto,
  ViewDto,
} from "../api/client";
import { useApiQuery } from "../hooks/useApiQuery";
import { useDynamicViewMaterializeChain } from "../hooks/useDynamicViewMaterializeChain";  // Phase 35 (DV-V16-13)
import { useFilterStore } from "../store/filterStore";
import { useFilterViewStore } from "../store/filterViewStore";
import { useInfoSelectionStore } from "../store/infoSelectionStore";
import { useLastInfoClickContextStore } from "../store/lastInfoClickContextStore";
import { useSpatialFilterStore } from "../store/spatialFilterStore";
import { useDynamicViewStore } from "../store/dynamicViewStore";
import LayersModal from "./LayersModal";
import DynamicViewsModal from "./DynamicViewsModal";  // Phase 34 (DV-V16-08)
import { useDashboardLayersStore } from "../store/dashboardLayersStore";
import {
  listDashboardLayers,
  createLayer,
  updateLayer as apiUpdateLayer,
  deleteLayer as apiDeleteLayer,
  reorderLayers as apiReorderLayers,
  dropFilterView,
  dropDynamicView,
  type DashboardLayerDto,
} from "../api/client";
import { useToastStore } from "../store/toast";
import ChartCard from "./ChartCard";
import ChartConfigPanel from "./charts/ChartConfigPanel";
import WidgetRenderer from "./charts/WidgetRenderer";
import { DashboardContextProvider } from "./DashboardContext";
import { FilteringBadge } from "./FilteringBadge";
import { MapFilteringBadge } from "./MapFilteringBadge";
import { aggregateSpatialTargetsByTable } from "../lib/spatialTargets";
import { buildChipText } from "../lib/columnTypes";
import { getAllChartTypes, getChartType } from "./charts/registry";
import { ResponsiveGridLayout, useContainerWidth, type LayoutItem, type Layout } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";

type View =
  | { mode: "list" }
  | { mode: "view"; dashboard: DashboardDto }
  | { mode: "edit"; dashboard: DashboardDto }
  | { mode: "create" }
  | { mode: "open"; dashboard: DashboardDto };

// Phase 44 (FILTER-V17-05): Filter-bar chip text now comes from buildChipText in columnTypes.ts.
// Previously duplicated here; consolidated to single source of truth.

const DashboardsPage = ({ onViewChange }: { onViewChange?: (mode: string) => void }) => {
  const { loading, data, error } = useApiQuery<DashboardDto[]>(() => listDashboards(), []);
  const [dashboards, setDashboards] = useState<DashboardDto[]>([]);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [view, setViewState] = useState<View>({ mode: "list" });

  // Sync dashboards state from useApiQuery data (preserves local mutation for delete)
  useEffect(() => {
    if (data) setDashboards(data);
  }, [data]);

  const setView = (v: View) => {
    setViewState(v);
    onViewChange?.(v.mode);
  };

  const handleDelete = (dash: DashboardDto) => {
    if (!window.confirm(`Delete dashboard "${dash.name}"?`)) return;
    deleteDashboard(dash.id)
      .then(() => setDashboards((prev) => prev.filter((d) => d.id !== dash.id)))
      .catch((err) => setDeleteError(err.message));
  };

  if (view.mode === "open") {
    return (
      <DashboardOpen
        dashboard={view.dashboard}
        onBack={() => setView({ mode: "list" })}
      />
    );
  }

  if (view.mode === "create") {
    return (
      <DashboardCreate
        onBack={() => setView({ mode: "list" })}
        onSaved={(created) => {
          setDashboards((prev) => [created, ...prev]);
          setView({ mode: "view", dashboard: created });
        }}
      />
    );
  }

  if (view.mode === "view") {
    return (
      <DashboardDetail
        dashboard={view.dashboard}
        onBack={() => setView({ mode: "list" })}
        onEdit={() => setView({ mode: "edit", dashboard: view.dashboard })}
      />
    );
  }

  if (view.mode === "edit") {
    return (
      <DashboardEdit
        dashboard={view.dashboard}
        onBack={() => setView({ mode: "list" })}
        onSaved={(updated) => {
          setDashboards((prev) => prev.map((d) => (d.id === updated.id ? updated : d)));
          setView({ mode: "view", dashboard: updated });
        }}
      />
    );
  }

  return (
    <div className="dashboard-list">
      <ChartCard
        title="Dashboards"
        description="All saved dashboards from the backend"
        actions={
          <button className="btn-primary" onClick={() => setView({ mode: "create" })}>
            + New Dashboard
          </button>
        }
      >
        {loading && <div className="muted">Loading dashboards…</div>}
        {error && error.kind === "permission" && (
          <div className="widget-permission-denied">Permission denied</div>
        )}
        {error && error.kind !== "permission" && (
          <div className="error">{error.message}</div>
        )}
        {deleteError && <div className="error">{deleteError}</div>}
        {!loading && !error && dashboards.length === 0 && <div className="muted">No dashboards yet.</div>}
        {!loading && !error && dashboards.length > 0 && (
          <div className="datasets-table">
            <div className="ds-header dash-grid">
              <span>Name</span>
              <span>Description</span>
              <span>Updated</span>
              <span>Actions</span>
            </div>
            {dashboards.map((dash) => (
              <div key={dash.id} className="ds-row dash-grid">
                <span className="ds-name">{dash.name}</span>
                <span className="ds-schema">{dash.description || "—"}</span>
                <span className="ds-meta">{new Date(dash.updated_at).toLocaleString()}</span>
                <span className="ds-actions">
                  <button className="btn-primary btn-sm" onClick={() => setView({ mode: "open", dashboard: dash })}>
                    Open
                  </button>
                  <button className="ghost-sm" onClick={() => setView({ mode: "view", dashboard: dash })}>
                    View
                  </button>
                  <button className="ghost-sm" onClick={() => setView({ mode: "edit", dashboard: dash })}>
                    Edit
                  </button>
                  <button className="ghost-sm ghost-danger" onClick={() => handleDelete(dash)}>
                    Delete
                  </button>
                </span>
              </div>
            ))}
          </div>
        )}
      </ChartCard>
    </div>
  );
};

const DashboardDetail = ({
  dashboard,
  onBack,
  onEdit
}: {
  dashboard: DashboardDto;
  onBack: () => void;
  onEdit: () => void;
}) => (
  <div className="dashboard-list">
    <ChartCard
      title={dashboard.name}
      description={dashboard.description || "No description"}
      actions={
        <div className="ds-actions">
          <button className="ghost-sm" onClick={onEdit}>Edit</button>
          <button className="ghost-sm" onClick={onBack}>Back</button>
        </div>
      }
    >
      <div className="ds-detail">
        {dashboard.description && (
          <div className="ds-detail-row">
            <span className="ds-detail-label">Description</span>
            <span>{dashboard.description}</span>
          </div>
        )}
        <div className="ds-detail-row">
          <span className="ds-detail-label">Created</span>
          <span>{new Date(dashboard.created_at).toLocaleString()}</span>
        </div>
        <div className="ds-detail-row">
          <span className="ds-detail-label">Updated</span>
          <span>{new Date(dashboard.updated_at).toLocaleString()}</span>
        </div>
      </div>
    </ChartCard>
  </div>
);

const DashboardEdit = ({
  dashboard,
  onBack,
  onSaved
}: {
  dashboard: DashboardDto;
  onBack: () => void;
  onSaved: (updated: DashboardDto) => void;
}) => {
  const [name, setName] = useState(dashboard.name);
  const [description, setDescription] = useState(dashboard.description || "");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const handleSave = () => {
    setSaving(true);
    setSaveError(null);
    updateDashboard(dashboard.id, { name, description })
      .then(onSaved)
      .catch((err) => setSaveError(err.message))
      .finally(() => setSaving(false));
  };

  return (
    <div className="dashboard-list">
      <ChartCard
        title={`Edit: ${dashboard.name}`}
        actions={<button className="ghost-sm" onClick={onBack}>Cancel</button>}
      >
        <div className="ds-form">
          <label className="ds-field">
            <span className="ds-field-label">Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="ds-field">
            <span className="ds-field-label">Description</span>
            <input value={description} onChange={(e) => setDescription(e.target.value)} />
          </label>
          {saveError && <div className="error">{saveError}</div>}
          <button className="btn-primary" onClick={handleSave} disabled={saving || !name}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </ChartCard>
    </div>
  );
};

const DashboardCreate = ({
  onBack,
  onSaved
}: {
  onBack: () => void;
  onSaved: (created: DashboardDto) => void;
}) => {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const handleSave = () => {
    setSaving(true);
    setSaveError(null);
    createDashboard({ name, description })
      .then(onSaved)
      .catch((err) => setSaveError(err.message))
      .finally(() => setSaving(false));
  };

  return (
    <div className="dashboard-list">
      <ChartCard
        title="New Dashboard"
        actions={<button className="ghost-sm" onClick={onBack}>Cancel</button>}
      >
        <div className="ds-form">
          <label className="ds-field">
            <span className="ds-field-label">Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Dashboard name" />
          </label>
          <label className="ds-field">
            <span className="ds-field-label">Description</span>
            <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional description" />
          </label>
          {saveError && <div className="error">{saveError}</div>}
          <button className="btn-primary" onClick={handleSave} disabled={saving || !name}>
            {saving ? "Creating…" : "Create Dashboard"}
          </button>
        </div>
      </ChartCard>
    </div>
  );
};

const getVisualizationTypes = () =>
  getAllChartTypes().map((ct) => ({ value: ct.type, label: ct.label, icon: ct.icon }));

const getWidgetLayout = (widget: WidgetDto, index: number): LayoutItem => {
  const saved = widget.config?.layout as Partial<LayoutItem> | undefined;
  return {
    i: String(widget.id),
    x: saved?.x ?? (index % 2) * 6,
    y: saved?.y ?? Math.floor(index / 2) * 4,
    w: saved?.w ?? 6,
    h: saved?.h ?? 4,
    minW: 2,
    minH: 2,
  };
};

const DashboardOpen = ({
  dashboard,
  onBack
}: {
  dashboard: DashboardDto;
  onBack: () => void;
}) => {
  const tablesQuery = useApiQuery<TableDto[]>(() => listDashboardTables(dashboard.id), [dashboard.id]);
  const widgetsQuery = useApiQuery<WidgetDto[]>(() => listWidgets(dashboard.id), [dashboard.id]);
  const viewsQuery = useApiQuery<ViewDto[]>(() => listViews(dashboard.id), [dashboard.id]);

  const [associatedTables, setAssociatedTables] = useState<TableDto[]>([]);
  const [views, setViews] = useState<ViewDto[]>([]);
  const [widgets, setWidgets] = useState<WidgetDto[]>([]);
  const [showTableModal, setShowTableModal] = useState(false);
  const [showVizModal, setShowVizModal] = useState(false);
  const [showLayersModal, setShowLayersModal] = useState(false);
  const [showDynamicViewsModal, setShowDynamicViewsModal] = useState(false);  // Phase 34 (DV-V16-08)
  const [configuringWidget, setConfiguringWidget] = useState<WidgetDto | null>(null);

  // Phase 35 (DV-V16-13): orchestrator hook — mounted ONCE at DashboardOpen scope.
  // Owns the dashboard's dynamic-view list + the cascading materialize chain
  // (markPending → materializeDynamicView → setView/setError) fired on
  // useFilterViewStore.views[T]?.materializeVersion bumps. Cold-start gate
  // inside the hook prevents N materialize calls on dashboard mount before any
  // filter is applied. `dynamicViews` is the SINGLE source of truth for the
  // dashboard's dv list, threaded through DashboardContext + WidgetConfigModal +
  // LayersModal. Phase 35 Plan 05: `retry` is now threaded through
  // DashboardContext so renderers' error-state Retry button can re-fire the
  // cascade for a specific dynamic-view id.
  const { dynamicViews, retry: retryDynamicView } = useDynamicViewMaterializeChain(dashboard.id);

  // Phase 12: Layer store subscription
  const layers = useDashboardLayersStore((s) => s.layers);
  const setLayers = useDashboardLayersStore((s) => s.setLayers);
  const [error, setError] = useState<string | null>(null);
  const { width, mounted, containerRef } = useContainerWidth();

  // Sync local state from query data; local state is used for mutations (add/remove/update)
  useEffect(() => { if (tablesQuery.data) setAssociatedTables(tablesQuery.data); }, [tablesQuery.data]);
  useEffect(() => { if (widgetsQuery.data) setWidgets(widgetsQuery.data); }, [widgetsQuery.data]);
  useEffect(() => { if (viewsQuery.data) setViews(viewsQuery.data); }, [viewsQuery.data]);

  // Phase 9 FILT-01 + Phase 15 LIFE-V13-04 lifecycle: on dashboard unmount or switch, fire-and-forget
  // DROPs for every active server-side filter view, then clear BOTH client stores.
  // Filters are transient per-dashboard — going A -> B -> A returns with empty filters.
  // entry.dashboardId is populated by Plan 15-02's FilterViewEntry schema extension —
  // cleanup loop reads it directly without needing the current dashboard.id (handles edge cases
  // where views from a previous dashboard somehow persist; defensive against state races).
  useEffect(() => {
    return () => {
      // LIFE-V13-04: snapshot active views BEFORE reset so the loop can read entry.dashboardId.
      const views = useFilterViewStore.getState().views;
      for (const tableIdStr of Object.keys(views)) {
        const tableId = Number(tableIdStr);
        const entry = views[tableId];
        // Fire-and-forget — errors swallowed (V13-P-12 lock; user is leaving the dashboard).
        dropFilterView({ dashboardId: entry.dashboardId, tableId }).catch(() => {});
      }
      useFilterViewStore.getState().reset();
      useFilterStore.getState().reset();
      // Phase 20 STORE-V14-03: third reset alongside the canonical two-store block.
      // Session-only store (STORE-V14-02) — no server-side DROP loop needed.
      useInfoSelectionStore.getState().reset();
      // Plan 23-02 (CARD-V14-02): fourth reset — last-info-click context store.
      // Pitfall 1 lock (23-RESEARCH.md): stale dashboard-A click coords MUST NOT survive a
      // dashboard-switch. Session-only store; no DROP loop needed.
      useLastInfoClickContextStore.getState().reset();
      // Phase 27 STORE-V15-04: fifth reset — spatial filter store.
      // Session-only shapes; NO server-side DROP loop needed (mirrors infoSelectionStore +
      // lastInfoClickContextStore pattern). Dashboard-A shapes MUST NOT leak into dashboard-B.
      useSpatialFilterStore.getState().reset();
      // Phase 33 DV-V16-07 (6th store): snapshot materialized dynamic views BEFORE
      // reset so the loop can read entry IDs. Only `status === "materialized"` entries
      // have a live Kinetica view to drop. Fire-and-forget — never blocks dashboard switch.
      // Dashboard-A dynamic views MUST NOT leak into dashboard-B (mirrors v1.4 + v1.5
      // session-only stores cleanup invariant).
      const dynamicViews = useDynamicViewStore.getState().views;
      for (const idStr of Object.keys(dynamicViews)) {
        const dvId = Number(idStr);
        if (dynamicViews[dvId]?.status === "materialized") {
          dropDynamicView(dvId).catch(() => {});
        }
      }
      useDynamicViewStore.getState().reset();
    };
  }, [dashboard.id]);

  // Phase 12: Load layers on dashboard open; reset on dashboard switch / unmount.
  // NOTE: filter bar visibility for layer-bound tables works because the LayersModal
  // table dropdown is sourced from associatedTables — see Plan 04 RESEARCH Open Q3.
  useEffect(() => {
    let cancelled = false;
    listDashboardLayers(dashboard.id)
      .then((data) => { if (!cancelled) setLayers(data); })
      .catch((err) => {
        if (!cancelled) setLayers([]);
        console.error("Failed to load dashboard layers", err);
      });
    return () => {
      cancelled = true;
      setLayers([]); // reset on dashboard switch / unmount
    };
  }, [dashboard.id, setLayers]);

  // Phase 10 DRILL-03: subscribe to filter store for the interactive filter bar.
  // PITFALL C-02 / S-02 lock: subscribe to the entire `filters` map AND `filterVersion`
  // so the bar re-renders on every mutation. DashboardOpen is the page-level component
  // (not a hot widget) so the cross-table re-render cost is acceptable here. Hot widgets
  // continue using the table-scoped selector at filters[tableId] (AggregatedWidgetRenderer).
  const allStoreFilters = useFilterStore((s) => s.filters);
  const filterVersion = useFilterStore((s) => s.filterVersion);
  void filterVersion; // referenced for dep tracking; not directly used in JSX

  // Phase 30 (CHIP-V15-01/02): subscribe to spatial shapes + memoize per-table eligible targets.
  // shapes is read as the full array (NOT a primitive selector) because chip rendering iterates
  // shapes directly — re-render on shape mutation is exactly the intended trigger.
  const shapes = useSpatialFilterStore((s) => s.shapes);
  const targetsByTable = useMemo(
    () => aggregateSpatialTargetsByTable(widgets),
    [widgets],
  );
  // Compute the set of tableIds that have any shape mapped to them (via targetsByTable.has).
  // A shape's "target tableId" is the tableId of the SpatialTarget that aggregateSpatialTargetsByTable
  // associates with this shape — but since shapes are global and targets are per-table, the
  // mapping is: for each tableId in targetsByTable, all shapes apply (OR-composition).
  // So a tableId has chips iff (a) targetsByTable.has(tableId) AND (b) shapes.length > 0.
  const tableIdsWithSpatialChips = useMemo(() => {
    if (shapes.length === 0) return new Set<number>();
    return new Set<number>(Array.from(targetsByTable.keys()));
  }, [shapes, targetsByTable]);

  const refreshViews = () => viewsQuery.refetch();

  const handleAddTable = (tableId: number) => {
    addDashboardTable(dashboard.id, tableId)
      .then((tables) => {
        setAssociatedTables(tables);
        // Auto-create a view placeholder for the new table
        const added = tables.find((t: TableDto) => t.id === tableId);
        if (added) {
          const fullName = added.schema ? `${added.schema}.${added.name}` : added.name;
          createView(dashboard.id, {
            table_id: tableId,
            view_name: fullName,
            filter_clause: "",
          }).then(() => refreshViews()).catch(() => {});
        }
      })
      .catch((err) => setError(err.message));
  };

  const handleRemoveTable = (tableId: number) => {
    removeDashboardTable(dashboard.id, tableId)
      .then(() => {
        setAssociatedTables((prev) => prev.filter((t) => t.id !== tableId));
        refreshViews();
      })
      .catch((err) => setError(err.message));
  };

  const handleAddVisualization = (type: string) => {
    const chartDef = getChartType(type);
    const label = chartDef?.label ?? type;
    const defaults = chartDef?.defaultConfig ?? {};
    const nextY = widgets.length > 0
      ? Math.max(...widgets.map((w, i) => {
          const l = getWidgetLayout(w, i);
          return l.y + l.h;
        }))
      : 0;
    createWidget(dashboard.id, {
      title: label,
      type,
      config: { ...defaults, layout: { x: 0, y: nextY, w: 6, h: 4 } }
    })
      .then((widget) => {
        setWidgets((prev) => [...prev, widget]);
        setShowVizModal(false);
      })
      .catch((err) => setError(err.message));
  };

  const handleSaveConfig = (widget: WidgetDto, payload: { title: string; config: Record<string, unknown> }) => {
    const layout = widget.config?.layout;
    const newConfig = { ...payload.config, layout };
    // Auto-save fires every onChange for custom-panel charts (e.g. map). Closing the
    // modal on every save makes the picker unusable — keep it open and let the user
    // dismiss explicitly via the modal's Close button (or Apply/Cancel inside the panel).
    // Standard form-field charts gate save behind their own Apply button, so closing
    // on save matches user intent there.
    const isCustomPanel = !!getChartType(widget.type)?.CustomConfigPanel;
    updateWidget(widget.id, { title: payload.title, config: newConfig })
      .then((updated) => {
        setWidgets((prev) => prev.map((w) => (w.id === updated.id ? updated : w)));
        if (isCustomPanel) {
          // Keep the modal's source-of-truth widget in sync with the persisted state.
          // Without this, every auto-save re-renders the modal with the stale widget
          // ref, which clobbers ChartConfigPanel's draft via its config-prop reset effect.
          setConfiguringWidget(updated);
        } else {
          setConfiguringWidget(null);
        }
      })
      .catch((err) => setError(err.message));
  };

  const handleRemoveWidget = (widgetId: number) => {
    deleteWidget(widgetId)
      .then(() => setWidgets((prev) => prev.filter((w) => w.id !== widgetId)))
      .catch((err) => setError(err.message));
  };

  const handleLayoutChange = (layout: Layout) => {
    layout.forEach((item) => {
      const widget = widgets.find((w) => String(w.id) === item.i);
      if (!widget) return;
      const prev = widget.config?.layout as Partial<LayoutItem> | undefined;
      if (prev?.x === item.x && prev?.y === item.y && prev?.w === item.w && prev?.h === item.h) return;
      updateWidget(widget.id, {
        config: { ...widget.config, layout: { x: item.x, y: item.y, w: item.w, h: item.h } }
      }).catch((err) => setError(err.message));
    });
    setWidgets((prev) =>
      prev.map((w) => {
        const item = layout.find((l) => l.i === String(w.id));
        if (!item) return w;
        return { ...w, config: { ...w.config, layout: { x: item.x, y: item.y, w: item.w, h: item.h } } };
      })
    );
  };

  // ─── Phase 12: Layers debounced auto-save ──────────────────────────────
  // PITFALL (RESEARCH Pitfall 5): debounce reads from a ref so it sees the LATEST patch
  // at fire time, not the patch from when the timeout was scheduled.
  const pendingPatchRef = useRef<Map<number, Partial<DashboardLayerDto>>>(new Map());
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushPendingPatches = useCallback(async () => {
    const patches = pendingPatchRef.current;
    if (patches.size === 0) return;
    const snapshot = new Map(patches);
    pendingPatchRef.current.clear();
    for (const [layerId, patch] of snapshot) {
      try {
        await apiUpdateLayer(dashboard.id, layerId, patch);
      } catch (err) {
        useToastStore.getState().showToast("Failed to save layer — check your connection", "error");
        console.error("updateLayer failed", err);
      }
    }
  }, [dashboard.id]);

  const handleLayerPatch = useCallback((layerId: number, patch: Partial<DashboardLayerDto>) => {
    // 1. Optimistic store update (immediate UI feedback — no await)
    useDashboardLayersStore.getState().updateLayer(layerId, patch);
    // 2. Stash patch in ref (latest wins per layer)
    const prev = pendingPatchRef.current.get(layerId) ?? {};
    pendingPatchRef.current.set(layerId, { ...prev, ...patch });
    // 3. Reset 300ms debounce
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => { void flushPendingPatches(); }, 300);
  }, [flushPendingPatches]);

  const handleLayerCreate = useCallback(async () => {
    if (associatedTables.length === 0) {
      useToastStore.getState().showToast("Add a table to this dashboard first.", "info");
      return;
    }
    const defaultTableId = associatedTables[0].id;
    // Defaults MUST match the field names that `buildWmsParams` and the form
    // controls read (camelCase, e.g. `pointOpacity` — NOT `POINTOPACITY`). The
    // previous defaults used `POINTOPACITY` (the on-wire WMS param name),
    // which buildWmsParams' `config.pointOpacity` check ignored — so a freshly
    // created layer's first tile request omitted POINTOPACITY entirely, and
    // Kinetica fell back to its own default (visually different from what the
    // form showed). Operator workaround: drag the slider once to set
    // `pointOpacity` in the correct case, then the tile re-rendered.
    //
    // Also explicitly seed style fields the form falls back to via `??`/`||`
    // (pointShape, shapeFillColor, shapeLineColor, shapeLineWidth,
    // antialiasing). Form fallbacks only affect the rendered SELECT/INPUT
    // value — they don't write into config, so the WMS URL omits those params
    // until the operator touches the control. Seeding here ensures the first
    // tile fetch already includes everything the form claims is the default.
    const defaultConfig = {
      renderMode: "raster",
      spatialMode: "latlon",
      colormap: "viridis",
      reverseColormap: false,
      // 8-char AARRGGBB: FF (opaque) + 3B82F6 (blue). Stored without '#' for the WMS URL.
      pointColor: "FF3B82F6",
      pointSize: 5,
      pointOpacity: 100,
      pointShape: "circle",
      shapeFillColor: "FFFF3838",
      shapeLineColor: "FF000000",
      shapeLineWidth: 1,
      antialiasing: false,
      visible: true,
    };
    try {
      const created = await createLayer(dashboard.id, { table_id: defaultTableId, config: defaultConfig });
      useDashboardLayersStore.getState().addLayer(created);
      useToastStore.getState().showToast("Layer added");
    } catch (err) {
      useToastStore.getState().showToast("Failed to save layer — check your connection", "error");
      console.error("createLayer failed", err);
    }
  }, [dashboard.id, associatedTables]);

  const handleLayerDelete = useCallback(async (layerId: number) => {
    try {
      await apiDeleteLayer(dashboard.id, layerId);
      useDashboardLayersStore.getState().removeLayer(layerId);
      useToastStore.getState().showToast("Layer deleted");
    } catch (err) {
      useToastStore.getState().showToast("Failed to save layer — check your connection", "error");
      console.error("deleteLayer failed", err);
    }
  }, [dashboard.id]);

  const handleLayerDuplicate = useCallback(async (layerId: number) => {
    const source = useDashboardLayersStore.getState().layers.find((l) => l.id === layerId);
    if (!source) return;
    try {
      const created = await createLayer(dashboard.id, { table_id: source.table_id, config: { ...source.config } });
      useDashboardLayersStore.getState().addLayer(created);
      useToastStore.getState().showToast("Layer added");
    } catch (err) {
      useToastStore.getState().showToast("Failed to save layer — check your connection", "error");
      console.error("duplicateLayer failed", err);
    }
  }, [dashboard.id]);

  const handleLayerReorder = useCallback(async (orderedIds: number[]) => {
    const current = useDashboardLayersStore.getState().layers;
    const reordered = orderedIds
      .map((id) => current.find((l) => l.id === id))
      .filter((l): l is DashboardLayerDto => !!l);
    useDashboardLayersStore.getState().reorderLayers(reordered);
    try {
      const final = await apiReorderLayers(dashboard.id, orderedIds);
      useDashboardLayersStore.getState().setLayers(final);
    } catch (err) {
      useToastStore.getState().showToast("Failed to save layer — check your connection", "error");
      console.error("reorderLayers failed", err);
    }
  }, [dashboard.id]);

  const handleLayersModalClose = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    void flushPendingPatches();
    setShowLayersModal(false);
  }, [flushPendingPatches]);

  useEffect(() => {
    if (showLayersModal && layers.length === 0 && associatedTables.length > 0) {
      void handleLayerCreate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showLayersModal]);

  const layouts = widgets.map((w, i) => getWidgetLayout(w, i));

  return (
    <div className="dashboard-open">
      <div className="dashboard-open-header">
        <div>
          <div className="dashboard-open-title">{dashboard.name}</div>
        </div>
        <div className="dashboard-toolbar">
          <button className="btn-primary btn-sm" onClick={() => setShowTableModal(true)}>
            Tables
          </button>
          <button className="btn-primary btn-sm" onClick={() => setShowDynamicViewsModal(true)}>
            Dynamic Views
          </button>
          <button className="btn-primary btn-sm" onClick={() => setShowLayersModal(true)}>
            Map Layers
          </button>
          <button className="btn-primary btn-sm" onClick={() => setShowVizModal(true)}>
            Visualizations
          </button>
          <button className="ghost-sm" onClick={onBack}>Back</button>
        </div>
      </div>

      {error && <div className="error">{error}</div>}
      {(tablesQuery.error || widgetsQuery.error || viewsQuery.error) && (() => {
        const qErr = tablesQuery.error ?? widgetsQuery.error ?? viewsQuery.error!;
        return qErr.kind === "permission"
          ? <div className="widget-permission-denied">Permission denied</div>
          : <div className="error">{qErr.message}</div>;
      })()}

      {/* Active filters bar (Phase 10 DRILL-03 — interactive). Hidden entirely when no
          table has either a non-empty static view.filter_clause OR active store filters.
          Phase 17-04: iterate the UNION of legacy `views[].table_id` (static WHERE-clause
          definitions persisted in SQLite) and store-filter tableIds (chips added via drill-down
          on tables that may not have a persisted view row in v1.3's FROM-swap world). Pre-17-04,
          chips for tableIds without a `views` row were silently dropped — the filter applied
          correctly but the user had no chip to dismiss. Display name resolved from
          associatedTables for tableIds without a view row. */}
      {(() => {
        const hasAnyStaticClause = views.some((v) => !!v.filter_clause?.trim());
        const hasAnyStoreFilters = Object.values(allStoreFilters).some((arr) => arr.length > 0);
        const hasAnySpatialChips = tableIdsWithSpatialChips.size > 0;
        if (!hasAnyStaticClause && !hasAnyStoreFilters && !hasAnySpatialChips) return null;

        // Build a map keyed by tableId so each table renders exactly once even if it has both
        // a `views` row AND active store filters.
        const tableIdsWithFilters = new Set<number>();
        for (const v of views) {
          if (v.filter_clause?.trim()) tableIdsWithFilters.add(v.table_id);
        }
        for (const [tidStr, arr] of Object.entries(allStoreFilters)) {
          if (arr.length > 0) tableIdsWithFilters.add(Number(tidStr));
        }
        // Phase 30 (CHIP-V15-01): include tableIds that have an eligible target AND shapes drawn.
        for (const tid of tableIdsWithSpatialChips) {
          tableIdsWithFilters.add(tid);
        }

        return (
          <div className="filter-bar">
            {Array.from(tableIdsWithFilters).map((tableId) => {
              const view = views.find((v) => v.table_id === tableId);
              const srcTable = associatedTables.find((t) => t.id === tableId);
              const srcName = srcTable
                ? srcTable.schema ? `${srcTable.schema}.${srcTable.name}` : srcTable.name
                : view?.view_name ?? `table ${tableId}`;
              const storeFilters = allStoreFilters[tableId] ?? [];
              const hasStaticClause = !!view?.filter_clause?.trim();
              const hasStoreFilters = storeFilters.length > 0;
              const hasSpatialForThisTable = tableIdsWithSpatialChips.has(tableId);

              // Defensive: if a tableId leaked in with no filters of either kind, skip.
              // Phase 30 (CHIP-V15-01): defensive guard extended to include spatial chips.
              if (!hasStaticClause && !hasStoreFilters && !hasSpatialForThisTable) return null;

              return (
                <div key={tableId} className="filter-bar-item">
                  <span className="filter-bar-table">{srcName}</span>
                  {hasStaticClause && (
                    <span className="filter-bar-clause">WHERE {view!.filter_clause}</span>
                  )}
                  {(hasStoreFilters || hasSpatialForThisTable) && (
                    <div className="filter-bar-chips">
                      {/* Column chips (existing v1.2/v1.3 behavior — unchanged) */}
                      {storeFilters.map((f) => (
                        <span key={`col-${f.column}`} className="filter-bar-chip">
                          {buildChipText(f.column, f.value, f.dataType, f.operator)}
                          <button
                            type="button"
                            className="filter-bar-chip-dismiss"
                            aria-label={`Remove filter ${f.column}`}
                            onClick={() => useFilterStore.getState().removeFilter(tableId, f.column)}
                          >
                            <FontAwesomeIcon icon={faXmark} />
                          </button>
                        </span>
                      ))}
                      {/* Phase 30 (CHIP-V15-01): spatial chips — one per shape, same row, same chip class. */}
                      {hasSpatialForThisTable && shapes.map((shape) => (
                        <span key={`spatial-${shape.id}`} className="filter-bar-chip">
                          {`${shape.label} (${shape.measurement})`}
                          <button
                            type="button"
                            className="filter-bar-chip-dismiss"
                            aria-label={`Remove spatial filter ${shape.label}`}
                            onClick={() => useSpatialFilterStore.getState().removeShape(shape.id)}
                          >
                            <FontAwesomeIcon icon={faXmark} />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                  {(hasStoreFilters || hasSpatialForThisTable) && (
                    <button
                      type="button"
                      className="filter-bar-clear"
                      onClick={() => {
                        // Phase 30 column branch: clear column filters for this table (existing behavior).
                        if (hasStoreFilters) {
                          useFilterStore.getState().clearFilters(tableId);
                        }
                        // Phase 30 (CHIP-V15-02) spatial branch: also remove every shape whose target
                        // tableId includes this row's tableId. Per CONTEXT.md `<decisions>` § "FilterBar
                        // chip placement": multi-target shapes are nuked GLOBALLY (their chips disappear
                        // from other rows too) — operator-locked. The semantic is "Clear all means this
                        // row is empty afterward".
                        //
                        // A shape is "targeting this tableId" when targetsByTable.has(tableId)
                        // returns true (in which case ALL shapes apply to this table via OR). So
                        // the condition for shape removal in this row's "Clear all" is simply:
                        // remove ALL shapes if hasSpatialForThisTable, else no-op.
                        //
                        // This is the GLOBAL nuke per the operator lock — equivalent to
                        // useSpatialFilterStore.getState().clearAll() — but written as an explicit
                        // removeShape loop for grep-stability AND because removeShape preserves
                        // shapeCounter for label continuity (clearAll resets shapeCounter to 0).
                        if (hasSpatialForThisTable) {
                          // Snapshot shape ids before mutation (avoid iterator invalidation).
                          const idsToRemove = shapes.map((s) => s.id);
                          for (const id of idsToRemove) {
                            useSpatialFilterStore.getState().removeShape(id);
                          }
                        }
                      }}
                    >
                      Clear all
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        );
      })()}

      {widgets.length === 0 && (
        <div className="muted" style={{ padding: "40px 0", textAlign: "center" }}>
          No visualizations yet. Click "Visualizations" to add one.
        </div>
      )}

      <DashboardContextProvider
        dashboardId={dashboard.id}
        widgets={widgets}
        dynamicViews={dynamicViews}
        retryDynamicView={retryDynamicView}
      >
        <div ref={containerRef as React.RefObject<HTMLDivElement>}>
        {widgets.length > 0 && mounted && (
          <ResponsiveGridLayout
            className="dashboard-grid"
            width={width}
            breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }}
            cols={{ lg: 12, md: 12, sm: 6, xs: 4, xxs: 2 }}
            rowHeight={80}
            layouts={{ lg: layouts }}
            onLayoutChange={(layout) => handleLayoutChange(layout)}
            dragConfig={{ enabled: true, handle: ".widget-drag-handle" }}
            resizeConfig={{ enabled: true }}
          >
            {widgets.map((w) => {
              // Phase 16: for map widgets, derive the included layer tableIds so MapFilteringBadge
              // subscribes to ANY-of-N materializing semantics matching the MapChartRenderer's
              // includedLayers set. Mirrors the includedLayers useMemo at MapChartRenderer.tsx:159-171.
              const mapTableIds: number[] = (() => {
                if (w.type !== "map") return [];
                const cfg = (w.config ?? {}) as Record<string, unknown>;
                const ids = cfg.includedLayerIds as number[] | undefined;
                const filtered =
                  ids === undefined || ids.length === 0
                    ? layers
                    : layers.filter((l) => ids.includes(l.id));
                const visible = filtered.filter(
                  (l) => (l.config as { visible?: boolean }).visible !== false,
                );
                return visible.map((l) => l.table_id);
              })();
              return (
              <div key={String(w.id)} className="widget-card">
                <div className="widget-header">
                  <span className="widget-drag-handle widget-title">{w.title}</span>
                  {w.type === "map" ? (
                    <MapFilteringBadge tableIds={mapTableIds} />
                  ) : (
                    <FilteringBadge tableId={(w.config as Record<string, unknown> | undefined)?.tableId as number | undefined} />
                  )}
                  <div className="widget-actions">
                    <button
                      className="widget-configure"
                      onClick={() => setConfiguringWidget(w)}
                      title="Configure"
                    >
                      <FontAwesomeIcon icon={faGear} />
                    </button>
                    <button
                      className="widget-remove"
                      onClick={() => handleRemoveWidget(w.id)}
                      title="Remove"
                    >
                      <FontAwesomeIcon icon={faXmark} />
                    </button>
                  </div>
                </div>
                <div className="widget-body">
                  <WidgetRenderer
                    widget={w}
                    tables={associatedTables}
                    onConfigureWidget={(target) => setConfiguringWidget(target)}
                  />
                </div>
              </div>
              );
            })}
          </ResponsiveGridLayout>
        )}
        </div>
      </DashboardContextProvider>

      {showTableModal && (
        <TablePickerModal
          associatedTables={associatedTables}
          onAdd={handleAddTable}
          onRemove={handleRemoveTable}
          onClose={() => setShowTableModal(false)}
        />
      )}

      {showVizModal && (
        <VisualizationPickerModal
          onSelect={handleAddVisualization}
          onClose={() => setShowVizModal(false)}
        />
      )}

      {configuringWidget && (
        <WidgetConfigModal
          widget={configuringWidget}
          widgets={widgets}
          tables={associatedTables}
          views={views}
          dynamicViews={dynamicViews}
          onSave={(chartConfig) => handleSaveConfig(configuringWidget, chartConfig)}
          onClose={() => setConfiguringWidget(null)}
        />
      )}

      {showLayersModal && (
        <LayersModal
          layers={layers}
          associatedTables={associatedTables}
          dynamicViews={dynamicViews}
          onClose={handleLayersModalClose}
          onCreate={handleLayerCreate}
          onDelete={handleLayerDelete}
          onDuplicate={handleLayerDuplicate}
          onPatch={handleLayerPatch}
          onReorder={handleLayerReorder}
        />
      )}

      {/* Phase 34 (DV-V16-08): Dashboard-scoped Dynamic Views management modal.
          dashboardId + associatedTables are passed as PROPS (NOT via DashboardContext —
          RESEARCH correction #3 lock). */}
      {showDynamicViewsModal && (
        <DynamicViewsModal
          dashboardId={dashboard.id}
          associatedTables={associatedTables}
          onClose={() => setShowDynamicViewsModal(false)}
        />
      )}
    </div>
  );
};

const VisualizationPickerModal = ({
  onSelect,
  onClose
}: {
  onSelect: (type: string) => void;
  onClose: () => void;
}) => {
  const vizTypes = getVisualizationTypes();

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">Add Visualization</span>
          <button className="ghost-sm" onClick={onClose}>Close</button>
        </div>
        <div className="modal-body">
          <div className="viz-picker-grid">
            {vizTypes.map((v) => (
              <button
                key={v.value}
                className="viz-picker-item"
                onClick={() => onSelect(v.value)}
              >
                <span className="viz-picker-icon">{v.icon}</span>
                <span className="viz-picker-label">{v.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

const WidgetConfigModal = ({
  widget,
  widgets,
  tables,
  views,
  dynamicViews,
  onSave,
  onClose
}: {
  widget: WidgetDto;
  widgets: WidgetDto[];           // Phase 42 Plan 42-01: required prop
  tables: TableDto[];
  views: ViewDto[];
  /**
   * Phase 35 (DV-V16-12): dashboard's dynamic-view list, threaded down from
   * DashboardOpen via Plan 35-03's prop conduit. Forwarded to ChartConfigPanel
   * which renders the "Dynamic Views" optgroup in the Data Source picker.
   */
  dynamicViews?: import("../api/client").DynamicViewRow[];
  onSave: (payload: { title: string; config: Record<string, unknown> }) => void;
  onClose: () => void;
}) => {
  // Extract chart-specific config (everything except layout)
  const { layout: _layout, ...chartConfig } = (widget.config ?? {}) as Record<string, unknown>;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content modal-config" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">Configure: {widget.title}</span>
          <button className="ghost-sm" onClick={onClose}>Close</button>
        </div>
        <div className="modal-body">
          <ChartConfigPanel
            widgetType={widget.type}
            title={widget.title}
            config={chartConfig}
            tables={tables}
            views={views}
            dynamicViews={dynamicViews}
            widgets={widgets}      // Phase 42 Plan 42-01: forward to <Custom> slot
            onSave={onSave}
            onCancel={onClose}
          />
        </div>
      </div>
    </div>
  );
};

const TablePickerModal = ({
  associatedTables,
  onAdd,
  onRemove,
  onClose
}: {
  associatedTables: TableDto[];
  onAdd: (tableId: number) => void;
  onRemove: (tableId: number) => void;
  onClose: () => void;
}) => {
  const [allTables, setAllTables] = useState<TableDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<number | null>(null);

  useEffect(() => {
    setLoading(true);
    listTables()
      .then(setAllTables)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const associatedIds = new Set(associatedTables.map((t) => t.id));
  const available = allTables.filter((t) => !associatedIds.has(t.id));

  const handleConfirmRemove = (tableId: number) => {
    onRemove(tableId);
    setConfirmingId(null);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">Manage Dashboard Tables</span>
          <button className="ghost-sm" onClick={onClose}>Close</button>
        </div>
        <div className="modal-body">
          {error && <div className="error">{error}</div>}

          <h3 className="modal-section-title">On this dashboard</h3>
          {associatedTables.length === 0 && (
            <div className="muted">No tables on this dashboard yet. Add one from the list below.</div>
          )}
          {associatedTables.length > 0 && (
            <div className="datasets-table">
              <div className="ds-header dash-tables-grid">
                <span>Name</span>
                <span>Schema</span>
                <span>Columns</span>
                <span>Actions</span>
              </div>
              {associatedTables.map((t) => (
                <div key={t.id} className="ds-row dash-tables-grid">
                  <span className="ds-name">{t.name}</span>
                  <span className="ds-schema">{t.schema}</span>
                  <span>{Object.keys(t.columns).length}</span>
                  <span>
                    {confirmingId === t.id ? (
                      <span className="confirm-actions">
                        <span className="muted confirm-prompt">Remove?</span>
                        <button className="btn-danger btn-sm" onClick={() => handleConfirmRemove(t.id)}>
                          Yes
                        </button>
                        <button className="ghost-sm" onClick={() => setConfirmingId(null)}>
                          Cancel
                        </button>
                      </span>
                    ) : (
                      <button className="ghost-sm" onClick={() => setConfirmingId(t.id)}>
                        Remove
                      </button>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}

          <h3 className="modal-section-title modal-section-title-spaced">Available to add</h3>
          {loading && <div className="muted">Loading tables…</div>}
          {!loading && available.length === 0 && (
            <div className="muted">No more tables available to add.</div>
          )}
          {!loading && available.length > 0 && (
            <div className="datasets-table">
              <div className="ds-header dash-tables-grid">
                <span>Name</span>
                <span>Schema</span>
                <span>Columns</span>
                <span>Actions</span>
              </div>
              {available.map((t) => (
                <div key={t.id} className="ds-row dash-tables-grid">
                  <span className="ds-name">{t.name}</span>
                  <span className="ds-schema">{t.schema}</span>
                  <span>{Object.keys(t.columns).length}</span>
                  <span>
                    <button className="btn-primary btn-sm" onClick={() => onAdd(t.id)}>
                      Add
                    </button>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default DashboardsPage;
