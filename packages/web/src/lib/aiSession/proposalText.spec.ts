import { describe, it, expect } from "vitest";
import { describeProposal, type ProposalNames } from "./proposalText";
import { buildChipText } from "../columnTypes";

const names: ProposalNames = {
  widgets: { 5: { title: "Old", type: "bar" }, 3: { title: "City map", type: "map" } },
  layers: { 9: "Pickups old" },
  views: { 4: "Late view" },
  tables: { 7: "trips" },
};

describe("describeProposal", () => {
  it("APPRTEXT-1: add lines", () => {
    const lines = describeProposal(
      [
        { op: "add_widget", tempId: -1, type: "bar", title: "Trips by vendor", config: {} },
        { op: "add_layer", tempId: -2, widgetId: 3, tableId: 7, renderMode: "heatmap", spatialMode: "latlon", name: "Pickups" },
        { op: "add_layer", tempId: -3, widgetId: 3, tableId: 7, renderMode: "heatmap", spatialMode: "latlon" },
        { op: "add_dynamic_view", tempId: -4, name: "Late trips", spec: {} },
      ],
      names,
    );
    expect(lines).toEqual([
      'Will add bar "Trips by vendor"',
      'Will add heatmap layer "Pickups"',
      'Will add a heatmap layer to "City map"',
      'Will create view "Late trips"',
    ]);
  });

  it("APPRTEXT-2: filter lines", () => {
    const f = (column: string, value: string) => ({ column, operator: "eq", value, dataType: "string" });
    const lines = describeProposal(
      [
        { op: "apply_filter", source: { kind: "table", id: 7 }, filters: [f("vendor", "CMT")] },
        { op: "apply_filter", source: { kind: "table", id: 7 }, filters: [f("vendor", "CMT"), f("zone", "A")] },
        { op: "clear_filter", source: { kind: "table", id: 7 }, column: "vendor" },
        { op: "clear_filter", source: { kind: "table", id: 7 } },
        { op: "clear_filter" },
      ],
      names,
    );
    expect(lines[0]).toBe("Will filter to " + buildChipText("vendor", "CMT", "string", "eq"));
    expect(lines[1]).toBe(`Will filter to ${buildChipText("vendor", "CMT", "string", "eq")}, ${buildChipText("zone", "A", "string", "eq")}`);
    expect(lines[2]).toBe("Will clear the vendor filter");
    expect(lines[3]).toBe("Will clear the filters on trips");
    expect(lines[4]).toBe("Will clear all filters");
  });

  it("APPRTEXT-3: rename, change, remove, edit, layout, unknown", () => {
    const lines = describeProposal(
      [
        { op: "set_widget_title", id: 5, title: "New" },
        { op: "add_widget", tempId: -1, type: "pie", title: "Temp", config: {} },
        { op: "set_widget_title", id: -1, title: "Temp2" },
        { op: "change_widget_type", id: 5, type: "line" },
        { op: "remove_widget", id: 5 },
        { op: "remove_layer", id: 9 },
        { op: "remove_dynamic_view", id: 4 },
        { op: "patch", action: { target: { kind: "widget", id: 5 }, configPatch: {} } },
        { op: "set_layout", items: [{ id: 5, x: 0, y: 0, w: 6, h: 6 }, { id: 3, x: 0, y: 0, w: 6, h: 6 }, { id: 8, x: 0, y: 0, w: 6, h: 6 }] },
        { op: "remove_widget", id: 99 },
        { op: "remove_layer", id: 98 },
        { op: "remove_dynamic_view", id: 97 },
        { nonsense: true },
      ],
      names,
    );
    expect(lines).toEqual([
      'Will rename "Old" to "New"',
      'Will add pie "Temp"',
      'Will rename "Temp" to "Temp2"',
      'Will change "Old" to line',
      'Will remove "Old"',
      'Will remove layer "Pickups old"',
      'Will remove view "Late view"',
      'Will edit "Old"',
      "Will rearrange 3 widgets",
      "Will remove widget 99",
      "Will remove layer 98",
      "Will remove view 97",
      "Will make a change",
    ]);
  });
});
