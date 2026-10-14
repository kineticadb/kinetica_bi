// Phase 137-01 Task 3 (AIGOV-V20-01): adding the AI Assistant widget needs ai:use on the server, not only in the UI.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/index";
import { db, createWidget } from "../src/db";
import { forbidProviderNetwork } from "./helpers/aiTestKit";
import { enableAiEnv, sessionFor, makeRole, makeDashboard, resetAiTables, mockKinetica } from "./helpers/aiRouteKit";

let restoreEnv: (() => void) | null = null;
beforeEach(() => {
  resetAiTables();
  db.exec("DELETE FROM widgets");
  forbidProviderNetwork(mockKinetica(), { allowHosts: ["provider.test"] });
});
afterEach(() => {
  vi.unstubAllGlobals();
  restoreEnv?.();
  restoreEnv = null;
});

const setup = async (perms: string[]) => {
  restoreEnv = enableAiEnv();
  const app = await createApp();
  const role = makeRole("wcg-" + perms.join("-").replace(/:/g, "_"), ["dashboards:view", ...perms]);
  const dash = makeDashboard([role]);
  const { cookie } = sessionFor("ann", [role]);
  return { app, dash, cookie };
};
const count = (dashId: number) => (db.prepare("SELECT COUNT(*) AS n FROM widgets WHERE dashboard_id = ?").get(dashId) as { n: number }).n;
const aiBody = { title: "AI Assistant", type: "ai", config: {} };

describe("AI widget create/patch guard", () => {
  it("WCG-1 without ai:use, POST type ai is 403 and creates nothing", async () => {
    const { app, dash, cookie } = await setup(["dashboards:edit"]);
    const res = await request(app).post(`/api/dashboards/${dash.id}/widgets`).set("Cookie", cookie).send(aiBody);
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: "PERMISSION_DENIED", permission: "ai:use" });
    expect(count(dash.id)).toBe(0);
  });

  it("WCG-2 with ai:use, POST type ai is 201", async () => {
    const { app, dash, cookie } = await setup(["dashboards:edit", "ai:use"]);
    const res = await request(app).post(`/api/dashboards/${dash.id}/widgets`).set("Cookie", cookie).send(aiBody);
    expect(res.status).toBe(201);
    expect(res.body.type).toBe("ai");
  });

  it("WCG-3 without ai:use, other widget types are unaffected", async () => {
    const { app, dash, cookie } = await setup(["dashboards:edit"]);
    const res = await request(app).post(`/api/dashboards/${dash.id}/widgets`).set("Cookie", cookie).send({ title: "B", type: "bar", config: {} });
    expect(res.status).toBe(201);
  });

  it("WCG-4 without ai:use, PATCH to type ai is 403; editing other fields of an existing ai widget is 200", async () => {
    const { app, dash, cookie } = await setup(["widgets:configure"]);
    const bar = createWidget(dash.id, { title: "B", type: "bar", position: 0, config: {} });
    const denied = await request(app).patch(`/api/widgets/${bar.id}`).set("Cookie", cookie).send({ type: "ai" });
    expect(denied.status).toBe(403);
    expect(denied.body).toMatchObject({ code: "PERMISSION_DENIED", permission: "ai:use" });
    const ai = createWidget(dash.id, { title: "AI", type: "ai", position: 1, config: {} });
    const ok = await request(app).patch(`/api/widgets/${ai.id}`).set("Cookie", cookie).send({ title: "x" });
    expect(ok.status).toBe(200);
  });
});
