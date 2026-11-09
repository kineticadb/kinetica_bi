import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useAiSessionStore } from "../store/aiSessionStore";
import { applyFilterRaw, baselineFixture, addWidgetOp, setTitleOp, removeWidgetOp, recordsWidget } from "../test/aiSessionHarness";

const order: string[] = [];
vi.mock("../lib/aiSession/askRunner", () => ({ cancelAsk: () => order.push("cancel") }));
import { AiChangeBar } from "./AiChangeBar";
import { useAuthStore } from "../store/auth";
import { AI_CHAT_COPY } from "../lib/aiSession/chatText";
import type { KeepRunOutcome } from "../lib/aiSession/keepRunner";

const widgets = [recordsWidget(50), { ...recordsWidget(51), title: "Revenue" }];
const baseline = () => baselineFixture({ widgets: [...widgets] });
const apply = (ops: unknown[]) => useAiSessionStore.getState().applyTurn({ prompt: "x", ops }, baseline());
const bar = (p: { onKeep?: () => Promise<KeepRunOutcome>; onReloadLatest?: () => Promise<void>; ownUnkept?: boolean } = {}) => (
  <AiChangeBar savedWidgets={widgets} savedLayers={[]} {...p} />
);
const asUser = (permissions: string[]) =>
  useAuthStore.setState({ status: "authenticated", user: { username: "u", roles: ["x"], permissions } });
const EDITOR = ["dashboards:edit"];
const dvToggle = (id: number) => ({ op: "patch", action: { target: { kind: "dynamicView", id }, configPatch: { enabled: false } } });
const deferred = <T,>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};
const keepBtn = () => screen.getByRole("button", { name: /^(Keep|Saving…)$/ }) as HTMLButtonElement;

beforeEach(() => {
  useAuthStore.setState({ status: "unauthenticated", user: null });
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

  it("BAR7-4: Keep enabled for an editor; buttons in ds-actions", () => {
    asUser(EDITOR);
    apply([addWidgetOp(-1)]);
    render(bar({ onKeep: vi.fn() }));
    const keep = screen.getByRole("button", { name: "Keep" }) as HTMLButtonElement;
    const discard = screen.getByRole("button", { name: "Discard" });
    expect(keep.disabled).toBe(false);
    expect(keep.className).toBe("btn-primary btn-sm");
    expect(keep.title).toBe("");
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

  it("KBAR-1: D-03 a non-editor sees no Keep, the editors-only note, and Discard", () => {
    asUser(["dashboards:view"]);
    apply([addWidgetOp(-1)]);
    render(bar({ onKeep: vi.fn() }));
    expect(screen.queryByRole("button", { name: "Keep" })).toBeNull();
    const note = screen.getByText("Only editors can save AI changes");
    expect(note.classList.contains("muted")).toBe(true);
    expect(screen.getByRole("button", { name: "Discard" })).toBeTruthy();
  });

  it("KBAR-2: D-04 an editor without dynamic_views:manage still sees an enabled Keep", () => {
    asUser(EDITOR);
    apply([addWidgetOp(-1)]);
    render(bar({ onKeep: vi.fn() }));
    expect(keepBtn().disabled).toBe(false);
  });

  it("KBAR-3: Keep opens the confirm; Cancel closes it without calling onKeep", () => {
    asUser(EDITOR);
    const onKeep = vi.fn();
    apply([addWidgetOp(-1)]);
    render(bar({ onKeep }));
    fireEvent.click(keepBtn());
    const dlg = screen.getByRole("dialog");
    expect(dlg.textContent).toContain("Save AI changes?");
    expect(dlg.textContent).toContain("Filters are not saved.");
    expect(dlg.textContent).toMatch(/1 added/i);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onKeep).not.toHaveBeenCalled();
  });

  it("KBAR-4: Save shows Saving… with Keep and Discard disabled until the promise resolves", async () => {
    asUser(EDITOR);
    const d = deferred<KeepRunOutcome>();
    const onKeep = vi.fn(() => d.promise);
    apply([addWidgetOp(-1)]);
    render(bar({ onKeep }));
    fireEvent.click(keepBtn());
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onKeep).toHaveBeenCalledTimes(1);
    expect(keepBtn().textContent).toBe("Saving…");
    expect(keepBtn().disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Discard" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => d.resolve({ kind: "error", message: "x" }));
    expect(keepBtn().textContent).toBe("Keep");
  });

  it("KBAR-5: after a saved outcome (completeKeep) the bar renders nothing", async () => {
    asUser(EDITOR);
    apply([addWidgetOp(-1)]);
    const { container } = render(
      bar({ onKeep: async () => { useAiSessionStore.getState().completeKeep(); return { kind: "saved" }; } }),
    );
    fireEvent.click(keepBtn());
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save" })); });
    expect(container.innerHTML).toBe("");
  });

  it("KBAR-6: an error shows in role=alert .error and Keep is enabled again; counts unchanged", async () => {
    asUser(EDITOR);
    const msg = "You can't save these changes: saving dynamic views needs the Manage dynamic views permission.";
    apply([addWidgetOp(-1)]);
    render(bar({ onKeep: async () => ({ kind: "error", message: msg }) }));
    fireEvent.click(keepBtn());
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save" })); });
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toBe(msg);
    expect(alert.classList.contains("error")).toBe(true);
    expect(keepBtn().disabled).toBe(false);
    expect(screen.getByRole("status").textContent).toMatch(/1 added/);
  });

  it("KBAR-7: conflict opens the dialog; Stay disables Keep with the note", async () => {
    asUser(EDITOR);
    apply([addWidgetOp(-1)]);
    render(bar({
      onKeep: async () => { useAiSessionStore.getState().setKeepBlocked("conflict"); return { kind: "conflict" }; },
    }));
    fireEvent.click(keepBtn());
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save" })); });
    expect(screen.getByRole("dialog").textContent).toContain(AI_CHAT_COPY.conflictTitle);
    fireEvent.click(screen.getByRole("button", { name: "Stay" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(keepBtn().disabled).toBe(true);
    expect(keepBtn().title).toBe(AI_CHAT_COPY.keepBlockedConflict);
    expect(screen.getByText(AI_CHAT_COPY.keepBlockedConflict).classList.contains("muted")).toBe(true);
  });

  it("KBAR-7b: Discard and reload the latest calls onReloadLatest once", async () => {
    asUser(EDITOR);
    const onReloadLatest = vi.fn(async () => {});
    apply([addWidgetOp(-1)]);
    render(bar({ onKeep: async () => ({ kind: "conflict" }), onReloadLatest }));
    fireEvent.click(keepBtn());
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save" })); });
    fireEvent.click(screen.getByRole("button", { name: "Discard and reload the latest" }));
    expect(onReloadLatest).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("KBAR-8: committed-without-refresh blocks Keep and shows the reload alert", () => {
    asUser(EDITOR);
    apply([addWidgetOp(-1)]);
    act(() => useAiSessionStore.getState().setKeepBlocked("committed"));
    render(bar({ onKeep: vi.fn() }));
    expect(keepBtn().disabled).toBe(true);
    expect(screen.getByRole("alert").textContent).toBe("Saved, but couldn't refresh the dashboard. Reload the page.");
  });

  it("KBAR-9: Keep is disabled while the AI runs, when nothing would be saved, and without onKeep", () => {
    asUser(EDITOR);
    apply([addWidgetOp(-1)]);
    act(() => useAiSessionStore.getState().startRun("q"));
    const { unmount } = render(bar({ onKeep: vi.fn() }));
    expect(keepBtn().disabled).toBe(true);
    expect(keepBtn().title).toBe(AI_CHAT_COPY.keepBusy);
    act(() => useAiSessionStore.getState().endRun());
    unmount();

    act(() => useAiSessionStore.getState().setCursor(-1, baseline()));
    const second = render(bar({ onKeep: vi.fn() }));
    expect(keepBtn().disabled).toBe(true);
    expect(keepBtn().title).toBe(AI_CHAT_COPY.keepNothing);
    second.unmount();

    act(() => useAiSessionStore.getState().setCursor(0, baseline()));
    render(bar());
    expect(keepBtn().disabled).toBe(true);
  });

  it("KBAR-10: D-20 the confirm mentions view on/off only when the session toggled a saved view", () => {
    asUser(EDITOR);
    apply([addWidgetOp(-1)]);
    const first = render(bar({ onKeep: vi.fn() }));
    fireEvent.click(keepBtn());
    expect(screen.getByRole("dialog").textContent).not.toContain("View on/off changes are not saved.");
    first.unmount();
    useAiSessionStore.getState().reset();
    useAiSessionStore.getState().applyTurn({ prompt: "x", ops: [addWidgetOp(-1), dvToggle(90)] }, baseline());
    render(bar({ onKeep: vi.fn() }));
    fireEvent.click(keepBtn());
    expect(screen.getByRole("dialog").textContent).toContain("View on/off changes are not saved.");
  });

  it("GENBAR-5: onDiscardGenerated routes Discard away from the 137 dialog; absent keeps it", () => {
    apply([addWidgetOp(-1)]);
    const fn = vi.fn();
    const first = render(<AiChangeBar savedWidgets={widgets} savedLayers={[]} onDiscardGenerated={fn} />);
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(fn).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
    first.unmount();
    render(bar());
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(screen.getByRole("dialog").textContent).toContain(AI_CHAT_COPY.discardTitle);
  });

  it("KBAR-OWN-1: a create-only user sees an enabled Keep on their own unkept dashboard", () => {
    asUser(["dashboards:view", "dashboards:create"]);
    apply([addWidgetOp(-1)]);
    render(bar({ onKeep: vi.fn(), ownUnkept: true }));
    expect(keepBtn().disabled).toBe(false);
    expect(screen.queryByText("Only editors can save AI changes")).toBeNull();
  });

  it("KBAR-OWN-2: the same user sees no Keep on a saved dashboard", () => {
    asUser(["dashboards:view", "dashboards:create"]);
    apply([addWidgetOp(-1)]);
    render(bar({ onKeep: vi.fn() }));
    expect(screen.queryByRole("button", { name: "Keep" })).toBeNull();
    expect(screen.getByText("Only editors can save AI changes")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Discard" })).toBeTruthy();
  });

  it("KBAR-OWN-3: ownUnkept without dashboards:create shows no Keep", () => {
    asUser(["dashboards:view"]);
    apply([addWidgetOp(-1)]);
    render(bar({ onKeep: vi.fn(), ownUnkept: true }));
    expect(screen.queryByRole("button", { name: "Keep" })).toBeNull();
  });
});
