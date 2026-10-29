import type { AiKeepIdMap, AiKeepRequest } from "@kinetica-bi/shared";
import {
  db,
  getDashboardVersion,
  createDashboardDynamicView,
  createDashboardLayer,
  updateDashboardLayer,
  getDashboardLayer,
  deleteDashboardLayer,
  createWidget,
  getWidget,
  updateWidget,
  deleteWidget,
  deleteDashboardDynamicView,
  listWidgets,
  listDashboardLayers,
} from "../db";
import { UnmappedTempRefError, collectSignedWidgetConfigRefs, emptyRefIdMaps, remapTempFilterSelection, remapTempRefs } from "./dashboardExportRefs";

export class KeepConflict extends Error {
  constructor() {
    super("dashboard changed since the baseline");
    this.name = "KeepConflict";
  }
}
export class KeepInvalid extends Error {
  constructor(readonly reasons: string[]) {
    super(reasons[0] ?? "invalid change");
    this.name = "KeepInvalid";
  }
}
export type KeepPreparedInput = {
  dynamicViews: { tempId: number; name: string; sourceTableId: number; templateSql: string; maxRecords: number; columns: { name: string; type: string }[] }[];
  warnings: string[];
};
export type KeepApplied = { before: number; version: number; idMap: AiKeepIdMap; warnings: string[]; removedDynamicViewIds: number[] };

const assertNoTempIds = (config: Record<string, unknown>): Record<string, unknown> => {
  for (const v of Object.values(config)) {
    if (typeof v === "number" && v < 0) throw new KeepInvalid(["unmapped temporary id in layer config"]);
  }
  return config;
};

/**
 * Keep (141): persist a folded AI change set in ONE synchronous better-sqlite3 transaction.
 * No await, no Kinetica, no fetch: a throw anywhere rolls every row (dashboards.version too) back.
 */
export function applyKeep(dashboardId: number, change: AiKeepRequest, prepared: KeepPreparedInput): KeepApplied {
  const run = db.transaction((): KeepApplied => {
    const cur = getDashboardVersion(dashboardId);
    if (cur === undefined) throw new KeepInvalid(["dashboard not found"]);
    if (cur !== change.baselineVersion) throw new KeepConflict();
    // 142 D-05: the first Keep makes a generated dashboard ordinary. Same transaction: a rollback restores the flag.
    db.prepare("UPDATE dashboards SET generated_by = NULL, generated_pending_at = NULL WHERE id = ? AND generated_pending_at IS NOT NULL").run(dashboardId);

    const maps = emptyRefIdMaps();
    const mapDv = (x: number | null | undefined): number | null => {
      if (x === null || x === undefined) return null;
      if (x > 0) return x;
      const id = maps.dynamicView.get(x);
      if (id === undefined) throw new KeepInvalid([`unmapped temporary dynamic view id ${x}`]);
      return id;
    };
    const remap = (config: unknown): Record<string, unknown> => {
      try {
        return remapTempRefs(config, maps);
      } catch (e) {
        if (e instanceof UnmappedTempRefError) throw new KeepInvalid([e.message]);
        throw e;
      }
    };

    // Pass 1: placeholders in dependency order dv -> layer -> widget.
    for (const add of change.dynamicViews.add) {
      const p = prepared.dynamicViews.find((d) => d.tempId === add.tempId);
      if (!p) throw new KeepInvalid([`missing prepared dynamic view for temporary id ${add.tempId}`]);
      const dv = createDashboardDynamicView(dashboardId, {
        source_table_id: p.sourceTableId,
        name: p.name,
        template_sql: p.templateSql,
        max_records: p.maxRecords,
        columns_json: p.columns,
      });
      maps.dynamicView.set(add.tempId, dv.id);
    }
    for (const add of change.layers.add) {
      maps.layer.set(add.tempId, createDashboardLayer(dashboardId, { table_id: add.tableId, config: {} }).id);
    }
    for (const add of change.widgets.add) {
      maps.widget.set(add.tempId, createWidget(dashboardId, { title: add.title, type: add.type, position: 0, config: {} }).id);
    }

    // Pass 2: real configs.
    for (const add of change.layers.add) {
      updateDashboardLayer(maps.layer.get(add.tempId)!, {
        config: assertNoTempIds(add.config),
        info_enabled: 1, // clickable like a hand-made layer, matching the browser fold
        dynamic_view_id: mapDv(add.dynamicViewId ?? null),
      });
    }
    for (const add of change.widgets.add) {
      const next = remap({ ...add.config, layout: add.rect });
      updateWidget(maps.widget.get(add.tempId)!, { config: finishFilterSelection(next, maps.widget) });
    }

    // Edits merge into the CURRENT stored rows.
    for (const e of change.widgets.edit) {
      const stored = getWidget(e.id);
      if (!stored || stored.dashboard_id !== dashboardId) throw new KeepInvalid([`widget ${e.id} not found`]);
      const next: Record<string, unknown> = { ...stored.config, ...remap(e.configSet ?? {}) };
      for (const k of e.configUnset ?? []) delete next[k];
      if (e.rect) next.layout = e.rect;
      updateWidget(e.id, {
        config: finishFilterSelection(next, maps.widget),
        ...(e.title !== undefined ? { title: e.title } : {}),
        ...(e.type !== undefined ? { type: e.type } : {}),
      });
    }
    for (const e of change.layers.edit) {
      const stored = getDashboardLayer(e.id);
      if (!stored || stored.dashboard_id !== dashboardId) throw new KeepInvalid([`layer ${e.id} not found`]);
      const attrs: Parameters<typeof updateDashboardLayer>[1] = {};
      if (e.configSet) attrs.config = { ...stored.config, ...e.configSet };
      if (e.tableId !== undefined) attrs.table_id = e.tableId;
      if ("dynamicViewId" in e) attrs.dynamic_view_id = mapDv(e.dynamicViewId);
      if ("cb_config" in e) attrs.cb_config = e.cb_config;
      if ("track_config" in e) attrs.track_config = e.track_config;
      updateDashboardLayer(e.id, attrs);
    }

    // Removals last.
    for (const id of change.widgets.remove) deleteWidget(id);
    for (const id of change.layers.remove) deleteDashboardLayer(id);
    const removedDynamicViewIds: number[] = [];
    for (const id of change.dynamicViews.remove) {
      if (deleteDashboardDynamicView(id)) removedDynamicViewIds.push(id);
    }

    // Invariant: no temp id survives.
    for (const w of listWidgets(dashboardId)) {
      if (collectSignedWidgetConfigRefs(w.config).some((r) => r.id < 0)) throw new KeepInvalid(["unmapped temporary id"]);
    }
    for (const l of listDashboardLayers(dashboardId)) {
      if (l.dynamic_view_id !== null && l.dynamic_view_id < 0) throw new KeepInvalid(["unmapped temporary id"]);
    }
    if (
      maps.dynamicView.size !== change.dynamicViews.add.length ||
      maps.layer.size !== change.layers.add.length ||
      maps.widget.size !== change.widgets.add.length
    ) {
      throw new KeepInvalid(["created counts do not match the request"]);
    }

    const idMap: AiKeepIdMap = { widgets: {}, layers: {}, dynamicViews: {} };
    for (const [t, id] of maps.widget) idMap.widgets[String(t)] = id;
    for (const [t, id] of maps.layer) idMap.layers[String(t)] = id;
    for (const [t, id] of maps.dynamicView) idMap.dynamicViews[String(t)] = id;
    return { before: cur, version: getDashboardVersion(dashboardId)!, idMap, warnings: prepared.warnings, removedDynamicViewIds };
  });
  return run();
}

/** A config's own filterSelection (object or JSON string) gets temp widget ids remapped. */
function finishFilterSelection(config: Record<string, unknown>, widgetMap: Map<number, number>): Record<string, unknown> {
  if (config.filterSelection === undefined || config.filterSelection === null) return config;
  const fs = remapTempFilterSelection(config.filterSelection, widgetMap);
  return fs ? { ...config, filterSelection: fs } : config;
}
