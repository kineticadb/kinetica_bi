# Phase 56: Access-Management UI & List/Open UX - Context

**Gathered:** 2026-06-09
**Status:** Ready for planning

<domain>
## Phase Boundary

Frontend layer over the Phase 55 server endpoints. Delivers: a per-dashboard access-management UI (view/add/remove user + role grants) reachable by `dashboards:manage_access` holders; UI gating of that entry point (hide-don't-disable); the dashboard list reflecting server-filtered visibility for every persona; and a clear "no access" state when an analyst hits a dashboard they can't open. NO server changes (Phase 55 already shipped the API). Live operator UAT is Phase 57.

</domain>

<decisions>
## Implementation Decisions

### Entry point
- A **"Manage access" action button on each dashboard list row** (in the existing `.ds-actions` cell, alongside Open/View/Edit/Delete), gated by `canManageAccess = hasPermission("dashboards:manage_access")` — mirrors the existing `canEdit`/`canDelete` button gating exactly. NOT in the open-dashboard view (list-row only).
- Hide-don't-disable: the button is absent from the DOM for users without `manage_access` (v1.8 pattern). The server 403 on the grant routes is the authority; the UI gate is UX only.

### Panel form factor
- A **modal dialog** ("Manage Access" / "Share: {dashboard name}"), consistent with LayersModal / Configure / DynamicViewsModal. Opens over the list, dismissible, no navigation away. Reuse the existing modal chrome/CSS conventions (`modal-title`, the `.layers-modal-*` family or equivalent) + theme tokens + green accent.

### Panel content + add-grant UX
- The modal lists the dashboard's CURRENT grants from `GET /api/dashboards/:id/access` → `{ grants: [...] }`, split into user grants and role grants, each with a remove (×) control → `DELETE /api/dashboards/:id/access` with body `{ grantee_type, grantee }`.
- **Add grant = a type toggle (User / Role) + a smart input** in one compact add-row:
  - **User** → free-text username input (supports PRE-PROVISIONING a user who hasn't logged in; stored lowercased server-side). Optional autocomplete/suggestions sourced from `listUsers()` (`/api/users`) — but free text must be allowed (don't restrict to known users).
  - **Role** → dropdown of existing roles from `listRoles()` (`/api/roles`).
  - Add → `POST /api/dashboards/:id/access` with `{ grantee_type, grantee }`; refresh the grant list on success.
- Informational line in the panel: admins & designers (manage_access holders) always have access — so operators understand why bypass users aren't listed. (Claude's discretion on exact wording/placement.)

### List & open UX
- The dashboard list is ALREADY server-filtered (Phase 55 `GET /api/dashboards`) — analysts see only granted dashboards; admin/designer see all. No client-side filtering needed; verify no regression to the admin/designer experience.
- Empty list (analyst with zero shared dashboards): a friendly empty state ("No dashboards have been shared with you yet" or similar) rather than the generic "No dashboards yet."
- **"No access" state on open:** the open flow (DashboardOpen / its data fetches) detects a **404** (access revoked mid-session, or a stale selection) and renders an inline "You don't have access to this dashboard" panel with a **Back to dashboards** action — NOT a broken/empty dashboard, NOT a generic error. (There is no URL routing today, so "direct nav" = a 404 on the open data fetch.)

### Claude's Discretion
- Exact modal layout, grant-row styling, and the bypass-info wording.
- Whether the user input uses a datalist/autocomplete vs plain free text (free text MUST work for pre-provisioning).
- Which open-path fetch's 404 triggers the no-access panel (widgets/tables/layers) and how it's threaded — pick the cleanest single detection point.
- Loading/error/toast affordances within the modal (follow existing patterns).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.** No external spec docs — the Phase 55 API + the v1.8 UI components are the contract.

### Phase 55 server contract (the API this UI consumes)
- `packages/server/src/index.ts` lines ~546-600 — `GET/POST/DELETE /api/dashboards/:id/access` (manage_access-gated; POST/DELETE body `{ grantee_type: "user"|"role", grantee: string }`; GET returns `{ grants }`; 400 on bad input).
- `packages/server/src/lib/dashboardAccessDb.ts` — grant row shape returned by `listDashboardGrants` (grantee_type/grantee fields) to mirror in the client DTO.
- `.planning/phases/55-access-model-server-enforcement/55-02-SUMMARY.md` — exact route placement, audit-on-change, DELETE-uses-body decisions.
- `.planning/phases/55-access-model-server-enforcement/55-CONTEXT.md` — locked access model (404-not-403, bypass via manage_access, private-by-default, pre-provisioning).

### Frontend patterns to mirror
- `packages/web/src/components/DashboardsPage.tsx` — list rows (`.ds-row`/`.ds-actions` ~line 175), `canEdit`/`canDelete` gating, `DashboardOpen` (~line 360) for the no-access state, `listDashboards` via `useApiQuery` (~73).
- `packages/web/src/components/RolesPage.tsx` + `UsersPage.tsx` — management UI patterns (role dropdowns, user chips/popover, add/remove rows, modal/section layout) + their `.css`.
- `packages/web/src/store/auth.ts` — `useAuthStore` + `hasPermission` selector (gate the entry point).
- `packages/web/src/api/client.ts` — `listUsers` (~1198), `listRoles` (~1205), and the dashboard-layers CRUD fns (~480+) as the PATTERN for the new grant CRUD client fns (`listDashboardGrants`/`addDashboardGrant`/`removeDashboardGrant`).

### Phase contract
- `.planning/ROADMAP.md` §Phase 56 — goal + 6 success criteria.
- `.planning/REQUIREMENTS.md` — GRANTUI-V110-01..03, LISTUX-V110-01..03.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `useAuthStore`/`hasPermission` (store/auth.ts) — `canManageAccess` gate, identical to `canEdit`/`canDelete`.
- `listUsers()` + `listRoles()` (client.ts) — populate the user-autocomplete and role-dropdown; no new endpoints needed.
- Modal chrome (LayersModal / DynamicViewsModal / Configure modal) + `.layers-modal-*` / `modal-title` CSS — reuse for the access modal.
- `apiFetch` + `useApiQuery` — grant fetch/refresh pattern; the dashboard-layers client fns are the template for the new grant CRUD fns.
- RolesPage/UsersPage add/remove-row + chip patterns.

### Established Patterns
- Hide-don't-disable UI gating; server is authoritative (v1.8 lock).
- Theme tokens only + green-accent (ui-consistency memory: accent checkboxes, light-mode overrides).
- Usernames lowercased to match the server grant store.

### Integration Points
- `client.ts` — add `listDashboardGrants` / `addDashboardGrant` / `removeDashboardGrant` + a `DashboardGrantDto` type.
- DashboardsPage list row — "Manage access" button (canManageAccess) + mount the access modal.
- New `AccessModal` (or `DashboardAccessModal`) component + spec.
- `DashboardOpen` — 404 detection → inline no-access panel; empty-list message.

### Test-gate reality
- Frontend vitest is 100% green (currently ~1700) and MUST stay 100%; web `tsc --noEmit` MUST be clean. New component + client fns need vitest specs (mock the grant endpoints; assert add/remove/list + manage_access gating absence-from-DOM + no-access 404 rendering). vitest doesn't type-check → run tsc as a separate gate. ZERO server changes this phase.

</code_context>

<specifics>
## Specific Ideas

- "Assign analysts to only the dashboards they need" — the modal is the operator's tool to do exactly this; the type-toggle add-row makes user vs role assignment one action.
- Pre-provisioning is a first-class case: granting `jdoe` before they've ever logged in must work from the UI (free-text username).

</specifics>

<deferred>
## Deferred Ideas

- Per-dashboard EDIT grants (DACL-V2-01) — view-only this milestone.
- Dashboard ownership / transfer (DACL-V2-02); link-based public sharing (DACL-V2-03).
- URL routing / deep-linking to a dashboard (separate rpToDos backlog item) — the no-access state here handles the 404 case without needing routing.
- Bulk "share to many dashboards at once" — not in scope.

</deferred>

---

*Phase: 56-access-management-ui-list-open-ux*
*Context gathered: 2026-06-09*
