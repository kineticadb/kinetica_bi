import { create } from "zustand";

export type ToastKind = "permission" | "info" | "error";
export type Toast = { id: number; message: string; kind: ToastKind };

type ToastState = {
  toasts: Toast[];
  _lastShown: Map<string, number>; // dedup: kind+message → timestamp
  showToast: (message: string, kind?: ToastKind) => void;
  dismissToast: (id: number) => void;
};

const DEDUP_WINDOW_MS = 5000;
let nextId = 1;

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  _lastShown: new Map(),
  showToast: (message, kind = "info") => {
    const key = `${kind}::${message}`;
    const now = Date.now();
    const last = get()._lastShown.get(key) ?? 0;
    if (now - last < DEDUP_WINDOW_MS) return; // debounced — same message within 5s suppressed
    const id = nextId++;
    const toast: Toast = { id, message, kind };
    const _lastShown = new Map(get()._lastShown);
    _lastShown.set(key, now);
    set({ toasts: [...get().toasts, toast], _lastShown });
    setTimeout(() => {
      set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
    }, 5000);
  },
  dismissToast: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}));
