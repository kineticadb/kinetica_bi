---
phase: 136-structural-edit-ops
verified: 2026-10-14T17:00:00Z
status: passed  # human_needed items satisfied by operator-approved UAT 2026-10-14 (136-12-UAT-RESULTS.md)
score: 4/4 success criteria verified by automation (criteria 3 and 4 also need operator human-verify)
re_verification: false
human_verification:
  - test: "136-12 Task 1: WMS GetMap tile check for an AI heatmap layer, with and without VAL_ATTR (136-12-UAT-STEPS.md Steps 1-3)"
    expected: "weighted 200 image/png and control 200 image/png, both with visible heat"
    why_human: "Needs the operator's live Kinetica. VAL_ATTR support is MEDIUM confidence (research Pitfall 9); specs only prove the param is emitted on both MapChartRenderer sites."
  - test: "Heatmap blur parity (UAT Step 3 blur note)"
    expected: "Operator judges whether AI heatmaps (BLUR_RADIUS=5 always sent) look noticeably different from saved heatmaps that never set a blur (no BLUR_RADIUS, Kinetica default)"
    why_human: "Visual comparison on real tiles"
  - test: "Heatmap add/restyle visuals in light AND dark (UAT 4.1, 4.3b)"
    expected: "AI heat and restyled saved heatmap redraw with the new ramp; legend shows the AI layer row; session-only eye hides/shows it; map added on a no-map dashboard is large, non-overlapping, themed basemap"
    why_human: "Roadmap criterion 4 human half; rendering and legibility"
  - test: "AI added / AI edited badge legibility in light AND dark (UAT 4.2)"
    expected: "Both pills readable, header does not break with long titles"
    why_human: "Visual (CSS bugs evade tests and theme-guard)"
  - test: "Placement and layout sensibility (UAT 4.3)"
    expected: "KPI small, bar about half width, records full width; gaps fill first then below; no overlap; set_layout swap renders correctly in the live grid"
    why_human: "Roadmap criterion 3 explicitly operator human-verify"
  - test: "Removal ask-once and undo feel (UAT 4.4, 4.5)"
    expected: "First saved removal asks, approve then removes, second removal does not ask, discard re-arms the ask; revert(-1) gives exactly the saved dashboard, forward restores, reload shows nothing saved"
    why_human: "End-to-end in the live page (logic is unit/e2e covered; this confirms the real grid and maps)"
---

# Phase 136: Structural & Edit Ops Verification Report

**Phase Goal:** The AI can add, remove and edit visualizations and map layers and place them sensibly, with every change validated against the live schema.
**Verified:** 2026-10-14 (HEAD 1461c49, branch feat/ai-driven-dashboards)
**Status:** human_needed
**Re-verification:** No (initial)

Plan 136-12 is paused: its operator UAT (Task 1 tile check, Task 2 visual/layout/undo) is deferred (no Kinetica access) and its Task 3 bookkeeping has not run. ROADMAP/REQUIREMENTS/STATE still show Phase 136 as Pending **by design**; this is not a gap.

## Gates (run by the verifier)

| Gate | Result |
| --- | --- |
| web `npx tsc --noEmit` | clean |
| web `npx vitest run` | 4648 passed, 1 skipped, 1 failed: `WidgetRenderer.line.spec` L132-21 (known flake). Rerun alone: failed once, then passed 4 times in a row. The spec is a Phase 132 file that Phase 136 did not touch, so this is a timing flake, not a 136 regression. Note: it can fail even when run alone. |
| web theme-guard | 160/160 |
| server `npx tsc --noEmit` | clean |
| server `node scripts/test-gate.mjs` | GATE PASSED: 2146/2200; 8 known-failing files plus `tests/layers.spec.ts`, which passes alone (TD-V16-TEST-ISOLATION) |
| shared `npx tsc --noEmit` | clean |

## Goal Achievement

### Observable Truths (roadmap success criteria)

| # | Truth | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Scripted ops add, remove and edit a visualization, and add, remove and restyle a heatmap layer; each is undoable | VERIFIED | Server: E2E6-1..4 (`lib.aiStructural.e2e.spec.ts`) through the real registry, gateway and loop with ScriptedProvider. Web: E2EW6-1..3 (`structuralOps.e2e.spec.ts`) apply each turn and undo to the saved dashboard, then redo. 136-11 mutation proof on `removalApproved` in applyTurn. |
| 2 | A nonexistent table/column is repaired within 2 attempts or refused, never applied; the model cannot emit hex | VERIFIED | `agentLoop.ts:285` counts per `refKey`, falling back to `tool:stage:slot`, and the gateway runs on every call (W2-1..4, E2E6-5/6). Refusal text comes after attempt 2. A failed op never enters `bufferedOps`. Hex is blocked by tool enums (TOOL6-6), then the catalogue (CAT-4), then the fold palette (E2EW6-5). E2E6-7 mutation shows defence in depth. Inaccessible tables read as not found (E2E6-8, GW6-3). See residual W2 note below. |
| 3 | New widgets do not overlap; AI can resize and reorder (sensibility is human-verify) | VERIFIED (automated half); human pending | Gateway stamps `placeWidget` layout (`gateway.ts` step f). `validateLayout` handles set_layout (E2E6-9). Specs: LAYOUT-1..7 including a no-overlap fuzz, DPL6-1..5, FOLD6 set_layout overlap check, STORE6-2. |
| 4 | AI-added or restyled heatmap renders tiles and legend on both buildWmsParams sites (human-verify light/dark) | VERIFIED (automated half); human pending | `MapChartRenderer.tsx:1372` and `:1630`. HMAP-1..6 cover construction and the update effect (including the negative-id layer and VAL_ATTR clear). E2EW6-4 and RT6-3 check parity against the operator's real saved heatmaps. The live tile check and visuals are deferred to the 136-12 UAT. |

**Score:** 4/4 automated; criteria 3 and 4 also need human verification.

### Required Artifacts (spot-checked at all three levels)

| Artifact | Status | Details |
| --- | --- | --- |
| `packages/shared/src/aiCatalog.ts` | VERIFIED | Positive catalogue built from allow-list v4 plus records extras. Used by the gateway (`validateAiWidgetConfig`) and the web fold. |
| `packages/shared/src/layout.ts` | VERIFIED | `placeWidget`/`validateLayout` are used in gateway.ts, foldSession.ts and DashboardsPage. |
| `packages/server/src/lib/ai/gateway.ts` | VERIFIED | Covers D-22, D-04, D-02, D-06 confirmRemove, D-11/12 host, D-21 layer columns, nearest-name hints restricted to the probed table. |
| `packages/server/src/lib/ai/agentLoop.ts` | VERIFIED | Per-ref counting, cap, clarifications, and `skipped` on the result. |
| `packages/server/src/lib/ai/tools/mutate.ts` | VERIFIED | 12 flat `.strict()` tools. TOOL6-7 walks the JSON schema and finds no config/sql/layout property. |
| `packages/server/src/lib/aiConfig.ts` | VERIFIED | `AI_MAX_NEW_WIDGETS` is an integer 1-30, default 6, and is passed to the loop (`runAnswer.ts:107`). |
| `packages/web/src/lib/chartSql.ts`, `aiPalette.ts`, `aiWidgetDefaults.ts`, `layerDefaults.ts` | VERIFIED | `buildChartSql` is shared with ChartConfigPanel. Drift specs pass. |
| `packages/web/src/lib/aiSession/foldSession.ts` | VERIFIED | STRIP_KEYS, catalogue, defaults, translate, derive. Removal gate. |
| `packages/web/src/store/aiSessionStore.ts` | VERIFIED | `removalApproved`, `approveRemoval`, `reset`, `tempLayerVisibility`. In-memory only. |
| `packages/web/src/lib/wmsUrlBuilder.ts` | VERIFIED | VAL_ATTR is identifier-validated and undefined when unset. |
| `packages/web/src/components/DashboardsPage.tsx`, `WidgetCard.tsx` | VERIFIED | Layouts memo, baseline tables/cap (DPL6-4 mutation), AI badge using the existing `widget-filter-badge` class. |

### Key Link Verification

| From | To | Via | Status |
| --- | --- | --- | --- |
| runAnswer | gateway | `dashboardTableIds` from `listDashboardTables`, `approvals: body.approvals` (`runAnswer.ts:90,101-102`) | WIRED |
| runAnswer | SSE result | `{answerId,text,ops,skipped,clarifications}` (`runAnswer.ts:127`) | WIRED |
| aiAsk request | approvals | `z.object({removeSaved}).strict().optional()` (`shared/src/aiAsk.ts:103`); extra key gives 400 (E2E6-11) | WIRED |
| aiSessionStore.applyTurn | evaluateTurn | `{ removalApproved: s.removalApproved }` (store:117) | WIRED |
| WidgetRenderer | deriveChartConfig | render-time SQL regeneration for SQL-affecting overlays (SEAM-10/12/17, mutation SEAM-14) | WIRED |
| applyLayerOverrides | translateLayerOverlay | opacity 0-1 becomes POINTOPACITY 0-100 (SEAM-16 canary) | WIRED |
| Server SSE ops | web fold | not wired yet; Phase 137 adds the AI widget. The only current client feeder is the DEV harness. | EXPECTED (137) |

### Requirements Coverage

| Requirement | Description | Status | Evidence |
| --- | --- | --- | --- |
| AIACT-V20-01 | AI can add a visualization | SATISFIED (pending UAT sign-off) | E2E6-1, E2EW6-1/2/5, FOLD6, DPL6-4 |
| AIACT-V20-02 | AI can remove a visualization | SATISFIED | E2E6-3/11, APR-1/2, STORE6-1, FOLD6-5 |
| AIACT-V20-03 | Edit chart type/metric/group-by/sort; colours only via tokens | SATISFIED | E2E6-2/7, SEAM-*, CAT-4, TOOL6-6, PAL-1 |
| AIACT-V20-04 | Add heatmap layer | SATISFIED (live tile check deferred) | E2E6-4/12, HMAP-2, E2EW6-4 |
| AIACT-V20-05 | Remove a map layer | SATISFIED | E2E6-4, gateway confirmRemove for layers, fold remove_layer gate |
| AIACT-V20-06 | Restyle heatmap layer | SATISFIED (visual deferred) | E2E6-4 (raster refused), HMAP-3, CAT-6/7, GW6-11 |
| AIACT-V20-10 | Sensible placement, resize/reorder | SATISFIED (automated); human pending | LAYOUT-*, DPL6-*, E2E6-9 |
| AIACT-V20-11 | Bad reference repaired in 2 or refused, never applied | SATISFIED | W2-1..4, E2E6-5/6/8 |

No orphaned requirements: REQUIREMENTS.md maps exactly these 8 IDs to Phase 136, and 136-12 claims all 8. They are not ticked yet because 136-12 Task 3 is pending.

## Specific Examinations

### 1. Shared `<tool>:shape:?` repair key (W2 residual): acceptable for 136, but there is a real reporting defect to fix before Phase 137 shows `skipped`

I probed this with a temporary scripted-loop spec, then deleted it; the tree is clean.
- **No safety risk and no blocking of valid calls.** The gateway runs on every call (W2-4). In the probe, three distinct malformed `add_widget` calls were followed by a valid call, and the valid call applied (`OK: Added bar`).
- **Defect A: a repaired shape failure stays in `skipped`.** Shape failures carry no `slot`, so `unresolvedBySlot` keys them as `add_widget:shape:?`. A later successful call deletes only `new:<tempId>`, so the stale entry is never cleared. In the probe, a bad-shape add (hex colour, missing title) followed by a correct add gave `ops: 1` and also `skipped: [{label:"add_widget", stage:"shape", ...}]`. The change log would therefore report as skipped something that was in fact applied. This contradicts the W2-2 / E2E6-5 principle ("a repaired reference leaves nothing in skipped"), which is tested only for live_schema failures. The label is also the raw tool name, not a human label. Shape failures are likely the most common real-LLM error (enums, strict objects).
- **Defect B: misleading retry guidance.** A second, *different* malformed call to the same tool is told "Do not retry this", and a third gets "Not executed: already refused twice; do not retry". A model that obeys may abandon a different widget the user asked for.
- **Verdict:** WARNING, not a Phase 136 blocker. Criterion 2's safety property holds: nothing invalid is applied, and valid calls are never blocked. Phase 137 must fix this before it renders `skipped` to users. Suggested fix: on any `ok` result from tool T, delete `T:shape:?` from `unresolvedBySlot` (and from the attempt map). Alternatively, derive a slot from the raw args' `tempId`/`id` when JSON-parseable. Add a spec "shape failure then repair leaves skipped empty".

### 2. Web fold skips the table check for add_widget with no tableId: the server handles it

- `gateway.ts` reference stage: non-map without a numeric `tableId` returns `reference: "tableId is required for <type>"`, and a map *with* a tableId returns "map widgets have no table". This is covered by GW6-2 and confirmed by the probe (records without tableId gave `ops: []` and was reported in `skipped`). Failed ops never reach `bufferedOps`, and the SSE result carries only `result.ops`.
- The only current client feeder of `applyTurn` is the DEV harness (`devHarness.ts`, DEV build only). The SSE-to-fold wiring is Phase 137, and it will carry only gateway-approved ops.
- Even on the harness path, a no-table widget gets no SQL: `strip` removes sql/table/tableRef and derivation runs only when a baseline table is found. So the skip cannot inject SQL. Acceptable.

### 3. AI heatmap BLUR_RADIUS 5 vs saved heatmaps without blur

- `layerDefaults.ts:68` sets `blurRadius: s.blurRadius ?? 5`. The layer editor *displays* 5 when unset (`KineticaWmsLayerForm.tsx:1422`) but does not persist it, so hand-made heatmaps send no BLUR_RADIUS (Kinetica's default). CONTEXT D-10 lets the AI set radius/blur but specifies no default (Claude's discretion), so 5 does not contradict CONTEXT. It mirrors the editor's displayed default.
- RT6-3 pins the difference explicitly, and 136-09 recorded it. It is a visible-parity question, routed to the operator (UAT Step 3 blur note). If the operator finds it noticeable, drop the `?? 5` so AI layers match saved ones (and update RT6-3).

### 4. S6 spike verdict (135) is stale: follow-up

- 136-05 replaced the mutate tool set with 12 flat typed tools and noted "S6 scores invalid until the 136-12 live check". The 135 verdict (Gemini native, provisional, 19 trials) was measured against the old tools. Neither ROADMAP nor STATE records this staleness yet.
- `src/spikes/toolCallSpike.ts` uses the live `buildToolRegistry`, `AI_SYSTEM_RULES` and `checkAiOp`, so a rerun automatically exercises the new tools. **Follow-up:** 136-12 Task 3 bookkeeping should record "S6 verdict stale (tool set changed in 136-05); re-run before 137 live UAT". This could be combined with the already-noted ≥20-clean-trial re-run (STATE line 55).

### 5. W1 carried to Phase 137: confirmed

ROADMAP Phase 137 has "**Carry-forward (135 verification, 2026-10-13):** (W1) the per-user in-flight AI lock ... Add a route-level hard deadline that always releases the lock, and give the Kinetica probes an abort signal", plus Kinetica job tagging/cancel.

### 6. D-23 positive catalogue: confirmed, with discriminating tests

- **Mechanism is positive:** `validateAiWidgetConfig` rejects any key not in `AI_WIDGET_CONFIG[type].fields` (only `tableId` is skipped). Patches go through `validateActionPatch`, which returns `unknown field` for any non-allow-listed key, including through the legacy `patch` tool's free `changes` record.
- **Tests that would fail if removal of a rejection occurred:**
  - CAT-2 (`it.each` over sql, customWhere, table, drillDownColumn, drillDownColumnType, dynamicViewId, metricId, layout, metricColumn, tableRef) asserts `valid === false` and that the reason names the key. 136-01's mutation (adding `sql` to fields) failed CAT-2.
  - GW6-1 checks sql, customWhere, drillDownColumn, layout, metricColumn, hex and an injection-shaped aggregation, each expecting `stage: allow_list`. The 136-04 mutation (accept-all) failed GW6-1/GW-2.
  - TOOL6-7 walks the tool JSON schema for `config`/`sql`/`layout`; `lib.aiTools.spec:134,137` reject `sql` on add/edit tools.
  - The web fold's STRIP_KEYS has a mutation proof (FOLD6-2), and E2E6-1 checks there is no sql/table/layout in the op config.
- Limitation: CAT-2 exercises `bar` only. The other types share the same positive code path, so this is acceptable. `drillDownColumnType` is covered by CAT-2 only (not GW6-1); still discriminating.

### 7. Removal approval resets on Keep, Discard and reload: confirmed for Discard and reload; Keep is pending Phase 141

- Server side is stateless per request: `approvals.removeSaved` comes in on each ask (strict schema), and the server stores nothing.
- Client side: `removalApproved` starts false. `reset()` sets `{...initial, nextTempId}`, which includes `removalApproved: false`, and clears it. STORE6-1 asserts that reset clears approval. `reset()` is called by Discard (`useAiSessionActions.discard`, harness `discard`), dashboard switch (store:113, DashboardsPage:838), leave (AiLeaveDialog), and App.tsx:307. Reload clears it because the store is in-memory only (no `persist`, file header).
- Keep does not exist yet (Phase 141). Phase 141's Keep must call `reset()`; the store doc comment already states this. Phase 137 must send `approvals.removeSaved` from `removalApproved`.

### 8. AI_MAX_NEW_WIDGETS default 6 enforced server-side: confirmed

- `aiConfig.ts:97` uses `parseIntInRange(..., 6, 1, 30)`, and an invalid value is a config error. It is passed to `runAgentLoop` via `runAnswer.ts:107`. `agentLoop.ts:255` rejects the 7th `add_widget` before the gateway runs (CAP6-1 asserts that describe was called 6 times), with stage `cap` in `skipped`. CAP6-2 checks a lower cap. E2E6-10 runs end to end, and E2E6-12 counts the map toward the cap. Mutation (`false` condition) failed CAP6-1/2. `tests/setup.ts` blanks the env var so the dev `.env` cannot leak.
- Note: only `add_widget` counts. Heatmap layers do not count, which matches D-09 ("new widgets").

## Grep-criteria discrimination (CLAUDE.md)

The SUMMARYs are candid. Each self-reports its non-discriminating greps (hex = 0 before and after by design; `FOLD6-` count; `removeSaved: true` literal; `AS value FROM` comment hit; `widget-filter-badge` line count) and backs the real requirement with a red run or a mutation proof. Spot-checks at HEAD:
- `MAX_REJECTIONS_PER_TOOL` / "too many invalid attempts": 0
- `fare_secret` in src: 0
- hex in mutate.ts, aiCatalog.ts and aiPalette.ts: 0

I found no criterion presented as proof that could not fail. Weak spots are honestly disclosed: 136-01 Task 1, 136-06 Task 1, 136-08 Task 2 and 136-11 had no strict red-first run, and each relied on mutation proofs instead.

## Anti-Patterns / Notes

| File | Line | Pattern | Severity | Impact |
| --- | --- | --- | --- | --- |
| `server/src/lib/ai/agentLoop.ts` | 285-289 | Shape failures share `<tool>:shape:?`; never cleared on success | Warning | Stale `skipped` entry after a repaired shape failure; misleading "do not retry" for distinct malformed calls (see 1) |
| `server/src/lib/ai/agentLoop.ts` | 68 | `opSlot` duplicates gateway `slotOf` | Info | Drift risk; export one from gateway |
| `web/src/lib/radioGroupCapture.ts` | 145 | Fix 5233a6e skips `""` for **all** captured fields, not just metric | Info | A radio option can no longer snapshot an intentionally empty label/title; harmless for metric |
| `web/src/lib/layerDefaults.ts` | 68 | `blurRadius ?? 5` | Info | Visual parity question (see 3) |
| `web/.../WidgetRenderer.line.spec.tsx` | L132-21 | Timing flake, can fail even alone | Info | Pre-existing (Phase 132); not a 136 regression |

## Human Verification Required

All items come from `136-12-UAT-STEPS.md` (browser console, DEV build, operator's Kinetica):

1. **WMS tile check (Task 1):** Steps 1-3. Expected `weighted 200 image/png` and `control 200 image/png`, both with visible heat. If VAL_ATTR fails, route it to a gap.
2. **Blur parity:** whether AI blur 5 looks different from saved heatmaps with no blur.
3. **Heatmap visuals in light and dark (4.1, 4.3b):** tiles, legend row, session eye, map added on a no-map dashboard.
4. **Badges in light and dark (4.2):** "AI edited" / "AI added" pills legible.
5. **Layout (4.3):** per-type sizes, gap-fill, no overlap, set_layout swap.
6. **Removal ask-once and undo (4.4, 4.5):** including reload showing nothing saved.

After the operator replies, 136-12 Task 3 does the bookkeeping by hand. Also record there: S6 staleness (item 4), the shape-key reporting defect as a Phase 137 prerequisite (item 1), and Keep calling `reset()` as a Phase 141 requirement (item 7).

## Gaps Summary

No blocking gaps. All four success criteria have substantive, wired implementations and discriminating automated proofs, and all gates are green apart from the documented flake and isolation set. The phase is held at `human_needed` only for the deferred 136-12 operator UAT (live WMS tiles and light/dark/layout visuals). One warning-level defect should be fixed before Phase 137 surfaces `skipped`: a repaired shape failure remains in `skipped`.

---

_Verified: 2026-10-14_
_Verifier: Claude (gsd-verifier)_
