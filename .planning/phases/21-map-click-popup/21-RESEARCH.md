# Phase 21: map-click-popup - Research

**Researched:** 2026-05-08
**Domain:** OpenLayers Overlay, Zustand store consumption, sequential async fan-out, React-in-OL popup, HTML template rendering
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Popup positioning + container**
- Anchor: `ol/Overlay` positioned at the clicked `[lon, lat]` map coord. Popup follows pan/zoom.
- Map stays fully interactive while popup is open. New click always replaces (abort + reset + new fan-out).
- Edge flip: `positioning` changes dynamically when click pixel is near widget edge.
- Off-screen pan: clamp to nearest map edge with small arrow indicator. `autoPan: false` + manual Effect on `map.on("postrender")` or `map.getView().on("change")`.
- Z-index above OL controls (~1000+).
- Sticky header: layer dropdown (left) + close X (right). Mirrors `LayersModal` header pattern.
- Anchor offset ~12px + CSS triangle tail pointing toward click.
- Single dashboard-global popup. Second map click dismisses first.

**Multi-layer fetch concurrency**
- Sequential top-down, stop on first hit. No popup chrome during fan-out — only `cursor: progress` on widget.
- First-position layer in dropdown regardless of where first hit landed (z-order, ascending `position`).
- Re-click: per-click `AbortController`; new click aborts prior, calls `reset()`, fires fresh fan-out.
- WKB layers silently skipped before iteration starts; do not appear in dropdown.
- Per-layer error during fan-out: treat like empty, continue. All-errored: fire toast.

**Dropdown contents + lazy on-demand fetch**
- Dropdown lists all visible enabled non-WKB layers, hit-or-not (POPUP-V14-02 verbatim).
- Layer order = z-order from layers panel (ascending `position`), stable across session.
- On-demand single-layer fetch when user switches to a layer whose `state[layerId]` is undefined.
- Switching to already-fetched layer: no fetch — just `setActiveLayer(layerId)`. (In practice every switch triggers a fetch because `setActiveLayer(B)` wipes `state[A]`.)

**Loading + error UX**
- Pre-first-hit: `cursor: progress` on widget container. No popup chrome.
- All-empty toast: `"No records within click radius"`. Auto-dismisses ~3s.
- All-error toast: `"Failed to fetch info for {N} layer(s)"`.
- On-demand fetch: body replaces with centered spinner + "Loading…". Sticky header stays.
- Load-more: existing rows stay. Button shows spinner/disabled. New page appends below.
- Load-more failure: toast `"Failed to load more records"`. Button becomes "Retry".
- `hasMore: false`: "Load more" button hidden entirely.

**Dismiss interactions**
All paths converge on `useInfoSelectionStore.getState().reset()`:
1. Close button (X)
2. Escape key — `window.addEventListener("keydown")` for `e.key === "Escape"`, mirrors LayersModal:71-77
3. Click outside popup body — overlay onClick + `e.stopPropagation()` on popup body, mirrors LayersModal:168
4. New map click — abort + reset + new fan-out
5. Active layer leaves visible-enabled-non-WKB set — useEffect in InfoPopup watches `[activeLayerId, visibleEnabledNonWkbLayerIds]`
6. Lifecycle (logout, dashboard switch) — already wired by Phase 20-02; no additional coupling needed

Filter-bar interactions do NOT dismiss.

**Click handler short-circuit (POPUP-V14-06)**
- `getInfoEnabled(widgetConfig)` checked at registration time. `false` = listener never registered.
- Cleanup removes listener on `infoEnabled` flip; re-registers on flip back.

**Template rendering (POPUP-V14-04)**
- Shared helper: `kinetica_bi/src/lib/renderInfoTemplate.ts`. Phase 23 imports this same module.
- Proposed signature: `renderInfoTemplate({ template: string | null, columns: string[], row: Record<string, unknown> }): { mode: "template"; html: string } | { mode: "kv"; pairs: { col: string; value: unknown }[] }`
- Token syntax: `{column_name}` (Tableau/Grafana convention). Literal substitution only — no expressions, no escaping, no logic.
- No HTML sanitization — locked PROJECT.md Key Decision (dashboard authors are privileged users). Popup uses `dangerouslySetInnerHTML`.
- Key-value fallback: `<table>` of `(column, value)` pairs. Columns from `info_columns` JSON array (try/catch + fall back to all columns on parse error), or all columns when null.

**Click-to-radius pipeline**
- `mapBbox`: `mapRef.current.getView().calculateExtent(mapRef.current.getSize())` → `[minX, minY, maxX, maxY]` in EPSG:3857.
- `clickLon/clickLat`: `ol/proj.transform(event.coordinate, "EPSG:3857", "EPSG:4326")`.
- `mapWidthPx/mapHeightPx`: `containerRef.current.clientWidth/clientHeight`.

### Claude's Discretion
- Template token syntax (recommend `{column_name}`)
- Exact spinner CSS (reuse existing CSS-variable theme)
- Toast wording (within 'No records' / 'Failed to fetch' semantics)
- Popup width/max-width/max-height (360-480px width, 60vh height)
- Component file split between `InfoPopup.tsx` and click-handler logic in `MapChartRenderer.tsx`
- Spec test names and grouping
- Whether to introduce `InfoQueryAbortRef` ref pattern or use local `useRef` + `useCallback`
- Anchor-clamps-to-edge implementation details
- Whether cursor-loading state lives in component state or class on widget container

### Deferred Ideas (OUT OF SCOPE)
- Hover-on-map preview (out of v1.4)
- Aggregate views for heatmap/contour (AGG-V2-01)
- Cross-widget broadcast (XWIDGET-V2-01)
- URL/localStorage persistence (PERSIST-V2-01/02)
- Template token syntax bikeshedding (if authors push back, revisit post-v1.4)
- 'Showing X of ~Y' total-estimate badge
- Touch/mobile pan-zoom interactions
- Per-layer 'Check this layer' eager toggle
- Inline error banner inside popup body vs Toast for Load-more failure
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| POPUP-V14-01 | Click on map with info enabled → fan-out POST /api/info/query per visible enabled layer, popup opens at click point showing first-hit layer results | OL `singleclick` event, `ol/proj.transform` for coord conversion, sequential abort pattern, store `setLoading` + `setSelection` sequence |
| POPUP-V14-02 | Popup contains layer dropdown listing all visible enabled layers; switching layers fetches and displays results; page counter resets per STORE-V14-05 | Store `setActiveLayer` action (wipes prior layer entry, triggers re-fetch); dropdown must list all eligible layers regardless of hit status |
| POPUP-V14-03 | Records shown 50/page; "Load more" appends next page on demand; hidden when `hasMore: false` | Store `appendPage` action; `page` field in request body increments from current `state[layerId].page + 1` |
| POPUP-V14-04 | `info_template` HTML rendered per record; fallback to key-value table when no template | Shared `renderInfoTemplate.ts` helper with `{column_name}` substitution; `dangerouslySetInnerHTML` for template mode; `info_columns` JSON parse with fallback |
| POPUP-V14-05 | Close button or click outside → dismiss calls `useInfoSelectionStore.reset()` | ESC key + click-outside + close-button patterns from LayersModal; store `reset()` is the single convergence point |
| POPUP-V14-06 | `infoEnabled: false` on widget config fully disables OL click listener | `getInfoEnabled(widgetConfig)` at listener registration time; dependency array includes the flag so Effect cleanup re-runs on flip |
</phase_requirements>

---

## Summary

Phase 21 wires the three upstream deliverables (Phase 18 endpoint, Phase 19 config schema, Phase 20 store) into a user-visible feature: a map popup that appears when a user clicks an info-enabled map widget. The implementation is a frontend-only phase — no new backend routes or schema changes are needed.

The four code surfaces to create or extend are: (1) a new `useEffect` in `MapChartRenderer.tsx` that registers the OL `singleclick` handler gated on `getInfoEnabled`; (2) a new `InfoPopup.tsx` React component that reads `useInfoSelectionStore` and renders the anchored overlay; (3) a new `renderInfoTemplate.ts` pure helper shared with Phase 23; and (4) a new `infoQuery()` client helper in `client.ts`. No new Zustand stores, no new backend routes.

The critical complexity is the sequential fan-out abort pattern — it mirrors the existing `materializeAbortRef` in `AggregatedWidgetRenderer` and must correctly handle re-clicks, dropdown switches, and component unmount. The OL `ol/Overlay` API is the first use of that API in the codebase; the positioning, autoPan, and `setPosition(undefined)` (hide) patterns are well-documented and straightforward.

**Primary recommendation:** Split into 3 plans — (1) `renderInfoTemplate.ts` helper + spec (self-contained, no UI dependencies); (2) `infoQuery` client helper + `InfoPopup.tsx` component + CSS; (3) `MapChartRenderer.tsx` Effect wiring (click handler, fan-out, abort pattern, overlay mount). Plans can proceed in parallel after Plan 1.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `ol` (OpenLayers) | Already in project | `ol/Overlay` for geo-anchored popup | Already the codebase's map library; `ol/Overlay` is the native OL API for this use case |
| `zustand` | Already in project | `useInfoSelectionStore` consumer | Already the state management library; store shipped in Phase 20 |
| `react` | Already in project | `InfoPopup.tsx` component | All UI components are React in this codebase |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `ol/proj` (transform) | Part of `ol` package | Convert EPSG:3857 click coords to EPSG:4326 lon/lat | Every click handler invocation |

### Alternatives Considered
None — all libraries are already locked in this codebase. No new dependencies are needed for this phase.

**Installation:** No new packages. All dependencies are already in `kinetica_bi/package.json`.

---

## Architecture Patterns

### Recommended Project Structure

New and modified files this phase:

```
kinetica_bi/src/
├── lib/
│   └── renderInfoTemplate.ts         # new — pure helper, Phase 23 imports this
│   └── renderInfoTemplate.spec.ts    # new — spec colocated
├── api/
│   └── client.ts                     # extend — add infoQuery() helper
├── components/charts/
│   ├── InfoPopup.tsx                  # new — popup presentation component
│   ├── InfoPopup.spec.tsx             # new — popup render + interaction spec
│   └── MapChartRenderer.tsx          # extend — add Effect 5 (click handler + overlay)
└── styles/
    └── global.css                    # extend — add .info-popup-* classes
```

### Pattern 1: OL Overlay — Anchored Geo-Popup

**What:** `ol/Overlay` attaches a React-rendered DOM node to a map coordinate. Position is updated via `overlay.setPosition(coordinate)` and hidden via `overlay.setPosition(undefined)`.

**When to use:** Any map UI that must stay anchored to a geographic point while pan/zoom occurs.

**Example (from official OL docs):**
```typescript
// Source: https://openlayers.org/en/latest/apidoc/module-ol_Overlay-Overlay.html
import Overlay from "ol/Overlay";

const overlay = new Overlay({
  element: popupDomRef.current,   // React ref to the popup container div
  autoPan: false,                 // We do manual viewport-bounds clamping instead
  positioning: "bottom-left",     // Flips dynamically based on click proximity to widget edge
  offset: [12, -12],              // ~12px clearance from click pixel
});

map.addOverlay(overlay);

// On singleclick — set position to show
overlay.setPosition(event.coordinate);  // EPSG:3857 coordinate from OL event

// On dismiss — set position to hide (does NOT remove the overlay from the DOM)
overlay.setPosition(undefined);
```

**Key behavior verified from OL docs:**
- `setPosition(undefined)` hides the overlay without removing it from the map — correct pattern for toggle show/hide.
- `autoPan: false` disables OL's built-in auto-pan; we use a manual `postrender` effect for edge-clamping.
- `positioning` controls which corner of the element aligns with the anchor coordinate. Dynamic flip is ~10 lines of click-pixel-vs-container-bounds math.
- The overlay element must be a DOM node that exists BEFORE `map.addOverlay()` is called — use a `useRef` whose `.current` is the rendered popup container div.

### Pattern 2: Sequential Fan-Out with AbortController

**What:** For each eligible layer in z-order, fire `POST /api/info/query`. On first non-empty response, open the popup and stop. Abort on re-click.

**When to use:** This is the locked Phase 21 concurrency model. Always sequential — never `Promise.all`.

```typescript
// Source: mirrors materializeAbortRef from AggregatedWidgetRenderer.tsx (V13-P-10 lock)
const infoQueryAbortRef = useRef<AbortController | null>(null);

// In singleclick handler:
infoQueryAbortRef.current?.abort();
infoQueryAbortRef.current = new AbortController();
const signal = infoQueryAbortRef.current.signal;

useInfoSelectionStore.getState().reset();

// Sequential iteration
for (const layer of eligibleLayers) {
  if (signal.aborted) break;
  try {
    const result = await infoQuery({ ...payload, layerId: layer.id }, signal);
    if (result.rows.length > 0) {
      useInfoSelectionStore.getState().setSelection(layer.id, result);
      useInfoSelectionStore.getState().setActiveLayer(layer.id);
      overlay.setPosition(event.coordinate);
      break; // stop on first hit
    }
  } catch (err) {
    if (signal.aborted) break;
    // treat per-layer error as empty — continue to next layer
  }
}
```

### Pattern 3: useInfoSelectionStore Consumer (Scoped Selector)

**What:** Subscribe to `state[activeLayerId]` only — never the whole `state` object — to avoid fan-out re-renders.

```typescript
// PITFALL S-02 lock: never s.state (whole object)
const activeLayerId = useInfoSelectionStore((s) => s.activeLayerId);
const entry = useInfoSelectionStore(
  (s) => (s.activeLayerId !== null ? s.state[s.activeLayerId] : null)
);
```

### Pattern 4: renderInfoTemplate — Pure Discriminated Union

**What:** Pure function, no React import. Returns a discriminated union so the caller decides the render path.

```typescript
// Source: kinetica_bi/src/lib/renderInfoTemplate.ts (to be created)
type RenderResult =
  | { mode: "template"; html: string }
  | { mode: "kv"; pairs: { col: string; value: unknown }[] };

export function renderInfoTemplate(opts: {
  template: string | null;
  columns: string[];
  row: Record<string, unknown>;
  infoColumns?: string | null; // raw JSON array string from DashboardLayerDto
}): RenderResult {
  if (opts.template) {
    const html = opts.template.replace(/\{(\w+)\}/g, (_, col) =>
      String(opts.row[col] ?? "")
    );
    // NOTE: No sanitization — locked by PROJECT.md Key Decision:
    // "Dashboard authors are privileged users (analogous to saved SQL queries)."
    return { mode: "template", html };
  }
  // Key-value fallback: resolve columns from info_columns or all response columns
  let cols = opts.columns;
  if (opts.infoColumns) {
    try {
      const parsed = JSON.parse(opts.infoColumns) as string[];
      if (Array.isArray(parsed) && parsed.length > 0) cols = parsed;
    } catch {
      // parse error → fall back to all columns
    }
  }
  return {
    mode: "kv",
    pairs: cols.map((col) => ({ col, value: opts.row[col] })),
  };
}
```

### Pattern 5: infoQuery Client Helper

**What:** Mirrors `materializeFilter` at `client.ts:585-599`. POST to `/api/info/query`.

```typescript
// Source: mirrors materializeFilter pattern at kinetica_bi/src/api/client.ts:585-599
export type InfoQueryRequest = {
  layerId: number;
  tableId: number;
  schema: string;
  table: string;
  spatialMode: SpatialMode;
  spatialColumns: SpatialColumns;
  clickLon: number;
  clickLat: number;
  radiusPx: number;
  mapBbox: [number, number, number, number];
  mapWidthPx: number;
  mapHeightPx: number;
  page: number;
};

export type InfoQueryResponse = {
  rows: Record<string, unknown>[];
  columns: string[];
  hasMore: boolean;
  page: number;
};

export const infoQuery = async (
  args: InfoQueryRequest,
  signal?: AbortSignal
): Promise<InfoQueryResponse> => {
  const response = await apiFetch(`${API_BASE}/api/info/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args),
    signal,
  });
  if (!response.ok) {
    await throwForStatus(response, "Failed to fetch info records");
  }
  return response.json() as Promise<InfoQueryResponse>;
};
```

### Pattern 6: ESC Key + Click-Outside Dismiss

**What:** Exact mirror of `LayersModal.tsx` lines 71-77 (ESC) and line 168 (click-outside).

```typescript
// Mirrors LayersModal.tsx:71-77
useEffect(() => {
  if (!isOpen) return;
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") onClose();
  };
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}, [isOpen, onClose]);

// Click-outside: overlay div (the transparent full-widget backdrop) calls onClose().
// popup body calls e.stopPropagation() so inner clicks don't bubble.
```

### Pattern 7: Kill-Switch Effect Registration

**What:** `infoEnabled` gates the `singleclick` listener. Effect re-runs when the flag flips.

```typescript
// In MapChartRenderer — Effect 5 (new)
useEffect(() => {
  const map = mapRef.current;
  if (!map) return;
  if (!getInfoEnabled(widgetConfig as MapWidgetConfig)) return; // kill switch

  const handler = (event: MapBrowserEvent<UIEvent>) => { /* fan-out logic */ };
  map.on("singleclick", handler);
  return () => map.un("singleclick", handler);
}, [getInfoEnabled(widgetConfig as MapWidgetConfig), eligibleLayers, /* mapRef is stable */]);
```

### Anti-Patterns to Avoid

- **Whole-state selector:** NEVER `useInfoSelectionStore((s) => s.state)` — scope to `s.state[activeLayerId]`.
- **Call `setActiveLayer(null)` on dismiss:** The action signature is `setActiveLayer(layerId: number)` — no null path. Call `reset()`.
- **Import from `useFilterViewStore` inside InfoPopup:** Info queries read source table directly, NOT filter views.
- **Sanitize `info_template`:** Locked no-sanitize decision. Add inline comment citing PROJECT.md.
- **`Promise.all` fan-out:** Locked sequential-stop-on-first-hit. Never parallel.
- **View-of-views:** Never pass `viewName` from `useFilterViewStore` to `infoQuery` payload.
- **OL `autoPan: true`:** Conflicts with manual edge-clamping. Use `autoPan: false`.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Geo-anchored overlay | Custom CSS absolute positioning relative to click pixel | `ol/Overlay` with `setPosition(coordinate)` | OL handles pan/zoom tracking automatically; hand-rolled pixel positioning requires re-computing on every `postrender` event |
| AbortController per-click | Custom cancel flag (`isCanceled = true`) | `AbortController` + `signal.aborted` check | Native fetch cancellation; mirrors the exact `materializeAbortRef` pattern already in the codebase (V13-P-10 lock) |
| Toast display | Custom toast component | `useToastStore.getState().showToast(message, "error")` | Existing `Toast.tsx` component + `useToastStore`; already de-duplicates within 5s window |
| HTML template substitution | Handlebars, mustache, template literals with `eval` | Tiny regex `{column_name}` replacement in `renderInfoTemplate.ts` | The locked template syntax is intentionally simple; no library overhead needed |
| Store wiring for lifecycle | Custom event emitters | `useInfoSelectionStore.getState().reset()` | Already wired into App.tsx and DashboardsPage by Phase 20-02 |

**Key insight:** All infrastructure is in place from Phases 18-20. This phase is integration — connecting dots, not building primitives.

---

## Common Pitfalls

### Pitfall 1: OL Overlay element not yet in DOM at `map.addOverlay()` time
**What goes wrong:** `overlay.setPosition()` silently does nothing because the element ref is null.
**Why it happens:** Effect fires before React renders the popup div into the DOM.
**How to avoid:** Render the popup div unconditionally in the MapChartRenderer JSX (even when not "open"), attach a `ref` to it, and pass `ref.current` to `new Overlay({ element: ref.current })`. The popup is hidden by CSS (or `setPosition(undefined)`) rather than by conditional rendering.
**Warning signs:** Popup never appears despite store state changing; `overlay.getElement()` returns `null`.

### Pitfall 2: Stale async mutation after layer switch
**What goes wrong:** Fan-out for layer A is in-flight. User switches dropdown to layer B. Layer A's response arrives after `setActiveLayer(B)` has wiped `state[A]`. The `setSelection(A, ...)` call re-creates A's deleted entry.
**Why it happens:** `setActiveLayer(B)` deletes `state[A]` synchronously, but the in-flight promise for A continues.
**How to avoid:** The `AbortController` approach — abort on dropdown switch so the layer-A promise rejects before executing `setSelection`. Mirror the v1.3 `clearMaterializingVersion` guard pattern.
**Warning signs:** Switching layers causes unexpected re-population of the previous layer's entry.

### Pitfall 3: `setActiveLayer(null)` TypeError at runtime
**What goes wrong:** Code calls `setActiveLayer(null)` to "clear" the popup instead of calling `reset()`.
**Why it happens:** `setActiveLayer` has signature `(layerId: number)` — the TypeScript type forbids null, but a typecast or `as any` can bypass it.
**How to avoid:** POPUP-V14-05 dismiss MUST call `reset()`. Never `setActiveLayer(null)`. The type enforces this at compile time if the cast is not used.
**Warning signs:** TypeScript errors or runtime crash on dismiss.

### Pitfall 4: `EPSG:3857` click coordinates sent directly to server
**What goes wrong:** Server receives ~X million / Y million as `clickLon/clickLat` instead of geographic degrees. Kinetica's `GEODIST`/`STXY_DISTANCE` returns zero results or wrong results.
**Why it happens:** OL `singleclick` provides `event.coordinate` in the map's projection (EPSG:3857). Not converted before sending.
**How to avoid:** Always `ol/proj.transform(event.coordinate, "EPSG:3857", "EPSG:4326")` before building the request payload. PITFALL M-03 lock.
**Warning signs:** All info queries return 0 results despite data clearly being visible in WMS tiles.

### Pitfall 5: Subscribe to whole `dashboardLayersStore.layers` in InfoPopup
**What goes wrong:** Every auto-save patch (e.g., opacity slider, color picker) fires a popup re-render even though popup content is unchanged.
**Why it happens:** `useDashboardLayersStore((s) => s.layers)` subscribes to the full array reference, which changes identity on every `setLayers` call.
**How to avoid:** Derive the eligible-layers list in `MapChartRenderer` (where `includedLayers` already exists as a memoized value) and pass it as a prop to `InfoPopup`. Popup stays a pure presentation component.
**Warning signs:** Popup flickers on every opacity/color/position change in the layers panel.

### Pitfall 6: Registering singleclick before mapRef.current is set
**What goes wrong:** Effect fires immediately on mount before Effect 1 (map construction) has run. `mapRef.current` is null.
**Why it happens:** React's effect ordering is not guaranteed across sibling effects in all edge cases. The M-01 guard in Effect 1 also means Effect 1 may be a no-op on the second StrictMode invocation.
**How to avoid:** Effect 5 must check `if (!mapRef.current) return;` as its first guard, exactly like Effects 2-4. In StrictMode, the map is only constructed in Effect 1's first invocation; the second invocation returns early. Effect 5 must handle the null case.
**Warning signs:** `Cannot read property 'on' of null` during StrictMode dev builds.

### Pitfall 7: WKB-layer error surfaced to user
**What goes wrong:** WKB layers are NOT excluded from the fan-out, so `POST /api/info/query` with `spatialMode='wkb'` returns HTTP 501. This 501 gets shown as an error toast on every click.
**Why it happens:** Forgetting the pre-iteration WKB filter step.
**How to avoid:** Filter out layers whose `(layer.config as MapWidgetConfig).spatialMode === "wkb"` BEFORE the sequential fan-out loop begins. These layers also must not appear in the dropdown. The 501 is never user-surfaceable — TD-V14-WKB-SPIKE-as-feature.
**Warning signs:** Clicks on maps with WKB layers always show "Failed to fetch" toast.

---

## Code Examples

### ol/Overlay mounting in a React useEffect

```typescript
// Source: Official OL docs https://openlayers.org/en/latest/apidoc/module-ol_Overlay-Overlay.html
// Combined with React ref pattern
import Overlay from "ol/Overlay";

// In MapChartRenderer:
const popupContainerRef = useRef<HTMLDivElement>(null);
const overlayRef = useRef<Overlay | null>(null);

// In Effect 1 cleanup or a new Effect after map is ready:
useEffect(() => {
  const map = mapRef.current;
  if (!map || !popupContainerRef.current) return;
  const overlay = new Overlay({
    element: popupContainerRef.current,
    autoPan: false,           // manual edge-clamping instead
    positioning: "bottom-left",
    offset: [0, -8],          // clearance above click pixel
  });
  map.addOverlay(overlay);
  overlayRef.current = overlay;
  return () => {
    map.removeOverlay(overlay);
    overlayRef.current = null;
  };
}, []); // empty deps — runs once after map is ready (Effect 1 must run first)
```

### Coordinate conversion for click payload

```typescript
// Source: locked M-03 pattern from MapChartRenderer.tsx
import { transform } from "ol/proj";

// Inside singleclick handler:
const [clickLon, clickLat] = transform(
  event.coordinate,
  "EPSG:3857",
  "EPSG:4326"
) as [number, number];

const mapBbox = mapRef.current
  .getView()
  .calculateExtent(mapRef.current.getSize()) as [number, number, number, number];
const [mapWidthPx, mapHeightPx] = mapRef.current.getSize() as [number, number];
const radiusPx = getInfoRadiusPx(widgetConfig as MapWidgetConfig);
```

### Eligible layers derivation

```typescript
// Derive the eligible-layer list for fan-out and dropdown
// (extends existing includedLayers computation in MapChartRenderer)
const eligibleLayers = useMemo(() => {
  return includedLayers.filter((layer) => {
    const cfg = layer.config as Record<string, unknown>;
    // Filter out WKB layers (TD-V14-WKB-SPIKE — endpoint returns 501)
    if ((cfg as MapWidgetConfig).spatialMode === "wkb") return false;
    // Filter out layers with info_enabled = 0
    if (layer.info_enabled === 0) return false;
    return true;
  });
}, [includedLayers]);
```

### InfoPopup component sketch

```typescript
// kinetica_bi/src/components/charts/InfoPopup.tsx
// Presentation component — reads store, emits callbacks
type InfoPopupProps = {
  eligibleLayers: DashboardLayerDto[];
  onClose: () => void;
  onLayerSwitch: (layerId: number) => void;
  onLoadMore: () => void;
};

export default function InfoPopup({ eligibleLayers, onClose, onLayerSwitch, onLoadMore }: InfoPopupProps) {
  const activeLayerId = useInfoSelectionStore((s) => s.activeLayerId);
  const entry = useInfoSelectionStore(
    (s) => s.activeLayerId !== null ? s.state[s.activeLayerId] : null
  );
  const activeLayer = eligibleLayers.find((l) => l.id === activeLayerId) ?? null;

  // ESC key dismiss — mirrors LayersModal:71-77
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Active layer leaves eligible set → auto-dismiss
  const eligibleIds = useMemo(() => new Set(eligibleLayers.map((l) => l.id)), [eligibleLayers]);
  useEffect(() => {
    if (activeLayerId !== null && !eligibleIds.has(activeLayerId)) {
      onClose();
    }
  }, [activeLayerId, eligibleIds, onClose]);

  if (activeLayerId === null) return null;

  return (
    <div className="info-popup" onClick={(e) => e.stopPropagation()}>
      <div className="info-popup-header">
        <select value={activeLayerId} onChange={(e) => onLayerSwitch(Number(e.target.value))}>
          {eligibleLayers.map((l) => (
            <option key={l.id} value={l.id}>{/* layer display name */}</option>
          ))}
        </select>
        <button onClick={onClose} aria-label="Close">×</button>
      </div>
      <div className="info-popup-body">
        {/* entry.loading: spinner; entry.rows: records; entry.error: error state */}
      </div>
      {entry?.hasMore && (
        <div className="info-popup-footer">
          <button onClick={onLoadMore}>Load more</button>
        </div>
      )}
    </div>
  );
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Client-side radius math | Server-side `pxToGroundDistance`/`pxToGroundDegrees` | Phase 18 lock | Client just passes `radiusPx + mapBbox + mapWidthPx + mapHeightPx`; no trig on frontend |
| WKB spatial queries | 501 deferred (TD-V14-WKB-SPIKE) | Phase 18 lock | Phase 21 must skip WKB layers in fan-out; behavior reverts automatically when WKB lands |
| No `ol/Overlay` usage | First use in codebase | Phase 21 (this phase) | Establishes the pattern for hover/tooltip future work |
| No `dangerouslySetInnerHTML` | First use in codebase | Phase 21 (this phase) | Must include inline comment citing PROJECT.md Key Decision |

---

## Open Questions

1. **Overlay timing relative to map construction**
   - What we know: Effect 1 constructs the OL Map; subsequent Effects read `mapRef.current`. The Overlay needs the map instance to call `map.addOverlay(overlay)`.
   - What's unclear: Whether `ol/Overlay` can be created before the map and added to it later, or if it must be created after `mapRef.current` is set.
   - Recommendation: Create Overlay inside a dedicated `useEffect` that has `mapRef.current` as a dependency (or guards with `if (!mapRef.current) return`). OL's `addOverlay` is called imperatively after map construction. Clean up with `map.removeOverlay(overlay)` on unmount.

2. **`positioning` dynamic flip calculation**
   - What we know: CONTEXT.md specifies ~10 lines of pixel-bounds math against widget container size + click pixel.
   - What's unclear: Exact pixel thresholds (e.g., when within 300px of right edge, flip to `bottom-right`).
   - Recommendation: Claude's discretion. Use 30% of widget dimension as threshold. Compute at click time, before calling `overlay.setPosition()`.

3. **`spatialColumns` type in the client helper**
   - What we know: Server accepts `spatialColumns` as `{ lonCol, latCol }` for latlon or `{ wktCol }` for wkt. Type `SpatialColumns` is defined in `server/src/spatialQuery.ts`.
   - What's unclear: Whether a frontend-side `SpatialColumns` type already exists or needs to be defined in `client.ts`.
   - Recommendation: Define the union type directly in `client.ts` alongside `InfoQueryRequest` rather than importing from the server module (mirrors the `ActiveFilter` precedent at `client.ts:575-577`).

---

## Sources

### Primary (HIGH confidence)
- `kinetica_bi/src/store/infoSelectionStore.ts` — Full store contract: 7 actions, type shapes, invariants (read directly)
- `kinetica_bi/src/components/charts/MapChartRenderer.tsx` — Existing Effect patterns, OL map ref, `includedLayers` derivation (read directly)
- `kinetica_bi/src/components/LayersModal.tsx` — ESC key pattern (lines 71-77), click-outside pattern (line 168) (read directly)
- `kinetica_bi/src/api/client.ts:585-627` — `materializeFilter` / `dropFilterView` POST helper pattern (read directly)
- `kinetica_bi/src/lib/mapInfoConfig.ts` — `getInfoEnabled` / `getInfoRadiusPx` getters (read directly)
- `kinetica_bi/server/src/index.ts:753-944` — `POST /api/info/query` endpoint contract, request/response shapes (read directly)
- `kinetica_bi/src/components/Toast.tsx` + `kinetica_bi/src/store/toast.ts` — Toast API: `useToastStore.getState().showToast(message, "error")`, 5s auto-dismiss, 5s dedup window (read directly)
- `kinetica_bi/__mocks__/zustand.ts` — Zustand reset shim: covers new store consumers automatically (read directly)
- Official OL Overlay docs (https://openlayers.org/en/latest/apidoc/module-ol_Overlay-Overlay.html) — `positioning` options, `autoPan`, `setPosition(undefined)` to hide (fetched)
- Official OL popup example (https://openlayers.org/en/latest/examples/popup.html) — canonical click-to-popup pattern (fetched)

### Secondary (MEDIUM confidence)
- `.planning/phases/21-map-click-popup/21-CONTEXT.md` — Locked decisions from user design session
- `.planning/STATE.md` — Key v1.4 architecture decisions record

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries already in use; no new dependencies
- Architecture patterns: HIGH — OL Overlay API verified from official docs; store contract read directly from source; fan-out pattern mirrors existing codebase pattern
- Pitfalls: HIGH — derived from existing codebase pitfall locks + OL API verification
- renderInfoTemplate: HIGH — pure function, well-understood `{column_name}` substitution pattern

**Research date:** 2026-05-08
**Valid until:** 2026-08-08 (stable — OL API, React patterns, and Zustand are all established; no fast-moving dependencies)
