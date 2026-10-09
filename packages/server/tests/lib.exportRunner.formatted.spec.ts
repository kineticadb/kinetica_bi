import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createSession } from "../src/sessionStore";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { createDashboard, createWidget, createTable, getExportJob, upsertColumnDisplayConfig } from "../src/db";
import { startExport, __exportRunForTest, loadFormatPlan } from "../src/lib/exportRunner";
import { buildFormatter } from "../../web/src/lib/columnFormatter";
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

describe("formatted export", () => {
  let dir: string;
  let sid: string;
  let widgetId: number;
  let dashId: number;
  let tableId: number;

  const objsFor = (N: number) => Array.from({ length: N }, (_, i) => Object.fromEntries(HEADERS.map((h, j) => [h, makeRow(i)[j]])));
  const rawExpected = (N: number) => rowsToCsv(objsFor(N), HEADERS);

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "kbi-expfmt-"));
    process.env.EXPORT_DIR = dir;
    process.env.KINETICA_MAX_RECORDS_PER_CALL = "20";
    process.env.KINETICA_MAX_ROWS_PER_QUERY = "";
    sid = createSession({ username: "runner", secret: "export-test-secret", kineticaUrl: process.env.KINETICA_URL! });
    const dash = createDashboard("expfmt-" + Math.random());
    dashId = dash.id;
    const t = createTable({ name: "demo_table", schema: "demo_schema" });
    tableId = t.id;
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

  const go = async (options?: any) => {
    const { jobId } = startExport({ spec: { widgetId }, sid, username: "runner", options });
    await __exportRunForTest(jobId);
    const job = getExportJob(jobId)!;
    expect(job.status).toBe("complete");
    return fs.readFileSync(job.filePath!, "utf8").split("\r\n").join("\n").split("\n");
  };

  it("EXPFMT-labels: configured label replaces the header in formatted mode only", async () => {
    upsertColumnDisplayConfig(tableId, "amount", "Amount ($)", null);
    installStub(5);
    expect((await go({ format: "formatted" }))[0]).toBe("id,name,Amount ($)");
    installStub(5);
    expect((await go({ format: "raw" }))[0]).toBe("id,name,amount");
  });

  it("EXPFMT-cells: format_spec is applied per cell and equals the web formatter", async () => {
    const spec = { kind: "d3", specifier: ",.2f" } as const;
    upsertColumnDisplayConfig(tableId, "amount", null, spec);
    installStub(5);
    const lines = await go({ format: "formatted" });
    expect(lines[2].endsWith(",1.50")).toBe(true);
    const f = buildFormatter(spec as any);
    for (let i = 0; i < 5; i++) {
      expect(lines[i + 1].split(",").pop()).toBe(String(f(makeRow(i)[2])));
    }
  });

  it("EXPFMT-identity: unconfigured and kind none columns equal raw output", async () => {
    installStub(5);
    const a = await go({ format: "formatted" });
    upsertColumnDisplayConfig(tableId, "amount", null, { kind: "none" });
    installStub(5);
    const b = await go({ format: "formatted" });
    expect(a.join("\n")).toBe(rawExpected(5).split("\r\n").join("\n"));
    expect(b).toEqual(a);
  });

  it("EXPFMT-formula-guard: a label starting with = is still neutralised", async () => {
    upsertColumnDisplayConfig(tableId, "name", "=Total", null);
    installStub(3);
    expect((await go({ format: "formatted" }))[0]).toContain("'=Total");
  });

  it("EXPFMT-raw-default: undefined options and format raw are byte-identical to raw CSV", async () => {
    upsertColumnDisplayConfig(tableId, "amount", "Amount ($)", { kind: "d3", specifier: ",.2f" });
    installStub(5);
    const a = await go(undefined);
    installStub(5);
    const b = await go({ format: "raw" });
    expect(a).toEqual(b);
    expect(a.join("\n")).toBe(rawExpected(5).split("\r\n").join("\n"));
  });

  it("EXPFMT-no-tableId: widget without a numeric tableId yields null plan", () => {
    const id = createWidget(dashId, {
      title: "nt",
      type: "records",
      position: 5,
      config: { table: "demo_schema.demo_table", columns: "id, name, amount" },
    }).id;
    expect(loadFormatPlan(id, HEADERS)).toBeNull();
    expect(loadFormatPlan(widgetId, HEADERS)).not.toBeNull();
  });

  it("EXPFMT-bad-spec: an unknown spec kind does not throw and writes raw", async () => {
    upsertColumnDisplayConfig(tableId, "amount", null, { kind: "weird" });
    installStub(5);
    const a = await go({ format: "formatted" });
    expect(a.join("\n")).toBe(rawExpected(5).split("\r\n").join("\n"));
  });
});
