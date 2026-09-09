#!/usr/bin/env node
/**
 * Server test gate — SET-BASED, never a fixed pass-count.
 *
 * The server suite carries a documented set of permanently-failing files
 * (TD-V11-04 OIDC issuer-mock, db.smoke schema-snapshot drift, routes.wms
 * credential-forwarding) plus a rotating handful that fail ONLY under
 * cross-mode contamination in a full parallel run and pass in isolation
 * (TD-V16-TEST-ISOLATION). Asserting "0 failures" would redden every run and
 * train everyone to ignore CI; asserting a fixed pass-count would go stale on
 * every new spec.
 *
 * So the gate asserts a SET relationship:
 *
 *   1. Run the full suite.
 *   2. Failing files in KNOWN_FAILING            -> allowed.
 *   3. Any OTHER failing file                    -> re-run it ALONE.
 *        - passes in isolation                   -> contamination, allowed (reported).
 *        - still fails in isolation              -> REAL failure, gate fails.
 *
 * That keeps a genuine regression in a contamination-prone file detectable,
 * which a flat allowlist would not.
 *
 * DEFAULT_VIEW_TTL_MINUTES is forced empty: the dev `packages/server/.env` sets
 * it to 3 and `src/env.ts` calls dotenv.config() at import time, so a developer
 * running this locally would otherwise see TTL specs falsely redden. CI has no
 * .env and is unaffected either way.
 *
 * Usage:  node scripts/test-gate.mjs         (from packages/server)
 *         npm run test:gate --workspace @kinetica-bi/server
 */
import { spawnSync } from "node:child_process";
import { readFileSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Files that fail every run for documented, pre-existing reasons.
 * Adding an entry here is a deliberate act — it must come with a TD- reference.
 */
const KNOWN_FAILING = new Map([
  ["tests/auth.oidc.spec.ts", "TD-V11-04 — OIDC issuer-mock (`Issuer is not a constructor`)"],
  ["tests/auth.routes.spec.ts", "TD-V11-04 — OIDC-mode /api/auth/me tests (password-mode unaffected)"],
  ["tests/boot.hardening.spec.ts", "TD-V11-04 — OIDC issuer-mock"],
  ["tests/boot.wipe.spec.ts", "TD-V11-04 — OIDC issuer-mock"],
  ["tests/bootstrap.spec.ts", "TD-V11-04 — OIDC boot-probe tests"],
  ["tests/oidc.module.spec.ts", "TD-V11-04 — OIDC issuer-mock"],
  ["tests/db.smoke.spec.ts", "Schema-snapshot drift — DDL evolved across v1.15-v1.20"],
  ["tests/routes.wms.spec.ts", "routes.wms credential-forwarding — untouched since v1.17"],
]);

const CWD = process.cwd();
const tmp = mkdtempSync(join(tmpdir(), "kbi-test-gate-"));
const cleanup = () => rmSync(tmp, { recursive: true, force: true });

/**
 * Normalize a reported spec path to its `tests/...` suffix. The JSON reporter's
 * `name` is absolute, but resolving it against cwd is brittle: a wrong base
 * silently yields `../../tests/x.spec.ts`, which matches no allowlist entry AND
 * re-runs as a path vitest cannot resolve — the failure mode that would make
 * this gate wave through a real regression.
 */
const normalize = (p) => {
  const unix = String(p).split("\\").join("/");
  const i = unix.lastIndexOf("tests/");
  return i === -1 ? unix : unix.slice(i);
};

function runVitest(files, label) {
  const out = join(tmp, `${label}.json`);
  const args = ["vitest", "run", "--reporter=json", `--outputFile=${out}`, ...files];
  const res = spawnSync("npx", args, {
    cwd: CWD,
    encoding: "utf-8",
    env: { ...process.env, DEFAULT_VIEW_TTL_MINUTES: "" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let report;
  try {
    report = JSON.parse(readFileSync(out, "utf-8"));
  } catch {
    console.error(`\nFAILED to read a vitest JSON report for "${label}".`);
    console.error(res.stdout?.slice(-4000) ?? "");
    console.error(res.stderr?.slice(-4000) ?? "");
    cleanup();
    process.exit(2);
  }
  const failing = (report.testResults ?? [])
    .filter((t) => t.status === "failed")
    .map((t) => normalize(t.name));
  return { failing, report };
}

console.log("Server test gate — SET-BASED (failing set must be explainable, not empty)\n");

const { failing, report } = runVitest([], "full");
const total = report.numTotalTests ?? 0;
const passed = report.numPassedTests ?? 0;
console.log(`Full run: ${passed}/${total} tests passed; ${failing.length} file(s) failing.`);

const known = failing.filter((f) => KNOWN_FAILING.has(f));
const unknown = failing.filter((f) => !KNOWN_FAILING.has(f));

if (known.length) {
  console.log(`\nKnown-failing (allowed, ${known.length}):`);
  for (const f of known) console.log(`  - ${f}  [${KNOWN_FAILING.get(f)}]`);
}

let realFailures = [];
if (unknown.length) {
  console.log(`\nNot on the known list (${unknown.length}) — re-running each in isolation:`);
  for (const f of unknown) {
    const { failing: still, report: isoReport } = runVitest(
      [f],
      `iso-${f.replace(/[^a-z0-9]/gi, "_")}`
    );
    if ((isoReport.numTotalTests ?? 0) === 0) {
      // A zero-test run has an empty failing set and would otherwise be
      // misread as "passes in isolation".
      console.log(`  - ${f}  -> ran ZERO tests in isolation (path did not resolve)`);
      realFailures.push(`${f} (isolation re-run executed no tests)`);
    } else if (still.length === 0) {
      console.log(`  - ${f}  -> PASSES alone (TD-V16-TEST-ISOLATION contamination, allowed)`);
    } else {
      console.log(`  - ${f}  -> STILL FAILS alone (REAL failure)`);
      realFailures.push(f);
    }
  }
}

cleanup();

if (realFailures.length) {
  console.error(
    `\nGATE FAILED: ${realFailures.length} file(s) fail in isolation and are not documented:\n` +
      realFailures.map((f) => `  - ${f}`).join("\n") +
      `\n\nFix them, or — if this is a genuinely pre-existing documented issue — add an entry to\n` +
      `KNOWN_FAILING in scripts/test-gate.mjs with its TD- reference in the same commit.`
  );
  process.exit(1);
}

console.log("\nGATE PASSED — every failing file is either documented or contamination-only.");
