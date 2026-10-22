import {
  db,
  createDashboard,
  createTable,
  addDashboardTable,
  createWidget,
  createDashboardLayer,
  createDashboardDynamicView,
  getDashboardVersion,
} from "../../src/db";
import type { KeepPreparedInput } from "../../src/lib/aiKeepApply";
import type { AiKeepRequest } from "@kinetica-bi/shared";

/** Shared Keep fixture (Phase 141-06): used by lib.aiKeepApply.spec.ts and lib.aiKeepApply.atomic.spec.ts. */
export const resetKeepDb = () => {
  db.exec(`
    DELETE FROM dashboard_access_grants; DELETE FROM column_display_config; DELETE FROM dashboard_table_views;
    DELETE FROM dashboard_layers; DELETE FROM dashboard_dynamic_views; DELETE FROM widgets;
    DELETE FROM dashboard_tables; DELETE FROM custom_metrics; DELETE FROM dashboards; DELETE FROM tables; DELETE FROM sessions;
  `);
};

export type Fx = { D: number; T: number; W1: number; W2: number; W3: number; L1: number; V70: number; change: AiKeepRequest; prepared: KeepPreparedInput };

export const buildKeepFixture = (): Fx => {
  resetKeepDb();
  const T = createTable({ schema: "kbi_keep", name: "t_keep", columns: { c1: "int" } }).id;
  const D = createDashboard("Keep Fixture").id;
  addDashboardTable(D, T);
  const V70 = createDashboardDynamicView(D, { source_table_id: T, name: "Old view", template_sql: "SELECT * FROM {view}", max_records: 10, columns_json: [{ name: "c1", type: "int" }] }).id;
  const L1 = createDashboardLayer(D, { table_id: T, config: { renderMode: "points", POINTSIZE: 3 } }).id;
  const W1 = createWidget(D, { title: "Bar one", type: "bar", position: 0, config: { tableId: T, sql: "SELECT 1", dynamicViewId: V70, layout: { x: 0, y: 0, w: 6, h: 8 } } }).id;
  const W2 = createWidget(D, { title: "Map two", type: "map", position: 1, config: { includedLayerIds: [L1] } }).id;
  const W3 = createWidget(D, { title: "Records", type: "records", position: 2, config: { tableId: T } }).id;
  const rect = (y: number) => ({ x: 0, y, w: 12, h: 10 });
  const change: AiKeepRequest = {
    baselineVersion: getDashboardVersion(D)!,
    dynamicViews: { add: [{ tempId: -3, name: "AI view", spec: {} as never }], remove: [V70] },
    layers: {
      add: [{ tempId: -2, tableId: T, config: { renderMode: "heatmap", visible: false }, dynamicViewId: -3 }],
      edit: [{ id: L1, configSet: { POINTOPACITY: 40 }, dynamicViewId: null }],
      remove: [],
    },
    widgets: {
      add: [
        { tempId: -1, type: "map", title: "AI map", config: { includedLayerIds: [-2] }, rect: rect(20) },
        { tempId: -4, type: "bar", title: "AI bar", config: { dynamicViewId: -3, tableId: T }, rect: rect(30) },
        { tempId: -5, type: "legend", title: "AI legend", config: { sourceMapWidgetId: -1, filterSelection: { sourceMode: "allow", allowedSourceWidgetIds: [-4] } }, rect: rect(40) },
      ],
      edit: [
        { id: W1, configSet: { title_x: "y" }, configUnset: ["dynamicViewId"], rect: { x: 6, y: 0, w: 6, h: 8 }, title: "Renamed", type: "line" },
        { id: W2, configSet: { includedLayerIds: [L1, -2] } },
      ],
      remove: [W3],
    },
  };
  const prepared: KeepPreparedInput = {
    dynamicViews: [{ tempId: -3, name: "AI view", sourceTableId: T, templateSql: "SELECT n FROM {view}", maxRecords: 100000, columns: [{ name: "n", type: "long" }] }],
    warnings: ["w1"],
  };
  return { D, T, W1, W2, W3, L1, V70, change, prepared };
};

