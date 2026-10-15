# Phase 138: AI Filters - Research

**Researched:** 2026-10-15
**Domain:** Driving the existing client filter path (filterStore -> orchestrator -> filterCombinationStore -> materialize) from validated AI ops, with per-column undo outside the session fold
**Confidence:** HIGH on the click path / stores / contract wiring (all read in code); MEDIUM on zero-row detection and dv column validation (design choices, see Open Questions)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01 Whole source, like a click.** An AI filter is a per-table filter (or per-dynamic-view filter for dv-backed widgets): every chart, records table and map layer reading that source narrows. No per-widget filter mechanism.
- **D-02 Ambiguous column -> ask.** If the requested column exists on more than one source on the dashboard and the question does not name one, the AI asks which table using the Phase 137 choice buttons (`choose_option`). It does not filter both.
- **D-03 Saved dynamic views included.** dv-backed widgets are filtered through the existing dv filter slice (`addDvFilter`/`clearDvFilters`), same as a click on them. AI-created views are Phase 139.
- **D-04 Filter kinds = what clicks and the filter panel can set:** equals, in-list, between (numeric and datetime/string), and empty (`isNull` / dataType null). Uses the existing `ActiveFilter` shape; nothing new.
- **D-05 Same column -> replace.** "Only credit" when the user has payment_type = Cash replaces Cash with Credit. Undo restores Cash.
- **D-06 Other columns stack.** Filters on other columns stay (same as clicking a second chart). The answer mentions filters that are still on.
- **D-07 "Clear the filters" clears all filters on the dashboard, the user's included.** No confirm (it is undoable). Narrower requests ("clear the vendor filter") clear only that.
- **D-08 Cap: refuse, never partial.** A filter that would exceed `FILTER_CAP_PER_TABLE` (25) is refused with a reason ("the table already has 25 filters"), suggesting clearing some. Nothing partial is applied.
- Nonexistent column: refused (client/gateway validation against the live schema; server `materialize` column guard from AISAFE-V20-01 / SSYNC-F6 is the backstop).
- **D-09 Filter-only answers do not lock editing and do not show the unsaved-changes bar**, and do not trigger the leave warning. Filters are view state, like the user's own clicks. An answer that ALSO changes widgets/layers locks as before (the filter part still does not count in the bar's added/edited/removed numbers).
- **D-10 Every AI filter change is still a turn** in the session history: Revert/Forward restore the per-source filter state of that point; follow-ups and the answer bubble work as in 137.
- **D-11 Revert/Forward touch only the columns the AI changed.** A filter the user set by hand after the AI turn is never clobbered (inverse is per source + column, not a whole-store snapshot).
- **D-12 Discard restores filters to how they were before the AI** (including user filters the AI replaced or cleared), again per column, leaving the user's later manual filters on other columns intact. Since filter-only sessions show no bar, the user undoes them with Revert in the chat; Discard via the bar applies when the bar is present.
- **D-13 Keep (Phase 141) does not save filters.** Filters stay applied for the current view; Keep's confirmation should say "filters are not saved". Record for 141; nothing built here.
- **D-14 Filter chips:** AI-applied filters appear as normal chips (removable the usual way) with a small "AI" tag. The tag goes away once the user edits/replaces that chip.
- **D-15 Outline, no pill:** every widget and map layer host that narrowed gets the Phase 137 fading accent outline. No "AI edited" pill (the widget itself didn't change).
- **D-16 Answer wording:** says what was filtered and how many widgets narrowed, and notes filters still on, e.g. "Filtered trips to payment_type = Credit (5 widgets). Your vendor_id filter is still on."
- **D-17 Zero matches:** the filter is applied (as a click would) and the user is told it matched no rows, with an offer to clear it. Widgets show their normal empty state.

### Claude's Discretion
- The `apply_filter` / `clear_filter` op payload (the 133 placeholders are keyed by `widgetId`; D-01 implies a source-keyed shape `{source:{kind:"table"|"dv",id}, filters:[...]}` or similar) and how the gateway validates columns/values/operators against the live schema.
- Where the AI filter applier lives (research recommends a NEW sibling module outside the action engine, e.g. `packages/web/src/lib/aiOps/aiFilterApplier.ts`, keeping the `ACTION-ENGINE-NO-FILTER` invariant).
- How the session stores filter turns (filter deltas per source+column alongside ops) so D-10..D-12 hold without making filter-only turns count as unsaved changes.
- How D-17 detects "no rows" (likely client-side after materialize/widget result, since schema mode cannot count rows server-side).
- How the "AI" chip tag is tracked (e.g. a marker on `ActiveFilter`), provided badges keep reading `filterCombinationStore`.

### Deferred Ideas (OUT OF SCOPE)
- Saving filters as a dashboard's default filters - new capability, own phase (backlog).
- Keep confirmation text "filters are not saved" - Phase 141.
- Per-widget filtering - not a click path today; not planned.
- Also out of scope per CONTEXT domain: AI-created dynamic views (139), query mode (140), saving anything (141), spatial/draw filters.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| AIACT-V20-09 | The AI can apply and clear filters through the existing filter path; charts, records tables and map tiles narrow exactly as they would after a click. | Section "Click path" proves the only inputs the orchestrator reads are `filterStore.filters/dvFilters` + `filterVersion`; charts, records, timeline/numericline/calendar and map layers are all combo-store consumers keyed off that, so `addFilter`/`addDvFilter`/`removeFilter`/`removeDvFilter`/`clearFilters`/`clearDvFilters` calls are sufficient. Contract, gateway, fold, applier, undo and UI designs below cover SC1-SC4. |
</phase_requirements>

## Summary

Every renderer (bar/pie/table/bignumber via WidgetRenderer, records, timeline/numericline/calendar, and both map WMS sites) is now a pure consumer of `filterCombinationStore.vizToHash` (set by `useCombinationOrchestrator`); the orchestrator is the SOLE caller of `materializeFilter` and re-runs (300 ms debounce, `useCombinationOrchestrator.ts:756`) on `filterStore.filterVersion`. Therefore the AI applier needs ONLY to call the same `filterStore` actions a click calls. No call to `materializeFilter`, no legacy `filterViewStore.markMaterializing` (a dead write: the only live reader of `filterViewStore.views` is `useViewKeepAlive`, keyed on `viewName`, which is empty for a mark-only entry), no touching of `WidgetRenderer`/`MapChartRenderer`. Maps narrow through `vizToHash["l:<id>"]` (`MapChartRenderer.tsx:1353-1371`, second site `:1630`, dep key `dvComboViewsKey :640-651`) with no AI-specific wiring.

The hard parts are not the filter path, they are (a) deterministic undo of state that lives OUTSIDE the session fold (per source+column deltas captured at apply time, guarded by "current still equals what the AI set"), (b) keeping filter-only turns from locking the editor (the lock is `selectHasUnsavedAiChanges` = "any applied entry", so filter entries must be excluded there and in `foldSession`), (c) a flat, provider-safe tool schema (no `anyOf`; `buildToolRegistry` throws on composites) with all type coercion and the cap/column checks done in the gateway, and (d) keeping filter VALUES away from the provider (AIGOV-V20-02): the snapshot carries column+operator only; client-composed answer notes that contain values must NOT be put in `Turn.answer`, because `buildAskTurns` sends `answer` back to the provider.

**Primary recommendation:** Add a source-keyed `apply_filter`/`clear_filter` op (new `packages/shared/src/aiFilter.ts`), validate everything in `gateway.ts` against `liveSchema` + a filter map in the shadow (seeded from a now-populated `snapshot.filters`), evaluate purely in `foldSession` (excluded from lock/counts), execute in a NEW `packages/web/src/lib/aiOps/aiFilterApplier.ts` that calls only existing `filterStore` actions and records per-column `{before, after}` deltas on the turn entry, and undo/redo/discard via a guarded per-column inverse ("only if the column still holds what the AI set").

## Standard Stack

No new libraries. Everything is existing code.

### Core
| Module | Location | Purpose | Why |
|--------|----------|---------|-----|
| `useFilterStore` | `packages/web/src/store/filterStore.ts` | `addFilter` (75-112), `setBulkFilters` (114-145), `removeFilter` (147), `clearFilters` (158), `addDvFilter` (173), `removeDvFilter` (211), `clearDvFilters` (222), `FILTER_CAP_PER_TABLE=25` (15) | THE click path; bumps `filterVersion` |
| `useCombinationOrchestrator` | `packages/web/src/hooks/useCombinationOrchestrator.ts` | Sole materialize trigger; table (240-301) and dv (304-390) enumeration | Reads filterStore on tick; nothing to change |
| `computeReverseFilterMap` + `enumerateVizDescriptors` | `packages/web/src/lib/computeReverseFilterMap.ts`, `lib/useReverseFilterMap.ts:58-120` | Which widgets (map layers resolved to owning map) each filter applies to | Gives D-16 "N widgets" and D-15 outline ids, incl. per-widget source allow-lists |
| `buildChipText` | `packages/web/src/lib/columnTypes.ts:200` | Chip/answer text for eq/in/between/isNull | Same wording as clicks |
| `inferDataTypeFromColumn` | `packages/web/src/lib/columnTypes.ts:85` | Kinetica type -> `ActiveFilter.dataType` | Client-side re-derivation (defence in depth) |
| `stableComboHash` | `packages/web/src/lib/stableComboHash.ts` | Hash of resolved filters; ignores `addedAt`, `sourceWidgetId` and any extra field | AI filter and equal click filter share the SAME hash/view |
| `useAiSessionStore`, `foldSession`, `askRunner`, `chatText`, `devHarness` | `packages/web/src/store/aiSessionStore.ts`, `lib/aiSession/*` | Session/turn machinery from 134/137 | Extend, do not replace |
| `checkAiOp`, `shadow`, `liveSchema`, `mutate tools`, `context` | `packages/server/src/lib/ai/*` | Gateway/validation/tools/prompt from 135/136 | Extend |
| `AiOpSchema`/`parseAiOp`, `AskRequestSchema` | `packages/shared/src/aiOp.ts`, `aiAsk.ts` | Shared contract (zod v3; web+server) | Extend |

### Supporting
| Item | Use |
|------|-----|
| `widget-filter-badge` CSS class (`WidgetCard.tsx:161`, used for "AI added"/"AI edited") | Reuse for the small "AI" chip tag (CLAUDE.md: reuse, do not invent classes) |
| `ai-chat-note muted`, `ghost-sm`, `ds-actions` classes (`AiChat.tsx`) | Filter notes and the "clear it" offer in chat |
| `useFilterHighlightStore` (flash) | NOT for D-15; D-15 is the 137 `aiSessionStore.setHighlight` outline (`WidgetCard.tsx:133`, `.widget-card--ai-changed`) |
| `runSql` (`api/client.ts:313`) | Client-side `SELECT COUNT(*)` for D-17 (never goes to the provider) |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Per-column `{before,after}` deltas on the turn entry | Whole-store snapshot per turn | Violates D-11 (would clobber later manual filters) |
| `aiApplied?: true` marker on `ActiveFilter` | Separate tag store keyed source+column | Marker auto-drops on replace/remove (D-14) with zero extra code; safe (see Pitfall 7) |
| Guard by structural key equality | Object identity | Identity works while the store keeps the reference (it does: `newTableFilters[idx] = filter`); use a key (`column|operator|JSON(value)`) so re-added `before` objects still match |
| Union-typed tool args | Flat string args coerced by the gateway | `buildToolRegistry` throws on `anyOf` (`tools/registry.ts:findComposite`); flat is mandatory |

**Installation:** none. **Versions:** n/a (no packages). Shared uses `zod ^3.25.76` (v3 API); server tools import `zod/v4` (`tools/mutate.ts:3`) - do not mix.

## Architecture Patterns

### Recommended Project Structure (additions only)
```
packages/shared/src/
  aiFilter.ts                 # NEW: AiFilterSourceSchema, AiFilterItemSchema, AI_FILTER_CAP_PER_TABLE, helpers
  aiOp.ts                     # apply_filter / clear_filter payloads (keep plain strict z.object members)
  aiAsk.ts                    # snapshot.filters .max(50) -> raise; SnapFilter kind stays table|dynamicView
packages/server/src/lib/ai/
  shadow.ts                   # + filters: Map<sourceKey, Set<column>>; describeOp/describeIntent for filter ops
  gateway.ts                  # + apply_filter/clear_filter checks (reference, live_schema, cap, clarification)
  tools/mutate.ts             # + apply_filter, clear_filter flat tools
  context.ts                  # + 2-3 prompt rules; projectSnapshot already copies filters
packages/web/src/lib/aiOps/
  aiFilterApplier.ts          # NEW: ONLY AI->filterStore contact point
  applyAiTurn.ts              # NEW: store.applyTurn + applier + highlight + notes (shared by askRunner and harness)
packages/web/src/lib/aiSession/
  types.ts                    # TurnEntry.filterDeltas?, SkipReason additions, TurnChat.filterNotes?
  foldSession.ts              # evaluateOne for filter ops (pure); foldSession skips them
```

### Pattern 1: What the AI applier must call (the click path, concretely)
Click chart/bar: `WidgetRenderer.tsx:156-240 dispatchDrillDown` -> table: `useFilterStore.addFilter(tableId, {column,value,dataType,sourceWidgetId,addedAt})` (`:221`); dv-backed widget: `addDvFilter(dynamicViewId, ...)` (`:188`). Timeline/NumericLine/Calendar/DataFilter use `setBulkFilters` for between/in (`TimelineRenderer.tsx:488`, `NumericLineRenderer.tsx:463`, `DataFilterRenderer.tsx:368`; calendar dv: `addDvFilter` `CalendarRenderer.tsx:539`). Chip x: `removeFilter/removeDvFilter` (`DashboardsPage.tsx:1114/1136/1691/1766`); chip "Clear all" per source: `clearFilters/clearDvFilters` (`:1122/1144`).

Each store action bumps `filterVersion` (primitive) -> orchestrator effect (deps `useCombinationOrchestrator.ts:760`) -> per viz `resolveFilterSet(cfg, filters[tableId])` + `stableComboHash` -> one `materializeFilter` per NEW unique hash (`:593` table, `:636` dv) -> `filterCombinationStore.setEntry/setVizHash`. Consumers: widgets `WidgetRenderer.tsx:507-520` comboKey; maps `MapChartRenderer.tsx:1353-1371` (site 1, `buildWmsParams` at `:1372`) and `:1583-1650` (site 2, `buildWmsParams` `:1630`), dv layers via `dvComboViewsKey :640-651`; records are a pure combo consumer since Phase 96-01 (comment `useCombinationOrchestrator.ts:95-96`).

**AI call mapping (table source):** `addFilter(tableId, f)` for every operator (dedupe is silent no-op on identical scalar, replace-by-column otherwise = D-05; arrays never `===` so in/between always replace). **dv source:** `addDvFilter(dvId, f)` (there is NO dv bulk action; one sync loop is fine - the orchestrator debounces 300 ms and React flushes uSES updates once per task). **Clear one column:** `removeFilter`/`removeDvFilter`. **Clear a source:** `clearFilters`/`clearDvFilters`. **Clear all (D-07):** iterate `Object.keys(filters)` and `Object.keys(dvFilters)` like `lib/clearAllFilters.ts:10-23` BUT DO NOT call `clearAllFilters()` itself: it also calls `useSpatialFilterStore.getState().clearAll()` (drawn shapes), which the delta machinery cannot invert and which is out of scope. Leave shapes alone; mention them in the answer note if any exist.

`ActiveFilter` for the AI: `{column, operator, value, dataType, addedAt: Date.now(), aiApplied: true}` with NO `sourceWidgetId` (see Pitfall 2).

### Pattern 2: Source-keyed op payload (recommended)
```typescript
// packages/shared/src/aiFilter.ts  (NEW; aiOp.ts is in the actionEngineDecoupling static grep, so keep banned symbols out of it)
import { z } from "zod";
import { AiIdentifierSchema } from "./actionAllowList";
import { AiRefIdSchema } from "./aiOp"; // or re-declare to avoid a cycle: put AiRefIdSchema import from a leaf

export const AI_FILTER_CAP_PER_TABLE = 25; // web spec asserts === filterStore FILTER_CAP_PER_TABLE (drift guard)
export const AiFilterSourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("table"), id: z.number().int().positive() }).strict(),
  z.object({ kind: z.literal("dynamicView"), id: AiRefIdSchema }).strict(), // negative temp dv refused by gateway until 139
]);
const Scalar = z.union([z.string().max(200), z.number(), z.boolean()]);
export const AiFilterItemSchema = z.object({
  column: AiIdentifierSchema,
  operator: z.enum(["eq", "in", "between", "isNull"]),
  value: z.union([Scalar, z.array(z.union([z.string().max(200), z.number()])).max(100), z.null()]).optional(),
  dataType: z.enum(["string", "number", "boolean", "datetime", "null"]).optional(), // gateway stamps the typed form
}).strict();
```
```typescript
// aiOp.ts (plain strict z.object members only: AIOP-8 reads AiOpSchema.options[i].shape.op.value; AI_OP_KINDS stays 12)
z.object({ op: z.literal("apply_filter"), source: AiFilterSourceSchema, filters: z.array(AiFilterItemSchema).min(1).max(10) }).strict(),
z.object({ op: z.literal("clear_filter"), source: AiFilterSourceSchema.optional(), column: AiIdentifierSchema.optional() }).strict(),
// per-operator value-shape checks go in parseAiOp's post-check (like add_layer), NOT .refine on the union member
```
`clear_filter` semantics: no source = clear ALL column filters on the dashboard (D-07); source only = that source; source+column = one column. `column` without `source` is a shape error.

**Source kind naming:** use `"table" | "dynamicView"` (matches `SnapFilter.source.kind` in `aiAsk.ts:64` and the patch target kind), not `"dv"` from CONTEXT's illustrative example.

### Pattern 3: Flat provider tools (no composites)
`buildToolRegistry` rejects `$ref/anyOf/oneOf/allOf` (`tools/registry.ts:findComposite`). So tool args are flat and string-typed; the gateway coerces to typed values:
```typescript
// tools/mutate.ts (zod/v4)
const applyFilterArgs = z.object({
  tableId: z.number().int().positive().optional(),        // omit -> gateway resolves / asks (D-02)
  dynamicViewId: z.number().int().positive().optional(),  // saved dv only
  column: z.string().max(128),
  operator: z.enum(["eq", "in", "between", "isNull"]).optional(), // default eq
  value: z.string().max(200).optional(),                  // eq
  values: z.array(z.string().max(200)).max(100).optional(),// in
  from: z.string().max(200).optional(), to: z.string().max(200).optional(), // between
}).strict();
const clearFilterArgs = z.object({ tableId: z.number().int().positive().optional(), dynamicViewId: z.number().int().positive().optional(), column: z.string().max(128).optional() }).strict();
```
`toOp` builds the raw `{op:"apply_filter", source, filters:[{column, operator, value}]}` candidate; the gateway (stage e) coerces by live column type and stamps `dataType` + typed `value` into the op (same "gateway stamps" pattern as `op.layout` for add_widget, `gateway.ts:344-348`). Add both names to `TOOL_PROGRESS`/`TOOL_NOUN` (`chatText.ts`) so progress/skipped copy is friendly.

### Pattern 4: Gateway validation (all in `checkAiOp`, stop-at-first-failure order kept)
- **shape:** `parseAiOp`; per-operator value-shape check in `parseAiOp`'s post-check.
- **reference (d):** `table` source: `tableRule(id)` (`gateway.ts:236-240`, on-dashboard, inaccessible reads as nonexistent). `dynamicView` source: id must be in `shadow.dynamicViews` and positive (negative temp -> fail reason "dynamic views created by the AI can't be filtered yet"); `clear_filter` with a column must find it in the shadow filter map ("no filter on `col`"); `clear_filter` with nothing filtered at all -> fail reference "there are no filters to clear" so the model tells the user.
- **live_schema (e):** table: `deps.liveSchema.describe(tableId)` (user-credentialed probe, `liveSchema.ts`), reuse `nearest()` for "did you mean". Column missing -> `column \`x\` not found on table ...` (existing wording, names only, never values). Type compatibility: derive dataType exactly as the client does (mirror `inferDataTypeFromColumn` rules: numeric set / bool / timestamp,date,time,datetime / else string; reject geometry/text via `isColumnDrillDownSafe`-equivalent: wkt, wkb, bytes, blob, text, point, geometry, geography -> "column is not filterable"). Coerce: number columns accept only numeric strings (optionally a strict thousands-comma pattern); boolean accepts `true|false`; datetime must `Date.parse`; `between` needs both ends of the same kind and `from <= to`; `in` -> non-empty list; `isNull` -> `{value:null,dataType:"null"}`. Failure reasons are fixed text + column NAMES only (the file's header contract: never rejected argument values).
- **dv columns:** the gateway has no dv column source in the snapshot. Use `getDashboardDynamicView(id)` (`db.ts`, columns_json at `db.ts:141,1322`): row must exist and `dashboard_id === deps.dashboardId`; check the column against `columns_json` names when present; if `columns_json` is null skip the pre-check. The authoritative backstop is the `/api/filter/materialize` dv probe (`index.ts:1380-1400`, `assertColumnsExist`). `liveSchema.ts`'s header says "never the stored per-view column blob" - for dv this is only a pre-check, documented as such (see Open Question 2). New `GatewayDeps` member, e.g. `dynamicViewColumns?: (dvId:number)=>{name:string;type?:string}[] | null | undefined`.
- **cap (new stage already in `GatewayStage`):** shadow holds `filters: Map<"table:<id>"|"dynamicView:<id>", Set<string>>` seeded from `body.snapshot.filters` (`createShadow`) and updated by `applyOpToShadow` for apply/clear (so two ops in one answer count correctly). Refuse the WHOLE op if `size + newColumns > 25` with reason "the table already has 25 filters; clear some first" (D-08). Replacing an existing column never counts. The cap is NOT currently known server-side: `FILTER_CAP_PER_TABLE` is web-only (`filterStore.ts:15`), so add `AI_FILTER_CAP_PER_TABLE` to shared and guard drift with a web spec (`expect(AI_FILTER_CAP_PER_TABLE).toBe(FILTER_CAP_PER_TABLE)`).
- **clarification (D-02):** when `tableId`/`dynamicViewId` are both omitted, resolve over the dashboard's tables: probe each (`dashboardTableIds()` + `describe`), keep those having the column. Exactly one -> use it. More than one -> `fail("clarification", ..., {clarification:{kind:"choose_option", question:"Which table should I filter by <column>?", options: tables.map(t=>({id:String(t.id), label:`${schema}.${name}`}))}})`; none -> live_schema failure with nearest names. Client `choiceQuestion` (`askRunner.ts:33-38`) sends the option LABEL as the next user message, so labels should be the table names the user sees. Pair this with ONE prompt rule ("filter by omitting tableId unless the user named a table or chart"). If the model names a source explicitly the gateway cannot know the user did not - the prompt rule plus the existing trailer rule (`AI_TRAILER_RULE`, `context.ts:48-49`) cover that path.
- **No new permission.** Filters are view state, edit-right checks do not apply (135 D-16 precedent), so the "adding a permission ripples across specs" trap (memory) is avoided.
- **Label (`describeOp`/`describeIntent`, `shadow.ts:165-167, 207-209`)**: titles/ids/column NAMES + operator only, never values (SHD-3 contract; the label is echoed to the model as `"OK: " + label` and persisted in `changes_json`). e.g. `Filtered table "demo.nyctaxi" on payment_type`, `Cleared the payment_type filter`, `Cleared all filters`. Spec `lib.aiShadow.spec.ts` SHD-3 style assertion with a planted value.
- Tool args (incl. the user-stated value) are persisted in `ai_audit.tools_json` (`agentLoop.ts` pushes `args: parsedArgs`; `aiAudit.ts:12`). The value comes from the user's own question, not row data, so this is consistent with AIGOV-V20-02, but call it out in the plan so nobody "fixes" it.

### Pattern 5: Context/snapshot wiring (currently stubbed)
`buildAskSnapshot` returns `filters: []` with comment "138 wires filters" (`buildAskRequest.ts:71`). Wire it from `useFilterStore.getState()`: one `{source:{kind, id}, column, op: operator ?? "eq"}` per active filter, NO value (the schema has no value field by design, `aiAsk.ts:61-68`). `projectSnapshot` already copies them (`context.ts:41`) and `get_dashboard` returns them, so the model knows which columns are filtered and which source (this feeds D-06 "your vendor_id filter is still on" without values). **Contract limit:** `snapshot.filters` is `.max(50)` (`aiAsk.ts:98`) but the true maximum is 25 per table x (tables + dvs); exceeding 50 makes the whole ask 400. Raise it (recommend 300; body cap `ASK_REQUEST_MAX_BYTES` 64 KB is ample: each entry < 100 bytes) and have the client slice to the cap, the cap check then being best-effort server-side and authoritative client-side (the pure fold re-checks).

### Pattern 6: Pure evaluation in the fold, side effects in the applier
`foldSession.ts:260-265` currently skips apply/clear with `unsupported_in_134`; `foldSession.spec.ts:47` asserts that and must change. New `evaluateOne` cases (still pure, no store/api imports, no banned symbols - `foldSession.ts`, `aiSessionStore.ts`, `applySession.ts`, `shared/src/aiOp.ts` are all in the decoupling static grep `actionEngineDecoupling.spec.ts:46-57`, banned: `materializeFilter`, `dropFilterView`, `addFilter\b`, `setBulkFilters`, `filterVersion`; comment lines are stripped before matching but do not rely on that for code):
- source exists (table in `baseline.tables`, dv in `baseline.dynamicViewIds`) else `skip("table_not_on_dashboard" | "target_not_found")`;
- column exists in `baseline.tables[].columns` (tables only; dv relies on the gateway) else new `SkipReason` `"column_not_found"`;
- cap: simulate with `sim.filters` seeded from `EvaluateOptions.currentFilters` (a plain `{ "table:5": ["payment_type", ...] }` map read from the real store at APPLY time, not ask time, because the user may click while an answer streams) -> `skip("filter_cap")`;
- mark `applied` for valid ops. `foldSession()` itself must `continue` before `applied++` for filter ops (so `appliedOpCount`/`EMPTY_DERIVED` are unaffected).
Add `SkipReason` members `"column_not_found" | "filter_cap"`; `unsupported_in_134` stays for dv ops.

**D-09 lock/bar:** `selectHasUnsavedAiChanges` (`aiSessionStore.ts:221-226`) = `isApplied` over all entries. Change `isApplied` to `status === "applied" && !isFilterOp(e.op)`. That one selector feeds `AiChangeBar.tsx:19`, `useAiEditLock.ts`, `DashboardsPage.tsx:182,686,690`, `aiLeaveGuard.ts` - a single fix point covers bar, lock, leave dialog and `beforeunload`. A mixed turn (filter + widget op) still locks through the widget op, and `computeChangeCounts` reads only `derived` so filter ops never appear in the counts.

### Pattern 7: Delta capture and per-column inverse (D-10/D-11/D-12)
filterStore is outside the fold, so record what the AI changed at apply time.
```typescript
// lib/aiSession/types.ts
export type FilterSourceRef = { kind: "table" | "dynamicView"; id: number };
export type FilterDelta = { source: FilterSourceRef; column: string; before: ActiveFilter | null; after: ActiveFilter | null };
export type TurnEntry = { raw: unknown; op: AiOp | null; result: OpResult; filterDeltas?: FilterDelta[] };
```
Put deltas on the ENTRY (not in a side Map keyed by turn id): `aiSessionStore` squashes the oldest turn into `baseEntries` at the 50-turn cap (`:149-153`) and entries carry over automatically; a side map would silently lose them. `reset()` clears them by construction.

Applier core (outside the engine, allowed to import filterStore):
```typescript
// lib/aiOps/aiFilterApplier.ts
const key = (f: ActiveFilter | null) => f ? `${f.column}|${f.operator ?? "eq"}|${JSON.stringify(f.value)}` : "∅";
const cur = (s: FilterSourceRef, col: string): ActiveFilter | null => {
  const fs = useFilterStore.getState();
  return (s.kind === "table" ? fs.filters[s.id] : fs.dvFilters[s.id])?.find(f => f.column === col) ?? null;
};
function set(s: FilterSourceRef, col: string, f: ActiveFilter | null) {
  const fs = useFilterStore.getState();
  if (f) (s.kind === "table" ? fs.addFilter(s.id, f) : fs.addDvFilter(s.id, f));
  else (s.kind === "table" ? fs.removeFilter(s.id, col) : fs.removeDvFilter(s.id, col));
}
export function undoDeltas(ds: FilterDelta[]) { // reverse order
  for (const d of [...ds].reverse()) if (key(cur(d.source, d.column)) === key(d.after)) set(d.source, d.column, d.before);
}
export function redoDeltas(ds: FilterDelta[]) { // forward order
  for (const d of ds) if (key(cur(d.source, d.column)) === key(d.before)) set(d.source, d.column, d.after);
}
```
`before` is captured with `cur()` BEFORE the store call, `after` is the exact object passed to `addFilter` (the store keeps that reference). Overlapping columns across turns undo correctly in reverse order (T2 restores T1's AI value, then T1 restores the user's Cash); a later manual edit makes `cur !== after` so the guard leaves it alone and older deltas on that column are skipped too (D-11). Redo of a column the user has since changed is skipped. A clear-all produces one delta per removed column. No delta (and no store call, no `filterVersion` bump) when the op is a no-op (same scalar already applied: `addFilter`'s dedupe).

**Triggering undo/redo/discard without making the store import filter code:**
- `setCursor(index, baseline)` is called from `AiChat.tsx:205`, `hooks/useAiSessionActions.ts:19`, and (via actions) `devHarness.ts:196,200`. Add a tiny sink registry to the store (`setSessionSink({ onCursorMove(prev, next, deltasBetween) })`, default no-op) invoked from `setCursor`; the applier module registers itself via an idempotent `installAiFilterEffects()` called where `useAiSessionActions` is created (one install per app, StrictMode-safe because it assigns, not appends). Compute `deltasBetween` from `turns[min+1..max]` entries (+ `baseEntries` is never revertable).
- **Discard (D-12):** `AiDiscardDialog.tsx:23-26` and `useAiSessionActions.discard` (`:20`) call `reset()`. Add `discardAiSession()` in the applier module = `undoDeltas(all deltas of turns <= cursor)` THEN `store.reset()`; wire those two call sites to it. Do NOT restore inside `reset()`: `reset()` also runs on dashboard switch/logout (`DashboardsPage.tsx:851`, after `useFilterStore.reset()`, `App.tsx:307`) and on `AiLeaveDialog` discard-and-leave (`AiLeaveDialog.tsx:28`), where restoring would resurrect the previous dashboard's filters or is pointless (filters are wiped on leave).
- If a later `applyTurn` truncates future turns (`aiSessionStore.ts:135`), their deltas were already inverted by the prior revert; nothing extra to do.

### Pattern 8: One wrapper for apply (shared by runner and harness)
Create `applyAiTurn(input, baseline)` in `lib/aiOps/applyAiTurn.ts`: (1) read `currentFilters` from filterStore, (2) `store.applyTurn({...input, filterState}, baseline)`, (3) execute applied filter entries via the applier, writing deltas back to the entries (`store.attachEntryFilterDeltas(turnId, entryIndex, deltas)`), (4) compute narrowed widget ids and counts, (5) `setHighlight(union(changedWidgetIds(entries,...), narrowedIds))`, (6) set `TurnChat.filterNotes`, (7) kick off the async zero-row check. `askRunner.applyResult` (`askRunner.ts:46-84`) and `useAiSessionActions.applyTurn` both call it, so the dev harness exercises the real path (the 137 UAT gap #8: harness never set the highlight).

### Pattern 9: D-15 outline / D-16 count / D-14 tag
- **Narrowed ids and count:** after applying, `enumerateVizDescriptors({widgets: effectiveWidgets, layers, associatedTables: [], targetsByTable: aggregateSpatialTargetsByTable(widgets)})` + `computeReverseFilterMap({filters, dvFilters, shapes, vizs, dvFilterScopeDisabled})` (`computeReverseFilterMap.ts`), filter `filterEntries` to the filters this op created (match by object identity - the map is keyed by the `ActiveFilter` object, which is exactly why the applier keeps `after` references), union `widgets[].widgetId` (layers already resolve to the OWNING map widget id). That set is both the D-16 "(N widgets)" and the D-15 outline ids (a map host counts once). For clears compute the same set BEFORE removal (widgets that just widened), outline those too. It correctly excludes widgets whose `filterSelection` allow-list rejects the filter (Pitfall 2). `applyResult` already builds effective `widgets`/`layers` (`askRunner.ts:76-83`); reuse them. `associatedTables: []` is fine (only used for layer display names).
- **No "AI edited" pill:** the pill derives from `derived.aiEditedWidgetIds`/`aiLayerHostWidgetIds` (`selectShowsAiEditedPill`); filter ops never write them, so nothing to do (assert in a spec).
- **Tag:** add `aiApplied?: boolean` to `ActiveFilter` (`filterStore.ts:17-40`). Safe: `stableComboHash` uses only column/operator/value (`stableComboHash.ts:25-35`); `/api/filter/materialize` reads `filters` untyped (`index.ts:1312-1330`, `whereClause.ts` ignores extra fields). Render via an optional `aiApplied` prop on `FilterChip` (`FilterChip.tsx`): in the **topbar** branch the file mandates byte-identical markup for non-AI chips, so add the tag only when the prop is true as a sibling `<span className="widget-filter-badge">AI</span>` between `{text}` and the dismiss button; panel branch: same span next to the value and `provenance` falls back to "from AI assistant" when `aiApplied` and no `sourceWidgetId` (`resolveProvenance.ts` returns undefined otherwise). Pass `aiApplied={f.aiApplied}` at the chip sites: top bar `DashboardsPage.tsx:1686-1693` (table), `:1760-1767` (dv); panel `:1111-1125`, `:1133-1147` (`FilterPanelChip` type gets the optional field). Badges stay on `filterCombinationStore` (`FilteringBadge.tsx`, `MapFilteringBadge.tsx`); no new reader of `filterViewStore` anywhere.
- **Tag drop:** user edit = `addFilter` replacing with a new object (no marker) or `removeFilter`: automatic. Edge: a user click with the IDENTICAL scalar value is a silent dedupe no-op (`filterStore.ts:90-96`) and the tag stays - acceptable, not an edit.

### Pattern 10: D-16 wording and D-17 zero-row, kept away from the provider
- **Where the text lives:** put client-composed filter text in a new display-only field `TurnChat.filterNotes?: string[]`, rendered in `AiChat.tsx` as `ai-chat-note muted` lines, and NEVER in `Turn.answer`. `buildAskTurns` (`buildAskRequest.ts:75-95`) sends `t.answer` back to the provider on the next ask; the note contains user filter state and (for D-17) an emptiness fact. The model's own answer text (from the provider) stays in `answer` and should describe the filter by column (prompt rule: "do not claim row counts").
- **Text:** `Filtered {sourceLabel} to {buildChipText(...)} ({N} widgets).` plus `Your {col} filter is still on.` for other columns still present on that source (column names only, never the user's values), built from `filterStore` after apply and `computeReverseFilterMap`. Pluralise "widget(s)".
- **Zero rows (client-side, D-17):** after the orchestrator settles, `SELECT COUNT(*) AS n FROM <viewName>` via `runSql` on the combo view. Locate the hash directly: `stableComboHash("table"|"dv", id, activeFiltersForSource)` (dv path is column-only; a table with drawn shapes AND an eligible spatial target folds shapes into the hash, so lookup misses -> silently skip the check). Wait with `useFilterCombinationStore.subscribe` until `registry[hash]` exists with `materializing:false` (timeout ~20 s, abort on epoch change / session reset), then count. If `n === 0` append a `filterNotes` line "It matched no rows." plus an offer button (`ghost-sm`) "Clear this filter" that performs the plain user-semantics `removeFilter`/`removeDvFilter` (no provider call, no new turn; D-11's guard makes a later Revert a no-op on that column). Do NOT import `materializeFilter` anywhere new (the orchestrator spec has a sole-trigger grep gate; `COUNT` goes through `runSql`). Case mismatch ("credit" vs "Credit") produces zero rows in schema mode because the model cannot see values; this is exactly the D-17 path, and the system-prompt rule should tell the model to use the user's exact casing and not to guess values.

### Anti-Patterns to Avoid
- **Calling `clearAllFilters()` for "clear the filters":** also clears spatial shapes (`clearAllFilters.ts:22`), not invertible by deltas.
- **Whole-store filter snapshots for undo:** clobbers later manual filters (D-11).
- **Putting filter calls in `foldSession`/`aiSessionStore`/`applySession`/`shared/aiOp.ts`:** breaks `ACTION-ENGINE-NO-FILTER` (`actionEngineDecoupling.spec.ts`). `AiOp` type/zod additions in `aiOp.ts` are fine; just no banned identifiers. Put the cap constant and filter schemas in the new `shared/aiFilter.ts`.
- **Union-typed tool args / `.refine` on a union member:** the first fails `buildToolRegistry`; the second breaks `AIOP-8` (`.options[i].shape`).
- **Reading `filterViewStore` for anything new**, or calling its `markMaterializing` from the applier (see Summary; add one static-grep spec that `aiFilterApplier.ts` imports neither `filterViewStore` nor `materializeFilter`).
- **Letting the store toast on AI refusals:** `addFilter`/`setBulkFilters` toast + silently truncate at the cap (`setBulkFilters` truncates the batch = partial, violating D-08). The pure fold pre-checks, so the store is never asked to exceed 25.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Which widgets did this filter narrow (count + outline) | A custom widget/table matcher | `enumerateVizDescriptors` + `computeReverseFilterMap` | Already honours per-viz source allow-lists, dv scope, layer->map host resolution, stays in lockstep with the orchestrator |
| Chip/answer text | New formatter | `buildChipText` | Identical wording to clicks, handles in/between/datetime |
| Type inference | New type map | `inferDataTypeFromColumn` (client) / mirrored rules (server) | Same dataType a drill-down/DataFilter would persist |
| Clear-all iteration | Re-deriving keys | Pattern from `clearAllFilters.ts:13-21` (minus the spatial clear) | Snapshot keys before looping (functional `set` deletes) |
| "Did you mean" for columns | New fuzzy matcher | `nearest()` in `gateway.ts:59-79` | Already tuned |
| Choice UI for ambiguity | New dialog | `choose_option` clarification (`aiAsk.ts:113`, `replyTrailer.ts`, `AiChat.tsx` choices) | 137 machinery, option label becomes the next user message |
| Highlight outline | New CSS/animation | `aiSessionStore.setHighlight` + `.widget-card--ai-changed` (`WidgetCard.tsx:133`) | D-15 says reuse the 137 outline |
| "AI" tag styling | New class | `widget-filter-badge` | CLAUDE.md: reuse existing classes, no hex |

**Key insight:** the filter system is already one funnel (filterStore -> orchestrator -> combo store). Anything that writes the stores the way a click does is "the same path"; anything that tries to be clever downstream (materialize, WMS, view names) re-creates a bug class this repo already fixed (SSYNC-F6, the v1.18 read-path flip).

## Common Pitfalls

### Pitfall 1: Lock/bar fire on a filter-only answer
**What goes wrong:** `applyTurn` records filter entries as `applied`; `selectHasUnsavedAiChanges` then locks editing, shows the bar and the leave dialog (D-09 violated).
**How to avoid:** exclude filter ops in `isApplied` and in `foldSession`'s `applied++`; spec: filter-only turn -> `hasUnsavedAiChanges() === false`, `AiChangeBar` renders null; mixed turn -> true and counts unchanged.
**Warning signs:** bar text "none shown at this point" appearing after a pure filter question.

### Pitfall 2: `sourceWidgetId` and per-widget filter scope
**What goes wrong:** `resolveFilterSet` (`lib/resolveFilterSet.ts`) returns only filters whose `sourceWidgetId` is in a widget's allow-list when that widget's `filterSelection.sourceMode !== "all"`. An AI filter has no `sourceWidgetId`, so such widgets (and map layers with a restricted `filter_scope`) ignore it. A click carries the clicked widget's id so it can be allowed.
**Resolution:** do not fabricate a `sourceWidgetId` (it would make the AI filter appear to come from a real widget and mis-scope it). Accept and document: AI filters narrow every accept-all consumer; scoped widgets deliberately do not. The D-16 count comes from `computeReverseFilterMap`, so the answer is honest. Include a spec with one scoped widget.

### Pitfall 3: Map read path assumed wired but orchestrator not enumerating the layer
**What goes wrong:** map tiles do not narrow if the layer is not in the orchestrator's input.
**Facts:** the orchestrator receives `effectiveWidgets, layers` (`DashboardsPage.tsx:738`), table-bound layers `layers.filter(dynamic_view_id == null)` (`:151-159`), dv layers via `dvLayersKey`; maps and layer hosts are in `NON_TRIGGER_TYPES` for widgets (`:81-97`) but layers are enumerated separately (`:278-301`). Hence no AI-specific wiring; SC4 is proven only by the operator against real Kinetica (WMS tiles cannot be asserted in jsdom). Automated check: assert the layer's `vizToHash["l:<id>"]` resolves and `buildWmsParams` receives the combo view name (pattern in `structuralOps.e2e.spec.ts`, `MapChartRenderer.spec.tsx`).
**Warning signs:** `vizToHash["l:<id>"]` undefined after a tick; layer table not on the dashboard's `tables`.

### Pitfall 4: dv FROM-swap and dv re-materialize on TABLE filters
**What goes wrong:** a table filter also re-materializes dynamic views whose source table is filtered (orchestrator materializes each dv's SOURCE combination, quick-261009-jg6, `useCombinationOrchestrator.ts` header + `dvSourcesKey`). dv-backed widgets can sit in pending/over_threshold/error after an AI table filter - same as after a click. A dv filter (`addDvFilter`) filters the dv's own materialized view in place (dv-isolated).
**How to avoid:** no AI code; make sure UAT includes one dv-backed widget; do not special-case.

### Pitfall 5: Stale snapshot vs. apply-time store
**What goes wrong:** the ask body snapshot is taken at ask start; the user may click filters while the answer streams (up to minutes). Evaluating cap/replace/before against the snapshot gives wrong deltas.
**How to avoid:** the fold gets `currentFilters` read from the store at apply time; the applier captures `before` at apply time. Gateway cap check (snapshot) is best-effort only.

### Pitfall 6: `filterVersion` ticks and dedupe
**What goes wrong:** `addFilter` of an identical scalar is a silent no-op (no bump); `setBulkFilters` always bumps and never dedupes; arrays never dedupe. Recording a delta for a no-op yields a bogus inverse.
**How to avoid:** the applier compares `key(before)` and `key(new)`; equal -> no store call, no delta, answer says "already filtered".

### Pitfall 7: Extra field on `ActiveFilter` leaking
`aiApplied` is sent to the server inside `filters[]` (orchestrator passes `resolved`) and into `stableComboHash`'s input objects. Verified harmless (hash reads three fields; server body is cast, no schema). Add one spec: two filters equal except `aiApplied` hash identically, so an AI filter and the equal click filter share a combination view. Update the server `whereClause.ts` type comment only if you want parity; not required.

### Pitfall 8: Snapshot filter cap of 50
See Pattern 5. A power user with >50 total filters turns every AI ask into a 400 until this is raised.

### Pitfall 9: Provider-facing leaks of filter values
Values appear in: tool args (audited, user-originated), the op returned to the client, and any text you compose. Keep them out of `describeOp` labels, `chat.applied`, `Turn.answer`, and anything `buildAskTurns`/`buildConversationMessages` sends back. Add a planted-value spec mirroring `lib.aiContext.spec.ts:38` (`dirty.filters[0].value = "SECRETVAL"`): a planted manual filter value never appears in the outbound parts, and the apply label never contains the applied value.

### Pitfall 10: Parallel executors colliding on shared files (memory)
`DashboardsPage.tsx`, `chatText.ts`, `aiSessionStore.ts`, `types.ts`, `foldSession.ts`, `shared/aiOp.ts`, ROADMAP/STATE/REQUIREMENTS: one plan owns each (see Plan Split). Bookkeeping docs by hand, by the LAST plan only (gsd-tools corrupts STATE; executors mark multi-phase requirements early).

### Pitfall 11: CSS/visual defects evade every gate (memory + CLAUDE.md)
The "AI" tag and filter note lines are visual: reuse `widget-filter-badge`/`ai-chat-note`, no hex/rgba; route legibility in light AND dark to a `checkpoint:human-verify`.

### Pitfall 12: Temp-id sources
Table sources are always real ids (positive). AI-added widgets (negative ids) on a saved table are narrowed through the table filter like any widget (the orchestrator is fed `effectiveWidgets`). Negative dv ids (Phase 139) are refused by the gateway AND by the fold in 138. Revert of a turn that added a widget and filtered the same table: deltas are independent of widget presence; fine.

## Code Examples

### Evaluation sketch (pure, in foldSession.ts)
```typescript
case "apply_filter": {
  const key = `${op.source.kind}:${op.source.id}`;
  if (op.source.kind === "table" ? !sim.tableIds?.has(op.source.id) : !sim.dvs.has(op.source.id)) return done(skip("target_not_found"));
  const cols = sim.filters.get(key) ?? new Set<string>();           // seeded from opts.currentFilters
  const fresh = op.filters.filter((f) => !cols.has(f.column));
  if (cols.size + new Set(fresh.map((f) => f.column)).size > AI_FILTER_CAP_PER_TABLE) return done(skip("filter_cap"));
  const known = op.source.kind === "table" ? columnsOf(baseline, op.source.id) : undefined;
  if (known && op.filters.some((f) => !(f.column in known))) return done(skip("column_not_found"));
  op.filters.forEach((f) => cols.add(f.column)); sim.filters.set(key, cols);
  return done({ status: "applied" });
}
```
(In `simApply`/`done`, mirror applied filter ops into `sim.filters` so later ops in the same turn see them.)

### Executing an applied op (applier, outside the engine)
```typescript
export function applyFilterOp(op: ApplyFilterOp): FilterDelta[] {
  const deltas: FilterDelta[] = [];
  for (const it of op.filters) {
    const next: ActiveFilter = { column: it.column, operator: it.operator, value: it.value ?? null, dataType: it.dataType ?? "string", addedAt: Date.now(), aiApplied: true };
    const before = cur(op.source, it.column);
    if (key(before) === key(next)) continue;           // dedupe parity, no bump, no delta
    set(op.source, it.column, next);
    deltas.push({ source: op.source, column: it.column, before, after: cur(op.source, it.column) }); // after === next when accepted
  }
  return deltas;
}
```
Source: pattern derived from `filterStore.ts:75-112` and `ARCHITECTURE.md` Q4 (`aiFilterApplier`; "inverse touches only the columns the AI changed").

## State of the Art

| Old (planned in 133) | Current (this phase) | Impact |
|----------------------|----------------------|--------|
| `apply_filter {widgetId}` / `clear_filter {widgetId?}` placeholders (`aiOp.ts:82-84`) | source-keyed, typed, column-scoped payloads | Placeholder references to retire: `aiOp.ts:15-16,83-84`, `shadow.ts:165-167,207-209`, `foldSession.ts:261-262`, `foldSession.spec.ts:47` |
| Filter state invisible to the AI (`filters: []`, `buildAskRequest.ts:71`) | Column+operator snapshot, no values | Model can say what is still on; AIGOV-V20-02 intact |

**Deprecated/outdated:** `SkipReason "unsupported_in_134"` for filter ops (keep for dv ops until 139). Legacy `filterViewStore.markMaterializing` write in click handlers is vestigial; do not copy it.

## Test Strategy (Nyquist section skipped: `workflow.nyquist_validation=false`)

**Existing specs that model the click path (assert AI == click through them):**
- `packages/web/src/store/filterStore.spec.ts` - store semantics, cap constant (`FILTER_CAP_PER_TABLE`).
- `packages/web/src/hooks/useCombinationOrchestrator.spec.ts` - mocks `materializeFilter`/`dropCombinationView`, scenarios 1-11 + spatial + dv (`:1460`); template for "filter via applier -> exactly ONE POST with `combinationKey = stableComboHash(...)`" and "AI and click produce the same POST filters (modulo `aiApplied`/`addedAt`/`sourceWidgetId`)".
- `packages/web/src/lib/aiSession/structuralOps.e2e.spec.ts` + `src/test/aiSessionHarness.ts` (`baselineFixture` with tables 5 `demo.trips` and 1; add `applyFilterOp`, `clearFilterOp` builders) - real store + fold, `buildWmsParams` assertions; model the new `aiFilters.e2e.spec.ts` on it.
- `MapChartRenderer.spec.tsx`, `wmsUrlBuilder.spec.ts` - WMS param/view-name assertions for table and dv layers.
- `computeReverseFilterMap.spec.ts` - applies-to semantics (count/outline).
- Server: `tests/lib.aiGateway.spec.ts`, `lib.aiShadow.spec.ts` (SHD-3 no-values labels), `lib.aiTools.spec.ts`, `lib.aiToolsRegistry.spec.ts` (flat-schema check over every tool, `:32`), `lib.aiContext.spec.ts` (snapshot projection drops values; `AI_SYSTEM_RULES` must stay <= 30 lines, `:80`, currently 18 lines incl. trailer), `lib.aiReplyTrailer.spec.ts`, `lib.aiAgentLoop.spec.ts`, `lib.aiStructural.e2e.spec.ts`, `routes.aiAsk.structural.spec.ts` (scripted provider E2E; add filter scripts).
- Shared: `aiOp.spec.ts` (AIOP-8 asserts exactly 12 op literals, keep it true), new `aiFilter.spec.ts`.

**Mandatory new red-before specs (CLAUDE.md "grep criteria must read 0 first"; verified now: `grep -rn "aiFilterApplier\|AI_FILTER_CAP_PER_TABLE\|filterDeltas\|aiApplied" packages --include='*.ts' --include='*.tsx' | grep -v node_modules` = 0 hits, so each of these identifiers is a valid fail-before anchor):**
1. Shared: valid/invalid payloads (missing source, `column` without `source`, `between` mixed types, negative table id, strict extra key); drift guard `AI_FILTER_CAP_PER_TABLE === FILTER_CAP_PER_TABLE`.
2. Gateway: unknown column refused with did-you-mean, no value in reasons; numeric column + non-numeric value refused; 25th-column cap refused whole (and replacing at cap allowed); ambiguous column -> `choose_option` with table labels, unique column resolves; temp/negative dv refused; unknown source/other-dashboard dv refused; `clear_filter` of a column that is not filtered refused; two ops in one answer count against one shadow; label contains no value.
3. Fold/store: filter-only turn -> `hasUnsavedAiChanges()===false`, bar null; mixed turn locks, counts unchanged; foldSession ignores filter entries (`appliedOpCount` 0); `decoupling` spec still green (new modules not in its list, existing four files unchanged in banned symbols).
4. Applier: eq/in/between/isNull on table and dv produce the same `filterStore` state a click produces (`filters[tableId]` / `dvFilters[dvId]`, one `filterVersion` bump per batch); replace same column (D-05), stack other columns (D-06), clear column/source/all without touching spatial shapes (D-07); cap refusal applies nothing (D-08); orchestrator POST body equal to the click's; map layer `vizToHash` + WMS view name.
5. Undo: per-column inverse with a manual filter on another column and on the same column added after the AI turn (D-11 both ways), forward guard, overlapping-column multi-turn revert, `discardAiSession` (D-12) leaving later manual filters, 50-turn squash keeps deltas.
6. Privacy: planted filter value in the snapshot filters never reaches outbound parts (mirror `lib.aiContext.spec.ts:38`); `Turn.answer` never contains client-composed notes; `buildAskTurns` output has no filter value.
7. UI (RTL): `FilterChip` topbar byte-identical without `aiApplied` (existing FilterChip spec stays green), tag present with it and gone after replace/remove; chips read from `filterStore` while badges read combination store.
8. Static greps: `aiFilterApplier.ts` does not import `filterViewStore`/`materializeFilter`; orchestrator sole-trigger gate stays green.

**DEV harness additions (`devHarness.ts`; add to `Harness` type, `help()` text and `devHarness.spec.ts`):** `filter(sourceKind, id, column, operator, valueOrArgs)`, `clearFilter(sourceKind?, id?, column?)` (both via `applyAiTurn` so they take the real path incl. deltas/highlight/notes), `highlight(ids)` (calls `setHighlight` - closes the known 137 UAT gap #8), `filterState()` (reports filterStore + AI deltas + `hasUnsavedAiChanges`). Reuse `chatTurn` for answer-bubble states.

**Operator human-verify (cannot be automated; `autonomous: false` checkpoint plan):**
- SC4: on dashboard 12 (map 117 + bar 118, layer 23, table 1 `demo.nyctaxi`) apply a filter via harness `filter(...)` AND, after the 142-style live ask is not available, via harness only (no provider calls needed): map tiles visibly narrow against real Kinetica, bar/records narrow, clear restores; light and dark; run through the CDP harness as in 136/137 UAT.
- Outline appears on all narrowed widgets and the map host and fades; no "AI edited" pill; "AI" tag legible on top-bar and panel chips in light+dark; filter-only answer shows no bar/lock; leave warning does not fire; Revert/Forward restore per column while a manual filter survives; zero-row note and "Clear this filter" button read correctly; one dv-backed widget narrows.
- Live model adherence to the new prompt rules (omit tableId, exact casing, Choices trailer for ambiguity) is NOT checkable without a provider key (no Anthropic key; Gemini free tier is the dev path): defer to Phase 142 live UAT and say so in the verification report.

## Plan / Wave Split (suggested)

Respect "one plan owns each shared file" (memory: parallel executors clobber shared docs/files).

| Plan | Wave | Owns (files) | Notes |
|------|------|--------------|-------|
| 138-01 Contract | 1 | `shared/src/aiFilter.ts` (new), `aiOp.ts`, `aiAsk.ts` (raise `filters` max), `index.ts`, `aiOp.spec.ts`/`aiFilter.spec.ts` | Everyone depends on it; keep AIOP-8 true |
| 138-02 Server gateway/tools/prompt | 2 | `server/src/lib/ai/{shadow,gateway,context}.ts`, `tools/{mutate,types}.ts`, `db`-side dv column accessor wiring in `runAnswer.ts`, server specs | Disjoint from web |
| 138-03 Web fold/types/lock | 2 | `lib/aiSession/{types,foldSession,constants}.ts`, `store/aiSessionStore.ts` (lock selector, sink, `attachEntryFilterDeltas`, `setCursor` hook), `buildAskRequest.ts` (wire filters), their specs, `foldSession.spec.ts:47` | Disjoint from 02 (different package) |
| 138-04 Applier + undo + counts + zero-rows | 3 | `lib/aiOps/{aiFilterApplier,applyAiTurn}.ts` (+ specs incl. click-equivalence e2e, orchestrator POST equality), `filterStore.ts` (`aiApplied` field only) | Depends on 01+03 |
| 138-05 UI + wiring | 4 | `FilterChip.tsx`, `FilterPanel.tsx` (type), `DashboardsPage.tsx` (chips, sink install via actions hook, discard wiring), `AiChat.tsx` (notes + clear offer), `AiDiscardDialog.tsx`, `chatText.ts`, `askRunner.ts` (call `applyAiTurn`), `hooks/useAiSessionActions.ts`, `devHarness.ts` (+spec) | Single owner of `DashboardsPage.tsx` |
| 138-06 Operator verification | 5 | `138-UAT*.md` only; bookkeeping (ROADMAP/STATE/REQUIREMENTS) by hand, only here | `checkpoint:human-verify`, SC4 |

Plan 02 and 03 may run in parallel (disjoint packages). Test gates per CLAUDE.md: `cd packages/web && npx tsc --noEmit`, `npx vitest run`, `npx vitest run src/styles/theme-guard.spec.ts`; server `npx tsc --noEmit` and the SET-BASED vitest rule (do not assert a pass-count); run web and server suites sequentially, `--maxWorkers=4` (parallel runs give false timeouts, memory).

## Open Questions

1. **Zero-row detection mechanics (D-17)**
   - Known: no global row-count signal exists; schema mode cannot count server-side; `COUNT(*)` over the combo view through `runSql` from the browser is safe (never touches the provider).
   - Unclear: sources with drawn shapes + eligible spatial target fold shapes into the hash, so the direct-hash lookup misses.
   - Recommendation: implement direct-hash lookup, silently skip the check when it misses; record the limitation. Confidence MEDIUM.
2. **dv column validation source**
   - Known: snapshot has dv `{id,name}` only; `columns_json` exists on the dv row (refreshed by Preview/save); materialize has the authoritative probe backstop.
   - Unclear: whether a stale/null `columns_json` is acceptable as a pre-check.
   - Recommendation: pre-check only when present, never refuse on absence; rely on the backstop; document. (The AISAFE-V20-03 "live probe, never the stored blob" rule was written for tables.)
3. **Source kind label** `"dynamicView"` (recommended, matches `SnapFilter`) vs `"dv"` (CONTEXT example). Discretion item; pick `dynamicView`.
4. **Zero-row "Clear this filter" button** as a direct local `removeFilter` (recommended: no quota, user-click semantics) vs a new provider turn. Discretion.
5. **Numeric string coercion strictness** (thousands commas). Recommend accept only plain numerics plus a strict `1,234`/`1,234.5` pattern; otherwise refuse with the column name.

## Sources

### Primary (HIGH confidence - read in this repo, 2026-10-15)
- `packages/web/src/store/filterStore.ts`, `filterCombinationStore.ts`, `lib/clearAllFilters.ts`, `lib/stableComboHash.ts`, `lib/resolveFilterSet.ts`, `lib/computeReverseFilterMap.ts`, `lib/useReverseFilterMap.ts`, `lib/columnTypes.ts`
- `packages/web/src/hooks/useCombinationOrchestrator.ts` (header, deps, enumeration, materialize), `components/charts/WidgetRenderer.tsx:156-240, 480-545`, `components/charts/MapChartRenderer.tsx:625-660, 1315-1380, 1583-1650`, `FilterChip.tsx`, `FilterPanel.tsx`, `FilteringBadge.tsx`, `components/DashboardsPage.tsx:730-740, 775-880, 1090-1150, 1660-1775`, `WidgetCard.tsx`
- `packages/web/src/store/aiSessionStore.ts`, `lib/aiSession/{types,foldSession,askRunner,buildAskRequest,changeCounts,applySession,chatText,constants,devHarness}.ts`, `components/{AiChangeBar,AiDiscardDialog,AiLeaveDialog}.tsx`, `components/charts/AiChat.tsx`, `hooks/useAiSessionActions.ts`, `lib/actionEngineDecoupling.spec.ts`
- `packages/shared/src/{aiOp,aiAsk,actionAllowList}.ts`, `index.ts`
- `packages/server/src/lib/ai/{gateway,shadow,context,runAnswer,agentLoop,replyTrailer,liveSchema}.ts`, `tools/{mutate,read,registry,types}.ts`, `lib/whereClause.ts`, `index.ts:1312-1400`, `lib/aiAudit.ts`
- `.planning/phases/138-ai-filters/138-CONTEXT.md`, `.planning/research/ARCHITECTURE.md` (Q4, Q5-undo, anti-pattern 2), `PITFALLS.md` (M8, filter-value leak), `137-12-UAT-RESULTS.md` (harness highlight gap), `.planning/config.json`

### Secondary (MEDIUM)
- Repo memory notes (filtering badges read combination store; map WMS is a separate read-path; parallel executors collide; CSS bugs evade gates; sequential test runs) - operator-recorded history.

### Tertiary (LOW)
- None. No external web sources were needed; no provider or Kinetica was contacted, `.env` was not read, no suites were run.

## Metadata

**Confidence breakdown:**
- Standard stack / click path: HIGH - every claim traced to file:line in current code.
- Architecture (op shape, gateway, fold, deltas): HIGH on constraints (strict zod, flat schemas, decoupling grep, lock selector), MEDIUM on the exact sink/`attachEntryFilterDeltas` shape (design choice, several equivalent forms).
- Pitfalls: HIGH for 1-9 (verified in code), MEDIUM for 4 (dv re-materialize behaviour read from orchestrator header comments, not exercised).
- Zero-row detection and dv column pre-check: MEDIUM (see Open Questions).

**Research date:** 2026-10-15
**Valid until:** ~2026-11-15 (stable code; invalid if Phase 139 lands first and changes dv source semantics)
