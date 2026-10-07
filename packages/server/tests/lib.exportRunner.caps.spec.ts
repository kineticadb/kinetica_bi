/**
 * Phase 130 Plan 02 — runner caps (EXPRT-V126-15). Do NOT assert a fixed total pass-count (SET-BASED gate).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import { randomBytes } from "node:crypto";
import { createSession } from "../src/sessionStore";
import { db, createDashboard, createWidget, createTable, getExportJob } from "../src/db";
import { startExport, cancelExport, writeCsv, getExportBatchSize, __exportRunForTest } from "../src/lib/exportRunner";
import { ExportCapError, SizeCapError, sizeCapMessage } from "../src/lib/exportCaps";
import { ExportSpecError } from "../src/lib/exportSql";

const respond = (encoded: unknown, extra: Record<string, unknown> = {}) =>
  new Response(
    JSON.stringify({
      status: "OK",
      data_str: JSON.stringify({ json_encoded_response: JSON.stringify(encoded), ...extra }),
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );

const HEADERS = ["id", "name", "amount"];
const PAD = "x".repeat(100);

type Stub = { batches: number };

/** `pad(i)` supplies the name column; `hold` may block a batch response. */
function installStub(
  N: number,
  opts: { hold?: () => Promise<void> | void; pad?: (i: number) => string } = {},
): Stub {
  const st: Stub = { batches: 0 };
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(async (_url: string, init: any) => {
      const body = JSON.parse(init.body as string);
      const stmt: string = body.statement;
      if (/^CREATE (OR REPLACE )?MATERIALIZED VIEW/.test(stmt)) return respond({});
      if (/^DROP TABLE IF EXISTS/.test(stmt)) return respond({});
      if (/SELECT COUNT\(\*\)/.test(stmt)) return respond({ column_headers: ["total"], column_1: [N] });
      st.batches++;
      await opts.hold?.();
      const n = Math.min(body.limit, Math.max(0, N - body.offset));
      const ids = Array.from({ length: n }, (_, k) => body.offset + k);
      return respond(
        {
          column_headers: HEADERS,
          column_1: ids,
          column_2: ids.map((i) => (opts.pad ? opts.pad(i) : `n${i}`)),
          column_3: ids.map((i) => i * 1.5),
        },
        { has_more_records: body.offset + n < N },
      );
    }),
  );
  return st;
}

describe("export caps (runner)", () => {
  let dir: string;
  let sid: string;
  let widgetId: number;
  let release!: () => void;
  let gate: Promise<void>;
  const started: string[] = [];

  const start = (username: string, options?: { gzip?: boolean }) => {
    const r = startExport({ spec: { widgetId }, sid, username, options });
    started.push(r.jobId);
    return r;
  };
  const rowCount = () => (db.prepare("SELECT COUNT(*) AS c FROM export_jobs").get() as { c: number }).c;

  beforeEach(() => {
    db.exec("DELETE FROM export_jobs");
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "kbi-expcaps-"));
    process.env.EXPORT_DIR = dir;
    process.env.KINETICA_MAX_RECORDS_PER_CALL = "20";
    process.env.KINETICA_MAX_ROWS_PER_QUERY = "";
    gate = new Promise<void>((r) => (release = r));
    sid = createSession({ username: "capper", secret: "cap-secret", kineticaUrl: process.env.KINETICA_URL! });
    const dash = createDashboard("expcaps-" + Math.random());
    const t = createTable({ name: "demo_table", schema: "demo_schema" });
    widgetId = createWidget(dash.id, {
      title: "w",
      type: "records",
      position: 0,
      config: { tableId: t.id, table: "demo_schema.demo_table", columns: "id, name, amount", sortField: "id", sortDirection: "asc" },
    }).id;
  });
  afterEach(async () => {
    release();
    for (const id of started.splice(0)) {
      cancelExport(id);
      await __exportRunForTest(id);
    }
    vi.unstubAllEnvs();
    process.env.EXPORT_DIR = "";
    process.env.KINETICA_MAX_RECORDS_PER_CALL = "";
    fs.rmSync(dir, { recursive: true, force: true });
    vi.unstubAllGlobals();
  });

  // ---- concurrency ----

  it("EXPCAP-conc-sync-pair: back-to-back starts at cap 1 -> second refused, one row", () => {
    vi.stubEnv("EXPORT_MAX_CONCURRENT_PER_USER", "1");
    installStub(100, { hold: () => gate });
    expect(start("capper").jobId).toBeTruthy();
    let err: unknown;
    try {
      start("capper");
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ExportCapError);
    expect((err as ExportCapError).code).toBe("concurrency_cap");
    expect((err as ExportCapError).message).toBe(
      "You already have 1 export running. Wait for one to finish or cancel one, then try again.",
    );
    expect(rowCount()).toBe(1);
  });

  it("EXPCAP-conc-default-2: default cap is 2", () => {
    vi.stubEnv("EXPORT_MAX_CONCURRENT_PER_USER", "");
    installStub(100, { hold: () => gate });
    start("capper");
    start("capper");
    expect(() => start("capper")).toThrow(/^You already have 2 exports running\. /);
    expect(rowCount()).toBe(2);
  });

  it("EXPCAP-conc-case-insensitive: Alice and alice share a budget", () => {
    vi.stubEnv("EXPORT_MAX_CONCURRENT_PER_USER", "1");
    installStub(100, { hold: () => gate });
    start("Alice");
    expect(() => start("alice")).toThrow(ExportCapError);
  });

  it("EXPCAP-conc-terminal-not-counted: a cancelled job frees the slot", async () => {
    vi.stubEnv("EXPORT_MAX_CONCURRENT_PER_USER", "1");
    installStub(100, { hold: () => gate });
    const { jobId } = start("capper");
    const run = __exportRunForTest(jobId)!;
    expect(cancelExport(jobId)).toBe(true);
    release();
    await run;
    expect(getExportJob(jobId)!.status).toBe("cancelled");
    expect(() => start("capper")).not.toThrow();
  });

  it("EXPCAP-conc-cancel-immediate: Cancel frees the slot while the in-flight Kinetica call is still pending", () => {
    vi.stubEnv("EXPORT_MAX_CONCURRENT_PER_USER", "1");
    installStub(100, { hold: () => gate }); // gate never released here: the first run is stuck mid-call
    const { jobId } = start("capper");
    expect(cancelExport(jobId)).toBe(true);
    expect(["queued", "running"]).toContain(getExportJob(jobId)!.status); // still non-terminal in the DB
    expect(() => start("capper")).not.toThrow();
    expect(() => start("capper")).toThrow(ExportCapError); // the new run does hold the slot
  });

  it("EXPCAP-conc-spec-error-first: spec validation precedes the cap", () => {
    vi.stubEnv("EXPORT_MAX_CONCURRENT_PER_USER", "1");
    installStub(100, { hold: () => gate });
    start("capper");
    expect(() => startExport({ spec: { widgetId: 999999 }, sid, username: "capper" })).toThrow(ExportSpecError);
  });

  // ---- writeCsv byte cap ----

  const memSink = () => {
    const chunks: Buffer[] = [];
    const w = new Writable({
      write(c, _e, cb) {
        chunks.push(Buffer.from(c));
        cb();
      },
    });
    return { w, size: () => chunks.reduce((a, c) => a + c.length, 0) };
  };
  async function* oneBatch(rows: unknown[][]) {
    yield rows;
  }
  async function* threeBatches() {
    for (let b = 0; b < 3; b++) yield Array.from({ length: 10 }, (_, k) => [b * 10 + k, "x".repeat(50)]);
  }

  it("EXPCAP-size-writecsv-exact: at-cap passes, one byte under fails", async () => {
    const rows = [[1, "abc"], [2, "def"]];
    const a = memSink();
    await writeCsv(oneBatch(rows), ["a", "b"], a.w);
    const B = a.size();
    const ok = memSink();
    await expect(writeCsv(oneBatch(rows), ["a", "b"], ok.w, { maxBytes: B })).resolves.toBe(2);
    const bad = memSink();
    await expect(writeCsv(oneBatch(rows), ["a", "b"], bad.w, { maxBytes: B - 1 })).rejects.toBeInstanceOf(SizeCapError);
  });

  it("EXPCAP-size-writecsv-bytes: cap is in UTF-8 bytes, not characters", async () => {
    const rows = [["ééééééééééééééééééééé"]]; // 21 chars, 42 bytes
    const a = memSink();
    await writeCsv(oneBatch(rows), ["h"], a.w);
    const B = a.size();
    const chars = B - 21; // what a string-length counter would see
    expect(chars).toBeLessThan(B);
    const s = memSink();
    await expect(writeCsv(oneBatch(rows), ["h"], s.w, { maxBytes: chars })).rejects.toBeInstanceOf(SizeCapError);
  });

  it("EXPCAP-size-writecsv-rows-at-cut: rowsAtCut is rows entered when the cap trips", async () => {
    const full = memSink();
    await writeCsv(threeBatches(), ["a", "b"], full.w);
    const per = full.size() / 3; // roughly one batch worth
    const s = memSink();
    // header + batch 1 fit; batch 2's chunk crosses the cap
    const err = await writeCsv(threeBatches(), ["a", "b"], s.w, { maxBytes: Math.floor(per * 1.5) }).catch((e) => e);
    expect(err).toBeInstanceOf(SizeCapError);
    expect((err as SizeCapError).rowsAtCut).toBe(20);
  });

  // ---- run-level row/size caps ----

  const dirFiles = () => fs.readdirSync(dir);

  it("EXPCAP-row-over: row cap fails before any batch/file", async () => {
    vi.stubEnv("EXPORT_MAX_ROWS", "1000");
    const st = installStub(1001);
    const { jobId } = start("capper");
    await __exportRunForTest(jobId);
    const job = getExportJob(jobId)!;
    expect(job.status).toBe("failed");
    expect(job.errorCode).toBe("row_cap");
    expect(job.errorMessage).toBe(
      "This export has 1,001 rows; the limit is 1,000. Add filters to narrow it down and try again.",
    );
    expect(job.rowsWritten).toBe(0);
    expect(st.batches).toBe(0);
    expect(dirFiles().filter((f) => f.startsWith(jobId))).toEqual([]);
  });

  it("EXPCAP-row-exact: exactly at the cap succeeds", async () => {
    vi.stubEnv("EXPORT_MAX_ROWS", "1000");
    installStub(1000);
    const { jobId } = start("capper");
    await __exportRunForTest(jobId);
    expect(getExportJob(jobId)!.status).toBe("complete");
  });

  const bigStub = (pad: (i: number) => string = () => PAD) => {
    const N = 2 * getExportBatchSize();
    return { N, st: installStub(N, { pad }) };
  };

  it("EXPCAP-size-raw: raw file over cap fails size_cap, partial deleted, exact message", async () => {
    vi.stubEnv("EXPORT_MAX_FILE_MB", "1");
    process.env.KINETICA_MAX_RECORDS_PER_CALL = "20000";
    expect(getExportBatchSize()).toBe(20000);
    const { N } = bigStub();
    const { jobId } = start("capper");
    await __exportRunForTest(jobId);
    const job = getExportJob(jobId)!;
    expect(job.status).toBe("failed");
    expect(job.errorCode).toBe("size_cap");
    expect(dirFiles().filter((f) => f.startsWith(jobId))).toEqual([]);
    expect(job.errorMessage).toBe(
      sizeCapMessage({ capMb: 1, rowsAtCut: getExportBatchSize(), totalRows: N, gzip: false }),
    );
    expect(job.errorMessage).toContain("You can also compress it (.csv.gz)");
  });

  it("EXPCAP-size-gzip-measures-compressed: compressible data under cap after gzip completes", async () => {
    vi.stubEnv("EXPORT_MAX_FILE_MB", "1");
    process.env.KINETICA_MAX_RECORDS_PER_CALL = "20000";
    bigStub();
    const { jobId } = start("capper", { gzip: true });
    await __exportRunForTest(jobId);
    expect(getExportJob(jobId)!.status).toBe("complete");
  });

  it("EXPCAP-size-gzip-over: incompressible gzip stream over cap fails without the gzip hint", async () => {
    vi.stubEnv("EXPORT_MAX_FILE_MB", "1");
    process.env.KINETICA_MAX_RECORDS_PER_CALL = "20000";
    bigStub(() => randomBytes(50).toString("hex"));
    const { jobId } = start("capper", { gzip: true });
    await __exportRunForTest(jobId);
    const job = getExportJob(jobId)!;
    expect(job.status).toBe("failed");
    expect(job.errorCode).toBe("size_cap");
    expect(job.errorMessage).not.toContain("You can also compress");
    expect(dirFiles().filter((f) => f.startsWith(jobId))).toEqual([]);
  });
});
