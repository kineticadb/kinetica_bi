import { describe, it, expect } from "vitest";
import {
  AiKeepRequestSchema,
  KEEP_CONFLICT_MESSAGE,
  KEEP_FAILED_MESSAGE,
  KEEP_RIGHTS_ORDER,
  keepPermissionMessage,
  DASHBOARD_VERSION_HEADER,
  DASHBOARD_VERSION_READ_HEADER,
  DASHBOARD_VERSION_LISTS,
  formatVersionWriteHeader,
  parseVersionWriteHeader,
  formatVersionReadHeader,
  parseVersionReadHeader,
} from "./aiKeep";

const spec = { baseTableId: 5, columns: [{ column: "vendor" }], limit: 500 };
const empty = () => ({
  baselineVersion: 0,
  dynamicViews: { add: [] as any[], remove: [] as number[] },
  layers: { add: [] as any[], edit: [] as any[], remove: [] as number[] },
  widgets: { add: [] as any[], edit: [] as any[], remove: [] as number[] },
});
const ok = (v: unknown) => AiKeepRequestSchema.safeParse(v).success;
const rect = { x: 0, y: 0, w: 4, h: 3 };
const wAdd = (tempId: number, extra: object = {}) => ({ tempId, type: "bar", title: "t", config: {}, rect, ...extra });

describe("AI keep request schema (141)", () => {
  it("KC-1 minimal request parses", () => {
    expect(ok(empty())).toBe(true);
  });

  it("KC-2 full request parses and round-trips", () => {
    const full = {
      baselineVersion: 7,
      dynamicViews: { add: [{ tempId: -3, name: "My view", spec }], remove: [4] },
      layers: {
        add: [{ tempId: -2, tableId: 9, config: { a: 1 }, dynamicViewId: -3 }],
        edit: [{ id: 7, dynamicViewId: null }],
        remove: [8],
      },
      widgets: {
        add: [wAdd(-1)],
        edit: [{ id: 12, configSet: { x: 1 }, configUnset: ["dynamicViewId"], rect }],
        remove: [13],
      },
    };
    const r = AiKeepRequestSchema.safeParse(full);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toEqual(full);
  });

  it("KC-3 unknown keys fail at every level", () => {
    const dv = { tempId: -1, name: "n", spec };
    const mk = (d: object) => ({ ...empty(), dynamicViews: { add: [d], remove: [] } });
    expect(ok(mk(dv))).toBe(true);
    expect(ok(mk({ ...dv, template_sql: "select 1" }))).toBe(false);
    expect(ok(mk({ ...dv, sql: "select 1" }))).toBe(false);
    expect(ok(mk({ ...dv, columns: [] }))).toBe(false);
    expect(ok({ ...empty(), dashboardId: 3 })).toBe(false);
  });

  it("KC-4 id rules", () => {
    const w = (add: any[] = [], edit: any[] = [], remove: number[] = []) => ({ ...empty(), widgets: { add, edit, remove } });
    expect(ok(w([wAdd(0)]))).toBe(false);
    expect(ok(w([wAdd(1)]))).toBe(false);
    expect(ok(w([], [{ id: 0 }]))).toBe(false);
    expect(ok(w([], [{ id: -1 }]))).toBe(false);
    expect(ok({ ...empty(), layers: { add: [{ tempId: -1, tableId: 1, config: {}, dynamicViewId: 0 }], edit: [], remove: [] } })).toBe(false);
    expect(ok(w([wAdd(-1), wAdd(-1)]))).toBe(false);
    expect(ok(w([wAdd(-1), wAdd(-2)]))).toBe(true);
    expect(ok(w([], [{ id: 5 }], [5]))).toBe(false);
    expect(ok({ ...empty(), layers: { add: [], edit: [{ id: 5 }], remove: [5] } })).toBe(false);
    expect(ok(w([], [], [5, 5]))).toBe(false);
    expect(ok(w([], [{ id: 5 }, { id: 5 }]))).toBe(false);
    expect(ok({ ...empty(), layers: { add: [{ tempId: -1, tableId: 1, config: {} }, { tempId: -1, tableId: 1, config: {} }], edit: [], remove: [] } })).toBe(false);
    expect(ok({ ...empty(), dynamicViews: { add: [{ tempId: -1, name: "a", spec }, { tempId: -1, name: "b", spec }], remove: [] } })).toBe(false);
  });

  it("KC-5 widget types", () => {
    const w = (add: any[] = [], edit: any[] = []) => ({ ...empty(), widgets: { add, edit, remove: [] } });
    expect(ok(w([wAdd(-1, { type: "ai" })]))).toBe(false);
    expect(ok(w([], [{ id: 1, type: "table" }]))).toBe(false);
    expect(ok(w([], [{ id: 1, type: "pie" }]))).toBe(true);
    expect(ok(w([wAdd(-1, { type: "map" })]))).toBe(true);
  });

  it("KC-6 caps", () => {
    const w = (add: any[]) => ({ ...empty(), widgets: { add, edit: [], remove: [] } });
    expect(ok(w(Array.from({ length: 200 }, (_, i) => wAdd(-(i + 1)))))).toBe(true);
    expect(ok(w(Array.from({ length: 201 }, (_, i) => wAdd(-(i + 1)))))).toBe(false);
    const cfg = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`k${i}`, i]));
    expect(ok(w([wAdd(-1, { config: cfg(200) })]))).toBe(true);
    expect(ok(w([wAdd(-1, { config: cfg(201) })]))).toBe(false);
    expect(ok(w([wAdd(-1, { title: "x".repeat(201) })]))).toBe(false);
    expect(ok({ ...empty(), dynamicViews: { add: [{ tempId: -1, name: "x".repeat(81), spec }], remove: [] } })).toBe(false);
    expect(ok({ ...empty(), dynamicViews: { add: [{ tempId: -1, name: "x".repeat(80), spec }], remove: [] } })).toBe(true);
    expect(ok(w([wAdd(-1, { rect: { ...rect, w: 0 } })]))).toBe(false);
  });

  it("KC-7 exact messages", () => {
    expect(keepPermissionMessage("dynamic_views:manage")).toBe("You can't save these changes: saving dynamic views needs the Manage dynamic views permission.");
    expect(keepPermissionMessage("layers:manage")).toBe("You can't save these changes: saving layer changes needs the Manage layers permission.");
    expect(keepPermissionMessage("widgets:configure")).toBe("You can't save these changes: saving widget changes needs the Configure widgets permission.");
    expect(KEEP_CONFLICT_MESSAGE).toBe("Someone else changed this dashboard since you started. Your AI changes weren't saved.");
    expect(KEEP_FAILED_MESSAGE).toBe("Couldn't save the AI changes. Nothing was saved; try again.");
    expect([...KEEP_RIGHTS_ORDER]).toEqual(["dynamic_views:manage", "layers:manage", "widgets:configure"]);
  });
});

describe("dashboard version headers (141)", () => {
  it("KH-1 write header format and parse", () => {
    expect(formatVersionWriteHeader(12, 40, 43)).toBe("12:40:43");
    expect(parseVersionWriteHeader("12:40:43")).toEqual({ dashboardId: 12, before: 40, after: 43 });
  });
  it("KH-2 read header format and parse", () => {
    expect(formatVersionReadHeader(12, "dynamic-views", 40)).toBe("12:dynamic-views:40");
    expect(parseVersionReadHeader("12:dynamic-views:40")).toEqual({ dashboardId: 12, list: "dynamic-views", version: 40 });
  });
  it("KH-3 garbage returns null and never throws", () => {
    const bad: (string | null | undefined)[] = [null, undefined, "", "12:40", "a:b:c", "12:-1:3", "12:5:4", "12:1.5:2", "12:widgetz:3", "0:1:2", "12:widgets:-1", "1".repeat(200)];
    for (const b of bad) {
      expect(parseVersionWriteHeader(b)).toBeNull();
      expect(parseVersionReadHeader(b)).toBeNull();
    }
    expect(parseVersionReadHeader("0:widgets:1")).toBeNull();
    expect(parseVersionReadHeader("12:widgets:x")).toBeNull();
  });
  it("KH-4 header names and lists", () => {
    expect(DASHBOARD_VERSION_HEADER).toBe("X-Kbi-Dashboard-Version");
    expect(DASHBOARD_VERSION_READ_HEADER).toBe("X-Kbi-Dashboard-Version-Read");
    expect([...DASHBOARD_VERSION_LISTS]).toEqual(["widgets", "layers", "dynamic-views", "tables"]);
  });
});
