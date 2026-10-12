// Column truth is the user-credentialed probe (133-SPIKES S1); never columns_json or client lists.
// Inaccessible and not-found are indistinguishable by design (AISAFE-V20-03): every failure is exactly {ok:false}.
import { kineticaSql, type KineticaPrincipal } from "../../kinetica";
import { getTable as dbGetTable } from "../../db";
import type { Table } from "../../types";
import { assertIdentifier } from "../columnGuard";
import { SessionEndedError } from "../exportRunner";
import { buildViewColumnsProbeSql, parseProbeColumns, createViewColumnsCache } from "../viewColumns";
import type { LiveSchemaPort } from "./tools/types";

const TTL_MS = 60_000;
const caches = new Map<string, ReturnType<typeof createViewColumnsCache>>();
const cacheFor = (ttlMs: number, now: (() => number) | undefined) => {
  const key = `${ttlMs}`;
  let c = caches.get(key);
  if (!c) {
    c = createViewColumnsCache({ ttlMs, now });
    caches.set(key, c);
  }
  return c;
};

export function __clearLiveSchemaCacheForTest(): void {
  for (const c of caches.values()) c.clear();
  caches.clear();
}

export function createLiveSchema(opts: {
  username: string;
  principal: () => KineticaPrincipal;
  getTable?: (id: number) => Table | undefined;
  sql?: typeof kineticaSql;
  ttlMs?: number;
  now?: () => number;
}): LiveSchemaPort {
  const getTable = opts.getTable ?? dbGetTable;
  const sql = opts.sql ?? kineticaSql;
  const cache = cacheFor(opts.ttlMs ?? TTL_MS, opts.now);
  return {
    async describe(tableId) {
      let t: Table | undefined;
      let from: string;
      try {
        t = getTable(tableId);
        if (!t) return { ok: false };
        if (t.schema) assertIdentifier(t.schema, "schema");
        assertIdentifier(t.name, "name");
        from = t.schema ? `${t.schema}.${t.name}` : t.name;
      } catch {
        return { ok: false };
      }
      const key = `${opts.username.toLowerCase()}:${tableId}`;
      const build = (names: string[]) => ({
        ok: true as const,
        table: {
          id: tableId,
          schema: t!.schema,
          name: t!.name,
          ...(t!.description ? { description: t!.description } : {}),
          columns: names.map((name) => {
            const type = Object.prototype.hasOwnProperty.call(t!.columns, name) ? t!.columns[name] : undefined;
            return type !== undefined ? { name, type } : { name };
          }),
        },
      });
      const hit = cache.get(key);
      if (hit) return build(hit);
      try {
        const res = await sql(opts.principal(), buildViewColumnsProbeSql(from), { route: "AI describe_table", op: "DISCOVERY" });
        const names = parseProbeColumns(res);
        cache.set(key, names);
        return build(names);
      } catch (e) {
        if (e instanceof SessionEndedError) throw e;
        return { ok: false };
      }
    },
  };
}
