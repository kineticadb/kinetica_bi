# Phase 134: Session Layer Engine (client, no LLM) - Research

**Researched:** 2026-10-12
**Domain:** Client-side (React 18 + zustand 4 + react-grid-layout 2.2.2) in-memory session layer over an existing source-keyed overlay engine
**Confidence:** HIGH on code-derived findings (all read from the repo, file:line cited); MEDIUM on react-grid-layout `static` behaviour and the browser-Back re-push (not exercised yet)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01** The session layer is an ordered list of **turns** with a **current position (cursor)**. Each turn records at least: an id, the user's prompt text, the AI's answer text (filled later by 135/137; may be empty in harness tests), the ops it applied, and enough inverse/snapshot data to restore the dashboard to "after this turn" as one unit.
- **D-02** **Revert to any turn** restores that turn's resulting state as one unit. Moving the cursor back does NOT delete later turns; the user can **jump forward** again to any later turn.
- **D-03** **Asking a new question while the cursor is not at the end replaces the later turns** (they are dropped; normal undo semantics).
- **D-04** History is cleared by **Keep** and by **Discard**; **reload clears it** (locked - in-memory only, never persisted).
- **D-05** **One shared history per dashboard per user.** If a dashboard has several AI widgets they all read/write the same session layer and show the same conversation.
- **D-06** Depth: all turns since the last Keep/Discard are revertible; an internal safety cap is Claude's discretion (e.g. 50 turns, oldest dropped with a note).
- **D-07** **Editing is locked** while the session layer has unsaved AI changes: the designer must **Keep** (save) or **Discard** first, then edit.
- **D-08** Lock scope = **editing only**. Blocked: widget config panels, add/delete widgets, the Layers and Dynamic Views editors, dashboard settings, drag/resize of SAVED widgets. Still allowed: filters, drill, map pan/zoom/draw, info popups, radio controls, exports, the AI widget itself.
- **D-09** This phase owns the lock **state + guard** (a single selector/hook such as `hasUnsavedAiChanges` that every edit entry point checks, plus specs that each blocked entry point is gated). The user-facing message text/placement may be finished in Phase 137; a plain non-blocking notice reusing existing classes is acceptable here.
- **D-10** With D-07 the user's own edits can't orphan AI changes. The remaining case is another user changing the dashboard concurrently -> handled by Phase 141's Keep 409; record any AI op whose target vanished as skipped (not applied), never crash.
- **D-11** **Most recent wins** when a radio control and an AI op set the same field. Reverting the AI turn restores whatever the radio set. The AI contribution must be rebuilt from the whole log under a reserved source id so it never wipes the radio's contribution (and vice versa) - `widgetActionStore` is source-keyed replace.
- **D-12** AI-added widgets' geometry is **session-only**; users **can drag/resize AI-added widgets** before Keep, and that geometry is part of the unsaved AI changes (persisted only by Keep, dropped by Discard/revert). Saved widgets stay locked (D-08).
- **D-13** `onLayoutChange` (DashboardsPage grid) must **never persist** AI-widget geometry nor reflow-and-save saved widgets because AI widgets were inserted. Test + operator human-verify.
- **D-14** *(For Phase 136, recorded now)* Placement: fill gaps first, then below existing content, with sensible per-type sizing. Saved widgets never move.
- **D-15** **Warn first.** In-app dashboard switch / navigation -> "You have unsaved AI changes - Discard and leave / Stay" (portalled modal; reuse the existing confirm-dialog pattern and classes). Reload / tab close -> browser `beforeunload` prompt. Leaving discards.

### Claude's Discretion
- Store shape (snapshot vs op-log + inverses per turn), temp-id scheme (negative ids per research), and how derived effective widgets/layers/dvs merge at the read sites (DashboardsPage, MapChartRenderer, LegendRenderer, applyLayerOverrides).
- The safety cap value (D-06) and the in-phase notice wording (D-09).
- How the harness drives ops in tests (scripted op lists through the shared `AiOp` contract from `@kinetica-bi/shared`).

### Deferred Ideas (OUT OF SCOPE)
- **AI-F13** per-dashboard "viewers can prompt" switch.
- Chat UI, size-driven inline/drawer presentation, highlights, Keep/Discard bar - Phase 137.
- Placement algorithm and per-type sizing - Phase 136 (D-14 recorded for it).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| AISES-V20-01 | Changes from one answer apply together and immediately; only the asking user sees them; no DB write | Single `applyTurn` = one zustand `set` + one `setControlContribution` write (Q1, Q2). Zero `api/client` imports in the new store (grep-testable). |
| AISES-V20-02 | A second answer builds on the first | Rebuild-from-log under `AI_SOURCE_ID = 0` + per-target merge in the fold (Q2). Hazard proven by a paired "naive path erases" test. |
| AISES-V20-03 | Revert to any earlier answer, jump forward; new question replaces later answers; Keep clears history | Cursor + pure fold over a log prefix; `setCursor(i)` is a single batch (Q1). |
| AISES-V20-07 | Discard / reload restores saved dashboard exactly | `reset()` joins DashboardOpen cleanup chain + App.tsx logout chain; saved `widgets` state and `dashboardLayersStore` are never mutated by the session layer (Q3). |
</phase_requirements>

## Summary

The saved dashboard is held in three places the session layer must NOT mutate: `widgets` (local `useState` in `DashboardOpen`, `DashboardsPage.tsx:602`), `useDashboardLayersStore` (global zustand, `store/dashboardLayersStore.ts:29`), and `dynamicViews` (local state inside `useDynamicViewMaterializeChain`, `hooks/useDynamicViewMaterializeChain.ts:66`). The session layer therefore has to be a **derived overlay**: a new `aiSessionStore` holds an ordered log of turns + a cursor, a pure `foldSession(baseline, turns, cursor)` function produces a `SessionDerived` value (added / removed / patched entities), and consumers merge that over the saved lists at the read sites. Because the saved entities are never touched, **inverse ops are unnecessary**: revert/forward is "move the cursor, re-fold, one `set()`", and Discard is "drop the log". This deliberately deviates from PITFALLS C7's "command pattern with inverses" and satisfies D-01's "inverse/snapshot data" by being replayable from the log.

The two non-obvious hazards found in the code: (1) `widgetActionStore.deriveOverlays` iterates `Object.keys(contributions)`, and JS orders integer keys **ascending** regardless of insertion, so the file's "insertion order = control order" comment is false for numeric ids (verified in node: keys `5,-1,0,2` iterate as `0,2,5,-1`). "Most recent wins" across a radio and the AI is therefore **not expressible today**; the minimal fix is a monotonic per-control sequence number used to sort in `deriveOverlays`. (2) `applyWidgetActions` replaces per-target (`combined.widget[target.id] = configPatch`, `lib/applyWidgetAction.ts:~365`), so even "pass the whole log through the existing plural dispatcher" erases turn 1 when turn 2 patches the same target; the fold must merge per target first and write via `setControlContribution` directly.

The layout answer is "both": mark SAVED items `static: true` in the layout array while the lock is on (RGL then neither drags, resizes nor displaces them), AND make `handleLayoutChange` a no-op for saved widgets while locked and route AI-item geometry to the session store. Today `handleLayoutChange` (`DashboardsPage.tsx:1155-1172`) writes `updateWidget` for any widget whose rect differs from its stored one, so a collision push caused by an inserted AI item would otherwise be persisted.

**Primary recommendation:** Op-log + cursor + pure fold (no inverses, no per-turn snapshots); AI patches on saved targets rebuilt into ONE `setControlContribution(AI_SOURCE_ID = 0, ...)` with a sequence-number ordering fix in `widgetActionStore`; effective widgets/layers/dvs merged via one pure helper set and one `useEffectiveLayers()` hook at every read site; ONE edit-lock source (`editLocked`) AND-ed into `canEdit/canConfigure/canDynamicViews/canLayers` plus handler-level guards; saved grid items `static` while locked.

## Standard Stack

No new dependencies. Everything below is already in the repo.

### Core
| Library | Version (verified in package.json / node_modules) | Purpose | Why |
|---------|---------|---------|-----|
| zustand | ^4.5.2 | `aiSessionStore` | All 13 session stores are zustand; `__mocks__/zustand.ts` auto-resets every store after each test (`test/setup.ts` `vi.mock("zustand")`), so a new store under `src/store/*.ts` is test-isolated for free |
| react-grid-layout | 2.2.2 (node_modules/react-grid-layout/package.json) | grid; `LayoutItem.static`, `isDraggable`, `isResizable` per item (`dist/types-BiXsdXr7.d.ts:36-48`) | already the grid; v2 API (`dragConfig`, `resizeConfig`) |
| @kinetica-bi/shared | workspace `*` | `AiOp`, `AiOpSchema`, `parseAiOp`, `AiTempIdSchema`, `validateActionPatch`, `validateLayerSnapshot` | Phase 133 contract; `web/src/lib/actionAllowList.ts` + `widgetAction.ts` are shims over it |
| vitest 4.1.5 + @testing-library/react 16 + user-event 14 | per package.json | specs | existing |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| op-log + pure fold | snapshot-per-turn | Snapshots cost a full widgets+layers+dvs structure per turn and make D-06 "drop oldest" trivial, but need a snapshot of *base-relative* state anyway; the fold gives identical semantics with O(ops) memory and no stale-snapshot bugs. See Q1. |
| op-log + inverses (PITFALLS C7) | - | Inverses only matter if you mutate shared state in place. We never mutate saved state, so inverses are dead weight and a bug surface (the C7 "restore removed widget with colliding id" failure mode cannot occur). |
| ids via `Number.MIN_SAFE_INTEGER` for `AI_SOURCE_ID` | `0` | `0` is excluded by `AiRefIdSchema` (non-zero) and is never a widget id (autoincrement > 0), so it cannot collide with a radio control id or a temp id. Use `0`. |

**Installation:** none.

## Architecture Patterns

### Recommended Project Structure
```
packages/web/src/
  store/aiSessionStore.ts            # NEW: turns, cursor, derived, geometry; actions below
  store/aiSessionStore.spec.ts       # NEW
  lib/aiSession/foldSession.ts       # NEW: pure fold(baseline, baseOps, turns, cursor) -> SessionDerived
  lib/aiSession/applySession.ts      # NEW: applySessionToWidgets/Layers/DynamicViews (pure, ref-stable when empty)
  lib/aiSession/constants.ts         # NEW: AI_SOURCE_ID = 0, SESSION_TURN_CAP = 50
  hooks/useEffectiveLayers.ts        # NEW: saved layers store + session -> merged, memoized
  hooks/useAiEditLock.ts             # NEW: hasUnsavedAiChanges selector + hook + getState helper
  lib/aiLeaveGuard.ts                # NEW: requestLeave(proceed) (mirrors components/settings/brandPageGuard)
  components/AiLeaveDialog.tsx       # NEW: portalled modal
  test/aiSessionHarness.ts           # NEW: scripted-ops driver
```
Modified: `store/widgetActionStore.ts` (ordering), `lib/applyWidgetAction.ts` (export `splitLayerSnapshot`), `components/DashboardsPage.tsx`, `App.tsx`, `components/charts/MapChartRenderer.tsx`, `LegendRenderer.tsx`, `InfoCardRenderer.tsx`, `hooks/useLayerVisibilityToggle.ts`.

### Pattern 1: Turn / cursor store (Q1 answer)
**What:** State = `{ dashboardId, baseOps, droppedCount, turns[], cursor, nextTempId, geometry, derived }`.
- `cursor` is an index in `[-1 .. turns.length-1]`; `-1` = "saved dashboard (plus any squashed base)".
- `Turn = { id, prompt, answer, ops: AiOp[], results: OpResult[], createdAt }`; `OpResult = {status:"applied"} | {status:"skipped", reason}`. `results` are computed ONCE at apply time (target exists? tempId unique? valid? kind supported in 134?) so replays are deterministic (D-10: skipped, never crash).
- `derived` = `foldSession(baseline, baseOps, turns.slice(0, cursor+1))`, stored in state and recomputed inside the SAME `set()` that moves the cursor. Consumers subscribe to `derived` (referentially new only when it actually changes).
- Actions: `applyTurn(input, baseline)` (if `cursor < turns.length-1` first truncates later turns = D-03, and prunes `geometry` entries for tempIds that no longer exist in any kept turn), `setCursor(i, baseline)` (revert AND forward, same code), `reset()` (Discard / Keep-clear / cleanup chain), `setGeometry(tempId, rect)`, `allocateTempId()` (monotonic, never reused, so a dropped turn's ids cannot collide with geometry).
- Cap (D-06, `SESSION_TURN_CAP = 50`): when exceeded, **squash** the oldest turn's applied ops into `baseOps` and increment `droppedCount` (the note). Plain `shift()` would be WRONG for a fold design: later turns depend on earlier ops. Revert-to-start after a squash means "state after squashed base".
- `hasUnsavedAiChanges = turns.some(t => t.results.some(r => r.status === "applied"))` (history of op-less chat turns must not lock editing or trigger the leave warning). Note it stays true at `cursor = -1`: user can jump forward, so editing must stay locked while any applied turn exists.

**Memory:** ops are small JSON (KBs); `derived` holds only added entities + patch maps. 50 turns x ~10 ops is trivial. No snapshot copies.

**Two-store write (one batch):** `applyTurn`/`setCursor` do `set({...derived})` then, synchronously in the same function, `useWidgetActionStore.getState().setControlContribution(AI_SOURCE_ID, derived.contribution)`. Two zustand stores cannot be atomic, but React 18 automatic batching coalesces both notifications into one commit. Prove it with a render-probe spec (below), do not assume it.

### Pattern 2: Rebuild-from-log under `AI_SOURCE_ID` (Q2 answer)
The fold produces `derived.contribution = { widget, layer, dynamicView }` already DTO-shaped:
- widget/dv patches on **saved** targets: shallow-merge across turns in order (later turn wins per field).
- layer patches on saved layers: split with `splitLayerSnapshot` (currently module-private at `lib/applyWidgetAction.ts:113` - export it, one-word change) so `track_config`/`cb_config` stay TOP-LEVEL (memory: track-config-toplevel-field), config keys nest; merge across turns the way `deriveOverlays` does (`widgetActionStore.ts:~137-165`).
- patches on **temp** targets: merged into the added entity's own `config` inside the fold (overlays are keyed by saved ids; ARCHITECTURE.md Q3).
- patch on a saved target that a later op removed: dropped from the contribution.
- Validate at apply time with `validateActionPatch(kind, widgetType, patch)` / `validateLayerSnapshot(patch)` (same functions the engine uses, `applyWidgetAction.ts:~203`); record `skipped` instead of toasting. Do NOT call `applyWidgetActions` for the rebuild: it toasts on rejects (`:~330`) and overwrites per target (see Pitfall 2).

**D-11 "most recent wins" - is it expressible today? No.** `deriveOverlays` iterates `Object.keys(contributions)` (`widgetActionStore.ts:~131`); for numeric keys this is ascending-numeric, not insertion order (node-verified). With `AI_SOURCE_ID = 0` the AI is always applied FIRST (radio always wins); with a negative id the AI is always LAST (AI always wins). Neither is recency.

**Minimal change:** add `order: Record<number, number>` + a module counter in `widgetActionStore`; `setControlContribution` assigns `order[controlId] = ++seq` (move-to-end on every write, including re-select), `clearControl`/`reset` clean it; `deriveOverlays(contributions, order)` sorts `Object.keys` by `order` (fallback `Number(key)` when absent). Every `setControlContribution` caller is a user action (radio select, AI rebuild), so "last write = most recent action". Radio-vs-radio conflicts switch from id-ascending to recency - this is the behaviour the header comment already claims; run `widgetActionStore.spec.ts`, `applyWidgetAction.spec.ts` and `RadioGroupRenderer` specs to confirm no assertion pinned the old order (the existing two-control test at `widgetActionStore.spec.ts:71` passes under both). Policy: every AI rebuild (new turn, revert, forward) bumps the AI source to most-recent - revert/forward is an explicit user action. Flagged as Open Question 2.

Caveat: `releaseLayerConfigField` (`widgetActionStore.ts:~257`, called from `useLayerVisibilityToggle.ts:54`) strips a field from EVERY control including the AI source; the next AI rebuild re-pins it. Acceptable (most-recent action wins) - document it in the spec.

### Pattern 3: Effective-list merge at the read sites (Q3)
Pure, ref-stable helpers in `lib/aiSession/applySession.ts`: if `derived` has no change for that kind, **return the input array itself** (so `React.memo`, `useMemo` deps and the no-session path stay byte-identical to today).
```ts
export function applySessionToWidgets(saved: WidgetDto[], d: SessionDerived): WidgetDto[] {
  if (d.removedWidgetIds.size === 0 && d.addedWidgets.length === 0) return saved;
  return [...saved.filter(w => !d.removedWidgetIds.has(w.id)), ...d.addedWidgets];
}
```
In `DashboardOpen`: keep `widgets` (saved) as the edit/persistence source; compute `effectiveWidgets = useMemo(applySessionToWidgets(widgets, derived))`, `effectiveLayers = useEffectiveLayers()`, `effectiveDvs = applySessionToDynamicViews(dynamicViews, derived)` and feed **effective** to read-only consumers, **saved** to persistence handlers.

### Pattern 4: Single edit lock (Q4)
`useAiEditLock()` -> `editLocked: boolean` (selector on `hasUnsavedAiChanges`); `isAiEditLocked()` for non-React callers. In `DashboardOpen` (`DashboardsPage.tsx:591-594`) rename the raw permission reads and define
`canEdit = rawCanEdit && !editLocked`, same for `canConfigure`, `canDynamicViews`, `canLayers`. These four names are consumed by every toolbar button (`:1337-1361`), `WidgetCard` props (`:1423-1425`) and RGL drag/resize (`:1414-1415`), so one definition gates them all. Belt-and-braces: handler-level `if (isAiEditLocked()) return` in each persistence handler (list in Q4 table) so a stale-closure or non-button route (e.g. `LegendRenderer` "Reconfigure" CTA, which receives `onConfigureWidget` through `WidgetCard`, `WidgetCard.tsx:185`) cannot persist. Toolbar buttons: render `disabled` + `title="Keep or discard the AI changes first"` rather than hiding (discoverable; the 137 bar finishes the UX, D-09). Close any open edit modal when the lock engages (effect on `editLocked` true -> `setShowLayersModal(false)` etc.) because a modal opened before the lock would otherwise still save.

### Anti-Patterns to Avoid
- **Writing session widgets into `widgets` state / `dashboardLayersStore` / `listDynamicViews` results.** Contaminates handlers that persist (`handleLayoutChange` calls `updateWidget(widget.id)`; a negative id would hit the server) and breaks D-07 exact-restore.
- **Draft DB rows** (SUMMARY.md): leak into every list query.
- **Inverse ops / per-turn snapshots**: unnecessary here.
- **Passing session dvs into `useDynamicViewMaterializeChain`**: its `fireCascade` calls the server for every dv in its list (`hooks/useDynamicViewMaterializeChain.ts:~140-190`); a temp dv would 404. Merge dvs AFTER the hook returns.
- **`AI_SOURCE_ID` negative**: collides with temp widget ids if an AI-added control widget ever dispatches with `controlId = widget.id` (negative). Use `0`.
- **Importing filter stores in the session store** (INVARIANT ACTION-ENGINE-NO-FILTER, `lib/actionEngineDecoupling.spec.ts` bans `materializeFilter|dropFilterView|addFilter\b|setBulkFilters|filterVersion` in engine modules). `apply_filter`/`clear_filter` ops are recorded `skipped: "unsupported_in_134"` (Phase 138 owns them). Add `aiSessionStore.ts` and `foldSession.ts` to that spec's `ENGINE_MODULES`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Op shape/ID validation | custom validators | `parseAiOp` / `AiOpSchema` from `@kinetica-bi/shared` (`packages/shared/src/aiOp.ts`) | Strict payloads; negative temp ids; non-zero refs |
| Patch field validation | own allow-list check | `validateActionPatch`, `validateLayerSnapshot` (same ones `applyWidgetAction.ts:~203` uses) | single source of truth, shared with server in 135 |
| Layer DTO split (top-level vs config) | new split | `splitLayerSnapshot` (export it) | `track_config` top-level invariant |
| Overlay merge for patches on saved targets | new overlay store | `widgetActionStore` + existing consumers (`WidgetRenderer.tsx:351`, `MapChartRenderer.tsx:534-540`, `LegendRenderer.tsx:73-77`, `applyLayerOverrides`) | already wired w/o remounts |
| Modal shell | new modal CSS | `.modal-overlay` / `.modal-content` / `.modal-header` / `.modal-title` / `.modal-body` (`styles/global.css:825-866`) + `createPortal` (precedent `components/ExportDialog.tsx:276`) | CLAUDE.md: reuse classes; portal is mandatory (grid transforms trap `position:fixed`) |
| Leave guard plumbing | router blocker | `components/settings/brandPageGuard` pattern (App.tsx:618-628) | there is NO router (App `page` useState + DashboardsPage `view` useState) |
| Grid "don't move saved items" | custom collision logic | RGL per-item `static: true` | library-native; statics are obstacles in compaction |

**Key insight:** the session layer is mostly *plumbing and discipline* (never mutate saved state, merge at read sites, guard every writer). The only new algorithm is a ~60-line fold.

## Read-Site Merge Inventory (Q3)

Legend: NOW = must merge in 134; LATER = defer (phase named); N/A = locked/unaffected.

| # | Site (file:line) | Reads | Classification | Change |
|---|---|---|---|---|
| 1 | `DashboardsPage.tsx:602` `widgets` state; consumers `:637, :656, :664-685, :837, :905, :945-947, :983/1005, :1331, :1375, :1385, :1417, :1610` | saved widgets | **NOW** | introduce `effectiveWidgets`; pass to context (`:1375`), orchestrator (`:656`), `applyAction` lookups (`:664-685`), `aggregateSpatialTargetsByTable` (`:837`), `useReverseFilterMap` (`:905`), `resolveProvenance` (`:983/1005`), `topmostId` (`:945`), `layouts` (`:1331`), grid map (`:1417`), empty-state check (`:1385/:1610`). Keep saved `widgets` for `handleAddVisualization`/`handleDuplicateWidget` nextY, `handleSaveConfig`, `handleRemoveWidget`, `handleLayoutChange`, `WidgetConfigModal`, `LayersModal`, `DynamicViewsModal` props (all locked). |
| 2 | `DashboardsPage.tsx:647` `layers` | layers store | **NOW** | `useEffectiveLayers()`; feeds `useCombinationOrchestrator` (`:656`), `applyAction` lookups, `WidgetCard layers` (`:1421`, `mapTableIds` IIFE `WidgetCard.tsx:~84`), `useReverseFilterMap`. `LayersModal layers` prop (`:1651`) stays saved. |
| 3 | `MapChartRenderer.tsx:513` `allLayers` -> `effectiveLayers :538` -> `includedLayers :575` | layers store | **NOW** | replace the `useDashboardLayersStore((s)=>s.layers)` selector with `useEffectiveLayers()`; `applyLayerOverrides` stays after it. `includedLayers` filters by `config.includedLayerIds`: a map with an explicit id list will not show an added layer unless the fold also appends the temp id to that widget's `includedLayerIds` (needs baseline; the op payload is minimal until 136 - Open Question 3). |
| 4 | `MapChartRenderer.tsx:1327` and `:1587` (two `buildWmsParams` sites) + dep keys `:631 dynamicViewsKey`, `:~648` | `useDynamicViewStore.views[layer.dynamic_view_id]` | **LATER (139)** | keyed by dv id so a negative id works once 139 writes store entries; no 134 change. Memory: map WMS is a separate read path - 139 plan MUST list both sites. |
| 5 | `LegendRenderer.tsx:73-77` | layers store + `applyLayerOverrides`; `useDashboardContext().widgets :44` | **NOW** | `useEffectiveLayers()`; `widgets` from context is already effective once #1 lands. `isOrphan` (`:92`) gives graceful handling when AI removed the bound map. |
| 6 | `InfoCardRenderer.tsx:39` | layers store direct (does NOT apply overrides) | **NOW** | `useEffectiveLayers()` (info-enabled eligibility list) |
| 7 | `lib/applyLayerOverrides.ts:27` | layers + overrides | **no change** | stays the overlay step; session add/remove happens before it |
| 8 | `MapConfigPanel.tsx:83`, `RadioGroupConfigPanel.tsx:712` | layers store (inside config modals) | N/A (locked, D-08) | switch to the hook in 136/137 when AI map widgets become configurable |
| 9 | `WidgetRenderer.tsx:351` widget overlay; `:2243` `overrideActive` | `widgetOverrides[widget.id]` | **no change** | patches on saved widgets already flow here from `AI_SOURCE_ID` |
| 10 | `WidgetRenderer.tsx:891, 2360` `widgetId: widget.id` into drill props / `buildExportRequest` | widget id sent to server for export | **LATER (136/137)** | export of a temp (negative id) widget cannot be served (D-04 exports use SAVED widget). Hide export entry for `widget.id < 0`; note in 136. |
| 11 | `hooks/useCombinationOrchestrator.ts:115-179, 277, 346` | widgets + layers + dvs params | **NOW (widgets, layers) / LATER (dvs)** | feed effective widgets/layers so AI widgets get filtered combination views; do NOT feed session dvs until 139 (dv path calls `materializeFilter` with the dv id) |
| 12 | `hooks/useDynamicViewMaterializeChain.ts:66,141-190` | own dv list | **do not touch** | merge session dvs after the hook |
| 13 | `DashboardContext.tsx:~100-135` (`widgets`, `dynamicViews`) | provider value | **NOW** | pass effective lists |
| 14 | `useLayerVisibilityToggle.ts:36-58` | `getState().layers.find` then `updateLayer` + **`apiUpdateLayer`** | **NOW (crash guard)** | for `layerId < 0`: skip store/`apiUpdateLayer`; hold visibility in a session-live bucket outside turns (like geometry) - or no-op in 134 and wire in 136. Saved layers: existing behaviour (Open Question 4). |
| 15 | `lib/resolveLayerViewName.ts:72`, `lib/wmsUrlBuilder.ts:201` | dv store | LATER (139) | |
| 16 | Dashboard export/import (list page) | server data | N/A | not in `DashboardOpen` |
| 17 | Filter bar (`DashboardsPage.tsx:1463-1600`) `views`, `associatedTables` | saved | N/A | filters are 138 |
| 18 | `useViewKeepAlive(dashboard.id)` `:644` | dv/filter-view stores | N/A | reads materialized views only |

## Edit-Lock Entry Points (Q4)

All in `packages/web/src/components/DashboardsPage.tsx` unless stated. **Gate = `editLocked` folded into the `can*` consts (`:591-594`) + handler guard.**

| Entry point | file:line | Gate today | New gate | Spec proves it |
|---|---|---|---|---|
| Toolbar "Tables" | `:1337` | `canEdit` | `canEdit` (locked) -> disabled | RTL: seed session, button `toBeDisabled()` |
| Toolbar "Dynamic Views" | `:1342` | `canDynamicViews` | same | same |
| Toolbar "Map Layers" | `:1347` | `canLayers` | same | same |
| Toolbar "Visualizations" (add widget) | `:1352`, `handleAddVisualization :1072` | `canEdit` | + handler guard | disabled + `createWidget` not called |
| Toolbar "Settings" (dashboard settings) | `:1357`, `handleChangeDisplayMode :613` | `canEdit` | + handler guard | `updateDashboard` not called |
| Widget gear (configure) | `WidgetCard.tsx:~160`, `handleConfigureWidget :1153`, `handleSaveConfig :1120` | `canConfigure` prop | prop is effective; handler guard | gear absent; `updateWidget` not called |
| Widget duplicate | `WidgetCard.tsx:~168`, `handleDuplicateWidget :1098` | `canEdit` prop | same | absent; `createWidget` not called |
| Widget delete | `WidgetCard.tsx:~176`, `handleRemoveWidget :1144` | `canEdit` prop | same | absent; `deleteWidget` not called |
| Legend "Reconfigure" CTA | `LegendRenderer.tsx:134-138` via `WidgetCard.tsx:185` | `canConfigure ?` | effective prop -> `undefined` | CTA absent when locked |
| Drag / resize saved widgets | `:1414-1415` `dragConfig/resizeConfig {enabled: canEdit}`; `handleLayoutChange :1155` | `canEdit` | `enabled: canEdit \|\| hasSessionWidgets` (AI items must stay draggable, D-12) + saved items `static: true` + handler guard (Q5) | mocked-RGL spec |
| Tables add/remove | `handleAddTable :1045`, `handleRemoveTable :1063` | modal only reachable via toolbar | handler guard | not called |
| LayersModal handlers | `handleLayerCreate :1206`, `Patch :1195`, `Delete :1253`, `Duplicate :1264`, `Reorder :1277`, auto-create effect `:1301` | modal only via toolbar | handler guard (the `:1301` effect auto-creates a layer when the modal opens with 0 layers - guard it) | not called |
| DynamicViewsModal create/update/delete | `components/DynamicViewsModal.tsx:526, 564, 254` | modal only via toolbar | closed by lock effect | modal absent |
| Legend / in-map layer eye toggle (persists) | `hooks/useLayerVisibilityToggle.ts:48-62` | none | see Open Question 4 | `layerId<0` never reaches `apiUpdateLayer` |
| Dashboard Edit screen (name/description) | `:484` `DashboardEdit` | separate screen reached from list/detail | unreachable while on `open` screen; leave-guard covers navigation | covered by Q6 |
| Column format / custom metrics | `DatasetsPage.tsx:336-342` | different page | unreachable (leave-guard) | - |
| Import dashboard / Access modal | list page (`:135`, `:134`) | list page | unreachable | - |

Allowed (D-08): filters, drill, map pan/zoom/draw, info popups, radio controls (`applyAction`), exports, AI widget. Spec: assert a radio dispatch and a filter add still work while locked (negative controls).

**Spec design:** one `DashboardsPage.aiLock.spec.tsx` (copy the ResizeObserver/OL/`api/client` mock preamble from `DashboardsPage.panel.spec.tsx:1-110`; `seedDesignerStore()` from `test/seedAuthStore.ts`). Each blocked entry point gets a PAIRED test: unlocked -> control present/enabled and handler fires the API mock; locked -> disabled/absent and API mock `not.toHaveBeenCalled()`. The paired positive control is what makes each assertion discriminating (it fails if the harness cannot reach the control).

## Layout (Q5, D-12/D-13, spike S5)

**Today:** `layouts = widgets.map(getWidgetLayout)` (`:1331`, `getWidgetLayout :568` reads `widget.config.layout`, falls back to index-based x/y); grid `layouts={{lg: layouts}}` (`:1412`); `onLayoutChange={(layout)=>handleLayoutChange(layout)}` (`:1413`). `handleLayoutChange` (`:1155-1172`) writes `updateWidget(widget.id, {config:{...layout}})` for every saved widget whose rect changed, and `setWidgets` for all. RGL fires `onLayoutChange` on mount/compaction/width-change too (see the Phase 107 comment `:1389-1404`: a fallback layout once got PERSISTED and corrupted stored coords).

**Insertion of AI items:** AI items appended below content do not move saved items under vertical compaction. The risks are (a) the user dragging/resizing an AI item onto saved items (collision displaces saved items -> `onLayoutChange` reports moved saved rects -> persisted), and (b) a gap-fill placement (D-14, 136) pulling items.

**Recommendation (both, defence in depth):**
1. **Structural:** while `editLocked`, `layouts` marks every SAVED item `static: true`. RGL doc: static items cannot be dragged/resized "and other items will move around it" (`dist/types-BiXsdXr7.d.ts:36-40`) - saved widgets can never be displaced (D-08, D-14). AI items are non-static, `minW/minH` as today. `dragConfig.enabled`/`resizeConfig.enabled` = `canEdit || hasSessionWidgets`.
2. **Behavioural:** `handleLayoutChange` splits items by `id < 0`: AI items -> `aiSessionStore.setGeometry(tempId, rect)` (session-only, lives OUTSIDE the turns so revert/forward keeps the user's drag; pruned when the entity leaves the log or on reset); saved items -> **return without `updateWidget` and without `setWidgets` while `editLocked`**. Not gating the whole callback (just the saved half) keeps D-12 geometry capture working. Note the existing handler already ignores unknown ids (`widgets.find(...) ; if (!widget) return`) - AI items are non-persisting by accident today; make it explicit and test it.
3. **Separate layout layer vs gating:** keeping AI items in a second grid would split drag-over-saved behaviour and double the scroll container; rejected. Single grid + static saved + guarded callback is the safer option.

**Minimal non-overlap default for 134** (136 replaces with D-14): AI widget without `config.layout`/`geometry` gets `y = max(bottom of saved + earlier AI items)`, `x = 0`. Reuse the `nextY` expression from `:1076-1081`. Without it `getWidgetLayout`'s index fallback (`(index%2)*18, floor(index/2)*24`) can overlap saved items.

**Test (red-before-green):** `vi.mock("react-grid-layout", ...)` with a stub `ResponsiveGridLayout` that stores its props in a module variable (keep `useContainerWidth`/types from the real module via `importOriginal`). (a) POSITIVE CONTROL, no session: call captured `onLayoutChange` with a moved saved item -> `updateWidget` called once. (b) Seed session with one AI widget: same call plus an AI item -> `updateWidget` NOT called, `useAiSessionStore.getState().geometry[-1]` equals the AI rect, `layouts.lg` saved items all `static: true`, AI item not static. (c) after `reset()`: saved items not static again, geometry empty. Human-verify: drag an AI widget over saved ones in a real browser; saved widgets do not move; reload shows original layout (RGL behaviour with `static`, MEDIUM confidence until seen).

## Leave Warning (Q6, D-15)

**Navigation reality:** no router. Two state machines: `App.tsx` `page` (`:121`) via `Sidebar onSelect` (`:618-630`), and `DashboardsPage` `view` (`:113`). Paths that leave an open dashboard:

| Path | Site | Guardable? |
|---|---|---|
| In-dashboard "Back" button | `DashboardsPage.tsx:1362` -> `onBack` `:185` (`leaveDashboardUrl(); setView(list)`) | yes: wrap `onBack` |
| Sidebar navigation | `App.tsx:618-630` (already has the `brandPageGuard` + `window.confirm` precedent) | yes |
| Topbar profile link / onboarding banner link | `App.tsx:634`, `:638` | yes (`requestLeave`) |
| "See all exports" event | `App.tsx:415-421` (`NAVIGATE_EXPORTS_EVENT`) | yes (`requestLeave`) |
| Browser Back/Forward (popstate) | `DashboardsPage.tsx:161-172` `onPopState` sets list view | **not vetoable**; recommended: when dirty, re-push the dashboard entry (`openDashboardUrl(id, mode)` from `lib/dashboardUrl.ts:103`), show the dialog, on confirm run the normal leave. MEDIUM confidence - test in the `urlsync` spec style; fallback: show the dialog without restoring the URL |
| Logout / 401 | `App.tsx:~255-285` unconditional reset chain | not promptable; reset unconditionally |
| Reload / tab close / paste-URL | n/a | `beforeunload` |
| Dashboard A -> B | only possible via list (covered by Back/popstate) | covered |

**Existing confirm pattern:** there is NO shared confirm component. Existing "confirm" is `window.confirm` (App.tsx:624, DatasetsPage.tsx:144, CustomMetricsEditorModal.tsx:126, DashboardsPage.tsx:175) and the portalled `.modal-overlay` shell (`ExportDialog.tsx:276-296`). D-15 says portalled modal, so build `AiLeaveDialog` on the modal shell classes: header `modal-title`, body text, footer `<div className="ds-actions"><button className="btn-primary btn-sm">Discard and leave</button><button className="ghost-sm">Stay</button></div>` (CLAUDE.md canonical pair; ensure the destructive action is the primary only if the operator agrees - alternative `ghost-sm ghost-danger` for "Discard and leave" + `btn-primary btn-sm` "Stay"; planner picks, default: Stay = `btn-primary btn-sm`, Discard = `ghost-sm ghost-danger`). `role="dialog" aria-modal="true" aria-labelledby`, Escape = Stay, restore focus on close (copy the `returnTo` ref idiom from `ExportDialog.tsx:~66`). No hex; no new CSS needed.

**Design:** `lib/aiLeaveGuard.ts`: `requestLeave(proceed: () => void): void` - if `!hasUnsavedAiChanges()` -> `proceed()`, else `useAiSessionStore.setState({ pendingLeave: { proceed } })`. `AiLeaveDialog` is mounted inside `DashboardOpen` (still mounted while the prompt is open) and reads `pendingLeave`; "Discard and leave" -> `const p = pendingLeave.proceed; clear; p()`; the subsequent unmount runs the cleanup chain's `reset()`. "Stay" -> clear `pendingLeave`. Store a function in zustand state is fine; do not include it in `derived`/serialisable parts.

**beforeunload:** a `useEffect` in `DashboardOpen` keyed on the `hasUnsavedAiChanges` boolean registers a handler that re-reads `getState()` at event time, `e.preventDefault(); e.returnValue = ""`; cleanup removes it. **StrictMode** (`main.tsx:14` wraps the app): mount -> cleanup -> mount; symmetrical add/remove makes this safe, but (a) never put `reset()` in a mount effect, (b) the existing unmount cleanup chain effect (`:701-766`, deps `[dashboard.id]`) runs spuriously once in dev and calls `reset()` on an empty store - harmless, but any future "fire on cleanup" side effect (139 temp-dv DROP) must read the snapshot from the store, not from closures, and be idempotent. Same hazard class as the `clearUrlTimer` comment `:768-780`. Spec: render under `<React.StrictMode>`, assert exactly one live `beforeunload` listener (spy `addEventListener`/`removeEventListener` counts) and that `dispatchEvent(new Event("beforeunload", {cancelable:true}))` is `defaultPrevented` only while dirty.

## Common Pitfalls

### Pitfall 1: "Insertion order" is not insertion order
**What goes wrong:** radio vs AI precedence is decided by numeric key order, not recency.
**Why:** integer-like keys iterate ascending (node: `{5,-1,0,2}` -> `0,2,5,-1`).
**Avoid:** sequence-number ordering in `deriveOverlays` (Pattern 2).
**Warning signs:** a test where the AI turn happens AFTER the radio selection yet the radio value shows.

### Pitfall 2: The plural dispatcher overwrites per target
**What goes wrong:** rebuilding via `applyWidgetActions(allLogPatches, ...)` loses turn 1's fields when turn 2 patches the same target (`combined.widget[target.id] = configPatch`, `applyWidgetAction.ts:~365`), and toasts on rejects.
**Avoid:** merge per target inside the fold, then `setControlContribution` once.

### Pitfall 3: Mutating saved state via the shared handlers
`handleLayoutChange`, `useLayerVisibilityToggle`, the auto-create effect at `:1301` all persist. Any negative id reaching them hits the server. Guard each.

### Pitfall 4: Dropping the oldest turn from a fold log
Later turns depend on earlier ops. Squash into `baseOps` instead (Pattern 1).

### Pitfall 5: Lock released at `cursor = -1`
User reverts to the start, edits manually, jumps forward -> ops hit changed targets. Keep the lock while any applied turn exists.

### Pitfall 6: Unstable effective-list identity
Returning fresh arrays every render re-renders every `WidgetCard` (it is `React.memo`, `WidgetCard.tsx:~231`) and re-fires `useCombinationOrchestrator`/`useReverseFilterMap` memos. Helpers must return the saved array when nothing changed; `useMemo` on `[saved, derived]`.

### Pitfall 7: Orchestrator/dv chain given temp dvs
See anti-patterns (#12, #11).

### Pitfall 8: Two-store write seen half-applied
A subscriber between `aiSessionStore.set` and `setControlContribution` sees a new `derived` with old overlays. React 18 batches the commit; verify with a probe, and write `derived` first, overlay second in one synchronous function.

### Pitfall 9: Discriminating-test trap (CLAUDE.md)
Turn-2-keeps-turn-1 "fails before rebuild exists" is trivially true if the module does not exist. Add the hazard test that PASSES today and documents the engine semantic: two consecutive `setControlContribution(0, ...)` calls -> turn-1 field is gone. Then the real-flow test (two `applyTurn`s -> both fields present) is red against a naive per-turn write and green against the fold.

## Code Examples

### Fold skeleton (new; no external source)
```ts
// lib/aiSession/foldSession.ts - pure
export function foldSession(
  baseline: SessionBaseline,            // { widgets, layers, dynamicViewIds } at call time
  ops: Iterable<{ op: AiOp; result: OpResult }>,
): SessionDerived {
  const added = new Map<number, WidgetDto>(); const removed = new Set<number>();
  const widgetPatch: Record<number, Record<string, unknown>> = {};
  for (const { op, result } of ops) {
    if (result.status !== "applied") continue;
    switch (op.op) {
      case "add_widget": added.set(op.tempId, makeSessionWidget(op)); break;
      case "remove_widget":
        if (op.id < 0) added.delete(op.id); else { removed.add(op.id); delete widgetPatch[op.id]; }
        break;
      case "patch": {
        const { target, configPatch } = op.action;
        if (target.kind === "widget" && target.id < 0) {
          const w = added.get(target.id); if (w) added.set(target.id, { ...w, config: { ...w.config, ...configPatch } });
        } else if (target.kind === "widget") {
          widgetPatch[target.id] = { ...widgetPatch[target.id], ...configPatch };   // per-target MERGE
        } /* layer: splitLayerSnapshot + deep-merge; dynamicView: shallow */
        break;
      }
      /* add_layer / remove_layer / add_dynamic_view / remove_dynamic_view analogous; apply_filter / clear_filter never reach here (skipped at apply time) */
    }
  }
  /* return { addedWidgets: [...added.values()], removedWidgetIds: removed, ..., contribution: {widget: widgetPatch, layer, dynamicView} } */
}
```

### Rebuild write (store action tail)
```ts
// inside applyTurn / setCursor, after computing `derived`
set({ turns, cursor, derived });
useWidgetActionStore.getState().setControlContribution(AI_SOURCE_ID, derived.contribution);
```

### widgetActionStore ordering fix (shape)
```ts
// state: order: Record<number, number>; module-level `let seq = 0`
// setControlContribution: order = { ...state.order, [controlId]: ++seq }
const ids = Object.keys(contributions).sort(
  (a, b) => (order[+a] ?? +a) - (order[+b] ?? +b),
);
```

### Mocked RGL for the layout spec (shape)
```ts
let gridProps: any;
vi.mock("react-grid-layout", async (orig) => {
  const actual = await orig<typeof import("react-grid-layout")>();
  return { ...actual, ResponsiveGridLayout: (p: any) => { gridProps = p; return <div data-testid="grid">{p.children}</div>; } };
});
```

## State of the Art

| Old Approach | Current Approach | Impact |
|---|---|---|
| Undo = pop last answer (Grafana Assistant; Phase 134 original wording) | Revert to ANY answer + jump forward; lock manual edits instead of blocking after them (CONTEXT specifics, changed 2026-10-12) | cursor model, not stack pop |
| Radio-only overlays patch existing ids | Structural add/remove merged at read sites | new effective-list layer |

**Deprecated/outdated:** PITFALLS C7 "inverse operations" prescription - superseded by pure-fold design here (record this deviation in the plan so a reviewer does not "fix" it).

## Open Questions

1. **`hasUnsavedAiChanges` definition**
   - Known: D-07/D-09 say "unsaved AI changes".
   - Unclear: should a chat with no applied ops lock editing / warn on leave?
   - Recommendation: no - `turns.some(t => t.results.some(r => r.status === "applied"))`; stays true at `cursor = -1`.
2. **Does revert/forward bump the AI source to "most recent" vs a radio set after the AI turn?**
   - Recommendation: yes (explicit user action wins). Document in spec as an intentional rule.
3. **`add_layer` payload is `{tempId, widgetId}` only (136 extends)**
   - Unclear: a full `DashboardLayerDto` needs `table_id`, `config`, etc.
   - Recommendation: 134 materialises a default-filled session layer (placeholder `table_id: 0`, `config: {}`, `layer_type`/`position` defaulted) behind ONE builder function `makeSessionLayer(op)` that 136 replaces; harness asserts structure only. If the target map widget has explicit `includedLayerIds`, the fold appends the temp id (needs baseline). Mark as 136's responsibility to complete; 134 tests the saved-map-without-includedLayerIds path.
4. **Legend/in-map eye toggle while locked (D-08 silent)**
   - Existing behaviour persists via `apiUpdateLayer` for saved layers. Recommendation: leave saved-layer behaviour unchanged (orthogonal, orphans nothing); for `layerId < 0` skip the API and no-op (or session-live bucket) so it cannot 404. Ask operator only if they consider the toggle "editing".
5. **Browser Back re-push (Q6)** - MEDIUM; needs a spec; fallback documented.
6. **Baseline supply:** `applyTurn(input, baseline)` takes baseline as an argument (pure, harness-friendly); a `useSessionActions()` hook binding `DashboardOpen` state is a 137 concern but should be sketched in 134 so the harness and the future widget share the entry point.

## Validation Architecture

> `workflow.nyquist_validation` is `false` in `.planning/config.json`, so this section is not required; included because the phase request asked for it.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.1.5 + RTL 16 (jsdom), `packages/web/vitest.config.ts`, setup `src/test/setup.ts`, zustand auto-reset mock |
| Quick run | `cd packages/web && npx vitest run src/store/aiSessionStore.spec.ts src/store/widgetActionStore.spec.ts` |
| Full suite | `cd packages/web && npx tsc --noEmit && npx vitest run && npx vitest run src/styles/theme-guard.spec.ts` (CLAUDE.md gates) |

### Phase Requirements -> Test Map (each must be RED before its work)
| Req | Behavior | Type | Command / file | Red-before anchor |
|---|---|---|---|---|
| AISES-V20-01 | scripted ops apply as one unit, no network | unit | `aiSessionStore.spec.ts`: `vi.mock("../api/client")` spy; assert 0 calls after `applyTurn`; probe component sees (derived, overlay) pair consistent on every commit | symbol `applyTurn` / `foldSession` do not exist (grep new names: `grep -c "applyTurn" src/store` = 0 now) |
| AISES-V20-01 | only asking user sees it | unit | derived lives only in client memory: assert `JSON.stringify` of nothing written to `localStorage`/`sessionStorage` after turns | new |
| AISES-V20-02 | turn 2 keeps turn 1 | unit | `aiSessionStore.spec.ts` "T2-KEEPS-T1": two turns patch different fields of widget 42, same field-set of layer 7 -> both present in `widgetOverrides[42]` and `layerOverrides[7]`; PLUS "HAZARD-DOC": two raw `setControlContribution(0,…)` -> first field gone (passes today) | `AI_SOURCE_ID` / `useAiSessionStore` absent |
| AISES-V20-02 / D-11 | radio vs AI recency | unit | `widgetActionStore.spec.ts` NEW tests: (a) radio(id 7) writes f=b, then `setControlContribution(0, f=a)` -> `a` (FAILS today: key `0` iterates first); (b) AI first then radio re-select -> radio value; (c) revert AI turn -> radio's value remains | (a) fails on current `deriveOverlays` |
| AISES-V20-03 | revert to any turn / forward / replace | unit | cursor tests: apply T1,T2,T3; `setCursor(0)` -> exactly T1 state (added widgets, removed ids, overlays); `setCursor(2)` -> T3; `setCursor(0)` then `applyTurn(T4)` -> turns = [T1,T4], T2/T3 gone, geometry of their tempIds pruned; revert is a single `derived` identity change (subscriber call count) | new |
| AISES-V20-03 | cap squash | unit | 51 turns -> `droppedCount===1`, `setCursor(-1)` state equals squashed base, later turns still correct | new |
| AISES-V20-07 | Discard / cleanup chain restores saved exactly | integration | `DashboardsPage.aiLock.spec.tsx`: render, seed session (added widget, removed saved widget, overlay), assert effective differs; unmount (dashboard switch) -> `aiSessionStore` empty AND `widgetOverrides` empty; saved `widgets` / layers store deep-equal to pre-session snapshot | new |
| AISES-V20-07 | reload clears | unit | store is not persisted: assert no `persist` middleware / no storage writes (static grep for `persist(`, `localStorage` in `aiSessionStore.ts` returns 0 AND runtime storage spy) | new |
| D-07/D-08 | lock gates each entry point | integration | paired tests per table row in Q4 (unlocked control works, locked blocked) + negative controls: radio dispatch, filter add still work | new |
| D-13 | `onLayoutChange` never persists | integration | mocked-RGL spec in Layout section | new (paired positive control) |
| D-15 | leave warning | integration | Back button / sidebar `onSelect` with dirty session -> dialog (`role="dialog"`), "Stay" keeps dashboard, "Discard and leave" navigates and resets; clean session -> no dialog; `beforeunload` `defaultPrevented` only when dirty; StrictMode single-listener | new |
| decoupling | no filter symbols | static | add `aiSessionStore.ts` + `foldSession.ts` to `lib/actionEngineDecoupling.spec.ts` `ENGINE_MODULES` | currently absent (`grep -c aiSession` there = 0) |

Grep-criterion rule (CLAUDE.md): every grep above must be run to confirm it reads 0/fails BEFORE the work; anchor on NEW symbols (`applyTurn`, `foldSession`, `AI_SOURCE_ID`, `useAiEditLock`, `requestLeave`, `aiLeaveGuard`), never on incidental strings.

### Sampling Rate
- Per task commit: the quick command for the touched store/spec.
- Per wave merge: full web suite + tsc + theme-guard.
- Phase gate: full suite green; server untouched (no server change this phase) - still run `cd packages/server && npx tsc --noEmit` as a no-regression check; server vitest is set-based (TD-V16-TEST-ISOLATION).

### Wave 0 Gaps
- [ ] `src/test/aiSessionHarness.ts` - scripted-op driver (builds `AiOp` lists, baseline fixture, calls store actions)
- [ ] `src/store/aiSessionStore.spec.ts`
- [ ] `src/lib/aiSession/foldSession.spec.ts`
- [ ] `src/components/DashboardsPage.aiLock.spec.tsx` (preamble copied from `DashboardsPage.panel.spec.tsx`; mocked RGL)
- [ ] `src/components/AiLeaveDialog.spec.tsx`
- [ ] extend `src/store/widgetActionStore.spec.ts`, `src/lib/actionEngineDecoupling.spec.ts`
- No framework install needed.

### Human-verify (not automatable - do NOT dress in grep)
1. Dragging an AI widget over saved widgets in a real browser: saved widgets do not move; reload shows the original layout (RGL `static` behaviour, MEDIUM confidence).
2. No visible flash/pop between the cursor move and overlay application (two-store batching) when reverting.
3. Leave dialog legibility in light and dark themes (token classes; theme-guard cannot catch rgba/wrong token, per memory).
4. Browser Back with a dirty session behaves sensibly (URL restored, dialog shown).
5. The notice wording (D-09) is acceptable; final UX is 137.

## Sources

### Primary (HIGH confidence - read in repo)
- `packages/web/src/store/widgetActionStore.ts` (full), `store/widgetActionStore.spec.ts:68-84`
- `packages/web/src/lib/applyWidgetAction.ts:64-120, 200-400`
- `packages/web/src/components/DashboardsPage.tsx:92-240, 560-1500, 1600-1730`
- `packages/web/src/components/WidgetCard.tsx:1-190`
- `packages/web/src/components/charts/MapChartRenderer.tsx:505-560, 575-650, 710-725`; `LegendRenderer.tsx:36-80`; `InfoCardRenderer.tsx:30-60`; `WidgetRenderer.tsx:340-360, 884-894, 2236-2246, 2355-2363`
- `packages/web/src/hooks/useDynamicViewMaterializeChain.ts:50-190`, `useCombinationOrchestrator.ts`, `useLayerVisibilityToggle.ts`
- `packages/web/src/lib/dashboardUrl.ts:100-180`, `App.tsx:240-285, 410-425, 596-642`, `main.tsx:14`
- `packages/web/src/components/ExportDialog.tsx:270-300`; `styles/global.css:825-866`
- `packages/shared/src/aiOp.ts`, `widgetAction.ts`, `index.ts`; `packages/web/src/lib/actionEngineDecoupling.spec.ts`
- `node_modules/react-grid-layout/dist/types-BiXsdXr7.d.ts:25-75` (v2.2.2 `LayoutItem.static/isDraggable/isResizable`)
- node execution confirming integer-key iteration order
- `.planning/research/{SUMMARY,ARCHITECTURE,PITFALLS}.md` (§2, Q3, C7, S5)

### Secondary (MEDIUM)
- RGL runtime behaviour of `static` items under drag collision: inferred from the d.ts doc comment, not exercised.

### Tertiary (LOW)
- none.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - no new libs; versions read from package.json/node_modules.
- Architecture (fold, ordering fix, merge sites, lock): HIGH - derived from direct code reading.
- Layout `static` behaviour and popstate re-push: MEDIUM - needs the specs/human check above.
- Pitfalls: HIGH for 1-6 (code-evidenced); 8 MEDIUM (React batching reasoning, to be probe-tested).

**Research date:** 2026-10-12
**Valid until:** 2026-11-11 (stable internal code; re-check line numbers if `DashboardsPage.tsx` changes before planning executes)
