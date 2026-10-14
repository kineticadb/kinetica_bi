---
phase: 137-ai-widget-streaming-ui
plan: 11
subsystem: web/dashboards
tags: [ai, dashboards-page, rbac-ui, askcontext]
requires: [137-04, 137-05, 137-07, 137-09]
provides: [picker gate, 12x40 add, duplicate gate, AiChangeBar mount, shared AskContext, cancelAsk on leave]
affects: [DashboardsPage]
key-files:
  modified:
    - packages/web/src/components/DashboardsPage.tsx
  created:
    - packages/web/src/components/DashboardsPage.aiWidget.spec.tsx
requirements: [AIWID-V20-01, AIWID-V20-02, AIGOV-V20-01, AISES-V20-04, AIWID-V20-04]
metrics:
  completed: 2026-10-14
---

# Phase 137 Plan 11: DashboardsPage AI wiring Summary

DashboardsPage now gates the AI Assistant on ai:use plus an AI-enabled server, adds it at 12x40, mounts the Keep/Discard bar in place of the old lock notice, hands every AI widget one shared AskContext, and cancels a running ask on leave.

## Tasks

1. Picker gate, 12x40 add, duplicate gate: commit 77371e1. `getVisualizationTypes(canUseAi)`; `useAiConfigured` is called with `hasPermission(AI_USE) && showVizModal` so availability is fetched only when the picker is open. `handleAddVisualization` early-returns for the ai type without permission and uses `AI_ASSISTANT_DEFAULT_SIZE`. Duplicate reads permission at call time and shows the error toast.
2. Bar mount, AskContext, cancelAsk: commit 757a34c. `<AiChangeBar savedWidgets savedLayers/>` sits after the header ternary and before the error line (outside the portalled header). The `config-hint` notice is removed. `aiAskContext` is a useMemo keyed on `dashboard.id`, reading latest values via a ref (`tables` is a getter). `cancelAsk()` runs before `useAiSessionStore.getState().reset()` in the `[dashboard.id]` cleanup.

## Grep criteria (pre vs post)

- `canUseAi|AI_ASSISTANT_DEFAULT_SIZE` 0 -> present (>=3 / >=1); `AiChangeBar|cancelAsk|buildAskSnapshot` 0 -> 1 each.
- `config-hint" role="status"` 1 -> 0 (verified post-change).
- `installAiDevHarness` stays at 1.

## Tests

New spec `DashboardsPage.aiWidget.spec.tsx` DPAI-1..7 (7 tests). DPAI-1 asserts the real list is non-empty (>3 labels) so "AI absent" is not vacuous, and that `useAiConfigured` is never called with true.

## Deviations from Plan

- DPAI-7 verifies ordering via a direct `unmount()` with a populated session. Through the Back + "Discard and leave" dialog path the leave guard resets the session before unmount, so `cancelAsk` there runs after the reset; the runner's epoch check covers that late-result case. The cleanup-effect order (cancel then reset) is what the test pins.
- DPAI-6 captures the `ai` prop by wrapping DashboardContextProvider in a mock (AiWidgetRenderer from 137-10 did not exist yet), rather than a consumer widget.
- The spec registers chart types with `registerAllChartTypes()` (the registry is empty in specs by default).
- Existing aiLock/aiSession/aiLeave specs needed NO repairs (AILOCK-10 still passes: the bar is `role="status"` with "Editing is locked" text). Their files were not modified.

## Gates

- `npx tsc --noEmit` clean.
- `npx vitest run --maxWorkers=4`: 232 files passed, 1 skipped; 4755 tests passed.
- theme-guard: 172 passed.

## Operator visual check (light and dark)

- The Keep/Discard bar as a full-width strip under the dashboard header, in both topbar-portal mode and non-portal mode (`.dashboard-open-header`); spacing against the grid and the filter bar.
- Picker shows "AI Assistant" tile only for a Use-AI user with AI enabled; a newly added AI widget lands 12 x 40 without overlapping.
- No visible lock notice remains in the header.

## Self-Check: PASSED

- FOUND: DashboardsPage.aiWidget.spec.tsx; commits 77371e1 and 757a34c exist.
