import { describe, it, expect } from "vitest";
import {
  sanitizeForViewName,
  buildFilterViewName,
} from "../src/lib/viewNaming";

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
