---
phase: 07-frontend-auth-mode-awareness
plan: 05
subsystem: ui
tags: [react, zustand, sessionStorage, oidc, vitest, rtl]

# Dependency graph
requires:
  - phase: 07-frontend-auth-mode-awareness
    provides: "Plan 07-02 vitest+jsdom+RTL test rig; Plan 07-03 useAuthStore.authMode field + UNAUTHORIZED_EVENT export"
provides:
  - "App.tsx writes sessionStorage['kbi_returnTo'] on UNAUTHORIZED_EVENT in OIDC mode (BEFORE markUnauthenticated)"
  - "App.tsx reads+restores+clears the same key after status flips to 'authenticated' (single-use)"
  - "App.spec.tsx — 11 RTL tests across write/read/regression on the 401 chain + status gates"
  - "Storage shape locked to { page, dashboardViewMode? } per CONTEXT.md"
affects: [phase-08-boot-wipe-hardening-runbook]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "useAuthStore.getState() for synchronous selector reads inside event handlers (avoids React batching delay; CONTEXT.md lock)"
    - "sessionStorage write in UNAUTHORIZED_EVENT handler BEFORE markUnauthenticated state transition"
    - "Single-use sessionStorage key: read → restore → remove in mount effect, with try/finally that clears key whether parse succeeds or fails"
    - "Page enum guard: only 'dashboards' | 'datasets' | 'settings' restored from storage; unknown values rejected"
    - "Effect deps include captured-value state (page, dashboardViewMode) so handler closure does not freeze"

key-files:
  created:
    - "kinetica_bi/src/App.spec.tsx"
  modified:
    - "kinetica_bi/src/App.tsx"

key-decisions:
  - "UNAUTHORIZED_EVENT handler reads authMode via useAuthStore.getState().authMode (NOT via selector) — synchronous read at handler-fire time avoids React batching delay (CONTEXT.md / RESEARCH Code Example #4)"
  - "Effect deps for UNAUTHORIZED handler include [markUnauthenticated, page, dashboardViewMode] so the handler closure captures fresh page+viewMode values; without this, the closure would freeze at mount"
  - "Read effect runs on [status] only (not [status, ...other]) — single-use key + early-return on non-authenticated keeps the effect idempotent across re-renders"
  - "Page enum validated against literal whitelist before setPage call — defense against tampered sessionStorage values; default page (dashboards) wins on rejection"
  - "JSON.parse wrapped in try/catch with finally that clears the key — corruption never crashes the app, single-use semantics preserved on parse failure"
  - "ReturnTo type stays internal to App.tsx (NOT exported) — no other module needs the shape"
  - "sessionStorage.setItem and sessionStorage.removeItem each wrapped in defensive try/catch — sessionStorage may be disabled in private-browsing modes; falling through to default page is acceptable"

patterns-established:
  - "Pattern: synchronous store read in event handlers — useAuthStore.getState().{field} for handler-time reads (selector subscriptions are for render-time reads only)"
  - "Pattern: BEFORE state transition writes — capture mutable in-memory state to sessionStorage BEFORE calling the action that may unmount components"
  - "Pattern: enum-guarded storage restore — never trust sessionStorage values; validate against literal whitelist before applying to component state"

requirements-completed: [UX-06]

# Metrics
duration: 2min
completed: 2026-05-01
---

# Phase 7 Plan 05: Return-to-Page After OIDC Re-Auth Summary

**App.tsx persists current page to sessionStorage on UNAUTHORIZED_EVENT (OIDC-only) and restores it after bootstrap re-authenticates, with 11 RTL tests covering the contract**

## Performance

- **Duration:** 2 min
- **Started:** 2026-05-01T18:43:27Z
- **Completed:** 2026-05-01T18:46:20Z
- **Tasks:** 2
- **Files modified:** 1
- **Files created:** 1

## Accomplishments

- UNAUTHORIZED_EVENT handler in App.tsx now writes `sessionStorage["kbi_returnTo"]` with the current `{ page, dashboardViewMode }` payload BEFORE calling `markUnauthenticated("session-expired")`, gated on `authMode === "oidc"` via synchronous `useAuthStore.getState()` read
- New mount effect on `status === "authenticated"` reads the key, validates the page against the literal whitelist (`dashboards | datasets | settings`), restores via `setPage` / `setDashboardViewMode`, and clears the key (single-use)
- JSON.parse failures and unknown enum values are caught — app never crashes, default page (dashboards) wins, key is still cleared
- `App.spec.tsx` (NEW) provides 11 RTL tests across 3 describe blocks: OIDC write path, password no-write, 401-chain regression, restore-on-authenticated, clear-after-restore, corrupt JSON, unknown page rejection, empty-key skip, and the existing `status === "unknown"` Loading + LoginPage status gates
- Existing 401-REAUTH chain preserved (regression coverage included): `markUnauthenticated("session-expired")` still fires in BOTH password and OIDC modes
- All 35 frontend tests pass (4 spec files); `tsc --noEmit` clean

## Task Commits

Each task was committed atomically:

1. **Task 1: Add sessionStorage write+read hooks to App.tsx** — `31b7f1f` (feat)
2. **Task 2: Add App.tsx RTL spec covering write/read/regression** — `0bc080a` (test)

## Files Created/Modified

- `kinetica_bi/src/App.tsx` — UNAUTHORIZED_EVENT handler gains OIDC-gated `sessionStorage.setItem("kbi_returnTo", JSON.stringify({page, dashboardViewMode}))` BEFORE `markUnauthenticated`; new mount effect on `[status]` reads/validates/restores/clears the key with try/catch/finally
- `kinetica_bi/src/App.spec.tsx` — NEW; 11 tests across 3 describe blocks; mocks Sidebar/Topbar/DashboardsPage/DatasetsPage/LoginPage/Toast to focus on App.tsx routing logic; uses `useAuthStore.setState` + `act()` to drive status transitions

## Decisions Made

1. **Synchronous authMode read via `useAuthStore.getState().authMode` inside the UNAUTHORIZED handler** — selector subscription would suffer React batching delay; handler-time getState() guarantees we read the deployment's actual mode at fire time. Locked by CONTEXT.md and RESEARCH Code Example #4.
2. **Effect deps `[markUnauthenticated, page, dashboardViewMode]` for the UNAUTHORIZED handler** — without page+viewMode in deps, the handler closure would freeze at mount and write stale values. The handler is reattached on every page/viewMode change, but addEventListener is idempotent because the cleanup runs first.
3. **`if (raw !== null)` guard before `removeItem`** — only attempt to remove when we actually read a value; harmless on the success path but avoids touching sessionStorage when the key was already absent.
4. **No reason flag passed to `markUnauthenticated` in OIDC mode** — kept the existing `"session-expired"` reason in BOTH modes; `LoginPage` already handles this. The OIDC SSO branch (Plan 07-04) renders the SSO link regardless of reason; the session-expired banner sits above it cleanly.
5. **Internal `ReturnTo` type, not exported** — only App.tsx reads/writes the key; no other module needs the shape. Avoids accidental coupling for a v1.1-scoped concern.
6. **`vi.mock("./api/client")` re-exports actuals** — only needed because the test file imports `UNAUTHORIZED_EVENT` from client; explicit re-export documents the intent and keeps the mock minimal (no API call interception needed because bootstrap is overridden via `useAuthStore.setState({ bootstrap: async () => {} })`).

## Deviations from Plan

None — plan executed exactly as written.

The plan's `<action>` block was a verbatim source replacement for `App.tsx` and a verbatim NEW file for `App.spec.tsx`. Both files were written exactly as specified. All 13 acceptance criteria for Task 1 and all 11 acceptance criteria for Task 2 verified pass.

## Issues Encountered

- **Topbar.tsx unstaged change** (out of scope): The working tree had a pre-existing `M kinetica_bi/src/components/Topbar.tsx` modification (switching from useUserStore to useAuthStore + adding logout button). This is unrelated to plan 07-05 and was NOT touched per the SCOPE BOUNDARY rule (only fix issues directly caused by the current task). Logged here for awareness; out of scope for this plan.
- **STATE.md disk state stale**: STATE.md showed "07-04, 07-05 remaining" but `git log` confirms `4d0a346 feat(07-04): add OIDC early-return branch to LoginPage` was committed. STATE.md never received the 07-04 SUMMARY.md update. Not blocking — plan 07-05's `depends_on: [02, 03]` is satisfied. State will be reconciled at the end of this plan when `state advance-plan` runs.

## User Setup Required

None — sessionStorage is browser-built-in; no external service configuration required.

## Next Phase Readiness

- Phase 7's three frontend hooks are now complete: Plan 07-03 (bootstrap+authMode), 07-04 (LoginPage OIDC branch), 07-05 (return-to-page). The frontend awaits Phase 8 only for boot-wipe hardening + runbook.
- All 35 frontend tests pass; full TypeScript compile clean across both `kinetica_bi/` and `kinetica_bi/server/`.
- The `status === "unknown"` Loading gate (Pitfall #2 in 07-RESEARCH.md) is locked by regression test in App.spec.tsx — Phase 8 cannot accidentally break it.

## Self-Check: PASSED

Files verified to exist:
- FOUND: kinetica_bi/src/App.tsx (modified)
- FOUND: kinetica_bi/src/App.spec.tsx (created)
- FOUND: .planning/phases/07-frontend-auth-mode-awareness/07-05-SUMMARY.md (this file)

Commits verified to exist:
- FOUND: 31b7f1f (Task 1: feat App.tsx sessionStorage hooks)
- FOUND: 0bc080a (Task 2: test App.spec.tsx)

Test verification:
- `npx tsc --noEmit` exits 0
- `npm test` passes 35/35 across 4 spec files (App.spec.tsx, auth.spec.ts, sanity.spec.ts, plus the LoginPage spec from 07-04)
- `git grep -F "kbi_returnTo" kinetica_bi/src` returns 16 hits (≥4 required)
- `git grep -F "useAuthStore.getState().authMode" kinetica_bi/src` returns 7 hits (≥1 required)

---
*Phase: 07-frontend-auth-mode-awareness*
*Completed: 2026-05-01*
