import { afterEach, describe, expect, it } from "vitest";
import { getSessionEncryptionKey } from "../src/sessionStore";

describe("sessionStore boot validation (SESSION_ENCRYPTION_KEY)", () => {
  // Restore the valid key after each test so subsequent tests don't break.
  afterEach(() => {
    process.env.SESSION_ENCRYPTION_KEY =
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  });

  it("getSessionEncryptionKey throws if SESSION_ENCRYPTION_KEY is unset", () => {
    delete process.env.SESSION_ENCRYPTION_KEY;
    expect(() => getSessionEncryptionKey()).toThrow(/SESSION_ENCRYPTION_KEY must be set/);
  });

  it("getSessionEncryptionKey throws if SESSION_ENCRYPTION_KEY is not exactly 64 hex chars", () => {
    process.env.SESSION_ENCRYPTION_KEY = "abc";
    expect(() => getSessionEncryptionKey()).toThrow(/64 hex characters/);
  });

  it("getSessionEncryptionKey throws if SESSION_ENCRYPTION_KEY contains non-hex characters", () => {
    // 64 chars but non-hex (z is not 0-9a-fA-F)
    process.env.SESSION_ENCRYPTION_KEY = "z".repeat(64);
    expect(() => getSessionEncryptionKey()).toThrow(/64 hex characters/);
  });

  it("getSessionEncryptionKey returns a Buffer of length 32 on a valid key", () => {
    process.env.SESSION_ENCRYPTION_KEY = "0".repeat(64);
    const buf = getSessionEncryptionKey();
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBe(32);
  });

  it("error message includes the hint: openssl rand -hex 32", () => {
    delete process.env.SESSION_ENCRYPTION_KEY;
    try {
      getSessionEncryptionKey();
      expect.fail("Should have thrown");
    } catch (err) {
      expect((err as Error).message).toContain("openssl rand -hex 32");
    }
  });
});
