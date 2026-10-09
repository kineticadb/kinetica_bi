import { create } from "zustand";

export type ToastKind = "permission" | "info" | "error";
export type ToastAction = { label: string; onClick: () => void };
export type Toast = { id: number; message: string; kind: ToastKind; action?: ToastAction };

type ToastState = {
  toasts: Toast[];
  _lastShown: Map<string, number>; // dedup: kind+message → timestamp
  showToast: (message: string, kind?: ToastKind, action?: ToastAction) => void;
  dismissToast: (id: number) => void;
};

const DEDUP_WINDOW_MS = 5000;
export const TOAST_TTL_MS = 5000;
// Phase 131: an action toast (e.g. the export "ready" toast's Download) persists 15 s so the user has time to click it.
export const TOAST_ACTION_TTL_MS = 15000;
let nextId = 1;

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  _lastShown: new Map(),
  showToast: (message, kind = "info", action) => {
    const key = `${kind}::${message}`;
    const now = Date.now();
    const last = get()._lastShown.get(key) ?? 0;
    if (now - last < DEDUP_WINDOW_MS) return; // debounced — same message within 5s suppressed
    const id = nextId++;
    const toast: Toast = action ? { id, message, kind, action } : { id, message, kind };
    const _lastShown = new Map(get()._lastShown);
    _lastShown.set(key, now);
    set({ toasts: [...get().toasts, toast], _lastShown });
    setTimeout(() => {
      set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
    }, action ? TOAST_ACTION_TTL_MS : TOAST_TTL_MS);
  },
  dismissToast: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}));
