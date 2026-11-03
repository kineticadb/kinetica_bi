import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { WidgetCard } from "./WidgetCard";
import { useAiSessionStore } from "../store/aiSessionStore";
import { AI_HIGHLIGHT_MS } from "../lib/aiSession/constants";
import { baselineFixture, mapWidget, savedLayer, patchLayerOp, setTitleOp } from "../test/aiSessionHarness";
import type { WidgetDto } from "../api/client";

vi.mock("./charts/WidgetRenderer", () => ({ default: () => <div data-testid="widget-renderer-stub" /> }));

const mk = (id: number): WidgetDto => ({
  id, dashboard_id: 1, title: `Widget ${id}`, type: "bar", position: id, config: {},
  created_at: "", updated_at: "",
});
const props = {
  layers: [], associatedTables: [], targetsByTable: new Map<number, unknown>(), canEdit: false,
  canConfigure: false, onConfigure: vi.fn(), onDuplicate: vi.fn(), onRemove: vi.fn(),
};
const cardOf = (t: string) => screen.getByText(t).closest(".widget-card") as HTMLElement;

beforeEach(() => {
  vi.useFakeTimers();
  useAiSessionStore.getState().reset();
});
afterEach(() => vi.useRealTimers());

describe("WidgetCard AI changed outline", () => {
  it("HL-1: only highlighted widget gets the class", () => {
    render(<><WidgetCard widget={mk(5)} {...props} /><WidgetCard widget={mk(6)} {...props} /></>);
    act(() => useAiSessionStore.getState().setHighlight([5]));
    expect(cardOf("Widget 5").className).toContain("widget-card--ai-changed");
    expect(cardOf("Widget 6").className).not.toContain("widget-card--ai-changed");
  });

  it("HL-2: class removed after AI_HIGHLIGHT_MS; pill remains", () => {
    const b = baselineFixture({ widgets: [{ ...mk(5) }] });
    useAiSessionStore.getState().applyTurn({ prompt: "x", ops: [setTitleOp(5, "Renamed")] }, b);
    render(<WidgetCard widget={mk(5)} {...props} />);
    act(() => useAiSessionStore.getState().setHighlight([5]));
    expect(cardOf("Widget 5").className).toContain("widget-card--ai-changed");
    act(() => { vi.advanceTimersByTime(AI_HIGHLIGHT_MS); });
    expect(cardOf("Widget 5").className).not.toContain("widget-card--ai-changed");
    expect(screen.getByText("AI edited")).toBeTruthy();
  });

  it("HL-3: a second highlight re-adds the class", () => {
    render(<WidgetCard widget={mk(5)} {...props} />);
    act(() => useAiSessionStore.getState().setHighlight([5]));
    act(() => { vi.advanceTimersByTime(AI_HIGHLIGHT_MS); });
    expect(cardOf("Widget 5").className).not.toContain("widget-card--ai-changed");
    act(() => useAiSessionStore.getState().setHighlight([5]));
    expect(cardOf("Widget 5").className).toContain("widget-card--ai-changed");
  });

  it("HL-4: a layer-only change shows 'AI edited' on the host map, not on others", () => {
    const m117 = mapWidget(117, { includedLayerIds: [23] });
    const m118 = mapWidget(118, { includedLayerIds: [99] });
    const b = baselineFixture({ widgets: [m117, m118], layers: [savedLayer(23, { config: { renderMode: "heatmap" }, table_id: 1 }), savedLayer(99, { config: { renderMode: "heatmap" }, table_id: 1 })] });
    useAiSessionStore.getState().applyTurn({ prompt: "x", ops: [patchLayerOp(23, { colormap: "magma" })] }, b);
    render(<><WidgetCard widget={m117} {...props} /><WidgetCard widget={m118} {...props} /></>);
    expect(cardOf("map 117").textContent).toContain("AI edited");
    expect(cardOf("map 118").textContent).not.toContain("AI edited");
  });
});
