// 152: the effective Viewer AI mode for the CURRENT user on the open dashboard. Written by DashboardOpen (load) and by the ask/apply runners (mode refusal, plan 06). No polling.
import { create } from "zustand";
import type { ViewerAiMode } from "@kinetica-bi/shared";

/** Same rule as AiChangeBar canKeep: a user who cannot save AI changes is restricted. */
export function isViewerAiRestricted(p: { canEdit: boolean; ownUnkept: boolean; canCreate: boolean }): boolean {
  return !(p.canEdit || (p.ownUnkept && p.canCreate));
}

type ViewerAiState = {
  dashboardId: number | null;
  mode: ViewerAiMode;
  restricted: boolean;
  set(p: { dashboardId: number; mode: ViewerAiMode; restricted: boolean }): void;
  switchMode(dashboardId: number, mode: ViewerAiMode): void;
  reset(): void;
};

const INITIAL = { dashboardId: null as number | null, mode: "session_only" as ViewerAiMode, restricted: false };

export const useViewerAiStore = create<ViewerAiState>((set, get) => ({
  ...INITIAL,
  set: (p) => set({ dashboardId: p.dashboardId, mode: p.mode, restricted: p.restricted }),
  switchMode: (dashboardId, mode) => {
    if (get().dashboardId !== dashboardId) return;
    set({ mode });
  },
  reset: () => set({ ...INITIAL }),
}));

export const selectEffectiveViewerAi = (s: ViewerAiState): ViewerAiMode => (s.restricted ? s.mode : "session_only");
