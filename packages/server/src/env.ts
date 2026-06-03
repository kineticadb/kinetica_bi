// Loads .env before any other module evaluates. MUST be the first import in
// index.ts: ESM evaluates imported modules before the importer's body, so a
// dotenv.config() call inside index.ts runs too late for modules that
// fail-fast on env at import time (sessionStore.ts SESSION_ENCRYPTION_KEY).
import dotenv from "dotenv";

dotenv.config();
