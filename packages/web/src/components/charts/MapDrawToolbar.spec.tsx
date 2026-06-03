/**
 * Phase 29 (DRAW-V15-01): MapDrawToolbar spec — covers render, click events, active state,
 * trash visibility, aria. Component is created in Task 2. This spec is the contract.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, screen, cleanup } from "@testing-library/react";
import MapDrawToolbar from "./MapDrawToolbar";
import type { DrawMode } from "../../lib/shapeDraw";

describe("MapDrawToolbar (DRAW-V15-01)", () => {
  beforeEach(() => { cleanup(); });

  function renderToolbar(
    overrides: Partial<{
      drawMode: DrawMode;
      shapesCount: number;
      eligibleTargetTableNames: string[];
    }> = {},
  ) {
    const onModeChange = vi.fn();
    const onClearAll = vi.fn();
    const utils = render(
      <MapDrawToolbar
        drawMode={overrides.drawMode ?? "info"}
        onModeChange={onModeChange}
        shapesCount={overrides.shapesCount ?? 0}
        onClearAll={onClearAll}
        eligibleTargetTableNames={overrides.eligibleTargetTableNames ?? []}
      />
    );
    return { ...utils, onModeChange, onClearAll };
  }

  it("T1: renders all 5 mode buttons with exact aria-labels", () => {
    renderToolbar();
    expect(screen.getByLabelText("Pan")).toBeInTheDocument();
    expect(screen.getByLabelText("Info")).toBeInTheDocument();
    expect(screen.getByLabelText("Draw bounding box")).toBeInTheDocument();
    expect(screen.getByLabelText("Draw lasso")).toBeInTheDocument();
    expect(screen.getByLabelText("Draw circle")).toBeInTheDocument();
  });

  it("T2: Trash hidden when shapesCount === 0", () => {
    renderToolbar({ shapesCount: 0 });
    expect(screen.queryByLabelText("Clear all shapes")).toBeNull();
  });

  it("T3: Trash visible when shapesCount === 1", () => {
    renderToolbar({ shapesCount: 1 });
    expect(screen.getByLabelText("Clear all shapes")).toBeInTheDocument();
  });

  it("T4: Trash visible when shapesCount === 5", () => {
    renderToolbar({ shapesCount: 5 });
    expect(screen.getByLabelText("Clear all shapes")).toBeInTheDocument();
  });

  it("T5: active mode = info → Info button has is-active; others do not", () => {
    renderToolbar({ drawMode: "info" });
    expect(screen.getByLabelText("Info").className).toContain("is-active");
    expect(screen.getByLabelText("Pan").className).not.toContain("is-active");
    expect(screen.getByLabelText("Draw bounding box").className).not.toContain("is-active");
    expect(screen.getByLabelText("Draw lasso").className).not.toContain("is-active");
    expect(screen.getByLabelText("Draw circle").className).not.toContain("is-active");
  });

  it("T6: active mode = bbox → only Bbox has is-active", () => {
    renderToolbar({ drawMode: "bbox" });
    expect(screen.getByLabelText("Draw bounding box").className).toContain("is-active");
    expect(screen.getByLabelText("Pan").className).not.toContain("is-active");
    expect(screen.getByLabelText("Info").className).not.toContain("is-active");
    expect(screen.getByLabelText("Draw lasso").className).not.toContain("is-active");
    expect(screen.getByLabelText("Draw circle").className).not.toContain("is-active");
  });

  it("T7: clicking non-active mode fires onModeChange with that mode", () => {
    const { onModeChange } = renderToolbar({
      drawMode: "info",
      // Drawing buttons require eligible spatial targets to be enabled.
      eligibleTargetTableNames: ["demo.nyctaxi"],
    });
    fireEvent.click(screen.getByLabelText("Draw bounding box"));
    expect(onModeChange).toHaveBeenCalledTimes(1);
    expect(onModeChange).toHaveBeenCalledWith("bbox");
  });

  it("T8: clicking already-active mode is a no-op (CONTEXT.md re-click lock)", () => {
    const { onModeChange } = renderToolbar({ drawMode: "bbox" });
    fireEvent.click(screen.getByLabelText("Draw bounding box"));
    expect(onModeChange).not.toHaveBeenCalled();
  });

  it("T9: clicking Trash fires onClearAll", () => {
    const { onClearAll } = renderToolbar({ shapesCount: 2 });
    fireEvent.click(screen.getByLabelText("Clear all shapes"));
    expect(onClearAll).toHaveBeenCalledTimes(1);
  });

  it("T10: aria-pressed reflects active state", () => {
    renderToolbar({ drawMode: "bbox" });
    expect(screen.getByLabelText("Draw bounding box").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByLabelText("Info").getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByLabelText("Pan").getAttribute("aria-pressed")).toBe("false");
  });

  it("T11: toolbar container has role=toolbar with aria-label", () => {
    renderToolbar();
    expect(screen.getByRole("toolbar", { name: /Drawing tools/i })).toBeInTheDocument();
  });

  it("T12: button order is Pan, Info, Bbox, Lasso, Circle, [Trash]", () => {
    const { container } = renderToolbar({ shapesCount: 1 });
    const buttons = container.querySelectorAll("button");
    const labels = Array.from(buttons).map((b) => b.getAttribute("aria-label"));
    expect(labels).toEqual([
      "Pan",
      "Info",
      "Draw bounding box",
      "Draw lasso",
      "Draw circle",
      "Clear all shapes",
    ]);
  });

  it("T13: with NO eligible targets → bbox/lasso/circle title=action-oriented warning", () => {
    renderToolbar({ eligibleTargetTableNames: [] });
    const expected =
      "No tables configured — add targets in widget config to filter on draw.";
    expect(screen.getByLabelText("Draw bounding box").getAttribute("title")).toBe(expected);
    expect(screen.getByLabelText("Draw lasso").getAttribute("title")).toBe(expected);
    expect(screen.getByLabelText("Draw circle").getAttribute("title")).toBe(expected);
  });

  it("T14: with eligible targets → title lists table names joined by comma+space", () => {
    renderToolbar({ eligibleTargetTableNames: ["demo.nyctaxi", "demo.zones"] });
    const expected = "Filters: demo.nyctaxi, demo.zones";
    expect(screen.getByLabelText("Draw bounding box").getAttribute("title")).toBe(expected);
    expect(screen.getByLabelText("Draw lasso").getAttribute("title")).toBe(expected);
    expect(screen.getByLabelText("Draw circle").getAttribute("title")).toBe(expected);
  });

  it("T15: single target → title shows single name", () => {
    renderToolbar({ eligibleTargetTableNames: ["demo.nyctaxi"] });
    expect(screen.getByLabelText("Draw bounding box").getAttribute("title")).toBe(
      "Filters: demo.nyctaxi",
    );
  });

  it("T16: Pan / Info / Trash buttons have NO title attribute (mode-only buttons)", () => {
    renderToolbar({ shapesCount: 1, eligibleTargetTableNames: ["demo.nyctaxi"] });
    expect(screen.getByLabelText("Pan").hasAttribute("title")).toBe(false);
    expect(screen.getByLabelText("Info").hasAttribute("title")).toBe(false);
    expect(screen.getByLabelText("Clear all shapes").hasAttribute("title")).toBe(false);
  });

  it("T17: with NO eligible targets → bbox/lasso/circle are disabled", () => {
    renderToolbar({ eligibleTargetTableNames: [] });
    expect((screen.getByLabelText("Draw bounding box") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText("Draw lasso") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText("Draw circle") as HTMLButtonElement).disabled).toBe(true);
  });

  it("T18: with eligible targets → bbox/lasso/circle are enabled", () => {
    renderToolbar({ eligibleTargetTableNames: ["demo.nyctaxi"] });
    expect((screen.getByLabelText("Draw bounding box") as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByLabelText("Draw lasso") as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByLabelText("Draw circle") as HTMLButtonElement).disabled).toBe(false);
  });

  it("T19: Pan / Info are NEVER disabled regardless of target state", () => {
    renderToolbar({ eligibleTargetTableNames: [] });
    expect((screen.getByLabelText("Pan") as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByLabelText("Info") as HTMLButtonElement).disabled).toBe(false);
  });

  it("T20: disabled draw buttons keep their title-attribute tooltip", () => {
    renderToolbar({ eligibleTargetTableNames: [] });
    const expected =
      "No tables configured — add targets in widget config to filter on draw.";
    expect(screen.getByLabelText("Draw bounding box").getAttribute("title")).toBe(expected);
  });

  it("T21: clicking a disabled draw button does NOT fire onModeChange", () => {
    const { onModeChange } = renderToolbar({ eligibleTargetTableNames: [] });
    fireEvent.click(screen.getByLabelText("Draw bounding box"));
    fireEvent.click(screen.getByLabelText("Draw lasso"));
    fireEvent.click(screen.getByLabelText("Draw circle"));
    expect(onModeChange).not.toHaveBeenCalled();
  });
});
