---
phase: 140-query-data-access-mode-injection-hardening
plan: 13
subsystem: ai-query-mode-verification
tags: [uat, gates, bookkeeping, kinetica-7.2.3.12, injection-hardening]
requires: ["140-01", "140-02", "140-03", "140-04", "140-05", "140-06", "140-07", "140-08", "140-09", "140-10", "140-11", "140-12"]
provides:
  - Operator UAT of AI query mode against real Kinetica 7.2.3.12 (live spike Q1-Q8; "Ran N queries" and literal markup in light and dark)
  - Deploy-bundle check: libpg-query loads in the server Docker image
  - AIGOV-V20-03 and AISAFE-V20-05 traced; Phase 140 bookkeeping
affects: [141, 142]
tech-stack:
  added: []
  patterns: ["Claude-driven CDP UAT through the DEV harness (no provider call)", "mode switch by shell env override, not .env edit"]
key-files:
  created:
    - .planning/phases/140-query-data-access-mode-injection-hardening/140-13-UAT-STEPS.md
    - .planning/phases/140-query-data-access-mode-injection-hardening/140-13-UAT-RESULTS.md
  modified:
    - .planning/REQUIREMENTS.md
    - .planning/ROADMAP.md
    - .planning/STATE.md
    - .planning/PROJECT.md
decisions:
  - "Live Gemini ask in query mode (step 7) deferred to Phase 142: dev AI_MODEL is still the invalid 'Antigravity'."
  - "lib.exportRunner.memory gate timeout classified environmental (fails alone and identically at pre-phase 4536a0c; no export code touched in 140)."
  - "The three minor issues (SQL ligature, spike slow SQL default, admin spike user) left open as follow-ups, not fixed in this plan."
metrics:
  tasks: 3
  completed: 2026-10-21
---

# Phase 140 Plan 13: Gates, operator UAT and Phase 140 bookkeeping Summary

AI query mode was verified live against Kinetica 7.2.3.12: the guarded run-as-user port enforces the row cap, timeout and tagged cancel with no job left behind, writes are refused before any SQL is sent, and the "Ran N queries" list and markup-as-literal-text hold in light and dark with no request to evil.test.

## Task 1: gates + UAT steps (c39318d)
- shared 192 passed; web 4953 passed + theme-guard 172; server tsc clean.
- Server `test-gate` printed **GATE FAILED** solely on `lib.exportRunner.memory` (EXPMEM zip backpressure, 60 s timeout). It fails alone and identically at the pre-phase commit 4536a0c, and no export code was touched in Phase 140: classified environmental. Remaining failures are the 8 known files plus 3 isolation-only (auth.login-rbac, routes.exports, routes.management), within TD-V16-TEST-ISOLATION. The script's own verdict was FAILED; the classification is ours.
- Gap gate re-run at Task 3: no `it.fails` / `GAP-140-` in server tests; 140-10 and 140-11 `gaps: []`.

## Task 2: operator UAT (resolved)
Operator asked Claude to run it. Spike in the terminal; dev API restarted with a shell override `AI_DATA_ACCESS=query` and back; operator's signed-in Chrome driven over CDP. The operator signed in; Claude never handled credentials or read/edited `.env`. Full record: `140-13-UAT-RESULTS.md`.

Verdict: steps 0-6 and 8 PASS (light and dark where visual); step 7 SKIPPED (invalid dev AI_MODEL).
- Spike: Q1 200 rows truncated 202 ms; Q2/Q3 PASS after replacing the default slow SQL (it completed in under 2 s: Kinetica computes cross-join COUNT without enumerating pairs); no tagged job left; Q4 writes refused with 0 SQL calls; Q5 no PG-accepted/Kinetica-rejected queries; Q6 only categorized messages reach the model; Q7 both quoted forms work; Q8 profile counts right.
- UI: "Ran 3 queries" collapses/expands, 23 px toggle matches other chat buttons; long SQL wraps on the inline tile and in the small-tile drawer; markup renders literally, zero img/a/script elements, no dialog, no request to evil.test or `x`.
- Deploy image builds and libpg-query parses in it.

## Task 3: UAT results + bookkeeping
Written by hand (no gsd-tools mutation commands). REQUIREMENTS: AIGOV-V20-03 and AISAFE-V20-05 Complete with evidence (live model adherence noted as unverified until 142). ROADMAP: Phase 140 ticked, 13/13, 2026-10-21. STATE: Phase 140 outcomes + follow-ups; next Phase 141. PROJECT: Key Decisions row.

## Open issues and follow-ups
- SQL line renders `--` as an en dash (UI font ligature): use a monospace font or `font-variant-ligatures: none` for query SQL (cosmetic).
- Spike default `SPIKE_SLOW_SQL` is too fast: switch to the non-shortcut join used in the rerun.
- Spike ran as admin, not the non-admin analyst; optional re-run as `uat_analyst` in 142.
- Live Gemini/Ollama query-mode ask deferred to Phase 142 (also the audit `queries_json` live check).
- `lib.exportRunner.memory` times out on this machine (environmental).

## Deviations from Plan
None to plan scope. The UAT was run by Claude over CDP at the operator's request, which the plan allows. The spike's default slow SQL was overridden by env var for Q2/Q3 (test data, not code). Step 7 not run.

## Auth gates
Sign-in was performed by the operator in the browser; Claude never handled credentials.
