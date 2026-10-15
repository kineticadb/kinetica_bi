import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runAsk, cancelAsk, choiceQuestion, type AskContext } from "./askRunner";
import { useAiSessionStore, selectHasUnsavedAiChanges } from "../../store/aiSessionStore";
import { useToastStore } from "../../store/toast";
import { baselineFixture, mapWidget, savedLayer, addWidgetOp, addLayerOp, patchLayerOp, removeLayerOp } from "../../test/aiSessionHarness";
import { AI_CHAT_COPY } from "./chatText";
import { useFilterStore } from "../../store/filterStore";
import { recordsWidget, applyFilterRaw } from "../../test/aiSessionHarness";

vi.mock("../aiOps/aiFilterZeroRows", () => ({
  checkZeroRowFilters: vi.fn().mockResolvedValue(undefined),
  readFirstCount: vi.fn(),
}));

const enc = new TextEncoder();
const frame = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
const sseResponse = (frames: string[], keepOpen = false) =>
  new Response(
    new ReadableStream<Uint8Array>({
      start(c) {
        for (const f of frames) c.enqueue(enc.encode(f));
        if (!keepOpen) c.close();
      },
    }),
    { status: 200, headers: { "Content-Type": "text/event-stream" } },
  );
const json = (b: unknown, status: number) =>
  new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
const result = (over: Record<string, unknown> = {}) =>
  frame("result", { answerId: 1, text: "Done.", ops: [], skipped: [], clarifications: [], followUps: [], applied: [], ...over });

const st = () => useAiSessionStore.getState();
let baseline = baselineFixture();
const mkCtx = (): AskContext => ({
  dashboardId: 1,
  getBaseline: () => baseline,
  getSnapshot: () => ({ widgets: [], layers: [], dynamicViews: [], filters: [] }),
  tables: [],
});
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  cancelAsk();
  st().reset();
  useToastStore.setState({ toasts: [], _lastShown: new Map() });
  baseline = baselineFixture();
});
afterEach(() => vi.restoreAllMocks());

describe("askRunner", () => {
  it("RUN-1: a result applies one ok turn with highlight and idles", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      sseResponse([
        frame("status", { phase: "thinking", label: "t" }),
        result({ text: "Added.", ops: [addWidgetOp(-1)], followUps: ["f1", "f2"], applied: ["Added bar"] }),
        frame("done", { answerId: 1, outcome: "ok", steps: 1 }),
      ]),
    );
    await runAsk(mkCtx(), "add one");
    expect(st().turns).toHaveLength(1);
    expect(st().turns[0].chat).toMatchObject({ status: "ok", followUps: ["f1", "f2"], applied: ["Added bar"] });
    expect(st().turns[0].answer).toBe("Added.");
    expect(st().derived.addedWidgets).toHaveLength(1);
    expect(st().highlight.ids).toContain(-1);
    expect(st().highlight.nonce).toBeGreaterThan(0);
    expect(st().run.status).toBe("idle");
  });

  it("RUN-2: a second runAsk while running does not fetch", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(sseResponse([result()]));
    const p1 = runAsk(mkCtx(), "one");
    const p2 = runAsk(mkCtx(), "two");
    await Promise.all([p1, p2]);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(st().turns).toHaveLength(1);
    expect(st().turns[0].prompt).toBe("one");
  });

  it("RUN-3: cancel records a cancelled turn, refills the draft, no toast", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(sseResponse([frame("status", { phase: "thinking", label: "t" })], true));
    const p = runAsk(mkCtx(), "slow question");
    await flush();
    expect(st().run.status).toBe("running");
    cancelAsk();
    await p;
    expect(st().turns[0].chat?.status).toBe("cancelled");
    expect(st().turns[0].entries).toEqual([]);
    expect(st().draft).toBe("slow question");
    expect(useToastStore.getState().toasts).toHaveLength(0);
    expect(st().run.status).toBe("idle");
    expect(selectHasUnsavedAiChanges(st())).toBe(false);
  });

  it("RUN-4: SSE error toasts, records the exact message, applies nothing", async () => {
    const msg = "The AI provider could not complete this answer. Try again.";
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(sseResponse([frame("error", { code: "AI_PROVIDER_ERROR", message: msg })]));
    await runAsk(mkCtx(), "q");
    expect(useToastStore.getState().toasts.map((t) => [t.message, t.kind])).toEqual([[msg, "error"]]);
    expect(st().turns[0].chat).toMatchObject({ status: "error", message: msg, retryable: true });
    expect(st().turns[0].entries).toEqual([]);
  });

  it("RUN-5: HTTP errors (429 / 409 / 403)", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    spy.mockResolvedValueOnce(json({ code: "AI_CAP_HOUR", message: "Hourly limit reached", retryAfterSeconds: 60 }, 429));
    await runAsk(mkCtx(), "a");
    expect(st().turns[0].chat).toMatchObject({ message: "Hourly limit reached", retryable: false });
    expect(useToastStore.getState().toasts[0].message).toBe("Hourly limit reached");
    spy.mockResolvedValueOnce(json({ code: "AI_BUSY", message: "Busy right now" }, 409));
    await runAsk(mkCtx(), "b");
    expect(st().turns[1].chat).toMatchObject({ message: "Busy right now", retryable: true });
    const errToasts = () => useToastStore.getState().toasts.filter((t) => t.kind === "error").length;
    const toastsBefore = errToasts(); // apiFetch itself raises its own permission toast on 403; the runner adds no error toast
    spy.mockResolvedValueOnce(json({ code: "PERMISSION_DENIED", message: "nope" }, 403));
    await runAsk(mkCtx(), "c");
    expect(errToasts()).toBe(toastsBefore);
    expect(st().turns[2].chat).toMatchObject({ message: AI_CHAT_COPY.noAccess, retryable: false });
  });

  it("RUN-6: a stream that ends without result/error is a lost connection", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(sseResponse([frame("status", { phase: "thinking", label: "t" })]));
    await runAsk(mkCtx(), "q");
    expect(st().turns[0].chat).toMatchObject({ status: "error", errorCode: "AI_CONNECTION_LOST", retryable: true });
    expect(useToastStore.getState().toasts).toHaveLength(1);
    expect(st().turns[0].entries).toEqual([]);
  });

  it("RUN-7: a result after reset() is dropped", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        new ReadableStream<Uint8Array>({
          async start(c) {
            await gate;
            c.enqueue(enc.encode(result({ ops: [addWidgetOp(-1)] })));
            c.close();
          },
        }),
        { status: 200 },
      ),
    );
    const p = runAsk(mkCtx(), "q");
    await flush();
    st().reset();
    release();
    await p;
    expect(st().turns).toHaveLength(0);
    expect(st().derived.addedWidgets).toHaveLength(0);
    expect(st().run.status).toBe("idle");
  });

  it("RUN-8: choice pick approves removal and is recorded", async () => {
    const confirm = { kind: "confirm_remove" as const, question: "Remove?", options: [{ id: "yes", label: "Yes" }, { id: "no", label: "No" }] };
    const spy = vi.spyOn(globalThis, "fetch");
    spy.mockResolvedValueOnce(sseResponse([result({ text: "Sure?", clarifications: [confirm] })]));
    await runAsk(mkCtx(), "remove it");
    spy.mockResolvedValueOnce(sseResponse([result({ text: "Removed." })]));
    await runAsk(mkCtx(), choiceQuestion(confirm, "yes"), { pick: { turnIndex: 0, clarificationIndex: 0, optionId: "yes", approveRemoval: true } });
    const body = JSON.parse(spy.mock.calls[1][1]!.body as string);
    expect(body.approvals).toEqual({ removeSaved: true });
    expect(body.question).toBe("Yes, remove it");
    expect(st().turns[0].chat?.pickedChoice).toEqual({ clarificationIndex: 0, optionId: "yes" });
    expect(st().removalApproved).toBe(true);
    expect(choiceQuestion(confirm, "no")).toBe("No, keep it");
    const cm = { kind: "choose_map" as const, question: "?", options: [{ id: "12", label: "Trips" }] };
    expect(choiceQuestion(cm, "12")).toBe('Use the map "Trips" (widget 12)');
    const co = { kind: "choose_option" as const, question: "?", options: [{ id: "1", label: "By vendor" }] };
    expect(choiceQuestion(co, "1")).toBe("By vendor");
  });

  it("RUN-9: layer add/edit/remove on an AI-added layer highlights the host map", async () => {
    baseline = baselineFixture({ widgets: [mapWidget(117, { includedLayerIds: [23] })], layers: [savedLayer(23, { config: { renderMode: "heatmap" } })] });
    const spy = vi.spyOn(globalThis, "fetch");
    spy.mockResolvedValueOnce(sseResponse([result({ ops: [addLayerOp(-1, 117)] })]));
    await runAsk(mkCtx(), "t1");
    expect(st().derived.addedLayers.map((l) => l.id)).toEqual([-1]);
    expect(st().highlight.ids).toContain(117);
    st().setHighlight([]);
    spy.mockResolvedValueOnce(sseResponse([result({ ops: [patchLayerOp(-1, { colormap: "magma" })] })]));
    await runAsk(mkCtx(), "t2");
    expect(st().turns[1].entries[0].result.status).toBe("applied");
    expect(st().highlight.ids).toContain(117);
    st().setHighlight([]);
    spy.mockResolvedValueOnce(sseResponse([result({ ops: [removeLayerOp(-1)] })]));
    await runAsk(mkCtx(), "t3");
    expect(st().turns[2].entries[0].result.status).toBe("applied");
    expect(st().highlight.ids).toContain(117);
  });

  it("RUNF-1 (138-06): a streamed apply_filter narrows filterStore with deltas, notes and outline", async () => {
    useFilterStore.getState().reset();
    baseline = baselineFixture({ widgets: [mapWidget(42), recordsWidget(50, { tableId: 5 })], layers: [savedLayer(7)] });
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      sseResponse([
        result({ text: "Done.", ops: [applyFilterRaw({ kind: "table", id: 5 }, "payment_type", "Credit")] }),
        frame("done", { answerId: 1, outcome: "ok", steps: 1 }),
      ]),
    );
    await runAsk(mkCtx(), "only credit");
    const f = useFilterStore.getState().filters[5];
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ column: "payment_type", value: "Credit", aiApplied: true });
    expect(st().turns[0].entries[0].filterDeltas).toHaveLength(1);
    expect(st().turns[0].chat?.filterNotes?.[0]).toBe("Filtered trips to payment_type = 'Credit' (2 widgets).");
    expect(st().turns[0].answer).toBe("Done.");
    expect([...st().highlight.ids].sort((a, b) => a - b)).toEqual([42, 50]);
  });
});
