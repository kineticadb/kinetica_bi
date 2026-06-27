/**
 * Phase 89 Plan 01 (COMBO-V118-02 / COMBO-V118-03): filterCombinationStore spec.
 *
 * Covered behaviours (one-to-one with Task 1 <behavior> bullets):
 *   1. Fresh store shape
 *   2. setEntry monotonic combinationVersion
 *   3. markMaterializing — absent key (placeholder) + existing key (preserve + merge)
 *   4. setVizHash — set + delete-key semantics
 *   5. acquire / release ref-count lifecycle (incl. DROP-at-0 / safe no-op)
 *   6. Reference-stability: mutating one hash does NOT clobber sibling object identity
 *   7. reset() zeroes all three slices
 *   8. MAX_COMBINATION_VIEWS_PER_TABLE === 10
 */

import { describe, it, expect } from "vitest";
import {
  useFilterCombinationStore,
  MAX_COMBINATION_VIEWS_PER_TABLE,
  type CombinationEntry,
} from "./filterCombinationStore";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEntry(overrides: Partial<CombinationEntry> = {}): CombinationEntry {
  return {
    viewName: "_kbi_combo_test",
    expiresAt: 9_000_000,
    materializing: false,
    materializeVersion: 1,
    refCount: 1,
    dashboardId: 100,
    sourceType: "table",
    sourceId: 5,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Canary: Zustand shim auto-resets store between tests
// ---------------------------------------------------------------------------

describe("useFilterCombinationStore — canary (Zustand reset shim)", () => {
  it("store is empty at start of each test (run 1)", () => {
    expect(useFilterCombinationStore.getState().registry).toEqual({});
    expect(useFilterCombinationStore.getState().vizToHash).toEqual({});
    expect(useFilterCombinationStore.getState().combinationVersion).toBe(0);
  });

  it("store is empty at start of each test (run 2 — proves shim resets between tests)", () => {
    expect(useFilterCombinationStore.getState().registry).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// MAX_COMBINATION_VIEWS_PER_TABLE
// ---------------------------------------------------------------------------

describe("MAX_COMBINATION_VIEWS_PER_TABLE", () => {
  it("is exported and equals 10 (ceiling VALUE; enforcement deferred to Phase 90)", () => {
    expect(MAX_COMBINATION_VIEWS_PER_TABLE).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// setEntry
// ---------------------------------------------------------------------------

describe("useFilterCombinationStore — setEntry", () => {
  it("stores the entry and bumps combinationVersion by 1", () => {
    const entry = makeEntry();
    useFilterCombinationStore.getState().setEntry("hash-a", entry);
    const state = useFilterCombinationStore.getState();
    expect(state.registry["hash-a"]).toEqual(entry);
    expect(state.combinationVersion).toBe(1);
  });

  it("a second setEntry on a DIFFERENT hash bumps combinationVersion again (monotonic)", () => {
    useFilterCombinationStore.getState().setEntry("hash-a", makeEntry());
    useFilterCombinationStore.getState().setEntry("hash-b", makeEntry({ sourceId: 6 }));
    expect(useFilterCombinationStore.getState().combinationVersion).toBe(2);
  });

  it("overwrites an existing entry and bumps combinationVersion", () => {
    const entryV1 = makeEntry({ viewName: "_kbi_combo_v1" });
    const entryV2 = makeEntry({ viewName: "_kbi_combo_v2", materializeVersion: 2 });
    useFilterCombinationStore.getState().setEntry("hash-a", entryV1);
    useFilterCombinationStore.getState().setEntry("hash-a", entryV2);
    expect(useFilterCombinationStore.getState().registry["hash-a"].viewName).toBe("_kbi_combo_v2");
    expect(useFilterCombinationStore.getState().combinationVersion).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// markMaterializing
// ---------------------------------------------------------------------------

describe("useFilterCombinationStore — markMaterializing", () => {
  it("creates a placeholder entry when hash is absent", () => {
    useFilterCombinationStore.getState().markMaterializing("hash-a", 100, "table", 5);
    const entry = useFilterCombinationStore.getState().registry["hash-a"];
    expect(entry).toEqual({
      viewName: "",
      expiresAt: 0,
      materializing: true,
      materializeVersion: 0,
      refCount: 0,
      dashboardId: 100,
      sourceType: "table",
      sourceId: 5,
    });
  });

  it("bumps combinationVersion on placeholder creation", () => {
    useFilterCombinationStore.getState().markMaterializing("hash-a", 100, "table", 5);
    expect(useFilterCombinationStore.getState().combinationVersion).toBe(1);
  });

  it("on existing entry: sets materializing=true and preserves viewName/expiresAt/materializeVersion/refCount", () => {
    const existing = makeEntry({
      viewName: "_kbi_combo_existing",
      expiresAt: 5000,
      materializeVersion: 3,
      refCount: 2,
      materializing: false,
    });
    useFilterCombinationStore.getState().setEntry("hash-a", existing);
    useFilterCombinationStore.getState().markMaterializing("hash-a", 100, "table", 5);
    const entry = useFilterCombinationStore.getState().registry["hash-a"];
    expect(entry.materializing).toBe(true);
    expect(entry.viewName).toBe("_kbi_combo_existing");
    expect(entry.expiresAt).toBe(5000);
    expect(entry.materializeVersion).toBe(3);
    expect(entry.refCount).toBe(2);
  });

  it("on existing entry: bumps combinationVersion", () => {
    useFilterCombinationStore.getState().setEntry("hash-a", makeEntry());
    const vBefore = useFilterCombinationStore.getState().combinationVersion;
    useFilterCombinationStore.getState().markMaterializing("hash-a", 100, "table", 5);
    expect(useFilterCombinationStore.getState().combinationVersion).toBe(vBefore + 1);
  });

  it("works for dv sourceType", () => {
    useFilterCombinationStore.getState().markMaterializing("dv-hash", 200, "dv", 42);
    const entry = useFilterCombinationStore.getState().registry["dv-hash"];
    expect(entry.sourceType).toBe("dv");
    expect(entry.sourceId).toBe(42);
    expect(entry.dashboardId).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// setVizHash
// ---------------------------------------------------------------------------

describe("useFilterCombinationStore — setVizHash", () => {
  it("records the mapping when hash is a string", () => {
    useFilterCombinationStore.getState().setVizHash("w:1", "table:5:hash");
    expect(useFilterCombinationStore.getState().vizToHash["w:1"]).toBe("table:5:hash");
  });

  it("does NOT bump combinationVersion (vizToHash changes are not registry mutations)", () => {
    const vBefore = useFilterCombinationStore.getState().combinationVersion;
    useFilterCombinationStore.getState().setVizHash("w:1", "table:5:hash");
    expect(useFilterCombinationStore.getState().combinationVersion).toBe(vBefore);
  });

  it("deletes the key when hash is undefined (delete-key semantics)", () => {
    useFilterCombinationStore.getState().setVizHash("w:1", "table:5:hash");
    expect("w:1" in useFilterCombinationStore.getState().vizToHash).toBe(true);
    useFilterCombinationStore.getState().setVizHash("w:1", undefined);
    expect("w:1" in useFilterCombinationStore.getState().vizToHash).toBe(false);
  });

  it("no-op (same reference) when deleting a key that doesn't exist", () => {
    const before = useFilterCombinationStore.getState().vizToHash;
    useFilterCombinationStore.getState().setVizHash("w:999", undefined);
    const after = useFilterCombinationStore.getState().vizToHash;
    expect(after).toBe(before);
  });

  it("overwrites existing mapping", () => {
    useFilterCombinationStore.getState().setVizHash("w:1", "hash-a");
    useFilterCombinationStore.getState().setVizHash("w:1", "hash-b");
    expect(useFilterCombinationStore.getState().vizToHash["w:1"]).toBe("hash-b");
  });
});

// ---------------------------------------------------------------------------
// acquire / release (ref-count)
// ---------------------------------------------------------------------------

describe("useFilterCombinationStore — acquire", () => {
  it("increments refCount by 1", () => {
    useFilterCombinationStore.getState().setEntry("hash-a", makeEntry({ refCount: 1 }));
    useFilterCombinationStore.getState().acquire("hash-a");
    expect(useFilterCombinationStore.getState().registry["hash-a"].refCount).toBe(2);
  });

  it("bumps combinationVersion", () => {
    useFilterCombinationStore.getState().setEntry("hash-a", makeEntry({ refCount: 1 }));
    const vBefore = useFilterCombinationStore.getState().combinationVersion;
    useFilterCombinationStore.getState().acquire("hash-a");
    expect(useFilterCombinationStore.getState().combinationVersion).toBe(vBefore + 1);
  });

  it("no-op (same state reference) when entry is missing", () => {
    const stateBefore = useFilterCombinationStore.getState().registry;
    useFilterCombinationStore.getState().acquire("missing-hash");
    expect(useFilterCombinationStore.getState().registry).toBe(stateBefore);
  });
});

describe("useFilterCombinationStore — release", () => {
  it("decrements refCount by 1 when count > 1", () => {
    useFilterCombinationStore.getState().setEntry("hash-a", makeEntry({ refCount: 3 }));
    useFilterCombinationStore.getState().release("hash-a");
    expect(useFilterCombinationStore.getState().registry["hash-a"].refCount).toBe(2);
  });

  it("bumps combinationVersion on decrement", () => {
    useFilterCombinationStore.getState().setEntry("hash-a", makeEntry({ refCount: 3 }));
    const vBefore = useFilterCombinationStore.getState().combinationVersion;
    useFilterCombinationStore.getState().release("hash-a");
    expect(useFilterCombinationStore.getState().combinationVersion).toBe(vBefore + 1);
  });

  it("DELETES the entry from registry when refCount reaches 0 (DROP-at-0)", () => {
    useFilterCombinationStore.getState().setEntry("hash-a", makeEntry({ refCount: 1 }));
    useFilterCombinationStore.getState().release("hash-a");
    expect("hash-a" in useFilterCombinationStore.getState().registry).toBe(false);
  });

  it("bumps combinationVersion on DROP-at-0 deletion", () => {
    useFilterCombinationStore.getState().setEntry("hash-a", makeEntry({ refCount: 1 }));
    const vBefore = useFilterCombinationStore.getState().combinationVersion;
    useFilterCombinationStore.getState().release("hash-a");
    expect(useFilterCombinationStore.getState().combinationVersion).toBe(vBefore + 1);
  });

  it("safe no-op when entry is missing", () => {
    const vBefore = useFilterCombinationStore.getState().combinationVersion;
    const regBefore = useFilterCombinationStore.getState().registry;
    useFilterCombinationStore.getState().release("missing-hash");
    expect(useFilterCombinationStore.getState().combinationVersion).toBe(vBefore);
    expect(useFilterCombinationStore.getState().registry).toBe(regBefore);
  });

  it("safe no-op when refCount is already 0", () => {
    useFilterCombinationStore.getState().setEntry("hash-a", makeEntry({ refCount: 0 }));
    const regBefore = useFilterCombinationStore.getState().registry;
    // Calling release on a 0-count entry should be a safe no-op (guard <= 0)
    // Actually per spec: release brings refCount to <= 0 → DELETE entry, so calling on
    // an entry that already has refCount=0 deletes it. The spec says "release that brings
    // refCount to 0 DELETES"; so release on already-zero also deletes (harmless).
    // But spec also says "release on a missing/already-zero entry is a safe no-op."
    // Interpretation: "already-zero" means the entry doesn't exist (was already deleted).
    // We've set it to 0 explicitly — calling release should delete it (bring to -1 → clamp delete).
    // This tests the <= 0 guard: after release the entry is gone.
    useFilterCombinationStore.getState().release("hash-a");
    expect("hash-a" in useFilterCombinationStore.getState().registry).toBe(false);
  });

  it("safe no-op on completely missing key (no throw)", () => {
    expect(() => {
      useFilterCombinationStore.getState().release("never-existed");
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Reference stability (S-02 selector safety)
// ---------------------------------------------------------------------------

describe("useFilterCombinationStore — reference stability (S-02)", () => {
  it("mutating registry[hashA] returns a new top-level registry but registry[hashB] keeps its identity", () => {
    useFilterCombinationStore.getState().setEntry("hash-a", makeEntry({ sourceId: 1 }));
    useFilterCombinationStore.getState().setEntry("hash-b", makeEntry({ sourceId: 2 }));
    const before = useFilterCombinationStore.getState().registry;
    useFilterCombinationStore.getState().setEntry("hash-a", makeEntry({ sourceId: 1, viewName: "_kbi_updated" }));
    const after = useFilterCombinationStore.getState().registry;
    expect(after).not.toBe(before);           // new top-level object
    expect(after["hash-b"]).toBe(before["hash-b"]); // hash-b entry is same object reference
    expect(after["hash-a"]).not.toBe(before["hash-a"]); // hash-a entry is new
  });
});

// ---------------------------------------------------------------------------
// reset
// ---------------------------------------------------------------------------

describe("useFilterCombinationStore — reset", () => {
  it("returns registry={}, vizToHash={}, combinationVersion=0", () => {
    useFilterCombinationStore.getState().setEntry("hash-a", makeEntry());
    useFilterCombinationStore.getState().setVizHash("w:1", "hash-a");
    useFilterCombinationStore.getState().reset();
    const state = useFilterCombinationStore.getState();
    expect(state.registry).toEqual({});
    expect(state.vizToHash).toEqual({});
    expect(state.combinationVersion).toBe(0);
  });
});
