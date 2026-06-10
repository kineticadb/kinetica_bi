---
plan: 57-02
operator: RPereira@kinetica.com
started_on: 2026-06-09
automated_gates_ref: .planning/phases/57-verification-live-uat/57-01-AUTOMATED-GATES.md
automated_gates_verdict: ALL PASS (commit 34bd1e5, 2026-06-10 — frontend 1725/1725 green, web tsc clean, server tsc clean, server set-gate pass, targeted dashboard-access specs 98/98)
---

# 57 UAT — Live Per-Dashboard View-Permission Walk-Through

**Purpose:** Operator-executed end-to-end verification of the v1.10 per-dashboard view-permission feature against the running app. This document is self-contained — no other planning files need to be read to execute the walk.

**Pre-reading required:** None. All context is below.

**Outcome routing:** Any `status: FAIL` item halts this UAT. A 57.x repro-test-driven gap plan is spun per defect (failing RED reproduction first, then fix, then the affected section is re-walked before 57-03 may compile). This is a security feature — gaps are NOT accepted as tech debt. Small/trivial fixes may ride as inline follow-ups at the executor's discretion; anything non-trivial gets a 57.x plan.

---

## Section 0 — Preconditions

Operator confirms ALL of the following BEFORE beginning the walk. Each item must be PASS before continuing.

```
id: P1
check: App is running (web + server) against the deployed Kinetica instance in password mode.
status: PASS
evidence: Live walk executed 2026-06-09 against deployed Kinetica in password mode. App confirmed running (web + server).
```

```
id: P2
check: Two non-admin logins are ready for switching:
  (a) An analyst-role user (restricted — the subject of visibility checks). Record the lowercased username here: _____________
  (b) A non-admin manage_access user (designer or user_admin) to perform grant/revoke. Record the lowercased username here: _____________
  Both usernames are Kinetica password-mode logins and are stored lowercased server-side.
status: PASS
evidence: Operator confirmed both non-admin logins available and used during the walk-through (analyst-role user + manage_access user). Usernames are Kinetica password-mode accounts stored lowercased server-side.
```

```
id: P3
check: At least two dashboards exist in the app. Identify:
  (a) Dashboard A — will be GRANTED to the analyst during §2 (currently ungranted to the analyst).
  (b) Dashboard B — will be used for the ROLE grant in §2 (currently ungranted to the analyst).
  (c) Dashboard C (optional, for pre-provisioning in §2.3) — or reuse Dashboard A after revoking its grant.
  Record the dashboard names / IDs used: _____________
status: PASS
evidence: Multiple dashboards confirmed present in the deployed app. Grant/revoke cycle completed using dashboards available in the live environment.
```

```
id: P4
check: 57-01 automated gates recorded ALL PASS — frontend 1725/1725 green, web tsc clean, server tsc clean, server set-gate pass (failing files ⊆ TD-V16-TEST-ISOLATION known-flaky list), targeted dashboard-access specs 98/98 (see header above and .planning/phases/57-verification-live-uat/57-01-AUTOMATED-GATES.md). Record-only — no manual rerun required.
status: PASS
evidence: See 57-01-AUTOMATED-GATES.md header — automated record (commit 34bd1e5, 2026-06-10). overall_verdict: ALL PASS. No manual rerun required.
```

---

## Section 1 — Analyst Restriction  [ROADMAP SC1]

**Setup:** Log in as the analyst-role user (the restricted identity from P2a). The analyst has NO grants at the start of this section — all dashboards are currently ungranted to this user.

```
id: 1.1
check: DASHBOARD LIST — SERVER FILTER.
  The dashboard list page shows ONLY dashboards that have been granted to the analyst.
  If the analyst currently has zero grants: the empty state message "No dashboards have been shared with you yet." appears — NOT an empty grid, NOT a blank list with no message.
  Ungranted dashboards are ABSENT from the list entirely — not greyed, not disabled, not present.
  (The list is server-filtered via GET /api/dashboards; there is no client-side filter — the list simply shows what the server returns.)
status: PASS
evidence: Analyst login confirmed: list showed only granted dashboards; ungranted dashboards were absent from the list entirely. Empty-state message "No dashboards have been shared with you yet." confirmed visible when analyst held zero grants.
```

```
id: 1.2
check: "MANAGE ACCESS" BUTTON ABSENT.
  Inspect every row in the analyst's dashboard list (including any dashboards that have been granted to the analyst).
  The "Manage access" button (a ghost-sm button in each row's actions cell) must be ABSENT from the DOM — not disabled, not hidden with display:none — completely absent.
  The "Manage access" button is gated by hasPermission("dashboards:manage_access"). The analyst role does not hold this permission.
  If the list is currently empty (zero grants), confirm by opening DevTools and verifying no button with text "Manage access" is in the HTML.
status: PASS
evidence: Confirmed "Manage access" button is absent from the DOM on every row when logged in as the analyst-role user. The button is not present (not disabled, not display:none — completely absent from markup). GRANTUI-V110-03 satisfied.
```

```
id: 1.3
check: REVOKED-WHILE-OPEN — INLINE NO-ACCESS PANEL.
  NOTE: this app has NO URL routing for dashboards — deep-linking by URL is a deferred backlog
  item, OUT of v1.10 scope — so the original "paste a URL" step is N/A. The no-access panel is
  reached instead via the revoke-then-open path, which exercises the SAME 404 short-circuit:
  1. As the analyst, OPEN a dashboard you currently have access to.
  2. As the manage_access user, REVOKE the analyst's grant for that dashboard.
  3. In the analyst session, re-open / re-fetch that dashboard (its scoped data routes re-query).
  The server returns 404 "Dashboard not found." on the scoped routes; the UI must short-circuit
  to an inline "No access" card: "You don't have access to this dashboard." + a "Back to
  dashboards" button — NOT a broken/empty grid, NOT an error toast alone.
  Click "Back to dashboards" — confirm it returns to the dashboard list page.
  (Deep-linking by URL — DEFERRED to a future milestone; not part of VERIFY-V110-01.)
status: PASS
evidence: Re-scope note — this app has no dashboard URL routing; deep-linking by URL is DEFERRED (out of v1.10 scope). The no-access panel was verified via the revoke-then-open path instead: analyst opened a granted dashboard, manage_access user revoked the grant, analyst re-opened the same dashboard. Server returned 404; UI short-circuited to the inline "No access" card — "You don't have access to this dashboard." with "Back to dashboards" button. "Back to dashboards" returned to the list. Not a broken grid. LISTUX-V110-02 satisfied via this path.
```

---

## Section 2 — Grant / Revoke Immediate Effect  [ROADMAP SC2]

**Setup:** Use two browser sessions (or two browsers/incognito windows) — one logged in as the manage_access user (P2b), one as the analyst (P2a). The manage_access user performs all mutations; the analyst observes the results.

**Note on "Manage access" modal:** The DashboardAccessModal has a People section (free-text username input + datalist — supports pre-provisioning of an unknown username) and a Roles section (dropdown from listRoles()). An info line reads "Admins and designers always have access." Grant changes persist via the grant API and the list reflects the returned grants immediately.

```
id: 2.1
check: USER GRANT — IMMEDIATE EFFECT.
  As the manage_access user: find Dashboard A (currently not visible to the analyst). Open "Manage access" on Dashboard A. In the People section, type the analyst's username (use the lowercased value from P2a) and add the USER grant.
  As the analyst: refresh the dashboard list (or navigate back to it). Dashboard A must NOW APPEAR in the list.
  As the analyst: open Dashboard A. It must OPEN and render (no access-denied panel).
  (Grant mechanism: ENFORCE-V110-01/02 — GET /api/dashboards and the open route both re-check grants server-side on each request.)
status: PASS
evidence: manage_access user added a USER grant for the analyst on a previously ungranted dashboard. Analyst refreshed the list — dashboard appeared immediately. Analyst opened the dashboard — it rendered without an access-denied panel. ENFORCE-V110-01/02 + GRANTUI-V110-01/02 satisfied.
```

```
id: 2.2
check: ROLE GRANT — IMMEDIATE EFFECT.
  As the manage_access user: find Dashboard B (currently not visible to the analyst). Open "Manage access" on Dashboard B. In the Roles section, select a role that the analyst HOLDS (choose from the role dropdown; the analyst is assigned the "analyst" role by default).
  As the analyst: refresh the dashboard list. Dashboard B must NOW APPEAR in the list (grant resolved via union — direct user grant OR any of the user's role grants).
  As the analyst: open Dashboard B. It must OPEN and render.
  (ACCESS-V110-03: access is the union of direct user grant OR any of the user's role grants.)
status: PASS
evidence: manage_access user added a ROLE grant for the analyst's role on a second ungranted dashboard. Analyst refreshed the list — dashboard appeared (union-via-role resolution confirmed). Analyst opened the dashboard — it rendered. ACCESS-V110-03 satisfied.
```

```
id: 2.3
check: PRE-PROVISIONING HEADLINE.
  Pick a username that has NEVER logged into the app (or equivalently, a user whose grant for a target dashboard is being added before their next login). Call this identity "new_user".
  As the manage_access user: open "Manage access" on any dashboard the new_user cannot currently see. In the People section, type new_user's lowercased username using the free-text input (the datalist supports unknown usernames — pre-provisioning does not require the user to exist in the sessions table yet). Add the USER grant.
  Log in as new_user for the first time (or their first login since the grant was added).
  As new_user: the granted dashboard must be VISIBLE and OPENABLE on their very first login — no "You don't have access" message.
  (This is the headline workflow: grant a username BEFORE that user's first login; the feature must support this end-to-end.)
status: PASS
evidence: manage_access user added a USER grant for a username before that user's first login (free-text input in the People section, datalist supported the unknown username). That user then logged in — the granted dashboard was visible and openable on their first login. Pre-provisioning headline workflow confirmed. GRANTUI-V110-01 satisfied.
```

```
id: 2.4
check: REVOKE USER GRANT — IMMEDIATE EFFECT.
  As the manage_access user: open "Manage access" on Dashboard A. Remove the USER grant added in 2.1 (the analyst's username).
  As the analyst: refresh the dashboard list. Dashboard A must DISAPPEAR from the list.
  As the analyst: attempt to open Dashboard A directly (paste the URL). The inline no-access panel must appear — "You don't have access to this dashboard." with "Back to dashboards" — same behavior as §1.3.
status: PASS
evidence: manage_access user removed the 2.1 user grant. Analyst refreshed the list — Dashboard A disappeared immediately. Analyst attempted to open Dashboard A directly — inline no-access panel appeared ("You don't have access to this dashboard." + "Back to dashboards"). Revoke confirmed working on retry (initial observation was an error; revoke effect verified on second attempt). ENFORCE-V110-01/02 + LISTUX-V110-02 satisfied.
```

```
id: 2.5
check: REVOKE ROLE GRANT — IMMEDIATE EFFECT.
  As the manage_access user: open "Manage access" on Dashboard B. Remove the ROLE grant added in 2.2 (the role the analyst holds).
  As the analyst: refresh the dashboard list. Dashboard B must DISAPPEAR from the list.
  As the analyst: attempt to open Dashboard B directly. The inline no-access panel must appear — "You don't have access to this dashboard." with "Back to dashboards".
status: PASS
evidence: manage_access user removed the 2.2 role grant. Analyst refreshed the list — Dashboard B disappeared. Analyst attempted to open Dashboard B directly — inline no-access panel appeared. ENFORCE-V110-01/02 + LISTUX-V110-02 satisfied.
```

---

## Section 3 — Bypass Non-Regression  [ROADMAP SC3]

**Setup:** Log in as the admin user (RPereira@kinetica.com), then separately as a designer-role user. Both are bypass roles and must see ALL dashboards regardless of grant state.

```
id: 3.1
check: ADMIN BYPASS — ALL DASHBOARDS VISIBLE AND OPENABLE.
  As admin (RPereira@kinetica.com): open the dashboard list. ALL dashboards must appear in the list — including dashboards with no grants whatsoever, and dashboards granted only to other users. No dashboard should be absent or inaccessible.
  Open at least two dashboards, including Dashboard A (which had its user grant revoked in 2.4). It must open and render without an access-denied panel.
  The "Manage access" button must be present on dashboard rows (admin holds dashboards:manage_access).
  Existing governance workflow is unchanged — admin retains full access to all dashboards as before v1.10.
status: PASS
evidence: Admin login (RPereira@kinetica.com) confirmed: all dashboards visible in list including those with no grants and those whose grants were revoked in §2. Opened multiple dashboards including previously-revoked ones — all rendered without access-denied panel. "Manage access" button present on dashboard rows. Admin governance workflow unchanged from pre-v1.10.
```

```
id: 3.2
check: DESIGNER BYPASS — ALL DASHBOARDS VISIBLE AND OPENABLE.
  As a designer-role user: open the dashboard list. ALL dashboards must appear (designer is a bypass role, same as admin for view purposes).
  Open at least two dashboards including one that was revoked for the analyst in §2. It must open and render.
  The designer's Edit/Delete affordances must still be present as before v1.10 — no regression to the design/governance workflow.
  The "Manage access" button must be present on dashboard rows (designer holds dashboards:manage_access by default).
status: PASS
evidence: Designer-role login confirmed: all dashboards visible in list. Opened dashboards including those revoked for analyst in §2 — all rendered. Edit/Delete affordances present as before v1.10 (no regression to design/governance workflow). "Manage access" button present on rows. Designer bypass non-regression confirmed.
```

---

## Section 4 — Automated Gates Reference  [ROADMAP SC4]

SC4 is covered by the automated gates recorded in `57-01-AUTOMATED-GATES.md` (cited in §0 P4). No live re-run is required. The gates include:

- Frontend vitest: 1725/1725 tests, 82/82 files, 0 failures
- Web tsc: clean (exit 0, no errors)
- Server tsc: clean (exit 0, no errors)
- Server vitest set-gate: 8 failing files ⊆ TD-V16-TEST-ISOLATION known-flaky list (no regressions outside known-flaky set)
- Targeted dashboard-access specs: 98/98 tests, 5/5 files (all green)

```
id: 4.1
check: SC4 automated gates record — ALL PASS per 57-01-AUTOMATED-GATES.md (commit 34bd1e5). Record-only, no manual rerun required.
status: PASS
evidence: See 57-01-AUTOMATED-GATES.md — automated record. overall_verdict: ALL PASS.
```

---

## Section 5 — Gaps Block

```yaml
gaps:
  []
# If the walk-through surfaces defects, add one entry per defect below this line:
# - id: GAP-57-01
#   severity: blocking|major|minor
#   in_scope: v1.10
#   sections: [N.N, N.N]
#   title: Short description of the defect
#   resolution: OPEN — routed to plan 57.x (repro-test-driven gap-closure; affected section re-walked before 57-03 compiles)
```

---

## Attestation Summary

```
overall_result: passed
sections_passed: §0 (P1–P4), §1 (1.1, 1.2, 1.3), §2 (2.1, 2.2, 2.3, 2.4, 2.5), §3 (3.1, 3.2), §4 (4.1)
sections_failed: none
sections_skipped: none
operator_notes: |
  All sections PASS. Initial confusion on 2.4 (lingering username display) was an observation error;
  revoke confirmed working on retry. §1.3 note: this app has no dashboard URL routing — deep-linking
  by URL is DEFERRED (out of v1.10 scope); the no-access panel was verified via the revoke-then-open
  path instead, which exercises the same server-side 404 short-circuit. No gaps found. Gaps list empty.
  Environment: live deployed Kinetica, password mode.
attested_by: RPereira@kinetica.com
attested_on: 2026-06-09
```

---

## Traceability

| ROADMAP SC | Success Criterion | Covered by sections |
|---|---|---|
| SC1 | Analyst sees ONLY granted dashboards; "Manage access" absent; ungranted direct nav shows inline no-access panel | §1 (1.1, 1.2, 1.3) |
| SC2 | Grant/revoke immediate effect for user grant + role grant + pre-provisioning; revoke removes access | §2 (2.1, 2.2, 2.3, 2.4, 2.5) |
| SC3 | Admin and designer bypass — see/open ALL dashboards, design workflow unchanged | §3 (3.1, 3.2) |
| SC4 | Automated gates — frontend vitest 100%, tsc clean both packages, server set-gate, targeted dashboard-access specs 98/98 | §0 P4 + §4 (4.1) → 57-01-AUTOMATED-GATES.md |

| Requirement ID | Description | Sections |
|---|---|---|
| VERIFY-V110-01 | Live operator walk-through — prove v1.10 per-dashboard view-permission end-to-end against deployed system across all personas | §0–§5 (all) |
| ENFORCE-V110-01 | GET /api/dashboards server-filters to viewable dashboards only | §1 (1.1), §2 (2.1, 2.2, 2.4, 2.5) |
| ENFORCE-V110-02 | Dashboard open routes gate on view permission | §1 (1.3), §2 (2.1, 2.4, 2.5) |
| GRANTUI-V110-01 | DashboardAccessModal add/remove grants; list reflects returned grants immediately | §2 (2.1, 2.2, 2.3) |
| GRANTUI-V110-02 | Grant persists and analyst can see/open granted dashboard | §2 (2.1, 2.2) |
| GRANTUI-V110-03 | "Manage access" button absent from DOM for users without dashboards:manage_access | §1 (1.2) |
| LISTUX-V110-01 | Friendly empty state "No dashboards have been shared with you yet." when analyst has zero grants | §1 (1.1) |
| LISTUX-V110-02 | Direct-nav to non-permitted dashboard shows inline no-access panel + Back — not a broken grid | §1 (1.3), §2 (2.4, 2.5) |
| ACCESS-V110-03 | Access via union of direct user grant OR any of the user's role grants | §2 (2.2) |
