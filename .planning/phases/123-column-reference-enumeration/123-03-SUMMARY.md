---
phase: 123-column-reference-enumeration
plan: 03
subsystem: database
tags: [column-reference-enumeration, schema-sync, pure-lib, layer-config, malformed-json-fallback]

# Dependency graph
requires:
  - phase: 123-column-reference-enumeration
    provides: "123-01's frozen ColumnRef contract + 40-entry COLUMN_REF_SITES registry; 123-02's resolveWidgetTableId / emitStructured shared emitters to mirror"
provides:
  - "resolveLayerTableId — the same dv-authority-over-cache table-resolution rule as resolveWidgetTableId, applied to DashboardLayer"
  - "All 11 layer.* COLUMN_REF_SITES entries implemented: 4 layer.config.* spatial bindings, cb_config.attr, 4 track_config.* fields, info_columns, info_template"
  - "The malformed-JSON fallback: a corrupt cb_config/track_config/info_columns TEXT blob downgrades to a heuristic (or low-confidence) finding via scanFreeSql over the raw string, keeping the record's own tableId/tableScope, instead of silently reporting nothing"
  - "The layer half of the exclude-list guard (EXCLUDED_LOOKALIKE_KEYS), proving the layer traversal is path-driven, not value-driven"
affects: [124-column-impact-report, 125-schema-sync-apply-and-history, 123-04]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "resolveLayerTableId: literal duplicate of resolveWidgetTableId's three-step dv-authority rule, kept side by side in the file for a record kind instead of a widget config"
    - "readJsonString + emitMalformedJsonFallback: a TEXT-column JSON parse failure fails toward REPORTING (heuristic/low-confidence, record's own table kept) rather than swallowing like coalesceTrackConfig does"
    - "One per-layer loop, extended across three tasks (config fields, then cb_config/track_config, then info_columns/info_template), because each TEXT column must be parsed once per layer, not once per site"
    - "info_template placeholder scanning is a dedicated regex over raw HTML ({ColumnName}), never scanFreeSql — a different shape from every other site in the registry"

key-files:
  created: []
  modified:
    - packages/server/src/lib/columnRefs.ts
    - packages/server/tests/lib.columnRefs.spec.ts

key-decisions:
  - "resolveLayerTableId checks layer.dynamic_view_id FIRST (dv is authority), layer.table_id only as fallback — mirrors resolveWidgetTableId exactly; a dangling dv reference never falls back to the cached table_id"
  - "The malformed-JSON fallback emits confidence heuristic/low-confidence (via the SAME isLowConfidenceColumnName rule as free-SQL) but tableId/tableScope from the RECORD's own resolution, NOT null/'free-sql' — the record's table is still known, only the exact JSON path inside the corrupt blob could not be proven"
  - "cb_config/track_config/info_columns are each parsed ONCE per layer via readJsonString and read by named key only, never Object.keys(parsed)/for-in, so styling siblings (breaks[].color, headColor, etc.) can never false-positive"
  - "A null/empty info_columns means ALL COLUMNS and is deliberately skipped, never defaulted to 'everything matches' — the alternative would flood the report with a finding for every layer on every query"
  - "info_template placeholder matching is EXACT and case-SENSITIVE against the trimmed {…} body, using a dedicated regex — never scanFreeSql, since this is HTML with a different lookaround shape than SQL"

requirements-completed: [SSYNC-V125-07]

# Metrics
duration: ~70min
completed: 2026-09-23
---

# Phase 123 Plan 03: Layer Structured + JSON-String Sites Summary

**All 11 `layer.*` column-reference sites (4 `layer.config.*` spatial bindings, `cb_config.attr`, 4 `track_config.*` fields, `info_columns`, `info_template`) plus `resolveLayerTableId` and the malformed-JSON fallback that keeps a corrupt stored blob from silently erasing a reference.**

## Performance

- **Duration:** ~70 min
- **Tasks:** 3 completed
- **Files modified:** 2 (both already existed from Plans 123-01/02)

## Accomplishments

- Shipped `resolveLayerTableId` (exported, verbatim signature below), the SAME three-step dv-authority-over-cache rule as `resolveWidgetTableId`, applied to `DashboardLayer` — proven by a SYNTHETIC fixture where a layer's cached `table_id` disagrees with its dv's `source_table_id`, and the dv wins.
- Implemented all 11 of this plan's `COLUMN_REF_SITES` entries: `layer.config.latColumn`/`lonColumn`/`wktColumn`/`wkbColumn`, `layer.cb_config.attr`, `layer.track_config.trackIdAttr`/`trackOrderAttr`/`xCol`/`yCol`, `layer.info_columns`, `layer.info_template`.
- Shipped the malformed-JSON fallback (`readJsonString` + `emitMalformedJsonFallback`): a corrupt `cb_config`/`track_config`/`info_columns` TEXT blob now downgrades to a heuristic (or low-confidence) finding carrying the raw text's matched line/offset, keeping the record's own `tableId`/`tableScope`, instead of returning silently the way `coalesceTrackConfig` does for renderers. Amended the `ColumnRef.matches` doc comment to name this third case.
- Extended the exclude-list guard with a layer fixture planting `vendor_id` under every `EXCLUDED_LOOKALIKE_KEYS` path (zero findings), paired with the companion assertion that setting `latColumn` on the same fixture DOES fire — now discriminating, since the layer traversal exists for it to guard.
- 22 new tests (84 total, up from 62 after Plan 123-02); all 17 mutation probes fired and reddened their named test (one, P14, required strengthening the test fixture first, per CLAUDE.md).
- `tsc --noEmit` clean in both packages; server test-gate SET unchanged (8/8 documented `KNOWN_FAILING`, 1324/1377 passing); `dashboardExportRefs.ts` sha256 unchanged (`52fd42722d68e650673ba281a979cd79734a5f7b1f49d813877040a6fa8cfe9d`); zero `packages/web` diff; `COLUMN_REF_SITES` still exactly 40 entries.

## Task Commits

1. **Task 1: resolveLayerTableId and the four layer.config column bindings** - `e96348c` (feat)
2. **Task 2: cb_config.attr, the four track_config fields, and the malformed-JSON fallback** - `4a28649` (feat)
3. **Task 3: info_columns, info_template placeholders, and the layer half of the exclude guard** - `de828bc` (feat)
4. **Mutation-probe fixture strengthening (P14)** - `f9de819` (test)

**Plan metadata:** pending — see final commit in this response.

## Files Created/Modified

- `packages/server/src/lib/columnRefs.ts` — added `resolveLayerTableId` (exported), `readJsonString`, `emitMalformedJsonFallback`, and one per-layer loop implementing the 11 layer sites (extended incrementally across the three tasks so each TEXT column is parsed once per layer, not once per site); amended the `ColumnRef.matches` doc comment.
- `packages/server/tests/lib.columnRefs.spec.ts` — added `makeLayer`, 3 new `describe` blocks (`layer config column bindings`, `layer JSON-string sites`, `layer info popup sites`), 22 new tests, 2 new `EXCLUDE:` tests extending the guard to 6 total.

## `resolveLayerTableId` — verbatim (mirrors resolveWidgetTableId; Plan 123-04 does not need this function but should be aware it exists for layers)

```ts
export const resolveLayerTableId = (
  layer: DashboardLayer,
  dynamicViews: DashboardDynamicView[],
): { tableId: number | null; tableScope: ColumnRefTableScope } => {
  const dvId = asPositiveInt(layer.dynamic_view_id);
  if (dvId !== undefined) {
    const dv = dynamicViews.find((d) => d.id === dvId);
    if (dv) return { tableId: dv.source_table_id, tableScope: "scoped" };
    return { tableId: null, tableScope: "unresolved" };   // dangling dv -> NEVER fall back to table_id
  }
  const tableId = asPositiveInt(layer.table_id);
  if (tableId !== undefined) return { tableId, tableScope: "scoped" };
  return { tableId: null, tableScope: "unresolved" };
};
```

Rules, in order (do not reorder — mutation probe P12 proves reordering breaks the dv-authority guarantee): (1) `layer.dynamic_view_id` present and resolves -> the dv's `source_table_id` wins, even when it disagrees with the cached `layer.table_id`. (2) `layer.dynamic_view_id` present but dangling -> `unresolved`, reported regardless of the queried table — never silently falls back to the cache. (3) No `dynamic_view_id` -> `layer.table_id` directly. (4) Neither -> `unresolved`.

## The Malformed-JSON Fallback — the rule in full (Phase 124 must plan against this combination)

**Trigger:** `layer.cb_config`, `layer.track_config` or `layer.info_columns` is a non-null, non-empty string that fails `JSON.parse`.

**Behavior:** `readJsonString` reports `{ parsed: undefined, malformed: true }`. The caller then runs `scanFreeSql(rawString, column)` over the RAW stored text (not a masked or re-serialized copy) and, if that scan finds at least one match, emits exactly ONE `ColumnRef` at the site that owns the record's primary column-bearing field:

| Malformed column | Fallback site |
|---|---|
| `cb_config` | `layer.cb_config.attr` |
| `track_config` | `layer.track_config.trackIdAttr` |
| `info_columns` | `layer.info_columns` |

The emitted finding carries:
- **`confidence`**: `isLowConfidenceColumnName(column) ? "low-confidence" : "heuristic"` — the SAME rule free-SQL sites use. The exact JSON path could not be proven, so the claim is no stronger than a text match.
- **`tableId` / `tableScope`**: taken from the RECORD's own `resolveLayerTableId(...)` result — **NOT** `null` / `"free-sql"`. This is the detail Phase 124 must plan against: a malformed-JSON finding looks exactly like an ordinary heuristic finding in every field except that its `site` is one normally associated with `confidence: "exact"`. Phase 124's grouping-by-record logic (already required per 123-01-SUMMARY.md for the `metricColumn`/`config.sql` pairing) must not assume "this site is always exact" — the malformed-JSON fallback proves that assumption false for the cb_config/track_config/info_columns family specifically.
- **`matches`**: from `scanFreeSql`, non-empty (a fallback that finds zero matches emits nothing, per the rule "report what the raw text actually contains, never manufacture a finding out of nothing").

**Why it exists:** `coalesceTrackConfig` (`packages/web/src/lib/trackConfig.ts`) returns `{ enabled: false }` on a parse failure — correct for a renderer (a plain layer beats a crash), catastrophic for an impact report (a blob that fails to parse would otherwise silently contribute zero findings, and the operator would read "not affected" for a layer that may in fact reference the dropped column). Mutation probe P13 confirms: swallowing the malformed case silently (the `coalesceTrackConfig` pattern) reddens the "malformed JSON still reports" test.

## The Five SYNTHETIC-Only Layer Sites — Risk Stated Explicitly

| Site | Why SYNTHETIC | Re-verify first if... |
|---|---|---|
| `layer.config.wkbColumn` | ZERO instances in `kinetica.db` or `env-b.db`; only `wktColumn` is ever populated (1 row, 4 rows respectively). `TD-V14-WKB-SPIKE` gates WKB at 501 throughout the app — a sleeper field, not a dead one. | Production ever populates a `wkbColumn` value with a shape other than a plain column-name string. |
| `layer.track_config.xCol` | Real `TrackConfig` field (Phase 52) that ZERO stored `track_config` rows in either database set — every real row uses only `trackIdAttr`/`trackOrderAttr` plus styling. | A future track-points feature starts writing `xCol`/`yCol` and the stored shape differs from the type declaration. |
| `layer.track_config.yCol` | Same as `xCol`. | Same as `xCol`. |
| `layer.info_columns` | 0/10 (`kinetica.db`) and 0/8 (`env-b.db`) layers populated. No operator has ever configured an info-popup column override in either environment; the persisted shape is inferred from the writer (`KineticaWmsLayerForm.tsx`) and the type (`packages/server/src/types.ts`), never observed. | Production data ever shows a non-array, non-null `info_columns` value, or an array containing non-string entries. |
| `layer.info_template` | Same zero-instance status as `info_columns`, same inference-not-observation caveat. Additionally the ONE structured site whose findings carry `matches` (line/offset), and the one site not scanned via `scanFreeSql` — a genuinely different code path from every other site in the registry. | Production ever shows a placeholder syntax other than `` `{${col}}` `` (spaces, nesting, or a different delimiter). |

A site with no real data behind it is where a bug survives a suite built from real fixtures — restated here per 123-CONTEXT.md's own instruction, not only asserted in the tests' own titles.

## Real vs. SYNTHETIC Fixtures (full table)

| Site | Fixture | Status |
|---|---|---|
| `layer.config.latColumn`, `layer.config.lonColumn` | layer 4 (real, table 1, `pickup_latitude`/`pickup_longitude`) | REAL |
| `layer.config.wktColumn` | layer 4's own config copy with `wktColumn` set to a real-shaped value | REAL shape, synthetic value (layer 4's own `wktColumn` is `""`; a populated real row exists elsewhere in the dev DB per 123-RESEARCH.md) |
| `layer.config.wkbColumn` | synthetic layer | **SYNTHETIC** — zero instances anywhere |
| `layer.cb_config.attr` | layer 4 (real, `attr: "passenger_count"`) | REAL |
| `layer.track_config.trackIdAttr`, `.trackOrderAttr` | layer 4 (real, `"TRACKID"`/`"TIMESTAMP"`) | REAL |
| `layer.track_config.xCol`, `.yCol` | synthetic layers | **SYNTHETIC** — zero instances anywhere |
| dv-scoping (SCOPE tests) | synthetic layer, dv 1 `source_table_id: 4` vs. layer `table_id: 1` (disagreeing on purpose) | **SYNTHETIC** — every real dv-bound layer's `table_id` already agrees with the dv |
| dangling-dv scoping | synthetic layer, `dynamic_view_id: 4242` | **SYNTHETIC** — every real dv reference in the dev DB resolves |
| malformed-JSON fallback | synthetic layer, truncated `cb_config` string | **SYNTHETIC** — no corrupt JSON exists in either database (by construction: the app writes it) |
| `layer.info_columns`, `layer.info_template` | synthetic layer 9301 | **SYNTHETIC** — see table above |
| layer exclude guard | synthetic layer 7101, `vendor_id` planted under every `EXCLUDED_LOOKALIKE_KEYS` path | **SYNTHETIC** — mirrors Plan 123-02's widget exclude fixture |

## Mutation Probes (17/17 verified)

Each probe was applied to the committed source, run against the full spec file (not `-t`-filtered, so collateral is visible), confirmed to redden the named test, then reverted via `git checkout -- src/lib/columnRefs.ts` before the next probe.

| # | Mutation | Named test | Result |
|---|----------|-----------|--------|
| P1 | Delete the `layer.config.latColumn` block | SITE layer.config.latColumn: ... | reddened (+3 collateral: 2 SCOPE tests + 1 EXCLUDE test that reuse `latColumn` as their probe field, expected) |
| P2 | Delete the `layer.config.lonColumn` block | SITE layer.config.lonColumn: ... | reddened, no collateral |
| P3 | Delete the `layer.config.wktColumn` block | SITE layer.config.wktColumn: ... | reddened, no collateral |
| P4 | Delete the `layer.config.wkbColumn` block | SITE layer.config.wkbColumn: ... (SYNTHETIC) | reddened, no collateral |
| P5 | Delete the `layer.cb_config.attr` block | SITE layer.cb_config.attr: ... | reddened, no collateral |
| P6 | Delete the `track_config.trackIdAttr` block | SITE layer.track_config.trackIdAttr: ... | reddened, no collateral |
| P7 | Delete the `track_config.trackOrderAttr` block | SITE layer.track_config.trackOrderAttr: ... | reddened, no collateral |
| P8 | Delete the `track_config.xCol` block | SITE layer.track_config.xCol: ... (SYNTHETIC) | reddened, no collateral |
| P9 | Delete the `track_config.yCol` block | SITE layer.track_config.yCol: ... (SYNTHETIC) | reddened, no collateral |
| P10 | Delete the `layer.info_columns` block | SITE layer.info_columns: ... (SYNTHETIC) | reddened, no collateral |
| P11 | Delete the `layer.info_template` block | SITE layer.info_template: ... (SYNTHETIC) | reddened, no collateral |
| P12 | In `resolveLayerTableId`, read `layer.table_id` first and only fall back to the dv | SCOPE: a layer bound through dynamic_view_id resolves through the dynamic view's source_table_id | reddened (+1 collateral: the dangling-dv SCOPE test, expected — its fixture also carries a real `table_id`) |
| P13 | Copy `coalesceTrackConfig`'s behaviour: return silently on a JSON parse failure | malformed JSON still reports: a truncated cb_config string yields a heuristic finding rather than silence | reddened, no collateral |
| P14 | Iterate the parsed `cb_config` object's keys instead of reading `attr` by name | cb_config styling fields are never findings: a break's shapeFillColor holding a column name yields nothing | reddened after strengthening the fixture (see below) |
| P15 | Make `info_template` placeholder matching case-insensitive | info_template placeholder matching is case-SENSITIVE and ignores surrounding HTML | reddened, no collateral |
| P16 | Treat a `null` `info_columns` as referencing every queried column | a null info_columns means ALL COLUMNS and yields no finding, because it names nothing | reddened (+3 collateral: the dv-authority SCOPE test and both EXCLUDE tests, expected — their fixtures also carry `info_columns: null`) |
| P17 | Add a generic walk over `layer.config`'s string values | EXCLUDE: a layer config with the queried column name planted under EVERY excluded key yields zero findings | reddened (+1 collateral: the companion "DOES yield a finding" EXCLUDE test, expected — it now over-counts) |

**One probe required strengthening a test first** (per CLAUDE.md: "if a probe does not redden, strengthen the TEST — never weaken the probe"):

- **P14:** The original fixture planted the queried column only inside `breaks[0].shapeFillColor` — a NESTED field. A shallow "iterate the parsed object's own top-level keys" mutation (which is what the probe table actually describes) can never reach a nested array element regardless of whether it reads `attr` by name or walks all top-level keys, so the mutation was a no-op against that fixture. Strengthened the fixture to ALSO plant the queried column under `valsType` (a top-level `cb_config` key) — a shallow top-level walk now discriminates, while the nested `breaks[].shapeFillColor` plant is kept in place as documentation of the deeper risk. Re-ran: reddens correctly, no collateral.

## Decisions Made

- **`resolveLayerTableId` exported and kept literally side-by-side with `resolveWidgetTableId`** in the source file (not merged into a single generic function) — per the plan's instruction that a reader should see at a glance the two are the same rule applied to two record kinds, without a shared abstraction that could drift independently later.
- **One per-layer loop, extended incrementally across all three tasks**, rather than three separate loops — because each TEXT column (`cb_config`, `track_config`, `info_columns`) must be `JSON.parse`d exactly once per layer, and splitting into separate loops would mean parsing (or re-deriving parse state) more than once per layer per column.
- **Malformed-JSON fallback keeps the record's `tableId`/`tableScope`, never `null`/`"free-sql"`** — a deliberate asymmetry from the ordinary FREE_SQL_SITES emitter (`emitFreeSql`), because the record's table IS known here; only the exact path inside its corrupt blob could not be proven. Documented above as the detail Phase 124 must plan against.
- **`info_template` uses a dedicated placeholder regex, never `scanFreeSql`** — the plan is explicit that the whole-identifier SQL lookaround is the wrong tool for HTML `{Column}` placeholders; confirmed by direct inspection that the actual implementation block contains zero calls to `scanFreeSql` (see Non-Discriminating Acceptance Criteria below).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] A code comment's own prose tripped a grep-based acceptance-criterion guard**
- **Found during:** Task 2 acceptance-criteria verification
- **Issue:** `node -e "...!/Object\.keys\(\s*parsed/.test(s)..."` (Task 2, criterion 5) was required to exit 0, but the module's own comment describing the design intent ("read by NAMED KEY ONLY — never Object.keys(parsed)/for...in") contained the literal text `Object.keys(parsed` inside its own disclaiming prose, despite the actual code doing no such enumeration.
- **Fix:** Reworded the comment to preserve identical meaning ("the parsed object's own key set is never enumerated generically") without the literal guarded substring.
- **Files modified:** `packages/server/src/lib/columnRefs.ts`
- **Verification:** the `node -e` check now exits 0; all 77 tests (at that point) still passed; `tsc --noEmit` clean.
- **Committed in:** `4a28649` (Task 2 commit — fixed before that commit was made, so it never landed broken)

---

**Total deviations:** 1 auto-fixed (mechanical comment wording; no scope creep, no behavior change).

## Non-Discriminating Acceptance Criteria (per CLAUDE.md — reported, not gamed)

**Task 3, acceptance criterion 5** (the `node -e` check that the `info_template` block never reuses `scanFreeSql`):

```
node -e "const s=...readFileSync('src/lib/columnRefs.ts','utf8');
const i=s.indexOf('info_template'); process.exit(i>=0 && !/info_template[\s\S]{0,800}scanFreeSql/.test(s) ? 0 : 1)"
```

This exits **1** (fails) as literally written, for reasons unrelated to the real requirement:
- `s.indexOf('info_template')` finds the **first** textual occurrence of that substring, which is inside the `ColumnRef.matches` field's doc comment near the top of the file ("...Non-empty for every FREE_SQL_SITES finding, for layer/configPatch **info_template** placeholder findings...") — a comment this and prior plans mandate be reproduced with that exact language, so it cannot be reworded away. The real `info_template` implementation block lives roughly 39,000 characters further down the file, entirely outside the checked 800-character window.
- Even scanning from the REAL implementation block's own start (`s.indexOf('info_template — Task 3')`), the word `scanFreeSql` DOES appear within the next few hundred characters — but only inside the block's own comment explicitly DISCLAIMING its use ("Does NOT use `scanFreeSql` — this is not SQL and the whole-identifier lookaround is the wrong tool"), never as an actual function call.

**Real requirement verified directly:** extracted the actual `info_template` implementation block (from its own `// info_template — Task 3` comment through the closing brace of its `if` statement) and grepped it in isolation: zero occurrences of `scanFreeSql(` as a call. The block instead scans with a dedicated `/\{([^{}]*)\}/g` regex over the raw template string, exactly as the plan's `<action>` specifies. This is additionally exercised indirectly by every `layer.info_template` test passing (case-sensitivity, no-placeholders, concrete line/offset) using behavior that `scanFreeSql`'s whole-identifier-with-underscore-boundary rule would not reproduce for `{Column}` syntax.

## Issues Encountered

None beyond the one auto-fixed comment-wording issue and the one non-discriminating acceptance criterion documented above, both investigated and resolved/verified directly per CLAUDE.md rather than gamed.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- All 11 `layer.*` sites are now implemented (31 of 40 total after this plan: 20 from Plans 123-01/02 + 11 from this plan). `COLUMN_REF_SITES` remains unchanged at exactly 40 entries, golden-tested.
- `resolveLayerTableId` and the malformed-JSON fallback (`readJsonString`/`emitMalformedJsonFallback`) are available for Plan 123-04 to reference conceptually; 123-04's own `configPatch.cb_config.attr`/`configPatch.track_config.*`/`configPatch.info_columns`/`configPatch.info_template` sites target the TARGET record's table (a widget's own `configPatch` action, not the layer directly) and so will need their own resolution path, not a direct reuse of `resolveLayerTableId`.
- The malformed-JSON fallback's tableId/tableScope-from-record behavior (as opposed to free-sql's tableId:null) is the detail Phase 124 must plan its grouping/rendering logic against — recorded above under "The Malformed-JSON Fallback."
- `dashboardExportRefs.ts` sha256 unchanged; zero `packages/web` diff — both phase-level success criteria hold.
- No blockers.

---
*Phase: 123-column-reference-enumeration*
*Completed: 2026-09-23*

## Self-Check: PASSED

- FOUND: `packages/server/src/lib/columnRefs.ts`
- FOUND: `packages/server/tests/lib.columnRefs.spec.ts`
- FOUND: `.planning/phases/123-column-reference-enumeration/123-03-SUMMARY.md`
- FOUND commit: `e96348c` (Task 1)
- FOUND commit: `4a28649` (Task 2)
- FOUND commit: `de828bc` (Task 3)
- FOUND commit: `f9de819` (P14 test strengthening)
