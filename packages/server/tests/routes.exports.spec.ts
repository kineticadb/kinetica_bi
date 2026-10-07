/**
 * Phase 129 Plan 02 — /api/exports routes (EXPRT-V126-13/17 + route half of -05/-07).
 * Do NOT assert a fixed total server pass-count (SET-BASED gate).
 *
 * MUTATION PROBES (each applied to src/exportRoutes.ts, reverted afterwards):
 * P1 loadOwnedJob skips owner check            -> EXPRT129-noleak-ids red
 * P2 start gate split (404 / 403)                -> EXPRT129-noleak-start (+ csv-disabled) red
 * P3 canViewDashboard clause removed             -> EXPRT129-noleak-start (+ csv-disabled) red
 * P4 enableCsvDownload check removed             -> EXPRT129-csv-disabled red
 * P5 filters array check removed                 -> EXPRT129-validate red
 * P6 permission gate analyst lacks on POST       -> EXPRT129-analyst-grant-only red (proof of EXPRT-V126-17)
 * P7 DELETE skips cancelExport for active jobs   -> initially did NOT fire (the run unwinds and cleans up
 *    after the row is gone); delete-running strengthened to assert the stub never served batch 3, then red.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import { buildTestApp } from "./helpers/app";
import { createAdminSession } from "./helpers/db";
import {
  db,
  createDashboard,
  createWidget,
  createTable,
  getExportJob,
  insertExportJob,
  markExportJobRunning,
  finalizeExportJob,
} from "../src/db";
import { addDashboardGrant } from "../src/lib/dashboardAccessDb";
import { createSession } from "../src/sessionStore";
import { PERMISSIONS } from "../src/lib/permissions";
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

const UUID4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const session = (username: string): { sid: string; cookie: string } => {
  const sid = createSession({ username, secret: "pw", kineticaUrl: process.env.KINETICA_URL! });
  const token = jwt.sign({ sub: username, sid, v: 1 }, process.env.AUTH_SECRET!, { expiresIn: "8h" });
  return { sid, cookie: `kbi_session=${token}` };
};

describe("export routes", () => {
  let dir: string;
  let dashId: number;
  let tableId: number;
  let widgetId: number;
  const recordsConfig = () => ({
    tableId,
    table: "demo_schema.demo_table",
    columns: "id, name, amount",
    sortField: "id",
    sortDirection: "asc",
  });

  beforeEach(() => {
    db.exec(
      "DELETE FROM export_jobs; DELETE FROM dashboard_access_grants; DELETE FROM widgets; DELETE FROM dashboards; DELETE FROM tables; DELETE FROM sessions;",
    );
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "kbi-exproutes-"));
    process.env.EXPORT_DIR = dir;
    process.env.KINETICA_MAX_RECORDS_PER_CALL = "20";
    process.env.KINETICA_MAX_ROWS_PER_QUERY = "";
    const dash = createDashboard("exproutes-" + Math.random());
    dashId = dash.id;
    tableId = createTable({ name: "demo_table", schema: "demo_schema" }).id;
    widgetId = createWidget(dashId, { title: "w", type: "records", position: 0, config: recordsConfig() }).id;
  });
  afterEach(() => {
    process.env.EXPORT_DIR = "";
    process.env.KINETICA_MAX_RECORDS_PER_CALL = "";
    fs.rmSync(dir, { recursive: true, force: true });
    vi.unstubAllGlobals();
  });

  const files = (id: string) => fs.readdirSync(dir).filter((f) => f.startsWith(id));
  const post = async (cookie: string, body: unknown) =>
    (await buildTestApp()).post("/api/exports").set("Cookie", cookie).send(body as object);
  const call = async (method: "get" | "post" | "delete", url: string, cookie: string) =>
    (await buildTestApp())[method](url).set("Cookie", cookie);

  it("EXPRT129-analyst-grant-only: grant-only analyst can start an export with an existing session", async () => {
    installStub(30);
    addDashboardGrant(dashId, "user", "ana");
    const { cookie } = session("ana");
    const r = await post(cookie, { widgetId });
    expect(r.status).toBe(202);
    expect(r.body.data.id).toMatch(UUID4);
    await __exportRunForTest(r.body.data.id);
    const s = await call("get", `/api/exports/${r.body.data.id}`, cookie);
    expect(s.status).toBe(200);
    expect(s.body.data.status).toBe("complete");
  });

  it("EXPRT129-noleak-start: no-grant user gets a 404 identical to a nonexistent widget", async () => {
    const { cookie } = session("nobody");
    const real = await post(cookie, { widgetId });
    const missing = await post(cookie, { widgetId: 999999 });
    expect(real.status).toBe(404);
    expect(real.status).toBe(missing.status);
    expect(real.body).toEqual(missing.body);
  });

  it("EXPRT129-csv-disabled: enableCsvDownload=false -> 403 for viewer, 404 for non-viewer, no job row", async () => {
    const w = createWidget(dashId, {
      title: "nocsv",
      type: "records",
      position: 1,
      config: { ...recordsConfig(), enableCsvDownload: false },
    });
    addDashboardGrant(dashId, "user", "viewer");
    const r = await post(session("viewer").cookie, { widgetId: w.id });
    expect(r.status).toBe(403);
    expect(r.body).toEqual({ error: "CSV download is disabled for this widget." });
    const n = (db.prepare("SELECT COUNT(*) AS c FROM export_jobs").get() as { c: number }).c;
    expect(n).toBe(0);
    const other = await post(session("stranger").cookie, { widgetId: w.id });
    expect(other.status).toBe(404);
  });

  it("EXPRT129-validate: malformed requests return 400 and insert no row", async () => {
    const bar = createWidget(dashId, { title: "bar", type: "bar", position: 2, config: { tableId, table: "demo_schema.demo_table" } });
    addDashboardGrant(dashId, "user", "val");
    const { cookie } = session("val");
    const cases: Array<[unknown, string | undefined]> = [
      [{ widgetId: "7" }, "invalid_export_request"],
      [{ widgetId, filters: "x" }, "invalid_export_request"],
      [{ widgetId, filters: [1] }, "invalid_export_request"],
      [{ widgetId, sortDir: "sideways" }, "invalid_export_request"],
      [{ widgetId, options: { gzip: "yes" } }, "invalid_export_request"],
      [{ widgetId, options: { format: "pretty" } }, "invalid_export_request"],
      [{ widgetId, sortField: "a;b" }, "invalid_sort"],
      [{ widgetId, filters: [{ column: "bad col", op: "eq", value: 1 }] }, "invalid_column"],
      [{ widgetId: bar.id }, "not_records_table"],
    ];
    for (const [body, code] of cases) {
      const r = await post(cookie, body);
      expect(r.status, JSON.stringify(body)).toBe(400);
      expect(r.body.code, JSON.stringify(body)).toBe(code);
    }
    const n = (db.prepare("SELECT COUNT(*) AS c FROM export_jobs").get() as { c: number }).c;
    expect(n).toBe(0);
  });

  it("EXPRT129-no-kinetica-url: missing KINETICA_URL -> 500", async () => {
    const saved = process.env.KINETICA_URL;
    process.env.KINETICA_URL = "";
    try {
      // session stamped with "" so it survives the operator-changed-URL check in auth
      const { cookie } = createAdminSession({ kineticaUrl: "" });
      const r = await post(cookie, { widgetId });
      expect(r.status).toBe(500);
    } finally {
      process.env.KINETICA_URL = saved;
    }
  });

  it("EXPRT129-gzip-option: options.gzip produces a .csv.gz", async () => {
    installStub(30);
    addDashboardGrant(dashId, "user", "gz");
    const { cookie } = session("gz");
    const r = await post(cookie, { widgetId, options: { gzip: true } });
    expect(r.status).toBe(202);
    expect(r.body.data.gzip).toBe(true);
    const id = r.body.data.id as string;
    await __exportRunForTest(id);
    const s = await call("get", `/api/exports/${id}`, cookie);
    expect(s.body.data.status).toBe("complete");
    expect(fs.existsSync(path.join(dir, `${id}.csv.gz`))).toBe(true);
  });

  const seedJob = (username: string, sid: string, id = randomUUID()) =>
    insertExportJob({ id, username, sid, dashboardId: dashId, widgetId, specJson: JSON.stringify({ widgetId }), optionsJson: null });

  it("EXPRT129-noleak-ids: not-yours / unknown / malformed ids give identical 404s; owner row untouched", async () => {
    const alice = session("alice");
    const mallory = session("mallory");
    const job = seedJob("alice", alice.sid);
    const before = getExportJob(job.id);
    const probes: Array<["get" | "post" | "delete", (id: string) => string]> = [
      ["get", (id) => `/api/exports/${id}`],
      ["post", (id) => `/api/exports/${id}/cancel`],
      ["delete", (id) => `/api/exports/${id}`],
    ];
    for (const [m, url] of probes) {
      const foreign = await call(m, url(job.id), mallory.cookie);
      const unknown = await call(m, url(randomUUID()), mallory.cookie);
      const malformed = await call(m, url("not-a-uuid"), mallory.cookie);
      expect(foreign.status).toBe(404);
      expect(foreign.body).toEqual({ error: "Export not found." });
      expect(foreign.status).toBe(unknown.status);
      expect(foreign.body).toEqual(unknown.body);
      expect(foreign.status).toBe(malformed.status);
      expect(foreign.body).toEqual(malformed.body);
    }
    expect(getExportJob(job.id)).toEqual(before);
  });

  it("EXPRT129-list-own-only: list returns only own jobs, newest first, with no private fields", async () => {
    const alice = session("alice");
    const mallory = session("mallory");
    const a1 = seedJob("alice", alice.sid);
    const a2 = seedJob("alice", alice.sid);
    seedJob("mallory", mallory.sid);
    const r = await call("get", "/api/exports", alice.cookie);
    expect(r.status).toBe(200);
    expect(r.body.data.map((j: { id: string }) => j.id)).toEqual([a2.id, a1.id]);
    for (const k of ["sid", "filePath", "username", "specJson"]) expect(r.text).not.toContain(`"${k}"`);
    expect(r.text).not.toContain(alice.sid);
  });

  it("EXPRT129-owner-relogin: job reachable from a new session and a case-variant username", async () => {
    const first = session("alice");
    const job = seedJob("alice", first.sid);
    const second = session("alice");
    expect(second.sid).not.toBe(first.sid);
    expect((await call("get", `/api/exports/${job.id}`, second.cookie)).status).toBe(200);
    const upper = session("Alice");
    expect((await call("get", `/api/exports/${job.id}`, upper.cookie)).status).toBe(200);
  });

  const startHeld = async (cookie: string) => {
    let release!: () => void;
    const deferred = new Promise<void>((r) => (release = r));
    let held = false;
    const st = installStub(100, async (batchNo) => {
      if (batchNo === 2) {
        held = true;
        await deferred;
      }
    });
    const r = await post(cookie, { widgetId });
    expect(r.status).toBe(202);
    const id = r.body.data.id as string;
    await waitFor(() => held);
    return { id, release, st };
  };

  it("EXPRT129-cancel-running: cancel -> 202, job ends cancelled, no file", async () => {
    addDashboardGrant(dashId, "user", "ana");
    const { cookie } = session("ana");
    const { id, release } = await startHeld(cookie);
    const c = await call("post", `/api/exports/${id}/cancel`, cookie);
    expect(c.status).toBe(202);
    release();
    await __exportRunForTest(id);
    expect(getExportJob(id)?.status).toBe("cancelled");
    expect(files(id)).toEqual([]);
  });

  it("EXPRT129-cancel-terminal: cancel on a complete job -> 409", async () => {
    installStub(30);
    addDashboardGrant(dashId, "user", "ana");
    const { cookie } = session("ana");
    const r = await post(cookie, { widgetId });
    const id = r.body.data.id as string;
    await __exportRunForTest(id);
    const before = getExportJob(id);
    const c = await call("post", `/api/exports/${id}/cancel`, cookie);
    expect(c.status).toBe(409);
    expect(c.body.status).toBe("complete");
    expect(getExportJob(id)).toEqual(before);
  });

  it("EXPRT129-delete-terminal: delete removes row and file; second delete 404", async () => {
    const { sid, cookie } = session("ana");
    const job = seedJob("ana", sid);
    const f = path.join(dir, `${job.id}.csv`);
    fs.writeFileSync(f, "id\n1\n");
    markExportJobRunning(job.id);
    finalizeExportJob(job.id, "complete", { rowsWritten: 1, filePath: f, fileBytes: 5 });
    const d = await call("delete", `/api/exports/${job.id}`, cookie);
    expect(d.status).toBe(204);
    expect(fs.existsSync(f)).toBe(false);
    expect((await call("get", `/api/exports/${job.id}`, cookie)).status).toBe(404);
    expect((await call("delete", `/api/exports/${job.id}`, cookie)).status).toBe(404);
  });

  it("EXPRT129-delete-running: delete cancels first, leaving no row and no file", async () => {
    addDashboardGrant(dashId, "user", "ana");
    const { cookie } = session("ana");
    const { id, release, st } = await startHeld(cookie);
    const d = await call("delete", `/api/exports/${id}`, cookie);
    expect(d.status).toBe(204);
    release();
    await __exportRunForTest(id);
    expect(getExportJob(id)).toBeUndefined();
    expect(files(id)).toEqual([]);
    // DELETE must have aborted the live run: it never fetched batch 3 (100 rows / 20 per call = 5 batches).
    expect(st.batches).toBeLessThanOrEqual(2);
  });

  // Regression guard (passes before and after; NOT proof of EXPRT-V126-17 — see analyst-grant-only).
  it("EXPRT129-no-new-permission: permission set unchanged and has no export permission", () => {
    expect(Object.keys(PERMISSIONS).length).toBe(18);
    for (const [k, v] of Object.entries(PERMISSIONS)) {
      expect(k).not.toMatch(/export/i);
      expect(v).not.toMatch(/export/i);
    }
  });
});
