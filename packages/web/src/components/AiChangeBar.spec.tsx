import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useAiSessionStore } from "../store/aiSessionStore";
import { applyFilterRaw, baselineFixture, addWidgetOp, setTitleOp, removeWidgetOp, recordsWidget } from "../test/aiSessionHarness";

const order: string[] = [];
vi.mock("../lib/aiSession/askRunner", () => ({ cancelAsk: () => order.push("cancel") }));
import { AiChangeBar } from "./AiChangeBar";

const widgets = [recordsWidget(50), { ...recordsWidget(51), title: "Revenue" }];
const baseline = () => baselineFixture({ widgets: [...widgets] });
const apply = (ops: unknown[]) => useAiSessionStore.getState().applyTurn({ prompt: "x", ops }, baseline());
const bar = () => <AiChangeBar savedWidgets={widgets} savedLayers={[]} />;

beforeEach(() => {
  order.length = 0;
  useAiSessionStore.getState().reset();
});

describe("AiChangeBar", () => {
  it("BAR7-1: nothing applied renders nothing", () => {
    render(bar());
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("LOCKF-8: a filter-only answer renders no bar", () => {
    apply([applyFilterRaw({ kind: "table", id: 5 }, "payment_type")]);
    const { container } = render(bar());
    expect(container.innerHTML).toBe("");
  });

  it("BAR7-2: counts text, locked phrase, removed names title", () => {
    useAiSessionStore.getState().approveRemoval();
    apply([addWidgetOp(-1), addWidgetOp(-2), setTitleOp(50, "Renamed"), removeWidgetOp(51)]);
    render(bar());
    const s = screen.getByRole("status");
    expect(s.textContent).toMatch(/Unsaved AI changes: \d+ added · \d+ edited · 1 removed/);
    expect(s.textContent).toMatch(/2 added/);
    expect(s.textContent).toMatch(/editing is locked/i);
    expect(screen.getByText("1 removed").getAttribute("title")).toBe("Revenue");
  });

  it("UAT12-3: 0 removed has no hover target; a full stop precedes the locked phrase", () => {
    apply([addWidgetOp(-1)]);
    render(bar());
    const s = screen.getByRole("status");
    expect(s.querySelector(".ai-change-bar-removed")).toBeNull();
    expect(s.textContent).toMatch(/0 removed\. Editing is locked/);
  });

  it("BAR7-3: cursor -1 still shows the bar", () => {
    apply([addWidgetOp(-1)]);
    act(() => useAiSessionStore.getState().setCursor(-1, baseline()));
    render(bar());
    const s = screen.getByRole("status");
    expect(s.textContent).toContain("Unsaved AI changes: none shown at this point.");
    expect(s.textContent).toMatch(/editing is locked/i);
  });

  it("BAR7-4: Keep disabled with tooltip; buttons in ds-actions", () => {
    apply([addWidgetOp(-1)]);
    render(bar());
    const keep = screen.getByRole("button", { name: "Keep" }) as HTMLButtonElement;
    const discard = screen.getByRole("button", { name: "Discard" });
    expect(keep.disabled).toBe(true);
    expect(keep.className).toBe("btn-primary btn-sm");
    expect(keep.title).toBe("Saving AI changes is coming soon");
    expect(discard.className).toBe("ghost-sm");
    expect(keep.parentElement!.classList.contains("ds-actions")).toBe(true);
    expect(discard.parentElement).toBe(keep.parentElement);
  });

  it("BAR7-5: Discard opens a portalled confirm; Cancel and Escape close it without reset", () => {
    apply([addWidgetOp(-1)]);
    render(bar());
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    const dlg = screen.getByRole("dialog");
    expect(dlg.textContent).toContain("Discard all AI changes?");
    expect(dlg.closest(".modal-overlay")!.parentElement).toBe(document.body);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(useAiSessionStore.getState().turns).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(useAiSessionStore.getState().turns).toHaveLength(1);
  });

  it("BAR7-6: confirm cancels the ask before reset, then the bar disappears", () => {
    apply([addWidgetOp(-1)]);
    const unsub = useAiSessionStore.subscribe((s, prev) => {
      if (prev.turns.length && !s.turns.length) order.push("reset");
    });
    render(bar());
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    const dlg = screen.getByRole("dialog");
    fireEvent.click(Array.from(dlg.querySelectorAll("button")).find((b) => b.textContent === "Discard")!);
    unsub();
    expect(order).toEqual(["cancel", "reset"]);
    expect(useAiSessionStore.getState().turns).toHaveLength(0);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("BAR7-7: under StrictMode the safe Cancel button has focus on open", () => {
    apply([addWidgetOp(-3)]);
    render(<React.StrictMode>{bar()}</React.StrictMode>);
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cancel" }));
  });

  it("UIDV-3: counts AI views added and saved views removed, naming the removed saved view", () => {
    useAiSessionStore.getState().approveRemoval();
    const dvAdd = { op: "add_dynamic_view", tempId: -3, name: "Trips by type", spec: { baseTableId: 5, groupBy: [{ column: "payment_type" }], aggregates: [{ fn: "count", as: "trips" }] }, columns: [{ name: "payment_type", type: "string" }, { name: "trips", type: "long" }], aggregated: true };
    const b = { ...baselineFixture({ widgets: [...widgets], dynamicViewIds: [90] }), dynamicViewSources: { 90: 5 }, dynamicViewNames: { 90: "Late trips" } };
    useAiSessionStore.getState().applyTurn({ prompt: "x", ops: [dvAdd, { op: "remove_dynamic_view", id: 90 }] }, b);
    render(<AiChangeBar savedWidgets={widgets} savedLayers={[]} savedDynamicViews={[{ id: 90, name: "Late trips" }]} />);
    expect(screen.getByRole("status").textContent).toMatch(/1 added/);
    expect(screen.getByText("1 removed").getAttribute("title")).toContain("Late trips");
  });
});
