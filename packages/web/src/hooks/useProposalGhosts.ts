// 150: computes ghost previews for the pending proposal and stores them (never in derived).
import { useEffect } from "react";
import { useAiSessionStore, selectPendingProposal } from "../store/aiSessionStore";
import { buildProposalGhosts } from "../lib/aiSession/proposalGhosts";
import type { ProposalGhosts, SessionBaseline } from "../lib/aiSession/types";

export function useProposalGhosts(getBaseline: () => SessionBaseline | null): ProposalGhosts | null {
  const turnId = useAiSessionStore((s) => selectPendingProposal(s)?.turnId ?? null);
  const tickedKey = useAiSessionStore((s) => selectPendingProposal(s)?.proposal.ticked.join(",") ?? "");
  const cursor = useAiSessionStore((s) => s.cursor);
  useEffect(() => {
    const st = useAiSessionStore.getState();
    const p = selectPendingProposal(st);
    const baseline = getBaseline();
    if (!p || !baseline) {
      if (st.proposalGhosts !== null) st.setProposalGhosts(null);
      return;
    }
    const prior = [...st.baseEntries, ...st.turns.slice(0, st.cursor + 1).flatMap((t) => t.entries)];
    st.setProposalGhosts(buildProposalGhosts({ baseline, priorEntries: prior, ops: p.proposal.ops, ticked: p.proposal.ticked, removalApproved: false }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turnId, tickedKey, cursor]);
  return useAiSessionStore((s) => s.proposalGhosts);
}
