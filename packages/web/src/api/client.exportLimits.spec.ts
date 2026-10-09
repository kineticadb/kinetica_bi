import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchMe } from "./client";

const body = { user: { username: "a", roles: [], permissions: [] }, authMode: "password" };
const respond = (b: unknown) =>
  vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
    new Response(JSON.stringify(b), { status: 200, headers: { "Content-Type": "application/json" } })
  );

afterEach(() => vi.restoreAllMocks());

describe("fetchMe exportLimits", () => {
  it("EXPLIM-fetchMe-maps: maps exportLimits from /me", async () => {
    const el = { maxRows: 500, maxFileMb: 100, maxConcurrentPerUser: 1 };
    respond({ ...body, exportLimits: el });
    expect((await fetchMe())?.exportLimits).toEqual(el);
  });
  it("EXPLIM-fetchMe-older-server: missing field yields defaults", async () => {
    respond(body);
    expect((await fetchMe())?.exportLimits).toEqual({ maxRows: null, maxFileMb: null, maxConcurrentPerUser: 2 });
  });
});
