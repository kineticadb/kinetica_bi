import { describe, it, expect } from "vitest";
import { AskRequestSchema } from "@kinetica-bi/shared";
import type { WidgetDto, DashboardLayerDto } from "../../api/client";
import type { Turn } from "./types";
import { buildAskSnapshot, buildAskTurns, buildAskRequest } from "./buildAskRequest";

const w = (id: number, type: string, config: Record<string, unknown> = {}, title = `W${id}`): WidgetDto =>
  ({ id, dashboard_id: 1, title, type, position: 0, config, created_at: "", updated_at: "" }) as WidgetDto;
const layer = (id: number, config: Record<string, unknown> = {}): DashboardLayerDto =>
  ({ id, dashboard_id: 1, table_id: 7, layer_type: "points", position: 0, config }) as unknown as DashboardLayerDto;
const turn = (i: number, chat?: Turn["chat"], answer = "a"): Turn =>
  ({ id: `t${i}`, prompt: `q${i}`, answer, entries: [], createdAt: i, chat }) as Turn;

const widgets = [
  w(1, "bar", { tableId: 7, metric: "m", aggregation: "sum", groupByColumn: "g", sql: "SELECT 1", customWhere: "x=1" }),
  w(2, "ai"),
  w(3, "map"),
  w(-2, "table", { tableId: 7 }),
];
const layouts = { 1: { x: 0, y: 0, w: 12, h: 8 }, 2: { x: 12, y: 0, w: 12, h: 8 } };
const snap = () => buildAskSnapshot({ widgets, layouts, layers: [layer(10, { name: "L" }), layer(11)], dynamicViews: [] });
const req = (over: Partial<Parameters<typeof buildAskRequest>[0]> = {}) =>
  buildAskRequest({ dashboardId: 1, question: " hi ", snapshot: snap(), turns: [], cursor: -1, removalApproved: false, ...over });

describe("buildAskRequest", () => {
  it("BAR-1: body parses; no sql/customWhere leak", () => {
    const body = req();
    expect(AskRequestSchema.safeParse(body).success).toBe(true);
    const s = JSON.stringify(body);
    expect(s).not.toContain("customWhere");
    expect(s).not.toContain("SELECT 1");
    const bar = body.snapshot.widgets.find((x) => x.id === 1)!;
    expect(bar).toMatchObject({ tableId: 7, binding: { metric: "m", aggregation: "sum", groupByColumn: "g" } });
    expect(body.snapshot.widgets.some((x) => x.id === -2)).toBe(true);
  });
  it("BAR-2: ai widget present with layout", () => {
    const ai = req().snapshot.widgets.find((x) => x.type === "ai");
    expect(ai).toMatchObject({ id: 2, layout: { x: 12, y: 0, w: 12, h: 8 } });
  });
  it("BAR-3: layers attach to first map that shows them; orphans omitted", () => {
    const s = buildAskSnapshot({
      widgets: [w(3, "map", { includedLayerIds: [10] }), w(4, "map")],
      layouts: {},
      layers: [layer(10), layer(11)],
      dynamicViews: [],
    });
    expect(s.layers.map((l) => [l.id, l.widgetId])).toEqual([[10, 3], [11, 4]]);
    const none = buildAskSnapshot({ widgets: [w(1, "bar")], layouts: {}, layers: [layer(10)], dynamicViews: [] });
    expect(none.layers).toEqual([]);
  });
  it("BAR-4: only ok turns up to cursor; changes from applied+skipped", () => {
    const turns = [
      turn(0, { status: "ok", applied: ["Added bar"], skipped: [{ label: "Remove X", stage: "s", reasons: ["r".repeat(300), "r2"] }] }),
      turn(1, { status: "error" }),
      turn(2, { status: "cancelled" }),
      turn(3),
      turn(4, { status: "ok" }),
    ];
    const out = buildAskTurns(turns, 3);
    expect(out.map((t) => t.question)).toEqual(["q0", "q3"]);
    expect(out[0].changes).toEqual([
      { label: "Added bar", status: "applied" },
      { label: "Remove X", status: "skipped", reason: "r".repeat(200) },
    ]);
  });
  it("BAR-5: approvals only when removal approved", () => {
    expect(req().approvals).toBeUndefined();
    expect(req({ removalApproved: true }).approvals).toEqual({ removeSaved: true });
  });
  it("BAR-6: worst case stays under 60000 bytes and keeps the newest turn", () => {
    const labels = Array.from({ length: 30 }, (_, i) => `${i}`.padEnd(200, "x"));
    const turns = Array.from({ length: 50 }, (_, i) => turn(i, { status: "ok", applied: labels }, "z".repeat(8000)));
    const body = req({ turns, cursor: 49 });
    expect(new TextEncoder().encode(JSON.stringify(body)).length).toBeLessThan(60000);
    expect(AskRequestSchema.safeParse(body).success).toBe(true);
    expect(body.turns.length).toBeGreaterThan(0);
    expect(body.turns[body.turns.length - 1].question).toBe("q49");
  });
  it("BAR-7: question trimmed/capped; filters empty", () => {
    expect(req().question).toBe("hi");
    expect(req({ question: "y".repeat(3000) }).question.length).toBe(2000);
    expect(req().snapshot.filters).toEqual([]);
  });
});
