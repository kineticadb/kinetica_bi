/**
 * lib.dynamicViewName.spec.ts — Phase 32 Plan 01 Task 2 (DV-V16-01).
 *
 * Unit coverage of `buildDynamicViewName`. Locked shape per 32-CONTEXT.md § D7:
 *   _kbi_dv_u<sanitizedUserId>_d<dashboardId>_<dynamicViewId>
 *
 * Mirrors lib.viewNaming.spec.ts shape (vitest, no jest globals, pure module).
 */
import { describe, it, expect } from "vitest";
import { buildDynamicViewName } from "../src/lib/dynamicViewName";

describe("buildDynamicViewName", () => {
  it("N1: composes a deterministic name with the locked _kbi_dv_ prefix", () => {
    const out = buildDynamicViewName({
      userId: "alice",
      dashboardId: 7,
      dynamicViewId: 3,
    });
    expect(out).toBe("_kbi_dv_ualice_d7_3");
  });

  it("N2: sanitizes OIDC-style userId via the shared sanitizeForViewName rule", () => {
    const out = buildDynamicViewName({
      userId: "john.doe@kinetica.com",
      dashboardId: 1,
      dynamicViewId: 42,
    });
    expect(out).toBe("_kbi_dv_ujohn_doe_kinetica_com_d1_42");
  });

  it("N3: truncates a long userId segment to exactly 32 chars (V13-P-08 rule)", () => {
    const long = "a".repeat(50);
    const out = buildDynamicViewName({
      userId: long,
      dashboardId: 1,
      dynamicViewId: 1,
    });
    // _kbi_dv_u<32 a's>_d1_1
    expect(out).toBe(`_kbi_dv_u${"a".repeat(32)}_d1_1`);
    // userId segment between "_kbi_dv_u" prefix and the "_d<dashboardId>_<dynamicViewId>"
    // suffix must be exactly 32 chars. We cannot use indexOf("_d") because the
    // PREFIX "_kbi_dv_u" itself contains the substring "_d" — so we slice
    // by a known suffix length instead. Suffix for d=1,id=1 is "_d1_1" (5 chars).
    const SUFFIX_LEN = "_d1_1".length;
    const userSegment = out.slice("_kbi_dv_u".length, out.length - SUFFIX_LEN);
    expect(userSegment.length).toBe(32);
    expect(userSegment).toBe("a".repeat(32));
  });

  it("N4: output always matches the locked regex shape", () => {
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

  it("is deterministic — same inputs always produce identical output", () => {
    const args = { userId: "alice", dashboardId: 7, dynamicViewId: 3 } as const;
    expect(buildDynamicViewName(args)).toBe(buildDynamicViewName(args));
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
