import { describe, it, expect } from "vitest";
import { useFilterViewStore } from "./filterViewStore";

describe("useFilterViewStore — canary (PITFALL S-03 — Zustand shim must cover src/store/*.ts)", () => {
  it("store is empty at start of each test", () => {
    expect(useFilterViewStore.getState().views).toEqual({});
  });

  it("store is empty at start of each test (run 2 — proves shim resets between tests)", () => {
    expect(useFilterViewStore.getState().views).toEqual({});
  });
});

describe("useFilterViewStore — setView", () => {
  it("creates a new entry on first call (materializeVersion=1, materializing=false)", () => {
    useFilterViewStore.getState().setView(1, { viewName: "_kbi_filt_v1", expiresAt: 1000 }, 100);
    const entry = useFilterViewStore.getState().views[1];
    expect(entry).toEqual({
      viewName: "_kbi_filt_v1",
      expiresAt: 1000,
      materializing: false,
      materializeVersion: 1,
      dashboardId: 100, // NEW field
    });
  });

  it("bumps materializeVersion when overwriting same viewName (CREATE OR REPLACE content swap)", () => {
    useFilterViewStore.getState().setView(1, { viewName: "_kbi_filt_v1", expiresAt: 1000 }, 100);
    useFilterViewStore.getState().setView(1, { viewName: "_kbi_filt_v1", expiresAt: 2000 }, 100);
    const entry = useFilterViewStore.getState().views[1];
    expect(entry.materializeVersion).toBe(2);
    expect(entry.expiresAt).toBe(2000);
    expect(entry.materializing).toBe(false);
  });

  it("resets materializeVersion to 1 on new viewName", () => {
    useFilterViewStore.getState().setView(1, { viewName: "_kbi_filt_v1", expiresAt: 1000 }, 100);
    useFilterViewStore.getState().setView(1, { viewName: "_kbi_filt_v1", expiresAt: 1500 }, 100); // bumps to 2
    useFilterViewStore.getState().setView(1, { viewName: "_kbi_filt_v1_new", expiresAt: 2000 }, 100);
    expect(useFilterViewStore.getState().views[1].materializeVersion).toBe(1);
  });

  it("clears materializing flag if it was set by markMaterializing", () => {
    useFilterViewStore.getState().markMaterializing(1, 100);
    expect(useFilterViewStore.getState().views[1].materializing).toBe(true);
    useFilterViewStore.getState().setView(1, { viewName: "_kbi_filt_v1", expiresAt: 1000 }, 100);
    expect(useFilterViewStore.getState().views[1].materializing).toBe(false);
  });

  it("preserves reference identity for entries on other tableIds", () => {
    useFilterViewStore.getState().setView(1, { viewName: "_kbi_filt_v1", expiresAt: 1000 }, 100);
    useFilterViewStore.getState().setView(2, { viewName: "_kbi_filt_v2", expiresAt: 2000 }, 100);
    const before = useFilterViewStore.getState().views;
    useFilterViewStore.getState().setView(1, { viewName: "_kbi_filt_v1_new", expiresAt: 3000 }, 100);
    const after = useFilterViewStore.getState().views;
    expect(after[2]).toBe(before[2]);          // tableId=2 entry reference unchanged
    expect(after[1]).not.toBe(before[1]);      // tableId=1 entry replaced
  });
});

describe("useFilterViewStore — markMaterializing", () => {
  it("creates entry with materializing=true when key absent", () => {
    useFilterViewStore.getState().markMaterializing(1, 100);
    expect(useFilterViewStore.getState().views[1]).toEqual({
      viewName: "",
      expiresAt: 0,
      materializing: true,
      materializeVersion: 0,
      dashboardId: 100,
    });
  });

  it("preserves prior viewName/expiresAt/materializeVersion when entry exists", () => {
    useFilterViewStore.getState().setView(1, { viewName: "_kbi_filt_v1", expiresAt: 1000 }, 100);
    useFilterViewStore.getState().markMaterializing(1, 100);
    const entry = useFilterViewStore.getState().views[1];
    expect(entry.viewName).toBe("_kbi_filt_v1");
    expect(entry.expiresAt).toBe(1000);
    expect(entry.materializeVersion).toBe(1);
    expect(entry.materializing).toBe(true);
  });

  it("preserves reference identity for entries on other tableIds", () => {
    useFilterViewStore.getState().setView(2, { viewName: "_kbi_filt_v2", expiresAt: 2000 }, 100);
    const before = useFilterViewStore.getState().views;
    useFilterViewStore.getState().markMaterializing(1, 100);
    const after = useFilterViewStore.getState().views;
    expect(after[2]).toBe(before[2]);
  });
});

describe("useFilterViewStore — clearView", () => {
  it("deletes the key (tableId in views becomes false)", () => {
    useFilterViewStore.getState().setView(1, { viewName: "_kbi_filt_v1", expiresAt: 1000 }, 100);
    useFilterViewStore.getState().clearView(1);
    expect(1 in useFilterViewStore.getState().views).toBe(false);
  });

  it("no-op when key absent (returns same state reference)", () => {
    useFilterViewStore.getState().setView(2, { viewName: "_kbi_filt_v2", expiresAt: 2000 }, 100);
    const before = useFilterViewStore.getState().views;
    useFilterViewStore.getState().clearView(999);
    const after = useFilterViewStore.getState().views;
    expect(after).toBe(before); // reference equality — no-op short-circuit
  });

  it("preserves reference identity for entries on other tableIds when deleting", () => {
    useFilterViewStore.getState().setView(1, { viewName: "_kbi_filt_v1", expiresAt: 1000 }, 100);
    useFilterViewStore.getState().setView(2, { viewName: "_kbi_filt_v2", expiresAt: 2000 }, 100);
    const before = useFilterViewStore.getState().views;
    useFilterViewStore.getState().clearView(1);
    const after = useFilterViewStore.getState().views;
    expect(after[2]).toBe(before[2]);
  });
});

describe("useFilterViewStore — bumpMaterializeVersion", () => {
  it("increments existing entry's materializeVersion by 1", () => {
    useFilterViewStore.getState().setView(1, { viewName: "_kbi_filt_v1", expiresAt: 1000 }, 100);
    expect(useFilterViewStore.getState().views[1].materializeVersion).toBe(1);
    useFilterViewStore.getState().bumpMaterializeVersion(1);
    expect(useFilterViewStore.getState().views[1].materializeVersion).toBe(2);
  });

  it("no-op when entry missing", () => {
    const before = useFilterViewStore.getState().views;
    useFilterViewStore.getState().bumpMaterializeVersion(999);
    const after = useFilterViewStore.getState().views;
    expect(after).toBe(before);
  });
});

describe("useFilterViewStore — clearMaterializing", () => {
  it("sets materializing=false on an entry that has materializing=true", () => {
    useFilterViewStore.getState().markMaterializing(1, 100);
    expect(useFilterViewStore.getState().views[1].materializing).toBe(true);
    useFilterViewStore.getState().clearMaterializing(1);
    expect(useFilterViewStore.getState().views[1].materializing).toBe(false);
  });

  it("no-op when entry is absent (returns same state reference)", () => {
    const beforeViews = useFilterViewStore.getState().views;
    const beforeVersion = useFilterViewStore.getState().clearMaterializingVersion;
    useFilterViewStore.getState().clearMaterializing(999);
    const afterViews = useFilterViewStore.getState().views;
    const afterVersion = useFilterViewStore.getState().clearMaterializingVersion;
    expect(afterViews).toBe(beforeViews); // reference equality — no-op short-circuit
    expect(afterVersion).toBe(beforeVersion); // version unchanged on no-op
  });

  it("no-op when materializing is already false (returns same state reference)", () => {
    useFilterViewStore.getState().setView(1, { viewName: "_kbi_filt_v1", expiresAt: 1000 }, 100);
    expect(useFilterViewStore.getState().views[1].materializing).toBe(false);
    const beforeViews = useFilterViewStore.getState().views;
    const beforeVersion = useFilterViewStore.getState().clearMaterializingVersion;
    useFilterViewStore.getState().clearMaterializing(1);
    const afterViews = useFilterViewStore.getState().views;
    const afterVersion = useFilterViewStore.getState().clearMaterializingVersion;
    expect(afterViews).toBe(beforeViews); // reference equality — no-op short-circuit
    expect(afterVersion).toBe(beforeVersion); // version unchanged on no-op
  });

  it("preserves viewName, expiresAt, materializeVersion, dashboardId on the entry", () => {
    useFilterViewStore.getState().setView(1, { viewName: "_kbi_filt_v1", expiresAt: 5000 }, 42);
    useFilterViewStore.getState().markMaterializing(1, 42);
    useFilterViewStore.getState().clearMaterializing(1);
    const entry = useFilterViewStore.getState().views[1];
    expect(entry).toEqual({
      viewName: "_kbi_filt_v1",
      expiresAt: 5000,
      materializing: false,
      materializeVersion: 1,
      dashboardId: 42,
    });
  });

  it("preserves reference identity for entries on other tableIds", () => {
    useFilterViewStore.getState().setView(2, { viewName: "_kbi_filt_v2", expiresAt: 2000 }, 100);
    useFilterViewStore.getState().markMaterializing(1, 100);
    const before = useFilterViewStore.getState().views;
    useFilterViewStore.getState().clearMaterializing(1);
    const after = useFilterViewStore.getState().views;
    expect(after[2]).toBe(before[2]); // tableId=2 entry reference unchanged
  });

  it("increments clearMaterializingVersion on non-no-op call (enables Effect 2 re-fire without materializing dep)", () => {
    useFilterViewStore.getState().markMaterializing(1, 100);
    const vBefore = useFilterViewStore.getState().clearMaterializingVersion;
    useFilterViewStore.getState().clearMaterializing(1);
    const vAfter = useFilterViewStore.getState().clearMaterializingVersion;
    expect(vAfter).toBe(vBefore + 1);
  });
});

describe("useFilterViewStore — reset", () => {
  it("empties views to {}", () => {
    useFilterViewStore.getState().setView(1, { viewName: "_kbi_filt_v1", expiresAt: 1000 }, 100);
    useFilterViewStore.getState().setView(2, { viewName: "_kbi_filt_v2", expiresAt: 2000 }, 100);
    useFilterViewStore.getState().reset();
    expect(useFilterViewStore.getState().views).toEqual({});
  });
});

describe("useFilterViewStore — dashboardId field (Phase 15-02 extension)", () => {
  it("setView persists dashboardId on the entry", () => {
    useFilterViewStore.getState().setView(1, { viewName: "v1", expiresAt: 1000 }, 42);
    expect(useFilterViewStore.getState().views[1].dashboardId).toBe(42);
  });

  it("markMaterializing persists dashboardId on placeholder entry when key absent", () => {
    useFilterViewStore.getState().markMaterializing(1, 42);
    expect(useFilterViewStore.getState().views[1].dashboardId).toBe(42);
  });

  it("markMaterializing OVERWRITES dashboardId when entry exists (V13-P-09 multi-tab last-write-wins)", () => {
    useFilterViewStore.getState().setView(1, { viewName: "v1", expiresAt: 1000 }, 42);
    useFilterViewStore.getState().markMaterializing(1, 99); // different dashboardId
    expect(useFilterViewStore.getState().views[1].dashboardId).toBe(99);
  });

  it("setView preserves materializeVersion bump while updating dashboardId", () => {
    useFilterViewStore.getState().setView(1, { viewName: "v1", expiresAt: 1000 }, 42);
    useFilterViewStore.getState().setView(1, { viewName: "v1", expiresAt: 2000 }, 50);
    const entry = useFilterViewStore.getState().views[1];
    expect(entry.materializeVersion).toBe(2);
    expect(entry.dashboardId).toBe(50);
  });

  it("bumpMaterializeVersion preserves existing dashboardId field", () => {
    useFilterViewStore.getState().setView(1, { viewName: "v1", expiresAt: 1000 }, 42);
    useFilterViewStore.getState().bumpMaterializeVersion(1);
    expect(useFilterViewStore.getState().views[1].dashboardId).toBe(42);
  });
});
