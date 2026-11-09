import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../../lib/aiSession/askRunner", async () => {
  const actual = await vi.importActual<typeof import("../../lib/aiSession/askRunner")>("../../lib/aiSession/askRunner");
  return { ...actual, runAsk: vi.fn(async () => {}), cancelAsk: vi.fn() };
});
vi.mock("../../api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api/client")>()),
  rateAiAnswer: vi.fn(async () => ({ rating: null })),
  getAiPrefs: vi.fn(async () => ({ showRatingButtons: true })),
  setAiPrefs: vi.fn(async (p: object) => ({ showRatingButtons: true, ...p })),
}));

import type { AskContext } from "../../lib/aiSession/askRunner";
import { rateAiAnswer, getAiPrefs, setAiPrefs } from "../../api/client";
import { useAiSessionStore } from "../../store/aiSessionStore";
import { useToastStore } from "../../store/toast";
import { __resetAiPrefsForTest } from "../../lib/aiSession/aiPrefs";
import { AI_CHAT_COPY } from "../../lib/aiSession/chatText";
import type { Turn, TurnChat } from "../../lib/aiSession/types";
import { AiChat } from "./AiChat";

const ctx: AskContext = {
  dashboardId: 1,
  getBaseline: () => ({ dashboardId: 1, widgets: [], layers: [], dynamicViewIds: [] }),
  getSnapshot: () => ({}) as never,
  tables: [{ id: 1, schema: "s", name: "taxi", columns: { fare_amount: "double" } }],
};

function turn(i: number, chat?: TurnChat): Turn {
  return { id: `t${i}`, prompt: `q${i}`, answer: `a${i}`, entries: [], createdAt: i, chat: chat ?? { status: "ok", followUps: [], answerId: 7 } };
}
function seed(turns: Turn[]) {
  useAiSessionStore.setState({ turns, cursor: turns.length - 1 });
}
const showToast = vi.fn();
const good = () => screen.getByRole("button", { name: "Good answer" });
const bad = () => screen.getByRole("button", { name: "Bad answer" });

beforeEach(() => {
  vi.clearAllMocks();
  useAiSessionStore.getState().reset();
  __resetAiPrefsForTest();
  useToastStore.setState({ showToast } as never);
});

describe("AiChat rating", () => {
  it("RATECHAT-1: thumbs save, switch and clear", async () => {
    seed([turn(0)]);
    render(<AiChat ctx={ctx} variant="inline" />);
    expect(good().getAttribute("aria-pressed")).toBe("false");
    expect(bad().getAttribute("aria-pressed")).toBe("false");
    await userEvent.click(good());
    expect(rateAiAnswer).toHaveBeenLastCalledWith(7, { rating: "up" });
    expect(good().getAttribute("aria-pressed")).toBe("true");
    await userEvent.click(bad());
    expect(rateAiAnswer).toHaveBeenLastCalledWith(7, { rating: "down" });
    expect(good().getAttribute("aria-pressed")).toBe("false");
    expect(bad().getAttribute("aria-pressed")).toBe("true");
    await userEvent.click(bad());
    expect(rateAiAnswer).toHaveBeenLastCalledWith(7, { rating: null });
    expect(good().getAttribute("aria-pressed")).toBe("false");
    expect(bad().getAttribute("aria-pressed")).toBe("false");
  });

  it("RATECHAT-2: no thumbs for cancelled, error, no answerId, or running", () => {
    seed([
      turn(0, { status: "cancelled" }),
      turn(1, { status: "error", message: "boom" }),
      turn(2, { status: "ok", followUps: [] }),
    ]);
    render(<AiChat ctx={ctx} variant="inline" />);
    expect(screen.queryByRole("button", { name: "Good answer" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Bad answer" })).toBeNull();
  });

  it("RATECHAT-2: running placeholder has no thumbs, finished turn does", () => {
    seed([turn(0)]);
    useAiSessionStore.setState({ run: { status: "running", question: "next?", line: "Working", startedAt: Date.now() } as never });
    render(<AiChat ctx={ctx} variant="inline" />);
    expect(screen.getAllByRole("button", { name: "Good answer" })).toHaveLength(1);
  });

  it("RATECHAT-3: down vote reasons are sent; Skip sends nothing", async () => {
    seed([turn(0)]);
    const { unmount } = render(<AiChat ctx={ctx} variant="inline" />);
    await userEvent.click(bad());
    const group = screen.getByRole("group", { name: "What went wrong? (optional)" });
    for (const n of ["Wrong data", "Wrong chart", "Didn't do what I asked", "Other"]) {
      expect(within(group).getByRole("button", { name: n })).toBeTruthy();
    }
    const box = screen.getByRole("textbox", { name: "Tell us more (optional)" }) as HTMLTextAreaElement;
    expect(box.maxLength).toBe(500);
    const chip = within(group).getByRole("button", { name: "Wrong chart" });
    await userEvent.click(chip);
    expect(chip.getAttribute("aria-pressed")).toBe("true");
    await userEvent.type(box, "the bars are wrong");
    await userEvent.click(screen.getByRole("button", { name: "Send feedback" }));
    expect(rateAiAnswer).toHaveBeenLastCalledWith(7, { rating: "down", reasons: ["wrong_chart"], note: "the bars are wrong" });
    expect(screen.getByText("Thanks for the feedback.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Send feedback" })).toBeNull();
    unmount();

    useAiSessionStore.getState().reset();
    vi.mocked(rateAiAnswer).mockClear();
    seed([turn(0)]);
    render(<AiChat ctx={ctx} variant="inline" />);
    await userEvent.click(bad());
    expect(rateAiAnswer).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(screen.queryByRole("group", { name: "What went wrong? (optional)" })).toBeNull();
    expect(rateAiAnswer).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Thanks for the feedback.")).toBeNull();
  });

  it("RATECHAT-4: switching to up drops the reasons", async () => {
    seed([turn(0)]);
    render(<AiChat ctx={ctx} variant="inline" />);
    await userEvent.click(bad());
    await userEvent.click(screen.getByRole("button", { name: "Wrong data" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Tell us more (optional)" }), "x");
    await userEvent.click(screen.getByRole("button", { name: "Send feedback" }));
    await userEvent.click(good());
    expect(rateAiAnswer).toHaveBeenLastCalledWith(7, { rating: "up" });
    const chat = useAiSessionStore.getState().turns[0].chat!;
    expect(chat.rating).toBe("up");
    expect(chat.ratingReasons).toBeUndefined();
    expect(chat.ratingNote).toBeUndefined();
    expect(screen.queryByRole("group", { name: "What went wrong? (optional)" })).toBeNull();
    expect(screen.queryByText("Thanks for the feedback.")).toBeNull();
  });

  it("RATECHAT-5: clarification-only answer has thumbs and no Revert", () => {
    seed([
      turn(0, {
        status: "ok",
        answerId: 7,
        followUps: [],
        clarifications: [{ kind: "choice", question: "Which?", options: [{ id: "a", label: "A" }] }] as never,
      }),
    ]);
    render(<AiChat ctx={ctx} variant="inline" />);
    expect(good()).toBeTruthy();
    expect(screen.queryByRole("button", { name: AI_CHAT_COPY.revert })).toBeNull();
  });

  it("RATECHAT-6: kept turn can be rated", async () => {
    useAiSessionStore.setState({
      savedTurns: [{ kind: "turn", id: "s1", prompt: "p", answer: "ans", chat: { status: "ok", answerId: 9 } }],
    });
    render(<AiChat ctx={ctx} variant="inline" />);
    await userEvent.click(good());
    expect(rateAiAnswer).toHaveBeenLastCalledWith(9, { rating: "up" });
    const item = useAiSessionStore.getState().savedTurns[0];
    expect(item.kind === "turn" && item.chat?.rating).toBe("up");
  });

  it("RATECHAT-7: Show rating buttons switch loads, saves, hides thumbs", async () => {
    seed([turn(0)]);
    render(<AiChat ctx={ctx} variant="inline" />);
    const cb = screen.getByRole("checkbox", { name: "Show rating buttons" }) as HTMLInputElement;
    expect(cb.checked).toBe(true);
    await userEvent.click(cb);
    expect(setAiPrefs).toHaveBeenCalledWith({ showRatingButtons: false });
    expect(screen.queryByRole("button", { name: "Good answer" })).toBeNull();
  });

  it("RATECHAT-7: loaded false pref hides thumbs; drawer has the checkbox; failed save reverts", async () => {
    vi.mocked(getAiPrefs).mockResolvedValueOnce({ showRatingButtons: false });
    seed([turn(0)]);
    const { unmount } = render(<AiChat ctx={ctx} variant="drawer" />);
    const cb = screen.getByRole("checkbox", { name: "Show rating buttons" }) as HTMLInputElement;
    await waitFor(() => expect(cb.checked).toBe(false));
    expect(screen.queryByRole("button", { name: "Good answer" })).toBeNull();
    unmount();

    __resetAiPrefsForTest();
    vi.mocked(setAiPrefs).mockRejectedValueOnce(new Error("nope"));
    render(<AiChat ctx={ctx} variant="inline" />);
    const cb2 = screen.getByRole("checkbox", { name: "Show rating buttons" }) as HTMLInputElement;
    await userEvent.click(cb2);
    await waitFor(() => expect(cb2.checked).toBe(true));
    expect(showToast).toHaveBeenCalledWith("Couldn't save the setting.", "error");
  });

  it("RATECHAT-8: failed rating save reverts and toasts", async () => {
    vi.mocked(rateAiAnswer).mockRejectedValueOnce(new Error("nope"));
    seed([turn(0)]);
    render(<AiChat ctx={ctx} variant="inline" />);
    await userEvent.click(good());
    await waitFor(() => expect(good().getAttribute("aria-pressed")).toBe("false"));
    expect(showToast).toHaveBeenCalledWith("Couldn't save your rating.", "error");
  });
});
