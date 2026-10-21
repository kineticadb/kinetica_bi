import { loadModule, parse } from "libpg-query";

export const GUARD_MAX_SQL_CHARS = 8000;
export const SYSTEM_SCHEMAS: ReadonlySet<string> = new Set(["ki_catalog", "information_schema", "pg_catalog", "sys"]); // ki_home deliberately NOT included: it is a normal user schema in Kinetica
export type GuardScope = { allowed: ReadonlySet<string> };
export type GuardTableRef = { schema?: string; name: string; location: number };
export type GuardResult = { ok: true; tables: GuardTableRef[]; columnNames: string[] } | { ok: false; reason: string };
export const GUARD_REASONS = {
  empty: "the query is empty",
  tooLong: "the query is too long (at most 8000 characters)",
  badChars: "remove semicolons, comments and the characters \\ # $ ` from the query, including inside text literals",
  unparseable: "unsupported or invalid syntax; rewrite it as one standard SQL SELECT (QUALIFY, PIVOT, TOP, LIMIT a,b, TABLE(...) and backticks are not supported)",
  multi: "only one statement is allowed",
  notSelect: "only a single SELECT (or WITH ... SELECT) is allowed",
  into: "SELECT INTO is not allowed",
  locking: "FOR UPDATE / FOR SHARE is not allowed",
  recursive: "WITH RECURSIVE is not allowed",
  dataModifying: "INSERT, UPDATE, DELETE and MERGE are not allowed",
  tableFunction: "table functions are not allowed in FROM",
  system: "system and catalog objects are not allowed; use describe_table for schema information",
  catalog: "catalog-qualified names are not allowed",
  noTable: "the query must read from a table or view on this dashboard",
  aliasUnresolved: "could not resolve a view alias; write dv_<id> or aidv_<n> exactly, unquoted",
} as const;
export const functionNotAllowed = (name: string): string => `function ${name.slice(0, 128)} is not allowed`;
export const tableNotInScope = (name: string, hint?: string): string => hint
  ? `table ${name.slice(0, 128)} is not available; use the schema-qualified name ${hint}`
  : `table ${name.slice(0, 128)} is not on this dashboard; use a table from describe_table or a view alias`;

const RAW_BAD: RegExp[] = [/;/, /--/, /\/\*/, /\*\//, /\\/, /#/, /\$/, /`/, /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/];
const FN_DENY = /^(pg_|dblink|lo_|set_config$|current_setting$)/;

let loading: Promise<void> | null = null;
function ensureLoaded(): Promise<void> {
  if (!loading) loading = loadModule().catch((e) => { loading = null; throw e; });
  return loading;
}

class Refusal extends Error {
  constructor(public readonly reason: string) { super(reason); }
}

type Node = Record<string, unknown>;
const isObj = (v: unknown): v is Node => typeof v === "object" && v !== null && !Array.isArray(v);
const lc = (v: unknown): string => String(v ?? "").toLowerCase();

type WalkState = { tables: GuardTableRef[]; columns: Set<string> };

function walkSelect(sel: Node, scope: ReadonlySet<string>, st: WalkState): void {
  if (sel.intoClause) throw new Refusal(GUARD_REASONS.into);
  if (sel.lockingClause) throw new Refusal(GUARD_REASONS.locking);
  let local = scope;
  const wc = sel.withClause;
  if (isObj(wc)) {
    if (wc.recursive) throw new Refusal(GUARD_REASONS.recursive);
    local = new Set(scope);
    for (const c of (wc.ctes as unknown[] | undefined) ?? []) {
      const cte = isObj(c) && isObj(c.CommonTableExpr) ? c.CommonTableExpr : null;
      if (!cte) throw new Refusal(GUARD_REASONS.unparseable);
      walkNode(cte.ctequery, local, st);
      (local as Set<string>).add(lc(cte.ctename));
    }
  }
  for (const [k, v] of Object.entries(sel)) if (k !== "withClause") walkNode(v, local, st);
}

function walkNode(n: unknown, scope: ReadonlySet<string>, st: WalkState): void {
  if (Array.isArray(n)) { for (const x of n) walkNode(x, scope, st); return; }
  if (!isObj(n)) return;
  for (const [key, val] of Object.entries(n)) {
    switch (key) {
      case "SelectStmt":
        if (isObj(val)) walkSelect(val, scope, st);
        continue;
      case "InsertStmt": case "UpdateStmt": case "DeleteStmt": case "MergeStmt":
        throw new Refusal(GUARD_REASONS.dataModifying);
      case "RangeFunction": case "RangeTableFunc": case "RangeTableSample":
        throw new Refusal(GUARD_REASONS.tableFunction);
      case "RangeVar": {
        if (!isObj(val)) continue;
        if (val.catalogname) throw new Refusal(GUARD_REASONS.catalog);
        const schema = val.schemaname ? lc(val.schemaname) : undefined;
        const name = lc(val.relname);
        if (schema && SYSTEM_SCHEMAS.has(schema)) throw new Refusal(GUARD_REASONS.system);
        if (!schema && scope.has(name)) continue;
        st.tables.push({ ...(schema ? { schema } : {}), name, location: Number(val.location ?? 0) });
        continue;
      }
      case "FuncCall": {
        if (isObj(val)) checkFunc(val);
        walkNode(val, scope, st);
        continue;
      }
      case "ColumnRef": {
        if (isObj(val)) {
          for (const f of (val.fields as unknown[] | undefined) ?? []) {
            if (isObj(f) && isObj(f.String)) st.columns.add(lc(f.String.sval));
          }
        }
        continue;
      }
      default:
        walkNode(val, scope, st);
    }
  }
}

function checkFunc(fc: Node): void {
  const parts = ((fc.funcname as unknown[] | undefined) ?? [])
    .map((p) => (isObj(p) && isObj(p.String) ? lc(p.String.sval) : ""));
  if (parts.length > 1 && !(parts[0] === "pg_catalog" && fc.funcformat === "COERCE_SQL_SYNTAX")) {
    throw new Refusal(functionNotAllowed(parts.join(".")));
  }
  const last = parts[parts.length - 1] ?? "";
  if (FN_DENY.test(last)) throw new Refusal(functionNotAllowed(last));
}

export async function guardQuery(sql: string, scope: GuardScope): Promise<GuardResult> {
  try {
    if (typeof sql !== "string" || sql.trim() === "") return { ok: false, reason: GUARD_REASONS.empty };
    if (sql.length > GUARD_MAX_SQL_CHARS) return { ok: false, reason: GUARD_REASONS.tooLong };
    if (RAW_BAD.some((re) => re.test(sql))) return { ok: false, reason: GUARD_REASONS.badChars };
    let ast: { stmts: { stmt: Node }[] };
    try {
      await ensureLoaded();
      ast = (await parse(sql)) as unknown as { stmts: { stmt: Node }[] };
    } catch {
      return { ok: false, reason: GUARD_REASONS.unparseable };
    }
    if (ast.stmts.length !== 1) return { ok: false, reason: GUARD_REASONS.multi };
    const top = ast.stmts[0].stmt;
    if (!isObj(top.SelectStmt)) return { ok: false, reason: GUARD_REASONS.notSelect };
    const st: WalkState = { tables: [], columns: new Set() };
    walkSelect(top.SelectStmt, new Set(), st);
    if (st.tables.length === 0) return { ok: false, reason: GUARD_REASONS.noTable };
    const allowed = new Set([...scope.allowed].map((a) => a.toLowerCase()));
    for (const t of st.tables) {
      const key = t.schema ? `${t.schema}.${t.name}` : t.name;
      if (allowed.has(key)) continue;
      if (!t.schema) {
        const matches = [...allowed].filter((a) => a.endsWith(`.${t.name}`));
        if (matches.length === 1) return { ok: false, reason: tableNotInScope(t.name, matches[0]) };
      }
      return { ok: false, reason: tableNotInScope(key) };
    }
    return { ok: true, tables: st.tables, columnNames: [...st.columns] };
  } catch (e) {
    if (e instanceof Refusal) return { ok: false, reason: e.reason };
    return { ok: false, reason: GUARD_REASONS.unparseable };
  }
}
