import { describe, expect, it } from "vitest";
import { coalesceCalendarFilterSelection } from "./coalesceCalendarFilterSelection";

describe("coalesceCalendarFilterSelection", () => {
  it("returns filterSelection unchanged when present (explicit scope always wins)", () => {
    const cfg = {
      tableId: 1,
      filterSelection: { sourceMode: "allowlist", allowedSourceWidgetIds: [7] },
    };
    expect(coalesceCalendarFilterSelection(cfg)).toEqual({
      sourceMode: "allowlist",
      allowedSourceWidgetIds: [7],
    });
  });

  it("legacy respondToFilters:false (no filterSelection) -> empty allow-list (respond to none)", () => {
    const cfg = { tableId: 1, respondToFilters: false };
    expect(coalesceCalendarFilterSelection(cfg)).toEqual({
      sourceMode: "allowlist",
      allowedSourceWidgetIds: [],
    });
  });

  it("legacy respondToFilters:true (no filterSelection) -> undefined (accept-all)", () => {
    const cfg = { tableId: 1, respondToFilters: true };
    expect(coalesceCalendarFilterSelection(cfg)).toBeUndefined();
  });

  it("no respondToFilters key at all (brand-new post-migration calendar) -> undefined (accept-all)", () => {
    const cfg = { tableId: 1 };
    expect(coalesceCalendarFilterSelection(cfg)).toBeUndefined();
  });
});
