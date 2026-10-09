/**
 * schemaSyncStrings spec — Phase 126 Plan 02 (SSYNC-V125-01)
 *
 * MIRROR-PARITY — the one guard standing between the web mirror of
 * SCHEMA_APPLY_TEXT_WIDTH_GAP and silent drift from the server's own constant.
 *
 * Why a static source read rather than an import: the server constant reaches NO response
 * body (`grep SCHEMA_APPLY_TEXT_WIDTH_GAP packages/server/src/index.ts` = 0) and this repo
 * has no cross-package imports, so the web CANNOT import it. ROADMAP criterion 6's "the UI
 * imports the constant" is not literally achievable; 126-CONTEXT.md records that correction
 * and mandates this mirror-plus-parity-guard instead. Adding the constant to the apply
 * response would be a `packages/server` change and is explicitly NOT wanted.
 *
 * The technique (readFileSync of a sibling package's source) is already used in-tree by
 * theme-guard.spec.ts, WidgetFilterBadge, LayersLegendPanel and WidgetRenderer.
 *
 * The `segments.length === 3` assertion is LOAD-BEARING, not decoration: without it a
 * segment regex that matched nothing would join to "" and the parity assertion would
 * compare "" to "" and pass — an unfalsifiable guard. Probe P5 in plan 02 task 3 mutates
 * the regex to match nothing precisely to prove this assertion reddens.
 *
 * Path resolution: process.cwd() is packages/web when vitest runs (see theme-guard.spec.ts
 * lines 15-18). Do NOT invoke vitest with --root from the repo root or this path breaks.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { SCHEMA_APPLY_TEXT_WIDTH_GAP } from "./schemaSyncStrings";

const SERVER_SCHEMA_APPLY = resolve(process.cwd(), "../server/src/lib/schemaApply.ts");

const DECLARATION_RE =
  /export const SCHEMA_APPLY_TEXT_WIDTH_GAP\s*=\s*([\s\S]*?);\n/;
const SEGMENT_RE = /"((?:[^"\\]|\\.)*)"/g;

describe("MIRROR-PARITY: web mirror of SCHEMA_APPLY_TEXT_WIDTH_GAP", () => {
  it("MIRROR-PARITY — reassembles the server declaration and matches the web mirror byte-for-byte", () => {
    const source = readFileSync(SERVER_SCHEMA_APPLY, "utf-8");

    const declaration = DECLARATION_RE.exec(source);
    expect(
      declaration,
      "Could not locate `export const SCHEMA_APPLY_TEXT_WIDTH_GAP = ...;` in " +
        "packages/server/src/lib/schemaApply.ts. If the server renamed or reshaped the " +
        "constant, update BOTH this regex and the web mirror in schemaSyncStrings.ts.",
    ).not.toBeNull();

    const segments = [...(declaration?.[1] ?? "").matchAll(SEGMENT_RE)].map((m) => m[1]);

    // LOAD-BEARING: a regex matching zero segments would make the parity assertion below
    // compare "" to "" and pass. The server constant is a THREE-segment + concatenation.
    expect(
      segments.length,
      "Expected the server constant to be a 3-segment string concatenation. " +
        `Got ${segments.length}. Either the server reshaped it (update the mirror AND this ` +
        "count) or the segment regex stopped matching (fix the regex — do NOT delete this " +
        "assertion; it is the only thing making this guard falsifiable).",
    ).toBe(3);

    expect(segments.join("")).toBe(SCHEMA_APPLY_TEXT_WIDTH_GAP);
  });
});
