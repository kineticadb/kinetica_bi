import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createSession, getSession } from "../src/sessionStore";
import {
  principalForSession,
  SessionEndedError,
  getExportDir,
  getExportViewTtlMinutes,
} from "../src/lib/exportRunner";
import path from "node:path";

describe("runner primitives", () => {
  it("EXPRUN-principal-fresh: principalForSession maps a password session like auth.ts and returns a new object per call", () => {
    const sid = createSession({ username: "alice", secret: "export-test-secret", kineticaUrl: process.env.KINETICA_URL! });
    const a = principalForSession(sid);
    const b = principalForSession(sid);
    expect(a).not.toBe(b);
    expect(a.user!.sub).toBe("alice");
    expect(a.user!.sid).toBe(sid);
    expect(a.user!.credentialType).toBe("password");
    expect(a.user!.creds.username).toBe("alice");
    expect(a.user!.creds.password).toBe("export-test-secret");
    expect(a.user!.creds.token).toBe("");
    expect(a.requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(a.requestId).not.toBe(b.requestId);
  });

  it("EXPRUN-principal-dead: a deleted session throws SessionEndedError", async () => {
    const { deleteSession } = await import("../src/sessionStore");
    const sid = createSession({ username: "bob", secret: "s", kineticaUrl: process.env.KINETICA_URL! });
    deleteSession(sid);
    expect(() => principalForSession(sid)).toThrow(SessionEndedError);
  });

  it("EXPRUN-principal-url-mismatch: another kineticaUrl throws SessionEndedError and the row is deleted", () => {
    const sid = createSession({ username: "carol", secret: "s", kineticaUrl: "https://other.test:9191" });
    expect(() => principalForSession(sid)).toThrow(SessionEndedError);
    expect(getSession(sid)).toBeNull();
  });

  it("EXPRUN-env-defaults: blank envs give <cwd>/data/exports and 60", () => {
    process.env.EXPORT_DIR = "";
    process.env.EXPORT_VIEW_TTL_MINUTES = "";
    expect(getExportDir()).toBe(path.join(process.cwd(), "data", "exports"));
    expect(getExportViewTtlMinutes()).toBe(60);
  });

  it("EXPRUN-env-ttl-bad: invalid TTL falls back to 60 and warns once per bad value", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      for (const bad of ["abc", "0"]) {
        process.env.EXPORT_VIEW_TTL_MINUTES = bad;
        expect(getExportViewTtlMinutes()).toBe(60);
        expect(getExportViewTtlMinutes()).toBe(60);
      }
      expect(warn).toHaveBeenCalledTimes(2);
    } finally {
      process.env.EXPORT_VIEW_TTL_MINUTES = "";
    }
  });
});

// ---------------------------------------------------------------------------
// Run loop
// ---------------------------------------------------------------------------
import fs from "node:fs";
import os from "node:os";
import zlib from "node:zlib";
import { createDashboard, createWidget, createTable, getExportJob, db } from "../src/db";
import { startExport, __exportRunForTest, cancelExport } from "../src/lib/exportRunner";
import { ExportSpecError, EXPORT_PAGING_MECHANISM } from "../src/lib/exportSql";
import { rowsToCsv } from "../../web/src/lib/csvExport";

const respond = (encoded: unknown, extra: Record<string, unknown> = {}) =>
  new Response(
    JSON.stringify({
      status: "OK",
      data_str: JSON.stringify({ json_encoded_response: JSON.stringify(encoded), ...extra }),
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );

type Stub = {
  stmts: string[];
  bodies: any[];
  batchOffsets: number[];
};

const HEADERS = ["id", "name", "amount"];
const makeRow = (i: number): unknown[] => [i, i === 3 ? "=1+1" : `n${i}`, i === 4 ? -5 : i * 1.5];

function installStub(
  N: number,
  opts: {
    countOverride?: number;
    pageCap?: number;
    glitch?: boolean;
    failBatchAt?: number;
    failSnapshot?: Response;
    missingRows?: number;
  } = {},
): Stub {
  const st: Stub = { stmts: [], bodies: [], batchOffsets: [] };
  let glitched = false;
  let batchCalls = 0;
  const f = vi.fn().mockImplementation(async (_url: string, init: any) => {
    const body = JSON.parse(init.body as string);
    const stmt: string = body.statement;
    st.stmts.push(stmt);
    st.bodies.push(body);
    if (/^CREATE (OR REPLACE )?MATERIALIZED VIEW/.test(stmt)) {
      if (opts.failSnapshot) return opts.failSnapshot;
      return respond({});
    }
    if (/^DROP TABLE IF EXISTS/.test(stmt)) return respond({});
    if (/SELECT COUNT\(\*\)/.test(stmt)) {
      return respond({ column_headers: ["total"], column_1: [opts.countOverride ?? N] });
    }
    const total = N - (opts.missingRows ?? 0);
    if (body.limit === 1 && !/ORDER BY/.test(stmt)) {
      return respond({ column_headers: HEADERS, column_1: [0], column_2: ["n0"], column_3: [0] }, { has_more_records: true });
    }
    batchCalls++;
    if (opts.failBatchAt && batchCalls === opts.failBatchAt) {
      return new Response("boom", { status: 500 });
    }
    st.batchOffsets.push(body.offset);
    let n = Math.min(body.limit, opts.pageCap ?? body.limit, Math.max(0, total - body.offset));
    if (opts.glitch) {
      if (body.offset === 14) n = Math.min(n, 3);
      if (body.offset === 17 && !glitched) {
        glitched = true;
        return respond({ column_headers: HEADERS, column_1: [], column_2: [], column_3: [] }, { has_more_records: true });
      }
    }
    const rows = Array.from({ length: n }, (_, k) => makeRow(body.offset + k));
    const sel = /^SELECT \*/.test(stmt) ? HEADERS : HEADERS;
    return respond(
      {
        column_headers: sel,
        column_1: rows.map((r) => r[0]),
        column_2: rows.map((r) => r[1]),
        column_3: rows.map((r) => r[2]),
      },
      { has_more_records: body.offset + n < total },
    );
  });
  vi.stubGlobal("fetch", f);
  return st;
}

describe("run loop", () => {
  let dir: string;
  let sid: string;
  let widgetId: number;
  let starWidgetId: number;

  const objsFor = (N: number) => Array.from({ length: N }, (_, i) => Object.fromEntries(HEADERS.map((h, j) => [h, makeRow(i)[j]])));
  const expected = (N: number) => rowsToCsv(objsFor(N), HEADERS);

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "kbi-exp-"));
    process.env.EXPORT_DIR = dir;
    process.env.KINETICA_MAX_RECORDS_PER_CALL = "20";
    process.env.KINETICA_MAX_ROWS_PER_QUERY = "";
    sid = createSession({ username: "runner", secret: "export-test-secret", kineticaUrl: process.env.KINETICA_URL! });
    const dash = createDashboard("exp-" + Math.random());
    const t = createTable({ name: "demo_table", schema: "demo_schema" });
    widgetId = createWidget(dash.id, {
      title: "w",
      type: "records",
      position: 0,
      config: { tableId: t.id, table: "demo_schema.demo_table", columns: "id, name, amount", sortField: "id", sortDirection: "asc" },
    }).id;
    starWidgetId = createWidget(dash.id, {
      title: "w2",
      type: "records",
      position: 1,
      config: { tableId: t.id, table: "demo_schema.demo_table" },
    }).id;
  });
  afterEach(() => {
    process.env.EXPORT_DIR = "";
    process.env.KINETICA_MAX_RECORDS_PER_CALL = "";
    fs.rmSync(dir, { recursive: true, force: true });
    vi.unstubAllGlobals();
  });

  const go = async (spec: any = { widgetId }, options?: any) => {
    const { jobId } = startExport({ spec, sid, username: "runner", options });
    await __exportRunForTest(jobId);
    return { jobId, job: getExportJob(jobId)! };
  };

  it("EXPRUN-multibatch: 45 rows in 20/20/5 batches produce a complete file byte-identical to web rowsToCsv", async () => {
    const st = installStub(45);
    const { jobId, job } = await go();
    expect(job.status).toBe("complete");
    expect(job.totalRows).toBe(45);
    expect(job.rowsWritten).toBe(45);
    expect(job.filePath).toBe(path.join(dir, `${jobId}.csv`));
    expect(job.fileBytes).toBe(fs.statSync(job.filePath!).size);
    expect(fs.readFileSync(job.filePath!, "utf8")).toBe(expected(45));
    expect(fs.existsSync(job.filePath! + ".part")).toBe(false);
    expect(st.batchOffsets).toEqual([0, 20, 40]);
  });

  it("EXPRUN-advance-by-received: a short batch flagged has_more_records advances the next offset by rows received", async () => {
    const st = installStub(45, { glitch: true, pageCap: 7 });
    const { job } = await go();
    expect(job.status).toBe("complete");
    // batch 1 received 17 rows (7+... capped by glitch); the following request starts at 17, not 20
    expect(st.batchOffsets).toContain(17);
    expect(st.batchOffsets.filter((o) => o === 20)).toEqual([]);
    expect(st.batchOffsets.filter((o) => o === 17).length).toBe(2);
    expect(fs.readFileSync(job.filePath!, "utf8")).toBe(expected(45));
  });

  it("EXPRUN-short-page-not-end: a short page with has_more_records true does not end the loop", async () => {
    installStub(45, { glitch: true, pageCap: 7 });
    const { job } = await go();
    expect(job.status).toBe("complete");
    expect(job.rowsWritten).toBe(45);
  });

  it("EXPRUN-row-mismatch: COUNT 50 but 45 rows delivered fails with row_mismatch and no file", async () => {
    installStub(45, { countOverride: 50 });
    const { jobId, job } = await go();
    expect(job.status).toBe("failed");
    expect(job.errorCode).toBe("row_mismatch");
    expect(fs.readdirSync(dir).filter((f) => f.startsWith(jobId))).toEqual([]);
  });

  it("EXPRUN-snapshot-first: the first statement creates _kbi_exp_<id8>; COUNT and batches read the view only", async () => {
    const st = installStub(10);
    const { jobId } = await go();
    const view = `_kbi_exp_${jobId.replace(/-/g, "").slice(0, 8)}`;
    expect(st.stmts[0]).toBe(
      `CREATE OR REPLACE MATERIALIZED VIEW ${view} AS (SELECT * FROM demo_schema.demo_table) USING TABLE PROPERTIES (TTL = 60)`,
    );
    for (const s of st.stmts.slice(1).filter((x) => !x.startsWith("DROP"))) {
      expect(s).toContain(`FROM ${view}`);
      expect(s).not.toContain("demo_schema.demo_table");
    }
  });

  it("EXPRUN-mechanism: batch bodies follow EXPORT_PAGING_MECHANISM", async () => {
    const st = installStub(10);
    await go();
    const batch = st.bodies.find((b) => /ORDER BY/.test(b.statement))!;
    if (EXPORT_PAGING_MECHANISM === "offset") {
      expect(batch.statement).toContain("ORDER BY id ASC, name, amount");
      expect(batch.options).toEqual({});
    } else {
      expect(batch.options.paging_table).toBeTruthy();
    }
  });

  it("EXPRUN-cleanup: DROP TABLE IF EXISTS is sent for the snapshot view after completion", async () => {
    const st = installStub(10);
    const { jobId } = await go();
    const view = `_kbi_exp_${jobId.replace(/-/g, "").slice(0, 8)}`;
    expect(st.stmts[st.stmts.length - 1]).toBe(`DROP TABLE IF EXISTS ${view}`);
  });

  it("EXPRUN-select-star-header: a widget with no columns writes the probe's column_headers as the header", async () => {
    installStub(5);
    const { job } = await go({ widgetId: starWidgetId });
    expect(job.status).toBe("complete");
    expect(fs.readFileSync(job.filePath!, "utf8").split("\r\n")[0]).toBe("id,name,amount");
  });

  it("EXPRUN-kinetica-error: a 500 on batch 2 fails with kinetica_error and no file", async () => {
    installStub(45, { failBatchAt: 2 });
    const { jobId, job } = await go();
    expect(job.status).toBe("failed");
    expect(job.errorCode).toBe("kinetica_error");
    expect(fs.readdirSync(dir).filter((f) => f.startsWith(jobId))).toEqual([]);
  });

  it("EXPRUN-snapshot-denied: a permission failure at snapshot creation fails with kinetica_error and a readable message", async () => {
    installStub(5, {
      failSnapshot: new Response(JSON.stringify({ message: "User does not have permission to create table" }), { status: 403 }),
    });
    const { jobId, job } = await go();
    expect(job.status).toBe("failed");
    expect(job.errorCode).toBe("kinetica_error");
    expect(job.errorMessage).toContain("Could not create the export snapshot");
    expect(job.errorMessage).toContain("materialized views");
    expect(fs.readdirSync(dir).filter((f) => f.startsWith(jobId))).toEqual([]);
  });

  it("EXPRUN-snapshot-denied-200: an ERROR body at snapshot creation also ends failed/kinetica_error", async () => {
    installStub(5, {
      failSnapshot: new Response(JSON.stringify({ status: "ERROR", message: "Permission denied" }), { status: 200 }),
    });
    const { job } = await go();
    expect(job.status).toBe("failed");
    expect(job.errorCode).toBe("kinetica_error");
    expect(job.errorMessage).toContain("Could not create the export snapshot");
  });

  it("EXPRUN-spec-error: an unknown widgetId throws ExportSpecError and inserts no export_jobs row", () => {
    installStub(1);
    const before = (db.prepare("SELECT COUNT(*) AS n FROM export_jobs").get() as any).n;
    expect(() => startExport({ spec: { widgetId: 999999 }, sid, username: "runner" })).toThrow(ExportSpecError);
    expect((db.prepare("SELECT COUNT(*) AS n FROM export_jobs").get() as any).n).toBe(before);
  });

  it("EXPRUN-gzip: options { gzip: true } produces <jobId>.csv.gz whose gunzip equals the plain bytes", async () => {
    installStub(25);
    const { jobId, job } = await go({ widgetId }, { gzip: true });
    expect(job.status).toBe("complete");
    expect(job.filePath).toBe(path.join(dir, `${jobId}.csv.gz`));
    expect(zlib.gunzipSync(fs.readFileSync(job.filePath!)).toString()).toBe(expected(25));
  });

  it("EXPRUN-batch-size: each batch request asks for min(maxRowsPerQuery, maxRecordsPerCall) rows", async () => {
    process.env.KINETICA_MAX_ROWS_PER_QUERY = "15";
    process.env.KINETICA_MAX_RECORDS_PER_CALL = "20";
    const st = installStub(40);
    await go();
    const batches = st.bodies.filter((b) => /ORDER BY/.test(b.statement));
    expect(batches.length).toBeGreaterThan(0);
    for (const b of batches) expect(b.limit).toBe(15);
    process.env.KINETICA_MAX_ROWS_PER_QUERY = "";
  });

  it("EXPRUN-no-secret: no export_jobs column value contains the session secret or its Basic header", async () => {
    installStub(10);
    const { jobId } = await go();
    const row = db.prepare("SELECT * FROM export_jobs WHERE id = ?").get(jobId) as Record<string, unknown>;
    const blob = JSON.stringify(row);
    expect(blob).not.toContain("export-test-secret");
    expect(blob).not.toContain(Buffer.from("runner:export-test-secret").toString("base64"));
  });

  it("EXPRUN-cancel-no-run: cancelExport on a queued job without a live run finalizes it cancelled", () => {
    const { jobId } = startExport({ spec: { widgetId }, sid, username: "runner" });
    installStub(1);
    // live controller exists -> abort path returns true
    expect(cancelExport(jobId)).toBe(true);
    expect(cancelExport("nope")).toBe(false);
  });
});
