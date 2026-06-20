/**
 * columnDisplayConfigStore.spec.ts — Phase 75 Plan 03 (COLCFG-V115-03).
 *
 * Unit tests for useColumnDisplayConfigStore + resolveLabel + resolveFormatter.
 * Mirrors dynamicViewStore.spec.ts conventions.
 *
 * Test infra:
 *   - Zustand reset shim auto-resets between tests (vi.mock("zustand") in src/test/setup.ts).
 *   - No spec-side beforeEach reset boilerplate needed — shim handles it.
 *   - listColumnDisplayConfig is mocked — this store is pure client-side; no fetch in tests.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useColumnDisplayConfigStore, resolveLabel, resolveFormatter } from "./columnDisplayConfigStore";

// Mock the api/client module so listColumnDisplayConfig never hits the network.
vi.mock("../api/client", () => ({
  listColumnDisplayConfig: vi.fn(),
}));

const tableId = 42;
const colA = "revenue";
const colB = "created_at";

describe("useColumnDisplayConfigStore — initial state", () => {
  it("starts with empty configs and configVersion 0", () => {
    const s = useColumnDisplayConfigStore.getState();
    expect(s.configs).toEqual({});
    expect(s.configVersion).toBe(0);
  });

  it("reading an unknown table id returns undefined cleanly", () => {
    expect(useColumnDisplayConfigStore.getState().configs[999]).toBeUndefined();
  });
});

describe("setConfig", () => {
  it("populates configs[tableId] from rows and bumps configVersion", () => {
    useColumnDisplayConfigStore.getState().setConfig(tableId, [
      { table_id: tableId, column_name: colA, label: "Revenue", format_spec: { kind: "number", thousandsSep: true, decimals: 2, currency: false, percent: false }, created_at: "", updated_at: "" },
      { table_id: tableId, column_name: colB, label: null, format_spec: null, created_at: "", updated_at: "" },
    ]);
    const s = useColumnDisplayConfigStore.getState();
    expect(s.configs[tableId]).toBeDefined();
    expect(s.configs[tableId].columns[colA]).toEqual({ label: "Revenue", format_spec: { kind: "number", thousandsSep: true, decimals: 2, currency: false, percent: false } });
    expect(s.configs[tableId].columns[colB]).toEqual({ label: null, format_spec: null });
    expect(s.configVersion).toBe(1);
  });

  it("ALWAYS bumps configVersion on byte-identical payload (Pitfall 5 lock)", () => {
    const rows = [{ table_id: tableId, column_name: colA, label: "Revenue", format_spec: null, created_at: "", updated_at: "" }];
    useColumnDisplayConfigStore.getState().setConfig(tableId, rows);
    useColumnDisplayConfigStore.getState().setConfig(tableId, rows);
    expect(useColumnDisplayConfigStore.getState().configVersion).toBe(2);
  });

  it("REPLACE semantics — second setConfig overwrites prior entry completely", () => {
    useColumnDisplayConfigStore.getState().setConfig(tableId, [
      { table_id: tableId, column_name: colA, label: "Old", format_spec: null, created_at: "", updated_at: "" },
    ]);
    useColumnDisplayConfigStore.getState().setConfig(tableId, [
      { table_id: tableId, column_name: colB, label: "New", format_spec: null, created_at: "", updated_at: "" },
    ]);
    const entry = useColumnDisplayConfigStore.getState().configs[tableId];
    expect(entry.columns[colA]).toBeUndefined();
    expect(entry.columns[colB]).toEqual({ label: "New", format_spec: null });
  });
});

describe("upsertColumn", () => {
  it("adds a new column entry and bumps configVersion", () => {
    useColumnDisplayConfigStore.getState().upsertColumn(tableId, colA, "Revenue", null);
    const s = useColumnDisplayConfigStore.getState();
    expect(s.configs[tableId].columns[colA]).toEqual({ label: "Revenue", format_spec: null });
    expect(s.configVersion).toBe(1);
  });

  it("ALWAYS bumps configVersion even when re-setting the SAME label (byte-identical — Pitfall 5 lock)", () => {
    useColumnDisplayConfigStore.getState().upsertColumn(tableId, colA, "Revenue", null);
    useColumnDisplayConfigStore.getState().upsertColumn(tableId, colA, "Revenue", null);
    expect(useColumnDisplayConfigStore.getState().configVersion).toBe(2);
  });

  it("MERGE semantics — only the target column is updated, others preserved", () => {
    useColumnDisplayConfigStore.getState().upsertColumn(tableId, colA, "Revenue", null);
    useColumnDisplayConfigStore.getState().upsertColumn(tableId, colB, "Created At", null);
    useColumnDisplayConfigStore.getState().upsertColumn(tableId, colA, "Revenue Updated", null);
    const entry = useColumnDisplayConfigStore.getState().configs[tableId];
    expect(entry.columns[colA].label).toBe("Revenue Updated");
    expect(entry.columns[colB].label).toBe("Created At"); // preserved
  });

  it("creates configs[tableId] when absent (no prior entry needed)", () => {
    useColumnDisplayConfigStore.getState().upsertColumn(99, colA, "X", null);
    expect(useColumnDisplayConfigStore.getState().configs[99]).toBeDefined();
  });
});

describe("removeColumn", () => {
  it("STRICT NO-OP on non-existent tableId — state reference preserved AND configVersion unchanged", () => {
    const before = useColumnDisplayConfigStore.getState();
    useColumnDisplayConfigStore.getState().removeColumn(999, colA);
    const after = useColumnDisplayConfigStore.getState();
    expect(after).toBe(before); // reference equality — strict no-op
    expect(after.configVersion).toBe(before.configVersion);
  });

  it("STRICT NO-OP when table exists but column is absent — state reference preserved AND configVersion unchanged", () => {
    useColumnDisplayConfigStore.getState().upsertColumn(tableId, colA, "Revenue", null);
    const versionBefore = useColumnDisplayConfigStore.getState().configVersion;
    const stateBefore = useColumnDisplayConfigStore.getState();
    useColumnDisplayConfigStore.getState().removeColumn(tableId, "non_existent_col");
    const stateAfter = useColumnDisplayConfigStore.getState();
    expect(stateAfter).toBe(stateBefore); // reference equality — strict no-op
    expect(stateAfter.configVersion).toBe(versionBefore);
  });

  it("removes an existing column and bumps configVersion", () => {
    useColumnDisplayConfigStore.getState().upsertColumn(tableId, colA, "Revenue", null);
    useColumnDisplayConfigStore.getState().upsertColumn(tableId, colB, "Date", null);
    const versionBefore = useColumnDisplayConfigStore.getState().configVersion;
    useColumnDisplayConfigStore.getState().removeColumn(tableId, colA);
    const s = useColumnDisplayConfigStore.getState();
    expect(s.configs[tableId].columns[colA]).toBeUndefined();
    expect(s.configs[tableId].columns[colB]).toBeDefined(); // sibling preserved
    expect(s.configVersion).toBe(versionBefore + 1);
  });
});

describe("version monotonicity", () => {
  it("five mutations produce configVersion === 5", () => {
    useColumnDisplayConfigStore.getState().setConfig(tableId, []);             // 1
    useColumnDisplayConfigStore.getState().upsertColumn(tableId, colA, "A", null); // 2
    useColumnDisplayConfigStore.getState().upsertColumn(tableId, colB, "B", null); // 3
    useColumnDisplayConfigStore.getState().removeColumn(tableId, colA);        // 4
    useColumnDisplayConfigStore.getState().setConfig(tableId, []);             // 5
    expect(useColumnDisplayConfigStore.getState().configVersion).toBe(5);
  });
});

describe("reset", () => {
  it("hard-sets state to { configs: {}, configVersion: 0 } — NOT an increment", () => {
    useColumnDisplayConfigStore.getState().upsertColumn(tableId, colA, "Revenue", null);
    useColumnDisplayConfigStore.getState().upsertColumn(tableId, colB, "Date", null);
    useColumnDisplayConfigStore.getState().reset();
    const s = useColumnDisplayConfigStore.getState();
    expect(s.configs).toEqual({});
    // hard-set to 0 — NOT 3 (would be an increment)
    expect(s.configVersion).toBe(0);
  });
});

describe("resolveLabel", () => {
  it("returns the stored label when configured", () => {
    useColumnDisplayConfigStore.getState().setConfig(tableId, [
      { table_id: tableId, column_name: colA, label: "Revenue ($)", format_spec: null, created_at: "", updated_at: "" },
    ]);
    expect(resolveLabel(tableId, colA)).toBe("Revenue ($)");
  });

  it("returns the raw column name when label is null", () => {
    useColumnDisplayConfigStore.getState().setConfig(tableId, [
      { table_id: tableId, column_name: colA, label: null, format_spec: null, created_at: "", updated_at: "" },
    ]);
    expect(resolveLabel(tableId, colA)).toBe(colA);
  });

  it("returns the raw column name when no entry exists for the table", () => {
    expect(resolveLabel(999, colA)).toBe(colA);
  });

  it("returns the raw column name when table exists but column is absent", () => {
    useColumnDisplayConfigStore.getState().upsertColumn(tableId, colB, "Date", null);
    expect(resolveLabel(tableId, colA)).toBe(colA);
  });
});

describe("resolveFormatter", () => {
  it("returns identity when no config entry exists (no table)", () => {
    const fn = resolveFormatter(999, colA);
    expect(fn(42)).toBe(42);
    expect(fn("hello")).toBe("hello");
  });

  it("returns identity when format_spec is null", () => {
    useColumnDisplayConfigStore.getState().setConfig(tableId, [
      { table_id: tableId, column_name: colA, label: null, format_spec: null, created_at: "", updated_at: "" },
    ]);
    const fn = resolveFormatter(tableId, colA);
    expect(fn(123)).toBe(123);
  });

  it("returns identity for kind:'none' spec", () => {
    useColumnDisplayConfigStore.getState().upsertColumn(tableId, colA, null, { kind: "none" });
    const fn = resolveFormatter(tableId, colA);
    // buildFormatter({ kind: "none" }) returns identity per Plan 02 implementation
    expect(fn(99)).toBe(99);
  });

  it("returns a number-percent formatter when spec has percent:true", () => {
    useColumnDisplayConfigStore.getState().upsertColumn(tableId, colA, null, {
      kind: "number",
      thousandsSep: false,
      decimals: 0,
      currency: false,
      percent: true,
    });
    const fn = resolveFormatter(tableId, colA);
    // 42 → "42%" (literal % suffix, no ×100)
    expect(fn(42)).toBe("42%");
  });

  it("returns a formatted string for a number spec with thousandsSep + decimals", () => {
    useColumnDisplayConfigStore.getState().upsertColumn(tableId, colA, null, {
      kind: "number",
      thousandsSep: true,
      decimals: 2,
      currency: false,
      percent: false,
    });
    const fn = resolveFormatter(tableId, colA);
    expect(fn(1234567.89)).toBe("1,234,567.89");
  });

  it("returns identity (raw value) when column is absent in an existing table", () => {
    useColumnDisplayConfigStore.getState().upsertColumn(tableId, colB, "Date", null);
    const fn = resolveFormatter(tableId, colA); // colA not set
    expect(fn(42)).toBe(42);
  });
});
