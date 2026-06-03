import request from "supertest";
import { createApp } from "../../src/index";

/**
 * Build a fresh supertest agent against the app constructed by createApp().
 * The app shares the production module-singleton db (since createApp imports
 * the same modules). Tests should clear the sessions table in beforeEach to
 * avoid cross-test bleeding:
 *
 *   import { db } from "../../src/db";
 *   beforeEach(() => { db.exec("DELETE FROM sessions"); });
 *
 * NOTE: Phase 5 made createApp() async (boot-time OIDC discovery in oidc mode).
 * All callers MUST `await buildTestApp()`.
 */
export const buildTestApp = async () => {
  const app = await createApp();
  return request(app);
};
