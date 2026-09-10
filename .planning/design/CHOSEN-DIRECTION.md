# v1.16 Chosen Design Direction — "Aurora" (Kinetica)

**Locked:** 2026-06-23 (operator-approved after live mockup iteration)
**Mockup:** `.planning/design/direction-A-aurora.html` (open in a browser)

The default Kinetica theme + the seed for the design-token system. Customers re-skin the **brandable** token layer on top; the **structural** personality (layout, depth, motion, component anatomy) stays fixed so re-skins still look characterful, not cookie-cutter.

## Identity
- **Personality:** atmospheric, premium, glassmorphic — a polished command center.
- **Brand color:** Kinetica violet **`#7f40ed`** (exact, from kinetica.com). **NVIDIA green is explicitly avoided.**
- **Wordmark:** lowercase **"kinetica"** + a stacked-bars mark echoing the logo's "e" glyph.
- **Background:** near-black `#0a0a12` + faint **hexagon mesh** (website motif) + **aurora glows** (violet / blue / magenta radial washes).
- **Type:** Manrope (body) + Space Grotesk (display).
- **Density:** **Compact** by default (small type, tight spacing — more widgets per screen).

## Token baseline (dark mode) — as validated in the mockup
| Token | Value | Role |
|---|---|---|
| `--bg` | `#0a0a12` | app background (+ hex mesh + aurora glows) |
| `--panel` | `rgba(24,22,40,0.55)` | glass card/panel |
| `--accent` | `#7f40ed` | **FILLS**: buttons, logo bars, swatches, borders, focus rings |
| `--accent-text` | `#c4b5fd` | **accent TEXT/numbers/icons on dark** (readable) — *two-tier accent* |
| `--accent-deep` | `#7c3aed` | button gradient end (keeps white text readable) |
| `--accent-2` | `#38bdf8` | cool-blue secondary / chart series contrast |
| `--on-accent` | `#ffffff` | text on accent fills |
| `--text` | `#ece9f6` | primary text |
| `--muted` | `#9b95b8` | secondary text |
| `--border` | `rgba(255,255,255,0.08)` | hairlines |
| `--danger` | `#fb7185` | error/destructive |

**Type scale (compact):** 2xs 9 · xs 10 · sm 11 · base **12** · lg 14 · 2xl 21 (px).
**Weights:** 400/500/600/700. **Radius:** `--radius` 13 / sm 9. **Spacing:** 4px rhythm, tight (grid gap 8, card pad 10–11, content pad 11). **Controls:** buttons/inputs ~6px pad · 10px text. **Motion:** ~200ms, `cubic-bezier(.2,.7,.2,1)`. **Sidebar** 212px.

## KEY DESIGN-SYSTEM RULE (learned during iteration)
**Two-tier accent.** A saturated brand color is for *fills*, NOT *text*. Accent-colored text/numbers/icons on dark must use a **lighter** variant (`--accent-text`); on light mode they use a **darker** variant. The WCAG-contrast guardrails enforce this. (Caught live: `#7f40ed` numbers were unreadable on the dark bg.)

## Still to derive when building the default theme
- **Light-mode palette** from `#7f40ed` (incl. a *darker* `--accent-text` for light).
- Full structural scales formalized: spacing `--space-*`, radius `--radius-*`, elevation `--shadow-sm/md/lg`, motion `--duration-*`/`--ease-*`, type ramp + weights + leading + tracking.
- Chart (recharts) + map (OpenLayers) palette integration (series stay visually distinct; not just brand-tinted).

## Brandable vs structural (for the admin UI)
- **Brandable (customer-overridable):** colors (light+dark, incl. the two-tier accent), fonts (body+display), radius, density (Compact/Comfortable/Spacious), glow on/off, + coarse controls for type-scale (base+ratio), spacing density, motion speed.
- **Structural (Kinetica-fixed, overridable only via custom CSS):** layout, component anatomy, the hex-mesh + glow treatment, motion personality.
