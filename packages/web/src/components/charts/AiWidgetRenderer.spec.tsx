import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../../api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api/client")>()),
  getAiPrefs: vi.fn(async () => ({ showRatingButtons: true })),
  setAiPrefs: vi.fn(async (p: object) => ({ showRatingButtons: true, ...p })),
  rateAiAnswer: vi.fn(async () => ({ rating: null })),
}));
vi.mock("../../lib/aiSession/askRunner", async () => {
  const actual = await vi.importActual<typeof import("../../lib/aiSession/askRunner")>("../../lib/aiSession/askRunner");
  return { ...actual, runAsk: vi.fn(async () => {}), cancelAsk: vi.fn() };
});
vi.mock("../../lib/aiSession/aiAvailability", () => ({ useAiConfigured: vi.fn(() => true) }));

import { useAiConfigured } from "../../lib/aiSession/aiAvailability";
import type { AskContext } from "../../lib/aiSession/askRunner";
import { useAiSessionStore } from "../../store/aiSessionStore";
import { useAuthStore } from "../../store/auth";
import { useViewerAiStore } from "../../store/viewerAiStore";
import { afterEach } from "vitest";
import { DashboardContextProvider } from "../DashboardContext";
import type { WidgetDto } from "../../api/client";
import type { Turn } from "../../lib/aiSession/types";
import { AiWidgetRenderer } from "./AiWidgetRenderer";
import WidgetRenderer from "./WidgetRenderer";

const baseline = { dashboardId: 1, widgets: [], layers: [], dynamicViewIds: [] };
const ctx: AskContext = {
  dashboardId: 1,
  getBaseline: () => baseline,
  getSnapshot: () => ({}) as never,
  tables: [{ id: 1, schema: "s", name: "taxi", columns: { fare_amount: "double" } }],
};

const w = (layout: Record<string, number>, type = "ai"): WidgetDto =>
  ({ id: 7, dashboard_id: 1, type, title: "AI", config: { layout } }) as unknown as WidgetDto;
const LARGE = { x: 0, y: 0, w: 12, h: 40 };

function setPerm(can: boolean) {
  useAuthStore.setState({ user: { permissions: can ? ["ai:use"] : [] } as never });
}
function wrap(ui: React.ReactNode, withAi = true) {
  return (
    <DashboardContextProvider
      dashboardId={1}
      widgets={[]}
      dynamicViews={[]}
      retryDynamicView={() => {}}
      ai={withAi ? ctx : undefined}
    >
      {ui}
    </DashboardContextProvider>
  );
}
function seed(chat: Turn["chat"], answer = "First line\nsecond line") {
  useAiSessionStore.setState({
    turns: [{ id: "t0", prompt: "q", answer, entries: [], createdAt: 1, chat }],
    cursor: 0,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useAiConfigured).mockReturnValue(true);
  useAiSessionStore.getState().reset();
  setPerm(true);
});

describe("AiWidgetRenderer", () => {
  it("AIW-1: no ai:use -> notice only, no config fetch", () => {
    setPerm(false);
    render(wrap(<AiWidgetRenderer widget={w(LARGE)} />));
    expect(screen.getByText("You don't have access to the AI assistant")).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    expect(useAiConfigured).toHaveBeenCalledWith(false);
  });

  it("AIW-2: not configured -> notice, no ask box", () => {
    vi.mocked(useAiConfigured).mockReturnValue(false);
    render(wrap(<AiWidgetRenderer widget={w(LARGE)} />));
    expect(screen.getByText("The AI assistant isn't set up on this server.")).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("AIW-3: no ai context -> unavailable", () => {
    render(wrap(<AiWidgetRenderer widget={w(LARGE)} />, false));
    expect(screen.getByText("The AI assistant is not available here.")).toBeTruthy();
  });

  it("AIW-4: large tile shows the chat inline", () => {
    render(wrap(<AiWidgetRenderer widget={w(LARGE)} />));
    expect(screen.getByRole("log")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Open conversation" })).toBeNull();
  });

  it.each([
    ["narrow", { x: 0, y: 0, w: 11, h: 40 }],
    ["short", { x: 0, y: 0, w: 12, h: 23 }],
  ])("AIW-5: %s tile shows ask bar, history button and last line", (_n, layout) => {
    seed({ status: "ok", followUps: [] });
    const { container } = render(wrap(<AiWidgetRenderer widget={w(layout)} />));
    expect(screen.queryByRole("log")).toBeNull();
    expect(screen.getByRole("button", { name: "Open conversation" })).toBeTruthy();
    expect(screen.getByLabelText("Ask the AI")).toBeTruthy();
    expect(container.querySelector(".ai-tile-last")?.textContent).toBe("First line");
  });

  it("AIW-5b: cancelled and error last lines; empty with no turns", () => {
    const small = { x: 0, y: 0, w: 6, h: 10 };
    const { container, unmount } = render(wrap(<AiWidgetRenderer widget={w(small)} />));
    expect(container.querySelector(".ai-tile-last")?.textContent).toBe("");
    unmount();
    seed({ status: "cancelled" });
    const r2 = render(wrap(<AiWidgetRenderer widget={w(small)} />));
    expect(r2.container.querySelector(".ai-tile-last")?.textContent).toBe("Cancelled, nothing changed");
    r2.unmount();
    seed({ status: "error", message: "Boom happened", retryable: false });
    const r3 = render(wrap(<AiWidgetRenderer widget={w(small)} />));
    expect(r3.container.querySelector(".ai-tile-last")?.textContent).toBe("Boom happened");
  });

  it("AIW-6: drawer is portalled to body, Escape and Close close it and restore focus", async () => {
    render(wrap(<AiWidgetRenderer widget={w({ x: 0, y: 0, w: 6, h: 10 })} />));
    const btn = screen.getByRole("button", { name: "Open conversation" });
    await userEvent.click(btn);
    const dlg = screen.getByRole("dialog");
    expect(dlg.closest(".modal-overlay")?.parentElement).toBe(document.body);
    expect(within(dlg).getByRole("log")).toBeTruthy();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(btn);
    await userEvent.click(btn);
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(btn);
  });

  it("AIW-7: running state is shared across widgets", () => {
    useAiSessionStore.setState({
      run: { status: "running", question: "q", startedAt: Date.now(), line: "Adding a chart…" },
    });
    render(
      wrap(
        <>
          <AiWidgetRenderer widget={w(LARGE)} />
          <AiWidgetRenderer widget={w({ x: 0, y: 0, w: 6, h: 10 })} />
        </>,
      ),
    );
    expect(screen.getAllByRole("button", { name: "Cancel" })).toHaveLength(2);
    expect(screen.getAllByRole("status")).toHaveLength(2);
  });

  it("AIW-8: StrictMode drawer focuses Close", async () => {
    render(
      <React.StrictMode>{wrap(<AiWidgetRenderer widget={w({ x: 0, y: 0, w: 6, h: 10 })} />)}</React.StrictMode>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Open conversation" }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close" }));
  });

  it("AIW-9: WidgetRenderer routes type ai to the AI shell, not the aggregated renderer", () => {
    const ai = render(wrap(<WidgetRenderer widget={w(LARGE)} />));
    expect(ai.container.querySelector(".ai-widget")).toBeTruthy();
    ai.unmount();
    const bar = render(wrap(<WidgetRenderer widget={w(LARGE, "bar")} />));
    expect(bar.container.querySelector(".ai-widget")).toBeNull();
  });
  it("APPRCHAT-9: a pending proposal opens the drawer by itself and the tile line says so", async () => {
    const small = { x: 0, y: 0, w: 6, h: 10 };
    const { container } = render(wrap(<AiWidgetRenderer widget={w(small)} />));
    expect(screen.queryByRole("dialog")).toBeNull();
    await act(async () => {
      useAiSessionStore.getState().applyTurn(
        { prompt: "q", answer: "plan", ops: [], chat: { status: "ok", answerId: 3, followUps: [], applied: [], proposal: { ops: [], ticked: [], status: "pending" } } },
        baseline,
      );
    });
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(container.querySelector(".ai-tile-last")?.textContent).toBe("Changes proposed \u2014 review");
  });

  it("APPRCHAT-10: a normal answer does not open the drawer", async () => {
    const small = { x: 0, y: 0, w: 6, h: 10 };
    render(wrap(<AiWidgetRenderer widget={w(small)} />));
    await act(async () => {
      useAiSessionStore.getState().applyTurn({ prompt: "q", answer: "plain", ops: [], chat: { status: "ok", answerId: 3, followUps: [] } }, baseline);
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("AiWidgetRenderer Viewer AI (152)", () => {
  const SMALL = { x: 0, y: 0, w: 6, h: 10 };
  const setVai = (mode: "off" | "answers_filters" | "session_only", restricted: boolean) =>
    useViewerAiStore.getState().set({ dashboardId: 1, mode, restricted });
  afterEach(() => useViewerAiStore.getState().reset());

  it("VAITILE-1: restricted + off, large tile -> note only", () => {
    setVai("off", true);
    render(wrap(<AiWidgetRenderer widget={w(LARGE)} />));
    const note = screen.getByRole("note");
    expect(note.textContent).toBe("AI is off for this dashboard.");
    expect(note.classList.contains("ai-widget-notice")).toBe(true);
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("VAITILE-2: restricted + off, small tile -> note, no history, no textbox", () => {
    setVai("off", true);
    render(wrap(<AiWidgetRenderer widget={w(SMALL)} />));
    expect(screen.getByRole("note").textContent).toBe("AI is off for this dashboard.");
    expect(screen.queryByRole("button", { name: "Open conversation" })).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("VAITILE-3: NOT restricted + off -> normal ask box", () => {
    setVai("off", false);
    render(wrap(<AiWidgetRenderer widget={w(LARGE)} />));
    expect(screen.getByPlaceholderText("Ask a question about this dashboard")).toBeTruthy();
  });

  it.each([["large", LARGE], ["small", SMALL]])("VAITILE-4: restricted + answers_filters placeholder (%s)", (_n, layout) => {
    setVai("answers_filters", true);
    render(wrap(<AiWidgetRenderer widget={w(layout)} />));
    expect(screen.getByPlaceholderText("Ask a question or filter the dashboard")).toBeTruthy();
  });

  it("VAITILE-5: answers_filters hides starters; session_only keeps them", () => {
    const starter = "Show total fare_amount by payment_type";
    setVai("answers_filters", true);
    const r = render(wrap(<AiWidgetRenderer widget={w(LARGE)} />));
    expect(screen.queryByRole("button", { name: starter })).toBeNull();
    r.unmount();
    setVai("session_only", true);
    render(wrap(<AiWidgetRenderer widget={w(LARGE)} />));
    expect(screen.getByRole("button", { name: starter })).toBeTruthy();
  });

  it("VAITILE-6: store untouched -> today's placeholder and starters", () => {
    render(wrap(<AiWidgetRenderer widget={w(LARGE)} />));
    expect(screen.getByPlaceholderText("Ask a question about this dashboard")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Show total fare_amount by payment_type" })).toBeTruthy();
  });
});
