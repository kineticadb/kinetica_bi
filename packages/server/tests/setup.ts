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

// Row-limit envs: env.ts dotenv.config loads packages/server/.env (dev overrides) but does NOT
// overwrite keys already present in process.env, so an empty string pins the code default.
process.env.KINETICA_MAX_ROWS_PER_QUERY = "";
process.env.KINETICA_MAX_RECORDS_PER_CALL = "";
process.env.CSV_INBROWSER_MAX_ROWS = "";
// Export runner envs: same dev .env leak guard (specs set EXPORT_DIR to a mkdtemp dir themselves).
process.env.EXPORT_DIR = "";
process.env.EXPORT_VIEW_TTL_MINUTES = "";
// Phase 130 export caps/TTL: dev .env leak guard (a dev EXPORT_MAX_CONCURRENT_PER_USER=1 would falsely 429 specs)
process.env.EXPORT_TTL_HOURS = "";
process.env.EXPORT_MAX_ROWS = "";
process.env.EXPORT_MAX_FILE_MB = "";
process.env.EXPORT_MAX_CONCURRENT_PER_USER = "";

// Phase 133 AI env: dev .env leak guard — a developer's real AI key/flags must never reach specs.
process.env.AI_ENABLED = "";
process.env.AI_PROVIDER = "";
process.env.AI_BASE_URL = "";
process.env.AI_MODEL = "";
process.env.AI_API_KEY = "";
process.env.AI_DATA_ACCESS = "";
process.env.AI_MAX_TOOL_STEPS = "";
process.env.AI_TIMEOUT_MS = "";
// Phase 135: caps / history / tool mode / audit retention (same leak guard).
process.env.AI_MAX_ANSWERS_PER_USER_PER_HOUR = "";
process.env.AI_MAX_ANSWERS_PER_DAY = "";
process.env.AI_HISTORY_TURNS = "";
process.env.AI_TOOL_MODE = "";
process.env.AI_AUDIT_RETENTION_DAYS = "";
// Phase 136: D-09 new-widget cap (same leak guard)
process.env.AI_MAX_NEW_WIDGETS = "";
// Phase 139: AI dynamic-view limits (same leak guard)
process.env.AI_DV_MAX_RECORDS = "";
process.env.AI_DV_MAX_JOINS = "";
process.env.AI_DV_MAX_PER_SESSION = "";
process.env.AI_DV_PREFLIGHT_TIMEOUT_MS = "";

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
