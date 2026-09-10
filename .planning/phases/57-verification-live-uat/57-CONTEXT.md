# Phase 57: Verification & Live UAT - Context

**Gathered:** 2026-06-09
**Status:** Ready for planning

<domain>
## Phase Boundary

Prove the v1.10 per-dashboard view-permission feature end-to-end against the deployed system across all personas, run the automated gates fresh, and compile a `57-VERIFICATION.md` that closes the milestone. This is the final v1.10 phase. Mirrors the v1.9 Phase 54 verification pattern (automated-gates record + operator walk-through doc with a blocking human checkpoint → compiled verification). No NEW feature work — only verification, the UAT script, and any gap closure that the walk-through surfaces.

</domain>

<decisions>
## Implementation Decisions

### Test identities (the persona problem)
- The bootstrap admin ALWAYS bypasses, so the restriction is invisible from the operator's admin login. The operator HAS separate non-admin logins ready and will switch between them:
  - an **analyst-role** user (restricted — the subject of the visibility checks), and
  - a **non-admin `manage_access` user** (e.g. designer or user_admin) to perform grant/revoke.
- The UAT script assumes the operator can log in/out as these identities; no in-script role provisioning is required (though the operator may use the Roles/Users pages if needed).

### Environment
- **Live deployed Kinetica, password mode** (same approach as the v1.9 walk-through). Grant usernames are Kinetica password logins, stored lowercased server-side.

### Gap handling
- If the walk-through surfaces defects: **decimal gap-closure phase 57.x**, repro-test-driven per defect (the v1.9 GAP-54 pattern — failing RED reproduction first, then fix, then re-walk the affected section), then close. NOT accept-as-tech-debt (this is a security feature). Small/trivial fixes may ride as inline follow-ups at the executor's discretion, but anything non-trivial gets a 57.x plan.

### Walk-through scenario coverage (maps to the 4 success criteria)
The UAT doc must script these, each with an explicit operator attestation (PASS / FAIL + notes):
- **§1 Analyst restriction (SC1):** logged in as the analyst — the dashboard list shows ONLY granted dashboards (ungranted ones absent); the "Manage access" button is absent (hide-don't-disable); reaching an ungranted/revoked dashboard shows the inline "no access" panel + Back-to-dashboards (not a broken/empty render).
- **§2 Grant/revoke immediate effect (SC2):** as the manage_access user, grant a USER grant (the analyst) → analyst sees/opens it on next list/open; grant a ROLE the analyst holds → analyst sees it; revoke each → it disappears for the analyst. Include the **pre-provisioning** case: grant a username before that user's first login, then that user logs in and sees the dashboard.
- **§3 Bypass non-regression (SC3):** admin AND designer each see and open ALL dashboards, unchanged — no regression to the design/governance workflow.
- **§4 Automated gates (SC4):** frontend vitest 100%; web + server `tsc --noEmit` clean; server vitest SET-BASED gate (failing files ⊆ TD-V16-TEST-ISOLATION known-flaky list — NEVER a fixed pass-count).

### Close criteria
- `57-VERIFICATION.md` committed with `overall_status: passed` (or `gaps_found` if defects remain, driving a 57.x cycle; `failed` is not an acceptable close state). All 4 SCs attested PASS by the operator + automated gates green → milestone gate PASSED, ready for `/gsd:complete-milestone 1.10`.

### Claude's Discretion
- Plan decomposition (likely: an automated-gates plan + a UAT-doc plan with the blocking checkpoint + a compile-verification plan — mirror v1.9 Phase 54; planner decides).
- Exact UAT doc structure (reuse the 54-UAT.md format).
- Which specific dashboards/grants the operator uses as fixtures.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### What shipped (the thing under test)
- `.planning/phases/55-access-model-server-enforcement/55-VERIFICATION.md` + `55-01/55-02-SUMMARY.md` — server enforcement (resolver, list filter, 404 gating, grant routes, audit) + the known-flaky server-test set.
- `.planning/phases/56-access-management-ui-list-open-ux/56-VERIFICATION.md` + `56-01/56-02-SUMMARY.md` — the UI (modal, manage-access button, no-access panel, empty state).
- `.planning/phases/55-access-model-server-enforcement/55-CONTEXT.md` + `56-CONTEXT.md` — the locked access model.

### Format precedent
- `.planning/phases/54-verification-live-walk-through/54-UAT.md` — UAT walk-through doc structure (sections + per-section attestation + gaps log).
- `.planning/phases/54-verification-live-walk-through/54-VERIFICATION.md` — compiled verification format (overall_status, per-criterion evidence).

### Phase contract
- `.planning/ROADMAP.md` §Phase 57 — goal + 4 success criteria.
- `.planning/REQUIREMENTS.md` — VERIFY-V110-01.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- v1.9 `54-UAT.md` / `54-VERIFICATION.md` as templates.
- Roles + Users management pages (if the operator needs to assign roles to test logins mid-UAT).

### Test-gate reality (for SC4 — encode precisely)
- Frontend vitest is DETERMINISTIC and MUST be 100% green (current baseline 1725 across 82 files); run from `packages/web` (`cd packages/web && npx vitest run`).
- Server vitest is nondeterministically flaky — SET-BASED gate: failing files ⊆ TD-V16-TEST-ISOLATION known-flaky set (observed in 55/56: `auth.oidc, auth.routes, boot.hardening, boot.wipe, bootstrap, db.smoke, oidc.module, routes.wms`); NEVER a fixed pass-count.
- `npx tsc --noEmit -p packages/web` AND `-p packages/server` MUST both be clean (separate gates; vitest doesn't type-check).
- A known pre-existing unhandled-rejection in `WidgetRenderer.spec.tsx` is NOT a Phase-57 regression (present since before Phase 56).

### Integration Points
- The walk-through exercises the running app (deployed Kinetica, password mode) — no code changes unless a gap is found.

</code_context>

<specifics>
## Specific Ideas

- The whole point: an analyst is assigned only the dashboards they need and sees/opens nothing else. The pre-provisioning case (grant before first login) is the headline workflow and must be demonstrated live.
- Operator: RPereira@kinetica.com (admin/bypass) drives the UAT; uses the separate non-admin logins to observe the restricted experience.

</specifics>

<deferred>
## Deferred Ideas

- Per-dashboard EDIT grants, ownership/transfer, link-based public sharing (DACL-V2-*) — out of v1.10.
- v1.7 TD-V17-LIVE-UAT, TD-V14-WKB-SPIKE, TD-V16-TEST-ISOLATION, GAP-54-04 (legend names) — pre-existing tech-debt, NOT in this UAT's scope (VERIFY-V110-01 covers only the new dashboard-permission feature).

</deferred>

---

*Phase: 57-verification-live-uat*
*Context gathered: 2026-06-09*
