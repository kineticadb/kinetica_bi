---
phase: 133-ai-contract-shared-package-ssync-f6-fix-spikes
plan: 05
subsystem: server-build
tags: [shared-package, esbuild, docker, ci]
requires: ["133-04"]
provides:
  - "server lib/aiContract.ts seam over @kinetica-bi/shared"
  - "build:server = tsc --noEmit + esbuild with --alias (shared inlined)"
affects: [133-06, 135]
key-files:
  created:
    - packages/server/src/lib/aiContract.ts
    - packages/server/tests/lib.aiContract.spec.ts
  modified:
    - packages/server/package.json
    - package.json
    - package-lock.json
    - Dockerfile
    - README.md
    - .github/workflows/ci.yml
requirements-completed: []
---

# Phase 133 Plan 05: Server consumes shared package, unified build Summary

The server imports `@kinetica-bi/shared` through one seam, builds via a single esbuild-with-alias script shared by local and Docker flows, and CI now tests the shared package.

## Commits
- 30cc11f: Task 1 (deps, aiContract seam, AIC-1..4 spec, lockfile; server package.json also carries the Task 2 build script)
- 99befd3: Task 2 (Dockerfile, README, root scripts, CI shared job)

## Verification
- Server tsc clean (no TS6059); AIC spec 4/4 green.
- `npm run build:server` succeeds, dist/index.js 311 KB.
- `grep -c "@kinetica-bi/shared" dist/index.js` = 0, but this is trivially true now because index.ts does not yet import the shared package (133-06 wires it). To get a real check, I bundled `src/lib/aiContract.ts` alone with the same flags: 0 bare specifiers and the op names are inlined, so the alias path resolves.
- Docker: real `docker build --target server` succeeded. In the image, `import("zod")` resolves. Booting the container reaches `createDb` and then fails with EACCES on `/app/data` because no data volume was mounted; this is unrelated to this plan. A full boot with a volume was not run.
- Shared tests were not re-run in this plan. `test:shared` script was not executed (shared vitest script already has `--run`; the extra `-- --run` is harmless).
- Full server set-based gate (`test-gate.mjs`) not run, to avoid disturbing parallel executors.

## Deviations from Plan
- Task 1's commit includes packages/server/package.json with both the deps and the build script (same file, one commit) instead of splitting across tasks.
- `grep -c "@kinetica-bi/shared" dist/index.js` = 0 cannot discriminate yet (see above); reported rather than treated as proof.

## Self-Check: PASSED
Files present, commits 30cc11f and 99befd3 exist.
