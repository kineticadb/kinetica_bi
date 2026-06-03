// Build an isolated in-memory better-sqlite3 instance for tests.
// Wave 1 will add a sessionStore.ts factory; until then this just exposes createDb.
import { createDb } from "../../src/db";

export const buildInMemoryDb = () => createDb(":memory:");
