import { describe, it, expect } from "vitest";
import { evaluateTurn, foldSession } from "./foldSession";
import { EMPTY_DERIVED } from "./constants";
import type { SessionBaseline, TurnEntry } from "./types";
import type { WidgetDto, DashboardLayerDto } from "../../api/client";

function deepFreeze<T>(o: T): T {
  if (o && typeof o === "object" && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o as object)) deepFreeze(v);
  }
  return o;
}
const w = (id: number, type: string, config: Record<string, unknown> = {}): WidgetDto => ({
  id, dashboard_id: 1, title: `w${id}`, type, position: 0, config, created_at: "", updated_at: "",
});
const l = (id: number): DashboardLayerDto => ({
  id, dashboard_id: 1, table_id: 5, layer_type: "KineticaWms", position: 0, config: {},
  info_enabled: 0, info_columns: null, info_template: null, dynamic_view_id: null,
  cb_config: null, track_config: null, created_at: "", updated_at: "",
});
const baseline: SessionBaseline = deepFreeze({
  dashboardId: 1,
  widgets: [w(42, "map"), w(43, "map", { includedLayerIds: [7] }), w(50, "records")],
  layers: [l(7), l(8)],
  dynamicViewIds: [90],
});
const patch = (kind: string, id: number, configPatch: Record<string, unknown>) => ({
  op: "patch", action: { target: { kind, id }, configPatch },
});
const turn = (ops: unknown[], prior: TurnEntry[] = []) => evaluateTurn(baseline, prior, ops);

describe("evaluateTurn", () => {
  it("EVAL-1: invalid op is skipped with detail, never throws", () => {
    const [e] = turn([{ op: "patch" }]);
    expect(e.op).toBeNull();
    expect(e.result).toMatchObject({ status: "skipped", reason: "invalid_op" });
    expect((e.result as { detail?: string }).detail).toBeTruthy();
  });
  it("EVAL-2: later-phase kinds are unsupported_in_134", () => {
    const es = turn([
      { op: "apply_filter", widgetId: 42 }, { op: "clear_filter" },
      { op: "add_dynamic_view", tempId: -9 }, { op: "remove_dynamic_view", id: 90 },
    ]);
    for (const e of es) expect(e.result).toMatchObject({ status: "skipped", reason: "unsupported_in_134" });
  });
  it("EVAL-3: missing targets are target_not_found; prior-turn temp target applies", () => {
    const es = turn([
      patch("widget", 999, { show_popup: true }), { op: "remove_widget", id: 999 }, { op: "remove_layer", id: 999 },
      { op: "remove_widget", id: 50 }, patch("widget", 50, { page_size: 10 }),
    ]);
    expect(es.slice(0, 3).map((e) => (e.result as { reason?: string }).reason)).toEqual([
      "target_not_found", "target_not_found", "target_not_found",
    ]);
    expect(es[3].result.status).toBe("applied");
    expect(es[4].result).toMatchObject({ status: "skipped", reason: "target_not_found" });
    const t1 = turn([{ op: "add_widget", tempId: -1, type: "records", title: "t", config: {} }]);
    const [p] = turn([patch("widget", -1, { page_size: 25 })], t1);
    expect(p.result.status).toBe("applied");
  });
  it("EVAL-4: reused tempId is duplicate_temp_id even if removed", () => {
    const t1 = turn([
      { op: "add_widget", tempId: -1, type: "records", title: "t", config: {} },
      { op: "remove_widget", id: -1 },
    ]);
    const [e] = turn([{ op: "add_widget", tempId: -1, type: "records", title: "t", config: {} }], t1);
    expect(e.result).toMatchObject({ status: "skipped", reason: "duplicate_temp_id" });
  });
  it("EVAL-5: invalid patches are patch_rejected", () => {
    const [a, b] = turn([patch("widget", 42, { show_popup: "yes" }), patch("layer", 7, { table_id: 3 })]);
    expect(a.result).toMatchObject({ status: "skipped", reason: "patch_rejected" });
    expect(b.result).toMatchObject({ status: "skipped", reason: "patch_rejected" });
  });
  it("EVAL-6: add_layer only on map widgets", () => {
    const [a, b] = turn([{ op: "add_layer", tempId: -2, widgetId: 50 }, { op: "add_layer", tempId: -3, widgetId: 42 }]);
    expect(a.result).toMatchObject({ status: "skipped", reason: "target_not_found" });
    expect(b.result.status).toBe("applied");
  });
});

describe("foldSession", () => {
  it("FOLD-1: turn 2 keeps turn 1 on the same widget", () => {
    const t1 = turn([patch("widget", 42, { show_popup: true })]);
    const t2 = turn([patch("widget", 42, { show_scale_bar: true })], t1);
    const d = foldSession(baseline, [...t1, ...t2]);
    expect(d.contribution.widget[42]).toEqual({ show_popup: true, show_scale_bar: true });
  });
  it("FOLD-2: layer patches deep-merge, track_config top-level", () => {
    const t1 = turn([patch("layer", 7, { opacity: 0.5, track_config: "x" })]);
    const t2 = turn([patch("layer", 7, { renderMode: "heatmap" })], t1);
    const d = foldSession(baseline, [...t1, ...t2]);
    expect(d.contribution.layer[7]).toEqual({ track_config: "x", config: { opacity: 0.5, renderMode: "heatmap" } });
  });
  it("FOLD-3: patch on temp widget merges into the added entity", () => {
    const t = turn([
      { op: "add_widget", tempId: -1, type: "records", title: "t", config: {} },
      patch("widget", -1, { page_size: 25 }),
    ]);
    const d = foldSession(baseline, t);
    expect(d.addedWidgets[0].config.pageSize).toBe(25); // 134-10: translated to the renderer key
    expect(Object.keys(d.contribution.widget)).not.toContain("-1");
  });
  it("OVK-F1: patch on an AI-added map translates show_scale_bar to the renderer key", () => {
    const t = turn([
      { op: "add_widget", tempId: -1, type: "map", title: "m", config: {} },
      patch("widget", -1, { show_scale_bar: true }),
    ]);
    const d = foldSession(baseline, t);
    expect(d.addedWidgets[0].config.showScaleBar).toBe(true);
    expect("show_scale_bar" in d.addedWidgets[0].config).toBe(false);
  });
  it("FOLD-4: removals", () => {
    const t = turn([
      patch("widget", 42, { show_popup: true }), { op: "remove_widget", id: 42 },
      { op: "add_widget", tempId: -1, type: "records", title: "t", config: {} }, { op: "remove_widget", id: -1 },
    ]);
    const d = foldSession(baseline, t);
    expect(d.removedWidgetIds.has(42)).toBe(true);
    expect(d.contribution.widget[42]).toBeUndefined();
    expect(d.addedWidgets.find((x) => x.id === -1)).toBeUndefined();
    expect(d.removedWidgetIds.has(-1)).toBe(false);
  });
  it("FOLD-5: add_layer extends explicit includedLayerIds only", () => {
    const t = turn([{ op: "add_layer", tempId: -2, widgetId: 43 }, { op: "add_layer", tempId: -3, widgetId: 42 }]);
    const d = foldSession(baseline, t);
    expect(d.contribution.widget[43].includedLayerIds).toEqual([7, -2]);
    expect(d.contribution.widget[42]).toBeUndefined();
    expect(d.addedLayers[0]).toMatchObject({ id: -2, table_id: 0, layer_type: "KineticaWms" });
  });
  it("FOLD-6: skipped ignored; appliedOpCount counts applied", () => {
    const t = turn([patch("widget", 42, { show_popup: true }), { op: "remove_widget", id: 999 }]);
    expect(foldSession(baseline, t).appliedOpCount).toBe(1);
  });
  it("FOLD-7: no applied entries returns EMPTY_DERIVED", () => {
    expect(foldSession(baseline, [])).toBe(EMPTY_DERIVED);
    expect(foldSession(baseline, turn([{ op: "remove_widget", id: 999 }]))).toBe(EMPTY_DERIVED);
  });
  it("FOLD-8: prefix fold is deterministic and does not mutate inputs", () => {
    const t1 = deepFreeze(turn([patch("widget", 42, { show_popup: true })]));
    const t2 = deepFreeze(turn([patch("widget", 42, { show_scale_bar: true })], t1));
    const p1 = foldSession(baseline, t1);
    const full = foldSession(baseline, [...t1, ...t2]);
    expect(p1).not.toEqual(full);
    expect(p1).toEqual(foldSession(baseline, turn([patch("widget", 42, { show_popup: true })])));
  });
});
