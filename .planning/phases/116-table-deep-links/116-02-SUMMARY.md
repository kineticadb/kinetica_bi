---
phase: 116-table-deep-links
plan: 02
subsystem: web-hooks
tags: [deep-links, react-hooks, tables, state-machine]
dependency-graph:
  requires:
    - "lib/tableUrl.ts (Plan 01) — readTableIdFromSearch, readTableModeFromSearch, hasTableParam, isValidTableId, clearTableUrl"
  provides:
    - "hooks/useDeepLinkTable.ts — the five-state table deep-link resolution machine + DEEP_LINK_TABLE_UNAVAILABLE_MESSAGE"
  affects:
    - "116-04..06 — App.tsx and DatasetsPage wiring plans consume this hook"
tech-stack:
  added: []
  patterns:
    - "Sibling hook over parameterized core (mirrors hooks/useDeepLinkDashboard.ts exactly; zero shared code, zero edits to the original)"
key-files:
  created:
    - packages/web/src/hooks/useDeepLinkTable.ts
    - packages/web/src/hooks/useDeepLinkTable.spec.ts
  modified: []
decisions:
  - "Unavailable message narrowed to a single clause ('...may have been deleted.') — not the dashboard's two-clause wording — because GET /api/tables and GET /api/tables/:id carry no permission middleware and no DATASETS_VIEW permission exists; 'not permitted' is not a reachable state for tables today"
  - "Resolution goes through listTables() + Array.find, not the existing-but-dead getTableById per-id route, to inherit the found/absent/rejected trichotomy for free instead of building new 404-vs-transport-error classification"
  - "No TLINK-V121-* requirement marked complete in this plan — the hook has zero consumers until plans 03-06 wire it into DatasetsPage/App.tsx (mirrors the same discipline 116-01-SUMMARY documented)"
metrics:
  duration_minutes: 6
  completed: 2026-09-14
---

# Phase 116 Plan 02: hooks/useDeepLinkTable.ts — Table Deep-Link Resolution Hook Summary

Created `hooks/useDeepLinkTable.ts`, a new sibling hook (not a refactor, not a parameterization)
mirroring `hooks/useDeepLinkDashboard.ts`'s five-state resolution machine line-for-line, plus the
one new dimension dashboards never needed — a `mode: "view" | "edit"` qualifier carried through
the `"opened"` state — and its 18-test unit spec, with both required mutation probes executed for
real and both reddening as designed. `useDeepLinkDashboard.ts` and its spec have a verified
zero-line diff throughout.

## What Was Built

### `packages/web/src/hooks/useDeepLinkTable.ts`
All three planned exports, compiling clean:
`DeepLinkTableState`, `DEEP_LINK_TABLE_UNAVAILABLE_MESSAGE`, `useDeepLinkTable`.

- Structurally identical control flow to `useDeepLinkDashboard`: a `useState` initializer reads
  the boot URL once (before any effect can mutate it), a `startedRef` guards against StrictMode's
  double-invoke, and the resolution effect only starts once `authStatus === "authenticated"`,
  re-arming on a mid-flight rejection while logged out so a same-tab re-auth retries.
- The one new piece: `readTableModeFromSearch` (from Plan 01) supplies the `mode` qualifier at
  the initializer, it rides through the `pending` state as `pendingMode`, and is placed into the
  `opened` state's payload — never hardcoded, always the value the URL/stored-table named.
- `DEEP_LINK_TABLE_UNAVAILABLE_MESSAGE` uses the single-clause narrowed wording
  ("This table isn't available — it may have been deleted.") per the locked operator decision,
  with the non-leak reasoning recorded in the header comment (condensed) rather than copied
  verbatim from 114-CONTEXT, since the underlying server fact differs for tables.
- Resolves via `listTables()` + `Array.prototype.find`, never the existing-but-unused
  `getTableById` per-id route — the header comment states why without naming the symbol
  literally (see the toothless-criterion note below), so `getTableById`'s repo-wide occurrence
  count stays at exactly 1 (its own definition).
- Zero imports from `hooks/useDeepLinkDashboard.ts`; that file is untouched (0-line diff, verified
  below).

### `packages/web/src/hooks/useDeepLinkTable.spec.ts`
18 tests, all titled `TLINK-116: …`, mirroring `useDeepLinkDashboard.spec.ts`'s harness (same
`renderHook`/`act`/`waitFor` imports, same `vi.mock("../api/client")` partial-mock stubbing
`listTables`, same `beforeEach` history/auth reset) plus:
- Two new mode-specific tests (`?table=7&mode=edit` → edit; `?table=7&mode=banana` → view, not an
  error) beyond the one-for-one behavior mirror.
- The full `storedTable` describe block mirroring `useDeepLinkDashboard.spec.ts`'s `storedId`
  block (7 tests): precedence over the URL, invalid shapes, StrictMode single-call, unknown-auth
  hold, junk-URL-plus-stored-resolves.
- The dedicated non-leak assertion (`not.toMatch(/access/i)`, `not.toMatch(/\d/)`) on the
  unavailable message.

## Mutation Probe Results (the evidence these criteria are not toothless)

**Probe 1 — hardcoded `mode: "view"` instead of `mode: pendingMode` in the `"opened"`
construction:** Re-ran `npx vitest run src/hooks/useDeepLinkTable.spec.ts`: **3 failed, 15
passed** (the edit-mode URL test, the stored-edit-mode test, and the junk-URL-plus-stored-12-edit
test all reddened — every test that actually asserts `mode === "edit"`). Reverted; suite returned
to **18 passed, 0 failed**, confirmed identical to the committed file via `git diff --stat -- src/hooks/useDeepLinkTable.ts` (empty).

**Probe 2 — removed the `if (authStatus !== "authenticated") return;` guard:** Re-ran the spec:
**2 failed, 16 passed** (the "auth status unknown at boot stays pending" test and its
`storedTable`-block analogue both reddened — `listTables` was called before authentication,
violating the logged-out-arrival contract). Reverted; suite returned to **18 passed, 0 failed**,
confirmed identical to the committed file via `git diff --stat` (empty).

## Verification

| Check | Result |
|---|---|
| `npx tsc --noEmit` | Clean |
| `npx vitest run src/hooks/useDeepLinkTable.spec.ts` | 18 passed, 0 failed |
| `npx vitest run src/hooks/useDeepLinkDashboard.spec.ts` | 16 passed, 0 failed (unmodified) |
| `npx vitest run src/styles/theme-guard.spec.ts` | 150 passed |
| `git diff --numstat -- packages/web/src/hooks/useDeepLinkDashboard.ts packages/web/src/hooks/useDeepLinkDashboard.spec.ts` | empty |
| `git diff --stat -- packages/server` | empty (frontend-only) |
| `grep -c "export function useDeepLinkTable" hooks/useDeepLinkTable.ts` | 1 |
| `grep -c "DEEP_LINK_TABLE_UNAVAILABLE_MESSAGE" hooks/useDeepLinkTable.ts` | 1 |
| `grep -c "may have been deleted, or you may not have access" hooks/useDeepLinkTable.ts` | 0 |
| `grep -rc "may have been deleted, or you may not have access" .` (non-zero files) | 1 (only `useDeepLinkDashboard.ts`) |
| `grep -c "listTables()" hooks/useDeepLinkTable.ts` | 1 |
| `grep -rn "getTableById" packages/web/src` | 1 (only `api/client.ts`'s own definition) |
| `grep -c "TLINK-116:" hooks/useDeepLinkTable.spec.ts` | 19 (18 tests + 1 header-comment mention) |
| `grep -c "mode: \"edit\"\|mode=edit" hooks/useDeepLinkTable.spec.ts` | 5 |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] First draft's header comment literally spelled `getTableById` and `listTables()`, tripping the stability-guard criteria it was meant to satisfy**
- **Found during:** Task 1, immediately after writing the file (self-review against the plan's own acceptance criteria before committing)
- **Issue:** The plan's `<why_listTables_and_not_getTableById>` block instructs the header comment to explain why the per-id route is unused, but acceptance criterion 5 requires `getTableById` to remain at exactly 1 occurrence repo-wide (its own definition in `api/client.ts`), and criterion 4 requires `listTables()` to occur on exactly 1 line in the new file. My first draft's comment used both identifiers literally (`getTableById` twice, `listTables()` once as prose), which would have pushed the repo-wide `getTableById` count to 4 and the file's `listTables()` line-count to 2 — both criteria would have failed a check that only exists to confirm the pattern was followed, not abandoned.
- **Fix:** Reworded the header comment to describe the route/pattern without spelling the exact identifiers (e.g. "a fetch by id" / "the existing client wrapper for that route" instead of `getTableById`; "the table list + find" instead of `listTables()`), preserving the same explanatory content the plan mandated.
- **Files modified:** `packages/web/src/hooks/useDeepLinkTable.ts` (comment only, before first commit — not a separate commit)
- **Commit:** `8056e94` (the fix was applied before Task 1's single commit; no separate revert/fix commit needed)

### Out-of-Scope Issue Found (not fixed, reported)

**`components/DatasetsPage.urlsync.spec.tsx` has 1 failing test** (`expects window.location.search
toBe "?table=42"`, receives `""`), reproducible in isolation (`npx vitest run
src/components/DatasetsPage.urlsync.spec.tsx` → 1 failed, 16 passed). This file is untracked
(`git status` shows `??`) and is owned by the concurrently-executing Plan 116-03
(`DatasetsPage.tsx` + `DatasetsPage.urlsync.spec.tsx`, per this plan's explicit
`<parallel_execution_notice>` — those files are out of my `files_modified` scope and were not
touched. Logged per the deviation rules' scope boundary ("only auto-fix issues directly caused by
the current task's changes... pre-existing warnings/failures in unrelated files are out of
scope"). Not added to `deferred-items.md` since it plausibly resolves once Plan 116-03 finishes
its own execution in this same wave — flagging here for the orchestrator/verifier instead, since
it is live, concurrent WIP rather than settled tech debt.

**Full-suite count at time of this plan's completion:** `npx vitest run` → **170 files passed / 1
failed (171 total)**, **3862 passed / 1 failed (3863 total)**. The 1 failure is the
`DatasetsPage.urlsync.spec.tsx` case above — zero failures trace to any file this plan created or
modified.

## Requirements

No `TLINK-V121-*` requirement is marked complete by this plan, consistent with 116-01-SUMMARY's
documented discipline and this plan's explicit `success_criteria` ("No TLINK requirement marked
complete — plans 03-06 remain"), even though this plan's frontmatter lists
`[TLINK-V121-02, TLINK-V121-04, TLINK-V121-07]`. Those requirements describe end-to-end,
user-visible behavior (a table opens from a URL with no flash, an unavailable/error banner
renders, the mode is honored) that is not yet reachable — `hooks/useDeepLinkTable.ts` has zero
consumers until plans 03-06 wire it into `DatasetsPage.tsx`/`App.tsx`.

## Self-Check: PASSED

- FOUND: `packages/web/src/hooks/useDeepLinkTable.ts`
- FOUND: `packages/web/src/hooks/useDeepLinkTable.spec.ts`
- FOUND commit `8056e94` (Task 1 — `feat(116-02): add hooks/useDeepLinkTable.ts`)
- FOUND commit `e17dd05` (Task 2 — `test(116-02): add hooks/useDeepLinkTable.spec.ts`)
