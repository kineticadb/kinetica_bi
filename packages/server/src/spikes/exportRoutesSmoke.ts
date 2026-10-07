/**
 * Phase 129-130 live smoke (R1-R7 routes; R8 sweep vs open download, R9 row cap, R10 concurrency cap) of the /api/exports routes over a real HTTP socket against real Kinetica.
 * NOT part of the app. In-memory SQLite, temp EXPORT_DIR, never prints credentials or cookies.
 * USAGE: cd packages/server && EXPORT_SMOKE_TABLE=schema.table [EXPORT_SMOKE_COLUMNS='a, b, c'] npm run export-routes-smoke
 */
import dotenv from "dotenv";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import assert from "node:assert";

dotenv.config();

const KINETICA_URL = process.env.KINETICA_URL?.replace(/\/$/, "");
const U = process.env.KINETICA_USERNAME;
const P = process.env.KINETICA_PASSWORD;
const TABLE = process.env.EXPORT_SMOKE_TABLE;
if (!KINETICA_URL || !U || !P || !process.env.SESSION_ENCRYPTION_KEY || !process.env.AUTH_SECRET) {
  console.error("[export-routes-smoke] ERROR: KINETICA_URL, KINETICA_USERNAME, KINETICA_PASSWORD, SESSION_ENCRYPTION_KEY, AUTH_SECRET must be set in packages/server/.env");
  process.exit(1);
}
if (!TABLE || !/^[A-Za-z_][\w]*\.[A-Za-z_][\w]*$/.test(TABLE)) {
  console.error("[export-routes-smoke] ERROR: set EXPORT_SMOKE_TABLE=schema.table");
  process.exit(1);
}

process.env.DB_PATH = ":memory:";
process.env.AUTH_MODE = "password";
process.env.NODE_ENV = "test"; // index.ts only auto-listens outside test; we call createApp() + listen(0) ourselves
const exportDir = fs.mkdtempSync(path.join(os.tmpdir(), "kbi-exp-routes-smoke-"));
process.env.EXPORT_DIR = exportDir;

const basicAuth = "Basic " + Buffer.from(`${U}:${P}`).toString("base64");
const raw = async (statement: string, limit = 100): Promise<{ ok: boolean; headers: string[] }> => {
  const res = await fetch(`${KINETICA_URL}/execute/sql`, {
    method: "POST",
    headers: { Authorization: basicAuth, "Content-Type": "application/json" },
    body: JSON.stringify({ statement, encoding: "json", request_schema_str: "", data: [], options: {}, offset: 0, limit }),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const bad = res.status >= 400 || String(body.status ?? "") === "ERROR";
  let headers: string[] = [];
  try {
    const ds = typeof body.data_str === "string" ? JSON.parse(body.data_str) : (body.data_str as Record<string, unknown>) ?? {};
    const enc = typeof ds.json_encoded_response === "string" ? JSON.parse(ds.json_encoded_response) : ds.json_encoded_response;
    headers = enc?.column_headers ?? [];
  } catch {
    /* ignore */
  }
  return { ok: !bad, headers };
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const sha = (b: Buffer) => crypto.createHash("sha256").update(b).digest("hex");
const TERMINAL = ["complete", "failed", "cancelled", "session_expired"];
const jobIds: string[] = [];
const id8 = (id: string) => id.replace(/-/g, "").slice(0, 8).toLowerCase();
const results: Record<string, string> = {};
const report = (k: string, name: string, pass: boolean | "SKIPPED", ev: string) => {
  results[k] = pass === "SKIPPED" ? "SKIPPED" : pass ? "PASS" : "FAIL";
  console.log(`${k} ${name}: ${results[k]} ${ev}`);
};

async function main() {
  const { createTable, createDashboard, createWidget } = await import("../db");
  const { addDashboardGrant } = await import("../lib/dashboardAccessDb");
  const { createSession } = await import("../sessionStore");
  const { createApp } = await import("../index");
  const jwt = (await import("jsonwebtoken")).default;

  const [schema, name] = TABLE!.split(".");
  let cols = process.env.EXPORT_SMOKE_COLUMNS;
  let first = "";
  if (!cols) {
    const probe = await raw(`SELECT * FROM ${TABLE}`, 1);
    if (!probe.ok || probe.headers.length < 3) throw new Error("probe failed");
    cols = probe.headers.slice(0, 3).join(", ");
    first = probe.headers[0];
  } else first = cols.split(",")[0].trim();
  const t = createTable({ schema, name });
  const dash = createDashboard("routes smoke");
  const widget = createWidget(dash.id, {
    title: "smoke", type: "records", position: 0,
    config: { tableId: t.id, table: TABLE, columns: cols, sortField: first, sortDirection: "asc" },
  } as never);
  addDashboardGrant(dash.id, "user", U!);

  const app = await createApp();
  const server = app.listen(0);
  try {
    await new Promise((r) => server.once("listening", r));
    const port = (server.address() as { port: number }).port;
    const base = `http://127.0.0.1:${port}`;

    const login = await fetch(`${base}/api/auth/login`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: U, password: P }),
    });
    if (login.status !== 200) throw new Error(`login failed: ${login.status}`);
    const cookie = (login.headers.getSetCookie().find((c) => c.startsWith("kbi_session=")) ?? "").split(";")[0];
    if (!cookie) throw new Error("no session cookie");

    const call = async (method: string, p: string, ck = cookie, body?: unknown, extra: Record<string, string> = {}) => {
      const res = await fetch(`${base}${p}`, {
        method, headers: { Cookie: ck, ...(body ? { "Content-Type": "application/json" } : {}), ...extra },
        body: body ? JSON.stringify(body) : undefined,
      });
      return res;
    };
    const poll = async (id: string, want?: string[]) => {
      const dl = Date.now() + 10 * 60_000;
      for (;;) {
        const j = ((await (await call("GET", `/api/exports/${id}`)).json()) as { data: Record<string, any> }).data;
        if ((want ?? TERMINAL).includes(j.status)) return j;
        if (Date.now() > dl) throw new Error("poll timeout");
        await sleep(500);
      }
    };

    // R1
    const startRes = await call("POST", "/api/exports", cookie, { widgetId: widget.id });
    const dto = ((await startRes.json()) as { data: Record<string, any> }).data;
    jobIds.push(dto.id);
    const uuidOk = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(dto.id);
    const done = await poll(dto.id);
    report("R1", "start", startRes.status === 202 && uuidOk && done.status === "complete" && done.rowsWritten === done.totalRows,
      `http=${startRes.status} uuid4=${uuidOk} status=${done.status} rows=${done.rowsWritten}/${done.totalRows} bytes=${done.fileBytes}`);
    const id = dto.id as string;

    // R2
    const dl = await call("GET", `/api/exports/${id}/download`);
    const full = Buffer.from(await dl.arrayBuffer());
    const etag = dl.headers.get("etag") ?? "";
    const fullSha = sha(full);
    report("R2", "full", dl.status === 200 && full.length === done.fileBytes && dl.headers.get("accept-ranges") === "bytes" &&
      dl.headers.get("cache-control") === "private, no-store" && (dl.headers.get("content-disposition") ?? "").includes("export-"),
      `http=${dl.status} len=${full.length} sha256=${fullSha.slice(0, 16)} etag=${etag ? "present" : "MISSING"}`);

    // R3
    const r3 = await call("GET", `/api/exports/${id}/download`, cookie, undefined, { Range: "bytes=100-" });
    const b3 = Buffer.from(await r3.arrayBuffer());
    report("R3", "range", r3.status === 206 && r3.headers.get("content-range") === `bytes 100-${full.length - 1}/${full.length}` && b3.equals(full.subarray(100)),
      `http=${r3.status} content-range=${r3.headers.get("content-range")}`);

    // R4
    const target = Math.min(1024 * 1024, Math.floor(full.length / 2));
    const first1 = await new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      let got = 0;
      const req = http.get(`${base}/api/exports/${id}/download`, { headers: { Cookie: cookie } }, (res) => {
        res.on("data", (c: Buffer) => {
          chunks.push(c);
          got += c.length;
          if (got >= target) { req.destroy(); resolve(Buffer.concat(chunks)); }
        });
        res.on("error", () => resolve(Buffer.concat(chunks)));
      });
      req.on("error", () => resolve(Buffer.concat(chunks)));
      void reject;
    });
    const offset = first1.length;
    const r4 = await call("GET", `/api/exports/${id}/download`, cookie, undefined, { Range: `bytes=${offset}-`, "If-Range": etag });
    const second = Buffer.from(await r4.arrayBuffer());
    const joined = Buffer.concat([first1, second]);
    report("R4", "interrupted resume", r4.status === 206 && offset > 0 && sha(joined) === fullSha,
      `resumed_from_byte=${offset} http=${r4.status} sha256_match=${sha(joined) === fullSha}`);

    // R5
    const s2 = ((await (await call("POST", "/api/exports", cookie, { widgetId: widget.id })).json()) as { data: Record<string, any> }).data;
    jobIds.push(s2.id);
    const r5 = await call("GET", `/api/exports/${s2.id}/download`, cookie, undefined, { Range: "bytes=0-" });
    const cres = await call("POST", `/api/exports/${s2.id}/cancel`);
    const fin = await poll(s2.id);
    const leftover = fs.readdirSync(exportDir).filter((f) => f.startsWith(s2.id));
    const ev5 = `download_http=${r5.status} cancel_http=${cres.status} final=${fin.status} files=${leftover.length}`;
    if (r5.status !== 409) {
      report("R5", "running refused + cancel", "SKIPPED", `job completed before the probe (${ev5})`);
    } else {
      report("R5", "running refused + cancel", cres.status === 202 && fin.status === "cancelled" && leftover.length === 0, ev5);
    }

    // R6
    const isid = createSession({ username: "smoke-intruder", secret: "x", kineticaUrl: KINETICA_URL! });
    const itok = jwt.sign({ sub: "smoke-intruder", sid: isid, v: 1 }, process.env.AUTH_SECRET!, { expiresIn: "8h" });
    const ick = `kbi_session=${itok}`;
    const rnd = crypto.randomUUID();
    let ok6 = true;
    const codes: string[] = [];
    for (const [m, suffix] of [["GET", ""], ["GET", "/download"], ["POST", "/cancel"], ["DELETE", ""]] as const) {
      const a = await call(m, `/api/exports/${id}${suffix}`, ick);
      const b = await call(m, `/api/exports/${rnd}${suffix}`, ick);
      const ab = m === "DELETE" ? await a.text() : await a.json().catch(() => null);
      const bb = m === "DELETE" ? await b.text() : await b.json().catch(() => null);
      let same = a.status === 404 && b.status === 404;
      try { assert.deepStrictEqual(ab, bb); } catch { same = false; }
      codes.push(`${m}${suffix}=${a.status}`);
      ok6 = ok6 && same;
    }
    const still = (await call("GET", `/api/exports/${id}`)).status === 200;
    report("R6", "privacy", ok6 && still, `${codes.join(" ")} owner_row_still_present=${still}`);

    // R7
    const del = await call("DELETE", `/api/exports/${id}`);
    const gone = !fs.readdirSync(exportDir).some((f) => f.startsWith(id));
    const after = await call("GET", `/api/exports/${id}`);
    report("R7", "delete", del.status === 204 && gone && after.status === 404, `delete=${del.status} file_gone=${gone} get_after=${after.status}`);

    const { runExportSweepOnce, isExportDownloading } = await import("../lib/exportCleanup");
    const { rowCapMessage, concurrencyCapMessage } = await import("../lib/exportCaps");
    const { db } = await import("../db");
    const hasFile = (jid: string) => fs.readdirSync(exportDir).some((f) => f.startsWith(jid));

    // R8: sweep vs a held-open download
    {
      const r8Start = ((await (await call("POST", "/api/exports", cookie, { widgetId: widget.id })).json()) as { data: Record<string, any> }).data;
      const jid = r8Start.id as string;
      jobIds.push(jid);
      const j8 = await poll(jid);
      const fileBytes = j8.fileBytes as number;
      const refSha = sha(Buffer.from(await (await call("GET", `/api/exports/${jid}/download`)).arrayBuffer()));
      const chunks: Buffer[] = [];
      let httpRes: http.IncomingMessage | undefined;
      let ended: Promise<void> = Promise.resolve();
      await new Promise<void>((resolve, reject) => {
        const req = http.get(`${base}/api/exports/${jid}/download`, { headers: { Cookie: cookie } }, (res) => {
          httpRes = res;
          ended = new Promise<void>((e) => res.on("end", () => e()));
          let paused = false;
          res.on("data", (c: Buffer) => {
            chunks.push(c);
            if (!paused) { paused = true; res.pause(); resolve(); }
          });
        });
        req.on("error", reject);
      });
      let open = false;
      for (const dl8 = Date.now() + 5000; Date.now() < dl8 && !open; ) {
        open = isExportDownloading(jid);
        if (!open) await sleep(20);
      }
      db.prepare("UPDATE export_jobs SET finished_at = datetime('now','-3 days') WHERE id = ?").run(jid);
      const expiredGet = (await call("GET", `/api/exports/${jid}/download`)).status;
      const s1 = runExportSweepOnce();
      const fileKept = hasFile(jid) && (await call("GET", `/api/exports/${jid}`)).status === 200;
      httpRes!.resume();
      await ended;
      const shaMatch = sha(Buffer.concat(chunks)) === refSha;
      await sleep(50);
      const closed = !isExportDownloading(jid);
      const s2r = runExportSweepOnce();
      const afterDeleted = !hasFile(jid);
      const newGet = (await call("GET", `/api/exports/${jid}/download`)).status;
      const pass8 = open && expiredGet === 410 && s1.skippedOpen >= 1 && fileKept && shaMatch && closed && s2r.deleted >= 1 && afterDeleted && newGet === 404;
      report("R8", "sweep-vs-open-download", pass8,
        `open=${open} expired_get=${expiredGet} skipped=${s1.skippedOpen} file_kept=${fileKept} sha_match=${shaMatch} after_close_deleted=${afterDeleted} new_get=${newGet} bytes=${fileBytes}` +
        (fileBytes < 8 * 1024 * 1024 ? " (small file: kernel buffers may absorb it; the unit/integration tests are the structural proof)" : ""));
    }

    // R9: row cap live
    try {
      process.env.EXPORT_MAX_ROWS = "1000";
      const r9s = ((await (await call("POST", "/api/exports", cookie, { widgetId: widget.id })).json()) as { data: Record<string, any> }).data;
      jobIds.push(r9s.id);
      const j9 = await poll(r9s.id);
      const msgOk = j9.errorMessage === rowCapMessage(j9.totalRows, 1000);
      const noFile = !hasFile(r9s.id);
      report("R9", "row-cap-live", j9.status === "failed" && j9.errorCode === "row_cap" && msgOk && j9.rowsWritten === 0 && noFile,
        `status=${j9.status} code=${j9.errorCode} message_match=${msgOk} rows_written=${j9.rowsWritten} no_file=${noFile}`);
    } finally {
      delete process.env.EXPORT_MAX_ROWS;
    }

    // R10: concurrency cap live
    try {
      process.env.EXPORT_MAX_CONCURRENT_PER_USER = "1";
      const a = await call("POST", "/api/exports", cookie, { widgetId: widget.id });
      const aj = ((await a.json()) as { data: Record<string, any> }).data;
      jobIds.push(aj.id);
      const b = await call("POST", "/api/exports", cookie, { widgetId: widget.id });
      const bb = (await b.json().catch(() => ({}))) as Record<string, any>;
      const cres10 = await call("POST", `/api/exports/${aj.id}/cancel`);
      const fin10 = await poll(aj.id);
      const ev10 = `a_http=${a.status} b_http=${b.status} code=${bb.code} message_match=${bb.error === concurrencyCapMessage(1)} cancel_http=${cres10.status} a_final=${fin10.status}`;
      if (b.status !== 429 && fin10.status === "complete") report("R10", "concurrency-live", "SKIPPED", `A completed before the second POST (${ev10})`);
      else report("R10", "concurrency-live", a.status === 202 && b.status === 429 && bb.code === "concurrency_cap" && bb.error === concurrencyCapMessage(1) && cres10.status === 202, ev10);
    } finally {
      delete process.env.EXPORT_MAX_CONCURRENT_PER_USER;
    }
  } finally {
    server.close();
  }
}

main()
  .catch((e) => {
    console.error("[export-routes-smoke] FAILED:", (e as Error).message);
    process.exitCode = 1;
  })
  .finally(async () => {
    console.log("RESULTS " + JSON.stringify(results));
    if (Object.values(results).includes("FAIL")) process.exitCode = 1;
    console.log("=== cleanup ===");
    for (const id of jobIds) {
      const n = `_kbi_exp_${id8(id)}`;
      for (const nm of [n, `${n}_pg`]) {
        const d = await raw(`DROP TABLE IF EXISTS ${nm}`);
        const chk = await raw(`SELECT COUNT(*) FROM ${nm}`);
        console.log(`${nm}: drop ${d.ok ? "ok" : "err"}; leftover check ${chk.ok ? "STILL EXISTS" : "gone"}`);
      }
    }
    fs.rmSync(exportDir, { recursive: true, force: true });
    process.exit();
  });
