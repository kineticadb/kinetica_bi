import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../../lib/aiSession/askRunner", async () => {
  const actual = await vi.importActual<typeof import("../../lib/aiSession/askRunner")>("../../lib/aiSession/askRunner");
  return { ...actual, runAsk: vi.fn(async () => {}), cancelAsk: vi.fn() };
});
vi.mock("../../lib/aiSession/aiAvailability", () => ({ useAiConfigured: vi.fn(() => true) }));

import { useAiConfigured } from "../../lib/aiSession/aiAvailability";
import type { AskContext } from "../../lib/aiSession/askRunner";
import { useAiSessionStore } from "../../store/aiSessionStore";
import { useAuthStore } from "../../store/auth";
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
});
