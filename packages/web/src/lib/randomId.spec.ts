import { describe, it, expect, afterEach, vi } from "vitest";
import { randomId } from "./randomId";

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("randomId", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns a v4 uuid in a secure context (crypto.randomUUID available)", () => {
    expect(randomId()).toMatch(V4);
  });

  it("falls back to getRandomValues when randomUUID is missing (insecure origin)", () => {
    // Exactly the shape of `crypto` on http:// at a hostname or IP: getRandomValues
    // present, randomUUID absent. Previously this threw
    // "crypto.randomUUID is not a function" and broke spatial filtering.
    vi.stubGlobal("crypto", {
      getRandomValues: (a: Uint8Array) => {
        for (let i = 0; i < a.length; i += 1) a[i] = i * 7 + 3;
        return a;
      },
    });
    const id = randomId();
    expect(id).toMatch(V4);
    // version + variant nibbles forced regardless of the source bytes
    expect(id[14]).toBe("4");
    expect(["8", "9", "a", "b"]).toContain(id[19]);
  });

  it("falls back to Math.random when crypto is absent entirely", () => {
    vi.stubGlobal("crypto", undefined);
    expect(randomId()).toMatch(V4);
  });

  it("does not collide across many calls", () => {
    const ids = new Set(Array.from({ length: 2000 }, () => randomId()));
    expect(ids.size).toBe(2000);
  });
});
