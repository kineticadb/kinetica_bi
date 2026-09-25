---
phase: 125-apply-sync-history
plan: 04
subsystem: server-routes
tags: [schema-sync, apply, sync-history, routes, rbac, requirement-closure]
requires:
  - packages/server/src/lib/schemaApply.ts applySchemaSync (Plan 125-03)
  - packages/server/src/db.ts listTableSyncHistory / getTableSyncHistoryEntry / deleteTableSyncHistoryEntry (Plan 125-01)
  - packages/server/src/lib/schemaFingerprint.ts tablePresence / parseColumnFingerprints (Phase 122)
  - packages/server/src/lib/schemaDiff.ts tableMissingResult (Phase 122)
provides:
  - POST /api/tables/:id/schema-apply (the milestone's only write route)
  - GET /api/tables/:id/sync-history
  - DELETE /api/tables/:id/sync-history/:entryId
affects:
  - .planning/REQUIREMENTS.md (SSYNC-V125-13..-17 closed)
  - .planning/ROADMAP.md (Phase 125 plan list)
tech-stack:
  added: []
  patterns:
    - the schema-check route's AND-gate spread, single-kineticaShowTable, no-try/catch shape reused verbatim for a WRITE
    - request-body validation placed BEFORE the upstream call, so a malformed apply never touches Kinetica
    - the refusal message SPREAD from the read route's own helper rather than retyped
key-files:
  created:
    - packages/server/tests/routes.schema-apply.spec.ts
  modified:
    - packages/server/src/index.ts
    - .planning/REQUIREMENTS.md
    - .planning/ROADMAP.md
decisions:
  - "The empty-map rejection lives in the route, not the lib, and precedes the Kinetica call — proven by a NAMED test, REFUSE-badbody, plus probe P5"
  - "A Kinetica-dropped table is 409 from the apply but 200 from the check: for a read it is a finding, for a write it is a conflict that stopped the write"
  - "table_missing reuses tableMissingResult's message by object spread so the check and the apply cannot drift"
  - "The sync-history routes carry no requireConfig — neither touches a Kinetica connection (column-display-config / custom-metrics precedent)"
  - "SCHEMA_APPLY_TABLE_MISSING_MESSAGE is UNREACHABLE through the HTTP surface — surfaced at the checkpoint rather than quietly left in place"
metrics:
  tasks: 2 of 3 (Task 3 is a BLOCKING checkpoint, not yet answered)
  tests_added: 21
  probes: 9
  duration: ~70m
  completed: pending checkpoint
---

# Phase 125 Plan 04: Route Wiring & Requirement Closure Summary

The three routes that make everything Plans 125-01..03 built reachable: the milestone's only
write route, the history read Phase 126 will render, and the per-entry delete that closes
ROADMAP criterion 5. Plus the closure of the phase's five requirements.

**Status: Tasks 1 and 2 are complete and committed. Task 3 — the blocking checkpoint on the six
operator-facing strings — is UNANSWERED.** Nothing in this document should be read as operator
approval of any wording.

## What shipped

| Task | What | Commits |
| ---- | ---- | ------- |
| 1 | `POST /api/tables/:id/schema-apply` | `093382b` (RED), `4612526` (GREEN) |
| 2 | `GET /sync-history`, `DELETE /sync-history/:entryId` | `24f7c65` (RED), `7565d1d` (GREEN) |
| 2 | SSYNC-V125-13..-17 closed; ROADMAP `Plans: TBD` replaced | `5a2a303` |
| 3 | **BLOCKING checkpoint — awaiting the operator** | — |

21 tests in `packages/server/tests/routes.schema-apply.spec.ts`, all green: 3 `GATE-`,
2 `ONECALL-`, 4 `REFUSE-`, 3 `PERSIST-`, 4 `READ-`, 5 `DELETE-`. All fixtures synthetic
(`demo_schema.demo_table`, `col_a`, `col_b`, `col_ts`, `col_gone`, `demo_operator`); no
dataset-specific name appears on any added line of either file.

## Verbatim Declarations

**Phase 126 is planned against all of this.** Reproduced exactly as shipped.

### 1. The three routes

```ts
// packages/server/src/index.ts
app.post(
  "/api/tables/:id/schema-apply",
  requireConfig,
  ...requirePermission(PERMISSIONS.DATASETS_MANAGE),
  ...requirePermission(PERMISSIONS.DASHBOARDS_MANAGE_ACCESS),
  asyncHandler(async (req, res) => { ... })
);

app.get(
  "/api/tables/:id/sync-history",
  ...requirePermission(PERMISSIONS.DATASETS_MANAGE),
  ...requirePermission(PERMISSIONS.DASHBOARDS_MANAGE_ACCESS),
  (req, res) => { ... }
);

app.delete(
  "/api/tables/:id/sync-history/:entryId",
  ...requirePermission(PERMISSIONS.DATASETS_MANAGE),
  ...requirePermission(PERMISSIONS.DASHBOARDS_MANAGE_ACCESS),
  (req, res) => { ... }
);
```

`requireConfig` is on the apply ONLY. The two history routes touch no Kinetica connection, so
they are permission-gated but not config-gated — the `column-display-config` and
`custom-metrics` precedent.

### 2. Status-code map

| Route | Code | When |
|---|---|---|
| `POST /schema-apply` | **200** | `outcome: "applied"` (`kind: "baseline"` or `"diff"`) |
| `POST /schema-apply` | **200** | `outcome: "no_changes"` — not an error; a truthful answer to a reasonable question |
| `POST /schema-apply` | **400** | `live` absent, not an object, an array, or an EMPTY object. Body `{ error: string }`. **No Kinetica call is made.** |
| `POST /schema-apply` | **403** | missing `datasets:manage` OR missing `dashboards:manage_access` |
| `POST /schema-apply` | **404** | unknown table id. Body `{ error: "Table not found." }`. **No Kinetica call is made.** |
| `POST /schema-apply` | **409** | `outcome: "stale"` — Kinetica moved after the report was built |
| `POST /schema-apply` | **409** | `outcome: "table_missing"` — Kinetica no longer has the table |
| `POST /schema-apply` | **502** | `/show/table` unreachable, unreadable, or present-with-no-readable-columns |
| `GET /sync-history` | **200** | the `TableSyncHistory` object |
| `GET /sync-history` | **403 / 404** | gate failure / unknown table id |
| `DELETE /sync-history/:entryId` | **204** | deleted; empty body |
| `DELETE /sync-history/:entryId` | **403 / 404** | gate failure / unknown entry id **or an entry belonging to a different table** |

**Two distinct `table_missing` situations — Phase 126 must not conflate them.**
- *Kinetica* no longer has the table → **409**, and the `message` is
  `tableMissingResult(qualified).message` (the check's own wording, spread in, plus `tableId`).
- An unknown table *row* → **404** `{ error: "Table not found." }`, raised before
  `applySchemaSync` is ever called.

Consequently `applySchemaSync`'s own `table_missing` arm — and therefore
`SCHEMA_APPLY_TABLE_MISSING_MESSAGE` — is **unreachable through the HTTP surface**. See
"Findings for the checkpoint" below.

### 3. The apply request body

```ts
{ live: ColumnFingerprintMap }   //  Record<string, { base: string; refinements: string[] }>
```

`live` is the map the check response already handed the client, echoed back unchanged. It is
the `reportedLive` argument — the route re-reads Kinetica itself for the authoritative `live`.
**An empty map is rejected with 400.**

### 4. The apply response union (`SchemaApplyResult`, Plan 125-03, unchanged)

```ts
export type SchemaApplyResult =
  | {
      outcome: "applied";
      kind: "baseline" | "diff";
      table: string;
      tableId: number;
      recorded: true;
      historyId: number;
      /** How many older entries this apply pushed out of the 20-entry cap. */
      droppedThisApply: number;
      /** The map written to tables.columns, echoed so the caller need not re-read. */
      columns: Record<string, string>;
      changeset: SyncChangeset | null;
      message: string;
    }
  | { outcome: "no_changes"; table: string; tableId: number; message: string }
  | { outcome: "stale"; table: string; tableId: number; message: string }
  | { outcome: "table_missing"; table: string; tableId: number; message: string };
```

The 409 `table_missing` body the ROUTE emits is `{ outcome, table, message, tableId }` — the
same four keys, with `message` from `tableMissingResult`.

### 5. The `GET /sync-history` read shape (`TableSyncHistory`, Plan 125-01, unchanged)

```ts
export type TableSyncHistory = {
  /** Newest first, ordered by id DESC. At most SYNC_HISTORY_CAP long. */
  entries: TableSyncHistoryEntry[];
  droppedCount: number;
  lastDroppedTs: string | null;
  /** Echoed so the UI never hardcodes the number. */
  cap: number;
};

export type TableSyncHistoryEntry = {
  id: number;
  table_id: number;
  ts: string;
  actor: string;
  kind: "baseline" | "diff";
  /** null for a baseline entry -- establishing a first fingerprint has no changeset. */
  changeset: SyncChangeset | null;
  /** null for a baseline entry. Otherwise the ImpactReport exactly as it was built. */
  report: ImpactReport | null;
};
```

`cap` is **20**. The UI must read it, never hardcode it. A table with no history returns
`{ entries: [], droppedCount: 0, lastDroppedTs: null, cap: 20 }` — asserted by `READ-empty`.

### 6. The six operator-facing strings — AS SHIPPED, **NOT YET APPROVED**

Read out of `packages/server/src/lib/schemaApply.ts` at the stated lines, not copied from the
plan. Task 3 replaces this heading with the approved text once the operator answers.

```ts
// :60
export const SCHEMA_APPLY_STALE_MESSAGE =
  "Kinetica's columns changed again after this report was built, so applying it would store " +
  "a snapshot you have not seen. Nothing was written. Re-run the check to see the current " +
  "state, then apply that.";

// :146
export const SCHEMA_APPLY_TEXT_WIDTH_GAP =
  "Kinetica's /show/table carries no marker for an unrestricted-length string column, so " +
  "a column INFORMATION_SCHEMA reported as `text` is stored as `string` after an apply and " +
  "becomes selectable in the drill-down picker. This report does NOT detect that case.";

// :217
export const SCHEMA_APPLY_BASELINE_MESSAGE =
  "Baseline established. This table's snapshot predated precise type capture, so there was " +
  "nothing to compare against -- the live column set is now stored exactly, and the next " +
  "check can report type changes.";

// :222
export const SCHEMA_APPLY_NO_CHANGES_MESSAGE =
  "Nothing to apply -- the stored snapshot already matches Kinetica. No history entry was " +
  "recorded, because nothing changed.";

// :226
export const SCHEMA_APPLY_TABLE_MISSING_MESSAGE =
  "That registered table no longer exists in this app, so there is nothing to apply to.";

// :229
export const schemaApplyDiffMessage = (c: SyncChangeset): string =>
  `Applied. The stored snapshot now matches Kinetica: ${c.added.length} added, ` +
  `${c.removed.length} removed, ${c.retyped.length} retyped. The changeset and the impact ` +
  `report as it stood are kept in this table's sync history.`;
```

`schemaApplyDiffMessage` RENDERED for a concrete changeset of 1 added / 2 removed / 1 retyped
(executed, not transcribed):

> Applied. The stored snapshot now matches Kinetica: 1 added, 2 removed, 1 retyped. The
> changeset and the impact report as it stood are kept in this table's sync history.

## Mutation probes — 9/9 FIRED (8 planned + 1 bonus), none required strengthening

Each probe was applied to the COMMITTED source, `tests/routes.schema-apply.spec.ts` re-run, then
reverted with `git checkout --` and `git diff --exit-code -- packages/server/src/index.ts`
confirmed clean after every one.

| # | Mutation | Must redden | Outcome |
|---|----------|-------------|---------|
| P1 | drop `...requirePermission(PERMISSIONS.DASHBOARDS_MANAGE_ACCESS)` from schema-apply | `GATE-datasets-only` | **FIRED** (exactly 1) |
| P2 | drop the same line from `GET /sync-history` | `READ-gate` | **FIRED** (exactly 1) |
| P3 | remove `showOptions: { no_error_if_not_exists: "true" }` from the apply's call | `ONECALL-showtable` | **FIRED** (exactly 1) |
| P4 | return 200 instead of 409 for `outcome: "stale"` | `REFUSE-stale` | **FIRED** (exactly 1) |
| P5 | move the body validation to AFTER `kineticaShowTable` | `REFUSE-badbody` | **FIRED** (exactly 1) |
| P6 | `entry.table_id !== id` → `false` | `DELETE-wrong-table` | **FIRED** (exactly 1) |
| P7 | apply on `presence === "missing"` instead of returning 409 (writes an empty column set) | `REFUSE-missing` | **FIRED** (exactly 1) |
| P8 | pass a literal `"system"` for `actor` | `PERSIST-actor` | **FIRED** (exactly 1) |
| P9 (bonus) | move the unknown-id 404 to AFTER the Kinetica call | `REFUSE-404` | **FIRED** (exactly 1) |

### P5's first attempt was a NON-RESULT, not a non-firing probe — recorded because it nearly wasn't

The first P5 script anchored the re-insertion point on
`showOptions: { no_error_if_not_exists: "true" },\n      });`, which occurs **twice** in
`index.ts` — the schema-check route has the identical two lines. The assertion tripped, the
mutation was never written to disk, and the suite reported `12 passed`. Read carelessly that is
indistinguishable from "the probe did not fire", which under the project rules would have sent
me off strengthening a test that was already fine.

It was re-run with a route-scoped anchor (including the `route: "POST /api/..."` tag line), the
mutation confirmed present in the tree via `git diff --stat` **before** the suite ran, and it
fired on `REFUSE-badbody`. Every probe in the table above was re-verified the same way.

### P6's first attempt was also a non-result — the revert ate uncommitted work

P2's `git checkout -- src/index.ts` reverted to the last commit, which at that moment did not
yet contain Task 2's routes (they were still unstaged). The following P6 run therefore executed
against a tree with no sync-history routes at all and reported 6 failures — meaningless. The
routes were restored, `tsc` and the suite re-confirmed green, the work committed, and P6 re-run
against committed source, where it fired on `DELETE-wrong-table` alone. **Probes must be run
against COMMITTED source; the `git checkout --` revert makes that mandatory, not advisory.**

## Acceptance criteria — all RUN, actual output recorded

Every "before" value was measured before any code was written (the doc criteria re-measured
against `git show HEAD:` after the fact, which is the same tree).

### Task 1

| # | Criterion | Expected | Actual |
|---|---|---|---|
| 1 | `grep -c '"/api/tables/:id/schema-apply"' src/index.ts` | 1 | **1** (before: `grep -c "schema-apply"` = 0) |
| 2 | `grep -A3 '"/api/tables/:id/schema-apply"' \| grep -c DASHBOARDS_MANAGE_ACCESS` | 1 | **1** (before: 0) |
| 3 | `grep -c "applySchemaSync(" src/index.ts` | 1 | **1** (before: 0) |
| 4 | `grep -c "POST /api/tables/:id/schema-apply" src/index.ts` | 1 | **1** (before: 0) |
| 5 | `grep -A45 '"/api/tables/:id/schema-apply"' \| grep -c "kineticaShowTable("` | 1 | **1** (before: 0) |
| 6 | same window, `grep -cE "^\s*try \{"` | 0 | **0** |
| 7 | NO-FORCE, added non-comment lines | 0 | **0** — and proven live, see below |
| 8 | `it("GATE-` / `ONECALL-` / `REFUSE-` / `PERSIST-` | ≥3 / ≥2 / ≥4 / ≥3 | **3 / 2 / 4 / 3**, 12/12 green (before: all four prefixes 0 across `tests/`) |
| 9 | `grep -c "not.toHaveBeenCalled()"` | ≥2 | **3** — weakly discriminating, see below |
| 10 | `grep -c "seedDatasetsManageOnlySession"` | ≥2 | **3** at Task 1 (**5** now) — weakly discriminating, see below |
| 11 | dataset hygiene, ADDED lines only | 0 | **0**, guard proven live (planted name drives it 0 → 1) |
| 12 | `npx tsc --noEmit` + `node scripts/test-gate.mjs` | clean + GATE PASSED | **clean + GATE PASSED** |
| 13 | `git diff --name-only 688ff43 \| grep -c '^packages/web/'` | 0 | **0** |

### Task 2

| # | Criterion | Expected | Actual |
|---|---|---|---|
| 1 | the two sync-history path literals | 1 / 1 | **1 / 1** (before: `grep -c "sync-history"` = 0) |
| 2 | second gate, scoped to each route's own `-A3` window | 1 / 1 | **1 / 1** (before: 0 / 0) |
| 3 | `grep -c "entry.table_id !== id" src/index.ts` | 1 | **1** (before: 0 under `packages/`) |
| 4 | `listTableSyncHistory(` / `deleteTableSyncHistoryEntry(` | 1 / 1 | **1 / 1** (before: 0 / 0) |
| 5 | `it("READ-` / `it("DELETE-`, spec green | ≥3 / ≥4 | **4 / 5**, 21/21 green (before: 0 / 0 across `tests/`) |
| 6 | `grep -c 'it("DELETE-wrong-table'` | 1 | **1** |
| 7 | `grep -c "^- \[x\] \*\*SSYNC-V125-1[34567]\*\*" REQUIREMENTS.md` | 5 | **5** (before: 0) |
| 8 | `grep -c "^\| SSYNC-V125-1[34567] .*\| Complete \|" REQUIREMENTS.md` | 5 | **5** (before: 0) |
| 9 | `SSYNC-V125-18` occurrences unchanged / not closed | 2 / 0 | **2 / 0** |
| 10 | `125-04-PLAN.md` in ROADMAP = 1; Phase-125-scoped `TBD` = 0 | 1 / 0 | **1 / 0** (before: 0 / **1**). Phase 126's own `TBD` verified still present |
| 11 | `npx tsc --noEmit` + `node scripts/test-gate.mjs` | clean + GATE PASSED | **clean + GATE PASSED** |
| 12 | web zero diff | 0 | **0** |

### Criteria that could not fully discriminate

**Criterion 1.10 (`grep -c "seedDatasetsManageOnlySession" ≥ 2`) is the project's own documented
anti-pattern, one more time.** The file header carries a mandated comment naming the four
helpers copied from the check suite, and that comment contains the token. So at Task 1 the count
was **3**: one comment mention (line 46), one definition (line 69), one call site (line 252).
**The threshold of 2 is met by the comment plus the definition alone — with the fixture never
once used in a test.** It cannot distinguish "the AND-gate's second half is actually exercised"
from "the helper exists and is mentioned in prose". This is the same mechanism CLAUDE.md records
four times from Phase 124 and once each from 125-01/-02/-03: a plan mandates doc text, then greps
a token that text contains.

Nothing was changed to accommodate it. The real requirement was verified directly: the fixture
has **three** call sites (lines 252, 564, 680 — `GATE-datasets-only`, `READ-gate`,
`DELETE-gate`), and probes **P1 and P2 fired on two of them**, which is a behavioural proof the
grep cannot give. The corrected form for a future plan is to count call sites, e.g.
`grep -c "= seedDatasetsManageOnlySession(\|} = seedDatasetsManageOnlySession("`, or simply to
name the tests.

**Criterion 1.9 (`grep -c "not.toHaveBeenCalled()" ≥ 2`) is weakly discriminating** for the same
family of reason as 125-03's criterion 2.6: it counts LITERALS, not assertion sites. The three
occurrences are at lines 374 and 384 — **both inside `REFUSE-badbody`** — and 402, in
`REFUSE-404`. The threshold of 2 is therefore satisfiable by `REFUSE-badbody` alone, with
`REFUSE-404` asserting nothing about Kinetica at all, which is precisely the case the criterion
exists to prevent.

The real requirement was verified directly, one probe per site: **P5** (body validation moved
after the Kinetica call) reddens `REFUSE-badbody`, and bonus probe **P9** (the unknown-id 404
moved after the Kinetica call) reddens `REFUSE-404`. Both assertions are load-bearing.

**Criteria 1.7 (NO-FORCE) and 1.11 (dataset hygiene) are 0-before / 0-after prohibition guards,
which is the correct shape — and both were proven capable of failing rather than assumed.**
- 1.7: the diff-anchored form reads **0**; dropping the comment filter reads **2** (the route's
  own "There is no force flag" / "no force flag" prose), so the `grep -vE '^\+\s*(\*|//|--)'`
  filter is genuinely load-bearing and not decorative. Piping one planted CODE line
  (`+ const force = req.body.force;`) into the same stream drives it **0 → 1**.
- 1.11: piping one planted banned name into the diff stream drives it **0 → 1**.

**Criterion 1.6's `-A45` window is adequate but tight.** The apply handler's body is longer than
45 lines once its comment block is counted; the window covers the route declaration through the
`kineticaShowTable` call, which is where a `try {` would have to sit to wrap the upstream call.
It would NOT catch a `try {` added late in the handler. The stronger statement is the structural
one already true and visible in the diff: the handler contains no `try` at all.

All other criteria read 0 (or failed) before the work and pass now.

## Findings for the checkpoint

**1. `SCHEMA_APPLY_TABLE_MISSING_MESSAGE` is unreachable through the HTTP surface.** The route
404s on an unknown table id *before* `applySchemaSync` is called, and the Kinetica-dropped case
returns `tableMissingResult`'s wording instead. There is no request that can make the API emit
"That registered table no longer exists in this app, so there is nothing to apply to." Phase 126
will therefore never render it. It remains correct as a library-level contract and is reachable
by a direct `applySchemaSync` caller, but the operator is being asked to approve wording the UI
cannot show. Flagged rather than silently deleted — removing it would weaken the lib's contract,
and the decision is the operator's.

**2. The plan's own `<action>` text and the executor's wiring contract disagreed about the
status code for `table_missing`** (404 in the handoff notes, 409 in the plan's code and in the
`REFUSE-missing` behaviour spec). The plan's code was followed. Because of finding 1 the
`applySchemaSync`-sourced arm is unreachable, so the disagreement is cosmetic — but Phase 126's
client should be written against **409 for a Kinetica-dropped table, 404 for an unknown row**.

**3. `SCHEMA_APPLY_TEXT_WIDTH_GAP` is a string with no emitter.** It is exported and pinned by
`RENDER-text-gap`, but nothing in the apply path attaches it to a response. If Phase 126 is to
surface the gap to the operator, it must import and render the constant itself — no route hands
it over. That is consistent with 125-02's intent (the gap is documentation for the UI to
display), but it is not wired, and "the known gap is surfaced rather than hidden" is currently
true only of the source file.

## Known Gaps Carried

Consolidated from 125-01..03 plus this plan, so Phase 126 plans against them rather than
rediscovering them in front of a live instance.

**1. `text` → `string`: drill-down over-inclusion (`SCHEMA_APPLY_TEXT_WIDTH_GAP`).** Kinetica's
`/show/table` exposes no marker for an unrestricted-length string column, so such a column
fingerprints as `{base:"string", refinements:[]}` and renders `"string"`. INFORMATION_SCHEMA
reported `"text"`, which **is** a member of the web's `EXCLUDED_DRILLDOWN_TYPES`. After an apply,
a column previously excluded from the drill-down picker becomes selectable there. This is
*over-inclusion*, the direction `columnTypes.ts`'s D-01 comment already names as acceptable. It
is a real case, not hypothetical — `text` appears in the dev database's current `tables.columns`
vocabulary. **The report does not detect it, so Phase 126 must not imply that it does.** See
finding 3 above: the constant exists but no route emits it.

**2. The Kinetica BOOLEAN marker was NEVER live-probed — it is assumed, by name.** No
`/show/table` body carrying a boolean column has been captured in this phase or any prior one.
`TYPE_NAMING_REFINEMENTS` carries both `"boolean"` and `"bool"` defensively. If Kinetica's real
marker is a third spelling, a boolean column renders through `formatFingerprint` as
`int(<marker>)` → normalizes to `int` → classifies as a **number**. `classifyFingerprint`
carries the identical assumption one layer up, so the two agree and `PARITY-class` would **not**
catch it. Phase 126's live operator verification is the first real chance to close this.

**3. Precedence-order divergence between `renderColumnType` and `classifyFingerprint` —
theoretical, deliberately not fixed.** The two scan markers in different orders. They agree over
every live and documented Kinetica shape because a numeric-type-literal refinement never
co-occurs with a temporal, boolean or spatial marker. `PARITY-class` proves agreement over the
fixture table, not in general.

**4. Five of the nine registered tables have been dropped from Kinetica.** A live check or apply
against most of them returns `table_missing` — now a **409** from the apply route. **Expected
behaviour, not a defect.** Phase 126's live operator verification should plan around it: only
about four registered tables can exercise a real diff-and-apply, and the operator will need to
alter one of those deliberately to see a non-trivial changeset.

**5. Criterion 2 ("only the `tables` row changed") cannot be proven by content comparison alone
in this schema.** `db.ts` declares zero `CREATE TRIGGER` statements, so nothing auto-bumps
`updated_at`; a value-identical UPDATE to any table is invisible to a row snapshot. 125-03's
`expectRowWriteBudget` (SQLite `total_changes()`) is what closes this. Any future plan asserting
"nothing else was written" must use a write budget, not a row diff.

## Deviations from Plan

**1. [Rule 2 - Missing critical coverage] Three tests beyond the plan's `<behavior>` list.**
- `READ-404` — an unknown table id on `GET /sync-history`. The plan's route code contains the
  `getTable(id)` guard but its `<behavior>` list named no test for it, so it would have shipped
  unproven.
- `DELETE-gate` — the plan gated the delete route but listed no gate test for it. Without this,
  a dropped `DASHBOARDS_MANAGE_ACCESS` spread on the DELETE route would have reddened nothing;
  the plan's probe table has no probe for it either.
- Bonus probe **P9** — run to give `REFUSE-404`'s `not.toHaveBeenCalled()` its own behavioural
  target, after criterion 1.9 was found unable to distinguish that assertion from
  `REFUSE-badbody`'s two.

**2. [Rule 3 - Blocking] `mockShowTableOk` could not be copied verbatim from the check suite.**
- **Found during:** Task 1, writing `PERSIST-diff`.
- **Issue:** The check suite's helper is `vi.fn().mockResolvedValue(new Response(...))`, which
  hands out the SAME `Response` instance on every call. A `Response` body can be consumed only
  once, so the second call in a round-trip (apply, then schema-check on one mock) would throw.
- **Fix:** This file's helper uses `mockImplementation` to build a FRESH `Response` per call. The
  divergence and its reason are stated in a comment above it. `showTableEnvelope`,
  `seedAnalystSession`, `seedDatasetsManageOnlySession` and `setStoredFingerprint` are still
  copied verbatim as the plan required.
- **Commit:** `093382b`

**3. [Rule 2 - Missing critical coverage] A third session fixture, `seedSchemaSyncSession`.**
- **Found during:** Task 1, writing `PERSIST-actor`.
- **Issue:** The plan's fixture list offers only an analyst, a datasets-manage-only user and the
  admin. Asserting the recorded `actor` against the admin fixture compares it to
  `APP_ADMIN_USERNAME` — a value several unrelated code paths also produce, which makes a weak
  claim about a field whose whole point is provenance.
- **Fix:** A custom role holding BOTH permissions, under the neutral username `demo_operator`.
  `PERSIST-actor` additionally asserts the actor is neither `"system"` nor the admin username.
  Probe P8 fires on it.
- **Commit:** `093382b`

**4. [Criterion defect, reported not fixed] Criteria 1.9 and 1.10 cannot fully discriminate** —
see "Criteria that could not fully discriminate". No code and no comment was changed to
accommodate either; the real requirements were verified directly by probes P1, P2, P5 and P9.

## Verification

- `cd packages/server && npx tsc --noEmit` → **clean**
- `cd packages/server && npx vitest run tests/routes.schema-apply.spec.ts` → **21/21 passed**
- `cd packages/server && node scripts/test-gate.mjs` → **GATE PASSED**, run twice.
  - Run 1 (after Task 1): 1478/1533 passed, the 8 documented `KNOWN_FAILING` plus 2 contamination
    files (`routes.dashboard-import.refs.spec.ts`, `routes.dashboard-layers-patch.spec.ts`), both
    re-run alone by the gate and passing — standard TD-V16-TEST-ISOLATION, whose extra set
    rotates between runs.
  - Run 2 (final): failing set was **exactly** the 8 documented `KNOWN_FAILING`, no contamination.
  - Never a bare `npx vitest run` as the gate; never a fixed pass-count; always from
    `packages/server`.
- `git diff --name-only 688ff43 | grep -c '^packages/web/'` → **0**. `packages/web` is untouched
  for the whole phase.
- All 9 mutation probes fired on their named targets;
  `git diff --exit-code -- packages/server/src/index.ts` clean after every one.
- **No `gsd-tools` mutation command was run.** `REQUIREMENTS.md` and `ROADMAP.md` were edited by
  hand, and the ROADMAP edit was re-read in place to confirm it landed under the Phase 125
  heading with Phase 126's own `TBD` intact.

## ROADMAP criteria status

| # | Criterion | Proven by |
|---|---|---|
| 1 | after applying, the table's metadata returns the live Kinetica columns | `PERSIST-diff` — applies, then re-runs `GET /schema-check` on the SAME live body through the app's own read path and gets `hasChanges: false` |
| 2 | only the `tables` row changed | 125-03's `ONLYTABLES-` full-row snapshot + `total_changes()` budget of exactly 2; probes P10/P10b fire there |
| 3 | removals + retypes apply, no force, no findings gate | `PERSIST-breaking` (200 `applied` on a changeset with 1 added / 1 removed / 1 retyped) + the diff-anchored `\bforce\b` guard; there is no parameter to pass |
| 4 | the entry holds ts, changeset and report, readable afterwards | `READ-after-apply` round-trips all five fields through the route; `PERSIST-actor` proves provenance |
| 5 | an entry deletes on its own, leaving the others and the schema untouched | `DELETE-one` (204, other entry present, `tables` row byte-identical), `DELETE-wrong-table` (probe P6), `DELETE-keeps-dropped` |

## Checkpoint (Task 3) — NOT YET ANSWERED

**Type:** `checkpoint:human-verify`, gate `blocking`.
**Automated precondition:** the six-constant grep prints **6** — verified.
**Status as of 2026-09-25: awaiting the operator.** The six strings are pinned above exactly as
they appear in the tree, with their line numbers, and `schemaApplyDiffMessage` is rendered for a
real 1/2/1 changeset rather than shown as a template. On an answer, the approved text (or the
replacement wording, with the constant edited and the three specs re-run) replaces § "The six
operator-facing strings" above, and the outcome and date are recorded here.

## Self-Check: PASSED

- `packages/server/tests/routes.schema-apply.spec.ts` — FOUND (created)
- `packages/server/src/index.ts` — FOUND (modified)
- `.planning/REQUIREMENTS.md` — FOUND (modified)
- `.planning/ROADMAP.md` — FOUND (modified)
- Commits `093382b`, `4612526`, `24f7c65`, `7565d1d`, `5a2a303` — all FOUND in `git log`
