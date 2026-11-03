---
phase: 142-generate-audit-viewer-live-provider-proofs
plan: 04
subsystem: docs
tags: [docs, env, ai, readme]
requires: []
provides: [tested model IDs and timeouts in .env.example, AI_GENERATED_TTL_HOURS docs, Generate and AI activity README text, seam doc superseded banner]
affects: [142-11]
key-files:
  modified:
    - packages/server/.env.example
    - README.md
    - packages/web/docs/mcp-action-seam.md
requirements: [AIPRV-V20-02, AIPRV-V20-03, AIGEN-V20-02, AIGOV-V20-05]
gaps: []
---

# Phase 142 Plan 04: Docs Summary

Docs-only update: .env.example now names the tested Gemini and Ollama models with timeouts and the Docker recipe, plus the new AI_GENERATED_TTL_HOURS and the generate-mode limits. README documents Generate, the TTL and the AI activity page, and the MCP seam doc carries a superseded banner.

## Commits
- 3aa27ec: .env.example AI block
- 29c0ab0: README and mcp-action-seam.md

## Deviations from Plan
None. The README "Provider status:" sentence was left untouched for 142-11. packages/server/.env was never opened. No STATE, ROADMAP or REQUIREMENTS edits.

## Verification
All greps passed (0 for gemini-2.5-flash and llama3.1 after; 1 for each new anchor; "Ollama/local models: untested" still 1). No criterion was found non-discriminating.

## Self-Check: PASSED
