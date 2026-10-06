import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createSession } from "../src/sessionStore";
import { createDashboard, createWidget, createTable, getExportJob, insertExportJob } from "../src/db";
import { startExport, cancelExport, __exportRunForTest } from "../src/lib/exportRunner";

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

type Stub = { stmts: string[]; batchOffsets: number[] };

/** Stateful stub. `hold(batchNo)` may return a promise the matching batch response awaits. */
function installStub(N: number, hold?: (batchNo: number, offset: number) => Promise<void> | void): Stub {
  const st: Stub = { stmts: [], batchOffsets: [] };
  let batchCalls = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(async (_url: string, init: any) => {
      const body = JSON.parse(init.body as string);
      const stmt: string = body.statement;
      st.stmts.push(stmt);
      if (/^CREATE (OR REPLACE )?MATERIALIZED VIEW/.test(stmt)) return respond({});
      if (/^DROP TABLE IF EXISTS/.test(stmt)) return respond({});
      if (/SELECT COUNT\(\*\)/.test(stmt)) return respond({ column_headers: ["total"], column_1: [N] });
      batchCalls++;
      st.batchOffsets.push(body.offset);
      await hold?.(batchCalls, body.offset);
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

const waitFor = async (cond: () => boolean, ms = 3000) => {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error("waitFor timeout");
    await new Promise((r) => setTimeout(r, 5));
  }
};

describe("export cancel", () => {
  let dir: string;
  let sid: string;
  let widgetId: number;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "kbi-expcancel-"));
    process.env.EXPORT_DIR = dir;
    process.env.KINETICA_MAX_RECORDS_PER_CALL = "20";
    process.env.KINETICA_MAX_ROWS_PER_QUERY = "";
    sid = createSession({ username: "canceller", secret: "cancel-secret", kineticaUrl: process.env.KINETICA_URL! });
    const dash = createDashboard("expcancel-" + Math.random());
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

  const files = (jobId: string) => fs.readdirSync(dir).filter((f) => f.startsWith(jobId));

  it("EXPCANCEL-mid-run: cancel during batch 2 stops the loop and deletes the partial file", async () => {
    let release!: () => void;
    const deferred = new Promise<void>((r) => (release = r));
    let batch2Held = false;
    const st = installStub(100, (n) => {
      if (n === 2) {
        batch2Held = true;
        return deferred;
      }
    });
    const { jobId } = startExport({ spec: { widgetId }, sid, username: "canceller" });
    const run = __exportRunForTest(jobId)!;
    await waitFor(() => batch2Held);
    // a partial file really exists before the cancel
    await waitFor(() => fs.existsSync(path.join(dir, `${jobId}.csv.part`)));
    expect(cancelExport(jobId)).toBe(true);
    release();
    await run;
    const job = getExportJob(jobId)!;
    expect(job.status).toBe("cancelled");
    expect(job.finishedAt).toBeTruthy();
    expect(files(jobId)).toEqual([]);
    expect(fs.existsSync(path.join(dir, `${jobId}.csv`))).toBe(false);
    expect(st.batchOffsets).toEqual([0, 20]); // nothing at offset >= 40
    expect(st.stmts.some((s) => /^DROP TABLE IF EXISTS _kbi_exp_/.test(s))).toBe(true);
  });

  it("EXPCANCEL-before-start: cancel immediately after startExport ends cancelled with no file and no batch request", async () => {
    const st = installStub(100);
    const { jobId } = startExport({ spec: { widgetId }, sid, username: "canceller" });
    expect(cancelExport(jobId)).toBe(true);
    await __exportRunForTest(jobId);
    expect(getExportJob(jobId)!.status).toBe("cancelled");
    expect(files(jobId)).toEqual([]);
    expect(st.batchOffsets).toEqual([]);
  });

  it("EXPCANCEL-after-complete: cancel on a complete job returns false; status and file untouched", async () => {
    installStub(30);
    const { jobId } = startExport({ spec: { widgetId }, sid, username: "canceller" });
    await __exportRunForTest(jobId);
    const job = getExportJob(jobId)!;
    expect(job.status).toBe("complete");
    const bytes = fs.readFileSync(job.filePath!);
    expect(cancelExport(jobId)).toBe(false);
    const after = getExportJob(jobId)!;
    expect(after.status).toBe("complete");
    expect(fs.readFileSync(after.filePath!).equals(bytes)).toBe(true);
  });

  it("EXPCANCEL-orphan-row: a queued row with no live run is cancelled and returns true", () => {
    const id = "00000000-0000-4000-8000-0000000000aa";
    insertExportJob({ id, username: "canceller", sid, dashboardId: null, widgetId, specJson: "{}", optionsJson: null });
    fs.writeFileSync(path.join(dir, `${id}.csv.part`), "partial");
    expect(cancelExport(id)).toBe(true);
    expect(getExportJob(id)!.status).toBe("cancelled");
    expect(fs.existsSync(path.join(dir, `${id}.csv.part`))).toBe(false);
  });

  it("EXPCANCEL-unknown: cancelExport on an unknown id returns false", () => {
    expect(cancelExport("does-not-exist")).toBe(false);
  });

  it("EXPCANCEL-race-finalize: a cancel inside the last batch leaves exactly one consistent terminal state", async () => {
    // 30 rows -> batches of 20 and 10; cancel while serving the LAST batch (before the response is consumed).
    let jobId = "";
    installStub(30, (n) => {
      if (n === 2) cancelExport(jobId);
    });
    ({ jobId } = startExport({ spec: { widgetId }, sid, username: "canceller" }));
    await __exportRunForTest(jobId);
    const job = getExportJob(jobId)!;
    const present = files(jobId);
    if (job.status === "complete") {
      expect(present).toEqual([`${jobId}.csv`]);
    } else {
      expect(job.status).toBe("cancelled");
      expect(present).toEqual([]);
    }
  });
});
