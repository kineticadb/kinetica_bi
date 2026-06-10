/**
 * Phase 58 Plan 02 — ACTION ENGINE DECOUPLING STATIC GREP
 *
 * SAFETY-V111-02: The engine modules (widgetAction.ts, actionAllowList.ts,
 * applyWidgetAction.ts, widgetActionStore.ts) MUST NEVER import filter-store
 * symbols or reference filterVersion.
 *
 * Enforced via static source-grep assertions that check the raw source text of
 * each engine module. This is a permanent regression lock — any accidental
 * import of filter symbols would cause CI to fail immediately.
 *
 * Mirrors the Phase 44 DataFilterRenderer sole-materialize-trigger invariant
 * assertion (DataFilterRenderer.spec.tsx:609-619 pattern).
 *
 * Banned symbols:
 *   - materializeFilter   — sole materialize trigger invariant
 *   - dropFilterView      — filter-view teardown (filter system)
 *   - addFilter           — filter store mutation
 *   - setBulkFilters      — filter store bulk mutation
 *   - filterVersion       — filter version counter
 *
 * These symbols are read as regexps so word boundaries are respected in the
 * grep assertions.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Engine module paths (relative to this file in src/lib/)
// ---------------------------------------------------------------------------

// widgetAction.ts and actionAllowList.ts live in src/lib/ (same dir as this spec)
// applyWidgetAction.ts lives in src/lib/ (same dir)
// widgetActionStore.ts lives in src/store/ (one level up, then into store/)

const ENGINE_MODULES = [
  path.resolve(__dirname, "widgetAction.ts"),
  path.resolve(__dirname, "actionAllowList.ts"),
  path.resolve(__dirname, "applyWidgetAction.ts"),
  path.resolve(path.join(__dirname, "../store"), "widgetActionStore.ts"),
];

// ---------------------------------------------------------------------------
// Banned symbols (static grep patterns)
// ---------------------------------------------------------------------------

const BANNED_PATTERNS: { pattern: RegExp; description: string }[] = [
  { pattern: /materializeFilter/, description: "materializeFilter (sole-trigger invariant)" },
  { pattern: /dropFilterView/, description: "dropFilterView (filter-view teardown)" },
  { pattern: /addFilter\b/, description: "addFilter (filter store mutation)" },
  { pattern: /setBulkFilters/, description: "setBulkFilters (bulk filter mutation)" },
  { pattern: /filterVersion/, description: "filterVersion (filter version counter)" },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ACTION ENGINE DECOUPLING — SAFETY-V111-02 static source grep", () => {
  for (const modulePath of ENGINE_MODULES) {
    const moduleName = path.relative(
      path.resolve(__dirname, "../.."),
      modulePath
    );

    describe(`module: ${moduleName}`, () => {
      // Read source once per module describe block
      const source = fs.readFileSync(modulePath, "utf-8");

      for (const { pattern, description } of BANNED_PATTERNS) {
        it(`does NOT reference ${description}`, () => {
          // The assertion is: the source text does not contain any actual IMPORT or
          // CALL of the banned symbol. Comments that mention these symbols (e.g., in
          // INVARIANT documentation) are acceptable — the real gate is no live import.
          //
          // We check for import statements and direct usage (not comments).
          // Strategy: strip comment lines, then assert no match.
          const sourceWithoutComments = source
            .split("\n")
            .filter((line) => {
              const trimmed = line.trim();
              // Remove single-line comments and JSDoc lines
              return !trimmed.startsWith("//") && !trimmed.startsWith("*") && !trimmed.startsWith("/*");
            })
            .join("\n");

          expect(sourceWithoutComments).not.toMatch(pattern);
        });
      }
    });
  }
});
