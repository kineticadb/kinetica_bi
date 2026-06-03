import { describe, it, expect } from "vitest";
import {
  KineticaAuthError,
  KineticaPermissionError,
  KineticaUpstreamError,
} from "../src/kineticaErrors";

describe("KineticaAuthError", () => {
  it("is instanceof Error", () => {
    const e = new KineticaAuthError("bad creds", 401);
    expect(e).toBeInstanceOf(Error);
  });

  it("is instanceof KineticaAuthError", () => {
    const e = new KineticaAuthError("bad creds", 401);
    expect(e).toBeInstanceOf(KineticaAuthError);
  });

  it("has name === 'KineticaAuthError'", () => {
    const e = new KineticaAuthError("bad creds", 401);
    expect(e.name).toBe("KineticaAuthError");
  });

  it("has fixed status === 401", () => {
    const e = new KineticaAuthError("bad creds", 401);
    expect(e.status).toBe(401);
  });

  it("carries upstreamStatus from constructor arg", () => {
    const e = new KineticaAuthError("bad creds", 401);
    expect(e.upstreamStatus).toBe(401);
  });

  it("preserves the message string", () => {
    const e = new KineticaAuthError("Kinetica rejected credentials", 401);
    expect(e.message).toBe("Kinetica rejected credentials");
  });

  it("message does NOT contain 'password', 'Basic ', or long base64-looking strings", () => {
    const e = new KineticaAuthError("Kinetica rejected credentials", 401);
    expect(e.message).not.toMatch(/password/i);
    expect(e.message).not.toContain("Basic ");
    // No base64 string over 16 chars (sentinel for leaked credentials)
    expect(e.message).not.toMatch(/[A-Za-z0-9+/]{17,}={0,2}/);
  });

  it("is NOT instanceof KineticaPermissionError", () => {
    const e = new KineticaAuthError("bad creds", 401);
    expect(e).not.toBeInstanceOf(KineticaPermissionError);
  });

  it("is NOT instanceof KineticaUpstreamError", () => {
    const e = new KineticaAuthError("bad creds", 401);
    expect(e).not.toBeInstanceOf(KineticaUpstreamError);
  });
});

describe("KineticaPermissionError", () => {
  it("is instanceof Error", () => {
    const e = new KineticaPermissionError("permission denied", 403);
    expect(e).toBeInstanceOf(Error);
  });

  it("is instanceof KineticaPermissionError", () => {
    const e = new KineticaPermissionError("permission denied", 403);
    expect(e).toBeInstanceOf(KineticaPermissionError);
  });

  it("has name === 'KineticaPermissionError'", () => {
    const e = new KineticaPermissionError("permission denied", 403);
    expect(e.name).toBe("KineticaPermissionError");
  });

  it("has fixed status === 403", () => {
    const e = new KineticaPermissionError("permission denied", 403);
    expect(e.status).toBe(403);
  });

  it("carries upstreamStatus from constructor arg (403)", () => {
    const e = new KineticaPermissionError("permission denied", 403);
    expect(e.upstreamStatus).toBe(403);
  });

  it("carries upstreamStatus from constructor arg (400 — DDL denial via HTTP 400)", () => {
    // Kinetica returns 400 for DDL access denial — see SPIKE.md
    const e = new KineticaPermissionError("Kinetica permission denied", 400);
    expect(e.upstreamStatus).toBe(400);
    expect(e.status).toBe(403); // still maps to client-facing 403
  });

  it("preserves the message string", () => {
    const e = new KineticaPermissionError("Kinetica permission denied", 403);
    expect(e.message).toBe("Kinetica permission denied");
  });

  it("message does NOT contain 'password', 'Basic ', or long base64-looking strings", () => {
    const e = new KineticaPermissionError("Kinetica permission denied", 403);
    expect(e.message).not.toMatch(/password/i);
    expect(e.message).not.toContain("Basic ");
    expect(e.message).not.toMatch(/[A-Za-z0-9+/]{17,}={0,2}/);
  });

  it("is NOT instanceof KineticaAuthError", () => {
    const e = new KineticaPermissionError("permission denied", 403);
    expect(e).not.toBeInstanceOf(KineticaAuthError);
  });

  it("is NOT instanceof KineticaUpstreamError", () => {
    const e = new KineticaPermissionError("permission denied", 403);
    expect(e).not.toBeInstanceOf(KineticaUpstreamError);
  });
});

describe("KineticaUpstreamError", () => {
  it("is instanceof Error", () => {
    const e = new KineticaUpstreamError("upstream failure", 500);
    expect(e).toBeInstanceOf(Error);
  });

  it("is instanceof KineticaUpstreamError", () => {
    const e = new KineticaUpstreamError("upstream failure", 500);
    expect(e).toBeInstanceOf(KineticaUpstreamError);
  });

  it("has name === 'KineticaUpstreamError'", () => {
    const e = new KineticaUpstreamError("upstream failure", 500);
    expect(e.name).toBe("KineticaUpstreamError");
  });

  it("has fixed status === 502", () => {
    const e = new KineticaUpstreamError("upstream failure", 500);
    expect(e.status).toBe(502);
  });

  it("carries upstreamStatus from constructor arg", () => {
    const e = new KineticaUpstreamError("upstream failure", 500);
    expect(e.upstreamStatus).toBe(500);
  });

  it("upstreamStatus is undefined for network-failure case (no arg)", () => {
    const e = new KineticaUpstreamError("Failed to reach Kinetica");
    expect(e.upstreamStatus).toBeUndefined();
  });

  it("preserves the message string", () => {
    const e = new KineticaUpstreamError("Kinetica returned 500", 500);
    expect(e.message).toBe("Kinetica returned 500");
  });

  it("message does NOT contain 'password', 'Basic ', or long base64-looking strings", () => {
    const e = new KineticaUpstreamError("Kinetica returned 500", 500);
    expect(e.message).not.toMatch(/password/i);
    expect(e.message).not.toContain("Basic ");
    expect(e.message).not.toMatch(/[A-Za-z0-9+/]{17,}={0,2}/);
  });

  it("is NOT instanceof KineticaAuthError", () => {
    const e = new KineticaUpstreamError("upstream failure", 500);
    expect(e).not.toBeInstanceOf(KineticaAuthError);
  });

  it("is NOT instanceof KineticaPermissionError", () => {
    const e = new KineticaUpstreamError("upstream failure", 500);
    expect(e).not.toBeInstanceOf(KineticaPermissionError);
  });
});

describe("instanceof cross-check (distinguishable classes)", () => {
  it("each class is only instanceof itself, not the other two", () => {
    const auth = new KineticaAuthError("a", 401);
    const perm = new KineticaPermissionError("p", 403);
    const upstream = new KineticaUpstreamError("u", 500);

    expect(auth).toBeInstanceOf(KineticaAuthError);
    expect(auth).not.toBeInstanceOf(KineticaPermissionError);
    expect(auth).not.toBeInstanceOf(KineticaUpstreamError);

    expect(perm).toBeInstanceOf(KineticaPermissionError);
    expect(perm).not.toBeInstanceOf(KineticaAuthError);
    expect(perm).not.toBeInstanceOf(KineticaUpstreamError);

    expect(upstream).toBeInstanceOf(KineticaUpstreamError);
    expect(upstream).not.toBeInstanceOf(KineticaAuthError);
    expect(upstream).not.toBeInstanceOf(KineticaPermissionError);
  });
});

// Test asserting that 400 + 'Access denied; ok' body → KineticaPermissionError (not KineticaUpstreamError)
// This test documents the classification CONTRACT so helper implementations (kinetica.ts Task 3)
// must handle this case. The constructor itself accepts 400 as upstreamStatus for KineticaPermissionError.
describe("400 + access-denied body → KineticaPermissionError (02-01 spike finding)", () => {
  it("KineticaPermissionError can be constructed with upstreamStatus=400 (Kinetica DDL-denial HTTP code)", () => {
    // Simulates: HTTP 400 + body.message = 'Access denied; ok'
    const e = new KineticaPermissionError("Kinetica permission denied", 400);
    expect(e).toBeInstanceOf(KineticaPermissionError);
    expect(e).not.toBeInstanceOf(KineticaUpstreamError);
    expect(e.upstreamStatus).toBe(400);
    expect(e.status).toBe(403);
  });
});
