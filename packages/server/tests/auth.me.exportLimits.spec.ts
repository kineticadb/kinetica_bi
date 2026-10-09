/**
 * auth.me.exportLimits.spec.ts — Phase 130 (EXPRT-V126-15, D-18): /api/auth/me carries exportLimits,
 * read once at boot (createApp), unset caps as null.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { buildTestApp } from "./helpers/app";
import { createAdminSession } from "./helpers/db";

afterEach(() => {
  vi.unstubAllEnvs();
});

const getMe = async () => {
  const { cookie } = createAdminSession();
  const app = await buildTestApp();
  const res = await app.get("/api/auth/me").set("Cookie", cookie);
  expect(res.status).toBe(200);
  return res.body;
};

describe("GET /api/auth/me exportLimits", () => {
  it("EXPLIM-me-default: unset caps are null, concurrency defaults to 2", async () => {
    expect((await getMe()).exportLimits).toEqual({ maxRows: null, maxFileMb: null, maxConcurrentPerUser: 2 });
  });
  it("EXPLIM-me-set: env values flow through", async () => {
    vi.stubEnv("EXPORT_MAX_ROWS", "10000000");
    vi.stubEnv("EXPORT_MAX_FILE_MB", "2048");
    vi.stubEnv("EXPORT_MAX_CONCURRENT_PER_USER", "3");
    expect((await getMe()).exportLimits).toEqual({ maxRows: 10000000, maxFileMb: 2048, maxConcurrentPerUser: 3 });
  });
  it("EXPLIM-me-invalid: junk / zero fall back to defaults", async () => {
    vi.stubEnv("EXPORT_MAX_ROWS", "abc");
    vi.stubEnv("EXPORT_MAX_CONCURRENT_PER_USER", "0");
    expect((await getMe()).exportLimits).toEqual({ maxRows: null, maxFileMb: null, maxConcurrentPerUser: 2 });
  });
});
