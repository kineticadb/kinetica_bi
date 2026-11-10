// 149: per-user AI preferences (server-stored). Loaded on each AiChat mount, deduped while in flight; defaults shown until loaded. 150: approveFirst (Approve changes first).
import { create } from "zustand";
import { getAiPrefs, setAiPrefs } from "../../api/client";
import { useToastStore } from "../../store/toast";

export const useAiPrefsStore = create<{ showRatingButtons: boolean; approveFirst: boolean }>(() => ({ showRatingButtons: true, approveFirst: false }));

let inflight: Promise<void> | null = null;
let touchedSeq = 0;

export function loadAiPrefs(): Promise<void> {
  if (inflight) return inflight;
  const startSeq = touchedSeq;
  inflight = getAiPrefs()
    .then((p) => {
      if (touchedSeq === startSeq) useAiPrefsStore.setState({ showRatingButtons: p.showRatingButtons, approveFirst: p.approveFirst === true });
    })
    .catch(() => {})
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export async function setShowRatingButtons(v: boolean): Promise<void> {
  const prev = useAiPrefsStore.getState().showRatingButtons;
  touchedSeq++;
  useAiPrefsStore.setState({ showRatingButtons: v });
  try {
    await setAiPrefs({ showRatingButtons: v });
  } catch {
    useAiPrefsStore.setState({ showRatingButtons: prev });
    useToastStore.getState().showToast("Couldn't save the setting.", "error");
  }
}

export async function setApproveFirst(v: boolean): Promise<void> {
  const prev = useAiPrefsStore.getState().approveFirst;
  touchedSeq++;
  useAiPrefsStore.setState({ approveFirst: v });
  try {
    await setAiPrefs({ approveFirst: v });
  } catch {
    useAiPrefsStore.setState({ approveFirst: prev });
    useToastStore.getState().showToast("Couldn't save the setting.", "error");
  }
}

export function __resetAiPrefsForTest(): void {
  useAiPrefsStore.setState({ showRatingButtons: true, approveFirst: false });
  inflight = null;
  touchedSeq = 0;
}
