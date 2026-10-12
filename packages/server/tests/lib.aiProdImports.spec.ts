// Phase 135-11 Task 2: production modules must never import the test-only scripted providers.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { posix } from "node:path";

const SRC = join(__dirname, "../src");
const TARGET = "lib/ai/providers/scripted";

/** Returns the file names (keys) whose import/export/dynamic-import specifiers resolve to the scripted providers module. */
export function filesImportingScripted(files: Record<string, string>): string[] {
  const spec = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)["']([^"']+)["']/g;
  const hits: string[] = [];
  for (const [name, text] of Object.entries(files)) {
    for (const m of text.matchAll(spec)) {
      const s = m[1];
      if (!s.startsWith(".")) continue;
      const resolved = posix.normalize(posix.join(posix.dirname(name), s)).replace(/\.(ts|js)$/, "");
      if (resolved === TARGET || resolved.endsWith(`/${TARGET}`)) {
        hits.push(name);
        break;
      }
    }
  }
  return hits;
}

function walk(dir: string, out: Record<string, string>): void {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) {
      if (relative(SRC, p).split(sep)[0] === "spikes") continue;
      walk(p, out);
    } else if (e.endsWith(".ts")) {
      out[relative(SRC, p).split(sep).join("/")] = readFileSync(p, "utf8");
    }
  }
}

describe("production import guard", () => {
  it("IMP-1 no module under src/ (excluding spikes) imports providers/scripted", () => {
    const files: Record<string, string> = {};
    walk(SRC, files);
    expect(Object.keys(files).length).toBeGreaterThan(50); // the walker really read the tree
    expect(Object.keys(files)).toContain("lib/ai/providers/scripted.ts"); // the scripted file itself is scanned (it must not import itself)
    expect(filesImportingScripted(files)).toEqual([]);
  });

  it("IMP-P positive control: the same walker flags an importing file (static, dynamic, re-export, extension forms)", () => {
    expect(filesImportingScripted({ "x.ts": 'import { ScriptedProvider } from "./lib/ai/providers/scripted";' })).toEqual(["x.ts"]);
    expect(filesImportingScripted({ "lib/ai/y.ts": 'const m = await import("./providers/scripted.js");' })).toEqual(["lib/ai/y.ts"]);
    expect(filesImportingScripted({ "aiRoutes.ts": 'export * from "./lib/ai/providers/scripted"' })).toEqual(["aiRoutes.ts"]);
    expect(filesImportingScripted({ "ok.ts": 'import { part } from "./lib/ai/outbound";' })).toEqual([]);
  });
});
