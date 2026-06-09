/**
 * Phase 56 Plan 01 (GRANTUI-V110-01/02): Unit tests for the grant CRUD client fns.
 *
 * Coverage:
 *   (a) listDashboardGrants — GET /api/dashboards/:id/access → returns json.grants
 *   (b) addDashboardGrant  — POST with Content-Type + JSON body
 *   (c) removeDashboardGrant — DELETE WITH JSON body (load-bearing DELETE-body contract)
 *   (d) non-ok response path → throwForStatus (throws)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  listDashboardGrants,
  addDashboardGrant,
  removeDashboardGrant,
} from "./client";

// ─── helpers ────────────────────────────────────────────────────────────────

function makeFetchStub(
  body: unknown,
  { ok = true, status = 200 }: { ok?: boolean; status?: number } = {},
) {
  return vi.fn().mockResolvedValue({
    ok,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  });
}

// ─── fixtures ───────────────────────────────────────────────────────────────

const GRANTS = [
  { grantee_type: "user" as const, grantee: "ann", created_at: "2026-06-09T00:00:00Z" },
  { grantee_type: "role" as const, grantee: "analyst", created_at: "2026-06-09T00:00:00Z" },
];

// ─── tests ───────────────────────────────────────────────────────────────────

describe("listDashboardGrants", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = makeFetchStub({ grants: GRANTS });
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("GETs /api/dashboards/:id/access and returns json.grants", async () => {
    const result = await listDashboardGrants(7);

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, opts] = fetchSpy.mock.calls[0] as [string, RequestInit | undefined];
    expect(url).toContain("/api/dashboards/7/access");
    // GET — no body, no explicit method (defaults to GET)
    expect(opts?.method).toBeUndefined();
    expect(result).toEqual(GRANTS);
  });

  it("throws when response is not ok", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        json: () => Promise.resolve({ error: "Forbidden" }),
        text: () => Promise.resolve(JSON.stringify({ error: "Forbidden" })),
      }),
    );
    await expect(listDashboardGrants(7)).rejects.toThrow();
  });
});

describe("addDashboardGrant", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = makeFetchStub({ grants: [...GRANTS, { grantee_type: "user", grantee: "jdoe", created_at: "2026-06-09T01:00:00Z" }] }, { status: 201 });
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs to /api/dashboards/:id/access with Content-Type and JSON body", async () => {
    await addDashboardGrant(7, { grantee_type: "user", grantee: "jdoe" });

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, opts] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/api/dashboards/7/access");
    expect(opts.method).toBe("POST");
    expect((opts.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    expect(JSON.parse(opts.body as string)).toEqual({ grantee_type: "user", grantee: "jdoe" });
  });

  it("returns the updated grants array from json.grants", async () => {
    const result = await addDashboardGrant(7, { grantee_type: "user", grantee: "jdoe" });
    expect(result).toHaveLength(3);
    expect(result.some((g) => g.grantee === "jdoe")).toBe(true);
  });
});

describe("removeDashboardGrant", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = makeFetchStub({
      grants: [{ grantee_type: "user", grantee: "ann", created_at: "2026-06-09T00:00:00Z" }],
    });
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fires method DELETE with a JSON body containing grantee_type and grantee (load-bearing contract)", async () => {
    await removeDashboardGrant(7, { grantee_type: "role", grantee: "analyst" });

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, opts] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/api/dashboards/7/access");
    expect(opts.method).toBe("DELETE");
    // The body MUST be present (server reads grantee_type/grantee from req.body — 55-02 decision)
    expect(opts.body).toBeDefined();
    expect(JSON.parse(opts.body as string)).toEqual({ grantee_type: "role", grantee: "analyst" });
    expect((opts.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
  });

  it("returns the updated grants array after removal", async () => {
    const result = await removeDashboardGrant(7, { grantee_type: "role", grantee: "analyst" });
    expect(result).toHaveLength(1);
    expect(result[0].grantee).toBe("ann");
  });

  it("throws when response is not ok", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ error: "Invalid grantee_type" }),
        text: () => Promise.resolve(JSON.stringify({ error: "Invalid grantee_type" })),
      }),
    );
    await expect(
      removeDashboardGrant(7, { grantee_type: "user", grantee: "ann" }),
    ).rejects.toThrow();
  });
});
