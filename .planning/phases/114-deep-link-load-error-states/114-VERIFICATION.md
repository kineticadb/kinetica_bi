---
phase: 114-deep-link-load-error-states
verified: 2026-09-11T14:20:00Z
status: passed
score: 7/7 must-haves verified
---

# Phase 114: Deep Link Load & Error States Verification Report

**Phase Goal:** Visiting or pasting a dashboard URL opens that dashboard directly — or, if it can't, shows a clear message instead of a blank or broken page.
**Verified:** 2026-09-11T14:20:00Z
**Status:** passed
**Re-verification:** No — initial verification (first automated pass after the 114-03 operator checkpoint cleared)

## Goal Achievement

### Observable Truths (amended ROADMAP success criteria, 2026-09-11)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Loading the app directly at a dashboard URL opens straight into that dashboard, without the dashboard-list page appearing first | ✓ VERIFIED | `App.tsx:339-341` holds `loadingShell` while `deepLink.status === "pending"` and only renders `DashboardsPage` afterwards; `DashboardsPage.tsx:106-108` mounts straight into `{mode:"open"}` via a lazy `useState` initializer, so the list branch of its JSX is never reached on a successful deep link. Structural proof: `App.deeplink.spec.tsx` test 1 asserts `screen.queryByTestId("page-dashboards")` is `null` while pending. Operator-confirmed live (UAT-114-1: pass, list never seen, incl. hard reload). |
| 2 | A link that cannot be opened (deleted OR not permitted) shows ONE clear, honest combined message, never blank/broken, never the dashboard's content | ✓ VERIFIED | `useDeepLinkDashboard.ts:64-65` — the one lookup-miss branch calls `clearDashboardUrl()` then `setState({status:"unavailable"})`; `App.tsx:372-377` renders the `.onboarding-banner` with `DEEP_LINK_UNAVAILABLE_MESSAGE`. Operator-confirmed live (UAT-114-3, UAT-114-4: pass, list+banner, no dashboard content shown). |
| 3 | That message does not reveal which of the two reasons applies (non-leak) | ✓ VERIFIED (structural + live) | `grep -c 'setState({ status: "unavailable" })' useDeepLinkDashboard.ts` = 1 (exactly one site); `DeepLinkState` union (lines 19-24) carries no reason/cause field on the `unavailable` variant — there is no data channel through which two texts could diverge. `App.deeplink.spec.tsx` test "names neither the reason nor the requested id" passes. Operator quoted both banners word-for-word identical (UAT-114-4). |
| 4 | Boot ordering never strands an unauthenticated deep-link arrival | ✓ VERIFIED | `App.tsx:324-341`: `status==="unknown"` → loadingShell; `status!=="authenticated"` → `LoginPage` (comment at :328-330 explicitly documents this must stay above the deep-link hold); THEN `deepLink.status==="pending"` → loadingShell. No state combination falls through un-rendered — every branch before the final return is a genuine early return. `App.deeplink.spec.tsx` "unauthenticated arrival goes to login and keeps the param" passes. |
| 5 | Phase 7's ReturnTo mechanism is untouched, and a deep link wins over it | ✓ VERIFIED | `ReturnTo` type (`App.tsx:36-39`) and its restore effect (`:222-260`) are byte-for-byte the same shape (`{page?, dashboardViewMode?}`, no dashboard id) as pre-Phase-113. New effect at `:268-275` runs strictly after it (declared later, and can only fire post-await), setting `page`/`dashboardViewMode` when a deep link resolves. `App.deeplink.spec.tsx` "a pasted link beats the Phase 7 ReturnTo page restore" passes (ReturnTo→"roles" is overridden). |
| 6 | The one-shot handoff bug (page-mismatch burning the ref early) is fixed and tested | ✓ VERIFIED | Fix present at `App.tsx:96`: `if (initialOpenDashboard && page === "dashboards") deepLinkConsumedRef.current = true;` (gated on `page`, not just presence of the value). Test "a pasted link beats the Phase 7 ReturnTo page restore" (`App.deeplink.spec.tsx:183-191`) exercises exactly this race (ReturnTo→"roles" while deepLink resolves to "opened") and asserts the dashboard still opens with `data-deeplink="7"` — traced by hand: removing the `page === "dashboards"` guard would flip the ref one render early (while `page` was still `"roles"`), causing `initialOpenDashboard` to read `undefined` on the render where `DashboardsPage` actually mounts, which would fail this test. Sidebar away-and-back non-reopen is separately covered by "navigating away and back does not re-open the deep-linked dashboard" (operator-confirmed UAT-114-7). |
| 7 | Phase 113 not regressed — no double history push on arrival | ✓ VERIFIED | `grep -c openDashboardUrl DashboardsPage.tsx` = 3: one `import`, one call site (`:240`, the manual "Open" button click — unrelated to arrival), and one explanatory comment (`:102-105`) stating why it is deliberately NOT called on a deep-link mount. `leaveDashboardUrl()`'s unmarked-entry branch (`dashboardUrl.ts:85-89`) correctly falls back to `clearDashboardUrl()` instead of `history.back()` for a deep-link arrival (no entry of ours to pop). Operator-confirmed UAT-114-5 (in-app Back stays inside the app). |

**Score:** 7/7 truths verified (all either structurally proven with a genuine discriminating test, or operator-confirmed live per 114-UAT.md, or both).

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/web/src/lib/dashboardUrl.ts` | `hasDashboardParam` added, Phase 113 exports untouched | ✓ VERIFIED | Added at lines 34-40, reuses `DASHBOARD_URL_PARAM`; all four Phase 113 writers (`openDashboardUrl`, `clearDashboardUrl`, `leaveDashboardUrl`, `buildDashboardUrl`) present and unchanged. |
| `packages/web/src/hooks/useDeepLinkDashboard.ts` | 5-state machine, one `DEEP_LINK_UNAVAILABLE_MESSAGE`, StrictMode-safe single fetch | ✓ VERIFIED | 80 lines; exports `useDeepLinkDashboard`, `DEEP_LINK_UNAVAILABLE_MESSAGE`, `DeepLinkState`; `startedRef` guards StrictMode double-invoke, tested explicitly. |
| `packages/web/src/hooks/useDeepLinkDashboard.spec.ts` | ≥8 `DEEPLINK-114:` tests, all 5 outcomes + StrictMode + session-ended-no-strip | ✓ VERIFIED | 8 tests present, all pass (`npx vitest run` — 8/8 green, confirmed by direct run). |
| `packages/web/src/App.tsx` | Held loading gate, LoginPage above the hold, failure banner, one-shot handoff (page-gated) | ✓ VERIFIED | All present per truths 1/4/5/6 above. |
| `packages/web/src/components/DashboardsPage.tsx` | `initialOpenDashboard` prop, mount-time-only, no `openDashboardUrl` on arrival | ✓ VERIFIED | Lines 89-108; comment block explicitly documents the scope fence. |
| `packages/web/src/App.deeplink.spec.tsx` | ≥9 `DEEPLINK-114:` App-level wiring tests incl. no-flash structural proof | ✓ VERIFIED | 9 tests present (counted directly in file), all pass. |
| `packages/web/src/styles/global.css` `.onboarding-banner` | No hardcoded hex; `--text` defined both themes | ✓ VERIFIED | `color: var(--text)` (line 4826); `--text: #ece9f6` (dark, line 16) / `--text: #1e1b2e` (light, line 126); fix landed in commit `c0ef3dc`. |
| `.planning/phases/114-deep-link-load-error-states/114-UAT.md` | Operator verdict on all 7 checks | ✓ VERIFIED | Present; verdict APPROVED, 6 pass / 1 not exercised / 1 defect found+fixed+re-verified; "Gaps: None outstanding." |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `useDeepLinkDashboard.ts` | `api/client.ts listDashboards` | permission-filtered list lookup | ✓ WIRED | `listDashboards()` called once per authenticated session; `grep -c "dashboards/"` in the hook = 0 (no hand-rolled per-id fetch). |
| `useDeepLinkDashboard.ts` | `dashboardUrl.ts clearDashboardUrl` | strip-on-failure | ✓ WIRED | Called on `unavailable` and (while still authenticated) `error`; explicitly NOT called when the session ends mid-flight (tested). |
| `App.tsx` | `useDeepLinkDashboard` | render-gate + banner + handoff | ✓ WIRED | `deepLink` drives the pending-hold branch, the banner condition, and `initialOpenDashboard`. |
| `App.tsx` | `DashboardsPage` | `initialOpenDashboard` prop, one-shot ref | ✓ WIRED | Prop passed at `:378`; consumed once via lazy `useState` initializer in the child; ref flip gated on `page === "dashboards"`. |
| `DashboardsPage.tsx` (arrival) | `dashboardUrl.ts openDashboardUrl` | deliberately NOT called | ✓ CONFIRMED ABSENT (by design) | 3 occurrences of the string in the file = import + comment + the one real call site at the "Open" button (`:240`), unrelated to arrival. |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|--------------|--------|----------|
| DLINK-V121-02 | 114-01, 114-02 | Visiting a dashboard link opens that dashboard directly, without passing through the list | ✓ SATISFIED | Truths 1, 4, 5, 6 above + UAT-114-1/2/5/7. Traceability updated to Complete (was "In Progress" pending this checkpoint). |
| DLINK-V121-04 | 114-01, 114-02 | Not-permitted link shows a clear message, not blank/broken | ✓ SATISFIED | Truths 2, 3 above + UAT-114-4. Traceability updated to Complete. |
| DLINK-V121-05 | 114-01, 114-02 | Nonexistent dashboard link shows a clear message | ✓ SATISFIED | Truths 2, 3 above + UAT-114-3. Traceability updated to Complete. |

`.planning/REQUIREMENTS.md` and `.planning/ROADMAP.md` were updated by this verification pass: the three requirement checkboxes flipped to `[x]`, the traceability table rows changed from "In Progress ... 114-03 operator checkpoint pending" to "Complete ... 114-03 operator UAT approved 2026-09-11", Phase 114's roadmap checkbox and all three plan checkboxes flipped to `[x]`, and the phase progress table row changed to `3/3 | Complete | 2026-09-11`. No orphaned requirements found — all three IDs mapped to this phase in both the PLAN frontmatter and REQUIREMENTS.md's own Phase-114 mapping.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | None found in the files this phase modified (`dashboardUrl.ts`, `useDeepLinkDashboard.ts`, `App.tsx`, `DashboardsPage.tsx`) | — | No TODO/FIXME/placeholder/empty-handler patterns; no stub returns. |

Carried tech debt (not a Phase 114 gap — confirmed accurate, pre-existing, surfaced by this phase's reuse of `.onboarding-banner`):
- `theme-guard.spec.ts:57` allowlists `global.css` wholesale for its hex scan (reasoning: `:root` blocks legitimately hold hex token definitions), while the structural guard (same file, ~line 150 onward) matches only `px`/`ms` literals via `STRUCTURAL_LITERAL_RE` / `DURATION_LITERAL_RE`. Neither guard checks for raw color literals inside a global.css *rule* (as opposed to a `:root` definition). This is exactly how `#cae8ff` survived in `.onboarding-banner` until UAT caught it visually. Confirmed accurate by direct inspection of both regexes. Logged here for the record per the task instructions; not remediated in this phase (narrowing the exemption has its own blast radius across existing global.css rules).

### Human Verification Required

All seven browser checks were already executed by the operator and recorded in `114-UAT.md` (verdict: APPROVED). For completeness:

1. UAT-114-1 (no-flash on successful arrival) — PASS.
2. UAT-114-2 (loading state is the app shell, not the list's own spinner) — NOT EXERCISED (transition too fast to observe by eye). The structural half is proven automatically (`App.deeplink.spec.tsx` test 1: `DashboardsPage` not in the DOM while pending) and is not, in itself, a gap — the operator explicitly declined to claim a PASS for something unobserved rather than inflate the result, and the fact that it's imperceptible is consistent with (not contradictory to) the hold being real and brief.
3. UAT-114-3 (nonexistent id → banner, param stripped, no replay on reload) — PASS after a real defect (light-mode text contrast) was found, fixed in `c0ef3dc`, and re-verified.
4. UAT-114-4 (real-but-forbidden id → identical banner text, non-leak) — PASS, both texts quoted and confirmed identical.
5. UAT-114-5 (in-app Back stays inside the app) — PASS.
6. UAT-114-6 (junk param → no banner) — PASS.
7. UAT-114-7 (away-and-back doesn't re-open) — PASS.

No further human verification items are outstanding for this phase.

### Gaps Summary

None. All seven derived truths verified either structurally (with a test shown to genuinely discriminate, not merely present) or by direct operator observation in a real browser. The one operator-flagged "not exercised" item (UAT-114-2) is not a gap: it was deliberately not claimed as a pass rather than being inflated, and its structural counterpart is independently proven by an automated test. The one defect UAT surfaced (light-mode banner contrast) was fixed and re-verified within the same UAT session, pre-dating this verification pass. Scope stayed within Phase 114: no server route added, no new dependency, no new CSS class invented, and Phase 115's boundary (unauthenticated arrival → LoginPage only, param preserved) was respected without doing any of Phase 115's actual work.

Traceability documents (`REQUIREMENTS.md`, `ROADMAP.md`) were stale relative to the passed UAT (both still read "In Progress" / pending checkbox) and have been updated by this verification pass to Complete, since the executors correctly declined to self-approve before the operator checkpoint and no plan was scheduled to update them afterward.

---

*Verified: 2026-09-11T14:20:00Z*
*Verifier: Claude (gsd-verifier)*
