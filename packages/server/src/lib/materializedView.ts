/**
 * Shared helper: `CREATE OR REPLACE MATERIALIZED VIEW` with the Kinetica
 * race-recovery retry locked in v1.5 Phase 30 (32-CONTEXT.md § D5).
 *
 * Kinetica's CREATE OR REPLACE internally looks up the existing view, drops
 * it, then creates anew — and fails with "Could not find the table"
 * (TM/SMc:1078) when a concurrent DELETE (or another widget's materialize)
 * dropped the view between the lookup and Kinetica's internal drop step.
 *
 * Happy path: single CREATE OR REPLACE statement. On the specific race
 * error we retry with explicit DROP IF EXISTS + plain CREATE — DROP IF
 * EXISTS is silent when the view does not exist, so the retry is always
 * safe.
 *
 * Used by:
 *   - POST /api/filter/materialize (extracted from index.ts in Phase 32 Plan 01)
 *   - POST /api/dynamic-view/materialize (added in Phase 32 Plan 03)
 */
import { kineticaSql, type KineticaOp } from "../kinetica";
import type { AuthedRequest } from "../auth";

export type CreateOrReplaceMaterializedArgs = {
  req: AuthedRequest;
  view: string;       // bare unqualified Kinetica view name
  sqlBody: string;    // the SELECT clause WITHOUT outer parens — helper wraps it
  ttl: number;        // minutes; emitted as USING TABLE PROPERTIES (TTL = <n>)
  route: string;      // for audit log entries — e.g. "POST /api/filter/materialize"
  op: KineticaOp;     // audit op tag — e.g. "MATERIALIZE"
};

export async function createOrReplaceMaterialized(
  args: CreateOrReplaceMaterializedArgs,
): Promise<void> {
  const { req, view, sqlBody, ttl, route, op } = args;
  const replaceDdl = `CREATE OR REPLACE MATERIALIZED VIEW ${view} AS (${sqlBody}) USING TABLE PROPERTIES (TTL = ${ttl})`;
  try {
    await kineticaSql(req, replaceDdl, { route, op });
    return;
  } catch (err) {
    const msg = (err as Error)?.message ?? "";
    const isReplaceRace =
      msg.includes("TM/SMc:1078") || /Could not find the table/i.test(msg);
    if (!isReplaceRace) throw err;
    // Race recovery: drop-if-exists + plain create. Both calls go through the
    // same audit / error-translation pipeline; if either fails the original
    // request still produces a 5xx with a meaningful body.
    await kineticaSql(req, `DROP TABLE IF EXISTS ${view}`, { route, op });
    await kineticaSql(
      req,
      `CREATE MATERIALIZED VIEW ${view} AS (${sqlBody}) USING TABLE PROPERTIES (TTL = ${ttl})`,
      { route, op },
    );
  }
}
