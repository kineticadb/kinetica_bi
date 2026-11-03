// Phase 142 UAT: server-stamped map default view from a robust lon/lat data extent (unit level, injected Kinetica).
import { describe, it, expect, vi } from "vitest";
import { mapViewForBounds, type AiOp } from "@kinetica-bi/shared";
import { stampMapDefaultViews, buildMapExtentSql, parseMapExtent, type MapExtentDeps } from "../src/lib/ai/mapDefaultView";
import type { LiveSchemaPort } from "../src/lib/ai/tools/types";

const NYC = { minLon: -74.01234, maxLon: -73.78765, minLat: 40.63456, maxLat: 40.85678 };
const enc = (b: typeof NYC | null) =>
  b ? { column_1: [b.minLon], column_2: [b.maxLon], column_3: [b.minLat], column_4: [b.maxLat] } : { column_1: [null], column_2: [null], column_3: [null], column_4: [null] };

const liveSchema: LiveSchemaPort = {
  describe: async (id) =>
    id === 7
      ? { ok: true, table: { id: 7, schema: "demo", name: "nyctaxi", columns: [{ name: "pickup_longitude", type: "double" }, { name: "pickup_latitude", type: "double" }, { name: "geom", type: "string" }] } }
      : { ok: false },
};
const map = (tempId: number, config: Record<string, unknown> = {}): AiOp => ({ op: "add_widget", tempId, type: "map", title: "Map", config });
const bar = (tempId: number): AiOp => ({ op: "add_widget", tempId, type: "bar", title: "Bar", config: { tableId: 7 } });
const layer = (tempId: number, widgetId: number, over: Record<string, unknown> = {}): AiOp =>
  ({ op: "add_layer", tempId, widgetId, tableId: 7, renderMode: "heatmap", spatialMode: "latlon", latColumn: "pickup_latitude", lonColumn: "pickup_longitude", ...over }) as AiOp;

function deps(over: Partial<MapExtentDeps> = {}): MapExtentDeps & { sql: ReturnType<typeof vi.fn> } {
  const sql = vi.fn(async () => enc(NYC));
  return {
    requestId: "req-1",
    principal: () => ({ user: { username: "dee", credentialType: "password", creds: { username: "dee", password: "x" } } }) as never,
    liveSchema,
    dashboardTableIds: () => [7],
    signal: new AbortController().signal,
    sql,
    cancel: vi.fn(async () => ({ cancelled: [] })),
    ...over,
  } as MapExtentDeps & { sql: ReturnType<typeof vi.fn> };
}
const viewOf = (ops: AiOp[], tempId: number) => (ops.find((o) => o.op === "add_widget" && o.tempId === tempId) as { config: Record<string, unknown> }).config.defaultView;

describe("stampMapDefaultViews", () => {
  it("MAPVIEW-S1 an AI map with an AI heatmap layer gets the extent view", async () => {
    const d = deps();
    const ops = [map(-1), layer(-2, -1)];
    const out = await stampMapDefaultViews(ops, d);
    expect(viewOf(out, -1)).toEqual(mapViewForBounds(NYC));
    expect(d.sql).toHaveBeenCalledTimes(1);
    expect(viewOf(ops, -1)).toBeUndefined(); // input not mutated
  });

  it("MAPVIEW-S2 the extent SQL: quoted columns, percentiles, sane-range and 0,0 exclusion, run as the user with a kbi-ai tag", async () => {
    const d = deps();
    await stampMapDefaultViews([map(-1), layer(-2, -1)], d);
    const [principal, stmt, opts] = d.sql.mock.calls[0];
    expect(principal.user.username).toBe("dee");
    expect(stmt).toBe(buildMapExtentSql({ ref: "demo.nyctaxi", lon: "pickup_longitude", lat: "pickup_latitude" }));
    expect(stmt).toContain('APPROX_PERCENTILE("pickup_longitude", 2)');
    expect(stmt).toContain('APPROX_PERCENTILE("pickup_latitude", 98)');
    expect(stmt).toContain("FROM demo.nyctaxi");
    expect(stmt).toContain('NOT ("pickup_longitude" = 0 AND "pickup_latitude" = 0)');
    expect(opts.tag).toMatch(/^req-1-mv\d+$/);
    expect(opts.signal).toBeInstanceOf(AbortSignal);
  });

  it("MAPVIEW-S3 query error -> no defaultView, never throws", async () => {
    const d = deps({ sql: vi.fn(async () => { throw new Error("boom"); }) });
    const out = await stampMapDefaultViews([map(-1), layer(-2, -1)], d);
    expect(viewOf(out, -1)).toBeUndefined();
  });

  it("MAPVIEW-S4 null percentiles (no rows) -> no defaultView", async () => {
    const out = await stampMapDefaultViews([map(-1), layer(-2, -1)], deps({ sql: vi.fn(async () => enc(null)) }));
    expect(viewOf(out, -1)).toBeUndefined();
  });

  it("MAPVIEW-S5 timeout aborts the query, cancels the tagged job, leaves the world view", async () => {
    const cancel = vi.fn(async () => ({ cancelled: [] }));
    const sql = vi.fn((_p: unknown, _s: string, o: { signal: AbortSignal }) => new Promise((_r, rej) => o.signal.addEventListener("abort", () => rej(new Error("aborted")))));
    const out = await stampMapDefaultViews([map(-1), layer(-2, -1)], deps({ sql: sql as never, cancel, timeoutMs: 20 }));
    expect(viewOf(out, -1)).toBeUndefined();
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(cancel.mock.calls[0][1]).toMatch(/^req-1-mv\d+$/);
  });

  it("MAPVIEW-S6 no query when there is no AI map layer, the map already has a view, or nothing usable", async () => {
    for (const ops of [
      [map(-1)],
      [map(-1, { defaultView: { center: [1, 2], zoom: 5 } }), layer(-2, -1)],
      [bar(-1)],
      [map(-1), layer(-2, 55)], // layer on a saved map
      [map(-1), layer(-2, -1, { spatialMode: "wkt", latColumn: undefined, lonColumn: undefined, wktColumn: "geom" })],
      [map(-1), layer(-2, -1, { dynamicViewId: -5 })],
      [map(-1), layer(-2, -1, { tableId: 8 })], // not on the dashboard
      [map(-1), layer(-2, -1, { latColumn: "nope" })], // not a live column
    ] as AiOp[][]) {
      const d = deps();
      const out = await stampMapDefaultViews(ops, d);
      expect(d.sql).not.toHaveBeenCalled();
      const m = out.find((o) => o.op === "add_widget" && o.type === "map") as { config: Record<string, unknown> } | undefined;
      if (m && !("defaultView" in ops[0].config)) expect(m.config.defaultView).toBeUndefined();
    }
  });

  it("MAPVIEW-S7 already-aborted answer signal -> no query", async () => {
    const ac = new AbortController();
    ac.abort();
    const d = deps({ signal: ac.signal });
    const out = await stampMapDefaultViews([map(-1), layer(-2, -1)], d);
    expect(d.sql).not.toHaveBeenCalled();
    expect(viewOf(out, -1)).toBeUndefined();
  });

  it("MAPVIEW-S8 uses the FIRST layer on the map", async () => {
    const d = deps();
    await stampMapDefaultViews([map(-1), layer(-2, -1), layer(-3, -1, { latColumn: "x", lonColumn: "y" })], d);
    expect(d.sql).toHaveBeenCalledTimes(1);
    expect(d.sql.mock.calls[0][1]).toContain("pickup_latitude");
  });
});

describe("parseMapExtent", () => {
  it("MAPVIEW-P1 parses column_1..4 and rejects non-numeric", () => {
    expect(parseMapExtent(enc(NYC))).toEqual(NYC);
    expect(parseMapExtent(enc(null))).toBeNull();
    expect(parseMapExtent({})).toBeNull();
    expect(parseMapExtent({ column_1: ["a"], column_2: [1], column_3: [1], column_4: [1] })).toBeNull();
  });
});
