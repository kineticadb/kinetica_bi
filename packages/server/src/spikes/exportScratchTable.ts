/**
 * exportScratchTable.ts - Phase 131 operator-approved scratch table helper (decision O-2).
 *
 * PURPOSE: build a >= 1,000,000-row scratch table for the live export checkpoint
 * (ROADMAP criterion 5) and the snapshot-isolation test (mutate rows mid-export).
 *
 * APPROVAL GATE: create / mutate / drop refuse to touch Kinetica unless
 * EXPORT_SCRATCH_APPROVED=yes. `plan` makes NO Kinetica call. `count` is read-only.
 *
 * USAGE: cd packages/server && npx tsx src/spikes/exportScratchTable.ts <plan|count|create|mutate|drop> [--schema]
 * ENV:
 *   EXPORT_SCRATCH_TABLE          required, schema.table (identifier chars only)
 *   EXPORT_SCRATCH_SOURCE         default demo.nyctaxi; must differ from the table
 *   EXPORT_SCRATCH_COPIES         default 2 (integer 1-10)
 *   EXPORT_SCRATCH_CREATE_SCHEMA  "yes" => also CREATE SCHEMA IF NOT EXISTS; allows `drop --schema`
 *   EXPORT_SCRATCH_DELETE_WHERE   required for mutate; must not contain ";"
 *   EXPORT_SCRATCH_APPROVED       "yes" required for create / mutate / drop
 * REQUIRED .env for non-plan commands: KINETICA_URL, KINETICA_USERNAME, KINETICA_PASSWORD
 *
 * Never prints credentials. NOT part of the Express app.
 */
import dotenv from "dotenv";

dotenv.config();

const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*$/;
const die = (msg: string): never => {
  console.error(`[export-scratch] ${msg}`);
  process.exit(1);
};

const cmd = process.argv[2];
const withSchema = process.argv.includes("--schema");
if (!cmd || !["plan", "count", "create", "mutate", "drop"].includes(cmd)) {
  die("usage: exportScratchTable.ts <plan|count|create|mutate|drop> [--schema]");
}

const TABLE = process.env.EXPORT_SCRATCH_TABLE ?? "";
const SOURCE = process.env.EXPORT_SCRATCH_SOURCE ?? "demo.nyctaxi";
const COPIES = Number(process.env.EXPORT_SCRATCH_COPIES ?? "2");
const CREATE_SCHEMA = process.env.EXPORT_SCRATCH_CREATE_SCHEMA === "yes";
const DELETE_WHERE = process.env.EXPORT_SCRATCH_DELETE_WHERE;
const APPROVED = process.env.EXPORT_SCRATCH_APPROVED === "yes";

if (!NAME_RE.test(TABLE)) die("EXPORT_SCRATCH_TABLE must be set and match schema.table (identifier characters only)");
if (!NAME_RE.test(SOURCE)) die("EXPORT_SCRATCH_SOURCE must match schema.table (identifier characters only)");
if (TABLE.toLowerCase() === SOURCE.toLowerCase()) die("EXPORT_SCRATCH_TABLE must differ from EXPORT_SCRATCH_SOURCE");
if (!Number.isInteger(COPIES) || COPIES < 1 || COPIES > 10) die("EXPORT_SCRATCH_COPIES must be an integer 1-10");
if (DELETE_WHERE !== undefined && DELETE_WHERE.includes(";")) die("EXPORT_SCRATCH_DELETE_WHERE must not contain ';'");

const SCHEMA = TABLE.split(".")[0];

const createStatements = (): string[] => {
  const s: string[] = [];
  if (CREATE_SCHEMA) s.push(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`);
  s.push(`CREATE TABLE ${TABLE} AS SELECT * FROM ${SOURCE}`);
  for (let i = 1; i < COPIES; i++) s.push(`INSERT INTO ${TABLE} SELECT * FROM ${SOURCE}`);
  s.push(`SELECT COUNT(*) FROM ${TABLE}`);
  return s;
};
const mutateStatements = (): string[] => [
  `SELECT COUNT(*) FROM ${TABLE}`,
  `DELETE FROM ${TABLE} WHERE ${DELETE_WHERE ?? "<EXPORT_SCRATCH_DELETE_WHERE>"}`,
  `INSERT INTO ${TABLE} SELECT * FROM ${SOURCE} LIMIT 1000`,
  `SELECT COUNT(*) FROM ${TABLE}`,
];
const dropStatements = (): string[] => {
  const s = [`DROP TABLE IF EXISTS ${TABLE}`];
  if (withSchema && CREATE_SCHEMA) s.push(`DROP SCHEMA IF EXISTS ${SCHEMA}`);
  return s;
};

if (cmd === "plan") {
  console.log(`[export-scratch] PLAN (no Kinetica call made). table=${TABLE} source=${SOURCE} copies=${COPIES} create_schema=${CREATE_SCHEMA}`);
  console.log("-- create:");
  createStatements().forEach((x) => console.log("  " + x));
  console.log("-- mutate (operator, mid-export):");
  mutateStatements().forEach((x) => console.log("  " + x));
  console.log("-- drop:");
  dropStatements().forEach((x) => console.log("  " + x));
  console.log("-- approval: create/mutate/drop require EXPORT_SCRATCH_APPROVED=yes");
  process.exit(0);
}

if (cmd !== "count" && !APPROVED) {
  die(`REFUSED: '${cmd}' writes to Kinetica and requires EXPORT_SCRATCH_APPROVED=yes. Nothing was executed.`);
}
if (cmd === "mutate" && !DELETE_WHERE) die("mutate requires EXPORT_SCRATCH_DELETE_WHERE");

const KINETICA_URL = process.env.KINETICA_URL?.replace(/\/$/, "");
const U = process.env.KINETICA_USERNAME;
const P = process.env.KINETICA_PASSWORD;
if (!KINETICA_URL || !U || !P) die("KINETICA_URL, KINETICA_USERNAME and KINETICA_PASSWORD must be set in packages/server/.env");
const auth = "Basic " + Buffer.from(`${U}:${P}`).toString("base64");

const run = async (statement: string): Promise<unknown[]> => {
  console.log(`[export-scratch] > ${statement}`);
  const res = await fetch(`${KINETICA_URL}/execute/sql`, {
    method: "POST",
    headers: { Authorization: auth, "Content-Type": "application/json" },
    body: JSON.stringify({ statement, encoding: "json", request_schema_str: "", data: [], options: {}, offset: 0, limit: 10 }),
  });
  const body = (await res.json().catch(() => null)) as { status?: string; message?: string; data_str?: unknown } | null;
  if (!res.ok || !body || body.status === "ERROR") {
    console.error(`[export-scratch] Kinetica error (HTTP ${res.status}): ${body?.message ?? "(no message)"}`);
    process.exit(1);
  }
  try {
    const ds = typeof body.data_str === "string" ? JSON.parse(body.data_str) : (body.data_str as Record<string, unknown>);
    const enc = typeof ds?.json_encoded_response === "string" ? JSON.parse(ds.json_encoded_response as string) : ds?.json_encoded_response;
    return ((enc as Record<string, unknown[]> | undefined)?.column_1 ?? []) as unknown[];
  } catch {
    return [];
  }
};
const count = async (where?: string): Promise<number> => {
  const col = await run(`SELECT COUNT(*) FROM ${TABLE}${where ? ` WHERE ${where}` : ""}`);
  const n = Number(col[0]);
  console.log(`[export-scratch] COUNT${where ? ` WHERE ${where}` : ""} = ${n}`);
  return n;
};

const main = async () => {
  if (cmd === "count") {
    await count();
    if (DELETE_WHERE) await count(DELETE_WHERE);
  } else if (cmd === "create") {
    // Refuse to overwrite: the table must NOT exist (COUNT must fail).
    const probe = await fetch(`${KINETICA_URL}/execute/sql`, {
      method: "POST",
      headers: { Authorization: auth, "Content-Type": "application/json" },
      body: JSON.stringify({ statement: `SELECT COUNT(*) FROM ${TABLE}`, encoding: "json", request_schema_str: "", data: [], options: {}, offset: 0, limit: 1 }),
    });
    const pb = (await probe.json().catch(() => null)) as { status?: string } | null;
    if (probe.ok && pb && pb.status !== "ERROR") die(`REFUSED: ${TABLE} already exists; nothing was overwritten.`);
    for (const stmt of createStatements().slice(0, -1)) await run(stmt);
    await count();
  } else if (cmd === "mutate") {
    await count();
    await run(`DELETE FROM ${TABLE} WHERE ${DELETE_WHERE}`);
    await run(`INSERT INTO ${TABLE} SELECT * FROM ${SOURCE} LIMIT 1000`);
    await count();
  } else if (cmd === "drop") {
    for (const stmt of dropStatements()) await run(stmt);
  }
};
main().catch((e) => {
  console.error(`[export-scratch] ERROR: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
