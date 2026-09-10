# Phase 15: chart-filtering — Research

**Researched:** 2026-05-06
**Domain:** Frontend SQL FROM-swap consumer wiring + Zustand cross-store coordination + lifecycle hook extension + atomic dead-code deletion
**Confidence:** HIGH (all primitives exist in-repo; Phase 13 + Phase 14 outputs verified by direct file reads)

## Summary

Phase 15 is the activation phase that flips Phase 13's `/api/filter/materialize` endpoint and Phase 14's `useFilterViewStore` + `materializeFilter` / `dropFilterView` helpers into production use. There is **zero new dependency**, **zero stack delta**, and **zero new test infrastructure** required. The phase is consumer-side only: every change is locality-scoped to ~6 existing files and 2 new files. Five fine-grained user-locked plans (15-01 → 15-05) sequence the work so every commit ships green (`tsc --noEmit` clean + full vitest green).

The phase's defining technical risk is **NOT** the FROM-swap regex (Phase 9's `injectWhereClause` already established the predictable-SQL-shape pattern), nor the trigger debounce (LayersModal already does 300ms), nor the AbortController separation (locked at the helper signature in Phase 14). The defining risk is the **atomic dead-code deletion (FILT-V13-05) — `MapChartRenderer.tsx` lines 316 and 414 call `buildWhereClause` and Phase 16 owns the LAYERS-swap migration**. This means the four utility functions cannot be deleted in plan 15-02 without first migrating MapChartRenderer's two callsites and the wmsUrlBuilder spec block at lines 470-492. **The CONTEXT.md's "atomic deletion in 15-02" lock is at risk** — see § Critical Pitfalls below for the planner-actionable resolution.

**Primary recommendation:** Frontload the MapChartRenderer + wmsUrlBuilder.spec callsite analysis at the very top of plan 15-02. Either (a) keep the four utilities exported but mark deprecated until Phase 16 completes the map LAYERS-swap, OR (b) migrate MapChartRenderer's two callsites to a no-op stub atomically with 15-02 so Phase 16 has a clean greenfield. Option (a) violates the "atomic with FROM-swap" lock; option (b) expands 15-02's scope. Planner picks; recommend option (b) with an explicit comment that Phase 16's MAP-V13-03 cleanup will remove the stubs.

## User Constraints (from CONTEXT.md)

### Locked Decisions

**Plan staging (5 fine-grained plans, each ships green):**
- **15-01** — `DashboardContext` + `dashboardId` plumbing. New file `kinetica_bi/src/components/DashboardContext.tsx`. Provider value `{ dashboardId: number }` only. `useDashboardContext()` THROWS on missing context (fail-loud). Mount in `DashboardOpen`, wrapping the widget grid.
- **15-02** — `AggregatedWidgetRenderer` materialize trigger + FROM-swap + "Filtering..." badge + atomic dead-code deletion (FILT-V13-01, FILT-V13-03, FILT-V13-04, FILT-V13-05).
- **15-03** — `RecordsTableRenderer` FROM-swap + badge (FILT-V13-02). PURE consumer — no materialize trigger here.
- **15-04** — TTL recovery (proactive `expiresAt` check + reactive `isViewNotFoundError` retry) (LIFE-V13-01, LIFE-V13-02).
- **15-05** — Lifecycle reset extensions (`App.tsx:40-44` logout + `DashboardsPage.tsx:379-383` dashboard-switch) (LIFE-V13-03, LIFE-V13-04, LIFE-V13-05).
- Each plan must leave `tsc --noEmit` clean and full vitest suite green — every commit is a deployable state.

**`AggregatedWidgetRenderer` is the SOLE materialize trigger** (VSTORE-V13-02 + FILT-V13 lock):
- Debounced 300ms `useEffect` on `[sql, filterVersion]`.
- Sequence: `markMaterializing → await materializeFilter(args, signal) → setView` (or `dropFilterView → clearView` on empty filters).
- Dedicated `materializeAbortRef` separate from the chart-query `AbortController` (V13-P-10 lock).
- `RecordsTableRenderer` and `MapChartRenderer` are PURE CONSUMERS — they NEVER trigger materialize.

**FROM-swap on chart SQL** (FILT-V13-01, FILT-V13-02, FILT-V13-03):
- Read `viewName` via scoped selector: `useFilterViewStore((s) => s.views[tableId]?.viewName)` (PITFALL C-02 lock).
- If `viewName` truthy: regex/string-scan replace `FROM <table>` → `FROM <viewName>` (Phase 9 `injectWhereClause`-style — no full SQL parse).
- If `viewName` falsy: query raw table SQL unchanged (zero materialize overhead on cold loads).
- Helper extracted to `src/lib/fromSwap.ts` OR kept inline (planner picks).

**Atomic dead-code deletion** (FILT-V13-05 — user-locked: same commit as FROM-swap landing in 15-02):
- Remove `injectWhereClause`, `buildWhereClause`, `escapeKineticaStringLiteral`, `buildEqualityFilter` from `kinetica_bi/src/store/filterStore.ts`.
- Remove corresponding test blocks from `kinetica_bi/src/store/filterStore.spec.ts`.
- Remove imports from `WidgetRenderer.tsx:24-29`.
- `tsc --noEmit` MUST be clean post-15-02.

**"Filtering..." badge UX** (FILT-V13-04 — user-locked):
| Decision | Choice |
|----------|--------|
| Position | Inline next to widget title in existing card header chrome |
| Visual | Text + spinner icon (small inline spinner glyph + "Filtering..." text) |
| Threshold | None — show always; sub-100ms flicker is acceptable |
| Scope | Every widget on the filtered tableId; each independently subscribes to `useFilterViewStore.views[tableId]?.materializing` |
| Layering | Existing chart data visible underneath; existing `loading` state covers the post-materialize chart-query phase |
| Aria / a11y | Claude's Discretion — recommend `aria-busy` on widget card during materializing |

**`DashboardContext` plumbing** (user-locked):
- File: `kinetica_bi/src/components/DashboardContext.tsx`.
- Shape: `{ dashboardId: number }` only — NOT full `DashboardDto`, NOT a list of associated tableIds, NOT a drop helper.
- Mount: inside `DashboardOpen` (in `DashboardsPage.tsx`), wrapping the widget grid.
- Missing-context behavior: `useDashboardContext()` THROWS — fail-loud.
- Phase 15 consumer: `AggregatedWidgetRenderer` only. `RecordsTableRenderer` does NOT need it (pure consumer — never calls materialize).

**Dual-path TTL expiry recovery** (LIFE-V13-01/02):
- **Proactive:** before each chart query, check `Date.now() >= useFilterViewStore.views[tableId]?.expiresAt`. If expired, `clearView(tableId)` then trigger materialize re-run silently.
- **Reactive:** chart-query `.catch()` detects `isViewNotFoundError(err)` (matches `/SqlEngine: Object '[^']+' not found/i` substring + Kinetica internal code `S/SDc:1513` at HTTP 400, per Phase 13 spike S3 capture) → `clearView(tableId)` → re-materialize → retry chart query ONCE.
- Max 1 reactive retry. If retry's chart query also returns view-not-found → fall through to raw `FROM <table>`. If retry's materialize fails (PermissionError/UpstreamError) → toast + fall through.

**Lifecycle reset extensions** (LIFE-V13-03/04):
- `App.tsx:40-44` logout effect — extend to fire `useFilterViewStore.reset()` AND fire-and-forget `dropFilterView` for each active view.
- `DashboardsPage.tsx:379-383` dashboard-switch cleanup — extend identically.
- Page-refresh / tab-close (LIFE-V13-05) — no client work; Kinetica TTL is sole cleanup.

**Toast on materialize failure** (Phase 14 user-lock — "toast every failure"):
- `PermissionError` (403) → `useToastStore.getState().showToast(err.message, "error")`.
- `UpstreamError` (502) / generic `Error` → same toast pattern.
- `AbortError` → silent (matches Phase 9 `WidgetRenderer.tsx:243` lock).
- On any non-abort failure: do NOT call `setView()` — leaves entry empty (or `materializing: false` if `markMaterializing` ran) so chart query falls through to raw `FROM <table>`.

**Plan ordering** (user-locked): 15-01 → 15-02 → 15-03 → 15-04 → 15-05.

### Claude's Discretion

- Exact CSS classes / spinner glyph for "Filtering..." badge (target: matches existing widget chrome; no existing spinner CSS — see § Code Examples for unicode-spinner sketch).
- Whether `fromSwap` regex helper extracted to `src/lib/fromSwap.ts` or kept inline in `WidgetRenderer.tsx`.
- Whether `isViewNotFoundError` lives in `src/lib/kineticaErrors.ts` (new file), `src/api/client.ts` (existing typed-error neighborhood), or co-located in `WidgetRenderer.tsx`.
- Test-spec file count and split (one big `WidgetRenderer.spec.tsx` extension vs split files).
- Whether `FilterViewEntry` extension to carry `dashboardId` happens in 15-02 (recommended) or 15-05.
- Whether badge component is `<FilteringBadge tableId={n} />` or inline JSX in each renderer's card-header block.
- Whether to add `aria-busy={materializing}` on the widget card root element.
- Exact retry semantics for reactive recovery: 1 retry locked; planner decides whether retry path also re-fires `markMaterializing` (recommend yes, for badge consistency).
- Whether the proactive `Date.now() >= expiresAt` check uses a small helper (`isViewExpired(entry)`) or inline arithmetic.

### Deferred Ideas (OUT OF SCOPE)

- Map widget LAYERS-swap (`MAP-V13-01..06`) → Phase 16
- `wmsUrlBuilder.ts` `QUERY` / `FILTER_PARAM` removal + `_v` → `_mv` rename (`MAP-V13-03`) → Phase 16
- `MapChartRenderer` Effect 3 dep-array swap to `viewsKey` (`MAP-V13-04`) → Phase 16
- End-to-end verification + low-cardinality test fixture (`VERIFY-V13-01..02`) → Phase 17
- OIDC-mode S2.b live DDL re-probe → Phase 17 verification (deferred from STATE.md Phase 15 tag)
- `useFilterStore` modifications — VSTORE-V13-03 lock holds (chip state byte-unchanged)
- Map-renderer materialize triggering — only `AggregatedWidgetRenderer` triggers materialize (prevents 2N redundant DDL)
- Once-per-session toast suppression flag → Phase 17 follow-up
- `bumpMaterializeVersion` callers in `MapChartRenderer` → Phase 16
- Records-table-only dashboard with no AggregatedWidgetRenderer on the same tableId → known limitation, addressed only if Phase 17 verification surfaces it
- Recovery failure UX beyond max-1-retry → Phase 15 falls through to raw table; revisit in v1.3 verification if confusing
- Replace-page-refresh cleanup — LIFE-V13-05 locks "no client cleanup"; Phase 15 explicitly does no work

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| FILT-V13-01 | Click any chart element → debounced materialize → `AggregatedWidgetRenderer` substitutes `FROM <table>` with `FROM <view>` and re-runs. | `WidgetRenderer.tsx:198-253` is the AggregatedWidgetRenderer; `runSql` at `client.ts:128-145` already takes `signal?`; Phase 14's `materializeFilter`/`dropFilterView` at `client.ts:570-612` ready; `useFilterViewStore` at `filterViewStore.ts:42-98` ready. FROM-swap pattern mirrors Phase 9's `injectWhereClause` (predictable SQL-shape regex; no full parser). |
| FILT-V13-02 | `RecordsTableRenderer` (second SQL consumer that bypasses `AggregatedWidgetRenderer`) wired with same FROM-swap pattern; subscribes to `useFilterViewStore.views[tableId]`. | `RecordsTableRenderer` at `WidgetRenderer.tsx:852-1068`. SQL composition at `WidgetRenderer.tsx:915` (`SELECT ${colsClause} FROM ${table}…`) and `WidgetRenderer.tsx:937` (COUNT). Both must swap `${table}` → `${viewName ?? table}`. |
| FILT-V13-03 | When no filters active, widgets query raw table — zero materialize round-trips on cold loads. | `tableFilters.length === 0` short-circuit branch in materialize trigger; FROM-swap reads `viewName` which is undefined when no entry exists in `useFilterViewStore.views[tableId]` → falls through to raw `${table}`. |
| FILT-V13-04 | Per-widget "filtering..." badge during materialize phase; existing chart data visible underneath; two visual phases (materializing, then loading). | Badge renders when `useFilterViewStore.views[tableId]?.materializing === true`; existing `loading` state at `WidgetRenderer.tsx:200, 263-269` covers the post-materialize chart-query phase. Badge in card header next to `widget-title` span at `DashboardsPage.tsx:736`. No existing spinner CSS — planner adds (or uses unicode `⟳` / `⏳`). |
| FILT-V13-05 | Atomic dead-code deletion: `injectWhereClause`, `buildWhereClause`, `escapeKineticaStringLiteral`, `buildEqualityFilter` removed; spec blocks deleted; `tsc --noEmit` clean. | **CRITICAL: `MapChartRenderer.tsx:316, 414` still uses `buildWhereClause`.** `wmsUrlBuilder.spec.ts:471-492` (FILT-04 block) tests QUERY emission. See § Critical Pitfalls Pitfall 1. |
| LIFE-V13-01 | Proactive TTL expiry — `Date.now() >= expiresAt` check; clear stored view; re-materialize silently before chart query. | `expiresAt` field already on `FilterViewEntry` (`filterViewStore.ts:28`); check site = chart-query effect at `WidgetRenderer.tsx:224-253` and `RecordsTableRenderer` at `WidgetRenderer.tsx:900-929`. |
| LIFE-V13-02 | Reactive TTL expiry — `.catch()` detects view-not-found error → clearView → re-materialize → retry chart query. | Pattern locked: `/SqlEngine: Object '[^']+' not found/i` + `S/SDc:1513` substring + HTTP 400 (Phase 13 spike S3 capture; STATE.md lock). Catch path is in chart-query effect; `runSql` throws via `throwForStatus` at `client.ts:63-79` mapping HTTP 400 to generic `Error` (not a typed class) — must inspect `err.message`. |
| LIFE-V13-03 | Logout reset — `App.tsx` `useEffect([status])` extended to call `useFilterViewStore.reset()` + fire-and-forget DROPs. | `App.tsx:40-44` is the existing site. Three sites today call `useFilterStore.getState().reset()`: `App.tsx:42`, `DashboardsPage.tsx:381`, `filterStore.spec.ts:155`. |
| LIFE-V13-04 | Dashboard-switch reset — `DashboardsPage.tsx` `useEffect([dashboard.id])` cleanup extended identically. | `DashboardsPage.tsx:379-383` — cleanup return inside `useEffect`. dashboardId is in scope (`dashboard.id`). |
| LIFE-V13-05 | Page-refresh / tab-close — no explicit client cleanup; Kinetica TTL handles orphans. | Server-side `USING TABLE PROPERTIES (TTL = 5)` (5-min sliding) per `server/src/index.ts:702`. No code change needed; plan acknowledges. |

## Standard Stack

### Core (zero new dependencies — entire Phase 15 stack is fully present in repo)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| zustand | ^4.5.2 | `useFilterViewStore` consumer subscription, `useFilterStore` chip state | Already used by 5 stores in `src/store/`; reset shim wired |
| react | ^18.x | `useEffect`, `useRef` (for `materializeAbortRef`), `useState`, `createContext`, `useContext` | Already in repo; `DashboardContext` uses standard React 18 context API |
| vitest | ^4.1.5 | Unit + integration tests for renderers + lifecycle | Existing `WidgetRenderer.spec.tsx` template at 566 LOC; `vi.mock("../../api/client")` pattern established |
| @testing-library/react | ^16.3.2 | `render`, `act`, `screen`, `waitFor` for renderer specs | Already used by `WidgetRenderer.spec.tsx`, `MapChartRenderer.spec.tsx` |

**Version verification:**
```bash
# All versions verified by reading kinetica_bi/package.json — see Phase 14 RESEARCH.md.
# No npm install needed.
```

**Confidence:** HIGH — every dependency is already in `package.json`. Zero install, zero version bump.

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| (none) | — | Phase 15 introduces zero new packages | All needed primitives exist |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Inline regex FROM-swap (`/FROM\s+(\w+)/i` → `FROM ${viewName}`) | Full SQL parser (e.g. `node-sql-parser`) | Parser handles arbitrary SQL but adds 100KB+ dep; ChartConfigPanel-generated SQL is predictable two-pattern shape (verified at Phase 9 RESEARCH.md). **Reject** parser; mirror Phase 9's `injectWhereClause` regex idiom. |
| `useFilterViewStore` selector reading whole `views` map | Per-tableId scoped selector `(s) => s.views[tableId]?.viewName` | Whole map causes cross-table re-render storms (PITFALL C-02 lock). **Reject** whole-map selector for hot widgets. |
| `materializeFilter` inside the chart-query `useEffect` | Separate `useEffect` with own `materializeAbortRef` | Sharing the chart-query AbortController would abort an in-flight chart query when filters change rapidly, even if the chart query was about to FROM-swap correctly (V13-P-10 lock). **Reject** shared controller. |
| Single big `WidgetRenderer.spec.tsx` extension | Split into `materialize-trigger.spec.tsx`, `from-swap.spec.tsx`, `ttl-recovery.spec.tsx` | Existing spec is 566 LOC; doubling it pushes towards 1100 LOC. Split gives clearer test ownership but adds 2 files + repeated mock boilerplate. **Recommend single file** for cohesion (Discretion item per CONTEXT.md). |
| `<FilteringBadge tableId={n} />` reusable component | Inline JSX in each renderer's card-header block | Component centralizes the spinner styling + selector subscription; inline JSX is less code now but duplicates between AggregatedWidgetRenderer and RecordsTableRenderer. **Recommend component** — DRY wins for two consumers. (Discretion item.) |
| `isViewNotFoundError` co-located in `WidgetRenderer.tsx` | New `src/lib/kineticaErrors.ts` | Co-location is shorter; new file is testable in isolation. **Recommend new file** (`src/lib/kineticaErrors.ts`) — single-purpose helper with own spec; matches `cardinalityProbe.ts` / `columnTypes.ts` pattern. (Discretion item.) |
| `fromSwap` regex inline in renderers | New `src/lib/fromSwap.ts` | Inline duplicates between AggregatedWidgetRenderer and RecordsTableRenderer (and Phase 16 may need it for layer SQL). **Recommend new file** for the same single-purpose-helper rationale. (Discretion item.) |

**Installation:** None.

## Architecture Patterns

### Recommended File Layout

```
kinetica_bi/src/components/
├── DashboardContext.tsx              # NEW (15-01) — context + useDashboardContext hook
├── DashboardContext.spec.tsx         # NEW (15-01) — provider/consumer happy + missing-context throw
├── DashboardsPage.tsx                # MODIFIED (15-01 mount + 15-05 lifecycle reset extension)
├── FilteringBadge.tsx                # NEW (15-02 — recommended) — reusable badge component
├── FilteringBadge.spec.tsx           # NEW (15-02 — recommended)
├── charts/
│   ├── WidgetRenderer.tsx            # MODIFIED (15-02 + 15-03 + 15-04) — major site of new code
│   └── WidgetRenderer.spec.tsx       # MODIFIED (15-02 + 15-03 + 15-04) — extend existing 566-LOC spec

kinetica_bi/src/lib/
├── fromSwap.ts                       # NEW (15-02 — recommended) — FROM-swap regex helper
├── fromSwap.spec.ts                  # NEW (15-02 — recommended)
├── kineticaErrors.ts                 # NEW (15-04 — recommended) — isViewNotFoundError helper
└── kineticaErrors.spec.ts            # NEW (15-04 — recommended)

kinetica_bi/src/store/
├── filterStore.ts                    # MODIFIED (15-02) — DELETE 4 utility functions (lines 104-195)
├── filterStore.spec.ts               # MODIFIED (15-02) — DELETE 4 utility test blocks (lines 162-291)
├── filterViewStore.ts                # MODIFIED (15-02 — recommended) — extend FilterViewEntry to carry dashboardId
└── filterViewStore.spec.ts           # MODIFIED (15-02 — if dashboardId added)

kinetica_bi/src/
├── App.tsx                           # MODIFIED (15-05) — extend logout effect
└── components/charts/MapChartRenderer.tsx   # MODIFIED (15-02) — see Critical Pitfall 1
```

### Pattern 1: Reference-Stable Per-tableId Selector Subscription (PITFALL C-02 / S-02 lock)

**What:** Hot widgets MUST scope selectors to `views[tableId]` — never read whole `views` map. The reference-stable update pattern in `useFilterViewStore` (mirrors `useDashboardLayersStore`) ensures only the mutated entry's reference changes; entries for other tableIds keep object identity.

**When to use:** Every Phase 15 selector subscription in `AggregatedWidgetRenderer` and `RecordsTableRenderer`.

**Reference example** (from `kinetica_bi/src/components/charts/WidgetRenderer.tsx:213-222` — Phase 9 lock that Phase 15 mirrors):
```typescript
// Source: kinetica_bi/src/components/charts/WidgetRenderer.tsx:213-222
// PITFALL C-02 lock: scope the selector to filters[tableId] — NEVER state.filters whole.
// Subscribing to the whole map would cause this widget to re-render on any other table's mutation.
const tableFilters = useFilterStore((state) =>
  tableId !== undefined ? state.filters[tableId] ?? [] : []
);
// PITFALL S-02 lock: filterVersion (primitive) is the useEffect dep — NEVER the array reference.
const filterVersion = useFilterStore((state) => state.filterVersion);
```

**Adaptation for Phase 15** (sketch):
```typescript
// In AggregatedWidgetRenderer (15-02):
const viewName = useFilterViewStore((s) =>
  tableId !== undefined ? s.views[tableId]?.viewName : undefined
);
const expiresAt = useFilterViewStore((s) =>
  tableId !== undefined ? s.views[tableId]?.expiresAt : undefined
);
const materializing = useFilterViewStore((s) =>
  tableId !== undefined ? s.views[tableId]?.materializing ?? false : false
);
```

### Pattern 2: Debounced Materialize Trigger Effect (mirror LayersModal 300ms auto-save)

**What:** `useEffect` with `setTimeout` + `clearTimeout` cleanup. On each `[sql, filterVersion]` change: clear pending timer, schedule new timer at 300ms. Inside timer: abort previous materialize via `materializeAbortRef`, branch on `tableFilters.length`.

**Existing reference:** `LayersModal.tsx` parent owns 300ms debounce for layer-config auto-save (`LayersModal.tsx:14-16` doc-comment). Pattern is a setTimeout + clearTimeout in useEffect cleanup.

**Adaptation for Phase 15** (sketch — exact code per planner):
```typescript
// In AggregatedWidgetRenderer (15-02):
const materializeAbortRef = useRef<AbortController | null>(null);
const dashboardId = useDashboardContext().dashboardId;

useEffect(() => {
  if (tableId === undefined) return;
  // Debounce: clear previous timer; schedule new one
  const timer = setTimeout(async () => {
    // V13-P-10 lock: separate abort controller from chart-query
    materializeAbortRef.current?.abort();
    const controller = new AbortController();
    materializeAbortRef.current = controller;

    if (tableFilters.length === 0) {
      // Empty filters → fire-and-forget DROP, then clearView
      dropFilterView({ dashboardId, tableId }).catch(() => {}); // V13-P-12: ignore drop errors
      useFilterViewStore.getState().clearView(tableId);
      return;
    }

    // V13-P-01 lock: markMaterializing → await → setView (post-200 only)
    useFilterViewStore.getState().markMaterializing(tableId);
    try {
      const result = await materializeFilter(
        { dashboardId, tableId, filters: tableFilters },
        controller.signal
      );
      // setView writes viewName + expiresAt; reference-stable per-tableId
      useFilterViewStore.getState().setView(tableId, result);
    } catch (err) {
      if ((err as Error)?.name === "AbortError") return; // silent
      // V13-P-12: PermissionError/UpstreamError → toast; do NOT setView; chart falls through to raw
      useToastStore.getState().showToast((err as Error).message, "error");
    }
  }, 300);

  return () => clearTimeout(timer);
  // PITFALL S-02: filterVersion is the primitive dep
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [sql, filterVersion]);
```

### Pattern 3: FROM-swap Regex (mirror Phase 9 `injectWhereClause` predictable-SQL-shape strategy)

**What:** Regex-based string replacement of `FROM <table>` → `FROM <viewName>`. Phase 9's `injectWhereClause` (`filterStore.ts:167-195`) established the precedent: ChartConfigPanel-generated SQL has predictable two-pattern shape (verified at `.planning/phases/09-filter-foundation/09-RESEARCH.md`); a full SQL parser is overkill.

**Reference example** (Phase 9 `injectWhereClause` pattern is the model — but Phase 15 deletes it; the *strategy* persists):
```typescript
// Source: kinetica_bi/src/store/filterStore.ts:167-195 (TO BE DELETED in 15-02)
// Strategy: regex/string-scan for GROUP BY | ORDER BY | LIMIT — full SQL parsing is overkill
// for the predictable two-pattern SQL shapes that ChartConfigPanel.tsx generates.
```

**Adaptation for Phase 15** — `src/lib/fromSwap.ts` (sketch):
```typescript
// New file: kinetica_bi/src/lib/fromSwap.ts (15-02 — recommended)
// Predictable SQL shape from ChartConfigPanel: SELECT ... FROM <table> [WHERE ...] [GROUP BY ...] [ORDER BY ...] [LIMIT ...]
// FROM <table> is the FIRST FROM keyword in the query (no subqueries in Phase 9-12 SQL).
// Word-boundary regex matches `FROM identifier` where identifier = [\w.]+ (handles schema.table).
const FROM_RE = /\bFROM\s+([\w.]+)/i;

export const fromSwap = (sql: string, viewName: string | undefined): string => {
  if (!viewName) return sql; // FILT-V13-03: zero overhead when no view
  return sql.replace(FROM_RE, `FROM ${viewName}`);
};
```

**Adapt for `RecordsTableRenderer`** (15-03) — its SQL is built inline at `WidgetRenderer.tsx:915, 937`; pass through `fromSwap`:
```typescript
// 15-03 — at WidgetRenderer.tsx:915:
const fromSource = viewName ?? table;
const sql = `SELECT ${colsClause} FROM ${fromSource}${orderBy} LIMIT ${pageSize} OFFSET ${offset}`;
// 15-03 — at WidgetRenderer.tsx:937:
const countSql = `SELECT COUNT(*) AS total FROM ${fromSource}`;
```
(No need for `fromSwap` helper here — inline interpolation is shorter and clearer when constructing SQL from scratch.)

### Pattern 4: `isViewNotFoundError` Detection (Phase 13 spike S3 verbatim capture)

**What:** Helper that detects the Kinetica "view not found" error string. Phase 13 spike S3 captured the verbatim error at HTTP 400: `SqlEngine: Object '<view-name>' not found (S/SDc:1513)`.

**Source contract** (locked at `.planning/STATE.md` Phase 13 lock):
```
HTTP status: 400
error.message contains: /SqlEngine: Object '[^']+' not found/i
error.message contains: S/SDc:1513
```

**Important:** `throwForStatus` at `client.ts:63-79` only maps 401/403/502 to typed errors. HTTP 400 hits the fallback `throw new Error(`${fallbackMessage}: ${response.status}`)` at `client.ts:78`. The `{ error: string }` body extraction at `client.ts:67-74` populates `message`, so `err.message` will contain the Kinetica error text.

**Adaptation for Phase 15** — `src/lib/kineticaErrors.ts` (sketch):
```typescript
// New file: kinetica_bi/src/lib/kineticaErrors.ts (15-04 — recommended)
// V13-P-04 + Phase 13 SPIKE-V13-03 lock: verbatim Kinetica error string captured 2026-05-06.
// Pattern: HTTP 400 with body containing both "SqlEngine: Object '<name>' not found" AND "S/SDc:1513".
const VIEW_NOT_FOUND_RE = /SqlEngine: Object '[^']+' not found/i;
const KINETICA_VIEW_NOT_FOUND_CODE = "S/SDc:1513";

export const isViewNotFoundError = (err: unknown): boolean => {
  if (!err || typeof err !== "object") return false;
  const message = (err as { message?: unknown }).message;
  if (typeof message !== "string") return false;
  return VIEW_NOT_FOUND_RE.test(message) && message.includes(KINETICA_VIEW_NOT_FOUND_CODE);
};
```

### Pattern 5: `DashboardContext` (mirror standard React 18 context idiom)

**What:** New React context exposing `{ dashboardId: number }`. Hook `useDashboardContext()` throws on missing context (matches react-redux `useSelector` idiom).

**Reference example** — standard React context pattern + fail-loud guard:
```typescript
// New file: kinetica_bi/src/components/DashboardContext.tsx (15-01)
import { createContext, useContext, type ReactNode } from "react";

type DashboardContextValue = { dashboardId: number };

const DashboardContext = createContext<DashboardContextValue | null>(null);

export const DashboardContextProvider = ({
  dashboardId,
  children,
}: {
  dashboardId: number;
  children: ReactNode;
}) => (
  <DashboardContext.Provider value={{ dashboardId }}>
    {children}
  </DashboardContext.Provider>
);

export const useDashboardContext = (): DashboardContextValue => {
  const ctx = useContext(DashboardContext);
  if (ctx === null) {
    throw new Error("useDashboardContext must be used inside DashboardContext.Provider");
  }
  return ctx;
};
```

**Mount site** — wrap the widget grid at `DashboardsPage.tsx:721-761`:
```tsx
// 15-01: wrap ResponsiveGridLayout in DashboardContextProvider
<DashboardContextProvider dashboardId={dashboard.id}>
  <ResponsiveGridLayout ...>
    {widgets.map((w) => (
      <div key={String(w.id)} className="widget-card">
        ...
      </div>
    ))}
  </ResponsiveGridLayout>
</DashboardContextProvider>
```

### Pattern 6: Module-level `vi.mock("../../api/client")` for Renderer Specs

**What:** When testing renderers that exercise the materialize trigger, mock the client module so `materializeFilter` / `dropFilterView` don't hit a real fetch.

**Reference example** (from `MapChartRenderer.spec.tsx:165-167` — existing pattern):
```typescript
// Source: kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx:165-167
vi.mock("../../store/filterStore", () => {
  ...
  buildWhereClause: vi.fn().mockReturnValue(""),
  injectWhereClause: vi.fn().mockImplementation((sql: string) => sql),
});
```

**Adapt for 15-02 spec extension:**
```typescript
// In WidgetRenderer.spec.tsx (15-02 extension):
vi.mock("../../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/client")>();
  return {
    ...actual,
    materializeFilter: vi.fn(),
    dropFilterView: vi.fn(),
    runSql: vi.fn(),
  };
});
import { materializeFilter, dropFilterView, runSql } from "../../api/client";
```

### Anti-Patterns to Avoid

- **Reading whole `useFilterViewStore.views` map in hot widgets** — PITFALL C-02 lock. Always scope selectors to `views[tableId]?.<field>`.
- **Sharing AbortController between materialize and chart-query** — V13-P-10 lock. Two separate refs: `materializeAbortRef` and the chart-query controller.
- **Calling `setView` before `materializeFilter` resolves** — V13-P-01 lock. `setView` is post-200 only; pre-call action is `markMaterializing`.
- **Looping reactive recovery without limit** — max 1 retry. If retry's chart query also fails view-not-found, fall through to raw `FROM <table>`.
- **Triggering materialize from `RecordsTableRenderer` or `MapChartRenderer`** — VSTORE-V13-02 / FILT-V13 lock. Only `AggregatedWidgetRenderer` triggers; others are pure consumers.
- **Optimistic dashboardId derivation at logout time** — at logout, the user might not be on a dashboard. CONTEXT.md recommends extending `FilterViewEntry` with `dashboardId` so the cleanup loop reads it from each entry; planner verifies and locks.
- **Toasting AbortError on materialize cancellation** — silent (matches Phase 9 `WidgetRenderer.tsx:243` lock).
- **Awaiting `dropFilterView` at logout / dashboard-switch** — fire-and-forget (CONTEXT.md). Use `.catch(() => {})` to swallow errors silently.
- **Importing `MaterializeFilterArgs`/`Response` from `filterViewStore.ts`** — types live in `client.ts:556-593` (Phase 14 lock). Renderer imports from `client`.
- **Adding a new `code` field check on PermissionError** — server convention: NO `code` field on permission errors (Phase 13 + Phase 14 lock); use `err.message` directly.
- **Building a parser for ChartConfigPanel SQL** — predictable two-pattern shape; regex suffices.
- **Catching view-not-found in `materializeFilter`'s catch path** — view-not-found errors come from `runSql` (the chart query), NOT from `materializeFilter` (which creates the view). The materialize call's catch handles 403 / 502 / Abort. The chart query's catch handles 400 view-not-found.
- **Mutating `useFilterStore.filterVersion` on view changes** — VSTORE-V13-03 lock: chip state byte-unchanged. View changes drive a separate selector subscription; never bump `filterVersion`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Per-tableId state slice | New custom hook with refs + manual selector tracking | `useFilterViewStore` + scoped selector | Already shipped in Phase 14; reset shim covers it; reference-stable updates already correct. |
| Materialize POST + DELETE | Custom `fetch` wrapper | `materializeFilter` / `dropFilterView` from `client.ts:570-612` | Already shipped in Phase 14; AbortSignal threading already in place; typed-error chain already wired. |
| HTTP error → typed-error mapping | Custom `if (status === 403) throw` | `throwForStatus` (already invoked inside helpers) | `PermissionError` (403) / `UpstreamError` (502) / `ReauthRequiredError` (401) already mapped at `client.ts:75-78`. Phase 15 catch path uses `instanceof`. |
| AbortController for chart query | New abort signal management | Reuse Phase 9 pattern at `WidgetRenderer.tsx:230, 249` | Already in place; Phase 15 ADDS a SECOND `materializeAbortRef` for materialize. |
| AbortError detection | Custom error.code check | `err?.name === "AbortError"` (matches Phase 9 lock at `WidgetRenderer.tsx:243`) | Native fetch spec; already idiomatic in repo. |
| Debounce timer | `lodash.debounce` import | `setTimeout` + `clearTimeout` in `useEffect` cleanup (matches LayersModal 300ms pattern) | No new dep; matches existing convention. |
| SQL FROM-replacement | Full SQL parser (`node-sql-parser` etc.) | Regex `\bFROM\s+([\w.]+)` (mirrors Phase 9 `injectWhereClause` strategy) | ChartConfigPanel SQL is predictable two-pattern shape; parser adds 100KB+ for one regex. |
| Toast routing | Custom error UI | `useToastStore.getState().showToast(message, "error")` from `src/store/toast.ts` | Existing pattern; `err.message` carries server text per typed-error chain. |
| React context for dashboardId | Drilling `dashboardId` prop down through every widget | `DashboardContext` (new in 15-01, mounted at `DashboardOpen` widget grid) | One provider, fail-loud `useDashboardContext()` hook; matches react-redux idiom. |
| View-not-found error detection | Custom error class hierarchy | Substring match on `err.message` (Phase 13 spike S3 verbatim capture) | HTTP 400 isn't mapped to a typed error class; substring match is the documented contract. |
| `expiresAt` math | Custom TTL tracker / setInterval | `Date.now() >= entry.expiresAt` inline check on chart-query effect | Server returns `expiresAt` (epoch ms); client trusts it; no clock-skew handling needed for v1.3 internal tool. |
| Lifecycle reset infrastructure | New cleanup module | Extend existing `App.tsx:40-44` and `DashboardsPage.tsx:379-383` hooks | Existing reset pattern; Phase 15 adds 2 lines + a fire-and-forget loop. |

**Key insight:** Phase 15 is a "wire existing primitives together" phase. Every primitive — store, helpers, abort patterns, error classes, toast routing, debounce, regex strategy — already exists in the repo. The strongest plan is one that explicitly references existing line numbers and adapts inline. Plans that introduce new abstractions or refactor existing patterns are over-engineering.

## Common Pitfalls

### Critical Pitfall 1: MapChartRenderer Blocks Atomic Dead-Code Deletion (FILT-V13-05)

**What goes wrong:** Plan 15-02's commit deletes `injectWhereClause`, `buildWhereClause`, `escapeKineticaStringLiteral`, `buildEqualityFilter` from `filterStore.ts`. **`tsc --noEmit` fails** because:
- `MapChartRenderer.tsx:42` imports `buildWhereClause`.
- `MapChartRenderer.tsx:316` calls `buildWhereClause(tableFilters)`.
- `MapChartRenderer.tsx:414` calls `buildWhereClause(tableFilters)`.
- `MapChartRenderer.spec.tsx:165-166` mocks `buildWhereClause` and `injectWhereClause`.
- `wmsUrlBuilder.spec.ts:471-492` (FILT-04 block) tests QUERY emission with non-empty `whereClause` argument (does NOT call `buildWhereClause` itself, but the spec describes the contract).

**Why it happens:** The CONTEXT.md and REQUIREMENTS.md both lock the dead-code deletion to Phase 15 / FILT-V13-05, but the LAYERS-swap migration (which would remove MapChartRenderer's `buildWhereClause` callsites) is locked to Phase 16. The two locks contradict each other for the `MapChartRenderer` callsites.

**How to avoid:** Two viable resolution paths — planner picks one and locks it in 15-02 plan:

**Option A (recommended): Migrate MapChartRenderer's two `buildWhereClause` callsites in 15-02 atomically, with explicit Phase 16 cleanup note.**
- Replace lines 316 and 414 with `const whereClause = "";` (or remove the variable entirely — buildWmsParams's `whereClause` arg becomes empty string).
- Effect: WMS QUERY param emission stops working for filtered map layers between 15-02 and Phase 16. **This is acceptable** because:
  1. v1.2 milestone close (`MILESTONES.md`) explicitly documents `TD-V12-01` — "WMS-QUERY tile filter does not narrow tiles — superseded; rework filtering wholesale in v1.3" (top v1.3 driver).
  2. The QUERY param wasn't narrowing tiles ANYWAY; that's why Phase 16 owns the LAYERS-swap migration.
  3. Phase 16 will atomically replace the LAYERS param with the view name; the empty whereClause path becomes irrelevant.
- Pro: 15-02 ships clean (`tsc --noEmit` passes); Phase 16 has greenfield.
- Con: Expands 15-02 scope by ~6 LOC of map-renderer touch.
- Spec impact: `MapChartRenderer.spec.tsx:165-167` mock entries for `buildWhereClause` / `injectWhereClause` must be removed in 15-02; the spec's FILT-04 assertions (if any) need adjustment. `wmsUrlBuilder.spec.ts:470-492` FILT-04 block stays as-is until Phase 16 (it tests QUERY emission given non-empty `whereClause` arg — the function still accepts the arg even if no caller passes it).

**Option B: Keep the four utilities exported but mark `@deprecated` until Phase 16 completes the map LAYERS-swap.**
- Pro: 15-02 plan stays scoped to chart consumers + utility deletion; map renderer untouched.
- Con: Violates the user-locked "atomic with FROM-swap" deletion timing. `tsc --noEmit` would still pass (deprecated isn't an error), but the dead-code deletion goal is split across two phases — exactly what the user lock prohibits.
- **Reject** unless user revisits the lock.

**Recommendation:** **Option A** — migrate MapChartRenderer's two callsites to empty whereClause in 15-02. Document the Phase 16 cleanup tag inline. Update `MapChartRenderer.spec.tsx:165-167` mock block to remove `buildWhereClause` / `injectWhereClause` entries. The wmsUrlBuilder.spec FILT-04 test block is for the builder function — leave it; Phase 16 deletes it.

**Warning signs to surface in plan:**
- Plan 15-02 doesn't enumerate ALL callers of the four functions (the planner missed the map renderer).
- Plan 15-02 says "atomic deletion" without specifying the MapChartRenderer migration step.
- TypeScript build fails with "Cannot find name 'buildWhereClause'" or similar after the delete commit.

### Pitfall 2: Two-Phase Visual State (`materializing` vs `loading`) — FILT-V13-04

**What goes wrong:** Implementation collapses materializing + loading into one boolean. Either (a) badge shows during chart query, breaking "two visual phases" lock; or (b) loading hides chart data during materialize, breaking "existing chart data visible underneath" lock.

**Why it happens:** "It's just a spinner" is an attractive simplification. But REQUIREMENTS FILT-V13-04 explicitly locks two phases: badge during materialize (chart data visible), then `loading` covers chart query (existing v1.2 behavior — chart data cleared / "Loading..." placeholder).

**How to avoid:**
- `materializing` flag is owned by `useFilterViewStore.views[tableId].materializing` — set true on `markMaterializing`, false on `setView` / `clearView` / error.
- `loading` is owned by `AggregatedWidgetRenderer`'s local `useState<boolean>` (existing at `WidgetRenderer.tsx:200`); fires AFTER materialize completes, when the chart-query `runSql` call begins.
- Badge JSX reads `materializing`. The existing `if (loading) return ...` placeholder at `WidgetRenderer.tsx:263-269` reads `loading`.
- Both can be true simultaneously? No — materialize completes first (debounce + await), then chart query fires; the two phases are sequential, not overlapping.

**Warning signs:**
- Plan conflates `materializing` and `loading` into one state.
- Spec asserts on `expect(screen.getByText("Loading...")).toBeInTheDocument()` during materialize phase — wrong; should assert on `getByText("Filtering...")` for materialize and `getByText("Loading...")` for chart query.

### Pitfall 3: Reactive Recovery Infinite Loop (LIFE-V13-02)

**What goes wrong:** Reactive recovery hits `isViewNotFoundError`, clears view, re-materializes (succeeds), retries chart query, but Kinetica's TTL has already expired the new view (in pathological 5-min-stuck scenarios). Catch fires again → loop.

**Why it happens:** No retry counter; the catch branch always retries.

**How to avoid:**
- Max 1 reactive retry per chart-query invocation. After retry, fall through to raw `FROM <table>` (drop the viewName from the SQL; query unfiltered data once; user gets stale-but-correct data instead of an infinite spinner).
- Implementation: a local `let retried = false` flag inside the chart-query effect's catch block. After the first retry, `retried = true`; on second view-not-found, fall through (or surface error normally).
- Alternative (cleaner): a separate retry function with `retried` parameter; recursion bounded.

**Warning signs:**
- Plan describes reactive recovery without mentioning a retry limit.
- Spec doesn't include a "view not found on retry → fall through" assertion.

### Pitfall 4: Stale `materializeAbortRef` Across Re-renders

**What goes wrong:** Component re-renders during materialize (e.g., another widget mutates a parent state); `materializeAbortRef.current.abort()` is called incorrectly, aborting the in-flight materialize.

**Why it happens:** Confusion about useRef semantics — the ref persists across renders, but only the latest closure sees it.

**How to avoid:** Standard `useRef` idiom — abort current ref then assign new controller. Pattern is already established at `WidgetRenderer.tsx:230` for the chart-query AbortController; mirror it.

**Warning signs:**
- Spec demonstrates a re-render mid-materialize and asserts the materialize completes (not aborted spuriously).

### Pitfall 5: dashboardId Cleanup Loop at Logout Without Dashboard Context

**What goes wrong:** User logs out while NOT on a dashboard (e.g., on `/datasets` page). `App.tsx:42` logout effect tries to fire `dropFilterView` for active views, but has no `dashboardId` source — there's no `DashboardContext` mounted on `/datasets`.

**Why it happens:** `DashboardContext` is mounted INSIDE `DashboardOpen` (per CONTEXT.md lock), so it's only available when a dashboard is open.

**How to avoid:** **Extend `FilterViewEntry` to carry `dashboardId`** (CONTEXT.md recommends this in 15-02). Cleanup loop reads `entry.dashboardId` from each `views[tableId]` entry, no external lookup needed. Logout site:
```typescript
// App.tsx:40-44 (15-05 extension):
useEffect(() => {
  if (status === "unauthenticated") {
    const views = useFilterViewStore.getState().views;
    for (const tableIdStr in views) {
      const tableId = Number(tableIdStr);
      const entry = views[tableId];
      // Fire-and-forget; dashboardId stored on entry per 15-02 schema extension
      dropFilterView({ dashboardId: entry.dashboardId, tableId }).catch(() => {});
    }
    useFilterViewStore.getState().reset();
    useFilterStore.getState().reset();
  }
}, [status]);
```

**Schema extension** (15-02 — recommended):
```typescript
// kinetica_bi/src/store/filterViewStore.ts (15-02):
export type FilterViewEntry = {
  viewName: string;
  expiresAt: number;
  materializing: boolean;
  materializeVersion: number;
  dashboardId: number; // NEW — Phase 15 cleanup loops read this
};
```
- `setView` accepts `dashboardId` (caller passes it from `useDashboardContext`).
- `markMaterializing` also accepts `dashboardId` (placeholder entry needs it).
- `bumpMaterializeVersion` and `clearView` don't touch dashboardId (preserve from prior entry / no-op).
- Spec: existing `filterViewStore.spec.ts` tests must update to pass dashboardId arg.

**Warning signs:**
- Plan 15-05 logout cleanup loop derives dashboardId from current page state — wrong (user might not be on a dashboard).
- Plan 15-02 doesn't extend `FilterViewEntry` — Phase 15-05 has no clean dashboardId source.

### Pitfall 6: "Filtering..." Badge Without Existing Spinner CSS

**What goes wrong:** Plan assumes a CSS spinner class like `.spinner` already exists; badge JSX uses non-existent class; build passes (CSS isn't type-checked) but UI shows nothing.

**Why it happens:** Codebase has no spinner. Verified by grep:
```
/Users/rydelpereira/Documents/projects/codex_kinetica_bi/kinetica_bi/src/styles/global.css:
  Only existing animation = @keyframes toast-in (line 1470)
  No .spinner class. No @keyframes spin/rotate.
```

**How to avoid:** Plan 15-02 adds a small CSS keyframe + class to `kinetica_bi/src/styles/global.css`, OR uses inline style. Sketch:
```css
/* kinetica_bi/src/styles/global.css — append in 15-02 */
.widget-filtering-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--muted);
  font-weight: 500;
  margin-left: 8px;
}
.widget-filtering-spinner {
  width: 10px;
  height: 10px;
  border: 1.5px solid var(--muted);
  border-top-color: transparent;
  border-radius: 50%;
  animation: filtering-spin 0.8s linear infinite;
}
@keyframes filtering-spin {
  to { transform: rotate(360deg); }
}
```

JSX:
```tsx
// FilteringBadge.tsx (15-02 — recommended):
import { useFilterViewStore } from "../store/filterViewStore";

export const FilteringBadge = ({ tableId }: { tableId: number | undefined }) => {
  const materializing = useFilterViewStore((s) =>
    tableId !== undefined ? s.views[tableId]?.materializing ?? false : false
  );
  if (!materializing) return null;
  return (
    <span className="widget-filtering-badge">
      <span className="widget-filtering-spinner" aria-hidden="true" />
      <span>Filtering...</span>
    </span>
  );
};
```

**Warning signs:**
- Plan 15-02 references a CSS class that doesn't exist in `global.css`.
- Plan ships unicode-only badge (e.g., `⏳`) — acceptable but visually weak; CSS spinner is recommended.

### Pitfall 7: `RecordsTableRenderer` Total-Count Effect Doesn't Re-Fire on viewName Change

**What goes wrong:** `RecordsTableRenderer`'s total-count effect at `WidgetRenderer.tsx:932-945` has dep array `[table]` only. On filter activation (viewName becomes non-null), the count query stays bound to the raw table and shows the unfiltered total. UI shows "1–25 of 500,000" while data table only has 1,200 filtered rows visible — confusing UX.

**Why it happens:** Existing v1.2 effect didn't anticipate FROM-swap.

**How to avoid:** 15-03 plan extends the dep array to `[table, viewName]`:
```typescript
// 15-03 — at WidgetRenderer.tsx:932 (CHANGE the dep array):
useEffect(() => {
  if (!table || !IDENT_RE.test(table)) {
    setTotalCount(null);
    return;
  }
  const fromSource = viewName ?? table;
  runSql<Record<string, unknown>>(`SELECT COUNT(*) AS total FROM ${fromSource}`)
    .then(...)
    .catch(...);
}, [table, viewName]); // CHANGED from [table]
```

**Warning signs:**
- Plan 15-03 doesn't mention the count-effect dep array.
- Spec doesn't assert "total count narrows when filter active" (REQUIREMENTS FILT-V13-02 explicit success criterion).

### Pitfall 8: HTTP 400 Falls Through `throwForStatus` to Generic Error (LIFE-V13-02)

**What goes wrong:** `runSql` throws `Error: SQL request failed: 400` on view-not-found because HTTP 400 isn't mapped to a typed class at `client.ts:75-78`. `isViewNotFoundError` checks `err.message` substring — but if the body extraction at `client.ts:67-74` failed, `err.message` might just be "SQL request failed: 400" without the Kinetica error string.

**Why it happens:** `throwForStatus` at `client.ts:63-79` extracts `body.error` if present, falls back to text or status code. The Kinetica error response body shape `{ error: "SqlEngine: Object '<view>' not found (S/SDc:1513)" }` matches the extraction path, so `err.message` SHOULD contain the Kinetica string. But this depends on the server's `errorMiddleware` correctly forwarding the Kinetica error message via `{ error: "..." }`.

**How to avoid:**
- Verify by reading server's error middleware: `kinetica_bi/server/src/index.ts:812-815` (per Phase 14 CONTEXT.md) returns `{ error: "..." }` for Kinetica errors. **Confidence: HIGH — Phase 13 spike S3 captured the verbatim error shape.**
- Spec for `isViewNotFoundError` MUST cover both forms:
  1. `new Error("SqlEngine: Object '_kbi_filt_u1_d2_t3_sabcdefab' not found (S/SDc:1513)")` → returns `true`.
  2. `new Error("SQL request failed: 400")` → returns `false` (no substring match).
- `runSql` calls `throwForStatus(response, "SQL request failed")` — the body-error extraction path works; `err.message` contains the Kinetica string.

**Warning signs:**
- Plan 15-04 doesn't enumerate the exact error message shapes; relies on assumption.
- Spec only tests the happy-path message form.

### Pitfall 9: Multi-Tab Same-User Same-Session Last-Write-Wins (V13-P-09 — accepted)

**What goes wrong:** User opens same dashboard in two tabs. Both filter the same table → both compute the same view name (deterministic per `userId+sessionId+dashboardId+tableId` at `viewNaming.ts`) → second tab's `CREATE OR REPLACE` silently overwrites first tab's view content. Tab 1 chips say filter A; tab 1 charts show data filtered by tab 2's filter B.

**Why it happens:** View name is intentionally deterministic for idempotency. Multi-tab use of one BI session was not in v1.3 design scope.

**How to avoid:** Inline-comment in 15-02 referencing `// V13-P-09 lock: ...` near the materialize trigger. **No code fix for v1.3** — accepted trade-off per CONTEXT.md. Future v1.4 mitigation: add per-tab `crypto.randomUUID()` to the view name input.

**Warning signs:**
- Plan adds tab-id correlation logic — out of scope; reject.

## Code Examples

Verified patterns from in-repo sources. Plans should reference these line numbers directly.

### Example 1: Existing AggregatedWidgetRenderer Filter-Subscription Effect (Phase 9 lock — Phase 15 EXTENDS)

```typescript
// Source: kinetica_bi/src/components/charts/WidgetRenderer.tsx:213-253
// PITFALL C-02 lock: scope the selector to filters[tableId] — NEVER state.filters whole.
const tableFilters = useFilterStore((state) =>
  tableId !== undefined ? state.filters[tableId] ?? [] : []
);
// PITFALL S-02 lock: filterVersion (primitive) is the useEffect dep — NEVER the array reference.
const filterVersion = useFilterStore((state) => state.filterVersion);

useEffect(() => {
  if (!sql?.trim()) {
    setData([]);
    return;
  }
  // Phase 9 FILT-02: cancel any in-flight fetch when filter changes before response arrives.
  const controller = new AbortController();
  const whereClause = buildWhereClause(tableFilters);              // <-- DELETE in 15-02
  const finalSql = injectWhereClause(sql, whereClause);             // <-- DELETE in 15-02
  setLoading(true);
  setError(null);
  runSql<Record<string, unknown>>(finalSql, undefined, controller.signal)
    .then((res) => {
      const rows = parseKineticaResponse(res);
      setData(rows);
    })
    .catch((err) => {
      if (err?.name === "AbortError") return;
      setError(err.message);
    })
    .finally(() => {
      setLoading(false);
    });
  return () => controller.abort();
}, [sql, filterVersion]);
```

**15-02 transformation:**
```typescript
// New code in AggregatedWidgetRenderer (15-02):
const dashboardId = useDashboardContext().dashboardId;
const viewName = useFilterViewStore((s) =>
  tableId !== undefined ? s.views[tableId]?.viewName : undefined
);
const expiresAt = useFilterViewStore((s) =>
  tableId !== undefined ? s.views[tableId]?.expiresAt ?? 0 : 0
);
const materializeAbortRef = useRef<AbortController | null>(null);

// Effect 1: materialize trigger (debounced 300ms)
useEffect(() => {
  if (tableId === undefined) return;
  const timer = setTimeout(async () => {
    materializeAbortRef.current?.abort();
    const controller = new AbortController();
    materializeAbortRef.current = controller;
    if (tableFilters.length === 0) {
      dropFilterView({ dashboardId, tableId }).catch(() => {});
      useFilterViewStore.getState().clearView(tableId);
      return;
    }
    useFilterViewStore.getState().markMaterializing(tableId, dashboardId);
    try {
      const result = await materializeFilter(
        { dashboardId, tableId, filters: tableFilters },
        controller.signal
      );
      useFilterViewStore.getState().setView(tableId, result, dashboardId);
    } catch (err) {
      if ((err as Error)?.name === "AbortError") return;
      useToastStore.getState().showToast((err as Error).message, "error");
    }
  }, 300);
  return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [sql, filterVersion, dashboardId, tableId]);

// Effect 2: chart query (FROM-swap; replaces old whereClause+inject path)
useEffect(() => {
  if (!sql?.trim()) { setData([]); return; }
  // LIFE-V13-01 proactive expiry check
  if (viewName && expiresAt > 0 && Date.now() >= expiresAt) {
    useFilterViewStore.getState().clearView(tableId!);
    return; // next effect cycle (after materialize completes) will re-fire
  }
  const controller = new AbortController();
  const finalSql = fromSwap(sql, viewName); // <-- replaces buildWhereClause + injectWhereClause
  setLoading(true);
  setError(null);
  runSql<Record<string, unknown>>(finalSql, undefined, controller.signal)
    .then((res) => setData(parseKineticaResponse(res)))
    .catch(async (err) => {
      if (err?.name === "AbortError") return;
      // LIFE-V13-02 reactive recovery — max 1 retry
      if (isViewNotFoundError(err) && viewName) {
        useFilterViewStore.getState().clearView(tableId!);
        // Re-materialize + retry once (planner picks exact mechanism)
        // ... (15-04 detail)
        return;
      }
      setError(err.message);
    })
    .finally(() => setLoading(false));
  return () => controller.abort();
}, [sql, filterVersion, viewName, expiresAt]);
```

### Example 2: Existing RecordsTableRenderer SQL Composition (Phase 15-03 EXTENDS)

```typescript
// Source: kinetica_bi/src/components/charts/WidgetRenderer.tsx:910-945
// (in RecordsTableRenderer)
const colsClause = effectiveColumns.length > 0 ? effectiveColumns.join(", ") : "*";
const orderBy = sortField && IDENT_RE.test(sortField)
  ? ` ORDER BY ${sortField} ${sortDir.toUpperCase()}`
  : "";
const offset = (page - 1) * pageSize;
const sql = `SELECT ${colsClause} FROM ${table}${orderBy} LIMIT ${pageSize} OFFSET ${offset}`;

// ...

// Total-count effect — currently scoped to [table] only
useEffect(() => {
  if (!table || !IDENT_RE.test(table)) { setTotalCount(null); return; }
  runSql<Record<string, unknown>>(`SELECT COUNT(*) AS total FROM ${table}`)
    .then(...)
    .catch(() => setTotalCount(null));
}, [table]); // <-- 15-03 changes to [table, viewName]
```

**15-03 transformation:**
```typescript
// 15-03 — RecordsTableRenderer:
const viewName = useFilterViewStore((s) =>
  tableId !== undefined ? s.views[tableId]?.viewName : undefined
);
const expiresAt = useFilterViewStore((s) =>
  tableId !== undefined ? s.views[tableId]?.expiresAt ?? 0 : 0
);
const fromSource = viewName ?? table;
const sql = `SELECT ${colsClause} FROM ${fromSource}${orderBy} LIMIT ${pageSize} OFFSET ${offset}`;
// ... and the count effect:
runSql<Record<string, unknown>>(`SELECT COUNT(*) AS total FROM ${fromSource}`);
// ... and the dep array change:
}, [table, viewName, sortField, sortDir, page, pageSize, effectiveColumns.join(",")]);
// total-count effect dep array becomes [table, viewName]
```

### Example 3: Existing Logout Reset (App.tsx — Phase 15-05 EXTENDS)

```typescript
// Source: kinetica_bi/src/App.tsx:40-44
// Phase 9 FILT-01 lifecycle: clear all filters when the user logs out / session expires.
useEffect(() => {
  if (status === "unauthenticated") {
    useFilterStore.getState().reset();
  }
}, [status]);
```

**15-05 transformation:**
```typescript
// kinetica_bi/src/App.tsx:40-44 (extended):
useEffect(() => {
  if (status === "unauthenticated") {
    // LIFE-V13-03: snapshot active views, fire-and-forget DROPs, then reset both stores.
    const views = useFilterViewStore.getState().views;
    for (const tableIdStr of Object.keys(views)) {
      const tableId = Number(tableIdStr);
      const entry = views[tableId];
      // Fire-and-forget — errors swallowed; user is logging out, nothing to surface.
      dropFilterView({ dashboardId: entry.dashboardId, tableId }).catch(() => {});
    }
    useFilterViewStore.getState().reset();
    useFilterStore.getState().reset();
  }
}, [status]);
```

### Example 4: Existing Dashboard-Switch Reset (DashboardsPage.tsx — Phase 15-05 EXTENDS)

```typescript
// Source: kinetica_bi/src/components/DashboardsPage.tsx:379-383
useEffect(() => {
  return () => {
    useFilterStore.getState().reset();
  };
}, [dashboard.id]);
```

**15-05 transformation:**
```typescript
// kinetica_bi/src/components/DashboardsPage.tsx:379-383 (extended):
useEffect(() => {
  return () => {
    // LIFE-V13-04: snapshot active views for THIS dashboard, fire-and-forget DROPs.
    const views = useFilterViewStore.getState().views;
    for (const tableIdStr of Object.keys(views)) {
      const tableId = Number(tableIdStr);
      const entry = views[tableId];
      dropFilterView({ dashboardId: entry.dashboardId, tableId }).catch(() => {});
    }
    useFilterViewStore.getState().reset();
    useFilterStore.getState().reset();
  };
}, [dashboard.id]);
```

### Example 5: Existing Module-Level Mock Pattern (WidgetRenderer.spec.tsx — Phase 15-02/03/04 EXTEND)

```typescript
// Source: kinetica_bi/src/components/charts/WidgetRenderer.spec.tsx:1-100 — existing mock pattern
// 15-02 extension: ADD module-level mocks for materializeFilter / dropFilterView
vi.mock("../../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/client")>();
  return {
    ...actual,
    materializeFilter: vi.fn(),
    dropFilterView: vi.fn(),
    runSql: vi.fn(),
  };
});
```

### Example 6: DashboardContext Provider/Consumer Pattern (15-01)

```typescript
// New file: kinetica_bi/src/components/DashboardContext.tsx (15-01)
import { createContext, useContext, type ReactNode } from "react";

// V13-P-13 (Phase 15 lock): minimal surface — { dashboardId } only.
// AggregatedWidgetRenderer is the sole Phase 15 consumer; reads dashboardId for the
// materializeFilter / dropFilterView args. Phase 16 may add MapChartRenderer if needed.
type DashboardContextValue = { dashboardId: number };
const DashboardContext = createContext<DashboardContextValue | null>(null);

export const DashboardContextProvider = ({
  dashboardId,
  children,
}: {
  dashboardId: number;
  children: ReactNode;
}) => (
  <DashboardContext.Provider value={{ dashboardId }}>
    {children}
  </DashboardContext.Provider>
);

// Fail-loud: throws on missing context. Tests must wrap renderers in the provider.
// Mirrors react-redux useSelector idiom.
export const useDashboardContext = (): DashboardContextValue => {
  const ctx = useContext(DashboardContext);
  if (ctx === null) {
    throw new Error("useDashboardContext must be used inside DashboardContext.Provider");
  }
  return ctx;
};
```

### Example 7: filterStore.spec.ts Test Block Deletion (15-02)

```typescript
// kinetica_bi/src/store/filterStore.spec.ts — DELETE these blocks atomically in 15-02:
// Lines 162-176: describe("escapeKineticaStringLiteral (PITFALL D-02 lock)")
// Lines 180-215: describe("buildEqualityFilter")
// Lines 217-234: describe("buildWhereClause")
// Lines 236-291: describe("injectWhereClause")
//
// KEEP intact:
// Lines 1-160: imports, helper f(), canary, addFilter, removeFilter, clearFilters, reset describes
//
// After deletion, file shrinks from 291 LOC to ~160 LOC.
```

## State of the Art

| Old Approach (v1.2 / Phase 9) | Current Approach (v1.3 / Phase 15) | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Client-side `injectWhereClause` + `buildWhereClause` mutating widget SQL | Server-side `CREATE OR REPLACE MATERIALIZED VIEW` + client-side FROM-swap | v1.3 Phase 13 ships endpoint; Phase 15 swaps consumers; Phase 16 swaps WMS LAYERS | Filtering uniformly works across charts AND map tiles (closes TD-V12-01); centralizes SQL safety server-side. |
| Single chart-query AbortController | Two AbortControllers: chart-query + `materializeAbortRef` | Phase 15 (Phase 14 helper signature accepts `signal?`; Phase 15 wires the second ref) | Rapid filter changes can cancel in-flight materialize without aborting the chart query that's about to FROM-swap. |
| Filter chip + WHERE-clause coupled in `useFilterStore` | Two-store split: `useFilterStore` (chips, filterVersion, 10-cap) + `useFilterViewStore` (viewName, expiresAt, materializing, materializeVersion) | Phase 14 ships the second store; Phase 15 wires the first production caller | Cleaner separation of WHEN-to-materialize (filterStore) vs WHAT-NAME-to-FROM (filterViewStore); selector scoping per tableId reduces re-renders. |
| `useFilterStore.reset()` only on logout / dashboard-switch | BOTH stores reset + fire-and-forget DROPs on logout / dashboard-switch | Phase 15 LIFE-V13-03/04 | Prevents orphan client view-name state at session boundary; Kinetica TTL handles server-side orphans regardless. |
| No "filtering..." indicator (existing `loading` covered both phases) | Two visual phases: badge during materialize (chart data visible underneath), then `loading` covers chart query | Phase 15 FILT-V13-04 | User sees fast feedback that filter click was acknowledged; existing data stays visible during the materialize round-trip. |

**Deprecated/outdated** (DELETED atomically in 15-02):
- `injectWhereClause` from `filterStore.ts:167-195`
- `buildWhereClause` from `filterStore.ts:151-154`
- `escapeKineticaStringLiteral` from `filterStore.ts:112-114`
- `buildEqualityFilter` from `filterStore.ts:124-149`
- Corresponding test blocks in `filterStore.spec.ts:162-291`

**Still in use after 15-02 (Phase 16 cleanup)**:
- WMS `QUERY` / `FILTER_PARAM` block in `wmsUrlBuilder.ts:229-234` (no `_v` cache-buster references in `MapChartRenderer.tsx` after 15-02 if Option A migrates the callsites — see Critical Pitfall 1)
- `MapChartRenderer.tsx` Effect 3 dep array `[filterVersion, includedLayers, tables]` → Phase 16 swaps to `viewsKey`

## Open Questions

1. **MapChartRenderer's two `buildWhereClause` callsites — migrate in 15-02 or accept dead-code-deletion timing slip?**
   - What we know: The four utilities are imported and called at `MapChartRenderer.tsx:42, 316, 414`; spec mocks at `MapChartRenderer.spec.tsx:165-166`. CONTEXT.md locks "atomic deletion in 15-02"; ROADMAP locks LAYERS-swap to Phase 16.
   - What's unclear: Whether the user intended Option A (migrate map callsites in 15-02) or implicitly assumed map renderer was already clean.
   - Recommendation: **Option A — migrate to empty whereClause in 15-02 with explicit Phase 16 cleanup tag**. See Critical Pitfall 1 for full analysis. Surface this in plan-check; if user wants to revisit the lock, planner re-engages.

2. **`FilterViewEntry.dashboardId` extension timing — 15-02 (recommended) or 15-05?**
   - What we know: 15-05 cleanup loops at logout / dashboard-switch need a dashboardId source per entry. Either store on the entry or derive from current page state. CONTEXT.md recommends storing on entry, planner picks timing.
   - What's unclear: Cohesion vs tight scoping.
   - Recommendation: **15-02** — same plan that wires `setView` / `markMaterializing` callers (which now need to pass dashboardId). Avoids forward-reference in 15-05.

3. **`<FilteringBadge>` component vs inline JSX — DRY tradeoff?**
   - What we know: Two consumers (AggregatedWidgetRenderer + RecordsTableRenderer) need identical badge rendering; both subscribe to `useFilterViewStore.views[tableId]?.materializing`.
   - What's unclear: Component centralizes (recommend) vs inline is shorter (acceptable).
   - Recommendation: **Component** — `FilteringBadge.tsx` + `FilteringBadge.spec.tsx`. ~30 LOC; centralizes selector + spinner CSS; testable in isolation.

4. **Reactive recovery: re-fire `markMaterializing` on retry?**
   - What we know: User-locked max 1 retry. Question is whether the retry's materialize call also calls `markMaterializing` (showing the badge during retry's materialize phase).
   - What's unclear: UX preference; not explicitly in CONTEXT.md.
   - Recommendation: **Yes** — for badge consistency; user sees "Filtering..." during retry's materialize phase, then chart data on success or fall-through.

5. **`isViewNotFoundError` location — `src/lib/kineticaErrors.ts` (new file) vs `src/api/client.ts` (existing)?**
   - What we know: CONTEXT.md flags as Discretion. Two existing patterns: helpers co-located in `client.ts` (bigger; ~613 LOC), or new file (smaller, single-purpose). `cardinalityProbe.ts` and `columnTypes.ts` are precedent for `src/lib/*.ts` single-purpose helpers.
   - Recommendation: **New file `src/lib/kineticaErrors.ts`** — single-purpose, easy to test, future Kinetica-specific error helpers extend it (e.g., DDL-permission-denied detection).

6. **OIDC S2.b re-probe — Phase 15 surfaces or pure Phase 17 ownership?**
   - What we know: STATE.md tagged it for Phase 15 LIFE-V13-02 OR Phase 17. CONTEXT.md migrated to Phase 17 (user lock).
   - What's unclear: Whether Phase 15 has any vector to surface it.
   - Recommendation: **No Phase 15 work**. Phase 15 supertest coverage stays as-is (existing Phase 13 supertests at `tests/routes.filter.materialize.spec.ts` cover both `AUTH_MODE=password` and `AUTH_MODE=oidc` with stubbed sessions; sufficient for Phase 15 to ship).

7. **Records-table-only dashboard with no AggregatedWidgetRenderer — known limitation, plan acknowledges?**
   - What we know: VSTORE-V13-02 / FILT-V13 lock `AggregatedWidgetRenderer` as sole materialize trigger. If a dashboard has ONLY a records table on a given tableId, materialize never fires.
   - What's unclear: Whether to add inline guard / log / TODO comment.
   - Recommendation: **Inline comment in 15-03 RecordsTableRenderer**: `// V13-LIMIT-01: pure consumer; materialize fires from sibling AggregatedWidgetRenderer on same tableId. Records-table-only dashboard = no filtering until v1.4 (acceptable per v1.3 lock).` Phase 17 verification surfaces if it bites users.

## Validation Architecture

> Phase 15 ships with `nyquist_validation: false` in `.planning/config.json`, but the additional_context EXPLICITLY requested this section to populate planner `acceptance_criteria`. Section provided per request.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest 4.1.5 + @testing-library/react 16.3.2 + jsdom 29.1.1 |
| Config file | `kinetica_bi/vitest.config.ts` |
| Quick run command | `cd kinetica_bi && npx vitest run --reporter=basic <spec-path>` |
| Full suite command | `cd kinetica_bi && npx vitest run` |
| Type-check command | `cd kinetica_bi && npx tsc --noEmit` |
| Server-side check | `cd kinetica_bi/server && npx vitest run` (no Phase 15 server changes; included for safety) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| FILT-V13-01 | Click chart element → debounce → materialize → FROM-swap → re-render | renderer integration | `npx vitest run src/components/charts/WidgetRenderer.spec.tsx -t "FILT-V13-01"` | ✅ extends existing 566-LOC spec |
| FILT-V13-02 | RecordsTableRenderer FROM-swap; total count narrows | renderer integration | `npx vitest run src/components/charts/WidgetRenderer.spec.tsx -t "FILT-V13-02"` | ✅ extends existing |
| FILT-V13-03 | No filters → raw table query, zero materialize call | renderer integration | `npx vitest run src/components/charts/WidgetRenderer.spec.tsx -t "FILT-V13-03"` | ✅ extends existing |
| FILT-V13-04 | "Filtering..." badge during materialize; chart data visible underneath; loading covers chart-query phase | renderer integration | `npx vitest run src/components/charts/WidgetRenderer.spec.tsx -t "FILT-V13-04"` | ✅ extends existing |
| FILT-V13-05 | `tsc --noEmit` clean after 4-utility deletion; spec blocks gone | type-check + spec | `cd kinetica_bi && npx tsc --noEmit && npx vitest run src/store/filterStore.spec.ts` | ✅ extends `filterStore.spec.ts` |
| LIFE-V13-01 | Proactive `expiresAt` check → silent re-materialize | renderer integration | `npx vitest run src/components/charts/WidgetRenderer.spec.tsx -t "LIFE-V13-01"` | ✅ extends existing |
| LIFE-V13-02 | Reactive view-not-found → clearView + re-materialize + retry once; max 1 retry | renderer integration + lib unit | `npx vitest run src/components/charts/WidgetRenderer.spec.tsx -t "LIFE-V13-02" && npx vitest run src/lib/kineticaErrors.spec.ts` | ❌ Wave 0 — `src/lib/kineticaErrors.ts` + `.spec.ts` need creation |
| LIFE-V13-03 | Logout fires `useFilterViewStore.reset()` + fire-and-forget DROPs | App-level integration | `npx vitest run src/App.spec.tsx` (NEW spec — Wave 0) | ❌ Wave 0 — no `App.spec.tsx` exists today |
| LIFE-V13-04 | Dashboard-switch fires `useFilterViewStore.reset()` + fire-and-forget DROPs | DashboardsPage integration | `npx vitest run src/components/DashboardsPage.spec.tsx` (NEW spec — Wave 0) | ❌ Wave 0 — no `DashboardsPage.spec.tsx` exists today |
| LIFE-V13-05 | No client cleanup on page refresh | manual / acknowledged | (no automated test — Kinetica TTL is server-side) | N/A |

### Sampling Rate

- **Per task commit:** `cd kinetica_bi && npx tsc --noEmit && npx vitest run --reporter=basic <relevant-spec-glob>` (< 30s for individual specs)
- **Per wave merge:** `cd kinetica_bi && npx tsc --noEmit && npx vitest run` (full suite; ~2-5 min depending on hardware)
- **Phase gate:** Full suite green + `tsc --noEmit` clean before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `kinetica_bi/src/lib/fromSwap.ts` — FROM-swap regex helper (15-02)
- [ ] `kinetica_bi/src/lib/fromSwap.spec.ts` — unit tests for fromSwap helper (15-02)
- [ ] `kinetica_bi/src/lib/kineticaErrors.ts` — `isViewNotFoundError` helper (15-04)
- [ ] `kinetica_bi/src/lib/kineticaErrors.spec.ts` — unit tests for `isViewNotFoundError` (15-04)
- [ ] `kinetica_bi/src/components/DashboardContext.tsx` — context provider + hook (15-01)
- [ ] `kinetica_bi/src/components/DashboardContext.spec.tsx` — provider/consumer tests + missing-context throw (15-01)
- [ ] `kinetica_bi/src/components/FilteringBadge.tsx` — reusable badge component (15-02 — recommended)
- [ ] `kinetica_bi/src/components/FilteringBadge.spec.tsx` — badge tests (15-02)
- [ ] `kinetica_bi/src/App.spec.tsx` — App-level integration test for logout cleanup (15-05) — **may be deferred to Phase 17 e2e if planner judges App-level test infrastructure is over-engineering for one effect**
- [ ] `kinetica_bi/src/components/DashboardsPage.spec.tsx` — DashboardsPage integration test for dashboard-switch cleanup (15-05) — same deferral note
- [ ] CSS additions in `kinetica_bi/src/styles/global.css` — `.widget-filtering-badge`, `.widget-filtering-spinner`, `@keyframes filtering-spin` (15-02)
- [ ] Framework install: **none** — vitest, @testing-library/react, jsdom all already in `package.json`

## Sources

### Primary (HIGH confidence)

- `kinetica_bi/src/components/charts/WidgetRenderer.tsx:198-253` — AggregatedWidgetRenderer Phase 9 baseline
- `kinetica_bi/src/components/charts/WidgetRenderer.tsx:852-1068` — RecordsTableRenderer Phase 9/10 baseline
- `kinetica_bi/src/store/filterStore.ts:104-195` — Four utility functions to delete (lines exact: 112-114, 124-149, 151-154, 167-195)
- `kinetica_bi/src/store/filterStore.spec.ts:162-291` — Four utility test blocks to delete
- `kinetica_bi/src/store/filterViewStore.ts:42-98` — Phase 14 store; verified shape + actions
- `kinetica_bi/src/api/client.ts:556-612` — Phase 14 helpers `materializeFilter` / `dropFilterView`
- `kinetica_bi/src/api/client.ts:7-32` — Typed-error classes
- `kinetica_bi/src/api/client.ts:63-79` — `throwForStatus` (HTTP 400 falls through to generic `Error` — see Pitfall 8)
- `kinetica_bi/src/App.tsx:40-44` — Logout reset existing site
- `kinetica_bi/src/components/DashboardsPage.tsx:379-383` — Dashboard-switch cleanup existing site
- `kinetica_bi/src/components/DashboardsPage.tsx:721-761` — Widget grid mount site for `DashboardContextProvider` (15-01)
- `kinetica_bi/src/components/DashboardsPage.tsx:734-756` — Widget card chrome (badge insertion point)
- `kinetica_bi/src/styles/global.css:399-463` — Widget card CSS (no existing spinner — Pitfall 6)
- `kinetica_bi/src/components/charts/MapChartRenderer.tsx:42, 316, 414` — `buildWhereClause` callsites (Critical Pitfall 1)
- `kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx:165-167` — Mock entries for buildWhereClause/injectWhereClause
- `kinetica_bi/src/lib/wmsUrlBuilder.ts:229-234` — QUERY/FILTER_PARAM emission (Phase 16 cleanup)
- `kinetica_bi/src/lib/wmsUrlBuilder.spec.ts:470-492` — FILT-04 test block (Phase 16 deletion)
- `kinetica_bi/src/store/toast.ts` — `useToastStore.getState().showToast` for materialize-failure routing
- `kinetica_bi/__mocks__/zustand.ts` + `kinetica_bi/src/test/setup.ts` — Reset shim auto-coverage for `useFilterViewStore`
- `kinetica_bi/server/src/index.ts:667-728` — Phase 13 endpoint contract (POST + DELETE shape)
- `kinetica_bi/server/src/index.ts:702` — `expiresAt = Date.now() + 5 * 60 * 1000` (server-side TTL math)
- `.planning/REQUIREMENTS.md § Chart Filtering (FROM-swap), § Lifecycle & Recovery` — FILT-V13-01..05, LIFE-V13-01..05 specs
- `.planning/STATE.md` — Phase 13/14 lockdown; spike S3 verbatim error capture
- `.planning/phases/15-chart-filtering/15-CONTEXT.md` — All Phase 15 user-locked decisions
- `.planning/phases/14-filter-view-store/14-CONTEXT.md` — Phase 14 user-locks Phase 15 inherits
- `.planning/phases/14-filter-view-store/14-RESEARCH.md` — Templates + pitfalls Phase 15 reuses
- `.planning/phases/13-spikes-and-endpoint/13-CONTEXT.md` + `13-SPIKE-NOTES.md` — Endpoint contract + S3 verbatim error capture
- `.planning/research/PITFALLS.md` — V13-P-01..12 (carry-forward); v1.2 C-02 / S-02 / D-04 / AP-3
- `.planning/codebase/CONVENTIONS.md` — TS strict; relative imports only; 2-space indent; no formatter
- `.planning/codebase/STRUCTURE.md` — `src/store/`, `src/components/`, `src/lib/`, `src/api/` placement
- `.planning/codebase/STACK.md` — Existing dependency baseline; zero new client deps
- `.planning/codebase/TESTING.md` — Spec naming + setup conventions

### Secondary (MEDIUM confidence)

- `kinetica_bi/src/components/charts/WidgetRenderer.spec.tsx:1-100` — Existing mock pattern for renderer specs (566 LOC total — Phase 15 extends)
- `kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx:147-180` — Reference for `vi.mock("../../store/filterStore")` pattern
- `kinetica_bi/src/components/LayersModal.tsx:14-16` — 300ms debounce comment (parent-owned debounce pattern)
- `kinetica_bi/src/store/filterStore.spec.ts:18-32` — Canary pattern (zustand reset shim)
- `kinetica_bi/package.json` — Pinned versions; zero new deps needed

### Tertiary (LOW confidence — flagged for validation)

- Reactive-recovery max-1-retry semantics — based on CONTEXT.md user lock; no live deployment trace yet (Phase 17 verification confirms)
- "Filtering..." badge sub-100ms flicker UX acceptance — based on user's stated preference; not yet UAT-validated
- ChartConfigPanel SQL shape predictability for `fromSwap` regex — verified against Phase 9 RESEARCH but not against every possible widget config (Phase 17 verification covers)

## Metadata

**Confidence breakdown:**

- **Standard stack:** HIGH — every dep already in `package.json`; verified by direct file reads
- **Architecture / patterns:** HIGH — every pattern has an exact in-repo template (Phase 9 chart-query effect, LayersModal debounce, dashboardLayersStore ref-stable updates, react-redux fail-loud context idiom)
- **API contract (Phase 13/14 inheritance):** HIGH — endpoint contract verified by reading `server/src/index.ts:667-728` and `client.ts:556-612`
- **Pitfalls:** HIGH — Critical Pitfall 1 (MapChartRenderer dead-code blocker) is a NEW finding from this research not surfaced in CONTEXT.md; Pitfalls 2-9 are documented carry-forwards from Phase 13/14 PITFALLS.md
- **Plan-staging discretion items:** MEDIUM — recommendations made; planner can deviate based on plan-check feedback
- **Validation Architecture:** MEDIUM — `nyquist_validation: false` for this run; section provided per explicit request; tests exist as Wave 0 file gaps

**Research date:** 2026-05-06
**Valid until:** 2026-06-05 (30 days for stable research; refresh if Phase 15 starts after that date or if `package.json` deps change in the interim, or if Phase 14's `filterViewStore.ts` / `client.ts` helper signatures change)

---

*Phase: 15-chart-filtering*
*Researcher: gsd-researcher*
*Companion files: 15-CONTEXT.md (user decisions); 14-RESEARCH.md (template inheritance); 14-CONTEXT.md (Phase 14 locks Phase 15 inherits)*
