import { describe, it, expect } from "vitest";
import { isViewNotFoundError } from "./kineticaErrors";

describe("isViewNotFoundError (Phase 13 spike S3 verbatim — LIFE-V13-02)", () => {
  it("returns true for the Phase 13 spike S3 verbatim error string", () => {
    const err = new Error("SqlEngine: Object '_kbi_filt_u1_d2_t3_sabcdef12' not found (S/SDc:1513)");
    expect(isViewNotFoundError(err)).toBe(true);
  });

  it("returns true with extra wrapping text around the verbatim error", () => {
    const err = new Error("Something happened: SqlEngine: Object '_kbi_filt_v1' not found (S/SDc:1513) — request failed");
    expect(isViewNotFoundError(err)).toBe(true);
  });

  it("returns true case-insensitive on the SqlEngine regex portion", () => {
    const err = new Error("sqlengine: object '_kbi_filt_v1' not found S/SDc:1513");
    // Regex /SqlEngine: Object '[^']+' not found/i is case-insensitive on letters
    expect(isViewNotFoundError(err)).toBe(true);
  });

  it("returns false when SqlEngine substring is missing (only Kinetica code)", () => {
    const err = new Error("Some other error S/SDc:1513");
    expect(isViewNotFoundError(err)).toBe(false);
  });

  it("returns false when Kinetica code S/SDc:1513 is missing (only SqlEngine substring)", () => {
    const err = new Error("SqlEngine: Object 'foo' not found");
    expect(isViewNotFoundError(err)).toBe(false);
  });

  it("returns false for a generic 'SQL request failed: 400' error", () => {
    const err = new Error("SQL request failed: 400");
    expect(isViewNotFoundError(err)).toBe(false);
  });

  it("returns false for a 401 reauth error", () => {
    const err = new Error("Reauthentication required");
    expect(isViewNotFoundError(err)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isViewNotFoundError(undefined)).toBe(false);
  });

  it("returns false for null", () => {
    expect(isViewNotFoundError(null)).toBe(false);
  });

  it("returns false for empty object {} (no message)", () => {
    expect(isViewNotFoundError({})).toBe(false);
  });

  it("returns false when message is not a string (e.g., number)", () => {
    expect(isViewNotFoundError({ message: 42 })).toBe(false);
  });

  it("returns false for plain string (not an Error or object with message)", () => {
    expect(isViewNotFoundError("SqlEngine: Object '_kbi_filt_v1' not found (S/SDc:1513)")).toBe(false);
    // Pattern requires err to be an object with a string `message` property
  });

  it("returns true for a plain object with matching message field (duck-typed)", () => {
    const errLike = { message: "SqlEngine: Object '_kbi_filt_v1' not found (S/SDc:1513)" };
    expect(isViewNotFoundError(errLike)).toBe(true);
  });
});
