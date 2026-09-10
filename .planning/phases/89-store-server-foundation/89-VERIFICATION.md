---
phase: 89-store-server-foundation
verified: 2026-06-27T22:26:00Z
status: passed
score: 7/7 must-haves verified
gaps: []
---

# Phase 89: Store + Server Foundation — Verification Report

**Phase Goal:** filterCombinationStore exists as the 9th store wired into BOTH cleanup chains; keep-alive covers combination views; the server materialize endpoint accepts an optional combinationKey param — all additive, backward-compatible, no renderer wiring.
**Verified:** 2026-06-27T22:26:00Z
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | filterCombinationStore is a new zustand store (NOT a slice) with ref-counted registry (acquire/release, DROP-at-0), vizToHash, combinationVersion, and reset() | VERIFIED | `packages/web/src/store/filterCombinationStore.ts` — standalone `create<FilterCombinationState>` call, all 6 actions present |
| 2 | MAX_COMBINATION_VIEWS_PER_TABLE = 10 is exported from the store | VERIFIED | Line 34: `export const MAX_COMBINATION_VIEWS_PER_TABLE = 10;` |
| 3 | filterCombinationStore.getState().reset() is wired into App.tsx logout preceded by a snapshot-then-DROP loop | VERIFIED | Lines 137-145 of App.tsx: snapshot → for-loop with entry.viewName guard → dropCombinationView → reset() |
| 4 | filterCombinationStore.getState().reset() is wired into DashboardsPage.tsx dashboard-switch preceded by a snapshot-then-DROP loop | VERIFIED | Lines 533-542 of DashboardsPage.tsx: same pattern after useColumnDisplayConfigStore.getState().reset() |
| 5 | useViewKeepAlive touches live combination views (combinationKey subscription + c: liveKeys) | VERIFIED | Lines 81-86: primitive combinationKey subscription; lines 183-192: c:\${hash} liveKeys build; line 231: combinationKey in dep array |
| 6 | POST /api/filter/materialize threads combinationKey on BOTH table and dv paths; output byte-identical when absent | VERIFIED | index.ts lines 1156/1165/1216/1294: combinationKey? declared, destructured, passed to buildFilterViewName on both paths |
| 7 | DELETE /api/filter/materialize accepts ?viewName= for direct combination-view drop | VERIFIED | index.ts lines 1343-1345: directViewName branch before the existing dv/table branches |

**Score:** 7/7 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/web/src/store/filterCombinationStore.ts` | useFilterCombinationStore + CombinationEntry + MAX_COMBINATION_VIEWS_PER_TABLE + all actions | VERIFIED | 171 lines; exports all types, constant, and store; PITFALL S-02 lock comment present |
| `packages/web/src/store/filterCombinationStore.spec.ts` | 28 specs covering all behavior bullets | VERIFIED | 28/28 passing; covers fresh state, setEntry, markMaterializing, setVizHash, acquire/release, reference-stability, reset, MAX constant |
| `packages/web/src/api/client.ts` | dropCombinationView (DELETE by viewName, in-flight dedup) | VERIFIED | Lines 1003-1049: `dropCombinationView` exported, `inFlightDropCombo` Map, URL uses `&viewName=${encodeURIComponent(...)}` |
| `packages/web/src/App.tsx` | 9th-store snapshot-then-DROP + reset() in logout block | VERIFIED | Import present; snapshot + loop + reset at lines 137-145 |
| `packages/web/src/components/DashboardsPage.tsx` | 9th-store snapshot-then-DROP + reset() in dashboard-switch block | VERIFIED | Import present; snapshot + loop + reset at lines 533-542 |
| `packages/web/src/hooks/useViewKeepAlive.ts` | combinationKey primitive subscription + c:\${hash} liveKeys + dep array | VERIFIED | All three additions confirmed; existing f: and d: paths unchanged |
| `packages/server/src/lib/viewNaming.ts` | hashKey8 (exact djb2, NOT FNV-1a) + combinationKey? on FilterViewNameArgs + _c\<hash8\> suffix | VERIFIED | Lines 40-46: seed 5381, `(h<<5)+h`, XOR charCode, `>>>0`, padStart(8).slice(0,8); suffix appended AFTER _s\<session\> |
| `packages/server/tests/lib.viewNaming.spec.ts` | hashKey8 known-vector "3a777c0f" + absent-key regression lock + present-key suffix tests | VERIFIED | Lines 200-203: KNOWN-VECTOR asserts `hashKey8('table:7:status|eq|"East"') === "3a777c0f"`; 6 new tests added, 29/29 total green |
| `packages/server/src/index.ts` | combinationKey threaded on BOTH paths; DELETE ?viewName= direct-drop branch | VERIFIED | Lines 1156/1216/1294 (POST); lines 1339-1345 (DELETE first branch) |
| `packages/server/tests/routes.filter-materialize-combo.spec.ts` | Both-auth-mode supertests: absent byte-identity, present _c\<hash8\>, DELETE by viewName | VERIFIED | 7 tests: AUTH_MODE=password (4 tests) + AUTH_MODE=oidc (3 tests); imports and asserts against hashKey8 directly |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| App.tsx logout effect | useFilterCombinationStore.getState().reset() | snapshot registry then dropCombinationView loop then reset | VERIFIED | Pattern `useFilterCombinationStore` found at lines 24/139/145 of App.tsx |
| DashboardsPage.tsx unmount cleanup | useFilterCombinationStore.getState().reset() | snapshot registry then dropCombinationView loop then reset | VERIFIED | Pattern `useFilterCombinationStore` found at lines 55/536/542 of DashboardsPage.tsx |
| useViewKeepAlive re-sync effect | filterCombinationStore.registry entries | c:\${hash} liveKeys schedule; combinationKey in dep array | VERIFIED | `c:${hash}` at line 187; combinationKey in dep array at line 231 |
| POST /api/filter/materialize handler (both paths) | buildFilterViewName({ ..., combinationKey }) | combinationKey threaded on table path (line 1294) and dv path (line 1216) | VERIFIED | grep shows 3 occurrences: body type, dv path, table path |
| buildFilterViewName | hashKey8(combinationKey) | `_c${hashKey8(args.combinationKey)}` suffix appended after _s\<session\> when present | VERIFIED | viewNaming.ts line 130: `return \`${base}_c${hashKey8(args.combinationKey)}\`` |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| COMBO-V118-02 | 89-01 | Combination views ref-counted + dropped when unused + cleared on switch/logout + kept alive | SATISFIED | filterCombinationStore with acquire/release/DROP-at-0; both cleanup sites wired; useViewKeepAlive extended |
| COMBO-V118-03 | 89-01 | Number of combination views per table bounded by deploy-time constant (default ~10) | SATISFIED (value only) | MAX_COMBINATION_VIEWS_PER_TABLE = 10 exported; enforcement deferred to Phase 90 per plan design |
| COMBO-V118-04 | 89-02 | Default (accept-all) config rendering byte-identical to v1.17; server materialize additive | SATISFIED | hashKey8 djb2 recipe matches client comboShortHash byte-for-byte; absent combinationKey produces byte-identical output; regression-locked by both-auth-mode supertests |

---

### Anti-Patterns Found

None detected in phase 89 files. No TODOs/FIXMEs, no placeholder returns, no empty handlers, no hardcoded hex colors in component files.

---

### Test Gates

| Gate | Result |
|------|--------|
| `cd packages/web && npx tsc --noEmit` | PASS — clean |
| `npx vitest run src/store/filterCombinationStore.spec.ts` | PASS — 28/28 |
| `npx vitest run src/styles/theme-guard.spec.ts` | PASS — 128/128 |
| `cd packages/server && npx tsc --noEmit` | PASS — clean |
| `npx vitest run tests/lib.viewNaming.spec.ts tests/routes.filter-materialize-combo.spec.ts` | PASS — 36/36 |
| `npx vitest run tests/routes.filter-materialize.spec.ts tests/routes.filter-materialize-dv.spec.ts` | 4 tests fail (TTL=3 env contamination); PASS when run with DEFAULT_VIEW_TTL_MINUTES=5 (isolated) |

The 4 failures in the last row are environmental: `DEFAULT_VIEW_TTL_MINUTES` is set to 3 in this test runner, but the tests assert TTL=5. These failures pre-existed this phase (documented in 89-02-SUMMARY.md) and are part of the known TD-V16-TEST-ISOLATION set. They pass in isolation — confirmed by re-running with the correct env var. The combo tests introduced in Phase 89 do NOT assert TTL values and are unaffected.

---

### No-Side-Effect Checks

- **No renderer wiring:** grep of `WidgetRenderer.tsx` and `MapChartRenderer.tsx` confirms neither imports `filterCombinationStore`. Phase 89 commits touch none of these files.
- **No new web deps:** `packages/web/package.json` unchanged in Phase 89 commits.
- **No new server deps:** `packages/server/package.json` unchanged.
- **No new SQLite table:** No migration or schema change in `packages/server/src/db.ts`.
- **Zero web diff in 89-02:** Phase 89-02 server commits introduced no changes to `packages/web/`.

---

### Cross-Stack Hash Contract Verification

The known-vector test in `lib.viewNaming.spec.ts` asserts:

```
hashKey8('table:7:status|eq|"East"') === "3a777c0f"
```

The client `comboShortHash` in `stableComboHash.ts` uses the identical djb2 algorithm (seed 5381, `(h<<5)+h`, XOR charCode, `>>>0`, padStart(8).slice(0,8)). The server `hashKey8` is a verbatim port. Both produce the same 8-char hex for the same input — the COMBO-V118-04 cross-stack contract is locked.

---

## Gaps Summary

No gaps. All 7 observable truths verified, all artifacts substantive and wired, all key links confirmed, all three requirements satisfied, no blocker anti-patterns.

---

_Verified: 2026-06-27T22:26:00Z_
_Verifier: Claude (gsd-verifier)_
