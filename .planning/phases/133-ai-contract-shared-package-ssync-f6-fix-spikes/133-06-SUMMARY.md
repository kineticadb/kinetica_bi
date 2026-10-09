---
phase: 133-ai-contract-shared-package-ssync-f6-fix-spikes
plan: 06
subsystem: server-ai-config
tags: [ai, env-config, boot, redaction]
requires: ["133-03", "133-05"]
provides:
  - "lib/aiConfig.ts: parseAiConfig, formatAiConfigLog, loadAiConfig, getAiConfig"
affects: [135]
key-files:
  created:
    - packages/server/src/lib/aiConfig.ts
    - packages/server/tests/lib.aiConfig.spec.ts
    - packages/server/tests/boot.aiConfig.spec.ts
  modified:
    - packages/server/src/index.ts
    - packages/server/tests/setup.ts
    - packages/server/.env.example
    - README.md
requirements-completed: [AIPRV-V20-01]
---

# Phase 133 Plan 06: AI env configuration Summary

Pure env-injected AI config parser (off by default, all errors collected, non-enumerable key, origin-only endpoint in logs) wired as one boot call that degrades to "AI disabled" and never exits, fetches or logs the key.

## Commits
- 756b03e test: failing parser specs (RED, module missing)
- d2038ed feat: aiConfig.ts (GREEN, 12/12)
- 3c25d6f feat: boot wiring, setup.ts leak guard, boot spec, .env.example, README

## Verification
- Server tsc clean; lib.aiConfig (12) + boot.aiConfig (3) specs green.
- Discrimination probes: apiKey enumerable -> AICFG-3 red; logging full baseUrl -> AICFG-11 red; both reverted.
- AIBOOT-1/2 pass red-first: AIBOOT-2/3 failed before wiring (no `[ai]` line); AIBOOT-1 passes pre-wiring by design (silence baseline).
- Gate `node scripts/test-gate.mjs`: PASSED, 1863/1916, 8 failing files all in the documented known set.
- Real bundle check (index.ts now reaches shared via aiConfig -> aiContract): `grep -c "@kinetica-bi/shared" dist/index.js` = 0; `ALLOW_LIST_VERSION = "v3"` = 1; `contract=` = 1. dist 322.1 KB.
- Dist boot smoke (`node dist/index.js`, in-memory DB, Ollama-style env): `[ai] AI enabled: provider=openai-compatible model=llama3.1 endpoint=http://localhost:11434 dataAccess=schema maxToolSteps=8 timeoutMs=60000 key=not set contract=v3`; no ERR_MODULE_NOT_FOUND.
- AIPRV-V20-01 parts: env config (done), off by default (AIBOOT-1 silent, AICFG-1), app unchanged without it (AIBOOT-1 plus full gate), bad config does not stop the app (AIBOOT-2, no process.exit), no boot network call (AIBOOT-3). All verified, so the requirement is eligible for completion (shared docs left to 133-10).

## Deviations from Plan
- AIBOOT-2 uses `/api/health` as the "existing route still answers" probe (no auth needed).
- The `process.exit(`/`throw new `/`fetch(` negative grep = 0 as intended; it was not discriminating pre-work (file absent), the export check and behavior specs carry the weight.
- Note: the dist smoke runs from packages/server, so the operator's real `.env` could be loaded by dotenv in that process; nothing from it was printed or recorded.

## Self-Check: PASSED
Files present; commits 756b03e, d2038ed, 3c25d6f exist. STATE/ROADMAP/REQUIREMENTS untouched.
