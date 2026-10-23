// Phase 142 UAT: every map the AI adds opens on its data, not the world view.
// After the model is done, each AI-added map (no defaultView yet) whose FIRST AI heatmap layer in the same answer
// is a lat/lon layer on a dashboard table gets config.defaultView from one robust extent query (2nd..98th
// percentile, junk coordinates excluded), run AS THE USER, tagged and cancellable, with a short timeout.
// Best effort: any failure leaves the map on the world view and never fails the answer. The values are never
// sent to the provider, written to the AI audit, or logged (kineticaSql's audit line carries no SQL or values).
import { isAiNumericColumnType, mapViewForBounds, type AiOp, type LonLatBounds } from "@kinetica-bi/shared";
import type { KineticaPrincipal } from "../../kinetica";
import { kineticaSql } from "../../kinetica";
import { cancelKineticaJobsByTag } from "../kineticaJobs";
import { assertIdentifier } from "../columnGuard";
import type { LiveSchemaPort } from "./tools/types";

export const MAP_EXTENT_TIMEOUT_MS = 5000;

export type MapExtentDeps = {
  requestId: string;
  principal: () => KineticaPrincipal;
  liveSchema: LiveSchemaPort;
  dashboardTableIds: () => number[];
  signal: AbortSignal;
  timeoutMs?: number;
  sql?: typeof kineticaSql;
  cancel?: typeof cancelKineticaJobsByTag;
};

type AddWidget = Extract<AiOp, { op: "add_widget" }>;
type AddLayer = Extract<AiOp, { op: "add_layer" }>;

/** Identifiers must already be vetted (assertIdentifier + present in the user's live probe). */
export function buildMapExtentSql(a: { ref: string; lon: string; lat: string }): string {
  const x = `"${a.lon}"`;
  const y = `"${a.lat}"`;
  return (
    `SELECT APPROX_PERCENTILE(${x}, 2), APPROX_PERCENTILE(${x}, 98), APPROX_PERCENTILE(${y}, 2), APPROX_PERCENTILE(${y}, 98) ` +
    `FROM ${a.ref} WHERE ${x} BETWEEN -180 AND 180 AND ${y} BETWEEN -85 AND 85 AND NOT (${x} = 0 AND ${y} = 0)`
  );
}

export function parseMapExtent(enc: unknown): LonLatBounds | null {
  const o = (enc && typeof enc === "object" ? enc : {}) as Record<string, unknown>;
  const v = [1, 2, 3, 4].map((i) => {
    const c = o[`column_${i}`];
    const x = Array.isArray(c) ? c[0] : undefined;
    return typeof x === "number" && Number.isFinite(x) ? x : null;
  });
  if (v.some((x) => x === null)) return null;
  const [minLon, maxLon, minLat, maxLat] = v as number[];
  return { minLon, maxLon, minLat, maxLat };
}

async function extentFor(layer: AddLayer, deps: MapExtentDeps, n: number): Promise<LonLatBounds | null> {
  if (layer.spatialMode !== "latlon" || layer.dynamicViewId !== undefined) return null;
  const lat = layer.latColumn;
  const lon = layer.lonColumn;
  if (!lat || !lon) return null;
  if (!deps.dashboardTableIds().includes(layer.tableId)) return null;
  const d = await deps.liveSchema.describe(layer.tableId);
  if (!d.ok) return null;
  const { schema, name, columns } = d.table;
  const latCol = columns.find((c) => c.name === lat);
  const lonCol = columns.find((c) => c.name === lon);
  if (!latCol || !lonCol) return null;
  if (isAiNumericColumnType(latCol.type) === false || isAiNumericColumnType(lonCol.type) === false) return null;
  if (schema) assertIdentifier(schema, "schema");
  assertIdentifier(name, "name");
  assertIdentifier(lat, "column");
  assertIdentifier(lon, "column");
  const stmt = buildMapExtentSql({ ref: schema ? `${schema}.${name}` : name, lon, lat });

  const sqlFn = deps.sql ?? kineticaSql;
  const cancelFn = deps.cancel ?? cancelKineticaJobsByTag;
  const tag = `${deps.requestId}-mv${n}`;
  const timeout = new AbortController();
  const t = setTimeout(() => timeout.abort(), deps.timeoutMs ?? MAP_EXTENT_TIMEOUT_MS);
  t.unref?.();
  const combined = AbortSignal.any([deps.signal, timeout.signal]);
  let used: KineticaPrincipal | undefined;
  try {
    const enc = await sqlFn((used = deps.principal()), stmt, { route: "AI map extent", op: "SQL", signal: combined, tag, extra: { limit: 2 } });
    return parseMapExtent(enc);
  } catch {
    if (combined.aborted) {
      try { await cancelFn(used ?? deps.principal(), tag); } catch { /* best effort */ }
    }
    return null;
  } finally {
    clearTimeout(t);
  }
}

/** Returns new ops with config.defaultView stamped on qualifying AI-added maps. Never throws; never mutates input. */
export async function stampMapDefaultViews(ops: readonly AiOp[], deps: MapExtentDeps): Promise<AiOp[]> {
  const out = [...ops];
  let n = 0;
  for (let i = 0; i < out.length; i++) {
    const o = out[i];
    if (o.op !== "add_widget" || o.type !== "map" || o.config.defaultView !== undefined) continue;
    if (deps.signal.aborted) break;
    const layer = ops.find((l): l is AddLayer => l.op === "add_layer" && l.widgetId === o.tempId);
    if (!layer) continue;
    let bounds: LonLatBounds | null = null;
    try {
      bounds = await extentFor(layer, deps, ++n);
    } catch {
      bounds = null;
    }
    const view = bounds ? mapViewForBounds(bounds) : null;
    if (view) out[i] = { ...o, config: { ...o.config, defaultView: view } } satisfies AddWidget;
  }
  return out;
}
