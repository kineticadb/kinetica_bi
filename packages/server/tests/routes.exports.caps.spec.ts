/**
 * Phase 130 Plan 02 — route-level caps (EXPRT-V126-15). Do NOT assert a fixed total pass-count (SET-BASED gate).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import jwt from "jsonwebtoken";
import { buildTestApp } from "./helpers/app";
import { db, createDashboard, createWidget, createTable } from "../src/db";
import { addDashboardGrant } from "../src/lib/dashboardAccessDb";
import { createSession } from "../src/sessionStore";
import { cancelExport, __exportRunForTest } from "../src/lib/exportRunner";

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

function installStub(N: number, hold?: () => Promise<void> | void) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(async (_url: string, init: any) => {
      const body = JSON.parse(init.body as string);
      const stmt: string = body.statement;
      if (/^CREATE (OR REPLACE )?MATERIALIZED VIEW/.test(stmt)) return respond({});
      if (/^DROP TABLE IF EXISTS/.test(stmt)) return respond({});
      if (/SELECT COUNT\(\*\)/.test(stmt)) return respond({ column_headers: ["total"], column_1: [N] });
      await hold?.();
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
}

const session = (username: string): { sid: string; cookie: string } => {
  const sid = createSession({ username, secret: "pw", kineticaUrl: process.env.KINETICA_URL! });
  const token = jwt.sign({ sub: username, sid, v: 1 }, process.env.AUTH_SECRET!, { expiresIn: "8h" });
  return { sid, cookie: `kbi_session=${token}` };
};

describe("export caps (routes)", () => {
  let dir: string;
  let dashId: number;
  let widgetId: number;
  let release!: () => void;
  let gate: Promise<void>;
  const rowCount = () => (db.prepare("SELECT COUNT(*) AS c FROM export_jobs").get() as { c: number }).c;

  beforeEach(() => {
    db.exec(
      "DELETE FROM export_jobs; DELETE FROM dashboard_access_grants; DELETE FROM widgets; DELETE FROM dashboards; DELETE FROM tables; DELETE FROM sessions;",
    );
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "kbi-expcapsr-"));
    process.env.EXPORT_DIR = dir;
    process.env.KINETICA_MAX_RECORDS_PER_CALL = "20";
    process.env.KINETICA_MAX_ROWS_PER_QUERY = "";
    gate = new Promise<void>((r) => (release = r));
    dashId = createDashboard("expcapsr-" + Math.random()).id;
    const tableId = createTable({ name: "demo_table", schema: "demo_schema" }).id;
    widgetId = createWidget(dashId, {
      title: "w",
      type: "records",
      position: 0,
      config: { tableId, table: "demo_schema.demo_table", columns: "id, name, amount", sortField: "id", sortDirection: "asc" },
    }).id;
    addDashboardGrant(dashId, "user", "alice");
    addDashboardGrant(dashId, "user", "bob");
  });
  afterEach(async () => {
    release();
    const ids = (db.prepare("SELECT id FROM export_jobs").all() as { id: string }[]).map((r) => r.id);
    for (const id of ids) {
      cancelExport(id);
      await __exportRunForTest(id);
    }
    vi.unstubAllEnvs();
    process.env.EXPORT_DIR = "";
    process.env.KINETICA_MAX_RECORDS_PER_CALL = "";
    fs.rmSync(dir, { recursive: true, force: true });
    vi.unstubAllGlobals();
  });

  const post = async (cookie: string) => (await buildTestApp()).post("/api/exports").set("Cookie", cookie).send({ widgetId });

  it("EXPCAP-conc-route-429: over-cap start -> 429 + D-17 body, nothing created", async () => {
    vi.stubEnv("EXPORT_MAX_CONCURRENT_PER_USER", "1");
    installStub(100, () => gate);
    const { cookie } = session("alice");
    expect((await post(cookie)).status).toBe(202);
    const r = await post(cookie);
    expect(r.status).toBe(429);
    expect(r.body).toEqual({
      error: "You already have 1 export running. Wait for one to finish or cancel one, then try again.",
      code: "concurrency_cap",
    });
    expect(rowCount()).toBe(1);
  });

  it("EXPCAP-conc-route-race: two simultaneous starts -> one 202, one 429", async () => {
    vi.stubEnv("EXPORT_MAX_CONCURRENT_PER_USER", "1");
    installStub(100, () => gate);
    const { cookie } = session("alice");
    const rs = await Promise.all([post(cookie), post(cookie)]);
    expect(rs.map((r) => r.status).sort()).toEqual([202, 429]);
    expect(rowCount()).toBe(1);
  });

  it("EXPCAP-conc-other-user: another user's budget is independent", async () => {
    vi.stubEnv("EXPORT_MAX_CONCURRENT_PER_USER", "1");
    installStub(100, () => gate);
    expect((await post(session("alice").cookie)).status).toBe(202);
    expect((await post(session("bob").cookie)).status).toBe(202);
  });

  it("EXPCAP-cap-route-status: row cap reason reaches the job DTO", async () => {
    vi.stubEnv("EXPORT_MAX_ROWS", "10");
    installStub(11);
    const { cookie } = session("alice");
    const r = await post(cookie);
    expect(r.status).toBe(202);
    await __exportRunForTest(r.body.data.id);
    const s = await (await buildTestApp()).get(`/api/exports/${r.body.data.id}`).set("Cookie", cookie);
    expect(s.body.data.status).toBe("failed");
    expect(s.body.data.errorCode).toBe("row_cap");
    expect(s.body.data.errorMessage).toBe(
      "This export has 11 rows; the limit is 10. Add filters to narrow it down and try again.",
    );
  });
});
