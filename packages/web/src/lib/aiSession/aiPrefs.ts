// 149: per-user AI preferences (server-stored). Loaded on each AiChat mount, deduped while in flight; defaults shown until loaded. Phase 150 adds approveFirst here.
import { create } from "zustand";
import { getAiPrefs, setAiPrefs } from "../../api/client";
import { useToastStore } from "../../store/toast";

export const useAiPrefsStore = create<{ showRatingButtons: boolean }>(() => ({ showRatingButtons: true }));

let inflight: Promise<void> | null = null;
let touchedSeq = 0;

export function loadAiPrefs(): Promise<void> {
  if (inflight) return inflight;
  const startSeq = touchedSeq;
  inflight = getAiPrefs()
    .then((p) => {
      if (touchedSeq === startSeq) useAiPrefsStore.setState({ showRatingButtons: p.showRatingButtons });
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

export function __resetAiPrefsForTest(): void {
  useAiPrefsStore.setState({ showRatingButtons: true });
  inflight = null;
  touchedSeq = 0;
}
