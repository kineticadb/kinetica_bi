# Phase 115: Deep Link Authentication Flow - Research

**Researched:** 2026-09-11
**Domain:** Client-side auth/routing state machines (React + zustand, native History API, sessionStorage) — no new libraries
**Confidence:** HIGH (all findings are direct code reads + one executed, deleted throwaway RTL test; nothing here rests on training-data assumptions about the codebase)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Mechanism — extend Phase 7's ReturnTo, do NOT add a second store.** ROADMAP §Phase 115 criterion 2 locks this: "reusing/extending the existing Phase 7 sessionStorage return-to-page mechanism, not a second mechanism." `type ReturnTo = { page?: Page; dashboardViewMode?: string }` (`App.tsx:36-39`) under `RETURN_TO_KEY = "kbi_returnTo"` (`App.tsx:41`) carries no dashboard id today. The shape grows to carry one. A separate `kbi_pendingDashboard` key would be the second mechanism the criterion forbids. The existing consumer's defensive validation (try/catch, explicit page allow-list, `finally`-clears-regardless, single-use) must be matched for the new id field.

**Which journeys count — paste + expiry, NOT explicit logout.**
(a) Pasting a link while logged out — literally DLINK-V121-03.
(b) A session expiring while already viewing a dashboard — included (same mechanism; the param is already preserved for it by `DashboardsPage.tsx:648`). Excluding it would ship a known defect (stale `?dashboard=12` after landing on the list, violating DLINK-V121-07).
(c) Explicit logout → log back in — EXCLUDED. Logout is a deliberate "I'm done here"; restoring the previous view surprises, especially on a shared machine.

**Restore depth — the dashboard, in its default state.** Land on dashboard 12 with filters cleared and no config panel open. Not a deeper restore (matches v1.21 locked scope decision 3: "dashboard identity only in the URL — no filter state, no map viewport").

**Conflict rule — for an EXPIRY, where you actually were wins.** Scenario: expiry on the Roles page, with a stale `?dashboard=12` left in the address bar from earlier. After re-auth → Roles. This is the mirror image of Phase 114's rule (a freshly pasted link beats the ReturnTo page restore, `App.tsx:262-275`), under one principle: whichever signal is the more recent expression of intent wins. On a paste, the URL is newer. On an expiry, the ReturnTo capture is newer.

**Lifetime — single-use, no TTL.** Cleared after restore, exactly like Phase 7's ReturnTo today. No timestamp, no expiry window — `sessionStorage` is already per-tab and dies with the tab.

**Write timing — on COMMIT for a paste, at INTERRUPTION for an expiry.** Fresh paste: store the target at the moment the user commits to signing in (submitting the password form, or clicking "Sign in with SSO") — not when the deep link first reaches the login page. Expiry: keeps Phase 7's existing timing — the write happens in the `UNAUTHORIZED_EVENT` handler (`App.tsx:186-200`), before `markUnauthenticated`. **These two write moments are NOT to be unified** — at `UNAUTHORIZED_EVENT` time the in-memory page/dashboard state still exists and is the only source of the id; by the time the user clicks Sign in, the components holding it have unmounted. State this explicitly in the plan so a later reviewer does not file it as a defect.

**Login page signalling — reuse the existing banner, expiry message wins.** Show something like "Sign in to open this dashboard." in the existing `login-banner` element — the same slot that already carries "Your session has ended. Please sign in again." (`LoginPage.tsx:25` OIDC branch and `:59` password branch; both need it). No new class, no new UI. Non-leak check (v1.10): safe — reveals only that a dashboard id was in the URL the visitor themselves pasted. When both conditions apply (an expiry, which by definition means a link was in play), the session-ended message stands alone — never stacked.

**Landing after login — Phase 114's banner, unchanged.** A link that resolves to nothing after sign-in lands on the dashboard list with Phase 114's existing combined message (`DEEP_LINK_UNAVAILABLE_MESSAGE`). This covers the wrong-account case too. No new code path, no new string. Rejected: appending "signed in as X."

**After the OIDC round trip — restore `?dashboard=<id>` to the address bar.** OIDC returns to a bare `/`. As the dashboard opens, put the param back via `replaceState` so the URL describes the screen (DLINK-V121-07). `replaceState`, not `pushState`: the user did not navigate within the app to get here, so no new entry is manufactured. Check whether `buildDashboardUrl` + a thin writer covers it before adding a new exported function.

### Claude's Discretion

- Exact banner copy for the login page.
- The field name and type added to `ReturnTo` (`dashboardId?: number` assumed, not sacred), and how it is validated on read.
- Whether password mode also writes sessionStorage for a single uniform code path, or relies on the URL surviving (Phase 7's storage is OIDC-only today — `App.tsx:190` gates on `authMode === "oidc"`). Either is fine; whichever is chosen must be justified in the plan and covered by tests in BOTH modes.
- Whether the address-bar restore reuses an existing helper in `lib/dashboardUrl.ts` or adds one there. It belongs in that module either way.
- How the login-page banner learns there is a pending link (prop, hook, store read) — as long as it is testable without a router.

### Deferred Ideas (OUT OF SCOPE)

- **Explicit logout → return to the dashboard you left** — considered and deliberately excluded. Not a defect; a decision.
- **Restoring filter state across an expiry** — would require not DROPping server-side materialized views on the logout chain, or rebuilding them. Its own phase, and it reopens the v1.4 exclusion.
- **"Sign in as someone else" recovery action on the unavailable banner** — a nice affordance for the wrong-account case, but a new flow, and it leaks existence by implication.
- **Distinguishing not-found from not-permitted** — carried from Phase 114. Needs a `GET /api/dashboards/:id` and a deliberate decision to leak existence. Revisit only on an explicit customer ask.
- **Sidebar "Dashboards" link is a no-op while a dashboard is open** (`App.tsx:355`) — pre-existing tech debt, still NOT in scope.
- **Narrowing theme-guard's `global.css` exemption to `:root` blocks only** — a test-infrastructure fix, not a v1.21 feature.

### Additional binding constraints (from the research brief, not CONTEXT.md itself)

- **v1.21 is frontend-only.** No server changes. Do NOT thread the dashboard id through the OIDC `state` parameter, redirect URI, or `WEB_REDIRECT_BASE`.
- **No new dependency, no router.**
- **No second sessionStorage key** (ROADMAP criterion 2).
</user_constraints>

## Summary

This phase is a small, surgical extension of an existing, already-tested state machine — not new infrastructure. The empirical spike (Q1) proves the password-mode journey already works today with zero code changes; the only real remaining engineering is (a) a synchronous `onClick` on the OIDC anchor to commit the pending id into the existing `ReturnTo` sessionStorage shape before the full-page redirect destroys the query string, (b) one new validated field on that shape plus a matching read-side guard, (c) a small change to how `useDeepLinkDashboard` acquires its id so it can also be fed from a restored `ReturnTo` after the OIDC round trip, and (d) one precedence inversion for the expiry-while-elsewhere conflict rule.

The single most important finding is negative: **`reason: "session-expired"` cannot be used as the expiry/paste discriminator** (Q5) — it is wiped in the exact same `set()` call that flips `status` to `"authenticated"`, in both `login()` and `bootstrap()`'s `/me` success branch (`store/auth.ts`), so it is already `null` by the time any restore effect runs. The real, working discriminator is structural: whether the restored `ReturnTo.page` is `"dashboards"` or something else — no new field needed for it.

**Primary recommendation:** Extend `ReturnTo` with one field (`dashboardId?: number`), write it only at the two commit moments CONTEXT.md already specifies (OIDC anchor `onClick`, unchanged `UNAUTHORIZED_EVENT` handler), feed `useDeepLinkDashboard` via a new optional parameter (not a second URL/sessionStorage read inside the hook), and gate the existing `deepLink.status === "opened"` effect in `App.tsx` on whether the restored ReturnTo page was `"dashboards"` — treating "elsewhere" as an immediate one-shot suppression, not just a timing delay.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-------------------|
| DLINK-V121-03 | Visiting a dashboard link while not authenticated routes to login, then lands on that dashboard once authenticated | Q1 proves the password-mode half of this already works (regression test only). Q2–Q5 give the full design for the OIDC half (commit-time write, restore, address-bar rewrite, and the expiry-vs-paste conflict rule) plus the exact existing code sites (`App.tsx:36-41,186-206,224-260,262-275`, `LoginPage.tsx:20-37`, `hooks/useDeepLinkDashboard.ts`, `lib/dashboardUrl.ts`) the planner must touch. |

</phase_requirements>

---

## Q1 — Does password-mode already work end-to-end, with zero code changes?

**YES — verified empirically. Confidence: HIGH (executed test, not reasoning).**

I wrote a throwaway RTL test (`packages/web/src/App.q1throwaway.spec.tsx`, deleted after this research — full content below for the planner to reuse as the regression test), mounted `<App />` with `window.history.replaceState(null, "", "/?dashboard=12")` and `useAuthStore` seeded `{ status: "unauthenticated", authMode: "password" }`, asserted `<LoginPage />`'s real password form renders and `window.location.search` is untouched, then flipped the store in-place to `{ status: "authenticated", authMode: "password" }` (this is exactly what a real password `login()` success does — an in-place zustand `set()`, no navigation) and asserted the dashboard opens with the id from the URL.

**First attempt failed** — but the failure was a test-authoring bug, not an app bug, and it is instructive: my first `DashboardsPage` stub read `initialOpenDashboard` as a plain prop and rendered it directly. `App.tsx`'s own effects (the `deepLink.status === "opened"` effect at `:268-275`, which calls `setDashboardViewMode("open")`) fire in the same flush and force a **second** render of `App` in which `initialOpenDashboardConsumedRef` gating recomputes `initialOpenDashboard` — a dumb prop-reflector stub sees that second render's value and appears to lose the id. `App.deeplink.spec.tsx` already documents this exact trap in a comment (lines 27-32: "Mirror that mount-only contract here rather than a dumb prop-reflector, which would falsely fail on a correct App.tsx"). I had read that comment and still made the mistake on the first pass — strong evidence this is a real, easy-to-hit trap for whoever writes Phase 115's regression test, not a hint about the real code. Once the stub was corrected to mirror the **real** `DashboardsPage`'s mount-time `useState(() => initialOpenDashboard)` lazy-capture contract (`DashboardsPage.tsx:107`), the test passed cleanly.

**Confirmed passing test output:**
```
Test Files  1 passed (1)
     Tests  1 passed (1)
```

**Why it works, mechanically:** `useDeepLinkDashboard`'s `useState` initializer reads `window.location.search` once, at `App`'s first-ever mount. In password mode there is no navigation between "unauthenticated" and "authenticated" — the same `App` instance, same hook instance, same `state` survives the transition. The hook's own effect (`hooks/useDeepLinkDashboard.ts:48-77`) already guards `if (authStatus !== "authenticated") return;`, so it just waits. `App.tsx:331`'s `status !== "authenticated"` branch renders `<LoginPage />` **above** the Phase 114 pending-hold (`:339`), so the login form itself never notices the pending deep link. When `status` flips to `"authenticated"`, the hook's effect re-fires (dep `[state, authStatus]`), calls `listDashboards()`, resolves, and the existing `deepLink.status === "opened"` effect (`:268-275`) opens it. No code in this chain is OIDC-specific.

**Consequence for phase shape:** confirmed per CONTEXT.md's own framing — password mode needs **only a regression test** pinning this behavior, not new code. All real engineering in this phase is the OIDC half (Q2–Q5).

### Throwaway test content (for the planner to adapt into the real regression test)

```tsx
// THROWAWAY — Phase 115 research spike (Q1). Already deleted from the working tree.
import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { act, render, screen } from "@testing-library/react";
import { useAuthStore } from "./store/auth";

vi.mock("./components/Sidebar", () => ({ default: () => <nav data-testid="sidebar" /> }));
vi.mock("./components/Topbar", () => ({ default: () => <header data-testid="topbar" /> }));
// Mirror the REAL DashboardsPage's mount-time lazy-useState capture contract — a dumb
// prop-reflector falsely fails (App's own effects mutate the prop's upstream state after mount).
vi.mock("./components/DashboardsPage", () => ({
  default: ({ initialOpenDashboard }: { initialOpenDashboard?: { id: number } }) => {
    const [captured] = useState(() => initialOpenDashboard);
    return (
      <main data-testid="page-dashboards" data-deeplink={captured ? String(captured.id) : ""}>
        Dashboards
      </main>
    );
  },
}));
vi.mock("./components/DatasetsPage", () => ({ default: () => <main data-testid="page-datasets" /> }));
// Real LoginPage NOT mocked — we want the real password-form branch to render.
vi.mock("./components/Toast", () => ({ default: () => null }));
vi.mock("./api/client", async () => {
  const actual = await vi.importActual<typeof import("./api/client")>("./api/client");
  return {
    ...actual,
    dropFilterView: vi.fn(() => Promise.resolve({ dropped: true as const })),
    dropDynamicView: vi.fn(() => Promise.resolve({ dropped: true as const })),
    fetchAuthConfig: vi.fn(() => Promise.resolve({ authMode: "password" as const })),
    fetchMe: vi.fn(() => Promise.resolve(null)),
    listUsers: vi.fn(() => Promise.resolve([])),
    listDashboards: vi.fn(() => Promise.resolve([{
      id: 12, name: "Deep Linked", filter_display_mode: "topbar" as const,
      created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
    }])),
    fetchWmsCapabilities: vi.fn(() => Promise.resolve({
      renderModes: [], colormaps: [], spatialModes: [], srs: [], source: "fallback" as const,
    })),
  };
});
vi.mock("./components/UsersPage", () => ({ UsersPage: () => <main data-testid="page-users" /> }));
vi.mock("./components/RolesPage", () => ({ RolesPage: () => <main data-testid="page-roles" /> }));
vi.mock("./components/ProfilePage", () => ({ ProfilePage: () => <main data-testid="page-profile" /> }));
vi.mock("./components/settings/BrandingSettingsPage", () => ({ BrandingSettingsPage: () => <main data-testid="page-branding" /> }));

import App from "./App";

const setAuth = (patch: Partial<ReturnType<typeof useAuthStore.getState>>) => {
  act(() => { useAuthStore.setState(patch); });
};

describe("password-mode logged-out deep link paste", () => {
  it("survives an in-place unauthenticated->authenticated flip and opens the dashboard", async () => {
    window.history.replaceState(null, "", "/?dashboard=12");
    setAuth({ status: "unauthenticated", user: null, authMode: "password", reason: null, error: null, bootstrap: async () => {} });

    render(<App />);

    expect(await screen.findByLabelText(/username/i)).toBeInTheDocument();
    expect(window.location.search).toBe("?dashboard=12");
    expect(screen.queryByTestId("page-dashboards")).toBeNull();

    // In-place store flip — exactly what auth.login() success does. No navigation.
    setAuth({ status: "authenticated", user: { username: "alice", roles: [], permissions: [] }, authMode: "password" });

    const page = await screen.findByTestId("page-dashboards");
    expect(page.getAttribute("data-deeplink")).toBe("12");
    expect(window.location.search).toBe("?dashboard=12");
  });
});
```

---

## Q2 — The commit-moment write for the OIDC journey

**Confidence: HIGH.**

- **Adding `onClick` alongside `href` is safe.** `sessionStorage.setItem` is synchronous. A native `<a>` click runs all registered listeners (React's synthetic `onClick` included) to completion *before* the browser executes the anchor's default action (the full-page navigation), unless a listener calls `preventDefault()`. As long as the new `onClick` does not call `preventDefault()` and does not `await` anything before the write, the write is guaranteed to land before the browser unloads the page. This also fires on keyboard-triggered activation (Enter on a focused link), which `pointerdown` would not — `onClick` is strictly the more correct seam of the two, not just the more convenient one.
- **No existing test asserts the anchor has no handler.** `grep -c "onClick" packages/web/src/components/LoginPage.spec.tsx` → **0**. Nothing in the current suite pins the "deliberately no onClick" design from Phase 7's comment; adding one will not require deleting or contradicting an existing assertion.
- **No cleaner seam exists elsewhere in the codebase.** The password form's own commit moment is `onSubmit` (`LoginPage.tsx:57`, `handleSubmit`) — already the natural mirror for OIDC's `onClick`, both firing at "user just committed to signing in." A grep for `pointerdown` across `packages/web/src` for auth-adjacent components turns up nothing; there is no pre-existing pattern to prefer over `onClick`.

**Recommendation:** add a synchronous `onClick` to the `<a href={...oidc/start}>` in `LoginPage.tsx:32` that reads the pending id (via a prop/hook, per CONTEXT's "Claude's Discretion" on how the banner learns of it — the same signal can feed the write) and writes it into `ReturnTo` using the *existing* write helper/shape, mirroring `App.tsx:190-199`'s existing OIDC-gated write but triggered from the click instead of `UNAUTHORIZED_EVENT`.

## Q3 — Extending `type ReturnTo` safely

**Confidence: HIGH.**

**Current read-side validation** (`App.tsx:224-260`): wrapped in try/catch; `page` is validated via an explicit allow-list (`"dashboards" | "datasets" | "settings" | "users" | "roles" | "profile"`, plus `"branding"` gated additionally on `hasPermission(PERMISSIONS.BRANDING_MANAGE)`); `dashboardViewMode` is validated only as `typeof parsed.dashboardViewMode === "string"` (looser than `page` — no allow-list on it today, worth noting but out of this phase's scope to tighten); `finally` always clears the key if `raw !== null`, regardless of parse success — true single-use.

**Equivalent validation for a new `dashboardId` field:** must NOT simply be `typeof === "number"` (too loose — `-3`, `0`, `1.5` would all pass). It must mirror the semantics already enforced for the URL param by `readDashboardIdFromSearch` (`lib/dashboardUrl.ts:27-32`: positive integer only). Recommend extracting/exporting a tiny shared predicate from `lib/dashboardUrl.ts` (e.g. `isValidDashboardId(x: unknown): x is number` — positive integer check) so the URL-parsing path and the ReturnTo-parsing path use ONE definition, not two independently-maintained regexes/checks. This is exactly the phase's "Don't Hand-Roll" opportunity (see below).

**Which existing tests would break:** none. `grep -n "toEqual({ page\|JSON.stringify({ page" packages/web/src/App.spec.tsx packages/web/src/App.deeplink.spec.tsx` shows every existing write-side fixture sets up `{ page: "..." }` as *input* and every read-side assertion checks `toHaveProperty("page")` / `toHaveProperty("dashboardViewMode")` or specific page-render outcomes — none assert a closed/exact shape on the object. Confirmed by direct grep, not inference. Adding `dashboardId?: number` to the type and to the write payload at `App.tsx:193` breaks nothing already green.

**Template for the new field's tests:** `App.spec.tsx:169-186` (`"does NOT crash on corrupt JSON; clears the key"` and `"rejects unknown 'page' values; key is still cleared"`) is the direct template — write a junk `dashboardId` (`"abc"`, `-3`, `0`, `1.5`, missing), assert the dashboard is NOT opened, the key is still cleared, and the app does not crash.

**Whether `App.tsx:190`'s `authMode === "oidc"` gate should stay, widen, or be bypassed for the dashboard-id field:**

Recommendation: **the gate should stay exactly as-is for the `UNAUTHORIZED_EVENT`/expiry write** (no change to `App.tsx:186-206`'s existing condition) — the rationale there ("password mode in-memory state survives the transition") is Q1-verified true for `page`/`dashboardViewMode` and remains true for a dashboard id captured the same way (Q1's test proves the URL itself, not sessionStorage, is the password-mode carrier). **But the NEW commit-time write (Q2, `LoginPage.tsx`'s `onClick`) is only reachable from the OIDC branch of `LoginPage` at all** (`authMode === "oidc"` is the `if` that returns that JSX in the first place, `LoginPage.tsx:20`) — so there is no separate gate to reconsider there; it is structurally OIDC-only by virtue of living inside the OIDC-only branch. Password mode's commit moment (`handleSubmit`, `:42-53`) needs **no** sessionStorage write at all, because Q1 proves the URL alone already carries the id through an in-place status flip. Writing to `ReturnTo` from password mode as well would be redundant and would introduce a *second* place to reconcile against the same URL-sourced id — actively worse, not just unnecessary. **Justification for the plan:** "one mechanism, two write sites, gated by which navigation model applies — OIDC writes because it navigates away and back; password does not write because it never leaves." Tests in BOTH modes (per CONTEXT's requirement) means: password mode gets Q1's regression test (proves no write needed); OIDC mode gets a new test asserting the `onClick` write fires and the key round-trips correctly.

## Q4 — The restore path and the address-bar rewrite

**Confidence: HIGH — with one option in CONTEXT's list eliminated as actively harmful, and a note on an ordering hazard the recommended option itself has to defend against.**

CONTEXT.md poses three options for feeding a stored id into `useDeepLinkDashboard`. Evaluated:

1. **URL rewritten before the hook initializes** (option "does the URL get rewritten before the hook initializes"): possible only because the OIDC round trip is a genuine fresh page load — `useDeepLinkDashboard`'s lazy `useState` initializer runs exactly once, at that fresh mount, so a synchronous `history.replaceState` executed before React's first render (e.g. very top of `main.tsx`, or inline at module scope before `App` mounts) would make the hook's existing `readDashboardIdFromSearch(window.location.search)` just work unmodified. **This is legitimate and simplest for the hook itself** (zero changes to `useDeepLinkDashboard.ts`), but it means the "read ReturnTo and rewrite the URL" logic has to live OUTSIDE `App`'s component body/effects (since App's own render already needs the id present in the URL to make the *existing* lazy initializer see it) — i.e. it has to run before or during module evaluation, which is an unusual place to put "read sessionStorage, validate, write history" logic and makes it hard to unit test with RTL's normal `render(<App />)` pattern (there is no seam to call before render inside a test without replicating the exact placement). This works but is awkward to test in isolation.
2. **An alternate source read directly inside the hook** (option "an alternate source"): would require `useDeepLinkDashboard.ts` to import the `RETURN_TO_KEY` constant and `ReturnTo` shape — both of which are currently owned by `App.tsx`, not exported. This is the literal "duplicating its resolution logic" CONTEXT.md warns against avoiding, and creates a second consumer of the same sessionStorage key with its own parsing/validation copy (risk of drift from `App.tsx`'s validation). **Not recommended.**
3. **A parameter to the hook** (option "a parameter"): extend `useDeepLinkDashboard(pendingId?: number | null)` and add an effect inside the hook, parallel to the existing `authStatus` effect, that transitions `state.status === "none" → "pending"` when `pendingId` arrives after mount. `App.tsx` computes this parameter from its OWN existing ReturnTo-restore effect (`:224-260`) — that effect already owns parsing/validating the shape; it would set a new `useState<number | null>` alongside its existing `setPage`/`setDashboardViewMode` calls, and pass that state into `useDeepLinkDashboard(pendingDashboardId)`. Because the restore effect is a **normal effect** (not the hook's lazy initializer), the state update it produces triggers a real re-render, on which the hook receives the new parameter and its own effect (dependent on the parameter) can react to it — no different in kind from how the hook already reacts to `authStatus` changing after mount.

**Recommendation: option 3 (parameter).** It keeps the hook's ownership boundary intact (App.tsx still owns all `ReturnTo` parsing; the hook only ever receives a plain validated number-or-null), and it is directly testable with `renderHook`/`setState` exactly like the hook's existing `useDeepLinkDashboard.spec.ts` suite already does for `authStatus`.

**`lib/dashboardUrl.ts` coverage check:** `buildDashboardUrl` (pure, id-in/id-out) + `clearDashboardUrl` (replaceState-only writer, id→null) already exist. There is **no existing id→writer** — `clearDashboardUrl` only handles the null case. A small new export mirroring it (e.g. `restoreDashboardUrl(id: number): void` doing `window.history.replaceState(null, "", buildDashboardUrl(window.location, id))`) is the minimal addition; this is "one small new export," consistent with CONTEXT's framing, not a new module or a new concept. Call it once, unconditionally, whenever `deepLink.status` transitions to `"opened"` in `App.tsx`'s existing effect (`:268-275`) — it is idempotent (a no-op if the URL already has the right param), so it is safe to call regardless of whether the id came from the URL directly (password mode, or an already-authenticated paste) or from the restored `ReturnTo` (post-OIDC).

**Interaction with `deepLinkConsumedRef` (`App.tsx:86-97`) and Phase 114's Wave-2 bug:** Phase 114's real bug was the ref flipping (burning the one-shot) on a render where `deepLink.status === "opened"` but `page` had not yet become `"dashboards"` — fixed by adding the `page === "dashboards"` gate to the flip effect. **Phase 115 reopens exactly this class of hazard for the expiry-while-elsewhere case** (see Q5): if a stale `?dashboard=<id>` resolves to `"opened"` while a restored `ReturnTo.page` is `"roles"`, the existing gate correctly refuses to flip the ref *yet* — but that only defers the flip, it does not suppress the deep link. If the user later manually navigates to the Dashboards page in the *same session* (sidebar click), the gate condition (`deepLink.status === "opened" && !deepLinkConsumedRef.current`) will now be satisfied and silently reopen the stale dashboard the user never asked for in this session — a real repeat of the Wave-2 defect class, worse because it's delayed rather than immediate. **The fix must not just delay the ref flip — it must set `deepLinkConsumedRef.current = true` immediately, as part of the same effect that decides "ReturnTo page wins," at the moment that decision is made** (see Q5), not wait for `page === "dashboards"` to become true naturally (it may never become true again this session, or may become true much later after the suppression should already have expired the deep link).

## Q5 — The conflict rule and the expiry journey

**Confidence: HIGH on the mechanism; this is the one finding CONTEXT.md explicitly invited scrutiny on, and the invited candidate (`reason`) is disproven with code evidence, not assumption.**

**`reason: "session-expired"` CANNOT be the discriminator — verified by direct code read of `store/auth.ts`:**
- `login()` success: `set({ status: "authenticated", user, error: null, reason: null })` — `reason` is nulled in the exact same `set()` call that flips `status`.
- `bootstrap()`'s `/me` success branch: `set({ status: "authenticated", ..., error: null, reason: null })` — same pattern.

Because zustand's `set()` is synchronous and both fields change in one call, by the time `App.tsx`'s `useEffect(() => { if (status !== "authenticated") return; ... }, [status])` restore effect runs (on the render where `status` becomes `"authenticated"`), `useAuthStore.getState().reason` is **already** `null`. There is no render, no effect, no timing window in which both `status === "authenticated"` and `reason === "session-expired"` are simultaneously true. Any plan that reads `reason` at restore time to decide "was this an expiry" will silently always see `null` and always take the non-expiry branch — a bug that would pass `tsc` and any naive test that doesn't specifically assert the `reason` value at that exact moment. **Flagging this loudly per CLAUDE.md's instruction to never quietly route around a locked-decision-adjacent dead end:** CONTEXT.md's own discretion list explicitly invites `reason` as a candidate discriminator; it does not work, for the structural reason above.

**The actual working discriminator is structural, not a new field:** whether the *restored* `ReturnTo.page` equals `"dashboards"` (the default) or something else.

- **Expiry while ON the dashboard:** at `UNAUTHORIZED_EVENT` time, in-memory `page === "dashboards"` (Phase 7's existing capture, unchanged). Restoring `page: "dashboards"` is a pure no-op (it's already the app's default). Meanwhile `DashboardsPage.tsx:648`'s existing guard has already left the stale `?dashboard=<id>` in the URL untouched. `useDeepLinkDashboard` naturally resolves it after re-auth exactly like a fresh paste — **no new code needed for this sub-case**; it already reduces to Q1's mechanism.
- **Expiry while elsewhere (e.g. Roles), with a stale URL param left over from an earlier, already-closed dashboard visit:** at `UNAUTHORIZED_EVENT` time, in-memory `page === "roles"` — captured and restored exactly as today. The stale `?dashboard=<id>` in the URL is genuinely stale (the user was NOT viewing it at the moment of expiry; they had already navigated away, and the address-bar clear that should have run got outrun by the 401 — the exact race `DashboardsPage.tsx:646-651`'s comment already documents). **This is the one case needing new logic:** when the restored `ReturnTo.page` is present and not `"dashboards"`, that restore must win over whatever `useDeepLinkDashboard` does with the stale param — i.e., the existing `deepLink.status === "opened"` effect (`App.tsx:268-275`) must be gated to skip its `setPage("dashboards")` call in this case, and must instead call `clearDashboardUrl()` to strip the stale param (satisfying DLINK-V121-07 — the address bar must not describe Roles-with-a-live-dashboard-link when the user is on Roles with nothing open), and must set `deepLinkConsumedRef.current = true` immediately (see Q4) to prevent the stale link resurfacing later in the session.

**Proposed discriminator, precisely:** a new ref/state in `App.tsx`, set inside the existing ReturnTo-restore effect (`:224-260`) at the moment a *non-`"dashboards"`* page is actually restored (i.e., `parsed.page` was present, in the allow-list, and not `"dashboards"`) — call it e.g. `returnToWonElsewhereRef.current = true`. The deep-link effect (`:268-275`) checks this ref before acting on `"opened"`.

**Failure mode of this discriminator, named:** it only fires correctly if the restore effect and the deep-link effect observe the SAME render/commit ordering guarantees Phase 114 already established (ReturnTo restore runs synchronously on the `status` transition; deep-link resolution can only complete after an awaited `listDashboards()` call, so it is always observed later) — this ordering is already documented and load-bearing at `App.tsx:262-267`'s existing comment, and Phase 115 does not change it, only adds a read of one more ref inside the already-later-firing effect. The one edge this discriminator does NOT cover: a **fresh, unauthenticated paste of a link to page `X`'s dashboard while an unrelated stale `ReturnTo.page` from a much earlier, already-expired browser session still happens to sit in `sessionStorage`** (e.g., the tab was left open for hours, a completely unrelated earlier expiry wrote `{page: "roles"}`, and now, still unauthenticated, the user pastes a fresh dashboard link and signs in). In this edge case the discriminator would (incorrectly) treat the stale leftover `ReturnTo.page: "roles"` as "expiry wins," landing the user on Roles instead of their freshly-pasted link — a real, if narrow, gap. **Recommendation to the planner:** the commit-time OIDC write (Q2) should itself overwrite/clear any pre-existing `ReturnTo.page` when a fresh paste is being committed (write `{ dashboardId, page: "dashboards" }` explicitly, not just `{ dashboardId }`), so a fresh paste's commit always produces a `ReturnTo` whose `page` is `"dashboards"` and therefore never trips the "elsewhere wins" branch. This closes the edge case without adding a second key, without a new field, and is a one-line change to the new `onClick` handler's payload.

## Q6 — Test infrastructure and pitfalls

**Confidence: HIGH — all directly confirmed by reading the files named in the question.**

- **`test/setup.ts:54`** confirmed: `sessionStorage.clear()` runs in a global `afterEach`. Also present in the same block: `localStorage.clear()` (`:55`, "defensive — no Phase 7 usage but standard hygiene" — still true for this phase, it uses sessionStorage only) and, critically, **`vi.useRealTimers()`** (`:62`) — this is the fix for the cross-file fake-timer leak (MEMORY.md: "Web vitest parallel fake-timer leak"). It runs unconditionally after every test in every spec file, so any new spec this phase adds is automatically protected as long as it doesn't do something that survives past the test's own synchronous/microtask completion (it won't — nothing in this phase's scope uses timers at all; `DashboardsPage.tsx:646`'s `setTimeout(..., 0)` is pre-existing and untouched).
- **Fake-timer leak risk for this phase specifically: none.** Nothing in the Q2–Q5 design introduces `vi.useFakeTimers()`. Flagging only because CLAUDE.md and MEMORY.md both call it out as a recurring project trap — if a future executor is tempted to fake-timer the `setTimeout(..., 0)` at `DashboardsPage.tsx:646` to make an expiry-race test deterministic, the existing global `afterEach` still protects other files even if they do, but they should still pair any local `vi.useFakeTimers()` with a matching `vi.useRealTimers()` in their own `afterEach`/`finally` rather than relying solely on the global one, per the project's documented convention.
- **Existing spec homes and where new tests belong:**
  - `LoginPage.spec.tsx` — the new `onClick` write-on-commit test (Q2/Q3) belongs here, alongside the existing OIDC-branch describe block (`:19-61`). This file has **zero** existing `onClick` assertions (confirmed grep count 0 above) so a new test here is a clean addition, not a modification of an existing assertion.
  - `hooks/useDeepLinkDashboard.spec.ts` — the new `pendingId` parameter (Q4) belongs here, as new `it()`s parallel to the existing `authStatus`-transition tests (e.g. `"auth status unknown at boot stays pending until authenticated, then resolves"`, already the closest existing template for "starts with no id, gains one after a state transition").
  - `lib/dashboardUrl.spec.ts` — the new `restoreDashboardUrl`-style writer (Q4) belongs here, directly next to `clearDashboardUrl`'s existing describe block (`:112-133`), which is its structural mirror (replaceState-only, idempotent, no push/pop).
  - `App.spec.tsx` — the extended `ReturnTo` shape's read-side validation tests (Q3: junk `dashboardId`, missing `dashboardId`, valid `dashboardId`) belong in the existing `"App — read+restore+clear on status='authenticated' (UX-06)"` describe block (`:146-194`), directly beside the existing corrupt-JSON and unknown-page tests that are their template.
  - `App.deeplink.spec.tsx` — the expiry-vs-paste conflict rule (Q5) and the address-bar restore-after-OIDC (Q4) belong here, as new `it()`s alongside the existing `"a pasted link beats the Phase 7 ReturnTo page restore"` test (`:183-191`) — that test is the direct structural precedent for the NEW, opposite-direction test this phase needs ("a restored ReturnTo page beats a stale dashboard link, on expiry").
- **StrictMode double-invoke hazards for any new one-shot flag:** `main.tsx:14` confirmed wraps the app in `<React.StrictMode>`. The existing `startedRef` (`useDeepLinkDashboard.ts:46`) and `deepLinkConsumedRef` (`App.tsx:87`) patterns are the templates: a `useRef` boolean flipped inside an effect (not inside a lazy initializer, and not inside the render body), checked before performing the one-shot action, is the established, already-StrictMode-safe idiom in this codebase. Any new suppression ref (Q4/Q5's `returnToWonElsewhereRef`) must follow the identical shape — set inside an effect, read-guarded before acting — and should get its own `"DEEPLINK-114"`-style StrictMode double-invoke regression test mirroring `useDeepLinkDashboard.spec.ts`'s existing one (`"StrictMode double-invoke still calls listDashboards exactly once"`).

---

## Standard Stack

No new libraries. This phase is pure application code inside the existing stack.

### Core (unchanged)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|---------------|
| React | (existing project version) | Component tree, hooks | Already in use |
| zustand | (existing project version) | `useAuthStore` | Already in use; `__mocks__/zustand.ts` test shim already resets stores per test |
| Native History API | n/a (browser built-in) | `replaceState` for address-bar sync | Locked milestone decision — no router dependency (`.planning/REQUIREMENTS.md` Out of Scope table) |
| Native `sessionStorage` | n/a (browser built-in) | `ReturnTo` persistence across the OIDC round trip | Locked Phase 7 precedent; extending it is the ROADMAP-locked mechanism |

No `npm install` needed for this phase.

## Architecture Patterns

### Pattern 1: Extend, don't duplicate, a validated sessionStorage shape
**What:** Add one optional field to an existing typed object (`ReturnTo`), extend its allow-list-style read validation to cover the new field, keep the single `finally`-clear.
**When to use:** Any time a "restore across a hard navigation boundary" need arises for a value that is a sibling concern to something already restored the same way.
**Example (existing pattern to extend, not new code — `App.tsx:224-260`):**
```typescript
// Existing (unchanged shape of the pattern):
useEffect(() => {
  if (status !== "authenticated") return;
  let raw: string | null = null;
  try {
    raw = sessionStorage.getItem(RETURN_TO_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as ReturnTo;
    if (parsed.page === "dashboards" || /* ...allow-list... */) {
      setPage(parsed.page);
    }
    // Phase 115 adds an equivalent guarded branch here for parsed.dashboardId,
    // using the SAME shared positive-integer predicate lib/dashboardUrl.ts
    // already uses for the URL param (see Q3 — Don't Hand-Roll).
  } catch {
    // Corrupt JSON or unknown shape — silently fall through.
  } finally {
    if (raw !== null) sessionStorage.removeItem(RETURN_TO_KEY);
  }
}, [status]);
```

### Pattern 2: Parameterize a resolver hook rather than duplicating its source-of-truth
**What:** `useDeepLinkDashboard` gains an optional parameter, not a second internal read of a second source.
**When to use:** When a value the hook already resolves from one source (URL) needs to be fed from a second source (restored sessionStorage) after a navigation destroys the first.
**Example (shape, not exact code — see Q4):**
```typescript
export function useDeepLinkDashboard(pendingId?: number | null): DeepLinkState {
  // ...existing lazy URL-read initializer, unchanged...
  useEffect(() => {
    if (state.status === "none" && pendingId != null) {
      setState({ status: "pending", id: pendingId });
    }
  }, [pendingId]); // parallels the existing authStatus effect below it
  // ...existing authStatus effect, unchanged...
}
```

### Anti-Patterns to Avoid
- **A second sessionStorage key for the pending dashboard id.** Explicitly forbidden by ROADMAP §Phase 115 criterion 2 and REQUIREMENTS.md's Phase 7 precedent. Confirmed zero existing occurrences of any second-key name anywhere in `src/` (see grep table below) — there is nothing to accidentally collide with, but also nothing to justify introducing.
- **Reading `reason` at restore time as the expiry/paste discriminator.** Disproven with code evidence in Q5 — it is always `null` by the time it would be read.
- **Delaying `deepLinkConsumedRef`'s flip instead of suppressing it outright, for the "ReturnTo elsewhere wins" case.** This reduces but does not eliminate the Phase 114 Wave-2 defect class — see Q4's ordering-hazard note.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|--------------|-----|
| Validating a dashboard id read out of untrusted storage | A second regex/parse routine inside `App.tsx`'s ReturnTo reader | A shared exported predicate from `lib/dashboardUrl.ts` (e.g. `isValidDashboardId`), used by BOTH `readDashboardIdFromSearch` and the new `ReturnTo.dashboardId` read | Two independent id-shape definitions drift over time (one already exists for the URL path — `readDashboardIdFromSearch`'s regex, `lib/dashboardUrl.ts:27-32`); a single shared predicate is one thing to get right, not two |
| Writing the id back into the address bar after OIDC restore | A one-off `window.history.replaceState(...)` call inline in `App.tsx` | A tiny new export in `lib/dashboardUrl.ts` mirroring `clearDashboardUrl`'s existing replaceState-only contract | `lib/dashboardUrl.ts` already owns every History-API write in the app (`openDashboardUrl`, `clearDashboardUrl`, `leaveDashboardUrl`) — this is the one missing writer (id→set), not a new concept |

**Key insight:** every piece this phase needs already has a same-shaped sibling somewhere in the existing three files (`App.tsx`, `hooks/useDeepLinkDashboard.ts`, `lib/dashboardUrl.ts`). The work is extension-by-analogy, not new design.

## Common Pitfalls

### Pitfall 1: Using `reason` as the expiry discriminator
**What goes wrong:** the restore logic always takes the "not an expiry" branch, silently, because `reason` is `null` by the time it's read.
**Why it happens:** `login()` and `bootstrap()`'s `/me` success both null `reason` in the same `set()` call that flips `status` to `"authenticated"` (`store/auth.ts`).
**How to avoid:** use the structural discriminator from Q5 (whether the restored `ReturnTo.page` is `"dashboards"` or not) instead.
**Warning signs:** a test that seeds `reason: "session-expired"` directly on the store and asserts restore behavior without also seeding a realistic `status` transition sequence will falsely pass — always drive the transition through the SAME `set()` shape `login()`/`bootstrap()` actually use, not a hand-picked partial patch.

### Pitfall 2: A "dumb prop-reflector" test stub for `DashboardsPage`
**What goes wrong:** a test stub that reads `initialOpenDashboard` as a plain prop (not lazily captured at mount) will falsely report the deep link "didn't work," even when `App.tsx` is completely correct — because App's own effects legitimately cause a second render in which the prop's live value briefly reads as `undefined`.
**Why it happens:** demonstrated directly in Q1 — this is exactly the mistake made and caught on the first pass of the throwaway test.
**How to avoid:** mirror the real component's `useState(() => initialOpenDashboard)` mount-time capture in any stub, per `App.deeplink.spec.tsx:27-38`'s existing (and correct) stub.
**Warning signs:** a new deep-link test failing with the opened dashboard's id showing up as empty/undefined on the FINAL assertion despite `App.tsx` looking correct on inspection.

### Pitfall 3: Delayed-not-suppressed one-shot ref for the "elsewhere wins" case
**What goes wrong:** a stale deep link resurfaces later in the same session (e.g., after the user manually navigates back to the Dashboards page) even though it was correctly NOT opened at expiry-restore time.
**Why it happens:** `deepLinkConsumedRef`'s existing gate (`page === "dashboards"`) only delays the flip; it doesn't suppress the underlying `deepLink.status === "opened"` state, which remains true indefinitely until the ref flips.
**How to avoid:** set the ref (or an equivalent suppression flag) immediately, in the same effect that decides ReturnTo wins — not conditionally on `page` later becoming `"dashboards"`.
**Warning signs:** a test that only checks the FIRST render after restore, not a subsequent simulated sidebar navigation to Dashboards within the same test.

## Code Examples

Verified against the actual files (not training data):

### The existing OIDC-only Phase 7 write this phase extends
```typescript
// App.tsx:186-206 — unchanged by this phase, shown for the planner's reference.
useEffect(() => {
  const handler = () => {
    const authMode = useAuthStore.getState().authMode;
    if (authMode === "oidc") {
      try {
        const payload: ReturnTo = { page, dashboardViewMode };
        sessionStorage.setItem(RETURN_TO_KEY, JSON.stringify(payload));
      } catch { /* best-effort */ }
    }
    markUnauthenticated("session-expired");
  };
  window.addEventListener(UNAUTHORIZED_EVENT, handler);
  return () => window.removeEventListener(UNAUTHORIZED_EVENT, handler);
}, [markUnauthenticated, page, dashboardViewMode]);
```

### The existing id-shape validator this phase should share, not duplicate
```typescript
// lib/dashboardUrl.ts:27-32 — the pattern to extract into a shared, exported predicate.
export function readDashboardIdFromSearch(search: string): number | null {
  const raw = new URLSearchParams(search).get(DASHBOARD_URL_PARAM);
  if (raw === null || !/^\d+$/.test(raw)) return null; // rejects "", "12abc", "1.5", "-3"
  const id = Number(raw);
  return id > 0 ? id : null; // rejects "0"
}
```

## State of the Art

Not applicable — this is a small internal state-machine extension, not a library/ecosystem question. No "old approach vs. current approach" axis exists here; the only prior art is the codebase's own Phase 7/113/114 precedents, all cited above.

## Open Questions

1. **How does the login-page banner learn there is a pending link (Q2's write-trigger signal)?**
   - What we know: CONTEXT.md leaves this to Claude's discretion ("as long as it is testable without a router"). The same read (`hasDashboardParam`/`readDashboardIdFromSearch` on the boot URL, since the banner only needs to render while the ORIGINAL `?dashboard=<id>` is still present in the address bar — this is the window BEFORE the OIDC redirect, when the URL still has it) can drive both the banner text and the `onClick` handler's payload.
   - What's unclear: whether the planner prefers a small local `useState` in `LoginPage` (reading the URL once, same lazy-initializer idiom `useDeepLinkDashboard` already uses) vs. a prop threaded down from `App.tsx` (which already knows `deepLink.status`).
   - Recommendation: reuse `App.tsx`'s existing `deepLink` value (it already distinguishes `"pending"` from `"none"`) and pass a boolean + the numeric id down as props to `LoginPage`, rather than having `LoginPage` re-derive it independently — one source of truth, and it's already computed before `LoginPage` renders (`deepLink` is computed at `App.tsx:79`, before the `status !== "authenticated"` early return at `:331`).

2. **Exact banner copy.**
   - What we know: CONTEXT.md suggests "Sign in to open this dashboard." verbatim, reusing the existing `login-banner` class in both `LoginPage.tsx` branches (`:25`, `:59`).
   - What's unclear: nothing structurally — this is pure copy, explicitly left to discretion.
   - Recommendation: use the suggested copy as-is; it needs no new class (confirmed `login-banner` exists and is used identically in both branches already).

## Verifiable Acceptance Criteria — grep counts (run BEFORE any Phase 115 code, per CLAUDE.md)

Every count below was executed against the current tree (commit at time of this research, branch `chore/ci-and-release-process`) via `grep -c` from `packages/web/`. **Criteria whose count is already non-zero are worthless as-is** and are marked accordingly with a replacement anchor.

| Proposed criterion | Command | Current count | Verdict |
|---|---|---|---|
| A second sessionStorage key was NOT introduced | `grep -rc "kbi_pendingDashboard" src` (or whatever second-key name a plan might pick) | **0** (files matching: 0) | Usable as a regression guard for "stayed at 0," but only discriminates against ONE specific hypothetical key name — not a general guard. Prefer a structural review criterion ("`grep -c "sessionStorage.setItem" src/App.tsx src/components/LoginPage.tsx` count is exactly 2" — see below) over a name-guessing negative. |
| `sessionStorage.setItem` call sites stay at exactly 2 (the two locked commit moments) | `grep -c "sessionStorage.setItem" src/App.tsx` → **1** today (the existing `UNAUTHORIZED_EVENT` write); `grep -c "sessionStorage.setItem" src/components/LoginPage.tsx` → **0** today | 1 + 0 = 1 total today | **Usable, and discriminates:** after Phase 115, `LoginPage.tsx` must go from 0→1 (the new `onClick` write) and `App.tsx` must stay at 1 (unchanged `UNAUTHORIZED_EVENT` write) — a real before/after delta on a symbol the work introduces. |
| `onClick` exists on the OIDC anchor | `grep -c "onClick" src/components/LoginPage.tsx` | **0** | Reads 0 before, so it discriminates once the work adds it. Note: pick a MORE specific anchor once the plan names the handler (e.g. a specific function name like `handleOidcCommit`) rather than the bare word `onClick`, which could later collide with an unrelated addition. |
| `dashboardId` field exists on `ReturnTo` | `grep -c "dashboardId" src/App.tsx` | **5** (pre-existing, unrelated: `dashboard.id`/`dashboardId` usages elsewhere in App.tsx's LIFE-V13-03 DROP loops — NOT the `ReturnTo` type) | **Toothless as written — already non-zero.** Replace with a criterion anchored to the TYPE declaration specifically, e.g. `grep -c "dashboardId?: number" src/App.tsx` → confirmed **0** today (verified separately below), which does discriminate. |
| `type ReturnTo` gains the new field (specific anchor) | `grep -c "dashboardId?: number" src/App.tsx` | **0** | **Usable** — specific enough to only match the intended type-field addition, not the unrelated existing `dashboardId` identifiers. |
| A shared id-validator predicate is exported and reused (Don't-Hand-Roll criterion) | `grep -c "isValidDashboardId" src/lib/dashboardUrl.ts src/App.tsx` | **0** in both files today | **Usable** — the name doesn't exist yet anywhere, so any non-zero count after the work is real evidence of the intended extraction, not an accident. (Note: the planner may choose a different function name — re-run this exact grep with whatever name is actually chosen, and confirm it is still 0 before locking it into a plan's acceptance criteria, per CLAUDE.md's rule.) |
| `useDeepLinkDashboard` accepts a parameter | `grep -c "useDeepLinkDashboard(" src/App.tsx` | **1** (today: `useDeepLinkDashboard()`, no-arg) | **Usable as a manual-diff check, not a count-based grep** — the call count won't change (still exactly one call site), only its argument. Recommend a different anchor: `grep -c "useDeepLinkDashboard()" src/App.tsx` (bare, no-arg form) → **1** today, and after the work this should become **0** (replaced by an argument-bearing call) — a real, dischriminating before(1)/after(0) flip. |
| The address-bar restore writer exists in `lib/dashboardUrl.ts` | `grep -c "restoreDashboardUrl\|writeDashboardUrl" src/lib/dashboardUrl.ts` | **0** | **Usable** — name doesn't exist yet; re-confirm against whatever name the plan actually picks before locking it in. |
| Existing "pasted link beats ReturnTo" test is NOT deleted/weakened (regression guard) | `grep -c "a pasted link beats the Phase 7 ReturnTo page restore" src/App.deeplink.spec.tsx` | **1** | **Usable as a stability guard** (must remain 1, not a "did we build X" criterion) — confirms Phase 115 doesn't quietly invert Phase 114's non-expiry precedence while implementing the expiry-specific inversion. |
| A new, opposite-direction expiry test exists | `grep -c "ReturnTo page beats\|ReturnTo.*wins.*expir\|expir.*ReturnTo.*wins" src/App.deeplink.spec.tsx` | **0** (no such phrasing anywhere yet) | **Usable**, but only as loosely as the exact test title the plan actually writes — re-run against the real chosen title before locking it in, per CLAUDE.md's rule (do not trust this pattern verbatim; it is illustrative, not a locked string). |

**Unprovable-by-grep requirements, routed to `checkpoint:human-verify` per CLAUDE.md:**
- "The login-page banner reads correctly in both light and dark mode" — CLAUDE.md's own documented history (Phase 114's light-mode banner defect on `.onboarding-banner`) shows this class of bug passes `tsc`/`vitest`/`theme-guard` silently. `login-banner` is a DIFFERENT class already used successfully in both branches for the session-expired message — lower risk, but still requires a human look at the new copy in both themes before sign-off, not a grep.
- "The dashboard the user lands on after OIDC round-trip is visually the one they meant, filters cleared, no config panel open" — structurally provable ("no filter store hydration call exists on this path," "config-panel-open state defaults false") but the actual on-screen correctness needs a human check, per CLAUDE.md's guidance on routing genuinely unprovable requirements rather than dressing them in a grep that looks rigorous but doesn't discriminate.

## Sources

### Primary (HIGH confidence — direct file reads + one executed test, this session, 2026-09-11)
- `packages/web/src/App.tsx` (full file, 394 lines) — ReturnTo type/key/write/restore, deep-link effects, ref-flip gating, render branches
- `packages/web/src/components/LoginPage.tsx` (full file) — OIDC/password branches, existing `login-banner` slot, deliberate no-`onClick` comment
- `packages/web/src/hooks/useDeepLinkDashboard.ts` (full file) — state machine, lazy initializer, `startedRef` StrictMode guard
- `packages/web/src/lib/dashboardUrl.ts` (full file) — all existing History-API helpers, id-validation regex
- `packages/web/src/store/auth.ts` (relevant sections) — `login()`/`bootstrap()` set() calls proving `reason` is nulled with `status`
- `packages/web/src/components/DashboardsPage.tsx` (relevant sections, ~600-660) — the 401-survives-param guard (`:648`), deferred-macrotask clear race
- `packages/web/src/App.spec.tsx`, `App.deeplink.spec.tsx`, `hooks/useDeepLinkDashboard.spec.ts`, `lib/dashboardUrl.spec.ts`, `components/LoginPage.spec.tsx` (full files) — existing test templates and confirmed absence of shape-breaking assertions
- `packages/web/src/test/setup.ts` (full file) — global `afterEach` hygiene (sessionStorage/localStorage clear, `vi.useRealTimers()`)
- Executed, then deleted: `packages/web/src/App.q1throwaway.spec.tsx` — `npx vitest run` output: `Test Files 1 passed (1)`, `Tests 1 passed (1)` (second attempt, after fixing the stub bug documented in Q1/Pitfall 2)
- `npx tsc --noEmit` on the current tree — clean, exit 0 (baseline confirmed before any Phase 115 change)
- `.planning/phases/115-deep-link-authentication-flow/115-CONTEXT.md`, `.planning/phases/114-deep-link-load-error-states/114-CONTEXT.md`, `.planning/REQUIREMENTS.md`, `.planning/STATE.md` — locked decisions, requirement text, milestone history
- `.planning/config.json` — confirmed `workflow.nyquist_validation: false` (Validation Architecture section correctly omitted from this document)

### Secondary / Tertiary
None used — no web search was needed for this phase; it is entirely internal-codebase research.

## Metadata

**Confidence breakdown:**
- Q1 (password mode already works): HIGH — executed test, not reasoning
- Q2 (onClick safety/timing): HIGH — DOM event-order semantics are well-established, confirmed against actual anchor markup
- Q3 (ReturnTo extension safety): HIGH — confirmed via grep that no existing test asserts a closed shape
- Q4 (restore path/hook parameter): HIGH — all three CONTEXT-posed options evaluated against actual module boundaries; one eliminated with a concrete objection
- Q5 (conflict discriminator): HIGH — `reason` elimination is proven by direct code read of `store/auth.ts`'s two `set()` call sites, not inference; the structural replacement is derived from the same files
- Q6 (test infra): HIGH — every claim checked against the actual file/line named in the research question
- Grep acceptance criteria: each individually run and reported; several of the naive candidates were found toothless and replaced in the same table, per CLAUDE.md's explicit instruction

**Research date:** 2026-09-11
**Valid until:** this is an internal-codebase research document tied to a specific commit; it is valid until Phase 115 code is written against it (should be consumed by the very next `/gsd:plan-phase` invocation, not stored long-term) — recommend treating as valid for 7 days or until the next commit touching `App.tsx`/`LoginPage.tsx`/`useDeepLinkDashboard.ts`/`dashboardUrl.ts`, whichever comes first.
