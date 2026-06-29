/**
 * Phase 90 (COMBO-V118-01 / COMBO-V118-03): Dashboard-level combination-view orchestrator.
 *
 * This is the SOLE owner of combination-view materializations for the dashboard.
 * On each `filterVersion` tick it enumerates in-scope (table-bound, trigger-type) widgets,
 * resolves each widget's filter set via `resolveFilterSet`, hashes via `stableComboHash`,
 * builds the unique desired registry, diffs it against `filterCombinationStore.registry`,
 * fires exactly ONE POST per NEW unique combination (via `materializeFilter` with
 * `combinationKey`), ref-counts via acquire/release, DROPs combos that drop to refCount 0,
 * and enforces the per-table ceiling (from auth store, set by /api/me from the
 * MAX_COMBINATION_VIEWS_PER_TABLE env var) with fallback to the all-filters view + one
 * "info" toast per table per tick.
 *
 * Phase 94 (FSCOPE-V118-03): also enumerates dv-bound widgets + layers, hashes with
 * stableComboHash("dv", dvId, resolved) (COLUMN-ONLY — no spatial 4th arg; server rejects
 * spatial on dv path with 400). The orchestrator is the SOLE materialize trigger for the
 * dv combination path; WidgetRenderer Effect 1 dv-branch is REMOVED (Phase 94).
 *
 * combinationVersion INVARIANT: `combinationVersion` from filterCombinationStore is NEVER
 * in this hook's Effect dep array. `setEntry` bumps `combinationVersion` — if it were a dep,
 * every successful materialize would re-fire the orchestrator, causing an infinite loop.
 * The Effect deps are EXACTLY:
 *   [filterVersion, spatialFilterVersion, dynamicViewVersion, dashboardId,
 *    widgetsKey, layersKey, dvWidgetsKey, dvLayersKey, ceiling].
 *
 * dynamicViewVersion SAFETY: bumps ONLY on dv materialize events (markPending/setView/
 * setError/clearView — inside useDynamicViewMaterializeChain). NEVER called by the
 * orchestrator or filterCombinationStore.setEntry → no feedback loop. Safe dep.
 *
 * Mount site: `DashboardsPage.tsx` `DashboardOpen`, immediately after `useViewKeepAlive`.
 * Single instance per open dashboard.
 *
 * Requirements: COMBO-V118-01 (one view per unique combination; dedup + ref-count DROP)
 *               COMBO-V118-03 (ceiling enforcement + fallback + warning)
 *               FSCOPE-V118-03 (dv-bound widgets + layers — Phase 94)
 */

import { useEffect, useMemo, useRef } from "react";

import { useFilterStore } from "../store/filterStore";
import { useFilterCombinationStore, MAX_COMBINATION_VIEWS_PER_TABLE } from "../store/filterCombinationStore";
import { useAuthStore } from "../store/auth";
import { useToastStore } from "../store/toast";
import { resolveFilterSet } from "../lib/resolveFilterSet";
import { resolveSpatialShapes } from "../lib/resolveSpatialShapes";
import { stableComboHash, NOFILTER_SENTINEL } from "../lib/stableComboHash";
import { aggregateSpatialTargetsByTable } from "../lib/spatialTargets";
import { useSpatialFilterStore } from "../store/spatialFilterStore";
import { useDynamicViewStore } from "../store/dynamicViewStore";
import { materializeFilter, dropCombinationView } from "../api/client";
import type { WidgetDto, DashboardLayerDto } from "../api/client";
import type { FilterSelectionConfig } from "../types/filterSelection";
import type { Shape } from "../store/spatialFilterStore";
import type { SpatialTarget } from "../lib/spatialTargets";

// ---------------------------------------------------------------------------
// Non-trigger widget types — AUTHORITATIVE source (Phase 93.5-02 removed the prior
// map-only hook; this set is the sole canonical definition).
// Do NOT import to avoid circular-dep risk. Extend with "radiogroup", "calendar",
// and "records" which are never routed through AggregatedWidgetRenderer:
//   - "radiogroup", "calendar" — WidgetRenderer dispatch never routes to AWR.
//   - "records" — RecordsTableRenderer is its OWN renderer; reads filterViewStore
//     (not combo store) and runs its own legacy spatial materialize trigger. Adding
//     records here stops the orchestrator from minting an orphan combo view that
//     no renderer consumes. Records remains a self-contained legacy island.
//     NOTE: "table" is intentionally NOT in this set — widget.type "table"
//     (TableRenderer) is rendered INSIDE AggregatedWidgetRenderer and correctly
//     reads the combo store.
// ---------------------------------------------------------------------------
const NON_TRIGGER_TYPES = new Set([
  "map",
  "info-card",
  "legend",
  "datafilter",
  "timeline",
  "numericline",
  "radiogroup",
  "calendar",
  // Phase 96-01 GAP 2: "records" removed — RecordsTableRenderer is now a pure combo-store
  // consumer; useCombinationOrchestrator is the sole materialize trigger for records widgets too.
]);

const isTriggerType = (t: string) => !NON_TRIGGER_TYPES.has(t);

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Dashboard-level orchestrator: materializes one Kinetica view per UNIQUE resolved
 * filter combination, ref-counts them, and enforces the per-table ceiling.
 *
 * @param dashboardId - The currently-open dashboard id.
 * @param widgets     - All widgets on the dashboard (synced from DashboardOpen state).
 * @param layers      - All layers on the dashboard (Phase 92 — table-bound layers enumerated alongside widgets).
 */
export function useCombinationOrchestrator(
  dashboardId: number,
  widgets: WidgetDto[],
  layers: DashboardLayerDto[],   // NEW — Phase 92 (READ-V118-02)
): void {
  // --- 1. Primitive subscriptions (S-02 compliant — primitives only) ---
  const filterVersion = useFilterStore((s) => s.filterVersion);
  // spatialFilterVersion bumps ONLY on draw/remove/clear (NOT on setEntry) → safe, no loop
  // (same reasoning as filterVersion; combinationVersion remains EXCLUDED).
  const spatialFilterVersion = useSpatialFilterStore((s) => s.spatialFilterVersion);
  // Phase 94 (FSCOPE-V118-03): dynamicViewVersion bumps ONLY on dv materialize events
  // (markPending/setView/setError/clearView in useDynamicViewMaterializeChain). NEVER
  // called by the orchestrator or filterCombinationStore.setEntry → no feedback loop.
  // Needed so the orchestrator re-fires when a dv materializes AFTER the last filterVersion
  // bump (the dv-materializes-after-last-filter edge case). Safe dep.
  const dynamicViewVersion = useDynamicViewStore((s) => s.dynamicViewVersion);
  // Read ceiling from auth store (set by /api/me from MAX_COMBINATION_VIEWS_PER_TABLE env var).
  // Falls back to the web-side constant if the field is not yet set.
  const ceiling =
    useAuthStore((s) => s.maxCombinationViewsPerTable) ?? MAX_COMBINATION_VIEWS_PER_TABLE;

  // --- 2. Stable primitive key for widgets (Pitfall 5 — don't use widgets[] directly) ---
  const widgetsKey = useMemo(
    () =>
      widgets
        .filter(
          (w) =>
            isTriggerType(w.type) &&
            (w.config.tableId as number | undefined) !== undefined,
        )
        .map((w) => `${w.id}:${w.config.tableId}`)
        .sort()
        .join(","),
    [widgets],
  );

  // --- 2b. Stable primitive key for table-bound layers (Phase 92 — S-02 compliant) ---
  const layersKey = useMemo(
    () =>
      layers
        .filter((l) => l.dynamic_view_id === null || l.dynamic_view_id === undefined)
        .map((l) => `${l.id}:${l.table_id}`)
        .sort()
        .join(","),
    [layers],
  );

  // --- 2c. Phase 94: Stable primitive keys for dv-bound trigger widgets + layers ---
  // (S-02 compliant — joined primitive strings, NOT widget/layer arrays)
  const dvWidgetsKey = useMemo(
    () =>
      widgets
        .filter((w) => isTriggerType(w.type) && typeof w.config.dynamicViewId === "number")
        .map((w) => `dv:${w.config.dynamicViewId as number}:${w.id}`)
        .sort()
        .join(","),
    [widgets],
  );

  const dvLayersKey = useMemo(
    () =>
      layers
        .filter((l) => l.dynamic_view_id !== null && l.dynamic_view_id !== undefined)
        .map((l) => `dv:${l.dynamic_view_id!}:${l.id}`)
        .sort()
        .join(","),
    [layers],
  );

  // --- 3. AbortController-per-hash Map (cross-hash isolation; survives re-renders) ---
  const controllersRef = useRef<Map<string, AbortController>>(new Map());

  // --- 4. Unmount cleanup: abort all in-flight materialize calls ---
  useEffect(
    () => () => {
      controllersRef.current.forEach((c) => c.abort());
      controllersRef.current.clear();
    },
    [],
  );

  // --- 5. Main orchestration effect ---
  // CRITICAL deps = [filterVersion, spatialFilterVersion, dynamicViewVersion, dashboardId,
  //                  widgetsKey, layersKey, dvWidgetsKey, dvLayersKey, ceiling].
  // combinationVersion is intentionally EXCLUDED — it bumps on every setEntry and
  // would cause this effect to re-fire after each materialize, creating an infinite loop.
  // spatialFilterVersion bumps ONLY on draw/remove/clear (NOT on setEntry) → safe, no loop.
  // dynamicViewVersion bumps ONLY on dv materialize events → safe, no loop (Phase 94).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const timer = setTimeout(async () => {
      // ----------------------------------------------------------------
      // STEP A — Enumerate trigger widgets, resolve filter sets, hash
      // Read live state via getState() — NOT subscriptions (S-02).
      // ----------------------------------------------------------------
      const filterState = useFilterStore.getState();
      // Shapes read imperatively — avoids stale closure + re-render storm.
      const shapes = useSpatialFilterStore.getState().shapes;
      // Build per-table spatial targets once (pure, synchronous).
      const targetsByTable = aggregateSpatialTargetsByTable(widgets);
      // Phase 96-01 GAP 3: read dvFilterScopeDisabled imperatively (S-02 pattern).
      // When true, treat ALL dv-bound vizs as accept-all (ignore saved filterSelection / filter_scope).
      const dvScopeDisabled = useAuthStore.getState().dvFilterScopeDisabled;

      // Map<tableId, Map<hash, { resolved: ActiveFilter[]; widgetIds: number[]; acceptedShapes: Shape[]; spatialTarget?: SpatialTarget }>>
      type HashEntry = { resolved: ReturnType<typeof resolveFilterSet>; widgetIds: number[]; acceptedShapes: Shape[]; spatialTarget?: SpatialTarget };
      const byTable = new Map<number, Map<string, HashEntry>>();

      // vizKey ("w:<widgetId>") → hash | undefined (undefined = NOFILTER)
      const vizKeyToHash = new Map<string, string | undefined>();

      for (const w of widgets) {
        if (!isTriggerType(w.type)) continue;
        const tableId = w.config.tableId as number | undefined;
        if (tableId === undefined) continue; // dv-bound = Phase 94 scope

        const cfg = w.config.filterSelection as FilterSelectionConfig | undefined;
        const allFilters = (filterState.filters[tableId] ?? []) as ReturnType<typeof resolveFilterSet>;
        const resolved = resolveFilterSet(cfg, allFilters);
        const acceptedShapes = resolveSpatialShapes(cfg, shapes);
        const spatialTarget = targetsByTable.get(tableId);
        // Pitfall 1 guard: only fold spatial into hash when an eligible target exists AND
        // accepted shapes are non-empty. Without an eligible target, the hash must stay
        // column-only so all vizs on that table share the same (column-only) dedup hash.
        const shapesForHash = (spatialTarget && acceptedShapes.length > 0) ? acceptedShapes : [];
        const hash = stableComboHash("table", tableId, resolved, shapesForHash);

        if (hash.endsWith(`:${NOFILTER_SENTINEL}`)) {
          vizKeyToHash.set(`w:${w.id}`, undefined);
          continue;
        }

        let hm = byTable.get(tableId);
        if (!hm) {
          hm = new Map<string, HashEntry>();
          byTable.set(tableId, hm);
        }
        let e = hm.get(hash);
        if (!e) {
          e = { resolved, widgetIds: [], acceptedShapes: shapesForHash, spatialTarget };
          hm.set(hash, e);
        }
        e.widgetIds.push(w.id);
        vizKeyToHash.set(`w:${w.id}`, hash);
      }

      // Phase 92 (READ-V118-02): enumerate table-bound map layers alongside widgets.
      // dv-bound layers (dynamic_view_id !== null) are handled in the dv loop below.
      // widgetIds in HashEntry now also stores layer ids (internal; not renamed to avoid churn).
      for (const layer of layers) {
        if (layer.dynamic_view_id !== null && layer.dynamic_view_id !== undefined) continue;
        const tableId = layer.table_id;
        // filter_scope is a TOP-LEVEL field (threaded like track_config). Undefined until Phase 93
        // config UI + persistence lands → resolveFilterSet(undefined, ...) = accept-all = byte-identical to v1.17.
        const cfg = layer.filter_scope ?? undefined;
        const allFilters = (filterState.filters[tableId] ?? []) as ReturnType<typeof resolveFilterSet>;
        const resolved = resolveFilterSet(cfg, allFilters);
        const acceptedShapes = resolveSpatialShapes(cfg, shapes);
        const spatialTarget = targetsByTable.get(tableId);
        // Pitfall 1 guard: only fold spatial when eligible target exists AND shapes accepted.
        const shapesForHash = (spatialTarget && acceptedShapes.length > 0) ? acceptedShapes : [];
        const hash = stableComboHash("table", tableId, resolved, shapesForHash);
        if (hash.endsWith(`:${NOFILTER_SENTINEL}`)) {
          vizKeyToHash.set(`l:${layer.id}`, undefined);
          continue;
        }
        let hm = byTable.get(tableId);
        if (!hm) { hm = new Map<string, HashEntry>(); byTable.set(tableId, hm); }
        let e = hm.get(hash);
        if (!e) { e = { resolved, widgetIds: [], acceptedShapes: shapesForHash, spatialTarget }; hm.set(hash, e); }
        e.widgetIds.push(layer.id);   // widgetIds holds widget AND layer ids (internal; not renamed)
        vizKeyToHash.set(`l:${layer.id}`, hash);
      }

      // ----------------------------------------------------------------
      // Phase 94 (FSCOPE-V118-03): enumerate dv-bound trigger widgets + layers.
      // dv path is COLUMN-ONLY — resolveSpatialShapes / aggregateSpatialTargetsByTable
      // are NOT called for dv vizs (server rejects spatial on dv path with 400).
      // No ceiling for dv path — naturally bounded by dvFilters length which is capped
      // by FILTER_CAP_PER_TABLE; see 94-RESEARCH §STEP B.
      // ----------------------------------------------------------------
      // DvHashEntry: no spatial fields (dv is column-only)
      type DvHashEntry = { resolved: ReturnType<typeof resolveFilterSet>; vizIds: string[] };
      const byDv = new Map<number, Map<string, DvHashEntry>>();

      // --- dv-bound trigger widgets ---
      for (const w of widgets) {
        if (!isTriggerType(w.type)) continue;
        const dvId = w.config.dynamicViewId as number | undefined;
        if (dvId === undefined) continue; // table-bound handled above

        // Gate: dv must be fully materialized before we can query off it.
        // Pitfall 5 — imperative getState() inside setTimeout (same as shapes read).
        if (useDynamicViewStore.getState().views[dvId]?.status !== "materialized") continue;

        // Phase 96-01 GAP 3: when dvScopeDisabled, treat as accept-all (cfg=undefined → resolveFilterSet returns all dvFilters).
        const cfg = dvScopeDisabled ? undefined : (w.config.filterSelection as FilterSelectionConfig | undefined);
        // dvFilters keyed by dvId — imperative read (Pitfall 4 — never subscribe to dvFilters array)
        const dvFilters = (filterState.dvFilters[dvId] ?? []) as ReturnType<typeof resolveFilterSet>;
        const resolved = resolveFilterSet(cfg, dvFilters);
        // NO 4th shapes arg — dv + spatial is server-rejected 400 (94-RESEARCH §"dv + Spatial Deferred Boundary")
        const hash = stableComboHash("dv", dvId, resolved);

        if (hash.endsWith(`:${NOFILTER_SENTINEL}`)) {
          // Case C: no dv filters → no combo entry; fall back to raw dv view
          vizKeyToHash.set(`w:${w.id}`, undefined);
          continue;
        }

        let hm = byDv.get(dvId);
        if (!hm) { hm = new Map<string, DvHashEntry>(); byDv.set(dvId, hm); }
        let e = hm.get(hash);
        if (!e) { e = { resolved, vizIds: [] }; hm.set(hash, e); }
        e.vizIds.push(`w:${w.id}`);
        vizKeyToHash.set(`w:${w.id}`, hash);
      }

      // --- dv-bound layers ---
      for (const layer of layers) {
        const dvId = layer.dynamic_view_id;
        if (dvId === null || dvId === undefined) continue; // table-bound handled above

        // Gate: dv must be fully materialized
        if (useDynamicViewStore.getState().views[dvId]?.status !== "materialized") continue;

        // Phase 96-01 GAP 3: when dvScopeDisabled, treat layer as accept-all (cfg=undefined).
        const cfg = dvScopeDisabled ? undefined : (layer.filter_scope ?? undefined);
        const dvFilters = (filterState.dvFilters[dvId] ?? []) as ReturnType<typeof resolveFilterSet>;
        const resolved = resolveFilterSet(cfg, dvFilters);
        // NO spatial — dv path is column-only
        const hash = stableComboHash("dv", dvId, resolved);

        if (hash.endsWith(`:${NOFILTER_SENTINEL}`)) {
          vizKeyToHash.set(`l:${layer.id}`, undefined);
          continue;
        }

        let hm = byDv.get(dvId);
        if (!hm) { hm = new Map<string, DvHashEntry>(); byDv.set(dvId, hm); }
        let e = hm.get(hash);
        if (!e) { e = { resolved, vizIds: [] }; hm.set(hash, e); }
        e.vizIds.push(`l:${layer.id}`);
        vizKeyToHash.set(`l:${layer.id}`, hash);
      }

      // ----------------------------------------------------------------
      // STEP B — Ceiling enforcement per table (COMBO-V118-03)
      // ----------------------------------------------------------------
      const storeSnapshot = useFilterCombinationStore.getState();

      for (const [tableId, hashMap] of byTable) {
        if (hashMap.size <= ceiling) continue;

        // Sort hashes by existing refCount DESC (shared views first),
        // tie-break by lowest widgetId for determinism.
        const sorted = [...hashMap.entries()].sort(([hA, eA], [hB, eB]) => {
          const rcA = storeSnapshot.registry[hA]?.refCount ?? 0;
          const rcB = storeSnapshot.registry[hB]?.refCount ?? 0;
          if (rcB !== rcA) return rcB - rcA;
          // tie-break: lowest widgetId
          const minA = Math.min(...eA.widgetIds);
          const minB = Math.min(...eB.widgetIds);
          return minA - minB;
        });

        // Keep top (ceiling - 1) hashes; reserve one slot for the fallback
        const keep = new Set(
          sorted.slice(0, ceiling - 1).map(([h]) => h),
        );

        // Fallback = all-filters view for this table
        const allFilters = filterState.filters[tableId] ?? [];
        const fallbackHash = stableComboHash("table", tableId, allFilters);
        const fallbackIsNoFilter = fallbackHash.endsWith(`:${NOFILTER_SENTINEL}`);

        // Collect the set of hashes that remain valid (kept + fallback)
        const removedHashes: string[] = [];

        // Remap over-ceiling widgets
        for (const [hash, entry] of sorted.slice(ceiling - 1)) {
          if (keep.has(hash)) continue; // within the kept set, skip
          // This hash is over-ceiling: remap each of its widgets to the fallback
          for (const wid of entry.widgetIds) {
            const vizKey = `w:${wid}`;
            if (fallbackIsNoFilter) {
              vizKeyToHash.set(vizKey, undefined);
            } else {
              vizKeyToHash.set(vizKey, fallbackHash);
            }
          }
          removedHashes.push(hash);
          hashMap.delete(hash);
        }

        // Phase 96-01 GAP 1 — ORPHAN FIX: after remap, clear any removed hash that is still
        // sitting in the registry as materializing:true with no active controller and no viz
        // still bound to it. Without this, those entries never resolve → permanent spinner.
        for (const removedHash of removedHashes) {
          const regEntry = useFilterCombinationStore.getState().registry[removedHash];
          if (!regEntry) continue;
          if (!regEntry.materializing) continue;
          // No controller = no in-flight POST → stale placeholder; clear it.
          if (controllersRef.current.has(removedHash)) continue;
          // Confirm no viz is still bound to this hash (belt-and-suspenders)
          const stillBound = [...vizKeyToHash.values()].some((h) => h === removedHash);
          if (stillBound) continue;
          useFilterCombinationStore.getState().clearEntry(removedHash);
        }

        // Add fallback hash to hashMap if not NOFILTER and not already present.
        // Fallback (ceiling) is always column-only — acceptedShapes:[] spatialTarget:undefined.
        // This is intentional: the fallback drops per-viz customization including spatial.
        if (!fallbackIsNoFilter) {
          const existing = hashMap.get(fallbackHash);
          if (!existing) {
            // Phase 96-01 GAP 1 — FALLBACK PLACEHOLDER FIX: if the fallback hash already has
            // a stale materializing:true placeholder from a prior tick (with no controller),
            // clear it now so STEP D fires a fresh POST rather than skipping it.
            const fallbackReg = useFilterCombinationStore.getState().registry[fallbackHash];
            if (fallbackReg?.materializing && !controllersRef.current.has(fallbackHash)) {
              useFilterCombinationStore.getState().clearEntry(fallbackHash);
            }

            // Gather all widgetIds that were remapped to this fallback
            const remappedWidgetIds: number[] = [];
            for (const [vizKey, h] of vizKeyToHash) {
              if (h === fallbackHash && vizKey.startsWith("w:")) {
                const wid = parseInt(vizKey.slice(2), 10);
                // Only include if it's part of this table's widgets
                const w = widgets.find((x) => x.id === wid);
                if (w && (w.config.tableId as number | undefined) === tableId) {
                  remappedWidgetIds.push(wid);
                }
              }
            }
            hashMap.set(fallbackHash, { resolved: allFilters, widgetIds: remappedWidgetIds, acceptedShapes: [], spatialTarget: undefined });
          } else {
            // Add any remapped widgetIds to existing fallback entry
            for (const [vizKey, h] of vizKeyToHash) {
              if (h === fallbackHash && vizKey.startsWith("w:")) {
                const wid = parseInt(vizKey.slice(2), 10);
                if (!existing.widgetIds.includes(wid)) {
                  existing.widgetIds.push(wid);
                }
              }
            }
          }
        }

        // Fire ONE toast per table that hit the ceiling
        useToastStore.getState().showToast(
          `Filter combinations for this table exceed the limit (${ceiling}). Some widgets use the full filter view.`,
          "info",
        );
      }

      // ----------------------------------------------------------------
      // STEP C — Build desired hash set (post-ceiling)
      // ----------------------------------------------------------------
      // Phase 94: DesiredEntry extended with optional dvId + sourceType discriminator.
      // table entries: sourceType "table", dvId undefined.
      // dv entries: sourceType "dv", tableId undefined (acceptedShapes/spatialTarget empty).
      type DesiredEntry = {
        tableId?: number;
        dvId?: number;
        sourceType: "table" | "dv";
        resolved: ReturnType<typeof resolveFilterSet>;
        acceptedShapes: Shape[];
        spatialTarget?: SpatialTarget;
      };
      const desired = new Map<string, DesiredEntry>();

      // Table-bound entries (post-ceiling)
      for (const [tableId, hashMap] of byTable) {
        for (const [hash, entry] of hashMap) {
          if (!hash.endsWith(`:${NOFILTER_SENTINEL}`)) {
            desired.set(hash, { tableId, sourceType: "table", resolved: entry.resolved, acceptedShapes: entry.acceptedShapes, spatialTarget: entry.spatialTarget });
          }
        }
      }

      // Phase 94: dv-bound entries (no ceiling — see comment at STEP A dv loop)
      for (const [dvId, hashMap] of byDv) {
        for (const [hash, entry] of hashMap) {
          if (!hash.endsWith(`:${NOFILTER_SENTINEL}`)) {
            desired.set(hash, { dvId, sourceType: "dv", resolved: entry.resolved, acceptedShapes: [], spatialTarget: undefined });
          }
        }
      }

      // ----------------------------------------------------------------
      // STEP D — Diff vs current registry + dispatch
      // ----------------------------------------------------------------
      const storeActions = useFilterCombinationStore.getState();

      for (const [hash, desiredEntry] of desired) {
        const { sourceType, tableId, dvId, resolved, acceptedShapes, spatialTarget } = desiredEntry;

        // Guard: never process NOFILTER (belt-and-suspenders)
        if (hash.endsWith(`:${NOFILTER_SENTINEL}`)) continue;

        // Check if already in registry (re-check live state right before markMaterializing)
        const liveEntry = useFilterCombinationStore.getState().registry[hash];

        if (liveEntry) {
          // REUSE: entry exists (materialized or in-flight). Ref-counting is handled by
          // STEP E's per-vizKey change detection — do not double-acquire here.
          continue;
        }

        // NEW: fire POST — but first check for in-flight dedup
        const liveCheck = useFilterCombinationStore.getState().registry[hash];
        if (liveCheck?.materializing) {
          // A prior tick is already in flight — skip
          continue;
        }

        if (sourceType === "table") {
          // ── Table path ────────────────────────────────────────────────
          // Call markMaterializing SYNCHRONOUSLY before any await (Pitfall 6 dedup guard).
          storeActions.markMaterializing(hash, dashboardId, "table", tableId!);

          // Set up AbortController for this hash (abort any prior in-flight)
          controllersRef.current.get(hash)?.abort();
          const ctrl = new AbortController();
          controllersRef.current.set(hash, ctrl);

          // Build spatial args — only when accepted shapes are non-empty AND an eligible target exists.
          const spatialArgs = (acceptedShapes.length > 0 && spatialTarget)
            ? {
                spatialFilters: acceptedShapes.map((s) => ({ id: s.id, wkt: s.wkt })),
                spatialTarget,
              }
            : {};

          // Fire the POST (non-blocking — we don't await here; each call resolves independently)
          materializeFilter(
            { dashboardId, tableId: tableId!, filters: resolved, combinationKey: hash, ...spatialArgs },
            ctrl.signal,
          )
            .then((res) => {
              if (ctrl.signal.aborted) return;
              useFilterCombinationStore.getState().setEntry(hash, {
                viewName: res.viewName,
                expiresAt: res.expiresAt,
                materializing: false,
                materializeVersion: 0,
                refCount: useFilterCombinationStore.getState().registry[hash]?.refCount ?? 0,
                dashboardId,
                sourceType: "table",
                sourceId: tableId!,
              });
            })
            .catch((err) => {
              if ((err as Error)?.name === "AbortError") return;
              if (ctrl.signal.aborted) return;
              // Clear the placeholder so a retry can re-fire
              useFilterCombinationStore.getState().clearEntry(hash);
            });
        } else {
          // ── Phase 94: dv path ──────────────────────────────────────────
          // NO spatial args — dv path is column-only (server enforces 400 on spatial + dvId).
          // Pitfall 6: markMaterializing SYNCHRONOUSLY before any await.
          storeActions.markMaterializing(hash, dashboardId, "dv", dvId!);

          controllersRef.current.get(hash)?.abort();
          const ctrl = new AbortController();
          controllersRef.current.set(hash, ctrl);

          materializeFilter(
            { dashboardId, dynamicViewId: dvId!, filters: resolved, combinationKey: hash },
            ctrl.signal,
          )
            .then((res) => {
              if (ctrl.signal.aborted) return;
              useFilterCombinationStore.getState().setEntry(hash, {
                viewName: res.viewName,
                expiresAt: res.expiresAt,
                materializing: false,
                materializeVersion: 0,
                refCount: useFilterCombinationStore.getState().registry[hash]?.refCount ?? 0,
                dashboardId,
                sourceType: "dv",
                sourceId: dvId!,
              });
            })
            .catch((err) => {
              if ((err as Error)?.name === "AbortError") return;
              if (ctrl.signal.aborted) return;
              useFilterCombinationStore.getState().clearEntry(hash);
            });
        }
      }

      // ----------------------------------------------------------------
      // STEP E — Sync vizToHash + ref-counts
      // The authoritative bind step: update each viz's hash binding and
      // adjust ref-counts for hash changes. Also handle widgets that left
      // the dashboard (not present in this tick's widget set).
      // ----------------------------------------------------------------
      const prevVizToHash = useFilterCombinationStore.getState().vizToHash;

      // Build set of vizKeys present in this tick's widget + layer set
      const currentVizKeys = new Set<string>();
      for (const w of widgets) {
        currentVizKeys.add(`w:${w.id}`);
      }
      // Phase 94: include ALL layers (table-bound AND dv-bound) so dv-bound `l:<id>` keys are
      // tracked for release-on-removal. Previously dv-bound layers were skipped here.
      for (const layer of layers) {
        currentVizKeys.add(`l:${layer.id}`);
      }

      // Handle widgets/layers that LEFT the dashboard (in store but not in this tick's set)
      for (const vizKey of Object.keys(prevVizToHash)) {
        if (!vizKey.startsWith("w:") && !vizKey.startsWith("l:")) continue;
        if (currentVizKeys.has(vizKey)) continue;
        // Widget removed from dashboard
        const oldHash = prevVizToHash[vizKey];
        if (oldHash && !oldHash.endsWith(`:${NOFILTER_SENTINEL}`)) {
          // Capture viewName BEFORE release (entry may be gone after DROP-at-0)
          const oldEntry = useFilterCombinationStore.getState().registry[oldHash];
          const oldViewName = oldEntry?.viewName;
          useFilterCombinationStore.getState().release(oldHash);
          // Check if DROP-at-0 occurred
          if (!useFilterCombinationStore.getState().registry[oldHash]) {
            if (oldViewName) {
              dropCombinationView({ dashboardId, viewName: oldViewName }).catch(() => {});
            }
          }
        }
        useFilterCombinationStore.getState().setVizHash(vizKey, undefined);
      }

      // Process each widget's new hash binding
      for (const [vizKey, newHash] of vizKeyToHash) {
        const oldHash = prevVizToHash[vizKey];

        if (oldHash === newHash) {
          // No change — nothing to do
          continue;
        }

        // Hash changed: release old, acquire new
        if (oldHash && !oldHash.endsWith(`:${NOFILTER_SENTINEL}`)) {
          // Capture viewName BEFORE release (entry may be gone after DROP-at-0)
          const oldEntry = useFilterCombinationStore.getState().registry[oldHash];
          const oldViewName = oldEntry?.viewName;
          useFilterCombinationStore.getState().release(oldHash);
          // Check if DROP-at-0 occurred (Pitfall 3)
          if (!useFilterCombinationStore.getState().registry[oldHash]) {
            if (oldViewName) {
              dropCombinationView({ dashboardId, viewName: oldViewName }).catch(() => {});
            }
          }
        }

        if (newHash && !newHash.endsWith(`:${NOFILTER_SENTINEL}`)) {
          useFilterCombinationStore.getState().acquire(newHash);
        }

        useFilterCombinationStore.getState().setVizHash(vizKey, newHash);
      }

      // Handle vizKeys that were previously set but are no longer in vizKeyToHash
      // (e.g., widget became dv-bound or non-trigger this tick, or layer became dv-bound)
      for (const vizKey of Object.keys(prevVizToHash)) {
        if (!vizKey.startsWith("w:") && !vizKey.startsWith("l:")) continue;
        if (!currentVizKeys.has(vizKey)) continue; // already handled above
        if (vizKeyToHash.has(vizKey)) continue;    // handled in the loop above

        // Widget is still on dashboard but no longer mapped (e.g. became non-trigger)
        const oldHash = prevVizToHash[vizKey];
        if (oldHash && !oldHash.endsWith(`:${NOFILTER_SENTINEL}`)) {
          const oldEntry = useFilterCombinationStore.getState().registry[oldHash];
          const oldViewName = oldEntry?.viewName;
          useFilterCombinationStore.getState().release(oldHash);
          if (!useFilterCombinationStore.getState().registry[oldHash]) {
            if (oldViewName) {
              dropCombinationView({ dashboardId, viewName: oldViewName }).catch(() => {});
            }
          }
        }
        useFilterCombinationStore.getState().setVizHash(vizKey, undefined);
      }
    }, 300);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterVersion, spatialFilterVersion, dynamicViewVersion, dashboardId, widgetsKey, layersKey, dvWidgetsKey, dvLayersKey, ceiling]);
}
