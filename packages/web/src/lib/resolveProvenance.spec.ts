import { describe, it, expect } from "vitest";
import { resolveProvenance } from "./resolveProvenance";
import type { WidgetDto } from "../api/client";

function makeWidget(id: number, title: string): WidgetDto {
  return {
    id,
    dashboard_id: 1,
    title,
    type: "bar",
    position: 0,
    config: {},
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}

describe("resolveProvenance", () => {
  it("resolves a known sourceWidgetId to 'from {title}'", () => {
    const widgets = [makeWidget(5, "Sales map")];
    expect(resolveProvenance(5, widgets)).toBe("from Sales map");
  });

  it("returns undefined when sourceWidgetId is undefined", () => {
    const widgets = [makeWidget(5, "Sales map")];
    expect(resolveProvenance(undefined, widgets)).toBeUndefined();
  });

  it("returns undefined when sourceWidgetId does not resolve to any widget", () => {
    const widgets = [makeWidget(5, "Sales map")];
    expect(resolveProvenance(99, widgets)).toBeUndefined();
  });
});
