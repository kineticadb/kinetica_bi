---
phase: 142-generate-audit-viewer-live-provider-proofs
verified: 2026-11-02T12:50:00Z
status: human_needed
score: 3/4 success criteria fully verified (SC4 partial by operator decision: Gemini PASS, Ollama PARTIAL)
human_verification:
  - test: "Gemini S6 tool-call spike day 3 (`--runs 1 --rpm 6`, native, stream)"
    expected: ">= 20 clean trials in total (14 after days 1-2); a recorded decision line (native stays default, or json) in 142-UAT-RESULTS.md and the README Tested models row updated from 'pass so far (the S6 spike still open)'"
    why_human: "Needs a live Gemini key and quota; the verifier must not call a provider"
  - test: "Operator accepts AIPRV-V20-03 as PARTIAL for v2.0 (qwen2.5:7b-instruct on CPU Ollama)"
    expected: "Explicit acceptance recorded (or a stronger local model / GPU run scheduled). Adapter proven; the model fails actions and cannot finish Generate in 600 s"
    why_human: "A scope decision, not a code defect"
  - test: "(Optional, minor) Discard a generated dashboard that holds a live AI dynamic view and list `_kbi_ai_` views in Kinetica afterwards"
    expected: "No `_kbi_ai_` view for that dashboard remains; SQLite counts 0|0|0|0|0|0|N"
    why_human: "Every live G3/G3c/O3 discard had ai_session_views = 0 before the discard, so the Kinetica DROP from discardGeneratedDashboard was proven only by specs (REGV-D, GENLIFE-5) and by the shared 139 lifecycle live listing"
---

# Phase 142: Generate, Audit Viewer & Live Provider Proofs Verification Report

**Phase Goal:** Designers generate a starter dashboard from a table, admins browse the AI audit log, and the operator proves the provider live on Gemini and a local model.
**Verified:** 2026-11-02
**Status:** human_needed (no code gaps; the S6 spike is mid-collection and AIPRV-V20-03 is PARTIAL by operator record)
**Re-verification:** No (initial verification, written after execution and UAT)

## Goal Achievement

### Observable Truths (ROADMAP success criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A designer picks a table and gets 4-8 widgets suited to its columns, refinable by asking and keepable | VERIFIED | `aiGenerateRoutes.ts:73-80` POST /api/dashboards/generate (auth + dashboards:create + ai:use, table readable via liveSchema, 409 on a second pending); `lib/aiGenerate.ts:34-68` one-transaction create (dashboard + table link + AI widget + pending marker, `uq_dashboards_one_pending` db.ts:544). Generate mode is server-derived (`aiRoutes.ts:88-91`, never client-supplied); `lib/ai/generateMode.ts:6-8` GEN_MIN_WIDGETS=4 / GEN_MAX_WIDGETS=8 (maxNewWidgets cap), recipe incl. timeline + map-if-geo; `runAnswer.ts:157` beforeFinish nudge, `:177-180` too-few refusal and server-owned bands. Web: `DashboardsPage.tsx:638` generate, `GeneratedDashboardBar.tsx`. UAT: dashboard 21 (6 data widgets, refine, Keep, bands survive reload), dashboard 25 (timeline used), map opens on data (dashboard 22) |
| 2 | Discarding a generated dashboard leaves no dashboard, widgets or views | VERIFIED (SQLite live; Kinetica DROP via specs) | One helper `discardGeneratedDashboard` (`lib/aiGenerate.ts:70-81`) drops AI session views as the user then deletes in a transaction with a Keep re-check; wired to the Discard route (`aiGenerateRoutes.ts:81`), DELETE (`index.ts:927-934`), logout (`index.ts:477`), boot sweep (`index.ts:3523`), hourly TTL sweep (`index.ts:3536`). UAT G3/G3b/G3c/O3: SQLite `1|1|0|0|1|0|N -> 0|0|0|0|0|0|N`, logout and restart sweeps logged. See human item 3: no live discard had an AI view registered |
| 3 | An admin with audit:view browses the log (no row values); a user without it cannot open the page | VERIFIED | `aiAuditRoutes.ts:110,145,160` all three GETs behind `requirePermission(AUDIT_VIEW)` (which includes requireAuth, rbac.ts:44); bound params only; no tool args; `idMap` stripped; queries expose sql/rowCount/durationMs/outcome only; unkept dashboard names hidden (`dashLookup`). Web: Sidebar.tsx:36 + App.tsx:458,571,685 gate; `AiActivityPage.tsx` calls `listAiAudit`/`getAiAuditEntry`/`listAiAuditDashboards`. D-18: answer text shown as stored (query results never stored). UAT G1 admin PASS light+dark; uat_analyst 403 on all three endpoints, no nav item |
| 4 | Operator completes live runs on Gemini and on one named Ollama model, recorded with a tested-models matrix | PARTIAL (accepted record) | Gemini `gemini-3-flash-preview` G0-G9 PASS (2026-10-23..28) + time-bucket check 2026-11-02. Ollama `qwen2.5:7b-instruct` (CPU, json mode) PARTIAL on 2026-10-26 and re-run 2026-10-29: adapter works (streamed tool_calls, no 400s; 300 s cut fixed and confirmed live at 394 s), model fails add/rename/filter adherence and Generate times out at 600 s; every bad call refused or shown as "Changes: none". Matrix in README.md:227-233 and 142-UAT-RESULTS.md. Gemini S6 spike done 2026-11-03: 21 clean trials, json (best effort) by its rule, borderline (88.9% valid); native kept by operator decision |

**Score:** 3/4 fully verified; SC4 Gemini half verified, Ollama half partial.

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `packages/server/src/lib/aiGenerate.ts` | create/discard lifecycle, sweeps | VERIFIED | 155 lines, imported by index.ts:70, aiGenerateRoutes.ts, mcpRoutes |
| `packages/server/src/aiGenerateRoutes.ts` | generate + discard-generated | VERIFIED | registered index.ts:1340 |
| `packages/server/src/lib/ai/generateMode.ts` | limits, recipe, nudge, bands | VERIFIED | used by runAnswer.ts:12 |
| `packages/server/src/aiAuditRoutes.ts` | /api/ai/audit, /:id, /dashboards | VERIFIED | registered index.ts:1334 |
| `packages/server/src/db.ts` | generated_by/generated_pending_at, unique pending index, ai_audit.kind + dash index | VERIFIED | db.ts:461-462, 542-544, DTO 614 |
| `packages/web/src/components/AiActivityPage.tsx` | filters, paging, detail | VERIFIED | 393 lines, rendered App.tsx:685 behind canViewAudit |
| `packages/web/src/components/GeneratedDashboardBar.tsx` | pending note + server Discard | VERIFIED | calls discardGeneratedDashboard |
| `packages/web/src/api/client.ts` | generate/discard/audit clients | VERIFIED | 413, 441, 2290, 2336, 2349 |
| `README.md` / `packages/server/.env.example` | tested-models matrix, Gemini + Ollama examples | VERIFIED | README:227-235; .env.example:100-112 incl. `AI_TOOL_MODE=json` for qwen |

### Key Link Verification

| From | To | Via | Status |
|---|---|---|---|
| DashboardsPage generate form | POST /api/dashboards/generate | `generateDashboard` (client.ts:413) | WIRED |
| GeneratedDashboardBar / DashboardsPage | POST /:id/discard-generated | `discardGeneratedDashboard` (client.ts:441) | WIRED |
| /api/ai/ask | generate mode | `generated_pending` derived server-side (aiRoutes.ts:90) -> runAnswer `generate` | WIRED |
| Discard / DELETE / logout / boot / TTL | `discardGeneratedDashboard` -> `dropViewsForDashboard` | lib/aiGenerate.ts:72 | WIRED |
| Sidebar "AI activity" | AiActivityPage -> /api/ai/audit* | permission AUDIT_VIEW + client fetches | WIRED |
| Provider calls | undici Agent without 300 s cap | providers/providerFetch.ts:6 | WIRED |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|---|---|---|---|---|
| AIGEN-V20-01 | 142-01,02,03,05,06,07,10,11 | Pick a table, get 4-8 suited widgets to review, refine, Keep | SATISFIED | Truth 1; Gemini UAT G2/G4/G7, dashboard 21 and 25 |
| AIGEN-V20-02 | 142-01,04,05,07,10,11 | Discard leaves no dashboard, widgets or views | SATISFIED | Truth 2; GENLIFE-5/8/10, REGV-D; UAT G3, G3b, G3c (logout + restart), O3 |
| AIGOV-V20-05 | 142-01,04,06,08,09,10,11 | Admin browses AI log on a page gated by audit:view | SATISFIED | Truth 3; routes.aiAudit.spec + AiActivityPage.spec; UAT G1, G9 |
| AIPRV-V20-02 | 142-04,10,11 | OpenAI-compatible provider proven live on Gemini | SATISFIED | G0-G9 PASS live; S6 tool-call matrix 21 clean trials (2026-11-03): json (best effort) by its rule, borderline; native stays documented (operator decision) |
| AIPRV-V20-03 | 142-04,11 | Same provider proven live on one named local model (Ollama) | PARTIAL | qwen2.5:7b-instruct: adapter end-to-end proven, model too weak for actions/Generate in 600 s. REQUIREMENTS.md keeps it `[ ]` and "Partial", consistent with this report |

All five IDs are declared across the 11 plans' frontmatter; REQUIREMENTS.md maps no other ID to Phase 142 (AIWID-V20-05's live check was completed in this phase's UAT but belongs to Phase 137). No orphaned requirements.

## Extra checks (run by the verifier, 2026-11-02)

- `142-gap-gate.sh`: `GAP GATE: PASS`, exit 0.
- Targeted server specs (8 files, `--maxWorkers=2`): lib.aiGenerate, routes.aiGenerate, routes.aiAudit, routes.aiAsk.generate, lib.aiGenerateMode, boot.generatedSweep, routes.generatedVisibility, db.generatedPending: 66/67 on the first run; PENDVIS-3 failed with `Parse Error: Expected HTTP/` (supertest socket under parallel load) and passed 6/6 twice in isolation. Flaky under load, not a logic failure.
- Targeted web specs (5 files): AiActivityPage, DashboardsPage.generate, DashboardsPage.generatedOpen, GeneratedDashboardBar, client.aiAudit: 41/41.
- Full suites not run (instructed; parallel load causes false timeouts).

## Anti-Patterns / open items

| Item | Severity | Notes |
|---|---|---|
| `routes.generatedVisibility.spec.ts` PENDVIS-3 HTTP parse error under parallel run | Info | Passes alone; candidate for the TD-V16-TEST-ISOLATION list |
| 142-UAT-RESULTS.md "Tested models" footnote says the 300 s fix and empty-answer fix were "not re-run live" | Info | Stale: the 2026-10-29 Ollama re-run confirmed the 300 s fix live (394 s). README row date still reads 2026-10-26 only |
| RGL "Maximum update depth exceeded" after a refine on an unkept generated dashboard (day 1) | Info | Diagnosed, not reproduced on later days; no visible effect |
| Model-quality observations (calendar hour vs hour of day, sum over an average) | Info | hour-of-day/weekday buckets since added and checked live 2026-11-02; required-fields hint 52919a9 not yet measured live |

No TODO/placeholder stubs in the phase's code paths; no blockers.

## Human Verification Required

1. **Gemini S6 spike day 3**: DONE 2026-11-03 (21 clean trials, verdict recorded in 142-UAT-RESULTS.md and the README row).
2. **Accept AIPRV-V20-03 as PARTIAL** for v2.0 (or schedule a stronger local model / GPU).
3. **(Optional)** Live discard of a generated dashboard that holds an AI dynamic view, then list `_kbi_ai_` views in Kinetica.

## Gaps Summary

No code gaps. Generate, discard lifecycle and the AI activity page exist, are substantive, wired and covered by specs plus live UAT. The remaining items are live-provider evidence: the Gemini S6 matrix is complete (borderline, native kept by operator decision), and the Ollama proof is partial because of model strength, not the adapter.

---

_Verified: 2026-11-02_
_Verifier: Claude (gsd-verifier)_
