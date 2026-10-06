import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createSession, getSession, deleteSession } from "../src/sessionStore";
import { createDashboard, createWidget, createTable, getExportJob, db } from "../src/db";
import {
  startExport,
  __exportRunForTest,
  principalForSession,
  EXPORT_SESSION_ENDED_MESSAGE,
} from "../src/lib/exportRunner";

const respond = (encoded: unknown, extra: Record<string, unknown> = {}) =>
  new Response(
    JSON.stringify({
      status: "OK",
      data_str: JSON.stringify({ json_encoded_response: JSON.stringify(encoded), ...extra }),
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );

const HEADERS = ["id", "name", "amount"];
const makeRow = (i: number): unknown[] => [i, `n${i}`, i * 1.5];

type Stub = { stmts: string[]; auths: string[]; batchNos: number[] };

/** `onBatch(n)` runs while serving the n-th batch request; `fail401At` makes that batch return 401. */
function installStub(N: number, opts: { onBatch?: (n: number) => void; fail401At?: number } = {}): Stub {
  const st: Stub = { stmts: [], auths: [], batchNos: [] };
  let batchCalls = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(async (_url: string, init: any) => {
      const body = JSON.parse(init.body as string);
      const stmt: string = body.statement;
      st.stmts.push(stmt);
      st.auths.push(init.headers?.Authorization ?? init.headers?.authorization);
      if (/^CREATE (OR REPLACE )?MATERIALIZED VIEW/.test(stmt)) return respond({});
      if (/^DROP TABLE IF EXISTS/.test(stmt)) return respond({});
      if (/SELECT COUNT\(\*\)/.test(stmt)) return respond({ column_headers: ["total"], column_1: [N] });
      batchCalls++;
      st.batchNos.push(batchCalls);
      opts.onBatch?.(batchCalls);
      if (opts.fail401At === batchCalls) return new Response("unauthorized", { status: 401 });
      const n = Math.min(body.limit, Math.max(0, N - body.offset));
      const rows = Array.from({ length: n }, (_, k) => makeRow(body.offset + k));
      return respond(
        {
          column_headers: HEADERS,
          column_1: rows.map((r) => r[0]),
          column_2: rows.map((r) => r[1]),
          column_3: rows.map((r) => r[2]),
        },
        { has_more_records: body.offset + n < N },
      );
    }),
  );
  return st;
}

const SECRET = "sess-secret-9f3";

describe("export session binding", () => {
  let dir: string;
  let sid: string;
  let widgetId: number;

  const expire = (s: string) =>
    db.prepare("UPDATE sessions SET expires_at = datetime('now', '-1 hour') WHERE sid = ?").run(s);
  const files = (jobId: string) => fs.readdirSync(dir).filter((f) => f.startsWith(jobId));
  const go = async (s = sid) => {
    const { jobId } = startExport({ spec: { widgetId }, sid: s, username: "sessuser" });
    await __exportRunForTest(jobId);
    return { jobId, job: getExportJob(jobId)! };
  };
  const expectD16 = (job: ReturnType<typeof getExportJob>) => {
    expect(job!.status).toBe("session_expired");
    expect(job!.errorCode).toBe("session_expired");
    expect(job!.errorMessage).toBe(EXPORT_SESSION_ENDED_MESSAGE);
  };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "kbi-expsess-"));
    process.env.EXPORT_DIR = dir;
    process.env.KINETICA_MAX_RECORDS_PER_CALL = "20";
    process.env.KINETICA_MAX_ROWS_PER_QUERY = "";
    sid = createSession({ username: "sessuser", secret: SECRET, kineticaUrl: process.env.KINETICA_URL! });
    const dash = createDashboard("expsess-" + Math.random());
    const t = createTable({ name: "demo_table", schema: "demo_schema" });
    widgetId = createWidget(dash.id, {
      title: "w",
      type: "records",
      position: 0,
      config: { tableId: t.id, table: "demo_schema.demo_table", columns: "id, name, amount", sortField: "id", sortDirection: "asc" },
    }).id;
  });
  afterEach(() => {
    process.env.EXPORT_DIR = "";
    process.env.KINETICA_MAX_RECORDS_PER_CALL = "";
    fs.rmSync(dir, { recursive: true, force: true });
    vi.unstubAllGlobals();
  });

  it("EXPSESS-logout-between-batches: deleting the session after batch 1 stops the job before batch 2", async () => {
    const st = installStub(100, { onBatch: (n) => n === 1 && deleteSession(sid) });
    const { jobId, job } = await go();
    expectD16(job);
    expect(st.batchNos).toEqual([1]);
    // CREATE, COUNT, batch 1 and nothing after (cleanup DROP skipped: session gone)
    expect(st.stmts.length).toBe(3);
    expect(st.stmts.some((s) => s.startsWith("DROP"))).toBe(false);
    expect(files(jobId)).toEqual([]);
  });

  it("EXPSESS-expired-before-start: an already-expired session ends session_expired with zero fetch calls", async () => {
    const st = installStub(100);
    expire(sid);
    const { jobId, job } = await go();
    expectD16(job);
    expect(st.stmts).toEqual([]);
    expect(files(jobId)).toEqual([]);
  });

  it("EXPSESS-expires-mid-run: forcing expires_at into the past during batch 1 behaves like logout", async () => {
    const st = installStub(100, { onBatch: (n) => n === 1 && expire(sid) });
    const { jobId, job } = await go();
    expectD16(job);
    expect(st.batchNos).toEqual([1]);
    expect(st.stmts.length).toBe(3);
    expect(files(jobId)).toEqual([]);
  });

  it("EXPSESS-kinetica-401: a 401 from Kinetica on batch 2 ends session_expired with the D-16 message and no file", async () => {
    installStub(100, { fail401At: 2 });
    const { jobId, job } = await go();
    expectD16(job);
    expect(files(jobId)).toEqual([]);
  });

  it("EXPSESS-url-mismatch: a session stamped with a different kineticaUrl ends session_expired and the row is deleted", async () => {
    const st = installStub(100);
    const other = createSession({ username: "sessuser", secret: SECRET, kineticaUrl: "https://other.test:9191" });
    const { job } = await go(other);
    expectD16(job);
    expect(st.stmts).toEqual([]);
    expect(getSession(other)).toBeNull();
  });

  it("EXPSESS-fresh-principal: every request carries an Authorization derived from the session at that moment", async () => {
    const st = installStub(45);
    const { job } = await go();
    expect(job.status).toBe("complete");
    const want = "Basic " + Buffer.from(`sessuser:${SECRET}`).toString("base64");
    expect(st.auths.length).toBeGreaterThan(3);
    for (const a of st.auths) expect(a).toBe(want);
    expect(principalForSession(sid)).not.toBe(principalForSession(sid));
  });

  it("EXPSESS-no-secret: no export_jobs value contains the secret, its Basic header, or 'password'", async () => {
    installStub(45);
    const { jobId } = await go();
    const blob = JSON.stringify(db.prepare("SELECT * FROM export_jobs WHERE id = ?").get(jobId));
    expect(blob).not.toContain(SECRET);
    expect(blob).not.toContain(Buffer.from(`sessuser:${SECRET}`).toString("base64"));
    expect(blob.toLowerCase()).not.toContain("password");
  });

  it("EXPSESS-no-touch: running an export does not change the session's expires_at", async () => {
    installStub(45);
    const before = (db.prepare("SELECT expires_at FROM sessions WHERE sid = ?").get(sid) as any).expires_at;
    const { job } = await go();
    expect(job.status).toBe("complete");
    const after = (db.prepare("SELECT expires_at FROM sessions WHERE sid = ?").get(sid) as any).expires_at;
    expect(after).toBe(before);
  });
});
