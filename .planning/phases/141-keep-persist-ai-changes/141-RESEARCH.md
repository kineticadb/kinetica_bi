# Phase 141: Keep (Persist AI Changes) - Research

**Researched:** 2026-10-21
**Domain:** all-or-nothing persistence of a client-side AI session layer (SQLite transaction, temp-id remap, optimistic concurrency, RBAC, post-Keep client state swap)
**Confidence:** HIGH on code facts (every claim below was read in the repo; two SQLite behaviours were verified empirically), MEDIUM on the recommended own-write attribution scheme (design, not yet built), LOW on nothing material.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Rights & partial rights
- **D-01 Rights the changes actually need**, checked server-side on the real change set: always `dashboards:edit`; plus `widgets:configure` if any widget is added, edited, rebound or removed; `layers:manage` if any layer changes; `dynamic_views:manage` if any dynamic view is added or removed. (135 D-16: edit rights are enforced at Keep, not at session apply.)
- **D-02 Missing a needed right refuses the whole Keep** and names the right, e.g. "You can't save these changes: saving dynamic views needs the Manage dynamic views permission." Nothing is saved. The session stays intact, so the user can revert that part or ask an editor.
- **D-03 Without `dashboards:edit`, Keep is hidden.** The bar shows only Discard, plus a short note "Only editors can save AI changes".
- **D-04 Partial rights:** if the user has `dashboards:edit` but lacks a specific right, Keep is shown. The server refuses on click with the named reason (D-02). The server is the authority; the client does not try to predict it.

#### What counts as "changed" (409)
- **D-05 Any saved change to the dashboard** after the baseline counts as a conflict: any widget, layer, dynamic view or dashboard-settings change. There is no merging.
- **D-06 The user's own layer visibility (eye) toggles during the session don't count** (134 D-16 lets them save while AI changes are pending). The same kind of change by another user does count.
- **D-07 Baseline = when the dashboard was loaded** in this tab, not the first AI answer.
- **D-08 After a 409:** "Someone else changed this dashboard since you started. Your AI changes weren't saved." Options: **Discard and reload the latest** (AI changes lost) or **Stay** (keep exploring; Keep keeps refusing until they discard). No merge or replay.
- **Research flag:** `dashboards.updated_at` is only bumped by dashboard-settings updates today (db.ts ~L638). Widget, layer and dynamic-view writes may not touch it. Planning needs a reliable dashboard-wide change signal, such as a version counter or max(updated_at) across the dashboard's rows, that also lets D-06 exclude the user's own visibility toggles.

#### Keep flow & confirmation
- **D-09 One confirm dialog** (portalled, same pattern as Discard: `AiLeaveDialog` / `modal-overlay` / `modal-content`): "Save AI changes? 3 added · 2 edited · 1 removed. Filters are not saved." [Save] [Cancel]. This is the "UI says filters are not saved" requirement.
- **D-10 While saving:** Keep shows "Saving…", and Keep and Discard are disabled until the response.
- **D-11 After success:** the conversation stays readable, every "Revert dashboard to this state" button is removed (history cleared, AISES-V20-03), and a muted chat note "Changes saved." is added. The bar disappears because there are no unsaved changes. Call the store `reset()` so the 136 removal approval clears (137 D-16).
- **D-12 On other failures** (server or DB error): "Couldn't save the AI changes. Nothing was saved; try again." The session stays intact and Keep can be retried.

#### What survives Keep
- **D-13 Filters stay applied, not saved.** Table filters remain as they are. Filters on an AI view (`dvFilters[-N]`) are re-keyed to its new saved view id so the view stays filtered. Reload clears filters as today.
- **D-14 AI-added widget geometry is saved exactly as shown** (134 D-12).
- **D-15 Temporary Kinetica views:** Keep creates the saved `dashboard_dynamic_views` row from the AI view's compiled template (139: a valid saved-dv template; joined tables are read raw after Keep, D-21 accepted). The temp `_kbi_ai_*` view is dropped and its registry row removed. Widgets and layers now read the saved view through the normal path (a brief re-materialize).
- **D-16 Everything else is saved:** widgets, layers (including AI-set visibility and style), dynamic views, rebinds, removals and geometry. Only filters and the chat are not saved.

### Claude's Discretion
- The route shape (e.g. `POST /api/dashboards/:id/ai-keep`) and the payload: the client's folded change set versus the op log replayed through the gateway. The server must re-validate everything (shape, allow-list, rights, references, live schema) and never trust client-supplied SQL or names.
- Reuse of the `dashboardImport` transaction and temp-id remap (`createWidget` / `createDashboardLayer` / `createDashboardDynamicView`, in dependency order dv → layer → widget), and the client id swap / refetch after Keep.
- The injected mid-transaction failure test (SC1) and the forged-Keep rejection test (SC2).
- The audit of a Keep (whether `ai_audit` or a separate record notes it).

### Deferred Ideas (OUT OF SCOPE)
- "Reapply my AI changes on the latest dashboard" after a 409 (replay ops on top of the newer version). This is a new capability and not in this milestone.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| AISES-V20-05 | Keep saves the added, changed and removed widgets, layers and dynamic views into the dashboard in one all-or-nothing step, only for a user with edit rights (otherwise Keep is not offered). Filters are not saved, and the user is told so. | Q2 (folded payload), Q3 (single sync `db.transaction`, dv → layer → widget, remap incl. negative ids, RAISE-trigger injection test), Q4 (rights from the change set, route gate + in-handler check, forged request 403), Q5/Q6 (client swap, confirm dialog text, Keep hidden without `dashboards:edit`) |
| AISES-V20-06 | If someone else changed the dashboard since the AI session began, Keep refuses with a clear message rather than overwriting. | Q1 (`dashboards.version` + triggers, version compare INSIDE the transaction, own-write rebase, load baseline), 409 body/wording, 409 dialog (Q6) |
</phase_requirements>

## Summary

Keep is feasible with no new libraries. Everything needed exists: `db.transaction` (better-sqlite3 12.x), the ref-visit traversal in `lib/dashboardExportRefs.ts`, `createWidget`/`createDashboardLayer`/`updateDashboardLayer`/`createDashboardDynamicView` in `db.ts`, `validateAiDvSpec`/`compileAiDvSpec` + `createLiveSchema` for views, `getEffectivePermissions` for rights, and the web `foldSession` output (`SessionDerived`) as the source of the change set. The hard parts are not the transaction itself; they are (1) a trustworthy dashboard-wide change signal that a client's *own* writes do not trip, (2) negative temp ids that the existing remap code silently does not see, (3) turning the fold's *overlay* output (renderer-key patches, `undefined` unbinds) into concrete persisted rows, and (4) the client state swap after commit without flashes, double-apply or lost conversation.

Five findings change the plan and need explicit tasks:
1. **`asId` ignores negative ids.** `visitWidgetConfigRefs` only visits ids `> 0` (`asId` in `dashboardExportRefs.ts`), so `remapWidgetConfigRefs` would leave `config.dynamicViewId = -3`, `includedLayerIds: [-2]`, `sourceMapWidgetId: -1` untouched and Keep would write negative ids into the database. Keep needs its own visitor (or an `allowNegative` option on the shared traversal) that maps negatives and FAILS on an unmapped negative.
2. **`reset()` wipes the conversation** (`turns: []`), but D-11 wants it readable. Keep needs a new store action (call it `completeKeep()`), not a bare `reset()`; and saved turns must be excluded from `selectHasUnsavedAiChanges` or the bar never disappears.
3. **There is no dashboard version today, and the eye toggle is a dashboard-level write.** `useLayerVisibilityToggle` calls `PATCH /api/dashboards/:id/layers/:layerId` with the whole layer `config`; it bumps nothing and is shared by all users. D-06 can only be honoured by attributing writes (own vs foreign), which needs a before/after version on write responses. The same mechanism is needed for the user's ordinary pre-session edits (see Open Question 1), because `handleLayoutChange` even auto-saves legacy widgets that lack `config.layout` on load.
4. **The derived chart SQL is web-only** (`deriveChartConfig`, `lib/chartSql.ts`; no server or shared copy). The server cannot replay `add_widget` ops into a renderer-ready config. The payload must be the **folded change set** the client already renders, with dynamic views sent as the structured `AiDvSpec` so the server recompiles them itself.
5. **Own-write and edit-lock traps in the web code:** the bar must gate Keep on the RAW `dashboards:edit` permission (`rawCanEdit`), not `canEdit` (which is AND-ed with `!editLocked` and is therefore false exactly when Keep matters); and `discardAiSession()` must NOT be used for Keep because it undoes filter deltas (D-13 says filters stay).

**Primary recommendation:** Add `dashboards.version` (bumped by SQLite triggers on widgets, layers, dynamic views and dashboard_tables, and in `updateDashboard`), have the four list GETs and every client-used write route stamp version headers, send the client's folded change set to `POST /api/dashboards/:id/ai-keep` (route gate `dashboards:edit`, in-handler named-right check, version compare as the first statement INSIDE one synchronous `db.transaction`), return `{ idMap, version, warnings }`, then on the client refetch widgets/layers/saved views and swap + `completeKeep()` + `rekeyDvFilters` in one React batch.

## Standard Stack

### Core
No new dependencies. All in-repo (versions read from package.json):

| Library / module | Version | Purpose | Why Standard |
|---|---|---|---|
| better-sqlite3 | ^12.8.0 (sqlite 3.53.1 in this checkout) | `db.transaction` all-or-nothing; triggers | Already the only SQLite layer; import and schema-apply use the same transaction style (`lib/dashboardImport.ts`, `lib/schemaApply.ts`) |
| zod | ^3.25.76 (shared) | `AiKeepRequestSchema` `.strict()` in `packages/shared` | Same pattern as `aiOp.ts`, `aiDynamicView.ts`, `aiAsk.ts` |
| `packages/shared` | workspace | Keep request/response types + schema, `AiDvSpecSchema`, `aiWidgetColumnRefs`, `aiLayerColumnRefs`, `AI_BLOCKED_CONFIG_KEYS`, `PERMANENTLY_BLOCKED_KEYS`, `AI_CHART_SWAP_TYPES` | One contract for web and server |
| express | ^4.19.2 | Route; `app._router.stack` is enumerable (for the route-classification spec) | Existing |
| zustand | ^4.5.2 | `dashboardVersionStore`, new `completeKeep` action | Existing store pattern |
| vitest ^4.1.5, supertest ^7.2.2, @testing-library/react ^16 | | Tests | Existing |

### Supporting (existing modules to reuse, not rebuild)
| Module | Reuse for |
|---|---|
| `server/src/lib/dashboardExportRefs.ts` | `RefIdMaps`/`emptyRefIdMaps`, `visitWidgetConfigRefs`, `visitFilterSelectionRefs`, `collectWidgetConfigRefs`, `remapFilterSelection`. Extend for negatives (Pitfall 1); do NOT call `remapWidgetConfigRefs` as is |
| `server/src/lib/aiDvCompile.ts` | `validateAiDvSpec`, `compileAiDvSpec(spec, tables, limits)` with NO `joinRefs` = the persisted, raw-join rendering (D-21) |
| `server/src/lib/ai/liveSchema.ts` | `createLiveSchema({username, principal: () => req}).describe(tableId)` (user-credentialed; failure = `{ok:false}`) |
| `server/src/lib/dynamicViewSql.ts` | `substituteViewToken(template, "_dummy_validation_view_name_")` sanity check before insert (same check the saved create route runs) |
| `server/src/lib/rbacDb.ts` | `getEffectivePermissions(username)` (sync `Set`) |
| `server/src/lib/dashboardAccessDb.ts` | `canViewDashboard(username, id)` (404 non-leak) |
| `server/src/lib/aiConfig.ts` | `getAiConfig()` for `dvMaxRecords`, `dvMaxJoins` |
| `shared` `AiDvSpecSchema`, `checkAiDvSpec` | Spec shape (strict, no SQL field) |
| web `lib/aiSession/foldSession.ts`, `applySession.ts`, `changeCounts.ts` | Source of the change set and counts |
| web `lib/widgetOverlayKeys.ts`, `lib/applyLayerOverrides.ts`, `lib/chartSql.ts` | Overlay translation + SQL derivation (shared with the renderer; see Pitfall 3) |
| web `components/AiDiscardDialog.tsx`, `AiLeaveDialog.tsx` | Portalled confirm pattern |
| web `lib/aiDv/aiDvLifecycle.ts` | Existing temp-view drop on `reset()` (D-15), keepalive DROP, pending-drop map |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|---|---|---|
| Triggers for the version bump (recommended) | JS `bumpVersion()` in each db.ts helper | JS misses FK cascades (verified: deleting a `tables` row cascades to `dashboard_dynamic_views` and `dashboard_tables`; triggers fire on the cascaded rows, JS helpers do not run) and any future raw write. JS gives exactly +1 per logical write, triggers give +N; irrelevant if write responses carry before/after |
| `max(updated_at)` across child rows | | Cannot see deletes (a deleted row leaves nothing to take a max of), 1-second resolution (`datetime('now')`), not bumped by `addDashboardTable`/`removeDashboardTable`, and `dashboard_tables` has no `updated_at`. Rejected |
| Folded change set (recommended) | Op-log replay through `checkAiOp` | Replay needs the web-only SQL derivation and the gateway takes flat tool args, not `AiOp`s (`checkAiOp(deps, tool, argsRaw)`). Rejected (Q2) |
| Return post-commit lists in the Keep response | Client refetches the three lists | Response approach is atomic but duplicates the dv `aggregated` shaping (`isAggregatedTemplate`); refetch reuses the exact GET paths that a reload uses (SC4). Recommend refetch |

**Installation:** none.

**Version verification:** no packages added; versions above read from `packages/server/package.json`, `packages/web/package.json`, `packages/shared/package.json`. SQLite behaviour verified by a scratch script against the repo's better-sqlite3 (FKs ON by default, trigger fires on FK cascade delete, `ADD COLUMN ... NOT NULL DEFAULT 0` pattern is standard).

## Architecture Patterns

### Recommended Structure
```
packages/shared/src/
  aiKeep.ts                      # AiKeepRequestSchema (.strict), AiKeepResponse, KEEP_PERMISSION_LABELS; export from index.ts
packages/server/src/
  db.ts                          # + dashboards.version column (ALTER, PRAGMA-guarded), triggers (post-ALTER block), getDashboardVersion(), updateDashboard bumps
  lib/dashboardVersion.ts        # getDashboardVersion, stampWrite(res, dashboardId, fn), stampRead(res, dashboardId)
  lib/aiKeep.ts                  # requiredRights(change), validateKeepChange (pure+lookups), prepareKeepViews (async, live), applyKeep (SYNC txn)
  aiKeepRoutes.ts                # POST /api/dashboards/:id/ai-keep (registered next to registerAiDvRoutes in index.ts ~L1305)
  lib/aiAudit.ts                 # + recordAiKeep (see Q7)
packages/web/src/
  store/dashboardVersionStore.ts # baseline + edges (Q1)
  api/client.ts                  # apiFetch parses X-Kbi-Dashboard-Version* headers; keepAiChanges()
  lib/aiSession/keepPayload.ts   # PURE buildKeepPayload(derived, baseline, rects, ...) 
  lib/widgetOverlay.ts           # extracted mergeWidgetOverlay (shared by WidgetRenderer and keepPayload)
  store/aiSessionStore.ts        # + completeKeep(), savedTurns, keepConflict
  store/filterStore.ts           # + rekeyDvFilters(map)
  components/AiChangeBar.tsx     # Keep enabled; AiKeepDialog.tsx, AiKeepConflictDialog.tsx (new, portalled)
```

### Pattern 1: Version signal (Q1)
**What:** `dashboards.version INTEGER NOT NULL DEFAULT 0`; AFTER INSERT/UPDATE/DELETE triggers on `widgets`, `dashboard_layers`, `dashboard_dynamic_views` (using `NEW.dashboard_id` / `OLD.dashboard_id`) and `dashboard_tables`; `updateDashboard` adds `version = version + 1` to its existing UPDATE (settings change). Triggers are created in the post-ALTER block of `createDb` (the ALTER block at db.ts ~L500-510 already adds `filter_display_mode` this way), not in `SCHEMA_DDL`, so the column exists first.
**Tables that hold dashboard state** (read from db.ts): `dashboards` (name, description, filter_display_mode), `widgets`, `dashboard_layers`, `dashboard_dynamic_views`, `dashboard_tables`. NOT state: `dashboard_table_views` (legacy view rows; `updateViewStatus`/`updateViewFilter` are materialize bookkeeping), `dashboard_access_grants` (visibility, re-checked live at Keep anyway), `tables`/`column_display_config`/`custom_metrics` (shared across dashboards; see Open Question 3).
**Which write paths bump `updated_at` today:** `updateDashboard` -> `dashboards.updated_at`; `updateWidget` -> `widgets.updated_at`; `updateDashboardLayer`, `reorderDashboardLayers` -> `dashboard_layers.updated_at`; `updateDashboardDynamicView` -> `dashboard_dynamic_views.updated_at`. Creates rely on the DEFAULT. **No delete leaves a trace, `addDashboardTable`/`removeDashboardTable` touch nothing, and no child write touches `dashboards.updated_at`.** That is why `updated_at` cannot be the signal.
**Example:**
```sql
-- Source: verified in scratch (better-sqlite3 12.x / sqlite 3.53.1): triggers fire on FK-cascade deletes too
CREATE TRIGGER IF NOT EXISTS kbi_ver_widgets_i AFTER INSERT ON widgets BEGIN UPDATE dashboards SET version = version + 1 WHERE id = NEW.dashboard_id; END;
CREATE TRIGGER IF NOT EXISTS kbi_ver_widgets_u AFTER UPDATE ON widgets BEGIN UPDATE dashboards SET version = version + 1 WHERE id = NEW.dashboard_id; END;
CREATE TRIGGER IF NOT EXISTS kbi_ver_widgets_d AFTER DELETE ON widgets BEGIN UPDATE dashboards SET version = version + 1 WHERE id = OLD.dashboard_id; END;
-- same three for dashboard_layers, dashboard_dynamic_views, dashboard_tables
```
Keep `version` OUT of `mapDashboard`/`DashboardDto` (adding a field ripples `toEqual` assertions in many route specs); expose it only through headers and the Keep response.

### Pattern 2: Own-write attribution (D-06) (Q1)
**What:** Write routes the web client uses report the dashboard's version before and after the write, atomically, because those handlers are synchronous:
```ts
// lib/dashboardVersion.ts
export function stampWrite<T>(res: Response, dashboardId: number, fn: () => T): T {
  const before = getDashboardVersion(dashboardId);
  const out = fn();                       // the existing db.ts call; sync better-sqlite3, nothing can interleave
  res.setHeader("X-Kbi-Dashboard-Version", `${dashboardId}:${before}:${getDashboardVersion(dashboardId)}`);
  return out;
}
```
The four list GETs (`/api/dashboards/:id/widgets`, `/layers`, `/dynamic-views`, `/tables`) set `X-Kbi-Dashboard-Version-Read: <id>:<list>:<version>` read in the same sync tick as the list.
**Client:** `apiFetch` (api/client.ts L63, already the single choke point and already peeks 401/403) parses both headers into `dashboardVersionStore`:
- `noteRead(id, list, v)`: keeps latest value per list; `baseline(id) = min` over lists seen (strict: a foreign write between two list reads yields a baseline <= every list's state, so Keep over-refuses, never under-refuses). This is D-07 "baseline = when loaded in this tab". Re-reading a list (refetch) raises only that list's entry.
- `noteWrite(id, before, after)`: stores edge `before -> after`; then `while (edges.has(known)) known = edges.get(known)` folds contiguous own writes (handles out-of-order responses, e.g. two quick eye toggles). If `before !== known` (a foreign write landed in between) nothing advances, so the conflict stays.
**Which writes get `stampWrite`** (the "every write route that must bump" list; the bump itself is automatic via triggers, stamping is what keeps own writes from false-409ing): `POST/PATCH/DELETE` widgets (index.ts L1012/L1029/L1037; the PATCH/DELETE resolve the dashboard from the row first), `POST /dashboards/:id/layers`, `PATCH .../layers/reorder`, `PATCH .../layers/:layerId` (**the eye toggle**), `DELETE .../layers/:layerId`, `POST /dashboards/:dashboardId/dynamic-views`, `PUT /dynamic-views/:id`, `DELETE /dynamic-view/:id` (async: stamp only around the final sync `deleteDashboardDynamicView`), `POST/DELETE` dashboard tables, `PATCH /dashboards/:id` (settings), and the Keep route itself. A missed stamp is safe (spurious 409 on own write, never an overwrite).
**Eye toggle answer:** route = `PATCH /api/dashboards/:id/layers/:layerId` with `{config:{...layer.config, visible}}` via `useLayerVisibilityToggle` (hooks/useLayerVisibilityToggle.ts); it is a dashboard-level layer write (shared by all viewers, gated by `layers:manage`), NOT user-scoped. D-06 is satisfied by the edge rebase above: the user's own toggle response carries `(before, after)` with `before === known`, so the baseline advances; another user's toggle bumps the version with no edge in this client, so it counts.

### Pattern 3: Keep transaction (Q3)
**What:** `prepare` (async, may call Kinetica read-only) then `apply` (SYNC `db.transaction`, no `await`, no Kinetica). better-sqlite3 commits when the transaction function returns; an `async` function would commit before its work finishes.
Order inside the transaction (mirrors `applyDashboardImport`'s two-pass shape, `lib/dashboardImport.ts` L535+):
1. Version compare FIRST: `SELECT version FROM dashboards WHERE id = ?`; missing -> 404 sentinel; `!== baselineVersion` -> throw `KeepConflict` (rolls back nothing, writes nothing). This is the only check that is race-free; the early pre-check before the live describes is an optimisation to avoid Kinetica calls, not the guard.
2. Pass 1, dependency order **dv -> layers -> widgets**, placeholders only: `createDashboardDynamicView` (record `maps.dynamicView.set(temp, id)`), `createDashboardLayer` (then `updateDashboardLayer` for `info_enabled` (AI layers use 0; DB default is 1), `dynamic_view_id` (remapped), per import's precedent because create cannot set them), `createWidget` with `config: {}` placeholder (a missed pass-2 rewrite then shows as an empty widget, not a stale negative reference).
3. Pass 2, rewrite: widget configs through the negative-aware visitor, layer `filter_scope`/`dynamic_view_id`, then saved-item edits.
4. Edits to saved items (merge into the CURRENT stored row): widgets `{...stored.config, ...configSet}` minus `configUnset` keys, title/type, `config.layout` rect; layers config merged + TOP-LEVEL fields via `getFieldLocation`/`splitLayerPatch` (memory: `track_config`/`cb_config`/`filter_scope`/`dynamic_view_id`/`table_id`/`info_*` are top-level columns, never inside `config`).
5. Removals last: widgets, layers, saved dvs (each verified to belong to this dashboard).
6. `invariant`: created count equals payload count; any unmapped negative id anywhere throws (rollback).
7. Return `{ idMap, version: getDashboardVersion(id) }`.
**Injected mid-transaction failure (SC1):** copy the existing technique from `tests/lib.dashboardImport.apply.spec.ts` (`withAbortTriggerOn`): `CREATE TRIGGER kbi_test_abort BEFORE <INSERT|UPDATE|DELETE> ON <table> BEGIN SELECT RAISE(ABORT, 'induced'); END`, dropped in `finally`. Run it at (a) the first create, (b) a late step (`BEFORE DELETE ON widgets` for the removal phase, `BEFORE UPDATE ON dashboard_layers` for pass 2), assert a full row-count + content snapshot of `dashboards (incl. version), widgets, dashboard_layers, dashboard_dynamic_views, dashboard_tables` equals the pre-state, and that the Kinetica fetch stub saw ZERO post-commit DROPs.
**Kinetica side effects: after commit only.** The saved-dv removal needs a best-effort `DROP TABLE IF EXISTS <buildDynamicViewName({userId, dashboardId, dynamicViewId})>` for the CALLER's view (same semantics as `DELETE /api/dynamic-view/:id`, index.ts ~L2355; other users' views expire by TTL) and `viewColumnsCache.delete(name)`; run it after the transaction returns, swallow/log errors (the commit already happened), never before. Temp `_kbi_ai_*` views are dropped by the existing client lifecycle (`reset()` -> `aiDvSink.onReset()` -> `dropAiDynamicView`, which also deletes the `ai_session_views` row) and by logout/boot sweeps as backstops.

### Pattern 4: Client swap after Keep (Q5)
Sequence (all awaited before any state change, then ONE synchronous block so React batches it):
1. `200 {idMap, version, warnings}` -> `dashboardVersionStore.rebase(id, version)`.
2. `await Promise.all([listWidgets, listDashboardLayers, reloadSavedDynamicViews])` (add a `reload()` to `useDynamicViewMaterializeChain`'s result; today only `dynamicViewVersion` bumps refetch the list, and `clearView` of a never-materialized temp id does not bump).
3. In one sync block: `setWidgets(w)`, `setLayers(l)`, set saved dvs, `useFilterStore.getState().rekeyDvFilters(idMap.dynamicViews)`, remap/clear `infoSelectionStore` (`activeLayerId`/`activeWidgetId` may hold temp ids), `useAiSessionStore.getState().completeKeep()` (which calls `aiDvSink.onReset()` -> drops temp views AFTER the swap).
Why this order: widgets/layers already point at real ids and the saved dv list already contains the real row when the session overlay disappears, so there is no frame with an orphan binding; the temp view is dropped only after nothing reads it; the saved dv re-materializes through the normal chain (brief pending state, D-15).
**If the refetch fails after a successful commit:** show "Saved, but couldn't refresh the dashboard. Reload the page." and leave the session as is but mark it `keepCommitted` so Keep is disabled and the only action is a reload (do NOT call `completeKeep()` against stale lists). A second Keep from the old baseline would 409 against the user's own commit and never duplicate; Keep is idempotent by the version check.

### Anti-Patterns to Avoid
- **`remapWidgetConfigRefs` as is for temp ids** (Pitfall 1).
- **`await` inside `db.transaction`** / Kinetica calls inside it.
- **Reading `canEdit` (locked) to decide Keep visibility.** Use `hasPermission(PERMISSIONS.DASHBOARDS_EDIT)` (raw).
- **`discardAiSession()` or bare `reset()` for Keep.** `discardAiSession` undoes filter deltas; bare `reset()` drops the transcript.
- **Trusting any client template/columns/`maxRecords` for a dv.** Send and use only `AiDvSpec`.
- **Adding `version` to `DashboardDto`.** Ripples route specs for no benefit.
- **Serializing `undefined`.** The fold encodes "unbind" as `dynamicViewId: undefined`; JSON drops the key. The payload needs an explicit `configUnset: string[]`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---|---|---|---|
| Dashboard-wide change detection | per-route JS bump, `max(updated_at)`, content hash | `dashboards.version` + SQLite triggers | Catches deletes, FK cascades, future routes; verified empirically |
| Id remap traversal | a second enumeration of widget-config ref sites | extend `visitWidgetConfigRefs`/`visitFilterSelectionRefs` (single traversal; REF-1..REF-9) with an `allowNegative` option | The module's whole point is one enumeration; a second list drifts (REF-9 was already missed three times) |
| dv SQL | any client-supplied `template_sql` | `compileAiDvSpec(spec, tables, limits)` without `joinRefs` | Quoted identifiers, live-schema membership, `{view}` token, raw-join Keep rendering |
| Atomicity | manual undo/compensation | one sync `db.transaction` | Failure rolls back every row (proved by `ATOMIC-*` specs in import) |
| Failure injection | monkeypatching db helpers | `RAISE(ABORT)` trigger helper (copy `withAbortTriggerOn`) | Works at the SQL layer for every helper |
| Rights check | ad-hoc role-name checks | `getEffectivePermissions(username)` + `PERMISSIONS.*` | Bootstrap-admin short-circuit and union-of-roles already inside |
| Overlay -> concrete config on the client | a second copy of `translateWidgetOverlay` + SQL derivation | extract the `WidgetRenderer.effectiveWidget` memo (WidgetRenderer.tsx ~L361-380) into `lib/widgetOverlay.ts` and call it from both | Prevents "what Keep saves != what the user saw" drift |
| Temp-view drop | server-side re-implementation | existing `aiDvSink.onReset` -> `dropAiDynamicView` | Already handles pending CREATE races (139 Pitfall 3) and registry cleanup |
| Confirm dialogs | new modal CSS | `modal-overlay`/`modal-content`/`modal-header`/`modal-title`/`modal-body` + `ds-actions` (copy `AiDiscardDialog.tsx`) | Project UI rule; undefined classes pass every gate and render broken |

**Key insight:** the risky code is the *glue* (negative ids, overlay resolution, own-write attribution), not any single primitive. Each has a precedent in the repo; none should be reinvented.

## Answers to the planner's questions

### Q1. Change signal (D-05..D-07)
Covered by Patterns 1 and 2. Additional specifics:
- **List every write path -> bump:** all writes to the five state tables go through `db.ts` helpers (grep of `INSERT INTO|UPDATE|DELETE FROM` on those tables outside db.ts found none; `dashboardImport.ts` uses the helpers). Routes: widgets POST/PATCH/DELETE; layers POST/PATCH(reorder, :layerId)/DELETE; dv POST/PUT/DELETE; dashboard tables POST/DELETE; dashboard PATCH; dashboard import (creates a NEW dashboard, bump irrelevant); dataset delete (`DELETE /api/tables/:id`, FK cascade removes dvs and associations) and schema apply (rewrites registry columns; no widget writes in `schemaApply.ts`).
- **Preventing future routes from forgetting:** the bump needs no per-route code (triggers). For the stamping (own-write) side add a spec that enumerates `app._router.stack` (Express 4), collects every non-GET route, and requires each `METHOD path` to be in a fixture map `{ "PATCH /api/widgets/:id": "stamped", "POST /api/auth/login": "exempt: not dashboard state", ... }`; a new write route fails the spec until classified. Add a behavioural spec that for each state-table helper (create/update/delete x 4 tables, `reorderDashboardLayers`, `addDashboardTable` insert and IGNORE-duplicate, `removeDashboardTable`, `updateDashboard`) asserts the version moved (and that a cascade delete of a `tables` row bumps).
- **DB subtlety:** `INSERT OR IGNORE` of an existing `dashboard_tables` pair inserts nothing, so no bump (correct). `reorderDashboardLayers` updates every row, so it bumps N (so the stamp must report before/after, not assume +1).
- **Dashboard-level GET baseline race:** do NOT fetch a lone `/version` endpoint in parallel with the lists (a foreign write between the two reads makes the baseline NEWER than a list, an unsafe direction). The per-list read header with `min` is strict.

### Q2. Payload design
**Recommendation: the client's folded change set** (`SessionDerived` at the current cursor, resolved to concrete rows), plus `baselineVersion`. Do not send the op log.
| | Folded change set (recommended) | Op log, server re-folds |
|---|---|---|
| Feasible | Yes | No: the SQL derivation (`deriveChartConfig`) and overlay translation live only in web; `checkAiOp` takes flat tool args |
| Matches what the user saw (D-14/D-16) | Exactly, if built from the same functions as the renderer | Would diverge |
| Server trust | Needs explicit validation (below); same trust boundary as the existing `PATCH /api/widgets/:id` (a `widgets:configure` user may already write arbitrary config incl. `sql`; `POST /api/sql` is itself an arbitrary-SQL proxy under the user's Kinetica credentials) | Higher, but unreachable |
| Size | Bounded by schema array caps (1 MB express body limit is ample) | Larger |
**Request shape (shared `AiKeepRequestSchema`, every object `.strict()`, arrays capped):**
```
{ baselineVersion: int >= 0,
  dynamicViews: { add: [{tempId<0, name<=80, spec: AiDvSpec}], remove: [id>0] },
  layers:  { add: [{tempId<0, tableId>0, config: record, dynamicViewId?: nonzero int}],
             edit: [{id>0, config?: record, tableId?, dynamicViewId?: int|null, info_*?, cb_config?, track_config?, filter_scope?}],
             remove: [id>0] },
  widgets: { add: [{tempId<0, type, title<=200, config: record, rect:{x,y,w,h}}],       // creation order = array order
             edit: [{id>0, title?, type?, configSet?: record, configUnset?: string[], rect?}],
             remove: [id>0] } }
```
**Server re-validation (all before the transaction, none trusting client SQL/names):**
1. shape: zod strict; temp ids unique and negative; positive ids positive.
2. ownership: every positive id exists AND `dashboard_id === :id` (a forged body can name another dashboard's widget; existing PATCH routes do not check this, Keep must).
3. type allow-list: add types must be a registered non-`ai` widget type; reject adding, retyping to, editing or removing a widget of type `ai` (gateway refuses ops on AI widgets; 137 `denyAiWidget`); `change_widget_type` targets limited to `AI_CHART_SWAP_TYPES`.
4. key hygiene: reject `AI_BLOCKED_CONFIG_KEYS` (`customWhere`) and `PERMANENTLY_BLOCKED_KEYS` (`__proto__`, ids) anywhere in `config`/`configSet`.
5. references: every `tableId` (widget config, layer table, dv base and joins) is on the dashboard (`listDashboardTables`); `dynamicViewId`/`includedLayerIds`/`sourceMapWidgetId`/`filterSelection` refs resolve to a saved id on this dashboard or a temp id in this same request; an unmapped negative anywhere fails 422.
6. live schema: for each distinct table, `createLiveSchema(...).describe(id)` as the user; every column in `aiWidgetColumnRefs(config)` / `aiLayerColumnRefs(config)` exists; dvs through `validateAiDvSpec` then `compileAiDvSpec` (ignore any client columns/maxRecords/template; use `config.dvMaxRecords`/`dvMaxJoins` from `getAiConfig()`).
7. caps: `widgets.add.length`, etc. bounded by schema; optionally `<= AI_MAX_NEW_WIDGETS x turns` is NOT required.
Hardening NOT recommended for this phase: re-deriving widget SQL server-side (not possible) or verifying `sql` mentions only dashboard tables (list as an operator-visible known limit in the docs).

### Q3. Transaction and id remap
See Pattern 3 plus:
- **Remap sites** the server must rewrite (all from `visitWidgetConfigRefs`): `config.tableId`, `config.dynamicViewId` (temp dv -> real), `config.sourceMapWidgetId` (legend -> map), `config.includedLayerIds` (map -> layers; the fold appends AI layer temp ids to a temp host map's list and to a saved host map's `contribution.widget[id].includedLayerIds`; an EMPTY list means "all layers" and must stay empty), `config.filterSelection.allowedSourceWidgetIds` (keep non-numeric sentinels verbatim), `config.options[].actions[].target`, `config.spatialTargets[].tableId`; plus layer top-level `dynamic_view_id` and `filter_scope.allowedSourceWidgetIds`. For Keep the visitor must: map negative ids via the maps (throw if absent), pass positive ids through unchanged (do NOT strip a saved id that happens to be missing: a pre-existing dangling reference is not Keep's to repair, same as a manual `DELETE /api/widgets/:id`).
- **dv remove with dependents:** the gateway already stamped `repoint`/`drop` on `remove_dynamic_view`; the fold turns them into `widgetMeta` rebinds, `layerBinding`, `removedWidgetIds`, `removedLayerIds`. The server just applies the resulting edits/removals; it need not recompute dependents. Positive refs to a removed id left in OTHER widgets (radio actions) stay dangling exactly as with manual delete; report a count in `warnings`, do not fail.
- **Geometry:** added widgets get `config.layout = rect`; saved widgets the AI moved (`derived.layout[id]`) get a new `config.layout`. Also bake the currently displayed rect into any saved widget that lacks a complete `config.layout` when the session removed a widget, because `getWidgetLayout(w, index)` falls back to the array index (`DashboardsPage.tsx` ~L609), so a removal would shift legacy widgets on reload. `position` stays 0 as the UI's own create path does; insertion order = array order (list sorts `ORDER BY position ASC`, ties resolve by rowid in practice).
- **Layer specifics:** `createDashboardLayer` default `position = max+1`; AI heatmap layer also needs `info_enabled: 0` (the AI fold sets 0; the DB default is 1) and `dynamic_view_id` through `updateDashboardLayer`. AI-set visibility of a NEW layer lives in `aiSessionStore.tempLayerVisibility[id]`, not in `addedLayers[].config`; the payload builder must copy it into `config.visible` (D-16) or the saved layer silently reverts to the default.
- **Failure injection / better-sqlite3 vs Kinetica:** see Pattern 3.

### Q4. Rights (D-01..D-04)
- Constants (server `lib/permissions.ts`, web mirror `lib/permissions.ts`; no new permission, so none of the RBAC ripple specs listed in memory apply): `PERMISSIONS.DASHBOARDS_EDIT` = `dashboards:edit`, `WIDGETS_CONFIGURE` = `widgets:configure`, `LAYERS_MANAGE` = `layers:manage`, `DYNAMIC_VIEWS_MANAGE` = `dynamic_views:manage`.
- **Compute needed rights from the change set** (`requiredRights(change)`): always `dashboards:edit`; `widgets:configure` if `widgets.add|edit|remove` non-empty OR any dv/layer change implies widget rebind (edits with `configSet` count as edits); `layers:manage` if `layers.add|edit|remove` non-empty; `dynamic_views:manage` if `dynamicViews.add|remove` non-empty. Note this is stricter than the individual routes (POST/DELETE widgets need only `dashboards:edit`); D-01 is the contract.
- **Two-layer gate (SC2):** route-level `...requirePermission(PERMISSIONS.DASHBOARDS_EDIT)` (a forged Keep from a viewer returns the standard `403 {code:"PERMISSION_DENIED", permission:"dashboards:edit"}`; the web `apiFetch` already turns that into a toast and a permission refetch), then in-handler `getEffectivePermissions(username)` for the rest. In-handler refusal uses a DISTINCT code so `apiFetch`'s generic 403 handler does not fire: `403 { error: <D-02 text>, code: "AI_KEEP_PERMISSION", permission }`. Wording template: `You can't save these changes: saving ${noun} needs the ${label} permission.` with `{dynamic views: "Manage dynamic views", widget changes: "Configure widgets", layer changes: "Manage layers"}` (server-owned constant, asserted verbatim in a spec; D-02's dynamic-views text is the locked example). If several are missing, name the first in a fixed order (dynamic views, layers, widgets) and put the full list in `missing: string[]`.
- Also `getDashboard`/`canViewDashboard` first, 404 `{error:"Dashboard not found."}` (non-leak, same as sibling routes); AI enabled (`getAiConfig().enabled`, else `503 AI_NOT_CONFIGURED` like the dv routes) because dv limits come from it. Do NOT additionally require `ai:use` (D-01 lists the needed rights; a user whose `ai:use` was revoked mid-session can still save what is already in their session). Flagged as Open Question 4.
- **Client (D-03):** `useAuthStore((s) => s.hasPermission)(PERMISSIONS.DASHBOARDS_EDIT)` (`store/auth.ts` L120, set from `/api/me`). In `AiChangeBar` use this raw value. `DashboardOpen.canEdit` is `rawCanEdit && !editLocked` and is FALSE whenever the bar is visible.

### Q5. Client after Keep
- **Id swap vs refetch:** refetch the three lists (Pattern 4); the `idMap` is used only for filter re-key and selection remap.
- **`completeKeep()` (new store action, not `reset()`):** (a) set a "saved" archive: move turns with index <= cursor into `savedTurns` with `entries: []` (so `selectHasUnsavedAiChanges` is false, and no per-turn revert, clarification buttons or filter-clear offers render), drop turns ahead of the cursor (they were not saved; same rule as "asking after a revert replaces later turns"); (b) clear `baseEntries`, `turns`, `cursor`, `derived`, `geometry`, `tempLayerVisibility`, `removalApproved`, `highlight`; (c) `aiDvSink.onReset()` (drops temp views, `dvNonce` regenerated), `epoch++`, `clearControl(AI_SOURCE_ID)`; (d) append a muted note "Changes saved." (render in `AiChat` as an `ai-chat-note muted` row after `savedTurns`) plus any server `warnings`; (e) keep `nextTempId` monotonic (as `reset()` does). The true `reset()` (dashboard switch, discard, leave) must also clear `savedTurns`. `buildAskTurns` should include `savedTurns` prompt/answer text in the provider history so the conversation keeps context (Open Question 5).
- **D-13 re-key:** new `useFilterStore.rekeyDvFilters(map: Record<number, number>)` moves `dvFilters[-N]` to `dvFilters[real]`, bumps `filterVersion` once; table filters untouched. Also remap `infoSelectionStore.activeLayerId/activeWidgetId` (memory: that store is global) or clear the selection. `filterCombinationStore.vizToHash` (`w:`/`l:`/`dv:` keys), `dynamicViewStore.views`, `mapCurrentViewStore.views` (keyed by widget id) are cleaned by existing paths (`clearView`, orchestrator ref-count, harmless stale entries); verify no orphan combination view in UAT.
- **D-15 order:** swap first, drop after (Pattern 4). Never drop before the saved dv exists in the effective list.
- **139 issue-1 lesson (2cef90c):** after Keep a dv-bound widget has `config.dynamicViewId = <real id>` and must keep reading the dv through the chain, never a table filter combination. Add a regression spec asserting a post-Keep dv-bound widget resolves its FROM through the dv path (reuse the 139 spec that pinned this) and that Keep never writes a `tableId`-only config for a dv-bound widget (the fold's `bindWidget` writes `tableId`+`table` as the base alongside `dynamicViewId`; keep both exactly as the renderer receives them).
- **Idempotence on a lost response:** a retry from the old baseline returns 409 (the user's own commit moved the version). Wording is slightly wrong for that case but nothing duplicates; "Discard and reload the latest" then shows the saved result.

### Q6. UI (existing classes only; CLAUDE.md)
- **`AiChangeBar`:** Keep = `className="btn-primary btn-sm"`, Discard = `className="ghost-sm"`, both inside `<div className="ds-actions">` (current structure). States: hidden (no raw `dashboards:edit`) -> bar shows Discard + `<span className="muted">Only editors can save AI changes</span>`; disabled while an ask runs (`run.status === "running"`), while saving (label "Saving…", Discard disabled too, D-10), when counts are all zero ("Nothing to save at this point" title) and after a 409 (`keepConflict`); enabled otherwise. Error text D-12 as `<span className="error" role="alert">` (class exists; used throughout DashboardsPage). Replace `AI_CHAT_COPY.keepSoon` (chatText.ts L11) and the `AiLeaveDialog` sentence "Saving AI changes is coming soon." with "Keep them first if you want to save them." (STATE.md L83 asks for exactly this).
- **Confirm dialog (D-09):** new `AiKeepDialog.tsx`, a copy of `AiDiscardDialog.tsx` structure (portal to `document.body`, `modal-overlay` > `modal-content` > `modal-header`/`modal-title`/`modal-body`, Escape and overlay click cancel, focus the safe button on open). Title "Save AI changes?"; body `${added} added · ${edited} edited · ${removed} removed. Filters are not saved.` from `computeChangeCounts`; actions inside `ds-actions`: Save = `btn-primary btn-sm`, Cancel = `ghost-sm`. (Portal is mandatory: grid CSS transforms trap `position:fixed`; memory "Widget modals must portal".)
- **409 dialog (D-08):** `AiKeepConflictDialog.tsx`, same structure; body is the exact D-08 sentence; "Stay" = `btn-primary btn-sm`, "Discard and reload the latest" = `ghost-sm ghost-danger` (mirrors `AiLeaveDialog`). Stay sets `keepConflict` (Keep disabled with a muted note); Discard calls the discard path (`cancelAsk()` + `discardAiSession()`) then the same reload as Pattern 4 step 2-3 without `completeKeep`.
- No new colours or hex; tokens only (`theme-guard` is green by construction if no new CSS file is added; if a rule is needed add it to `styles/global.css` next to `.ai-change-bar` using `var(--...)`).
- **Not machine-verifiable (route to `checkpoint:human-verify`):** the "Filters are not saved" text is legible and visible in light and dark, the bar/dialog buttons look matched, no visual flash during the swap, the chat reads correctly after Keep.

### Q7. Audit
**Recommend recording Keep.** Add `recordAiKeep()` in `lib/aiAudit.ts` that inserts one `ai_audit` row with `counted = 0` (the hour/day cap queries filter `counted = 1`, so caps are unaffected), `status = 'final'`, `question = ''` (column is NOT NULL), `outcome = 'kept' | 'keep_conflict'`, `dashboard_id`, `changes_json = {added:{widgets,layers,dynamicViews}, edited:{...}, removed:{...}, idMap}` (counts and ids only, never config, SQL, filter values or row values), `ts_ms`, `username`. Also emit an OBS-01 JSON log line (`event: "ai_keep"`), like `finalizeAiAnswer`. Refusals for rights are already logged by `permission_denied` (route gate) or can log `ai_keep_denied`. Why `ai_audit` and not `rbac_audit`: Phase 142's viewer reads `ai_audit`; `rbac_audit` has a typed action union and an RBAC-specific viewer. Ripple: 142's viewer must tolerate empty `question` and outcomes beyond `AiOutcome`; `lib.aiAudit.spec` / `routes.aiAsk.audit.spec` count rows per user only in asks, so they are unaffected unless a spec mixes Keep. If the operator prefers zero schema-visible change, the log line alone is the fallback (Open Question 6).

### Q8. Spec ripples and contract
- **New route:** no existing spec enumerates routes (`grep _router.stack` found none); `routes.guards.spec.ts` spot-checks individual routes only. The new classification spec (Q1) is net-new.
- **Permissions:** none added -> the memory's ripple (rbacDb/rbacMigration/web permissions/RolesPage count specs, `permissionGroups`) does NOT apply. Verify with `grep -c` that `lib.permissions.spec.ts` still reads 19.
- **Contract:** add `packages/shared/src/aiKeep.ts` + `export * from "./aiKeep"` in `index.ts`. `ALLOW_LIST_VERSION` ("v4", `AI_CONTRACT_VERSION`) does not change (no allow-list or op change); `aiOp.spec` asserts `AI_OP_KINDS` length 12, untouched.
- **DB:** `ALTER TABLE dashboards ADD COLUMN version ...` mirrors the `filter_display_mode` migration; `db.smoke.spec.ts` enumerates `sqlite_master WHERE type='table'` only (triggers are `type='trigger'`), no ripple; add a migration spec modelled on `db.dynamicViewsMigration.spec.ts` (old-schema DB gains the column and triggers, idempotent re-run).
- **Web specs that WILL change:** `AiChangeBar.spec.tsx` BAR7-4 (asserts Keep `disabled` and title "Saving AI changes is coming soon"), `AiLeaveDialog.spec.tsx`/`DashboardsPage.aiLeave.spec.tsx` (sentence), `aiSessionStore*.spec` (new `completeKeep`, `savedTurns` reset), `AiChat` specs (saved rendering), `DashboardsPage.aiWidget.spec.tsx` (bar). `filterStore.spec.ts` gains `rekeyDvFilters`.
- **Server specs likely to change:** none by contract; `routes.dashboard-*`/widget/layer specs gain header assertions only if the planner chooses to assert them there.

## Common Pitfalls

### Pitfall 1: Negative ids are invisible to the shared remap
**What goes wrong:** Keep calls `remapWidgetConfigRefs`; AI configs holding `dynamicViewId: -3` or `includedLayerIds: [-2]` are written to SQLite unchanged (`asId` requires `> 0`).
**Why:** `asId` was written for exported (positive) ids.
**How to avoid:** negative-aware visitor; throw on unmapped negatives; a spec that builds a payload where a temp widget references a temp dv, a temp layer in a saved map's `includedLayerIds`, and a temp map by a temp legend, then asserts no negative number remains anywhere in the saved rows (`collect` over every config and `dynamic_view_id`).
**Warning signs:** a post-Keep reload shows an orphan dv or an empty map.

### Pitfall 2: Version check outside the transaction
**What goes wrong:** read version, `await` live describes, then write: another user commits in between and is overwritten.
**How to avoid:** compare inside the sync transaction as the first statement; the earlier pre-check is only to skip Kinetica calls on obvious conflicts.

### Pitfall 3: Overlay output is not persisted rows
**What goes wrong:** saving `derived.contribution.widget[id]` raw writes allow-list keys (`metric`, `show_popup`, lowercase `aggregation`) the renderers do not read, and skips the SQL regeneration the renderer does at read time (WidgetRenderer.tsx ~L361-380). `dynamicViewId: undefined` (unbind) disappears in JSON.
**How to avoid:** resolve edits through the SAME function the renderer uses (extract it), send `configSet` + `configUnset`; for retyped widgets send `widgetMeta[id].type` and its config. Add a **Keep-equivalence spec**: for scripted sessions (reuse `devHarness`/`structuralOps.e2e.spec` ops) assert `merge(saved, keepResolved)` deep-equals the renderer's effective config (excluding radio overlays, which come from other sources in `widgetActionStore`).

### Pitfall 4: Using the radio-merged overlay
`widgetActionStore.widgetOverrides[id]` merges ALL sources (radio groups and AI). Persisting it would save radio selections. Use `derived.contribution` (AI-only).

### Pitfall 5: Own incidental writes cause a self-409
`handleLayoutChange` (DashboardsPage.tsx ~L1357) PATCHes widgets whose stored `layout` differs from the grid's (a legacy widget with no `config.layout` always differs); layer debounce flushes, the eye toggle, widget edits before the first AI answer all bump the version. Without own-write rebase, Keep says "Someone else changed this dashboard" to a single user (Open Question 1).

### Pitfall 6: Eye toggle by a user without `layers:manage`
`PATCH layers` returns 403; `apiFetch` shows "You no longer have permission" and refetches permissions. Not a Keep concern, but it means the baseline does not move and nothing is written (correct).

### Pitfall 7: Double Keep / two tabs
Two Keeps race: the second fails its in-transaction version check -> 409. A lost response then retry also 409s (safe). Never auto-retry Keep.

### Pitfall 8: `changes_json`/log leakage
Do not put widget configs, dv specs (their filters hold user values) or SQL in the audit row or log; counts and ids only (matches `ai_audit` "no row values").

### Pitfall 9: Saved-dv `max_records` and `aggregated`
Use `config.dvMaxRecords` (server), not the client's `maxRecords`. The list route derives `aggregated` from `template_sql` (`isAggregatedTemplate`), so the saved row needs no extra column; the compiled templates already satisfy it (139 Q7).

### Pitfall 10: Reorder/legacy layout baking
Removing a saved widget shifts the index fallback layout of legacy widgets lacking `config.layout` (see Q3). Bake rects.

### Pitfall 11: `canEdit` vs `rawCanEdit`; `discardAiSession` vs `reset`
See Anti-Patterns. Both are silent: tests that mount the bar with a non-locked store pass while the real (locked) page hides Keep.

### Pitfall 12: Temp ids still referenced by client state after the swap
`infoSelectionStore.activeLayerId`, `useAiSessionStore.highlight`, `FilterDelta.source.id` in archived chat. Clear or remap (Q5).

## Code Examples

### Version triggers + migration (db.ts post-ALTER block)
```ts
// Source: db.ts ~L500-510 pattern (PRAGMA-guarded ALTER), plus verified trigger semantics
const dashCols = new Set((instance.prepare("PRAGMA table_info(dashboards)").all() as { name: string }[]).map((c) => c.name));
if (!dashCols.has("version")) instance.exec("ALTER TABLE dashboards ADD COLUMN version INTEGER NOT NULL DEFAULT 0");
for (const t of ["widgets", "dashboard_layers", "dashboard_dynamic_views", "dashboard_tables"] as const) {
  instance.exec(`
    CREATE TRIGGER IF NOT EXISTS kbi_ver_${t}_i AFTER INSERT ON ${t} BEGIN UPDATE dashboards SET version = version + 1 WHERE id = NEW.dashboard_id; END;
    CREATE TRIGGER IF NOT EXISTS kbi_ver_${t}_u AFTER UPDATE ON ${t} BEGIN UPDATE dashboards SET version = version + 1 WHERE id = NEW.dashboard_id; END;
    CREATE TRIGGER IF NOT EXISTS kbi_ver_${t}_d AFTER DELETE ON ${t} BEGIN UPDATE dashboards SET version = version + 1 WHERE id = OLD.dashboard_id; END;`);
}
```

### Route skeleton (aiKeepRoutes.ts)
```ts
// Source: aiDvRoutes.ts structure (requireConfig + wrap) and index.ts L1012 gate style
app.post("/api/dashboards/:id/ai-keep", requireConfig, ...requirePermission(PERMISSIONS.DASHBOARDS_EDIT), wrap(async (req, res) => {
  const id = Number(req.params.id);
  const user = (req as AuthedRequest).user!.creds.username;
  if (!getDashboard(id) || !canViewDashboard(user, id)) return res.status(404).json({ error: "Dashboard not found." });
  if (!getAiConfig().enabled) return res.status(503).json({ error: "AI is not configured.", code: "AI_NOT_CONFIGURED" });
  const parsed = AiKeepRequestSchema.safeParse(req.body);               // 400 AI_KEEP_INVALID with path+message only
  const change = parsed.data;
  const missing = missingRights(requiredRights(change), getEffectivePermissions(user));
  if (missing.length) return res.status(403).json({ error: keepPermissionMessage(missing[0]), code: "AI_KEEP_PERMISSION", permission: missing[0], missing });
  if (getDashboardVersion(id) !== change.baselineVersion) return res.status(409).json({ error: KEEP_CONFLICT_MESSAGE, code: "AI_KEEP_CONFLICT" }); // cheap early exit, NOT the guard
  const prepared = await prepareKeep(req, id, change);                  // live describes + compileAiDvSpec; 400/422 on failure; no writes
  try {
    const out = applyKeep(id, change, prepared);                        // SYNC txn; first statement is the version compare
    res.setHeader("X-Kbi-Dashboard-Version", `${id}:${out.before}:${out.version}`);
    afterCommit(req, id, change);                                       // best-effort DROPs of removed saved dv views (caller's names), audit row
    return res.json({ idMap: out.idMap, version: out.version, warnings: out.warnings });
  } catch (e) {
    if (e instanceof KeepConflict) return res.status(409).json({ error: KEEP_CONFLICT_MESSAGE, code: "AI_KEEP_CONFLICT" });
    if (e instanceof KeepInvalid) return res.status(422).json({ error: e.message, code: "AI_KEEP_INVALID" });
    console.error(JSON.stringify({ level: "error", event: "ai_keep_failed", message: e instanceof Error ? e.message : String(e) }));
    return res.status(500).json({ error: "Couldn't save the AI changes. Nothing was saved; try again.", code: "AI_KEEP_FAILED" });
  }
}));
```

### Negative-aware ref visitor (extend the single traversal)
```ts
// Source: dashboardExportRefs.ts asId/visitWidgetConfigRefs; add an option instead of a second enumeration
export const visitWidgetConfigRefs = (config: unknown, visit: RefVisitor, notes?: VisitNotes, opts?: { allowNegative?: boolean }) => {
  const idOf = opts?.allowNegative ? asRefId : asId;   // asRefId: finite non-zero integers (negative = temp)
  /* replace each `asId(` call with `idOf(`; behaviour with opts undefined is byte-identical (existing specs stay green) */
};
// Keep visitor: negative -> maps.get(id) ?? throw KeepInvalid; positive -> id (never stripped)
```

### Client: keep orchestration (shape)
```ts
// Source: aiSessionStore.ts reset() / aiFilterEffects.discardAiSession pattern; order from Pattern 4
const r = await keepAiChanges(dashboardId, payload);              // returns {ok:true,...} | {ok:false, kind:"conflict"|"permission"|"invalid"|"server", message}
if (!r.ok) return handle(r);                                      // conflict -> store.keepConflict=true + dialog; others -> D-12 / D-02 text, session untouched
dashboardVersionStore.getState().rebase(dashboardId, r.version);
const [w, l] = await Promise.all([listWidgets(dashboardId), listDashboardLayers(dashboardId), reloadSavedDynamicViews()]);
unstable_batchedUpdates(() => {                                   // React 18 batches async continuations; keep it ONE synchronous block
  setWidgets(w); setLayers(l);
  useFilterStore.getState().rekeyDvFilters(r.idMap.dynamicViews);
  useAiSessionStore.getState().completeKeep({ notes: r.warnings });
});
```

## State of the Art

| Old approach | Current approach | When | Impact |
|---|---|---|---|
| ARCHITECTURE.md Q6: `expectedDashboardUpdatedAt`, "Keep anyway" on mismatch | `dashboards.version` + triggers, hard 409, no merge | CONTEXT D-05/D-08 (2026-10-21) | `updated_at` cannot detect deletes or child writes; "Keep anyway" is deferred/out of scope |
| ARCHITECTURE.md Q6: `steps: AiOp[]` replayed on the server | Folded change set | this research | server cannot derive chart SQL; ops would also need the gateway's flat tool args |
| ARCHITECTURE.md Q6: reuse `remapWidgetConfigRefs` | Negative-aware visitor | this research | `asId` ignores negatives |
| 139 note "call `reset()` after save" | `completeKeep()` | this research | `reset()` empties the transcript (D-11 wants it kept) |

**Deprecated/outdated:** the Q6 sketch in `.planning/research/ARCHITECTURE.md` (use it for intent only, not mechanics); the stale code comment "foreign_keys PRAGMA is NOT enabled" in db.ts (the comment at ~L1091 documents that better-sqlite3 enables it by default; verified again here: `foreign_keys = 1`).

## Open Questions

1. **Do the user's own non-eye writes count as a conflict? (needs operator confirmation; memory: do not silently reinterpret explicit wording)**
   - Known: D-05 says any saved change after the baseline counts; D-06 exempts only the user's own eye toggles. Literally, a designer who drags a widget (own PATCH) and then uses the AI would get "Someone else changed this dashboard" on Keep; `handleLayoutChange` can even auto-save on load (Pitfall 5).
   - Recommendation: the own-write rebase mechanism is generic; apply it to every write this tab makes (the intent of D-05 is other people's changes). If the operator wants the literal reading, restrict `noteWrite` to the layer PATCH route only. Surface this as a one-line confirmation at plan-check, not an executor choice.
2. **Own writes made in a second tab of the same user.** The edge rebase is per tab (store is per tab), so another tab's write counts as foreign. Recommended and consistent with "someone else"; mention in UAT only.
3. **Custom metrics and column display config are not dashboard state here** (shared across dashboards, not in `dashboard_*` tables). A metric edit by another user between baseline and Keep does not 409 even though a widget referencing `metricId` changes meaning. Accept (out of D-05's enumeration) or add `custom_metrics`/`column_display_config` triggers keyed to every dashboard that uses the table (heavier). Recommend accept and note it.
4. **Require `ai:use` at Keep?** Recommended no (D-01 literal). Cost of yes: a user whose `ai:use` was revoked mid-session loses the ability to save. Planner may add it as defence in depth if the operator prefers.
5. **Provider history after Keep.** Recommend including `savedTurns` Q/A text in `buildAskTurns` so the next question has context; if the operator expects a fresh start, drop them from history but keep them displayed.
6. **Audit row vs log-only** (Q7). Recommend `ai_audit` row with `counted = 0`; log-only is the zero-schema-ripple fallback.
7. **Lost-response retry message.** A self-409 reads "Someone else changed...". Accept (documented) or have the server return the caller's own last Keep version to distinguish; not worth building.

## Operator UAT (live verification needed; operator may ask Claude to drive Chrome over CDP, per memory)
No live Kinetica writes or provider calls are part of automated tests; these need the real stack (light and dark theme for visual items):
1. **SC4 reload:** AI adds a bar chart + KPI + a map heatmap layer, edits one saved widget, removes one widget, adds one AI dynamic view bound to a new chart; Keep; note ids; reload the page; the saved result matches what was shown (`checkpoint:human-verify`). Confirm the confirm dialog text includes "Filters are not saved." and filters are still applied after Keep but cleared on reload.
2. **Temp view lifecycle (D-15):** before Keep `GET /api/ai/dynamic-view/list` shows the `_kbi_ai_*` view; after Keep it lists none; the saved view materializes (brief pending) and the chart reads it; also check no orphan combination/filter views.
3. **dvFilters re-key (D-13):** hand drill-filter on the AI-view chart before Keep; after Keep the chart is still filtered and the chip names the saved view.
4. **Map layer bound to an AI dv, then Keep:** tiles render on both `buildWmsParams` sites (initial and after a filter change) (memory: map WMS is a separate read path).
5. **409:** two browsers (or a second profile) on the same dashboard; user B edits a widget title after user A loaded; A asks AI, Keep -> 409 dialog; "Stay" keeps Keep disabled; "Discard and reload the latest" shows B's title. Then B toggles a layer eye (counts as foreign) vs A toggling their own (does not).
6. **Rights:** a user with `dashboards:edit` but without `dynamic_views:manage` sees Keep and gets the D-02 named refusal with the session intact; a viewer sees only Discard + "Only editors can save AI changes"; forged request via browser devtools `fetch` returns 403.
7. **Join difference (D-21):** keep an AI view with a join; the saved-view note/warning appears; behaviour with a filter on the joined table (now read raw) is as stated.
8. **Visual items (not automatable):** no flash during swap, bar disappears, chat readable with "Changes saved.", button heights matched, dialogs centered in both themes.

## Test strategy and red-first criteria (Nyquist section skipped: `workflow.nyquist_validation` is false)

Gates (CLAUDE.md): web `npx tsc --noEmit`, `npx vitest run`, `npx vitest run src/styles/theme-guard.spec.ts`; server `npx tsc --noEmit` and the SET-BASED server gate (failing files must be a subset of the known `TD-V16-TEST-ISOLATION` set; never assert a fixed pass count). Run web and server suites sequentially, `--maxWorkers=4` (memory: parallel load gives false timeouts). Do not read `packages/server/.env`; server specs run with the leak guard in `tests/setup.ts`.

Grep anchors verified to read **0 today** (checked with `grep -rn` across `server/src server/tests web/src shared/src`): `ai-keep`, `AI_KEEP_CONFLICT`, `AI_KEEP_PERMISSION`, `AiKeepRequestSchema`, `completeKeep`, `rekeyDvFilters`, `stampWrite`, `dashboardVersionStore`, `X-Kbi-Dashboard-Version`, `buildKeepPayload`, `AiKeepDialog`, `Only editors can save AI changes`, `Filters are not saved`. Use these (or new test titles such as `KEEP-ATOMIC-late`) as criteria anchors, never `Saving AI changes is coming soon` (already 1 occurrence in `AiChangeBar.spec.tsx`; it must go to 0, which is a valid red-first inversion because it reads 1 now).

| Criterion | Test (suggested) | Automated |
|---|---|---|
| SC1 atomic | `tests/lib.aiKeep.atomic.spec.ts`: RAISE trigger at first create and at late step; full snapshot incl. `dashboards.version`; zero DROP fetches | yes |
| SC1 ids | `lib.aiKeep.apply.spec.ts`: no negative number remains in any saved row; dv -> layer -> widget refs resolve | yes |
| SC2 forged | `routes.aiKeep.spec.ts`: viewer 403 `PERMISSION_DENIED`; edit-without-`dynamic_views:manage` 403 `AI_KEEP_PERMISSION` exact text; foreign-dashboard widget id 422/404; type `ai` refused; no view access 404 | yes |
| SC3 409 | same spec: stale `baselineVersion` -> 409, all tables unchanged, zero Kinetica calls; concurrent second Keep -> 409 | yes |
| Version | `db.dashboardVersion.spec.ts` (each helper bumps; cascade bumps; migration idempotent) + route classification spec | yes |
| Web payload | `keepPayload.spec.ts` + Keep-equivalence spec vs renderer config | yes |
| Web store/UI | `aiSessionStore.keep.spec`, `AiChangeBar.spec` (rewrite BAR7-4), `AiKeepDialog.spec`, `filterStore` rekey, `dashboardVersionStore.spec` (edges, out-of-order, foreign write) | yes |
| SC4 text/visual, no flash | operator UAT | **manual-only** (visual/legibility; route to `checkpoint:human-verify`) |

## Sources

### Primary (HIGH confidence, read in this repo 2026-10-21)
- `packages/server/src/db.ts` (schema DDL, ALTER block, `updateDashboard`, widget/layer/dv/table helpers, FK note)
- `packages/server/src/index.ts` (routes L840-1210, L1795-1980, L2300-2380, L3104; `express.json` 1 MB)
- `packages/server/src/lib/dashboardImport.ts`, `lib/dashboardExportRefs.ts` (`asId`, visitor, `RefIdMaps`)
- `packages/server/src/lib/aiDvCompile.ts`, `aiDvRoutes.ts`, `aiSessionViews.ts`, `lib/ai/gateway.ts`, `lib/ai/liveSchema.ts`, `lib/aiAudit.ts`, `lib/rbacAudit.ts`, `rbac.ts`, `lib/permissions.ts`
- `packages/shared/src/aiOp.ts`, `aiDynamicView.ts`, `aiColumnRefs.ts`, `aiCatalog.ts`, `actionAllowList.ts`, `layout.ts`
- `packages/web/src/store/aiSessionStore.ts`, `lib/aiSession/*` (`foldSession`, `applySession`, `changeCounts`, `buildAskRequest`, `askRunner`, `chatText`, `types`), `components/AiChangeBar.tsx`, `AiDiscardDialog.tsx`, `AiLeaveDialog.tsx`, `charts/AiChat.tsx`, `charts/WidgetRenderer.tsx`, `DashboardsPage.tsx`, `hooks/useLayerVisibilityToggle.ts`, `hooks/useDynamicViewMaterializeChain.ts`, `hooks/useApiQuery.ts`, `lib/aiDv/*`, `store/filterStore.ts`, `store/dynamicViewStore.ts`, `store/auth.ts`, `api/client.ts`, `lib/widgetOverlayKeys.ts`
- `packages/server/tests/lib.dashboardImport.apply.spec.ts` (`withAbortTriggerOn`), `tests/routes.aiDv.spec.ts`, `tests/helpers/aiRouteKit.ts`
- Scratch verification (better-sqlite3 12.x, sqlite 3.53.1): FKs on by default; AFTER INSERT/DELETE triggers fire on FK-cascade deletes
- `.planning/` CONTEXT, ROADMAP, REQUIREMENTS, STATE, `research/ARCHITECTURE.md` (Q6, S4), 134-CONTEXT (D-10, D-12, D-16), 139-RESEARCH (Q7)

### Secondary (MEDIUM)
- SQLite documented trigger/FK semantics (consistent with the scratch run; official docs not re-fetched)

### Tertiary (LOW)
- none

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH (no new dependencies; every reused module read)
- Architecture: HIGH for server transaction, rights, remap trap, version triggers; MEDIUM for own-write attribution and client swap (design verified against code paths, not yet built)
- Pitfalls: HIGH (each traced to a specific file and line region)

**Research date:** 2026-10-21
**Valid until:** 2026-11-20 (stable internal code; re-check if Phases 142 or any edit to `foldSession`, `WidgetRenderer` overlay merge or `db.ts` schema lands first)
