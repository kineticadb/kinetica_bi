---
phase: 33-dynamic-view-store
plan: 01
subsystem: frontend-store
tags: [zustand, dynamic-views, tdd, byte-parity-helper, session-state]

# Dependency graph
requires:
  - phase: 32-dynamic-view-foundation
    provides: server `buildDynamicViewName` helper + DynamicViewRow shape (consumer of 33-01 byte-parity contract)
provides:
  - "Pure helper `buildDynamicViewName({ userId, dashboardId, dynamicViewId })` — frontend mirror of server lib with byte-parity contract"
  - "Zustand slice `useDynamicViewStore` with 5 locked actions (setView, markPending, setError, clearView, reset)"
  - "Type exports: `DynamicViewStatus`, `DynamicViewReason`, `DynamicViewEntry`, `DynamicViewState`, `DynamicViewNameArgs`"
  - "`dynamicViewVersion` counter — Phase 35 AggregatedWidgetRenderer dep-array signal (locked monotonic bump semantics)"
affects: [33-02 server-drop-endpoint, 33-03 client-helpers-lifecycle, 34 management-modal, 35 renderer-from-swap]

# Tech tracking
tech-stack:
  added: []  # no new deps — zustand and vitest already present from v1.2
  patterns:
    - "Pure-lib mirror pattern extended (v1.4 mapInfoConfig, v1.5 spatialTargets, v1.6 dynamicViewName)"
    - "Per-key Zustand entry shape with always-populated viewName invariant + version-counter mutation signal"

key-files:
  created:
    - "kinetica_bi/src/lib/dynamicViewName.ts (46 lines)"
    - "kinetica_bi/src/lib/dynamicViewName.spec.ts (111 lines, 7 tests)"
    - "kinetica_bi/src/store/dynamicViewStore.ts (155 lines)"
    - "kinetica_bi/src/store/dynamicViewStore.spec.ts (231 lines, 17 tests)"
  modified: []

key-decisions:
  - "Inlined `sanitizeForViewName` in frontend helper (not imported from server tree) — frontend file is dependency-free; parity enforced by spec round-trip pairs"
  - "`markPending(id, viewName)` on existing entry KEEPS prev.viewName, ignores new arg (locked 33-CONTEXT.md § Action contract bullet) — preserves cached deterministic name for retry without re-fetch"
  - "`setView` REPLACE semantics — optional fields stripped from entry if absent in payload (NOT merged with prior entry)"
  - "Spec organization follows spatialFilterStore.spec.ts grouped-describe-per-action style (closest match for stores with several mutations + no-op rules)"
  - "Exported type names follow infoSelectionStore convention: DynamicViewStatus, DynamicViewReason, DynamicViewEntry"
  - "Sanitization regex `/[^a-zA-Z0-9_]/g` + `.slice(0, 32)` — verbatim match to server-side `kinetica_bi/server/src/lib/viewNaming.ts:sanitizeForViewName`"

patterns-established:
  - "Pure-lib byte-parity helper: frontend duplicates server helper body verbatim; cross-tree imports forbidden; parity validated via spec round-trip pairs copied from server tests"
  - "Always-bump version semantics: every successful mutation (setView, markPending, setError, clearView-existing) increments `dynamicViewVersion`; only no-op (clearView non-existent) preserves state reference"
  - "Defensive placeholder pattern: setError on absent entry creates `{ viewName: '', status: 'error', error }` to prevent crash, but Phase 35 caller path always calls markPending first"

requirements-completed: [DV-V16-06]

# Metrics
duration: ~5min
completed: 2026-05-14
---

# Phase 33 Plan 01: store-and-naming-helper Summary

**Ships the two dependency-free building blocks for v1.6 Dynamic Views: a pure `buildDynamicViewName` helper (byte-parity with the server) and the `useDynamicViewStore` Zustand slice with all 5 locked actions.**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-05-14T17:18Z
- **Completed:** 2026-05-14T17:22Z
- **Tasks:** 2 (both TDD)
- **Files created:** 4
- **Tests added:** 24 (7 helper + 17 store)

## Accomplishments

- Pure helper `buildDynamicViewName` ships with 7 round-trip parity tests against the server spec (pairs N1, N2, N4 + auth0-style pipe sanitization). Output shape `_kbi_dv_u<sanitizedUserId>_d<dashboardId>_<dynamicViewId>` matches server byte-for-byte.
- `useDynamicViewStore` ships with 17 tests covering all 5 actions, version monotonicity, REPLACE vs merge semantics, no-op rules, reference stability (PITFALL C-02 / S-02 carry-forward), and error-state shape (success criterion 4).
- 4 production type exports (`DynamicViewStatus`, `DynamicViewReason`, `DynamicViewEntry`, `DynamicViewState`) lock the wire contract Phase 34 modal + Phase 35 renderer will read.
- Zero regressions: full `src/store/` suite (9 spec files, 129 tests) still green; tsc clean.

## Task Commits

Each task was committed atomically with TDD RED → GREEN pairs:

1. **Task 1 RED: spec for `buildDynamicViewName`** — `1664ca9` (test)
2. **Task 1 GREEN: helper implementation** — `6e1e948` (feat)
3. **Task 2 RED: spec for `useDynamicViewStore`** — `2975472` (test)
4. **Task 2 GREEN: store implementation** — `7e1bb91` (feat)

_Note: Plan 33-02 commit `48f1bad` was authored under a different plan; not part of this plan's commit set._

## Files Created

- `kinetica_bi/src/lib/dynamicViewName.ts` — Pure helper exporting `buildDynamicViewName` + `DynamicViewNameArgs`. Sanitization rule inlined (NOT imported from server) so this module is dependency-free.
- `kinetica_bi/src/lib/dynamicViewName.spec.ts` — 7 tests including 4 round-trip parity pairs sourced from `kinetica_bi/server/tests/lib.dynamicViewName.spec.ts`.
- `kinetica_bi/src/store/dynamicViewStore.ts` — Zustand slice `useDynamicViewStore` with the 5 locked actions + 4 type exports. Lives under `src/store/` so the Zustand reset shim auto-resets between specs.
- `kinetica_bi/src/store/dynamicViewStore.spec.ts` — 17 tests organized by action (mirrors `spatialFilterStore.spec.ts` style).

## Exported Types (Hand-off Reference)

```typescript
// From kinetica_bi/src/lib/dynamicViewName.ts
export type DynamicViewNameArgs = {
  userId: string;
  dashboardId: number;
  dynamicViewId: number;
};
export function buildDynamicViewName(args: DynamicViewNameArgs): string;

// From kinetica_bi/src/store/dynamicViewStore.ts
export type DynamicViewStatus = "materialized" | "over_threshold" | "pending" | "error";
export type DynamicViewReason = "no_filter" | "exceeds_max_records";
export type DynamicViewEntry = {
  viewName: string;
  status: DynamicViewStatus;
  expiresAt?: number;       // ONLY when status === "materialized"
  error?: string;            // when status === "error"
  reason?: DynamicViewReason; // when status === "over_threshold"
};
export type DynamicViewState = {
  views: Record<number, DynamicViewEntry>;
  dynamicViewVersion: number;
  setView: (id, payload) => void;
  markPending: (id, viewName) => void;
  setError: (id, error) => void;
  clearView: (id) => void;
  reset: () => void;
};
export const useDynamicViewStore;
```

## Sanitization Regex (verbatim for future server-version comparison)

```ts
function sanitizeForViewName(userId: string): string {
  return userId.replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 32);
}
```

This must remain byte-identical to `kinetica_bi/server/src/lib/viewNaming.ts:sanitizeForViewName`. Spec round-trip pairs N1-N4 are the parity assertion — if the server ever changes the regex or truncation length, those pairs must be updated in both trees simultaneously.

## Test Counts per Describe Block

**`dynamicViewName.spec.ts`** (7 tests):
- composes simple alphanumeric (1)
- sanitizes non-alphanumeric (1)
- truncates to 32 chars (1)
- determinism (1)
- byte-parity round-trip (1 with 4 inner asserts)
- regex shape (1)
- length budget (1)

**`dynamicViewStore.spec.ts`** (17 tests across 9 describe groups):
- initial state (2)
- setView (3 — happy path, idempotent-bump, REPLACE)
- markPending (3 — absent, existing-keeps-viewName, over-pending-bump)
- setError (3 — preserves viewName, over-error-bump, absent placeholder)
- clearView (2 — existing, strict no-op)
- version monotonicity (1)
- reset (1)
- reference stability PITFALL C-02 (1)
- error-state shape success criterion 4 (1)

## Deviations from Plan

None — plan executed exactly as written. The action body, spec scaffolding, and acceptance criteria all matched the proposed implementation 1:1. Plan author had already verified the sanitization rule against the server source before specifying the inlined body.

## Decisions Made Under Claude's Discretion

- **Spec organization:** Grouped describe-per-action (mirrors `spatialFilterStore.spec.ts`) rather than a single mega-describe. Easier to spot which behavior failed during regressions.
- **Test pairs in byte-parity spec:** Selected 4 pairs (alice simple, john.doe@kinetica.com OIDC, zero-id case, auth0|pipe variant) — covers the 3 distinct sanitization branches (alphanumeric pass-through, dot→underscore, pipe→underscore) plus a boundary case (zero IDs).
- **Inline `sanitizeForViewName` as a private function** (not exported) — frontend file stays dependency-free; nobody outside the helper needs the sanitizer.
- **No `beforeEach` reset in spec** — Zustand reset shim (`kinetica_bi/__mocks__/zustand.ts`) auto-applies because the store file lives under `src/store/`. Confirmed via two consecutive initial-state assertions (`describe("useDynamicViewStore — initial state")`).

## Hand-off Pointers for Plan 33-03

Plan 33-03 will import these exports for lifecycle wiring at App.tsx UNAUTHORIZED + DashboardsPage.tsx DashboardOpen cleanup:

```typescript
// In App.tsx and DashboardsPage.tsx — DROP loop wiring
import { useDynamicViewStore } from "./store/dynamicViewStore";
import { dropDynamicView } from "./api/client";  // Plan 33-03 will add this helper

const views = useDynamicViewStore.getState().views;
for (const idStr of Object.keys(views)) {
  const id = Number(idStr);
  if (views[id]?.status === "materialized") {
    dropDynamicView(id).catch(() => {}); // fire-and-forget
  }
}
useDynamicViewStore.getState().reset();
```

The `views[id]?.status === "materialized"` guard skips pending/over_threshold/error entries (no live Kinetica view to drop). The `.catch(() => {})` follows the V13-P-12 lock — user is leaving session, errors not surfaceable.

## Hand-off Pointers for Phase 35

Phase 35 `AggregatedWidgetRenderer` / `RecordsTableRenderer` / `MapChartRenderer` will read entries via the per-id selector pattern (PITFALL C-02 scoping):

```typescript
const view = useDynamicViewStore((s) => s.views[widget.config.dynamicViewId]);
// Then branch on view?.status — "materialized" → FROM-swap, "over_threshold" → empty-state UI, etc.
```

The deterministic `viewName` from `buildDynamicViewName(...)` enables markPending → materialize → setView idempotency: if a re-materialize cycle is triggered by `filterVersion` bump, the SAME view name is reused (server `CREATE OR REPLACE MATERIALIZED VIEW` rewrites in place; WMS `_mv` cache-buster handles tile invalidation orthogonally).

## Self-Check: PASSED

- `kinetica_bi/src/lib/dynamicViewName.ts` — FOUND (46 lines)
- `kinetica_bi/src/lib/dynamicViewName.spec.ts` — FOUND (111 lines)
- `kinetica_bi/src/store/dynamicViewStore.ts` — FOUND (155 lines)
- `kinetica_bi/src/store/dynamicViewStore.spec.ts` — FOUND (231 lines)
- Commit `1664ca9` (test: helper RED) — FOUND
- Commit `6e1e948` (feat: helper GREEN) — FOUND
- Commit `2975472` (test: store RED) — FOUND
- Commit `7e1bb91` (feat: store GREEN) — FOUND
- `npx vitest run src/lib/dynamicViewName.spec.ts src/store/dynamicViewStore.spec.ts` — 24/24 passing
- `npx vitest run src/store/` — 129/129 passing (no regressions)
- `npx tsc --noEmit` — clean exit
