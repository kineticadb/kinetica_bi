# Phase 139 Gap-fix Summary

Three gaps flagged by 139-07/10/11 executors, each fixed red-first with one commit.

## Gap A: apply_filter / clear_filter on AI (negative-id) views
- Commit: 6a26b22 `fix(139): apply_filter/clear_filter accept AI (negative-id) dynamic views`
- Files: packages/server/src/lib/ai/tools/mutate.ts (dynamicViewId on both tools: `.positive()` -> int, non-zero; schema stays flat), packages/server/tests/lib.aiFilter.dv.e2e.spec.ts (new)
- Specs: GAPA-1 (schema accepts -3 and 90, rejects 0 and 1.5, no anyOf/oneOf/allOf/$ref/$defs), GAPA-2 (negative-id apply_filter stamps a dynamicView source through gateway), GAPA-3 (unknown -9 refused with "dynamic view -9 does not exist"), GAPA-4 (apply then clear on -3)
- Red run: 4/4 failed before the fix (GAPA-1 `expected false to be true`; GAPA-2/4 `expected [] to deeply equal ...`; GAPA-3 failed on the pinned reason, since the old schema rejected it before the gateway). 4/4 green after.

## Gap B: rebind to a saved view did not update the shadow tableId
- Commit: 4b688a9 `fix(139): rebind to a saved dynamic view updates the shadow tableId`
- Files: packages/server/src/lib/ai/gateway.ts (rebind branch records the saved view's sourceTableId on shadow.dvInfo before applyOpToShadow), packages/server/tests/lib.aiGateway.bind.spec.ts
- Specs: BINDDV-13 (widget and layer tableId move to the view's source table 6), BINDDV-14 (after rebinding layer 70 to a saved view on table 6, a follow-up `valueColumn: fare` patch is refused against table 6)
- Red run: both failed before the fix (`expected 5 to be 6`; `expected { ok: true ... } to match object { ok: false, stage: 'live_schema' }`). 13/13 green after.

## Gap C: AI view generation not in the orchestrator dv key
- Commit: fb38e93 `fix(139): AI view generation change replaces stale dv combination entries`
- Files: packages/web/src/hooks/useCombinationOrchestrator.ts (dvSourcesKey includes `:g<gen>` for negative ids with an `ai` row; a per-id last-seen-gen ref clears stale dv registry entries, aborts in-flight, drops the old view, and unbinds their vizToHash before hashing so STEP D re-requests and STEP E re-acquires), packages/web/src/hooks/useCombinationOrchestrator.spec.ts
- Spec: ORCHDV-4 (filter on -3 at gen 0, rerender at gen 1 with no filter change: second materialize carries aiGen 1, entry replaced, vizToHash rebound, refCount 1)
- Red run: failed before the fix (test timed out waiting for the second materialize call). Existing ORCHDV-1..3, DVCOMBO, aiFilter and materialize-chain specs stay green (94/94 across 4 files). Positive-id keys are byte-for-byte unchanged.

## Verification
- `npx tsc --noEmit` clean in packages/server and packages/web.
- Server `DEFAULT_VIEW_TTL_MINUTES=5 npx vitest run ai --maxWorkers=4`: 45 files, 465 tests green.
- Web: useCombinationOrchestrator.spec, .aiFilter.spec, useDynamicViewMaterializeChain.spec, dvSourceCombo.spec green. Full suites and test-gate not run, per instructions.

## Notes
- Gap C: the stale entry is dropped on the next tick after the gen changes. Whether the real undo/redo flow bumps `dynamicViews` (row replaced with new gen) before the chain re-materializes the view is covered by the spec only structurally; a live undo/redo with an active AI-view filter is not browser-verified.
- Gap A: the tool description text still says "saved dynamic view"; left unchanged.
