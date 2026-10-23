import { describe, it, expect, vi, afterEach } from "vitest";
import { listAiAudit, getAiAuditEntry, listAiAuditDashboards, API_BASE } from "./client";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
let fetchMock: ReturnType<typeof vi.fn>;
const stub = (impl: () => Promise<unknown>) => {
  fetchMock = vi.fn(impl);
  vi.stubGlobal("fetch", fetchMock);
};

describe("AI audit client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("AUDCLI-1: listAiAudit builds the query and returns JSON; non-ok throws", async () => {
    const body = { rows: [], total: 0, page: 2, pageSize: 50 };
    stub(async () => json(body));
    const r = await listAiAudit({ from: 1, to: 2, outcomes: ["kept", "ok"], dashboardId: 5, page: 2 });
    expect(r).toEqual(body);
    expect(fetchMock.mock.calls[0][0]).toBe(`${API_BASE}/api/ai/audit?from=1&to=2&outcome=kept%2Cok&dashboardId=5&page=2`);

    stub(async () => json({}));
    await listAiAudit({});
    expect(fetchMock.mock.calls[0][0]).toBe(`${API_BASE}/api/ai/audit`);

    stub(async () => json({}, 403));
    await expect(listAiAudit({})).rejects.toThrow("Failed to load AI activity (403)");
  });

  it("AUDCLI-2: getAiAuditEntry and listAiAuditDashboards URLs", async () => {
    stub(async () => json({ id: 7 }));
    await getAiAuditEntry(7);
    expect(fetchMock.mock.calls[0][0]).toBe(`${API_BASE}/api/ai/audit/7`);
    stub(async () => json({ dashboards: [] }));
    await listAiAuditDashboards({ from: 10, to: 20 });
    expect(fetchMock.mock.calls[0][0]).toBe(`${API_BASE}/api/ai/audit/dashboards?from=10&to=20`);
  });
});
