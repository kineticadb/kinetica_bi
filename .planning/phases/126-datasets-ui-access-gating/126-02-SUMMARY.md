---
phase: 126-datasets-ui-access-gating
plan: 02
subsystem: web-schema-sync-ui
tags: [schema-sync, modal, impact-report, css-tokens, static-guard, mutation-probes, tdd]
requires:
  - "126-01 — checkTableSchema / applyTableSchema and the 20 schema-sync DTO types"
provides:
  - "packages/web/src/components/SchemaSyncModal.tsx :: default export SchemaSyncModal({ table, onClose })"
  - "packages/web/src/lib/schemaSyncStrings.ts :: SCHEMA_APPLY_TEXT_WIDTH_GAP (guarded mirror)"
  - "packages/web/src/styles/global.css :: 20 .schema-sync-* / .impact-* rules"
  - "CLASSNAME-RESOLVES — a reusable two-pass static className guard, with its coverage boundary stated"
affects:
  - "126-03 — adds the tab bar + sync-history panel to SchemaSyncModal.tsx"
  - "126-04 — mounts the modal from TableDetail / DatasetsPage behind the double permission gate"
  - "126-05 — the operator checkpoint verifies this screen live; Decision A is on its script"
tech-stack:
  added: []
  patterns:
    - "single useState<Stage> discriminated union; no store, no context, no fetch-on-mount"
    - "cross-package constant MIRROR guarded by a spec that readFileSync's the server source"
    - "two-pass static className→CSS resolution guard (attribute values + phase-prefixed tokens)"
key-files:
  created:
    - packages/web/src/lib/schemaSyncStrings.ts
    - packages/web/src/lib/schemaSyncStrings.spec.ts
    - packages/web/src/components/SchemaSyncModal.tsx
    - packages/web/src/components/SchemaSyncModal.spec.tsx
  modified:
    - packages/web/src/styles/global.css
decisions:
  - "Decision A — the text-width caveat renders on outcome \"applied\" ONLY, never on no_changes; a no_changes apply stored no column, so the caveat would describe an event that did not happen. Reversing it is a one-line change and it is on plan 05's checkpoint script."
  - "Decision B — the modal takes { table, onClose } and knows nothing about where it is mounted; plan 04 owns the per-table entry point."
  - "SCHEMA_APPLY_TEXT_WIDTH_GAP is MIRRORED in packages/web, not imported: it reaches no response body and the repo has no cross-package imports. Parity is executable, not aspirational."
  - "No SchemaSyncModal.css — every new rule went into global.css, keeping theme-guard at 154 rather than 156."
metrics:
  duration: "~50 min"
  completed: 2026-09-28
  tasks: 3
  commits: 4
---

# Phase 126 Plan 02: SchemaSyncModal — check → report → apply Summary

The operator-facing half of the schema-sync surface: one button issues one check, the full impact
report renders in the order the server built it, and Apply echoes the check's own `live` map back —
with every server-authored sentence byte-identical and a 409 stale refusal offering Re-check in
place.

## What shipped

| File | Lines | What |
|---|---|---|
| `packages/web/src/lib/schemaSyncStrings.ts` | 23 | The guarded mirror of `SCHEMA_APPLY_TEXT_WIDTH_GAP` |
| `packages/web/src/lib/schemaSyncStrings.spec.ts` | 63 | `MIRROR-PARITY` — reads `../server/src/lib/schemaApply.ts` |
| `packages/web/src/components/SchemaSyncModal.tsx` | 300 | The stage machine + `ImpactReportView` |
| `packages/web/src/components/SchemaSyncModal.spec.tsx` | 511 | 13 behaviour tests + 2 `CLASSNAME-RESOLVES` passes |
| `packages/web/src/styles/global.css` | +120 | 20 new rules, token-only |

**Sync history is deliberately absent** — plan 03 adds the tab bar and history panel to the same
file.

### The stage machine

```ts
type Stage =
  | { k: "idle" }
  | { k: "checking" }
  | { k: "report";   check: SchemaCheckResponse }
  | { k: "applying"; check: SchemaCheckResponse }
  | { k: "result";   check: SchemaCheckResponse; result: SchemaApplyResult }
  | { k: "error";    message: string };
```

One `useState`. No store, no context, **no `useEffect` that fetches**, no timer. `checkTableSchema`
and `applyTableSchema` are reachable from click handlers and from nowhere else.

`reportBody()` branches on `check.outcome` **first**, then on `check.impact !== undefined`. An
absent report is never coalesced to an empty one — absence means "the report was not run",
emptiness means "no findings", and they are different facts.

### What 126-03 needs to know about the staging

1. **The stage union is the whole state.** Adding a history tab means adding a sibling concern, not
   a new stage arm: the tab selection is orthogonal to `Stage` and should be its own `useState`
   (e.g. `useState<"sync" | "history">("sync")`), wrapping the existing `<div className="modal-body
   schema-sync-body">` content. Do not fold `history` into `Stage` — every current arm carries the
   check/apply payload and a history tab carries none of it.
2. **`Stage` survives a tab switch** if the tab lives outside it, which is what the operator wants:
   read the history, come back, the report is still there. Folding it into `Stage` would destroy
   the report on every tab click.
3. **The modal body is `display: flex; flex-direction: column; gap: var(--space-4)`.** A tab bar
   inserted as the first child inherits that gap for free.
4. **`listTableSyncHistory` must also be click-triggered** (or at minimum tab-activation-triggered)
   — the `NOPOLL-no-check-on-mount` test only guards `checkTableSchema`. If plan 03 fetches history
   in a mount effect, ROADMAP criterion 2's spirit is broken with no test to catch it. Add a
   `NOPOLL-no-history-on-mount` twin.
5. **`.schema-sync-modal` is `max-width: 900px`**, overriding `.modal-content`'s 600px by source
   order. A new rule for the history panel must be appended AFTER it or use a distinct class.
6. **The `CLASSNAME-RESOLVES` floors are `≥12` (Pass A) and `≥8` (Pass B); actuals are 30 and 20.**
   Plan 03 adding classes only raises them. Keep every new className a plain double-quoted literal
   or the guard goes blind — and keep any helper-returned class string `impact-`/`schema-sync-`
   prefixed.
7. **`applyActions()` is a local closure taking `(check, busy)`.** It renders `btn-primary btn-sm` +
   `ghost-sm` inside `ds-actions` — the CLAUDE.md canonical matched-height pairing. Reuse it rather
   than writing a second action row.

### CSS — 20 new rules in `global.css`, no component `.css` file

`.schema-sync-modal`, `-body`, `-message`, `-refusal`, `-caveat`, `-section`; `.impact-severity`,
`.impact-column`, `-head`, `-name`, `-kind`, `-types`, `-summary`; `.impact-record`, `-label`;
`.impact-advisory`; `.impact-reference`, `-path`, `-certainty`; `.impact-gaps`.

`.schema-sync-refusal` and `.schema-sync-caveat` copy `.login-error` (`global.css:2164-2171`) —
`color-mix(in srgb, var(--danger|--warning) 12%, transparent)` fill, `40%` border, solid token text.
`.view-status-*` and `.layer-row-badge.error` were deliberately NOT copied; both carry unthemed hex.

Severity colour comes from the pre-existing `.text-danger` / `.text-warning` / `.text-muted`
co-classes. **`--success` is used nowhere** — verified: `var(--success)` reads **0** in the added
lines. It aliases `--accent` (brand violet) in both themes and would read as an accent control.

## Both-theme token hand audit (the compensating control)

`global.css` is a **TOTAL** hex exemption in theme-guard — for an allowlisted file the test asserts
hex IS present and returns, so absence is never checked. Nothing automated protects these colours.
The audit was therefore run by hand, machine-assisted, against the `:root` block and the
`:root[data-theme="light"]` block.

| Token used | Light-mode status |
|---|---|
| `--text` | **REDEFINED** (`#1e1b2e`, AA on `#f6f5fb`) |
| `--muted` | **REDEFINED** (`#6b6490`) |
| `--border` | **REDEFINED** (`rgba(20, 16, 40, 0.12)`) |
| `--danger` | **REDEFINED** (`#e11d48`) |
| `--warning` | **REDEFINED** (`#d97706`) |
| `--space-0/1/2/3/4`, `--radius-md`, `--text-xs/sm/base`, `--leading-normal`, `--font-weight-normal/semibold` | inherited from `:root` — deliberately theme-independent structural tokens |

**Result: PASS.** Every colour token is redefined for light mode; every structural token is
deliberately shared. The `color-mix(... 12%, transparent)` fills therefore re-tint from the
light-mode `--danger`/`--warning` automatically, and would also re-tint under a re-branded palette.

**Still NOT automatically verifiable, routed to plan 05's checkpoint (not dressed in a grep):**
that the three severities read as visually distinct and legible in both themes, and that the report
is scannable at the widths the operator actually uses.

## Tests

`schemaSyncStrings.spec.ts` — 1 test. `SchemaSyncModal.spec.tsx` — 15 tests.

| Test id | Proves |
|---|---|
| `MIRROR-PARITY` | server declaration reassembles to **3 segments**, joining byte-equal to the web mirror |
| `NOPOLL-no-check-on-mount` | mounting issues 0 `checkTableSchema` calls — **the discriminating proof for ROADMAP criterion 2** |
| `NOPOLL-check-on-click` | exactly 1 call, argument `table.id` |
| `STAGE-report-full` | breaking + changed + harmless columns all render; no `show more/all` control |
| `ORDER-no-client-sort` | sections fed `[harmless, changed, breaking]` render in **that** DOM order |
| `VERBATIM-summary-and-label` | `summary`, `displayLabel`, `certainty`, `advisory.message`, `staleDrillDownType.message` all exact-match |
| `GAPS-all` | both `knownGaps` entries render |
| `ABSENT-impact-baseline` | `baseline_required` → message verbatim, 0 severity headings, Apply still offered |
| `NOAPPLY-table-missing` | message verbatim, Close present, Apply **null** |
| `STAGE-apply-applied` | `applyTableSchema(7, LIVE)` — second arg is the check's own map |
| `CAVEAT-applied` | the exact `SCHEMA_APPLY_TEXT_WIDTH_GAP` string is in the DOM |
| `CAVEAT-applied-only` | `no_changes` message IS present, caveat is NOT |
| `STAGE-stale-recheck` | refusal verbatim + Re-check; call count still 1 before the click, 2 after; second response's content replaces the first |
| `STAGE-apply-tablemissing-409` | 409 `table_missing` message verbatim, no Apply |
| `CLASSNAME-RESOLVES Pass A` / `Pass B` | every className literal resolves to a real rule |

TDD order was observed: both spec files were committed RED (`7b3f915`, `edbb9d1`) before their
implementations (`36034e5`, `e4a40c3`).

## CLASSNAME-RESOLVES — measured token counts and stated boundary

| Pass | Floor | **Measured** | Unresolved |
|---|---|---|---|
| A — `className="…"` attribute values (+ one-line two-literal ternary) | ≥ 12 | **30** | `[]` |
| B — `impact-` / `schema-sync-` prefixed tokens in any double-quoted string | ≥ 8 | **20** | `[]` |

Both are well above the plan-check's estimate (21 / 12) because the column head and reference rows
were split into named spans (`.impact-column-name`, `.impact-reference-path`, …) so that
`VERBATIM-` could exact-match single text nodes. Comfortable headroom: a floor failure downstream
means classes were genuinely omitted, not that the floor is wrong.

**STATED COVERAGE BOUNDARY, recorded rather than papered over.** A class token that is BOTH
(a) written outside a `className` attribute AND (b) unprefixed is invisible to both passes. In this
file that is exactly `text-danger` / `text-warning` / `text-muted`, the three co-classes
`severityClass()` appends. Compensating control: all three are pre-existing (`global.css:150`,
`:153`, `:156`) and were not invented here. The guard also does not cover template literals, `clsx`
or array joins — which is why a whole-file grep forbids those idioms in this file.

## Mutation probes — 13/13 firing probes fired, first attempt; P7c recorded as EXPECTED NOT TO FIRE

Every probe was applied to **committed** source, its presence on disk confirmed with
`git diff --stat` **before** the suite ran (the 125-04 NON-RESULT lesson), then reverted with
`git checkout --` and `git diff --exit-code -- packages/web/src` confirmed clean before the next.
No test was weakened, deleted or re-scoped. **No test needed strengthening.**

| # | Mutation | On-disk | Required to redden | **Actually reddened** | Count |
|---|---|---|---|---|---|
| P1 | `report.sections.map` → `[...].sort(localeCompare).map` | `1 +, 1 -` | `ORDER-no-client-sort` | `ORDER-no-client-sort` | 1 failed / 14 passed |
| P2 | `report.knownGaps.map` → `[report.knownGaps[0]].map` | `1 +, 1 -` | `GAPS-all` | `GAPS-all` | 1 / 14 |
| P3 | `EMPTY_REPORT` fallback substituted, rendered for `baseline_required` too | `6 +, 5 -` | `ABSENT-impact-baseline` | `ABSENT-impact-baseline` | 1 / 14 |
| P4 | mirror `NOT detect` → `not detect` | `1 +, 1 -` | `MIRROR-PARITY` | `MIRROR-PARITY` | 1 / 1 |
| P5 | segment regex → `/"…"XX/g` (matches nothing), everything else intact | `1 +, 1 -` | the `segments.length` assertion | **`segments.length`** — `AssertionError: … Got 0 … expected +0 to be 3` | 1 / 1 |
| P7 | `className="impact-column"` → `"impact-column-x"` | `1 +, 1 -` | `CLASSNAME-RESOLVES` Pass A | **Pass A AND Pass B** (as the plan predicted — the token keeps the `impact-` prefix) | 2 / 13 |
| P7b | inside `severityClass()`: `"impact-severity …"` → `"impact-severity-zz …"` | `1 +, 1 -` | `CLASSNAME-RESOLVES` Pass B | **Pass B ALONE**; Pass A stayed green | 1 / 14 |
| P7d | Close button `className="ghost-sm"` → `"ghost-smzz"` | `1 +, 1 -` | `CLASSNAME-RESOLVES` Pass A alone | **Pass A ALONE**; Pass B's set unchanged and green | 1 / 14 |
| P7c | inside `severityClass()`: `text-danger` → `text-dangerzz` | `1 +, 1 -` | **NOTHING — EXPECTED NOT TO FIRE** | **nothing — 15/15 passed with the mutation on disk** | 0 / 15 |
| P6 | caveat rendered for `no_changes` as well as `applied` | `1 +, 1 -` | `CAVEAT-applied-only` | `CAVEAT-applied-only` | 1 / 14 |
| P8 | Apply button rendered in the `table_missing` branch | `6 +, 1 -` | `NOAPPLY-table-missing` | `NOAPPLY-table-missing` | 1 / 14 |
| P9 | `useEffect(() => void runCheck(), [])` added on mount | `6 +, 1 -` | `NOPOLL-no-check-on-mount` | `NOPOLL-no-check-on-mount` | 1 / 14 |
| P10 | `{column.summary}` → `{column.column + " changed."}` | `1 +, 1 -` | `VERBATIM-summary-and-label` | `VERBATIM-summary-and-label` | 1 / 14 |
| P11 | auto-`runCheck()` when the apply resolves `stale` | `1 +` | `STAGE-stale-recheck` | `STAGE-stale-recheck` (its "call count is still 1" arm) | 1 / 14 |
| P12 | `applyTableSchema(table.id, check.live)` → `(table.id, {})` | `1 +, 1 -` | `STAGE-apply-applied` | `STAGE-apply-applied` | 1 / 14 |

### The three results worth reading twice

- **P5 is the one that mattered.** It proves `MIRROR-PARITY` is falsifiable rather than vacuous:
  with a segment regex matching nothing, the `segments.length === 3` assertion fired first and by
  name. Without that assertion the guard would have compared `""` to `""` in the degenerate case.
- **P7b and P7d together prove the two passes are independently load-bearing.** P7 alone could not:
  `impact-column-x` still carries the phase prefix, so it reddens via BOTH passes and proves only
  that one of them works. P7b reddened Pass B alone; P7d reddened Pass A alone. Pass A is the sole
  cover for an invented **unprefixed** utility class (`ghost-smm`, `btn-primary-sm`, `mutedd`) —
  precisely the CLAUDE.md defect class this guard exists for.
- **P7c did not fire, and that is the recorded result, not a defect.** `text-dangerzz` is written
  outside a `className` attribute and carries no phase prefix, so neither pass sees it. It marks the
  guard's documented limit. No test was strengthened to make it fire (the plan's one stated
  exception to the strengthen-the-test rule).

## Acceptance criteria — every one RUN, before and after

### Task 1

| # | Command | Before (measured at `2ccb8c5`) | Required | **Actual after** | Verdict |
|---|---|---|---|---|---|
| 1 | `grep -rF 'SCHEMA_APPLY_TEXT_WIDTH_GAP' packages/web/src \| wc -l` | **0** | ≥ 3 | **9** | PASS |
| 2 | `grep -rF 'MIRROR-PARITY' packages/web/src \| wc -l` | **0** | ≥ 1 | **3** | PASS |
| 3 | `grep -rF 'schemaSyncStrings' packages/web/src \| wc -l` | **0** | ≥ 2 | **4** | PASS |
| 4 | `grep -cF 'segments.length' .../schemaSyncStrings.spec.ts` | file absent (exit 2, empty stdout) | ≥ 1 | **3** | PASS |
| 5 | `git diff --name-only 2ccb8c5 \| grep -c '^packages/server/'` | **0** | **0** | **0** | PASS |
| — | `npx vitest run src/lib/schemaSyncStrings.spec.ts` | — | 1 passed | **1 passed** | PASS |

### Task 2

| # | Command | Before (measured at `2ccb8c5`) | Required | **Actual after** | Verdict |
|---|---|---|---|---|---|
| 1 | `grep -rF 'SchemaSyncModal' packages/web/src \| wc -l` | **0** | ≥ 4 | **7** | PASS |
| 2 | `grep -cF 'impact-severity' .../global.css` | **0** | ≥ 1 | **1** | PASS |
| 3 | `grep -rF 'CLASSNAME-RESOLVES' packages/web/src \| wc -l` | **0** | ≥ 1 | **7** | PASS |
| 4 | `grep -rF 'ORDER-no-client-sort' packages/web/src \| wc -l` | **0** | ≥ 1 | **1** | PASS |
| 5 | `grep -rF 'CAVEAT-applied-only' packages/web/src \| wc -l` | **0** | ≥ 1 | **1** | PASS |
| 6 | `grep -rF 'NOAPPLY-table-missing' packages/web/src \| wc -l` | **0** | ≥ 1 | **1** | PASS |
| 7 | `grep -rF 'GAPS-all' packages/web/src \| wc -l` | **0** | ≥ 1 | **1** | PASS |
| 8 | `grep -rF 'NOPOLL-' packages/web/src \| wc -l` | **0** | ≥ 2 | **4** | PASS |
| 9 | `grep -cF 'schema-sync' .../global.css` | **0** | ≥ 6 | **6** | PASS |
| 10 | `git diff --name-only 2ccb8c5 \| grep -c '^packages/server/'` | **0** | **0** | **0** | PASS |

**Prohibitions:**

| Command | Required | **Actual** | Verdict |
|---|---|---|---|
| diff-anchored `global.css` hex/`rgba(` on ADDED lines | 0 | **0** | PASS |
| whole-file hex / `rgba(` / `.sort(` / `knownGaps[0]` / `impact ??` on `SchemaSyncModal.tsx` | 0 | **0** (after one fix — see below) | PASS |
| whole-file `className={\`` / `clsx(` / `classNames(` / `.join(" ")` on `SchemaSyncModal.tsx` | 0 | **0** | PASS |
| `setInterval[[:space:]]*(` in non-spec web source | 0 | **0** | PASS |
| `window.setInterval` | 0 | **0** | PASS |
| `grep -rlF 'checkTableSchema' packages/web/src` | exactly 4 named files | `client.ts`, `client.schema-sync.spec.ts`, `SchemaSyncModal.tsx`, `SchemaSyncModal.spec.tsx` — nothing under `charts/`, no `DashboardsPage.tsx`, no `App.tsx` | PASS |
| `ls packages/web/src/components/SchemaSyncModal.css` | must not exist | **No such file** | PASS |

**The one prohibition that fired, and why that is the criterion working.** On first run the
whole-file `SchemaSyncModal.tsx` grep read **1**, not 0. The hit was a *code comment* reading
``Never `impact ?? {}` `` — the exact failure mode `126-01-SUMMARY.md` warned about (writing the
prohibited phrase in prose trips a grep that cannot tell code from comment). **No code was changed
to satisfy the check**; the comment was reworded to state the same rule without the literal
("An absent report is never coalesced to an empty one: absence and emptiness mean different
things"). Re-run: **0**.

## Criteria that could not discriminate — reported, not quietly passed

Three criteria in this plan read the same value before and after **by construction**, so they can
never fail-before. The plan already labelled all three honestly; this summary confirms the
measurement rather than re-litigating it.

1. **`git diff --name-only 2ccb8c5 | grep -c '^packages/server/'` = 0** (task 1 #5, task 2 #10).
   0 before, 0 after. It proves "nothing broke", not "something was built". It is still the only
   mechanical guard on the milestone's ZERO-server-diff budget, so it stays.
2. **The two `setInterval` greps.** Prohibitions on code that did not exist at `2ccb8c5`; both read
   0 before, by construction. The plan says so explicitly and routes the real proof to
   `NOPOLL-no-check-on-mount` (which P9 proved discriminates) plus plan 05's operator checkpoint.
   **Noted for plan 03:** the bare token `setInterval` reads **3** in non-spec web source — all
   three are `setIntervalState` in `charts/TimelineRenderer.tsx:260/:379/:421` — so the
   `[[:space:]]*(` form is mandatory and the bare-token form must not be substituted.
3. **`git diff --unified=0 … | grep '^+[^+]' | grep -cE '#hex|rgba('` on `global.css`.** Correctly
   anchored to ADDED lines (the whole-file form is hopeless against hundreds of pre-existing hits)
   and it *would* fire on a real violation — but it has no meaningful before-value.

Everything else (criteria 1-9 in task 2, 1-4 in task 1) anchors on a symbol or test-id this plan
introduces and genuinely read 0 beforehand; all stated before-values were **re-measured, not
trusted**, and all matched.

## Gates

| Gate | Baseline | **Result** |
|---|---|---|
| `cd packages/web && npx tsc --noEmit` | clean | **clean (exit 0)** |
| `cd packages/web && npx vitest run` | 182 files / 4111 tests | **184 files / 4129 tests passed, 0 failed** (+2 files, +18 tests: 1 MIRROR-PARITY + 15 SchemaSyncModal + 2 theme-guard) |
| `npx vitest run src/styles/theme-guard.spec.ts` | 152 | **154 passed (154)** — exactly +2, NOT 156 |
| `git diff --exit-code -- packages/web/src` after probes | — | **exit 0, no residue** |
| `git diff --name-only 2ccb8c5 \| grep -c '^packages/server/'` | 0 | **0** |

## Planner decisions restated for plan 05's checkpoint

**Decision A — the text-width caveat renders on `outcome: "applied"` ONLY, not on `no_changes`.**
ROADMAP criterion 6 says "after an apply", unconditionally, and no source settles whether a
`no_changes` apply counts. The judgement made here is that it does not, because the limitation the
criterion names is that *"a column INFORMATION_SCHEMA reported as `text` **is stored as `string`
after an apply**"* — and a `no_changes` outcome wrote nothing
(`SCHEMA_APPLY_NO_CHANGES_MESSAGE`'s own second sentence: "No history entry was recorded, because
nothing changed"). No column was stored as anything, so the caveat would describe an event that did
not happen. The "NOT conditional" clause in criterion 6 is about not conditioning on whether the
table actually had a `text` column — detection the server deliberately does not do; *within*
`applied` the caveat is unconditional, covering `kind: "baseline"` and `kind: "diff"` alike.

**This is a judgement, not a finding. Put it in front of the operator.** Reversing it is one line:
`result.outcome === "applied"` → `result.outcome === "applied" || result.outcome === "no_changes"`
in `resultBody()` (`SchemaSyncModal.tsx`), and flipping `CAVEAT-applied-only`. Probe P6 already
demonstrates the mutation and shows the test catches it.

**Decision B — the modal is opened per TABLE and takes `{ table, onClose }`.** It knows nothing
about where it is mounted. Plan 04 owns the entry point and the `datasets:manage` AND
`dashboards:manage_access` absence gate.

## Deviations from Plan

**None affecting behaviour.** No auto-fix rule was invoked, no auth gate was hit, no architectural
decision arose. Two presentational elaborations within the plan's own latitude, both recorded here
because they change measured numbers downstream:

1. **The column head and reference row were split into named spans** — `.impact-column-name`,
   `.impact-column-kind`, `.impact-column-types`, `.impact-column-summary`, `.impact-record-label`,
   `.impact-advisory`, `.impact-reference-path`, `.impact-reference-certainty` — rather than the
   plan's sketch of `<div className="impact-reference">{r.path} — {r.certainty}</div>`. Reason: the
   `VERBATIM-` tests exact-match single text nodes, and interpolating two values into one element
   splits the text across nodes so an exact `getByText` cannot match. Consequence: 20 new CSS rules
   instead of the plan's 12, and Pass A / Pass B counts of 30 / 20 instead of the estimated 21 / 12.
   Every added class resolves; the diff-anchored colour prohibition still reads 0.
2. **`applyActions()` renders a `ghost-sm` Cancel alongside `btn-primary btn-sm` Apply**, per
   CLAUDE.md's canonical `ds-actions` pairing. The plan showed only the Apply button.

One documentation nuance, already covered above: the whole-file prohibition grep caught a code
comment containing ``impact ?? {}``. The comment was reworded; no code changed.

## Commits

| Hash | Message |
|---|---|
| `7b3f915` | `test(126-02): add failing MIRROR-PARITY guard for the text-width caveat mirror` |
| `36034e5` | `feat(126-02): mirror SCHEMA_APPLY_TEXT_WIDTH_GAP into packages/web` |
| `edbb9d1` | `test(126-02): add failing SchemaSyncModal specs incl. CLASSNAME-RESOLVES` |
| `e4a40c3` | `feat(126-02): add SchemaSyncModal check/report/apply stage machine` |

Task 3 (mutation probes) produced no code change by design — all 14 mutations were reverted — so it
carries no implementation commit. Its evidence is the probe table above.

## Self-Check: PASSED

- `packages/web/src/lib/schemaSyncStrings.ts` — FOUND (23 lines)
- `packages/web/src/lib/schemaSyncStrings.spec.ts` — FOUND (63 lines)
- `packages/web/src/components/SchemaSyncModal.tsx` — FOUND (300 lines; min_lines 200 satisfied)
- `packages/web/src/components/SchemaSyncModal.spec.tsx` — FOUND (511 lines)
- `packages/web/src/styles/global.css` — MODIFIED (+120 lines; `.impact-severity` present)
- `packages/web/src/components/SchemaSyncModal.css` — **correctly absent**
- commits `7b3f915`, `36034e5`, `edbb9d1`, `e4a40c3` — all FOUND
- `git diff --exit-code -- packages/web/src` — exit 0, no probe residue
