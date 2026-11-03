---
phase: 140-query-data-access-mode-injection-hardening
verified: 2026-10-21T00:00:00Z
status: passed
score: 4/4 must-haves verified (SC3 visual part already operator/Claude-UAT'd; live model ask deferred to 142 by agreement)
---

# Phase 140 Verification Report

**Goal:** In query mode the AI can run only guarded read-only queries as the user, and poisoned inputs cannot push it past the gateway.
**Re-verification:** No, initial.

## Observable Truths

| # | Truth | Status | Evidence |
|---|---|---|---|
| 1 | Query mode: single SELECT runs as user with row cap; multi-statement, non-SELECT, comment-smuggled SQL refused; schema mode: query tools unregistered | VERIFIED | `packages/server/src/lib/ai/sqlGuard.ts` (libpg-query AST guard, raw-char refusal, single-SELECT, scope check). Live spike Q1-Q8 on Kinetica 7.2.3.12 (cap 200, writes refused with 0 SQL sent). EGX-Q1/Q2 prove query tools are "Unknown tool" in schema mode. |
| 2 | Obedient provider reading poisoned comment/column/value/title cannot act outside gateway | VERIFIED | `tests/lib.aiInjection.e2e.spec.ts` INJ-1..INJ-11 pass; mutation checks show they go red when guard weakened. Gap gate empty. |
| 3 | Model markup/links/images render literal | VERIFIED (UAT) | 140-13-UAT-RESULTS step 5, light and dark: 0 img/a/script elements, no request to evil.test. Minor cosmetic open issue: SQL line ligature renders `--` as en dash (UI font). |
| 4 | Canary no-egress passes across every tool and error path | VERIFIED | `tests/routes.aiEgress.spec.ts` has schema-mode matrix, "Phase 140 schema-mode query tools" (EGX-Q1/Q2) and "Phase 140 query mode" describes; both modes covered. |

## Extra checks
- (a) Gap gate: `grep -rnE "it\.fails|GAP-140-" packages/server/tests` returned no matches.
- (b) Mutation sanity (file restored each time, `git diff --stat` empty, status clean). Baseline 94/94 pass for lib.aiSqlGuard + lib.aiInjection.e2e.
  - RAW_BAD emptied (comment/semicolon refusal): 14 failed (SQG-R01..R05, INJ-2, INJ-4, ...).
  - System-schema refusal disabled: 5 failed (SQG-R20a-d, INJ-4).
  - Scope check (`allowed.has(key)`) bypassed: 16 failed (SQG-R23..R26, INJ-1, INJ-5, INJ-6).
- (c) Canary egress spec covers both modes: yes.

## Requirements Coverage

| Requirement | Plans | Status | Evidence |
|---|---|---|---|
| AIGOV-V20-03 | 140 plans (8 plans list it alone, 3 list both) | SATISFIED | Guard + run-as-user port + cap/timeout/cancel; live spike. Spike ran as admin (non-admin covered by 133 S7). |
| AISAFE-V20-05 | 140 plans (2 alone, 3 both) | SATISFIED | INJ fixtures, EGX-Q matrix, literal rendering UAT. |

No orphaned requirement IDs; both appear in REQUIREMENTS.md mapped to Phase 140.

## Anti-patterns / notes
- Server test-gate FAILED on `lib.exportRunner.memory` only; classified environmental (fails identically at pre-phase commit 4536a0c, no export code touched). Other failures inside known TD-V16-TEST-ISOLATION set.
- Open minor: SQL line ligature; spike default slow SQL too fast; spike user admin.

## Human verification / deferrals
- Live Gemini ask in query mode (model adherence to query rules, audit `queries_json` from live ask): deferred to Phase 142, accepted deferral.

_Verifier: Claude (gsd-verifier)_
