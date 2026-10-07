/**
 * Phase 129 Plan 03 — GET /api/exports/:id/download (EXPRT-V126-11/13/17).
 * Do NOT assert a fixed total server pass-count (SET-BASED gate).
 *
 * MUTATION PROBES (applied to src/exportRoutes.ts, reverted afterwards):
 * D1 status !== "complete" gate removed          -> dl-not-complete + dl-range-on-running red
 * D2 resolveServableExportFile -> {path, size:0}   -> dl-size-mismatch + dl-foreign-file red
 * D3 Cache-Control header removed + cacheControl:true -> dl-full red (cacheControl:true alone is an equivalent
 *    mutation: send only sets its default when no Cache-Control is already present)
 * D4 res.download -> createReadStream.pipe          -> dl-full, all range/206/416/if-range/resume/gzip/e2e red
 * D5 loadOwnedJob -> raw getExportJob               -> dl-noleak red
 * D6 ENOENT callback branch removed                 -> NOT provable by a fast test (needs a file vanishing between
 *    the route's stat and send's open); dl-missing-file covers the pre-stat case only.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import { buildTestApp } from "./helpers/app";
import {
  db,
  createDashboard,
  createWidget,
  createTable,
  getExportJob,
  insertExportJob,
  markExportJobRunning,
  finalizeExportJob,
  type ExportJob,
} from "../src/db";
import { addDashboardGrant } from "../src/lib/dashboardAccessDb";
import { createSession } from "../src/sessionStore";
import { __exportRunForTest } from "../src/lib/exportRunner";

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

function installStub(N: number, hold?: (batchNo: number, offset: number) => Promise<void> | void) {
  const st = { batches: 0 };
  let batchCalls = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(async (_url: string, init: any) => {
      const body = JSON.parse(init.body as string);
      const stmt: string = body.statement;
      if (/^CREATE (OR REPLACE )?MATERIALIZED VIEW/.test(stmt)) return respond({});
      if (/^DROP TABLE IF EXISTS/.test(stmt)) return respond({});
      if (/SELECT COUNT\(\*\)/.test(stmt)) return respond({ column_headers: ["total"], column_1: [N] });
      batchCalls++;
      st.batches = batchCalls;
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


const session = (username: string): { sid: string; cookie: string } => {
  const sid = createSession({ username, secret: "pw", kineticaUrl: process.env.KINETICA_URL! });
  const token = jwt.sign({ sub: username, sid, v: 1 }, process.env.AUTH_SECRET!, { expiresIn: "8h" });
  return { sid, cookie: `kbi_session=${token}` };
};


const FULL = ["id,name,amount", ...Array.from({ length: 100 }, (_, i) => `${i},name-${i},${i * 1.5}`)].join("\r\n");
const bin = (res: any, cb: (e: Error | null, b: Buffer) => void) => {
  const c: Buffer[] = [];
  res.on("data", (d: Buffer) => c.push(d));
  res.on("end", () => cb(null, Buffer.concat(c)));
};

describe("export download route", () => {
  let dir: string;
  let dashId: number;
  let tableId: number;
  let widgetId: number;
  const recordsConfig = () => ({ tableId, table: "demo_schema.demo_table", columns: "id, name, amount", sortField: "id", sortDirection: "asc" });

  beforeEach(() => {
    db.exec(
      "DELETE FROM export_jobs; DELETE FROM dashboard_access_grants; DELETE FROM widgets; DELETE FROM dashboards; DELETE FROM tables; DELETE FROM sessions;",
    );
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "kbi-expdl-"));
    process.env.EXPORT_DIR = dir;
    process.env.KINETICA_MAX_RECORDS_PER_CALL = "20";
    process.env.KINETICA_MAX_ROWS_PER_QUERY = "";
    dashId = createDashboard("expdl-" + Math.random()).id;
    tableId = createTable({ name: "demo_table", schema: "demo_schema" }).id;
    widgetId = createWidget(dashId, { title: "w", type: "records", position: 0, config: recordsConfig() }).id;
  });
  afterEach(() => {
    process.env.EXPORT_DIR = "";
    process.env.KINETICA_MAX_RECORDS_PER_CALL = "";
    fs.rmSync(dir, { recursive: true, force: true });
    vi.unstubAllGlobals();
  });

  const get = async (url: string, cookie: string, headers: Record<string, string> = {}) => {
    const r = (await buildTestApp()).get(url).set("Cookie", cookie);
    for (const [k, v] of Object.entries(headers)) r.set(k, v);
    return r;
  };
  const getBin = async (url: string, cookie: string, headers: Record<string, string> = {}) => {
    const r = (await buildTestApp()).get(url).set("Cookie", cookie);
    for (const [k, v] of Object.entries(headers)) r.set(k, v);
    return r.buffer(true).parse(bin);
  };

  const insert = (owner: string, id = randomUUID()) => {
    insertExportJob({ id, username: owner, sid: "x", dashboardId: dashId, widgetId, specJson: "{}", optionsJson: null });
    return id;
  };
  const seedComplete = (owner: string, content: string | Buffer, ext = ".csv") => {
    const id = insert(owner);
    markExportJobRunning(id);
    const filePath = path.join(dir, `${id}${ext}`);
    fs.writeFileSync(filePath, content);
    finalizeExportJob(id, "complete", { rowsWritten: 100, filePath, fileBytes: fs.statSync(filePath).size });
    return { id, size: fs.statSync(filePath).size, job: getExportJob(id) as ExportJob };
  };
  const url = (id: string) => `/api/exports/${id}/download`;
  const SIZE = Buffer.byteLength(FULL);

  it("EXPRT129-dl-full: 200 with private no-store, attachment name, nosniff", async () => {
    const { id, job } = seedComplete("alice", FULL);
    const r = await get(url(id), session("alice").cookie);
    expect(r.status).toBe(200);
    expect(r.text).toBe(FULL);
    expect(r.headers["accept-ranges"]).toBe("bytes");
    expect(r.headers["cache-control"]).toBe("private, no-store");
    expect(r.headers["cache-control"]).not.toContain("public");
    expect(r.headers["content-disposition"]).toContain("attachment");
    expect(r.headers["content-disposition"]).toContain(`export-${job.createdAt.slice(0, 10)}-${id.slice(0, 8)}.csv`);
    expect(r.headers["content-type"]).toMatch(/^text\/csv/);
    expect(r.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("EXPRT129-dl-range-206: open-ended range returns 206 with correct Content-Range", async () => {
    const { id } = seedComplete("alice", FULL);
    const r = await get(url(id), session("alice").cookie, { Range: "bytes=100-" });
    expect(r.status).toBe(206);
    expect(r.headers["content-range"]).toBe(`bytes 100-${SIZE - 1}/${SIZE}`);
    expect(r.headers["content-length"]).toBe(String(SIZE - 100));
    expect(r.text).toBe(FULL.slice(100));
  });

  it("EXPRT129-dl-range-closed: bytes=0-99", async () => {
    const { id } = seedComplete("alice", FULL);
    const r = await get(url(id), session("alice").cookie, { Range: "bytes=0-99" });
    expect(r.status).toBe(206);
    expect(r.text).toBe(FULL.slice(0, 100));
  });

  it("EXPRT129-dl-range-suffix: bytes=-10", async () => {
    const { id } = seedComplete("alice", FULL);
    const r = await get(url(id), session("alice").cookie, { Range: "bytes=-10" });
    expect(r.status).toBe(206);
    expect(r.text).toBe(FULL.slice(-10));
  });

  it("EXPRT129-dl-416: unsatisfiable range", async () => {
    const { id } = seedComplete("alice", FULL);
    const r = await get(url(id), session("alice").cookie, { Range: `bytes=${SIZE + 100}-` });
    expect(r.status).toBe(416);
    expect(r.headers["content-range"]).toBe(`bytes */${SIZE}`);
  });

  it("EXPRT129-dl-if-range: current etag resumes (206), stale validator gives full 200", async () => {
    const { id } = seedComplete("alice", FULL);
    const { cookie } = session("alice");
    const plain = await get(url(id), cookie);
    const etag = plain.headers["etag"];
    expect(etag).toBeTruthy();
    const ok = await get(url(id), cookie, { Range: "bytes=100-", "If-Range": etag });
    expect(ok.status).toBe(206);
    expect(ok.text).toBe(FULL.slice(100));
    const stale = await get(url(id), cookie, { Range: "bytes=100-", "If-Range": 'W/"stale"' });
    expect(stale.status).toBe(200);
    expect(stale.text).toBe(FULL);
  });

  it("EXPRT129-dl-resume-concat: first 300 bytes + bytes=300- reconstructs the file", async () => {
    const { id } = seedComplete("alice", FULL);
    const { cookie } = session("alice");
    const a = await get(url(id), cookie, { Range: "bytes=0-299" });
    const b = await get(url(id), cookie, { Range: "bytes=300-" });
    expect(a.status).toBe(206);
    expect(b.status).toBe(206);
    expect(a.text + b.text).toBe(FULL);
  });

  it("EXPRT129-dl-gzip: .csv.gz served as application/gzip with no content-encoding", async () => {
    const gz = zlib.gzipSync(FULL);
    const { id } = seedComplete("alice", gz, ".csv.gz");
    const r = await getBin(url(id), session("alice").cookie);
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toBe("application/gzip");
    expect(r.headers["content-encoding"]).toBeUndefined();
    expect(Buffer.compare(r.body, gz)).toBe(0);
    expect(zlib.gunzipSync(r.body).toString()).toBe(FULL);
    expect(r.headers["content-disposition"]).toMatch(/\.csv\.gz"/);
  });

  it("EXPRT129-dl-not-complete: 409 for every non-complete status, plain and Range, even with a valid file present", async () => {
    const { cookie } = session("alice");
    for (const status of ["queued", "running", "failed", "cancelled", "session_expired"] as const) {
      const id = insert("alice");
      if (status !== "queued") markExportJobRunning(id);
      if (status === "failed" || status === "cancelled" || status === "session_expired") {
        const filePath = path.join(dir, `${id}.csv`);
        fs.writeFileSync(filePath, FULL);
        finalizeExportJob(id, status, { rowsWritten: 100, filePath, fileBytes: SIZE });
      }
      for (const headers of [{}, { Range: "bytes=0-" }] as Array<Record<string, string>>) {
        const r = await get(url(id), cookie, headers);
        expect(r.status, `${status} ${JSON.stringify(headers)}`).toBe(409);
        expect(r.body.status).toBe(status);
        expect(r.text).not.toContain("name-5,");
        expect(r.text).not.toContain("id,name,amount");
      }
    }
  });

  it("EXPRT129-dl-range-on-running: Range on a running job with a .part file is refused", async () => {
    const id = insert("alice");
    markExportJobRunning(id);
    fs.writeFileSync(path.join(dir, `${id}.csv.part`), FULL);
    const r = await get(url(id), session("alice").cookie, { Range: "bytes=0-" });
    expect(r.status).toBe(409);
    expect(r.text).not.toContain("name-1,");
  });

  it("EXPRT129-dl-missing-file: complete row with deleted file -> 410, server keeps serving", async () => {
    const { id, job } = seedComplete("alice", FULL);
    fs.rmSync(job.filePath!);
    const { cookie } = session("alice");
    const r = await get(url(id), cookie);
    expect(r.status).toBe(410);
    expect(r.body).toEqual({ error: "This export is no longer available." });
    expect((await get("/api/exports", cookie)).status).toBe(200);
  });

  it("EXPRT129-dl-size-mismatch: fileBytes != on-disk size -> 410", async () => {
    const id = insert("alice");
    markExportJobRunning(id);
    const filePath = path.join(dir, `${id}.csv`);
    fs.writeFileSync(filePath, FULL);
    finalizeExportJob(id, "complete", { rowsWritten: 100, filePath, fileBytes: SIZE + 1 });
    expect((await get(url(id), session("alice").cookie)).status).toBe(410);
  });

  it("EXPRT129-dl-foreign-file: filePath pointing at another job's file -> 410, no leak", async () => {
    const b = seedComplete("bob", "SECRET-B-CONTENT-xxxxxxxxxxxxxxxx");
    const id = insert("alice");
    markExportJobRunning(id);
    finalizeExportJob(id, "complete", { rowsWritten: 1, filePath: b.job.filePath!, fileBytes: b.size });
    const r = await get(url(id), session("alice").cookie);
    expect(r.status).toBe(410);
    expect(r.text).not.toContain("SECRET-B");
  });

  it("EXPRT129-dl-noleak: foreign / unknown / malformed ids give identical 404s", async () => {
    const { id } = seedComplete("alice", FULL);
    const mallory = session("mallory").cookie;
    const base = await get(`/api/exports/${randomUUID()}`, mallory);
    const foreign = await get(url(id), mallory);
    const unknown = await get(url(randomUUID()), mallory);
    const malformed = await get(url("not-a-uuid"), mallory);
    const ranged = await get(url(id), mallory, { Range: "bytes=0-" });
    for (const r of [foreign, unknown, malformed, ranged]) {
      expect(r.status).toBe(404);
      expect(r.body).toEqual(foreign.body);
      expect(r.body).toEqual(base.body);
    }
    expect(foreign.text).not.toContain("name-");
  });

  it("EXPRT129-dl-owner-relogin: new session and case-variant username both download", async () => {
    const { id } = seedComplete("alice", FULL);
    expect((await get(url(id), session("alice").cookie)).status).toBe(200);
    expect((await get(url(id), session("ALICE").cookie)).status).toBe(200);
  });

  it("EXPRT129-dl-e2e-analyst: grant-only analyst starts then downloads (full and Range)", async () => {
    installStub(45);
    addDashboardGrant(dashId, "user", "ana");
    const { cookie } = session("ana");
    const post = await (await buildTestApp()).post("/api/exports").set("Cookie", cookie).send({ widgetId });
    expect(post.status).toBe(202);
    const id = post.body.data.id as string;
    await __exportRunForTest(id);
    const full = await getBin(url(id), cookie);
    expect(full.status).toBe(200);
    const lines = full.body.toString().split(/\r?\n/).filter((l: string) => l.length > 0);
    expect(lines[0]).toBe("id,name,amount");
    expect(lines.length - 1).toBe(45);
    const part = await getBin(url(id), cookie, { Range: "bytes=10-" });
    expect(part.status).toBe(206);
    expect(Buffer.compare(part.body, full.body.subarray(10))).toBe(0);
  });
});
