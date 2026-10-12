import { describe, it, expect, vi } from "vitest";
import { z } from "zod/v4";
import { checkAiOp, AI_COLUMN_BINDING_KEYS, type GatewayDeps } from "../src/lib/ai/gateway";
import { createShadow } from "../src/lib/ai/shadow";
import type { MutateTool, LiveSchemaPort } from "../src/lib/ai/tools/types";
import { CANARY_ROW_VALUE_9f3 as C } from "./helpers/aiTestKit";

const addWidget: MutateTool = {
  kind: "mutate", name: "add_widget", description: "",
  args: z.object({ tempId: z.number(), type: z.string(), title: z.string(), tableId: z.number(), metricColumn: z.string().optional(), config: z.record(z.string(), z.unknown()).optional() }),
  toOp: (a) => {
    const x = a as { tempId: number; type: string; title: string; tableId: number; metricColumn?: string; config?: Record<string, unknown> };
    return { op: "add_widget", tempId: x.tempId, type: x.type, title: x.title, config: { ...(x.config ?? {}), tableId: x.tableId, ...(x.metricColumn ? { metricColumn: x.metricColumn } : {}) } };
  },
};
// Passes the model's JSON straight through as the op so the gateway itself (not the fake tool/zod) is what sees hostile keys.
const rawOp: MutateTool = {
  kind: "mutate", name: "raw", description: "",
  args: z.object({}).passthrough(),
  toOp: (a) => a,
};
const patch: MutateTool = {
  kind: "mutate", name: "patch", description: "",
  args: z.object({ kind: z.enum(["widget", "layer", "dynamicView"]), id: z.number(), configPatch: z.record(z.string(), z.unknown()) }),
  toOp: (a) => { const x = a as { kind: string; id: number; configPatch: unknown }; return { op: "patch", action: { target: { kind: x.kind, id: x.id }, configPatch: x.configPatch } }; },
};
const removeWidget: MutateTool = {
  kind: "mutate", name: "remove_widget", description: "",
  args: z.object({ id: z.number() }),
  toOp: (a) => ({ op: "remove_widget", id: (a as { id: number }).id }),
};

const snap = () => ({
  widgets: [{ id: 42, type: "map", title: "Trips", tableId: 7 }, { id: 43, type: "bar", title: "Fares", tableId: 7 }],
  layers: [{ id: 70, widgetId: 42, tableId: 7 }],
  dynamicViews: [{ id: 90, name: "dv" }],
  filters: [],
});
const ANALYST = new Set(["dashboards:view", "ai:use"]);
const live = (): LiveSchemaPort => ({
  describe: vi.fn(async (id: number) =>
    id === 7
      ? { ok: true as const, table: { id: 7, schema: "demo", name: "nyctaxi", columns: [{ name: "fare_amount" }, { name: "vendor_id" }] } }
      : { ok: false as const }),
});
const mk = (o: Partial<GatewayDeps> = {}): GatewayDeps => ({
  username: "ann", dashboardId: 1, shadow: createShadow(snap()), liveSchema: live(),
  getPermissions: vi.fn(() => ANALYST), canViewDashboard: vi.fn(() => true), ...o,
});
const add = (o: Record<string, unknown> = {}) => JSON.stringify({ tempId: -1, type: "bar", title: "T", tableId: 7, metricColumn: "fare_amount", ...o });
const pat = (kind: string, id: number, configPatch: unknown) => JSON.stringify({ kind, id, configPatch });

describe("checkAiOp gateway", () => {
  it("GW-1: shape failures, no values in reasons", async () => {
    const raw = add({ tempId: C });
    expect(raw).toContain(C);
    for (const r of [
      await checkAiOp(mk(), addWidget, "not json"),
      await checkAiOp(mk(), addWidget, raw),
      await checkAiOp(mk(), addWidget, add({ tempId: 5 })),
    ]) {
      expect(r).toMatchObject({ ok: false, stage: "shape" });
      if (!r.ok) expect(JSON.stringify(r.reasons)).not.toContain(C);
    }
  });

  it("GW-2: allow_list", async () => {
    const stage = async (t: MutateTool, raw: string) => { const r = await checkAiOp(mk(), t, raw); return r.ok ? "ok" : r.stage; };
    expect(await stage(addWidget, add({ type: "scatter" }))).toBe("allow_list");
    expect(await stage(addWidget, add({ config: { customWhere: "1=1" } }))).toBe("allow_list");
    const proto = `{"tempId":-1,"type":"bar","title":"T","tableId":7,"config":{"__proto__":{"x":1}}}`;
    // parseAiOp's z.record strips an own "__proto__" key before the allow-list stage (verified), so the plan's
    // "__proto__ -> allow_list" is not observable; assert the real guarantee: the accepted op never carries it.
    const pr = await checkAiOp(mk(), rawOp, `{"op":"add_widget","tempId":-1,"type":"bar","title":"T","config":{"tableId":7,"__proto__":{"x":1}}}`);
    if (pr.ok && pr.op.op === "add_widget") expect(Object.prototype.hasOwnProperty.call(pr.op.config, "__proto__")).toBe(false);
    else expect(pr).toMatchObject({ ok: false, stage: "allow_list" });
    expect(await stage(rawOp, `{"op":"add_widget","tempId":-1,"type":"bar","title":"T","config":{"tableId":7,"constructor":1}}`)).toBe("allow_list");
    expect(await stage(addWidget, proto)).toMatch(/ok|allow_list/); // fake tool's zod may drop the key; hostile-key proof is the rawOp pair above
    expect(await stage(addWidget, add({ config: { dynamicViewId: 3 } }))).toBe("allow_list");
    expect(await stage(patch, pat("widget", 42, { show_popup: "yes" }))).toBe("allow_list");
    expect(await stage(patch, pat("layer", 70, { table_id: 3 }))).toBe("allow_list");
    expect(await stage(patch, pat("widget", 43, { anything: 1 }))).toBe("allow_list");
  });

  it("GW-3: permission", async () => {
    const a = await checkAiOp(mk({ getPermissions: () => new Set(["dashboards:view"]) }), addWidget, add());
    expect(a).toMatchObject({ ok: false, stage: "permission" });
    const b = await checkAiOp(mk({ canViewDashboard: () => false }), addWidget, add());
    expect(b).toMatchObject({ ok: false, stage: "permission" });
  });

  it("GW-4: D-16 analyst without edit rights is accepted", async () => {
    expect((await checkAiOp(mk(), addWidget, add())).ok).toBe(true);
    expect((await checkAiOp(mk(), removeWidget, JSON.stringify({ id: 43 }))).ok).toBe(true);
    expect((await checkAiOp(mk(), patch, pat("widget", 42, { show_popup: true }))).ok).toBe(true);
  });

  it("GW-5: permissions re-read per op", async () => {
    const getPermissions = vi.fn().mockReturnValueOnce(ANALYST).mockReturnValueOnce(new Set(["dashboards:view"]));
    const d = mk({ getPermissions });
    expect((await checkAiOp(d, removeWidget, JSON.stringify({ id: 43 }))).ok).toBe(true);
    expect(await checkAiOp(d, removeWidget, JSON.stringify({ id: 42 }))).toMatchObject({ ok: false, stage: "permission" });
    expect(getPermissions).toHaveBeenCalledTimes(2);
  });

  it("GW-6: reference", async () => {
    expect(await checkAiOp(mk(), removeWidget, JSON.stringify({ id: 999 }))).toMatchObject({ ok: false, stage: "reference" });
    const d = mk();
    expect((await checkAiOp(d, removeWidget, JSON.stringify({ id: 42 }))).ok).toBe(true);
    expect(await checkAiOp(d, patch, pat("widget", 42, { show_popup: true }))).toMatchObject({ ok: false, stage: "reference" });
    const d2 = mk({ shadow: createShadow({ ...snap(), widgets: [...snap().widgets, { id: -1, type: "bar", title: "x" }] }) });
    expect(await checkAiOp(d2, addWidget, add({ tempId: -1 }))).toMatchObject({ ok: false, stage: "reference" });
    const d3 = mk();
    expect((await checkAiOp(d3, addWidget, add())).ok).toBe(true);
    expect(await checkAiOp(d3, addWidget, add())).toMatchObject({ ok: false, stage: "reference" });
  });

  it("GW-7: live_schema", async () => {
    const r = await checkAiOp(mk(), addWidget, add({ tableId: 8 }));
    expect(r).toEqual({ ok: false, stage: "live_schema", reasons: ["table 8 is not available"] });
    const typo = await checkAiOp(mk(), addWidget, add({ metricColumn: "fare_amout" }));
    expect(typo.ok).toBe(false);
    if (!typo.ok) {
      expect(typo.stage).toBe("live_schema");
      const t = typo.reasons.join(" | ");
      expect(t).toContain("column `fare_amout` not found");
      expect(t).toContain("did you mean `fare_amount`");
    }
    const noTable = JSON.stringify({ tempId: -1, type: "bar", title: "T" });
    expect(await checkAiOp(mk(), addWidget, noTable)).toMatchObject({ ok: false, stage: "shape" });
  });

  it("GW-8: stage order", async () => {
    const both = await checkAiOp(mk({ getPermissions: () => new Set() }), addWidget, "nope");
    expect(both).toMatchObject({ stage: "shape" });
    const d = mk({ getPermissions: () => new Set() });
    expect(await checkAiOp(d, addWidget, add({ tableId: 8 }))).toMatchObject({ ok: false, stage: "permission" });
    expect(d.liveSchema.describe).not.toHaveBeenCalled();
  });

  it("GW-9: success updates shadow", async () => {
    const d = mk();
    const r = await checkAiOp(d, addWidget, add({ type: "map", tempId: -2, metricColumn: undefined }));
    expect(r).toMatchObject({ ok: true, label: 'Added map "T"' });
    expect((await checkAiOp(d, patch, pat("widget", -2, { show_popup: true }))).ok).toBe(true);
    expect((await checkAiOp(d, removeWidget, JSON.stringify({ id: 42 }))).ok).toBe(true);
    expect(await checkAiOp(d, patch, pat("widget", 42, { show_popup: true }))).toMatchObject({ ok: false, stage: "reference" });
    expect(AI_COLUMN_BINDING_KEYS).toContain("metricColumn");
  });
});
