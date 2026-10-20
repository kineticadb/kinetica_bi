import { describe, it, expect } from "vitest";
import { buildAiDynamicViewName, parseAiDynamicViewName, isOwnAiDynamicViewName, aiDvJobTag } from "../src/lib/aiDvName";

const base = { username: "alice", sid: "0123456789abcdef", nonce: "0a1b2c3d", tempId: -3, gen: 0 };

describe("aiDvName", () => {
  it("DVNAME-1: build shape, gen suffix", () => {
    expect(buildAiDynamicViewName(base)).toBe("_kbi_ai_ualice_s01234567_n0a1b2c3d_3");
    expect(buildAiDynamicViewName({ ...base, gen: 2 })).toBe("_kbi_ai_ualice_s01234567_n0a1b2c3d_3_g2");
  });
  it("DVNAME-2: sanitize + truncate user", () => {
    expect(buildAiDynamicViewName({ ...base, username: "john.doe@kinetica.com" })).toContain("_ujohn_doe_kinetica_com_s");
    const n = buildAiDynamicViewName({ ...base, username: "a".repeat(50) });
    expect(parseAiDynamicViewName(n)!.user).toBe("a".repeat(32));
  });
  it("DVNAME-3: bad ids throw", () => {
    for (const o of [{ nonce: "ZZZZZZZZ" }, { nonce: "0a1b2c3" }, { tempId: 0 }, { tempId: 3 }, { tempId: -1.5 }, { gen: -1 }, { gen: 1000 }]) {
      expect(() => buildAiDynamicViewName({ ...base, ...o })).toThrow("bad ai view id");
    }
  });
  it("DVNAME-4: parse round-trip", () => {
    expect(parseAiDynamicViewName(buildAiDynamicViewName(base))).toEqual({ user: "alice", sid8: "01234567", nonce: "0a1b2c3d", absTempId: 3, gen: 0 });
    expect(parseAiDynamicViewName(buildAiDynamicViewName({ ...base, gen: 2 }))!.gen).toBe(2);
  });
  it("DVNAME-5: parse rejects foreign shapes", () => {
    for (const n of [
      "_kbi_ai_uadmin_s12345678_1", "_kbi_dv_ualice_d1_3", "_kbi_filt_ualice_d1_t1_s01234567",
      "_kbi_ai_ualice_s01234567_n0a1b2c3d_3; DROP TABLE x", "ki_home._kbi_ai_ualice_s01234567_n0a1b2c3d_3", "",
    ]) expect(parseAiDynamicViewName(n)).toBeNull();
  });
  it("DVNAME-6: own check", () => {
    const n = buildAiDynamicViewName(base);
    expect(isOwnAiDynamicViewName(n, { username: "alice", sid: "0123456789abcdef" })).toBe(true);
    expect(isOwnAiDynamicViewName(n, { username: "bob", sid: "0123456789abcdef" })).toBe(false);
    expect(isOwnAiDynamicViewName(n, { username: "alice", sid: "ffffffffffff" })).toBe(false);
  });
  it("DVNAME-7: job tag", () => {
    const t = aiDvJobTag({ nonce: "0a1b2c3d", tempId: -3, gen: 2 });
    expect(t).toBe("aidv-0a1b2c3d-3-g2");
    expect(t).toMatch(/^[A-Za-z0-9-]{1,64}$/);
  });
  it("DVNAME-8: worst-case length", () => {
    expect(buildAiDynamicViewName({ ...base, username: "u".repeat(32), gen: 999, tempId: -999999999 }).length).toBeLessThan(120);
  });
});
