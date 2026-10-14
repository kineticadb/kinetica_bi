import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { tagSql, cancelKineticaJobsByTag } from "../src/lib/kineticaJobs";

const principal = { user: { credentialType: "password", creds: { username: "ann", password: "pw" } } } as never;
const TAG = "11111111-2222-3333-4444-555555555555";

const envelope = (data: unknown) =>
  new Response(JSON.stringify({ status: "OK", data_str: JSON.stringify(data) }), { status: 200 });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  process.env.KINETICA_URL = "http://kinetica.invalid:9191";
});
afterEach(() => vi.unstubAllGlobals());

describe("kineticaJobs", () => {
  it("KJ-1: tagSql prefixes a comment", () => {
    expect(tagSql("SELECT 1", "abc")).toBe("/* kbi-ai:abc */ SELECT 1");
  });

  it("KJ-2: cancels only the job whose query_text carries the tag", async () => {
    fetchMock = vi.fn(async (url: string) =>
      String(url).endsWith("/admin/show/jobs")
        ? envelope({ job_id: [11, 12, 13], auth_id: ["a", "a", "a"], query_text: [`/* kbi-ai:${TAG} */ SELECT x`, "SELECT other", "/* kbi-ai:zzz */ SELECT y"] })
        : envelope({}),
    );
    vi.stubGlobal("fetch", fetchMock);
    const r = await cancelKineticaJobsByTag(principal, TAG);
    expect(r).toEqual({ cancelled: [11] });
    const alters = fetchMock.mock.calls.filter((c) => String(c[0]).endsWith("/admin/alter/jobs"));
    expect(alters).toHaveLength(1);
    expect(JSON.parse(alters[0][1].body)).toEqual({ job_ids: [11], action: "cancel", options: {} });
  });

  it("KJ-3: no match -> no alter call", async () => {
    fetchMock = vi.fn(async () => envelope({ job_id: [1], auth_id: ["a"], query_text: ["SELECT 1"] }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await cancelKineticaJobsByTag(principal, TAG)).toEqual({ cancelled: [] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("KJ-4: HTTP 403 or a network throw resolves empty and logs no SQL/auth", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(async () => new Response("no", { status: 403 })));
    expect(await cancelKineticaJobsByTag(principal, TAG)).toEqual({ cancelled: [] });
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("ECONNREFUSED"); }));
    expect(await cancelKineticaJobsByTag(principal, TAG)).toEqual({ cancelled: [] });
    const logged = JSON.stringify([...warn.mock.calls, ...err.mock.calls]);
    expect(logged).not.toMatch(/SELECT|Authorization|Basic /);
    warn.mockRestore();
    err.mockRestore();
  });

  it("KJ-5: a non-uuid-ish tag never reaches the network", async () => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await cancelKineticaJobsByTag(principal, "a */ b")).toEqual({ cancelled: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
