---
phase: 126-datasets-ui-access-gating
plan: 03
subsystem: web-schema-sync-ui
tags: [schema-sync, sync-history, tabs, css-tokens, mutation-probes, tdd]
requires:
  - "126-01 — listTableSyncHistory / deleteTableSyncHistoryEntry and the TableSyncHistory DTOs"
  - "126-02 — SchemaSyncModal.tsx, ImpactReportView, the .schema-sync-* / .impact-* rules, CLASSNAME-RESOLVES"
provides:
  - "packages/web/src/components/SchemaSyncModal.tsx :: the sync-history tab (tab bar, row list, expand, delete, cap notice)"
  - "packages/web/src/styles/global.css :: 6 more .schema-sync-* rules (tabs, tab-active, cap-notice, history-row, history-meta, history-detail)"
  - "HIST-order-as-given — a DOM-order guard proving the server's id DESC ordering is not re-sorted client-side"
affects:
  - "126-04 — mounts this modal from DatasetsPage behind the datasets:manage AND dashboards:manage_access absence gate"
  - "126-05 — the operator checkpoint reads history live; three items below are routed to it"
tech-stack:
  added: []
  patterns:
    - "tab selection as a SIBLING useState, deliberately outside the Stage discriminated union, so the impact report survives a tab switch"
    - "server-echoed cap interpolated, never hardcoded; droppedCount never recomputed client-side"
    - "one-click destructive action with no confirm(), guarded by a test that stubs confirm to FALSE"
key-files:
  created: []
  modified:
    - packages/web/src/components/SchemaSyncModal.tsx
    - packages/web/src/components/SchemaSyncModal.spec.tsx
    - packages/web/src/styles/global.css
decisions:
  - "The tab is a sibling useState<\"check\" | \"history\">, NOT a Stage arm — 126-02's finding 1/2, proven by TABS-report-survives-switch."
  - "loadHistory() runs on the history-tab click and, additionally, after an apply resolves outcome === \"applied\". Never on mount, never on a timer."
  - "removeEntry filters local state rather than re-calling loadHistory: re-calling would re-render the deleted row from the unchanged server fixture and hide the bug the test is for."
  - "The cap notice string is built by concatenation, not JSX text interpolation, so a line wrap cannot silently eat the space between a literal and an expression."
  - "P8 required TWO rounds of test strengthening; the first HIST-order-as-given still could not fire. Recorded in full below — it is the most instructive result in this plan."
metrics:
  duration: "~55 min"
  completed: 2026-09-28
  tasks: 2
  commits: 5
---

# Phase 126 Plan 03: Sync history — the durable worklist Summary

The history half of the schema-sync modal: a tab bar that reaches history **without a check having
run**, rows stating when/who/what, in-place expansion to the full changeset and the report as it
stood, one-click delete with no dialog, and a cap notice that states the number the **server**
echoed.

## What shipped

| File | Δ | What |
|---|---|---|
| `packages/web/src/components/SchemaSyncModal.tsx` | 300 → 507 (+229/−11) | tab bar, `loadHistory`, `removeEntry`, `historyRow`, `historyBody`, `ChangesetView`/`ChangesetGroup`, `entryCounts` |
| `packages/web/src/components/SchemaSyncModal.spec.tsx` | 511 → 801 (+290) | 13 new tests (12 in task 1, `HIST-order-as-given` added in task 2) |
| `packages/web/src/styles/global.css` | 5147 → 5205 (+58) | 6 new rules, token-only |

**No `SchemaSyncModal.css`** — theme-guard held at **154**, not 156.

### The shape, and why it is that shape

```ts
const [stage, setStage]  = useState<Stage>({ k: "idle" });          // unchanged, plan 02's
const [tab, setTab]      = useState<"check" | "history">("check");  // SIBLING, not a Stage arm
const [history, setHistory]           = useState<TableSyncHistory | null>(null);
const [historyError, setHistoryError] = useState<string | null>(null);
const [expanded, setExpanded]         = useState<number | null>(null);
```

126-02's finding 1 was followed exactly. Every `Stage` arm carries a check/apply payload; a history
tab carries none, so folding it in would have destroyed the impact report on every tab click.
`TABS-report-survives-switch` is the named test that proves it: run a check, read the history, come
back — `col_alpha` is still on screen and `checkTableSchema` has still been called exactly **once**.

`listTableSyncHistory` is reachable from precisely two places: the `Sync history` tab's `onClick`,
and `runApply` after `result.outcome === "applied"` resolves. **No `useEffect`, no timer.**
`NOPOLL-no-history-on-mount` is the twin 126-02's finding 4 asked for — without it, a mount-effect
history fetch would have broken ROADMAP criterion 2's spirit with nothing to catch it.

### Two small implementation judgements

1. **`removeEntry` filters local state** rather than re-calling `loadHistory()`. The plan permitted
   either. Filtering is the honest one under test: a re-fetch would return the same fixture and put
   the deleted row straight back, so `HIST-delete`'s "the row disappears" arm would be asserting
   against the mock rather than against the code. `droppedCount` is **not** recomputed — the
   server's non-decrement (`index.ts:2674-2677`) is deliberate and is left alone.
2. **The cap notice is built by string concatenation**, not JSX text interpolation. JSX trims
   whitespace adjacent to a newline, so if a formatter ever wrapped
   `most recent. {history.droppedCount}` across lines the space would vanish silently and
   `HIST-cap-notice`'s exact `textContent` assertion would fail for a reason having nothing to do
   with the requirement. `history.cap` is still interpolated (criterion 9 reads 1); the prohibition
   on a hardcoded 20 reads 0.

### CSS — 6 rules appended to `global.css`

`.schema-sync-tabs`, `.schema-sync-tab-active`, `.schema-sync-cap-notice`,
`.schema-sync-history-row`, `.schema-sync-history-meta`, `.schema-sync-history-detail`.

Appended **after** `.schema-sync-modal` on purpose — 126-02's finding 5: that rule's
`max-width: 900px` beats `.modal-content`'s 600px by source order, and nothing may land before it.

`.schema-sync-cap-notice` copies `.login-error` (`global.css:2164-2171`) with `--warning`:
`color-mix(in srgb, var(--warning) 12%, transparent)` fill, `40%` border, solid token text. It
reports a retention fact, not an error, so `--danger` would overstate it. `.view-status-*`,
`.layer-row-badge.error`, `.modal-left` and `.modal-right` were all deliberately NOT copied.

## Both-theme token hand audit (the compensating control)

`global.css` is a **TOTAL** hex exemption in theme-guard — for an allowlisted file the spec asserts
hex IS present and returns, so absence is never checked. **Nothing automated protects these
colours.** Audited by hand against `:root` (lines 1-111) and `:root[data-theme="light"]` (112-148).

| Token used in the 6 new rules | `:root` | `:root[data-theme="light"]` | Verdict |
|---|---|---|---|
| `--border` | `rgba(255,255,255,0.08)` | **REDEFINED** `rgba(20,16,40,0.12)` | PASS |
| `--text` | `#ece9f6` | **REDEFINED** `#1e1b2e` | PASS |
| `--warning` | `#f59e0b` | **REDEFINED** `#d97706` | PASS |
| `--accent-text` | `#c4b5fd` | **REDEFINED** `#6d28d9` (AA on light) | PASS |
| `--accent` | `#7f40ed` | **REDEFINED** (same brand violet, deliberately) | PASS |
| `--radius-md`, `--space-1/2/3`, `--text-sm`, `--leading-normal` | defined | **inherited by design** | PASS — structural, theme-independent |

**Result: PASS.** Every colour token is redefined for light mode; every structural token is
deliberately shared. The `color-mix(… 12%, transparent)` fill re-tints from the light-mode
`--warning` automatically and would also re-tint under a re-branded palette.

The success token is deliberately unused (it aliases the brand-violet accent in both themes and
would read as an accent control). It is **not spelled out in the new CSS comment** — see the
deviation note below; spelling it out is what blinds the grep that forbids using it.

**Not automatically verifiable, routed to plan 05's operator checkpoint — stated, not dressed in a
grep:** that the cap notice reads as a *warning* rather than an *error* in both themes; that an
expanded entry is legible at the widths the operator uses; that history survives a server restart.

## Tests — 13 added, 28 in the file

| Test id | Proves |
|---|---|
| `NOPOLL-no-history-on-mount` | mounting issues **0** `listTableSyncHistory` calls — the twin 126-02 asked for |
| `HIST-loads-without-check` | the tab renders entries with `checkTableSchema` call count **0** — the durable-worklist property |
| `HIST-row-summary` | `ts`, `opuser`, and the exact string `1 added, 2 removed, 1 retyped` |
| `HIST-order-as-given` | 3 entries in MID/LATE/EARLY ts order render in **array** order — added in task 2, see P8 |
| `HIST-expand` | `col_epsilon` (report-only) and `col_delta`/`col_gamma` (changeset-only) are **null** before expanding and present after |
| `HIST-expand-baseline` | `changeset: null, report: null` expands to a neutral line without throwing; the row survives |
| `HIST-cap-notice` | `textContent` is exactly `Showing the 5 most recent. 3 older entries were dropped.` with **`cap: 5`** |
| `HIST-cap-notice-absent` | `droppedCount: 0` → no notice, **while the entries ARE present** |
| `HIST-delete` | `deleteTableSyncHistoryEntry.mock.calls[0]` is `(7, 41)` — **both** args — and the row goes |
| `HIST-delete-no-confirm` | `window.confirm` stubbed to `false`; the delete still fires and `confirm` is called **0** times |
| `HIST-refetch-after-apply` | call count goes 1 → 2 **with no tab click in between**; the second response's entry then shows |
| `HIST-empty` | `entries: []` renders a neutral line, no notice, no throw |
| `TABS-report-survives-switch` | the report is intact after history → back, with `checkTableSchema` still at 1 |

TDD order was observed: the spec was committed RED (`8df8602`, **11 failed / 16 passed**) before
the implementation (`7eca53b`). `NOPOLL-no-history-on-mount` passed in the RED commit by
construction — it is a prohibition on code that did not exist, and its discriminating power is
supplied by probe P6, not by a fail-before.

### CLASSNAME-RESOLVES — floors comfortably cleared

| Pass | Floor | 126-02 | **Now** | Unresolved |
|---|---|---|---|---|
| A — `className="…"` values + one-line two-literal ternaries | ≥ 12 | 30 | **39** | `[]` |
| B — `impact-` / `schema-sync-` tokens in any double-quoted string | ≥ 8 | 20 | **26** | `[]` |

Both tab-bar ternaries are matched by Pass A's `TERNARY` regex (2 hits) — the allowed form. All six
new classes carry the `schema-sync-` prefix, so both passes reach them.

## Mutation probes — 9 probes, 8 fired first attempt, P8 took two rounds of strengthening

Every mutation was applied to **committed** source, its presence on disk confirmed with
`git diff --stat` **before** the suite ran (the 125-04 NON-RESULT lesson), then reverted with
`git checkout --` and `git diff --exit-code -- packages/web/src` confirmed clean before the next.
**No test was weakened, deleted or re-scoped.**

| # | Mutation | On-disk | Required to redden | **Actually reddened** | Count |
|---|---|---|---|---|---|
| P1 | `String(history.cap)` → the literal `"20"` | `1 +, 1 −` | `HIST-cap-notice` | `HIST-cap-notice` | 1 failed / 26 passed |
| P2 | cap notice rendered unconditionally (`droppedCount > 0` guard dropped) | `1 +, 1 −` | `HIST-cap-notice-absent` | `HIST-cap-notice-absent` **and** `HIST-empty` (superset) | 2 / 25 |
| P3 | `deleteTableSyncHistoryEntry(entryId)` — `table.id` dropped | `1 +, 1 −` | `HIST-delete` | `HIST-delete` | 1 / 26 |
| P4 | `if (!window.confirm("Delete this entry?")) return;` before the delete | `1 +` | `HIST-delete-no-confirm` | `HIST-delete-no-confirm` **and** `HIST-delete` (superset) | 2 / 25 |
| P5 | post-apply `loadHistory()` removed | `1 −` | `HIST-refetch-after-apply` | `HIST-refetch-after-apply` | 1 / 26 |
| P6 | history tab runs `runCheck()` before `loadHistory()` | `1 +, 1 −` | `HIST-loads-without-check` | `HIST-loads-without-check`, `HIST-refetch-after-apply`, `TABS-report-survives-switch` | 3 / 24 |
| P7 | expanded detail rendered unconditionally (`expanded` ignored) | `1 +, 1 −` | `HIST-expand` (its "not in the DOM before expansion" half) | `HIST-expand` **and** `TABS-report-survives-switch` | 2 / 25 |
| P8 | `history.entries` sorted by `ts` ascending before mapping | `1 +, 1 −` | **EXPECTED NOT TO FIRE** → strengthen | see below | 0 / 27 → 0 / 28 → **1 / 27** |
| P8b | same, sorted **descending** (added to prove the strengthened fixture is order-as-given, not merely ascending-hostile) | `1 +, 1 −` | `HIST-order-as-given` | `HIST-order-as-given` | 1 / 27 |
| P9 | baseline branch removed; `entry.report` rendered with no null check | `1 +, 13 −` | `HIST-expand-baseline` | `HIST-expand-baseline` **and** `HIST-expand` | 2 / 25 |

### P8 — the result worth reading twice, and the one this plan got wrong first

P8 was written **expecting not to fire**, and it did not: run 1 was 27/27 green with the ascending
sort on disk. No existing test rendered more than one history entry, so nothing could see a
reordering. Per the plan, the **test was strengthened, not the probe dropped** — commit `de592a3`
added `HIST-order-as-given`.

**The first `HIST-order-as-given` still did not make P8 fire (run 2: 28/28 green).** Its fixture was
two entries in ts-**ascending** array order, and an ascending sort leaves that untouched. Any
two-element array is already sorted in one of the two directions, so a two-entry fixture cannot
express "order as given" at all — it can only express "not sorted the other way".

The fix (commit `2309322`) was three entries in **MID / LATE / EARLY** order, which is
non-monotonic and therefore reproducible by **neither** an ascending nor a descending sort. Run 3:
P8 reddened `HIST-order-as-given`, 1 failed / 27 passed. P8b (descending) then reddened the same
test, confirming the fixture guards order-as-given rather than one sort direction.

This is the CLAUDE.md "a guard that cannot fail manufactures confidence" failure mode caught in
flight, by the probe, in the new test's own first version. It is recorded rather than quietly
fixed because the *habit* — writing a discriminator and not checking that it discriminates — is the
thing to watch, and it recurred here even inside a task whose entire purpose was discrimination.

## Acceptance criteria — every one RUN, before and after

Before-values were **re-measured at `2ccb8c5` with `git grep`, not trusted**, and also re-measured
at `HEAD` immediately before any work. All read 0 in both places.

### Task 1

| # | Command (repo root) | Before (`2ccb8c5` / pre-work HEAD) | Required | **Actual after** | Verdict |
|---|---|---|---|---|---|
| 1 | `grep -rF 'listTableSyncHistory' packages/web/src/components \| wc -l` | **0 / 0** | ≥ 2 | **17** | PASS |
| 2 | `grep -rF 'deleteTableSyncHistoryEntry' packages/web/src/components \| wc -l` | **0 / 0** | ≥ 2 | **10** | PASS |
| 3 | `grep -cF 'schema-sync-history-row' packages/web/src/styles/global.css` | **0 / 0** | ≥ 1 | **1** | PASS |
| 4 | `grep -cF 'schema-sync-cap-notice' packages/web/src/styles/global.css` | **0 / 0** | ≥ 1 | **2** | PASS |
| 5 | `grep -rF 'HIST-cap-notice' packages/web/src \| wc -l` | **0 / 0** | ≥ 2 | **3** | PASS |
| 6 | `grep -rF 'HIST-delete-no-confirm' packages/web/src \| wc -l` | **0 / 0** | ≥ 1 | **1** | PASS |
| 7 | `grep -rF 'HIST-loads-without-check' packages/web/src \| wc -l` | **0 / 0** | ≥ 1 | **1** | PASS |
| 8 | `grep -rF 'HIST-refetch-after-apply' packages/web/src \| wc -l` | **0 / 0** | ≥ 1 | **1** | PASS |
| 9 | `grep -cF 'history.cap' packages/web/src/components/SchemaSyncModal.tsx` | **0 / 0** | ≥ 1 | **1** | PASS |
| 10 | `git diff --name-only 2ccb8c5 \| grep -c '^packages/server/'` | **0** | **0** | **0** | PASS |

### Prohibitions (all four diff-anchored to ADDED lines, per the plan)

| Command | Required | **Actual** | Verdict |
|---|---|---|---|
| hardcoded cap: `… -- SchemaSyncModal.tsx \| grep '^+[^+]' \| grep -cE 'most recent[^{]*20\|\b20 most recent\b'` | 0 | **0** | PASS |
| confirm dialog: `… \| grep -cE 'window\.confirm\|confirm\('` | 0 | **0** | PASS |
| `global.css` colour: `… -- global.css \| grep '^+[^+]' \| grep -cE '#[0-9a-fA-F]{3,8}\b\|rgba\('` | 0 | **0** | PASS |
| className convention: `… \| grep -cE 'className=\{\`\|clsx(\|classNames(\|.join(" ")'` | 0 | **0** | PASS |
| `grep -rnE 'setInterval[[:space:]]*\(' … \| grep -v '\.spec\.' \| wc -l` | 0 | **0** | PASS |
| `ls packages/web/src/components/SchemaSyncModal.css` | must not exist | **No such file** | PASS |

The `setInterval[[:space:]]*\(` form was used as mandated. The **bare token** `setInterval` still
reads **3** in non-spec web source — all three `setIntervalState` in
`charts/TimelineRenderer.tsx:260/:379/:421` — confirming the bare form must never be substituted.

### Task 2

| Criterion | **Actual** | Verdict |
|---|---|---|
| All 9 probes recorded with reddening test ids and counts | table above, plus P8b | PASS |
| P8's strengthening recorded explicitly | two rounds, both recorded | PASS |
| `git diff --exit-code -- packages/web/src` after the final revert | **exit 0**, `git status --short` empty | PASS |
| `git diff --name-only 2ccb8c5 \| grep -c '^packages/server/'` | **0** | PASS |

## Criteria that could not discriminate — reported, not quietly passed

1. **`git diff --name-only 2ccb8c5 | grep -c '^packages/server/'` = 0** (criterion 10, and task 2's).
   0 before, 0 after, by construction. It proves "nothing broke", not "something was built". Kept:
   it is still the only mechanical guard on the milestone's ZERO-server-diff budget. Third plan
   running that this has been flagged — a planner note, not a defect.
2. **The `setInterval` grep and the four diff-anchored prohibitions.** All are prohibitions on code
   that did not exist at `2ccb8c5`, so none can *fail-before*. They would fire on a real violation,
   and each has a named discriminating proof: `HIST-cap-notice` (cap: 5) for the hardcoded cap,
   `HIST-delete-no-confirm` for the dialog, `CLASSNAME-RESOLVES` Pass A/B for the className
   convention, the hand audit above for the colours, and `NOPOLL-no-check-on-mount` +
   `NOPOLL-no-history-on-mount` + probe P6 for polling.
3. **`NOPOLL-no-history-on-mount` passed in the RED commit.** Same class: a prohibition test on
   code that did not exist. Its discriminating power comes from probe P6, which reddened it.

**No criterion in this plan was found to be structurally broken**, so none needed to be reported
under the CLAUDE.md "report it and verify the real requirement directly" rule. The nearest thing was
the first `HIST-order-as-given` — a *test* that could not discriminate — and it was strengthened,
not worked around.

## Gates

| Gate | Baseline (plan 02) | **Result** |
|---|---|---|
| `cd packages/web && npx tsc --noEmit` | clean | **clean (exit 0)** |
| `cd packages/web && npx vitest run` | 184 files / 4129 tests | **184 files / 4142 tests passed, 0 failed** (+13 tests, same file count) |
| `npx vitest run src/styles/theme-guard.spec.ts` | 154 | **154 passed (154)** — UNCHANGED, not 156 |
| `git diff --exit-code -- packages/web/src` after probes | — | **exit 0, no residue** |
| `git diff --name-only 2ccb8c5 \| grep -c '^packages/server/'` | 0 | **0** |

## Deviations from Plan

**None affecting behaviour.** No auto-fix rule was invoked, no auth gate was hit, no architectural
decision arose. Four recorded judgements within the plan's own latitude:

1. **`removeEntry` filters local state** instead of re-calling `loadHistory()` — the plan allowed
   either; the reasoning is above.
2. **The cap notice string is concatenated, not JSX-interpolated** — same rendered output,
   `history.cap` still read from the response, immune to a whitespace-eating line wrap.
3. **`HIST-order-as-given` was added in task 2 and strengthened twice** — mandated by the plan for
   P8, though the plan did not anticipate that the first strengthening would also fail to fire.
4. **P8b was added** beyond the plan's nine probes, to show the strengthened fixture is hostile to
   *any* ts sort rather than only the ascending one.

One documentation nuance, same family as 126-02's: the new `global.css` comment originally spelled
out the success token while explaining why it is unused, which blinds a `grep -c -- '--success'`
prohibition. **No CSS changed**; the comment was reworded (`b5291f3`) and that grep now reads
**0** on this plan's added lines. (126-02's identical comment line remains and is left alone — it
is not this plan's to rewrite.)

## What 126-04 needs to know to mount this behind the permission gate

1. **The props are still exactly `{ table, onClose }`** (126-02 Decision B, unchanged). The modal
   knows nothing about where it is mounted and needs nothing from 126-04 but a `TableDto` and a
   close callback.
2. **Mount it conditionally, never render-then-hide.** The modal fires no request on mount, so
   mounting it for a user who lacks permission would be silent — but CONTEXT requires the *entry
   control* be ABSENT, not disabled, for anyone missing either `datasets:manage` **or**
   `dashboards:manage_access`. The AND-gate precedent is `DashboardsPage.tsx:130-132`.
3. **Four API calls now originate here**, all click-triggered: `checkTableSchema`,
   `applyTableSchema`, `listTableSyncHistory`, `deleteTableSyncHistoryEntry`. All four routes
   require BOTH permissions server-side, so a gate on only one still produces the 403 that
   criterion 4 exists to prevent.
4. **theme-guard is at 154 and plan 04 must keep it there.** 126-04 adds no component `.css` file
   either; any new rule goes in `global.css`. 156 means a component `.css` was created.
5. **Do not re-run this plan's before-measurements from the plan text.** `grep -rF 'SchemaSyncModal'
   packages/web/src` now reads well above 0; any 126-04 criterion anchored on that token will pass
   before the work and prove nothing. Anchor on a symbol 126-04 introduces.
6. **`DatasetsPage.tsx` is still at zero diff** from `2ccb8c5` — 126-04 owns its first change this
   milestone.

## Commits

| Hash | Message |
|---|---|
| `8df8602` | `test(126-03): add failing HIST- / TABS- specs for the sync-history tab` |
| `7eca53b` | `feat(126-03): add the sync-history tab to SchemaSyncModal` |
| `de592a3` | `test(126-03): strengthen with HIST-order-as-given after probe P8 did not fire` |
| `2309322` | `test(126-03): make HIST-order-as-given non-monotonic so P8 can fire` |
| `b5291f3` | `docs(126-03): reword the success-token note so the prohibition grep stays sharp` |

Task 2 produced no *implementation* change by design — all ten mutations were reverted — but it did
produce two test commits (`de592a3`, `2309322`), which is the strengthen-the-test rule working as
intended.

## Self-Check: PASSED

- `packages/web/src/components/SchemaSyncModal.tsx` — FOUND (507 lines)
- `packages/web/src/components/SchemaSyncModal.spec.tsx` — FOUND (801 lines, 28 tests)
- `packages/web/src/styles/global.css` — MODIFIED (5205 lines; `.schema-sync-history-row` present)
- `packages/web/src/components/SchemaSyncModal.css` — **correctly absent**
- commits `8df8602`, `7eca53b`, `de592a3`, `2309322`, `b5291f3` — all FOUND
- `git diff --exit-code -- packages/web/src` — exit 0, no probe residue
- `git status --short` — clean apart from this untracked SUMMARY

**Not touched, by instruction:** `.planning/ROADMAP.md`, `.planning/REQUIREMENTS.md`,
`.planning/STATE.md`. No `gsd-tools` mutation command was run. 126-05 owns those documents.
