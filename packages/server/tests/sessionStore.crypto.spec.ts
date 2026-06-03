import { describe, expect, it } from "vitest";
import {
  encryptSecret,
  decryptSecret,
} from "../src/sessionStore";

// SESS-01 — server persists Kinetica password encrypted at rest with AES-256-GCM.
describe("sessionStore crypto (SESS-01)", () => {
  it("encryptSecret/decryptSecret round-trip recovers the original secret", () => {
    const blob = encryptSecret("hunter2");
    const recovered = decryptSecret(blob);
    expect(recovered).toBe("hunter2");
    // Structural checks
    expect(Buffer.isBuffer(blob.ciphertext)).toBe(true);
    expect(blob.ciphertext.length).toBeGreaterThan(0);
    expect(Buffer.isBuffer(blob.iv)).toBe(true);
    expect(blob.iv.length).toBe(12);
    expect(Buffer.isBuffer(blob.authTag)).toBe(true);
    expect(blob.authTag.length).toBe(16);
  });

  it("tamper: flipping any byte of ciphertext causes decryptSecret to throw", () => {
    const blob = encryptSecret("secret");
    const tampered = {
      ciphertext: Buffer.from(blob.ciphertext),
      iv: blob.iv,
      authTag: blob.authTag,
    };
    tampered.ciphertext[0] ^= 0xff;
    expect(() => decryptSecret(tampered)).toThrow();
    try {
      decryptSecret(tampered);
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toMatch(/unable to authenticate|unsupported state/i);
    }
  });

  it("tamper: flipping any byte of authTag causes decryptSecret to throw", () => {
    const blob = encryptSecret("secret");
    const tampered = {
      ciphertext: blob.ciphertext,
      iv: blob.iv,
      authTag: Buffer.from(blob.authTag),
    };
    tampered.authTag[0] ^= 0xff;
    expect(() => decryptSecret(tampered)).toThrow();
    try {
      decryptSecret(tampered);
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toMatch(/unable to authenticate|unsupported state/i);
    }
  });

  it("tamper: flipping any byte of iv causes decryptSecret to throw", () => {
    const blob = encryptSecret("secret");
    const tampered = {
      ciphertext: blob.ciphertext,
      iv: Buffer.from(blob.iv),
      authTag: blob.authTag,
    };
    tampered.iv[0] ^= 0xff;
    expect(() => decryptSecret(tampered)).toThrow();
    try {
      decryptSecret(tampered);
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toMatch(/unable to authenticate|unsupported state/i);
    }
  });

  it("encryptSecret generates a fresh 12-byte IV for every call (no IV reuse)", () => {
    const ivs = Array.from({ length: 10 }, () => encryptSecret("x").iv);
    const hexSet = new Set(ivs.map((iv) => iv.toString("hex")));
    // All 10 IVs must be distinct (statistically guaranteed with 96-bit random)
    expect(hexSet.size).toBe(10);
    // Each IV must be exactly 12 bytes
    for (const iv of ivs) {
      expect(iv.length).toBe(12);
    }
  });

  it("encryptSecret's ciphertext bytes do not contain the plaintext substring", () => {
    const plaintext = "supersecretpassword";
    const blob = encryptSecret(plaintext);
    // The ciphertext buffer should not contain the UTF-8 representation of the secret
    expect(blob.ciphertext.indexOf(plaintext)).toBe(-1);
    // Also confirm the plaintext cannot be found in the raw ciphertext bytes
    const ciphertextStr = blob.ciphertext.toString("utf8");
    expect(ciphertextStr).not.toContain(plaintext);
  });
});
