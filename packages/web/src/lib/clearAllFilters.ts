import { useFilterStore } from "../store/filterStore";
import { useSpatialFilterStore } from "../store/spatialFilterStore";

// Phase 109 (FCLEAR-V120-01): global clear-all. INPUT-STORE MUTATIONS ONLY.
// Loops the existing per-source clear actions over every active source, then clears
// spatial shapes. Does not build combination views or invoke the store lifecycle-wipe
// action live — the untouched useCombinationOrchestrator ref-count-based teardown handles
// the now-unused views on its own. No-op safe: empty stores => zero iterations + clearAll()
// self-no-ops.
export function clearAllFilters(): void {
  const fs = useFilterStore.getState();
  // Snapshot keys BEFORE looping — functional set() deletes must not disturb iteration.
  const tableIds = Object.keys(fs.filters);
  const dvIds = Object.keys(fs.dvFilters);

  for (const tableId of tableIds) {
    fs.clearFilters(Number(tableId));
  }
  for (const dvId of dvIds) {
    fs.clearDvFilters(Number(dvId));
  }
  useSpatialFilterStore.getState().clearAll();
}
