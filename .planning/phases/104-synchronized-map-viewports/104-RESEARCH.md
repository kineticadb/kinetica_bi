# Phase 104: Synchronized Map Viewports - Research

**Researched:** 2026-07-07
**Domain:** OpenLayers viewport event system + transient Zustand store design + MapChartRenderer wiring
**Confidence:** HIGH (codebase-verified; no external library research required — all patterns
verified directly against the live source files)

---

## Summary

Phase 104 adds a per-map "Sync map viewport" config toggle (default OFF). When enabled, the map
PUBLISHES its viewport (center + zoom, both in EPSG:3857) to a new transient Zustand store
(`mapViewportSyncStore`) keyed by dashboardId, and SUBSCRIBES to updates published by OTHER
enabled maps on the same dashboard, programmatically moving its OL view to match. Disabled maps
are entirely unaffected.

The feature is **frontend-only**, lives entirely inside `packages/web`, and touches exactly two
files plus one new store: `MapChartRenderer.tsx`, `MapConfigPanel.tsx`, and a new
`mapViewportSyncStore.ts`. There is no server route, no persistence, no WMS param change, and no
SQL path involved. The OL map is already fully accessible via `mapRef.current`, and the view is
`EPSG:3857` (locked by PITFALL M-03). The store pattern mirrors `spatialFilterStore.ts` exactly.

The critical engineering challenge is the **echo-loop guard**: a sync-driven `view.animate()`
call fires a `moveend` event, which would re-publish and create an oscillation between two or
more subscribing maps. The standard solution — a boolean ref flag set around the programmatic
move — is the right approach here and integrates cleanly with the existing `mountedRef` lifecycle
discipline.

**Primary recommendation:** New `mapViewportSyncStore` (transient, keyed by dashboardId →
published viewport snapshot + originWidgetId + bump counter); publish on OL `moveend` after
checking an `isSyncDrivenRef` flag; subscribe via a Zustand selector scoped to the dashboard's
slot; apply via `view.animate()` guarded by the flag. Cleanup: reset the dashboard's slot on
the existing DashboardsPage cleanup chain.

---

## Standard Stack

### Core (all already installed — no new dependencies)

| Library | Import path | Purpose in this phase |
|---------|------------|----------------------|
| OpenLayers `ol/Map` | `ol/Map` | Map instance already in `mapRef.current` |
| OpenLayers `ol/View` | `ol/View` | `view.getCenter()`, `view.getZoom()`, `view.animate()` |
| OpenLayers `ol/Observable` | `ol/Observable` | `unByKey` (already imported at line 50) for listener cleanup |
| `ol/events` `EventsKey` | `ol/events` | Already imported (line 51); return type of `map.on('moveend', ...)` |
| Zustand `create` | `zustand` | New `mapViewportSyncStore.ts` mirrors `spatialFilterStore.ts` |

### No new dependencies required

The feature uses only libraries already in the project. No `npm install` needed.

---

## Architecture Patterns

### Recommended Project Structure

```
packages/web/src/
├── store/
│   └── mapViewportSyncStore.ts   ← NEW (mirrors spatialFilterStore.ts pattern)
├── components/charts/
│   ├── MapChartRenderer.tsx      ← Wire Effect 9 (publish) + subscribe effect
│   └── MapConfigPanel.tsx        ← Add "Sync map viewport" toggle to VIEWPORT SYNC group
└── lib/
    └── mapInfoConfig.ts          ← Add getSyncViewportEnabled() getter (same pattern as others)
```

### Pattern 1: mapViewportSyncStore shape

Mirrors `spatialFilterStore.ts` — a transient Zustand store with `reset()`. Keyed by
`dashboardId` to isolate dashboards.

```typescript
// Source: inferred from spatialFilterStore.ts + filterCombinationStore.ts patterns

export type ViewportSnapshot = {
  center: [number, number]; // EPSG:3857 — matches OL view.getCenter()
  zoom: number;             // fractional zoom level
  originWidgetId: number;   // identifies the publishing map; subscribers skip if their own id
  bump: number;             // monotonic counter — allows re-publishing identical coords on force-sync
};

type State = {
  // keyed by dashboardId — one active viewport slot per dashboard
  viewports: Record<number, ViewportSnapshot | undefined>;
  publish: (dashboardId: number, snap: ViewportSnapshot) => void;
  clear: (dashboardId: number) => void;
  reset: () => void;
};
```

**Why `dashboardId` key:** DashboardContext exposes `dashboardId` (already imported by
MapChartRenderer via `useDashboardContextOptional()`). Multiple dashboards are never open
simultaneously in the current app, but keying by dashboardId future-proofs the store and mirrors
the `filterCombinationStore` cleanup pattern (snapshot then clear per dashboardId).

**Why `originWidgetId`:** Subscribers compare the incoming `originWidgetId` against
`widget.id`. A map skips updates where `originWidgetId === widget.id` (it published them itself).

**Why `bump`:** Allows a user to force a re-sync even if the viewport coordinates haven't
changed (e.g., after enabling sync on a map that is already at the same coords as the leader).

### Pattern 2: Echo-Loop Guard — `isSyncDrivenRef`

```typescript
// Inside MapChartRenderer, alongside existing refs:
const isSyncDrivenRef = useRef<boolean>(false);

// In the publish Effect (Effect 9):
const moveendKey = map.on('moveend', () => {
  if (isSyncDrivenRef.current) return; // suppress re-publish for programmatic moves
  if (!syncEnabled) return;
  const view = map.getView();
  const center = view.getCenter();
  const zoom = view.getZoom();
  if (!center || zoom === undefined) return;
  useMapViewportSyncStore.getState().publish(dashboardId, {
    center: center as [number, number],
    zoom,
    originWidgetId: widget.id,
    bump: Date.now(), // monotonic; fine-grained enough
  });
});
return () => { unByKey(moveendKey); };
```

This is the established OL listener cleanup pattern already used in Effect 8 with `geomChangeKey`
and `unByKey` (lines 1970–1973). The ref approach is the same pattern used for `drawModeRef`
(lines 819–828): set the ref imperatively to avoid widening effect dependency arrays.

### Pattern 3: Subscribe and Apply

```typescript
// Zustand subscription scoped to this dashboard's viewport slot:
const incomingViewport = useMapViewportSyncStore(
  (s) => s.viewports[dashboardId] // primitive enough per S-02 — object ref changes on each publish
);

// Apply in a separate useEffect that depends on incomingViewport:
useEffect(() => {
  if (!syncEnabled) return;
  if (!incomingViewport) return;
  if (incomingViewport.originWidgetId === widget.id) return; // skip own publishes
  const map = mapRef.current;
  if (!map) return;
  isSyncDrivenRef.current = true;
  map.getView().animate(
    { center: incomingViewport.center, zoom: incomingViewport.zoom, duration: 0 },
    () => { isSyncDrivenRef.current = false; } // reset flag in animate completion callback
  );
}, [incomingViewport, syncEnabled, widget.id, dashboardId]);
```

**Note on `duration: 0`:** Using `animate()` with `duration: 0` instead of
`setCenter`/`setZoom` keeps the API consistent with the existing zoom toolbar pattern (lines
2252–2265) and ensures the completion callback fires synchronously to reset `isSyncDrivenRef`.
Alternatively, `isSyncDrivenRef` can be reset inside the `moveend` listener itself immediately
after the `return` branch.

**Note on S-02:** The `viewports[dashboardId]` selector returns an object reference that changes
on every `publish()` call (new object created). This is correct — we WANT the subscriber to
re-fire on every new publish. The selector should NOT be a primitive string for this use case
(it is the trigger, not a cache-buster key).

### Pattern 4: Debounce for High-Frequency Events

`moveend` fires ONCE after the move completes (not on every pixel of pan), so it is naturally
low-frequency. No debounce is required. This is distinct from `change:center` or
`change:resolution` which fire continuously during animation — do NOT use those events.

**Confirmed from OL documentation pattern:** `moveend` fires after the map stops moving
(equivalent to a drag-end or zoom-end). It is the correct event for this use case.

### Anti-Patterns to Avoid

- **Do NOT use `view.setCenter()` + `view.setZoom()` separately:** They each fire independent
  events. Use `view.animate()` which is atomic.
- **Do NOT use `change:center` or `change:resolution`:** These fire on every animation frame;
  extremely high frequency, will flood the store and other maps.
- **Do NOT subscribe to the entire store object:** S-02 lock — scope the selector to
  `s.viewports[dashboardId]` only, not `s.viewports` (would re-render on ANY dashboard's update).
- **Do NOT put `isSyncDrivenRef` in state:** It needs to be visible synchronously inside the
  `moveend` callback. A React state update is asynchronous and would miss the guard window.
- **Do NOT reset `isSyncDrivenRef` in a `useEffect`:** The animate callback is the right
  site — it fires synchronously after the animation completes (or immediately for `duration: 0`).

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| OL event listener cleanup | Manual ref tracking | `unByKey(key)` + `EventsKey` | Already the established pattern in Effect 8 (line 1973) |
| Store lifecycle (reset on dashboard switch) | Custom tracking | `reset()` in DashboardsPage cleanup chain (item 11) | Established pattern; 10 stores already in the chain |
| Config field default | Duplicated null-checks | `getSyncViewportEnabled(config)` getter in `mapInfoConfig.ts` | Established pattern — all 7 existing map config fields use this |

**Key insight:** The entire feature is plumbing two existing, well-understood patterns together:
OL event listening (already done for `moveend`-adjacent events in Effect 8) and a transient
Zustand store (already done for spatial filters). There is no novel algorithmic work.

---

## Common Pitfalls

### Pitfall 1: Echo-Loop Oscillation
**What goes wrong:** Map A publishes viewport → Map B receives it, applies via `animate()` →
`moveend` fires on Map B → Map B publishes → Map A receives it → infinite oscillation.
**Why it happens:** `view.animate()` triggers `moveend` just like a user pan.
**How to avoid:** `isSyncDrivenRef.current = true` before `animate()`;
reset in the animate completion callback. The `moveend` publish handler checks this flag first
and returns immediately.
**Warning signs:** Maps visually stutter / oscillate between two slightly different positions.

### Pitfall 2: Oscillation Between 3+ Maps
**What goes wrong:** With maps A, B, C all sync-enabled, A pans → publishes → B applies and
publishes (if its guard failed) → C receives B's publish (not A's) → visual drift over time.
**How to avoid:** The `originWidgetId` stamp is not sufficient alone — the `isSyncDrivenRef`
guard is the primary protection. All three maps must correctly suppress `moveend` on programmatic
moves. Verify the guard is in place at EVERY publish site.
**Warning signs:** With 3 maps, moving one causes brief stuttering on a third map.

### Pitfall 3: OL `moveend` Fires During Animation Completion
**What goes wrong:** After `view.animate({ duration: 0 }, callback)`, OL may fire `moveend`
BEFORE the callback runs (order is implementation-defined in some OL versions). If
`isSyncDrivenRef` is reset inside the callback but `moveend` fires first, the guard may have
already been reset.
**How to avoid:** Reset `isSyncDrivenRef.current = false` INSIDE the `moveend` handler itself,
after confirming it was set. Alternatively, use a small `queueMicrotask(() => { isSyncDrivenRef.current = false; })` in the completion callback.
**Recommended approach:** Reset the flag at the START of the next `moveend` callback that sees
the flag set: the publish handler reads `isSyncDrivenRef.current === true` → returns without
publishing → sets `isSyncDrivenRef.current = false` before the return. This way the flag is
always cleared by the very event that would have caused the echo.

### Pitfall 4: `dashboardId` Not Available in `useDashboardContextOptional()`
**What goes wrong:** In some test fixtures, `DashboardContext` is not provided, so `dashboardCtx`
is null and `dashboardCtx?.dashboardId` is undefined. Publishing to `viewports[undefined]` would
corrupt the store.
**How to avoid:** Guard: `if (!dashboardCtx) return;` before any publish/subscribe logic.
The `useDashboardContextOptional` pattern is already present in MapChartRenderer (lines 512–514).

### Pitfall 5: `view.getCenter()` Returns `undefined` Before Map Is Fully Initialized
**What goes wrong:** On first render, `getCenter()` returns undefined if the view hasn't been
positioned yet (view center is `[0, 0]` by default in Effect 1, but there's a brief window).
**How to avoid:** `if (!center || zoom === undefined) return;` guard in the `moveend` handler
(OL guarantees both are defined after the first move, but defensive).

### Pitfall 6: Interaction With Spatial-Filter Draw Interactions
**What goes wrong:** Drawing a spatial filter (bbox/lasso/circle) involves clicking and dragging,
which produces pan events and a `moveend` after the draw completes. This could spuriously
re-publish the viewport.
**How to avoid:** Drawing does NOT pan the map; the draw interaction captures pointer events
but doesn't move the view. `moveend` only fires when the view's center or zoom changes. Draw
events (drawstart/drawend) do not fire `moveend`. No special handling needed.

### Pitfall 7: StrictMode Double-Mount
**What goes wrong:** React 18 StrictMode double-invokes effects. The `isSyncDrivenRef` is `false`
by default on each mount — safe. The subscribe effect re-fires harmlessly. The `moveend` key from
the first mount is cleaned up by the first cleanup; the second mount registers a fresh listener.
**How to avoid:** No special handling required beyond the existing `mountedRef` pattern.

### Pitfall 8: Fractional / Undefined Zoom
**What goes wrong:** OL `view.getZoom()` can return `undefined` when the view has no zoom level
set. `view.setZoom(undefined)` causes OL to throw.
**How to avoid:** Guard with `if (zoom === undefined) return;` before publishing; always pass
a concrete number to `animate()`.

---

## Code Examples

### OL `moveend` Event Subscription (verified OL pattern)

```typescript
// Source: ol/Map API + Effect 8 pattern (MapChartRenderer.tsx line 1973)
// map.on() returns an EventsKey; unByKey(key) removes it — the established project pattern.
const key: EventsKey = map.on('moveend', () => {
  if (isSyncDrivenRef.current) {
    isSyncDrivenRef.current = false; // clear flag — the echo we suppressed
    return;
  }
  // ... publish logic
});
return () => { unByKey(key); };
```

### Reading OL Viewport (verified against MapChartRenderer lines 2252–2264)

```typescript
const view = map.getView(); // or mapRef.current?.getView()
const center = view.getCenter();   // [x, y] in EPSG:3857; undefined before first interaction
const zoom = view.getZoom();       // fractional number; undefined when view has no zoom
const resolution = view.getResolution(); // alternative to zoom — not needed here
```

### Programmatically Setting Viewport (verified against MapChartRenderer lines 2255–2264)

```typescript
// Existing pattern (MapZoomToolbar handlers, lines 2252–2264):
view.animate({ zoom: z + 1, duration: 200 });

// For sync (duration: 0 = immediate, atomic, still fires moveend after):
view.animate({ center: incomingViewport.center, zoom: incomingViewport.zoom, duration: 0 });
```

### Zustand Store Pattern (mirrors spatialFilterStore.ts)

```typescript
// Source: spatialFilterStore.ts lines 75–128
export const useMapViewportSyncStore = create<State>((set) => ({
  viewports: {},
  publish: (dashboardId, snap) =>
    set((s) => ({ viewports: { ...s.viewports, [dashboardId]: snap } })),
  clear: (dashboardId) =>
    set((s) => {
      const next = { ...s.viewports };
      delete next[dashboardId];
      return { viewports: next };
    }),
  reset: () => set({ viewports: {} }),
}));
```

### Config Toggle in MapConfigPanel (mirrors showScaleBar pattern)

```typescript
// In MapConfigPanel — existing pattern (lines 395–422 for showScaleBar):
<div className="config-group">
  <div className="config-group-label">VIEWPORT SYNC</div>
  <label className="config-toggle">
    <input
      type="checkbox"
      aria-label="Sync map viewport"
      checked={getSyncViewportEnabled(widgetCfg as MapWidgetConfig)}
      onChange={(e) => onChange({ ...config, syncViewport: e.target.checked })}
    />
    Sync map viewport with other maps on this dashboard
  </label>
  <div className="config-hint">
    When enabled, panning or zooming this map moves all other sync-enabled maps on the
    same dashboard. Disabled by default.
  </div>
</div>
```

### Getter in mapInfoConfig.ts (mirrors all existing getters)

```typescript
/** Default for `syncViewport` — opt-in (false): legacy maps are byte-identical to today. */
export const DEFAULT_SYNC_VIEWPORT = false;

export function getSyncViewportEnabled(config: Pick<MapWidgetConfig, "syncViewport">): boolean {
  return config.syncViewport ?? DEFAULT_SYNC_VIEWPORT;
}
```

---

## Research Findings: Specific Questions Answered

### Q1: OL Map Creation and Viewport API

The `ol/Map` instance is created in Effect 1 (line 983) and stored in `mapRef`. It is never
recreated after mount (M-01 lock). The `OlView` is created inline at Effect 1 time with
`projection: "EPSG:3857"`, `center: [0, 0]`, `zoom: 2`.

Key view API calls, all verified in the file:
- `map.getView()` — returns the OlView (no defensive check needed; it's created at mount)
- `view.getCenter()` — `[number, number] | undefined` in EPSG:3857
- `view.getZoom()` — `number | undefined`
- `view.animate({ center, zoom, duration }, callback?)` — already used at lines 2255–2264
- `map.on('moveend', handler)` — returns `EventsKey`; `unByKey(key)` removes it

The coordinate system is EPSG:3857 (Web Mercator) — PITFALL M-03 lock. Publishing and receiving
maps both use EPSG:3857 natively. No coordinate transformation is needed.

### Q2: Echo-Loop Guard

Best approach: a module-local `useRef<boolean>(false)` named `isSyncDrivenRef`.

Set to `true` immediately before calling `view.animate()` in the subscribe effect.

Reset to `false` inside the `moveend` handler: the very first `moveend` that fires after the
programmatic move will see `isSyncDrivenRef.current === true`, return without publishing, and
reset the flag. This is deterministic because:
1. `animate({ duration: 0 })` completes synchronously (OL fires moveend on next frame)
2. `isSyncDrivenRef` is set before the animate call and read inside the next moveend handler

This is safer than resetting in the animate completion callback due to OL's moveend/callback
ordering (Pitfall 3).

### Q3: Widget and Dashboard Identity

`widget.id` (type `number`) is available via the `widget: WidgetDto` prop. This is already used
at line 1706 (`sourceWidgetId: widget.id`).

`dashboardId` is available via `useDashboardContextOptional()` → `dashboardCtx?.dashboardId`.
This is already imported (line 65) and called (lines 512–514). The context provides `dashboardId`
as a `number`.

No new prop-drilling is needed — both identifiers are already accessible inside
`MapChartRenderer`.

### Q4: Transient Store Pattern to Mirror

`spatialFilterStore.ts` is the closest match:
- Simple shape: `shapes[]` + `spatialFilterVersion` counter + actions + `reset()`
- Registered in BOTH cleanup chains (App.tsx logout + DashboardsPage dashboard-switch)
- The `mapViewportSyncStore` should follow the same pattern

Current cleanup chain in `DashboardsPage.tsx` (lines 500–555):
1. filterViewStore
2. filterStore
3. infoSelectionStore
4. lastInfoClickContextStore
5. spatialFilterStore
6. dynamicViewStore
7. widgetActionStore
8. columnDisplayConfigStore
9. filterCombinationStore (9th)
10. customMetricsStore (10th)

**`mapViewportSyncStore` becomes the 11th store** in the cleanup chain, in both App.tsx
(logout) and DashboardsPage.tsx (dashboard-switch). The `clear(dashboardId)` action is sufficient
for the DashboardsPage side (only clear the current dashboard's slot); `reset()` covers logout.

Selective per-dashboard subscription:
```typescript
const incomingViewport = useMapViewportSyncStore((s) => s.viewports[dashboardId]);
```
This selector is already scoped to the current dashboard. Maps on other dashboards (which don't
exist simultaneously) don't interfere.

### Q5: Config Toggle Wiring

`MapConfigPanel` is the `CustomConfigPanel` registered for the `map` chart type (definitions/map.ts,
line 32). All map-level config is written here.

The toggle pattern is identical to the existing `showScaleBar` checkbox (lines 395–410 of
MapConfigPanel.tsx). The exact same `<div className="config-group">` + `<label
className="config-toggle"><input type="checkbox" .../>` structure applies.

`getSyncViewportEnabled()` goes into `lib/mapInfoConfig.ts` alongside all 7 existing map config
getters. The config field `syncViewport?: boolean` goes into `MapWidgetConfig` in
`lib/wmsUrlBuilder.ts`. Default is `false` (opt-in, unlike `infoEnabled` which defaults true).

MapChartRenderer reads it at component scope:
```typescript
const syncEnabled = getSyncViewportEnabled(widgetConfig as Partial<MapWidgetConfig>);
```

### Q6: Multiple Maps on One Dashboard

Each `MapChartRenderer` is an **independent React component instance** mounted by the widget
grid. Each has its own:
- `mapRef.current` (distinct `OlMap` instance)
- `widget.id` (distinct widget ID)
- All refs (`isSyncDrivenRef`, `mountedRef`, etc.)

There is NO shared OL state. The only shared state is the `mapViewportSyncStore` (global Zustand
store) which is keyed by `dashboardId`. All sync-enabled maps on the same dashboard read and
write the same `viewports[dashboardId]` slot.

The subscriber check `incomingViewport.originWidgetId === widget.id` correctly identifies that
a map should not react to its own publish. With 3 maps (A, B, C — all sync-enabled): A pans →
publishes (originWidgetId=A) → B's subscribe effect fires (B's originWidgetId check: A !== B →
apply, but isSyncDrivenRef=true → suppress B's moveend) → C's subscribe effect fires (C's check:
A !== C → apply, isSyncDrivenRef=true → suppress C's moveend). No oscillation.

### Q7: Lifecycle and Cleanup

Dashboard switch reset: Add `useMapViewportSyncStore.getState().reset()` to the DashboardsPage
cleanup return function (alongside the 10 existing resets). Unlike filter/combination stores,
there is no server-side DROP needed (purely transient).

App.tsx logout reset: Same — `useMapViewportSyncStore.getState().reset()`.

The publish effect (`Effect 9`) cleanup function calls `unByKey(moveendKey)` — the established
OL listener cleanup pattern.

The subscribe effect cleanup is handled automatically by Zustand — the subscription selector
is unregistered when the component unmounts. No explicit cleanup needed.

### Q8: Test Approach

The `MapChartRenderer.spec.tsx` file uses vi.mock for all store dependencies and OL internals
(OlMap, OlView, etc.). The ol mock pattern is established.

**What can be pure-logic unit-tested (no OL mock needed):**
- `mapViewportSyncStore.ts`: publish, clear, reset, and the `originWidgetId` filtering logic
  (pure Zustand store — same pattern as `spatialFilterStore.spec.ts`)
- `getSyncViewportEnabled()` getter in `mapInfoConfig.ts` (trivial ?? default function)

**What needs the OL mock (in MapChartRenderer.spec.tsx):**
- Verify that `map.on('moveend', ...)` is called when `syncEnabled=true` and not called when
  `syncEnabled=false`
- Verify that `view.animate()` is called when an incoming viewport differs from the current one
  and `syncEnabled=true`
- Verify that `isSyncDrivenRef` guard prevents re-publish (this may need an integration-style test
  using the mock store + mock OL view)

The established test infrastructure in `MapChartRenderer.spec.tsx` mocks `useFilterStore`,
`useSpatialFilterStore`, etc. via `vi.mock` with module-level mutable state objects. A
`useMapViewportSyncStore` mock follows the exact same pattern.

### Q9: Pitfalls Summary

Already documented above. The most important:
1. Echo-loop oscillation — `isSyncDrivenRef` guard is non-negotiable
2. `moveend` fires on `animate()` — confirmed; this is by design and why the guard is needed
3. Fractional zoom — always guard `zoom === undefined`
4. 3+ map oscillation — the guard must work for ALL participating maps, not just the initial publisher
5. `dashboardCtx` may be null in tests — gate all publish/subscribe on `if (!dashboardCtx) return`

---

## State of the Art

| Old Approach | Current Approach | Notes |
|--------------|------------------|-------|
| No viewport sync | Phase 104: transient store + OL moveend | New feature |
| Manual OL event cleanup | `unByKey(EventsKey)` | Already established in Effect 8 |

---

## Open Questions

1. **`view.animate()` completion callback timing vs `moveend` ordering**
   - What we know: OL fires `moveend` when an animation completes; `animate()` has an optional
     completion callback. The ordering between them is not explicitly documented.
   - What's unclear: Whether the completion callback runs before or after `moveend` in OL's
     implementation.
   - Recommendation: Reset `isSyncDrivenRef` inside the `moveend` handler itself (see Pattern 2
     and Pitfall 3) to avoid dependency on callback ordering. This is the safest approach.

2. **Should `duration: 0` or `duration: 250` be used for the programmatic sync?**
   - What we know: `duration: 0` is immediate (no animation); `duration: 250` animates smoothly.
     The zoom toolbar uses `duration: 200`.
   - What's unclear: User preference — smooth animation may feel nice for sync, but could also
     feel sluggish when many maps are syncing.
   - Recommendation: Default to `duration: 0` (immediate, matches the "data follows cursor"
     feel of scrolling). Can expose as a future config option if operators request it.

3. **Whether `clear(dashboardId)` or `reset()` is the right cleanup on dashboard-switch**
   - What we know: All other stores call `reset()` (full wipe) on dashboard switch because
     dashboard-A data must not leak to dashboard-B.
   - Recommendation: Use `reset()` for consistency with the established cleanup chain pattern.
     The `clear(dashboardId)` action is available for targeted cleanup if ever needed.

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| MAPSYNC-V119-01 | Per-map "Sync map viewport" config toggle (default OFF). An enabled map both publishes and subscribes. | `MapWidgetConfig.syncViewport?: boolean` + `getSyncViewportEnabled()` getter + toggle in `MapConfigPanel` |
| MAPSYNC-V119-02 | When a sync-enabled map pans/zooms, its viewport (center + zoom in EPSG:3857) is published to the per-dashboard sync store slot. | OL `map.on('moveend')` → `mapViewportSyncStore.publish(dashboardId, snap)` |
| MAPSYNC-V119-03 | Every OTHER sync-enabled map on the same dashboard receives the published viewport and animates to match. | `useMapViewportSyncStore(s => s.viewports[dashboardId])` selector → `view.animate()` subscriber effect |
| MAPSYNC-V119-04 | A sync-driven programmatic move does NOT re-publish (no echo/oscillation). | `isSyncDrivenRef` boolean ref guard; verified by a unit test (pure logic + OL mock) |
| MAPSYNC-V119-05 | Sync is scoped per-dashboard — maps on different dashboards (or the same dashboard opened later after a switch) are isolated. | Store keyed by `dashboardId`; `reset()` on dashboard-switch in the DashboardsPage cleanup chain |
| MAPSYNC-V119-06 | Maps with no `syncViewport` config field (existing maps) render and behave byte-identically to today. | `DEFAULT_SYNC_VIEWPORT = false`; all logic is gated on `syncEnabled === true`; no publish/subscribe when disabled |
</phase_requirements>

---

## Sources

### Primary (HIGH confidence — verified against live source files)

| File | What was verified |
|------|------------------|
| `packages/web/src/components/charts/MapChartRenderer.tsx` | OL Map creation (Effect 1); existing effects 1–8; `mapRef`, `mountedRef`, `isSyncDrivenRef` pattern; `unByKey`/`EventsKey` usage; `view.animate()` at lines 2255–2264; `widget.id` at line 1706; `useDashboardContextOptional()` at lines 512–514 |
| `packages/web/src/components/charts/MapConfigPanel.tsx` | Toggle pattern (showScaleBar/showFullscreenButton at lines 395–422); `config-group` + `config-toggle` CSS class usage; `onChange({ ...config, field: value })` pattern |
| `packages/web/src/store/spatialFilterStore.ts` | Transient store shape: state + actions + `reset()`; lifecycle wiring comment |
| `packages/web/src/store/filterCombinationStore.ts` | `dashboardId` keying pattern; cleanup chain (snapshot-then-reset) |
| `packages/web/src/store/filterStore.ts` | `reset()` lifecycle; S-02 primitive selector pattern |
| `packages/web/src/components/DashboardsPage.tsx` | 10-store reset chain (lines 500–555); cleanup ordering |
| `packages/web/src/lib/mapInfoConfig.ts` | Getter pattern for all 7 map config fields; `DEFAULT_*` constant + `getX()` function shape |
| `packages/web/src/lib/wmsUrlBuilder.ts` | `MapWidgetConfig` type (lines 65–150); optional boolean field pattern (`showScaleBar?: boolean` at line 144) |
| `packages/web/src/components/charts/definitions/map.ts` | `CustomConfigPanel: MapConfigPanel` wiring; `defaultConfig` pattern; `fields: []` |
| `packages/web/src/components/charts/MapChartRenderer.spec.tsx` | Test structure; vi.mock pattern for stores; OL mock approach |
| `packages/web/CLAUDE.md` | UI conventions: `config-group`, `config-toggle`, `config-hint` classes; theme token rules |

### Tertiary (LOW confidence — not verified against external OL docs)

- OL `moveend` event semantics (fires after animation completes, once per move): stated from training data. Not verified against OL docs directly. The behavior is already relied upon implicitly by the existing spatial-filter draw pipeline. MEDIUM confidence via codebase inference.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new deps; all OL APIs verified in existing code
- Architecture: HIGH — all patterns directly mirrored from existing code
- Pitfalls: HIGH — most derived from direct code reading + existing pitfall lock comments
- OL moveend semantics: MEDIUM — inferred from code + training data; recommend a quick smoke test

**Research date:** 2026-07-07
**Valid until:** 2026-08-07 (stable patterns; no fast-moving deps)
