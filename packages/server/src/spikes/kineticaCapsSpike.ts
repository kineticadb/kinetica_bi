/**
 * kineticaCapsSpike.ts - Phase 133 S7 live harness (operator-run, NON-ADMIN Kinetica user, D-12).
 *
 * QUESTION: what can the non-admin user do - create views, enforce a statement timeout, be denied writes by
 * grants, run EXPLAIN, and how are unquoted identifiers case-folded?
 *
 * USAGE:
 *   cd packages/server && npx tsx src/spikes/kineticaCapsSpike.ts [--try-alter]
 *
 * ENV (LOCAL, un-committed packages/server/.env; never paste the password anywhere):
 *   KINETICA_URL, KINETICA_USERNAME, KINETICA_PASSWORD   - the NON-ADMIN user
 *   SPIKE_SOURCE_TABLE (default demo.nyctaxi), SPIKE_SCHEMA (optional), SPIKE_SLOW_SQL (optional),
 *   SPIKE_FILTER_COLUMN (a known column name for the case-folding probe)
 *
 * SAFETY: creates only _kbi_spike_<rand>_* objects (dropped in `finally`). Write probes on the source table use
 * WHERE 1 = 0 so no data can change. ALTER only runs with --try-alter. Never drops a non-spike table.
 * No AI provider is called.
 */
import dotenv from "dotenv";

dotenv.config();

const KINETICA_URL = process.env.KINETICA_URL?.replace(/\/$/, "");
const USER = process.env.KINETICA_USERNAME;
const PASS = process.env.KINETICA_PASSWORD;
if (!KINETICA_URL || !USER || !PASS) {
  console.error("[s7-spike] ERROR: KINETICA_URL, KINETICA_USERNAME, KINETICA_PASSWORD must be set in your local .env");
  process.exit(1);
}
console.log(`[s7-spike] User: ${USER}   (confirm this is the NON-ADMIN user)`);
console.log(`[s7-spike] Kinetica: ${KINETICA_URL}`);

const SRC = process.env.SPIKE_SOURCE_TABLE ?? "demo.nyctaxi";
const SCHEMA = process.env.SPIKE_SCHEMA;
const COL = process.env.SPIKE_FILTER_COLUMN;
const SLOW = process.env.SPIKE_SLOW_SQL ?? `SELECT COUNT(*) FROM ${SRC} a, ${SRC} b`;
const TRY_ALTER = process.argv.includes("--try-alter");
const auth = "Basic " + Buffer.from(`${USER}:${PASS}`).toString("base64");
const r6 = Math.random().toString(36).slice(2, 8);
const V = `_kbi_spike_${r6}_v`;
const V2 = `_kbi_spike_${r6}_v2`;
const W = `_kbi_spike_${r6}_w`;
console.log(`[s7-spike] Source: ${SRC}   spike objects: ${V}, ${V2}, ${W}\n`);

type SqlResult = { ok: boolean; message?: string; encoded?: Record<string, unknown>; ms: number };

async function sql(
  statement: string,
  opts: { limit?: number; options?: Record<string, string>; signal?: AbortSignal } = {},
): Promise<SqlResult> {
  const t0 = Date.now();
  let res: Response;
  try {
    res = await fetch(`${KINETICA_URL}/execute/sql`, {
      method: "POST",
      signal: opts.signal,
      headers: { Authorization: auth, "Content-Type": "application/json" },
      body: JSON.stringify({
        statement, offset: 0, limit: opts.limit ?? 1000, encoding: "json", request_schema_str: "", data: [],
        options: opts.options ?? {},
      }),
    });
  } catch (e) {
    return { ok: false, message: `network/abort: ${String(e)}`, ms: Date.now() - t0 };
  }
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok || !body || body.status === "ERROR") {
    return { ok: false, message: `HTTP ${res.status} ${String(body?.message ?? "no body")}`, ms: Date.now() - t0 };
  }
  try {
    const ds = typeof body.data_str === "string" ? JSON.parse(body.data_str) : (body.data_str as Record<string, unknown>);
    const enc = typeof ds?.json_encoded_response === "string" ? JSON.parse(ds.json_encoded_response) : ds?.json_encoded_response;
    return { ok: true, encoded: enc as Record<string, unknown>, ms: Date.now() - t0 };
  } catch {
    return { ok: true, ms: Date.now() - t0 };
  }
}

const results: Record<string, string> = {};
function record(step: string, outcome: "PASS" | "DENIED" | "FAIL" | "SKIPPED", detail: string): void {
  results[step] = outcome;
  console.log(`${step}: ${outcome}${detail ? " - " + detail : ""}`);
}
const headers = (e?: Record<string, unknown>): string[] | undefined =>
  Array.isArray(e?.column_headers) ? (e!.column_headers as string[]) : undefined;

try {
  // S7.1 view creation
  const v1 = await sql(`CREATE OR REPLACE MATERIALIZED VIEW ${V} AS (SELECT * FROM ${SRC} LIMIT 10) USING TABLE PROPERTIES (TTL = 2)`);
  record("S7.1a create view (default schema)", v1.ok ? "PASS" : "DENIED", v1.message ?? "");
  if (SCHEMA) {
    const v2 = await sql(`CREATE OR REPLACE MATERIALIZED VIEW ${V2} AS (SELECT * FROM ${SRC} LIMIT 10) USING TABLE PROPERTIES (TTL = 2)`, {
      options: { current_schema: SCHEMA },
    });
    record(`S7.1b create view (current_schema=${SCHEMA})`, v2.ok ? "PASS" : "DENIED", v2.message ?? "");
  } else record("S7.1b create view (current_schema)", "SKIPPED", "SPIKE_SCHEMA unset");

  // S7.2 timeout / abort
  const base = await sql(`SELECT 1`);
  console.log(`S7.2 baseline SELECT 1: ${base.ms} ms`);
  const full = await sql(SLOW);
  record("S7.2a slow query to completion", full.ok ? "PASS" : "FAIL", `elapsed=${full.ms} ms${full.message ? " " + full.message : ""}`);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 2000);
  const aborted = await sql(SLOW, { signal: ac.signal });
  clearTimeout(timer);
  const after = await sql(`SELECT 1`);
  record(
    "S7.2b client abort after 2 s",
    aborted.ok ? "FAIL" : "PASS",
    `slow call returned after ${aborted.ms} ms (${aborted.message?.slice(0, 80) ?? "completed"}); immediate SELECT 1 took ${after.ms} ms vs baseline ${base.ms} ms (much slower => server kept executing after abort)`,
  );
  const tmo = await sql(SLOW, { options: { timeout: "5" } });
  record("S7.2c options.timeout=5 accepted?", tmo.ok ? "PASS" : "DENIED", `elapsed=${tmo.ms} ms ${tmo.message ?? "(accepted; check elapsed to see whether it was enforced)"}`);

  // S7.3 write enforcement
  const cw = await sql(`CREATE TABLE ${W} (id INT)`);
  record("S7.3a CREATE TABLE scratch", cw.ok ? "PASS" : "DENIED", cw.message ?? "");
  const del = await sql(`DELETE FROM ${SRC} WHERE 1 = 0`);
  record("S7.3b DELETE source (WHERE 1 = 0)", del.ok ? "PASS" : "DENIED", del.ok ? "ALLOWED by grants (0 rows affected)" : (del.message ?? ""));
  const ins = await sql(`INSERT INTO ${SRC} SELECT * FROM ${SRC} WHERE 1 = 0`);
  record("S7.3c INSERT source (WHERE 1 = 0)", ins.ok ? "PASS" : "DENIED", ins.ok ? "ALLOWED by grants (0 rows inserted)" : (ins.message ?? ""));
  if (TRY_ALTER) {
    const alt = await sql(`ALTER TABLE ${SRC} ADD COLUMN _kbi_spike_c INT`);
    record("S7.3d ALTER source", alt.ok ? "PASS" : "DENIED", alt.ok ? "ALLOWED - OPERATOR: drop column _kbi_spike_c manually" : (alt.message ?? ""));
  } else record("S7.3d ALTER source", "SKIPPED", "pass --try-alter to run");

  // S7.4 EXPLAIN
  const ex = await sql(`EXPLAIN SELECT * FROM ${SRC} WHERE 1 = 1`);
  record("S7.4 EXPLAIN", ex.ok ? "PASS" : "DENIED", ex.ok ? `keys=${JSON.stringify(Object.keys(ex.encoded ?? {}))} sample=${JSON.stringify(ex.encoded).slice(0, 400)}` : (ex.message ?? ""));

  // S7.5 case folding
  if (COL) {
    for (const [label, ident] of [
      ["as-given", COL],
      ["UPPER unquoted", COL.toUpperCase()],
      ["UPPER quoted", `"${COL.toUpperCase()}"`],
    ] as const) {
      const r = await sql(`SELECT ${ident} FROM ${SRC} LIMIT 1`, { limit: 1 });
      record(`S7.5 ${label}`, r.ok ? "PASS" : "FAIL", r.ok ? `header=${JSON.stringify(headers(r.encoded))}` : (r.message ?? ""));
    }
  } else record("S7.5 case folding", "SKIPPED", "SPIKE_FILTER_COLUMN unset");
} finally {
  const drops = await Promise.all([V, V2, W].map((n) => sql(`DROP TABLE IF EXISTS ${n}`)));
  record("S7.cleanup drop spike objects", drops.every((d) => d.ok) ? "PASS" : "FAIL", drops.map((d) => d.message).filter(Boolean).join(" | "));
}

console.log("\n=== DECISION-RECORD ===");
console.log(`user=${USER} source=${SRC}`);
for (const [k, v] of Object.entries(results)) console.log(`${k}: ${v}`);
console.log("Read: S7.3b/c PASS => grants do NOT block writes => Phase 140 guard must be fully app-side. S7.2c DENIED => no server-side timeout option. S7.2b slow SELECT 1 => abort does not stop the server.");
