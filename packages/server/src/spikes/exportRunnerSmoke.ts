/**
 * exportRunnerSmoke.ts - Phase 128 live end-to-end check of the export runner.
 * NOT part of the app. Uses an in-memory SQLite DB so the dev database is untouched.
 * Never prints credentials.
 *
 * USAGE: cd packages/server && EXPORT_SMOKE_TABLE=schema.table npm run export-runner-smoke
 * REQUIRED .env: KINETICA_URL, KINETICA_USERNAME, KINETICA_PASSWORD, SESSION_ENCRYPTION_KEY
 *
 * S1 complete  - rows_written == independent COUNT(*), header == configured columns, snapshot dropped
 * S2 cancel    - cancelled, no file
 * S3 session   - deleteSession mid-export -> session_expired, no file
 * Read-only against the source table; only job-private _kbi_exp_<id8> objects are created and dropped.
 */
import dotenv from "dotenv";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

dotenv.config();

const KINETICA_URL = process.env.KINETICA_URL?.replace(/\/$/, "");
const U = process.env.KINETICA_USERNAME;
const P = process.env.KINETICA_PASSWORD;
const TABLE = process.env.EXPORT_SMOKE_TABLE;
if (!KINETICA_URL || !U || !P || !process.env.SESSION_ENCRYPTION_KEY) {
  console.error("[export-runner-smoke] ERROR: KINETICA_URL, KINETICA_USERNAME, KINETICA_PASSWORD, SESSION_ENCRYPTION_KEY must be set in packages/server/.env");
  process.exit(1);
}
if (!TABLE || !/^[A-Za-z_][\w]*\.[A-Za-z_][\w]*$/.test(TABLE)) {
  console.error("[export-runner-smoke] ERROR: set EXPORT_SMOKE_TABLE=schema.table");
  process.exit(1);
}

process.env.DB_PATH = ":memory:";
const exportDir = fs.mkdtempSync(path.join(os.tmpdir(), "kbi-exp-smoke-"));
process.env.EXPORT_DIR = exportDir;

const basicAuth = "Basic " + Buffer.from(`${U}:${P}`).toString("base64");

const raw = async (statement: string, limit = 100): Promise<{ ok: boolean; message: string; cols: unknown[][] }> => {
  const res = await fetch(`${KINETICA_URL}/execute/sql`, {
    method: "POST",
    headers: { Authorization: basicAuth, "Content-Type": "application/json" },
    body: JSON.stringify({ statement, encoding: "json", request_schema_str: "", data: [], options: {}, offset: 0, limit }),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const bad = res.status >= 400 || String(body.status ?? "") === "ERROR";
  let cols: unknown[][] = [];
  let headers: string[] = [];
  try {
    const ds = typeof body.data_str === "string" ? JSON.parse(body.data_str) : (body.data_str as Record<string, unknown>) ?? {};
    const enc = typeof ds.json_encoded_response === "string" ? JSON.parse(ds.json_encoded_response) : ds.json_encoded_response;
    headers = enc?.column_headers ?? [];
    cols = headers.map((_, i) => enc[`column_${i + 1}`] ?? []);
    (cols as unknown as { headers?: string[] }).headers = headers;
  } catch {
    /* ignore */
  }
  return { ok: !bad, message: String(body.message ?? ""), cols };
};

/** CSV-aware record counter: CR/LF inside quoted fields do not count. */
const countRecords = async (file: string): Promise<{ records: number; firstLine: string }> => {
  let inQ = false;
  let records = 0;
  let sawData = false;
  let first = "";
  let firstDone = false;
  for await (const chunk of fs.createReadStream(file, { encoding: "utf8" })) {
    for (const ch of chunk as string) {
      sawData = true;
      if (ch === '"') inQ = !inQ;
      if (!firstDone && !(ch === "\r" && !inQ) && !(ch === "\n" && !inQ)) first += ch;
      if (!inQ && ch === "\n") {
        records++;
        firstDone = true;
      } else if (!firstDone && !inQ && ch === "\r") {
        /* keep scanning to \n */
      }
    }
  }
  if (sawData) records++; // final record has no trailing terminator
  return { records, firstLine: first };
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const jobIds: string[] = [];
const id8 = (id: string) => id.replace(/-/g, "").slice(0, 8).toLowerCase();
const filesFor = (id: string) => fs.readdirSync(exportDir).filter((f) => f.startsWith(id));

async function main() {
  const { createTable, createDashboard, createWidget, getExportJob } = await import("../db");
  const { createSession, deleteSession } = await import("../sessionStore");
  const { startExport, cancelExport, __exportRunForTest } = await import("../lib/exportRunner");
  const { csvLine } = await import("../lib/csvExport");

  const [schema, name] = TABLE!.split(".");
  console.log(`[export-runner-smoke] Kinetica: ${KINETICA_URL!.replace(/\/\/[^@/]*@/, "//***@")} user: ${U} table: ${TABLE}`);

  const probe = await raw(`SELECT * FROM ${TABLE}`, 1);
  const headers = ((probe.cols as unknown as { headers?: string[] }).headers ?? []) as string[];
  if (!probe.ok || headers.length < 3) throw new Error("probe failed: " + probe.message);
  const [c1, c2, c3] = headers;
  const t = createTable({ schema, name });
  const dash = createDashboard("export smoke");
  const widget = createWidget(dash.id, {
    title: "smoke",
    type: "records",
    position: 0,
    config: { tableId: t.id, table: TABLE, columns: `${c1}, ${c2}, ${c3}`, sortField: c1, sortDirection: "asc" },
  } as never);
  const mkSession = () => createSession({ username: U!, secret: P!, kineticaUrl: KINETICA_URL! });
  const results: Record<string, string> = {};

  const cnt = await raw(`SELECT COUNT(*) FROM ${TABLE}`);
  const independent = Number(cnt.cols[0]?.[0]);
  console.log(`independent COUNT(*) = ${independent}`);

  // ---- S1 ----
  console.log("=== S1 complete ===");
  {
    const sid = mkSession();
    const t0 = Date.now();
    const { jobId } = startExport({ spec: { widgetId: widget.id }, sid, username: U! });
    jobIds.push(jobId);
    await __exportRunForTest(jobId);
    const ms = Date.now() - t0;
    const j = getExportJob(jobId)!;
    console.log(`status=${j.status} total_rows=${j.totalRows} rows_written=${j.rowsWritten} file_bytes=${j.fileBytes} elapsed_ms=${ms} rows/s=${Math.round(j.rowsWritten / (ms / 1000))}`);
    let pass = j.status === "complete" && j.totalRows === independent && j.rowsWritten === independent;
    if (j.filePath) {
      const { records, firstLine } = await countRecords(j.filePath);
      const headerOk = firstLine === csvLine([c1, c2, c3]);
      console.log(`file records=${records} (expect ${j.rowsWritten + 1}) header_ok=${headerOk}`);
      pass = pass && records === j.rowsWritten + 1 && headerOk;
    } else pass = false;
    const snap = await raw(`SELECT COUNT(*) FROM _kbi_exp_${id8(jobId)}`);
    console.log(`snapshot after run: ${snap.ok ? "STILL EXISTS" : "gone (error as expected)"}`);
    pass = pass && !snap.ok;
    results.S1 = pass ? "PASS" : "FAIL";
    console.log(`S1 ${results.S1}`);
  }

  // ---- S2 ----
  console.log("=== S2 cancel ===");
  {
    const sid = mkSession();
    const { jobId } = startExport({ spec: { widgetId: widget.id }, sid, username: U! });
    jobIds.push(jobId);
    let inconclusive = false;
    for (;;) {
      const j = getExportJob(jobId)!;
      if (["complete", "failed", "cancelled", "session_expired"].includes(j.status)) {
        inconclusive = true;
        break;
      }
      if (j.rowsWritten > 0) break;
      await sleep(50);
    }
    if (inconclusive) {
      console.log("too fast to cancel; rerun with a larger table");
      results.S2 = "INCONCLUSIVE";
    } else {
      const midRows = getExportJob(jobId)!.rowsWritten;
      cancelExport(jobId);
      await __exportRunForTest(jobId);
      const j = getExportJob(jobId)!;
      console.log(`cancelled at rows_written~${midRows}; final status=${j.status} rows_written=${j.rowsWritten} files=${JSON.stringify(filesFor(jobId))}`);
      results.S2 = j.status === "cancelled" && filesFor(jobId).length === 0 ? "PASS" : "FAIL";
    }
    console.log(`S2 ${results.S2}`);
  }

  // ---- S3 ----
  console.log("=== S3 session end ===");
  {
    const sid2 = mkSession();
    const { jobId } = startExport({ spec: { widgetId: widget.id }, sid: sid2, username: U! });
    jobIds.push(jobId);
    let inconclusive = false;
    for (;;) {
      const j = getExportJob(jobId)!;
      if (["complete", "failed", "cancelled", "session_expired"].includes(j.status)) {
        inconclusive = true;
        break;
      }
      if (j.rowsWritten > 0) break;
      await sleep(50);
    }
    if (inconclusive) {
      console.log("too fast; session ended after the job finished");
      results.S3 = "INCONCLUSIVE";
    } else {
      deleteSession(sid2);
      await __exportRunForTest(jobId);
      const j = getExportJob(jobId)!;
      console.log(`status=${j.status} error_code=${j.errorCode} error_message=${JSON.stringify(j.errorMessage)} rows_written=${j.rowsWritten} total_rows=${j.totalRows} files=${JSON.stringify(filesFor(jobId))}`);
      const early = (j.totalRows ?? 0) > j.rowsWritten;
      results.S3 =
        j.status === "session_expired" &&
        j.errorMessage === "Export stopped: your session ended. Sign in and start it again." &&
        filesFor(jobId).length === 0 &&
        early
          ? "PASS"
          : "FAIL";
    }
    console.log(`S3 ${results.S3}`);
  }
  console.log("RESULTS " + JSON.stringify(results));
}

main()
  .catch((e) => {
    console.error("[export-runner-smoke] FAILED:", (e as Error).message);
    process.exitCode = 1;
  })
  .finally(async () => {
    console.log("=== cleanup ===");
    for (const id of jobIds) {
      const n = `_kbi_exp_${id8(id)}`;
      for (const name of [n, `${n}_pg`]) {
        const d = await raw(`DROP TABLE IF EXISTS ${name}`);
        const chk = await raw(`SELECT COUNT(*) FROM ${name}`);
        console.log(`${name}: drop ${d.ok ? "ok" : "err"}; leftover check ${chk.ok ? "STILL EXISTS" : "gone"}`);
      }
    }
    fs.rmSync(exportDir, { recursive: true, force: true });
    process.exit();
  });
