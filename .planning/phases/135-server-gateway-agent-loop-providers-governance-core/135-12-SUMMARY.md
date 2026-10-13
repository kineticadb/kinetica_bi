---
phase: 135-server-gateway-agent-loop-providers-governance-core
plan: 12
subsystem: ai-providers / spikes / planning
tags: [s6, spike, gemini, tool-calling, provider-docs, bookkeeping]
requires: ["135-04", "135-05", "135-07", "135-08", "135-10", "135-11"]
provides:
  - "S6 operator-run spike (npm run tool-call-spike) with clean-trial scoring and early stop"
  - "135-SPIKES.md S6 decision + tested-models matrix"
  - "README AI provider status (Claude NOT live-verified)"
  - "Phase 135 bookkeeping (REQUIREMENTS / ROADMAP / STATE)"
affects: [136, 137, 142]
tech-stack:
  added: []
  patterns: ["operator-run spike with pure, unit-tested metrics", "transport/quota-errored trials excluded from quality denominators"]
key-files:
  created:
    - packages/server/src/spikes/toolCallSpike.ts
    - packages/server/src/spikes/toolCallSpikeMetrics.ts
    - packages/server/tests/spike.s6-toolcall.spec.ts
    - .planning/phases/135-server-gateway-agent-loop-providers-governance-core/135-SPIKES.md
  modified:
    - packages/server/package.json
    - README.md
    - .planning/REQUIREMENTS.md
    - .planning/ROADMAP.md
    - .planning/STATE.md
key-decisions:
  - "Gemini gemini-3-flash-preview = AI_TOOL_MODE=native (provisional, operator decision): 19 clean trials, 100% valid calls, multi-turn 2/2; one short of the 20-trial bar because the free-tier daily quota ran out"
  - "S6 scoring: rate_limited/overloaded/network/timeout/aborted/auth/bad_request trials are excluded from quality figures; protocol errors stay in; < 20 clean trials -> inconclusive; all request errors -> INVALID RUN"
  - "Spike stops early after 3 consecutive 400s or on a PerDay / > 1 h 429, writing partial output"
  - "AIGOV-V20-01 recorded Partial, not Complete: the widget-side gate ('cannot use or add the AI widget') belongs with the widget in Phase 137"
metrics:
  duration: "~1 h (continuation: Task 3 + spike scoring fix)"
  completed: 2026-10-13
---

# Phase 135 Plan 12: S6 Tool-Calling Spike, Provider Docs and Phase Bookkeeping Summary

The operator ran the S6 spike on Gemini `gemini-3-flash-preview`. Every clean measurement passed: 100 % valid tool calls over 19 clean trials, the multi-turn round-trip 2/2, and thought_signature replay worked. The run is recorded as native tool calling (provisional). The spike's original `json (best effort)` verdict came from counting quota 429s as model failures; that scoring was fixed red-first. README now documents provider status (Claude NOT live-verified), and the phase planning docs were updated by hand.

## Tasks

| Task | Name | Commit | Files |
|---|---|---|---|
| 1 | S6 spike script + unit-tested pure parts | a3205d8 | toolCallSpike.ts, toolCallSpikeMetrics.ts, spike.s6-toolcall.spec.ts, package.json |
| 2 | Operator runs S6 (checkpoint:human-action) | — (operator) | none committed (outputs left untracked in packages/server) |
| — | Spike scoring/early-stop fix, RED | ed08c42 | tests/spike.s6-toolcall.spec.ts |
| — | Spike scoring/early-stop fix, GREEN | bb693c7 | toolCallSpikeMetrics.ts, toolCallSpike.ts |
| 3 | S6 findings, provider docs, bookkeeping | 49b78b3 | 135-SPIKES.md, README.md, REQUIREMENTS.md, ROADMAP.md, STATE.md |

Task 1 acceptance: the single `apiKey` use in toolCallSpike.ts passes `config.apiKey` to the `createOpenAiCompatProvider` constructor only. The `--raw` path uses the env-read `secret` for its one bypass POST; it is never printed and is redacted from recordings.

**The agent never ran the spike against a real endpoint** and issued no command that called a real provider. It never read `packages/server/.env` and never saw a key. The S6 spec drives `main()` with a scripted `fetch` (through `forbidProviderNetwork` with an allow-host of `provider.test`). The operator's sanitised outputs contain no key-like strings (`AIza`, `Bearer `, `sk-`: 0 files).

## Operator S6 input (Task 2)

- 2026-10-12, `AI_MODEL=Antigravity`: 35/35 HTTP 400 "unexpected model name format". This was operator error (a product name, not a model ID) and gets no verdict.
- 2026-10-13, `gemini-3-flash-preview`, stream=true, `--runs 5 --rpm 6`: 35 trials. 15 got HTTP 429 from the free-tier daily cap (`GenerateRequestsPerDayPerProjectPerModel-FreeTier`, limit 20, retryDelay about 29,900 s, no Retry-After header). 1 first call was aborted at the 60 s timeout. 19 trials were clean.
- Ollama was not run.

## Red-first evidence (spike scoring fix)

The 16 new or changed tests in `tests/spike.s6-toolcall.spec.ts` (S6-2 updated, S6-6 to S6-9 new) were run before the fix. All 16 failed and the other 16 passed. Representative failures:

- `expected 'json (best effort)' to be 'inconclusive (19 clean trials)'`: the operator-shaped fixture (19 clean, 15 rate-limited, 1 aborted) was mis-scored.
- `expected 48.5 to be +0` (text-instead-of-tool): errored trials were counted as "text instead of tool".
- `expected 94.4 to be 100`: a malformed call inside a 429-cut trial lowered validity.
- `expected 'json (best effort)' to be 'native'`: 20 clean trials plus rate-limited ones.
- `expected 'insufficient trials' to be 'INVALID RUN (check AI_MODEL / AI_BASE…'`
- `createEarlyStopGuard is not a function` / `parse429Body is not a function`
- S6-9 (`main()` with a scripted fetch): `expected 14 to be 3` provider calls for persistent 400s, and `expected 14 to be 1` for a daily-quota 429. The old harness kept using requests.

After the fix (bb693c7): 32/32 green, server tsc clean.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] S6 verdict counted transport/quota failures as model failures**
- **Found during:** Task 3 (operator's run printed `fail (2/5)` / `json (best effort)` when every clean measurement passed)
- **Fix:** clean-trial basis (`cleanTrials`, `excludedTrials{count,byKind}`, `requestErrorTrials`). Verdicts are now `inconclusive (N clean trials)` and `INVALID RUN (check AI_MODEL / AI_BASE_URL)`. `createEarlyStopGuard` and `parse429Body` are wired into the spike: it stops after 3 consecutive 400s or on a PerDay / > 1 h 429, and still writes partial output (`stoppedEarly`).
- **Files modified:** toolCallSpikeMetrics.ts, toolCallSpike.ts, spike.s6-toolcall.spec.ts
- **Commits:** ed08c42 (red), bb693c7 (green)
- The old `insufficient trials` label is replaced by `inconclusive (N clean trials)`. The existing S6-2 assertion was updated for this, and it was red before the fix.

**2. [Scope honesty] AIGOV-V20-01 marked Partial, not Complete**
- The plan's acceptance criterion expects 8 `Complete` rows. The grep now reads **7**. AIGOV-V20-01 says "without it, a user cannot use or add the AI widget". The AI widget is Phase 137 (AIWID-V20-01) and does not exist yet, so that clause cannot be verified. The server 403 and the Roles-page grant are delivered. The row reads `Partial (... widget gate lands with the widget, Phase 137)` and its checkbox stays unticked.
- AIGOV-V20-02 is ticked: the env setting and the schema-mode canary proof are delivered here. The query tools themselves are AIGOV-V20-03 (Phase 140).

**3. Task 3 commit scope:** 49b78b3 touches exactly the five files listed in the plan. The spike fix went in its own two commits.

## Gates

- Server: `npx tsc --noEmit` clean. `node scripts/test-gate.mjs` **PASSED**: 9 failing files, the 8 known (TD-V11-04 OIDC, db.smoke drift, routes.wms) plus `lib.exportRunner.memory.spec.ts`, which passes alone (TD-V16-TEST-ISOLATION).
- Web: `npx tsc --noEmit` clean. `npx vitest run` passes 214 files with 1 skipped, and had no flakes this run. theme-guard 160/160.

## Not verified / follow-ups

- Gemini native is provisional: 19 clean trials, one short of 20, and only 2 multi-turn round-trips. Making it final needs a re-run with a paid key, or `--runs 3` on two separate quota days.
- Streaming vs non-streaming was not compared (`--stream false` not run). The p50/p95 latency printed by the old harness mixes clean and errored trials.
- The Claude adapter is not live-verified, and Ollama is untested.
- `packages/server/.env.example` still shows `AI_MODEL=gemini-2.5-flash` and has no Gemini-3 timeout note. It is outside this plan's file list, so it is logged as a follow-up in STATE.md.
- The operator outputs `packages/server/s6-gemini.json` and `packages/server/s6-gemini-wire/` were left untracked, as instructed. The plan does not ask for them to be copied into the phase dir.

## Self-Check: PASSED

- FOUND: packages/server/src/spikes/toolCallSpike.ts, toolCallSpikeMetrics.ts, tests/spike.s6-toolcall.spec.ts, 135-SPIKES.md
- FOUND commits: a3205d8, ed08c42, bb693c7, 49b78b3
- STATE.md line count 1879 → 1888 (edited surgically)
