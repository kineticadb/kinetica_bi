---
phase: 137-ai-widget-streaming-ui
plan: 10
subsystem: web/ai-widget
tags: [ai-widget, drawer, portal, devharness]
requires: [137-05, 137-07, 137-08]
provides: [AiWidgetRenderer, AiDrawer, WidgetRenderer ai branch, harness chatTurn/fakeRun]
affects: [137-11, 137-12]
key-files:
  created: [packages/web/src/components/charts/AiWidgetRenderer.tsx, packages/web/src/components/charts/AiDrawer.tsx, packages/web/src/components/charts/AiWidgetRenderer.spec.tsx]
  modified: [packages/web/src/components/charts/AiWidget.css, packages/web/src/components/charts/WidgetRenderer.tsx, packages/web/src/lib/aiSession/devHarness.ts, packages/web/src/lib/aiSession/devHarness.spec.ts]
requirements: [AIWID-V20-01, AIWID-V20-02, AIGOV-V20-01]
completed: 2026-10-14
---

# Phase 137 Plan 10: AI widget shell Summary

AI tile renders inline chat (>=12 cols and >=24 rows in 36-col config.layout) or an ask bar + History button + one-line last result with a body-portalled drawer; gated by ai:use, then server config, then dashboard context; WidgetRenderer routes type "ai" before the aggregated fallback; DEV harness gains chatTurn/fakeRun.

## Commits
- 40fc51f AiWidgetRenderer + AiDrawer + spec (AIW-1..8)
- d333c53 drawer/tile CSS + WidgetRenderer branch (AIW-9)
- harness commit (HEAD after d333c53): chatTurn/fakeRun + HARN7-1..4

## Verification
- Pre-checks (all 0 before work): AiWidgetRenderer/AiDrawer refs (only definitions/ai.ts hit unrelated), `type === "ai"` in WidgetRenderer 0, `ai-drawer` in CSS 0, chatTurn/fakeRun in harness 0.
- Web tsc clean (a transient error from 137-11's in-flight spec appeared once, then cleared); `src/components/charts` 40 files / 1385 tests green with --maxWorkers=4; theme-guard 172 green; harness spec 16 green.
- Class-resolution loop printed no UNDEFINED; `ai-drawer-title` is an id (excluded). No hex/rgba in AiWidget.css.
- AIW-9 note: the "bar" negative control only proves the `.ai-widget` anchor is absent for non-ai types; the positive half proves routing.

## Deviations
None. (Used default import of WidgetRenderer in the spec since it is a default export.)

## Needs operator light/dark visual check (137-12)
- Large inline chat tile; small tile ask bar/History/last-line row alignment and ellipsis.
- Drawer: right-aligned panel, opaque --panel-solid, border/shadow, full-width under 900px, focus on Close.
- No-access / not-configured notices legibility.
- Harness: `__kbiAiHarness.chatTurn(...)` and `fakeRun(...)` to see answer/choices/follow-ups/error/cancelled/running states.

## Self-Check: PASSED
Files and the three commits exist; no STATE/ROADMAP/REQUIREMENTS edits.
