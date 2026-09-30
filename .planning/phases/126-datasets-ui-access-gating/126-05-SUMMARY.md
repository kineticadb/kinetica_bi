---
phase: 126-datasets-ui-access-gating
plan: 05
subsystem: planning-docs
tags: [requirement-amendment, roadmap, rbac, operator-checkpoint, uat, anchor-uniqueness]
status: COMPLETE
requires:
  - "126-01 — the four route callers"
  - "126-02 — SchemaSyncModal check → report → apply"
  - "126-03 — the sync-history tab"
  - "126-04 — the TableDetail entry point and its AND-gate"
provides:
  - ".planning/REQUIREMENTS.md :: SSYNC-V125-19 amended to name BOTH datasets:manage and dashboards:manage_access"
  - ".planning/ROADMAP.md § Phase 126 :: Goal, criterion 4 and Canonical refs amended to match"
  - ".planning/phases/126-datasets-ui-access-gating/126-UAT.md :: the operator's verification record, 14 checks, ALL UNANSWERED"
  - ".planning/phases/126-datasets-ui-access-gating/deferred-items.md :: the DatasetsPage.spec.tsx test that passes for the wrong reason"
affects:
  - "SSYNC-V125-01, -18, -19 closed in REQUIREMENTS.md; ROADMAP Phase 126 ticked complete"
tech-stack:
  added: []
  patterns:
    - "literal-string replacement under a scripted uniqueness assertion (refuse to edit unless count == 1), not sed"
key-files:
  created:
    - .planning/phases/126-datasets-ui-access-gating/126-UAT.md
    - .planning/phases/126-datasets-ui-access-gating/deferred-items.md
  modified:
    - .planning/REQUIREMENTS.md
    - .planning/ROADMAP.md
decisions:
  - "The plan's own suggested amendment prose quoted the stale wording verbatim, which would have made its own load-bearing criterion 3 UNSATISFIABLE. Resolved by describing the old wording instead of quoting it, so the stale sentence is genuinely gone in every form rather than the grep being gamed by dropping one word. REPORTED, not smoothed over."
  - "No checkbox ticked anywhere. Task 3 not run."
metrics:
  duration: "~25 min (task 1 + pre-flight + UAT record)"
  completed: 2026-09-30
  tasks: "3 of 3"
  commits: 1
---

# Phase 126 Plan 05: Amendment + operator checkpoint Summary

**STATUS: COMPLETE 2026-09-30.** The operator approved the checkpoint — all 14 checks PASS
against a real Kinetica instance — and task 3 closed the three requirements and the roadmap.
The sections below from "Task 2 — the operator checkpoint: NOT YET ANSWERED" onward are the
pre-checkpoint record, kept as written; the outcome is in "Outcome (added 2026-09-30)" at the end.

**Original pause note:**

Task 1 is complete and committed. Task 2 is a blocking `checkpoint:human-verify` against a real
Kinetica instance — it was **not** self-approved, **not** simulated, and no verdict was invented.
Task 3 (requirement closure and roadmap bookkeeping) is gated behind the operator's verdict and
**has not run**.

## Task 1 — the amendment, four sites, one commit

`95e6ee0` — `docs(126): amend SSYNC-V125-19 and the Phase 126 roadmap — the gate is two permissions, not one`

Exactly two files, 4 changed lines, nothing else:

| Site | File:line | What changed |
|---|---|---|
| The requirement | `.planning/REQUIREMENTS.md:52` | now names BOTH `datasets:manage` AND `dashboards:manage_access`, with the reasoning, the four route citations and the rejected alternative |
| The Goal | `.planning/ROADMAP.md:159` | "only with the permission that already governs dataset management" → "only with BOTH `datasets:manage` and `dashboards:manage_access`" |
| Canonical refs | `.planning/ROADMAP.md:162` | `permissions.ts` (`DATASETS_MANAGE`) → (`DATASETS_MANAGE` AND `DASHBOARDS_MANAGE_ACCESS` — the gate is both, not one) |
| Criterion 4 | `.planning/ROADMAP.md:167` | names the AND-gate, plus the dated **AMENDED 2026-09-28 (Phase 126)** note |

One commit for both files by design: splitting it would leave a commit in which the requirement
and its own roadmap criterion disagree.

**Every citation in the amendment text was verified against source before being written**, not
copied from the plan on trust:
- `packages/server/src/index.ts:2500-2501` — read; the schema-check route does spread
  `...requirePermission(PERMISSIONS.DATASETS_MANAGE)` then
  `...requirePermission(PERMISSIONS.DASHBOARDS_MANAGE_ACCESS)`. Confirmed.
- `packages/server/src/lib/dashboardAccessDb.ts:11` — read; `canViewDashboard`'s resolution order
  step 1 is literally "Bypass: `getEffectivePermissions(username).has(DASHBOARDS_MANAGE_ACCESS)`".
  Confirmed — the cross-dashboard-visibility argument holds.

## A criterion that contradicted the plan's own prose — REPORTED, not gamed

The plan's suggested replacement text for SSYNC-V125-19 (lines 115-126) reads:

> As originally written this said "the same permission that governs dataset management today",
> singular.

Its own load-bearing **acceptance criterion 3** requires
`grep -c 'the same permission that governs dataset management today' .planning/REQUIREMENTS.md`
→ **0**. **Writing the suggested prose verbatim would have left that count at 1 and failed the
criterion.** The two halves of the plan disagree.

There were three ways out, and two of them are the antipattern CLAUDE.md names:

1. Write the prose and report criterion 3 as unsatisfiable. — Rejected: the criterion is sound and
   its intent is right.
2. Quote the old wording but drop the word "today" so the grep misses it. — **Rejected as exactly
   "editing to satisfy a broken check."** The stale sentence would still be sitting in the file,
   one word short, and the guard would be passing for a reason unrelated to what it measures.
3. **Chosen:** describe the old wording rather than quote it — "As originally written this named
   ONE permission — the one that governs dataset management". The historical record is fully
   preserved, the stale assertion is genuinely gone **in every form**, and criterion 3 passes
   because the thing it measures is actually true.

The plan explicitly licensed this (`Replace the requirement's text at :52 with wording along these
lines`). Recorded because the near-miss is the interesting part: the criterion was well-designed
and the *suggested prose written alongside it* was what would have broken it.

The equivalent ROADMAP note (criterion 4) has no such conflict — the plan's suggested wording there
is "As originally written this named `datasets:manage` alone", which does not reproduce criterion
9's anchor string. Used as written.

## Anchor-uniqueness drill (control C1) — every count recorded

All four edits were made by a script that **counts occurrences of the exact literal and refuses to
edit unless the count is exactly 1** (`assert n == 1`), rather than by `sed`. Output:

| Anchor | Site | **Measured** | Required |
|---|---|---|---|
| `REQ-19-line` (full line text of `:52`) | REQUIREMENTS | **1** | 1 |
| `A` — `only with the permission that already governs dataset management` | ROADMAP Goal | **1** | 1 |
| `B` — ``A user without `datasets:manage` sees no check, apply or history control`` (full criterion-4 line) | ROADMAP crit 4 | **1** | 1 |
| `C` — ``` `packages/web/src/lib/permissions.ts` (`DATASETS_MANAGE`) ``` | ROADMAP refs | **1** | 1 |

No anchor needed extending. The bare token `SSYNC-V125-19` reads **2** (requirement line + mapping
row) and was correctly NOT used as an anchor — the full line text was.

## Controls C2 and C3 — re-read after, full diff before commit

**C2 (re-read after every edit):** the whole `### Access` section of REQUIREMENTS.md was read back.
(a) the amended text sits under SSYNC-V125-19 and nowhere else; (b) SSYNC-V125-18 at `:48` and
SSYNC-V125-01 at `:22` are byte-unchanged —
`git diff 2ccb8c5 -- .planning/REQUIREMENTS.md | grep -cE '^[+-].*SSYNC-V125-(01|18)\*\*'` → **0**;
(c) no other requirement's text moved (`--numstat` = `1 1`).

**C3 (full ROADMAP diff read before committing):** `git diff 2ccb8c5 -- .planning/ROADMAP.md` is a
**single hunk**, and `git diff -U0` reports changed lines **159, 162, 167** only. The Phase 126
heading is at **158** and the section's closing `---` at **178**, so all three are inside the Phase
126 block. Phases 122/123/124/125 and the v1.24 archive are untouched. The Phase 122-under-Phase-123
failure did not recur.

## Task 1 acceptance criteria — every one RUN, before-value measured AT HEAD

HEAD at measurement time: **`84e6c41`** (not `2ccb8c5` — `.planning/` moved between them).
**Every before-value below matched the plan's HEAD-measured table exactly**, so no correction was
needed.

| # | Command (repo root) | Before (at HEAD `84e6c41`) | Required | **Actual after** | Verdict |
|---|---|---|---|---|---|
| 1 | `grep -c 'dashboards:manage_access' .planning/REQUIREMENTS.md` | **0** | ≥ 1 | **1** | PASS |
| 2 | `grep -c 'AMENDED 2026-09-28' .planning/REQUIREMENTS.md` | **0** | exactly 1 | **1** | PASS |
| **3** | `grep -c 'the same permission that governs dataset management today' .planning/REQUIREMENTS.md` | **1** | **0** | **0** | **PASS — load-bearing** |
| 4 | `grep -c 'SSYNC-V125-19' .planning/REQUIREMENTS.md` | **2** | 2 | **2** | PASS (no third copy) |
| 5 | `grep -c '^- \[ \] \*\*SSYNC-V125-19\*\*' .planning/REQUIREMENTS.md` | **1** | 1 | **1** | PASS (still UNTICKED) |
| 6 | `git show --stat --name-only --format= HEAD \| sort` | — | exactly 2 paths | `.planning/REQUIREMENTS.md`, `.planning/ROADMAP.md` — **no third** | PASS |
| 7 | `git diff --name-only 2ccb8c5 \| grep -c '^packages/'` | **11** | unchanged | **11** | PASS |
| **8** | `grep -cF 'only with the permission that already governs dataset management' .planning/ROADMAP.md` | **1** | **0** | **0** | **PASS — load-bearing** |
| **9** | ``grep -cF 'A user without `datasets:manage` sees no check, apply or history control' .planning/ROADMAP.md`` | **1** | **0** | **0** | **PASS — load-bearing** |
| 10 | `grep -cF 'AMENDED 2026-09-28 (Phase 126)' .planning/ROADMAP.md` | **0** | ≥ 1 | **1** | PASS |
| 11 | `grep -cF 'dashboards:manage_access' .planning/ROADMAP.md` | **2** | ≥ 3 | **4** | PASS |
| 12 | `grep -c '### Phase 126: Datasets UI, Access Gating & Operator Verification' .planning/ROADMAP.md` | **1** | 1 | **1** | PASS (landed in the existing section) |
| 13 | `grep -c '^- \[ \] 126-0' .planning/ROADMAP.md` | **5** | 5 | **5** | PASS (no plan checkbox ticked) |

Criterion 11 landed at 4, not the minimum 3: the Goal line and the criterion-4 line each added one
occurrence. The Canonical-refs edit named the **constant** `DASHBOARDS_MANAGE_ACCESS`, not the
permission string, and correctly contributed nothing — which is precisely the margin the plan built
in and the reason `≥ 4` would have been the wrong assertion.

**Criteria that could not discriminate, reported rather than quietly passed:** criterion 7
(`grep -c '^packages/'` = 11 before and after) is a "nothing was broken" guard, not evidence of
work — it reads the same whether or not this task ran. Kept as the budget guard it is. Criteria 5,
12 and 13 are likewise unchanged-value guards; their job is to catch a *scope* error, and they can
fail (ticking a box, duplicating a heading), so they are honest guards with a null before/after.

## Nothing was ticked — verified, not asserted

| Check | Required | **Actual** |
|---|---|---|
| `grep -c '^- \[ \] \*\*SSYNC-V125' .planning/REQUIREMENTS.md` | 3 | **3** |
| `grep -c 'Pending' .planning/REQUIREMENTS.md` | 3 | **3** |
| `grep -c '^- \[ \] 126-0' .planning/ROADMAP.md` | 5 | **5** |
| `grep -c '^- \[ \] \*\*Phase 126' .planning/ROADMAP.md` | 1 | **1** |

No requirement checkbox, no plan checkbox and no milestone phase checkbox was touched. Task 3 owns
all four and has not run.

## Task 2 pre-flight gates — run and recorded BEFORE the operator is asked to look

Asking the operator to verify a red tree would waste the one control this phase has that no gate
can replace.

| # | Gate | Required | **Result** |
|---|---|---|---|
| 1 | `cd packages/web && npx tsc --noEmit` | clean | **clean (exit 0)** |
| 2 | `cd packages/web && npx vitest run` | 100% | **185 files / 4150 tests passed, 0 failed** |
| 3 | `cd packages/web && npx vitest run src/styles/theme-guard.spec.ts` | 154 | **154 passed (154)** |
| 4 | `git diff --name-only 2ccb8c5 \| grep -c '^packages/server/src/'` | 0 | **0** |
| 5 | `git status --porcelain` | clean | **clean** |

Gate 2 matches wave 4's carried-forward number exactly (185 / 4150) — this plan added no web source
and none was expected to move. Gate 3 held at 154, not 156: no new component `.css` file was
created anywhere in the phase.

Also confirmed: `git diff --name-only 2ccb8c5 | grep -c '^packages/server/'` (the whole package, not
just `src/`) → **0**.

## Task 2 — the operator checkpoint: NOT YET ANSWERED

`126-UAT.md` was written with all fourteen checks `UAT-126-G1` … `UAT-126-G14` recorded and
**UNANSWERED**. `grep -c 'UAT-126-G'` → **14**, all distinct ids present. G8 and G9 carry
`ruling: UNANSWERED` rather than a result, as they are decisions rather than observations.

**No verdict was supplied, inferred, simulated or self-approved.** The checkpoint is blocking and
execution stopped here.

### The four items the earlier waves asked to be put in front of the operator — all four are in

1. **Decision B (G9) — where the entry point lives.** `Schema sync` is third of four in
   `TableDetail`'s actions bar, between `Custom metrics` and `Back`, reached via the row's `View`
   button. `126-CONTEXT.md`'s *prose* says "per Datasets row"; its only file:line citations are
   inside `TableDetail`. One-line move, no CSS change needed. Operator to confirm or reject.
2. **Decision A (G8) — the text-gap caveat.** Renders on `outcome: "applied"` only, never on
   `no_changes`. ROADMAP criterion 6's literal wording is "after an apply", unconditionally, so
   **this narrows it**. One-line reversal; probe P6 (126-02) already showed the test catches the
   change.
3. **Colour legibility in BOTH themes (G10).** `global.css` is a total hex exemption in
   theme-guard, so **nothing automated protects any colour there**. Severity distinctness, and
   whether the cap notice reads as a warning rather than an error, are human checks and are stated
   as such rather than dressed in a grep.
4. **The pre-existing test that passes for the wrong reason.** Logged to
   `.planning/phases/126-datasets-ui-access-gating/deferred-items.md` (new file) with P4's measured
   evidence, and repeated at the foot of `126-UAT.md` as a recommendation rather than a check.

The UAT document also carries the **`table_missing` is CORRECT** note prominently in its Setup
section — five of the nine registered tables have been dropped from Kinetica (Phase 124's carried
gaps), so it is expected behaviour, not a defect to file.

## Deviations from Plan

**None affecting the outcome.** No auto-fix rule (1-4) was invoked, no auth gate was hit, no
architectural decision arose. Two recorded judgements:

1. **The amendment prose describes rather than quotes the stale wording** — see the section above.
   Without this, the plan's own load-bearing criterion 3 was unsatisfiable by its own suggested
   text.
2. **`deferred-items.md` was created rather than the finding being left in prose only.** 126-04's
   SUMMARY recommended "a line in `deferred-items.md` or a future plan"; the executor's standing
   scope-boundary rule says out-of-scope discoveries go to `deferred-items.md` in the phase
   directory. Both point the same way. It touches no source.

No `gsd-tools` command of any kind was run — not `state`, `phase`, `roadmap`, `milestone`,
`config-set` or `verify key-links`. All bookkeeping was hand edits.

## Gaps to carry into the milestone close (for task 3's `Known gaps` line)

Gathered now so task 3 does not have to reconstruct them. **This list is incomplete by design** —
G10 and G14 will add to it, and NOT-EXERCISED checks must be added as NOT-EXERCISED.

1. **No automated gate can check ANY colour in `global.css`** — it is a total hex exemption in
   `theme-guard.spec.ts`, and every colour this phase added lives there. The only control is G10.
2. **ROADMAP criterion 6's "the UI imports the constant" was not literally achievable** —
   `SCHEMA_APPLY_TEXT_WIDTH_GAP` reaches no response body and this repo has no cross-package
   imports. Satisfied by a MIRROR in `packages/web/src/lib/schemaSyncStrings.ts` behind an
   executable parity guard (`MIRROR-PARITY`) that reads the server source and asserts the segment
   count as well as the value.
3. **126-03 probe P8 required TWO rounds of test strengthening** — the first `HIST-order-as-given`
   still could not fire, because any two-element fixture is already sorted in one of the two
   directions. Fixed with a three-entry MID/LATE/EARLY fixture; P8b (descending) then confirmed it
   guards order-as-given rather than one sort direction. No probe was weakened.
4. **126-04 probe P4 under-reddened by one, and that one is a real hole** —
   `DatasetsPage.spec.tsx`'s `does NOT render ColumnFormatEditorModal before the button is clicked`
   passes for the wrong reason. Now in `deferred-items.md`.
5. **`ENTRY-closes` (126-04) was an undiscriminated test** until probe P9 was added beyond the
   plan's eight to prove it could fail.
6. **Five of the nine registered Kinetica tables have been dropped**, so most live checks return
   `table_missing`. Correct behaviour; constrains what G1-G4/G6/G7 can be run against.
7. **G8 and G9 are planner judgements, not findings** — if the operator overrules either, task 3
   must make the one-line change, re-run all three gates, and commit it separately.
8. **Open until G14 answers:** the BOOLEAN marker is documentation-derived and was never probed
   against a live `/show/table` body; and `renderColumnType` / `classifyFingerprint` scan markers
   in different orders and are proven to agree only over a fixture, not in general.

## Commits

| Hash | Message |
|---|---|
| `95e6ee0` | `docs(126): amend SSYNC-V125-19 and the Phase 126 roadmap — the gate is two permissions, not one` |

`126-UAT.md`, `deferred-items.md` and this SUMMARY are uncommitted at hand-back, so the operator's
verdict can be written into the UAT document before it enters history.

## Self-Check

- `.planning/phases/126-datasets-ui-access-gating/126-UAT.md` — FOUND, 14 distinct `UAT-126-G` ids,
  all UNANSWERED
- `.planning/phases/126-datasets-ui-access-gating/deferred-items.md` — FOUND
- `.planning/REQUIREMENTS.md` — MODIFIED, `:52` amended, nothing ticked (3 unticked, 3 `Pending`)
- `.planning/ROADMAP.md` — MODIFIED at `159`/`162`/`167` only, all inside the Phase 126 block,
  nothing ticked (5 unticked plans, Phase 126 milestone box unticked)
- commit `95e6ee0` — FOUND, exactly two paths
- `packages/web`, `packages/server` — **zero diff from this plan**; server diff from `2ccb8c5` = 0

**Self-Check: PASSED** — with the standing caveat that this plan is INCOMPLETE by design: task 2 is
awaiting the operator and task 3 has not run.

## Outcome (added 2026-09-30)

**Operator verdicts** (full record in `126-UAT.md`): G1-G7, G10, G12, G14 PASS; G11 PASS after two
fixes; G13 PASS after one fix. No check NOT-EXERCISED.

**Rulings:** G8 REVERSED — caveat after `no_changes` too (`49a0410`: `CAVEAT-no-changes` replaces
`CAVEAT-applied-only`, plus `CAVEAT-not-on-stale`; probe: reverting the condition reddens
`CAVEAT-no-changes` alone). G9 KEPT — entry point stays in `TableDetail`.

**Defects found at the checkpoint, all past every automated gate:**
| Check | Defect | Fix |
|---|---|---|
| G13 | Gate sealed itself shut — mid-session grant never revealed the hidden button (client re-syncs permissions only on a 403) | `c6bd957` — `/me` re-sync on Datasets mount, `RESYNC-` x3 |
| G11 | History detail font: shared `.data-table` at 14px | `c6bd957` — scoped `.schema-sync-section .data-table` |
| G11 | Changeset labels on `.modal-section-title` (14px); bare `.muted` "None." inherited `body` 16px | `49a0410` — reuse `impact-severity text-muted`; `.schema-sync-section > .muted` |
| (G13, out of scope) | RolesPage stale closure re-checked an unchecked permission after Save | `2af200a`, on explicit request |

**G14:** live boolean renders `int(boolean)`; `classifyFingerprint` classes it `boolean`
(refinements first, `columnTypeClass.ts:128`). Phase 124/125 assumption confirmed live.

**Task 3 anchor drill:** all six REQUIREMENTS.md anchors and every ROADMAP anchor counted at
exactly 1 before editing. Acceptance criteria after: 3/4/5 → 1 each; 6 → 0; 7 (`Pending`) → 0;
8 → 0; 8b → 1; 9 → 1; `- [x] **Phase 126` → 1; 11 (`packages/server/` diff) → 0.
ROADMAP diff hunks: line 57 (milestone phase list) and 170-176 (inside the Phase 126 block, 158-178)
only. No `gsd-tools` command was run.

**Final gates:** web tsc clean; vitest 185 files / 4156 tests; theme-guard 154; `packages/server`
diff 0.
