/**
 * Phase 141 (AISES-V20-06, D-07/D-17): per-tab dashboard version tracking.
 *
 * The baseline is "the dashboard as loaded in THIS tab": the minimum version read over the
 * four dashboard lists, advanced only along a contiguous chain of this tab's own write edges
 * (before -> after). A foreign write leaves a gap in the chain, so the baseline stops short and
 * Keep gets the 409. Another tab of the same user counts as "someone else". In-memory only.
 * 145: an optional floor (the Claude Desktop handoff baseline) can only lower the start of the chain.
 * Must not import api/client.ts (client feeds this store).
 */
import { create } from "zustand";
import type { DashboardVersionList } from "@kinetica-bi/shared";

type Entry = { reads: Partial<Record<DashboardVersionList, number>>; edges: Record<number, number> };

export type DashboardVersionState = {
  byDashboard: Record<number, Entry>;
  noteRead(dashboardId: number, list: DashboardVersionList, version: number): void;
  noteWrite(dashboardId: number, before: number, after: number): void;
  baseline(dashboardId: number, floor?: number): number | undefined;
  clear(dashboardId: number): void;
};

const MAX_STEPS = 10000;

export const useDashboardVersionStore = create<DashboardVersionState>((set, get) => ({
  byDashboard: {},
  noteRead(dashboardId, list, version) {
    set((s) => {
      const e = s.byDashboard[dashboardId] ?? { reads: {}, edges: {} };
      return { byDashboard: { ...s.byDashboard, [dashboardId]: { ...e, reads: { ...e.reads, [list]: version } } } };
    });
  },
  noteWrite(dashboardId, before, after) {
    if (!(after > before)) return;
    set((s) => {
      const e = s.byDashboard[dashboardId] ?? { reads: {}, edges: {} };
      const prev = e.edges[before];
      const next = prev === undefined ? after : Math.max(prev, after);
      return { byDashboard: { ...s.byDashboard, [dashboardId]: { ...e, edges: { ...e.edges, [before]: next } } } };
    });
  },
  baseline(dashboardId, floor) {
    const e = get().byDashboard[dashboardId];
    if (!e) return undefined;
    const vals = Object.values(e.reads);
    if (vals.length === 0) return undefined;
    let v = Math.min(...vals);
    if (floor !== undefined && floor < v) v = floor; // 145: a Claude Desktop handoff baseline (server-held, from open_dashboard)
    for (let i = 0; i < MAX_STEPS; i++) {
      const n = e.edges[v];
      if (n === undefined || n <= v) break;
      v = n;
    }
    return v;
  },
  clear(dashboardId) {
    set((s) => {
      const { [dashboardId]: _drop, ...rest } = s.byDashboard;
      void _drop;
      return { byDashboard: rest };
    });
  },
}));
