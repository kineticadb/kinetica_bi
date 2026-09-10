# Phase 48: /me Extension + Frontend Store + UI Gating - Research

**Researched:** 2026-06-05
**Domain:** Frontend RBAC gating — store extension, apiFetch dispatch, permission-keyed UI hide/show, Topbar identity replacement, test migration
**Confidence:** HIGH (all findings verified from live source code)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **Widget gear/configure affordance HIDDEN entirely** for users without `widgets:configure` — consistent hide-don't-disable. ChartConfigPanel needs NO read-only mode in v1.8 — panel is only reachable by users who can configure.
- **Widget delete (×) and add-widget (+) hidden** without `dashboards:edit` (already locked).
- On any `PERMISSION_DENIED` response: **error toast naming the permission** ("You no longer have permission: dashboards:edit") **+ automatic `/api/auth/me` re-fetch** updating `useAuthStore` so gated surfaces re-render immediately (self-healing UI).
- Implement PERMISSION_DENIED handling in `apiFetch` dispatch layer mirroring the existing `REAUTH_REQUIRED` code-based dispatch pattern (`packages/web/src/api/client.ts`).
- Topbar shows **real authenticated username + role chips** from `/me` (e.g. "rpereira — designer, user admin"). Bootstrap admin shows its roles as "admin".
- Initials derived from username (first letters; fallback first two chars).
- **Delete the vestigial `useUserStore`** (`packages/web/src/store/user.ts`, hardcoded "Data Engineer / Admin") and its Topbar usage.
- Unassigned (analyst-default) users: chips show "analyst".
- **No "view only" hint/badge** — hidden surfaces are simply absent.
- Analyst click-through exploration (filters, drill-down, map draw, info popups, data-filter widget USAGE) remains fully functional.

### Claude's Discretion

- Exact hasPermission selector implementation (Set vs array lookup)
- How gating conditions read in JSX (inline hasPermission calls vs derived booleans)
- Drag/resize inert mechanics for react-grid-layout (isDraggable/isResizable static props)
- Toast wording details; /me re-fetch debounce (avoid stampede if N parallel 403s)
- Test approach for gated rendering (RTL with store-seeded permission states)

### Deferred Ideas (OUT OF SCOPE)

- ChartConfigPanel read-only/inspect mode — dropped for v1.8 (gear hidden instead); revisit if analysts ask to "see how a chart is built"
- "View only" badge — revisit post-rollout if shared-screen confusion reported
- Users/Roles management pages — Phases 49/50 (nav items gated here, pages built there)

</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| GATE-V18-01 | `/api/auth/me` response widened with `roles: string[]` + `permissions: string[]`; `useAuthStore` extended with `hasPermission(perm)` selector | Server `/me` handler at index.ts:327–338 identified; `MeResponse` type in client.ts:105; `useAuthStore` shape in store/auth.ts; `getEffectiveRolesAndPermissions` from Phase 46 lib/rbacDb.ts is the ready-to-call primitive |
| GATE-V18-02 | DashboardsPage action-bar buttons hidden per permission | Exact elements catalogued — New Dashboard (list view), Edit/Delete (list row + DashboardDetail), Dynamic Views/Map Layers/Visualizations (DashboardOpen toolbar) — with file:line references in §Gating-Point Inventory |
| GATE-V18-03 | Widget grid — add-widget and widget-delete hidden, drag/resize inert without `dashboards:edit` | `dragConfig`/`resizeConfig` props at DashboardsPage.tsx:889–890 confirmed; gear+xmark buttons at lines 919–932 |
| GATE-V18-04 | ChartConfigPanel renders read-only (save/apply hidden) without `widgets:configure` — REINTERPRETED as gear hidden | Gear renders at DashboardsPage.tsx:919–925; decision: hide gear entirely, no read-only panel |
| GATE-V18-05 | Sidebar nav — "User Management" gated on `users:view`, "Roles" gated on `roles:view` | Sidebar.tsx nav array at lines 18–22: currently 3 items (Dashboards, Datasets, Settings); "User Management" and "Roles" are net-new items to add |

</phase_requirements>

---

## Summary

Phase 48 is a pure-frontend phase with one small server change. The server side requires adding `getEffectiveRolesAndPermissions(username)` (already built in Phase 46 lib/rbacDb.ts) to the existing `/api/auth/me` handler — roughly 5 lines. The frontend work has five distinct areas, the most dangerous of which is test migration.

The existing test suite has ~20+ DashboardsPage specs and ~11 Sidebar specs that assert button and nav-item presence by name. Once those affordances are conditionally gated behind `hasPermission`, the default auth store state (no `permissions` field = empty array) will cause every gated button to vanish from the DOM — breaking all assertions that expect "Dynamic Views", "Map Layers", "Visualizations", "Edit", "Delete" etc. to be present. This is the direct frontend analog of Phase 47's `createAdminSession()` migration, and it MUST be resolved in the same phase that adds gating, not as a follow-up.

The `useUserStore` deletion is total: exactly one file imports it (`Topbar.tsx`). Replacing it with real identity from `useAuthStore` is a contained change with no hidden consumers.

The apiFetch PERMISSION_DENIED dispatch is a one-branch addition alongside the existing REAUTH_REQUIRED block. Toast dispatch from outside React is already established via `useToastStore.getState().showToast()` (the pattern is in DashboardsPage.tsx). A debounce on the `/me` re-fetch prevents a burst of N parallel 403s each triggering N refetches.

The frontend permissions mirror (`packages/web/src/lib/permissions.ts`) follows the exact `dynamicViewName.ts` precedent: copy the PERMISSIONS constant, mark it "byte-parity with server", add a spec that hardcodes all strings independently to catch drift.

**Primary recommendation:** Wave 1 = permissions mirror + /me server extension + store extension + client.ts type updates. Wave 2 = apiFetch PERMISSION_DENIED dispatch. Wave 3 = UI gating (DashboardsPage + WidgetRenderer gear/delete + Sidebar + Topbar). Wave 4 = test migration (seed hasPermission in every spec that touches gated affordances).

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| zustand | existing | Store extension | Already used; additive pattern locked from v1.1 Phase 7 |
| react-grid-layout | existing | Widget grid drag/resize inert control | `dragConfig`/`resizeConfig` props already in DashboardsPage |
| @testing-library/react | existing | RTL spec updates | Established test infra |
| vitest | existing | Test runner | Project standard |

No new dependencies. This phase is pure-TypeScript on existing libraries.

**Installation:** none required.

---

## Architecture Patterns

### Pattern 1: Additive Store Extension (AUTH_MODE Precedent from Phase 7)

**What:** Add `roles`, `permissions` fields and `hasPermission` selector to existing `useAuthStore` without creating a new store or adding to the reset chain.

**When to use:** When state has the same session lifetime as existing auth state (permissions are cleared on logout/session expiry just like `user`).

**Exact current shape** (`packages/web/src/store/auth.ts`):
```typescript
type AuthState = {
  status: AuthStatus;
  user: AuthUser | null;      // AuthUser = { username: string }
  error: string | null;
  reason: AuthReason;
  authMode: AuthModeOrNull;
  bootstrap: () => Promise<void>;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  markUnauthenticated: (reason?: AuthReason) => void;
};
```

**Required additions:**
```typescript
// In client.ts — widen AuthUser and MeResponse
export type AuthUser = { username: string; roles: string[]; permissions: string[] };
export type MeResponse = { user: AuthUser; authMode: AuthMode };

// In store/auth.ts — add selector and reset path
type AuthState = {
  // ... existing fields ...
  hasPermission: (perm: string) => boolean;
};
```

The `bootstrap()` flow already calls `fetchMe()` and does `set({ user: me.user, ... })`. Widening `AuthUser` to include roles+permissions means the bootstrap path automatically threads them through — no new fetch call needed.

**Critical:** `hasPermission` must read from `get()` (not a closure over `permissions`) to avoid stale-closure bugs when permissions update mid-session. Use a `Set<string>` for O(1) lookup:
```typescript
hasPermission: (perm) => new Set(get().user?.permissions ?? []).has(perm)
```

### Pattern 2: apiFetch PERMISSION_DENIED Dispatch (Mirror of REAUTH_REQUIRED)

**Current REAUTH_REQUIRED seam** (`packages/web/src/api/client.ts`, lines 41–58):
```typescript
const apiFetch: typeof fetch = async (input, init) => {
  const response = await fetch(input, { ...init, credentials: "include" });
  if (response.status === 401 && typeof window !== "undefined") {
    let shouldDispatch = false;
    try {
      const peek = await response.clone().json();
      if (peek?.code === "REAUTH_REQUIRED") {
        shouldDispatch = true;
      }
    } catch { }
    if (shouldDispatch) {
      window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT));
    }
  }
  return response;
};
```

**PERMISSION_DENIED branch slots in after the 401 block.** The 403 body contract from Phase 47 is `{ error, code: "PERMISSION_DENIED", permission: "<perm string>" }`. Toast dispatch outside React uses the already-established `useToastStore.getState().showToast(...)` pattern (seen in DashboardsPage.tsx flushPendingPatches, createLayer, etc.).

The `/me` re-fetch must be debounced. A module-level `let permissionDeniedRefetchTimer: ReturnType<typeof setTimeout> | null = null` prevents stampede when N parallel requests all return 403 simultaneously.

**Key:** `PermissionError` class (status 403) already exists in client.ts line 19. `throwForStatus` already throws it at line 77. The PERMISSION_DENIED dispatch in `apiFetch` runs BEFORE the caller's `throwForStatus` — same as REAUTH_REQUIRED dispatch running before the caller's error handling.

### Pattern 3: UI Gating with Hide Semantics

**Established precedent:** `useApiQuery` error handling already uses `error.kind === "permission"` to show "Permission denied" in DashboardsPage.tsx (lines 148–150, 735–738) instead of the raw error. The hide-not-disable pattern is already practiced.

**Pattern for gating in JSX:**
```typescript
// In component body
const canEdit = useAuthStore((s) => s.hasPermission(PERMISSIONS.DASHBOARDS_EDIT));

// In JSX
{canEdit && <button onClick={() => setView({ mode: "edit", dashboard: dash })}>Edit</button>}
```

Or using derived booleans for performance (avoids re-subscribing on every render):
```typescript
const { canCreate, canEdit, canDelete, canLayers, canDynamicViews } = useAuthStore((s) => ({
  canCreate: s.hasPermission(PERMISSIONS.DASHBOARDS_CREATE),
  canEdit: s.hasPermission(PERMISSIONS.DASHBOARDS_EDIT),
  canDelete: s.hasPermission(PERMISSIONS.DASHBOARDS_DELETE),
  canLayers: s.hasPermission(PERMISSIONS.LAYERS_MANAGE),
  canDynamicViews: s.hasPermission(PERMISSIONS.DYNAMIC_VIEWS_MANAGE),
}));
```

### Pattern 4: react-grid-layout Drag/Resize Inert

**Current config** (`DashboardsPage.tsx` lines 888–891):
```tsx
<ResponsiveGridLayout
  dragConfig={{ enabled: true, handle: ".widget-drag-handle" }}
  resizeConfig={{ enabled: true }}
>
```

This is the project's custom wrapper `ResponsiveGridLayout` from `react-grid-layout`. To make it inert without `dashboards:edit`:
```tsx
<ResponsiveGridLayout
  dragConfig={{ enabled: canEdit, handle: ".widget-drag-handle" }}
  resizeConfig={{ enabled: canEdit }}
>
```

This is cleaner than `isDraggable`/`isResizable` on individual layout items. The custom wrapper likely passes `dragConfig.enabled` directly to the underlying `isDraggable` prop on the GridLayout.

### Pattern 5: Frontend Permissions Mirror Module

**Precedent:** `packages/web/src/lib/dynamicViewName.ts` — pure module, no imports, inlines the sanitize logic with a comment "INTENTIONALLY INLINED — parity enforced by spec, not by cross-tree imports."

**New file:** `packages/web/src/lib/permissions.ts`
```typescript
/**
 * Frontend mirror of packages/server/src/lib/permissions.ts.
 * BYTE-PARITY: PERMISSIONS constant values must match server exactly.
 * Parity enforced by spec (independently hardcodes all expected strings).
 * Pure module — zero imports, zero runtime side effects.
 */
export const PERMISSIONS = {
  DASHBOARDS_VIEW:          "dashboards:view",
  DASHBOARDS_CREATE:        "dashboards:create",
  DASHBOARDS_EDIT:          "dashboards:edit",
  DASHBOARDS_DELETE:        "dashboards:delete",
  WIDGETS_CONFIGURE:        "widgets:configure",
  LAYERS_MANAGE:            "layers:manage",
  DYNAMIC_VIEWS_MANAGE:     "dynamic_views:manage",
  DATA_FILTERS_CONFIGURE:   "data_filters:configure",
  USERS_VIEW:               "users:view",
  USERS_ASSIGN_ROLES:       "users:assign_roles",
  ROLES_VIEW:               "roles:view",
  ROLES_MANAGE_PERMISSIONS: "roles:manage_permissions",
  ROLES_CREATE_CUSTOM:      "roles:create_custom",
  ROLES_DELETE_CUSTOM:      "roles:delete_custom",
  AUDIT_VIEW:               "audit:view",
  DATASETS_MANAGE:          "datasets:manage",
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];
```

Spec independently hardcodes all 16 strings to catch source typos (same pattern as Phase 46 catalog spec).

### Pattern 6: Topbar Identity Replacement

**Current identity source:** `useUserStore` (hardcoded "Data Engineer" / "Admin"). Sole consumer: `Topbar.tsx`.

**Deletion scope:** `packages/web/src/store/user.ts` (entire file), `Topbar.tsx` import line 3 and usage at line 7.

**Replacement:** `useAuthStore((s) => s.user)` provides `{ username, roles, permissions }` after Phase 48. Initials: `username.slice(0, 2).toUpperCase()` with "?" fallback during loading.

**Role chips:** Render `user.roles` as `<span class="role-chip">{role}</span>` elements. If `user.roles` is empty (shouldn't happen post-/me, but defensive), derive from permissions presence or show nothing.

**No App.spec.tsx or other spec imports useUserStore** — only Topbar.tsx. The App.spec.tsx mocks Topbar entirely (`vi.mock("./components/Topbar", () => ...)`) so Topbar internals are not under test in App.spec.tsx.

### Recommended Project Structure (new files)

```
packages/web/src/
├── lib/
│   └── permissions.ts          # NEW: client mirror of server catalog
│   └── permissions.spec.ts     # NEW: byte-parity verification spec
└── store/
    └── auth.ts                 # MODIFIED: + roles/permissions fields + hasPermission
```

```
packages/web/src/api/
└── client.ts                   # MODIFIED: + PERMISSION_DENIED dispatch in apiFetch
                                #           + AuthUser roles/permissions fields
                                #           + MeResponse threading
packages/server/src/
└── index.ts                    # MODIFIED: /me handler (line 327) adds roles+permissions
```

```
packages/web/src/components/
├── DashboardsPage.tsx           # MODIFIED: gating on 7 action-bar + grid affordances
├── Sidebar.tsx                  # MODIFIED: + 2 new gated nav items
└── Topbar.tsx                   # MODIFIED: useUserStore → useAuthStore + role chips
packages/web/src/store/
└── user.ts                      # DELETED
```

### Anti-Patterns to Avoid

- **Don't add permissions to the reset chain.** `useAuthStore` reset is intentionally NOT extended (permissions have the same session lifetime as `user` — they vanish with `markUnauthenticated`). Adding to reset would be a no-op (markUnauthenticated sets user=null → hasPermission returns false immediately).
- **Don't create a separate `usePermissionsStore`.** The architecture doc (STATE.md v1.8 locked decisions) mandates extending useAuthStore, not creating a new store.
- **Don't scatter PERMISSIONS string literals in JSX.** All strings go through `PERMISSIONS.DASHBOARDS_EDIT` from the mirror module. TypeScript catches typos at compile time.
- **Don't poll `/me` for permission changes.** Self-healing on first denied action is sufficient — server enforcement is authoritative.
- **Don't wire `fetchMe` inside `apiFetch`'s PERMISSION_DENIED handler without debounce.** Parallel 403s (e.g., dashboard list + widget list both returning 403) would trigger N simultaneous `/me` re-fetches.

---

## Gating-Point Inventory (Complete)

All UI elements requiring permission checks with their exact source locations:

### DashboardsPage — List View (lines 136–190)
| Element | Permission | Location | Action |
|---------|------------|----------|--------|
| `+ New Dashboard` button | `dashboards:create` | line 142 | Hide |
| Per-row `Edit` button | `dashboards:edit` | line 174 | Hide |
| Per-row `Delete` button | `dashboards:delete` | line 179 | Hide |

### DashboardsPage — DashboardDetail (lines 192–230)
| Element | Permission | Location | Action |
|---------|------------|----------|--------|
| `Edit` button | `dashboards:edit` | line 207 | Hide |

### DashboardsPage — DashboardOpen toolbar (lines 710–730)
| Element | Permission | Location | Action |
|---------|------------|----------|--------|
| `Dynamic Views` button | `dynamic_views:manage` | line 720 | Hide |
| `Map Layers` button | `layers:manage` | line 723 | Hide |
| `Visualizations` button (add-widget modal trigger) | `dashboards:edit` | line 726 | Hide |

Note: `Tables` button (line 717) — the FEATURES.md table does NOT list a separate permission for table association. `datasets:manage` gates `POST/PATCH/DELETE /api/tables` (dataset CRUD), NOT table-to-dashboard association. Table association routes (`POST/DELETE /api/dashboards/:id/tables`) are mutation routes gated in Phase 47. The research must confirm what Phase 47 gated this on before the planner decides whether to hide the Tables button. **OPEN QUESTION: what permission gates `POST /api/dashboards/:dashboardId/tables`?** (Likely `dashboards:edit` — GATE-V18-02 includes "edit dashboard metadata and widgets"; association changes count as edit.)

### DashboardsPage — Widget Grid (lines 880–944)
| Element | Permission | Location | Action |
|---------|------------|----------|--------|
| `dragConfig.enabled` | `dashboards:edit` | line 889 | Set `enabled: false` |
| `resizeConfig.enabled` | `dashboards:edit` | line 890 | Set `enabled: false` |
| Gear (configure) button | `widgets:configure` | line 919–925 | Hide (CONTEXT: gear hidden, no read-only mode) |
| × (remove) button | `dashboards:edit` | line 926–931 | Hide |

### Sidebar — Nav Items (lines 18–22)
| Element | Permission | Location | Action |
|---------|------------|----------|--------|
| `User Management` | `users:view` | NEW nav item | Hide if absent |
| `Roles` | `roles:view` | NEW nav item | Hide if absent |

Existing items (Dashboards, Datasets, Settings) are NOT gated (all roles have `dashboards:view`; Datasets and Settings have no explicit permission in the catalog).

### DatasetsPage surfaces
DatasetsPage has `+ New Dataset`, `Edit`, and `Delete` buttons. The permission `datasets:manage` gates `POST/PATCH/DELETE /api/tables`. The FEATURES.md UI Surface → Permission Mapping table does NOT include DatasetsPage affordances in the GATE-V18-01..05 scope. The requirements (GATE-V18-02..05) say nothing about DatasetsPage. **These are OUT OF SCOPE for Phase 48** — they are not listed in GATE-V18-01..05. Note they will return 403 from the server when pressed by non-designers (server enforcement is live from Phase 47), but the frontend affordances remain unguarded in this phase. The existing `error.kind === "permission"` path in DatasetsPage (lines 80–82) already gracefully handles 403 responses.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Toast outside React | Custom event bus or global ref | `useToastStore.getState().showToast(...)` | Already used throughout DashboardsPage.tsx and established in v1.3+ |
| /me re-fetch debounce | setTimeout reinvention | Module-level timer ref in client.ts | Same file as the fetch call; mirrors materializeFilter's inFlightMaterialize dedup pattern |
| Permission string constants | Scattered string literals | `PERMISSIONS.DASHBOARDS_EDIT` from lib/permissions.ts | TypeScript catches typos at compile time; byte-parity with server |
| Store reset for permissions | New reset chain entry | Nothing — permissions cleared when `user` is set to null on markUnauthenticated | Permissions have session lifetime; hasPermission returns false when user is null |

---

## Common Pitfalls

### Pitfall 1: Spec Suite Collapse (THE highest-risk item)

**What goes wrong:** After gating buttons behind `hasPermission`, the Zustand reset shim (`packages/web/__mocks__/zustand.ts`) resets all stores to their initial state before each test. The initial state of `useAuthStore.user` is `null`, which means `hasPermission(anything) → false`, which means EVERY gated button is absent from the DOM.

**Affected tests (minimum):**
- `DashboardsPage.spec.tsx`: at least 8 tests that click "Dynamic Views", "Map Layers", "Visualizations", or assert they're present — lines 594–731
- `Sidebar.spec.tsx` line 31–35: `"renders the three nav items"` — will need updating when "User Management" and "Roles" are added; tests that count/name items will break
- `App.spec.tsx`: Topbar is mocked out — SAFE
- No Topbar.spec.tsx exists — SAFE (no spec to break)

**Exact count of DashboardsPage tests that will break:** Every test that calls `openDashboard()` and then asserts presence of "Dynamic Views" or "Map Layers" or gear/xmark affordances. From the spec: `describe("Phase 34 — Dynamic Views action-bar button")` has 3 tests; `describe("Phase 35 — useDynamicViewMaterializeChain")` has 4 tests — all of these click/assert these buttons.

**How to fix:** Seed the auth store with designer-level permissions before each affected test:
```typescript
beforeEach(() => {
  useAuthStore.setState({
    status: "authenticated",
    user: {
      username: "testuser",
      roles: ["designer"],
      permissions: Object.values(PERMISSIONS) // all permissions = admin-like
    }
  });
});
```
Or create a `seedDesignerStore()` helper in a test utils module.

**Why it happens:** Zustand reset shim at `__mocks__/zustand.ts` line 31: `storeResetFns.forEach((fn) => fn())` sets store back to initial state after every test. Initial auth store state has `user: null`.

**Warning signs:** TypeScript will not catch this. Tests fail with "Unable to find role button with name 'Dynamic Views'" — looks like a DOM/async issue but is actually a store-seeding issue.

### Pitfall 2: MeResponse fetchMe JSON Parsing

**What goes wrong:** `fetchMe` in client.ts line 131 does `return { user: json.user as AuthUser, authMode: json.authMode as AuthMode }`. After widening `AuthUser` to include `roles`/`permissions`, `json.user` must actually contain those fields. If the server `/me` handler is not updated first, `user.roles` will be `undefined` — `hasPermission` will crash or silently return false.

**How to avoid:** Wire the server change (index.ts `/me` handler) in Wave 1, before any frontend code reads `user.roles`. Type assertion catches nothing at runtime — the consumer code `user?.permissions ?? []` defensive default in `hasPermission` provides the safety net.

### Pitfall 3: Stale Closure in hasPermission Selector

**What goes wrong:** If `hasPermission` closes over `permissions` at store creation time instead of reading from current state at call time, it will never see updated permissions after a `/me` re-sync.

**How to avoid:** Implement as:
```typescript
hasPermission: (perm) => new Set(get().user?.permissions ?? []).has(perm)
```
NOT as:
```typescript
// WRONG — stale closure
const permissions = new Set(initialState.permissions ?? []);
hasPermission: (perm) => permissions.has(perm)
```

### Pitfall 4: useUserStore Consumers — Deletion Safety

**What goes wrong:** Deleting `store/user.ts` before confirming all consumers have been migrated.

**Research finding:** `useUserStore` has exactly two references:
1. `packages/web/src/store/user.ts` — the definition
2. `packages/web/src/components/Topbar.tsx` — the sole consumer (lines 3, 7)

No specs directly test `useUserStore` (App.spec.tsx mocks Topbar entirely). Deletion is safe as long as Topbar.tsx is migrated first.

### Pitfall 5: Sidebar Nav Item Count Tests

**What goes wrong:** Sidebar.spec.tsx line 31 asserts `"renders the three nav items"` by checking for exactly three named buttons (Dashboards, Datasets, Settings). After adding "User Management" and "Roles" as gated items, the test may need updating if the spec counts nav items.

**Research finding:** The Sidebar spec uses `getByRole("button", { name: "..." })` individually — it does NOT assert a total count of 3. The test at line 31 will NOT break because it only asserts the three named items are present. The new gated items will be hidden by default (no permissions in test store), so they won't appear unless explicitly seeded.

**Caution:** The test `"renders the three nav items with their labels (expanded)"` (line 31) only checks three buttons exist by name — it does not assert that ONLY three exist. Safe.

### Pitfall 6: DashboardsPage.spec.tsx Known-Red Baseline

**Pre-existing red test** (TD-V17-DASHPAGE-SPEC noted in STATE.md): one test in DashboardsPage.spec.tsx is already failing due to button-order expectations. Do not count this as a new Phase 48 regression. The count of known-red tests before this phase is 1 in frontend, 106 in server.

### Pitfall 7: PERMISSION_DENIED Toast — Infinite Loop Risk

**What goes wrong:** The PERMISSION_DENIED handler calls `fetchMe()` to re-sync permissions. If `fetchMe()` itself triggers a 403 (shouldn't happen — it's an unauthenticated endpoint returning 401 for unauth, not 403), the handler could loop.

**How to avoid:** Use raw `fetch` for the re-sync (same as the existing `fetchMe` implementation which intentionally uses raw `fetch` not `apiFetch` — client.ts line 124). The PERMISSION_DENIED dispatch in `apiFetch` should call the re-sync function that uses raw fetch internally, not `apiFetch`. The existing `fetchMe` already does this correctly.

---

## Code Examples

### /me Server Extension (packages/server/src/index.ts ~line 327)

Current handler:
```typescript
app.get("/api/auth/me", (req, res) => {
  const loaded = loadSessionForRequest(req);
  if (!loaded) {
    clearSessionCookie(res);
    return res.status(401).json({ error: "Not authenticated.", code: "REAUTH_REQUIRED" });
  }
  return res.json({ user: { username: loaded.session.username }, authMode });
});
```

Required change — add `getEffectiveRolesAndPermissions` call:
```typescript
app.get("/api/auth/me", (req, res) => {
  const loaded = loadSessionForRequest(req);
  if (!loaded) {
    clearSessionCookie(res);
    return res.status(401).json({ error: "Not authenticated.", code: "REAUTH_REQUIRED" });
  }
  const { roles, permissions } = getEffectiveRolesAndPermissions(loaded.session.username);
  return res.json({
    user: { username: loaded.session.username, roles, permissions },
    authMode
  });
});
```

`getEffectiveRolesAndPermissions` is in `packages/server/src/lib/rbacDb.ts` (Phase 46). It returns `{ roles: string[], permissions: string[] }` synchronously via better-sqlite3. Import it at the top of index.ts alongside other lib imports.

### PERMISSION_DENIED dispatch in apiFetch (client.ts, after existing 401 block)

```typescript
// After the existing 401 block (lines ~55-58), before return response:
if (response.status === 403 && typeof window !== "undefined") {
  try {
    const peek = await response.clone().json();
    if (peek && typeof peek === "object" && peek.code === "PERMISSION_DENIED") {
      const perm = typeof peek.permission === "string" ? peek.permission : "a required permission";
      useToastStore.getState().showToast(
        `You no longer have permission: ${perm}`, "permission"
      );
      // Debounced /me re-fetch — avoid stampede on parallel 403s.
      if (permissionDeniedRefetchTimer !== null) {
        clearTimeout(permissionDeniedRefetchTimer);
      }
      permissionDeniedRefetchTimer = setTimeout(() => {
        permissionDeniedRefetchTimer = null;
        fetchMe().then((me) => {
          if (me) {
            useAuthStore.getState().setPermissions(me.user.roles, me.user.permissions);
          }
        }).catch(() => {});
      }, 200); // collapse N parallel 403s into one re-fetch
    }
  } catch { }
}
```

Note: requires either adding `setPermissions` action to useAuthStore, or re-using `markAuthenticated`-style partial set. Claude's discretion per CONTEXT.md.

### Topbar Replacement Pattern

```typescript
// Topbar.tsx — replace useUserStore with useAuthStore
import { useAuthStore } from "../store/auth";
import { useThemeStore } from "../store/theme";

const Topbar = () => {
  const user = useAuthStore((s) => s.user);
  const theme = useThemeStore((s) => s.theme);
  const toggleTheme = useThemeStore((s) => s.toggleTheme);

  const initials = user
    ? user.username.slice(0, 2).toUpperCase()
    : "?";

  return (
    <header className="topbar">
      <div />
      <div className="top-actions">
        <button type="button" className="theme-toggle" onClick={toggleTheme}
          aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}>
          <FontAwesomeIcon icon={theme === "dark" ? faSun : faMoon} />
        </button>
        <div className="user-identity">
          <div className="avatar" aria-label="User avatar">{initials}</div>
          {user && (
            <div className="user-info">
              <span className="username">{user.username}</span>
              <div className="role-chips">
                {user.roles.map((r) => (
                  <span key={r} className="role-chip">{r.replace("_", " ")}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
```

### Test Store Seeding Pattern (for affected specs)

```typescript
// In beforeEach or per-test setup in DashboardsPage.spec.tsx and similar:
import { useAuthStore } from "../store/auth";
import { PERMISSIONS } from "../lib/permissions";

beforeEach(() => {
  // Seed designer-level permissions so gated buttons are visible in tests
  useAuthStore.setState({
    status: "authenticated",
    user: {
      username: "testdesigner",
      roles: ["designer"],
      permissions: [
        PERMISSIONS.DASHBOARDS_VIEW,
        PERMISSIONS.DASHBOARDS_CREATE,
        PERMISSIONS.DASHBOARDS_EDIT,
        PERMISSIONS.DASHBOARDS_DELETE,
        PERMISSIONS.WIDGETS_CONFIGURE,
        PERMISSIONS.LAYERS_MANAGE,
        PERMISSIONS.DYNAMIC_VIEWS_MANAGE,
        PERMISSIONS.DATA_FILTERS_CONFIGURE,
        PERMISSIONS.DATASETS_MANAGE,
      ]
    }
  });
});
```

---

## State of the Art

| Old | Current | Impact |
|-----|---------|--------|
| `useUserStore` with hardcoded "Data Engineer / Admin" | Deleted; `useAuthStore.user` carries real identity from `/me` | Topbar shows real username + roles |
| `MeResponse = { user: AuthUser, authMode: AuthMode }` where `AuthUser = { username }` | `AuthUser = { username, roles, permissions }` | Zero new fetch calls; widens existing types |
| apiFetch handles only 401 REAUTH_REQUIRED | apiFetch also handles 403 PERMISSION_DENIED with toast + re-sync | Self-healing stale-permissions UI |
| Sidebar has 3 static nav items | Sidebar has 3 static + 2 gated nav items | "User Management" and "Roles" gated on permissions |

---

## Open Questions

1. **What permission gates `POST /api/dashboards/:dashboardId/tables`?**
   - What we know: Phase 47 gated "tables association" routes. The 47-CONTEXT.md says "dashboards CRUD, widgets CRUD + config PATCH, tables association" is gated on `dashboards:edit`.
   - What's unclear: Whether the "Tables" button in the DashboardOpen toolbar (line 717) should be hidden. GATE-V18-02 lists 5 named buttons (New, Edit, Delete, Map Layers, Dynamic Views) — "Tables" is not in that list.
   - Recommendation: Hide the Tables button on `dashboards:edit` (table association is an edit-tier operation). If this interpretation is wrong, GATE-V18-02 is silent on it — flag to operator during VERIFY-V18-01. The Visualizations button similarly needs `dashboards:edit` (adding a widget = editing the dashboard). Neither are explicitly named in GATE-V18-02 but both are logically required for GATE-V18-03 completeness.

2. **`ResponsiveGridLayout` wrapper API for disabling drag/resize**
   - What we know: `dragConfig={{ enabled: true, handle: ".widget-drag-handle" }}` and `resizeConfig={{ enabled: true }}` at DashboardsPage.tsx:889–890 are the current props.
   - What's unclear: Whether `enabled: false` on `dragConfig`/`resizeConfig` is the correct API for the project's custom wrapper vs needing `isDraggable={false}` on individual layout items.
   - Recommendation: The implementor should check `packages/web/src/` for the `ResponsiveGridLayout` wrapper definition to confirm `dragConfig.enabled` propagates to `isDraggable`. If it doesn't, use per-item `isDraggable: false` in the `layouts` array.

3. **`fetchMe` return type after permissions widening**
   - Current: `return { user: json.user as AuthUser, authMode: json.authMode as AuthMode }` (line 131).
   - After widening: `json.user` will contain `roles` and `permissions`. The `as AuthUser` cast means TypeScript trusts the shape. No runtime check.
   - Recommendation: The cast is safe as long as the server is updated first. Add a defensive `roles: json.user.roles ?? []` coalesce in `fetchMe` to handle any interim state where the server hasn't been updated yet (should not happen in practice but defensive).

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest (existing) |
| Config file | packages/web/vite.config.ts (or vitest.config.ts) |
| Quick run command | `npm run test -- --run` (from root) or `npm test` in packages/web |
| Full suite command | `npm run test:all` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| GATE-V18-01 | `hasPermission("dashboards:edit")` returns true with matching permission, false without | unit | `npm run test -- store/auth.spec.ts` | ✅ (extend existing) |
| GATE-V18-01 | `MeResponse` includes roles+permissions fields, `fetchMe` threads them through | unit | `npm run test -- api/client` | ✅ (extend or new) |
| GATE-V18-01 | Frontend permissions mirror has all 16 strings matching server catalog | unit | `npm run test -- lib/permissions.spec.ts` | ❌ Wave 0 |
| GATE-V18-02 | DashboardsPage hides New/Edit/Delete/MapLayers/DynamicViews for analyst store state | component | `npm run test -- DashboardsPage.spec.tsx` | ✅ (extend — new describe block) |
| GATE-V18-02 | DashboardsPage shows all buttons for designer store state | component | `npm run test -- DashboardsPage.spec.tsx` | ✅ (extend — new describe block) |
| GATE-V18-03 | Widget grid gear/delete/add hidden for analyst; drag/resize inert | component | `npm run test -- DashboardsPage.spec.tsx` | ✅ (extend) |
| GATE-V18-04 | Gear button hidden for analyst (widget configure affordance absent) | component | `npm run test -- DashboardsPage.spec.tsx` | ✅ (extend) |
| GATE-V18-05 | Sidebar hides User Management + Roles for analyst | component | `npm run test -- Sidebar.spec.tsx` | ✅ (extend) |
| GATE-V18-05 | Sidebar shows User Management + Roles for user_admin/admin store state | component | `npm run test -- Sidebar.spec.tsx` | ✅ (extend) |

### Sampling Rate
- **Per task commit:** `npm run test -- --run --reporter=verbose` (frontend vitest, all specs)
- **Per wave merge:** `npm run test:all` (frontend + server)
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `packages/web/src/lib/permissions.spec.ts` — byte-parity verification (all 16 strings independently hardcoded)
- [ ] `packages/web/src/store/auth.spec.ts` — extend with hasPermission selector tests (file exists, needs new test cases)

*(All other test files exist; new test cases extend existing describe blocks)*

---

## Sources

### Primary (HIGH confidence)
- Live source: `packages/web/src/api/client.ts` — `apiFetch` REAUTH_REQUIRED seam (lines 39–60), `MeResponse` type (line 105), `PermissionError` class (line 19)
- Live source: `packages/web/src/store/auth.ts` — full `AuthState` shape, bootstrap flow
- Live source: `packages/web/src/store/user.ts` — vestigial `useUserStore` (confirmed: hardcoded "Data Engineer / Admin", no test coverage)
- Live source: `packages/web/src/components/Topbar.tsx` — sole consumer of `useUserStore` (confirmed: lines 3, 7)
- Live source: `packages/web/src/components/DashboardsPage.tsx` — full action-bar + widget grid inventory; `dragConfig`/`resizeConfig` at lines 889–890; gear at 919–925; xmark at 926–931
- Live source: `packages/web/src/components/Sidebar.tsx` — current nav array (lines 18–22): 3 items, no permission logic
- Live source: `packages/web/src/components/DashboardsPage.spec.tsx` — 732 lines; Phase 34/35 describe blocks identify button-presence tests that will break on gating
- Live source: `packages/web/__mocks__/zustand.ts` — reset shim; confirms initial store state restored after every test
- Live source: `packages/web/src/store/toast.ts` — `useToastStore.getState().showToast()` confirmed; 5s dedup window
- Live source: `packages/server/src/index.ts` lines 327–338 — `/me` handler current shape
- Live source: `packages/server/src/lib/permissions.ts` — 16-permission PERMISSIONS constant (confirmed `datasets:manage` was added as 16th in Phase 47)
- Live source: `packages/web/src/lib/dynamicViewName.ts` — byte-parity mirror precedent confirmed

### Secondary (MEDIUM confidence)
- Planning docs: `48-CONTEXT.md`, `47-CONTEXT.md`, `REQUIREMENTS.md`, `ROADMAP.md`, `research/FEATURES.md` — all verified consistent with live code

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all from live source code
- Architecture: HIGH — all patterns from live source code with exact line refs
- Pitfalls: HIGH — derived from code inspection, not speculation
- Gating inventory: HIGH — verified against live DashboardsPage.tsx and Sidebar.tsx

**Research date:** 2026-06-05
**Valid until:** 2026-07-05 (stable codebase; permissions.ts content depends on Phase 47 not being modified)
