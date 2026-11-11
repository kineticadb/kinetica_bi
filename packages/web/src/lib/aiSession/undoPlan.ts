// 151: pure planning for per-step undo/redo. No store, no UI. Undo = fold without the entry (never inverse ops).
import { aiOpDependencies, closeSelection, dependentsOf } from "@kinetica-bi/shared";
import { evaluateTurn } from "./foldSession";
import { describeProposal, type ProposalNames } from "./proposalText";
import { BASE_TURN_ID } from "./constants";
import type { EntryRef, OpResult, SessionBaseline, Turn, TurnEntry } from "./types";

export type FlatEntry = { ref: EntryRef; entry: TurnEntry; turnIndex: number }; // turnIndex -1 = baseEntries
export type UndoInput = {
  baseEntries: readonly TurnEntry[];
  turns: readonly Turn[];
  userMoved?: Readonly<Record<number, true>>;
  tempLayerVisibility?: Readonly<Record<number, boolean>>;
};
export type UndoPlan = { refs: EntryRef[]; dependents: { ref: EntryRef; turnIndex: number }[]; removedTempIds: number[]; handEdited: boolean };
export type ChangeLine = { label: string; entryIndex: number | null; undone: boolean; undoable: boolean };

export const refKey = (r: EntryRef): string => `${r.turnId}#${r.entryIndex}`;

const EMPTY_NAMES: ProposalNames = { widgets: {}, layers: {}, views: {}, tables: {} };

/** Every applied entry of baseEntries then EVERY turn (cursor ignored: turns ahead are forwardable). Undone ones included. */
export function flattenLive(s: UndoInput): FlatEntry[] {
  const out: FlatEntry[] = [];
  const take = (turnId: string, entries: readonly TurnEntry[], turnIndex: number) =>
    entries.forEach((entry, entryIndex) => {
      if (entry.result.status === "applied" && entry.op !== null) out.push({ ref: { turnId, entryIndex }, entry, turnIndex });
    });
  take(BASE_TURN_ID, s.baseEntries, -1);
  s.turns.forEach((t, i) => take(t.id, t.entries, i));
  return out;
}

/** Replay the flat entries whose key is live. removalApproved: every replayed entry was approved when first applied. */
function replay(baseline: SessionBaseline, flats: readonly FlatEntry[], liveKeys: ReadonlySet<string>): Map<string, OpResult> {
  const live = flats.filter((f) => liveKeys.has(refKey(f.ref)));
  const results = evaluateTurn(baseline, [], live.map((f) => f.entry.raw), { removalApproved: true });
  return new Map(live.map((f, i) => [refKey(f.ref), results[i].result]));
}

export function planUndo(baseline: SessionBaseline, s: UndoInput, target: EntryRef): UndoPlan | null {
  const live = flattenLive(s).filter((f) => !f.entry.undone);
  const t = live.findIndex((f) => refKey(f.ref) === refKey(target));
  if (t < 0) return null;
  const deps = aiOpDependencies(live.map((f) => f.entry.raw));
  const sel = new Set<number>([t, ...dependentsOf(t, deps)]);
  for (let round = 0; round <= live.length; round++) {
    const keys = new Set(live.filter((_, i) => !sel.has(i)).map((f) => refKey(f.ref)));
    const results = replay(baseline, live, keys);
    const before = sel.size;
    live.forEach((f, i) => {
      if (sel.has(i)) return;
      if (results.get(refKey(f.ref))?.status !== "applied") {
        sel.add(i);
        for (const d of dependentsOf(i, deps)) sel.add(d);
      }
    });
    if (sel.size === before) break;
  }
  const chosen = live.map((f, i) => ({ f, i })).filter(({ i }) => sel.has(i));
  const removedTempIds: number[] = [];
  for (const { f } of chosen) {
    const op = f.entry.op;
    if (op && (op.op === "add_widget" || op.op === "add_layer" || op.op === "add_dynamic_view")) removedTempIds.push(op.tempId);
  }
  const handEdited = removedTempIds.some(
    (id) => s.userMoved?.[id] === true || (s.tempLayerVisibility !== undefined && id in s.tempLayerVisibility),
  );
  return {
    refs: chosen.map(({ f }) => f.ref),
    dependents: chosen.filter(({ i }) => i !== t).map(({ f }) => ({ ref: f.ref, turnIndex: f.turnIndex })),
    removedTempIds,
    handEdited,
  };
}

export function planRedo(s: UndoInput, target: EntryRef): { refs: EntryRef[] } | null {
  const all = flattenLive(s);
  const t = all.findIndex((f) => refKey(f.ref) === refKey(target));
  if (t < 0 || !all[t].entry.undone) return null;
  const deps = aiOpDependencies(all.map((f) => f.entry.raw));
  return { refs: closeSelection([t], deps).filter((i) => all[i].entry.undone).map((i) => all[i].ref) };
}

export function revalidateRedo(
  baseline: SessionBaseline,
  s: UndoInput,
  redo: readonly EntryRef[],
): { ok: true } | { ok: false; ref: EntryRef; result: OpResult } {
  const all = flattenLive(s);
  const redoKeys = new Set(redo.map(refKey));
  const liveKeys = new Set(all.filter((f) => !f.entry.undone || redoKeys.has(refKey(f.ref))).map((f) => refKey(f.ref)));
  const results = replay(baseline, all, liveKeys);
  for (const f of all) {
    const k = refKey(f.ref);
    if (!liveKeys.has(k)) continue;
    const result = results.get(k);
    if (result && result.status !== "applied") return { ok: false, ref: f.ref, result };
  }
  return { ok: true };
}

export function describeRedoBlock(result: OpResult): string {
  if (result.status === "applied") return "the dashboard has changed";
  switch (result.reason) {
    case "target_not_found": return "something it changes is no longer there";
    case "column_not_found": return `column ${result.detail ?? ""} is missing`.trim();
    case "duplicate_temp_id": return "a later answer reused its place";
    case "layout_rejected": return "it would overlap another widget";
    case "table_not_on_dashboard": return "its table is no longer on the dashboard";
    case "filter_cap": return "too many filters are on";
    default: return "the dashboard has changed";
  }
}

type LabelledTurn = Pick<Turn, "entries" | "chat">;
const alignedLabels = (turn: LabelledTurn): string[] | null => {
  const labels = turn.chat?.applied ?? [];
  return labels.length > 0 && labels.length === turn.entries.length ? labels : null;
};

export function changeLines(turn: Turn): ChangeLine[] {
  const labels = turn.chat?.applied ?? [];
  if (alignedLabels(turn)) {
    return labels.map((label, i) => {
      const e = turn.entries[i];
      return { label, entryIndex: i, undone: e.undone === true, undoable: e.result.status === "applied" && e.op !== null };
    });
  }
  return labels.map((label) => ({ label, entryIndex: null, undone: false, undoable: false }));
}

export function entryName(turn: LabelledTurn, entryIndex: number): string {
  const aligned = alignedLabels(turn);
  if (aligned) return aligned[entryIndex];
  return describeProposal([turn.entries[entryIndex]?.raw], EMPTY_NAMES)[0] ?? "a change";
}

export function splitAppliedLabels(turn: LabelledTurn): { applied: string[]; undone: string[] } {
  const aligned = alignedLabels(turn);
  if (aligned) {
    return {
      applied: aligned.filter((_, i) => !turn.entries[i].undone),
      undone: aligned.filter((_, i) => turn.entries[i].undone === true),
    };
  }
  const undone: string[] = [];
  turn.entries.forEach((e, i) => {
    if (e.undone && e.result.status === "applied") undone.push(entryName(turn, i));
  });
  return { applied: [...(turn.chat?.applied ?? [])], undone };
}
