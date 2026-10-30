// DEV ONLY. Loaded through an `import.meta.env.DEV`-gated dynamic import in DashboardsPage, so
// the branch (and this module) is eliminated from production bundles. Lets the operator drive
// scripted AI turns from the browser console. Phase 137's AI widget replaces it as the real driver.
import { runSql, listAiDynamicViews, type WidgetDto } from "../../api/client";
import {
  resolveHeatmapHost,
  layersOfMap,
  AI_PALETTE_NAMES,
  AI_HEATMAP_RAMPS,
  coerceAiFilterItem,
  checkAiFilterItem,
  aiFilterSourceKey,
  aiDvIsAggregated,
} from "@kinetica-bi/shared";
import type { AiClarification, AiFilterItem, AiDvSpec, AskQueryEntry } from "@kinetica-bi/shared";
import { useDynamicViewStore } from "../../store/dynamicViewStore";
import { useFilterStore, type ActiveFilter } from "../../store/filterStore";
import type { TurnInput, TurnEntry } from "./types";
import { useAiSessionStore, hasUnsavedAiChanges } from "../../store/aiSessionStore";
import { useDashboardLayersStore } from "../../store/dashboardLayersStore";
import { applySessionToLayers, applySessionToWidgets } from "./applySession";

type Actions = {
  applyTurn(input: TurnInput): { turnId: string; entries: TurnEntry[] };
  setCursor(i: number): void;
  discard(): void;
};

type Result = { turnId: string; entries: TurnEntry[] };
type Rect = { id: number; x: number; y: number; w: number; h: number };
type HeatmapSpec = {
  tableId: number;
  spatialMode: "latlon" | "wkt" | "wkb";
  latColumn?: string;
  lonColumn?: string;
  wktColumn?: string;
  wkbColumn?: string;
  name?: string;
  style?: Record<string, unknown>;
};

type ChatTurnOpts = {
  ops?: unknown[];
  status?: "ok" | "error" | "cancelled";
  followUps?: string[];
  clarifications?: AiClarification[];
  skipped?: { label: string; stage: string; reasons: string[] }[];
  pickedChoice?: { clarificationIndex: number; optionId: string };
  message?: string;
  retryable?: boolean;
  applied?: string[];
  queries?: AskQueryEntry[];
};

type Harness = {
  approveRemoval(): void;
  addChart(type: string, title: string, tableId?: number, fields?: Record<string, unknown>): Result;
  editChart(id: number, fields: Record<string, unknown>): Result;
  changeType(id: number, type: string): Result;
  renameWidget(id: number, title: string): Result;
  setLayout(items: Rect[]): Result;
  addHeatmap(spec: HeatmapSpec, mapId?: number): Result | null;
  editHeatmap(layerId: number, style: Record<string, unknown>): Result;
  setLayerVisible(layerId: number, visible: boolean): Result | void;
  removeLayer(layerId: number): Result;
  turn(ops: unknown[], prompt?: string): { turnId: string; entries: TurnEntry[] };
  addWidget(type?: string, title?: string, config?: Record<string, unknown>): { turnId: string; entries: TurnEntry[] };
  removeWidget(id: number): { turnId: string; entries: TurnEntry[] };
  patchWidget(id: number, configPatch: Record<string, unknown>): { turnId: string; entries: TurnEntry[] };
  chatTurn(prompt: string, answer: string, opts?: ChatTurnOpts): Result;
  fakeRun(line?: string, ms?: number): void;
  revert(index: number): void;
  forward(index: number): void;
  discard(): void;
  state(): unknown;
  filter(kind: "table" | "dynamicView", id: number, column: string, operator?: "eq" | "in" | "between" | "isNull", value?: unknown): Result | null;
  clearFilter(kind?: "table" | "dynamicView", id?: number, column?: string): Result;
  highlight(ids: number[]): void;
  filterState(): unknown;
  // 139 (D-26): AI dynamic views, driven without any provider request.
  addDynamicView(name: string, spec: AiDvSpec, tempId?: number): Result;
  bindWidget(widgetId: number, dvId: number): Result;
  bindLayer(layerId: number, dvId: number): Result;
  addChartOnView(type: string, title: string, dvId: number, fields?: Record<string, unknown>): Result;
  removeDynamicView(id: number): Result;
  aiViews(): void;
  listAiViews(): Promise<void>;
  peekAiView(tempId: number): Promise<void>;
  help(): void;
};

declare global {
  interface Window {
    __kbiAiHarness?: Harness;
  }
}

export function installAiDevHarness(
  actions: Actions,
  getSavedWidgets: () => readonly WidgetDto[],
  getTables: () => readonly { id: number; columns: Record<string, string> }[] = () => [],
): () => void {
  // GAP-134-02: tell the operator where the session is after every move. Turn indices include
  // patch-only turns (invisible), so print the cursor, turn count, turn list and visible AI widgets.
  const reportPosition = (action: string): void => {
    const st = useAiSessionStore.getState();
    console.table([
      {
        action,
        cursor: st.cursor,
        turnCount: st.turns.length,
        visibleAiWidgets: st.derived.addedWidgets.map((w) => `${w.id}:${w.title}`).join(", ") || "(none)",
        ...(st.droppedCount > 0 ? { droppedCount: st.droppedCount } : {}),
      },
    ]);
    console.table([
      { index: -1, prompt: "saved dashboard", ops: "", current: st.cursor === -1 ? "<- current" : "" },
      ...st.turns.map((t, index) => ({
        index,
        prompt: t.prompt,
        ops: t.entries
          .filter((e) => e.result.status === "applied")
          .map((e) => (e.op as { op?: string } | null)?.op ?? "?")
          .join(", "),
        current: index === st.cursor ? "<- current" : "",
      })),
    ]);
  };
  const run = (ops: unknown[], prompt = "harness turn") => {
    const res = actions.applyTurn({ prompt, ops });
    console.table(res.entries.map((e) => ({ op: (e.op as { op?: string } | null)?.op ?? "?", ...e.result })));
    if (res.entries.some((e) => e.result.status === "skipped" && e.result.reason === "needs_confirmation")) {
      console.log(
        "Removing saved content needs confirmation: run __kbiAiHarness.approveRemoval() then repeat (Phase 137 shows Yes/No buttons).",
      );
    }
    reportPosition("turn");
    return res;
  };
  const nextId = () => useAiSessionStore.getState().allocateTempId();
  const patchOp = (kind: "widget" | "layer", id: number, configPatch: Record<string, unknown>) => ({
    op: "patch",
    action: { target: { kind, id }, configPatch },
  });
  // Same host rule as the gateway (D-11/D-12), over saved + session maps and layers.
  const resolveHost = (tableId: number): number | null => {
    const d = useAiSessionStore.getState().derived;
    const widgets = applySessionToWidgets([...getSavedWidgets()], d);
    const layers = applySessionToLayers(useDashboardLayersStore.getState().layers, d);
    const maps = widgets.filter((w) => w.type === "map");
    const hostLayers = maps.flatMap((m) =>
      layersOfMap(m, layers).map((l) => ({ id: l.id, widgetId: m.id, tableId: l.table_id })),
    );
    const host = resolveHeatmapHost({ maps: maps.map((m) => ({ id: m.id, title: m.title })), layers: hostLayers, tableId });
    if (host.kind === "use") return host.widgetId;
    if (host.kind === "add_map") console.warn("No map on this dashboard: add a map widget first, e.g. addChart('map', 'Trips map').");
    else console.warn("More than one candidate map; pass mapId as the second argument:", host.options);
    return null;
  };
  const harness: Harness = {
    approveRemoval: () => {
      useAiSessionStore.getState().approveRemoval();
      console.log("Removal of saved content approved for this session; repeat the removal call.");
    },
    addChart: (type, title, tableId, fields = {}) =>
      run([
        {
          op: "add_widget",
          tempId: nextId(),
          type,
          title,
          config: { ...fields, ...(tableId !== undefined ? { tableId } : {}) },
        },
      ]),
    editChart: (id, fields) => run([patchOp("widget", id, fields)]),
    changeType: (id, type) => run([{ op: "change_widget_type", id, type }]),
    renameWidget: (id, title) => run([{ op: "set_widget_title", id, title }]),
    setLayout: (items) => run([{ op: "set_layout", items }]),
    addHeatmap: (spec, mapId) => {
      const widgetId = mapId ?? resolveHost(spec.tableId);
      if (widgetId === null) return null;
      return run([{ op: "add_layer", tempId: nextId(), widgetId, renderMode: "heatmap", ...spec }]);
    },
    editHeatmap: (layerId, style) => run([patchOp("layer", layerId, style)]),
    setLayerVisible: (layerId, visible) => {
      if (layerId < 0) {
        useAiSessionStore.getState().setTempLayerVisible(layerId, visible);
        reportPosition(`setLayerVisible(${layerId}, ${visible})`);
        return;
      }
      return run([patchOp("layer", layerId, { visible })]);
    },
    removeLayer: (layerId) => run([{ op: "remove_layer", id: layerId }]),
    turn: run,
    addWidget: (type = "records", title = "AI widget", config = {}) =>
      run([{ op: "add_widget", tempId: useAiSessionStore.getState().allocateTempId(), type, title, config }]),
    removeWidget: (id) => run([{ op: "remove_widget", id }]),
    patchWidget: (id, configPatch) => run([{ op: "patch", action: { target: { kind: "widget", id }, configPatch } }]),
    // 137-10: render chat states without any provider request.
    chatTurn: (prompt, answer, opts = {}) => {
      const res = actions.applyTurn({
        prompt,
        answer,
        ops: opts.ops ?? [],
        chat: {
          status: opts.status ?? "ok",
          followUps: opts.followUps,
          clarifications: opts.clarifications,
          skipped: opts.skipped,
          pickedChoice: opts.pickedChoice,
          message: opts.message,
          retryable: opts.retryable,
          ...(opts.queries ? { queries: opts.queries } : {}),
          ...(opts.applied ? { applied: opts.applied } : {}),
        },
      });
      reportPosition("chatTurn");
      return res;
    },
    fakeRun: (line = "Thinking…", ms = 15000) => {
      const st = useAiSessionStore.getState();
      st.startRun("(harness) fake question");
      st.updateRun(line);
      setTimeout(() => useAiSessionStore.getState().endRun(), ms);
    },
    // -1 = the saved dashboard; N = state after turn N
    revert: (index) => {
      actions.setCursor(index);
      reportPosition(`revert(${index})`);
    },
    forward: (index) => {
      actions.setCursor(index);
      reportPosition(`forward(${index})`);
    },
    discard: () => actions.discard(),
    state: () => {
      const s = useAiSessionStore.getState();
      return {
        turns: s.turns.map((t) => ({ id: t.id, prompt: t.prompt, results: t.entries.map((e) => e.result) })),
        cursor: s.cursor,
        droppedCount: s.droppedCount,
        hasUnsavedAiChanges: hasUnsavedAiChanges(),
        geometry: s.geometry,
        removalApproved: s.removalApproved,
        aiEditedWidgetIds: [...s.derived.aiEditedWidgetIds],
        layout: s.derived.layout,
      };
    },
    // 138: filters go through actions.applyTurn (the real apply path: deltas, outline, notes, zero-row check).
    filter: (kind, id, column, operator, value) => {
      const op = operator ?? "eq";
      const item = { column, operator: op, ...(op === "isNull" ? {} : { value }) } as AiFilterItem;
      let coerced: AiFilterItem | null = null;
      let reason = "";
      if (kind === "table") {
        const r = coerceAiFilterItem(item, getTables().find((t) => t.id === id)?.columns[column]);
        if (r.ok) coerced = r.item;
        else reason = r.reason;
      } else {
        // No column types for dynamic views: numbers stay numbers, strings stay strings.
        const isNum = (v: unknown) => typeof v === "number";
        const numeric = isNum(item.value) || (Array.isArray(item.value) && item.value.length > 0 && item.value.every(isNum));
        if (numeric) {
          const errs = checkAiFilterItem(item);
          if (errs.length === 0) coerced = { ...item, dataType: "number" };
          else reason = errs[0];
        } else {
          const r = coerceAiFilterItem(item, undefined);
          if (r.ok) coerced = r.item;
          else reason = r.reason;
        }
      }
      if (!coerced) {
        console.warn(`filter refused: ${reason}`);
        return null;
      }
      return run([{ op: "apply_filter", source: { kind, id }, filters: [coerced] }], `filter ${column}`);
    },
    clearFilter: (kind, id, column) =>
      run(
        [
          {
            op: "clear_filter",
            ...(kind !== undefined && id !== undefined ? { source: { kind, id } } : {}),
            ...(column ? { column } : {}),
          },
        ],
        "clear filters",
      ),
    highlight: (ids) => useAiSessionStore.getState().setHighlight(ids),
    filterState: () => {
      const fs = useFilterStore.getState();
      const st = useAiSessionStore.getState();
      const view = (list: ActiveFilter[]) =>
        list.map((f) => ({
          column: f.column,
          operator: f.operator ?? (f.dataType === "null" ? "isNull" : "eq"),
          value: f.value,
          aiApplied: !!f.aiApplied,
        }));
      const filters: Record<string, ReturnType<typeof view>> = {};
      for (const [id, list] of Object.entries(fs.filters)) {
        if (list.length > 0) filters[aiFilterSourceKey({ kind: "table", id: Number(id) })] = view(list);
      }
      for (const [id, list] of Object.entries(fs.dvFilters)) {
        if (list.length > 0) filters[aiFilterSourceKey({ kind: "dynamicView", id: Number(id) })] = view(list);
      }
      return {
        filters,
        cursor: st.cursor,
        hasUnsavedAiChanges: hasUnsavedAiChanges(),
        turnsWithFilterDeltas: st.turns.filter((t) => t.entries.some((e) => (e.filterDeltas?.length ?? 0) > 0)).length,
      };
    },
    // 139: every command only appends ops through run() -> actions.applyTurn; the materialize chain does the rest.
    addDynamicView: (name, spec, tempId) =>
      run(
        [{ op: "add_dynamic_view", tempId: tempId ?? nextId(), name, spec, aggregated: aiDvIsAggregated(spec) }],
        `add view ${name}`,
      ),
    bindWidget: (widgetId, dvId) => run([patchOp("widget", widgetId, { dynamicViewId: dvId })], `bind widget ${widgetId}`),
    bindLayer: (layerId, dvId) => run([patchOp("layer", layerId, { dynamicViewId: dvId })], `bind layer ${layerId}`),
    addChartOnView: (type, title, dvId, fields = {}) =>
      run([{ op: "add_widget", tempId: nextId(), type, title, config: { ...fields, dynamicViewId: dvId } }], `chart on view ${dvId}`),
    removeDynamicView: (id) => run([{ op: "remove_dynamic_view", id }], `remove view ${id}`),
    aiViews: () => {
      const st = useAiSessionStore.getState();
      const dvs = useDynamicViewStore.getState().views;
      console.table(
        st.derived.addedDynamicViews.map((v) => ({
          id: v.id,
          name: v.name,
          gen: st.dvGen[v.id] ?? 0,
          status: dvs[v.id]?.status ?? "(none)",
          reason: dvs[v.id]?.reason ?? "",
          kineticaName: dvs[v.id]?.viewName ?? "",
          aggregated: v.aggregated,
        })),
      );
    },
    listAiViews: async () => {
      const res = await listAiDynamicViews();
      console.table(res.views.map((name) => ({ kineticaName: name })));
    },
    peekAiView: async (tempId) => {
      const entry = useDynamicViewStore.getState().views[tempId];
      if (!entry || entry.status !== "materialized" || !entry.viewName) {
        console.log(`peekAiView(${tempId}): view is ${entry ? entry.status : "unknown"}; nothing to peek (needs a materialized view).`);
        return;
      }
      const raw = await runSql(`SELECT * FROM ${entry.viewName} LIMIT 5`);
      console.log(`peekAiView(${tempId}) ${entry.viewName}:`, raw);
    },
    help: () => {
      const saved = getSavedWidgets().map((w) => `${w.id}:${w.type}`).join(", ") || "(none)";
      console.log(
        [
          "__kbiAiHarness (DEV only)",
          "  addWidget(type='records', title, config)   removeWidget(id)   patchWidget(id, configPatch)",
          "  addChart(type, title, tableId, {metric, aggregation, groupByColumn, color, ...})   editChart(id, fields)   changeType(id, 'bar'|'line'|'pie')   renameWidget(id, title)",
          "  setLayout([{id,x,y,w,h}])   addHeatmap({tableId, spatialMode, latColumn, lonColumn, style}, mapId?)   editHeatmap(layerId, {colormap, blurRadius, opacity, valueColumn, name})",
          "  setLayerVisible(layerId, bool)   removeLayer(layerId)   approveRemoval() (then repeat a saved-content removal)",
          `  chart colour names: ${AI_PALETTE_NAMES.join(", ")}`,
          `  heatmap ramps: ${AI_HEATMAP_RAMPS.join(", ")}`,
          "  chatTurn(prompt, answer, {followUps, clarifications, pickedChoice, status:'ok'|'error'|'cancelled', message, retryable, ops})  (no provider call)",
          "  chatTurn(prompt, answer, { queries: [{ sql, rowCount, outcome: 'ok'|'refused'|'timed_out'|'cancelled'|'error', reason }] })  // 140: \"Ran N queries\" list, no provider",
          "  fakeRun(line, ms)  shows the running status line for ms (no provider call; Cancel does nothing here)",
          "  filter(kind 'table'|'dynamicView', id, column, op 'eq'|'in'|'between'|'isNull', value)  e.g. filter('table', 5, 'payment_type', 'eq', 'Credit'); in: [..]; between: [from, to]",
          "  clearFilter()  (all)   clearFilter(kind, id)   clearFilter(kind, id, column)",
          "  highlight([widgetIds])  flash the AI outline   filterState()  filters + AI deltas + lock state",
          "  D-26: record the Kinetica version first (SELECT version / admin show) before the AI view UAT.",
          "  addDynamicView(name, spec, tempId?)   e.g. addDynamicView('Trips by hour', {baseTableId: 5, groupBy: [{column: 'pickup_datetime', bucket: 'hour', as: 'pickup_hour'}], aggregates: [{fn: 'count', as: 'trips'}, {fn: 'median', column: 'fare_amount', as: 'med_fare'}]})  (median is APPROX)",
          "  bindWidget(widgetId, dvId)   bindLayer(layerId, dvId)   addChartOnView(type, title, dvId, {metric, aggregation, groupByColumn})",
          "  removeDynamicView(id)  (harness removal does not repoint dependents; use chatTurn with a stamped remove op to test repoint; saved ids need approveRemoval())",
          "  aiViews()  session views + status + Kinetica names   listAiViews()  the caller's AI views as Kinetica reports them   peekAiView(tempId)  5 rows + types",
          "  turn(ops[], prompt)   revert(i)/forward(i) (-1 = saved dashboard)   discard()   state()",
          "  map widgets accept show_popup / show_scale_bar / show_fullscreen; records accept page_size",
          "  e.g. patchWidget(<mapId>, { show_scale_bar: true })  (false equals the default, so it shows no change)",
          "  Turn indices include patch turns: every addWidget/patchWidget/removeWidget/turn call is one turn (e.g. patch then add => the add is turn 1)",
          "  revert(-1) shows the saved dashboard but editing stays locked until discard()",
          `  saved widgets: ${saved}`,
        ].join("\n"),
      );
    },
  };
  window.__kbiAiHarness = harness;
  return () => {
    if (window.__kbiAiHarness === harness) delete window.__kbiAiHarness;
  };
}
