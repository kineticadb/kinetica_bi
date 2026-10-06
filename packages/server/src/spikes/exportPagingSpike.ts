/**
 * exportPagingSpike.ts - Phase 128 live paging spike (D-01..D-04).
 *
 * PURPOSE: decide how the export job pages a large result: Kinetica `options.paging_table`
 * (+ `paging_table_ttl`) versus a job-private snapshot materialized view + request-level
 * OFFSET + composite ORDER BY. Also verifies the two Phase 127 carry-overs:
 *   D-04a  split-call row order WITHOUT an ORDER BY (kineticaSql batch split)
 *   D-04b  KINETICA_MAX_RECORDS_PER_CALL above the server's max_get_records_size
 *
 * READ-ONLY against the operator's schemas. The only objects created are job-private
 * `_kbi_exp_spike_<8hex>_*` views / paging tables, ALL dropped in a `finally`.
 *
 * USAGE: cd packages/server && npm run export-paging-spike
 * REQUIRED .env: KINETICA_URL, KINETICA_USERNAME, KINETICA_PASSWORD
 * OPTIONAL env:
 *   EXPORT_SPIKE_TABLE         fully-qualified table (default: auto-discover the largest)
 *   EXPORT_SPIKE_SORT_COL      non-unique column for the ordered probe (default: first column)
 *   EXPORT_SPIKE_WAIT_SECONDS  durability/TTL wait (default 90)
 *   EXPORT_SPIKE_MAX_ROWS      cap on rows read (default 2000000)
 *
 * Never prints credentials, the Authorization header or the URL with embedded credentials.
 * NOT part of the Express app: one-shot CLI via tsx.
 */
import dotenv from "dotenv";
import { createHash, randomBytes } from "node:crypto";
import type { AuthedRequest } from "../auth";
import { kineticaSql, __resetRowLimitWarningsForTest } from "../kinetica";

dotenv.config();

const KINETICA_URL = process.env.KINETICA_URL?.replace(/\/$/, "");
const U = process.env.KINETICA_USERNAME;
const P = process.env.KINETICA_PASSWORD;

if (!KINETICA_URL || !U || !P) {
  console.error(
    "[export-paging-spike] ERROR: KINETICA_URL, KINETICA_USERNAME and KINETICA_PASSWORD must be set in packages/server/.env"
  );
  process.exit(1);
}

const basicAuth = "Basic " + Buffer.from(`${U}:${P}`).toString("base64");
const redactedUrl = KINETICA_URL.replace(/\/\/[^@/]*@/, "//***@");
const RUN = randomBytes(4).toString("hex");
const PFX = `_kbi_exp_spike_${RUN}`;
const WAIT_S = Number(process.env.EXPORT_SPIKE_WAIT_SECONDS ?? "90");
const MAX_ROWS = Number(process.env.EXPORT_SPIKE_MAX_ROWS ?? "2000000");
const created: string[] = [];

type Encoded = Record<string, unknown> & { column_headers?: string[]; column_datatypes?: string[] };
type Resp = {
  ms: number;
  httpStatus: number;
  status: string;
  message: string;
  encoded: Encoded | undefined;
  hasMore: boolean | undefined;
  total: number | undefined;
  pagingTable: unknown;
  resultTableList: unknown;
  rawKeys: string[];
};

const post = async (statement: string, extra: Record<string, unknown> = {}): Promise<Resp> => {
  const t0 = Date.now();
  const res = await fetch(`${KINETICA_URL}/execute/sql`, {
    method: "POST",
    headers: { Authorization: basicAuth, "Content-Type": "application/json" },
    body: JSON.stringify({
      statement,
      encoding: "json",
      request_schema_str: "",
      data: [],
      options: {},
      offset: 0,
      limit: 100,
      ...extra,
    }),
  });
  const ms = Date.now() - t0;
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  let ds: Record<string, unknown> = {};
  try {
    ds = typeof body.data_str === "string" ? JSON.parse(body.data_str) : ((body.data_str as object) ?? {});
  } catch {
    ds = {};
  }
  let encoded: Encoded | undefined;
  try {
    encoded =
      typeof ds.json_encoded_response === "string"
        ? JSON.parse(ds.json_encoded_response)
        : (ds.json_encoded_response as Encoded | undefined);
  } catch {
    encoded = undefined;
  }
  return {
    ms,
    httpStatus: res.status,
    status: String(body.status ?? ""),
    message: String(body.message ?? ""),
    encoded,
    hasMore: typeof ds.has_more_records === "boolean" ? ds.has_more_records : undefined,
    total: typeof ds.total_number_of_records === "number" ? ds.total_number_of_records : undefined,
    pagingTable: ds.paging_table,
    resultTableList: ds.result_table_list,
    rawKeys: Object.keys(ds),
  };
};

const ok = (r: Resp) => r.httpStatus < 400 && r.status !== "ERROR";

const transpose = (e: Encoded | undefined): unknown[][] => {
  if (!e || !Array.isArray(e.column_headers)) return [];
  const n = e.column_headers.length;
  const cols: unknown[][] = [];
  for (let i = 0; i < n; i++) cols.push((e[`column_${i + 1}`] as unknown[]) ?? []);
  const len = cols[0]?.length ?? 0;
  const rows: unknown[][] = [];
  for (let r = 0; r < len; r++) rows.push(cols.map((c) => c[r]));
  return rows;
};

const rowHash = (row: unknown[]) => createHash("sha1").update(JSON.stringify(row)).digest("hex");
const multiset = (rows: unknown[][]) => {
  const m = new Map<string, number>();
  for (const r of rows) {
    const h = rowHash(r);
    m.set(h, (m.get(h) ?? 0) + 1);
  }
  return m;
};
const msEqual = (a: Map<string, number>, b: Map<string, number>) => {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) if (b.get(k) !== v) return false;
  return true;
};
const dupCount = (m: Map<string, number>) => {
  let d = 0;
  for (const v of m.values()) if (v > 1) d += v - 1;
  return d;
};
const sleep = (s: number) => new Promise((r) => setTimeout(r, s * 1000));
const section = (t: string) => console.log(`\n${t}`);
const j = (o: unknown) => console.log(JSON.stringify(o));
const scalar = (r: Resp) => {
  const v = (r.encoded?.column_1 as unknown[] | undefined)?.[0];
  return typeof v === "number" ? v : Number(v);
};
const firstMidLast = (a: number[]) =>
  a.length ? { first: a[0], mid: a[Math.floor(a.length / 2)], last: a[a.length - 1], pages: a.length } : {};

const principal = {
  requestId: "export-spike",
  user: { sub: U, sid: "spike", credentialType: "password", creds: { username: U, password: P, token: "" } },
} as unknown as AuthedRequest;

type Page = { offset: number; n: number; hasMore: boolean | undefined; ms: number };

/** Page to exhaustion on has_more_records. Returns rows, pages, first raw page. */
const pageAll = async (
  stmt: string,
  batch: number,
  extraOptions: Record<string, unknown> | undefined,
  rowCap: number
) => {
  const rows: unknown[][] = [];
  const pages: Page[] = [];
  let offset = 0;
  let first: Resp | undefined;
  let headers: string[] = [];
  for (;;) {
    const r = await post(stmt, { offset, limit: batch, ...(extraOptions ? { options: extraOptions } : {}) });
    if (!ok(r)) throw new Error(`page@${offset}: ${r.message}`);
    first ??= r;
    if (!headers.length) headers = r.encoded?.column_headers ?? [];
    const pr = transpose(r.encoded);
    pages.push({ offset, n: pr.length, hasMore: r.hasMore, ms: r.ms });
    for (const x of pr) rows.push(x);
    offset += pr.length;
    if (r.hasMore !== true || pr.length === 0 || rows.length >= rowCap) break;
  }
  return { rows, pages, first: first!, headers };
};

const lastFlagsOk = (pages: Page[]) =>
  pages.every((p, i) => (i < pages.length - 1 ? p.hasMore === true : p.hasMore === false));

const drop = async (name: string) => {
  const r = await post(`DROP TABLE IF EXISTS ${name}`);
  return ok(r) ? "dropped" : `ERR ${r.message}`;
};

const exists = async (name: string) => {
  const r = await post(`SELECT COUNT(*) AS n FROM ${name}`);
  return ok(r) ? { exists: true, n: scalar(r) } : { exists: false, error: r.message };
};

const main = async () => {
  console.log(`[export-paging-spike] Kinetica: ${redactedUrl}  user: ${U}  run: ${RUN}`);

  // ---- Q0 table ----
  section("=== Q0 table selection ===");
  let table = process.env.EXPORT_SPIKE_TABLE;
  if (!table) {
    const st = await fetch(`${KINETICA_URL}/show/table`, {
      method: "POST",
      headers: { Authorization: basicAuth, "Content-Type": "application/json" },
      body: JSON.stringify({ table_name: "", options: { show_children: "true", get_sizes: "true" } }),
    });
    const body = (await st.json().catch(() => ({}))) as { data_str?: string };
    let names: string[] = [];
    let sizes: number[] = [];
    try {
      const ds = JSON.parse(body.data_str ?? "{}");
      names = ds.table_names ?? [];
      sizes = ds.full_sizes ?? ds.sizes ?? [];
    } catch {
      /* ignore */
    }
    const cands = names
      .map((n, i) => ({ n, s: Number(sizes[i] ?? 0) }))
      .filter((c) => !c.n.toUpperCase().startsWith("ki_catalog") && !c.n.startsWith("_kbi_") && !/^(ki_|INFORMATION_SCHEMA|SYS)/i.test(c.n))
      .sort((a, b) => b.s - a.s)
      .slice(0, 15);
    j({ candidates: cands.slice(0, 8) });
    for (const c of cands) {
      const r = await post(`SELECT COUNT(*) AS n FROM ${c.n}`);
      if (ok(r) && scalar(r) >= 50000) {
        table = c.n;
        break;
      }
    }
    table ??= "demo.nyctaxi";
  }
  const cnt0 = await post(`SELECT COUNT(*) AS n FROM ${table}`);
  if (!ok(cnt0)) {
    console.log(`Cannot COUNT ${table}: ${cnt0.message}`);
    process.exit(2);
  }
  const COUNT_BASE = scalar(cnt0);
  j({ table, count: COUNT_BASE });
  if (COUNT_BASE < 50000) {
    console.log("NO TABLE >= 50k - set EXPORT_SPIKE_TABLE");
    process.exit(2);
  }
  let src = table;
  let COUNT = COUNT_BASE;
  if (COUNT_BASE > MAX_ROWS) {
    const capmv = `${PFX}_cap`;
    created.push(capmv);
    const r = await post(
      `CREATE MATERIALIZED VIEW ${capmv} AS (SELECT * FROM ${table} LIMIT ${MAX_ROWS}) USING TABLE PROPERTIES (TTL = 30)`
    );
    if (!ok(r)) throw new Error(`cap MV: ${r.message}`);
    src = capmv;
    COUNT = scalar(await post(`SELECT COUNT(*) AS n FROM ${capmv}`));
    console.log(`COUNT ${COUNT_BASE} > EXPORT_SPIKE_MAX_ROWS ${MAX_ROWS}: all later probes read from capped MV ${capmv} (${COUNT} rows)`);
  }

  // ---- Q1 max_get_records_size ----
  section("=== Q1 max_get_records_size ===");
  let propVal: number | undefined;
  const sp = await post(`SHOW SYSTEM PROPERTIES WITH OPTIONS ('properties' = 'max_get_records_size')`);
  j({ showSystemProperties: ok(sp) ? sp.encoded : { error: sp.message } });
  if (ok(sp)) {
    const flat = JSON.stringify(sp.encoded ?? {});
    const m = flat.match(/max_get_records_size[^0-9]*"?(\d+)/);
    if (m) propVal = Number(m[1]);
  }
  const emp = await post(`SELECT * FROM ${src}`, { limit: 100000 });
  const empRows = transpose(emp.encoded).length;
  j({ empiricalRows: empRows, hasMore: emp.hasMore, total: emp.total, ms: emp.ms });
  const CONFIRMED_MAX = propVal ?? (emp.hasMore === true ? empRows : empRows);
  const maxSource = propVal ? "property" : "empirical";
  const BATCH = Math.min(CONFIRMED_MAX, 20000);
  j({ CONFIRMED_MAX, maxSource, BATCH });
  const headers = emp.encoded?.column_headers ?? [];
  const sortCol = process.env.EXPORT_SPIKE_SORT_COL ?? headers[0];

  const statements = {
    base: `SELECT * FROM ${src}`,
  };

  // ---- Q2 paging_table, no ORDER BY ----
  section("=== Q2 paging_table on source, no ORDER BY ===");
  const pg1 = `${PFX}_pg1`;
  created.push(pg1);
  let hPg: Map<string, number> | undefined;
  try {
    const res = await pageAll(statements.base, BATCH, { paging_table: pg1, paging_table_ttl: "30" }, Infinity);
    hPg = multiset(res.rows);
    j({
      totalRows: res.rows.length,
      timing: firstMidLast(res.pages.map((p) => p.ms)),
      hasMoreSequenceOk: lastFlagsOk(res.pages),
      pages: res.pages.length,
      hasMoreFirst3: res.pages.slice(0, 3).map((p) => p.hasMore),
      hasMoreLast: res.pages[res.pages.length - 1]?.hasMore,
      pagingTableField: res.first.pagingTable,
      resultTableList: res.first.resultTableList,
      rawKeys: res.first.rawKeys,
      totalFieldPage1: res.first.total,
      multisetDuplicates: dupCount(hPg),
    });
  } catch (e) {
    j({ error: String(e) });
  }

  // ---- Q3 snapshot MV + OFFSET ----
  section("=== Q3 snapshot MV + OFFSET + ORDER BY all columns ===");
  const mv = `${PFX}_mv`;
  created.push(mv);
  let hOff: Map<string, number> | undefined;
  let mvMs = -1;
  let COUNT_MV = 0;
  try {
    const t0 = Date.now();
    const c = await post(
      `CREATE MATERIALIZED VIEW ${mv} AS (SELECT * FROM ${src}) USING TABLE PROPERTIES (TTL = 30)`
    );
    mvMs = Date.now() - t0;
    if (!ok(c)) throw new Error(`MV create: ${c.message}`);
    const c1 = scalar(await post(`SELECT COUNT(*) AS n FROM ${mv}`));
    const c2 = scalar(await post(`SELECT COUNT(*) AS n FROM ${mv}`));
    COUNT_MV = c1;
    j({ mvCreateMs: mvMs, count1: c1, count2: c2, sourceCount: COUNT });
    const orderAll = headers.map((h) => `"${h}"`).join(", ");
    const res = await pageAll(`SELECT * FROM ${mv} ORDER BY ${orderAll}`, BATCH, undefined, Infinity);
    hOff = multiset(res.rows);
    j({
      totalRows: res.rows.length,
      timing: firstMidLast(res.pages.map((p) => p.ms)),
      hasMoreSequenceOk: lastFlagsOk(res.pages),
      pages: res.pages.length,
      duplicateRows: dupCount(hOff),
      pagingTableFieldWhenNotRequested: res.first.pagingTable,
    });
    j({
      H_pg_equals_H_off: hPg && msEqual(hPg, hOff),
      pgTotal: hPg ? [...hPg.values()].reduce((a, b) => a + b, 0) : null,
      offTotal: res.rows.length,
      count: COUNT,
    });
  } catch (e) {
    j({ error: String(e) });
  }

  // ---- Q4 paging_table on MV with ORDER BY sortCol ----
  section(`=== Q4 paging_table on MV with ORDER BY ${sortCol} ===`);
  const pg2 = `${PFX}_pg2`;
  created.push(pg2);
  try {
    const res = await pageAll(
      `SELECT * FROM ${mv} ORDER BY "${sortCol}"`,
      BATCH,
      { paging_table: pg2, paging_table_ttl: "30" },
      Infinity
    );
    const si = res.headers.indexOf(sortCol);
    let violations = 0;
    let firstViolation = -1;
    for (let i = 1; i < res.rows.length; i++) {
      const a = res.rows[i - 1][si] as number | string;
      const b = res.rows[i][si] as number | string;
      if (a > b) {
        violations++;
        if (firstViolation < 0) firstViolation = i;
      }
    }
    j({
      sortCol,
      totalRows: res.rows.length,
      countMv: COUNT_MV,
      nonDecreasing: violations === 0,
      violations,
      firstViolation,
      pageBoundaries: res.pages.map((p) => p.offset).slice(0, 5),
      timing: firstMidLast(res.pages.map((p) => p.ms)),
      hasMoreSequenceOk: lastFlagsOk(res.pages),
      totalFieldPage1: res.first.total,
    });
  } catch (e) {
    j({ error: String(e) });
  }

  // ---- Q5 durability + TTL ----
  section("=== Q5 durability + TTL ===");
  const pg3 = `${PFX}_pg3`;
  const ttlmv = `${PFX}_ttlmv`;
  created.push(pg3, ttlmv);
  try {
    const stmt = `SELECT * FROM ${mv}`;
    const p1 = await post(stmt, { offset: 0, limit: BATCH, options: { paging_table: pg3, paging_table_ttl: "1" } });
    j({ pg3Page1: { ok: ok(p1), rows: transpose(p1.encoded).length, hasMore: p1.hasMore, err: p1.message } });
    const q = await post(`SELECT COUNT(*) AS n FROM ${pg3}`);
    j({ pagingTableSqlQueryable: ok(q), result: ok(q) ? scalar(q) : q.message });
    const tm = await post(
      `CREATE MATERIALIZED VIEW ${ttlmv} AS (SELECT * FROM ${mv} LIMIT 10) USING TABLE PROPERTIES (TTL = 1)`
    );
    j({ ttlmvCreated: ok(tm), err: tm.message });
    console.log(`sleeping ${WAIT_S}s ...`);
    await sleep(WAIT_S);
    const p2 = await post(stmt, { offset: BATCH, limit: BATCH, options: { paging_table: pg3, paging_table_ttl: "1" } });
    j({ pg3Page2AfterWait: { ms: p2.ms, rows: transpose(p2.encoded).length, hasMore: p2.hasMore, error: ok(p2) ? "" : p2.message } });
    j({ pg3ExistsAfterWait: await exists(pg3), ttlmvExistsAfterWait: await exists(ttlmv) });
  } catch (e) {
    j({ error: String(e) });
  }

  // ---- Q6 cleanup ----
  section("=== Q6 cleanup ===");
  try {
    j({ dropPg1: await drop(pg1), pg1After: await exists(pg1) });
    j({ dropNeverCreated: await drop(`${PFX}_never`) });
    const smallPg = `${PFX}_small`;
    created.push(smallPg);
    const sm = await post(`SELECT * FROM ${src} LIMIT 5`, {
      offset: 0,
      limit: 100,
      options: { paging_table: smallPg, paging_table_ttl: "30" },
    });
    j({ smallResult: { ok: ok(sm), rows: transpose(sm.encoded).length, pagingTableField: sm.pagingTable, tableExists: await exists(smallPg) } });
  } catch (e) {
    j({ error: String(e) });
  }

  // ---- Q7 D-04a ----
  section("=== Q7 (D-04a) split-call order without ORDER BY via kineticaSql ===");
  try {
    process.env.KINETICA_MAX_ROWS_PER_QUERY = String(CONFIRMED_MAX);
    process.env.KINETICA_MAX_RECORDS_PER_CALL = String(CONFIRMED_MAX);
    const A = transpose(
      (await kineticaSql(principal, statements.base, { route: "SPIKE", op: "SQL", extra: { limit: CONFIRMED_MAX } })) as Encoded
    );
    const aSeq = A.map(rowHash);
    const aMs = multiset(A);
    process.env.KINETICA_MAX_RECORDS_PER_CALL = String(Math.floor(CONFIRMED_MAX / 4));
    const out: unknown[] = [];
    for (let i = 1; i <= 3; i++) {
      const B = transpose(
        (await kineticaSql(principal, statements.base, { route: "SPIKE", op: "SQL", extra: { limit: CONFIRMED_MAX } })) as Encoded
      );
      const bSeq = B.map(rowHash);
      let firstDiff = -1;
      for (let k = 0; k < Math.max(aSeq.length, bSeq.length); k++) {
        if (aSeq[k] !== bSeq[k]) {
          firstDiff = k;
          break;
        }
      }
      const sameSet = msEqual(aMs, multiset(B));
      out.push({
        run: `B${i}`,
        rowsA: A.length,
        rowsB: B.length,
        verdict: firstDiff < 0 ? "identical" : sameSet ? "reordered" : "different-rows",
        firstDiff,
      });
    }
    j(out);
  } catch (e) {
    j({ error: String(e) });
  }

  // ---- Q8 D-04b ----
  section("=== Q8 (D-04b) KINETICA_MAX_RECORDS_PER_CALL above server max ===");
  const origWarn = console.warn;
  let warns = 0;
  try {
    __resetRowLimitWarningsForTest();
    console.warn = (...a: unknown[]) => {
      if (a.some((x) => String(x).includes("exceeds this Kinetica server"))) warns++;
      origWarn(...a);
    };
    process.env.KINETICA_MAX_RECORDS_PER_CALL = String(CONFIRMED_MAX * 2);
    const want = Math.min(CONFIRMED_MAX * 3, COUNT);
    process.env.KINETICA_MAX_ROWS_PER_QUERY = String(want);
    const results: unknown[] = [];
    for (let i = 0; i < 2; i++) {
      const rows = transpose(
        (await kineticaSql(principal, statements.base, { route: "SPIKE", op: "SQL", extra: { limit: want } })) as Encoded
      );
      results.push({ rows: rows.length, expected: want, duplicates: dupCount(multiset(rows)) });
    }
    j({ results, warningCount: warns });
  } catch (e) {
    j({ error: String(e) });
  } finally {
    console.warn = origWarn;
    delete process.env.KINETICA_MAX_RECORDS_PER_CALL;
    delete process.env.KINETICA_MAX_ROWS_PER_QUERY;
  }

  // ---- Q9 value types ----
  section("=== Q9 value types ===");
  const t = await post(`SELECT * FROM ${src}`, { limit: 1 });
  j({
    column_headers: t.encoded?.column_headers,
    column_datatypes: t.encoded?.column_datatypes,
    firstRow: transpose(t.encoded)[0],
  });
};

let exitCode = 0;
try {
  await main();
} catch (e) {
  console.error("[export-paging-spike] FATAL:", e instanceof Error ? e.message : String(e));
  exitCode = 1;
} finally {
  section("=== CLEANUP ===");
  for (const name of created) {
    try {
      console.log(`DROP TABLE IF EXISTS ${name}: ${await drop(name)}`);
    } catch (e) {
      console.log(`DROP ${name} threw: ${String(e)}`);
    }
  }
  section("=== LEFTOVER CHECK ===");
  for (const name of created) {
    try {
      const r = await exists(name);
      console.log(`${name}: ${r.exists ? "STILL EXISTS" : "gone (" + (r as { error: string }).error + ")"}`);
    } catch (e) {
      console.log(`${name}: check threw ${String(e)}`);
    }
  }
}
process.exit(exitCode);
