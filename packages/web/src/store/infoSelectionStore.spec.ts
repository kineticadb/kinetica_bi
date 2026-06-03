import { describe, it, expect } from "vitest";
import { useInfoSelectionStore } from "./infoSelectionStore";

describe("useInfoSelectionStore — canary (PITFALL S-03 — Zustand shim must cover src/store/*.ts)", () => {
  it("store is empty at start of each test", () => {
    expect(useInfoSelectionStore.getState().state).toEqual({});
    expect(useInfoSelectionStore.getState().activeLayerId).toBeNull();
  });

  it("store is empty at start of each test (run 2 — proves shim resets between tests)", () => {
    expect(useInfoSelectionStore.getState().state).toEqual({});
    expect(useInfoSelectionStore.getState().activeLayerId).toBeNull();
  });
});

describe("useInfoSelectionStore — setSelection", () => {
  it("creates a fresh entry on first call (rows/columns/page/hasMore populated; loading=false; error=null)", () => {
    useInfoSelectionStore.getState().setSelection(1, {
      rows: [{ id: 1 }, { id: 2 }],
      columns: ["id"],
      page: 0,
      hasMore: true,
    });
    expect(useInfoSelectionStore.getState().state[1]).toEqual({
      rows: [{ id: 1 }, { id: 2 }],
      columns: ["id"],
      page: 0,
      hasMore: true,
      loading: false,
      error: null,
      currentIndex: 0,
    });
  });

  it("REPLACE on second call wipes prior rows/columns/page/hasMore (no append)", () => {
    useInfoSelectionStore.getState().setSelection(1, {
      rows: [{ id: 1 }],
      columns: ["id"],
      page: 0,
      hasMore: true,
    });
    useInfoSelectionStore.getState().setSelection(1, {
      rows: [{ name: "Alice" }],
      columns: ["name"],
      page: 2,
      hasMore: false,
    });
    const entry = useInfoSelectionStore.getState().state[1];
    expect(entry.rows).toEqual([{ name: "Alice" }]);
    expect(entry.columns).toEqual(["name"]);
    expect(entry.page).toBe(2);
    expect(entry.hasMore).toBe(false);
  });

  // CONTEXT.md § Action contract lock — required regression for the v0 plan that hard-coded loading: false.
  // Test name MUST contain "preserves prior loading" (grep-verifiable acceptance criterion).
  it("setSelection preserves prior loading flag (CONTEXT.md § Action contract)", () => {
    useInfoSelectionStore.getState().setLoading(1, true);
    expect(useInfoSelectionStore.getState().state[1].loading).toBe(true);
    useInfoSelectionStore.getState().setSelection(1, {
      rows: [{ id: 1 }],
      columns: ["id"],
      page: 0,
      hasMore: false,
    });
    // Loading flag is STILL true after setSelection — caller is responsible for setLoading(false).
    expect(useInfoSelectionStore.getState().state[1].loading).toBe(true);
  });

  // Paired test: setSelection DOES clear error (judgment call — settled rows obsolete prior error).
  it("setSelection clears prior error to null (settled rows obsolete the prior error)", () => {
    useInfoSelectionStore.getState().setError(1, "boom");
    expect(useInfoSelectionStore.getState().state[1].error).toBe("boom");
    useInfoSelectionStore.getState().setSelection(1, {
      rows: [{ id: 1 }],
      columns: ["id"],
      page: 0,
      hasMore: false,
    });
    expect(useInfoSelectionStore.getState().state[1].error).toBeNull();
  });

  it("preserves reference identity for entries on other layerIds", () => {
    useInfoSelectionStore.getState().setSelection(1, { rows: [{ id: 1 }], columns: ["id"], page: 0, hasMore: false });
    useInfoSelectionStore.getState().setSelection(2, { rows: [{ id: 2 }], columns: ["id"], page: 0, hasMore: false });
    const before = useInfoSelectionStore.getState().state;
    useInfoSelectionStore.getState().setSelection(1, { rows: [{ id: 99 }], columns: ["id"], page: 1, hasMore: true });
    const after = useInfoSelectionStore.getState().state;
    expect(after[2]).toBe(before[2]); // layerId=2 entry reference unchanged
    expect(after[1]).not.toBe(before[1]); // layerId=1 entry replaced
  });
});

describe("useInfoSelectionStore — appendPage", () => {
  it("no-op when state[layerId] absent (state object identity preserved)", () => {
    const before = useInfoSelectionStore.getState().state;
    useInfoSelectionStore.getState().appendPage(999, { rows: [{ id: 1 }], page: 1, hasMore: false });
    const after = useInfoSelectionStore.getState().state;
    expect(after).toBe(before); // reference equality — store-level no-op
    expect(after[999]).toBeUndefined();
  });

  it("appends rows onto existing entry; sets page + hasMore from payload; columns unchanged", () => {
    useInfoSelectionStore.getState().setSelection(1, {
      rows: [{ id: 1 }, { id: 2 }],
      columns: ["id"],
      page: 0,
      hasMore: true,
    });
    useInfoSelectionStore.getState().appendPage(1, { rows: [{ id: 3 }], page: 1, hasMore: false });
    const entry = useInfoSelectionStore.getState().state[1];
    expect(entry.rows).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
    expect(entry.page).toBe(1);
    expect(entry.hasMore).toBe(false);
    expect(entry.columns).toEqual(["id"]); // unchanged
  });

  it("multiple appends accumulate (page 1 → 2 → 3 rows compound)", () => {
    useInfoSelectionStore.getState().setSelection(1, { rows: [{ id: 1 }], columns: ["id"], page: 0, hasMore: true });
    useInfoSelectionStore.getState().appendPage(1, { rows: [{ id: 2 }], page: 1, hasMore: true });
    useInfoSelectionStore.getState().appendPage(1, { rows: [{ id: 3 }], page: 2, hasMore: false });
    const entry = useInfoSelectionStore.getState().state[1];
    expect(entry.rows).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
    expect(entry.page).toBe(2);
    expect(entry.hasMore).toBe(false);
  });
});

describe("useInfoSelectionStore — clearSelection", () => {
  it("no-op when key absent (state object identity preserved)", () => {
    useInfoSelectionStore.getState().setSelection(1, { rows: [{ id: 1 }], columns: ["id"], page: 0, hasMore: false });
    const before = useInfoSelectionStore.getState().state;
    useInfoSelectionStore.getState().clearSelection(999);
    const after = useInfoSelectionStore.getState().state;
    expect(after).toBe(before); // reference equality
  });

  it("removes the per-layerId entry when present", () => {
    useInfoSelectionStore.getState().setSelection(1, { rows: [{ id: 1 }], columns: ["id"], page: 0, hasMore: false });
    expect(1 in useInfoSelectionStore.getState().state).toBe(true);
    useInfoSelectionStore.getState().clearSelection(1);
    expect(1 in useInfoSelectionStore.getState().state).toBe(false);
  });
});

describe("useInfoSelectionStore — setActiveLayer (STORE-V14-05 layer-switch page reset)", () => {
  it("same-layer call is a full no-op (state object identity preserved)", () => {
    useInfoSelectionStore.getState().setSelection(1, { rows: [{ id: 1 }], columns: ["id"], page: 0, hasMore: false });
    useInfoSelectionStore.getState().setActiveLayer(1);
    const beforeState = useInfoSelectionStore.getState().state;
    const beforeActive = useInfoSelectionStore.getState().activeLayerId;
    useInfoSelectionStore.getState().setActiveLayer(1); // same layer
    const afterState = useInfoSelectionStore.getState().state;
    const afterActive = useInfoSelectionStore.getState().activeLayerId;
    expect(afterState).toBe(beforeState); // reference equality
    expect(afterActive).toBe(beforeActive);
  });

  it("initial setActiveLayer when activeLayerId is null: just sets activeLayerId, no prior delete", () => {
    expect(useInfoSelectionStore.getState().activeLayerId).toBeNull();
    useInfoSelectionStore.getState().setSelection(7, { rows: [{ id: 1 }], columns: ["id"], page: 0, hasMore: false });
    useInfoSelectionStore.getState().setActiveLayer(7);
    expect(useInfoSelectionStore.getState().activeLayerId).toBe(7);
    expect(useInfoSelectionStore.getState().state[7]).toBeDefined(); // entry NOT touched
  });

  // STORE-V14-05 explicit invariant test — Phase 20 success criterion #4.
  it("STORE-V14-05: setActiveLayer(B) when current is A wipes A's entry — page counter reset to 0 (entry gone)", () => {
    // Phase 20 success criterion #4 — set page > 0 on layer A, switch to B, assert state[A] gone.
    useInfoSelectionStore.getState().setSelection(1, { rows: [{ id: 1 }], columns: ["id"], page: 5, hasMore: true });
    useInfoSelectionStore.getState().setActiveLayer(1);
    expect(useInfoSelectionStore.getState().state[1].page).toBe(5);
    useInfoSelectionStore.getState().setActiveLayer(2);
    expect(useInfoSelectionStore.getState().state[1]).toBeUndefined();
    expect(useInfoSelectionStore.getState().activeLayerId).toBe(2);
  });

  it("setActiveLayer does NOT touch the new layer's existing entry (preserves cached entry on B)", () => {
    useInfoSelectionStore.getState().setSelection(1, { rows: [{ id: 1 }], columns: ["id"], page: 0, hasMore: false });
    useInfoSelectionStore.getState().setSelection(2, { rows: [{ id: 2 }], columns: ["id"], page: 3, hasMore: true });
    useInfoSelectionStore.getState().setActiveLayer(1);
    const beforeB = useInfoSelectionStore.getState().state[2];
    useInfoSelectionStore.getState().setActiveLayer(2); // switch to B
    const afterB = useInfoSelectionStore.getState().state[2];
    expect(afterB).toBe(beforeB); // identity preserved — setActiveLayer left B alone
    expect(afterB.rows).toEqual([{ id: 2 }]);
    expect(afterB.page).toBe(3);
  });
});

describe("useInfoSelectionStore — setLoading", () => {
  it("creates placeholder entry when layerId absent", () => {
    useInfoSelectionStore.getState().setLoading(1, true);
    expect(useInfoSelectionStore.getState().state[1]).toEqual({
      rows: [],
      columns: [],
      page: 0,
      hasMore: false,
      loading: true,
      error: null,
      currentIndex: 0,
    });
  });

  it("updates existing entry without losing rows/columns/page/hasMore/error", () => {
    useInfoSelectionStore.getState().setSelection(1, {
      rows: [{ id: 1 }],
      columns: ["id"],
      page: 2,
      hasMore: true,
    });
    useInfoSelectionStore.getState().setError(1, "stale");
    useInfoSelectionStore.getState().setLoading(1, true);
    const entry = useInfoSelectionStore.getState().state[1];
    expect(entry.rows).toEqual([{ id: 1 }]);
    expect(entry.columns).toEqual(["id"]);
    expect(entry.page).toBe(2);
    expect(entry.hasMore).toBe(true);
    expect(entry.error).toBe("stale"); // setLoading does NOT touch error
    expect(entry.loading).toBe(true);
  });
});

describe("useInfoSelectionStore — setError", () => {
  it("creates placeholder entry when layerId absent", () => {
    useInfoSelectionStore.getState().setError(1, "Network error");
    expect(useInfoSelectionStore.getState().state[1]).toEqual({
      rows: [],
      columns: [],
      page: 0,
      hasMore: false,
      loading: false,
      error: "Network error",
      currentIndex: 0,
    });
  });

  // Append-fail invariant — locked in CONTEXT.md § specifics.
  it("preserves prior rows when setError fires (append-fail UX lock)", () => {
    useInfoSelectionStore.getState().setSelection(1, { rows: [{ id: 1 }, { id: 2 }], columns: ["id"], page: 1, hasMore: true });
    useInfoSelectionStore.getState().setError(1, "Network error on page 2");
    const entry = useInfoSelectionStore.getState().state[1];
    expect(entry.rows).toEqual([{ id: 1 }, { id: 2 }]); // prior rows preserved
    expect(entry.error).toBe("Network error on page 2");
  });

  it("setting error to null clears it", () => {
    useInfoSelectionStore.getState().setError(1, "boom");
    expect(useInfoSelectionStore.getState().state[1].error).toBe("boom");
    useInfoSelectionStore.getState().setError(1, null);
    expect(useInfoSelectionStore.getState().state[1].error).toBeNull();
  });
});

describe("useInfoSelectionStore — reset", () => {
  it("from populated state: state === {} and activeLayerId === null", () => {
    useInfoSelectionStore.getState().setSelection(1, { rows: [{ id: 1 }], columns: ["id"], page: 0, hasMore: false });
    useInfoSelectionStore.getState().setSelection(2, { rows: [{ id: 2 }], columns: ["id"], page: 0, hasMore: false });
    useInfoSelectionStore.getState().setActiveLayer(2);
    expect(useInfoSelectionStore.getState().activeLayerId).toBe(2);
    useInfoSelectionStore.getState().reset();
    expect(useInfoSelectionStore.getState().state).toEqual({});
    expect(useInfoSelectionStore.getState().activeLayerId).toBeNull();
  });

  it("from empty state: idempotent — still state === {} and activeLayerId === null", () => {
    expect(useInfoSelectionStore.getState().state).toEqual({});
    expect(useInfoSelectionStore.getState().activeLayerId).toBeNull();
    useInfoSelectionStore.getState().reset();
    expect(useInfoSelectionStore.getState().state).toEqual({});
    expect(useInfoSelectionStore.getState().activeLayerId).toBeNull();
  });
});

describe("useInfoSelectionStore — currentIndex (single-record nav)", () => {
  it("setSelection resets currentIndex to 0 (fresh-click semantics)", () => {
    useInfoSelectionStore.getState().setSelection(1, {
      rows: [{ id: 1 }, { id: 2 }, { id: 3 }],
      columns: ["id"],
      page: 0,
      hasMore: false,
    });
    useInfoSelectionStore.getState().setCurrentIndex(1, 2);
    expect(useInfoSelectionStore.getState().state[1].currentIndex).toBe(2);
    // Fresh click resets to 0 even if user was deep in pagination
    useInfoSelectionStore.getState().setSelection(1, {
      rows: [{ id: 10 }],
      columns: ["id"],
      page: 0,
      hasMore: false,
    });
    expect(useInfoSelectionStore.getState().state[1].currentIndex).toBe(0);
  });

  it("appendPage preserves currentIndex (Load-more / Next-past-end semantics)", () => {
    useInfoSelectionStore.getState().setSelection(1, {
      rows: [{ id: 1 }, { id: 2 }],
      columns: ["id"],
      page: 0,
      hasMore: true,
    });
    useInfoSelectionStore.getState().setCurrentIndex(1, 1);
    useInfoSelectionStore.getState().appendPage(1, {
      rows: [{ id: 3 }, { id: 4 }],
      page: 1,
      hasMore: false,
    });
    expect(useInfoSelectionStore.getState().state[1].currentIndex).toBe(1);
    expect(useInfoSelectionStore.getState().state[1].rows.length).toBe(4);
  });

  it("setCurrentIndex updates index when entry exists", () => {
    useInfoSelectionStore.getState().setSelection(1, {
      rows: [{ id: 1 }, { id: 2 }],
      columns: ["id"],
      page: 0,
      hasMore: false,
    });
    useInfoSelectionStore.getState().setCurrentIndex(1, 1);
    expect(useInfoSelectionStore.getState().state[1].currentIndex).toBe(1);
  });

  it("setCurrentIndex is a no-op when entry is absent (store does not invent entries)", () => {
    useInfoSelectionStore.getState().setCurrentIndex(99, 5);
    expect(useInfoSelectionStore.getState().state[99]).toBeUndefined();
  });

  it("setCurrentIndex is a no-op when same index (reference-stable)", () => {
    useInfoSelectionStore.getState().setSelection(1, {
      rows: [{ id: 1 }],
      columns: ["id"],
      page: 0,
      hasMore: false,
    });
    const before = useInfoSelectionStore.getState().state[1];
    useInfoSelectionStore.getState().setCurrentIndex(1, 0);
    const after = useInfoSelectionStore.getState().state[1];
    expect(after).toBe(before); // same object reference
  });
});
