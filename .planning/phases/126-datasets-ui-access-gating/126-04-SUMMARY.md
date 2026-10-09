---
phase: 126-datasets-ui-access-gating
plan: 04
subsystem: web-schema-sync-ui
tags: [schema-sync, rbac, absence-gate, permissions, mutation-probes, tdd, test-helper]
requires:
  - "126-01 — checkTableSchema / listTableSyncHistory and the schema-sync DTOs"
  - "126-02 — SchemaSyncModal.tsx and its { table, onClose } props (Decision B)"
  - "126-03 — the sync-history tab on the same modal"
provides:
  - "packages/web/src/components/DatasetsPage.tsx :: canSchemaSync — the datasets:manage AND dashboards:manage_access absence gate, and the Schema sync entry point in TableDetail"
  - "packages/web/src/test/seedAuthStore.ts :: seedPermissionsStore(permissions) — the arbitrary-permission-set seeder, now the single tree-wide definition"
  - "GATE-both / GATE-neither / GATE-datasets-only / GATE-access-only / GATE-ungated-siblings — a four-combination absence probe where EVERY negative case asserts an ungated sibling is present"
affects:
  - "126-05 — owns the ROADMAP/REQUIREMENTS updates and the operator checkpoint; Decision B and two unprovable items below are on its script"
tech-stack:
  added: []
  patterns:
    - "client-side AND-gate mirroring a server route's own requirePermission spread, hidden not disabled"
    - "negative gate tests carry an ungated-sibling assertion so a null result cannot mean 'nothing rendered'"
    - "a TableDetail-only chrome anchor ('Created') as a render-reached proof independent of the actions bar"
key-files:
  created:
    - packages/web/src/components/DatasetsPage.schemasync.spec.tsx
  modified:
    - packages/web/src/components/DatasetsPage.tsx
    - packages/web/src/test/seedAuthStore.ts
    - packages/web/src/components/DashboardsPage.exportimport.spec.tsx
decisions:
  - "Decision B upheld — the entry point is TableDetail's actions bar, third ghost-sm, between Custom metrics and Back. One line to move to the list row if the operator disagrees; it is on plan 05's checkpoint."
  - "Decision C executed — seedPermissions promoted to seedPermissionsStore in seedAuthStore.ts; the spec-local copy AND its now-dead useAuthStore import deleted. One definition tree-wide."
  - "Permission seeding happens at the TOP OF THE TEST BODY, not in beforeEach: four tests need four different permission sets, and the test body is the position the working precedent (DashboardsPage.exportimport.spec.tsx) uses. The real constraint from seedAuthStore.ts:1-10 — 'after the zustand reset shim' — is satisfied identically either way."
  - "A ninth probe (P9) was added beyond the plan's eight: nothing in P1-P8 could redden ENTRY-closes, so that test was undiscriminated until P9 proved it."
metrics:
  duration: "~40 min"
  completed: 2026-09-28
  tasks: 3
  commits: 3
---

# Phase 126 Plan 04: The Datasets entry point and its AND-gate Summary

One `Schema sync` button in `TableDetail`'s actions bar, rendered only for a user holding
**both** `datasets:manage` and `dashboards:manage_access` — the same AND all four server routes
spread — and **absent**, not disabled, for anyone else. Plus the one test helper this phase needed,
promoted rather than copy-pasted.

## What shipped

| File | Δ | What |
|---|---|---|
| `packages/web/src/components/DatasetsPage.tsx` | 511 → 538 (+27/−0) | `canSchemaSync`, `showSchemaSync`, the third `ghost-sm`, the `SchemaSyncModal` mount |
| `packages/web/src/components/DatasetsPage.schemasync.spec.tsx` | **new**, 200 lines | 8 tests: 5 `GATE-`, 2 `ENTRY-`, 1 `NOPOLL-` |
| `packages/web/src/test/seedAuthStore.ts` | 96 → 110 (+14) | `seedPermissionsStore(permissions)` |
| `packages/web/src/components/DashboardsPage.exportimport.spec.tsx` | 278 → 268 (−10) | local helper + dead `useAuthStore` import deleted, 2 call sites re-pointed |

**No new component `.css`** — this plan added no CSS at all. theme-guard held at **154**.
`packages/server`: **zero diff**, as in every plan of this milestone.

### The gate

```tsx
const hasPermission = useAuthStore((s) => s.hasPermission);
// v1.25 Phase 126 (SSYNC-V125-19): mirrors all four schema-sync routes' OWN gate exactly —
// index.ts:2500-2501, :2577-2578, :2664-2665, :2682-2683 each spread
// requirePermission(DATASETS_MANAGE) AND requirePermission(DASHBOARDS_MANAGE_ACCESS). An AND,
// so the control is HIDDEN rather than offered to someone the server will refuse with a 403.
// The second permission is deliberate (Phase 124 RBAC widening), not an accident to paper over.
// ABSENT, not disabled: a disabled button still tells an unauthorised user the feature exists.
const canSchemaSync =
  hasPermission(PERMISSIONS.DATASETS_MANAGE) &&
  hasPermission(PERMISSIONS.DASHBOARDS_MANAGE_ACCESS);
```

`useAuthStore` was **already imported** by `DatasetsPage.tsx` (`:13`, used at `:105` for the
401 guard); only `PERMISSIONS` and `SchemaSyncModal` are new imports. `TableDetail` is an inner
component of the same file, so it reads the store directly — no prop drilling, exactly as planned.

Nothing else on the page changed. `Format columns`, `Custom metrics`, `Back`, `View`, `Edit`,
`Delete` are all still ungated, and the reactive `Permission denied` render from a server 403
(`:171-174`, `:431-434`) is byte-untouched and remains the backstop.

The modal mount is guarded on `showSchemaSync` alone — `canSchemaSync` already gated the only
control that can set it — mirroring how the two pre-existing per-table modals are mounted.

## Why every negative test carries a sibling assertion

`expect(queryByRole(…)).toBeNull()` passes just as happily when the component threw, when the list
never loaded, or when `TableDetail` never mounted. So each negative case asserts, **first**, that
the ungated sibling `Format columns` IS in the document — proving the render reached the very
actions bar the schema-sync button would have appeared in.

The tests are layered with three independent render-reached proofs before the absence assertion:

1. `await screen.findByRole("button", { name: "View" })` — the list loaded.
2. `await screen.findByText("Created")` — a `ds-detail-label` **only `TableDetail` renders**, so
   it is a detail-mounted proof that does not depend on the actions bar at all.
3. `expect(getByRole("button", /format columns/i)).toBeInTheDocument()` — the actions bar rendered.

This is deliberately stronger than the precedent. `DashboardsPage.exportimport.spec.tsx` has a
sibling assertion in **only one** of its three negative cases (`:202`); the other two (`:195`,
`:210`) rely solely on `await findByText(dashboard.name)`, which proves the *list* rendered, not
the actions bar. Those were **not** weakened-to-match and were **not** touched.

## Tests — 8 new, in a new file

| Test id | Proves |
|---|---|
| `GATE-both` | both permissions → the `Schema sync` button resolves |
| `GATE-neither` | `[]` → button **null**, `Format columns` present |
| `GATE-datasets-only` | `[DATASETS_MANAGE]` → button **null**, `Format columns` present |
| `GATE-access-only` | `[DASHBOARDS_MANAGE_ACCESS]` → button **null**, `Format columns` present |
| `GATE-ungated-siblings` | with `[]`, `Format columns` **and** `Custom metrics` **and** `Back` are all present — the `<danger>` constraint as an executable assertion |
| `ENTRY-opens-modal` | stub absent before the click; after it, present, and `__lastSchemaSyncProps.table.id === 71`, `.name === "table_alpha"`, `onClose` is a function |
| `ENTRY-closes` | invoking the captured `onClose` removes the stub |
| `NOPOLL-datasets-page` | rendering Datasets and navigating to `TableDetail` calls `checkTableSchema` **0** times — and `listTableSyncHistory` 0 times too (added beyond the plan; same one-line cost, one more route covered) |

Fixture is neutral and synthetic: `table_alpha` / `schema_alpha` / `col_alpha`, `col_beta`, id `71`.
No dataset-specific names.

TDD order was observed. The spec was committed **RED** (`5b8040c`, **4 failed / 4 passed**) before
the implementation (`431c82d`). The four that passed in the RED commit are the negatives and
`GATE-ungated-siblings` — they pass by construction because no button existed yet. **That is
precisely why probes P1–P6 exist**; their discriminating power is supplied there, not by a
fail-before. This is the same class of result as 126-03's `NOPOLL-no-history-on-mount`.

## Mutation probes — 9 probes, 9/9 fired, first attempt, no test strengthened

Every mutation was applied to **committed** source, its presence on disk confirmed with
`git diff --stat` **before** the suite ran, then reverted with `git checkout --` and
`git diff --exit-code -- packages/web/src` confirmed clean before the next.

| # | Mutation | On-disk | Required to redden | **Actually reddened** | Count |
|---|---|---|---|---|---|
| P1 | `canSchemaSync`: `&&` → `\|\|` | `1 +, 1 −` | `GATE-datasets-only` AND `GATE-access-only` | exactly those two | 2 failed / 6 passed |
| P2 | button rendered unconditionally (`canSchemaSync &&` guard dropped) | `3 +, 5 −` | `GATE-neither` | `GATE-neither`, `GATE-datasets-only`, `GATE-access-only` (superset) | 3 / 5 |
| P3 | `disabled={!canSchemaSync}` instead of conditional render | `3 +, 5 −` | all three negatives | `GATE-neither`, `GATE-datasets-only`, `GATE-access-only` | 3 / 5 |
| **P4** | `canSchemaSync &&` added to the **`Format columns`** button | `5 +, 3 −` | `GATE-ungated-siblings` **and** `DatasetsPage.spec.tsx` | see below | **9 / 5** across 2 files |
| P5 | `canSchemaSync = hasPermission(DATASETS_MANAGE)` only | `1 +, 3 −` | `GATE-datasets-only` | `GATE-datasets-only` | 1 / 7 |
| P6 | `canSchemaSync = hasPermission(DASHBOARDS_MANAGE_ACCESS)` only | `1 +, 3 −` | `GATE-access-only` | `GATE-access-only` | 1 / 7 |
| P7 | `<SchemaSyncModal table={{ ...table, id: 0 }} …>` | `1 +, 1 −` | `ENTRY-opens-modal` | `ENTRY-opens-modal` | 1 / 7 |
| P8 | `useEffect(() => { void checkTableSchema(table.id); }, [table.id])` in `TableDetail` | `2 +` | `NOPOLL-datasets-page` | `NOPOLL-datasets-page` | 1 / 7 |
| P9 | `onClose={() => {}}` — added beyond the plan | `1 +, 1 −` | `ENTRY-closes` | `ENTRY-closes` | 1 / 7 |

### P4 — the `<danger>` constraint, measured

Gating `Format columns` on `canSchemaSync` reddened:

- **4 tests in `DatasetsPage.schemasync.spec.tsx`** — `GATE-ungated-siblings` (as required) plus
  all three negatives, whose sibling assertions are the ones that now fail. That is the sibling
  assertion doing exactly the job it was written for.
- **5 of the 6 tests in the untouched `DatasetsPage.spec.tsx`** — `renders a 'Format columns'
  button`, `clicking 'Format columns' renders ColumnFormatEditorModal`, the two prop tests, and
  `calling onClose hides the modal`.

**Correction to the plan's own expectation, recorded rather than rounded up.** The plan (and the
`<danger>` block) predicted **6**. The actual is **5**. The survivor is
`does NOT render ColumnFormatEditorModal before the button is clicked`, which asserts the modal
stub is *absent* — and it stays absent when the button that opens it is gated away. It passes for
the wrong reason, which is the same defect class this plan's sibling assertions exist to prevent,
in a spec this plan is forbidden to touch. **Flagged for 126-05, not fixed here.**

### P9 — added because a test was undiscriminated

Nothing in P1–P8 could redden `ENTRY-closes`: P2/P3 change the button, P7 changes the `table` prop,
and none of them touch the `onClose` wiring. `ENTRY-closes` was therefore a guard with no proof
that it could fail. P9 (`onClose={() => {}}`) reddened it, 1 / 7. Same reflex as 126-03's P8b, and
the same CLAUDE.md rule: a guard that cannot fail manufactures confidence.

### One procedural NON-RESULT, recorded

The first attempt at P1–P3 was run from a shell loop whose `cd packages/web` / `cd ..` left the
working directory at `packages/`, so P1's `git checkout --` failed with `pathspec … did not match`
while the subsequent `git diff --exit-code -- packages/web/src` — evaluated from the wrong
directory, where that path matches nothing — **returned 0 and printed "reverted clean"**. P2 was
then skipped entirely. The revert check itself was the thing that lied. All three were re-run from
a cwd-safe script with every git command in its own `(cd $REPO && …)` subshell; the results in the
table are from that second run. **The lesson is narrower than 125-04's:** a clean-tree assertion
evaluated in the wrong directory is not a weak check, it is an inverted one.

## Acceptance criteria — every one RUN, before and after

Before-values were measured at `HEAD` immediately before any work; `DatasetsPage.tsx`,
`DatasetsPage.spec.tsx` and `DatasetsPage.urlsync.spec.tsx` were all at zero diff from `2ccb8c5`
at that point, so HEAD and `2ccb8c5` agree for every criterion below.

### Task 1

| # | Command (repo root) | Before | Required | **Actual after** | Verdict |
|---|---|---|---|---|---|
| 1 | `grep -rF 'seedPermissionsStore' packages/web/src \| wc -l` | **0** | ≥ 3 | **4** | PASS |
| 2 | `grep -rF 'seedPermissions' packages/web/src \| wc -l` | **4** | — | **4** | informational |
| 3 | `grep -c 'const seedPermissions =' …/DashboardsPage.exportimport.spec.tsx` | **1** | **0** | **0** | PASS |
| 4 | `grep -rc 'export function seedPermissionsStore' …/test/seedAuthStore.ts` | **0** | **1** | **1** | PASS |
| — | `npx vitest run …/DashboardsPage.exportimport.spec.tsx` | **13 passed** | same count | **13 passed** | PASS |

### Task 2

| # | Command (repo root) | Before | Required | **Actual after** | Verdict |
|---|---|---|---|---|---|
| 1 | `grep -rF 'canSchemaSync' packages/web/src \| wc -l` | **0** | ≥ 2 | **2** | PASS |
| 2 | `grep -rF 'GATE-datasets-only' packages/web/src \| wc -l` | **0** | ≥ 1 | **2** | PASS |
| 3 | `grep -rF 'GATE-access-only' packages/web/src \| wc -l` | **0** | ≥ 1 | **2** | PASS |
| 4 | `grep -rF 'GATE-neither' packages/web/src \| wc -l` | **0** | ≥ 1 | **2** | PASS |
| 5 | `grep -rF 'GATE-both' packages/web/src \| wc -l` | **0** | ≥ 1 | **1** | PASS |
| 6 | `grep -rF 'GATE-ungated-siblings' packages/web/src \| wc -l` | **0** | ≥ 1 | **2** | PASS |
| 7 | `grep -cF 'SchemaSyncModal' …/DatasetsPage.tsx` | **0** | ≥ 2 | **2** | PASS |
| 8 | `git diff --name-only 2ccb8c5 \| grep -c 'DatasetsPage.spec.tsx'` | 0 | **0** | **0** | PASS |
| 9 | `git diff --name-only 2ccb8c5 \| grep -c 'DatasetsPage.urlsync.spec.tsx'` | 0 | **0** | **0** | PASS |
| 10 | `git diff --name-only 2ccb8c5 \| grep -c '^packages/server/'` | **0** | **0** | **0** | PASS |

**"Absent, not disabled" — anchored to ADDED lines only:**

```
git diff --unified=0 2ccb8c5 -- packages/web/src/components/DatasetsPage.tsx \
  | grep '^+[^+]' | grep -cE 'disabled=|title="You'
```
→ **0**. PASS. The discriminating proof is P3: rendering the button `disabled={!canSchemaSync}`
reddened all three negatives, because `queryByRole` finds a disabled button.

**Regression guard, measured:** `DatasetsPage.spec.tsx` **6 before → 6 after**;
`DatasetsPage.urlsync.spec.tsx` **17 before → 17 after**.

### `DatasetsPage.urlsync.spec.tsx` — confirmed, not assumed

It seeds `seedDesignerStore`, which grants **both** permissions (`seedAuthStore.ts:35-36`), so the
new `Schema sync` button **does** render inside its `TableDetail`. Confirmed benign by execution,
not by reading: **17 passed before, 17 passed after**, and the file is byte-unchanged from
`2ccb8c5` (criterion 9 = 0). Its `...actual` partial mock resolves the new `SchemaSyncModal`
import graph, and it makes no button-count assertions.

## Criteria that could not discriminate — reported, not quietly passed

1. **Criteria 8, 9 and 10 (`git diff --name-only … | grep -c` = 0).** All three read 0 before and
   0 after, by construction. They prove "nothing was broken", never "something was built". Kept —
   they are the only mechanical guards on the byte-untouched and ZERO-server-diff budgets — but
   they are not evidence of work. This is the fourth plan running that the server-diff one has been
   flagged; a planner note, not a defect.
2. **The "absent, not disabled" grep.** A prohibition on code that does not exist, so it cannot
   fail-before. It is correctly diff-anchored to added lines (a whole-file grep over 511
   pre-existing lines could not have discriminated at all), and its real discriminating proof is
   probe P3, which fired.
3. **Criterion 2 of task 1** (`grep -rF 'seedPermissions'` = 4) was already labelled non-usable in
   the plan itself and is reported as informational; criterion 1 uses the new name, which read 0.
4. **`ENTRY-closes` was an undiscriminated test** until P9 was added. Not a criterion defect — a
   test defect, caught by asking which probe covers it. Recorded above.

No criterion was found to be structurally broken in a way that required verifying the requirement
by another route.

## Gates

| Gate | Baseline (plan 03) | **Result** |
|---|---|---|
| `cd packages/web && npx tsc --noEmit` | clean | **clean (exit 0)** |
| `cd packages/web && npx vitest run` | 184 files / 4142 tests | **185 files / 4150 tests passed, 0 failed** (+1 file, +8 tests) |
| `npx vitest run src/styles/theme-guard.spec.ts` | 154 | **154 passed (154)** — UNCHANGED, not 156 |
| `git diff --exit-code -- packages/web/src` after probes | — | **exit 0**, `git status --short` empty |
| `git diff --name-only 2ccb8c5 \| grep -c '^packages/server/'` | 0 | **0** |

## Deviations from Plan

**None affecting behaviour.** No auto-fix rule was invoked, no auth gate was hit, no architectural
decision arose. Five recorded judgements:

1. **The dead `useAuthStore` import in `DashboardsPage.exportimport.spec.tsx` was removed** along
   with the local helper — it was used at exactly one site, inside the deleted function. `tsc` does
   not run `noUnusedLocals`, so leaving it would have compiled; removing it is the honest end of
   the move. No test body, assertion or fixture was touched.
2. **The plan said "update its three call sites"; there are two** (`:203`, `:211` pre-edit). The
   third occurrence was the definition itself. No behavioural consequence.
3. **Seeding is at the top of each test body, not in `beforeEach`** — four tests need four
   different permission sets, so a shared `beforeEach` cannot express them. This is the position
   the working precedent uses and its own comment recommends; the ordering constraint the plan
   cited (`seedAuthStore.ts:1-10`, "after the zustand reset shim") is satisfied identically.
4. **`NOPOLL-datasets-page` also asserts `listTableSyncHistory` is called 0 times**, beyond the
   plan's `checkTableSchema`. One extra line, one more route covered.
5. **Probe P9 added** beyond the plan's eight, because `ENTRY-closes` was otherwise undiscriminated.

## For plan 05

1. **Decision B is live and is a one-line move.** The `Schema sync` button sits in `TableDetail`'s
   actions bar, third of four, between `Custom metrics` and `Back`. It is reached via the row's
   `View` button — one entry point per table, but **inside** the detail view rather than on the
   list row. CONTEXT's prose says "one entry point per Datasets row"; its only file:line citations
   (`:279`/`:285`) are inside `TableDetail`. **Put this in front of the operator.** Moving it to
   the list row needs no CSS change: `.ds-actions` is the `auto` track of
   `grid-template-columns: 2fr 1fr 1fr 1.5fr auto` (`global.css:914-921`) and is a nowrap flex row.
2. **Not automatically verifiable, stated rather than dressed in a grep:** that the button reads as
   a peer of `Format columns` / `Custom metrics` rather than as a mismatched-height outlier. It
   uses `ghost-sm`, byte-identical to its two neighbours, so the structural precondition holds —
   but "reads as a peer" is a human check.
3. **`DatasetsPage.spec.tsx` carries a test that passes for the wrong reason** —
   `does NOT render ColumnFormatEditorModal before the button is clicked` survived probe P4 (which
   gated `Format columns` away entirely) because it only asserts the modal stub is absent. This
   plan was forbidden to touch that file. Worth a line in `deferred-items.md` or a future plan.
4. **`SSYNC-V125-19`'s amendment and all ROADMAP/REQUIREMENTS updates are untouched** and remain
   126-05's exclusively, as instructed.
5. **Gate numbers to carry forward:** web suite **185 files / 4150 tests**, theme-guard **154**,
   `packages/server` diff **0**.

## Commits

| Hash | Message |
|---|---|
| `06d0b04` | `refactor(126-04): promote seedPermissionsStore into the shared test helper` |
| `5b8040c` | `test(126-04): add failing GATE-/ENTRY-/NOPOLL- specs for the schema-sync gate` |
| `431c82d` | `feat(126-04): gate the Schema sync entry point on datasets:manage AND dashboards:manage_access` |

Task 3 produced **no commit by design** — all nine mutations were reverted and no test needed
strengthening, so there was nothing to commit.

## Self-Check: PASSED

- `packages/web/src/components/DatasetsPage.schemasync.spec.tsx` — FOUND (200 lines, 8 tests)
- `packages/web/src/components/DatasetsPage.tsx` — MODIFIED (538 lines; `canSchemaSync` present)
- `packages/web/src/test/seedAuthStore.ts` — MODIFIED (110 lines; `seedPermissionsStore` exported once)
- `packages/web/src/components/DashboardsPage.exportimport.spec.tsx` — MODIFIED (268 lines, 13 tests, green)
- `packages/web/src/components/DatasetsPage.schemasync.css` — **correctly absent** (none created)
- commits `06d0b04`, `5b8040c`, `431c82d` — all FOUND
- `git diff --exit-code -- packages/web/src` — exit 0, no probe residue
- `git status --short` — clean apart from this untracked SUMMARY

**Not touched, by instruction:** `.planning/ROADMAP.md`, `.planning/REQUIREMENTS.md`,
`.planning/STATE.md`. No `gsd-tools` mutation command was run.
