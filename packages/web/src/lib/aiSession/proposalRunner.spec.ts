import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../api/client", async (orig) => ({
  ...(await orig<object>()),
  applyAiProposal: vi.fn(),
  rejectAiProposal: vi.fn(),
}));
vi.mock("../aiOps/aiFilterZeroRows", () => ({
  checkZeroRowFilters: vi.fn().mockResolvedValue(undefined),
  readFirstCount: vi.fn(),
}));

import { applyAiProposal, rejectAiProposal } from "../../api/client";
import { toggleProposalTick, applyPendingProposal, rejectPendingProposal } from "./proposalRunner";
import type { AskContext } from "./askRunner";
import { useAiSessionStore, hasPendingProposal, selectPendingProposal } from "../../store/aiSessionStore";
import { useFilterStore } from "../../store/filterStore";
import { useToastStore } from "../../store/toast";
import { baselineFixture, addWidgetOp, applyFilterRaw } from "../../test/aiSessionHarness";

const st = () => useAiSessionStore.getState();
const baseline = baselineFixture();
const snap = { widgets: [], layers: [], dynamicViews: [], filters: [] };
const ctx: AskContext = { dashboardId: 1, getBaseline: () => baseline, getSnapshot: () => snap, tables: [] };
const bar = () => addWidgetOp(-1, "records", "Bar A");
const flt = () => applyFilterRaw({ kind: "table", id: 5 }, "vendor_id", "V1");
const toasts = () => useToastStore.getState().toasts.map((t) => t.message);

function seed(ops: unknown[], answerId = 7): string {
  const { turnId } = st().applyTurn(
    { prompt: "make it", answer: "plan", ops: [], chat: { status: "ok", answerId, followUps: [], applied: [], proposal: { ops, ticked: ops.map((_, i) => i), status: "pending" } } },
    baseline,
  );
  return turnId;
}
const dto = (over: Record<string, unknown> = {}) => ({
  outcome: "applied" as const, accepted: [bar(), flt()], acceptedIndexes: [0, 1], applied: ['Add bar "Bar A"', "Filter on vendor"], failed: [], unticked: [], ...over,
});
const proposal = () => st().turns[0].chat!.proposal!;

beforeEach(() => {
  st().reset();
  vi.clearAllMocks();
  useToastStore.setState({ toasts: [], _lastShown: new Map() });
});

describe("proposalRunner", () => {
  it("APPRRUN-4: ticks stay closed under dependencies", () => {
    const id = seed([{ op: "add_dynamic_view", tempId: -1 }, { op: "add_widget", tempId: -2, type: "bar", title: "b", config: { dynamicViewId: -1 } }, addWidgetOp(-3)]);
    toggleProposalTick(id, 0, false);
    expect(proposal().ticked).toEqual([2]);
    toggleProposalTick(id, 1, true);
    expect(proposal().ticked).toEqual([0, 1, 2]);
    toggleProposalTick(id, 2, false);
    expect(proposal().ticked).toEqual([0, 1]);
  });

  it("APPRRUN-5: apply folds only the server ops into the same turn", async () => {
    const id = seed([bar(), flt()]);
    const v0 = useFilterStore.getState().filterVersion;
    const accepted = [{ ...bar(), layout: { x: 0, y: 0, w: 12, h: 8 } }, flt()];
    vi.mocked(applyAiProposal).mockResolvedValueOnce({ ok: true, data: dto({ accepted }) });
    await applyPendingProposal(ctx);
    expect(applyAiProposal).toHaveBeenCalledTimes(1);
    expect(applyAiProposal).toHaveBeenCalledWith(7, { selected: [0, 1], snapshot: snap });
    expect(st().turns).toHaveLength(1);
    expect(st().turns[0].id).toBe(id);
    expect(st().turns[0].entries.length).toBe(2);
    expect(st().turns[0].chat?.applied).toEqual(dto().applied);
    expect(proposal()).toMatchObject({ status: "applied", ops: [], busy: false });
    expect(st().derived.addedWidgets).toHaveLength(1);
    expect(hasPendingProposal()).toBe(false);
    expect(useFilterStore.getState().filterVersion).toBeGreaterThan(v0);
  });

  it("APPRRUN-6: partly applied records unticked and does not run the filter", async () => {
    seed([bar(), flt()]);
    const v0 = useFilterStore.getState().filterVersion;
    toggleProposalTick(st().turns[0].id, 1, false);
    vi.mocked(applyAiProposal).mockResolvedValueOnce({
      ok: true,
      data: dto({ outcome: "partly_applied", accepted: [bar()], acceptedIndexes: [0], applied: ['Add bar "A"'], unticked: ["Filter on vendor"] }),
    });
    await applyPendingProposal(ctx);
    expect(proposal().status).toBe("partly_applied");
    expect(proposal().unticked).toEqual(["Filter on vendor"]);
    expect(useFilterStore.getState().filterVersion).toBe(v0);
  });

  it("APPRRUN-7: outcome none keeps it pending with the reasons", async () => {
    seed([bar(), flt()]);
    const failed = [{ index: 0, label: "Add bar", stage: "live_schema", reasons: ["column fare not found"] }];
    vi.mocked(applyAiProposal).mockResolvedValueOnce({ ok: true, data: dto({ outcome: "none", accepted: [], acceptedIndexes: [], applied: [], failed }) });
    await applyPendingProposal(ctx);
    expect(proposal().status).toBe("pending");
    expect(proposal().failed).toEqual(failed);
    expect(proposal().busy).toBe(false);
    expect(st().derived.addedWidgets).toHaveLength(0);
    expect(hasPendingProposal()).toBe(true);
  });

  it("APPRRUN-8: 410 expires; 409 expires with a toast", async () => {
    seed([bar()]);
    vi.mocked(applyAiProposal).mockResolvedValueOnce({ ok: false, status: 410, code: "AI_PROPOSAL_GONE" });
    await applyPendingProposal(ctx);
    expect(proposal()).toMatchObject({ status: "expired", ops: [] });
    expect(hasPendingProposal()).toBe(false);
    st().reset();
    seed([bar()]);
    vi.mocked(applyAiProposal).mockResolvedValueOnce({ ok: false, status: 409, code: "AI_PROPOSAL_DECIDED" });
    await applyPendingProposal(ctx);
    expect(proposal().status).toBe("expired");
    expect(toasts()).toContain("These changes were already decided.");
  });

  it("APPRRUN-9: reject marks rejected without touching the dashboard", async () => {
    seed([bar()]);
    vi.mocked(rejectAiProposal).mockResolvedValueOnce({ ok: true, data: { outcome: "rejected" } });
    await rejectPendingProposal();
    expect(rejectAiProposal).toHaveBeenCalledWith(7);
    expect(proposal()).toMatchObject({ status: "rejected", ops: [] });
    expect(st().derived.addedWidgets).toHaveLength(0);
    expect(hasPendingProposal()).toBe(false);
    for (const status of [404, 409]) {
      st().reset();
      seed([bar()]);
      vi.mocked(rejectAiProposal).mockResolvedValueOnce({ ok: false, status });
      await rejectPendingProposal();
      expect(proposal().status).toBe("rejected");
    }
  });

  it("APPRRUN-10: a network error leaves it pending and toasts", async () => {
    seed([bar()]);
    vi.mocked(applyAiProposal).mockRejectedValueOnce(new Error("net"));
    await applyPendingProposal(ctx);
    expect(proposal()).toMatchObject({ status: "pending", busy: false });
    expect(toasts()).toContain("Couldn't apply the changes. Try again.");
    vi.mocked(rejectAiProposal).mockRejectedValueOnce(new Error("net"));
    await rejectPendingProposal();
    expect(proposal()).toMatchObject({ status: "pending", busy: false });
    expect(toasts()).toContain("Couldn't reject the changes. Try again.");
  });

  it("APPRRUN-11: a response after reset() is dropped", async () => {
    seed([bar(), flt()]);
    let resolve!: (v: unknown) => void;
    vi.mocked(applyAiProposal).mockReturnValueOnce(new Promise((r) => (resolve = r)) as never);
    const p = applyPendingProposal(ctx);
    st().reset();
    resolve({ ok: true, data: dto() });
    await p;
    expect(st().turns).toHaveLength(0);
    expect(st().derived.addedWidgets).toHaveLength(0);
    expect(toasts()).toEqual([]);
  });

  it("APPRRUN-12: Keep archives a pending proposal as expired with no ops", () => {
    seed([bar(), flt()]);
    st().setProposalGhosts({ widgets: [], rects: {}, layers: [], layerHosts: {} });
    st().completeKeep();
    const item = st().savedTurns.find((x) => x.kind === "turn");
    expect(item && item.kind === "turn" && item.chat?.proposal).toMatchObject({ ops: [], status: "expired" });
    expect(st().proposalGhosts).toBeNull();
    expect(selectPendingProposal(st())).toBeNull();
  });
});
