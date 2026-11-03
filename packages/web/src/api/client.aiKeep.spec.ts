import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { listWidgets, keepAiChanges, API_BASE, KEEP_GONE_MESSAGE } from "./client";
import { useDashboardVersionStore } from "../store/dashboardVersionStore";
import { useToastStore } from "../store/toast";
import { KEEP_CONFLICT_MESSAGE, KEEP_FAILED_MESSAGE, type AiKeepRequest } from "@kinetica-bi/shared";

const payload = { baseline: 5 } as unknown as AiKeepRequest;
const okBody = { idMap: { widgets: { "-1": 9 }, layers: {}, dynamicViews: {} }, version: 6, warnings: [] };
const json = (body: unknown, status: number, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

let fetchMock: ReturnType<typeof vi.fn>;
const stub = (impl: () => Promise<unknown>) => {
  fetchMock = vi.fn(impl);
  vi.stubGlobal("fetch", fetchMock);
};

describe("client Keep + version header capture", () => {
  beforeEach(() => {
    useDashboardVersionStore.setState({ byDashboard: {} });
    useToastStore.setState({ toasts: [] } as never);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("KCL-1: records read and write headers", async () => {
    stub(async () => json({ data: [] }, 200, { "X-Kbi-Dashboard-Version-Read": "12:widgets:5", "X-Kbi-Dashboard-Version": "12:5:6" }));
    await listWidgets(12);
    const e = useDashboardVersionStore.getState().byDashboard[12];
    expect(e.reads.widgets).toBe(5);
    expect(e.edges[5]).toBe(6);
  });

  it("KCL-2: headerless mock and garbage header are tolerated", async () => {
    stub(async () => ({ ok: true, status: 200, json: async () => ({ data: [] }) }));
    await expect(listWidgets(12)).resolves.toEqual([]);
    stub(async () => json({ data: [] }, 200, { "X-Kbi-Dashboard-Version-Read": "x:y" }));
    await listWidgets(12);
    expect(useDashboardVersionStore.getState().byDashboard).toEqual({});
  });

  it("KCL-3: ok maps and posts correctly", async () => {
    stub(async () => json(okBody, 200));
    const r = await keepAiChanges(12, payload);
    expect(r).toEqual({ ok: true, response: okBody });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${API_BASE}/api/dashboards/12/ai-keep`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual(payload);
    expect(init.credentials).toBe("include");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("KCL-4: conflict", async () => {
    stub(async () => json({ error: "x", code: "AI_KEEP_CONFLICT" }, 409));
    expect(await keepAiChanges(12, payload)).toEqual({ ok: false, kind: "conflict", message: KEEP_CONFLICT_MESSAGE });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("KCL-5: permission, named right shows no toast", async () => {
    const msg = "You can't save these changes: saving dynamic views needs the Manage dynamic views permission.";
    stub(async () => json({ code: "AI_KEEP_PERMISSION", error: msg }, 403));
    expect(await keepAiChanges(12, payload)).toEqual({ ok: false, kind: "permission", message: msg });
    expect(useToastStore.getState().toasts ?? []).toHaveLength(0);
    stub(async () => json({ code: "PERMISSION_DENIED", permission: "dashboards:edit" }, 403));
    expect(await keepAiChanges(12, payload)).toEqual({ ok: false, kind: "permission", message: "You can't save AI changes." });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("KCL-6: invalid for 422 and 400", async () => {
    const msg = "This change can't be saved: widget 9 is not on this dashboard";
    for (const status of [422, 400]) {
      stub(async () => json({ code: "AI_KEEP_INVALID", error: msg }, status));
      expect(await keepAiChanges(12, payload)).toEqual({ ok: false, kind: "invalid", message: msg });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  });

  it("KCL-6b: a 404 (the unkept dashboard was removed) says so instead of 'try again'", async () => {
    stub(async () => json({ error: "Dashboard not found." }, 404));
    expect(await keepAiChanges(12, payload)).toEqual({ ok: false, kind: "invalid", message: KEEP_GONE_MESSAGE });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("KCL-7/8: everything else is failed, never rejects, never retries", async () => {
    const failed = { ok: false, kind: "failed", message: KEEP_FAILED_MESSAGE };
    const cases: Array<() => Promise<unknown>> = [
      async () => json({ code: "AI_KEEP_FAILED" }, 500),
      async () => json({ code: "AI_NOT_CONFIGURED" }, 503),
      async () => new Response("<html>", { status: 502 }),
      async () => { throw new TypeError("network"); },
    ];
    for (const c of cases) {
      stub(c);
      expect(await keepAiChanges(12, payload)).toEqual(failed);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  });
});
