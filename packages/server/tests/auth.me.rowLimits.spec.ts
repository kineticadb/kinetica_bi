/**
 * auth.me.rowLimits.spec.ts — Phase 127 (EXPRT-V126-01, D-07): /api/auth/me carries
 * csvInBrowserMaxRows (CSV_INBROWSER_MAX_ROWS, read once at boot, default 100000).
 */
import { describe, it, expect, afterEach } from "vitest";
import { buildTestApp } from "./helpers/app";
import { createAdminSession } from "./helpers/db";

const prev = process.env.CSV_INBROWSER_MAX_ROWS;
afterEach(() => {
  // Never delete: dotenv would refill it from packages/server/.env.
  process.env.CSV_INBROWSER_MAX_ROWS = prev ?? "";
});

const getMe = async () => {
  const { cookie } = createAdminSession();
  const app = await buildTestApp();
  const res = await app.get("/api/auth/me").set("Cookie", cookie);
  expect(res.status).toBe(200);
  return res.body;
};

describe("GET /api/auth/me csvInBrowserMaxRows", () => {
  it("RLME-default: empty env -> 100000", async () => {
    process.env.CSV_INBROWSER_MAX_ROWS = "";
    expect((await getMe()).csvInBrowserMaxRows).toBe(100000);
  });
  it("RLME-env: 250000 -> 250000", async () => {
    process.env.CSV_INBROWSER_MAX_ROWS = "250000";
    expect((await getMe()).csvInBrowserMaxRows).toBe(250000);
  });
  it("RLME-invalid: abc -> 100000 (fallback + warn)", async () => {
    process.env.CSV_INBROWSER_MAX_ROWS = "abc";
    expect((await getMe()).csvInBrowserMaxRows).toBe(100000);
  });
});
