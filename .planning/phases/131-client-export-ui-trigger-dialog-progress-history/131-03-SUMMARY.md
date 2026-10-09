---
phase: 131-client-export-ui-trigger-dialog-progress-history
plan: 03
subsystem: web-ui
tags: [css, toast, tooling]
requires: []
provides: [exports-css-block, check-classnames-script, toast-action]
affects: [131 UI plans]
key-files:
  created: [packages/web/scripts/check-classnames.mjs, packages/web/src/store/toast.spec.ts, packages/web/src/components/Toast.spec.tsx]
  modified: [packages/web/src/styles/global.css, packages/web/src/store/toast.ts, packages/web/src/components/Toast.tsx]
requirements: [EXPRT-V126-06, EXPRT-V126-12]
metrics: {tasks: 2}
---

# Phase 131 Plan 03: CSS block, className check, toast action Summary

Token-only exports CSS (4 classes), a className-existence script, and optional 15 s action button on toasts.

## Pinned APIs (for later plans)

**className check** (run from repo root, paths relative to cwd):

    node packages/web/scripts/check-classnames.mjs <file.tsx> [...]

Prints `MISSING <token> (<file>)` per undefined token and exits 1; otherwise `OK <n> tokens in <m> files`, exit 0. Reads string-literal and template-literal classNames only (object-key clsx not seen); `toast-` style template fragments skipped.

**Toast action API:**

    export type ToastAction = { label: string; onClick: () => void };
    export type Toast = { id; message; kind; action?: ToastAction };
    export const TOAST_TTL_MS = 5000;
    export const TOAST_ACTION_TTL_MS = 15000;
    useToastStore.getState().showToast(message, kind?, action?)

Action renders as `<button type="button" className="ghost-sm">` between `.toast-message` and `.toast-dismiss`; click runs `action.onClick()` then dismisses. Dedup (5 s on kind+message) unchanged. Existing 2-arg callers unaffected.

## CSS
All tokens (`--danger`, `--text-base`, `--radius-md`, `--muted`, `--accent`, `--duration-base`) exist in :root. Block inserted after `.ds-actions > button`; 0 hex / 0 rgba in block; theme-guard green (154 passed).

## Probes
- Invented-class probe: exit 1, listed exactly `not-a-real-class-xyz` and `bogus-abc`; did not list `ds-actions`, `muted`, `toast`, `toast-`.
- DatasetsPage.tsx: `OK 23 tokens in 1 files` (no pre-existing misses). Toast.tsx: `OK 5 tokens in 1 files`.
- Pre-checks read 0 before work (global.css export classes; `action` in toast.ts/Toast.tsx).
- Discrimination: using TOAST_TTL_MS for action toasts turns TOAST-ttl-action red (verified), reverted.
- TDD RED confirmed: 3 of 6 specs failed before implementation.

## Gates
- Web vitest full run: 192 files / 4267 tests pass. theme-guard green. No fake-timer leak observed.
- `tsc --noEmit`: only errors are in `src/lib/exportRequest.ts` (131-02's in-flight file, missing `StartExportBody`/`ExportStartOptions` exports from api/client.ts); none in this plan's files. Not touched.

## Deviations
None. Minor: Toast.tsx map callback now uses a local `const action = t.action` (so `action.onClick()` narrows without a non-null assertion); prettier reflowed the file.

## Commits
- 0e28cbb: CSS block + check-classnames script
- a800e70: toast action button with 15 s lifetime

Shared docs (STATE/ROADMAP/REQUIREMENTS) untouched per instructions.

## Self-Check: PASSED
