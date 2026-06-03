/**
 * MapZoomToolbar spec — covers render, aria, and click events.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, screen, cleanup } from "@testing-library/react";
import MapZoomToolbar from "./MapZoomToolbar";

describe("MapZoomToolbar", () => {
  beforeEach(() => { cleanup(); });

  function renderToolbar() {
    const onZoomIn = vi.fn();
    const onZoomOut = vi.fn();
    const utils = render(<MapZoomToolbar onZoomIn={onZoomIn} onZoomOut={onZoomOut} />);
    return { ...utils, onZoomIn, onZoomOut };
  }

  it("renders two buttons with exact aria-labels", () => {
    renderToolbar();
    expect(screen.getByLabelText("Zoom in")).toBeInTheDocument();
    expect(screen.getByLabelText("Zoom out")).toBeInTheDocument();
  });

  it("clicking Zoom in fires onZoomIn (and only onZoomIn)", () => {
    const { onZoomIn, onZoomOut } = renderToolbar();
    fireEvent.click(screen.getByLabelText("Zoom in"));
    expect(onZoomIn).toHaveBeenCalledTimes(1);
    expect(onZoomOut).not.toHaveBeenCalled();
  });

  it("clicking Zoom out fires onZoomOut (and only onZoomOut)", () => {
    const { onZoomIn, onZoomOut } = renderToolbar();
    fireEvent.click(screen.getByLabelText("Zoom out"));
    expect(onZoomOut).toHaveBeenCalledTimes(1);
    expect(onZoomIn).not.toHaveBeenCalled();
  });

  it("toolbar container has role=toolbar and aria-label=Zoom", () => {
    renderToolbar();
    expect(screen.getByRole("toolbar", { name: /Zoom/i })).toBeInTheDocument();
  });

  it("both buttons carry title attribute for hover tooltip", () => {
    renderToolbar();
    expect(screen.getByLabelText("Zoom in").getAttribute("title")).toBe("Zoom in");
    expect(screen.getByLabelText("Zoom out").getAttribute("title")).toBe("Zoom out");
  });

  it("buttons use the shared .map-draw-toolbar-btn class for visual parity", () => {
    renderToolbar();
    expect(screen.getByLabelText("Zoom in").className).toContain("map-draw-toolbar-btn");
    expect(screen.getByLabelText("Zoom out").className).toContain("map-draw-toolbar-btn");
  });
});
