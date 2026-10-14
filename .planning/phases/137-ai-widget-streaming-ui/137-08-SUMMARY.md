---
phase: 137-ai-widget-streaming-ui
plan: 08
subsystem: web-ai-chat
tags: [ai, chat, react, css]
requires: [137-05, 137-07]
provides: [AiChat, AiAskBox, AiRunStatus, ai-chat-* CSS]
key-files:
  created:
    - packages/web/src/components/charts/AiChat.tsx
    - packages/web/src/components/charts/AiChat.spec.tsx
    - packages/web/src/components/charts/AiWidget.css
requirements: [AIWID-V20-02, AIWID-V20-03, AIWID-V20-04, AIWID-V20-05, AIWID-V20-07]
completed: 2026-10-14
---

# Phase 137 Plan 08: AiChat Summary

Shared-store chat UI (bubbles, empty-state starters, run status with elapsed seconds, Cancel, inline errors/Retry, clarification choices, follow-ups with local fallback, per-answer revert, shared-draft ask box) with token-only CSS.

## Commits
- 552817c AiChat.tsx + AiChat.spec.tsx (9 specs, CHAT-1..8 plus 6b)
- 6285c87 AiWidget.css

## Notes
- All asks come from click/Enter handlers only; StrictMode spec (CHAT-1) asserts a single runAsk.
- Revert uses the store turn index. Plain-text rendering only (CHAT-7 asserts no HTML).
- Pre-checks: AiChat.tsx and AiWidget.css did not exist; `ai-chat-` count in src was 0. Spec failed (module missing) before implementation.
- Class-resolution loop: every `ai-chat-*` class in the TSX has a CSS rule (count >= 1). Positive control `ai-chat-bogus` returned 0. The only 0 in the raw loop output is the template prefix `ai-chat--` (from `ai-chat--${variant}`); the `--inline`/`--drawer` modifiers are intentionally unstyled hooks.
- No hex/rgba/accent-text in AiWidget.css (0/0). All tokens used were confirmed defined in global.css.

## Gates
- `npx tsc --noEmit` clean.
- Full web vitest with --maxWorkers=4: 229 files passed, 1 skipped; 4725 tests passed.
- theme-guard: green (168 tests).

## Deviations from Plan
None. (Shell note: first commit attempt failed on zsh word-splitting of path variables; nothing was committed then, recommitted with literal paths.)

## Needs operator light/dark visual check (137-12)
- User bubble (accent fill, --on-accent text) and AI bubble (--panel-solid, border) legibility in both themes.
- Error bubble border (--danger), status line muted text and spinner, `ai-chat-turn--ahead` dimming (0.55 opacity).
- Textarea auto-grow to about 4 lines and Send/Cancel button height match (btn-sm vs ghost-sm).
- Choices picked state (tick) and wrapping of long follow-up buttons.

## Self-Check: PASSED
- Files exist: AiChat.tsx, AiChat.spec.tsx, AiWidget.css.
- Commits 552817c and 6285c87 exist.
