---
phase: 116-table-deep-links
plan: 01
subsystem: web-lib
tags: [deep-links, history-api, url-sync, tables]
dependency-graph:
  requires: []
  provides:
    - "lib/tableUrl.ts — table URL param readers + History-API writers (openTableUrl, clearTableUrl, restoreTableUrl, setTableMode, leaveTableUrl)"
  affects:
    - "116-02..06 — every later plan in this phase imports from lib/tableUrl.ts"
tech-stack:
  added: []
  patterns:
    - "Sibling module over shared abstraction (mirrors lib/dashboardUrl.ts exactly; zero shared code, zero edits to the original)"
key-files:
  created:
    - packages/web/src/lib/tableUrl.ts
    - packages/web/src/lib/tableUrl.spec.ts
  modified: []
decisions:
  - "setTableMode preserves window.history.state verbatim (neither null nor a hardcoded marker) so the pop-vs-write branch of leaveTableUrl sees the same answer before and after an edit-mode Save — proven by mutation probe, not just asserted"
  - "No TLINK-V121-* requirement marked complete in this plan — the requirement IDs in this plan's frontmatter (TLINK-V121-01/06/07) describe end-to-end user-visible behavior that only becomes true once plans 02-06 wire this module into DatasetsPage/App.tsx; marking them here would be premature (see GSD subagent tracking gotcha: executors mark multi-phase requirements complete early)"
metrics:
  duration_minutes: 15
  completed: 2026-09-14
---

# Phase 116 Plan 01: lib/tableUrl.ts — Table URL Sync Module Summary

Created `lib/tableUrl.ts`, a new sibling module (not a refactor) mirroring `lib/dashboardUrl.ts`'s
param-read/build helpers and History-API writers, plus the one genuinely new writer
(`setTableMode`) that changes the `mode` qualifier on the current history entry without disturbing
whether that entry is self-opened or arrived-on — and its 50-test unit spec, with both required
mutation probes executed for real and both reddening as designed.

## What Was Built

### `packages/web/src/lib/tableUrl.ts`
All 14 planned symbols, exported and compiling clean:
`TABLE_URL_PARAM`, `TABLE_MODE_PARAM`, `TABLE_HISTORY_MARKER`, `TableMode`, `isValidTableId`,
`readTableIdFromSearch`, `readTableModeFromSearch`, `hasTableParam`, `buildTableUrl`,
`openTableUrl`, `clearTableUrl`, `restoreTableUrl`, `setTableMode`, `leaveTableUrl`.

- Query param shape and marker-based pop/write leave semantics mirror `dashboardUrl.ts` exactly.
- `readTableModeFromSearch` — the one new reader — treats absence and any unrecognised value
  (including a differently-cased `"EDIT"`) as `"view"`, exact-match only against `"edit"`, per the
  116-CONTEXT locked decision.
- `buildTableUrl` expresses view mode by the `mode` param's ABSENCE (not `mode=view`), so a view
  URL stays the short canonical form; a stale `mode=edit` from a previous state is dropped when a
  fresh `view` build runs over it.
- `setTableMode` — the one writer with no dashboard analogue — is
  `window.history.replaceState(window.history.state, "", buildTableUrl(...))`, preserving whatever
  marker state the current entry already carries (self-opened vs. deep-linked-in).
- Zero imports from `lib/dashboardUrl.ts`; `dashboardUrl.ts` itself is untouched (0-line diff,
  verified below).

### `packages/web/src/lib/tableUrl.spec.ts`
50 tests, all titled `TLINK-116: …`, mirroring `dashboardUrl.spec.ts`'s harness (same
`beforeEach` history reset, same `waitFor`-wrapped async-traversal technique for the `"popped"`
branch) plus two describe blocks with no dashboard analogue: `readTableModeFromSearch` (7 cases,
including the explicit `mode=banana` → view case) and `setTableMode` (both marker-preservation
paths — self-opened and arrived-on — each verified end-to-end through a subsequent
`leaveTableUrl()` call).

## Mutation Probe Results (the evidence these criteria are not toothless)

**Probe 1 — `setTableMode` marker-preservation (116-RESEARCH Pitfall 3):**
Mutated `setTableMode` to `window.history.replaceState(null, "", ...)` (dropping the
`window.history.state` read). Re-ran `npx vitest run src/lib/tableUrl.spec.ts`:
**2 failed, 48 passed** (both `setTableMode` tests — the self-opened-preserves-pop case and the
arrived-on-preserves-write case — reddened). Reverted; suite returned to **50 passed, 0 failed**,
confirmed identical to the pre-mutation file via `git diff --stat` (empty).

**Probe 2 — `leaveTableUrl` unmarked-branch ejection guard:**
Mutated `leaveTableUrl` to always call `window.history.back()` unconditionally (deleting the
`state[TABLE_HISTORY_MARKER] === true` check). Re-ran the spec:
**2 failed, 48 passed** (the arrived-on `setTableMode` test and the dedicated `leaveTableUrl`
"writes the list URL" test both reddened, confirming the deep-link-arrival ejection guard is
really exercised). Reverted; suite returned to **50 passed, 0 failed**, confirmed identical to the
committed file via `git diff --stat` (empty).

## Verification

| Check | Result |
|---|---|
| `npx tsc --noEmit` | Clean |
| `npx vitest run src/lib/tableUrl.spec.ts` | 50 passed, 0 failed |
| `npx vitest run src/lib/dashboardUrl.spec.ts` | 39 passed, 0 failed (unmodified) |
| `npx vitest run` (full suite) | 169 files, 3828 tests, 100% passing (baseline was 168 files / 3778 tests) |
| `npx vitest run src/styles/theme-guard.spec.ts` | 150 passed |
| `git diff --numstat -- packages/web/src/lib/dashboardUrl.ts packages/web/src/lib/dashboardUrl.spec.ts` | empty |
| `git diff --numstat -- packages/server` | empty (frontend-only) |
| `grep -c "export function setTableMode" lib/tableUrl.ts` | 1 |
| `grep -c "replaceState(window.history.state" lib/tableUrl.ts` | 1 |
| `grep -rc "replaceState(window.history.state" packages/web/src` (files, non-zero) | 1 file |
| `grep -c "kbiTableEntry" lib/tableUrl.ts` | 1 |
| `grep -c "from \"./dashboardUrl\"\|from \"../lib/dashboardUrl\"" lib/tableUrl.ts` | 0 |
| `grep -c "TLINK-116:" tableUrl.spec.ts` | 50 |
| `grep -c "mode=banana" tableUrl.spec.ts` | 2 |

## Deviations from Plan

None — plan executed exactly as written. All acceptance-criteria grep anchors in the plan were
already pre-verified at 0 by the planner/researcher; re-running them in this session reconfirmed
0-before / non-zero-after for every one, so none were toothless.

## Requirements

No `TLINK-V121-*` requirement was marked complete by this plan, per explicit instruction in the
executor task (`success_criteria`: "No TLINK requirement marked complete — plans 02-06 remain"),
even though this plan's own frontmatter lists `[TLINK-V121-01, TLINK-V121-06, TLINK-V121-07]`.
Those requirements describe end-to-end, user-visible behavior (a table opens from a URL, Back
works, leaving clears the bar) that is not yet reachable — `lib/tableUrl.ts` has zero consumers
until plans 02-06 wire it into `DatasetsPage.tsx`/`App.tsx`. Marking them complete here would be
premature per the known GSD gotcha of executors marking multi-phase requirements complete early.

## Self-Check: PASSED

- FOUND: `packages/web/src/lib/tableUrl.ts`
- FOUND: `packages/web/src/lib/tableUrl.spec.ts`
- FOUND commit `c5a2c69` (Task 1 — `feat(116-01): add lib/tableUrl.ts`)
- FOUND commit `d721067` (Task 2 — `test(116-01): add lib/tableUrl.spec.ts`)
