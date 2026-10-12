// Phase 134: pure apply-time evaluation + fold of the session op-log. No stores, no toast, no
// runtime api/client imports. See types.ts for the op-log-vs-inverse design note.
import { translateWidgetOverlay } from "../widgetOverlayKeys";
import { parseAiOp, validateActionPatch, validateLayerSnapshot } from "@kinetica-bi/shared";
import type { AiOp } from "@kinetica-bi/shared";
import type { WidgetDto, DashboardLayerDto } from "../../api/client";
import { splitLayerSnapshot } from "../applyWidgetAction";
import { EMPTY_DERIVED } from "./constants";
import type { OpResult, SessionBaseline, SessionDerived, TurnEntry } from "./types";

type AddWidgetOp = Extract<AiOp, { op: "add_widget" }>;
type AddLayerOp = Extract<AiOp, { op: "add_layer" }>;

/** Phase 136 replaces the add_widget builder's config validation; this is a plain shell. */
export function makeSessionWidget(op: AddWidgetOp, dashboardId: number): WidgetDto {
  return {
    id: op.tempId,
    dashboard_id: dashboardId,
    title: op.title,
    type: op.type,
    position: 0,
    config: { ...op.config },
    created_at: "",
    updated_at: "",
  };
}

/**
 * Phase 136 replaces this builder when the add_layer payload is extended; table_id 0 is
 * auto-hidden by MapChartRenderer's source-validity check, so it never issues a WMS request.
 */
export function makeSessionLayer(op: AddLayerOp, baseline: SessionBaseline, position: number): DashboardLayerDto {
  return {
    id: op.tempId,
    dashboard_id: baseline.dashboardId,
    table_id: 0,
    layer_type: "KineticaWms",
    position,
    config: {},
    info_enabled: 0,
    info_columns: null,
    info_template: null,
    dynamic_view_id: null,
    cb_config: null,
    track_config: null,
    filter_scope: null,
    created_at: "",
    updated_at: "",
  };
}

const skip = (reason: Exclude<OpResult, { status: "applied" }>["reason"], detail?: string): OpResult =>
  detail === undefined ? { status: "skipped", reason } : { status: "skipped", reason, detail };

type Sim = {
  widgets: Map<number, string>; // id -> type (existing)
  layers: Set<number>;
  dvs: Set<number>;
  usedTemp: Set<number>;
};

function simApply(sim: Sim, op: AiOp): void {
  switch (op.op) {
    case "add_widget":
      sim.widgets.set(op.tempId, op.type);
      break;
    case "remove_widget":
      sim.widgets.delete(op.id);
      break;
    case "add_layer":
      sim.layers.add(op.tempId);
      break;
    case "remove_layer":
      sim.layers.delete(op.id);
      break;
    default:
      break;
  }
}

function noteTemp(sim: Sim, op: AiOp): void {
  if (op.op === "add_widget" || op.op === "add_layer" || op.op === "add_dynamic_view") sim.usedTemp.add(op.tempId);
}

function buildSim(baseline: SessionBaseline, prior: readonly TurnEntry[]): Sim {
  const sim: Sim = {
    widgets: new Map(baseline.widgets.map((x) => [x.id, x.type])),
    layers: new Set(baseline.layers.map((x) => x.id)),
    dvs: new Set(baseline.dynamicViewIds),
    usedTemp: new Set(),
  };
  for (const e of prior) {
    if (!e.op) continue;
    noteTemp(sim, e.op);
    if (e.result.status === "applied") simApply(sim, e.op);
  }
  return sim;
}

function evaluateOne(sim: Sim, rawOp: unknown): TurnEntry {
  const parsed = parseAiOp(rawOp);
  if (!parsed.ok) return { raw: rawOp, op: null, result: skip("invalid_op", parsed.errors.join("; ")) };
  const op = parsed.op;
  const done = (result: OpResult): TurnEntry => {
    noteTemp(sim, op);
    if (result.status === "applied") simApply(sim, op);
    return { raw: rawOp, op, result };
  };
  switch (op.op) {
    case "apply_filter":
    case "clear_filter":
    case "add_dynamic_view":
    case "remove_dynamic_view":
      return done(skip("unsupported_in_134"));
    case "add_widget":
      return done(sim.usedTemp.has(op.tempId) ? skip("duplicate_temp_id") : { status: "applied" });
    case "add_layer":
      if (sim.usedTemp.has(op.tempId)) return done(skip("duplicate_temp_id"));
      if (sim.widgets.get(op.widgetId) !== "map") return done(skip("target_not_found", `no map widget ${op.widgetId}`));
      return done({ status: "applied" });
    case "remove_widget":
      return done(sim.widgets.has(op.id) ? { status: "applied" } : skip("target_not_found"));
    case "remove_layer":
      return done(sim.layers.has(op.id) ? { status: "applied" } : skip("target_not_found"));
    case "patch": {
      const { target, configPatch } = op.action;
      const exists =
        target.kind === "widget" ? sim.widgets.has(target.id)
        : target.kind === "layer" ? sim.layers.has(target.id)
        : sim.dvs.has(target.id);
      if (!exists) return done(skip("target_not_found"));
      const v =
        target.kind === "layer"
          ? validateLayerSnapshot(configPatch)
          : validateActionPatch(target.kind, target.kind === "widget" ? sim.widgets.get(target.id) : undefined, configPatch);
      if (!v.valid) return done(skip("patch_rejected", v.reasons.join("; ")));
      return done({ status: "applied" });
    }
  }
}

/** Evaluate one turn's raw ops against baseline + prior entries. Never throws. */
export function evaluateTurn(
  baseline: SessionBaseline,
  prior: readonly TurnEntry[],
  rawOps: readonly unknown[],
): TurnEntry[] {
  const sim = buildSim(baseline, prior);
  return rawOps.map((r) => {
    try {
      return evaluateOne(sim, r);
    } catch (err) {
      return { raw: r, op: null, result: skip("invalid_op", String(err)) };
    }
  });
}

type Cfg = Record<string, unknown>;

function mergeLayerPatch(existing: Cfg | undefined, patch: Cfg): Cfg {
  const { config: patchConfig, topLevel } = splitLayerSnapshot(patch);
  const { config: existingConfig, ...existingTop } = (existing ?? {}) as { config?: Cfg } & Cfg;
  const merged: Cfg = { ...existingTop, ...topLevel };
  const cfg = patchConfig !== undefined ? { ...(existingConfig ?? {}), ...patchConfig } : existingConfig;
  if (cfg !== undefined && Object.keys(cfg).length > 0) merged.config = cfg;
  return merged;
}

/** Pure: fold applied entries into derived added/removed/patched state. */
export function foldSession(baseline: SessionBaseline, entries: Iterable<TurnEntry>): SessionDerived {
  const savedWidgets = new Map(baseline.widgets.map((x) => [x.id, x]));
  const addedWidgets = new Map<number, WidgetDto>();
  const addedLayers = new Map<number, DashboardLayerDto>();
  const removedWidgetIds = new Set<number>();
  const removedLayerIds = new Set<number>();
  const contribution = {
    widget: {} as Record<number, Cfg>,
    layer: {} as Record<number, Cfg>,
    dynamicView: {} as Record<number, Cfg>,
  };
  let applied = 0;

  for (const e of entries) {
    if (e.result.status !== "applied" || !e.op) continue;
    applied++;
    const op = e.op;
    switch (op.op) {
      case "add_widget":
        addedWidgets.set(op.tempId, makeSessionWidget(op, baseline.dashboardId));
        break;
      case "add_layer": {
        addedLayers.set(op.tempId, makeSessionLayer(op, baseline, baseline.layers.length + addedLayers.size));
        const hostTemp = addedWidgets.get(op.widgetId);
        if (hostTemp) {
          const inc = hostTemp.config.includedLayerIds;
          if (Array.isArray(inc) && inc.length > 0) {
            addedWidgets.set(op.widgetId, { ...hostTemp, config: { ...hostTemp.config, includedLayerIds: [...inc, op.tempId] } });
          }
        } else {
          const baseInc = savedWidgets.get(op.widgetId)?.config.includedLayerIds;
          if (Array.isArray(baseInc) && baseInc.length > 0) {
            const cur = contribution.widget[op.widgetId]?.includedLayerIds;
            const list = Array.isArray(cur) ? cur : baseInc;
            contribution.widget[op.widgetId] = { ...contribution.widget[op.widgetId], includedLayerIds: [...list, op.tempId] };
          }
        }
        break;
      }
      case "remove_widget":
        if (addedWidgets.has(op.id)) addedWidgets.delete(op.id);
        else {
          removedWidgetIds.add(op.id);
          delete contribution.widget[op.id];
        }
        break;
      case "remove_layer":
        if (addedLayers.has(op.id)) addedLayers.delete(op.id);
        else {
          removedLayerIds.add(op.id);
          delete contribution.layer[op.id];
        }
        break;
      case "patch": {
        const { target, configPatch } = op.action;
        if (target.kind === "widget") {
          const temp = addedWidgets.get(target.id);
          if (temp) addedWidgets.set(target.id, { ...temp, config: { ...temp.config, ...translateWidgetOverlay(temp.type, configPatch) } });
          else contribution.widget[target.id] = { ...contribution.widget[target.id], ...configPatch };
        } else if (target.kind === "layer") {
          const temp = addedLayers.get(target.id);
          if (temp) {
            const { config, topLevel } = splitLayerSnapshot(configPatch);
            addedLayers.set(target.id, {
              ...temp,
              ...(topLevel as Partial<DashboardLayerDto>),
              config: { ...temp.config, ...(config ?? {}) },
            });
          } else {
            contribution.layer[target.id] = mergeLayerPatch(contribution.layer[target.id], configPatch);
          }
        } else {
          contribution.dynamicView[target.id] = { ...contribution.dynamicView[target.id], ...configPatch };
        }
        break;
      }
      default:
        break;
    }
  }

  if (applied === 0) return EMPTY_DERIVED;
  return {
    addedWidgets: [...addedWidgets.values()],
    removedWidgetIds,
    addedLayers: [...addedLayers.values()],
    removedLayerIds,
    contribution,
    appliedOpCount: applied,
  };
}
