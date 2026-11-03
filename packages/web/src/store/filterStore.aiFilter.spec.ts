// Phase 138 Plan 04: drift guards tying the shared AI filter rules to the web
// filterStore / columnTypes rules, plus the aiApplied marker lifecycle (D-14).
import { describe, it, expect, beforeEach } from "vitest";
import { AI_FILTER_CAP_PER_TABLE, aiFilterDataTypeOf } from "@kinetica-bi/shared";
import { FILTER_CAP_PER_TABLE, useFilterStore, type ActiveFilter } from "./filterStore";
import { inferDataTypeFromColumn, isColumnDrillDownSafe } from "../lib/columnTypes";

describe("AI filter drift + marker", () => {
  beforeEach(() => {
    useFilterStore.getState().reset();
  });

  it("CHIPAI-1: shared AI cap equals the web per-table cap", () => {
    expect(AI_FILTER_CAP_PER_TABLE).toBe(FILTER_CAP_PER_TABLE);
  });

  it("CHIPAI-2: aiFilterDataTypeOf matches inferDataTypeFromColumn and flags unfilterable types", () => {
    const types = [
      "int", "INT(8)", "long", "double", "double precision", "decimal(10,2)", "numeric",
      "smallint", "bigint", "real", "tinyint", "float", "bool", "boolean", "timestamp",
      "date", "time", "datetime", "string", "char16", "varchar(40)", "ipv4",
    ];
    for (const t of types) {
      expect(aiFilterDataTypeOf(t), t).toBe(inferDataTypeFromColumn("c", { c: t }));
    }
    for (const t of ["wkt", "wkb", "bytes", "blob", "text", "point", "geometry", "geography"]) {
      expect(isColumnDrillDownSafe(t), t).toBe(false);
      expect(aiFilterDataTypeOf(t), t).toBe("unfilterable");
    }
  });

  it("CHIPAI-4: a user filter on the same column replaces an AI filter (tag drops); remove clears it", () => {
    const ai: ActiveFilter = { column: "pay", value: "Credit", dataType: "string", aiApplied: true, addedAt: 1 };
    const user: ActiveFilter = { column: "pay", value: "Cash", dataType: "string", addedAt: 2 };
    useFilterStore.getState().addFilter(5, ai);
    expect(useFilterStore.getState().filters[5][0].aiApplied).toBe(true);
    useFilterStore.getState().addFilter(5, user);
    const stored = useFilterStore.getState().filters[5];
    expect(stored).toHaveLength(1);
    expect(stored[0].value).toBe("Cash");
    expect(stored[0].aiApplied).toBeUndefined();
    useFilterStore.getState().removeFilter(5, "pay");
    expect(useFilterStore.getState().filters[5] ?? []).toHaveLength(0);
  });
});
