/**
 * 138-05 Task 3: an AI filter and the equivalent click produce the SAME materialize request and the SAME
 * combination views (vizToHash) through the REAL orchestrator, for widgets, records tables, map layers and dvs.
 *
 * Not provable here: map TILES narrowing against real Kinetica (jsdom has no WMS). That is SC4, operator
 * human-verify in 138-08. This spec proves the structural precondition: the layer's "l:<id>" key resolves to the
 * same combination view hash as after a click, which is what MapChartRenderer reads.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import type { Mock } from "vitest";
import type { AiOp } from "@kinetica-bi/shared";

import { useCombinationOrchestrator } from "./useCombinationOrchestrator";
import { useFilterStore, type ActiveFilter } from "../store/filterStore";
import { useFilterCombinationStore } from "../store/filterCombinationStore";
import { useDynamicViewStore } from "../store/dynamicViewStore";
import { useAuthStore } from "../store/auth";
import { stableComboHash } from "../lib/stableComboHash";
import { executeFilterOp } from "../lib/aiOps/aiFilterApplier";
import type { WidgetDto, DashboardLayerDto } from "../api/client";

vi.mock("../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client")>();
  return { ...actual, materializeFilter: vi.fn(), dropCombinationView: vi.fn() };
});
import { materializeFilter, dropCombinationView } from "../api/client";

const DASH_ID = 42;
const A = 100;
const DV = 90;
const BAR = 1;
const REC = 2;
const LAYER = 5;

const widget = (id: number, type: string, config: Record<string, unknown>): WidgetDto => ({
  id, dashboard_id: DASH_ID, title: `W${id}`, type, position: 0,
  config, created_at: "2026-06-01T00:00:00Z", updated_at: "2026-06-01T00:00:00Z",
});
const layer = (id: number, tableId: number): DashboardLayerDto => ({
  id, dashboard_id: DASH_ID, table_id: tableId, layer_type: "KineticaWms", position: 0, config: {},
  info_enabled: 0, info_columns: null, info_template: null, dynamic_view_id: null,
  cb_config: null, track_config: null, created_at: "2026-06-01T00:00:00Z", updated_at: "2026-06-01T00:00:00Z",
});

const TABLE_WIDGETS = [widget(BAR, "bar", { tableId: A }), widget(REC, "records", { tableId: A })];
const LAYERS = [layer(LAYER, A)];
const CLICK: ActiveFilter = { column: "payment_type", value: "Credit", dataType: "string", sourceWidgetId: BAR, addedAt: 1 };
const AI_APPLY_A = {
  op: "apply_filter", source: { kind: "table", id: A },
  filters: [{ column: "payment_type", operator: "eq", value: "Credit", dataType: "string" }],
} as unknown as AiOp;
const AI_APPLY_DV = {
  op: "apply_filter", source: { kind: "dynamicView", id: DV },
  filters: [{ column: "payment_type", operator: "eq", value: "Credit", dataType: "string" }],
} as unknown as AiOp;

type Call = { combinationKey: string; tableId?: number; dynamicViewId?: number; filters: ActiveFilter[]; dashboardId: number };
const strip = (fs: ActiveFilter[]) => fs.map(({ addedAt: _a, sourceWidgetId: _s, aiApplied: _i, ...rest }) => rest);

function resetAll() {
  useFilterCombinationStore.getState().reset();
  useFilterStore.getState().reset();
  useDynamicViewStore.getState().reset();
  useAuthStore.setState({ maxCombinationViewsPerTable: 10, dvFilterScopeDisabled: false } as Parameters<typeof useAuthStore.setState>[0]);
  (materializeFilter as Mock).mockReset();
  (materializeFilter as Mock).mockResolvedValue({ viewName: "_kbi_combo_v", expiresAt: 9_999_999_999 });
  (dropCombinationView as Mock).mockReset();
  (dropCombinationView as Mock).mockResolvedValue({});
}

async function settle(expectCalls: number) {
  act(() => {
    vi.advanceTimersByTime(310);
  });
  if (expectCalls > 0) await waitFor(() => expect(materializeFilter).toHaveBeenCalledTimes(expectCalls));
  await act(async () => {
    await Promise.resolve();
  });
}

/** Mount the real orchestrator, run `change`, return what it POSTed and the resulting viz -> hash map. */
async function run(widgets: WidgetDto[], layers: DashboardLayerDto[], change: () => void, expectCalls = 1) {
  resetAll();
  const { unmount } = renderHook(() => useCombinationOrchestrator(DASH_ID, widgets, layers));
  act(() => change());
  await settle(expectCalls);
  const calls = (materializeFilter as Mock).mock.calls.map((c: unknown[]) => c[0] as Call);
  const vizToHash = { ...useFilterCombinationStore.getState().vizToHash };
  unmount();
  return { calls, vizToHash };
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("AI filter == click through the real orchestrator (138-05)", () => {
  it("ORCHF-1 (SC1): table filter -> same POST and same vizToHash for chart, records and map layer", async () => {
    const click = await run(TABLE_WIDGETS, LAYERS, () => useFilterStore.getState().addFilter(A, CLICK));
    const ai = await run(TABLE_WIDGETS, LAYERS, () => {
      expect(executeFilterOp(AI_APPLY_A)).toHaveLength(1);
    });

    expect(ai.calls).toHaveLength(click.calls.length);
    expect(ai.calls[0].combinationKey).toBe(click.calls[0].combinationKey);
    expect(ai.calls[0].tableId).toBe(A);
    expect(strip(ai.calls[0].filters)).toEqual(strip(click.calls[0].filters));

    const expected = stableComboHash("table", A, [CLICK]);
    for (const k of [`w:${BAR}`, `w:${REC}`, `l:${LAYER}`]) {
      expect(click.vizToHash[k], `click ${k}`).toBe(expected);
      expect(ai.vizToHash[k], `ai ${k}`).toBe(expected);
    }
  });

  it("ORCHF-2 (D-03): dv filter -> same POST and hash as a dv click", async () => {
    const dvWidget = widget(10, "bar", { dynamicViewId: DV });
    const seed = () =>
      useDynamicViewStore.setState((s) => ({
        views: { ...s.views, [DV]: { status: "materialized", viewName: `_kbi_dv_${DV}` } },
        dynamicViewVersion: s.dynamicViewVersion + 1,
      }));
    const click = await run([dvWidget], [], () => {
      seed();
      useFilterStore.getState().addDvFilter(DV, { ...CLICK, sourceWidgetId: 10 });
    });
    const ai = await run([dvWidget], [], () => {
      seed();
      executeFilterOp(AI_APPLY_DV);
    });
    expect(click.calls[0].dynamicViewId).toBe(DV);
    expect(ai.calls[0].dynamicViewId).toBe(DV);
    expect(ai.calls[0].combinationKey).toBe(click.calls[0].combinationKey);
    expect(strip(ai.calls[0].filters)).toEqual(strip(click.calls[0].filters));
    expect(ai.vizToHash["w:10"]).toBe(click.vizToHash["w:10"]);
    expect(ai.vizToHash["w:10"]).toBe(stableComboHash("dv", DV, [CLICK]));
  });

  it("ORCHF-3: AI clear leaves the same vizToHash state as the chip x", async () => {
    const afterChipX = await run(TABLE_WIDGETS, LAYERS, () => {
      useFilterStore.getState().addFilter(A, CLICK);
      useFilterStore.getState().removeFilter(A, "payment_type");
    }, 0);
    const afterAiClear = await run(TABLE_WIDGETS, LAYERS, () => {
      executeFilterOp(AI_APPLY_A);
      executeFilterOp({ op: "clear_filter", source: { kind: "table", id: A }, column: "payment_type" } as AiOp);
    }, 0);
    expect(afterAiClear.vizToHash).toEqual(afterChipX.vizToHash);
    for (const k of [`w:${BAR}`, `w:${REC}`, `l:${LAYER}`]) expect(afterAiClear.vizToHash[k]).toBeUndefined();
    expect(afterAiClear.calls).toHaveLength(afterChipX.calls.length);
  });

  it("ORCHF-4 (Pitfall 2, D-18): allow-list widget takes the click filter but NOT the AI filter", async () => {
    const scoped = widget(3, "records", { tableId: A, filterSelection: { sourceMode: "allowlist", allowedSourceWidgetIds: [BAR] } });
    const all = [...TABLE_WIDGETS, scoped];
    const click = await run(all, [], () => useFilterStore.getState().addFilter(A, CLICK));
    expect(click.vizToHash["w:3"]).toBe(stableComboHash("table", A, [CLICK]));

    const ai = await run(all, [], () => {
      executeFilterOp(AI_APPLY_A);
    });
    expect(ai.vizToHash[`w:${BAR}`]).toBe(stableComboHash("table", A, [CLICK]));
    expect(ai.vizToHash["w:3"]).toBeUndefined();
  });
});
