// 141 Keep client orchestration (RESEARCH Pattern 4). No React: deps are injected so the order of
// effects is unit-testable. Keep never auto-retries (a retry could double-apply on the server).
import { KEEP_FAILED_MESSAGE, type AiKeepRequest } from "@kinetica-bi/shared";
import type { WidgetDto, DashboardLayerDto, TableDto, DynamicViewRow, KeepAiResult } from "../../api/client";
import { useAiSessionStore } from "../../store/aiSessionStore";
import { useFilterStore } from "../../store/filterStore";
import { useDashboardVersionStore } from "../../store/dashboardVersionStore";
import { useInfoSelectionStore } from "../../store/infoSelectionStore";
import { discardAiSession } from "../aiOps/aiFilterEffects";
import { cancelAsk } from "./askRunner";
import { countViewToggles } from "./keepPayload";

export type KeepLists = { widgets: WidgetDto[]; layers: DashboardLayerDto[]; tables: TableDto[]; dynamicViews: DynamicViewRow[] };
export type KeepRunDeps = {
  dashboardId: number;
  buildPayload: (baselineVersion: number) => AiKeepRequest;
  keep: (dashboardId: number, body: AiKeepRequest) => Promise<KeepAiResult>;
  reloadLists: () => Promise<KeepLists>;
  /** Synchronous setters only. */
  applyLists: (lists: KeepLists) => void;
};
export type KeepRunOutcome = { kind: "saved" } | { kind: "saved_no_refresh" } | { kind: "conflict" } | { kind: "error"; message: string };

const failed: KeepRunOutcome = { kind: "error", message: KEEP_FAILED_MESSAGE };

export async function runKeep(d: KeepRunDeps): Promise<KeepRunOutcome> {
  const versions = useDashboardVersionStore.getState();
  const baseline = versions.baseline(d.dashboardId);
  if (baseline === undefined) return failed;

  let body: AiKeepRequest;
  try {
    body = d.buildPayload(baseline);
  } catch {
    return failed; // D-12: e.g. a new widget with no displayed rect
  }

  const result = await d.keep(d.dashboardId, body);
  if (!result.ok) {
    if (result.kind === "conflict") {
      useAiSessionStore.getState().setKeepBlocked("conflict");
      return { kind: "conflict" };
    }
    return { kind: "error", message: result.message };
  }

  // Committed. Drop the stale baseline before refetching so the list reads re-seed it (the server bumped the version).
  versions.clear(d.dashboardId);
  const viewTogglesNotSaved = countViewToggles(useAiSessionStore.getState().derived) > 0; // D-20, before the swap
  let lists: KeepLists;
  try {
    lists = await d.reloadLists();
  } catch {
    useAiSessionStore.getState().setKeepBlocked("committed");
    return { kind: "saved_no_refresh" };
  }

  // One synchronous block (no awaits): lists, filter re-key, then completeKeep LAST so temp views are
  // dropped only after the saved ones are in the list (D-15).
  d.applyLists(lists);
  useFilterStore.getState().rekeyDvFilters(result.response.idMap.dynamicViews, result.response.idMap.widgets);
  const sel = useInfoSelectionStore.getState();
  if ((sel.activeLayerId ?? 0) < 0 || (sel.activeWidgetId ?? 0) < 0) sel.reset();
  useAiSessionStore.getState().completeKeep({ warnings: result.response.warnings, viewTogglesNotSaved });
  return { kind: "saved" };
}

/** D-08 "Discard and reload the latest": a Discard (filter deltas undone) followed by a fresh list read. */
export async function runReloadLatest(d: Pick<KeepRunDeps, "dashboardId" | "reloadLists" | "applyLists">): Promise<void> {
  cancelAsk();
  discardAiSession();
  useDashboardVersionStore.getState().clear(d.dashboardId);
  try {
    d.applyLists(await d.reloadLists());
  } catch {
    // Lists stay as loaded; the baseline is cleared so Keep refuses until a reload (no stale write).
  }
}
