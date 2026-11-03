import { useAiSessionStore, selectHasUnsavedAiChanges, hasUnsavedAiChanges } from "../store/aiSessionStore";

/**
 * Single edit-lock source (D-07/D-09). True once any AI op has applied, and it STAYS true at
 * cursor -1 (Pitfall 5: reverted turns still exist). Op-less turns do not lock (D-17).
 */
export function useAiEditLock(): boolean {
  return useAiSessionStore(selectHasUnsavedAiChanges);
}

/** Non-React mirror of useAiEditLock. */
export function isAiEditLocked(): boolean {
  return hasUnsavedAiChanges();
}
