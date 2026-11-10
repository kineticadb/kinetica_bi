import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../api/client", () => ({
  getAiPrefs: vi.fn(async () => ({ showRatingButtons: true, approveFirst: true })),
  setAiPrefs: vi.fn(async (p: object) => ({ showRatingButtons: true, approveFirst: false, ...p })),
}));

import { getAiPrefs, setAiPrefs } from "../../api/client";
import { useAiPrefsStore, loadAiPrefs, setApproveFirst, __resetAiPrefsForTest } from "./aiPrefs";
import { useToastStore } from "../../store/toast";

beforeEach(() => {
  __resetAiPrefsForTest();
  vi.clearAllMocks();
  useToastStore.setState({ toasts: [], _lastShown: new Map() });
});

describe("aiPrefs approveFirst", () => {
  it("APPRPREF-W1: loads approveFirst from the server; default false before load", async () => {
    expect(useAiPrefsStore.getState().approveFirst).toBe(false);
    await loadAiPrefs();
    expect(useAiPrefsStore.getState().approveFirst).toBe(true);
  });

  it("APPRPREF-W2: setApproveFirst is optimistic, PUTs only approveFirst, rolls back with a toast on failure", async () => {
    await setApproveFirst(true);
    expect(useAiPrefsStore.getState().approveFirst).toBe(true);
    expect(setAiPrefs).toHaveBeenCalledWith({ approveFirst: true });
    __resetAiPrefsForTest();
    vi.mocked(setAiPrefs).mockRejectedValueOnce(new Error("nope"));
    const p = setApproveFirst(true);
    expect(useAiPrefsStore.getState().approveFirst).toBe(true);
    await p;
    expect(useAiPrefsStore.getState().approveFirst).toBe(false);
    expect(useToastStore.getState().toasts.map((t) => t.message)).toContain("Couldn't save the setting.");
  });

  it("APPRPREF-W3: a late load does not overwrite the user's choice", async () => {
    let resolve!: (v: { showRatingButtons: boolean; approveFirst: boolean }) => void;
    vi.mocked(getAiPrefs).mockReturnValueOnce(new Promise((r) => (resolve = r)));
    const load = loadAiPrefs();
    await setApproveFirst(false);
    useAiPrefsStore.setState({ approveFirst: false });
    await setApproveFirst(true);
    resolve({ showRatingButtons: true, approveFirst: false });
    await load;
    expect(useAiPrefsStore.getState().approveFirst).toBe(true);
  });
});
