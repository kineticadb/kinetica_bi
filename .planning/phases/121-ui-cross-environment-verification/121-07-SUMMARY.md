---
phase: 121-ui-cross-environment-verification
plan: 07
subsystem: verification
tags: [checkpoint, human-verify, dxim, gap-closure, operator-uat]
gap_closure: true

requires:
  - phase: 121-05
    provides: "liveMetricSql.ts — applyLiveMetricExpr + isMetricsHydrated"
  - phase: 121-06
    provides: "AggregatedWidgetRenderer resolves the custom-metric expression live"
provides:
  - "Live operator confirmation that the frozen-config.sql defect is fixed in both environments"
  - "DXIM-V124-10 re-closed with the reopening left visible in the record"
  - "v1.24 at 11/11 requirements Complete"
affects: ["v1.24 closeout"]

tech-stack:
  added: []
  patterns: []

key-files:
  created:
    - .planning/phases/121-ui-cross-environment-verification/121-07-SUMMARY.md
  modified:
    - .planning/REQUIREMENTS.md
    - .planning/ROADMAP.md
    - .planning/STATE.md
    - .planning/defect-frozen-config-sql-metric-expression.md

verdict: PASS
requirements-closed: [DXIM-V124-10]
---

# Phase 121 Plan 07: Live Re-verification — Operator Verdict

## Verdict

**PASS on all four checks. DXIM-V124-10 RE-CLOSED. v1.24 is 11/11.**

## What the operator reported

The operator ran Checks 1-4 as written in 121-07-PLAN.md against the two environments plan 121-04
left running (A: `:5173`/`:4000`/`kinetica.db`; B: `:5174`/`:4001`/`env-b.db`) and reported:

> All 4 pass

**Recorded exactly as given.** The plan asked for per-check observed values and the verdict came as
a blanket pass, so no per-check numbers are transcribed here. Inventing plausible figures (`716.9…`
for B's `* 50.111111`, say) would have manufactured evidence, which is the failure mode CLAUDE.md's
verifiable-criteria section exists to prevent. The four checks are recorded as PASS on the
operator's word; the numeric proof of the same property lives in
`LIVEMETRIC-XENV-target-expression`, which asserts the executed SQL string directly.

| # | Check | Verdict |
|---|---|---|
| 1 | Single-environment metric edit re-queries without reopening a config panel (env A, no import involved) | **PASS** |
| 2 | Imported widget renders the TARGET environment's definition; byte-identity with source is now the failure signal | **PASS** |
| 3 | No regression — real-column widgets, drill-down, filters, dv-bound chart, deleted-metric fallback, no stale flash | **PASS** |
| 4 | Light and dark theme on the one new `Loading...` placeholder | **PASS** |

Check 1 is the load-bearing one: it needs no import at all, and it is the case that proved the root
cause was pre-existing rather than an export/import defect.

## Gates at verdict time

| Gate | Result |
|---|---|
| `packages/web` `tsc --noEmit` | clean |
| `packages/web` `vitest run` | **181 files / 4100 tests / 0 failed** (gap-open baseline: 179 / 4069) |
| `packages/web` theme-guard | **152/152** |
| `packages/server` `tsc --noEmit` | clean |
| `packages/server` `scripts/test-gate.mjs` | **GATE PASSED** — 8 failing files, all documented |
| `git diff --numstat` on `packages/server` across 121-05/06/07 | **EMPTY** |

The server gate is SET-BASED per CLAUDE.md, never a pass-count. Its 8 allowed failures are 7×
TD-V11-04 (OIDC issuer-mock) plus `db.smoke` schema-snapshot drift and `routes.wms`
credential-forwarding. A raw `npx vitest run` instead reports 12 failing files, because the dev
`packages/server/.env` sets `DEFAULT_VIEW_TTL_MINUTES=3` and `src/env.ts` calls `dotenv.config()` at
import time; `test-gate.mjs` forces that variable empty. **Use the gate script, not raw vitest.**

## Bookkeeping applied

1. `REQUIREMENTS.md` — DXIM-V124-10 `- [ ]` → `- [x]`, with a re-closure clause that keeps the
   reopening visible: reopened 2026-09-18 and why, root cause pre-existing and not import-specific,
   fixed in the renderer so Phases 119/120 stay closed, the named automated proof, the dated live
   confirmation, and the honest limit (no test in this repo renders a chart against a live
   Kinetica). Traceability row updated to point at `121-06-SUMMARY.md`.
2. `ROADMAP.md` — plans 121-05/06/07 added, `**Plans**: 4/4` → `7/7`. The known-gap text was
   PRESERVED and a resolution appended; the record of what was found is the point.
3. `defect-…md` — `Status: OPEN` → `FIXED 2026-09-21`; "Suggested fix" replaced by "Fix as shipped"
   recording the (b)-over-(a) decision and both reasons, the fail-closed parser, the deliberate
   deleted-metric fallback, and suspend-not-fallback. A new section records the one thing found
   alongside and deliberately NOT fixed.
4. `STATE.md` — `stopped_at` rewritten, `last_updated` set, plan counts 13 → 16, Current Position
   rewritten to 11/11 with a `Next:` that is no longer `/gsd:plan-phase 121 --gaps`, plus a
   "Plans 05-07 decisions" section.

All nine of this plan's acceptance criteria were confirmed FAILING before the edits and PASSING
after — each one discriminates.

## Still open — recorded, not fixed

The hydration effect ends in `loadConfig(tableId).catch(() => {})`, copied byte-for-byte from
`TimelineRenderer.tsx:156-163`. A REJECTED metrics fetch suspends the widget in `Loading...`
indefinitely, with no error surfaced and no retry. Pre-existing and project-wide (the same idiom is
in `BarRenderer`'s own hydration effect); deviating unilaterally inside a gap-closure plan would
have put an unreviewed error-handling design into seven more widget types. Candidate for a future
phase.

## What this phase cost and returned

Phase 121 found FOUR defects that no automated gate could catch — REF-9 `spatialTargets`,
`max_records: 0` rejection, wrong-table custom metrics, and the frozen `config.sql` expression — and
three of the four were invisible precisely because the tests and the code agreed with each other.
The last one was found only because a side-by-side comparison LOOKED correct and the operator
checked why.

## Self-Check: PASSED
