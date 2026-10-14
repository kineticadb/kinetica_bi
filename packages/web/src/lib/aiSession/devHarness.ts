// DEV ONLY. Loaded through an `import.meta.env.DEV`-gated dynamic import in DashboardsPage, so
// the branch (and this module) is eliminated from production bundles. Lets the operator drive
// scripted AI turns from the browser console. Phase 137's AI widget replaces it as the real driver.
import type { WidgetDto } from "../../api/client";
import { resolveHeatmapHost, layersOfMap, AI_PALETTE_NAMES, AI_HEATMAP_RAMPS } from "@kinetica-bi/shared";
import type { AiClarification } from "@kinetica-bi/shared";
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
  help(): void;
};

declare global {
  interface Window {
    __kbiAiHarness?: Harness;
  }
}

export function installAiDevHarness(actions: Actions, getSavedWidgets: () => readonly WidgetDto[]): () => void {
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
          "  fakeRun(line, ms)  shows the running status line for ms (no provider call; Cancel does nothing here)",
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
