import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.spec.ts"],
    setupFiles: ["./tests/setup.ts"],
    // Each spec file gets a fresh module graph so module-singleton state
    // (e.g., the cached SESSION_KEY in sessionStore) is reset between files.
    isolate: true,
    // Always run once — never watch — so CI / pre-commit hooks finish.
    // Callers pass --run explicitly per VALIDATION.md but this defaults defensively.
    passWithNoTests: false,
  },
});
