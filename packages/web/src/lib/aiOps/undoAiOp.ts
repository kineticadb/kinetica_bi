// 151: the ONE entry point for per-step undo/redo (UI calls these, never the store action). Store first (atomic derived), filter writes after.
import { useAiSessionStore } from "../../store/aiSessionStore";
import { isFilterOp } from "../aiSession/foldSession";
import { AI_UNDO_COPY } from "../aiSession/chatText";
import { flattenLive, planRedo, revalidateRedo, describeRedoBlock, refKey } from "../aiSession/undoPlan";
import type { EntryRef, FilterDelta, SessionBaseline } from "../aiSession/types";
import { executeFilterOp, undoFilterDeltas } from "./aiFilterApplier";

export type RedoResult = { ok: true } | { ok: false; reason: string };

export function undoAiOps(refs: readonly EntryRef[], baseline: SessionBaseline): void {
  const s = useAiSessionStore.getState();
  const wanted = new Set(refs.map(refKey));
  // Entries in turns ahead of the cursor were already reverted by Revert: no filter write for them.
  const filterEntries = flattenLive(s).filter(
    (f) => wanted.has(refKey(f.ref)) && !f.entry.undone && isFilterOp(f.entry.op) && f.turnIndex <= s.cursor && f.entry.filterDeltas?.length,
  );
  s.setEntriesUndone(refs, true, baseline);
  for (const f of filterEntries.reverse()) undoFilterDeltas(f.entry.filterDeltas as FilterDelta[]);
}

export function redoAiOps(target: EntryRef, baseline: SessionBaseline): RedoResult {
  const s = useAiSessionStore.getState();
  const plan = planRedo(s, target);
  if (!plan) return { ok: false, reason: AI_UNDO_COPY.redoRefused("the dashboard has changed") };
  const check = revalidateRedo(baseline, s, plan.refs);
  if (!check.ok) return { ok: false, reason: AI_UNDO_COPY.redoRefused(describeRedoBlock(check.result)) };
  s.setEntriesUndone(plan.refs, false, baseline);
  const after = useAiSessionStore.getState();
  const wanted = new Set(plan.refs.map(refKey));
  const filterEntries = flattenLive(after).filter((f) => wanted.has(refKey(f.ref)) && isFilterOp(f.entry.op) && f.turnIndex <= after.cursor);
  const executed: FilterDelta[][] = [];
  for (const f of filterEntries) {
    const op = f.entry.op;
    if (!op) continue;
    const deltas = executeFilterOp(op);
    if (op.op === "apply_filter" && deltas.length < op.filters.length) {
      // The filter store refused (e.g. per-table cap): put everything back exactly as it was.
      undoFilterDeltas(deltas);
      for (const d of executed.reverse()) undoFilterDeltas(d);
      useAiSessionStore.getState().setEntriesUndone(plan.refs, true, baseline);
      return { ok: false, reason: AI_UNDO_COPY.redoRefused(describeRedoBlock({ status: "skipped", reason: "filter_cap" } as never)) };
    }
    executed.push(deltas);
    useAiSessionStore.getState().attachEntryFilterDeltas(f.ref.turnId, f.ref.entryIndex, deltas);
  }
  return { ok: true };
}
