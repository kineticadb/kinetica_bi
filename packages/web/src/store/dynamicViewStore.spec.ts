/**
 * dynamicViewStore.spec.ts — Phase 33 Plan 01 Task 2 (DV-V16-06).
 *
 * Vitest coverage for useDynamicViewStore. Locked semantics from 33-CONTEXT.md
 * § "Action contract" + § "dynamicViewVersion semantics".
 *
 * Test infra:
 *   - Zustand reset shim auto-resets between tests (vi.mock("zustand") in src/test/setup.ts).
 *   - No spec-side beforeEach reset boilerplate needed — shim handles it.
 *
 * Spec organization style mirrors `spatialFilterStore.spec.ts` (single top-level
 * describe per action group) — closest match for stores with several mutations +
 * no-op rules.
 */
import { describe, it, expect } from "vitest";
import { useDynamicViewStore } from "./dynamicViewStore";

describe("useDynamicViewStore — initial state", () => {
  it("starts with empty views and version 0", () => {
    const s = useDynamicViewStore.getState();
    expect(s.views).toEqual({});
    expect(s.dynamicViewVersion).toBe(0);
  });

  it("reading an unknown id returns undefined cleanly", () => {
    expect(useDynamicViewStore.getState().views[999]).toBeUndefined();
  });
});

describe("setView", () => {
  it("writes entry verbatim and bumps version", () => {
    useDynamicViewStore.getState().setView(1, {
      viewName: "_kbi_dv_ualice_d1_1",
      status: "materialized",
      expiresAt: 1000,
    });
    const s = useDynamicViewStore.getState();
    expect(s.views[1]).toEqual({
      viewName: "_kbi_dv_ualice_d1_1",
      status: "materialized",
      expiresAt: 1000,
    });
    expect(s.dynamicViewVersion).toBe(1);
  });

  it("ALWAYS bumps version on byte-identical payload (locked rule)", () => {
    useDynamicViewStore.getState().setView(1, {
      viewName: "v",
      status: "materialized",
      expiresAt: 1,
    });
    useDynamicViewStore.getState().setView(1, {
      viewName: "v",
      status: "materialized",
      expiresAt: 1,
    });
    expect(useDynamicViewStore.getState().dynamicViewVersion).toBe(2);
  });

  it("REPLACE semantics — payload without expiresAt produces entry without expiresAt", () => {
    useDynamicViewStore.getState().setView(1, {
      viewName: "a",
      status: "materialized",
      expiresAt: 100,
    });
    useDynamicViewStore.getState().setView(1, {
      viewName: "b",
      status: "over_threshold",
      reason: "no_filter",
    });
    const e = useDynamicViewStore.getState().views[1];
    expect(e).toEqual({
      viewName: "b",
      status: "over_threshold",
      reason: "no_filter",
    });
    expect("expiresAt" in e).toBe(false);
  });
});

describe("markPending", () => {
  it("creates placeholder { viewName, status: 'pending' } on absent entry", () => {
    useDynamicViewStore.getState().markPending(1, "_kbi_dv_ualice_d1_1");
    const e = useDynamicViewStore.getState().views[1];
    expect(e).toEqual({ viewName: "_kbi_dv_ualice_d1_1", status: "pending" });
    expect(useDynamicViewStore.getState().dynamicViewVersion).toBe(1);
  });

  it("on existing entry: status → pending, KEEPS prev viewName, strips expiresAt/error/reason", () => {
    useDynamicViewStore.getState().setView(1, {
      viewName: "_kbi_dv_a",
      status: "materialized",
      expiresAt: 1000,
    });
    useDynamicViewStore
      .getState()
      .markPending(1, "different_name_should_be_ignored");
    const e = useDynamicViewStore.getState().views[1];
    // CONTEXT.md § "Action contract" markPending bullet: "keep viewName unchanged".
    expect(e.viewName).toBe("_kbi_dv_a");
    expect(e.status).toBe("pending");
    expect("expiresAt" in e).toBe(false);
    expect("error" in e).toBe(false);
    expect("reason" in e).toBe(false);
  });

  it("ALWAYS bumps version on markPending-over-pending (locked rule)", () => {
    useDynamicViewStore.getState().markPending(1, "v");
    useDynamicViewStore.getState().markPending(1, "v");
    expect(useDynamicViewStore.getState().dynamicViewVersion).toBe(2);
  });
});

describe("setError", () => {
  it("preserves prior viewName, sets status='error', populates error, strips expiresAt/reason", () => {
    useDynamicViewStore.getState().setView(1, {
      viewName: "_kbi_dv_a",
      status: "materialized",
      expiresAt: 1000,
    });
    useDynamicViewStore.getState().setError(1, "Network down");
    const e = useDynamicViewStore.getState().views[1];
    expect(e).toEqual({
      viewName: "_kbi_dv_a",
      status: "error",
      error: "Network down",
    });
    expect("expiresAt" in e).toBe(false);
    expect("reason" in e).toBe(false);
  });

  it("ALWAYS bumps version on setError-over-already-error (locked rule)", () => {
    useDynamicViewStore
      .getState()
      .setView(1, { viewName: "v", status: "error", error: "msg1" });
    useDynamicViewStore.getState().setError(1, "msg2");
    expect(useDynamicViewStore.getState().dynamicViewVersion).toBe(2);
  });

  it("on absent entry: creates defensive placeholder { viewName: '', status: 'error', error }", () => {
    useDynamicViewStore.getState().setError(99, "msg");
    expect(useDynamicViewStore.getState().views[99]).toEqual({
      viewName: "",
      status: "error",
      error: "msg",
    });
  });
});

describe("clearView", () => {
  it("removes existing entry and bumps version", () => {
    useDynamicViewStore
      .getState()
      .setView(1, { viewName: "v", status: "materialized", expiresAt: 1 });
    const versionBefore = useDynamicViewStore.getState().dynamicViewVersion;
    useDynamicViewStore.getState().clearView(1);
    const s = useDynamicViewStore.getState();
    expect(s.views[1]).toBeUndefined();
    expect(s.dynamicViewVersion).toBe(versionBefore + 1);
  });

  it("STRICT NO-OP on non-existent id — no version bump, state reference preserved", () => {
    const before = useDynamicViewStore.getState();
    useDynamicViewStore.getState().clearView(999);
    const after = useDynamicViewStore.getState();
    // reference equality — views object preserved
    expect(after.views).toBe(before.views);
    expect(after.dynamicViewVersion).toBe(before.dynamicViewVersion);
  });
});

describe("version monotonicity", () => {
  it("five mutations produce dynamicViewVersion === 5", () => {
    useDynamicViewStore
      .getState()
      .setView(1, { viewName: "v1", status: "materialized", expiresAt: 1 });
    useDynamicViewStore.getState().markPending(2, "v2");
    useDynamicViewStore.getState().setError(3, "msg");
    useDynamicViewStore.getState().clearView(1);
    useDynamicViewStore.getState().setView(4, {
      viewName: "v4",
      status: "over_threshold",
      reason: "no_filter",
    });
    expect(useDynamicViewStore.getState().dynamicViewVersion).toBe(5);
  });
});

describe("reset", () => {
  it("hard-sets state to { views: {}, dynamicViewVersion: 0 } — NOT an increment", () => {
    useDynamicViewStore
      .getState()
      .setView(1, { viewName: "v", status: "materialized", expiresAt: 1 });
    useDynamicViewStore
      .getState()
      .setView(2, { viewName: "v", status: "materialized", expiresAt: 1 });
    useDynamicViewStore.getState().reset();
    const s = useDynamicViewStore.getState();
    expect(s.views).toEqual({});
    // hard-set to 0 — NOT 3 (would be an increment)
    expect(s.dynamicViewVersion).toBe(0);
  });
});

describe("reference stability (PITFALL C-02 / S-02)", () => {
  it("mutating entry A leaves entry B's object identity intact", () => {
    useDynamicViewStore
      .getState()
      .setView(1, { viewName: "a", status: "materialized", expiresAt: 1 });
    useDynamicViewStore
      .getState()
      .setView(2, { viewName: "b", status: "materialized", expiresAt: 2 });
    const entryAFirst = useDynamicViewStore.getState().views[1];
    useDynamicViewStore
      .getState()
      .setView(2, { viewName: "b2", status: "materialized", expiresAt: 22 });
    const entryAAfter = useDynamicViewStore.getState().views[1];
    // SAME object reference — selectors scoped to views[id] remain stable across cross-id mutations.
    expect(entryAAfter).toBe(entryAFirst);
  });
});

describe("error-state shape (success criterion 4)", () => {
  it("after markPending → setError: entry has exactly { viewName, status, error } — no expiresAt/reason", () => {
    useDynamicViewStore.getState().markPending(1, "v");
    useDynamicViewStore.getState().setError(1, "msg");
    const e = useDynamicViewStore.getState().views[1];
    expect(Object.keys(e).sort()).toEqual(["error", "status", "viewName"]);
    expect(e).toEqual({ viewName: "v", status: "error", error: "msg" });
  });
});
