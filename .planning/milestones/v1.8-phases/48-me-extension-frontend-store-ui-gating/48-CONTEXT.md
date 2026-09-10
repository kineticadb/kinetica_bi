# Phase 48: /me Extension + Frontend Store + UI Gating - Context

**Gathered:** 2026-06-05
**Status:** Ready for planning

<domain>
## Phase Boundary

The application is usable as a non-admin role: `/api/auth/me` returns `roles[]` + `permissions[]`, `useAuthStore` gains `hasPermission(perm)`, and every gated UI surface (DashboardsPage action bar, widget grid, ChartConfigPanel reachability, Sidebar nav) hides/disables correctly. Server enforcement (Phase 47) is already live and authoritative — this phase is UX alignment. NO management UI (Phases 49–50).

</domain>

<decisions>
## Implementation Decisions

### Config-panel access (GATE-V18-04 interpretation)
- **Widget gear/configure affordance HIDDEN entirely** for users without `widgets:configure` — consistent hide-don't-disable.
- Consequence: **ChartConfigPanel needs NO read-only mode in v1.8** — the panel is only reachable by users who can configure. The research-flagged "readOnly prop threading through ChartConfigPanel + all CustomConfigPanels" complexity is eliminated. GATE-V18-04 is satisfied by unreachability (document this interpretation in the plan; the requirement's intent — non-configurers cannot save — holds trivially).
- Same rule for widget delete (×) and add-widget (+): hidden without `dashboards:edit` (already locked).

### Stale-UI 403 handling
- On any `PERMISSION_DENIED` response: **error toast naming the permission** ("You no longer have permission: dashboards:edit") **+ automatic `/api/auth/me` re-fetch** updating `useAuthStore` so gated surfaces re-render immediately (self-healing UI).
- Implement in the `apiFetch` dispatch layer mirroring the existing `REAUTH_REQUIRED` code-based dispatch pattern (`packages/web/src/api/client.ts`).
- Permissions changed mid-session require no polling — UI re-syncs on the first denied action (server is authoritative regardless).

### Topbar identity
- Topbar shows the **real authenticated username + role chips** from `/me` (e.g. "rpereira — designer, user admin"). Bootstrap admin shows its roles as "admin".
- Initials derived from username (first letters; fallback first two chars).
- **Delete the vestigial `useUserStore`** (`packages/web/src/store/user.ts`, hardcoded "Data Engineer / Admin") and its Topbar usage. Do not leave dead code.
- Unassigned (analyst-default) users: chips show "analyst" — the /me response should reflect the effective role(s) including the analyst fallback (server already resolves this in getEffectiveRolesAndPermissions).

### Analyst experience
- **No "view only" hint/badge** — hidden surfaces are simply absent; Topbar role chips explain implicitly.
- Analyst click-through exploration (filters, drill-down, map draw, info popups, data-filter widget USAGE) remains fully functional — zero gating on interaction paths. Regression-test this: the existing drill-down/filter specs must pass with an analyst-permission store state.

### Claude's Discretion
- Exact hasPermission selector implementation (Set vs array lookup)
- How gating conditions read in JSX (inline hasPermission calls vs derived booleans)
- Drag/resize inert mechanics for react-grid-layout (isDraggable/isResizable static props)
- Toast wording details; /me re-fetch debounce (avoid stampede if N parallel 403s)
- Test approach for gated rendering (RTL with store-seeded permission states)

</decisions>

<specifics>
## Specific Ideas

- The /me re-sync on 403 mirrors how REAUTH_REQUIRED already dispatches in apiFetch — same seam, new code branch ("PERMISSION_DENIED").
- Frontend permission strings must come from ONE module mirroring the server catalog (byte-parity pattern like dynamicViewName.ts client/server mirror precedent) — no scattered string literals in JSX.

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase contract
- `.planning/ROADMAP.md` § Phase 48 — success criteria
- `.planning/REQUIREMENTS.md` — GATE-V18-01..05
- `.planning/phases/47-server-middleware-route-guards/47-VERIFICATION.md` — what the server now enforces (the contract this phase renders)
- `.planning/phases/47-server-middleware-route-guards/47-CONTEXT.md` — 403 body shape `{ error, code: "PERMISSION_DENIED", permission }`

### Research
- `.planning/research/ARCHITECTURE.md` § frontend store extension — /me widening, hasPermission selector, reset-chain NON-extension rationale
- `.planning/research/FEATURES.md` § UI Surface → Permission Mapping — the exact element→permission table to implement

### Existing code (read before touching)
- `packages/server/src/index.ts` `/api/auth/me` handler (~line 315) — extend with getEffectiveRolesAndPermissions from lib/rbacDb.ts
- `packages/web/src/store/auth.ts` — AuthState shape, authMode precedent for additive extension
- `packages/web/src/api/client.ts` — apiFetch REAUTH_REQUIRED dispatch seam (~line 63-79)
- `packages/web/src/components/Topbar.tsx` + `packages/web/src/store/user.ts` — vestigial identity display to replace/delete
- `packages/web/src/components/DashboardsPage.tsx` — action bar buttons (New/Edit/Delete/Map Layers/Dynamic Views), widget grid props
- `packages/web/src/components/Sidebar.tsx` — nav items
- `packages/web/src/components/charts/WidgetRenderer.tsx` — onConfigureWidget affordance threading
- `packages/web/__mocks__/zustand.ts` — store reset shim for specs

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `getEffectiveRolesAndPermissions(username)` (Phase 46) — exactly the /me shape, already built
- apiFetch code-based dispatch (REAUTH_REQUIRED precedent) — PERMISSION_DENIED branch slots in beside it
- AUTH_MODE additive-extension precedent (v1.1 Phase 7) — same pattern for roles/permissions on MeResponse + useAuthStore
- RTL + zustand reset shim test infra — gated-rendering specs follow existing component spec patterns

### Established Patterns
- Hide-don't-disable already practiced (auth-mode-conditional LoginPage rendering)
- react-grid-layout drag config lives in DashboardsPage grid props — static/isDraggable flags are the established control points
- Client/server byte-parity mirror modules (dynamicViewName.ts precedent) — apply to permission strings

### Integration Points
- `/api/auth/me` handler (server, ~6 lines) — the ONLY server change in this phase
- `useAuthStore` — roles/permissions fields + hasPermission selector; reset chain NOT extended (permissions have session lifetime, no server resources)
- DashboardsPage action bar + grid props; Sidebar nav; WidgetRenderer gear/delete affordances; Topbar identity

</code_context>

<deferred>
## Deferred Ideas

- ChartConfigPanel read-only/inspect mode — dropped for v1.8 (gear hidden instead); revisit if analysts ask to "see how a chart is built"
- "View only" badge — revisit post-rollout if shared-screen confusion reported
- Users/Roles management pages — Phases 49/50 (nav items gated here, pages built there)

</deferred>

---

*Phase: 48-me-extension-frontend-store-ui-gating*
*Context gathered: 2026-06-05*
