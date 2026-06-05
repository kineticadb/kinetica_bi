// Build an isolated in-memory better-sqlite3 instance for tests.
// Wave 1 will add a sessionStore.ts factory; until then this just exposes createDb.
import { createDb } from "../../src/db";
import jwt from "jsonwebtoken";
import { createSession } from "../../src/sessionStore";

export const buildInMemoryDb = () => createDb(":memory:");

// Seeds an admin session against the production module-singleton db and returns a cookie.
// Uses APP_ADMIN_USERNAME (default "admin") so getEffectivePermissions short-circuits to
// ALL_PERMISSIONS via the Phase 46 bootstrap path — NO user_roles row needed.
// Replaces the per-spec `const sid = createSession(...); jwt.sign(...)` idiom (GUARD-V18-05).
export const createAdminSession = (opts?: { kineticaUrl?: string }): { sid: string; cookie: string } => {
  const kineticaUrl = opts?.kineticaUrl ?? process.env.KINETICA_URL!;
  const username = process.env.APP_ADMIN_USERNAME || "admin";
  const sid = createSession({ username, secret: "admin-test-secret", kineticaUrl });
  const token = jwt.sign({ sub: username, sid, v: 1 }, process.env.AUTH_SECRET!, { expiresIn: "8h" });
  return { sid, cookie: `kbi_session=${token}` };
};
