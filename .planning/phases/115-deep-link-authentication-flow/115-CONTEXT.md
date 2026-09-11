# Phase 115: Deep Link Authentication Flow - Context

**Gathered:** 2026-09-11
**Status:** Ready for planning

<domain>
## Phase Boundary

A dashboard link works for a visitor who isn't logged in yet — it routes through login and lands them on the dashboard from the link, not the dashboard list.

**In scope:** DLINK-V121-03 — the last open requirement in v1.21, and the last phase of the milestone.

**NOT in scope:** anything Phases 113/114 already settled (URL shape, numeric id, the combined unavailable message, the failure banner on the list). This phase adds no new URL semantics — it makes the existing ones survive an authentication boundary.

**The asymmetry that shapes the whole phase — read this before planning anything:**

- **Password mode:** signing in is a `fetch`; nothing navigates. `window.location.search` still holds `?dashboard=12` throughout. Phase 114's `useDeepLinkDashboard` already stays `{status:"pending"}` while unauthenticated (`hooks/useDeepLinkDashboard.ts` — `if (authStatus !== "authenticated") return;`) and resolves on the transition to authenticated. **A fresh logged-out paste in password mode may already work end-to-end today.** Verify this before writing code for it; if it works, the phase's job there is to pin it with a test, not to build a second path.
- **OIDC mode:** `LoginPage.tsx:32` is a plain `<a href>` full-page navigation to the IdP, and the server's success path redirects to `` `${webRedirectBase}/` `` (`packages/server/src/index.ts:637`). **The query string is destroyed.** This is the case sessionStorage actually has to solve, and the only reason this phase needs storage at all.

**Two hooks were deliberately left here by earlier phases:**
- `App.tsx:331` — the `status !== "authenticated"` branch renders `<LoginPage />` with the `?dashboard=` param untouched in the address bar, on purpose, above the Phase 114 pending hold.
- `DashboardsPage.tsx:648` — `if (useAuthStore.getState().status !== "authenticated") return; // 401/logout: leave it for Phase 115`, inside the deferred unmount clear. So a 401 while viewing a dashboard also leaves the param intact.

</domain>

<decisions>
## Implementation Decisions

### Mechanism — extend Phase 7's ReturnTo, do NOT add a second store

ROADMAP §Phase 115 criterion 2 locks this, and it is not negotiable: "reusing/extending the existing Phase 7 sessionStorage return-to-page mechanism, not a second mechanism."

`type ReturnTo = { page?: Page; dashboardViewMode?: string }` (`App.tsx:36-39`) under `RETURN_TO_KEY = "kbi_returnTo"` (`App.tsx:41`) carries **no dashboard id**. The shape grows to carry one. A separate `kbi_pendingDashboard` key would be the second mechanism the criterion forbids.

Note the existing consumer is defensive about shape (`App.tsx:228-256`: try/catch, an explicit page allow-list, `finally`-clears-regardless, single-use). Any added field must be validated the same way — an id read out of sessionStorage is attacker-controllable in the same sense the page field is, and `App.spec.tsx:180` already proves the allow-list rejects a junk page. Do the equivalent for the id.

### Which journeys count — paste + expiry, NOT explicit logout

**(a) Pasting a link while logged out** — literally DLINK-V121-03.

**(b) A session expiring while you are already viewing a dashboard** — included. Same mechanism, and the param is *already* preserved for it by `DashboardsPage.tsx:648`. Excluding it would ship a known defect: an expiry drops you on the list with a stale `?dashboard=12` still in the address bar, which is exactly the URL/screen mismatch DLINK-V121-07 exists to forbid.

**(c) Explicit logout → log back in** — EXCLUDED. Logout is a deliberate "I'm done here"; restoring the previous view surprises, especially on a shared machine. Logout stays a clean slate.

### Restore depth — the dashboard, in its default state

Land on dashboard 12 with **filters cleared and no config panel open**. Not a deeper restore.

- Matches v1.21's locked scope decision 3, "dashboard identity only in the URL — no filter state, no map viewport."
- Matches what the app already does: the logout/expiry reset chain in `App.tsx` deliberately DROPs server-side filter/dynamic/combination views and resets all 13 stores. Restoring filters would mean not dropping them, or rebuilding them — a different phase.

### Conflict rule — for an EXPIRY, where you actually were wins

Scenario: expiry on the Roles page, with a stale `?dashboard=12` left in the address bar from earlier. After re-auth → **Roles**.

This is the mirror image of Phase 114's rule (a freshly pasted link beats the ReturnTo page restore, `App.tsx:262-275`), and consistent with it under one principle: **whichever signal is the more recent expression of intent wins.** On a paste, the URL is newer. On an expiry, the ReturnTo capture is newer.

Do not treat this as unreachable. Phase 113's clear-on-leave is a deferred `setTimeout(…, 0)` (`DashboardsPage.tsx:646`) that a 401 can outrun — that is precisely how a stale param survives.

### Lifetime — single-use, no TTL

Cleared after restore, exactly like Phase 7's ReturnTo is today. No timestamp, no expiry window.

`sessionStorage` is already per-tab and dies with the tab, so a pending target cannot outlive the browsing session that created it. An explicit TTL would add a clock to get wrong and an arbitrary number to defend, for a bound that already exists.

### Write timing — on COMMIT for a paste, at INTERRUPTION for an expiry

**Fresh paste:** store the target at the moment the user commits to signing in — submitting the password form, or clicking "Sign in with SSO" — **not** when the deep link first reaches the login page.

Why: browsing away from login never commits, so nothing is stored. Without this, a link you walked away from can hijack a later login in the same tab, and nothing on screen explains why you suddenly landed on someone else's dashboard.

**Expiry:** keeps Phase 7's existing timing — the write happens in the `UNAUTHORIZED_EVENT` handler (`App.tsx:186-200`), before `markUnauthenticated`.

**⚠️ Planner: these two write moments are NOT to be unified.** It is tempting to see an inconsistency and collapse them. You cannot: at `UNAUTHORIZED_EVENT` time the in-memory page/dashboard state still exists and is the *only* source of the id; by the time the user clicks Sign in, the components holding it have unmounted. Two journeys, two sources for the id, two write moments. The commit-time rule governs the paste journey only. State this explicitly in the plan so a later reviewer does not file it as a defect.

### Login page signalling — reuse the existing banner, expiry message wins

- Show something like **"Sign in to open this dashboard."** in the existing `login-banner` element — the same slot that already carries "Your session has ended. Please sign in again." (`LoginPage.tsx:25` OIDC branch and `:59` password branch; both would need it). **No new class, no new UI.** Per CLAUDE.md, do not invent a className.
- **Non-leak check (v1.10):** this is safe. It reveals only that *a* dashboard id was in the URL the visitor themselves pasted. It says nothing about whether id 12 exists or who may see it.
- When both conditions apply (an expiry, which by definition means a link was in play), **the session-ended message stands alone.** It is the more urgent and more informative fact; the user already knew which dashboard they were on. One banner, never stacked.

### Landing after login — Phase 114's banner, unchanged

A link that resolves to nothing after sign-in lands on the dashboard list with Phase 114's existing combined message: `DEEP_LINK_UNAVAILABLE_MESSAGE` — "This dashboard isn't available — it may have been deleted, or you may not have access."

This covers the wrong-account case too: **signing in as a different account than the link was meant for IS the no-access case** from the app's point of view, and that message is already deliberately honest about not knowing which reason applies. No new code path, no new string.

Rejected: appending "signed in as X" — it implies the dashboard exists and you are the wrong person, exactly the inference v1.10's conflated 404 (`server/src/index.ts:879/918/949/1043`) exists to prevent.

### After the OIDC round trip — restore `?dashboard=<id>` to the address bar

OIDC returns to a bare `/`. As the dashboard opens, put the param back via `replaceState` so the URL describes the screen.

DLINK-V121-07 is the rule Phase 113 spent two review rounds enforcing. Leaving the bar bare would break Back, break copy-link, and make a refresh silently land on the list — and it would happen only to OIDC users, making it an inconsistency most of the team would never see.

`replaceState`, not `pushState`: the user did not navigate within the app to get here, so no new entry is manufactured. This is the same reasoning `clearDashboardUrl()` documents in `lib/dashboardUrl.ts`. Check whether `buildDashboardUrl` + a thin writer covers it before adding a new exported function.

### Claude's Discretion

- Exact banner copy for the login page.
- The field name and type added to `ReturnTo` (`dashboardId?: number` assumed, not sacred), and how it is validated on read.
- Whether password mode also writes sessionStorage for a single uniform code path, or relies on the URL surviving (Phase 7's storage is OIDC-only today — `App.tsx:190` gates on `authMode === "oidc"`). Either is fine; **whichever is chosen must be justified in the plan and covered by tests in BOTH modes.**
- Whether the address-bar restore reuses an existing helper in `lib/dashboardUrl.ts` or adds one there. It belongs in that module either way.
- How the login-page banner learns there is a pending link (prop, hook, store read) — as long as it is testable without a router.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

No external specs or ADRs — this project keeps its decisions in the planning docs.

### Requirements & scope
- `.planning/REQUIREMENTS.md` — DLINK-V121-03 is this phase and the only one still open; §"Implementation constraints carried into planning" item 4 (Phase 7 is the precedent to extend) and item 5 (v1.10 per-dashboard permissions must not leak existence) are both binding
- `.planning/ROADMAP.md` §"Phase 115" — goal and the 2 success criteria; criterion 2 locks the extend-Phase-7 constraint
- `.planning/PROJECT.md` §"Current Milestone: v1.21" — locked scope decisions 2 (no router dependency) and 3 (dashboard identity only)

### Prior phases in this chain (all three matter)
- `.planning/phases/113-dashboard-url-sync/113-CONTEXT.md` — URL shape, numeric id, and the History-API model this phase must not disturb
- `.planning/phases/114-deep-link-load-error-states/114-CONTEXT.md` — the combined-message decision and its security reasoning, the loading-hold rule, and the strip-on-failure rule
- `.planning/phases/114-deep-link-load-error-states/114-UAT.md` — what the operator actually verified, incl. UAT-114-2 recorded as **not exercised** (loading state too fast to observe) and the light-mode banner defect found there

### Project conventions (binding)
- `CLAUDE.md` — UI conventions (**never invent a className**; theme tokens only, no raw hex) AND §"Writing verifiable acceptance criteria" (a grep guard must read 0 before the work is done; route genuinely unverifiable requirements to a human checkpoint)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`App.tsx:36-41` + `:186-200` + `:224-257`** — the whole Phase 7 ReturnTo mechanism: the type, the key, the `UNAUTHORIZED_EVENT` write, and the validate-restore-clear read. This phase extends these three sites; it should not add a fourth storage concern.
- **`hooks/useDeepLinkDashboard.ts`** — already auth-aware and already correct for this phase's needs. It holds `{status:"pending"}` while unauthenticated, and its `.catch` deliberately re-arms `startedRef` and does NOT strip the param when a 401 lands mid-flight, with the comment "Phase 115 consumes it after re-auth." Prefer feeding this hook over duplicating its resolution logic.
- **`lib/dashboardUrl.ts`** — `buildDashboardUrl`, `clearDashboardUrl`, `readDashboardIdFromSearch`, `hasDashboardParam`. The address-bar restore belongs here.
- **`hooks/useDeepLinkDashboard.spec.ts`, `lib/dashboardUrl.spec.ts`, `App.deeplink.spec.tsx`, `App.spec.tsx`** — existing spec homes. `App.spec.tsx:101-190` is the Phase 7 ReturnTo suite (OIDC-gated write, allow-list, single-use clear, corrupt-JSON tolerance) — **extending `ReturnTo`'s shape will land next to these tests, and they are the template for validating the new field.**
- **`LoginPage.tsx`** — the `login-banner` element exists in BOTH branches (`:25` OIDC, `:59` password). Reuse it.

### Established Patterns
- **Two login branches, not one.** `LoginPage` returns early for `authMode === "oidc"` (`:20-37`) before the password form. Any banner change must be applied to both, and any test must cover both.
- **`authMode` is `"password" | "oidc" | null`** (`store/auth.ts`), where `null` means the pre-auth `/config` read failed and the password form is the fallback. Treat `null` as password mode, as `LoginPage` already does.
- **Phase 7 storage is OIDC-only.** `App.tsx:190` gates the ReturnTo write on `authMode === "oidc"`, with the rationale that in password mode in-memory `useState` survives. That rationale does NOT hold for a fresh paste in either mode, and does not hold for password-mode *expiry* either — the components unmount. Re-examine the gate rather than assuming it still fits.
- **Server-side: the OIDC success redirect is `` `${webRedirectBase}/` `` (`packages/server/src/index.ts:637`), and every failure redirects to `/login?error=…`.** Read-only for this phase — **v1.21 is frontend-only.** Do not propose threading the dashboard id through the OIDC `state` parameter or the redirect URI; that is a server change and it is out of scope.

### Integration Points
- `App.tsx` — owns auth bootstrap, the ReturnTo write and read, the `status !== "authenticated"` → LoginPage branch (`:331`), the Phase 114 pending hold (`:339`), and the deep-link → page effect (`:268-275`). This phase's changes are concentrated here. **Phase 114 was the first phase to modify `App.tsx` in this milestone; the ordering comments it left at `:262-267` and `:88-94` explain why the current effect order is deterministic — read them before reordering anything.**
- `LoginPage.tsx` — needs to know a deep link is pending (for the banner) and needs a commit moment (form submit + SSO link click) to trigger the store-on-commit write. The SSO branch is a bare `<a href>` with no `onClick` **by deliberate Phase 7 design**; adding one is the natural implementation but the existing comment at `:16-18` explains why it was avoided, so the plan should address that explicitly rather than silently reverse it.
- `DashboardsPage.tsx:648` — read-only for this phase, but it is the reason the expiry journey works at all. Do not "tidy" that guard.

### Known hazards from this chain
- **StrictMode double-invoke** — Phase 114's `startedRef` and the one-shot `deepLinkConsumedRef` handoff (`App.tsx:86-94`) both exist because of it. Any new one-shot flag needs the same treatment; Wave 2 of Phase 114 found a real bug in the plan's own prescribed code at exactly this seam.
- **theme-guard does not catch colour literals in `global.css` rules** — it exempts that file wholesale from the hex scan. The Phase 114 light-mode banner defect (`.onboarding-banner` hardcoding `#cae8ff`) got through that hole and was caught only by the operator's eye. If this phase touches banner CSS, **check it in light mode manually.**
- **`test/setup.ts:54` clears `sessionStorage` per test** — relied on by the Phase 7 suite; new tests inherit it.

</code_context>

<specifics>
## Specific Ideas

- The originating request: *"Need a way to provide a url to a dashboard. Right now you have to navigate from the dashboard list page."* Phase 114 delivered that for a logged-in user; **115 is what makes the link work for the person you send it to**, who is the actual point of a shareable link and who is, by default, not logged in on the machine where they open it.
- The operator's framing throughout v1.21 has been that the URL is a thing people paste to each other. A pasted link that dead-ends at a login screen and then forgets where it was going is the failure this phase exists to prevent.

</specifics>

<deferred>
## Deferred Ideas

- **Explicit logout → return to the dashboard you left** — considered and deliberately excluded above. Not a defect; a decision.
- **Restoring filter state across an expiry** — would require not DROPping server-side materialized views on the logout chain, or rebuilding them. Its own phase, and it reopens the v1.4 exclusion.
- **"Sign in as someone else" recovery action on the unavailable banner** — a genuinely nice affordance for the wrong-account case, but a new flow, and it leaks existence by implication.
- **Distinguishing not-found from not-permitted** — carried from Phase 114. Needs a `GET /api/dashboards/:id` and a deliberate decision to leak existence. Revisit only on an explicit customer ask.
- **Sidebar "Dashboards" link is a no-op while a dashboard is open** (`App.tsx:355`) — pre-existing tech debt surfaced in Phase 113 UAT, carried unclosed through 114. This phase works in `App.tsx` again, so it will be in view. It is still NOT in scope.
- **Narrowing theme-guard's `global.css` exemption to `:root` blocks only** — the hole that let the Phase 114 light-mode defect through. A test-infrastructure fix, not a v1.21 feature.

</deferred>

---

*Phase: 115-deep-link-authentication-flow*
*Context gathered: 2026-09-11*
