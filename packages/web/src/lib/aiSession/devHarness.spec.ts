import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { installAiDevHarness } from "./devHarness";
import { useAiSessionStore, hasUnsavedAiChanges } from "../../store/aiSessionStore";
import { useDashboardLayersStore } from "../../store/dashboardLayersStore";
import { useFilterStore } from "../../store/filterStore";
import { baselineFixture, mapWidget, recordsWidget, savedLayer } from "../../test/aiSessionHarness";

const baseline = baselineFixture();
type Row = Record<string, unknown>;

describe("devHarness feedback (GAP-134-02)", () => {
  let tableSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let uninstall: () => void;
  const h = () => window.__kbiAiHarness!;

  beforeEach(() => {
    useAiSessionStore.getState().reset();
    tableSpy = vi.spyOn(console, "table").mockImplementation(() => {});
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    uninstall = installAiDevHarness(
      {
        applyTurn: (input) => useAiSessionStore.getState().applyTurn(input, baseline),
        setCursor: (i) => useAiSessionStore.getState().setCursor(i, baseline),
        discard: () => useAiSessionStore.getState().reset(),
      },
      () => baseline.widgets,
    );
  });
  afterEach(() => {
    uninstall();
    useAiSessionStore.getState().reset();
    vi.restoreAllMocks();
  });

  const summary = (): Row => {
    const calls = (tableSpy.mock.calls as unknown[][]).map((c) => c[0] as Row[]).filter((rows: Row[]) => rows[0] && "visibleAiWidgets" in rows[0]);
    return calls[calls.length - 1][0];
  };
  const turnList = (): Row[] => {
    const calls = (tableSpy.mock.calls as unknown[][]).map((c) => c[0] as Row[]).filter((rows: Row[]) => rows[0] && "current" in rows[0]);
    return calls[calls.length - 1];
  };
  const build = () => {
    h().addWidget("records", "AI 1");
    h().patchWidget(42, { show_scale_bar: true });
    h().addWidget("records", "AI 2");
  };

  it("HFB-1: position row shows cursor, turn count and visible AI widgets after a build", () => {
    build();
    const s = summary();
    expect(s.cursor).toBe(2);
    expect(s.turnCount).toBe(3);
    expect(String(s.visibleAiWidgets)).toContain("AI 1");
    expect(String(s.visibleAiWidgets)).toContain("AI 2");
  });

  it("HFB-2: revert(0) reports cursor 0, hides AI 2 and marks turn 0 current", () => {
    build();
    h().revert(0);
    const s = summary();
    expect(s.cursor).toBe(0);
    expect(s.turnCount).toBe(3);
    expect(String(s.visibleAiWidgets)).toContain("AI 1");
    expect(String(s.visibleAiWidgets)).not.toContain("AI 2");
    const cur = turnList().filter((r) => r.current);
    expect(cur).toHaveLength(1);
    expect(cur[0].index).toBe(0);
  });

  it("HFB-3: revert(-1) shows none; forward(2) shows both", () => {
    build();
    h().revert(-1);
    expect(summary().cursor).toBe(-1);
    expect(summary().visibleAiWidgets).toBe("(none)");
    h().forward(2);
    expect(summary().cursor).toBe(2);
    expect(String(summary().visibleAiWidgets)).toMatch(/AI 1.*AI 2|AI 2.*AI 1/);
  });

  it("HFB-4: turn() and removeWidget() also log the position row", () => {
    h().addWidget("records", "AI 1");
    tableSpy.mockClear();
    h().turn([{ op: "patch", action: { target: { kind: "widget", id: 42 }, configPatch: { show_popup: false } } }]);
    expect(summary().turnCount).toBe(2);
    tableSpy.mockClear();
    const id = useAiSessionStore.getState().derived.addedWidgets[0].id;
    h().removeWidget(id);
    expect(summary().turnCount).toBe(3);
    expect(summary().visibleAiWidgets).toBe("(none)");
  });

  it("HFB-5: help() explains turn numbering and suggests show_scale_bar: true", () => {
    h().help();
    const out = (logSpy.mock.calls as unknown[][]).map((c) => String(c[0])).join("\n");
    expect(out).toContain("Turn indices include patch turns");
    expect(out).toContain("show_scale_bar: true");
  });
});

describe("devHarness Phase 136 ops (HARN6)", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let uninstall: () => void;
  const h = () => window.__kbiAiHarness!;
  const ops = (i = -1) => {
    const t = useAiSessionStore.getState().turns;
    const turn = t[i < 0 ? t.length + i : i];
    return turn.entries.map((e) => (e.op as { op: string } | null)?.op);
  };
  const install = (bl: ReturnType<typeof baselineFixture>) => {
    uninstall?.();
    uninstall = installAiDevHarness(
      {
        applyTurn: (input) => useAiSessionStore.getState().applyTurn(input, bl),
        setCursor: (i) => useAiSessionStore.getState().setCursor(i, bl),
        discard: () => useAiSessionStore.getState().reset(),
      },
      () => bl.widgets,
    );
  };
  const chartFields = { metric: "fare_amount", aggregation: "avg", groupByColumn: "vendor_id", color: "teal" };

  beforeEach(() => {
    useAiSessionStore.getState().reset();
    useDashboardLayersStore.getState().setLayers([]);
    vi.spyOn(console, "table").mockImplementation(() => {});
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    install(baselineFixture());
  });
  afterEach(() => {
    uninstall();
    useAiSessionStore.getState().reset();
    useDashboardLayersStore.getState().setLayers([]);
    vi.restoreAllMocks();
  });

  it("HARN6-1: addChart applies one add_widget turn with a negative tempId", () => {
    const res = h().addChart("bar", "Fares", 5, chartFields);
    expect(res.entries).toHaveLength(1);
    expect(res.entries[0].result.status).toBe("applied");
    expect((res.entries[0].op as { tempId: number }).tempId).toBeLessThan(0);
    expect(useAiSessionStore.getState().derived.addedWidgets).toHaveLength(1);
  });

  it("HARN6-2: editChart / changeType / renameWidget / setLayout each yield one matching op", () => {
    const id = (h().addChart("bar", "Fares", 5, chartFields).entries[0].op as { tempId: number }).tempId;
    h().editChart(id, { aggregation: "max" });
    expect(ops()).toEqual(["patch"]);
    h().changeType(id, "line");
    expect(ops()).toEqual(["change_widget_type"]);
    h().renameWidget(id, "x");
    expect(ops()).toEqual(["set_widget_title"]);
    h().setLayout([{ id, x: 0, y: 100, w: 18, h: 30 }]);
    expect(ops()).toEqual(["set_layout"]);
    expect(useAiSessionStore.getState().turns.every((t) => t.entries[0].result.status === "applied")).toBe(true);
  });

  it("HARN6-3: saved removal needs approveRemoval(); discard resets approval", () => {
    const first = h().removeWidget(50);
    expect(first.entries[0].result).toMatchObject({ status: "skipped", reason: "needs_confirmation" });
    const out = (logSpy.mock.calls as unknown[][]).map((c) => String(c[0])).join("\n");
    expect(out).toContain("approveRemoval()");
    h().approveRemoval();
    expect((h().state() as { removalApproved: boolean }).removalApproved).toBe(true);
    expect(h().removeWidget(50).entries[0].result.status).toBe("applied");
    h().discard();
    expect((h().state() as { removalApproved: boolean }).removalApproved).toBe(false);
  });

  const heat = { tableId: 5, spatialMode: "latlon" as const, latColumn: "lat", lonColumn: "lon", style: { colormap: "plasma" as const } };

  it("HARN6-4: addHeatmap host resolution, edit, visibility and removal", () => {
    // two maps, neither hosting table 5 -> ask: no turn
    expect(h().addHeatmap(heat)).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
    expect(useAiSessionStore.getState().turns).toHaveLength(0);
    // exactly one map hosts table 5
    const bl = baselineFixture({
      widgets: [mapWidget(42, { includedLayerIds: [7] }), mapWidget(43, { includedLayerIds: [8] }), recordsWidget(50)],
    });
    useDashboardLayersStore.getState().setLayers([savedLayer(7, { table_id: 5 }), savedLayer(8, { table_id: 1 })]);
    install(bl);
    const res = h().addHeatmap(heat)!;
    expect(res.entries[0].result.status).toBe("applied");
    expect((res.entries[0].op as { widgetId: number }).widgetId).toBe(42);
    const layerId = (res.entries[0].op as { tempId: number }).tempId;
    h().editHeatmap(layerId, { blurRadius: 12 });
    expect(ops()).toEqual(["patch"]);
    expect(useAiSessionStore.getState().turns.at(-1)!.entries[0].result.status).toBe("applied");
    const before = useAiSessionStore.getState().turns.length;
    h().setLayerVisible(layerId, false);
    expect(useAiSessionStore.getState().tempLayerVisibility[layerId]).toBe(false);
    expect(useAiSessionStore.getState().turns).toHaveLength(before);
    h().setLayerVisible(7, false);
    expect(ops()).toEqual(["patch"]);
    h().removeLayer(layerId);
    expect(ops()).toEqual(["remove_layer"]);
    expect(useAiSessionStore.getState().derived.addedLayers).toHaveLength(0);
  });

  it("HARN6-5: help() lists methods, palette names and ramps, and keeps turn numbering", () => {
    h().help();
    const out = (logSpy.mock.calls as unknown[][]).map((c) => String(c[0])).join("\n");
    for (const m of ["addChart", "editChart", "changeType", "renameWidget", "setLayout", "addHeatmap", "editHeatmap", "setLayerVisible", "removeLayer", "approveRemoval"]) {
      expect(out).toContain(m);
    }
    expect(out).toContain("violet");
    expect(out).toContain("YlOrRd");
    expect(out).toContain("Turn indices include patch turns");
  });

  it("HARN6-6: state() exposes removalApproved, aiEditedWidgetIds and layout", () => {
    const st = h().state() as Record<string, unknown>;
    expect(st.removalApproved).toBe(false);
    expect(Array.isArray(st.aiEditedWidgetIds)).toBe(true);
    expect(st.layout).toEqual({});
  });

  it("HARN6-9: no map on the dashboard: addChart map then addHeatmap resolves to the new temp map (D-12)", () => {
    install(baselineFixture({ widgets: [recordsWidget(50)], layers: [] }));
    expect(h().addHeatmap(heat)).toBeNull();
    const mapId = (h().addChart("map", "Trips map").entries[0].op as { tempId: number }).tempId;
    const res = h().addHeatmap({ tableId: 5, spatialMode: "latlon", latColumn: "lat", lonColumn: "lon" })!;
    expect(res.entries[0].result.status).toBe("applied");
    expect((res.entries[0].op as { widgetId: number }).widgetId).toBe(mapId);
    const map = useAiSessionStore.getState().derived.addedWidgets.find((w) => w.id === mapId)!;
    expect(map.config.basemapLight).toBeDefined();
    expect(map.config.basemapDark).toBeDefined();
  });
});

describe("devHarness chat helpers (137-10)", () => {
  const baselineH = baselineFixture();
  let uninstall: () => void;
  const h = () => window.__kbiAiHarness!;
  beforeEach(() => {
    vi.useFakeTimers();
    useAiSessionStore.getState().reset();
    vi.spyOn(console, "table").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    uninstall = installAiDevHarness(
      {
        applyTurn: (input) => useAiSessionStore.getState().applyTurn(input, baselineH),
        setCursor: (i) => useAiSessionStore.getState().setCursor(i, baselineH),
        discard: () => useAiSessionStore.getState().reset(),
      },
      () => baselineH.widgets,
    );
  });
  afterEach(() => {
    uninstall();
    useAiSessionStore.getState().reset();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("HARN7-1: chatTurn adds an ok turn with clarifications and follow-ups, no ops applied", () => {
    const clar = { kind: "choose_option" as const, question: "Which total do you mean?", options: [{ id: "1", label: "Fare" }, { id: "2", label: "Tip" }] };
    h().chatTurn("Which total?", "Which total do you mean?", { clarifications: [clar], followUps: ["Show by month"] });
    const t = useAiSessionStore.getState().turns;
    expect(t).toHaveLength(1);
    expect(t[0].chat?.status).toBe("ok");
    expect(t[0].chat?.followUps).toEqual(["Show by month"]);
    expect(t[0].chat?.clarifications?.[0].question).toBe("Which total do you mean?");
    expect(t[0].entries).toHaveLength(0);
  });

  it("HARN7-2: error and cancelled turns are recorded and do not lock editing", () => {
    h().chatTurn("q", "", { status: "error", message: "The AI provider could not complete this answer. Try again.", retryable: true });
    h().chatTurn("q", "", { status: "cancelled" });
    const t = useAiSessionStore.getState().turns;
    expect(t.map((x) => x.chat?.status)).toEqual(["error", "cancelled"]);
    expect(t[0].chat?.retryable).toBe(true);
    expect(hasUnsavedAiChanges()).toBe(false);
  });

  it("HARN7-3: fakeRun runs then goes idle, never fetching", () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    h().fakeRun("Adding a chart…", 15000);
    expect(useAiSessionStore.getState().run.status).toBe("running");
    expect(useAiSessionStore.getState().run.line).toBe("Adding a chart…");
    vi.advanceTimersByTime(15000);
    expect(useAiSessionStore.getState().run.status).toBe("idle");
    expect(f).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("HARN7-4: help mentions chatTurn and fakeRun", () => {
    h().help();
    const out = String((console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1)?.[0]);
    expect(out).toContain("chatTurn");
    expect(out).toContain("fakeRun");
  });
});

describe("filter helpers (138)", () => {
  const apply = vi.fn((input: unknown) => ({ turnId: "t", entries: [] as never[], input }));
  let uninstall: () => void;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;
  const h = () => window.__kbiAiHarness!;
  const lastOps = () => (apply.mock.calls[apply.mock.calls.length - 1][0] as { ops: unknown[] }).ops;

  beforeEach(() => {
    apply.mockClear();
    useAiSessionStore.getState().reset();
    useFilterStore.getState().reset();
    vi.spyOn(console, "table").mockImplementation(() => {});
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    uninstall = installAiDevHarness(
      { applyTurn: apply as never, setCursor: () => {}, discard: () => {} },
      () => baseline.widgets,
      () => [{ id: 5, columns: { fare_amount: "double", payment_type: "varchar(16)", vendor_id: "int" } }],
    );
  });
  afterEach(() => {
    uninstall();
    useAiSessionStore.getState().reset();
    useFilterStore.getState().reset();
    vi.restoreAllMocks();
  });

  it("HARNF-1: filter applies a coerced typed op through applyTurn", () => {
    h().filter("table", 5, "fare_amount", "between", ["1", "5"]);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(lastOps()).toEqual([
      { op: "apply_filter", source: { kind: "table", id: 5 }, filters: [{ column: "fare_amount", operator: "between", value: [1, 5], dataType: "number" }] },
    ]);
    h().filter("table", 5, "payment_type", undefined, "Credit");
    expect(lastOps()).toEqual([
      { op: "apply_filter", source: { kind: "table", id: 5 }, filters: [{ column: "payment_type", operator: "eq", value: "Credit", dataType: "string" }] },
    ]);
  });

  it("HARNF-2: a value that does not fit the column type is refused with a warning", () => {
    expect(h().filter("table", 5, "fare_amount", "eq", "abc")).toBeNull();
    expect(apply).not.toHaveBeenCalled();
    expect(String(warnSpy.mock.calls[0]?.[0])).toContain("fare_amount");
  });

  it("HARNF-3: clearFilter all / one column", () => {
    h().clearFilter();
    expect(lastOps()).toEqual([{ op: "clear_filter" }]);
    h().clearFilter("table", 5, "vendor_id");
    expect(lastOps()).toEqual([{ op: "clear_filter", source: { kind: "table", id: 5 }, column: "vendor_id" }]);
  });

  it("HARNF-4: highlight triggers the outline directly", () => {
    const before = useAiSessionStore.getState().highlight.nonce;
    h().highlight([42, 50]);
    const hl = useAiSessionStore.getState().highlight;
    expect(hl.ids).toEqual([42, 50]);
    expect(hl.nonce).toBeGreaterThan(before);
  });

  it("HARNF-5: filterState lists filters per source with AI marker plus lock info", () => {
    useFilterStore.getState().addFilter(5, { column: "payment_type", value: "Credit", dataType: "string", addedAt: 1, aiApplied: true });
    useFilterStore.getState().addDvFilter(90, { column: "fare", value: 5, dataType: "number", addedAt: 2 });
    const st = h().filterState() as {
      filters: Record<string, Row[]>;
      cursor: number;
      hasUnsavedAiChanges: boolean;
      turnsWithFilterDeltas: number;
    };
    expect(st.filters["table:5"]).toEqual([{ column: "payment_type", operator: "eq", value: "Credit", aiApplied: true }]);
    expect(st.filters["dynamicView:90"]).toEqual([{ column: "fare", operator: "eq", value: 5, aiApplied: false }]);
    expect(st.cursor).toBe(-1);
    expect(st.hasUnsavedAiChanges).toBe(false);
    expect(st.turnsWithFilterDeltas).toBe(0);
  });

  it("HARNF-6: dynamic view filters keep numbers numeric and strings as strings", () => {
    h().filter("dynamicView", 90, "fare", "eq", 5);
    expect(lastOps()).toEqual([
      { op: "apply_filter", source: { kind: "dynamicView", id: 90 }, filters: [{ column: "fare", operator: "eq", value: 5, dataType: "number" }] },
    ]);
    h().filter("dynamicView", 90, "zone", "eq", "East");
    expect((lastOps()[0] as { filters: Row[] }).filters[0]).toEqual({ column: "zone", operator: "eq", value: "East", dataType: "string" });
  });

  it("HARNF-7: help lists the filter helpers", () => {
    h().help();
    const text = String(logSpy.mock.calls[logSpy.mock.calls.length - 1][0]);
    for (const k of ["filter(", "clearFilter(", "highlight(", "filterState()"]) expect(text).toContain(k);
  });
});
