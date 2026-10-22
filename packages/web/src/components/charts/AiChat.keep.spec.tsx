import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../../lib/aiSession/askRunner", async () => {
  const actual = await vi.importActual<typeof import("../../lib/aiSession/askRunner")>("../../lib/aiSession/askRunner");
  return { ...actual, runAsk: vi.fn(async () => {}), cancelAsk: vi.fn() };
});

import type { AskContext } from "../../lib/aiSession/askRunner";
import { useAiSessionStore } from "../../store/aiSessionStore";
import type { Turn, TurnChat } from "../../lib/aiSession/types";
import { AI_CHAT_COPY } from "../../lib/aiSession/chatText";
import { AiChat } from "./AiChat";

const ctx: AskContext = {
  dashboardId: 1,
  getBaseline: () => ({ dashboardId: 1, widgets: [], layers: [], dynamicViewIds: [] }),
  getSnapshot: () => ({}) as never,
  tables: [{ id: 1, schema: "s", name: "taxi", columns: { fare_amount: "double", payment_type: "varchar(16)" } }],
};

function turn(i: number, prompt: string, answer: string, chat?: TurnChat): Turn {
  return { id: `t${i}`, prompt, answer, entries: [], createdAt: i, chat: chat ?? { status: "ok", followUps: [] } };
}
function seedLive(turns: Turn[]) {
  useAiSessionStore.setState({ turns, cursor: turns.length - 1 });
}

beforeEach(() => {
  vi.clearAllMocks();
  useAiSessionStore.getState().reset();
  useAiSessionStore.setState({ savedTurns: [] });
});

describe("AiChat after Keep (141 D-11)", () => {
  it("KCHAT-1: saved turn stays readable, no revert, 'Changes saved.' is a muted note", () => {
    seedLive([turn(0, "Show fares", "Here are fares", { status: "ok", followUps: [] })]);
    useAiSessionStore.getState().completeKeep();
    render(<AiChat ctx={ctx} variant="inline" />);
    const user = screen.getByText("Show fares");
    expect(user.className).toBe("ai-chat-bubble ai-chat-bubble--user");
    expect(screen.getByText("Here are fares").className).toBe("ai-chat-bubble ai-chat-bubble--ai");
    expect(screen.queryByRole("button", { name: AI_CHAT_COPY.revert })).toBeNull();
    expect(screen.getByText("Changes saved.").className).toBe("ai-chat-note muted");
  });

  it("KCHAT-2: saved turn has no follow-up/choice/clear buttons; filter and skipped notes remain", () => {
    seedLive([
      turn(0, "q1", "a1", {
        status: "ok",
        followUps: ["FOLLOW-ME"],
        clarifications: [{ kind: "choose_option", question: "Which one?", options: [{ id: "o1", label: "OPT-ONE" }] }] as never,
        emptyFilters: [{ source: { kind: "dashboard" } as never, column: "payment_type" }],
        filterNotes: ["FILTER-NOTE"],
        skipped: [{ label: "Skipped thing", stage: "s", reasons: ["because"] }],
      }),
    ]);
    useAiSessionStore.getState().completeKeep();
    render(<AiChat ctx={ctx} variant="inline" />);
    expect(screen.queryByRole("button", { name: "FOLLOW-ME" })).toBeNull();
    expect(screen.queryByRole("button", { name: /OPT-ONE/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /clear/i })).toBeNull();
    expect(screen.getByText("FILTER-NOTE").className).toBe("ai-chat-note muted");
    expect(screen.getByText(/Skipped thing/).className).toBe("ai-chat-note muted");
  });

  it("KCHAT-3: warnings render as a further muted note after 'Changes saved.'", () => {
    seedLive([turn(0, "q", "a")]);
    useAiSessionStore.getState().completeKeep({ warnings: ["W1"] });
    render(<AiChat ctx={ctx} variant="inline" />);
    const saved = screen.getByText("Changes saved.");
    const w1 = screen.getByText("W1");
    expect(w1.className).toBe("ai-chat-note muted");
    expect(saved.compareDocumentPosition(w1) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("KCHAT-4: starter questions do not reappear above a saved conversation", () => {
    seedLive([turn(0, "q", "a")]);
    useAiSessionStore.getState().completeKeep();
    render(<AiChat ctx={ctx} variant="inline" />);
    expect(screen.queryByText(AI_CHAT_COPY.emptyHint)).toBeNull();
    expect(screen.queryByRole("button", { name: "Show total fare_amount by payment_type" })).toBeNull();
  });

  it("KCHAT-5: a live turn after Keep renders below the saved block with its own Revert", () => {
    seedLive([turn(0, "old q", "old a")]);
    useAiSessionStore.getState().completeKeep();
    useAiSessionStore.setState({ turns: [turn(1, "new q", "new a")], cursor: 0 });
    render(<AiChat ctx={ctx} variant="inline" />);
    const old = screen.getByText("old q");
    const fresh = screen.getByText("new q");
    expect(old.compareDocumentPosition(fresh) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getAllByRole("button", { name: AI_CHAT_COPY.revert })).toHaveLength(1);
  });
});
