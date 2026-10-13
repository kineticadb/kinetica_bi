// Phase 135 (AISAFE-V20-02/03): the ONE validation gateway every AI change passes, in a fixed order:
// shape -> allow_list -> permission -> reference -> live_schema, stopping at the first failure.
// Reasons are built from fixed text, paths, ids and column NAMES only - never rejected argument values or upstream error text.
import {
  AI_BLOCKED_CONFIG_KEYS,
  AI_WIDGET_TYPES,
  PERMANENTLY_BLOCKED_KEYS,
  parseAiOp,
  validateActionPatch,
  validateLayerSnapshot,
  type AiOp,
} from "@kinetica-bi/shared";
import type { GatewayResult, GatewayStage, LiveSchemaPort, MutateTool } from "./tools/types";
import { applyOpToShadow, describeOp, type ShadowState } from "./shadow";

// Literal on purpose (see PERMISSIONS.AI_USE in lib/permissions.ts; kept local to avoid a catalog import cycle in specs).
const AI_USE = "ai:use";

/** Config keys the bar/line/pie/table/bignumber/records renderers read as COLUMN NAMES
 *  (packages/web/src/components/charts/WidgetRenderer.tsx:1057-1068 metricColumn/groupByColumn/groupByColumns;
 *   :1383-1384, :1693-1694, :1850-1851, :1968-1977 same keys). `metric`/`dimension` are snapshot-binding names only; no renderer reads them from config. */
export const AI_COLUMN_BINDING_KEYS: readonly string[] = ["metricColumn", "groupByColumn", "groupByColumns"];

export type GatewayDeps = {
  username: string;
  dashboardId: number;
  shadow: ShadowState;
  liveSchema: LiveSchemaPort;
  getPermissions: (u: string) => ReadonlySet<string>;
  canViewDashboard: (u: string, dashboardId: number) => boolean;
  /** Tables associated with the dashboard (D-22). */
  dashboardTableIds: () => readonly number[];
  /** D-06: UX approval for removing saved content. */
  approvals?: { removeSaved?: boolean };
};

const fail = (stage: GatewayStage, reasons: string[]): GatewayResult => ({ ok: false, stage, reasons });
const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function lev(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}
function nearest(name: string, cols: string[]): string[] {
  const n = name.toLowerCase();
  const sharedPrefix = (c: string) => {
    let k = 0;
    while (k < n.length && k < c.length && n[k] === c[k]) k++;
    return k;
  };
  return cols
    .filter((c) => lev(n, c.toLowerCase()) <= 2 || sharedPrefix(c.toLowerCase()) >= 3)
    .slice(0, 3);
}

function columnsIn(rec: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const k of AI_COLUMN_BINDING_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(rec, k)) continue;
    const v = rec[k];
    if (typeof v === "string" && v) out.push(v);
    else if (Array.isArray(v)) for (const x of v) if (typeof x === "string" && x) out.push(x);
  }
  return out;
}

export async function checkAiOp(deps: GatewayDeps, tool: MutateTool, argsRaw: string): Promise<GatewayResult> {
  // a. shape
  let json: unknown;
  try {
    json = JSON.parse(argsRaw);
  } catch {
    return fail("shape", ["arguments are not valid JSON"]);
  }
  const parsed = tool.args.safeParse(json);
  if (!parsed.success) {
    return fail("shape", parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`));
  }
  const p = parseAiOp(tool.toOp(parsed.data));
  if (!p.ok) return fail("shape", p.errors);
  const op: AiOp = p.op;

  // b. allow_list
  const shadow = deps.shadow;
  if (op.op === "add_widget") {
    const reasons: string[] = [];
    if (!(AI_WIDGET_TYPES as readonly string[]).includes(op.type)) reasons.push(`widget type "${op.type}" is not supported`);
    const blocked = new Set<string>([...AI_BLOCKED_CONFIG_KEYS, ...PERMANENTLY_BLOCKED_KEYS, "dynamicViewId", "dynamic_view_id"]);
    // tableId is the data binding of a NEW widget (checked at the live_schema stage), not an identity mutation.
    blocked.delete("tableId");
    for (const k of Object.keys(op.config)) if (blocked.has(k)) reasons.push(`config key "${k}" is not allowed`);
    if (reasons.length) return fail("allow_list", reasons);
  } else if (op.op === "patch") {
    const { kind, id } = op.action.target;
    const patchRec = op.action.configPatch;
    let res: { valid: true } | { valid: false; reasons: string[] } | undefined;
    if (kind === "widget") {
      const w = shadow.widgets.get(id);
      if (w) res = validateActionPatch("widget", w.type, patchRec);
    } else if (kind === "layer") {
      if (shadow.layers.has(id)) res = validateLayerSnapshot(patchRec);
    } else if (kind === "dynamicView") {
      if (shadow.dynamicViews.has(id)) res = validateActionPatch("dynamicView", undefined, patchRec);
    }
    if (res && !res.valid) return fail("allow_list", res.reasons);
  }

  // c. permission - re-read for EVERY op (no caching) so a mid-answer revocation rejects the next op.
  // D-16: NO edit-right checks here; session-only changes are allowed for any ai:use user. Edit rights are enforced at Keep (Phase 141).
  if (!deps.getPermissions(deps.username).has(AI_USE)) return fail("permission", ["the AI assistant is not enabled for this user"]);
  if (!deps.canViewDashboard(deps.username, deps.dashboardId)) return fail("permission", ["this dashboard is not available"]);

  // d. reference
  if (op.op === "patch") {
    const { kind, id } = op.action.target;
    const exists = kind === "widget" ? shadow.widgets.has(id) : kind === "layer" ? shadow.layers.has(id) : kind === "dynamicView" ? shadow.dynamicViews.has(id) : true;
    if (!exists) return fail("reference", [`${kind} ${id} does not exist`]);
  } else if (op.op === "remove_widget") {
    if (!shadow.widgets.has(op.id)) return fail("reference", [`widget ${op.id} does not exist`]);
  } else if (op.op === "remove_layer") {
    if (!shadow.layers.has(op.id)) return fail("reference", [`layer ${op.id} does not exist`]);
  } else if (op.op === "remove_dynamic_view") {
    if (!shadow.dynamicViews.has(op.id)) return fail("reference", [`dynamic view ${op.id} does not exist`]);
  } else if (op.op === "add_widget" || op.op === "add_layer" || op.op === "add_dynamic_view") {
    if (shadow.usedTempIds.has(op.tempId)) return fail("reference", [`temp id ${op.tempId} is already in use`]);
  }

  // e. live_schema
  let tableId: number | undefined;
  let cols: string[] = [];
  let needProbe = false;
  if (op.op === "add_widget") {
    const t = (op.config as Record<string, unknown>).tableId;
    tableId = typeof t === "number" ? t : undefined;
    cols = columnsIn(op.config);
    needProbe = true;
  } else if (op.op === "patch" && op.action.target.kind === "widget") {
    cols = columnsIn(op.action.configPatch);
    tableId = shadow.widgets.get(op.action.target.id)?.tableId;
    needProbe = cols.length > 0;
  }
  if (needProbe) {
    if (tableId === undefined) return fail("live_schema", ["table is not available"]);
    const d = await deps.liveSchema.describe(tableId);
    if (!d.ok) return fail("live_schema", [`table ${tableId} is not available`]);
    const names = d.table.columns.map((c) => c.name);
    const reasons: string[] = [];
    for (const c of cols) {
      if (names.includes(c)) continue;
      const near = nearest(c, names);
      reasons.push(
        `column \`${c}\` not found on table ${d.table.schema ? `${d.table.schema}.` : ""}${d.table.name}` +
          (near.length ? `; did you mean ${near.map((n) => `\`${n}\``).join(", ")}?` : ""),
      );
    }
    if (reasons.length) return fail("live_schema", reasons);
  }

  // f. ok
  const label = describeOp(op, shadow);
  applyOpToShadow(shadow, op);
  return { ok: true, op, label };
}
