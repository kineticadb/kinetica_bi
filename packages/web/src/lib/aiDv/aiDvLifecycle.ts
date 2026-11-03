// Phase 139 (AISAFE-V20-06): client half of the AI view lifecycle. The store announces fold changes + resets
// (setAiDvSink); this module DROPs every AI view it built that the session no longer has. Logout/restart are
// server-side (139-06); closed tabs/crashes fall back to the Kinetica TTL.
import { setAiDvSink, useAiSessionStore } from "../../store/aiSessionStore";
import { useDynamicViewStore } from "../../store/dynamicViewStore";
import { dropAiDynamicView } from "../../api/client";
import type { SessionDerived } from "../aiSession/types";

type Tracked = { dashboardId: number; nonce: string; tempId: number; gen: number };

const tracked = new Map<number, Tracked>();
const pending = new Map<number, Promise<void>>();

/** Chain calls at materialize START (covers in-flight CREATEs). */
export function trackAiDv(t: Tracked): void {
  tracked.set(t.tempId, t);
}

/** The in-flight drop for this temp id (a rebuild must wait for it, Pitfall 3), else undefined. */
export function pendingAiDvDrop(tempId: number): Promise<void> | undefined {
  return pending.get(tempId);
}

function dropOne(t: Tracked): void {
  tracked.delete(t.tempId);
  useDynamicViewStore.getState().clearView(t.tempId);
  const p: Promise<void> = dropAiDynamicView({ dashboardId: t.dashboardId, nonce: t.nonce, tempId: t.tempId, gen: t.gen })
    .then(() => undefined, () => undefined)
    .finally(() => {
      if (pending.get(t.tempId) === p) pending.delete(t.tempId);
    });
  pending.set(t.tempId, p);
}

function reconcile(derived: SessionDerived): void {
  const live = new Set(derived.addedDynamicViews.map((v) => v.id));
  for (const t of [...tracked.values()]) {
    if (live.has(t.tempId)) continue;
    useAiSessionStore.getState().bumpDvGen(t.tempId); // redo rebuilds under a NEW generation name
    dropOne(t);
  }
}

export async function dropAllTrackedAiViews(): Promise<void> {
  for (const t of [...tracked.values()]) dropOne(t);
  await Promise.all([...pending.values()]);
}

/** Idempotent (assigns, never appends): StrictMode/double mount safe. */
export function installAiDvEffects(): void {
  setAiDvSink({ onDerived: reconcile, onReset: () => void dropAllTrackedAiViews() });
}

export function __resetAiDvLifecycleForTest(): void {
  tracked.clear();
  pending.clear();
}
