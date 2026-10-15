// 138: Revert / Forward / Discard for AI filter deltas. The session store only stores deltas and announces
// cursor moves (setAiFilterSink); the filterStore writes happen here, via the applier's guarded per-column undo/redo.
import { useAiSessionStore, setAiFilterSink } from "../../store/aiSessionStore";
import type { FilterDelta, TurnEntry } from "../aiSession/types";
import { undoFilterDeltas, redoFilterDeltas } from "./aiFilterApplier";

export function deltasOfEntries(entries: readonly TurnEntry[]): FilterDelta[] {
  return entries.flatMap((e) => e.filterDeltas ?? []);
}

/** Idempotent (assigns, never appends): StrictMode/double mount safe. */
export function installAiFilterEffects(): void {
  setAiFilterSink({
    onCursorMove(from, to, turns) {
      if (to < from) {
        for (let t = Math.min(from, turns.length - 1); t > to; t--) undoFilterDeltas(deltasOfEntries(turns[t].entries));
      } else if (to > from) {
        for (let t = from + 1; t <= to && t < turns.length; t++) redoFilterDeltas(deltasOfEntries(turns[t].entries));
      }
    },
  });
}

/**
 * D-12: undo every AI filter delta up to the cursor (incl. squashed baseEntries), newest first, then reset the session.
 * Use for Discard only; reset() alone runs on dashboard switch/logout/leave where restoring is wrong.
 */
export function discardAiSession(): void {
  const s = useAiSessionStore.getState();
  undoFilterDeltas(deltasOfEntries([...s.baseEntries, ...s.turns.slice(0, s.cursor + 1).flatMap((t) => t.entries)]));
  s.reset();
}
