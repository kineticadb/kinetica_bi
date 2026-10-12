---
phase: 135-server-gateway-agent-loop-providers-governance-core
plan: 04
subsystem: ai-providers
tags: [openai-compatible, gemini, sse, retry, d-14]
requires: [135-02]
provides: [createOpenAiCompatProvider, createRetryBudget, withProviderRetry, defaultSleep]
affects: [135-06, 135-12]
key-files:
  created:
    - packages/server/src/lib/ai/providers/openaiCompat.ts
    - packages/server/src/lib/ai/retry.ts
    - packages/server/tests/lib.aiOpenaiCompat.spec.ts
    - packages/server/tests/lib.aiRetry.spec.ts
    - packages/server/tests/fixtures/ai/openai/ (12 hand-written fixtures + README)
requirements-completed: [AIPRV-V20-05, AIGOV-V20-06]
completed: 2026-10-12
---

# Phase 135 Plan 04: OpenAI-compatible adapter + D-14 retry budget

Fetch-based OpenAI-compatible adapter (tolerant tool-call accumulator, Gemini extra_content replay, body-free error normalisation) and a cumulative 20 s per-answer retry budget.

## Commits
- ad05391 feat(135-04): OpenAI-compatible adapter on fetch with hand-written fixtures
- 5b5a814 feat(135-04): provider retry budget for 429/overloaded (D-14)

## Verification
- server `tsc --noEmit` clean; `lib.aiOpenaiCompat` (11) + `lib.aiRetry` (8) + `lib.aiOutbound` all green (25 tests).
- Mutation 1: adding the parsed error body to the error event made OAI-9 fail (1 failed/10 passed); reverted, 11/11.
- Mutation 2: removing the budget check in withProviderRetry made RTY-2 and RTY-3 fail; reverted, 8/8.
- Positive controls: OAI-8 asserts the sentinel IS in `Authorization` (and nowhere else); OAI-9 asserts BODYSENTINEL IS in each error fixture.
- `grep -c useFakeTimers` on the retry spec = 0; `isOutboundRequest(` and `extra_content` present in adapter.

## Notes / deviations
- Fixtures are HAND-WRITTEN (README says so); no network, no key, no .env read.
- RED was not run as a separate commit: spec and implementation were written together (module absent beforehand); mutation proofs are the discriminating evidence.
- `complete()` throws synchronously for an unbranded request (before fetch); callers using `for await` see it at call time.
- Mid-stream end without `[DONE]` and without `finish_reason` => `protocol`; a `finish_reason` without `[DONE]` is accepted.
- A finish of `stop` with accumulated tool calls is reported as `tool_calls` (Gemini quirk safety).
- Timeout kind is only produced for a `TimeoutError` rejection; the adapter itself sets no timer (loop owns deadlines).
- The Gemini 429 fixture's message says "retry in 34.2s" while `retryDelay` is "34s"; the 34000 assertion proves detail precedence over the message regex.

## Self-Check: PASSED
