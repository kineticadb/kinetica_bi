// Phase 131: CLAUDE.md UI rule as a check. tsc/vitest/theme-guard cannot see an invented className (it renders unstyled). Limits: object-key classes (clsx({ a: x })) are not seen; keep new components to string-literal classNames.
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../src/styles/global.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const defined = new Set();
for (const m of css.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) defined.add(m[1]);

function literalsIn(expr) {
  const out = [];
  const re = /"([^"]*)"|'([^']*)'|`([^`]*)`/g;
  let m;
  while ((m = re.exec(expr))) {
    if (m[1] !== undefined) out.push(m[1]);
    else if (m[2] !== undefined) out.push(m[2]);
    else out.push(m[3].replace(/\$\{[^}]*\}/g, " "));
  }
  return out;
}

function collect(src) {
  const texts = [];
  const re = /className=/g;
  let m;
  while ((m = re.exec(src))) {
    let i = m.index + m[0].length;
    if (src[i] === '"') {
      const end = src.indexOf('"', i + 1);
      if (end > 0) texts.push(src.slice(i + 1, end));
    } else if (src[i] === "{") {
      let depth = 0;
      let j = i;
      for (; j < src.length; j++) {
        if (src[j] === "{") depth++;
        else if (src[j] === "}") {
          depth--;
          if (depth === 0) break;
        }
      }
      texts.push(...literalsIn(src.slice(i + 1, j)));
    }
  }
  return texts;
}

const files = process.argv.slice(2);
let count = 0;
let bad = false;
for (const f of files) {
  let src;
  try {
    src = readFileSync(f, "utf8");
  } catch (e) {
    console.log(`MISSING-FILE ${f}`);
    bad = true;
    continue;
  }
  const seen = new Set();
  for (const t of collect(src)) {
    for (const tok of t.split(/\s+/)) {
      if (!/^[_a-zA-Z][\w-]*$/.test(tok) || tok.endsWith("-")) continue;
      if (seen.has(tok)) continue;
      seen.add(tok);
      count++;
      if (!defined.has(tok)) {
        console.log(`MISSING ${tok} (${f})`);
        bad = true;
      }
    }
  }
}
if (bad) process.exit(1);
console.log(`OK ${count} tokens in ${files.length} files`);
