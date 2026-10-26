// 142 UAT: an AI timeline op folds into the renderer's own config (timeCol + metrics[]); the AI never supplies SQL.
import { describe, it, expect } from "vitest";
import { AiKeepRequestSchema } from "@kinetica-bi/shared";
import { evaluateTurn, foldSession, makeSessionWidget } from "./foldSession";
import { buildKeepPayload } from "./keepPayload";
import { buildAskSnapshot } from "./buildAskRequest";
import { baselineFixture, addChartOp } from "../../test/aiSessionHarness";
import { AI_PALETTE_COLORS } from "../aiPalette";
import { DEFAULT_MAX_INTERVALS } from "../timelineBin";
import type { SessionBaseline, TurnEntry } from "./types";
import type { TableDto } from "../../api/client";

const b: SessionBaseline = {
  ...baselineFixture(),
  tables: [{ id: 5, schema: "demo", name: "trips", columns: { pickup_datetime: "timestamp", fare_amount: "double", vendor_id: "string" } }],
};
const RECT = { x: 0, y: 0, w: 18, h: 30 };
const tlCfg = (o: Record<string, unknown> = {}) => ({ tableId: 5, timeColumn: "pickup_datetime", metric: "fare_amount", aggregation: "sum", ...o });
const tlOp = (o: Record<string, unknown> = {}, tempId = -1) => addChartOp(tempId, "timeline", "Fares over time", tlCfg(o), RECT);
/** "#rrggbb" palette colour -> the timeline metric's 8-char AARRGGBB. */
const aarrggbb = (css: string) => `FF${css.slice(1).toUpperCase()}`;
const fold = (ops: unknown[]) => {
  const es: TurnEntry[] = evaluateTurn(b, [], ops);
  return { es, d: foldSession(b, es) };
};

describe("AI timeline fold (142)", () => {
  it("FOLDTL-1 a timeline op becomes the renderer config with the definition defaults", () => {
    const { es, d } = fold([tlOp()]);
    expect(es[0].result.status).toBe("applied");
    const w = d.addedWidgets[0];
    expect(w.type).toBe("timeline");
    expect(w.config).toEqual({
      tableId: 5,
      tableRef: "demo.trips",
      timeCol: "pickup_datetime",
      metrics: [{ column: "fare_amount", aggregation: "SUM", color: aarrggbb(AI_PALETTE_COLORS.violet) }],
      maxIntervals: DEFAULT_MAX_INTERVALS,
      showLegend: true,
      showTooltip: true,
      vertical: false,
      colorTheme: "Set2",
      dateFormatOverride: "",
      layout: RECT,
    });
  });

  it("FOLDTL-2 colour, label, legend and count_distinct translate; model-facing keys never reach the renderer", () => {
    const c = makeSessionWidget(
      tlOp({ color: "teal", yFieldLabel: "Distinct vendors", showLegend: false, aggregation: "count_distinct", metric: "vendor_id" }) as never,
      b,
    ).config;
    expect(c.metrics).toEqual([{ column: "vendor_id", aggregation: "COUNT_DISTINCT", color: aarrggbb(AI_PALETTE_COLORS.teal), label: "Distinct vendors" }]);
    expect(c.showLegend).toBe(false);
    for (const k of ["timeColumn", "metric", "aggregation", "color", "yFieldLabel", "sql", "table", "metricColumn"]) expect(c).not.toHaveProperty(k);
  });

  it("FOLDTL-3 a timeline is table-bound and add-only in the fold too", () => {
    const [dv] = evaluateTurn({ ...b, dynamicViewIds: [90] }, [], [addChartOp(-1, "timeline", "t", { ...tlCfg({ tableId: undefined }), dynamicViewId: 90 })]);
    expect(dv.result).toMatchObject({ status: "skipped", reason: "config_rejected" });
    const { es } = fold([tlOp()]);
    const later = evaluateTurn({ ...b, dynamicViewIds: [90] }, es, [
      { op: "patch", action: { target: { kind: "widget", id: -1 }, configPatch: { dynamicViewId: 90 } } },
      { op: "patch", action: { target: { kind: "widget", id: -1 }, configPatch: { color: "amber" } } },
    ]);
    expect(later.map((e) => e.result.status)).toEqual(["skipped", "skipped"]);
    expect(later[0].result).toMatchObject({ reason: "unsupported_target" });
  });

  it("FOLDTL-4 the ask snapshot shows a timeline's time column and metric (names only)", () => {
    const { d } = fold([tlOp({ aggregation: "avg" })]);
    const snap = buildAskSnapshot({ widgets: d.addedWidgets, layouts: {}, layers: [], dynamicViews: [] });
    expect(snap.widgets[0]).toMatchObject({ id: -1, type: "timeline", tableId: 5, binding: { metric: "fare_amount", aggregation: "avg", timeColumn: "pickup_datetime" } });
  });

  it("FOLDTL-5 Keep sends the renderer config and the request parses", () => {
    const { d } = fold([tlOp()]);
    const p = buildKeepPayload({
      baselineVersion: 1, derived: d, savedWidgets: b.widgets, savedLayers: b.layers, tempLayerVisibility: {}, rects: {},
      overlay: { tables: (b.tables ?? []) as unknown as TableDto[], maxBarGroupBySeriesCap: 12 },
    });
    expect(p.widgets.add).toHaveLength(1);
    expect(p.widgets.add[0]).toMatchObject({ tempId: -1, type: "timeline", rect: RECT });
    expect(p.widgets.add[0].config).toMatchObject({ tableId: 5, tableRef: "demo.trips", timeCol: "pickup_datetime", metrics: [{ column: "fare_amount", aggregation: "SUM" }] });
    expect(p.widgets.add[0].config).not.toHaveProperty("layout");
    expect(AiKeepRequestSchema.safeParse(p).success).toBe(true);
  });
});
