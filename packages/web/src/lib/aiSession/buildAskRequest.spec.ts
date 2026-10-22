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

describe("ask snapshot filters (138)", () => {
  const base = { widgets, layouts, layers: [], dynamicViews: [] };
  it("SNAPF-1: names and operators only, never values", () => {
    const snapshot = buildAskSnapshot({
      ...base,
      filters: {
        filters: { 5: [{ column: "payment_type", value: "SECRETVAL_77", dataType: "string", addedAt: 1 } as never] },
        dvFilters: { 90: [{ column: "zone", operator: "in", value: ["a"], dataType: "string", addedAt: 1 } as never] },
      },
    });
    expect(snapshot.filters).toEqual([
      { source: { kind: "table", id: 5 }, column: "payment_type", op: "eq" },
      { source: { kind: "dynamicView", id: 90 }, column: "zone", op: "in" },
    ]);
    expect(JSON.stringify(snapshot)).not.toContain("SECRETVAL_77");
    const body = buildAskRequest({ dashboardId: 1, question: "q", snapshot, turns: [], cursor: -1, removalApproved: false });
    expect(AskRequestSchema.safeParse(body).success).toBe(true);
  });
  it("SNAPF-2: null filter is isNull; between kept", () => {
    const snapshot = buildAskSnapshot({
      ...base,
      filters: {
        filters: { 5: [{ column: "tip", dataType: "null" }, { column: "fare", operator: "between", dataType: "number" }] },
        dvFilters: {},
      },
    });
    expect(snapshot.filters.map((f) => f.op)).toEqual(["isNull", "between"]);
  });
  it("SNAPF-3: capped at 300", () => {
    const mk = (n: number) => Array.from({ length: n }, (_, i) => ({ column: `c${i}`, dataType: "string" }));
    const snapshot = buildAskSnapshot({ ...base, filters: { filters: { 1: mk(160), 2: mk(160) }, dvFilters: {} } });
    expect(snapshot.filters).toHaveLength(300);
  });
  it("SNAPF-4: omitted filters is []; client filter notes are never sent back", () => {
    expect(buildAskSnapshot(base).filters).toEqual([]);
    const t = turn(1, { status: "ok", filterNotes: ["Filtered trips to payment_type = SECRETVAL_77 (2 widgets)."] });
    expect(JSON.stringify(buildAskTurns([t], 0))).not.toContain("SECRETVAL_77");
  });
});

describe("ask snapshot dynamic views (139)", () => {
  const base = { widgets, layouts, layers: [] as DashboardLayerDto[] };
  const parse = (snapshot: ReturnType<typeof buildAskSnapshot>) =>
    AskRequestSchema.safeParse({ dashboardId: 1, question: "q", snapshot, turns: [] }).success;

  it("SNAPW-1: session view carries base/aggregated/columns, never the spec or a filter value", () => {
    const s = buildAskSnapshot({
      ...base,
      dynamicViews: [
        { id: -3, name: "Trips by hour", baseTableId: 5, aggregated: true, columns: [{ name: "trips", type: "long" }],
          spec: { filters: [{ column: "c", value: "SECRETVAL_139" }] } } as never,
      ],
    });
    expect(s.dynamicViews[0]).toEqual({ id: -3, name: "Trips by hour", baseTableId: 5, aggregated: true, columns: [{ name: "trips", type: "long" }] });
    expect("spec" in s.dynamicViews[0]).toBe(false);
    expect(JSON.stringify(s)).not.toContain("SECRETVAL_139");
    expect(parse(s)).toBe(true);
  });

  it("SNAPW-2: widget binding includes columns (array or comma string) and sortField", () => {
    const s = buildAskSnapshot({
      ...base,
      widgets: [w(1, "records", { tableId: 7, columns: ["a", "b"], sortField: "a" }), w(2, "records", { tableId: 7, columns: "x, y ,z" })],
      dynamicViews: [],
    });
    expect(s.widgets[0].binding).toEqual({ columns: ["a", "b"], sortField: "a" });
    expect(s.widgets[1].binding).toEqual({ columns: ["x", "y", "z"] });
    expect(parse(s)).toBe(true);
  });

  it("SNAPW-3: layer dynamic_view_id and column refs", () => {
    const l = { ...layer(10, { latColumn: "lat", lonColumn: "lon", valueColumn: "v" }), dynamic_view_id: -3 } as unknown as DashboardLayerDto;
    const s = buildAskSnapshot({ widgets, layouts, layers: [l], dynamicViews: [] });
    // host map resolution: map widget 3 has no explicit layer ids, so it owns all layers
    const out = s.layers.find((x) => x.id === 10);
    expect(out?.dynamicViewId).toBe(-3);
    expect(out?.columns).toEqual(expect.arrayContaining(["lat", "lon"]));
    expect(parse(s)).toBe(true);
  });

  it("SNAPW-4: saved view without columns stays {id,name}", () => {
    const s = buildAskSnapshot({ ...base, dynamicViews: [{ id: 4, name: "Saved" }] });
    expect(s.dynamicViews[0]).toEqual({ id: 4, name: "Saved" });
  });

  it("SNAPW-5: 20 views x 70 columns still fits the request body guard", () => {
    const columns = Array.from({ length: 70 }, (_, i) => ({ name: `col_${i}`, type: "string" }));
    const dynamicViews = Array.from({ length: 20 }, (_, i) => ({ id: -(i + 1), name: `V${i}`, baseTableId: 5, aggregated: false, columns }));
    const r = buildAskRequest({ dashboardId: 1, question: "q", snapshot: buildAskSnapshot({ ...base, dynamicViews }), turns: [turn(1)], cursor: 0, removalApproved: false });
    expect(new TextEncoder().encode(JSON.stringify(r)).length).toBeLessThan(60_000);
    expect(AskRequestSchema.safeParse(r).success).toBe(true);
  });
});

describe("KHIST saved turns as provider history (141 D-18)", () => {
  type Saved = NonNullable<Parameters<typeof buildAskTurns>[2]>;
  const st = (i: number, chat?: Turn["chat"], answer = `A${i}`): Saved[number] =>
    ({ kind: "turn", id: `s${i}`, prompt: `Q${i}`, answer, ...(chat ? { chat } : {}) }) as Saved[number];
  const note = { kind: "note", id: "n1", text: "Changes saved." } as Saved[number];

  it("KHIST-1: saved turns come first, notes never appear, changes carried", () => {
    const saved = [st(1, { status: "ok", applied: ["added a chart"] } as Turn["chat"]), note, st(2)];
    const out = buildAskTurns([turn(3, { status: "ok" } as Turn["chat"])], 0, saved);
    expect(out.map((t) => t.question)).toEqual(["Q1", "Q2", "q3"]);
    expect(out[0].changes).toContainEqual({ label: "added a chart", status: "applied" });
  });
  it("KHIST-2: saved turns count toward the recent-answer window", () => {
    const saved = Array.from({ length: 9 }, (_, i) => st(i));
    const out = buildAskTurns([turn(99)], 0, saved);
    expect(out).toHaveLength(10);
    expect(out[0].answer).toBe("");
    expect(out[1].answer).toBe("");
    expect(out[2].answer).toBe("A2");
  });
  it("KHIST-3: error/cancelled saved turns are excluded", () => {
    const saved = [st(1, { status: "error" } as Turn["chat"]), st(2, { status: "cancelled" } as Turn["chat"]), st(3)];
    expect(buildAskTurns([], -1, saved).map((t) => t.question)).toEqual(["Q3"]);
  });
  it("KHIST-4: no saved argument is unchanged", () => {
    const turns = [turn(0, { status: "ok" } as Turn["chat"]), turn(1, { status: "error" } as Turn["chat"])];
    expect(buildAskTurns(turns, 1)).toEqual(buildAskTurns(turns, 1, []));
    expect(buildAskTurns(turns, 1).map((t) => t.question)).toEqual(["q0"]);
  });
  it("KHIST-5: buildAskRequest passes savedTurns through", () => {
    const body = req({ savedTurns: [st(1), note] } as never);
    expect(body.turns[0].question).toBe("Q1");
  });
});
