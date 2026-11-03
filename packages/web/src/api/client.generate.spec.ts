import { describe, it, expect, vi, afterEach } from "vitest";
import { generateDashboard, discardGeneratedDashboard, API_BASE } from "./client";

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
let fetchMock: ReturnType<typeof vi.fn>;
const stub = (impl: () => Promise<unknown>) => {
  fetchMock = vi.fn(impl);
  vi.stubGlobal("fetch", fetchMock);
};
const FALLBACK = "Couldn't generate the dashboard. Try again.";

describe("generateDashboard / discardGeneratedDashboard", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("GENAPI-1: posts JSON and maps 201 to ok", async () => {
    const dto = { id: 1, name: "Trips", generated_pending: true };
    stub(async () => json(dto, 201));
    const r = await generateDashboard({ name: "Trips", tableId: 7 });
    expect(r).toEqual({ ok: true, dashboard: dto });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${API_BASE}/api/dashboards/generate`);
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body as string)).toEqual({ name: "Trips", tableId: 7 });
  });

  it("GENAPI-2: 409 AI_GENERATE_PENDING maps to pending", async () => {
    stub(async () => json({ code: "AI_GENERATE_PENDING", error: "pending msg", dashboard: { id: 5, name: "Old" } }, 409));
    expect(await generateDashboard({ name: "x", tableId: 1 })).toEqual({
      ok: false, kind: "pending", existing: { id: 5, name: "Old" }, message: "pending msg"
    });
  });

  it("GENAPI-3: failures never throw and map to error", async () => {
    stub(async () => json({ code: "AI_NOT_CONFIGURED", error: "AI is not configured." }, 503));
    expect(await generateDashboard({ name: "x", tableId: 1 })).toEqual({ ok: false, kind: "error", message: "AI is not configured." });
    stub(async () => json({ code: "AI_TABLE_UNREADABLE" }, 422));
    expect(await generateDashboard({ name: "x", tableId: 1 })).toEqual({ ok: false, kind: "error", message: FALLBACK });
    stub(async () => json({ code: "PERMISSION_DENIED", permission: "ai:use" }, 403));
    expect((await generateDashboard({ name: "x", tableId: 1 })).ok).toBe(false);
    stub(async () => json({}, 500));
    expect(await generateDashboard({ name: "x", tableId: 1 })).toEqual({ ok: false, kind: "error", message: FALLBACK });
    stub(async () => { throw new Error("net"); });
    expect(await generateDashboard({ name: "x", tableId: 1 })).toEqual({ ok: false, kind: "error", message: FALLBACK });
    stub(async () => new Response("<html>", { status: 502 }));
    expect(await generateDashboard({ name: "x", tableId: 1 })).toEqual({ ok: false, kind: "error", message: FALLBACK });
  });

  it("GENAPI-4: discard posts and resolves on 204; rejects with server text", async () => {
    stub(async () => new Response(null, { status: 204 }));
    await expect(discardGeneratedDashboard(9)).resolves.toBeUndefined();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${API_BASE}/api/dashboards/9/discard-generated`);
    expect(init.method).toBe("POST");
    stub(async () => json({ error: "Dashboard not found." }, 404));
    await expect(discardGeneratedDashboard(9)).rejects.toThrow("Dashboard not found.");
    stub(async () => json({ error: "Already kept.", code: "DASHBOARD_ALREADY_KEPT" }, 409));
    await expect(discardGeneratedDashboard(9)).rejects.toThrow("Already kept.");
  });
});
