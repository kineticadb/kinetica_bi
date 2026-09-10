---
phase: 89-store-server-foundation
plan: "02"
subsystem: filter-materialize
tags: [server-only, viewNaming, combinationKey, djb2, hash, COMBO-V118-04, v1.18]
dependency_graph:
  requires:
    - hashKey8 client-side comboShortHash recipe (packages/web/src/lib/stableComboHash.ts — Phase 88)
  provides:
    - hashKey8 (packages/server/src/lib/viewNaming.ts) — server-side djb2, byte-identical to client comboShortHash
    - combinationKey? on FilterViewNameArgs + _c<hash8> suffix in buildFilterViewName
    - POST /api/filter/materialize accepts optional combinationKey body param (both table + dv paths)
    - DELETE /api/filter/materialize accepts ?viewName= for direct combination-view drop
  affects:
    - packages/server/src/lib/viewNaming.ts (extended)
    - packages/server/src/index.ts (POST + DELETE handlers extended)
tech_stack:
  added: []
  patterns:
    - djb2 non-cryptographic 8-char hash (cross-stack parity with client comboShortHash)
    - optional param backward-compat extension (byte-identical when absent)
    - both-auth-mode supertest pattern (mirrors routes.filter-materialize-dv.spec.ts)
key_files:
  created:
    - packages/server/tests/routes.filter-materialize-combo.spec.ts
  modified:
    - packages/server/src/lib/viewNaming.ts
    - packages/server/tests/lib.viewNaming.spec.ts
    - packages/server/src/index.ts
decisions:
  - "hashKey8 uses djb2 (seed 5381, (h<<5)+h, XOR charCode, >>>0, padStart 8) — NOT FNV-1a; byte-identical to Phase-88 client comboShortHash (COMBO-V118-04 cross-stack contract)"
  - "_c<hash8> suffix appended AFTER _s<session> segment per ARCHITECTURE.md — not between _t<tableId> and _s"
  - "combinationKey absent / empty string → byte-identical v1.17 output (backward-compat regression-locked)"
  - "DELETE ?viewName= direct-drop: uses value verbatim; same DROP TABLE IF EXISTS path as existing dv/table branches — no new injection surface"
metrics:
  duration_seconds: 340
  completed_date: "2026-06-27"
  tasks_completed: 2
  files_created: 1
  files_modified: 3
---

# Phase 89 Plan 02: Server — viewNaming hashKey8 + combinationKey Endpoint Summary

**One-liner:** Server-side djb2 hashKey8 + optional combinationKey on POST /api/filter/materialize (both table + dv paths) + ?viewName= on DELETE — byte-identical to v1.17 when absent (COMBO-V118-04 server half).

## What Was Built

Server-only changes in `packages/server/` (zero web diff). Two task commits.

### Task 1: hashKey8 + combinationKey in viewNaming.ts (TDD)

**`packages/server/src/lib/viewNaming.ts`** — extended with:

```typescript
export function hashKey8(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h) ^ s.charCodeAt(i);
  }
  return (h >>> 0).toString(16).padStart(8, "0").slice(0, 8);
}
```

This is the EXACT Phase-88 djb2 recipe from `comboShortHash` in `stableComboHash.ts`. The doc comment cites the COMBO-V118-04 cross-stack contract. Known-vector: `hashKey8('table:7:status|eq|"East"') === "3a777c0f"`.

`FilterViewNameArgs` gains `combinationKey?: string`. `buildFilterViewName` appends `_c${hashKey8(combinationKey)}` after the `_s<session>` segment when `combinationKey` is present and non-empty. When absent (or empty string), output is byte-identical to v1.17.

Name shapes:
- `_kbi_filt_u<user>_d<dashId>_t<tableId>_s<session>` (no combo — unchanged)
- `_kbi_filt_u<user>_d<dashId>_t<tableId>_s<session>_c<hash8>` (combo present)
- `_kbi_filt_u<user>_d<dashId>_dv<dvId>_s<session>_c<hash8>` (dv path, combo present)

**`packages/server/tests/lib.viewNaming.spec.ts`** — added:
- `describe("hashKey8 ...")`: determinism, 8-hex-length, KNOWN-VECTOR `"3a777c0f"` assertion
- `describe("buildFilterViewName with combinationKey ...")`: absent-key regression locks (both table + dv), present-key suffix (table + dv), empty-string no-suffix, worst-case length < 200

All 29 tests green (23 pre-existing + 6 new).

### Task 2: Thread combinationKey through index.ts + both-auth-mode supertests

**`packages/server/src/index.ts`** — two surgical changes:

1. **POST /api/filter/materialize** body type gains `combinationKey?: string;`. Destructured and threaded into `buildFilterViewName` on BOTH paths:
   - dv path (line ~1216): `buildFilterViewName({ ..., dynamicViewId, combinationKey })`
   - table path (line ~1294): `buildFilterViewName({ ..., tableId, combinationKey })`

2. **DELETE /api/filter/materialize** gains a first branch before the existing dv/table branches:
   ```typescript
   const directViewName = req.query.viewName;
   if (typeof directViewName === "string" && directViewName !== "") {
     viewName = directViewName;
   } else if (dynamicViewId ...) {
     // existing dv path unchanged
   } else {
     // existing table path unchanged
   }
   ```
   The shared `DROP TABLE IF EXISTS ${viewName}` path handles all three branches.

**`packages/server/tests/routes.filter-materialize-combo.spec.ts`** (new) — both-auth-mode supertest mirroring `routes.filter-materialize-dv.spec.ts`:
- `AUTH_MODE=password` describe: absent-key byte-identity regex, present-key table + dv suffix equality against `hashKey8(COMBO_KEY)`, DELETE-by-viewName exact DROP statement
- `AUTH_MODE=oidc` describe: same pattern with oidc session + Bearer auth verification

7 tests, all green.

## Decisions Made

1. **hashKey8 uses djb2, not FNV-1a** — ARCHITECTURE.md mentions FNV-1a in one place but the Phase-88 SUMMARY.md and plan interfaces block are unambiguous: the exact same algorithm as `comboShortHash` must be used. Byte-for-byte parity is the COMBO-V118-04 correctness gate.

2. **`_c<hash8>` suffix AFTER `_s<session>`** — ARCHITECTURE.md §"buildFilterViewName extension" is the authoritative shape: `_kbi_filt_u<user>_d<dashId>_t<tableId>_s<session>_c<hash8>`. Not between `_t` and `_s`.

3. **`combinationKey` absent / empty string → byte-identical** — Empty string explicitly guarded (`!== ""`) so callers sending `combinationKey: ""` get the same v1.17 output as callers omitting the field entirely.

4. **DELETE `?viewName=` first branch** — Client already knows the exact combination view name (predicted locally). Direct drop avoids re-deriving from tableId which may not be available in the cleanup loop. Uses the same `kineticaSqlHelper` DROP path as existing branches — no new injection surface.

## Test Gates

| Gate | Result |
|------|--------|
| `cd packages/server && npx tsc --noEmit` | PASS — clean |
| `npx vitest run tests/lib.viewNaming.spec.ts` | PASS — 29/29 |
| `npx vitest run tests/routes.filter-materialize-combo.spec.ts` | PASS — 7/7 (both auth modes) |
| `git diff --name-only packages/web` | Pre-existing 89-01 working-tree change only; this plan introduced zero web changes |

Pre-existing failures in `routes.filter-materialize.spec.ts` (3 tests) and `routes.filter-materialize-dv.spec.ts` (1 test) are environmental: `DEFAULT_VIEW_TTL_MINUTES` is set to 3 in this test runner, and those tests assert TTL=5. These failures existed before this plan (confirmed via git stash round-trip) and are unrelated to combinationKey changes.

## Deviations from Plan

None — plan executed exactly as written.

The `toEndWith` Chai matcher does not exist in Vitest — replaced with `(string as string).endsWith(...)` assertion (Rule 1 auto-fix, no behavior change). The `not.toContain("_c")` check in the oidc absent-key test was replaced by a tighter anchored regex (the sanitized username `admin_kinetica_com` contains the literal `_c` substring, causing a false failure).

## Self-Check: PASSED
