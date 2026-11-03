---
phase: 140-query-data-access-mode-injection-hardening
plan: 07
subsystem: ai-chat-ui
tags: [chat, query-list, xss-literal-text]
requires: [140-03]
provides:
  - formatQueriesToggle / describeQueryEntry in chatText.ts
  - collapsed "Ran N queries" toggle + plain-text list per answer in AiChat
  - .ai-chat-query wrap-only CSS class
key-files:
  modified:
    - packages/web/src/lib/aiSession/chatText.ts
    - packages/web/src/components/charts/AiChat.tsx
    - packages/web/src/components/charts/AiChat.spec.tsx
    - packages/web/src/components/charts/AiWidget.css
metrics:
  tasks: 1
  files: 4
completed: 2026-10-21
---

# Phase 140 Plan 07: Ran N queries list Summary

Under an answer that ran queries, a ghost-sm toggle "Ran N queries" (aria-expanded, per-turn state, collapsed by default) expands into `ai-chat-note muted ai-chat-query` lines: `<sql> — <N rows | refused: reason | timed out | cancelled | failed[: reason]>`. All text is React text; no markdown, links or innerHTML.

## Commit
- 20ce306: feat(140-07)

## RED evidence
Before implementation: `vitest run src/components/charts/AiChat.spec.tsx` gave `Tests 5 failed | 15 passed (20)`; all five CHATQ-1..5 failed (toggle button not found / describeQueryEntry not exported).

## Verification (GREEN)
- web `tsc --noEmit` clean.
- AiChat.spec + src/lib/aiSession: 12 files, 179 tests pass (`--maxWorkers=4`).
- theme-guard: 172 pass.
- Greps: `formatQueriesToggle(` in AiChat.tsx = 1; `dangerouslySetInnerHTML` = 0; `CHATQ-` = 5; `.ai-chat-query` defined once in AiWidget.css (no colour/hex/rgba).

## Notes
- CHATQ-4 is the real D-15(d) proof: markup in answer, follow-up, clarification question/option label, filter note and SQL yields no img/a/b/strong/script element. The `dangerouslySetInnerHTML = 0` grep is only an invariant (passes before and after).
- Not provable here: light/dark legibility of the query lines; routed to the 140-13 operator check.

## Deviations from Plan
None. Plan executed as written.

## Self-Check: PASSED
