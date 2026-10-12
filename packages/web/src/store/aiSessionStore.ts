/**
 * Phase 134 Plan 03 — per-user AI session store (turns + cursor + derived).
 *
 * IN-MEMORY ONLY: never `persist`, never browser storage, never a runtime api/client import.
 * Reload clears the session by construction (D-04 / AISES-V20-07).
 *
 * Design: op-log + cursor + pure fold. This deliberately deviates from milestone PITFALLS C7
 * (command pattern with inverse ops): the saved dashboard is never mutated, so revert/forward
 * is "fold a different prefix of the log" and Discard is "drop the log". Inverses would be dead
 * code and a bug surface.
 *
 * The AI overlay contribution is rebuilt from the WHOLE log prefix and written once under
 * AI_SOURCE_ID. widgetActionStore.setControlContribution REPLACES a source's contribution
 * wholesale, so writing per turn would erase earlier turns' patches on the same target.
 *
 * Cap (D-06): the oldest turn is squashed into baseEntries (never shift()-ed away) because
 * later turns may depend on its ops.
 */
import { create } from "zustand";
import type { Turn, TurnEntry, TurnInput, SessionBaseline, SessionDerived, SessionRect } from "../lib/aiSession/types";
import { AI_SOURCE_ID, SESSION_TURN_CAP, EMPTY_DERIVED } from "../lib/aiSession/constants";
import { evaluateTurn, foldSession } from "../lib/aiSession/foldSession";
import { useWidgetActionStore } from "./widgetActionStore";

type AiSessionState = {
  dashboardId: number | null;
  baseEntries: TurnEntry[];
  droppedCount: number;
  turns: Turn[];
  cursor: number;
  nextTempId: number;
  geometry: Record<number, SessionRect>;
  derived: SessionDerived;
  pendingLeave: { proceed: () => void } | null;
  applyTurn(input: TurnInput, baseline: SessionBaseline): { turnId: string; entries: TurnEntry[] };
  setCursor(index: number, baseline: SessionBaseline): void;
  reset(): void;
  setGeometry(tempId: number, rect: SessionRect): void;
  allocateTempId(): number;
  setPendingLeave(p: { proceed: () => void } | null): void;
};

let turnSeq = 0;

function writeAiContribution(d: SessionDerived): void {
  const c = d.contribution;
  const empty =
    Object.keys(c.widget).length === 0 && Object.keys(c.layer).length === 0 && Object.keys(c.dynamicView).length === 0;
  const wa = useWidgetActionStore.getState();
  if (empty) wa.clearControl(AI_SOURCE_ID);
  else wa.setControlContribution(AI_SOURCE_ID, c);
}

function prefixEntries(baseEntries: TurnEntry[], turns: Turn[], cursor: number): TurnEntry[] {
  return [...baseEntries, ...turns.slice(0, cursor + 1).flatMap((t) => t.entries)];
}

function minTempId(entries: TurnEntry[]): number {
  let min = 0;
  for (const e of entries) {
    const id = (e.op as { tempId?: unknown } | null)?.tempId;
    if (typeof id === "number" && id < min) min = id;
  }
  return min;
}

function addedTempIds(entries: TurnEntry[]): Set<number> {
  const s = new Set<number>();
  for (const e of entries) {
    if (e.result.status !== "applied" || !e.op) continue;
    const id = (e.op as { tempId?: unknown }).tempId;
    if (typeof id === "number" && (e.op.op === "add_widget" || e.op.op === "add_layer")) s.add(id);
  }
  return s;
}

const initial = {
  dashboardId: null as number | null,
  baseEntries: [] as TurnEntry[],
  droppedCount: 0,
  turns: [] as Turn[],
  cursor: -1,
  geometry: {} as Record<number, SessionRect>,
  derived: EMPTY_DERIVED,
  pendingLeave: null as { proceed: () => void } | null,
};

export const useAiSessionStore = create<AiSessionState>((set, get) => ({
  ...initial,
  nextTempId: -1,

  applyTurn: (input, baseline) => {
    if (get().dashboardId !== null && baseline.dashboardId !== get().dashboardId) get().reset();
    const s = get();
    const kept = s.turns.slice(0, s.cursor + 1);
    const prior = [...s.baseEntries, ...kept.flatMap((t) => t.entries)];
    const entries = evaluateTurn(baseline, prior, input.ops);
    const turn: Turn = {
      id: `turn-${++turnSeq}`,
      prompt: input.prompt,
      answer: input.answer ?? "",
      entries,
      createdAt: Date.now(),
    };
    let turns = [...kept, turn];
    let baseEntries = s.baseEntries;
    let droppedCount = s.droppedCount;
    if (turns.length > SESSION_TURN_CAP) {
      baseEntries = [...baseEntries, ...turns[0].entries];
      turns = turns.slice(1);
      droppedCount++;
    }
    const cursor = turns.length - 1;
    const all = prefixEntries(baseEntries, turns, cursor);
    const nextTempId = Math.min(s.nextTempId, minTempId(all) - 1);
    const live = addedTempIds(all);
    const geometry: Record<number, SessionRect> = {};
    for (const [k, v] of Object.entries(s.geometry)) if (live.has(Number(k))) geometry[Number(k)] = v;
    const derived = foldSession(baseline, all);
    set({ dashboardId: baseline.dashboardId, turns, baseEntries, droppedCount, cursor, nextTempId, geometry, derived });
    writeAiContribution(derived);
    return { turnId: turn.id, entries };
  },

  setCursor: (index, baseline) => {
    const s = get();
    const cursor = Math.max(-1, Math.min(index, s.turns.length - 1));
    const derived = foldSession(baseline, prefixEntries(s.baseEntries, s.turns, cursor));
    set({ cursor, derived });
    writeAiContribution(derived);
  },

  reset: () => {
    set({ ...initial, nextTempId: get().nextTempId });
    useWidgetActionStore.getState().clearControl(AI_SOURCE_ID);
  },

  setGeometry: (tempId, rect) =>
    set((s) => {
      const cur = s.geometry[tempId];
      if (cur && cur.x === rect.x && cur.y === rect.y && cur.w === rect.w && cur.h === rect.h) return s;
      return { geometry: { ...s.geometry, [tempId]: rect } };
    }),

  allocateTempId: () => {
    const id = get().nextTempId;
    set({ nextTempId: id - 1 });
    return id;
  },

  setPendingLeave: (p) => set({ pendingLeave: p }),
}));

const isApplied = (e: TurnEntry) => e.result.status === "applied";

/** True once any op has applied, regardless of cursor (Pitfall 5); op-less turns do not count (D-17). */
export function selectHasUnsavedAiChanges(s: AiSessionState): boolean {
  return s.baseEntries.some(isApplied) || s.turns.some((t) => t.entries.some(isApplied));
}

export function hasUnsavedAiChanges(): boolean {
  return selectHasUnsavedAiChanges(useAiSessionStore.getState());
}

