---
phase: 142-generate-audit-viewer-live-provider-proofs
plan: 09
subsystem: server-api
tags: [ai-audit, rbac, read-api]
requires: [142-01, 142-06, 142-08]
provides: [registerAiAuditRoutes, AI_AUDIT_OUTCOMES, keepSummary]
affects: [AiActivityPage]
key-files:
  created: [packages/server/src/aiAuditRoutes.ts, packages/server/tests/routes.aiAudit.spec.ts]
  modified: [packages/server/src/index.ts]
requirements: [AIGOV-V20-05]
gaps: none
---

# Phase 142 Plan 09: Audit read API Summary

Read-only `GET /api/ai/audit`, `/api/ai/audit/dashboards` and `/api/ai/audit/:id` behind `audit:view` (no new permission), with bound/validated filters, derived kind, keep summaries, and dashboard names only for live kept dashboards.

## Result
- Task 1 commit: see git log (`feat(142-09): read-only AI audit API behind audit:view`).
- RED: before implementation 13 of 14 AUDAPI tests failed (routes absent); after, all green. `routes.versionStamp`, `routes.aiAsk.audit`, `lib.aiAudit` specs green (49 tests); `tsc --noEmit` clean.
- Response shape matches 142-08's `<interfaces>` DTOs exactly (list rows add no `answerText`/tools/queries; detail drops tool args and `idMap`).
- Not gated on AI being enabled (AUDAPI-1 checked with AI env off). index.ts: one import + one registration line.

## Deviations from Plan
None to the code. Two test-fixture arithmetic mistakes of my own were corrected (expected keep summary "0 removed" for fixture 1/1/1/0; in-window row count 76) after the implementation was already behaving per the plan's formulas; no code was bent to satisfy them.

## Non-discriminating criteria
- "grep -c answer_text counts only the detail": the plan's actual check (`SELECT id, ts_ms` line contains answer_text = 0) was run and is meaningful (route did not exist before). No broken criteria found.
- Plan's "no change to rbac/permission specs" holds: only the three paths above changed.

## Self-Check: PASSED
