import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render } from "@testing-library/react";

vi.mock("../../lib/aiSession/askRunner", async () => {
  const actual = await vi.importActual<typeof import("../../lib/aiSession/askRunner")>("../../lib/aiSession/askRunner");
  return { ...actual, runAsk: vi.fn(async () => {}), cancelAsk: vi.fn() };
});
vi.mock("../../lib/aiSession/aiAvailability", () => ({ useAiConfigured: vi.fn(() => true) }));

import { useAiConfigured } from "../../lib/aiSession/aiAvailability";
import { runAsk, type AskContext } from "../../lib/aiSession/askRunner";
import {
  GENERATE_DEFAULT_QUESTION,
  setGenerateIntent,
  takeGenerateIntent,
  __resetGenerateIntentForTest,
} from "../../lib/aiSession/generateIntent";
import { useAiSessionStore } from "../../store/aiSessionStore";
import { useAuthStore } from "../../store/auth";
import { DashboardContextProvider } from "../DashboardContext";
import type { WidgetDto } from "../../api/client";
import { AiWidgetRenderer } from "./AiWidgetRenderer";

const mkCtx = (dashboardId: number): AskContext => ({
  dashboardId,
  getBaseline: () => ({ dashboardId, widgets: [], layers: [], dynamicViewIds: [] }),
  getSnapshot: () => ({}) as never,
  tables: [],
});
const widget = { id: 7, dashboard_id: 42, type: "ai", title: "AI", config: { layout: { x: 0, y: 0, w: 12, h: 40 } } } as unknown as WidgetDto;
const tree = (ctx: AskContext, strict = false) => {
  const inner = (
    <DashboardContextProvider dashboardId={ctx.dashboardId} widgets={[]} dynamicViews={[]} retryDynamicView={() => {}} ai={ctx}>
      <AiWidgetRenderer widget={widget} />
    </DashboardContextProvider>
  );
  return strict ? <React.StrictMode>{inner}</React.StrictMode> : inner;
};
const setPerm = (can: boolean) => useAuthStore.setState({ user: { permissions: can ? ["ai:use"] : [] } as never });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useAiConfigured).mockReturnValue(true);
  __resetGenerateIntentForTest();
  useAiSessionStore.getState().reset();
  setPerm(true);
});

describe("AiWidgetRenderer generate start", () => {
  it("GENSTART-1: StrictMode starts exactly one ask and clears the intent", () => {
    setGenerateIntent(42, "");
    const ctx = mkCtx(42);
    render(tree(ctx, true));
    expect(runAsk).toHaveBeenCalledTimes(1);
    expect(runAsk).toHaveBeenCalledWith(ctx, GENERATE_DEFAULT_QUESTION);
    expect(takeGenerateIntent(42)).toBeNull();
  });

  it("GENSTART-2: no intent -> no ask", () => {
    render(tree(mkCtx(42), true));
    expect(runAsk).not.toHaveBeenCalled();
  });

  it("GENSTART-3: another dashboard's intent is untouched", () => {
    setGenerateIntent(41, "x");
    render(tree(mkCtx(42), true));
    expect(runAsk).not.toHaveBeenCalled();
    expect(takeGenerateIntent(41)).toEqual({ question: "x" });
  });

  it("GENSTART-4: waits for configured; never when false or without ai:use", () => {
    setGenerateIntent(42, "go");
    const ctx = mkCtx(42);
    vi.mocked(useAiConfigured).mockReturnValue(null as never);
    const r = render(tree(ctx));
    expect(runAsk).not.toHaveBeenCalled();
    vi.mocked(useAiConfigured).mockReturnValue(true);
    r.rerender(tree(ctx));
    expect(runAsk).toHaveBeenCalledTimes(1);
    expect(runAsk).toHaveBeenCalledWith(ctx, "go");
    r.unmount();

    vi.clearAllMocks();
    setGenerateIntent(42, "go");
    vi.mocked(useAiConfigured).mockReturnValue(false);
    const r2 = render(tree(ctx));
    expect(runAsk).not.toHaveBeenCalled();
    r2.unmount();

    vi.mocked(useAiConfigured).mockReturnValue(true);
    setPerm(false);
    render(tree(ctx));
    expect(runAsk).not.toHaveBeenCalled();
  });

  it("GENSTART-5: re-render with a new ctx object does not ask again", () => {
    setGenerateIntent(42, "go");
    const r = render(tree(mkCtx(42)));
    expect(runAsk).toHaveBeenCalledTimes(1);
    act(() => r.rerender(tree(mkCtx(42))));
    expect(runAsk).toHaveBeenCalledTimes(1);
  });
});
