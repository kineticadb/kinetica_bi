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
import { setAiPrefs } from "../../api/client";
import { toggleProposalTick, applyPendingProposal, rejectPendingProposal } from "../../lib/aiSession/proposalRunner";
import { useAiSessionStore } from "../../store/aiSessionStore";
import { __resetAiPrefsForTest } from "../../lib/aiSession/aiPrefs";
import type { TurnProposal } from "../../lib/aiSession/types";
import { addWidgetOp, applyFilterRaw } from "../../test/aiSessionHarness";
import { AiChat } from "./AiChat";

const baseline = { dashboardId: 1, widgets: [], layers: [], dynamicViewIds: [] };
const ctx: AskContext = {
  dashboardId: 1,
  getBaseline: () => baseline,
  getSnapshot: () => ({ widgets: [], layers: [], dynamicViews: [], filters: [] }),
  tables: [{ id: 5, schema: "s", name: "trips", columns: { vendor: "string" } }],
};
const st = () => useAiSessionStore.getState();

const bar = () => addWidgetOp(-1, "records", "Trips by vendor");
const flt = () => applyFilterRaw({ kind: "table", id: 5 }, "vendor", "CMT");

function seedProposal(proposal: Partial<TurnProposal> = {}, answer = "Here is my plan.") {
  const ops = [bar(), flt()];
  return st().applyTurn(
    {
      prompt: "make it",
      answer,
      ops: [],
      chat: { status: "ok", answerId: 41, followUps: ["Try something else"], applied: [], proposal: { ops, ticked: [0, 1], status: "pending", ...proposal } },
    },
    baseline,
  ).turnId;
}

beforeEach(() => {
  vi.clearAllMocks();
  st().reset();
  __resetAiPrefsForTest();
});

describe("AiChat approve first", () => {
  it("APPRCHAT-1: pending proposal shows a marker and a ticked list", () => {
    seedProposal();
    render(<AiChat ctx={ctx} variant="inline" />);
    expect(screen.getByText("Proposed")).toBeTruthy();
    const list = screen.getByRole("list", { name: "Proposed changes" });
    const boxes = within(list).getAllByRole("checkbox") as HTMLInputElement[];
    expect(boxes).toHaveLength(2);
    expect(boxes.every((b) => b.checked)).toBe(true);
    expect(within(list).getByLabelText('Will add records "Trips by vendor"')).toBeTruthy();
    expect(within(list).getByLabelText("Will filter to vendor = 'CMT'")).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Dashboard changes" })).toBeNull();
    expect(screen.queryByText("No changes were made", { exact: false })).toBeNull();
  });

  it("APPRCHAT-2: unticking calls toggleProposalTick", async () => {
    const id = seedProposal();
    render(<AiChat ctx={ctx} variant="inline" />);
    const boxes = within(screen.getByRole("list", { name: "Proposed changes" })).getAllByRole("checkbox");
    await userEvent.click(boxes[1]);
    expect(toggleProposalTick).toHaveBeenCalledWith(id, 1, false);
  });

  it("APPRCHAT-3: Apply and Reject sit in one ds-actions row and call the runner", async () => {
    seedProposal();
    const { container, rerender } = render(<AiChat ctx={ctx} variant="inline" />);
    const apply = screen.getByRole("button", { name: "Apply changes" });
    const reject = screen.getByRole("button", { name: "Reject" });
    expect(apply.className).toBe("btn-primary btn-sm");
    expect(reject.className).toBe("ghost-sm");
    expect(apply.parentElement).toBe(reject.parentElement);
    expect(apply.parentElement!.classList.contains("ds-actions")).toBe(true);
    await userEvent.click(apply);
    expect(applyPendingProposal).toHaveBeenCalledWith(ctx);
    await userEvent.click(reject);
    expect(rejectPendingProposal).toHaveBeenCalled();

    act(() => st().setProposal(st().turns[0].id, { busy: true }));
    rerender(<AiChat ctx={ctx} variant="inline" />);
    expect((screen.getByRole("button", { name: "Apply changes" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Reject" }) as HTMLButtonElement).disabled).toBe(true);

    act(() => st().setProposal(st().turns[0].id, { busy: false, ticked: [] }));
    expect((screen.getByRole("button", { name: "Apply changes" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Reject" }) as HTMLButtonElement).disabled).toBe(false);
    expect(container).toBeTruthy();
  });

  it("APPRCHAT-4: failed reasons show under the line and the all-failed note shows", () => {
    seedProposal({ failed: [{ index: 0, label: "Add bar", stage: "live_schema", reasons: ["column fare not found"] }] });
    render(<AiChat ctx={ctx} variant="inline" />);
    const first = within(screen.getByRole("list", { name: "Proposed changes" })).getAllByRole("listitem")[0];
    expect(within(first).getByText("column fare not found")).toBeTruthy();
    expect(screen.getByText("None of the ticked changes can be applied now. Untick them or reject.")).toBeTruthy();
  });

  it("APPRCHAT-5: the ask box and follow-ups are locked while a proposal waits", () => {
    seedProposal();
    render(<AiChat ctx={ctx} variant="inline" />);
    const ta = screen.getByLabelText("Ask the AI") as HTMLTextAreaElement;
    expect(ta.disabled).toBe(true);
    expect(ta.placeholder).toBe("Apply or reject the proposed changes first.");
    expect((screen.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Try something else" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Revert" }) as HTMLButtonElement | null)?.disabled ?? true).toBe(true);
  });

  it("APPRCHAT-6: thumbs only once decided; rejected and expired notes", () => {
    const id = seedProposal();
    render(<AiChat ctx={ctx} variant="inline" />);
    expect(screen.queryByRole("button", { name: "Good answer" })).toBeNull();
    act(() => st().setProposal(id, { status: "rejected", ops: [] }));
    expect(screen.getByRole("button", { name: "Good answer" })).toBeTruthy();
    expect(screen.getByText("You rejected these changes. Nothing was changed.")).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Proposed changes" })).toBeNull();
    act(() => st().setProposal(id, { status: "expired", ops: [] }));
    expect(screen.queryByRole("button", { name: "Good answer" })).toBeNull();
    expect(screen.getByText("This proposal expired. Ask again.")).toBeTruthy();
  });

  it("APPRCHAT-7: a partly applied turn lists what was applied, left unticked and not applied", () => {
    st().applyTurn(
      {
        prompt: "make it",
        answer: "Done.",
        ops: [addWidgetOp(-1, "records", "A")],
        chat: {
          status: "ok",
          answerId: 41,
          followUps: [],
          applied: ['Add bar "A"'],
          proposal: { ops: [], ticked: [], status: "partly_applied", unticked: ["Filter on vendor"], failed: [{ index: 1, label: "Add pie", stage: "recheck", reasons: ["r1"] }] },
        },
      },
      baseline,
    );
    render(<AiChat ctx={ctx} variant="inline" />);
    const list = screen.getByRole("list", { name: "Dashboard changes" });
    expect(within(list).getByText('Add bar "A"')).toBeTruthy();
    expect(screen.getByText("Left unticked: Filter on vendor")).toBeTruthy();
    expect(screen.getByText("Not applied: Add pie (r1)")).toBeTruthy();
    expect(screen.queryAllByRole("checkbox", { name: /Will / })).toHaveLength(0);
    expect(screen.queryByText("Proposed")).toBeNull();
  });

  it.each(["inline", "drawer"] as const)("APPRCHAT-8: the switch (%s) is off by default and saves", async (variant) => {
    render(<AiChat ctx={ctx} variant={variant} />);
    const sw = screen.getByRole("checkbox", { name: "Approve changes first" }) as HTMLInputElement;
    expect(sw.checked).toBe(false);
    await userEvent.click(sw);
    expect(setAiPrefs).toHaveBeenLastCalledWith({ approveFirst: true });
    expect((screen.getByRole("checkbox", { name: "Approve changes first" }) as HTMLInputElement).checked).toBe(true);
  });
});
