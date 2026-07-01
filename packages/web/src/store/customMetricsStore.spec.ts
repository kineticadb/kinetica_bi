/**
 * customMetricsStore.spec.ts — Phase 99 Plan 02 (METRIC-V119-01/02).
 *
 * Unit tests for useCustomMetricsStore + selectMetrics selector.
 * Mirrors columnDisplayConfigStore.spec.ts conventions.
 *
 * Test infra:
 *   - Zustand reset shim auto-resets between tests (vi.mock("zustand") in src/test/setup.ts).
 *   - No spec-side beforeEach reset boilerplate needed — shim handles it.
 *   - listCustomMetrics is mocked — this store is pure client-side; no fetch in tests.
 */
import { describe, it, expect, vi } from "vitest";
import { useCustomMetricsStore, selectMetrics } from "./customMetricsStore";
import type { CustomMetricRow } from "../api/client";

// Mock the api/client module so listCustomMetrics never hits the network.
vi.mock("../api/client", () => ({
  listCustomMetrics: vi.fn(),
}));

const tableId = 42;
const tableId2 = 99;

const makeRow = (id: number, label: string, expression = "SUM(x)"): CustomMetricRow => ({
  id,
  table_id: tableId,
  label,
  expression,
  format_spec: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
});

const rowA = makeRow(1, "Revenue");
const rowB = makeRow(2, "Cost");
const rowC = makeRow(3, "Margin");

describe("useCustomMetricsStore — initial state", () => {
  it("starts with empty configs and configVersion 0", () => {
    const s = useCustomMetricsStore.getState();
    expect(s.configs).toEqual({});
    expect(s.configVersion).toBe(0);
  });

  it("reading an unknown tableId returns undefined cleanly", () => {
    expect(useCustomMetricsStore.getState().configs[999]).toBeUndefined();
  });
});

describe("setConfig", () => {
  it("populates configs[tableId] from rows and bumps configVersion", () => {
    useCustomMetricsStore.getState().setConfig(tableId, [rowA, rowB]);
    const s = useCustomMetricsStore.getState();
    expect(s.configs[tableId]).toBeDefined();
    expect(s.configs[tableId].metrics[rowA.id]).toEqual(rowA);
    expect(s.configs[tableId].metrics[rowB.id]).toEqual(rowB);
    expect(s.configVersion).toBe(1);
  });

  it("ALWAYS bumps configVersion on byte-identical payload (Pitfall 5 lock)", () => {
    useCustomMetricsStore.getState().setConfig(tableId, [rowA]);
    useCustomMetricsStore.getState().setConfig(tableId, [rowA]);
    expect(useCustomMetricsStore.getState().configVersion).toBe(2);
  });

  it("REPLACE semantics — second setConfig overwrites prior entry completely", () => {
    useCustomMetricsStore.getState().setConfig(tableId, [rowA, rowB]);
    useCustomMetricsStore.getState().setConfig(tableId, [rowC]);
    const entry = useCustomMetricsStore.getState().configs[tableId];
    expect(entry.metrics[rowA.id]).toBeUndefined();
    expect(entry.metrics[rowB.id]).toBeUndefined();
    expect(entry.metrics[rowC.id]).toEqual(rowC);
  });

  it("empty rows array replaces existing entry with empty metrics map", () => {
    useCustomMetricsStore.getState().setConfig(tableId, [rowA, rowB]);
    useCustomMetricsStore.getState().setConfig(tableId, []);
    const entry = useCustomMetricsStore.getState().configs[tableId];
    expect(entry.metrics).toEqual({});
    expect(useCustomMetricsStore.getState().configVersion).toBe(2);
  });
});

describe("upsertMetric", () => {
  it("adds a new metric entry and bumps configVersion", () => {
    useCustomMetricsStore.getState().upsertMetric(tableId, rowA);
    const s = useCustomMetricsStore.getState();
    expect(s.configs[tableId].metrics[rowA.id]).toEqual(rowA);
    expect(s.configVersion).toBe(1);
  });

  it("ALWAYS bumps configVersion even when re-setting an identical row (Pitfall 5 lock)", () => {
    useCustomMetricsStore.getState().upsertMetric(tableId, rowA);
    useCustomMetricsStore.getState().upsertMetric(tableId, rowA);
    expect(useCustomMetricsStore.getState().configVersion).toBe(2);
  });

  it("MERGE semantics — only the target metric is updated, others preserved", () => {
    useCustomMetricsStore.getState().upsertMetric(tableId, rowA);
    useCustomMetricsStore.getState().upsertMetric(tableId, rowB);
    const updatedA: CustomMetricRow = { ...rowA, label: "Revenue Updated" };
    useCustomMetricsStore.getState().upsertMetric(tableId, updatedA);
    const entry = useCustomMetricsStore.getState().configs[tableId];
    expect(entry.metrics[rowA.id].label).toBe("Revenue Updated");
    expect(entry.metrics[rowB.id]).toEqual(rowB); // sibling preserved
  });

  it("creates configs[tableId] when absent (no prior entry needed)", () => {
    useCustomMetricsStore.getState().upsertMetric(tableId2, rowA);
    expect(useCustomMetricsStore.getState().configs[tableId2]).toBeDefined();
  });
});

describe("removeMetric", () => {
  it("STRICT NO-OP on non-existent tableId — state reference preserved AND configVersion unchanged", () => {
    const before = useCustomMetricsStore.getState();
    useCustomMetricsStore.getState().removeMetric(999, 1);
    const after = useCustomMetricsStore.getState();
    expect(after).toBe(before); // reference equality — strict no-op
    expect(after.configVersion).toBe(before.configVersion);
  });

  it("STRICT NO-OP when table exists but metric id is absent — state reference preserved AND configVersion unchanged", () => {
    useCustomMetricsStore.getState().upsertMetric(tableId, rowA);
    const stateBefore = useCustomMetricsStore.getState();
    const versionBefore = stateBefore.configVersion;
    useCustomMetricsStore.getState().removeMetric(tableId, 9999); // non-existent id
    const stateAfter = useCustomMetricsStore.getState();
    expect(stateAfter).toBe(stateBefore); // reference equality — strict no-op
    expect(stateAfter.configVersion).toBe(versionBefore);
  });

  it("removes an existing metric and bumps configVersion", () => {
    useCustomMetricsStore.getState().upsertMetric(tableId, rowA);
    useCustomMetricsStore.getState().upsertMetric(tableId, rowB);
    const versionBefore = useCustomMetricsStore.getState().configVersion;
    useCustomMetricsStore.getState().removeMetric(tableId, rowA.id);
    const s = useCustomMetricsStore.getState();
    expect(s.configs[tableId].metrics[rowA.id]).toBeUndefined();
    expect(s.configs[tableId].metrics[rowB.id]).toEqual(rowB); // sibling preserved
    expect(s.configVersion).toBe(versionBefore + 1);
  });
});

describe("version monotonicity", () => {
  it("five mutations produce configVersion === 5", () => {
    useCustomMetricsStore.getState().setConfig(tableId, []);                // 1
    useCustomMetricsStore.getState().upsertMetric(tableId, rowA);           // 2
    useCustomMetricsStore.getState().upsertMetric(tableId, rowB);           // 3
    useCustomMetricsStore.getState().removeMetric(tableId, rowA.id);        // 4
    useCustomMetricsStore.getState().setConfig(tableId, []);                // 5
    expect(useCustomMetricsStore.getState().configVersion).toBe(5);
  });
});

describe("loadConfig", () => {
  it("fetches via listCustomMetrics and calls setConfig (bumps configVersion)", async () => {
    const { listCustomMetrics } = await import("../api/client");
    vi.mocked(listCustomMetrics).mockResolvedValueOnce([rowA, rowB]);

    await useCustomMetricsStore.getState().loadConfig(tableId);

    const s = useCustomMetricsStore.getState();
    expect(s.configs[tableId].metrics[rowA.id]).toEqual(rowA);
    expect(s.configs[tableId].metrics[rowB.id]).toEqual(rowB);
    expect(s.configVersion).toBe(1);
    expect(listCustomMetrics).toHaveBeenCalledWith(tableId);
  });
});

describe("reset", () => {
  it("hard-sets state to { configs: {}, configVersion: 0 } — NOT an increment", () => {
    useCustomMetricsStore.getState().upsertMetric(tableId, rowA);
    useCustomMetricsStore.getState().upsertMetric(tableId, rowB);
    useCustomMetricsStore.getState().reset();
    const s = useCustomMetricsStore.getState();
    expect(s.configs).toEqual({});
    // hard-set to 0 — NOT 3 (which would be an increment)
    expect(s.configVersion).toBe(0);
  });
});

describe("selectMetrics", () => {
  it("returns [] when table is absent", () => {
    expect(selectMetrics(999)).toEqual([]);
  });

  it("returns [] when table has no metrics (empty setConfig)", () => {
    useCustomMetricsStore.getState().setConfig(tableId, []);
    expect(selectMetrics(tableId)).toEqual([]);
  });

  it("returns label-sorted array of metrics for the table", () => {
    // rowA=Revenue, rowC=Margin, rowB=Cost -> sorted: Cost, Margin, Revenue
    useCustomMetricsStore.getState().setConfig(tableId, [rowA, rowC, rowB]);
    const result = selectMetrics(tableId);
    expect(result).toHaveLength(3);
    expect(result[0].label).toBe("Cost");
    expect(result[1].label).toBe("Margin");
    expect(result[2].label).toBe("Revenue");
  });

  it("returns only the requested table's metrics (not another table's)", () => {
    const rowForOtherTable: CustomMetricRow = { ...rowA, table_id: tableId2 };
    useCustomMetricsStore.getState().upsertMetric(tableId, rowA);
    useCustomMetricsStore.getState().upsertMetric(tableId2, rowForOtherTable);
    const result = selectMetrics(tableId);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(rowA.id);
  });

  it("reflects updates after upsertMetric", () => {
    useCustomMetricsStore.getState().upsertMetric(tableId, rowA);
    const updatedA: CustomMetricRow = { ...rowA, label: "Revenue (Updated)" };
    useCustomMetricsStore.getState().upsertMetric(tableId, updatedA);
    const result = selectMetrics(tableId);
    expect(result[0].label).toBe("Revenue (Updated)");
  });
});
