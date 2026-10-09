// Reads a type Set literal straight out of the WEB source, for MIRROR-PARITY assertions.
//
// There are no cross-package imports in this repo, so the server mirrors the web's type
// taxonomy by hand. A parity test that compares one hardcoded copy against ANOTHER hardcoded
// copy cannot fail when the web side changes — the v1.25 milestone audit (F2) found every
// mirror of packages/web/src/lib/columnTypes.ts guarded exactly that way. Reading the real
// file is the same technique packages/web/src/lib/schemaSyncStrings.spec.ts uses in the other
// direction.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const WEB_COLUMN_TYPES_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../web/src/lib/columnTypes.ts",
);

/**
 * The members of `const <name>: ReadonlySet<string> = new Set([...])` in the web's
 * columnTypes.ts. Throws, rather than returning [], when the declaration is not found or
 * holds no string literals — a renamed or reshaped Set must redden the parity test, never
 * satisfy it with an empty comparison.
 */
export function readWebTypeSet(name: string): string[] {
  const source = readFileSync(WEB_COLUMN_TYPES_PATH, "utf-8");
  const decl = new RegExp(
    `const ${name}: ReadonlySet<string> = new Set\\(\\[([\\s\\S]*?)\\]\\)`,
  ).exec(source);
  if (!decl) throw new Error(`${name} not found in ${WEB_COLUMN_TYPES_PATH}`);
  const members = [...decl[1].matchAll(/"([^"]*)"/g)].map((m) => m[1]);
  if (members.length === 0) throw new Error(`${name} has no string members in ${WEB_COLUMN_TYPES_PATH}`);
  return members;
}
