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
 * Removal approval (136 D-06): `removalApproved` is per conversation. It starts false, is set by
 * `approveRemoval()` and cleared by `reset()` (Discard / dashboard switch / leave) and by `completeKeep()` (Keep), and
 * reload clears memory (134 D-04). It is UX, not security: Keep enforces edit rights (141).
 *
 * 137: run/draft/highlight are shared by every AI widget on the dashboard (D-10); epoch lets the
 * runner drop a late result after reset().
 *
 * 139: dvNonce (per-tab, regenerated on reset) + dvGen (per-view generation) name AI views server-side;
 * lib/aiDv registers a sink (setAiDvSink) so fold changes and resets can DROP views (the store never calls the API).
 *
 * Cap (D-06): the oldest turn is squashed into baseEntries (never shift()-ed away) because
 * later turns may depend on its ops.
 */
import { create } from "zustand";
import type {
  Turn, TurnEntry, TurnInput, SessionBaseline, SessionDerived, SessionRect, FilterDelta, FilterSourceRef, SavedChatItem, TurnChat, TurnProposal, ProposalGhosts, EntryRef,
} from "../lib/aiSession/types";
import { AI_SOURCE_ID, AI_KEPT_VIEW_TOGGLES_SOURCE_ID, SESSION_TURN_CAP, EMPTY_DERIVED, BASE_TURN_ID } from "../lib/aiSession/constants";
import { evaluateTurn, foldSession, isFilterOp } from "../lib/aiSession/foldSession";
import { useWidgetActionStore } from "./widgetActionStore";
import { AI_CHAT_COPY } from "../lib/aiSession/chatText";
import { splitAppliedLabels } from "../lib/aiSession/undoPlan";
import { AI_FOLLOWUP_MAX, AI_FOLLOWUP_MAX_CHARS, type AiDvOutputColumn } from "@kinetica-bi/shared";

export type AiRun = { status: "idle" | "running"; question: string; startedAt: number; line: string; waitSeconds?: number };
const IDLE_RUN: AiRun = { status: "idle", question: "", startedAt: 0, line: "" };

/** 138: the AI filter applier (lib/aiOps, outside the engine) registers here so Revert/Forward can restore per-column filter state. Default none. */
export type AiFilterSink = {
  onCursorMove(from: number, to: number, turns: readonly Turn[], baseEntries: readonly TurnEntry[]): void;
};
let aiFilterSink: AiFilterSink | null = null;
export function setAiFilterSink(sink: AiFilterSink | null): void {
  aiFilterSink = sink;
}

/** 139: lib/aiDv registers here so fold changes and resets can DROP AI views (the store never calls the API). Default none. */
export type AiDvSink = { onDerived(derived: SessionDerived): void; onReset(): void };
let aiDvSink: AiDvSink | null = null;
export function setAiDvSink(sink: AiDvSink | null): void {
  aiDvSink = sink;
}
const newDvNonce = (): string => {
  const b = new Uint8Array(4);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
};

export type AiSessionState = {
  /** 139: random per-session (per-tab) nonce for AI view names (D-16). */
  dvNonce: string;
  dvGen: Record<number, number>;
  dvColumns: Record<number, AiDvOutputColumn[]>;
  bumpDvGen(tempId: number): void;
  setDvColumns(tempId: number, cols: AiDvOutputColumn[]): void;
  appendFollowUps(turnId: string, followUps: string[]): void;
  /** 150: ghost previews of a pending proposal (computed by the UI); cleared on every decision/reset/keep. */
  proposalGhosts: ProposalGhosts | null;
  setProposalGhosts(g: ProposalGhosts | null): void;
  /** 150: merge into a turn's proposal; a non-pending result clears the ghosts. */
  setProposal(turnId: string, patch: Partial<TurnProposal>): void;
  dashboardId: number | null;
  baseEntries: TurnEntry[];
  droppedCount: number;
  turns: Turn[];
  cursor: number;
  nextTempId: number;
  geometry: Record<number, SessionRect>;
  derived: SessionDerived;
  removalApproved: boolean;
  approveRemoval(): void;
  run: AiRun;
  draft: string;
  epoch: number;
  highlight: { ids: number[]; nonce: number };
  startRun(question: string): void;
  updateRun(line: string, waitSeconds?: number): void;
  endRun(): void;
  setDraft(text: string): void;
  setHighlight(ids: number[]): void;
  markChoicePicked(turnIndex: number, pick: { clarificationIndex: number; optionId: string }): void;
  /** 149: set/clear the rating on the live and kept turn whose chat.answerId matches. */
  setTurnRating(answerId: number, next: Pick<TurnChat, "rating" | "ratingReasons" | "ratingNote" | "ratingFollowUp">): void;
  /** 138: store what a filter op changed so Revert/Forward/Discard can invert it per column. */
  attachEntryFilterDeltas(turnId: string, entryIndex: number, deltas: FilterDelta[]): void;
  /** 138: display-only answer notes (never sent to the provider) + D-17 empty-result offers. */
  appendFilterNotes(turnId: string, notes: string[], emptyFilters?: { source: FilterSourceRef; column: string }[]): void;
  /** 136 D-13/134 D-16: session-only visibility for AI-added (negative id) layers. */
  tempLayerVisibility: Record<number, boolean>;
  setTempLayerVisible(id: number, visible: boolean): void;
  pendingLeave: { proceed: () => void } | null;
  applyTurn(input: TurnInput, baseline: SessionBaseline): { turnId: string; entries: TurnEntry[] };
  setCursor(index: number, baseline: SessionBaseline): void;
  reset(): void;
  /** 141 D-08/Pattern 4: "conflict" = a 409 happened and the user chose Stay; "committed" = saved but the refresh failed. Keep stays disabled until reset(). */
  keepBlocked: null | "conflict" | "committed";
  setKeepBlocked(v: null | "conflict" | "committed"): void;
  /** 145: the Claude Desktop handoff's server-held baseline (version at open_dashboard, advanced by the user's own writes). Cleared by reset() and completeKeep(). */
  keepBaselineFloor: number | null;
  setKeepBaselineFloor(v: number | null): void;
  /** 141 D-11/D-18: read-only archive of kept turns plus notes; cleared by reset(). */
  savedTurns: SavedChatItem[];
  /** 141 D-11: after a successful Keep. NOT reset(): keeps the transcript (as savedTurns) and filters; clears history, approval, overlay; drops temp views. */
  completeKeep(opts?: { warnings?: readonly string[]; viewTogglesNotSaved?: boolean }): void;
  setGeometry(tempId: number, rect: SessionRect): void;
  /** 151: user drag/resize-stop of AI (negative id) items; drives the "your edits will be lost" note. */
  userMoved: Record<number, true>;
  markUserMoved(ids: readonly number[]): void;
  /** 151: per-step undo; one set(); the UI calls lib/aiOps/undoAiOp, never this directly. */
  setEntriesUndone(refs: readonly EntryRef[], undone: boolean, baseline: SessionBaseline): void;
  allocateTempId(): number;
  setPendingLeave(p: { proceed: () => void } | null): void;
};

let turnSeq = 0;

/** 150: a still-pending proposal cannot survive Keep (the server copy is gone with the session): archive it expired and without ops. */
function archiveChat(chat: TurnChat, turn?: Turn): TurnChat {
  const p = chat.proposal;
  let out: TurnChat = chat;
  if (turn) {
    const split = splitAppliedLabels(turn);
    if (split.undone.length > 0) out = { ...out, applied: split.applied, undoneLabels: split.undone };
  }
  if (!p) return out;
  return { ...out, proposal: { ...p, ops: [], busy: false, status: p.status === "pending" ? "expired" : p.status } };
}

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
    if (e.result.status !== "applied" || !e.op || e.undone) continue;
    const id = (e.op as { tempId?: unknown }).tempId;
    if (typeof id === "number" && (e.op.op === "add_widget" || e.op.op === "add_layer")) s.add(id);
  }
  return s;
}

function pruneTempVisibility(vis: Record<number, boolean>, d: SessionDerived): Record<number, boolean> {
  const live = new Set(d.addedLayers.map((l) => l.id));
  const keys = Object.keys(vis);
  if (keys.every((k) => live.has(Number(k)))) return vis;
  const out: Record<number, boolean> = {};
  for (const k of keys) if (live.has(Number(k))) out[Number(k)] = vis[Number(k)];
  return out;
}

const initial = {
  dashboardId: null as number | null,
  baseEntries: [] as TurnEntry[],
  droppedCount: 0,
  turns: [] as Turn[],
  cursor: -1,
  geometry: {} as Record<number, SessionRect>,
  userMoved: {} as Record<number, true>,
  derived: EMPTY_DERIVED,
  removalApproved: false,
  run: IDLE_RUN,
  draft: "",
  highlight: { ids: [] as number[], nonce: 0 },
  tempLayerVisibility: {} as Record<number, boolean>,
  pendingLeave: null as { proceed: () => void } | null,
  savedTurns: [] as SavedChatItem[],
  keepBlocked: null as null | "conflict" | "committed",
  keepBaselineFloor: null as number | null,
  proposalGhosts: null as ProposalGhosts | null,
};

export const useAiSessionStore = create<AiSessionState>((set, get) => ({
  ...initial,
  nextTempId: -1,
  epoch: 0,
  dvNonce: newDvNonce(),
  dvGen: {},
  dvColumns: {},

  bumpDvGen: (tempId) => set((s) => ({ dvGen: { ...s.dvGen, [tempId]: Math.min(999, (s.dvGen[tempId] ?? 0) + 1) } })),
  setDvColumns: (tempId, cols) => {
    if (tempId >= 0) return;
    set((s) => ({ dvColumns: { ...s.dvColumns, [tempId]: cols } }));
  },
  appendFollowUps: (turnId, followUps) =>
    set((s) => {
      const ti = s.turns.findIndex((t) => t.id === turnId);
      const t = s.turns[ti];
      if (!t) return s;
      const merged: string[] = [];
      for (const f of [...(t.chat?.followUps ?? []), ...followUps.map((x) => x.slice(0, AI_FOLLOWUP_MAX_CHARS))]) {
        if (!merged.includes(f)) merged.push(f);
      }
      const turns = s.turns.slice();
      turns[ti] = { ...t, chat: { status: "ok", ...t.chat, followUps: merged.slice(0, AI_FOLLOWUP_MAX) } };
      return { turns };
    }),

  setProposalGhosts: (g) => set({ proposalGhosts: g }),
  setProposal: (turnId, patch) =>
    set((s) => {
      const ti = s.turns.findIndex((t) => t.id === turnId);
      const t = s.turns[ti];
      if (!t?.chat?.proposal) return s;
      const proposal = { ...t.chat.proposal, ...patch };
      const turns = s.turns.slice();
      turns[ti] = { ...t, chat: { ...t.chat, proposal } };
      return proposal.status === "pending" ? { turns } : { turns, proposalGhosts: null };
    }),

  applyTurn: (input, baseline) => {
    if (get().dashboardId !== null && baseline.dashboardId !== get().dashboardId) get().reset();
    const s = get();
    const kept = s.turns.slice(0, s.cursor + 1);
    // 150: replaceTurnId folds an approved proposal into its own (last kept) turn instead of appending.
    const last = kept[kept.length - 1];
    const replacing = input.replaceTurnId !== undefined && last?.id === input.replaceTurnId ? last : null;
    const priorTurns = replacing ? kept.slice(0, -1) : kept;
    const prior = [...s.baseEntries, ...priorTurns.flatMap((t) => t.entries)];
    const entries = evaluateTurn(baseline, prior, input.ops, { removalApproved: s.removalApproved, currentFilters: input.currentFilters });
    const turn: Turn = {
      id: replacing ? replacing.id : `turn-${++turnSeq}`,
      prompt: input.prompt,
      answer: input.answer ?? "",
      entries,
      createdAt: replacing ? replacing.createdAt : Date.now(),
      ...(input.chat ? { chat: input.chat } : {}),
    };
    let turns = [...priorTurns, turn];
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
    // Pitfall 4: an applied set_layout owns its ids' positions, so a stale user drag must not shadow it.
    const moved = new Set<number>();
    for (const e of entries) {
      if (e.result.status === "applied" && e.op?.op === "set_layout") for (const it of e.op.items) moved.add(it.id);
    }
    for (const [k, v] of Object.entries(s.geometry)) if (live.has(Number(k)) && !moved.has(Number(k))) geometry[Number(k)] = v;
    const userMoved: Record<number, true> = {};
    for (const k of Object.keys(s.userMoved)) if (live.has(Number(k))) userMoved[Number(k)] = true;
    const derived = foldSession(baseline, all);
    set({ ...(replacing ? { proposalGhosts: null } : {}), dashboardId: baseline.dashboardId, turns, baseEntries, droppedCount, cursor, nextTempId, geometry, userMoved, derived, tempLayerVisibility: pruneTempVisibility(s.tempLayerVisibility, derived) });
    writeAiContribution(derived);
    aiDvSink?.onDerived(derived);
    return { turnId: turn.id, entries };
  },

  setCursor: (index, baseline) => {
    const s = get();
    const from = s.cursor;
    const cursor = Math.max(-1, Math.min(index, s.turns.length - 1));
    const derived = foldSession(baseline, prefixEntries(s.baseEntries, s.turns, cursor));
    set({ cursor, derived, tempLayerVisibility: pruneTempVisibility(s.tempLayerVisibility, derived) });
    writeAiContribution(derived);
    if (from !== cursor) aiFilterSink?.onCursorMove(from, cursor, s.turns, s.baseEntries);
    if (from !== cursor) aiDvSink?.onDerived(derived);
  },

  reset: () => {
    aiDvSink?.onReset();
    set({ ...initial, nextTempId: get().nextTempId, epoch: get().epoch + 1, dvNonce: newDvNonce(), dvGen: {}, dvColumns: {} });
    useWidgetActionStore.getState().clearControl(AI_SOURCE_ID);
    useWidgetActionStore.getState().clearControl(AI_KEPT_VIEW_TOGGLES_SOURCE_ID);
  },

  setKeepBlocked: (v) => set({ keepBlocked: v }),
  setKeepBaselineFloor: (v) => set({ keepBaselineFloor: v }),

  // 141 D-21: Keep calls completeKeep(), NOT reset() - reset() would drop the transcript (D-18) and is for
  // discard/switch/leave only. Do not change this back. Filters are NOT undone (D-13): aiFilterSink is never called.
  completeKeep: (opts) => {
    const s = get();
    const toggles = s.derived.contribution.dynamicView; // D-20: captured BEFORE the derived state is cleared
    const archived: SavedChatItem[] = s.turns.slice(0, s.cursor + 1).map((t) => ({
      kind: "turn" as const, id: t.id, prompt: t.prompt, answer: t.answer, ...(t.chat ? { chat: archiveChat(t.chat, t) } : {}),
    }));
    const texts = [
      opts?.viewTogglesNotSaved ? `${AI_CHAT_COPY.keepSaved} ${AI_CHAT_COPY.viewTogglesNotSaved}` : AI_CHAT_COPY.keepSaved,
      ...(opts?.warnings ?? []),
    ];
    const notes: SavedChatItem[] = texts.map((text) => ({ kind: "note" as const, id: `keep-note-${++turnSeq}`, text }));
    set({
      savedTurns: [...s.savedTurns, ...archived, ...notes],
      baseEntries: [], droppedCount: 0, turns: [], cursor: -1, geometry: {}, userMoved: {}, derived: EMPTY_DERIVED,
      removalApproved: false, highlight: { ids: [], nonce: s.highlight.nonce + 1 }, tempLayerVisibility: {},
      keepBlocked: null, keepBaselineFloor: null, pendingLeave: null, proposalGhosts: null, epoch: s.epoch + 1, dvNonce: newDvNonce(), dvGen: {}, dvColumns: {},
    });
    aiDvSink?.onReset();
    const wa = useWidgetActionStore.getState();
    wa.clearControl(AI_SOURCE_ID);
    if (Object.keys(toggles).length > 0) {
      // D-20: toggled views stay as shown in this tab (render-time only, never sent to the server); reset() clears.
      const prev = wa.contributions[AI_KEPT_VIEW_TOGGLES_SOURCE_ID]?.dynamicView ?? {};
      wa.setControlContribution(AI_KEPT_VIEW_TOGGLES_SOURCE_ID, { widget: {}, layer: {}, dynamicView: { ...prev, ...toggles } });
    }
  },

  setGeometry: (tempId, rect) =>
    set((s) => {
      const cur = s.geometry[tempId];
      if (cur && cur.x === rect.x && cur.y === rect.y && cur.w === rect.w && cur.h === rect.h) return s;
      return { geometry: { ...s.geometry, [tempId]: rect } };
    }),

  markUserMoved: (ids) =>
    set((s) => {
      const add = ids.filter((id) => id < 0 && !s.userMoved[id]);
      if (add.length === 0) return s;
      const userMoved = { ...s.userMoved };
      for (const id of add) userMoved[id] = true;
      return { userMoved };
    }),

  setEntriesUndone: (refs, undone, baseline) => {
    if (refs.length === 0) return;
    const s = get();
    const mark = (e: TurnEntry): TurnEntry => {
      if (undone) return { ...e, undone: true };
      const { undone: _u, ...rest } = e;
      return rest;
    };
    const idxOf = (turnId: string) => refs.filter((r) => r.turnId === turnId).map((r) => r.entryIndex);
    const removed: number[] = [];
    const apply = (entries: TurnEntry[], turnId: string): TurnEntry[] => {
      const hit = idxOf(turnId).filter((i) => entries[i]);
      if (hit.length === 0) return entries;
      const next = entries.slice();
      for (const i of hit) {
        next[i] = mark(entries[i]);
        const op = entries[i].op;
        if (undone && op && (op.op === "add_widget" || op.op === "add_layer" || op.op === "add_dynamic_view")) removed.push(op.tempId);
      }
      return next;
    };
    const baseEntries = apply(s.baseEntries, BASE_TURN_ID);
    const turns = s.turns.map((t) => {
      const entries = apply(t.entries, t.id);
      return entries === t.entries ? t : { ...t, entries };
    });
    const derived = foldSession(baseline, prefixEntries(baseEntries, turns, s.cursor));
    const drop = new Set(removed);
    const geometry = { ...s.geometry };
    const userMoved = { ...s.userMoved };
    const vis = { ...s.tempLayerVisibility };
    for (const id of drop) {
      delete geometry[id];
      delete userMoved[id];
      delete vis[id];
    }
    set({ baseEntries, turns, derived, geometry, userMoved, tempLayerVisibility: pruneTempVisibility(vis, derived) });
    writeAiContribution(derived);
    aiDvSink?.onDerived(derived);
  },

  allocateTempId: () => {
    const id = get().nextTempId;
    set({ nextTempId: id - 1 });
    return id;
  },

  approveRemoval: () => set({ removalApproved: true }),

  startRun: (question) => set({ run: { status: "running", question, startedAt: Date.now(), line: "Thinking…" } }),
  updateRun: (line, waitSeconds) => set((s) => ({ run: { ...s.run, line, waitSeconds } })),
  endRun: () => set({ run: IDLE_RUN }),
  setDraft: (text) => set({ draft: text }),
  setHighlight: (ids) => set((s) => ({ highlight: { ids, nonce: s.highlight.nonce + 1 } })),
  markChoicePicked: (turnIndex, pick) =>
    set((s) => {
      const t = s.turns[turnIndex];
      if (!t) return s;
      const turns = s.turns.slice();
      turns[turnIndex] = { ...t, chat: { status: "ok", ...t.chat, pickedChoice: pick } };
      return { turns };
    }),

  setTurnRating: (answerId, next) =>
    set((s) => {
      let hit = false;
      const apply = (chat: TurnChat | undefined): TurnChat | undefined => {
        if (!chat || chat.answerId !== answerId) return chat;
        hit = true;
        const merged: TurnChat = { ...chat, rating: undefined, ratingReasons: undefined, ratingNote: undefined, ratingFollowUp: undefined, ...next };
        for (const k of ["rating", "ratingReasons", "ratingNote", "ratingFollowUp"] as const) {
          if (merged[k] === undefined) delete merged[k];
        }
        return merged;
      };
      const turns = s.turns.map((t) => (t.chat?.answerId === answerId ? { ...t, chat: apply(t.chat) } : t));
      const savedTurns = s.savedTurns.map((x) => (x.kind === "turn" && x.chat?.answerId === answerId ? { ...x, chat: apply(x.chat) } : x));
      return hit ? { turns, savedTurns } : s;
    }),

  attachEntryFilterDeltas: (turnId, entryIndex, deltas) =>
    set((s) => {
      if (turnId === BASE_TURN_ID) {
        if (!s.baseEntries[entryIndex]) return s;
        const baseEntries = s.baseEntries.slice();
        baseEntries[entryIndex] = { ...baseEntries[entryIndex], filterDeltas: deltas };
        return { baseEntries };
      }
      const ti = s.turns.findIndex((t) => t.id === turnId);
      const t = s.turns[ti];
      if (!t || !t.entries[entryIndex]) return s;
      const entries = t.entries.slice();
      entries[entryIndex] = { ...entries[entryIndex], filterDeltas: deltas };
      const turns = s.turns.slice();
      turns[ti] = { ...t, entries };
      return { turns };
    }),

  appendFilterNotes: (turnId, notes, emptyFilters) =>
    set((s) => {
      const ti = s.turns.findIndex((t) => t.id === turnId);
      const t = s.turns[ti];
      if (!t) return s;
      const turns = s.turns.slice();
      turns[ti] = {
        ...t,
        chat: {
          status: "ok",
          ...t.chat,
          filterNotes: [...(t.chat?.filterNotes ?? []), ...notes],
          ...(emptyFilters?.length ? { emptyFilters: [...(t.chat?.emptyFilters ?? []), ...emptyFilters] } : {}),
        },
      };
      return { turns };
    }),

  setTempLayerVisible: (id, visible) => {
    if (id >= 0) return;
    set((s) => ({ tempLayerVisibility: { ...s.tempLayerVisibility, [id]: visible } }));
  },

  setPendingLeave: (p) => set({ pendingLeave: p }),
}));

const isApplied = (e: TurnEntry) => e.result.status === "applied" && !e.undone && !isFilterOp(e.op); // 151: undone entries do not count (Keep bar hides, editing unlocks, leave warning drops); // 138 D-09: filter-only answers never lock, show the bar or arm the leave warning

/** True once any non-filter op has applied, regardless of cursor (Pitfall 5); op-less turns do not count (D-17); filter ops are excluded (D-09). */
export function selectHasUnsavedAiChanges(s: AiSessionState): boolean {
  return s.baseEntries.some(isApplied) || s.turns.some((t) => t.entries.some(isApplied));
}

/** Saved widgets the AI edited, retyped, renamed or moved at the current cursor. */
export function selectAiEditedWidgetIds(s: AiSessionState): ReadonlySet<number> {
  return s.derived.aiEditedWidgetIds;
}

/**
 * 137 (136-12 UAT finding 3): the "AI edited" pill shows for a widget the AI edited directly OR a
 * map whose layers the AI added/edited/removed. Counts in the bar use aiEditedWidgetIds only.
 */
export function selectShowsAiEditedPill(s: AiSessionState, id: number): boolean {
  return s.derived.aiEditedWidgetIds.has(id) || s.derived.aiLayerHostWidgetIds.has(id);
}

/** 150: the proposal awaiting a decision at the cursor turn, if any. */
export function selectPendingProposal(s: AiSessionState): { turnId: string; turnIndex: number; answerId: number; proposal: TurnProposal } | null {
  const turnIndex = s.cursor;
  const t = s.turns[turnIndex];
  const proposal = t?.chat?.proposal;
  if (!t || !proposal || proposal.status !== "pending" || typeof t.chat?.answerId !== "number") return null;
  return { turnId: t.id, turnIndex, answerId: t.chat.answerId, proposal };
}

export function hasPendingProposal(): boolean {
  return selectPendingProposal(useAiSessionStore.getState()) !== null;
}

export function hasUnsavedAiChanges(): boolean {
  return selectHasUnsavedAiChanges(useAiSessionStore.getState());
}

