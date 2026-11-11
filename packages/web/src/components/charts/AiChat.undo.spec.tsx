// Phase 151 Plan 03: per-line Undo/Redo in the AI change list (real store, real undoAiOps/planUndo).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../../lib/aiSession/askRunner", async () => {
  const actual = await vi.importActual<typeof import("../../lib/aiSession/askRunner")>("../../lib/aiSession/askRunner");
  return { ...actual, runAsk: vi.fn(async () => {}), cancelAsk: vi.fn() };
});
vi.mock("../../lib/aiSession/proposalRunner", () => ({
  toggleProposalTick: vi.fn(),
  applyPendingProposal: vi.fn(async () => {}),
  rejectPendingProposal: vi.fn(async () => {}),
}));
vi.mock("../../api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api/client")>()),
  rateAiAnswer: vi.fn(async () => ({ rating: null })),
  getAiPrefs: vi.fn(async () => ({ showRatingButtons: true, approveFirst: false })),
  setAiPrefs: vi.fn(async (p: object) => ({ showRatingButtons: true, approveFirst: false, ...p })),
}));

import type { AskContext } from "../../lib/aiSession/askRunner";
import { useAiSessionStore } from "../../store/aiSessionStore";
import { __resetAiPrefsForTest } from "../../lib/aiSession/aiPrefs";
import { baselineFixture, addWidgetOp, mapWidget, recordsWidget, savedLayer } from "../../test/aiSessionHarness";
import { AiChat } from "./AiChat";

const spec = { baseTableId: 5, groupBy: [{ column: "payment_type" }], aggregates: [{ fn: "count", as: "trips" }] };
const stamped = [{ name: "payment_type", type: "string" }, { name: "trips", type: "long" }];
const addDv = (tempId = -3) => ({ op: "add_dynamic_view", tempId, name: "Trips by type", spec, columns: stamped, maxRecords: 1000, aggregated: true });
const addBoundWidget = (tempId: number, dv: number) => ({
  op: "add_widget", tempId, type: "bar", title: "dv bar",
  config: { dynamicViewId: dv, metric: "trips", aggregation: "sum", groupByColumn: "payment_type" },
});

const baseline = {
  ...baselineFixture({ widgets: [mapWidget(44, { includedLayerIds: [70] }), recordsWidget(50)], layers: [savedLayer(70)], dynamicViewIds: [90] }),
  dynamicViewSources: { 90: 5 }, dynamicViewColumns: { 90: [{ name: "trips", type: "long" }] }, dynamicViewNames: { 90: "Saved view" },
};
const ctx: AskContext = {
  dashboardId: 1,
  getBaseline: () => baseline,
  getSnapshot: () => ({ widgets: [], layers: [], dynamicViews: [], filters: [] }),
  tables: [{ id: 5, schema: "s", name: "trips", columns: { vendor: "string" } }],
};
const st = () => useAiSessionStore.getState();

let answerId = 100;
const turn = (ops: unknown[], applied: string[], prompt = "go") =>
  act(() => {
    st().applyTurn({ prompt, answer: "Done.", ops, chat: { status: "ok", answerId: answerId++, followUps: [], applied } }, baseline);
  });
const undoBtns = () => screen.queryAllByRole("button", { name: /^Undo / }) as HTMLButtonElement[];
const li = (label: string) => screen.getByText(label).closest("li") as HTMLElement;

const threeCharts = () => turn([addWidgetOp(-1, "records", "A"), addWidgetOp(-2, "records", "B"), addWidgetOp(-3, "records", "C")], ["Add A", "Add B", "Add C"]);
const viewThenChart = () => {
  turn([addDv(-3)], ["Add view"], "first");
  turn([addBoundWidget(-4, -3)], ["Add chart on view"], "second");
};

beforeEach(() => {
  vi.clearAllMocks();
  st().reset();
  __resetAiPrefsForTest();
});

describe("AiChat per-line undo", () => {
  it("UNDOUI-1: each line has Undo; clicking one undoes only it", async () => {
    threeCharts();
    render(<AiChat ctx={ctx} variant="inline" />);
    expect(undoBtns()).toHaveLength(3);
    await userEvent.click(undoBtns()[1]);
    const row = li("Add B");
    expect(row.classList.contains("ai-chat-change--undone")).toBe(true);
    expect(within(row).getByText("Undone")).toBeTruthy();
    expect(within(row).getByRole("button", { name: /^Redo/ })).toBeTruthy();
    expect(st().derived.addedWidgets.map((w) => w.id)).toEqual([-1, -3]);
    expect(screen.queryByText(/Undo this change\?|These depend on it/)).toBeNull();
  });

  it("UNDOUI-2: dependents prompt, Cancel changes nothing", async () => {
    viewThenChart();
    render(<AiChat ctx={ctx} variant="inline" />);
    const turnsBefore = st().turns;
    const derivedBefore = st().derived;
    await userEvent.click(within(li("Add view")).getByRole("button", { name: /^Undo/ }));
    expect(screen.getByText(/These depend on it: .*\(answer 2\)\. Undo all 2\?/)).toBeTruthy();
    const all = screen.getByRole("button", { name: "Undo all" });
    const cancel = screen.getByRole("button", { name: "Cancel" });
    expect(all.className).toBe("btn-primary btn-sm");
    expect(cancel.className).toBe("ghost-sm");
    expect(all.parentElement!.classList.contains("ds-actions")).toBe(true);
    expect(cancel.parentElement).toBe(all.parentElement);
    await userEvent.click(cancel);
    expect(screen.queryByRole("button", { name: "Undo all" })).toBeNull();
    expect(st().turns).toBe(turnsBefore);
    expect(st().derived).toBe(derivedBefore);
  });

  it("UNDOUI-3: Undo all undoes the whole set", async () => {
    viewThenChart();
    render(<AiChat ctx={ctx} variant="inline" />);
    await userEvent.click(within(li("Add view")).getByRole("button", { name: /^Undo/ }));
    await userEvent.click(screen.getByRole("button", { name: "Undo all" }));
    expect(li("Add view").classList.contains("ai-chat-change--undone")).toBe(true);
    expect(li("Add chart on view").classList.contains("ai-chat-change--undone")).toBe(true);
    expect(st().derived.addedDynamicViews).toHaveLength(0);
    expect(st().derived.addedWidgets).toHaveLength(0);
  });

  it("UNDOUI-4: Redo on the dependent brings both back", async () => {
    viewThenChart();
    render(<AiChat ctx={ctx} variant="inline" />);
    await userEvent.click(within(li("Add view")).getByRole("button", { name: /^Undo/ }));
    await userEvent.click(screen.getByRole("button", { name: "Undo all" }));
    await userEvent.click(within(li("Add chart on view")).getByRole("button", { name: /^Redo/ }));
    expect(li("Add view").classList.contains("ai-chat-change--undone")).toBe(false);
    expect(li("Add chart on view").classList.contains("ai-chat-change--undone")).toBe(false);
    expect(st().derived.addedDynamicViews).toHaveLength(1);
    expect(st().derived.addedWidgets).toHaveLength(1);
  });

  it("UNDOUI-5: disabled while running or pending; none in saved or pending turns", () => {
    threeCharts();
    const { unmount } = render(<AiChat ctx={ctx} variant="inline" />);
    expect(undoBtns().every((b) => !b.disabled)).toBe(true);
    act(() => st().startRun("q"));
    expect(undoBtns().length).toBe(3);
    expect(undoBtns().every((b) => b.disabled)).toBe(true);
    unmount();

    st().reset();
    threeCharts();
    act(() => {
      st().applyTurn(
        { prompt: "plan", answer: "Plan.", ops: [], chat: { status: "ok", answerId: 999, followUps: [], applied: [], proposal: { ops: [addWidgetOp(-9, "records", "P")], ticked: [0], status: "pending" } } },
        baseline,
      );
    });
    render(<AiChat ctx={ctx} variant="inline" />);
    expect(undoBtns().length).toBe(3);
    expect(undoBtns().every((b) => b.disabled)).toBe(true);
  });

  it("UNDOUI-5b: saved turns show no Undo", () => {
    threeCharts();
    act(() => st().completeKeep());
    turn([addWidgetOp(-1, "records", "N")], ["Add N"], "after keep");
    render(<AiChat ctx={ctx} variant="inline" />);
    expect(screen.queryByText("Add A")).toBeNull();
    expect(undoBtns()).toHaveLength(1);
  });

  it("UNDOUI-6: eight changes list all eight; ahead turns have no Undo", () => {
    const labels = Array.from({ length: 8 }, (_, i) => `Add chart ${i + 1}`);
    turn(labels.map((_, i) => addWidgetOp(-(i + 1), "records", `W${i + 1}`)), labels);
    turn([addWidgetOp(-20, "records", "Later")], ["Add later"], "second");
    render(<AiChat ctx={ctx} variant="inline" />);
    expect(screen.queryByText(/and \d+ more/)).toBeNull();
    expect(labels.every((l) => screen.queryByText(l))).toBe(true);
    expect(undoBtns()).toHaveLength(9);
    act(() => st().setCursor(0, baseline));
    expect(within(li("Add later")).queryByRole("button", { name: /Undo/ })).toBeNull();
    expect(undoBtns()).toHaveLength(8);
  });

  it("UNDOUI-7: a hand-moved item warns that edits are lost", async () => {
    threeCharts();
    act(() => st().markUserMoved([-1]));
    render(<AiChat ctx={ctx} variant="inline" />);
    await userEvent.click(within(li("Add A")).getByRole("button", { name: /^Undo/ }));
    expect(screen.getByText(/your edits to it will be lost/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Undo all" })).toBeNull();
    const row = li("Add A");
    const confirm = within(row).getByRole("button", { name: "Undo" });
    expect(confirm.className).toBe("btn-primary btn-sm");
    await userEvent.click(confirm);
    expect(st().derived.addedWidgets.map((w) => w.id)).toEqual([-2, -3]);
    expect(st().geometry[-1]).toBeUndefined();
    expect(st().userMoved[-1]).toBeUndefined();
  });

  it("UNDOUI-8: a refused Redo shows the reason and nothing changes", async () => {
    turn([addWidgetOp(-1, "records", "A")], ["Add A"], "first");
    render(<AiChat ctx={ctx} variant="inline" />);
    await userEvent.click(undoBtns()[0]);
    turn([addWidgetOp(-1, "records", "Reused")], ["Add reused"], "second");
    const before = st().turns;
    await userEvent.click(within(li("Add A")).getByRole("button", { name: /^Redo/ }));
    expect(screen.getByText(/^Can't be redone now:/)).toBeTruthy();
    expect(li("Add A").classList.contains("ai-chat-change--undone")).toBe(true);
    expect(st().turns).toBe(before);
  });
});
