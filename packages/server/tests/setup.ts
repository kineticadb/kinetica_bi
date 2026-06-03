// Shared test setup. Loaded by vitest via setupFiles in vitest.config.ts.
// Sets a deterministic SESSION_ENCRYPTION_KEY for any spec that doesn't override it,
// and exposes a fetch mock helper for Kinetica login responses.
import { beforeEach, vi } from "vitest";

// 64 hex chars = 32 bytes. Used by spec files that don't set their own key.
process.env.SESSION_ENCRYPTION_KEY =
  process.env.SESSION_ENCRYPTION_KEY ||
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

// Default Kinetica URL for any spec that doesn't override.
process.env.KINETICA_URL = process.env.KINETICA_URL || "https://kinetica.test:9191";

// Use an in-memory SQLite database for all tests so that each spec file
// (with isolate:true) gets its own isolated in-memory instance and
// spec files do not interfere via the shared on-disk file.
process.env.DB_PATH = process.env.DB_PATH || ":memory:";

// AUTH_SECRET for jwt signing.
process.env.AUTH_SECRET = process.env.AUTH_SECRET || "test-auth-secret-at-least-16-chars";

beforeEach(() => {
  // Clear any global fetch stub between tests.
  vi.restoreAllMocks();
});

// Helper: stub global.fetch with a Kinetica `/execute/sql` happy-path response.
// Use in tests like:  mockKineticaLoginOK();  await login(...);
export const mockKineticaLoginOK = () => {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ status: "OK" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

export const mockKineticaLoginUnauthorized = () => {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response("Unauthorized", { status: 401 })
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};
