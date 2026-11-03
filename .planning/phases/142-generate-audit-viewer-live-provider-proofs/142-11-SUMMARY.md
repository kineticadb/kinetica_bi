---
phase: 142-generate-audit-viewer-live-provider-proofs
plan: 11
subsystem: live-uat
tags: [uat, ollama, local-model, bookkeeping]
requires: [142-10]
provides: [142-UAT-RESULTS.md (Ollama sections, Tested models), README Tested models table]
affects: []
key-files:
  created: []
  modified: [README.md, packages/server/.env.example, .planning/REQUIREMENTS.md, .planning/ROADMAP.md, .planning/STATE.md, .planning/PROJECT.md]
requirements: [AIPRV-V20-03]
gaps: []
---

# Phase 142 Plan 11: Ollama live UAT + bookkeeping Summary

Ollama in Docker (CPU, 4 vCPU, `OLLAMA_CONTEXT_LENGTH=16384`) with `qwen2.5:7b-instruct`, run 2026-10-26 (native, then json) and re-run 2026-10-29 in json mode after the defect fixes. Container, volume and image removed afterwards. Full evidence: `142-UAT-RESULTS.md` "Ollama" sections.

## Result
- **Verdict: PARTIAL.** The OpenAI-compatible adapter works unchanged against Ollama (no 400s, streamed tool calls, usage present). The model is too weak for the app on 4 CPUs: wrong targets, claimed actions with no call, Generate does not finish in 600 s. Every wrong or unbacked action was refused or not applied.
- S6: native 58.1% valid (18 clean), json 85.7% valid (21/21 clean). json mode is the documented setting for this model.
- Defect 1 (300 s fetch cap cut long answers) fixed in 51b009d and confirmed live (an ask ran 394 s). The json reply shape `{"<tool>": {...}}` fixed in 7517ae1 (add chart passed live).
- README "Tested models (Phase 142):" table built from this evidence (dfc2f51); `.env.example` carries the json note for the Ollama example.
- Bookkeeping (REQUIREMENTS, ROADMAP, STATE, PROJECT) done by hand on 2026-10-30. Milestone completion is a separate step (`/gsd:complete-milestone`), after the remaining G10 S6 spike days.

## Deviations from Plan
- Task 2 landed before Task 3 in separate commits (dfc2f51, then this summary with the bookkeeping).
- AIPRV-V20-03 is recorded as Partial, as the plan allowed.

## Self-Check: PASSED
