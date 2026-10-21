import { describe, it, expect, vi } from "vitest";
import { createQueryPort, QUERY_ERRORS, type QueryPortDeps } from "../src/lib/ai/queryRunner";
import { buildQueryScope } from "../src/lib/ai/queryScope";
import { buildDynamicViewName } from "../src/lib/dynamicViewName";
import { UNTRUSTED_NOTICE } from "../src/lib/ai/untrusted";
import { GUARD_REASONS } from "../src/lib/ai/sqlGuard";
import { KineticaAuthError, KineticaPermissionError, KineticaUpstreamError } from "../src/kineticaErrors";
import { SessionEndedError } from "../src/lib/exportRunner";
import { captureConsole } from "./helpers/aiTestKit";

const fakePrincipal = { user: { id: 1 }, requestId: "p" } as never;
const scope = buildQueryScope({
  username: "ann",
  dashboardId: 1,
  dashboardTables: [{ id: 5, schema: "demo", name: "trips" }],
  savedViews: [{ id: 7, name: "Fares" }],
  aiViews: [],
});
const okEnc = () => ({ column_headers: ["vendor", "n"], column_1: ["AA", "BB"], column_2: [42, 7] });
const limits = { maxRows: 200, maxChars: 20000, timeoutMs: 50, maxPerAnswer: 5 };

function make(over: Partial<QueryPortDeps> & { sqlImpl?: (...a: unknown[]) => unknown } = {}) {
  const sql = vi.fn(over.sqlImpl ?? (async () => okEnc()));
  const cancel = vi.fn(async () => ({ cancelled: [] as string[] }));
  const principal = vi.fn(() => fakePrincipal);
  const port = createQueryPort({
    requestId: "rid-140-06",
    principal,
    scope,
    limits,
    liveSchema: { describe: async () => ({ ok: false }) },
    dashboardTableIds: () => [5],
    sql: sql as never,
    cancel: cancel as never,
    ...over,
  });
  return { port, sql, cancel, principal };
}
const hang = (_p: unknown, _s: unknown, opts: { signal: AbortSignal }) =>
  new Promise((_res, rej) => opts.signal.addEventListener("abort", () => rej(new KineticaUpstreamError("Kinetica request aborted"))));

describe("createQueryPort.run", () => {
  it("QRN-1 ok", async () => {
    const cap = captureConsole();
    const { port, sql, principal } = make();
    const q = "SELECT vendor, COUNT(*) AS n FROM demo.trips GROUP BY vendor";
    const r = await port.run(q);
    const text = cap.text();
    cap.restore();
    expect(r).toEqual({
      ok: true,
      envelope: { kind: "query_result", untrusted: true, notice: UNTRUSTED_NOTICE, columns: ["vendor", "n"], rows: [["AA", 42], ["BB", 7]], rowCount: 2, truncated: false, truncation: { rows: false, chars: false, cellsClipped: 0 } },
    });
    expect(sql).toHaveBeenCalledTimes(1);
    const [p, s, opts] = sql.mock.calls[0] as unknown as [unknown, string, Record<string, any>];
    expect(p).toBe(fakePrincipal);
    expect(s).toBe(q);
    expect(opts.route).toBe("AI run_query");
    expect(opts.op).toBe("SQL");
    expect(opts.tag).toBe("rid-140-06-q01");
    expect(opts.extra.limit).toBe(201);
    expect(opts.signal).toBeInstanceOf(AbortSignal);
    expect(principal).toHaveBeenCalledTimes(1);
    expect(port.entries()[0]).toMatchObject({ sql: q, rowCount: 2, outcome: "ok" });
    expect(port.entries()[0].durationMs).toBeGreaterThanOrEqual(0);
    expect(text).not.toContain("demo.trips");
  });
  it("QRN-2 row cap", async () => {
    const rows = Array.from({ length: 201 }, (_, i) => i);
    const { port } = make({ sqlImpl: async () => ({ column_headers: ["i"], column_1: rows }) });
    const r = await port.run("SELECT i FROM demo.trips");
    if (!r.ok) throw new Error("expected ok");
    expect(r.envelope.rows.length).toBe(200);
    expect(r.envelope.truncated).toBe(true);
    expect(r.envelope.truncation.rows).toBe(true);
    expect(r.envelope.note).toContain("200 rows");
    expect(r.envelope.note).toContain("add filters or aggregate");
    expect(port.entries()[0].rowCount).toBe(200);
  });
  it("QRN-3 char budget", async () => {
    const big = "x".repeat(300);
    const { port } = make({
      limits: { ...limits, maxChars: 1000 },
      sqlImpl: async () => ({ column_headers: ["s"], column_1: Array.from({ length: 50 }, () => big) }),
    });
    const r = await port.run("SELECT s FROM demo.trips");
    if (!r.ok) throw new Error("expected ok");
    for (const row of r.envelope.rows) {
      const c = row[0] as string;
      expect(c.length).toBeLessThanOrEqual(200);
      expect(c.endsWith("…")).toBe(true);
    }
    expect(r.envelope.truncation.cellsClipped).toBeGreaterThan(0);
    expect(JSON.stringify(r.envelope).length).toBeLessThanOrEqual(1000);
    expect(r.envelope.truncation.chars).toBe(true);
  });
  it("QRN-4 refusal", async () => {
    const { port, sql } = make();
    const r = await port.run("DELETE FROM demo.trips");
    expect(r).toEqual({ ok: false, message: "Refused: only a single SELECT (or WITH ... SELECT) is allowed" });
    expect(sql).not.toHaveBeenCalled();
    expect(port.entries()[0]).toMatchObject({ outcome: "refused", reason: GUARD_REASONS.notSelect, durationMs: 0 });
  });
  it("QRN-5 alias", async () => {
    const { port, sql } = make();
    const phys = buildDynamicViewName({ userId: "ann", dashboardId: 1, dynamicViewId: 7 });
    const r = await port.run("SELECT * FROM dv_7");
    expect(r.ok).toBe(true);
    expect((sql.mock.calls[0] as unknown[])[1]).toBe(`SELECT * FROM ${phys}`);
    expect(port.entries()[0].sql).toBe("SELECT * FROM dv_7");
    const r2 = await port.run(`SELECT * FROM ${phys}`);
    expect(r2.ok).toBe(false);
    expect(sql).toHaveBeenCalledTimes(1);
  });
  it("QRN-6 budget", async () => {
    const { port, sql } = make({ limits: { ...limits, maxPerAnswer: 2 } });
    expect((await port.run("DROP TABLE x")).ok).toBe(false);
    expect((await port.run("SELECT 1 FROM demo.trips")).ok).toBe(true);
    expect((await port.run("SELECT 2 FROM demo.trips")).ok).toBe(true);
    expect(await port.run("SELECT 3 FROM demo.trips")).toEqual({ ok: false, message: "Refused: query limit for this answer reached (2); answer with what you have" });
    expect(sql).toHaveBeenCalledTimes(2);
  });
  it("QRN-7 timeout", async () => {
    const { port, cancel } = make({ sqlImpl: hang as never, limits: { ...limits, timeoutMs: 30 } });
    expect(await port.run("SELECT 1 FROM demo.trips")).toEqual({ ok: false, message: "query timed out" });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledWith(fakePrincipal, "rid-140-06-q01");
    expect(port.entries()[0].outcome).toBe("timed_out");
  });
  it("QRN-8 cancel", async () => {
    const { port, cancel, sql } = make({ sqlImpl: hang as never, limits: { ...limits, timeoutMs: 5000 } });
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 5);
    expect(await port.run("SELECT 1 FROM demo.trips", ac.signal)).toEqual({ ok: false, message: "query cancelled" });
    expect(cancel).toHaveBeenCalledWith(fakePrincipal, "rid-140-06-q01");
    expect(port.entries()[0].outcome).toBe("cancelled");
    const pre = new AbortController();
    pre.abort();
    sql.mockClear();
    cancel.mockClear();
    expect(await port.run("SELECT 1 FROM demo.trips", pre.signal)).toEqual({ ok: false, message: "query cancelled" });
    expect(sql).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
  });
  it("QRN-9 D-18 categorized errors", async () => {
    const cases: [() => Error, string, string][] = [
      [() => new KineticaPermissionError("denied CANARY_QRN_7x", 403), "SELECT a FROM demo.trips", QUERY_ERRORS.noAccess],
      [() => new KineticaUpstreamError("Unknown column 'fair' in CANARY_QRN_7x", 400), "SELECT fair FROM demo.trips", "unknown column fair; check the names with describe_table"],
      [() => new KineticaUpstreamError("syntax problem near CANARY_QRN_7x", 400), "SELECT a FROM demo.trips", QUERY_ERRORS.syntax],
      [() => new KineticaUpstreamError("boom CANARY_QRN_7x", 500), "SELECT a FROM demo.trips", QUERY_ERRORS.failed],
      [() => new KineticaAuthError("bad CANARY_QRN_7x", 401), "SELECT a FROM demo.trips", QUERY_ERRORS.auth],
    ];
    const cap = captureConsole();
    for (const [mk, q, msg] of cases) {
      const { port } = make({ sqlImpl: async () => { throw mk(); } });
      const r = await port.run(q);
      expect(r).toEqual({ ok: false, message: msg });
      expect(JSON.stringify(r)).not.toContain("CANARY_QRN_7x");
      expect(port.entries()[0]).toMatchObject({ outcome: "error", reason: msg });
      expect(JSON.stringify(port.entries())).not.toContain("CANARY_QRN_7x");
    }
    const text = cap.text();
    cap.restore();
    expect(text).not.toContain("CANARY_QRN_7x");
    expect(text).not.toContain("demo.trips");
    const a = make({ principal: () => { throw new SessionEndedError(); } });
    await expect(a.port.run("SELECT a FROM demo.trips")).rejects.toBeInstanceOf(SessionEndedError);
    const b = make({ sqlImpl: async () => { throw new SessionEndedError(); } });
    await expect(b.port.run("SELECT a FROM demo.trips")).rejects.toBeInstanceOf(SessionEndedError);
  });
  it("QRN-10 hygiene (no console output with SQL / canary)", async () => {
    const cap = captureConsole();
    const { port } = make({ sqlImpl: async () => { throw new KineticaUpstreamError("x CANARY_QRN_7x", 400); } });
    await port.run("SELECT secret_col FROM demo.trips");
    const t = cap.text();
    cap.restore();
    expect(t).not.toContain("secret_col");
    expect(t).not.toContain("CANARY_QRN_7x");
  });
});
