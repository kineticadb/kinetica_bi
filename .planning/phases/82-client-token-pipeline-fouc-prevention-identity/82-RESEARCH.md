# Phase 82: Client Token Pipeline + FOUC Prevention + Identity — Research

**Researched:** 2026-06-24
**Domain:** Frontend-only brand token pipeline — Zustand store, inline-script FOUC guard, identity wiring
**Confidence:** HIGH (all findings grounded in direct codebase inspection of the actual files)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Logo fallback + placement**
- When NO custom logo is uploaded (default install), render a bundled default Kinetica logo asset (an image shipped with the app). A custom uploaded logo replaces it.
- Logo renders in its current slots only: the sidebar (expanded state) and the login page. The Topbar is NOT given a logo in this phase (it has none today; leave it).
- Logo is ALWAYS an `<img>` element — never inline SVG / `dangerouslySetInnerHTML`.

**App-name scope + tab title**
- The custom app name replaces the hardcoded "Kinetica BI" string everywhere: sidebar, login page (2 sites), AND the browser tab `<title>`.
- `document.title` format is just the app name (e.g. `MyApp`) — NOT `AppName — PageName`.
- `Sidebar.spec.tsx` asserts the literal "Kinetica BI" text (2 sites) — update those to match the brand store, or they fail.

**Cross-tab change UX**
- When another tab's admin saves a brand change, THIS tab applies it silently and instantly via the `BroadcastChannel("kbi-brand-updated")` listener. No toast, no notification, no deferral.

**Favicon source + cold-cache flash policy**
- Favicon is derived from the uploaded logo (NO separate favicon upload field). No-FOUC guaranteed on every load EXCEPT the very first visit on an empty cache. Once `localStorage("kbi-brand-tokens")` is written, all subsequent loads apply brand before first paint.

### Claude's Discretion
- Exact bundled-default-logo asset format/dimensions and where it's imported.
- The precise shape/keys of the cached `localStorage("kbi-brand-tokens")` payload.
- How the favicon is injected from logo data (data-URI vs the `/api/branding/logo` URL).
- Whether `appName` flows through a shared selector/hook or per-component reads.

### Deferred Ideas (OUT OF SCOPE)
- Separate favicon upload (distinct from the logo) — would expand Phase 81's server schema.
- Topbar logo — not added this phase.
- Custom-CSS `@scope` wrapping at injection time — owned by Phase 83.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| BRANDFND-03 | Client fetches active brand at startup and applies it at runtime via CSS custom properties; brand change propagates to other tabs without a hard refresh | brandStore.ts bootstrap() + applyBrandTokens() + BroadcastChannel + window.focus refetch |
| BRANDFND-04 | Branding applied before first paint — no flash of default theme on load/reload | index.html inline script extension reads kbi-brand-tokens from localStorage synchronously |
| BRANDUI-01 | Permission-gated Branding settings page lets admin set app name and upload brand logo; used in sidebar, login, favicon | identity wiring in Sidebar.tsx + LoginPage.tsx + document.title + favicon link injection |
</phase_requirements>

---

## Summary

Phase 82 is a frontend-only phase that builds the consumer side of the Phase-81 server contract. Three distinct technical sub-problems must be solved in dependency order: (1) a Zustand store that bootstraps from `GET /api/branding`, applies CSS custom properties, and manages localStorage caching + cross-tab propagation; (2) an extension to the existing inline `<head>` FOUC guard in `index.html` that applies the cached brand tokens synchronously before any stylesheet parses; (3) identity wiring that replaces every hardcoded "Kinetica BI" string across `Sidebar.tsx`, `LoginPage.tsx`, `document.title`, and `<title>` with brand-store-driven values.

The existing codebase patterns are directly applicable: `theme.ts` is the exact Zustand store template (create(), localStorage persistence with try/catch, DOM property mutation on store action), `apiFetch` with raw `fetch` for unauthenticated calls is the established client API pattern, and `App.tsx` already demonstrates the bootstrap sequence. The FOUC script in `index.html` (lines 8–17) is a 9-line IIFE that sets `data-theme` — it must be extended in-place to additionally apply brand tokens and inject font/favicon links.

The single riskiest area is the favicon injection timing. The favicon URL from `GET /api/branding` is a relative URL (`/api/branding/logo?v=...`), not a data-URI. The inline script cannot know the logo URL on first render (the URL comes from the server, and the script runs before any fetch). The correct approach: persist the `logoUrl` inside `kbi-brand-tokens` in localStorage after the first successful brand fetch, then the inline script can read it and inject a `<link rel="icon">` synchronously on subsequent loads. On cold cache, no favicon is set by the inline script (the browser shows the default); once any brand fetch populates localStorage, the favicon is injected on all subsequent loads — consistent with the cold-cache one-frame policy.

**Primary recommendation:** Build in the order 82-01 → 82-02 → 82-03. The store must exist and define the localStorage key shape before the inline script extension can be written correctly. The identity wiring (82-03) has no timing sensitivity and can be done last.

---

## Existing Pattern Citations

### The `index.html` Inline FOUC Script (verbatim, lines 1–23)

Full file contents confirmed by direct read:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Kinetica BI</title>
    <!-- Apply the saved theme before first paint to avoid a flash (no-FOUC). -->
    <script>
      (function () {
        try {
          var t = localStorage.getItem("kinetica-bi-theme");
          if (t !== "light" && t !== "dark") t = "dark";
          document.documentElement.setAttribute("data-theme", t);
          document.documentElement.style.colorScheme = t;
        } catch (e) {}
      })();
    </script>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

**Key observations:**
- The FOUC IIFE is at lines 8–17, in `<head>`, BEFORE the `<script type="module" src="/src/main.tsx">` in `<body>`. This placement is critical — the inline script runs synchronously during HTML parsing, before the module script is fetched/executed and before `<link rel="stylesheet">` tags parse (there are none in the current `index.html`; Vite injects stylesheets at build time via the module script bundle).
- The existing script reads `localStorage.getItem("kinetica-bi-theme")`, sets `data-theme` attribute, and sets `colorScheme` — it does NOT call `setProperty` anywhere. The brand extension will add a `setProperty` loop.
- There is NO `<link rel="icon">` in the current `index.html`. The browser shows no favicon by default (or falls back to browser default). The inline script extension is the right place to add one.
- `document.title` is `<title>Kinetica BI</title>` on line 6. This static value is what the user sees on cold cache before React hydrates. After React mounts, `brandStore.bootstrap()` must overwrite it.

**What to add to the inline script (immediately after the existing try/catch block, before the closing `})()`:**

```javascript
// Brand token + favicon guard — extends dark/light theme guard above.
// Reads localStorage("kbi-brand-tokens") synchronously — populated by brandStore after
// every authoritative GET /api/branding. On first-ever cold-cache visit, this block is
// a no-op (brand not yet cached); one frame of the Aurora default is acceptable.
try {
  var brand = JSON.parse(localStorage.getItem("kbi-brand-tokens") || "null");
  if (brand && typeof brand === "object") {
    var root = document.documentElement;
    var isDark = t !== "light";
    // Apply token overrides (same slots as applyBrandTokens in brandStore.ts)
    var slots = [
      ["--accent",   isDark ? brand.primaryColor : (brand.lightPrimaryColor || brand.primaryColor)],
      ["--accent-2", isDark ? brand.accent2Color : (brand.lightAccent2Color || brand.accent2Color)],
      ["--bg",       isDark ? brand.bgColor       : (brand.lightBgColor       || brand.bgColor)],
      ["--panel",    isDark ? brand.panelColor    : (brand.lightPanelColor    || brand.panelColor)],
      ["--text",     isDark ? brand.textColor     : (brand.lightTextColor     || brand.textColor)],
      ["--muted",    isDark ? brand.mutedColor    : (brand.lightMutedColor    || brand.mutedColor)],
      ["--border",   isDark ? brand.borderColor   : (brand.lightBorderColor   || brand.borderColor)],
      ["--danger",   isDark ? brand.dangerColor   : (brand.lightDangerColor   || brand.dangerColor)],
      ["--font-body", brand.fontFamily],
    ];
    for (var i = 0; i < slots.length; i++) {
      if (slots[i][1]) root.style.setProperty(slots[i][0], slots[i][1]);
    }
    // Inject font <link> early so download starts before React mounts
    if (brand.fontUrl) {
      var fontLink = document.createElement("link");
      fontLink.rel = "stylesheet";
      fontLink.href = brand.fontUrl;
      document.head.appendChild(fontLink);
    }
    // Inject favicon from cached logo URL (stored by brandStore.bootstrap after first fetch)
    if (brand.logoUrl) {
      var iconLink = document.createElement("link");
      iconLink.rel = "icon";
      iconLink.href = brand.logoUrl;
      document.head.appendChild(iconLink);
    }
  }
} catch (e) {}
```

The `var t` from the existing block is already in scope — `isDark = t !== "light"` is valid because the brand block runs inside the same IIFE after the theme block. The `t` variable is already set to either `"light"` or `"dark"` by the time the brand block runs.

**Ordering guarantee:** The inline `<script>` in `<head>` blocks HTML parsing. Everything inside it runs synchronously before the parser reaches `<body>`, before the module script is loaded, and before Vite-injected stylesheets are parsed (they are injected via JS at runtime, not as static `<link>` tags in the source HTML). So `setProperty` calls here win: inline `style` on `:root` has higher cascade priority than any stylesheet `:root { }` rule.

---

### `theme.ts` Zustand Pattern (the exact template `brandStore.ts` must mirror)

File: `packages/web/src/store/theme.ts` (entire file is 56 lines)

**Pattern summary:**
- `create<ThemeState>((set, get) => ({...}))` — vanilla `create`, no `persist` middleware
- `readInitialTheme()` — pure function called in the initializer, reads localStorage with try/catch, returns default
- `applyTheme(theme)` — imperative DOM mutation function called from `setTheme`; guard: `if (typeof document === "undefined") return`
- `try { localStorage.setItem(...) } catch { // ignore }` — persistence failure is silent
- `applyTheme(useThemeStore.getState().theme)` called at module level (line 55) to sync DOM with store on module load

**brandStore.ts must:**
1. Use the same `create<BrandState>((set, get) => ({...}))` pattern (no persist middleware)
2. Use `BRAND_STORAGE_KEY = "kbi-brand-tokens"` exported constant (mirrors `THEME_STORAGE_KEY`)
3. Call `applyBrandTokens(config, theme)` imperatively from `bootstrap()` and `update()`, with DOM guard
4. Persist to localStorage with try/catch silence after every authoritative fetch
5. Subscribe to `useThemeStore` for dark/light re-apply: `useThemeStore.subscribe((state) => applyBrandTokens(get().config, state.theme))`
6. Have a co-located `brandStore.spec.ts` (mirrors `theme.spec.ts`)

**Key difference from theme.ts:** brandStore.bootstrap() is async (network call), while theme.ts reads only localStorage. The bootstrap pattern to follow is `auth.ts` (same file, async bootstrap with try/catch that never throws out).

---

### `api/client.ts` — Unauthenticated GET Pattern

The established pattern for unauthenticated calls (before auth is established) is `fetchAuthConfig` at `client.ts:122`:

```typescript
// IMPORTANT: raw fetch (NOT apiFetch). The endpoint is unauthenticated and must NOT
// trigger UNAUTHORIZED_EVENT if it 401s or fails. Caller (bootstrap) wraps in try/catch.
export const fetchAuthConfig = async (): Promise<AuthConfig> => {
  const response = await fetch(`${API_BASE}/api/auth/config`, { credentials: "include" });
  if (!response.ok) throw new Error(`Failed to load auth config: ${response.status}`);
  return response.json() as Promise<AuthConfig>;
};
```

**brandStore's `fetchBranding` must follow this exact pattern:**
- Use raw `fetch` (NOT `apiFetch`) — `apiFetch` dispatches `UNAUTHORIZED_EVENT` on 401; brand fetch must NOT trigger logout
- Include `credentials: "include"` (consistent with all other calls)
- Return typed response; caller (`bootstrap()`) wraps in `try/catch` and silently falls back

**Response typing for `GET /api/branding`:**

The actual server code at `index.ts:416–427` returns this shape:

```typescript
// Server returns: { config: Record<string, unknown>, logoUrl: string | null, updatedAt: string | null }
// The config object is the raw config_json parsed from SQLite — it is a flexible JSON blob
// whose keys match whatever the admin PUT. For Phase 82 (read-only), the keys we need to
// read are the ones that applyBrandTokens drives. Define the client type as:

export type BrandConfigPayload = {
  primaryColor?:      string | null;
  accent2Color?:      string | null;
  bgColor?:           string | null;
  panelColor?:        string | null;
  textColor?:         string | null;
  mutedColor?:        string | null;
  borderColor?:       string | null;
  dangerColor?:       string | null;
  lightPrimaryColor?: string | null;
  lightAccent2Color?: string | null;
  lightBgColor?:      string | null;
  lightPanelColor?:   string | null;
  lightTextColor?:    string | null;
  lightMutedColor?:   string | null;
  lightBorderColor?:  string | null;
  lightDangerColor?:  string | null;
  fontFamily?:        string | null;
  fontUrl?:           string | null;
  appName?:           string | null;
  customCss?:         string | null; // sanitized server-side, safe to inject
};

export type BrandingResponse = {
  config: BrandConfigPayload;
  logoUrl: string | null;   // "/api/branding/logo?v=<timestamp>" or null
  updatedAt: string | null;
};
```

**CRITICAL — how the logo is delivered:** The server stores the logo as base64 TEXT (`logo_data` column, `db.ts:256`) and serves it via `GET /api/branding/logo` which decodes the base64 and sends the raw bytes (`index.ts:436`). `GET /api/branding` returns `logoUrl: "/api/branding/logo?v=<timestamp>"` — a relative URL, NOT a data-URI. The server does NOT embed a data-URI in the JSON payload.

**Favicon implication:** The inline script cannot know the logo URL at cold-cache time because it comes from the server. The solution: persist `logoUrl` inside the `kbi-brand-tokens` localStorage object (e.g. as `brand.logoUrl`). Then the inline script can inject `<link rel="icon" href="/api/branding/logo?v=...">` synchronously on all loads after the first. On the first cold-cache visit, `localStorage("kbi-brand-tokens")` is absent → no favicon injected → browser shows default → one frame acceptable per the locked decision.

A data-URI approach (embedding the full logo bytes in localStorage) would enable inline-script favicon injection with no network call, but it would bloat localStorage with potentially 256 KB of base64, causing quota issues. The URL approach is correct: the relative URL works immediately once the page has network access, the browser fetches the favicon lazily (does not block paint), and the `Cache-Control: public, max-age=31536000, immutable` header on `GET /api/branding/logo` ensures it is cached forever after first download.

---

### `GET /api/branding` Response Shape — Confirmed from Server Code

```
GET /api/branding
→ { config: BrandConfigPayload, logoUrl: string | null, updatedAt: string | null }
```

The `config` object is a parsed JSON blob from `brand_config.config_json`. Phase 82 only reads it; it has whatever keys Phase 83 will eventually write. For Phase 82, the relevant keys are the token override fields listed in `BrandConfigPayload` above.

`config.customCss` is included (server sanitizes it with PostCSS AST before storage per Phase 81), so the client can safely inject it. `BrandStyleInjector.tsx` does a secondary client-side sanitization pass (defense-in-depth using a regex pattern list — the server-sanitized CSS is already safe, but this prevents any future server-side regression from causing a client-side injection).

**Note:** The ARCHITECTURE.md research doc describes a separate `GET /api/branding/css` endpoint for lazy CSS loading, but this endpoint does NOT exist in the actual server code (`index.ts`). The `customCss` field is already included in `config` within the `GET /api/branding` response. There is no separate CSS endpoint. `BrandStyleInjector` should read `customCss` from the `config` returned by `GET /api/branding`.

---

### Token Vocabulary — CSS Custom Property Names in `global.css`

Confirmed token names from `packages/web/src/styles/global.css` `:root` block (Phase 80 migrated file):

| Token | Purpose | Phase 82 maps to |
|-------|---------|-----------------|
| `--accent` | Primary fill color | `config.primaryColor` (dark) / `config.lightPrimaryColor` (light) |
| `--accent-2` | Secondary/contrast color | `config.accent2Color` / `config.lightAccent2Color` |
| `--bg` | App background | `config.bgColor` / `config.lightBgColor` |
| `--panel` | Card/panel surface | `config.panelColor` / `config.lightPanelColor` |
| `--text` | Primary text | `config.textColor` / `config.lightTextColor` |
| `--muted` | Secondary text | `config.mutedColor` / `config.lightMutedColor` |
| `--border` | Hairlines | `config.borderColor` / `config.lightBorderColor` |
| `--danger` | Error/destructive | `config.dangerColor` / `config.lightDangerColor` |
| `--font-body` | Body font-family | `config.fontFamily` |

**Tokens NOT overridden by brand (structural, static):** `--font-display`, all `--text-*` size tokens, all `--space-*`, `--radius-*`, `--duration-*`, `--on-accent`, `--accent-text`, `--accent-deep`, `--success`, `--warning`, `--input-bg`, `--sidebar-from/to`, `--map-surface`, `--panel-solid`, `--chip-bg`, `--swatch-border`, `--shadow`, `--color-chart-grid`, `--color-chart-axis`.

The ARCHITECTURE.md doc mentions `--font-family` but the actual Phase-80-migrated `global.css` uses `--font-body` for the body font. `brandStore.ts` must call `setProperty("--font-body", config.fontFamily)` not `--font-family`.

---

### Identity Components — Every "Kinetica BI" Site

**Confirmed by grep `packages/web/src/**/*.tsx`:**

| File | Line(s) | Current Code | What to Replace |
|------|---------|-------------|-----------------|
| `Sidebar.tsx:45` | Line 45 | `<div className="logo">Kinetica BI</div>` | Render logo `<img>` when logoUrl is set; fall back to bundled default logo `<img>`; use `appName` for accessible alt text |
| `LoginPage.tsx:27` | Line 27 | `<div className="login-brand">Kinetica BI</div>` | OIDC branch: use `appName ?? "Kinetica BI"` |
| `LoginPage.tsx:61` | Line 61 | `<div className="login-brand">Kinetica BI</div>` | Password branch: use `appName ?? "Kinetica BI"` |
| `index.html:6` | Line 6 | `<title>Kinetica BI</title>` | Static HTML; runtime override via `document.title = appName ?? "Kinetica BI"` in `brandStore.bootstrap()` |

**`Topbar.tsx` confirmed clean:** No hardcoded "Kinetica BI" string. The topbar has no logo or brand text today (confirmed by reading the file). Phase 82 leaves it unchanged.

**`Sidebar.spec.tsx` — required spec ripple (2 sites):**
- Line 57: `expect(screen.getByText("Kinetica BI")).toBeInTheDocument();` — asserts logo text when expanded
- Line 62: `expect(screen.queryByText("Kinetica BI")).toBeNull();` — asserts no logo when collapsed

After wiring, the sidebar will show an `<img>` (not text). The tests must be updated to:
1. Mock `useBrandStore` to return a known appName + logoUrl
2. Assert the `<img>` element is present when expanded (e.g. `screen.getByRole("img", { name: appName })`)
3. Assert the `<img>` element is absent when collapsed

The test stubs for `useBrandStore` should follow the `seedAnalystStore`/`seedAdminStore` pattern from `Sidebar.spec.tsx:9`.

**Logo rendering pattern for sidebar (expanded state only):**
```tsx
// In Sidebar.tsx, expanded state:
const logoUrl = useBrandStore((s) => s.logoUrl);
const appName = useBrandStore((s) => s.appName);

// In JSX:
{!collapsed && (
  <div className="logo">
    <img
      src={logoUrl ?? DEFAULT_LOGO_URL}
      alt={appName ?? "Kinetica BI"}
      className="logo-img"
    />
  </div>
)}
```

**Default logo asset:** No `src/assets/` directory exists in the current codebase (confirmed by ls). The default logo asset needs to be created. Options: (a) a simple SVG file at `src/assets/logo-default.svg` imported as a Vite asset URL; (b) inline an SVG as a `data:` URL constant in a `lib/brandDefaults.ts` file. Option (a) is cleaner and follows Vite conventions. The asset format/dimensions are Claude's discretion per CONTEXT.md.

---

### `App.tsx` Bootstrap Sequence — Where to Wire `brandStore.bootstrap()`

The auth bootstrap is at `App.tsx:69–71`:

```typescript
const bootstrap = useAuthStore((s) => s.bootstrap);
useEffect(() => {
  bootstrap();
}, [bootstrap]);
```

`brandStore.bootstrap()` must be called in parallel (not sequential) with `authStore.bootstrap()`. The brand fetch is unauthenticated — it should NOT wait for auth to complete. Pattern:

```typescript
// In App.tsx useEffect:
useEffect(() => {
  bootstrap();
  useBrandStore.getState().bootstrap();
}, [bootstrap]);
```

Note: `useBrandStore.getState().bootstrap()` (imperative call, not a hook selector) avoids adding `brandStore.bootstrap` as a dependency that would re-fire on every store update. This mirrors how `initWmsCapabilities()` is called in `App.tsx` — as a fire-and-forget imperative call.

`BrandStyleInjector` mounts as a sibling of other App-level components. The custom CSS is included in `GET /api/branding` (the `config.customCss` field), so there is no separate lazy fetch needed. `BrandStyleInjector` reads `customCss` from the brand store and injects it on mount + updates.

---

## `brandStore.ts` Design

### State Shape

```typescript
export const BRAND_STORAGE_KEY = "kbi-brand-tokens";

export type BrandState = {
  // Resolved config (null = not yet fetched or default)
  config: BrandConfigPayload | null;
  // Derived from config for convenient component reads
  appName: string | null;      // config.appName ?? null
  logoUrl: string | null;      // absolute or relative URL to the logo, or null
  customCss: string | null;    // config.customCss ?? null
  hasLoaded: boolean;          // true after first successful bootstrap
  // Actions
  bootstrap: () => Promise<void>;
  update: (config: BrandConfigPayload, logoUrl: string | null) => void;
};
```

### `applyBrandTokens` (pure function, not in state)

```typescript
function applyBrandTokens(config: BrandConfigPayload | null, theme: Theme): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (!config) return; // No overrides — compiled defaults from global.css win

  const isDark = theme !== "light";
  const set = (prop: string, val: string | null | undefined) => {
    if (val) root.style.setProperty(prop, val);
    else root.style.removeProperty(prop);
  };

  set("--accent",    isDark ? config.primaryColor : (config.lightPrimaryColor ?? config.primaryColor));
  set("--accent-2",  isDark ? config.accent2Color : (config.lightAccent2Color ?? config.accent2Color));
  set("--bg",        isDark ? config.bgColor       : (config.lightBgColor ?? config.bgColor));
  set("--panel",     isDark ? config.panelColor    : (config.lightPanelColor ?? config.panelColor));
  set("--text",      isDark ? config.textColor     : (config.lightTextColor ?? config.textColor));
  set("--muted",     isDark ? config.mutedColor    : (config.lightMutedColor ?? config.mutedColor));
  set("--border",    isDark ? config.borderColor   : (config.lightBorderColor ?? config.borderColor));
  set("--danger",    isDark ? config.dangerColor   : (config.lightDangerColor ?? config.dangerColor));
  set("--font-body", config.fontFamily);
}
```

**Critical:** use `removeProperty` when value is null/undefined — this lets the compiled CSS default resume cleanly. Failing to removeProperty means a previously-set override persists even after a Reset-to-defaults (which sets all fields to null).

### `bootstrap()` Sequence

```typescript
bootstrap: async () => {
  // 1. Subscribe to theme changes — fire-once at module load level, not per-bootstrap
  //    (the subscription must survive re-bootstrap calls; do this at store creation time)

  // 2. Fetch brand config (unauthenticated; never throws out of bootstrap)
  try {
    const response = await fetch(`${API_BASE}/api/branding`, { credentials: "include" });
    if (!response.ok) return; // server offline — compiled defaults win
    const data = await response.json() as BrandingResponse;

    // 3. Apply tokens immediately
    applyBrandTokens(data.config, useThemeStore.getState().theme);

    // 4. Set document.title (authoritative, overwrites static HTML <title>)
    document.title = data.config.appName ?? "Kinetica BI";

    // 5. Inject/update favicon <link> in <head>
    injectFavicon(data.logoUrl);

    // 6. Persist to localStorage (enables FOUC guard on next load)
    try {
      const cache = { ...data.config, logoUrl: data.logoUrl };
      localStorage.setItem(BRAND_STORAGE_KEY, JSON.stringify(cache));
    } catch { /* quota/private-mode — non-fatal */ }

    // 7. Update Zustand state
    set({
      config: data.config,
      appName: data.config.appName ?? null,
      logoUrl: data.logoUrl,
      customCss: data.config.customCss ?? null,
      hasLoaded: true,
    });

    // 8. Post to BroadcastChannel (this tab's update just happened; notify siblings)
    // NOTE: only post if this is an update triggered by an admin save, not the initial
    // bootstrap. For the admin save path, use update() not bootstrap().
  } catch { /* network failure — compiled defaults win */ }
},
```

### BroadcastChannel Wiring

```typescript
// At store creation time (module level, not inside bootstrap):
const brandChannel = typeof BroadcastChannel !== "undefined"
  ? new BroadcastChannel("kbi-brand-updated")
  : null;

// Listen for changes from other tabs:
brandChannel?.addEventListener("message", () => {
  // Refetch brand from server (silent; no toast)
  useBrandStore.getState().bootstrap();
});

// Post after admin save (called from update()):
function notifyOtherTabs(): void {
  brandChannel?.postMessage({ type: "brand-updated" });
}
```

The `window.focus` refetch fallback for suspended tabs that miss the BroadcastChannel:

```typescript
// In App.tsx or brandStore initialization:
window.addEventListener("focus", () => {
  // Only refetch if brand has already loaded (avoid double-bootstrap on startup)
  if (useBrandStore.getState().hasLoaded) {
    useBrandStore.getState().bootstrap();
  }
});
```

### `update()` — Called After Admin Save (Phase 83)

```typescript
update: (newConfig: BrandConfigPayload, newLogoUrl: string | null) => {
  applyBrandTokens(newConfig, useThemeStore.getState().theme);
  document.title = newConfig.appName ?? "Kinetica BI";
  injectFavicon(newLogoUrl);
  try {
    localStorage.setItem(BRAND_STORAGE_KEY, JSON.stringify({ ...newConfig, logoUrl: newLogoUrl }));
  } catch { /* ignore */ }
  set({ config: newConfig, appName: newConfig.appName ?? null, logoUrl: newLogoUrl, customCss: newConfig.customCss ?? null });
  notifyOtherTabs();
},
```

### Theme-Store Subscription

```typescript
// At store creation — subscribe to theme changes so brand re-applies with correct dark/light values
useThemeStore.subscribe((state) => {
  const { config } = useBrandStore.getState();
  applyBrandTokens(config, state.theme);
});
```

This must be done at module evaluation time (not inside `bootstrap()`), so the subscription is established once and survives re-bootstrap calls. It mirrors how `applyTheme(useThemeStore.getState().theme)` is called at module level in `theme.ts:55`.

---

## `BrandStyleInjector.tsx` Design

```tsx
// packages/web/src/components/BrandStyleInjector.tsx
export function BrandStyleInjector() {
  const customCss = useBrandStore((s) => s.customCss);
  useEffect(() => {
    let el = document.getElementById("kbi-custom-css") as HTMLStyleElement | null;
    if (!el) {
      el = document.createElement("style");
      el.id = "kbi-custom-css";
      document.head.appendChild(el);
    }
    // textContent (NOT innerHTML) — prevents </style> escape sequence injection
    el.textContent = customCss ?? "";
  }, [customCss]);
  return null;
}
```

The custom CSS was sanitized server-side by PostCSS AST before storage (Phase 81 confirmed). Phase 82 injects it as-is. Phase 83 adds `@scope` wrapping. The `textContent` assignment is idempotent — if `customCss` doesn't change, React's effect dependency comparison means this doesn't re-run.

The element is appended AFTER existing stylesheets (it is created at runtime), so custom CSS has the highest cascade order among stylesheets. Inline `setProperty` on `:root` still beats it.

**Theme-guard ALLOWLIST:** `BrandStyleInjector.tsx` does not contain hex literals — it only injects a string from the store. No ALLOWLIST entry needed for this file.

---

## FOUC Timing Analysis

### Inline `<head>` Script Before CSS — Confirmed Correct

In the current `index.html`, there are NO `<link rel="stylesheet">` tags in `<head>` (Vite injects CSS at runtime via the module script bundle). The inline `<script>` in `<head>` runs synchronously before the module script in `<body>` is fetched. Therefore `setProperty` calls in the inline script apply to `:root` before any stylesheet is parsed. This is confirmed by the existing dark/light FOUC guard working correctly today.

**At Vite build time:** Vite may inject `<link rel="stylesheet">` tags in `<head>` for CSS chunks in the built output (`dist/index.html`). If they appear AFTER the inline `<script>`, the inline script still runs first and wins (inline styles beat stylesheet rules regardless of order). If they appear BEFORE (unlikely with Vite defaults), the inline script would run after the stylesheet parses — but `style.setProperty` on `:root` still wins because inline styles have higher specificity than `:root { }` rules in any stylesheet. Either ordering is safe.

### Favicon Injection — No First-Paint Flash

Favicon requests are not render-blocking. Browsers fetch favicons lazily (typically after page load is complete, or on tab title computation). Injecting `<link rel="icon">` from the inline script or from React does NOT affect first-frame paint timing. The favicon "flash" (showing browser default icon then switching to brand icon) happens on subsequent tab focus, not on first paint. This means the favicon can safely be set either from the inline script (synchronous) or from React after mount — both are equivalent from a user perception standpoint.

The inline script approach (using the cached `logoUrl` from localStorage) is still preferred because it ensures the favicon is correct on the first tab render when localStorage is already populated.

### BroadcastChannel — Timing and Suspended Tabs

`BroadcastChannel("kbi-brand-updated")` delivers messages synchronously to all other tabs on the same origin that have the channel open. There is no delivery guarantee to tabs that are suspended (background CPU-throttled). The `window.focus` refetch handles this: when a suspended tab regains focus, it re-runs `bootstrap()` and picks up the latest brand from the server. This matches the success criterion "within seconds without manual refresh" — suspended tabs pick up the change the moment the user returns to them.

The BroadcastChannel is created at module level (once per tab). The `bootstrap()` implementation calls `fetch("/api/branding")` which has `Cache-Control: no-cache, no-store` (confirmed at `index.ts:417`), so every bootstrap call gets fresh data from the server, not a cached response.

---

## Architecture Patterns

### Standard Stack (Phase 82)

| Library | Version | Purpose | How used |
|---------|---------|---------|---------|
| `zustand` | existing | Brand store | `create<BrandState>()` — mirrors theme.ts |
| `BroadcastChannel` API | Web standard | Cross-tab propagation | Native API, no npm dep |
| `fetch` | Web standard | Unauthenticated brand fetch | Raw `fetch` (not `apiFetch`) |

No new npm dependencies needed for Phase 82.

### Recommended Project Structure

New files:
```
packages/web/src/
├── store/
│   ├── brandStore.ts         (new — mirrors theme.ts pattern)
│   └── brandStore.spec.ts    (new — mirrors theme.spec.ts pattern)
├── components/
│   └── BrandStyleInjector.tsx (new)
├── api/
│   └── client.ts             (modified — add fetchBranding + BrandingResponse type)
└── assets/
    └── logo-default.svg      (new — bundled default Kinetica logo)
```

Modified files:
```
packages/web/
├── index.html                (inline script extended)
├── src/App.tsx               (brandStore.bootstrap() + BrandStyleInjector mount + window.focus listener)
├── src/components/Sidebar.tsx       (logo <img> + appName)
├── src/components/Sidebar.spec.tsx  (spec update — 2 "Kinetica BI" assertions)
└── src/components/LoginPage.tsx     (appName in both branches)
```

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead |
|---------|-------------|-------------|
| Cross-tab brand propagation | Custom WebSocket or polling | `BroadcastChannel("kbi-brand-updated")` + `window.focus` refetch |
| CSS token override priority over stylesheets | Injecting a `<style>` block with `:root { }` | `document.documentElement.style.setProperty()` — inline beats stylesheets unambiguously |
| Custom CSS injection safety | Manual string sanitization / regex | CSS is already sanitized by PostCSS AST server-side (Phase 81); Phase 82 injects via `textContent` (not `innerHTML`), which is sufficient defense-in-depth |

---

## Common Pitfalls

### Pitfall 1: `setProperty` Token Name Mismatch

**What goes wrong:** Calling `setProperty("--font-family", ...)` when `global.css` defines `--font-body`. The token override silently has no effect.

**Prevention:** Only set properties that are actual `:root` tokens in `global.css`. Confirmed token names are in the table above. Do NOT use `--font-family` — Phase 80 migrated to `--font-body`.

**Warning signs:** Changing the font in brand config has no visual effect.

### Pitfall 2: `removeProperty` Omission on Reset

**What goes wrong:** When config fields are null (default brand), calling `setProperty("--accent", null)` or skipping the call leaves a stale override on `:root`. The "Reset to Kinetica defaults" action in Phase 83 will not work.

**Prevention:** The `set()` helper in `applyBrandTokens` must call `root.style.removeProperty(prop)` when the value is null/undefined/falsy. Test this in `brandStore.spec.ts`.

### Pitfall 3: BroadcastChannel Missing in jsdom / Test Environment

**What goes wrong:** `new BroadcastChannel(...)` throws in jsdom (the vitest test environment). Any test that imports `brandStore.ts` will fail with "BroadcastChannel is not defined."

**Prevention:** Guard with `typeof BroadcastChannel !== "undefined"` before constructing. Alternatively, provide a mock in vitest setup. The same defensive pattern used for `document` (`if (typeof document === "undefined") return`) applies here.

### Pitfall 4: Double-Bootstrap from `window.focus` on Page Load

**What goes wrong:** The `window.focus` event fires when the page first gains focus (on initial load). If the `focus` listener unconditionally calls `bootstrap()`, the brand is fetched twice on every page load.

**Prevention:** Gate the `focus` refetch on `hasLoaded === true`. On page load, `hasLoaded` is false until `bootstrap()` completes. The `window.focus` refetch only fires for subsequent focus events.

### Pitfall 5: `apiFetch` for Brand Fetch Triggers `UNAUTHORIZED_EVENT`

**What goes wrong:** Using `apiFetch` for `GET /api/branding`. `apiFetch` dispatches `UNAUTHORIZED_EVENT` on 401, which triggers logout. Brand fetch must survive even when the user is not logged in (login page needs brand before auth).

**Prevention:** Use raw `fetch` (not `apiFetch`), matching the `fetchAuthConfig` pattern.

### Pitfall 6: Stale BroadcastChannel After `brandStore.update()` Notification Race

**What goes wrong:** When an admin saves a brand change, the admin's tab calls `update()` which posts to `BroadcastChannel`. The message arrives at OTHER tabs, which call `bootstrap()`. Those tabs' `bootstrap()` fires `GET /api/branding` — but if the server hasn't committed the write yet (very fast save, network in-flight), tabs may get the OLD config.

**Prevention:** The server PUT route writes synchronously to SQLite before responding. `notifyOtherTabs()` is called AFTER `update()` receives the server's confirmed response. The other tabs' `bootstrap()` call fires AFTER the write is complete. No race.

---

## Identity Wiring Checklist

Every file and line to change in Plan 82-03:

| File | Change | Notes |
|------|--------|-------|
| `Sidebar.tsx:45` | Replace `<div className="logo">Kinetica BI</div>` with `<img src={logoUrl ?? DEFAULT_LOGO_ASSET} alt={appName ?? "Kinetica BI"} className="logo-img" />` | Add `useBrandStore` selector for `logoUrl` + `appName` |
| `LoginPage.tsx:27` | Replace `<div className="login-brand">Kinetica BI</div>` with `<div className="login-brand">{appName ?? "Kinetica BI"}</div>` | OIDC branch |
| `LoginPage.tsx:61` | Same replacement | Password branch |
| `Sidebar.spec.tsx:57` | Update: mock `useBrandStore`, assert `<img>` role present when expanded | See spec update section above |
| `Sidebar.spec.tsx:62` | Update: assert `<img>` absent when collapsed | |
| `brandStore.ts` (bootstrap) | `document.title = config.appName ?? "Kinetica BI"` | One line; fires on every bootstrap |
| `index.html` | `<title>Kinetica BI</title>` stays as static fallback; runtime override via `document.title` | No change to the HTML `<title>` tag; React/store overrides it after mount |

**Default logo asset:** Create `packages/web/src/assets/logo-default.svg` (or `.png`) — a simple Kinetica wordmark or icon at ~40×24 px. Import with Vite's asset URL pattern:

```typescript
// In Sidebar.tsx or in a brandDefaults.ts lib file:
import DEFAULT_LOGO_ASSET from "../assets/logo-default.svg";
```

Vite transforms this into a URL string pointing to the Vite-served/hashed asset. Use this URL as the `<img src>` fallback when `logoUrl` is null.

---

## Recommended Plan Breakdown (validates/refines ROADMAP)

The ROADMAP's 3-plan split is correct. Dependency order is strict.

### Plan 82-01: `brandStore.ts` + API client function

**Wave:** 1 (foundation; blocks 82-02 and 82-03)

**Deliverables:**
- `packages/web/src/api/client.ts` — add `fetchBranding(): Promise<BrandingResponse>`, `BrandingResponse` type, `BrandConfigPayload` type
- `packages/web/src/store/brandStore.ts` — `BRAND_STORAGE_KEY`, `BrandState` type, `create<BrandState>`, `applyBrandTokens`, `bootstrap()`, `update()`, `BroadcastChannel` post+listen, `useThemeStore.subscribe` for dark/light re-apply
- `packages/web/src/store/brandStore.spec.ts` — unit tests for: `applyBrandTokens` sets correct tokens on `:root`, `removeProperty` called when value is null, `bootstrap()` populates state + localStorage + document.title, `update()` re-applies tokens and notifies channel (mock BroadcastChannel), dark/light theme subscription calls `applyBrandTokens` with right variant
- `packages/web/src/App.tsx` — add `useBrandStore.getState().bootstrap()` call in the existing bootstrap useEffect; mount `<BrandStyleInjector />`; add `window.focus` listener gated on `hasLoaded`
- `packages/web/src/components/BrandStyleInjector.tsx` — textContent injection, null guard

**Why first:** Defines `BRAND_STORAGE_KEY` and the exact localStorage cache shape that 82-02's inline script reads. Cannot write the inline script without knowing what keys to read from `kbi-brand-tokens`.

### Plan 82-02: FOUC prevention — extend `index.html` inline `<head>` script

**Wave:** 2 (depends on 82-01 for localStorage key shape)

**Deliverables:**
- `packages/web/index.html` — extend the existing inline IIFE (lines 8–17) with the brand token block shown above; add favicon `<link>` injection from cached `logoUrl`

**Testing:** The inline script is vanilla JavaScript with no module imports — it cannot be unit-tested directly by vitest. Test coverage strategy: `brandStore.spec.ts` (Plan 82-01) tests that `localStorage.setItem(BRAND_STORAGE_KEY, ...)` writes the correct JSON shape. The inline script is tested by the shape invariant: if the localStorage object has the same keys that the inline script reads, it works. The Slow-3G first-paint check (success criterion 1) is genuinely human/Phase-84-UAT work.

### Plan 82-03: App identity wiring

**Wave:** 3 (depends on 82-01 for brandStore being available; logically sequential with 82-02 but no technical dependency)

**Deliverables:**
- `packages/web/src/assets/logo-default.svg` — bundled default logo asset
- `packages/web/src/components/Sidebar.tsx` — logo `<img>` with fallback
- `packages/web/src/components/Sidebar.spec.tsx` — spec updates (2 "Kinetica BI" assertions → mock + `<img>` assertions)
- `packages/web/src/components/LoginPage.tsx` — `appName` in both branches (OIDC + password)

**Why last:** Pure wiring with no timing complexity. Lowest risk plan.

---

## Test Strategy

**Framework:** vitest + testing-library (existing, from `packages/web`)

### What is testable in vitest (jsdom):

| Test | File | What to assert |
|------|------|---------------|
| `applyBrandTokens` sets correct `:root` tokens | `brandStore.spec.ts` | `document.documentElement.style.getPropertyValue("--accent")` equals the brand value |
| `removeProperty` called when value is null | `brandStore.spec.ts` | After applying a config with null primaryColor, `getPropertyValue("--accent")` returns `""` |
| `bootstrap()` writes localStorage | `brandStore.spec.ts` | `localStorage.getItem(BRAND_STORAGE_KEY)` is valid JSON after `bootstrap()` with mocked fetch |
| `bootstrap()` sets `document.title` | `brandStore.spec.ts` | `document.title` equals `appName` after bootstrap |
| Dark/light subscription re-applies tokens | `brandStore.spec.ts` | After `useThemeStore.getState().setTheme("light")`, `:root` has light token values |
| `update()` calls `notifyOtherTabs()` | `brandStore.spec.ts` | Mock BroadcastChannel, assert `postMessage` was called |
| `BrandStyleInjector` injects `<style>` | Component test | `document.getElementById("kbi-custom-css")` has correct `textContent` |
| `BrandStyleInjector` uses `textContent` not `innerHTML` | Static code assertion | `grep -c "innerHTML" BrandStyleInjector.tsx` === 0 |
| `Sidebar` shows `<img>` when expanded | `Sidebar.spec.tsx` | `getByRole("img")` exists when `collapsed=false`, not when `collapsed=true` |
| `LoginPage` shows appName | `LoginPage.spec.tsx` (new or existing) | Both OIDC + password branches show the mocked appName |
| `Sidebar.spec.tsx` "Kinetica BI" assertions | Updated | Changed to assert `<img>` role + alt text |

**BroadcastChannel mock pattern for vitest:**
```typescript
// In brandStore.spec.ts:
const mockPostMessage = vi.fn();
vi.stubGlobal("BroadcastChannel", vi.fn().mockImplementation(() => ({
  addEventListener: vi.fn(),
  postMessage: mockPostMessage,
  close: vi.fn(),
})));
```

### What is genuinely human/Phase-84-UAT:

| Scenario | Why human |
|----------|----------|
| Slow-3G first-paint check — custom colors visible from first frame | Requires real browser DevTools network throttling + screen recording |
| Other tab picks up brand change within seconds | Requires two real browser windows; no reliable way to simulate cross-tab BroadcastChannel in jsdom |
| Favicon updates when logo changes | Browser favicon rendering is not testable in jsdom |
| `BrandStyleInjector` CSS applies visually | CSS injection effects are not visually verifiable in jsdom |

---

## Open Questions / Risks

1. **`--font-body` vs ARCHITECTURE.md's `--font-family`**
   - What we know: `global.css` Phase-80 migration uses `--font-body` (confirmed from file). ARCHITECTURE.md research doc says `--font-family`. The actual token is `--font-body`.
   - Risk: If Phase 83 uses `--font-family` for the font picker, the fonts won't apply to `body { font-family: var(--font-body); }`.
   - Recommendation: brandStore and inline script must use `--font-body`. Document this explicitly in 82-01 plan.

2. **`config_json` schema — keys are camelCase but DB column comments say hex strings**
   - What we know: Phase 81 stores whatever the client PUTs in `config_json` as a JSON blob. The field names are determined by whatever Phase 83 will write. For Phase 82 (read-only), the brandStore needs to handle the case where `config` is `{}` (empty object, the Phase-81 seed default) without crashing.
   - Risk: `config.primaryColor` is undefined (not null) when `config_json = '{}'`. The `applyBrandTokens` set helper must handle `undefined` the same as `null`.
   - Recommendation: Use optional chaining throughout. `val ?? undefined` → `removeProperty`.

3. **`GET /api/branding` returns `{ config: {}, logoUrl: null }` when no brand is set (server seed is `config_json = '{}'`)**
   - What we know: `index.ts:421` returns `{ config: {}, logoUrl: null, updatedAt: null }` when the row exists but config is empty.
   - Implication: `brandStore.bootstrap()` must treat an all-null config correctly — no `setProperty` calls, `document.title = "Kinetica BI"`, no favicon injection. Must NOT crash.

4. **Default logo asset — format choice**
   - No `src/assets/` directory exists today (confirmed). Must create directory + file.
   - SVG is the recommended format (crisp at any size, small file, standard for logos).
   - The Vite `import logoUrl from "../assets/logo-default.svg"` pattern returns a URL string at build time — safe to use as `<img src>`.

5. **`window.focus` listener lifecycle in App.tsx**
   - The listener must be cleaned up on unmount (React `useEffect` cleanup) to avoid duplicate listeners across HMR cycles in development.
   - Pattern: `useEffect(() => { const handler = () => {...}; window.addEventListener("focus", handler); return () => window.removeEventListener("focus", handler); }, [])`.

6. **Phase 83 `update()` call site**
   - Phase 82 implements `brandStore.update()` but it is only called from Phase 83's admin save action. The plan for 82-01 should implement `update()` as a stub that is tested but never called in Phase 82 UI.
   - Risk: If `update()` has a bug, it won't surface until Phase 83. Recommendation: unit test `update()` thoroughly in `brandStore.spec.ts`.

---

## Sources

All findings are from direct codebase inspection (HIGH confidence):

- `packages/web/index.html` — full file (lines 1–23 verbatim)
- `packages/web/src/store/theme.ts` — full file (56 lines)
- `packages/web/src/store/auth.ts` — bootstrap pattern (lines 32–54)
- `packages/web/src/api/client.ts` — `fetchAuthConfig` unauthenticated GET pattern (lines 122–126)
- `packages/web/src/components/Sidebar.tsx` — full file (91 lines); "Kinetica BI" at line 45
- `packages/web/src/components/Sidebar.spec.tsx` — "Kinetica BI" assertions at lines 57, 62
- `packages/web/src/components/LoginPage.tsx` — "Kinetica BI" at lines 27, 61
- `packages/web/src/components/Topbar.tsx` — no brand strings (confirmed)
- `packages/web/src/App.tsx` — bootstrap sequence, setProperty usage, store pattern
- `packages/web/src/styles/global.css` — complete `:root` token table (lines 1–101)
- `packages/web/src/styles/theme-guard.spec.ts` — ALLOWLIST pattern, justification comment format
- `packages/server/src/index.ts:416–441` — `GET /api/branding` + `GET /api/branding/logo` implementation (exact response shape)
- `packages/server/src/index.ts:593–617` — `PUT /api/branding` + `POST /api/branding/logo`
- `packages/server/src/db.ts:253–261` — `brand_config` DDL (actual schema; `logo_data TEXT`, `config_json TEXT`)
- `.planning/phases/81-brand-config-server-foundation/81-VERIFICATION.md` — Phase 81 confirmed truths
- `.planning/research/ARCHITECTURE.md` — v1.16 architecture research (HIGH confidence)
- `.planning/research/PITFALLS.md` — v1.16 pitfalls research (HIGH confidence)

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries are existing; no new deps required
- Architecture: HIGH — all patterns verified from actual files; no speculation
- Token names: HIGH — read directly from global.css `:root` block
- Server response shape: HIGH — read directly from index.ts routes
- Pitfalls: HIGH — grounded in actual codebase patterns + confirmed Phase 81 artifacts
- Favicon approach: MEDIUM — URL-from-localStorage approach is sound but not yet validated in a real browser render

**Research date:** 2026-06-24
**Valid until:** 2026-07-24 (stable patterns; invalidated only if Phase 80 token names change or Phase 81 routes change)
