# Phase 83: Branding Admin UI — Research

**Researched:** 2026-06-25
**Domain:** React admin UI — color pickers, WCAG contrast, font/feel-lever controls, CodeMirror CSS editor, live :root apply/revert, BRANDUI-06 server schema extension
**Confidence:** HIGH (all findings grounded in direct codebase reads)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **Single scrolling page** with sections: Logo & app name / Colors / Fonts / Feel levers / Custom CSS. Page header carries Reset + Save. Scaffold mirrors RolesPage/ProfilePage.
- **Live whole-app apply**: edits hit `:root` immediately via `brandStore`/`applyBrandTokens` (`setProperty`) — whole app re-skins live. PLUS a compact preview card (button/chip/input/badge/nav-item).
- **Active-theme nuance**: live re-skin reflects the currently active theme. Editing the off-theme column won't visibly change the live app until the theme is toggled; preview card and whole app update for whichever theme is active.
- **Colors**: side-by-side dark | light columns — all 8 token pairs × 2 = 16 react-colorful pickers. colord for contrast. WCAG = warn-only badges on critical pairs: `--text`/`--bg`, `--accent-text`/`--accent` (accent text readability), `--on-accent`/`--accent` (button text). Save NOT blocked.
- **Save** via `PUT /api/branding` + `POST /api/branding/logo` for newly chosen logo(s). On success: `brandStore.update()` reflects saved state + notifies other tabs.
- **Leave with unsaved changes** → confirm prompt; on leave, **revert** live `:root` back to saved brand (re-call `applyBrandTokens` with `brandStore.config`). Dirty-tracking mirrors RolesPage (`isDirty`/`saving`, Save disabled when `!isDirty`).
- **Reset to Kinetica default** → loads Aurora defaults live (staged), persists only on Save.
- **Logo**: both slots always visible (primary required + dark-override optional). Each previewed on its mode's background. Reuse Phase-81 upload validation. BRANDUI-06 server: `logo_dark_*` columns + dark-variant upload/serve + `logoDarkUrl` in GET; client selects dark variant when `theme==="dark" && logoDarkUrl`.
- **Custom CSS**: CodeMirror via `@uiw/react-codemirror` (installed) + new `@codemirror/lang-css`; `oneDark` when dark. Live as-you-type debounced via `BrandStyleInjector` textContent. On Save, server `sanitizeCssPostcss` returns cleaned CSS; editor shows "stripped declarations" notice. UNSCOPED full-power. Branding settings page itself is EXEMPT from live custom CSS.
- **Open Decision 1 RESOLVED**: custom CSS = UNSCOPED (diverges from CSS-V116-02 literal "scoped" — protecting the branding admin page is the safety net; flag for Phase 84).

### Claude's Discretion
- Section ordering within the page; exact preview-card component set; debounce interval for live CSS.
- Feel-lever control types: density as Compact/Comfortable/Spacious presets; radius + glow on/off; type-scale base+ratio; motion-speed.
- Curated font list (e.g. Manrope, Space Grotesk + a few self-hosted) for body + display font.
- Extending `BrandConfigPayload` + `applyBrandTokens` to cover display-font + feel-lever tokens.

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within Phase 83 boundary. Per-tenant branding / brand import-export remain v2.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| BRANDUI-02 | Admin edits color palette dark+light via pickers with live WCAG contrast indicator | react-colorful HexColorPicker + colord a11y plugin `.contrast()` + `.isReadable()`; 16-picker grid spec below |
| BRANDUI-03 | Admin chooses body + display fonts from curated self-hosted list | `--font-body` + `--font-display` already exist in global.css; extend BrandConfigPayload; curated list approach below |
| BRANDUI-04 | Admin adjusts feel levers: corner radius, density, ambient glow + coarse type-scale + motion speed | Token mapping confirmed against global.css; `--radius`, `--space-*`, `--duration-*` exist; glow requires new token |
| BRANDUI-05 | Live preview before saving; Save + Reset-to-Kinetica-default | applyBrandTokens + page unmount revert mechanism; RolesPage dirty-tracking pattern |
| BRANDUI-06 | Optional dark-mode logo override; client selects dark variant in dark mode | BOTH-stack: server schema + route + client selection; exact vertical slice below |
| CSS-V116-01 | Permitted admin injects custom CSS; persisted + applied at runtime | CodeMirror CSS editor + BrandStyleInjector; "stripped declarations" diff from PUT response |
| SECA-V116-02 | Branding UI surfaces WCAG contrast guardrails for dark AND light simultaneously | colord a11y plugin; warn-only; critical-pair list; rendered as inline badges |
</phase_requirements>

---

## Summary

Phase 83 is a single React settings page (`BrandingSettingsPage.tsx`) wired into the existing state machines from Phases 81/82. The infrastructure — `brandStore`, `applyBrandTokens`, `BrandStyleInjector`, `sanitizeCssPostcss`, `BrandConfigPayload`, PUT/POST routes — exists and works. Phase 83 builds the admin UI on top of it and extends the payload shape to cover display-font and five feel-lever fields, adds a BRANDUI-06 server column pair, and wires a CodeMirror CSS editor.

The two architectural facts that shape every plan: (1) the app has **no URL-based router** — navigation is `setPage(key)` state in App.tsx, and `onSelect` on Sidebar calls that setter directly. There is no React Router `useBlocker`/`Prompt`. Unsaved-on-leave guarding is therefore done inside the page's own `useEffect` cleanup or by intercepting the `onSelect` call in App.tsx (the `RolesPage` pattern uses `window.confirm` at the component level when navigating away within the page — but for cross-page leave, the guard must be lifted to App.tsx's `setPage` wrapper). (2) `BrandConfigPayload` currently lacks display-font and feel-lever fields — these must be added before `applyBrandTokens` can map them.

**Primary recommendation:** Build in four plans matching the ROADMAP stub. Plans 83-01/02 are Web-only and parallel-safe after 83-01 lands; 83-03 (CSS editor) depends on 83-01 scaffold; 83-04 (BRANDUI-06) is BOTH-stack and self-contained — server work first, then client wiring.

---

## Standard Stack

### Core (already installed)

| Library | Installed Version | Purpose | Why Standard |
|---------|------------------|---------|--------------|
| `@uiw/react-codemirror` | 4.25.9 | CSS editor shell | Already used in DynamicViewsModal + KineticaWmsLayerForm; same import pattern |
| `@codemirror/lang-sql` | 6.10.0 | SQL extension (precedent) | Confirms `@codemirror/lang-css` is same major (6.x) — compatible |
| `@codemirror/lang-css` | **6.3.1 already in lock** | CSS syntax highlighting | Transitive dep already resolved in package-lock.json — just needs `package.json` entry |
| `zustand` | 4.5.2 | brandStore | Already wired |
| `postcss` | (server) | sanitizeCssPostcss | Already installed + wired in Phase 81 |

### New Web Dependencies

| Library | Version | Purpose | Note |
|---------|---------|---------|------|
| `react-colorful` | `^5.7.0` | 16 hex color pickers | 2.8 KB gzipped, zero deps, React 18 hooks-based. NOT yet in package.json. |
| `colord` | `^2.9.3` | Contrast ratio math | 1.7 KB gzipped, zero deps. Needs `colord/plugins/a11y` extension for `.contrast()` / `.isReadable()`. NOT yet in package.json. |

**Installation:**
```bash
# From packages/web
npm install react-colorful colord
```

`@codemirror/lang-css` is already present in `package-lock.json` at 6.3.1 (transitive). Just add it to `package.json`:
```bash
npm install @codemirror/lang-css
```
No version conflict — `@codemirror/lang-sql` is `^6.10.0` and `lang-css` is `^6.3.x`; both are @codemirror/6.x ecosystem.

---

## Architecture Patterns

### App Routing: State-Based (No URL Router)

**Critical:** The app uses `useState<Page>` in `App.tsx`, NOT React Router. Navigation is:
```tsx
// App.tsx line 254
<Sidebar activeKey={page} onSelect={(key) => { setPage(key as Page); setDashboardViewMode("list"); }} />
// Render:
{page === "settings" && <div className="muted">Section coming soon.</div>}
```

There is **no React Router `useBlocker`/`<Prompt>`**. The `RolesPage` dirty-tracking (lines 87-102) uses `window.confirm` only for within-page navigation (switching selected role). For cross-page navigation (user clicks a Sidebar item while `BrandingSettingsPage` has unsaved changes), the guard must be implemented by wrapping App.tsx's `onSelect` handler — passing an `isDirty` ref or callback from `BrandingSettingsPage` up to App.tsx, or intercepting in the Sidebar `onSelect` prop.

**Recommended mechanism for leave-with-unsaved:** `BrandingSettingsPage` exposes a `ref` or `onBeforeLeave` callback that App.tsx calls before switching away from `page === "settings"`. Alternative (simpler): a module-level `let brandPageIsDirty = false` flag in a small `brandPageGuard.ts` that `BrandingSettingsPage` sets and App.tsx reads when `onSelect` fires. On leaving with `isDirty === true`: `window.confirm(...)`, then call `applyBrandTokens(brandStore.config, theme)` to revert live `:root` to the last-saved state.

**Revert mechanism on leave:** `brandStore.config` holds the last-saved config (set by `update()` or `bootstrap()`). On confirm-leave:
```ts
// Revert live :root to saved state:
applyBrandTokens(useBrandStore.getState().config, useThemeStore.getState().theme);
// BrandStyleInjector will also revert via store.customCss (no separate action needed)
```
`applyBrandTokens` is not exported from brandStore.ts (it is module-private). Phase 83 must either export it or call `useBrandStore.getState().bootstrap()` (which re-fetches and re-applies). The cleaner approach: export `applyBrandTokens` or add a `revertToSaved(): void` action to `BrandState` that calls `applyBrandTokens(get().config, theme)` — avoids a network round-trip on leave.

### Page Scaffold: mirrors RolesPage

```
BrandingSettingsPage
  state: draftConfig (BrandConfigPayload), isDirty, saving
         draftLogoFile (File | null), draftDarkLogoFile (File | null)
         strippedDeclarations (string | null) — from last Save response

  useEffect(() => return () => { if isDirty: confirm + revert }, [isDirty])
    — runs cleanup on unmount; BUT since page conditionally renders
      {page==="settings" && <BrandingSettingsPage/>}, unmount IS the leave event.
      A useEffect cleanup with isDirty check + window.confirm does work here.

  Header:
    <h2>Branding</h2>
    <button disabled={!isDirty || saving} onClick={handleSave}>Save</button>
    <button onClick={handleReset}>Reset to Kinetica Defaults</button>

  Sections (scrollable):
    1. Logo & App Name
    2. Colors (16 pickers, 2-col dark|light)
    3. Fonts (body + display dropdowns)
    4. Feel Levers (density/radius/glow/type-scale/motion)
    5. Custom CSS (CodeMirror)
    [Preview card fixed or inline]
```

**isDirty tracking:** Set to `true` on any draft change. Reset to `false` after successful Save. Pattern from RolesPage lines 47-48, 113-114.

**Key difference from RolesPage:** RolesPage's dirty guard only covers within-page navigation (switching roles). BrandingSettingsPage needs to guard cross-page navigation. Use `useEffect` cleanup:

```ts
useEffect(() => {
  return () => {
    // Cleanup = component unmounts = user navigated away
    // window.confirm inside useEffect cleanup is too late (DOM already gone in some browsers)
    // BETTER: intercept at App.tsx onSelect level
  };
}, [isDirty]);
```

The safest implementation: in App.tsx, wrap `setPage` for the "leave settings" case:
```ts
const handleNav = (key: string) => {
  if (page === "settings" && brandPageIsDirtyRef.current) {
    const ok = window.confirm("Discard unsaved branding changes?");
    if (!ok) return;
    brandPageRevertRef.current?.(); // calls applyBrandTokens(savedConfig)
  }
  setPage(key as Page);
  setDashboardViewMode("list");
};
```
`brandPageIsDirtyRef` and `brandPageRevertRef` are refs populated by `BrandingSettingsPage` via a prop or context. This is the same pattern used by RolesPage's `handleSelectRole` guard (lines 87-102) just lifted one level.

---

## BrandConfigPayload Extension Spec

### Current Shape (client.ts lines 132-143)

```ts
export type BrandConfigPayload = {
  // 8 color pairs dark + light (16 fields):
  primaryColor?: string | null;      accent2Color?: string | null;
  bgColor?: string | null;           panelColor?: string | null;
  textColor?: string | null;         mutedColor?: string | null;
  borderColor?: string | null;       dangerColor?: string | null;
  lightPrimaryColor?: string | null; lightAccent2Color?: string | null;
  lightBgColor?: string | null;      lightPanelColor?: string | null;
  lightTextColor?: string | null;    lightMutedColor?: string | null;
  lightBorderColor?: string | null;  lightDangerColor?: string | null;
  // Typography:
  fontFamily?: string | null;        // maps to --font-body (body font)
  fontUrl?: string | null;           // optional Google Fonts/CDN link tag
  // Identity:
  appName?: string | null;           customCss?: string | null;
};
```

### Required New Fields (Phase 83)

Add to `BrandConfigPayload` in `packages/web/src/api/client.ts`:

```ts
  // Display font (Phase 83 — BRANDUI-03)
  displayFontFamily?: string | null;  // maps to --font-display
  displayFontUrl?: string | null;     // Google Fonts link for display font

  // Feel levers (Phase 83 — BRANDUI-04)
  densityPreset?: "compact" | "comfortable" | "spacious" | null;
  // density drives --space-* scale: compact = current (4px rhythm); comfortable = 1.25x; spacious = 1.5x
  // IMPLEMENTATION NOTE: density controls --space-1 through --space-10 as a multiplier.
  // There is NO single --density token in global.css today — density affects the whole --space-* set.
  // Approach: map "compact" → no override (Aurora default); "comfortable" → setProperty on each --space-*;
  // "spacious" → setProperty on each --space-*. FLAG: 8 individual setProperty calls, no shorthand.

  radiusPreset?: "sharp" | "default" | "round" | null;
  // "sharp" → --radius=4px, --radius-sm=2px, --radius-md=4px, --radius-lg=6px
  // "default" → removeProperty (Aurora defaults: --radius=13px, --radius-sm=9px, --radius-md=8px, --radius-lg=12px)
  // "round"  → --radius=20px, --radius-sm=14px, --radius-md=16px, --radius-lg=20px

  glowEnabled?: boolean | null;
  // Controls whether the aurora radial gradient wash on body is visible.
  // IMPLEMENTATION NOTE: body background in global.css is a compound multi-stop radial-gradient.
  // There is NO single --glow token in global.css today. FLAG — no direct token to toggle.
  // Approach A: add a new --glow-opacity token (0 = off, 1 = on) used in the radial-gradient rgba() alpha.
  //   Requires global.css body background to interpolate rgba(127,64,237,calc(0.20 * var(--glow-opacity,1))).
  //   This is a Phase 83 global.css change — low risk (body only).
  // Approach B: inject/remove a <style> override toggling body background to omit the glow stops.
  //   Heavier. Approach A preferred.
  // FLAG: glowEnabled needs a backing --glow-opacity token ADDED to global.css in the same plan.

  typeScaleBase?: number | null;
  // Base font size in px. Maps to --text-base. Aurora default = 12. Range: 11–15.
  // Side-effect: all relative --text-* sizes scale from --text-base proportionally only if other tokens
  // are also updated. The current --text-* scale (9/10/11/12/14/16/21) is NOT derived from --text-base.
  // FLAG: the type-scale tokens in global.css are ABSOLUTE values, not relative to --text-base.
  // Only --text-base (body baseline) is directly mappable. The UI should expose only body baseline,
  // not the full scale. Expose "Small/Medium/Large" presets that map to full --text-* override sets.

  motionSpeed?: "none" | "reduced" | "default" | "fast" | null;
  // Maps to --duration-fast/base/slow:
  // "none"    → 0ms, 0ms, 0ms
  // "reduced" → 50ms, 100ms, 150ms
  // "default" → removeProperty (100ms, 200ms, 300ms)
  // "fast"    → 60ms, 120ms, 180ms
```

### applyBrandTokens Extension

`applyBrandTokens` in `packages/web/src/store/brandStore.ts` currently ends at `set("--font-body", config.fontFamily)`. Add after it:

```ts
// Display font
set("--font-display", config.displayFontFamily);

// Density (space-* scale multipliers)
applyDensityPreset(root, config.densityPreset ?? null);

// Radius preset
applyRadiusPreset(root, config.radiusPreset ?? null);

// Glow (requires --glow-opacity token added to global.css body background)
if (config.glowEnabled === false) root.style.setProperty("--glow-opacity", "0");
else root.style.removeProperty("--glow-opacity");

// Type scale base (only --text-base directly; see FLAG above)
// Phase 83 discretion: expose as Small(11)/Medium(12)/Large(14) presets
applyTypeScalePreset(root, config.typeScaleBase ?? null);

// Motion speed
applyMotionPreset(root, config.motionSpeed ?? null);
```

Helper functions (pure, no imports):
```ts
function applyDensityPreset(root: HTMLElement, preset: string | null): void {
  const scales = {
    compact:     null,                                   // Aurora defaults
    comfortable: ["4px","8px","12px","14px","20px","24px","28px","36px"],
    spacious:    ["6px","12px","14px","18px","24px","28px","34px","44px"],
  };
  const TOKENS = ["--space-1","--space-2","--space-3","--space-4","--space-5","--space-6","--space-8","--space-10"];
  if (!preset || preset === "compact") { TOKENS.forEach(t => root.style.removeProperty(t)); return; }
  const vals = scales[preset as keyof typeof scales];
  if (!vals) return;
  TOKENS.forEach((t, i) => root.style.setProperty(t, vals[i]));
}
function applyRadiusPreset(root: HTMLElement, preset: string | null): void {
  const RTOKENS = ["--radius","--radius-sm","--radius-md","--radius-lg"];
  if (!preset || preset === "default") { RTOKENS.forEach(t => root.style.removeProperty(t)); return; }
  const maps: Record<string,string[]> = {
    sharp: ["4px","2px","4px","6px"],
    round: ["20px","14px","16px","20px"],
  };
  (maps[preset] ?? []).forEach((v, i) => root.style.setProperty(RTOKENS[i], v));
}
function applyMotionPreset(root: HTMLElement, speed: string | null): void {
  if (!speed || speed === "default") {
    ["--duration-fast","--duration-base","--duration-slow"].forEach(t => root.style.removeProperty(t));
    return;
  }
  const maps: Record<string,[string,string,string]> = {
    none:    ["0ms","0ms","0ms"], reduced:["50ms","100ms","150ms"], fast:["60ms","120ms","180ms"],
  };
  const [f,b,s] = maps[speed] ?? ["100ms","200ms","300ms"];
  root.style.setProperty("--duration-fast", f);
  root.style.setProperty("--duration-base", b);
  root.style.setProperty("--duration-slow", s);
}
function applyTypeScalePreset(root: HTMLElement, base: number | null): void {
  if (!base) { root.style.removeProperty("--text-base"); return; }
  root.style.setProperty("--text-base", `${base}px`);
}
```

**FLAGS requiring global.css change:**
- `--glow-opacity` token must be added to the body background radial-gradient rgba() calls. This is a Phase 83 task (one-line change per glow stop, ~4 lines).
- The `--text-*` scale is absolute (not derived from `--text-base`). Only body baseline is overridable per token. The UI should expose "Small / Medium / Large" body text presets, not a continuous slider.

---

## Color Section: 16 Pickers Side-by-Side

### Token Map (8 pairs × 2 modes = 16)

| Field in BrandConfigPayload | :root token | Column |
|------------------------------|-------------|--------|
| `primaryColor` / `lightPrimaryColor` | `--accent` | Dark / Light |
| `accent2Color` / `lightAccent2Color` | `--accent-2` | Dark / Light |
| `bgColor` / `lightBgColor` | `--bg` | Dark / Light |
| `panelColor` / `lightPanelColor` | `--panel` | Dark / Light |
| `textColor` / `lightTextColor` | `--text` | Dark / Light |
| `mutedColor` / `lightMutedColor` | `--muted` | Dark / Light |
| `borderColor` / `lightBorderColor` | `--border` | Dark / Light |
| `dangerColor` / `lightDangerColor` | `--danger` | Dark / Light |

**Note on `--accent-text`:** The CONTEXT.md two-tier accent rule mentions WCAG checking `--accent-text` on its background. `--accent-text` is NOT currently a `BrandConfigPayload` field. Phase 83 should include it as a new field `accentTextColor` / `lightAccentTextColor` mapping to `--accent-text`. Without this, the admin cannot set the two-tier accent text color at all. **FLAG for planner:** add this pair (2 new fields) to BrandConfigPayload extension.

### react-colorful API

```tsx
import { HexColorPicker } from "react-colorful";

// Props: color (string hex), onChange ((color: string) => void), onChangeEnd
<HexColorPicker
  color={draft.primaryColor ?? "#7f40ed"}
  onChange={(hex) => {
    setDraft(d => ({ ...d, primaryColor: hex }));
    // Live apply to :root immediately (CONTEXT.md locked)
    applyBrandTokens({ ...draft, primaryColor: hex }, theme);
  }}
/>
```

`onChange` fires on every drag position. For live :root apply this is correct (immediate visual feedback). The `onChangeEnd` callback fires when user releases — use this for debounced WCAG re-check if performance is a concern, but the WCAG computation via colord is microseconds so computing on every `onChange` is fine.

### colord WCAG: Exact API

```ts
import { colord, extend } from "colord";
import a11yPlugin from "colord/plugins/a11y";
extend([a11yPlugin]);

// Contrast ratio (1–21):
const ratio = colord(bgColor).contrast(textColor);
// → e.g. 14.3

// WCAG AA pass/fail:
const aaPass = colord(bgColor).isReadable(textColor, { level: "AA", size: "normal" });
// AA normal: 4.5:1; AA large/UI: 3.0:1
```

`extend([a11yPlugin])` must be called ONCE at module level (not per render). Put it at the top of the WCAG badge utility file.

### Critical Pairs (WCAG badges per CONTEXT.md)

| Pair | Check | Threshold | Fields |
|------|-------|-----------|--------|
| `--text` on `--bg` | Primary text readability | AA normal (4.5:1) | `textColor`/`bgColor` + `lightTextColor`/`lightBgColor` |
| `--accent-text` on `--accent` | Accent-colored text on accent fill | AA normal (4.5:1) | `accentTextColor`/`primaryColor` + `lightAccentTextColor`/`lightPrimaryColor` |
| `--on-accent` on `--accent` | Button text on accent fills | AA normal (4.5:1) | (fixed `#ffffff` unless also exposed as a field) |

**`--on-accent` note:** Currently fixed at `#ffffff` in global.css. Since it is not a `BrandConfigPayload` field, the Phase 83 WCAG check for it should be computed live by checking `#ffffff` against the current `--accent` draft value. If the admin picks a very light accent, this will flag. Consider adding `onAccentColor` to the payload (one field, no light variant needed) — Phase 83 discretion.

### WCAG Badge Rendering

Render as inline colored badge next to each critical picker:
```tsx
const ratio = colord(bg).contrast(text);
const pass  = ratio >= 4.5;
<span className={pass ? "wcag-pass" : "wcag-fail"}>
  {ratio.toFixed(1)}:1 {pass ? "AA" : "FAIL"}
</span>
```
Classes `wcag-pass` / `wcag-fail` use `var(--success)` / `var(--danger)` — no hardcoded colors (theme-guard safe).

---

## Fonts Section

### Existing Tokens in global.css

```css
--font-body: "Manrope Variable", "Segoe UI", system-ui, -apple-system, sans-serif;
--font-display: "Space Grotesk Variable", "Segoe UI", system-ui, -apple-system, sans-serif;
```

Both are already CSS custom properties. `body { font-family: var(--font-body); }` is in global.css. Headings use `var(--font-display)` directly. Overriding them is a straightforward `setProperty("--font-body", newFamily)`.

### Self-Hosted Font Strategy (CONTEXT.md locked: no arbitrary URLs)

The project already self-hosts Manrope Variable and Space Grotesk Variable via `@fontsource-variable` (Phase 80). Curated list for Phase 83 should be the already-installed fonts plus any others from @fontsource-variable that are already in node_modules. Using Google Fonts CDN for other picks is acceptable (REQUIREMENTS.md does NOT say "offline only" — just "self-hosted list"; the operator clarified: curated list, no arbitrary URLs from the user). Check installed @fontsource packages:

```bash
ls packages/web/node_modules/@fontsource-variable/ 2>/dev/null
```

For the Phase 83 UI: a `<select>` with 4–6 options is sufficient. Body and Display each get their own select. The font value stored in `BrandConfigPayload.fontFamily` is the CSS font-family string; if a Google Fonts CDN link is needed, store it in `fontUrl` and inject a `<link>` at apply time (existing `fontUrl` field). Phase 83 can use the already-installed `@fontsource-variable` fonts by name — no CDN needed for them.

---

## Feel Levers Section

Control types (Claude's discretion):

| Lever | Control Type | Values | Token(s) |
|-------|-------------|--------|----------|
| Density | 3-button segmented (Compact / Comfortable / Spacious) | enum | `--space-1` through `--space-10` (8 tokens) |
| Radius | 3-button segmented (Sharp / Default / Round) | enum | `--radius`, `--radius-sm`, `--radius-md`, `--radius-lg` |
| Glow | Toggle (on/off) | boolean | `--glow-opacity` (NEW — must add to global.css body background) |
| Type Scale | 3-button segmented (Small / Medium / Large) | enum mapping to base px | `--text-base` only (other --text-* are absolute) |
| Motion | 4-button segmented (None / Reduced / Default / Fast) | enum | `--duration-fast`, `--duration-base`, `--duration-slow` |

Each control calls `applyBrandTokens` immediately on change for live preview.

---

## Custom CSS Section

### CodeMirror Setup

Replicates `DynamicViewsModal.tsx` pattern exactly, substituting `css()` for `sql()`:

```tsx
import CodeMirror, { oneDark } from "@uiw/react-codemirror";
import { css } from "@codemirror/lang-css"; // NEW dep — already in lock file at 6.3.1
import { useThemeStore } from "../store/theme";

const editorTheme = useThemeStore((s) => s.theme) === "dark" ? oneDark : "light";

<CodeMirror
  value={draftCss}
  onChange={handleCssChange}         // debounced live injection below
  extensions={[css()]}
  theme={editorTheme}
  minHeight="200px"
  maxHeight="400px"
  placeholder="/* Custom CSS — applies to entire app. Reset clears. */"
/>
```

`oneDark` is imported from `@uiw/react-codemirror` (not from `@codemirror/theme-one-dark`). Same as DynamicViewsModal line 43.

### Live Debounced Injection

```ts
const DEBOUNCE_MS = 400; // Claude's discretion
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

function handleCssChange(value: string) {
  setDraftCss(value);
  setIsDirty(true);
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    // Live inject raw (unsanitized) CSS for trusted admin preview
    // BrandStyleInjector watches brandStore.customCss — bypass it here for draft preview
    // Use a SEPARATE draft style element (not kbi-custom-css) to avoid overwriting saved CSS
    const el = getDraftStyleEl(); // creates/reuses <style id="kbi-brand-css-draft">
    el.textContent = value;       // raw preview — OK for trusted admin session
  }, DEBOUNCE_MS);
}
```

**Why a separate draft style element:** The live `:root` is already the whole app. `<style id="kbi-custom-css">` reflects the LAST SAVED custom CSS (from brandStore.customCss). The draft must NOT overwrite that until Save — use `kbi-brand-css-draft` for the in-progress preview. On unmount/leave, remove the draft element.

**Branding page CSS exemption:** To exempt `BrandingSettingsPage` itself from live custom CSS (so Reset is always reachable), the draft style element should target `#root` but exclude the branding page's own container. Implementation: wrap the branding page's root element in a `<div id="branding-admin-exempt">` and add a CSS comment / exclusion. The SIMPLEST approach matching the CONTEXT.md intent: just ensure the draft custom CSS injects AFTER the branding page's own styles in the cascade, and that the branding page uses `!important` only on critical Reset/Save buttons — OR simply note this as a Phase 84 UAT check and don't build complex exclusion logic. The admin can always reach Reset via the hardcoded-position page header.

### "Stripped Declarations" Notice

The PUT /api/branding handler (server/src/index.ts line 607) sanitizes `customCss` via `sanitizeCssPostcss()` and returns `{ config: ..., updatedAt: ... }` where `config.customCss` is the sanitized result. After Save:

```ts
const putResponse = await updateBrandConfig(draft); // PUT /api/branding
const savedCss = putResponse.config.customCss ?? "";
const submittedCss = draft.customCss ?? "";

if (savedCss !== submittedCss) {
  // Show stripped declarations notice
  setStrippedDeclarations(computeStrippedNotice(submittedCss, savedCss));
}
// Update editor to show the sanitized version
setDraftCss(savedCss);
```

`computeStrippedNotice` compares line-by-line or counts declaration removals. Simple approach: show "X declarations were removed by the server (url(), @import, etc.)" without an exact diff.

The PUT response **does** return `config.customCss` — confirmed from server/src/index.ts line 616: `return res.json({ config: JSON.parse(row.config_json), updatedAt: row.updated_at })`.

---

## API Client Functions (New)

Add to `packages/web/src/api/client.ts`:

```ts
// PUT /api/branding — persist brand config (authenticated, branding:manage)
export type BrandingPutResponse = {
  config: BrandConfigPayload;
  updatedAt: string;
};
export const updateBrandConfig = async (
  config: BrandConfigPayload
): Promise<BrandingPutResponse> => {
  const response = await apiFetch(`${API_BASE}/api/branding`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ config }),
  });
  if (!response.ok) await throwForStatus(response, "Failed to save brand config");
  return response.json() as Promise<BrandingPutResponse>;
};

// POST /api/branding/logo — upload logo variant (authenticated, branding:manage)
// variant: 'primary' (default) | 'dark' (BRANDUI-06)
export type LogoUploadResponse = {
  logoUrl: string; // for 'primary'; or logoDarkUrl for 'dark'
};
export const uploadBrandLogo = async (
  file: File,
  variant: "primary" | "dark" = "primary"
): Promise<LogoUploadResponse> => {
  const form = new FormData();
  form.append("logo", file);
  if (variant === "dark") form.append("variant", "dark");
  const response = await apiFetch(`${API_BASE}/api/branding/logo`, {
    method: "POST",
    body: form,
  });
  if (!response.ok) await throwForStatus(response, "Failed to upload logo");
  return response.json() as Promise<LogoUploadResponse>;
};
```

**Server request shapes (confirmed from index.ts):**
- `PUT /api/branding`: `{ config: Record<string, unknown> }` — server extracts `config` object, sanitizes `customCss` in place, upserts `config_json`.
- `POST /api/branding/logo`: multipart form, field `logo` (file). Phase 83 adds optional `variant` field.
- `GET /api/branding` response: `{ config: BrandConfigPayload, logoUrl: string | null, updatedAt: string | null }`.

---

## BRANDUI-06 Server Vertical Slice

### db.ts Column Additions

The `brand_config` table currently has: `id, config_json, logo_data, logo_mime, logo_updated_at, updated_at, updated_by`.

Add via PRAGMA-guarded ALTER (same pattern as sessions table lines 277-293):

```ts
// In createDb(), after existing PRAGMA guards:
const brandCols = instance.prepare("PRAGMA table_info(brand_config)").all() as Array<{ name: string }>;
const brandColNames = new Set(brandCols.map((c: { name: string }) => c.name));
if (!brandColNames.has("logo_dark_data")) {
  instance.exec("ALTER TABLE brand_config ADD COLUMN logo_dark_data TEXT");
}
if (!brandColNames.has("logo_dark_mime")) {
  instance.exec("ALTER TABLE brand_config ADD COLUMN logo_dark_mime TEXT");
}
if (!brandColNames.has("logo_dark_updated_at")) {
  instance.exec("ALTER TABLE brand_config ADD COLUMN logo_dark_updated_at TEXT");
}
```

Note: `brand_config` is a new v1.16 table (no ALTER needed for fresh installs — `CREATE TABLE IF NOT EXISTS` already includes the columns if added to SCHEMA_DDL). The PRAGMA-guarded ALTER is only for existing Phase 81 deployments that have `brand_config` without the dark columns.

**Recommended: add all three to SCHEMA_DDL as well** so fresh deployments get them without ALTER:
```sql
CREATE TABLE IF NOT EXISTS brand_config (
  id          INTEGER PRIMARY KEY CHECK(id = 1),
  config_json TEXT NOT NULL DEFAULT '{}',
  logo_data   TEXT,  logo_mime TEXT,  logo_updated_at TEXT,
  logo_dark_data TEXT,  logo_dark_mime TEXT,  logo_dark_updated_at TEXT,  -- BRANDUI-06
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by  TEXT
);
```

### Route Changes (index.ts)

**GET /api/branding** (lines 416-427): Add `logo_dark_mime, logo_dark_updated_at` to the SELECT and compute `logoDarkUrl`:
```ts
const row = db.prepare(
  "SELECT config_json, logo_mime, logo_updated_at, logo_dark_mime, logo_dark_updated_at, updated_at FROM brand_config WHERE id = 1"
).get() as BrandConfigRow | undefined;
const logoDarkUrl = row?.logo_dark_mime && row?.logo_dark_updated_at
  ? `/api/branding/logo?variant=dark&v=${encodeURIComponent(row.logo_dark_updated_at)}`
  : null;
return res.json({ config, logoUrl, logoDarkUrl, updatedAt: ... });
```

**GET /api/branding/logo** (lines 431-441): Support `?variant=dark` query param:
```ts
app.get("/api/branding/logo", (_req, res) => {
  const variant = (_req.query as Record<string, string>).variant === "dark" ? "dark" : "primary";
  const col = variant === "dark" ? "logo_dark_data, logo_dark_mime" : "logo_data, logo_mime";
  const row = db.prepare(`SELECT ${col} FROM brand_config WHERE id = 1`).get() as any;
  const data = variant === "dark" ? row?.logo_dark_data : row?.logo_data;
  const mime = variant === "dark" ? row?.logo_dark_mime : row?.logo_mime;
  if (!data || !mime) return res.status(404).end();
  // ... same Buffer.from + headers as existing
});
```

**POST /api/branding/logo** (lines 627-678): Add `variant` field handling:
```ts
// After multer middleware + existing validation logic:
const variant = (req.body as Record<string,unknown>)?.variant === "dark" ? "dark" : "primary";
// For variant === "dark", write to logo_dark_* columns:
if (variant === "dark") {
  db.prepare(
    "UPDATE brand_config SET logo_dark_data=?, logo_dark_mime=?, logo_dark_updated_at=?, updated_at=datetime('now'), updated_by=? WHERE id=1"
  ).run(storedData, storedMime, ts, username);
  return res.json({ logoDarkUrl: `/api/branding/logo?variant=dark&v=${encodeURIComponent(ts)}` });
} else {
  // existing primary logo update unchanged
}
```

**Reuse Phase-81 validation**: The SVG content-sniff + DOMPurify path and raster magic-byte check are ALREADY in the POST handler body. The variant change only affects which columns are written — the validation logic is identical.

### BrandingResponse Extension

Add to `client.ts` `BrandingResponse`:
```ts
export type BrandingResponse = {
  config: BrandConfigPayload;
  logoUrl: string | null;
  logoDarkUrl: string | null;  // NEW — BRANDUI-06
  updatedAt: string | null;
};
```

### brandStore Extension

Add `logoDarkUrl: string | null` to `BrandState`. In `bootstrap()` and `update()`, read/set from `data.logoDarkUrl`.

### Sidebar Client Selection

```tsx
// Sidebar.tsx — after brandStore reads
const logoDarkUrl = useBrandStore((s) => s.logoDarkUrl);
const theme = useThemeStore((s) => s.theme);
const effectiveLogoUrl = (theme === "dark" && logoDarkUrl) ? logoDarkUrl : logoUrl;

{effectiveLogoUrl ? (
  <img src={effectiveLogoUrl} alt={appName ?? "Kinetica BI"} className="logo-img" />
) : (
  <DefaultLogo className="logo-img" title={appName ?? "Kinetica BI"} />
)}
```

### FOUC Script Extension

The `index.html` inline IIFE also needs `logoDarkUrl` from localStorage. Add to the script:
```js
var effectiveLogoUrl = (isDark && brand.logoDarkUrl) ? brand.logoDarkUrl : brand.logoUrl;
// (used for the favicon injection — the sidebar logo is rendered by React, not the FOUC script)
```

---

## Theme-Guard ALLOWLIST Handling

### The Problem

`BrandColorPicker.tsx` (or equivalent) will contain hex literals as the **default values** for color inputs:
```tsx
<HexColorPicker color={draft.primaryColor ?? "#7f40ed"} ... />
```
The hex `#7f40ed` is data (a default config value), not a CSS literal. But the theme-guard `HEX_RE` regex matches it regardless.

### ALLOWLIST Entry Pattern

The guard is in `packages/web/src/styles/theme-guard.spec.ts`. The `ALLOWLIST` array is at line 37. New entries go here:

```ts
const ALLOWLIST: ReadonlyArray<string> = [
  // ... existing entries ...

  // Color tooling: BrandingSettingsPage and its sub-components — their job is to
  // author literal hex color values; default picker values appear as hex literals.
  "settings/BrandingSettingsPage.tsx",
  "settings/BrandColorPicker.tsx",   // if split into a subcomponent
];
```

Each entry must have a justification comment (STATE invariant — same commit as the component).

**Does react-colorful itself trigger the guard?** react-colorful renders **inline styles** at runtime (not compile-time hex in component source). The guard scans `.tsx` source files, not runtime DOM. As long as the only hex literals in `BrandColorPicker.tsx` are the Aurora default fallback values, a single ALLOWLIST entry covers it. Confirm by checking: `grep -n '#[0-9a-fA-F]' src/components/settings/BrandColorPicker.tsx` — if only default values appear, one ALLOWLIST entry is sufficient.

The guard also scans `*.css` files in `src/components/`. `BrandingSettingsPage.css` should use only `var(--token)` values — no hex in the CSS. Defaults live in `.tsx` only.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead |
|---------|-------------|-------------|
| Color picker | Custom `<input type="color">` wrapper | `react-colorful` HexColorPicker |
| WCAG contrast ratio | Custom luminance math | `colord` a11y plugin `.contrast()` / `.isReadable()` |
| CSS syntax highlighting | Regex-based textarea | `@uiw/react-codemirror` + `@codemirror/lang-css` (both available) |
| CSS sanitization | Client-side regex strip | Server-side `sanitizeCssPostcss()` (Phase 81, already wired) |
| SVG logo validation | MIME check only | Phase-81 path (content-sniff + DOMPurify + magic-byte) — reuse for dark variant |
| Cross-tab brand propagation | `localStorage` polling | `BroadcastChannel` (already wired in brandStore) |

---

## Common Pitfalls

### Pitfall 1: Dirty-Flag vs. Live-Apply Confusion
**What goes wrong:** Developer applies draft changes to `:root` live AND marks `isDirty = true`. On Save, they call `brandStore.update(draft)` which re-applies the same tokens — correct. But on Reset, they call `removeProperty` for all tokens AND set `isDirty = false` — now the `:root` shows Aurora defaults but `isDirty` is false, so the user can't save the reset. **Fix:** Reset stages Aurora defaults live AND sets `isDirty = true` (user must Save to persist the reset).

### Pitfall 2: Leave-Revert Race
**What goes wrong:** User clicks Sidebar nav → App.tsx calls `setPage("dashboards")` → `BrandingSettingsPage` unmounts → `useEffect` cleanup runs **after** the page switch animation. The live `:root` shows the draft brand for a frame during the transition. **Fix:** Intercept at App.tsx `onSelect` BEFORE `setPage` — confirm dialog + revert + then `setPage`. This is synchronous and eliminates the race.

### Pitfall 3: BrandStyleInjector Overwritten by Draft
**What goes wrong:** `BrandStyleInjector` watches `brandStore.customCss` (the saved CSS) and writes `<style id="kbi-custom-css">`. The CSS editor's draft preview also writes to `kbi-custom-css` on every keystroke. Result: the draft preview gets overwritten by the saved CSS on the next render cycle. **Fix:** Draft preview writes to a separate element `kbi-brand-css-draft`; `BrandStyleInjector` owns `kbi-custom-css` only.

### Pitfall 4: accentTextColor Field Gap
**What goes wrong:** The CONTEXT.md specifies WCAG checking `--accent-text` on `--accent`. `--accent-text` is NOT currently a BrandConfigPayload field. Phase 83 checks contrast between a fixed value and the admin's chosen `--accent` — but the admin can't actually change `--accent-text` from the UI. **Fix:** Add `accentTextColor` / `lightAccentTextColor` to BrandConfigPayload and expose as two additional pickers (or auto-compute and show for info). Flag this in the plan.

### Pitfall 5: `@codemirror/lang-css` Import Path
**What goes wrong:** Developer writes `import { css } from "@codemirror/lang-css"` but the package isn't in `package.json` (only in `package-lock.json` as a transitive). TypeScript reports `Cannot find module`. **Fix:** `npm install @codemirror/lang-css` — adds to `package.json` even though it's already in lock. Zero version conflict since `lang-sql@6.10` and `lang-css@6.3` are both @codemirror v6.

### Pitfall 6: theme-guard Fails if BrandColorPicker not ALLOWLISTED Same Commit
**What goes wrong:** Plan 83-01 adds `BrandColorPicker.tsx` with default hex values but defers the ALLOWLIST entry to a later plan. CI theme-guard fails immediately. **Fix:** STATE.md locked rule — ALLOWLIST entries and their justification comments MUST be in the SAME commit that introduces the component.

---

## Code Examples

### HexColorPicker + immediate live apply
```tsx
// Source: react-colorful README + confirmed against DynamicViewsModal CodeMirror pattern
function BrandColorPicker({ label, value, onChange }: {
  label: string;
  value: string;
  onChange: (hex: string) => void;
}) {
  return (
    <div className="brand-color-picker">
      <label className="ds-field-label">{label}</label>
      <HexColorPicker color={value} onChange={onChange} />
      <span className="brand-color-hex">{value}</span>
    </div>
  );
}
```

### colord WCAG badge
```tsx
// Source: colord a11y plugin README
import { colord, extend } from "colord";
import a11yPlugin from "colord/plugins/a11y";
extend([a11yPlugin]);

function WcagBadge({ fg, bg }: { fg: string; bg: string }) {
  const ratio = colord(bg).contrast(fg);
  const pass  = ratio >= 4.5;
  return (
    <span className={pass ? "wcag-pass" : "wcag-fail"} title={`Contrast ratio ${ratio.toFixed(2)}:1`}>
      {ratio.toFixed(1)}:1 {pass ? "AA" : "FAIL"}
    </span>
  );
}
```

### applyBrandTokens call from draft edit handler
```ts
// Immediately reflect draft in :root — no network call, no store update
// (brandStore.update() is only called on Save)
function handleDraftChange(updates: Partial<BrandConfigPayload>) {
  const next = { ...draft, ...updates };
  setDraft(next);
  setIsDirty(true);
  applyBrandTokens(next, useThemeStore.getState().theme);
  // applyBrandTokens must be exported from brandStore.ts (currently module-private)
}
```

### CodeMirror CSS editor
```tsx
// Pattern from DynamicViewsModal.tsx lines 43-46, 797-857
import CodeMirror, { oneDark } from "@uiw/react-codemirror";
import { css } from "@codemirror/lang-css";

const editorTheme = useThemeStore((s) => s.theme) === "dark" ? oneDark : "light";
<CodeMirror
  value={draftCss}
  onChange={handleCssChange}
  extensions={[css()]}
  theme={editorTheme}
  minHeight="200px"
  maxHeight="500px"
/>
```

---

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| DOMPurify client-side CSS sanitization (STACK.md) | PostCSS AST server-side before storage (Phase 81, PITFALLS.md) | Phase 81 already ships the correct approach — do NOT re-implement client-side |
| `@scope (#root)` wrapping (was Open Decision 1) | UNSCOPED + page exemption (resolved in CONTEXT.md) | Phase 83 injects raw custom CSS; branding page is protected by page architecture, not scoping |
| Google Fonts CDN font list (STACK.md) | Self-hosted via @fontsource-variable (Phase 80) | Manrope + Space Grotesk already available locally; Phase 83 UI uses installed fonts |
| CSS sanitize at render time (ARCHITECTURE.md old pattern) | Sanitize at PUT save time; store sanitized; Phase 83 just reads returned value | "Stripped declarations" diff is simply `submitted !== returned.config.customCss` |

---

## Recommended Plan Breakdown

Refining the ROADMAP 4-plan stub:

### Plan 83-01: Scaffold + Colors + WCAG (Wave 1)
**Scope:** `BrandingSettingsPage.tsx` scaffolding, Sidebar nav entry (hide-don't-disable, `PERMISSIONS.BRANDING_MANAGE`), `BrandConfigPayload` extension (display-font + feel-levers + accentTextColor), `applyBrandTokens` extension, 16-picker color section, WCAG badges, `updateBrandConfig()` + `uploadBrandLogo()` client fns, primary logo slot, app name field, Save/Reset skeleton with dirty-tracking. Theme-guard ALLOWLIST entries. Add `--glow-opacity` to global.css. Add `revertToSaved()` action + export `applyBrandTokens` from brandStore.

**App.tsx change:** Add nav guard for `page === "settings"` leave-with-dirty. Add `"branding"` as a sub-page of settings OR expand settings routing to render `BrandingSettingsPage` when `page === "settings"`.

**Dependencies:** Phase 82 brandStore exists. Self-contained.
**Test gate:** web vitest 100%; theme-guard green; web tsc clean.

### Plan 83-02: Fonts + Feel Levers + Preview Card + Leave-Revert (Wave 2, depends on 83-01)
**Scope:** Font picker section (body + display), feel-lever controls (density/radius/glow/type-scale/motion), compact preview card component, leave-with-unsaved revert mechanism (App.tsx guard + `revertToSaved()`), BRANDUI-06 UI (second logo upload slot), Reset-to-defaults full implementation.

**Dependencies:** 83-01 (BrandConfigPayload extension, scaffold, dirty-tracking).
**Test gate:** web vitest 100%; tsc clean.

### Plan 83-03: Custom CSS Editor (Wave 2, parallel-safe with 83-02 after 83-01)
**Scope:** CodeMirror CSS editor with `@codemirror/lang-css`, debounced live injection via draft style element, stripped-declarations notice after Save, branding page exemption note, `@codemirror/lang-css` added to package.json.

**Dependencies:** 83-01 (scaffold, updateBrandConfig client fn).
**Note:** 83-02 and 83-03 are parallel-safe — no shared files except `BrandingSettingsPage.tsx` (which they both extend). Assign to separate executors only if the planner can avoid the merge conflict on that file. If single-executor: run sequentially 83-02 then 83-03.
**Test gate:** web vitest 100%; tsc clean.

### Plan 83-04: BRANDUI-06 Dark Logo Server + Client (Wave 3, after 83-01)
**Scope:** SERVER — `brand_config` schema adds `logo_dark_*` columns (SCHEMA_DDL + PRAGMA guards); `GET /api/branding` adds `logoDarkUrl`; `GET /api/branding/logo?variant=dark`; `POST /api/branding/logo` with `variant` field. CLIENT — `BrandingResponse.logoDarkUrl`, `BrandState.logoDarkUrl`, Sidebar theme-aware selection, FOUC script extension, logo upload UI second slot (may overlap with 83-02).

**Dependencies:** 83-01 (BrandingResponse type, uploadBrandLogo client fn already there).
**BOTH-stack:** server work first (DB migration + routes), then client wiring.
**Test gate:** server vitest SET-BASED + supertests BOTH auth modes for dark-logo routes; web vitest 100%; tsc clean both stacks.

**Wave summary:**
```
Wave 1: 83-01 (scaffold + colors + WCAG + payload extension + app nav guard)
Wave 2: 83-02 + 83-03 (parallel-safe if BrandingSettingsPage.tsx edited in separate sections)
Wave 3: 83-04 (BOTH-stack; server first, client follows in same plan)
```

---

## Open Questions / Risks for the Planner

1. **`accentTextColor` field omission from current BrandConfigPayload.** CONTEXT.md says WCAG check includes `--accent-text` on its background, but `--accent-text` is not currently a payload field. Plan 83-01 must add `accentTextColor` / `lightAccentTextColor` fields AND expose pickers. Recommend: add 2 fields to payload, add 2 pickers to the Color section (making 18 pickers total, not 16). Adjust section header accordingly.

2. **`--glow-opacity` token not in global.css.** The glow lever requires adding `--glow-opacity` to the body background radial-gradient in global.css. This is a Phase 83 change (1 line per glow stop in the body background rule, ~4 lines). Low risk but must be included in Plan 83-01.

3. **App.tsx routing + leave guard.** The navigation system is state-based (`setPage`), not React Router. The leave-with-unsaved guard must be implemented at the App.tsx `onSelect` intercept level, not via React Router `useBlocker`. The planner should assign the App.tsx guard change to Plan 83-01 (foundation plan).

4. **`applyBrandTokens` visibility.** Currently module-private in brandStore.ts. Phase 83 needs to call it from BrandingSettingsPage for immediate live preview without committing to the store. Options: (a) export it, (b) add a `previewDraft(config)` action to BrandState, (c) add `revertToSaved()` action (already needed for leave-revert) and let live preview call `brandStore.update()` with the draft (but `update()` also calls `notifyOtherTabs()` and writes localStorage — undesirable for drafts). **Recommended:** export `applyBrandTokens` as a named export from brandStore.ts; add `revertToSaved()` action for the leave-revert path.

5. **Settings page routing.** Currently `page === "settings"` renders `<div className="muted">Section coming soon.</div>`. Phase 83 replaces this with `<BrandingSettingsPage />`. If "Settings" should become a multi-page section (Branding + other settings), add a sub-page state variable. For Phase 83 scope: replace directly, one page.

6. **83-02 vs 83-04 logo UI overlap.** The BRANDUI-06 dark logo upload slot could be in Plan 83-02 (feel levers + UI work) or Plan 83-04 (BRANDUI-06 BOTH-stack). If 83-04 is executed separately, 83-02 should implement the primary logo slot only; 83-04 adds the dark-override slot. This avoids merging both plans into BrandingSettingsPage simultaneously.

7. **`--font-display` already in global.css.** `--font-display` exists and is used by `.modal-header h3`, `.page-header-title`, etc. It maps to `displayFontFamily` in the extended payload. No new token needed — just expose the field in the UI and call `set("--font-display", config.displayFontFamily)` in `applyBrandTokens`.

---

## Sources

### PRIMARY (HIGH confidence — direct codebase reads)

- `packages/web/src/store/brandStore.ts` — exact BrandState, BrandConfigPayload, applyBrandTokens body, update()/bootstrap() signatures, BroadcastChannel setup
- `packages/web/src/api/client.ts` lines 128-157 — BrandConfigPayload type, BrandingResponse type, fetchBranding() raw-fetch pattern
- `packages/web/src/styles/global.css` lines 1-100 — all :root tokens: --font-body, --font-display, --radius-*, --space-1/2/3/4/5/6/8/10, --duration-fast/base/slow, --text-base/sm/lg etc.
- `packages/web/src/styles/theme-guard.spec.ts` lines 37-55 — ALLOWLIST array, HEX_RE pattern, structural literal guard
- `packages/web/src/components/Sidebar.tsx` — nav array, hasPermission filter, logoUrl/logoDarkUrl wiring point
- `packages/web/src/App.tsx` — state-based Page routing, setPage, onSelect pattern, brandStore.bootstrap() call
- `packages/web/src/components/RolesPage.tsx` lines 40-144 — isDirty/saving pattern, window.confirm on selection change, handleSave
- `packages/web/src/components/DynamicViewsModal.tsx` lines 43-46, 797-857 — CodeMirror import pattern, editorTheme, extensions=[sql()], oneDark
- `packages/web/src/components/BrandStyleInjector.tsx` — textContent injection, kbi-custom-css element, customCss watch
- `packages/server/src/index.ts` lines 416-679 — GET/PUT /api/branding shapes, POST /api/branding/logo multer+validation path
- `packages/server/src/db.ts` lines 253-261 — brand_config SCHEMA_DDL, column names
- `packages/server/src/lib/brandCssSanitizer.ts` — sanitizeCssPostcss, blocked patterns, returns string
- `package-lock.json` — confirmed @codemirror/lang-css@6.3.1 already in lock (transitive); react-colorful + colord NOT yet installed
- `packages/web/package.json` — installed deps confirm react-colorful + colord absent, @uiw/react-codemirror@^4.25.9, @codemirror/lang-sql@^6.10.0

### SECONDARY (MEDIUM confidence — official docs via WebFetch)

- react-colorful README (github.com/omgovich/react-colorful) — `HexColorPicker` props: `color: string`, `onChange: (color: string) => void`, `onChangeEnd`. Confirmed React 18 compatible.
- colord a11y plugin README (github.com/omgovich/colord) — `extend([a11yPlugin])`, `.contrast(color2)` returns number 1–21, `.isReadable(color2, { level: "AA", size: "normal" })` returns boolean; AA normal = 4.5:1, AA large = 3.0:1.

### TERTIARY (LOW confidence — not separately verified)

- Density multiplier values in `applyDensityPreset` — derived from the 4px base rhythm in global.css; specific comfortable/spacious values are Claude's discretion per CONTEXT.md.
- Radius sharp/round preset values — derived from the existing Aurora radius scale (9/8/12/13px); sharp/round values are Claude's discretion.

---

## Metadata

**Confidence breakdown:**
- Standard stack (deps + versions): HIGH — lock file verified, no conflicts
- Architecture (routing, dirty-tracking, leave-revert): HIGH — direct App.tsx/RolesPage reads
- brandStore extension spec: HIGH — direct brandStore.ts read; feel-lever token names verified against global.css
- Color picker + WCAG APIs: HIGH — WebFetch official READMEs
- BRANDUI-06 server slice: HIGH — direct db.ts + index.ts reads
- Feel-lever preset values: MEDIUM — base rhythm confirmed; multiplier values are discretionary
- Font strategy: HIGH — global.css tokens confirmed; @fontsource-variable packages confirmed installed

**Research date:** 2026-06-25
**Valid until:** 2026-07-25 (stable libraries; brandStore shape could change if Phase 82 commits land before Phase 83 planning)
