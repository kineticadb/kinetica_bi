/**
 * Phase 23 (CARD-V14-03) — Shared info selection body component.
 *
 * SCOPE: Pure body presentation + on-demand fetch path. Renders dropdown header
 * + records list + Load-more footer. No popup chrome (backdrop, close X, ESC
 * handler) — those live in the popup wrapper (InfoPopup.tsx). The Info Card
 * (Plan 23-03) wraps this same component inside a widget-cell container without
 * chrome.
 *
 * Why this exists: Plan 23-01 extracted the body from InfoPopup.tsx. Plan 23-03
 * (Task 1) moved the on-demand fetch (`handleLayerSwitch`) and Load-more fetch
 * (`handleLoadMore`) here from MapChartRenderer.tsx so popup and card share a
 * single source of truth for dropdown / records list / Load more / cross-phase
 * column sort / auto-eligibility-leave / fetch path.
 *
 * STORE SELECTOR (PITFALL S-02 lock from Phase 12+):
 *   - activeLayerId:    useInfoSelectionStore((s) => s.activeLayerId)
 *   - entry:            useInfoSelectionStore((s) => s.activeLayerId !== null
 *                                             ? s.state[s.activeLayerId] : null)
 *   - lastClickContext: useLastInfoClickContextStore((s) => s.context)
 *   - NEVER subscribe to s.state whole — fan-out re-renders on unrelated layer mutations.
 *
 * RENDER MODE: When the active layer's `info_template` is non-null, each row renders
 * via the shared `renderInfoTemplate` helper (Plan 21-01) using
 * `dangerouslySetInnerHTML`. NO sanitization — locked at .planning/PROJECT.md Key
 * Decision: "Dashboard authors are privileged users (analogous to saved SQL queries)."
 *
 * CROSS-PHASE COLUMN SORT (Phase 22 lock): caller-side alphabetical sort via
 * localeCompare BEFORE renderInfoTemplate so KV-mode column order matches the
 * ChipCombobox picker order. Lives HERE so both popup and card inherit it.
 *
 * PITFALL 2 LOCK (Plan 23-03): when `lastClickContext === null` (no prior click),
 * dropdown switch updates focus only (no fetch); Load-more no-ops. The card has
 * no map click of its own, so without a prior click on the dashboard's map widget
 * there is nothing to replay.
 *
 * ABORT-CONTROLLER LOCK: a dedicated AbortController for the on-demand fetch
 * lives inside this view (separate from MapChartRenderer's click-fan-out
 * controller). Aborts on dropdown re-switch, Load-more re-click, and unmount.
 */
import { useEffect, useMemo, useRef } from "react";
import { useInfoSelectionStore } from "../../store/infoSelectionStore";
import { useLastInfoClickContextStore } from "../../store/lastInfoClickContextStore";
import { useFilterViewStore } from "../../store/filterViewStore";
import { useDynamicViewStore } from "../../store/dynamicViewStore";
import { isViewExpired } from "../../lib/viewExpiry";

/**
 * Resolve the FROM target for an info-query SQL request against a given layer.
 *
 * Precedence:
 *   1. DV-bound + materialized → DYNAMIC VIEW name (the operator clicked tiles
 *      rendered from this view; querying anywhere else would surface records
 *      that don't correspond to what's visible).
 *   2. Filter view present for the layer's source table → filter view name
 *      (v1.3 behavior — keeps record set aligned with the filtered WMS tiles).
 *   3. undefined → server falls through to `FROM <schema>.<table>` (Phase 18
 *      default for unfiltered table-bound layers).
 *
 * Shared between MapChartRenderer's click fan-out, InfoSelectionView's
 * dropdown-switch fetch, and InfoSelectionView's Load-more fetch so all three
 * paths agree on which view the records come from. Returning undefined means
 * "skip this layer entirely" only when dv-bound but not materialized — caller
 * must check that case before invoking infoQuery (otherwise the server would
 * unintentionally query the source table for a dv-bound layer).
 */
function resolveInfoQueryViewName(
  layer: DashboardLayerDto,
): { kind: "view"; viewName: string | undefined } | { kind: "skip-dv-not-materialized" } {
  if (layer.dynamic_view_id != null) {
    const dvEntry =
      useDynamicViewStore.getState().views[layer.dynamic_view_id];
    if (dvEntry?.status === "materialized" && dvEntry.viewName) {
      return { kind: "view", viewName: dvEntry.viewName };
    }
    return { kind: "skip-dv-not-materialized" };
  }
  const fvEntry = useFilterViewStore.getState().views[layer.table_id];
  if (fvEntry && !isViewExpired(fvEntry) && fvEntry.viewName) {
    return { kind: "view", viewName: fvEntry.viewName };
  }
  return { kind: "view", viewName: undefined };
}
import { renderInfoTemplate } from "../../lib/renderInfoTemplate";
import { buildSpatialColumns } from "../../lib/spatialColumns";
import { infoQuery, type InfoSpatialMode } from "../../api/client";
import type { DashboardLayerDto } from "../../api/client";
import type { MapWidgetConfig } from "../../lib/wmsUrlBuilder";
import { coalesceTrackConfig } from "../../lib/wmsUrlBuilder";

type Props = {
  /** Eligibility list. Caller (popup or card wrapper) computes with its own scoping rule.
   *  Stable order (popup: by position via includedLayers; card: by position via dashboard layers). */
  eligibleLayers: DashboardLayerDto[];
  /** Display-name resolver for dropdown options. */
  layerNameFor: (layer: DashboardLayerDto) => string;
  /** Plan 23-03 Task 1: caller resolves layer.table_id → { schema, name } so this view
   *  can build the infoQuery payload internally. Both wrappers (popup + card) build this
   *  from their `tables` prop. Returns null when the table cannot be found. */
  resolveTable: (tableId: number) => { schema: string; name: string } | null;
  /** Empty-state copy override. Popup passes "No records" (preserves Phase 21 spec).
   *  Card passes the ROADMAP literal "Click a point on the map to see details" (CARD-V14-04). */
  emptyStateCopy?: string;
  /** Called when active layer leaves eligibleLayers (e.g. info_enabled flipped to 0,
   *  layer deleted, spatialMode flipped to wkb). Popup uses this to dismiss; card
   *  uses it to reset the store and render empty state. */
  onActiveLayerIneligible: () => void;
};

export default function InfoSelectionView({
  eligibleLayers,
  layerNameFor,
  resolveTable,
  emptyStateCopy,
  onActiveLayerIneligible,
}: Props) {
  // PITFALL S-02 lock: scoped selectors. NEVER subscribe to s.state whole.
  const activeLayerId = useInfoSelectionStore((s) => s.activeLayerId);
  const entry = useInfoSelectionStore((s) =>
    s.activeLayerId !== null ? s.state[s.activeLayerId] : null
  );
  const lastClickContext = useLastInfoClickContextStore((s) => s.context);
  const activeLayer =
    activeLayerId !== null
      ? eligibleLayers.find((l) => l.id === activeLayerId) ?? null
      : null;

  // Plan 23-03 Task 1: per-view AbortController for dropdown-switch + Load-more fetches.
  // Independent of MapChartRenderer's click-fan-out controller (V13-P-10 spirit:
  // separate controllers per concern so a fan-out abort cannot kill an in-flight
  // dropdown-switch and vice versa).
  const infoQueryAbortRef = useRef<AbortController | null>(null);

  // Auto-callback when active layer leaves eligibleLayers — single behavior, two surfaces.
  // Popup wrapper supplies onActiveLayerIneligible = onClose (which calls reset() +
  //   overlay.setPosition(undefined)).
  // Card wrapper supplies onActiveLayerIneligible = () =>
  //   useInfoSelectionStore.getState().reset().
  const eligibleIds = useMemo(
    () => new Set(eligibleLayers.map((l) => l.id)),
    [eligibleLayers]
  );
  useEffect(() => {
    if (activeLayerId !== null && !eligibleIds.has(activeLayerId)) {
      onActiveLayerIneligible();
    }
  }, [activeLayerId, eligibleIds, onActiveLayerIneligible]);

  // Cleanup AbortController on unmount.
  useEffect(() => {
    return () => {
      infoQueryAbortRef.current?.abort();
      infoQueryAbortRef.current = null;
    };
  }, []);

  // Plan 23-03 Task 1: dropdown switch handler.
  // Pitfall 2 lock — when lastClickContext === null (initial / post-reset), only
  //   update focus, do NOT fetch (no coords to replay; card has no map click of its own).
  // Phase 20 layer-switch lock — when state[newLayerId] !== undefined (already fetched),
  //   only switch focus, do NOT re-fetch (preserves prior data; setActiveLayer same-id
  //   is a no-op per Phase 20 store contract).
  const handleLayerSwitch = (newLayerId: number) => {
    const layer = eligibleLayers.find((l) => l.id === newLayerId);
    if (!layer) return;

    const store = useInfoSelectionStore.getState();

    // Pitfall 2: no prior click context — only update focus, do NOT fetch.
    if (lastClickContext === null) {
      store.setActiveLayer(newLayerId);
      return;
    }

    // Already-fetched layer: just switch focus, do NOT re-fetch.
    if (store.state[newLayerId] !== undefined) {
      store.setActiveLayer(newLayerId);
      return;
    }

    const tableMeta = resolveTable(layer.table_id);
    if (!tableMeta) return;

    const cfg = layer.config as Partial<MapWidgetConfig>;
    // TRACKFIX-V19-07 (GAP-54-08): thread layer.track_config as the 2nd arg so
    // buildSpatialColumns can resolve xCol/yCol for track-mode layers. track_config
    // is a top-level DashboardLayerDto column — it is NOT inside layer.config.
    const spatialColumns = buildSpatialColumns(cfg, layer.track_config);
    if (!spatialColumns) return;

    // Resolve FROM target — dv-bound layers query the DYNAMIC VIEW (not the
    // filter view); table-bound layers query the filter view when one exists.
    // See resolveInfoQueryViewName JSDoc for the full precedence.
    const resolved = resolveInfoQueryViewName(layer);
    if (resolved.kind === "skip-dv-not-materialized") {
      // DV-bound but not materialized — surface as a no-op switch. The card /
      // popup dropdown should already reflect this state (over_threshold
      // empty), but defensive: don't query the wrong view.
      return;
    }

    infoQueryAbortRef.current?.abort();
    const controller = new AbortController();
    infoQueryAbortRef.current = controller;

    store.setActiveLayer(newLayerId);  // wipes prior layer's entry per Phase 20 lock
    store.setLoading(newLayerId, true);

    // Phase 52: translate track→latlon at the wire boundary (InfoSpatialMode is a 3-mode union).
    const infoMode1: InfoSpatialMode =
      cfg.spatialMode === "track" ? "latlon" : (cfg.spatialMode as InfoSpatialMode);
    infoQuery(
      {
        layerId: newLayerId,
        tableId: layer.table_id,
        schema: tableMeta.schema,
        table: tableMeta.name,
        viewName: resolved.viewName,
        spatialMode: infoMode1,
        spatialColumns,
        clickLon: lastClickContext.clickLon,
        clickLat: lastClickContext.clickLat,
        radiusPx: lastClickContext.radiusPx,
        mapBbox: lastClickContext.mapBbox,
        mapWidthPx: lastClickContext.mapWidthPx,
        mapHeightPx: lastClickContext.mapHeightPx,
        page: 0,
      },
      controller.signal,
    )
      .then((res) => {
        if (controller.signal.aborted) return;
        const s = useInfoSelectionStore.getState();
        s.setSelection(newLayerId, res);
        s.setLoading(newLayerId, false);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        if ((err as { name?: string })?.name === "AbortError") return;
        const s = useInfoSelectionStore.getState();
        s.setError(newLayerId, "Failed to load layer");
        s.setLoading(newLayerId, false);
      });
  };

  // Load-more fetch — appends the next page to the active layer's entry.
  // Returns true if a new page was appended; false if short-circuited (Pitfall 2,
  // no entry, !hasMore, abort, etc) or if the fetch errored.
  // The Next button awaits this and advances currentIndex on success.
  const loadNextPage = async (): Promise<boolean> => {
    const store = useInfoSelectionStore.getState();
    const layerId = store.activeLayerId;
    if (layerId === null) return false;
    const cur = store.state[layerId];
    if (!cur || !cur.hasMore || cur.loading) return false;
    if (lastClickContext === null) return false;  // Pitfall 2

    const layer = eligibleLayers.find((l) => l.id === layerId);
    if (!layer) return false;
    const tableMeta = resolveTable(layer.table_id);
    if (!tableMeta) return false;

    const cfg = layer.config as Partial<MapWidgetConfig>;
    // TRACKFIX-V19-07 (GAP-54-08): thread layer.track_config as the 2nd arg so
    // buildSpatialColumns can resolve xCol/yCol for track-mode layers. track_config
    // is a top-level DashboardLayerDto column — it is NOT inside layer.config.
    const spatialColumns = buildSpatialColumns(cfg, layer.track_config);
    if (!spatialColumns) return false;

    // Resolve FROM target — fresh lookup at fetch time so a filter / dv
    // state change between pages narrows the next page to the currently-
    // displayed map state. DV-bound layers route through the dynamic view;
    // table-bound through the filter view. See resolveInfoQueryViewName.
    const resolved = resolveInfoQueryViewName(layer);
    if (resolved.kind === "skip-dv-not-materialized") {
      // DV-bound but not materialized mid-pagination (e.g. operator cleared
      // the filter between pages). Drop the Load-more attempt — the dropdown
      // will reflect over_threshold and operator can adjust.
      store.setLoading(layerId, false);
      return false;
    }

    infoQueryAbortRef.current?.abort();
    const controller = new AbortController();
    infoQueryAbortRef.current = controller;
    store.setLoading(layerId, true);

    try {
      // Phase 52: translate track→latlon at the wire boundary (InfoSpatialMode is a 3-mode union).
      const infoMode2: InfoSpatialMode =
        cfg.spatialMode === "track" ? "latlon" : (cfg.spatialMode as InfoSpatialMode);
      const res = await infoQuery(
        {
          layerId,
          tableId: layer.table_id,
          schema: tableMeta.schema,
          table: tableMeta.name,
          viewName: resolved.viewName,
          spatialMode: infoMode2,
          spatialColumns,
          clickLon: lastClickContext.clickLon,
          clickLat: lastClickContext.clickLat,
          radiusPx: lastClickContext.radiusPx,
          mapBbox: lastClickContext.mapBbox,
          mapWidthPx: lastClickContext.mapWidthPx,
          mapHeightPx: lastClickContext.mapHeightPx,
          page: cur.page + 1,
        },
        controller.signal,
      );
      if (controller.signal.aborted) return false;
      const s = useInfoSelectionStore.getState();
      s.appendPage(layerId, { rows: res.rows, page: res.page, hasMore: res.hasMore });
      s.setLoading(layerId, false);
      return res.rows.length > 0;
    } catch (err: unknown) {
      if (controller.signal.aborted) return false;
      if ((err as { name?: string })?.name === "AbortError") return false;
      const s = useInfoSelectionStore.getState();
      s.setError(layerId, "Failed to load more records");
      s.setLoading(layerId, false);
      return false;
    }
  };

  // Back: decrement currentIndex (disabled at 0 — handler also no-ops defensively).
  const handleBack = () => {
    if (activeLayerId === null || !entry) return;
    if (entry.currentIndex <= 0) return;
    useInfoSelectionStore.getState().setCurrentIndex(activeLayerId, entry.currentIndex - 1);
  };

  // Next: advance currentIndex. If at the last loaded row AND hasMore, fetch next page
  // first and advance into it once appended.
  const handleNext = async () => {
    if (activeLayerId === null || !entry) return;
    const atLastLoaded = entry.currentIndex >= entry.rows.length - 1;
    if (!atLastLoaded) {
      useInfoSelectionStore.getState().setCurrentIndex(activeLayerId, entry.currentIndex + 1);
      return;
    }
    if (!entry.hasMore || entry.loading) return;
    const indexBefore = entry.currentIndex;
    const ok = await loadNextPage();
    if (!ok) return;
    // After appendPage, advance into the first row of the newly-appended page.
    useInfoSelectionStore.getState().setCurrentIndex(activeLayerId, indexBefore + 1);
  };

  // Plan 23-03 (CARD-V14-04): default empty-state copy is the ROADMAP literal.
  // Popup wrapper overrides with "No records" (Phase 21 contract preserved).
  const empty = emptyStateCopy ?? "Click a point on the map to see details";

  if (activeLayerId === null || activeLayer === null) {
    // Card surface: render the empty placeholder so users see "Click a point on the map
    //   to see details" before any click. CARD-V14-04 requires this verbatim copy.
    // Popup surface: chrome wrapper short-circuits ABOVE this view (returns null when
    //   activeLayerId === null), so this branch only fires for the card OR when the
    //   active layer leaves eligibility (onActiveLayerIneligible runs but the popup
    //   wrapper closes before re-render — the card stays mounted and shows the empty
    //   state). For cards, returning the placeholder here is correct.
    return <div className="info-selection-empty">{empty}</div>;
  }

  const handleDropdownChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newId = Number(e.target.value);
    if (newId !== activeLayerId) handleLayerSwitch(newId);
  };

  // Single-record render: clamp currentIndex into bounds defensively (Phase 20 setSelection
  // already resets to 0; defensive clamp guards against future bugs / race with appendPage).
  const rowsLen = entry?.rows.length ?? 0;
  const clampedIndex =
    entry && rowsLen > 0
      ? Math.max(0, Math.min(entry.currentIndex, rowsLen - 1))
      : 0;
  const currentRow = entry && rowsLen > 0 ? entry.rows[clampedIndex] : null;

  // Phase 22 cross-phase lock: alphabetically sort columns BEFORE renderInfoTemplate so
  // KV-mode column order = ChipCombobox picker order. renderInfoTemplate stays order-preserving.
  const sortedColumns = entry ? [...entry.columns].sort((a, b) => a.localeCompare(b)) : [];

  // Nav state: Back disabled at first record; Next disabled at last record AND !hasMore.
  // When at last loaded record + hasMore, Next is enabled and triggers Load-more on click.
  const canBack = clampedIndex > 0;
  const atLastLoaded = entry ? clampedIndex >= rowsLen - 1 : true;
  const canNext = entry ? (!atLastLoaded || (entry.hasMore && !entry.loading)) : false;
  // "Record N of M(+)" — plus indicates more pages loadable from server.
  const totalLabel = entry
    ? `Record ${clampedIndex + 1} of ${rowsLen}${entry.hasMore ? "+" : ""}`
    : "";

  return (
    <>
      <div className="info-selection-header">
        <select
          className="info-selection-layer-select"
          value={activeLayerId}
          onChange={handleDropdownChange}
          aria-label="Select layer"
        >
          {eligibleLayers.map((l) => (
            <option key={l.id} value={l.id}>
              {layerNameFor(l)}
            </option>
          ))}
        </select>
      </div>
      <div className="info-selection-body">
        {entry?.loading && rowsLen === 0 && (
          <div className="info-selection-loading">Loading…</div>
        )}
        {entry && !entry.loading && rowsLen === 0 && !entry.error && (
          <div className="info-selection-empty">{empty}</div>
        )}
        {entry?.error && rowsLen === 0 && (
          <div className="info-selection-error">{entry.error}</div>
        )}
        {entry && currentRow !== null && (() => {
          const result = renderInfoTemplate({
            template: activeLayer.info_template,
            columns: sortedColumns,
            row: currentRow,
            infoColumns: activeLayer.info_columns,
          });
          if (result.mode === "template") {
            // NO SANITIZATION — locked at .planning/PROJECT.md Key Decision:
            // "Dashboard authors are privileged users (analogous to saved SQL queries)."
            return (
              <div
                className="info-selection-row info-selection-row-template"
                dangerouslySetInnerHTML={{ __html: result.html }}
              />
            );
          }
          return (
            <table className="info-selection-row info-selection-row-kv">
              <tbody>
                {result.pairs.map(({ col, value }) => (
                  <tr key={col}>
                    <th scope="row">{col}</th>
                    <td>{formatKvValue(value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          );
        })()}
      </div>
      {entry && rowsLen > 0 && (
        <div className="info-selection-footer">
          <button
            className="info-selection-nav-back"
            onClick={handleBack}
            disabled={!canBack || entry.loading}
            aria-label="Previous record"
          >
            ← Back
          </button>
          <span className="info-selection-nav-total" aria-live="polite">
            {entry.loading && atLastLoaded ? "Loading…" : totalLabel}
          </span>
          <button
            className="info-selection-nav-next"
            onClick={handleNext}
            disabled={!canNext || entry.loading}
            aria-label="Next record"
          >
            Next →
          </button>
        </div>
      )}
    </>
  );
}

/** kv-mode value formatter. Pure — no JSX. Coerces unknown to string for safe table cell rendering. */
function formatKvValue(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
