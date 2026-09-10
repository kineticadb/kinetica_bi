# Phase 51: Verification + Live UAT - Context

**Gathered:** 2026-06-06
**Status:** Ready for planning

<domain>
## Phase Boundary

Milestone-gate verification for v1.8 RBAC: live operator walk-through as all five personas (admin, user admin, designer, analyst, one custom role), automated test gates, the queued 48-50 human-verify items, and a compiled `51-VERIFICATION.md` with `overall_status: passed` or `gaps_found` (`failed` is NOT an acceptable close state — blocking issues get fixed in-phase as 51.x revisions). Plus one cleanup item: fix TD-V17-DASHPAGE-SPEC. NO new features.

</domain>

<decisions>
## Implementation Decisions

### UAT environment
- **AUTH_MODE=password** for the full walk-through. The bootstrap `admin` Kinetica account is the admin persona.
- **Operator provisions ~4 Kinetica test users before the walk-through** (e.g. `uat_useradmin`, `uat_designer`, `uat_analyst`, `uat_custom`). The plan MUST open with a precondition checklist naming exactly what's needed (usernames, the role assignments the operator will perform in-app as part of the test, a dashboard with widgets to exercise).
- **OIDC gets a targeted check only**: boot the server in AUTH_MODE=oidc with default APP_ADMIN_USERNAME and attest the `rbac_bootstrap_admin_warning` appears in the boot log. No full OIDC persona pass.

### Walk-through format: live guided checklist
- Claude produces a **persona-by-persona checklist**; the operator executes against the running app (`npm run dev` + `npm run dev:server`) and attests per item.
- The checklist MUST include the queued human-verify items from prior verifications:
  - 48: analyst visual inertness (drag/resize), mid-session permission-change self-healing (two sessions), Topbar role chips
  - 49: Users page visuals, popover click-outside dismiss, live bulk-assign flow, OIDC ReturnTo (fold the ReturnTo check into the OIDC targeted check or skip with note)
  - 50: Roles page layout/badges, window.confirm dialogs, live audit OBS-1 output + rbac_audit rows
- Persona walks (minimum):
  - **admin**: full access everywhere; assign roles incl. admin; edit admin role mappings; see audit rows
  - **user admin**: Users+Roles pages work; CANNOT see admin in assign popover; admin role locked in Roles page; unheld perms disabled; analyst-level elsewhere
  - **designer**: full design surfaces; NO Users/Roles nav
  - **analyst**: clean read-only app + full click-through exploration (filters, drill-down, map interactions)
  - **custom role**: operator creates e.g. `uat_custom` role with a deliberate subset (e.g. dashboards:view + widgets:configure) and verifies exactly those surfaces appear
  - **last-admin + escalation guards live**: attempt the three blocked operations as user admin (verbatim 403s); attempt revoking the last non-bootstrap admin (400)
- Evidence: per-item operator attestation recorded in the walk-through doc; screenshots optional (operator's choice), not required.

### Scope
- **v1.8 RBAC only.** TD-V17-LIVE-UAT (classbreak/track/legend) stays carried — do NOT fold in; its preconditions (track fixture etc.) are out of scope here.

### Gap & debt handling
- UAT bugs → **inline 51.x plan-revisions** with regression specs + re-walk of the affected item (v1.3/v1.4 precedent).
- **Fix TD-V17-DASHPAGE-SPEC in this phase**: the stale button-order assertion in DashboardsPage.spec.tsx ("Dynamic Views button after Map Layers"). Goal: frontend suite at TRUE 100% green for milestone close. This is a spec fix, not a product change (verify actual current button order and assert that).

### Automated gates (compiled into 51-VERIFICATION.md)
- Frontend vitest: **100% green** (after the known-red fix) + `tsc --noEmit` clean
- Server: tsc clean; vitest set-based gate — failing FILES a subset of the 14 known-flaky list (TD-V16-TEST-ISOLATION explicitly excluded from this gate, consistent with v1.6/v1.7 precedent); all RBAC spec groups (lib.permissions, db.rbacMigration, db.rbacAudit, lib.rbacDb, boot.rbacAdminWarning, routes.rbac, routes.guards, routes.management) deterministically green
- Builds: `npm run build` + `npm run build:server` clean

### Claude's Discretion
- Checklist document format/structure (51-UAT.md style per prior UAT precedents)
- How attestation is captured (conversational per-section vs whole-checklist)
- Exact custom-role permission subset for the test
- Plan structure (likely: 51-01 spec-fix + automated gates; 51-02 checklist + live UAT checkpoint — the UAT plan is NOT autonomous; it has a human checkpoint)

</decisions>

<specifics>
## Specific Ideas

- "failed is not an acceptable close state" — ROADMAP SC1 verbatim; anything blocking is fixed in-phase.
- The analyst persona walk doubles as the milestone's core-value regression: click-through exploration must be fully intact.
- v1.0's 16 deferred manual UAT checks (TD-01) are NOT in scope — only v1.8 surfaces (note in VERIFICATION for posterity).

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase contract
- `.planning/ROADMAP.md` § Phase 51 — 7 success criteria
- `.planning/REQUIREMENTS.md` — VERIFY-V18-01
- `.planning/phases/48-me-extension-frontend-store-ui-gating/48-VERIFICATION.md` § Human Verification Required (3 items)
- `.planning/phases/49-users-management-ui/49-VERIFICATION.md` § Human Verification Required (4 items)
- `.planning/phases/50-roles-management-ui-custom-roles-audit/50-VERIFICATION.md` § Human Verification Required (items incl. audit log)

### Precedents
- `.planning/milestones/v1.4-...` Phase 24 verification — live persona walk-through + inline gap-closure (the format to mirror)
- `.planning/phases/44-.../44-*` — Phase 44 live-UAT attestation precedent (operator-approved checklist)

### Code/test refs
- `packages/web/src/components/DashboardsPage.spec.tsx` — the known-red button-order test to fix (verify CURRENT button order in DashboardsPage.tsx and update the assertion)
- All RBAC spec groups (see automated gates list)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- Persona seeding happens THROUGH THE APP during UAT (admin assigns roles via the Users page — the assignment flow is itself under test)
- `npm run dev` / `npm run dev:server` from repo root; server needs packages/server/.env (exists, password mode)
- rbac_audit table queryable via sqlite3 CLI for audit-row spot-checks during the walk

### Established Patterns
- UAT doc + per-item attestation + gap table (v1.4 Phase 24 / v1.7 Phase 44 precedents)
- 51.x inline plan-revision numbering for UAT fixes
- Set-based server gate; known-flaky list of 14 files

### Integration Points
- 51-VERIFICATION.md compiled at close (status passed/gaps_found)
- MILESTONES.md v1.8 entry + /gsd:complete-milestone follow after this phase
- TD ledger updates: TD-V17-DASHPAGE-SPEC closes here; TD-V17-LIVE-UAT, TD-V16-TEST-ISOLATION, TD-V14-WKB-SPIKE, TD-V15-MAP-ONLY-TRIGGER carry

</code_context>

<deferred>
## Deferred Ideas

- TD-V17-LIVE-UAT (v1.7 classbreak/track/legend walk-through) — carried, explicitly out of this session
- TD-V16-TEST-ISOLATION (cross-mode server suite contamination, ~106 red) — carried; candidate for a dedicated v1.9 phase
- Full OIDC persona UAT — reduced to the boot-warning targeted check; full pass when OIDC test accounts exist
- v1.0 TD-01 manual UAT backlog — out of scope, note for posterity

</deferred>

---

*Phase: 51-verification-live-uat*
*Context gathered: 2026-06-06*
