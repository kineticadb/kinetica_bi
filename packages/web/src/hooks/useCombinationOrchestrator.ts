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
 * DUAL-TRIGGER (Phase 90): runs ALONGSIDE AggregatedWidgetRenderer Effect 1. Combination
 * views carry a distinct _c<hash8> suffix and are NOT read by any renderer until Phase 91/92.
 * Effect 1 in AggregatedWidgetRenderer must NOT be touched in this phase.
 *
 * combinationVersion INVARIANT: `combinationVersion` from filterCombinationStore is NEVER
 * in this hook's Effect dep array. `setEntry` bumps `combinationVersion` — if it were a dep,
 * every successful materialize would re-fire the orchestrator, causing an infinite loop.
 * The Effect deps are EXACTLY: [filterVersion, dashboardId, widgetsKey, ceiling].
 *
 * Mount site: `DashboardsPage.tsx` `DashboardOpen`, immediately after `useViewKeepAlive`.
 * Single instance per open dashboard.
 *
 * Requirements: COMBO-V118-01 (one view per unique combination; dedup + ref-count DROP)
 *               COMBO-V118-03 (ceiling enforcement + fallback + warning)
 */

import { useEffect, useMemo, useRef } from "react";

import { useFilterStore } from "../store/filterStore";
import { useFilterCombinationStore, MAX_COMBINATION_VIEWS_PER_TABLE } from "../store/filterCombinationStore";
import { useAuthStore } from "../store/auth";
import { useToastStore } from "../store/toast";
import { resolveFilterSet } from "../lib/resolveFilterSet";
import { stableComboHash, NOFILTER_SENTINEL } from "../lib/stableComboHash";
import { materializeFilter, dropCombinationView } from "../api/client";
import type { WidgetDto } from "../api/client";
import type { FilterSelectionConfig } from "../types/filterSelection";

// ---------------------------------------------------------------------------
// Non-trigger widget types — COPIED from useMapOnlySpatialMaterialize.ts:43.
// Do NOT import to avoid circular-dep risk. Extend with "radiogroup" and "calendar"
// which WidgetRenderer dispatch never routes to AggregatedWidgetRenderer.
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
 */
export function useCombinationOrchestrator(
  dashboardId: number,
  widgets: WidgetDto[],
): void {
  // --- 1. Primitive subscriptions (S-02 compliant — primitives only) ---
  const filterVersion = useFilterStore((s) => s.filterVersion);
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
  // CRITICAL: deps = [filterVersion, dashboardId, widgetsKey, ceiling].
  // combinationVersion is intentionally EXCLUDED — it bumps on every setEntry and
  // would cause this effect to re-fire after each materialize, creating an infinite loop.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const timer = setTimeout(async () => {
      // ----------------------------------------------------------------
      // STEP A — Enumerate trigger widgets, resolve filter sets, hash
      // Read live state via getState() — NOT subscriptions (S-02).
      // ----------------------------------------------------------------
      const filterState = useFilterStore.getState();

      // Map<tableId, Map<hash, { resolved: ActiveFilter[]; widgetIds: number[] }>>
      type HashEntry = { resolved: ReturnType<typeof resolveFilterSet>; widgetIds: number[] };
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
        const hash = stableComboHash("table", tableId, resolved);

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
          e = { resolved, widgetIds: [] };
          hm.set(hash, e);
        }
        e.widgetIds.push(w.id);
        vizKeyToHash.set(`w:${w.id}`, hash);
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
          hashMap.delete(hash);
        }

        // Add fallback hash to hashMap if not NOFILTER and not already present
        if (!fallbackIsNoFilter) {
          const existing = hashMap.get(fallbackHash);
          if (!existing) {
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
            hashMap.set(fallbackHash, { resolved: allFilters, widgetIds: remappedWidgetIds });
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
      // Map<hash, { tableId, resolved }>
      type DesiredEntry = { tableId: number; resolved: ReturnType<typeof resolveFilterSet> };
      const desired = new Map<string, DesiredEntry>();
      for (const [tableId, hashMap] of byTable) {
        for (const [hash, entry] of hashMap) {
          if (!hash.endsWith(`:${NOFILTER_SENTINEL}`)) {
            desired.set(hash, { tableId, resolved: entry.resolved });
          }
        }
      }

      // ----------------------------------------------------------------
      // STEP D — Diff vs current registry + dispatch
      // ----------------------------------------------------------------
      const current = useFilterCombinationStore.getState().registry;
      const storeActions = useFilterCombinationStore.getState();

      for (const [hash, { tableId, resolved }] of desired) {
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

        // Call markMaterializing SYNCHRONOUSLY before any await (Pitfall 6 dedup guard).
        storeActions.markMaterializing(hash, dashboardId, "table", tableId);

        // Set up AbortController for this hash (abort any prior in-flight)
        controllersRef.current.get(hash)?.abort();
        const ctrl = new AbortController();
        controllersRef.current.set(hash, ctrl);

        // Fire the POST (non-blocking — we don't await here; each call resolves independently)
        materializeFilter(
          { dashboardId, tableId, filters: resolved, combinationKey: hash },
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
              sourceId: tableId,
            });
          })
          .catch((err) => {
            if ((err as Error)?.name === "AbortError") return;
            if (ctrl.signal.aborted) return;
            // Clear the placeholder so a retry can re-fire
            useFilterCombinationStore.getState().clearEntry(hash);
          });
      }

      // ----------------------------------------------------------------
      // STEP E — Sync vizToHash + ref-counts
      // The authoritative bind step: update each viz's hash binding and
      // adjust ref-counts for hash changes. Also handle widgets that left
      // the dashboard (not present in this tick's widget set).
      // ----------------------------------------------------------------
      const prevVizToHash = useFilterCombinationStore.getState().vizToHash;

      // Build set of vizKeys present in this tick's widget set
      const currentVizKeys = new Set<string>();
      for (const w of widgets) {
        currentVizKeys.add(`w:${w.id}`);
      }

      // Handle widgets that LEFT the dashboard (in store but not in this tick's widgets)
      for (const vizKey of Object.keys(prevVizToHash)) {
        if (!vizKey.startsWith("w:")) continue;
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
      // (e.g., widget became dv-bound or non-trigger this tick)
      for (const vizKey of Object.keys(prevVizToHash)) {
        if (!vizKey.startsWith("w:")) continue;
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
  }, [filterVersion, dashboardId, widgetsKey, ceiling]);
}
