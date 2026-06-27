import { describe, it, expect } from "vitest";
import {
  sanitizeForViewName,
  buildFilterViewName,
  hashKey8,
} from "../src/lib/viewNaming";
import { buildDynamicViewName } from "../src/lib/dynamicViewName";

describe("sanitizeForViewName", () => {
  it("returns alphanumeric input unchanged", () => {
    expect(sanitizeForViewName("alice")).toBe("alice");
  });

  it("preserves digits and existing alphanumerics", () => {
    expect(sanitizeForViewName("123abc")).toBe("123abc");
  });

  it("replaces dots, at-signs, and other punctuation with underscores", () => {
    // OIDC username with dot + @ — V13-P-08 case
    expect(sanitizeForViewName("john.doe@kinetica.com")).toBe(
      "john_doe_kinetica_com"
    );
  });

  it("replaces pipe characters with underscores (auth0-style userIds)", () => {
    expect(sanitizeForViewName("auth0|abc123def456")).toBe(
      "auth0_abc123def456"
    );
  });

  it("replaces hyphens, spaces, and bangs with underscores", () => {
    expect(sanitizeForViewName("user-name with spaces!")).toBe(
      "user_name_with_spaces_"
    );
  });

  it("truncates inputs longer than 32 chars to exactly 32 chars", () => {
    const long = "a".repeat(50);
    const out = sanitizeForViewName(long);
    expect(out.length).toBe(32);
    expect(out).toBe("a".repeat(32));
  });

  it("returns empty string for empty input", () => {
    expect(sanitizeForViewName("")).toBe("");
  });

  it("preserves underscores in input (already valid identifier chars)", () => {
    expect(sanitizeForViewName("snake_case_name")).toBe("snake_case_name");
  });
});

describe("buildFilterViewName", () => {
  it("composes a deterministic view name with the locked _kbi_filt_ prefix", () => {
    const out = buildFilterViewName({
      username: "alice",
      sessionId: "abcd1234ef567890aaaaaaaa",
      dashboardId: 42,
      tableId: 7,
    });
    expect(out).toBe("_kbi_filt_ualice_d42_t7_sabcd1234");
    expect(out).toMatch(/^_kbi_filt_u/);
  });

  it("sanitizes OIDC-style username before interpolation", () => {
    const out = buildFilterViewName({
      username: "john.doe@kinetica.com",
      sessionId: "1aef8b3c0000000000",
      dashboardId: 1,
      tableId: 1,
    });
    expect(out).toBe("_kbi_filt_ujohn_doe_kinetica_com_d1_t1_s1aef8b3c");
  });

  it("uses first 8 hex chars of sessionId for sessionShort", () => {
    const out = buildFilterViewName({
      username: "u",
      sessionId: "deadbeefcafef00d11112222",
      dashboardId: 0,
      tableId: 0,
    });
    expect(out.endsWith("_sdeadbeef")).toBe(true);
  });

  it("is deterministic — same inputs produce identical output", () => {
    const args = {
      username: "alice",
      sessionId: "abcd1234ef567890",
      dashboardId: 42,
      tableId: 7,
    };
    expect(buildFilterViewName(args)).toBe(buildFilterViewName(args));
  });

  it("stays well under Kinetica's 200-char identifier limit at worst case", () => {
    // Worst case: 50-char username (truncates to 32) + 9-digit dashId + 9-digit tableId + 8-char session
    const out = buildFilterViewName({
      username: "x".repeat(50),
      sessionId: "abcdef0123456789",
      dashboardId: 999999999,
      tableId: 999999999,
    });
    expect(out.length).toBeLessThan(200);
  });

  it("returns the unqualified form (no schema prefix) — S4 spike showed both work, bare is simpler", () => {
    const out = buildFilterViewName({
      username: "alice",
      sessionId: "abcd1234",
      dashboardId: 1,
      tableId: 1,
    });
    // Should NOT contain a dot before the prefix (no "ki_home._kbi_filt_..." form)
    expect(out.startsWith("_kbi_filt_u")).toBe(true);
    expect(out.includes(".")).toBe(false);
  });
});

describe("buildFilterViewName with dynamicViewId (dv drill-down path — DVDRILL-V112-03)", () => {
  it("emits a _dv<id> segment (not _t<id>) when dynamicViewId is present", () => {
    const out = buildFilterViewName({
      username: "alice",
      sessionId: "abcd1234ef",
      dashboardId: 42,
      dynamicViewId: 7,
    });
    expect(out).toBe("_kbi_filt_ualice_d42_dv7_sabcd1234");
  });

  it("REGRESSION LOCK: the table path (tableId, no dynamicViewId) is byte-unchanged", () => {
    const out = buildFilterViewName({
      username: "alice",
      sessionId: "abcd1234ef",
      dashboardId: 42,
      tableId: 7,
    });
    expect(out).toBe("_kbi_filt_ualice_d42_t7_sabcd1234");
  });

  it("dv-filter name is distinct from BOTH the table-filter view AND the dv view", () => {
    const tablePath = buildFilterViewName({
      username: "alice",
      sessionId: "abcd1234ef",
      dashboardId: 42,
      tableId: 7,
    });
    const dvPath = buildFilterViewName({
      username: "alice",
      sessionId: "abcd1234ef",
      dashboardId: 42,
      dynamicViewId: 7,
    });
    const dvView = buildDynamicViewName({
      userId: "alice",
      dashboardId: 42,
      dynamicViewId: 7,
    });
    expect(dvView).toBe("_kbi_dv_ualice_d42_7");
    expect(dvPath).not.toBe(tablePath);
    expect(dvPath).not.toBe(dvView);
  });

  it("sanitizes OIDC-style username on the dv path identically to the table path", () => {
    const out = buildFilterViewName({
      username: "john.doe@kinetica.com",
      sessionId: "1aef8b3c0000000000",
      dashboardId: 1,
      dynamicViewId: 5,
    });
    expect(out).toBe("_kbi_filt_ujohn_doe_kinetica_com_d1_dv5_s1aef8b3c");
  });

  it("GUARD: throws when NEITHER tableId NOR dynamicViewId is supplied (no silent _tundefined)", () => {
    expect(() =>
      buildFilterViewName({
        username: "alice",
        sessionId: "abcd1234ef",
        dashboardId: 42,
      })
    ).toThrow(/tableId or dynamicViewId required/);
  });
});

describe("hashKey8 (COMBO-V118-04 — djb2 cross-stack contract)", () => {
  it("returns a string of exactly 8 lowercase hex chars for a non-empty input", () => {
    const result = hashKey8("hello");
    expect(result).toMatch(/^[0-9a-f]{8}$/);
  });

  it("returns a string of exactly 8 lowercase hex chars for an empty input", () => {
    const result = hashKey8("");
    expect(result).toMatch(/^[0-9a-f]{8}$/);
  });

  it("is deterministic — same input always produces the same output", () => {
    const s = "table:7:status|eq|\"East\"";
    expect(hashKey8(s)).toBe(hashKey8(s));
  });

  it("KNOWN-VECTOR (cross-stack lock): hashKey8(\"table:7:status|eq|\\\"East\\\"\") === \"3a777c0f\"", () => {
    // Computed from the Phase-88 djb2 recipe: seed 5381, (h<<5)+h, XOR charCode, >>>0, padStart(8).
    // Client comboShortHash("table:7:status|eq|\"East\"") must equal the same literal.
    expect(hashKey8('table:7:status|eq|"East"')).toBe("3a777c0f");
  });
});

describe("buildFilterViewName with combinationKey (COMBO-V118-04)", () => {
  const K = 'table:7:status|eq|"East"';

  it("ABSENT-KEY REGRESSION LOCK (table path): byte-identical to v1.17", () => {
    const out = buildFilterViewName({
      username: "alice",
      sessionId: "abcd1234ef",
      dashboardId: 42,
      tableId: 7,
    });
    expect(out).toBe("_kbi_filt_ualice_d42_t7_sabcd1234");
  });

  it("ABSENT-KEY REGRESSION LOCK (dv path): byte-identical to v1.17", () => {
    const out = buildFilterViewName({
      username: "alice",
      sessionId: "abcd1234ef",
      dashboardId: 42,
      dynamicViewId: 7,
    });
    expect(out).toBe("_kbi_filt_ualice_d42_dv7_sabcd1234");
  });

  it("PRESENT-KEY (table path): appends _c<hash8> after _s<session> segment", () => {
    const out = buildFilterViewName({
      username: "alice",
      sessionId: "abcd1234ef",
      dashboardId: 42,
      tableId: 7,
      combinationKey: K,
    });
    expect(out).toBe("_kbi_filt_ualice_d42_t7_sabcd1234_c" + hashKey8(K));
  });

  it("PRESENT-KEY (dv path): appends _c<hash8> after _s<session> segment", () => {
    const out = buildFilterViewName({
      username: "alice",
      sessionId: "abcd1234ef",
      dashboardId: 42,
      dynamicViewId: 7,
      combinationKey: K,
    });
    expect(out).toBe("_kbi_filt_ualice_d42_dv7_sabcd1234_c" + hashKey8(K));
  });

  it("PRESENT-KEY: does NOT append _c when combinationKey is empty string", () => {
    const out = buildFilterViewName({
      username: "alice",
      sessionId: "abcd1234ef",
      dashboardId: 42,
      tableId: 7,
      combinationKey: "",
    });
    expect(out).toBe("_kbi_filt_ualice_d42_t7_sabcd1234");
    expect(out).not.toContain("_c");
  });

  it("worst-case length with combinationKey present stays < 200 chars", () => {
    const out = buildFilterViewName({
      username: "x".repeat(50),
      sessionId: "abcdef0123456789",
      dashboardId: 999999999,
      tableId: 999999999,
      combinationKey: K,
    });
    expect(out.length).toBeLessThan(200);
  });
});
