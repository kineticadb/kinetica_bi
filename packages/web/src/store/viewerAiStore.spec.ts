import { describe, it, expect, beforeEach } from "vitest";
import { useViewerAiStore, selectEffectiveViewerAi, isViewerAiRestricted } from "./viewerAiStore";

describe("viewerAiStore", () => {
  beforeEach(() => useViewerAiStore.getState().reset());

  it("VAISTORE-1: initial state is session_only", () => {
    expect(selectEffectiveViewerAi(useViewerAiStore.getState())).toBe("session_only");
  });

  it("VAISTORE-2: the mode only applies to restricted users", () => {
    useViewerAiStore.getState().set({ dashboardId: 7, mode: "off", restricted: true });
    expect(selectEffectiveViewerAi(useViewerAiStore.getState())).toBe("off");
    useViewerAiStore.getState().set({ dashboardId: 7, mode: "off", restricted: false });
    expect(selectEffectiveViewerAi(useViewerAiStore.getState())).toBe("session_only");
  });

  it("VAISTORE-3: switchMode targets the open dashboard only; reset restores the initial state", () => {
    const s = useViewerAiStore.getState();
    s.set({ dashboardId: 7, mode: "session_only", restricted: true });
    s.switchMode(7, "answers_filters");
    expect(useViewerAiStore.getState().mode).toBe("answers_filters");
    s.switchMode(8, "off");
    expect(useViewerAiStore.getState().mode).toBe("answers_filters");
    s.reset();
    expect(useViewerAiStore.getState()).toMatchObject({ dashboardId: null, mode: "session_only", restricted: false });
  });

  it("VAISTORE-4: isViewerAiRestricted truth table", () => {
    expect(isViewerAiRestricted({ canEdit: true, ownUnkept: false, canCreate: false })).toBe(false);
    expect(isViewerAiRestricted({ canEdit: false, ownUnkept: true, canCreate: true })).toBe(false);
    expect(isViewerAiRestricted({ canEdit: false, ownUnkept: true, canCreate: false })).toBe(true);
    expect(isViewerAiRestricted({ canEdit: false, ownUnkept: false, canCreate: true })).toBe(true);
  });
});
