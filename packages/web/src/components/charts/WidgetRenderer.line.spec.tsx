/**
 * WidgetRenderer.line.spec.tsx — Phase 132 Plan 04 (LINE-V126-01..04).
 *
 * Behavioural proof for the rewritten LineRenderer. WidgetRenderer.spec.tsx's recharts mock is
 * file-wide and strips props (`interval`, `connectNulls`, `dot`, `onClick`), so this NEW file uses a
 * prop-CAPTURING mock: every mocked recharts component records its props and renders its children.
 */
import React, { cloneElement } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor, act, cleanup, screen } from "@testing-library/react";
import { Line, Area, XAxis, YAxis, Tooltip } from "recharts";
import WidgetRenderer from "./WidgetRenderer";
import { DashboardContextProvider } from "../DashboardContext";
import * as clientModule from "../../api/client";
import type { WidgetDto, CustomMetricRow } from "../../api/client";
import { useCustomMetricsStore } from "../../store/customMetricsStore";
import { useDynamicViewStore } from "../../store/dynamicViewStore";
import { useFilterStore } from "../../store/filterStore";
import { useColumnDisplayConfigStore } from "../../store/columnDisplayConfigStore";
import { themeColorsFor, getCbColorTheme } from "../../lib/cbColorThemes";

const { captured } = vi.hoisted(() => ({ captured: {} as Record<string, Array<Record<string, unknown>>> }));

vi.mock("recharts", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const R = await import("react");
  const cap = (name: string) => (props: Record<string, unknown>) => {
    (captured[name] ??= []).push(props);
    return R.createElement("div", { "data-testid": `rc-${name}` }, props.children as React.ReactNode);
  };
  return {
    ...actual,
    ResponsiveContainer: cap("ResponsiveContainer"),
    LineChart: cap("LineChart"),
    AreaChart: cap("AreaChart"),
    Line: cap("Line"),
    Area: cap("Area"),
    XAxis: cap("XAxis"),
    YAxis: cap("YAxis"),
    Tooltip: cap("Tooltip"),
    Legend: cap("Legend"),
    CartesianGrid: cap("CartesianGrid"),
  };
});

let mockVizToHash: Record<string, string | undefined> = {};
let mockRegistry: Record<string, { viewName: string; expiresAt: number; materializing: boolean }> = {};
let mockCombinationVersion = 0;

vi.mock("../../store/filterCombinationStore", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const useFilterCombinationStore = ((selector?: (s: unknown) => unknown) => {
    const state = { vizToHash: mockVizToHash, registry: mockRegistry, combinationVersion: mockCombinationVersion };
    return selector ? selector(state) : state;
  }) as unknown as { getState: () => unknown };
  useFilterCombinationStore.getState = () => ({
    vizToHash: mockVizToHash,
    registry: mockRegistry,
    combinationVersion: mockCombinationVersion,
    clearEntry: vi.fn(),
  });
  return { ...actual, useFilterCombinationStore };
});

vi.mock("../../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/client")>();
  return {
    ...actual,
    runSql: vi.fn(),
    materializeFilter: vi.fn(),
    dropFilterView: vi.fn(),
    listColumnDisplayConfig: vi.fn().mockResolvedValue([]),
    listCustomMetrics: vi.fn().mockResolvedValue([]),
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(captured)) delete captured[k];
  mockVizToHash = {};
  mockRegistry = {};
  mockCombinationVersion = 0;
  useCustomMetricsStore.getState().reset();
  useDynamicViewStore.getState().reset();
  useFilterStore.setState({ filters: {}, dvFilters: {} });
  useColumnDisplayConfigStore.setState({ configs: {} } as never);
  vi.mocked(clientModule.listCustomMetrics).mockResolvedValue([]);
  vi.mocked(clientModule.listColumnDisplayConfig).mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const wrap = (ui: React.ReactNode) => (
  <DashboardContextProvider dashboardId={1} widgets={[]} dynamicViews={[]} retryDynamicView={() => {}}>
    {ui}
  </DashboardContextProvider>
);

const TABLE_ID = 7;

const makeWidget = (config: Record<string, unknown>): WidgetDto => ({
  id: 501,
  dashboard_id: 1,
  title: "Line",
  type: "line",
  position: 0,
  config: { tableId: TABLE_ID, ...config },
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
});

type R = Record<string, unknown>;

function buildResponse(rows: R[]): Record<string, unknown> {
  const keys = Object.keys(rows[0] ?? {});
  const out: Record<string, unknown> = {
    column_headers: keys,
    column_datatypes: keys.map(() => "string"),
  };
  keys.forEach((k, i) => {
    out[`column_${i + 1}`] = rows.map((r) => r[k]);
  });
  return out;
}

const SINGLE_SQL = "SELECT region, SUM(fare) AS value FROM demo.t GROUP BY region LIMIT 500";
const MULTI_SQL = "SELECT day, payment_type, SUM(fare) AS value FROM demo.t GROUP BY day, payment_type LIMIT 12000";

async function renderLine(config: Record<string, unknown>, rows: R[]) {
  vi.mocked(clientModule.runSql).mockResolvedValue(buildResponse(rows) as never);
  const sql = Array.isArray(config.groupByColumns) && (config.groupByColumns as string[]).length >= 2 ? MULTI_SQL : SINGLE_SQL;
  const utils = render(wrap(<WidgetRenderer widget={makeWidget({ sql, ...config })} />));
  await waitFor(() => expect(captured.LineChart ?? captured.AreaChart).toBeTruthy());
  return utils;
}

function chartKids(): { chart: Record<string, unknown>; kids: React.ReactElement[]; name: string } {
  const lc = captured.LineChart?.at(-1);
  const ac = captured.AreaChart?.at(-1);
  const chart = (lc ?? ac) as Record<string, unknown>;
  const kids = React.Children.toArray(chart.children as React.ReactNode) as React.ReactElement[];
  return { chart, kids, name: lc ? "LineChart" : "AreaChart" };
}
const ofType = (t: unknown) => chartKids().kids.filter((k) => k.type === t);
const lines = () => ofType(Line).map((k) => k.props as R);
const xAxis = () => ofType(XAxis)[0].props as R;
const yAxis = () => ofType(YAxis)[0].props as R;
const chartData = () => chartKids().chart.data as R[];

const MULTI_CFG = {
  groupByColumns: ["day", "payment_type"],
  groupByColumn: "day",
  metricColumn: "fare",
  aggregation: "SUM",
};
const MULTI_ROWS: R[] = [
  { day: "Mon", payment_type: "Cash", value: 10 },
  { day: "Mon", payment_type: "Credit", value: 20 },
  { day: "Tue", payment_type: "Credit", value: 25 },
  { day: "Wed", payment_type: "Cash", value: 12 },
  { day: "Wed", payment_type: "Credit", value: 22 },
];
const SINGLE_CFG = { groupByColumn: "region", metricColumn: "fare", aggregation: "SUM" };
const SINGLE_ROWS: R[] = [
  { region: "West", value: 3 },
  { region: "East", value: 5 },
];

describe("LineRenderer multi-series (Phase 132)", () => {
  it("L132-1 multi lines: one Line per series, gaps, no animation", async () => {
    await renderLine(MULTI_CFG, MULTI_ROWS);
    expect(chartKids().name).toBe("LineChart");
    const ls = lines();
    expect(ls.map((l) => l.dataKey)).toEqual(["Credit", "Cash"]);
    expect(ls.map((l) => l.name)).toEqual(["Credit", "Cash"]);
    for (const l of ls) {
      expect(l.connectNulls).toBe(false);
      expect(l.isAnimationActive).toBe(false);
      expect(l.activeDot).toEqual({ r: 5 });
      expect(l.strokeWidth).toBe(2);
    }
    expect(chartData().map((r) => r.bucket)).toEqual(["Mon", "Tue", "Wed"]);
    expect(chartData().find((r) => r.bucket === "Tue")?.Cash).toBeNull();
  });

  it("L132-2 palette is Set2 in series order", async () => {
    await renderLine(MULTI_CFG, MULTI_ROWS);
    const expected = themeColorsFor(getCbColorTheme("Set2")!, 2).map((c) => "#" + c.slice(2).toLowerCase());
    expect(lines().map((l) => String(l.stroke).toLowerCase())).toEqual(expected);
  });

  it("L132-3 blank builder row is not a series", async () => {
    await renderLine(
      { ...SINGLE_CFG, groupByColumn: "day", groupByColumns: ["day", ""] },
      [
        { day: "Mon", value: 1 },
        { day: "Tue", value: 2 },
      ],
    );
    const ls = lines();
    expect(ls).toHaveLength(1);
    expect(ls[0].dataKey).toBe("value");
    expect(ls.some((l) => l.name === "undefined")).toBe(false);
  });

  it("L132-4 X sort multi numeric", async () => {
    await renderLine({ ...MULTI_CFG, groupByColumns: ["hour", "payment_type"], groupByColumn: "hour" }, [
      { hour: 10, payment_type: "Cash", value: 1 },
      { hour: 2, payment_type: "Cash", value: 2 },
      { hour: 1, payment_type: "Cash", value: 3 },
    ]);
    expect(chartData().map((r) => r.bucket)).toEqual(["1", "2", "10"]);
  });

  it("L132-5 X sort single (numbers, then text)", async () => {
    await renderLine({ groupByColumn: "hour", metricColumn: "fare", aggregation: "SUM" }, [
      { hour: 10, value: 1 },
      { hour: 2, value: 5 },
      { hour: 1, value: 3 },
    ]);
    expect(chartData().map((r) => r.hour)).toEqual([1, 2, 10]);
    cleanup();
    for (const k of Object.keys(captured)) delete captured[k];
    await renderLine({ groupByColumn: "hour", metricColumn: "fare", aggregation: "SUM" }, [
      { hour: "b", value: 1 },
      { hour: "A", value: 5 },
      { hour: "c", value: 3 },
    ]);
    expect(chartData().map((r) => r.hour)).toEqual(["A", "b", "c"]);
  });

  it("L132-6 legacy single series unchanged", async () => {
    await renderLine({ ...SINGLE_CFG, color: "rebeccapurple" }, SINGLE_ROWS);
    const ls = lines();
    expect(ls).toHaveLength(1);
    expect(ls[0].dataKey).toBe("value");
    expect(ls[0].stroke).toBe("rebeccapurple");
    expect(ls[0].dot).toEqual({ r: 3 });
    expect(ls[0].type).toBe("monotone");
    expect(ls[0].name).toBe("Sum of fare");
    expect(screen.queryByTestId("line-truncated-note")).toBeNull();
  });

  it("L132-7 titles: Y axis + legend name use the metric title", async () => {
    await renderLine(SINGLE_CFG, SINGLE_ROWS);
    const label = yAxis().label as R;
    expect(label.value).toBe("Sum of fare");
    expect(label.angle).toBe(-90);
    expect(label.position).toBe("insideLeft");
    cleanup();
    for (const k of Object.keys(captured)) delete captured[k];

    await renderLine({ ...SINGLE_CFG, yFieldLabel: "Revenue" }, SINGLE_ROWS);
    expect((yAxis().label as R).value).toBe("Revenue");
    expect(lines()[0].name).toBe("Revenue");
    cleanup();
    for (const k of Object.keys(captured)) delete captured[k];

    vi.mocked(clientModule.listColumnDisplayConfig).mockResolvedValue([
      {
        table_id: TABLE_ID,
        column_name: "fare",
        label: "Fare ($)",
        format_spec: null,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      },
    ] as never);
    await renderLine(SINGLE_CFG, SINGLE_ROWS);
    await waitFor(() => expect((yAxis().label as R).value).toBe("Fare ($)"));
    expect(lines()[0].name).toBe("Fare ($)");
    cleanup();
    for (const k of Object.keys(captured)) delete captured[k];

    vi.mocked(clientModule.listColumnDisplayConfig).mockResolvedValue([]);
    await renderLine(MULTI_CFG, MULTI_ROWS);
    expect((yAxis().label as R).value).toBe("Sum of fare");
    const names = lines().map((l) => l.name);
    expect(names).not.toContain("Sum of fare");
    expect(names).not.toContain("value");
  });

  it("L132-8 custom metric label names the line and the Y axis", async () => {
    const metric: CustomMetricRow = {
      id: 2,
      table_id: TABLE_ID,
      label: "try_again",
      expression: "AVG(x)",
      format_spec: null,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    };
    vi.mocked(clientModule.listCustomMetrics).mockResolvedValue([metric]);
    useCustomMetricsStore.getState().setConfig(TABLE_ID, [metric]);
    await renderLine({ groupByColumn: "region", metricId: 2, metricColumn: "", aggregation: "AVG" }, SINGLE_ROWS);
    expect(lines()[0].name).toBe("try_again");
    expect((yAxis().label as R).value).toBe("try_again");
  });

  it("L132-9 tooltip props", async () => {
    await renderLine(MULTI_CFG, MULTI_ROWS);
    const tip = ofType(Tooltip)[0].props as R;
    const content = tip.content as React.ReactElement<R>;
    expect(content.props.multiSeries).toBe(true);
    expect(content.props.groupByColumn).toBe("day");
    render(
      cloneElement(content as React.ReactElement<R>, {
        active: true,
        payload: [{ name: "Cash", value: 5, color: "var(--chart-1)" }],
        label: "Tue",
      }),
    );
    expect(screen.getAllByText(/Cash: 5/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/fare: 5/)).toBeNull();
    cleanup();
    for (const k of Object.keys(captured)) delete captured[k];

    await renderLine(SINGLE_CFG, SINGLE_ROWS);
    const sc = (ofType(Tooltip)[0].props as R).content as React.ReactElement<R>;
    expect(sc.props.metricTitle).toBe("Sum of fare");
    expect(sc.props.multiSeries).toBeFalsy();
  });

  it("L132-10 dots: isolation overrides showDots and density", async () => {
    type Dot = (p: R) => React.ReactElement;
    const dotOf = () => lines()[0].dot as Dot;
    const normal = { key: "d", cx: 1, cy: 2, index: 1, points: [{ y: 5 }, { y: 6 }, { y: 7 }], stroke: "red" };
    const missing = { key: "d", cx: null, cy: null, index: 0, points: [{ y: null }], stroke: "red" };
    const isolated = { key: "d", cx: 1, cy: 2, index: 1, points: [{ y: null }, { y: 5 }, { y: null }], stroke: "red" };
    const day3 = [
      { day: "A", payment_type: "Cash", value: 1 },
      { day: "B", payment_type: "Cash", value: 2 },
      { day: "C", payment_type: "Cash", value: 3 },
    ];
    await renderLine(MULTI_CFG, day3);
    expect(typeof dotOf()).toBe("function");
    const el = dotOf()(normal);
    expect(el.type).toBe("circle");
    expect(el.props.fill).toBe("red");
    expect(dotOf()(missing).type).toBe("g");
    cleanup();
    for (const k of Object.keys(captured)) delete captured[k];

    await renderLine({ ...MULTI_CFG, showDots: false }, day3);
    expect(dotOf()(normal).type).toBe("g");
    expect(dotOf()(isolated).type).toBe("circle");
    cleanup();
    for (const k of Object.keys(captured)) delete captured[k];

    const dense = Array.from({ length: 25 }, (_, i) => ({ day: `d${String(i).padStart(2, "0")}`, payment_type: "Cash", value: i }));
    await renderLine(MULTI_CFG, dense);
    expect(dotOf()(normal).type).toBe("g");
    expect(dotOf()(isolated).type).toBe("circle");
  });

  it("L132-11 series cap note", async () => {
    const rows = Array.from({ length: 13 }, (_, i) => ({ day: "Mon", payment_type: `p${String(i).padStart(2, "0")}`, value: 13 - i }));
    await renderLine(MULTI_CFG, rows);
    expect(lines()).toHaveLength(12);
    const note = screen.getByTestId("line-truncated-note");
    expect(note.className).toContain("config-hint");
    expect(note.textContent).toBe("Showing top 12 of 13 series");
  });

  it("L132-12 fillArea: multi stays a LineChart, single becomes an AreaChart", async () => {
    await renderLine({ ...MULTI_CFG, fillArea: true }, MULTI_ROWS);
    expect(captured.AreaChart).toBeUndefined();
    expect(captured.LineChart).toBeTruthy();
    cleanup();
    for (const k of Object.keys(captured)) delete captured[k];

    await renderLine({ ...SINGLE_CFG, fillArea: true }, SINGLE_ROWS);
    expect(chartKids().name).toBe("AreaChart");
    const areas = ofType(Area);
    expect(areas).toHaveLength(1);
    expect((areas[0].props as R).name).toBe("Sum of fare");
  });
});

