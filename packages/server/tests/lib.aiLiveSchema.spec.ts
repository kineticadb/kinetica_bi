import { describe, it, expect, vi, beforeEach } from "vitest";
import { createLiveSchema, __clearLiveSchemaCacheForTest } from "../src/lib/ai/liveSchema";
import { KineticaPermissionError, KineticaUpstreamError } from "../src/kineticaErrors";
import { SessionEndedError } from "../src/lib/exportRunner";
import { CANARY_ROW_VALUE_9f3 as C } from "./helpers/aiTestKit";

const principal = { user: { creds: { username: "ann" } } } as never;
const table = (over: Record<string, unknown> = {}) => ({
  id: 7, name: "nyctaxi", schema: "demo", columns: { fare_amount: "double", vendor_id: "string" },
  created_at: "", updated_at: "", ...over,
});
const probe = (cols: string[]) => ({ column_headers: cols });
const mk = (o: Record<string, unknown> = {}) => {
  const sql = vi.fn(async () => probe(["fare_amount", "vendor_id", "new_col"]));
  let t = 0;
  const now = () => t;
  const adv = (ms: number) => { t += ms; };
  const port = (username = "ann") =>
    createLiveSchema({ username, principal: () => principal, getTable: (id) => (id === 7 ? (table() as never) : undefined), sql: sql as never, now, ...o });
  return { sql, port, adv };
};

beforeEach(() => __clearLiveSchemaCacheForTest());

describe("live schema port", () => {
  it("LSC-1: probe names, registry types, exact SQL, injected principal", async () => {
    const { sql, port } = mk();
    const r = await port().describe(7);
    expect(r).toEqual({
      ok: true,
      table: { id: 7, schema: "demo", name: "nyctaxi", columns: [
        { name: "fare_amount", type: "double" }, { name: "vendor_id", type: "string" }, { name: "new_col" },
      ] },
    });
    expect(sql).toHaveBeenCalledWith(principal, "SELECT * FROM demo.nyctaxi LIMIT 0", expect.objectContaining({ op: "DISCOVERY" }));
  });

  it("LSC-2: empty schema omits the prefix", async () => {
    const sql = vi.fn(async () => probe(["a"]));
    const p = createLiveSchema({ username: "ann", principal: () => principal, getTable: () => table({ schema: "" }) as never, sql: sql as never });
    await p.describe(7);
    expect(sql.mock.calls[0][1]).toBe("SELECT * FROM nyctaxi LIMIT 0");
  });

  it("LSC-3: every failure is exactly {ok:false}; no sql for unregistered/invalid ident", async () => {
    const { sql, port } = mk();
    expect(await port().describe(8)).toEqual({ ok: false });
    expect(sql).not.toHaveBeenCalled();
    const bad = createLiveSchema({ username: "ann", principal: () => principal, getTable: () => table({ name: "x; DROP" }) as never, sql: sql as never });
    expect(await bad.describe(7)).toEqual({ ok: false });
    expect(sql).not.toHaveBeenCalled();
    for (const err of [new KineticaPermissionError("denied", 403), new KineticaUpstreamError(`boom ${C}` as never), new Error(C)]) {
      __clearLiveSchemaCacheForTest();
      const s = vi.fn(async () => { throw err; });
      const p = createLiveSchema({ username: "ann", principal: () => principal, getTable: () => table() as never, sql: s as never });
      const r = await p.describe(7);
      expect(r).toEqual({ ok: false });
      expect(JSON.stringify(r)).not.toContain(C);
    }
  });

  it("LSC-4: SessionEndedError propagates", async () => {
    const p = createLiveSchema({ username: "ann", principal: () => { throw new SessionEndedError(); }, getTable: () => table() as never, sql: vi.fn() as never });
    await expect(p.describe(7)).rejects.toBeInstanceOf(SessionEndedError);
  });

  it("LSC-5: per-(user,table) TTL cache; failures not cached", async () => {
    const { sql, port, adv } = mk();
    await port().describe(7);
    await port().describe(7);
    expect(sql).toHaveBeenCalledTimes(1);
    await port("bob").describe(7);
    expect(sql).toHaveBeenCalledTimes(2);
    adv(61_000);
    await port().describe(7);
    expect(sql).toHaveBeenCalledTimes(3);
    const fail = vi.fn(async () => { throw new Error("x"); });
    const p = createLiveSchema({ username: "zed", principal: () => principal, getTable: () => table() as never, sql: fail as never });
    await p.describe(7); await p.describe(7);
    expect(fail).toHaveBeenCalledTimes(2);
  });
});
