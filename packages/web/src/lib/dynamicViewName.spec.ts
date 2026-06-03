/**
 * lib/dynamicViewName.spec.ts — Phase 33 Plan 01 Task 1 (DV-V16-06).
 *
 * Round-trip identity coverage for the pure helper. The output shape is locked
 * by 32-CONTEXT.md § D7 and the byte-parity contract requires identical strings
 * to the server helper at `packages/server/src/lib/dynamicViewName.ts` for
 * any given { userId, dashboardId, dynamicViewId } input.
 *
 * Test pairs N1-N4 mirror `packages/server/tests/lib.dynamicViewName.spec.ts`
 * verbatim so the parity contract can be diff-checked across both trees.
 */
import { describe, it, expect } from "vitest";
import { buildDynamicViewName } from "./dynamicViewName";

describe("buildDynamicViewName", () => {
  it("composes simple alphanumeric inputs into the locked _kbi_dv_ shape", () => {
    expect(
      buildDynamicViewName({ userId: "alice", dashboardId: 5, dynamicViewId: 7 }),
    ).toBe("_kbi_dv_ualice_d5_7");
  });

  it("sanitizes non-alphanumeric chars in userId to underscore", () => {
    expect(
      buildDynamicViewName({
        userId: "john.doe@kinetica.com",
        dashboardId: 1,
        dynamicViewId: 2,
      }),
    ).toBe("_kbi_dv_ujohn_doe_kinetica_com_d1_2");
  });

  it("truncates userId to 32 chars (V13-P-08 length budget)", () => {
    const longId = "a".repeat(50);
    const result = buildDynamicViewName({
      userId: longId,
      dashboardId: 1,
      dynamicViewId: 2,
    });
    expect(result).toBe(`_kbi_dv_u${"a".repeat(32)}_d1_2`);
  });

  it("is deterministic — same input always produces the same output", () => {
    const args = { userId: "alice", dashboardId: 5, dynamicViewId: 7 } as const;
    expect(buildDynamicViewName(args)).toBe(buildDynamicViewName(args));
  });

  it("byte-parity with server spec round-trip pairs (3+ pairs from server tests)", () => {
    // These pairs are pulled directly from packages/server/tests/lib.dynamicViewName.spec.ts.
    // The frontend helper MUST produce identical strings for each pair — this is the
    // parity contract that lets the deterministic name resolve to the same Kinetica
    // view whether composed on the server or the client.

    // N1 (server): { userId: "alice", dashboardId: 7, dynamicViewId: 3 } → "_kbi_dv_ualice_d7_3"
    expect(
      buildDynamicViewName({ userId: "alice", dashboardId: 7, dynamicViewId: 3 }),
    ).toBe("_kbi_dv_ualice_d7_3");

    // N2 (server): OIDC-style userId sanitization
    expect(
      buildDynamicViewName({
        userId: "john.doe@kinetica.com",
        dashboardId: 1,
        dynamicViewId: 42,
      }),
    ).toBe("_kbi_dv_ujohn_doe_kinetica_com_d1_42");

    // N4 case (server): zero dashboardId / zero dynamicViewId — still composes cleanly
    expect(
      buildDynamicViewName({ userId: "u", dashboardId: 0, dynamicViewId: 0 }),
    ).toBe("_kbi_dv_uu_d0_0");

    // Additional pair — auth0-style userId with pipe gets sanitized
    expect(
      buildDynamicViewName({
        userId: "auth0|abc123def456",
        dashboardId: 99,
        dynamicViewId: 100,
      }),
    ).toBe("_kbi_dv_uauth0_abc123def456_d99_100");
  });

  it("output always matches the locked regex shape (matches server N4 case)", () => {
    const cases = [
      buildDynamicViewName({ userId: "alice", dashboardId: 7, dynamicViewId: 3 }),
      buildDynamicViewName({
        userId: "john.doe@kinetica.com",
        dashboardId: 1,
        dynamicViewId: 42,
      }),
      buildDynamicViewName({ userId: "u", dashboardId: 0, dynamicViewId: 0 }),
      buildDynamicViewName({
        userId: "a".repeat(50),
        dashboardId: 999999,
        dynamicViewId: 1,
      }),
    ];
    const re = /^_kbi_dv_u[a-zA-Z0-9_]+_d\d+_\d+$/;
    for (const out of cases) {
      expect(out).toMatch(re);
    }
  });

  it("stays well under Kinetica's 200-char identifier limit at worst case", () => {
    const out = buildDynamicViewName({
      userId: "x".repeat(50),
      dashboardId: 999999999,
      dynamicViewId: 999999999,
    });
    expect(out.length).toBeLessThan(200);
  });
});
