import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../../lib/aiSession/askRunner", async () => {
  const actual = await vi.importActual<typeof import("../../lib/aiSession/askRunner")>("../../lib/aiSession/askRunner");
  return { ...actual, runAsk: vi.fn(async () => {}), cancelAsk: vi.fn() };
});

import { runAsk, cancelAsk } from "../../lib/aiSession/askRunner";
import type { AskContext } from "../../lib/aiSession/askRunner";
import { useAiSessionStore } from "../../store/aiSessionStore";
import type { Turn, TurnChat } from "../../lib/aiSession/types";
import { AiChat, AiAskBox } from "./AiChat";

const baseline = { dashboardId: 1, widgets: [], layers: [], dynamicViewIds: [] };
const ctx: AskContext = {
  dashboardId: 1,
  getBaseline: () => baseline,
  getSnapshot: () => ({}) as never,
  tables: [{ id: 1, schema: "s", name: "taxi", columns: { fare_amount: "double", payment_type: "varchar(16)" } }],
};

function turn(i: number, prompt: string, answer: string, chat?: TurnChat): Turn {
  return { id: `t${i}`, prompt, answer, entries: [], createdAt: i, chat: chat ?? { status: "ok", followUps: [] } };
}
function seed(turns: Turn[], cursor = turns.length - 1) {
  useAiSessionStore.setState({ turns, cursor });
}

beforeEach(() => {
  vi.clearAllMocks();
  useAiSessionStore.getState().reset();
});

describe("AiChat", () => {
  it("CHAT-1: empty state + starters ask once under StrictMode", async () => {
    render(
      <React.StrictMode>
        <AiChat ctx={ctx} variant="inline" />
      </React.StrictMode>,
    );
    expect(screen.getByText("Ask about this dashboard's data")).toBeTruthy();
    const starter = screen.getByRole("button", { name: "Show total fare_amount by payment_type" });
    await userEvent.click(starter);
    expect(runAsk).toHaveBeenCalledTimes(1);
    expect(runAsk).toHaveBeenCalledWith(ctx, "Show total fare_amount by payment_type");
  });

  it("CHAT-2: Enter sends, Shift+Enter newline, IME does not send, maxLength 2000", async () => {
    render(<AiChat ctx={ctx} variant="inline" />);
    const ta = screen.getByLabelText("Ask the AI") as HTMLTextAreaElement;
    expect(ta.maxLength).toBe(2000);
    await userEvent.type(ta, "a{Shift>}{Enter}{/Shift}b");
    expect(runAsk).not.toHaveBeenCalled();
    expect(ta.value).toBe("a\nb");
    useAiSessionStore.getState().setDraft("");
    await userEvent.type(ta, "hello{Enter}");
    expect(runAsk).toHaveBeenCalledTimes(1);
    expect(runAsk).toHaveBeenCalledWith(ctx, "hello");
    vi.mocked(runAsk).mockClear();
    useAiSessionStore.getState().setDraft("ime");
    const ev = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, isComposing: true });
    ta.dispatchEvent(ev);
    expect(runAsk).not.toHaveBeenCalled();
  });

  it("CHAT-3: follow-ups, template fallback, revert uses store index", async () => {
    seed([
      turn(0, "q1", "a1", { status: "ok", followUps: ["F1", "F2"] }),
      turn(1, "q2", "a2", { status: "ok", followUps: [] }),
    ]);
    render(<AiChat ctx={ctx} variant="drawer" />);
    await userEvent.click(screen.getByRole("button", { name: "F1" }));
    expect(runAsk).toHaveBeenCalledWith(ctx, "F1");
    expect(screen.getByRole("button", { name: "F2" })).toBeTruthy();
    // second answer falls back to local template follow-ups
    expect(screen.getAllByRole("button", { name: "Show total fare_amount by payment_type" }).length).toBeGreaterThan(0);
    const reverts = screen.getAllByRole("button", { name: "Revert dashboard to this state" });
    expect(reverts).toHaveLength(2);
    const spy = vi.spyOn(useAiSessionStore.getState(), "setCursor");
    useAiSessionStore.setState({ setCursor: spy });
    await userEvent.click(reverts[0]);
    expect(spy).toHaveBeenCalledWith(0, baseline);
  });

  it("CHAT-4: running status, elapsed, Cancel, typeable box, disabled suggestions", async () => {
    seed([turn(0, "q1", "a1", { status: "ok", followUps: ["F1"] })]);
    useAiSessionStore.setState({
      run: { status: "running", question: "next", startedAt: Date.now() - 12_000, line: "Adding a chart…" },
    });
    render(<AiChat ctx={ctx} variant="inline" />);
    const status = screen.getByRole("status");
    expect(status.textContent).toContain("Adding a chart…");
    expect(status.textContent).toContain("12s");
    expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(cancelAsk).toHaveBeenCalledTimes(1);
    const ta = screen.getByLabelText("Ask the AI") as HTMLTextAreaElement;
    expect(ta.disabled).toBe(false);
    await userEvent.type(ta, "x");
    expect(ta.value).toBe("x");
    expect((screen.getByRole("button", { name: "F1" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("CHAT-5: cancelled note, error message, Retry only when retryable", async () => {
    seed([
      turn(0, "qc", "", { status: "cancelled" }),
      turn(1, "qe", "", { status: "error", message: "Provider exploded", retryable: true }),
      turn(2, "qn", "", { status: "error", message: "Nope forbidden", retryable: false }),
    ]);
    render(<AiChat ctx={ctx} variant="inline" />);
    expect(screen.getByText("Cancelled, nothing changed")).toBeTruthy();
    expect(screen.getByText("Provider exploded")).toBeTruthy();
    expect(screen.getByText("Nope forbidden")).toBeTruthy();
    const retries = screen.getAllByRole("button", { name: "Retry" });
    expect(retries).toHaveLength(1);
    await userEvent.click(retries[0]);
    expect(runAsk).toHaveBeenCalledWith(ctx, "qe");
  });

  it("CHAT-6: choices click, picked state, older turns disabled", async () => {
    const clar = { kind: "confirm_remove" as const, question: "Remove it?", options: [{ id: "yes", label: "Yes" }, { id: "no", label: "No" }] };
    seed([turn(0, "remove", "ok?", { status: "ok", followUps: [], clarifications: [clar] })]);
    const { unmount } = render(<AiChat ctx={ctx} variant="inline" />);
    await userEvent.click(screen.getByRole("button", { name: "Yes" }));
    expect(runAsk).toHaveBeenCalledWith(ctx, "Yes, remove it", {
      pick: { turnIndex: 0, clarificationIndex: 0, optionId: "yes", approveRemoval: true },
    });
    unmount();
    seed([turn(0, "remove", "ok?", { status: "ok", followUps: [], clarifications: [clar], pickedChoice: { clarificationIndex: 0, optionId: "yes" } })]);
    render(<AiChat ctx={ctx} variant="inline" />);
    const yes = screen.getByRole("button", { name: /Yes/ }) as HTMLButtonElement;
    const no = screen.getByRole("button", { name: "No" }) as HTMLButtonElement;
    expect(yes.disabled).toBe(true);
    expect(no.disabled).toBe(true);
    expect(yes.getAttribute("aria-pressed")).toBe("true");
    expect(yes.textContent).toContain("✓");
  });

  it("CHAT-6b: a clarification on an older turn is disabled", () => {
    const clar = { kind: "choose_option" as const, question: "Which?", options: [{ id: "a", label: "Alpha" }] };
    seed([
      turn(0, "q0", "a0", { status: "ok", followUps: [], clarifications: [clar] }),
      turn(1, "q1", "a1", { status: "ok", followUps: [] }),
    ]);
    render(<AiChat ctx={ctx} variant="inline" />);
    expect((screen.getByRole("button", { name: "Alpha" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("CHAT-7: skipped via describeSkipped, clarification-stage hidden, no HTML", () => {
    seed([
      turn(0, "q", "<b>x</b>", {
        status: "ok",
        followUps: [],
        skipped: [
          { label: "add_widget", stage: "validate", reasons: ["bad column"] },
          { label: "hiddenthing", stage: "clarification", reasons: ["r"] },
        ],
      }),
    ]);
    const { container } = render(<AiChat ctx={ctx} variant="inline" />);
    expect(screen.getByText("Couldn't do: add a chart (bad column)")).toBeTruthy();
    expect(container.textContent).not.toContain("hiddenthing");
    expect(screen.getByText("<b>x</b>")).toBeTruthy();
    expect(container.querySelector("b")).toBeNull();
  });

  it("CHAT-8: two ask boxes share the draft and both show Cancel while running", async () => {
    render(
      <>
        <div data-testid="a"><AiAskBox ctx={ctx} /></div>
        <div data-testid="b"><AiAskBox ctx={ctx} /></div>
      </>,
    );
    const [t1, t2] = screen.getAllByLabelText("Ask the AI") as HTMLTextAreaElement[];
    await userEvent.type(t1, "shared");
    expect(t2.value).toBe("shared");
    useAiSessionStore.setState({ run: { status: "running", question: "q", startedAt: Date.now(), line: "x" } });
    expect(await within(screen.getByTestId("a")).findByRole("button", { name: "Cancel" })).toBeTruthy();
    expect(within(screen.getByTestId("b")).getByRole("button", { name: "Cancel" })).toBeTruthy();
  });

  it("UAT12-1: clarification shows its question once, no template follow-ups, no Revert when nothing changed", () => {
    const clar = { kind: "choose_option" as const, question: "Which total?", options: [{ id: "1", label: "Fare" }, { id: "2", label: "Tip" }] };
    seed([turn(0, "Show the total", "Which total?", { status: "ok", followUps: [], clarifications: [clar] })]);
    render(<AiChat ctx={ctx} variant="inline" />);
    expect(screen.getAllByText("Which total?")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Show total fare_amount by payment_type" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Revert dashboard to this state" })).toBeNull();
    expect(screen.getByRole("button", { name: "Fare" })).toBeTruthy();
  });

  it("UAT12-2: a differently worded choice question keeps its label; AI follow-ups still show", () => {
    const clar = { kind: "choose_option" as const, question: "Pick one", options: [{ id: "1", label: "Fare" }] };
    seed([turn(0, "Show the total", "I can show two totals.", { status: "ok", followUps: ["Show by month"], clarifications: [clar] })]);
    render(<AiChat ctx={ctx} variant="inline" />);
    expect(screen.getByText("Pick one")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Show by month" })).toBeTruthy();
  });
});
