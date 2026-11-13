// 152-02 (VIEWAI-V22-02): the gateway refuses change tools/ops for restricted viewers, per op, on both paths.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { z } from "zod/v4";
import { checkAiOp, checkAiCandidate, type GatewayDeps } from "../src/lib/ai/gateway";
import { buildGatewayDeps } from "../src/lib/ai/gatewayDeps";
import { createShadow } from "../src/lib/ai/shadow";
import { MUTATE_TOOLS } from "../src/lib/ai/tools/mutate";
import type { MutateTool, LiveSchemaPort } from "../src/lib/ai/tools/types";
import { db } from "../src/db";
import { sessionFor, makeRole, makeDashboard, resetAiTables } from "./helpers/aiRouteKit";

const AF = "Viewer AI: answers and filters only";
const OFF = "Viewer AI: off for this dashboard";
const CHANGE = ["add_widget", "edit_widget", "rename_widget", "change_widget_type", "set_layout", "add_heatmap_layer", "edit_heatmap_layer", "set_layer_visibility", "patch", "add_dynamic_view", "remove_widget", "remove_layer", "remove_dynamic_view"];
const rawOp: MutateTool = { kind: "mutate", name: "apply_filter", description: "", args: z.object({}).passthrough(), toOp: (a) => a };
const tool = (n: string) => MUTATE_TOOLS.find((t) => t.name === n)!;
const snap = () => ({ widgets: [{ id: 42, type: "bar", title: "Fares", tableId: 5 }], layers: [], dynamicViews: [], filters: [] });
const T5 = { id: 5, schema: "demo", name: "trips", columns: [{ name: "payment_type", type: "string" }, { name: "fare_amount", type: "double" }] };
const live = (): LiveSchemaPort => ({
  describe: vi.fn(async (id: number) => (id === 5 ? { ok: true as const, table: T5 } : { ok: false as const })),
});
const mk = (o: Partial<GatewayDeps> & { viewerRestriction?: () => unknown } = {}): GatewayDeps => ({
  username: "ann", dashboardId: 1, shadow: createShadow(snap()), liveSchema: live(),
  getPermissions: vi.fn(() => new Set(["dashboards:view", "ai:use"])), canViewDashboard: vi.fn(() => true),
  dashboardTableIds: () => [5], ...o,
}) as GatewayDeps;
const af = () => mk({ viewerRestriction: () => "answers_filters" });
const applyF = { op: "apply_filter", source: { kind: "table", id: 5 }, filters: [{ column: "payment_type", operator: "eq", value: "Credit" }] };

describe("gateway Viewer AI (152)", () => {
  it("VAIGW-1: every change tool is refused in Answers and filters before argument parsing", async () => {
    expect(CHANGE).toHaveLength(13);
    for (const name of CHANGE) {
      const r = await checkAiOp(af(), tool(name), "{not json");
      expect(r, name).toMatchObject({ ok: false, stage: "permission", reasons: [AF], label: name });
    }
  });

  it("VAIGW-2: apply_filter still passes in Answers and filters", async () => {
    const r = await checkAiOp(af(), rawOp, JSON.stringify(applyF));
    expect(r).toMatchObject({ ok: true });
  });

  it("VAIGW-3: absent, null and session_only restrictions leave today's behaviour", async () => {
    for (const d of [mk(), mk({ viewerRestriction: () => null }), mk({ viewerRestriction: () => "session_only" })]) {
      const r = await checkAiOp(d, tool("add_widget"), "{not json");
      expect(r).toMatchObject({ ok: false, stage: "shape" });
    }
  });

  it("VAIGW-4: Apply path refuses stored change ops and unknown ops, allows filters", async () => {
    const addW = { op: "add_widget", tempId: -1, type: "bar", title: "T", config: { tableId: 5 } };
    expect(await checkAiCandidate(af(), addW)).toMatchObject({ ok: false, stage: "permission", reasons: [AF] });
    expect((await checkAiCandidate(af(), applyF)).ok).toBe(true);
    expect(await checkAiCandidate(af(), { op: "add_track_layer" })).toMatchObject({ ok: false, stage: "permission", reasons: [AF] });
    expect(await checkAiCandidate(mk({ viewerRestriction: () => null }), { op: "add_track_layer" })).toMatchObject({ ok: false, stage: "shape" });
  });

  it("VAIGW-5: Off refuses even filters on both paths", async () => {
    const d = mk({ viewerRestriction: () => "off" });
    expect(await checkAiOp(d, rawOp, JSON.stringify(applyF))).toMatchObject({ ok: false, stage: "permission", reasons: [OFF] });
    expect(await checkAiCandidate(d, applyF)).toMatchObject({ ok: false, stage: "permission", reasons: [OFF] });
  });

  it("VAIGW-6: the restriction is re-read for every op", async () => {
    let n = 0;
    const d = mk({ viewerRestriction: () => (n++ === 0 ? null : "answers_filters") });
    expect(await checkAiOp(d, tool("add_widget"), "{not json")).toMatchObject({ stage: "shape" });
    expect(await checkAiOp(d, tool("add_widget"), "{not json")).toMatchObject({ stage: "permission" });
  });
});

describe("buildGatewayDeps viewerRestriction (152)", () => {
  beforeEach(() => { resetAiTables(); });
  it("VAIGW-7: restricted users get the mode, designers null, and the mode is not cached", () => {
    const viewerRole = makeRole("vaigw_viewer", ["dashboards:view", "ai:use"]);
    sessionFor("vee", [viewerRole]);
    sessionFor("dee", ["designer"]);
    const D = makeDashboard([viewerRole]).id;
    db.prepare("UPDATE dashboards SET viewer_ai = 'answers_filters' WHERE id = ?").run(D);
    const config = { dvMaxRecords: 1000, dvMaxJoins: 2, dvMaxPerSession: 5 } as never;
    const mkDeps = (username: string) => buildGatewayDeps({ username, dashboardId: D, shadow: createShadow(snap()), liveSchema: live(), config });
    const viewer = mkDeps("vee");
    expect(viewer.viewerRestriction!()).toBe("answers_filters");
    expect(mkDeps("dee").viewerRestriction!()).toBeNull();
    db.prepare("UPDATE dashboards SET viewer_ai = 'off' WHERE id = ?").run(D);
    expect(viewer.viewerRestriction!()).toBe("off");
  });
});
