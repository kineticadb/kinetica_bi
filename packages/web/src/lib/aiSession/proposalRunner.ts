// 150 (APPROVE-V22-03): tick, apply and reject a pending proposal. Apply sends only {selected, snapshot}; the client folds ONLY the ops the server re-checked and returned, into the same turn, through applyAiTurn.
import { aiOpDependencies, closeSelection, dependentsOf } from "@kinetica-bi/shared";
import { applyAiProposal, rejectAiProposal } from "../../api/client";
import { useAiSessionStore, selectPendingProposal } from "../../store/aiSessionStore";
import { useToastStore } from "../../store/toast";
import { applyAiTurn } from "../aiOps/applyAiTurn";
import type { AskContext } from "./askRunner";

export const PROPOSAL_RUNNER_COPY = {
  applyFailed: "Couldn't apply the changes. Try again.",
  rejectFailed: "Couldn't reject the changes. Try again.",
  decided: "These changes were already decided.",
} as const;

const toast = (m: string) => useToastStore.getState().showToast(m, "error");

/** Tick keeps the selection closed under dependencies: ticking pulls prerequisites in, unticking drops dependents. */
export function toggleProposalTick(turnId: string, index: number, on: boolean): void {
  const store = useAiSessionStore.getState();
  const t = store.turns.find((x) => x.id === turnId);
  const p = t?.chat?.proposal;
  if (!p || p.status !== "pending" || p.busy) return;
  const deps = aiOpDependencies(p.ops);
  let ticked: number[];
  if (on) {
    ticked = [...new Set([...p.ticked, ...closeSelection([index], deps)])].sort((a, b) => a - b);
  } else {
    const drop = new Set([index, ...dependentsOf(index, deps)]);
    ticked = p.ticked.filter((i) => !drop.has(i));
  }
  store.setProposal(turnId, { ticked, failed: undefined });
}

export async function applyPendingProposal(ctx: AskContext): Promise<void> {
  const store = useAiSessionStore.getState();
  const p = selectPendingProposal(store);
  if (!p || p.proposal.busy || p.proposal.ticked.length === 0) return;
  const epoch0 = store.epoch;
  store.setProposal(p.turnId, { busy: true });
  let r: Awaited<ReturnType<typeof applyAiProposal>>;
  try {
    r = await applyAiProposal(p.answerId, {
      selected: [...p.proposal.ticked].sort((a, b) => a - b),
      snapshot: ctx.getSnapshot(),
    });
  } catch {
    if (useAiSessionStore.getState().epoch === epoch0) {
      useAiSessionStore.getState().setProposal(p.turnId, { busy: false });
      toast(PROPOSAL_RUNNER_COPY.applyFailed);
    }
    return;
  }
  const cur = useAiSessionStore.getState();
  if (cur.epoch !== epoch0) return; // reset() already dropped the session; drop the late response
  if (!r.ok) {
    if (r.status === 410 || r.status === 409) {
      cur.setProposal(p.turnId, { status: "expired", ops: [], busy: false });
      if (r.status === 409) toast(PROPOSAL_RUNNER_COPY.decided);
    } else {
      cur.setProposal(p.turnId, { busy: false });
      toast(r.message ?? PROPOSAL_RUNNER_COPY.applyFailed);
    }
    return;
  }
  if (r.data.outcome === "none") {
    cur.setProposal(p.turnId, { busy: false, failed: r.data.failed });
    return;
  }
  const turn = cur.turns[p.turnIndex];
  if (!turn?.chat) return;
  applyAiTurn(
    {
      prompt: turn.prompt,
      answer: turn.answer,
      ops: r.data.accepted,
      chat: {
        ...turn.chat,
        applied: r.data.applied,
        proposal: { ...p.proposal, ops: [], busy: false, status: r.data.outcome, failed: r.data.failed, unticked: r.data.unticked },
      },
      replaceTurnId: p.turnId,
    },
    ctx.getBaseline(),
  );
}

export async function rejectPendingProposal(): Promise<void> {
  const store = useAiSessionStore.getState();
  const p = selectPendingProposal(store);
  if (!p || p.proposal.busy) return;
  const epoch0 = store.epoch;
  store.setProposal(p.turnId, { busy: true });
  try {
    await rejectAiProposal(p.answerId); // any HTTP answer (ok, 404, 409, 410): nothing was applied either way
  } catch {
    if (useAiSessionStore.getState().epoch === epoch0) {
      useAiSessionStore.getState().setProposal(p.turnId, { busy: false });
      toast(PROPOSAL_RUNNER_COPY.rejectFailed);
    }
    return;
  }
  const cur = useAiSessionStore.getState();
  if (cur.epoch !== epoch0) return;
  cur.setProposal(p.turnId, { status: "rejected", ops: [], busy: false });
}
