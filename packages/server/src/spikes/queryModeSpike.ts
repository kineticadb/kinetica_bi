/**
 * queryModeSpike.ts - Phase 140 live harness (operator-run, NON-ADMIN Kinetica user, NO AI provider => quota-free).
 *
 * QUESTION: does the SHIPPING query path (guardQuery + buildQueryScope + createQueryPort) behave against real
 * Kinetica as designed: row cap, timeout/user cancel leaving no running job, writes refused despite grants,
 * dialect coverage, D-18 error categories, quoted-identifier case, column profile shape?
 *
 * USAGE:
 *   cd packages/server && npx tsx src/spikes/queryModeSpike.ts [--dry-run]
 *   (--dry-run: offline guard corpus only, no network, no .env needed)
 *
 * ENV (LOCAL, un-committed packages/server/.env; never paste the password anywhere):
 *   KINETICA_URL, KINETICA_USERNAME, KINETICA_PASSWORD   - the NON-ADMIN user
 *   SPIKE_SOURCE_TABLE (default demo.nyctaxi), SPIKE_NUM_COL (default fare_amount), SPIKE_STR_COL (default vendor_id),
 *   SPIKE_TS_COL (optional), SPIKE_SLOW_SQL (optional), AI_QUERY_TIMEOUT_MS (Q2 timeout, default 2000 here)
 *
 * SAFETY: never prints the password, the Authorization header or any row value. Write probes are only ever guard
 * inputs (refused before any request). No DDL/DML is sent. Not imported by src/index.ts.
 */
import dotenv from "dotenv";
import { randomBytes } from "node:crypto";
import { guardQuery } from "../lib/ai/sqlGuard";
import { buildQueryScope } from "../lib/ai/queryScope";
import type { KineticaPrincipal, kineticaSql as KineticaSqlFn } from "../kinetica";

dotenv.config();

const DRY = process.argv.includes("--dry-run");
const SRC = process.env.SPIKE_SOURCE_TABLE ?? "demo.nyctaxi";
const NUM = process.env.SPIKE_NUM_COL ?? "fare_amount";
const STR = process.env.SPIKE_STR_COL ?? "vendor_id";
const TS = process.env.SPIKE_TS_COL;
const SLOW =
  process.env.SPIKE_SLOW_SQL ??
  `SELECT COUNT(*) FROM (SELECT * FROM ${SRC} LIMIT 20000) a, (SELECT * FROM ${SRC} LIMIT 2000) b`;

const ACCEPT: string[] = [
  `SELECT * FROM ${SRC} LIMIT 10`,
  `SELECT ${STR}, COUNT(*) AS n FROM ${SRC} GROUP BY ${STR} ORDER BY n DESC`,
  `SELECT ${NUM}, ROW_NUMBER() OVER (PARTITION BY ${STR} ORDER BY ${NUM} DESC) AS rn FROM ${SRC}`,
  `SELECT ${STR}, SUM(${NUM}) OVER (PARTITION BY ${STR}) AS s FROM ${SRC} LIMIT 100`,
  `SELECT DATE_TRUNC('day', ${TS ?? "pickup_datetime"}) AS d, COUNT(*) AS n FROM ${SRC} GROUP BY 1`,
  `SELECT APPROX_MEDIAN(${NUM}) AS m FROM ${SRC}`,
  `SELECT APPROX_PERCENTILE(${NUM}, 90) AS p90 FROM ${SRC}`,
  `SELECT COUNT(*) AS n FROM ${SRC} WHERE STXY_CONTAINS(ST_MAKEPOLYGON('POLYGON((0 0, 0 1, 1 1, 1 0, 0 0))'), pickup_longitude, pickup_latitude)`,
  `SELECT ST_DISTANCE(ST_POINT(0, 0), ST_POINT(1, 1)) AS d FROM ${SRC} LIMIT 1`,
  `SELECT HOUR(${TS ?? "pickup_datetime"}) AS h, COUNT(*) AS n FROM ${SRC} GROUP BY 1`,
  `SELECT DATEDIFF('DAY', ${TS ?? "pickup_datetime"}, NOW()) AS dd FROM ${SRC} LIMIT 5`,
  `SELECT TIMESTAMPADD(DAY, 1, ${TS ?? "pickup_datetime"}) AS t FROM ${SRC} LIMIT 5`,
  `SELECT ${NUM} FROM ${SRC} WHERE ${TS ?? "pickup_datetime"} > NOW() - INTERVAL '7' DAY LIMIT 5`,
  `SELECT CAST(${NUM} AS VARCHAR) AS s FROM ${SRC} LIMIT 5`,
  `SELECT ${NUM}::INTEGER AS i FROM ${SRC} LIMIT 5`,
  `SELECT ${STR} FROM ${SRC} WHERE ${NUM} > 10 UNION ALL SELECT ${STR} FROM ${SRC} WHERE ${NUM} < 1 LIMIT 20`,
  `WITH t AS (SELECT ${STR}, ${NUM} FROM ${SRC}) SELECT ${STR}, AVG(${NUM}) AS a FROM t GROUP BY ${STR}`,
  `WITH a AS (SELECT * FROM ${SRC} LIMIT 100) SELECT COUNT(*) AS n FROM a`,
  `SELECT * FROM ${SRC} FETCH FIRST 5 ROWS ONLY`,
  `SELECT COUNT(DISTINCT ${STR}) AS n FROM ${SRC}`,
  `SELECT ${STR}, CASE WHEN ${NUM} > 10 THEN 'hi' ELSE 'lo' END AS band FROM ${SRC} LIMIT 10`,
  `SELECT MIN(${NUM}) AS lo, MAX(${NUM}) AS hi, AVG(${NUM}) AS av, STDDEV(${NUM}) AS sd FROM ${SRC}`,
  `SELECT ${STR}, COUNT(*) AS n FROM ${SRC} GROUP BY ${STR} HAVING COUNT(*) > 1 LIMIT 10`,
];
const quotedSrc = SRC.split(".").map((p) => `"${p.toUpperCase()}"`).join(".");
ACCEPT.push(`SELECT COUNT(*) AS n FROM ${quotedSrc}`);

const REFUSE: string[] = [
  `INSERT INTO ${SRC} SELECT * FROM ${SRC} WHERE 1 = 0`,
  `CREATE TABLE _kbi_spike_x AS SELECT * FROM ${SRC}`,
  `DELETE FROM ${SRC} WHERE 1 = 0`,
  `SELECT 1 FROM ${SRC}; DROP TABLE ${SRC}`,
  `SELECT * FROM ${SRC} -- trailing comment`,
  `SELECT * FROM ki_catalog.ki_objects`,
  `SELECT * FROM ${SRC} QUALIFY ROW_NUMBER() OVER (ORDER BY 1) = 1`,
  `SELECT TOP 5 * FROM ${SRC}`,
  `UPDATE ${SRC} SET ${NUM} = 0 WHERE 1 = 0`,
  `SELECT * FROM other_schema.other_table`,
];

const clip = (s: string, n = 90): string => s.replace(/\s+/g, " ").slice(0, n);
const line = (tag: "PASS" | "FAIL" | "INFO", q: string, msg: string): void => console.log(`${tag} ${q} ${msg}`);

async function dryRun(): Promise<number> {
  const scope = { allowed: new Set([SRC.toLowerCase()]) };
  console.log(`[q-spike] --dry-run (offline guard corpus) source=${SRC}\n`);
  console.log("verdict | reason | sql");
  let bad = 0;
  for (const sql of ACCEPT) {
    const g = await guardQuery(sql, scope);
    console.log(`${g.ok ? "accepted" : "REFUSED "} | ${g.ok ? "-" : clip(g.reason, 60)} | ${clip(sql)}`);
  }
  for (const sql of REFUSE) {
    const g = await guardQuery(sql, scope);
    if (g.ok) bad++;
    console.log(`${g.ok ? "ACCEPTED!" : "refused  "} | ${g.ok ? "MUST-REFUSE VIOLATED" : clip(g.reason, 60)} | ${clip(sql)}`);
  }
  console.log(`\n[q-spike] must-refuse violations: ${bad}`);
  return bad === 0 ? 0 : 1;
}

async function live(): Promise<number> {
  const URL_ = process.env.KINETICA_URL?.replace(/\/$/, "");
  const USER = process.env.KINETICA_USERNAME;
  const PASS = process.env.KINETICA_PASSWORD;
  if (!URL_ || !USER || !PASS) {
    console.error("[q-spike] ERROR: KINETICA_URL, KINETICA_USERNAME, KINETICA_PASSWORD must be set in your local .env");
    return 1;
  }
  // Dynamic: queryRunner -> exportRunner -> sessionStore needs env at import time, so load only after dotenv (live mode).
  const { createQueryPort, QUERY_ERRORS } = await import("../lib/ai/queryRunner");
  const { kineticaSql } = await import("../kinetica");
  const { AI_JOB_TAG_PREFIX } = await import("../lib/kineticaJobs");
  console.log(`[q-spike] User: ${USER}   (confirm this is the NON-ADMIN user)\n[q-spike] Kinetica: ${URL_}\n[q-spike] Source: ${SRC}\n`);
  const principal: KineticaPrincipal = {
    user: { sub: USER, sid: "spike", credentialType: "password", creds: { username: USER, password: PASS, token: "" } },
    requestId: `spike-${randomBytes(3).toString("hex")}`,
  };
  const dot = SRC.indexOf(".");
  const schema = dot >= 0 ? SRC.slice(0, dot) : "";
  const table = dot >= 0 ? SRC.slice(dot + 1) : SRC;
  const scope = buildQueryScope({ username: USER, dashboardId: 0, dashboardTables: [{ id: 1, schema, name: table }], savedViews: [], aiViews: [] });

  let sqlCalls = 0;
  const countingSql: typeof KineticaSqlFn = (...a) => { sqlCalls++; return kineticaSql(...a); };
  const timeoutMs = Number(process.env.AI_QUERY_TIMEOUT_MS ?? 2000);

  // Q8 stub: describe built from a LIMIT 0 probe (column names only; no row values).
  const probe = await kineticaSql(principal, `SELECT * FROM ${SRC} LIMIT 0`, { route: "AI run_query", op: "SQL", extra: { limit: 1 } }).catch(() => undefined) as Record<string, unknown> | undefined;
  const headers = Array.isArray(probe?.column_headers) ? (probe!.column_headers as unknown[]).map(String) : [NUM, STR];
  const liveSchema = {
    describe: async (id: number) => id === 1
      ? ({ ok: true as const, table: { id: 1, schema, name: table, columns: headers.map((name) => ({ name, type: name === NUM ? "double" : name === STR ? "string" : undefined })) } })
      : ({ ok: false as const }),
  };
  const mk = (over: Partial<{ maxRows: number; timeoutMs: number }> = {}) => createQueryPort({
    requestId: principal.requestId!, principal: () => principal, scope,
    limits: { maxRows: over.maxRows ?? 200, maxChars: 200_000, timeoutMs: over.timeoutMs ?? 60_000, maxPerAnswer: 500 },
    liveSchema, dashboardTableIds: () => [1], sql: countingSql,
  });

  const taggedJobsRemaining = async (tag: string): Promise<number> => {
    const auth = "Basic " + Buffer.from(`${USER}:${PASS}`).toString("base64");
    const needle = `/* ${AI_JOB_TAG_PREFIX}${tag}`;
    const deadline = Date.now() + 10_000;
    let n = -1;
    while (Date.now() < deadline) {
      const res = await fetch(`${URL_}/admin/show/jobs`, { method: "POST", headers: { Authorization: auth, "Content-Type": "application/json" }, body: JSON.stringify({ options: {} }) });
      const body = (await res.json().catch(() => null)) as { data_str?: unknown } | null;
      const d = (typeof body?.data_str === "string" ? JSON.parse(body.data_str) : body?.data_str) as Record<string, unknown> | undefined;
      const texts = Array.isArray(d?.query_text) ? (d!.query_text as unknown[]) : [];
      n = texts.filter((t) => typeof t === "string" && t.includes(needle)).length;
      if (n === 0) return 0;
      await new Promise((r) => setTimeout(r, 1000));
    }
    return n;
  };

  // Q1 cap
  {
    const t0 = Date.now();
    const r = await mk({ maxRows: 200 }).run(`SELECT * FROM ${SRC}`);
    const ok = r.ok && r.envelope.rowCount === 200 && r.envelope.truncated;
    line(ok ? "PASS" : "FAIL", "Q1 cap", `rowCount=${r.ok ? r.envelope.rowCount : "-"} truncated=${r.ok ? r.envelope.truncated : "-"} elapsed=${Date.now() - t0}ms${r.ok ? "" : " msg=" + r.message}`);
  }
  // Q2 timeout
  {
    const port = mk({ timeoutMs });
    const r = await port.run(SLOW);
    const tag = `${principal.requestId}-q01`;
    const left = await taggedJobsRemaining(tag);
    line(!r.ok && r.message === QUERY_ERRORS.timedOut && left === 0 ? "PASS" : "FAIL", "Q2 timeout", `msg="${r.ok ? "ok?!" : r.message}" taggedJobsRemaining=${left} timeoutMs=${timeoutMs}`);
  }
  // Q3 user cancel
  {
    const port = mk();
    const ctl = new AbortController();
    setTimeout(() => ctl.abort(), 1500);
    const r = await port.run(SLOW, ctl.signal);
    const left = await taggedJobsRemaining(`${principal.requestId}-q01`);
    line(!r.ok && r.message === QUERY_ERRORS.cancelled && left === 0 ? "PASS" : "FAIL", "Q3 user-cancel", `msg="${r.ok ? "ok?!" : r.message}" taggedJobsRemaining=${left}`);
  }
  // Q4 writes refused
  {
    const port = mk();
    const before = sqlCalls;
    const outs: string[] = [];
    let allRefused = true;
    for (const w of REFUSE.slice(0, 3)) {
      const r = await port.run(w);
      const refused = !r.ok && r.message.startsWith("Refused:");
      if (!refused) allRefused = false;
      outs.push(refused ? "refused" : "NOT-REFUSED");
    }
    const sent = sqlCalls - before;
    line(allRefused && sent === 0 ? "PASS" : "FAIL", "Q4 writes", `${outs.join(",")} sqlCallsForWrites=${sent}`);
  }
  // Q5 dialect corpus live
  {
    const port = mk({ maxRows: 50 });
    const rejected: string[] = [];
    for (const q of ACCEPT) {
      const g = await guardQuery(q, { allowed: scope.pass1Allowed });
      if (!g.ok) { line("INFO", "Q5 dialect", `guard-refused: ${clip(g.reason, 60)} | ${clip(q, 70)}`); continue; }
      const r = await port.run(q);
      if (r.ok) line("INFO", "Q5 dialect", `ok rows=${r.envelope.rowCount} | ${clip(q, 70)}`);
      else { rejected.push(q); line("INFO", "Q5 dialect", `category="${r.message}" | ${clip(q, 70)}`); }
    }
    line("INFO", "Q5 dialect", `PG-accepted but Kinetica-rejected: ${rejected.length}`);
  }
  // Q6 D-18 calibration
  {
    const port = mk();
    const probes = [`SELECT no_such_col FROM ${SRC}`, `SELECT * FROM ${SRC}_nope`, `SELECT ${STR} FROM ${SRC} GROUP BY ROLLUP(${STR}) LIMIT 5`];
    for (const q of probes) {
      const r = await port.run(q);
      let raw = "";
      try { await kineticaSql(principal, q, { route: "AI run_query", op: "SQL", extra: { limit: 1 } }); raw = "(no error)"; } catch (e) { raw = clip(String((e as Error)?.message ?? e), 200); }
      line("INFO", "Q6 errors", `port="${r.ok ? "ok" : r.message}" [raw, local terminal only]="${raw}" | ${clip(q, 60)}`);
    }
  }
  // Q7 quoted case
  {
    const port = mk();
    const up = SRC.split(".").map((p) => `"${p.toUpperCase()}"`).join(".");
    const lo = SRC.split(".").map((p) => `"${p.toLowerCase()}"`).join(".");
    for (const [label, name] of [["upper", up], ["lower", lo]] as const) {
      const r = await port.run(`SELECT COUNT(*) AS n FROM ${name}`);
      line("INFO", "Q7 quoted-case", `${label} ${name}: ${r.ok ? "ok" : r.message}`);
    }
  }
  // Q8 profile
  {
    const port = mk();
    for (const col of [NUM, STR]) {
      const r = await port.profile({ tableId: 1, column: col });
      if (r.ok) line("PASS", "Q8 profile", `${col}: rowCount=${r.envelope.rowCount} distinct=${r.envelope.distinctCount} nulls=${r.envelope.nullCount} topValues=${r.envelope.topValues?.length ?? 0}`);
      else line("FAIL", "Q8 profile", `${col}: ${r.message}`);
    }
  }
  console.log("\n[q-spike] done. Visually review Q5/Q6/Q7 INFO lines; PASS/FAIL lines are automatic.");
  return 0;
}

process.exit(DRY ? await dryRun() : await live());
