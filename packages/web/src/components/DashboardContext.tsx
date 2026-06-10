import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { WidgetDto, DynamicViewRow } from "../api/client";
import type { WidgetAction, WidgetActionResult } from "../lib/widgetAction";

/**
 * Phase 15 + Phase 30 + Phase 35.
 *
 * Surface: { dashboardId, widgets, dynamicViews, retryDynamicView }.
 *  - widgets (Phase 30 / MAT-V15-02): exposed so descendant renderers
 *    (AggregatedWidgetRenderer) can resolve per-table SpatialTarget eligibility
 *    via aggregateSpatialTargetsByTable without prop-drilling.
 *  - dynamicViews (Phase 35 / DV-V16-13): exposed so renderers can detect
 *    orphan widgets (`widget.config.dynamicViewId` set but no row in the
 *    dashboard's dynamic-view list). Single source of truth flows from the
 *    `useDynamicViewMaterializeChain` hook mounted in DashboardOpen — same
 *    array reference threaded through here AND through WidgetConfigModal +
 *    LayersModal props.
 *  - retryDynamicView (Phase 35 Plan 05 / DV-V16-13): exposed so the renderer
 *    error-state Retry button can re-fire the orchestrator hook's `retry(id)`
 *    cascade without importing the hook directly. Plan 35-03 destructured
 *    `retry` from `useDynamicViewMaterializeChain`; this plan threads it
 *    through to renderers via context.
 *
 * Fail-loud guard: useDashboardContext() THROWS on missing context (existing
 * Phase 15 contract preserved). Tests MUST wrap renderers in the provider with
 * ALL FOUR props (dashboardId, widgets, dynamicViews, retryDynamicView).
 *
 * Phase 15 consumers:
 *   - Plan 15-02 AggregatedWidgetRenderer (reads dashboardId for materializeFilter args)
 *   - Plan 15-05 logout / dashboard-switch lifecycle DO NOT use this hook — they read
 *     dashboardId from each FilterViewEntry instead (extended in 15-02 — entry.dashboardId).
 *
 * Phase 30 consumers:
 *   - Plan 30-02 AggregatedWidgetRenderer (reads widgets for aggregateSpatialTargetsByTable)
 *
 * Phase 35 consumers:
 *   - Plan 35-05 renderer orphan detection (reads dynamicViews to detect
 *     `widget.config.dynamicViewId` not in list) + Retry button binding.
 *
 * Phase 58 Plan 02 (ENGINE-V111-02/03):
 *   - applyWidgetAction: the single dispatch entry for the widget action engine.
 *     Optional on the provider to avoid breaking many existing specs that mount
 *     renderers with the 4-prop provider — missing specs that never dispatch an
 *     action are unaffected by the safe no-op default.
 */

export type DashboardContextValue = {
  dashboardId: number;
  widgets: WidgetDto[];
  dynamicViews: DynamicViewRow[];
  retryDynamicView: (dynamicViewId: number) => void;
  /**
   * Phase 58 (ENGINE-V111-02): single dispatch entry for the widget action engine.
   * Applies a transient config overlay to the target widget/layer/dynamicView.
   * NEVER persists to server — session-only; resets on dashboard-switch/logout.
   */
  applyWidgetAction: (action: WidgetAction) => WidgetActionResult;
};

const DashboardContext = createContext<DashboardContextValue | null>(null);

/**
 * Safe no-op default for applyWidgetAction.
 * Used when the provider does not supply an applyWidgetAction prop (e.g. test
 * fixtures that never dispatch actions). Returning target_not_found is the
 * safest possible no-op — callers handle it gracefully and no overlay is written.
 */
const noopApplyWidgetAction = (action: WidgetAction): WidgetActionResult => ({
  status: "target_not_found",
  target: action.target,
});

export const DashboardContextProvider = ({
  dashboardId,
  widgets,
  dynamicViews,
  retryDynamicView,
  applyWidgetAction = noopApplyWidgetAction,
  children,
}: {
  dashboardId: number;
  widgets: WidgetDto[];
  dynamicViews: DynamicViewRow[];
  retryDynamicView: (dynamicViewId: number) => void;
  /** Phase 58 (ENGINE-V111-02): optional — defaults to a safe no-op. */
  applyWidgetAction?: (action: WidgetAction) => WidgetActionResult;
  children: ReactNode;
}) => {
  // Memoize so consumers don't see a new context object identity on every
  // parent re-render when underlying props are unchanged.
  const value = useMemo(
    () => ({ dashboardId, widgets, dynamicViews, retryDynamicView, applyWidgetAction }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dashboardId, widgets, dynamicViews, retryDynamicView, applyWidgetAction],
  );
  return (
    <DashboardContext.Provider value={value}>
      {children}
    </DashboardContext.Provider>
  );
};

export const useDashboardContext = (): DashboardContextValue => {
  const ctx = useContext(DashboardContext);
  if (ctx === null) {
    throw new Error("useDashboardContext must be used inside DashboardContext.Provider");
  }
  return ctx;
};

/**
 * Lenient variant — returns null when no provider is mounted. Use this in
 * components whose specs render the component directly without a provider
 * (e.g. MapChartRenderer.spec.tsx legacy fixtures). Callers must handle the
 * null case with sensible defaults.
 *
 * Prefer `useDashboardContext()` for production code paths that MUST run
 * inside DashboardContextProvider — the hard error catches accidental
 * unwrapped renders early.
 */
export const useDashboardContextOptional = (): DashboardContextValue | null => {
  return useContext(DashboardContext);
};
