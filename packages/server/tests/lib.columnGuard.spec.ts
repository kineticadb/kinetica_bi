import { describe, it, expect } from "vitest";
import {
  ColumnGuardError,
  UnknownColumnError,
  InvalidIdentifierError,
  assertColumnsExist,
  assertIdentifier,
  assertSchemaTableColumn,
  tableLabel,
} from "../src/lib/columnGuard";

describe("columnGuard (Phase 133)", () => {
  it("CG-U1: accepts a column in the snapshot", () => {
    expect(() => assertColumnsExist({ zone: "string" }, ["zone"], "fleet.trips")).not.toThrow();
  });

  it("CG-U2: missing column throws UnknownColumnError with D-02 message", () => {
    let err: unknown;
    try {
      assertColumnsExist({ zone: "string" }, ["region"], "fleet.trips");
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(UnknownColumnError);
    expect(err).toBeInstanceOf(ColumnGuardError);
    const u = err as UnknownColumnError;
    expect(u.message).toBe('Column "region" no longer exists on fleet.trips');
    expect(u.column).toBe("region");
    expect(u.table).toBe("fleet.trips");
  });

  it("CG-U3: prototype keys never pass", () => {
    for (const c of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
      expect(() => assertColumnsExist({ zone: "string" }, [c], "t")).toThrow(UnknownColumnError);
    }
  });

  it("CG-U4: array snapshot", () => {
    expect(() => assertColumnsExist(["zone", "fare"], ["fare"], "t")).not.toThrow();
    expect(() => assertColumnsExist(["zone", "fare"], ["region"], "t")).toThrow(UnknownColumnError);
  });

  it("CG-U5: empty snapshot rejects", () => {
    expect(() => assertColumnsExist({}, ["zone"], "t")).toThrow(UnknownColumnError);
  });

  it("CG-U6: non-string columns throw with stringified column", () => {
    for (const [c, s] of [[5, "5"], [null, "null"], [undefined, "undefined"]] as const) {
      try {
        assertColumnsExist({ zone: "string" }, [c], "t");
        expect.unreachable();
      } catch (e) {
        expect(e).toBeInstanceOf(UnknownColumnError);
        expect((e as UnknownColumnError).column).toBe(s);
      }
    }
  });

  it("CG-U7: exact-case match", () => {
    expect(() => assertColumnsExist({ Zone: "string" }, ["zone"], "t")).toThrow(UnknownColumnError);
  });

  it("CG-U8: tableLabel", () => {
    expect(tableLabel({ schema: "fleet", name: "trips" })).toBe("fleet.trips");
    expect(tableLabel({ schema: "", name: "trips" })).toBe("trips");
  });

  it("CG-U9: assertIdentifier", () => {
    expect(() => assertIdentifier("zone", "column")).not.toThrow();
    expect(() => assertIdentifier("_kbi_dv_uadmin_d1_7", "column")).not.toThrow();
    for (const v of ["x; DROP TABLE t", "a b", "1abc", "a.b", "", 7]) {
      expect(() => assertIdentifier(v, "column")).toThrow(InvalidIdentifierError);
    }
    expect(() => assertIdentifier("", "schema", { allowEmpty: true })).not.toThrow();
  });

  it("CG-U10: toBody shapes", () => {
    expect(new UnknownColumnError("region", "fleet.trips").toBody()).toEqual({
      error: 'Column "region" no longer exists on fleet.trips',
      code: "UNKNOWN_COLUMN",
      column: "region",
      table: "fleet.trips",
      hint: "If the column was added or renamed recently, apply Schema Sync for this table.",
    });
    expect(new InvalidIdentifierError("column", "x; DROP TABLE t").toBody()).toEqual({
      error: 'Invalid column: "x; DROP TABLE t" is not a valid SQL identifier',
      code: "INVALID_IDENTIFIER",
      field: "column",
    });
  });

  it("CG-U11: assertSchemaTableColumn registered table + missing column -> UnknownColumnError", () => {
    const lookup = () => ({ schema: "fleet", name: "trips", columns: { fare: "double" } });
    expect(() => assertSchemaTableColumn({ schema: "fleet", table: "trips", column: "region" }, lookup)).toThrow(UnknownColumnError);
    expect(() => assertSchemaTableColumn({ schema: "fleet", table: "trips", column: "fare" }, lookup)).not.toThrow();
  });

  it("CG-U12: assertSchemaTableColumn schema empty skips lookup", () => {
    let called = 0;
    const lookup = () => {
      called++;
      return undefined;
    };
    expect(() => assertSchemaTableColumn({ schema: "", table: "_kbi_dv_u1", column: "anything" }, lookup)).not.toThrow();
    expect(called).toBe(0);
  });

  it("CG-U13: assertSchemaTableColumn injected column throws before lookup", () => {
    let called = 0;
    const lookup = () => {
      called++;
      return undefined;
    };
    expect(() => assertSchemaTableColumn({ schema: "fleet", table: "trips", column: "x; DROP" }, lookup)).toThrow(InvalidIdentifierError);
    expect(called).toBe(0);
  });
});
