# Phase 82: Client Token Pipeline + FOUC Prevention + Identity - Context

**Gathered:** 2026-06-24
**Status:** Ready for planning

<domain>
## Phase Boundary

Brand tokens flow from the Phase-81 server routes to the browser at startup; the app never flashes the default Kinetica theme on load/reload (FOUC prevention); logo, app name, and favicon are drawn from the brand store across every surface (sidebar, login, browser tab); and an admin's brand change propagates live to other open tabs without a manual refresh.

FRONTEND-ONLY (`packages/web`). Consumes the Phase-81 `GET /api/branding` + `GET /api/branding/logo` routes. The Branding Admin UI (the page that *edits* brand) is Phase 83 — NOT this phase. This phase builds the read/apply pipeline + identity wiring only.
</domain>

<decisions>
## Implementation Decisions

### Logo fallback + placement
- When NO custom logo is uploaded (default install), render a **bundled default Kinetica logo asset** (an image shipped with the app). A custom uploaded logo replaces it.
- Logo renders in its **current slots only**: the sidebar (expanded state) and the login page. The Topbar is NOT given a logo in this phase (it has none today; leave it).
- Logo is ALWAYS an `<img>` element — never inline SVG / `dangerouslySetInnerHTML` (carried from Phase 81 SVG-safety lock).

### App-name scope + tab title
- The custom app name replaces the hardcoded "Kinetica BI" string **everywhere**: sidebar (`Sidebar.tsx`), login page (`LoginPage.tsx`, 2 sites), AND the browser tab `<title>`.
- `document.title` format is **just the app name** (e.g. `MyApp`) — NOT `AppName — PageName`.
- `Sidebar.spec.tsx` asserts the literal "Kinetica BI" text (2 sites) — update those to read from / match the brand store, or they'll fail (known spec ripple).

### Cross-tab change UX
- When another tab's admin saves a brand change, THIS tab **applies it silently and instantly** via the `BroadcastChannel("kbi-brand-updated")` listener re-applying tokens. **No toast, no notification, no deferral.** Matches success criterion 2 ("within seconds, without manual refresh").

### Favicon source + cold-cache flash policy
- The favicon `<link>` is **derived from the uploaded logo** (the same logo asset/data) — NO separate favicon upload field. This keeps Phase 81's server scope unchanged (it stored a single logo only).
- **No-FOUC is guaranteed on every load EXCEPT the very first visit on an empty cache.** On a cold cache (first-ever visit, before any brand fetch has populated `localStorage`), one frame of the default Aurora theme is acceptable; once `localStorage("kbi-brand-tokens")` is written, all subsequent loads apply brand before first paint.

### Claude's Discretion
- Exact bundled-default-logo asset format/dimensions and where it's imported.
- The precise shape/keys of the cached `localStorage("kbi-brand-tokens")` payload (mirror what `applyBrandTokens` needs).
- How the favicon is injected from logo data (data-URI vs the `/api/branding/logo` URL) — pick whatever the inline `<head>` script can do synchronously without a flash.
- Whether `appName` flows through a shared selector/hook or per-component reads — implementation detail.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 82 scope + criteria
- `.planning/ROADMAP.md` §"Phase 82: Client Token Pipeline + FOUC Prevention + Identity" — goal, 4 success criteria, the pre-scoped 3-plan breakdown (82-01 brandStore, 82-02 FOUC/BrandStyleInjector, 82-03 identity wiring).
- `.planning/STATE.md` §"v1.16 Key Architectural Decisions (locked)" — brandStore mirrors theme-store pattern; `document.documentElement.style.setProperty()` for runtime apply / `removeProperty()` for reset; FOUC inline `<head>` script; `BroadcastChannel("kbi-brand-updated")` + `window.focus` refetch fallback; SVG logo as `<img>` only.
- `.planning/REQUIREMENTS.md` — BRANDFND-03, BRANDFND-04, BRANDUI-01.

### Phase 81 server contract (the source this phase reads)
- `packages/server/src/index.ts` — `GET /api/branding` (unauthenticated, `Cache-Control: no-cache, no-store`, returns token overrides + appName + logo reference + custom CSS) and `GET /api/branding/logo` (public, immutable-cache). These are the bootstrap endpoints.
- `.planning/phases/81-brand-config-server-foundation/81-VERIFICATION.md` — confirmed route shapes/behaviors the client can rely on.

### Token vocabulary (Phase 80)
- `packages/web/src/styles/global.css` — the `:root` token names that `applyBrandTokens` overrides via `setProperty`. Brand token keys must match these exactly.

[No external (non-.planning) specs — requirements are captured in the decisions above + the codebase refs.]
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `packages/web/src/store/theme.ts` — zustand theme store; `THEME_STORAGE_KEY = "kinetica-bi-theme"`; persists to localStorage with a try/catch ignore. **`brandStore.ts` mirrors this pattern** (new key `kbi-brand-tokens`).
- `packages/web/index.html` (lines 8–21) — EXISTING inline `<head>` FOUC guard that reads `localStorage("kinetica-bi-theme")` and sets `data-theme` before paint. Phase 82 **extends this same script** to also read `kbi-brand-tokens` + apply token `setProperty` + inject the font `<link>` and favicon `<link>`.

### Established Patterns
- Stores live in `packages/web/src/store/`, each with a co-located `.spec.ts`. New `brandStore.ts` + `brandStore.spec.ts` follow suit.
- No branding API client function exists yet in `packages/web/src/api/client.ts` — Phase 82 adds the `GET /api/branding` fetch.

### Integration Points
- Identity strings to replace: `LoginPage.tsx` (`login-brand`, 2 sites), `Sidebar.tsx` (`logo` div, currently `Kinetica BI`), `index.html` `<title>`. `Topbar.tsx` has NO hardcoded brand string today.
- Spec ripple: `Sidebar.spec.tsx` asserts the literal `"Kinetica BI"` (2 sites) — must be updated when the name becomes brand-driven.
- `BrandStyleInjector.tsx` (new, 82-02) injects sanitized custom CSS via `textContent` (the CSS was sanitized server-side in Phase 81; `@scope` wrapping is Phase 83, not here).
</code_context>

<specifics>
## Specific Ideas

- "Apply silently and instantly" on cross-tab change — no UI chrome announcing it; the look just updates.
- Browser tab is just the app name, no page suffix.
- First-ever cold-cache visit may flash the default theme for one frame; every load after that must not.
</specifics>

<deferred>
## Deferred Ideas

- **Separate favicon upload** (distinct from the logo) — would expand Phase 81's server schema (it stores one logo). Deferred; favicon is derived from the logo for now.
- **Topbar logo** — not added this phase; revisit if the design wants a brand mark in the topbar.
- Custom-CSS `@scope` wrapping at injection time — owned by Phase 83 (the remaining half of CSS-V116-02).
</deferred>

---

*Phase: 82-client-token-pipeline-fouc-prevention-identity*
*Context gathered: 2026-06-24*
