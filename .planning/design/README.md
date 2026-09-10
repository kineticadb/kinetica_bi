# v1.16 — Design Direction Exploration

Three distinct visual directions for Kinetica. **Same content** (topbar, sidebar, KPI + bar-chart + data-filter cards, buttons/inputs/checkbox/chips) so you compare *design language*, not layout. Each is built on CSS custom properties — **whichever you pick becomes the token system + default theme** for the milestone.

Open all three in a browser:

```
open .planning/design/direction-A-aurora.html \
     .planning/design/direction-B-editorial.html \
     .planning/design/direction-C-engineered.html
```

(Fonts load from Google Fonts, so view online.)

---

## A — "Aurora"  · atmospheric · glassmorphic · glowing
Evolves today's identity, taken premium: deep-space navy, brighter emerald + sky aurora glows, **frosted-glass panels** (backdrop-blur), soft layered glow depth, **generous 18px rounding**, Manrope + Space Grotesk. Gradient-text KPIs.
- **Personality:** modern, premium, futuristic command center.
- **Pros:** closest to current → lowest migration risk; very "premium SaaS"; brands beautifully (glow + accent are tokens).
- **Cons:** dark-glass dashboards are increasingly common — distinctive but not the *boldest* choice.

## B — "Editorial"  · Swiss · high-contrast · typographic
A **data instrument**, not a glossy app. Warm paper, **ink hairlines as structure**, a single decisive vermillion accent, near-flat surfaces, **tight 4px geometry**, hard offset shadows, Archivo display + Inter + IBM Plex Mono numerals.
- **Personality:** precise, confident, editorial — Bloomberg × Swiss design.
- **Pros:** the most *unlike* a generic SaaS app; ages well; numbers feel authoritative; light-first stands out.
- **Cons:** opinionated; the hard-shadow/ink-rule style is a strong stance; biggest departure from today.

## C — "Engineered"  · technical · GPU control-room
Leans into Kinetica's **GPU-accelerated** identity: graphite base with a **blueprint grid texture**, cyan + lime *signal* accents, **monospace data labels**, status dots, crisp 6px geometry, scanline-ish depth. Sora display + Chivo Mono.
- **Personality:** technical, high-performance "engine room" — on-brand for a GPU database.
- **Pros:** unmistakably Kinetica/technical; distinctive without relying on glass; mono numerals read as precise/fast.
- **Cons:** the "technical" aesthetic can feel niche to non-engineer analysts if overdone.

---

## How to decide
- Pick the **personality** that fits Kinetica's positioning (premium / editorial / technical).
- You can also say "**A, but** …" — e.g. *A's glass with B's mono numerals*, or *C's grid texture on A's palette*. The final theme is ours to compose.
- Whatever you pick → it defines the **default Kinetica theme**; customers then re-skin the **brandable token layer** (colors L+D, fonts, radius, density, glow) on top, while the **structural personality stays** (so re-skins still look characterful, not generic).

After you choose, I'll capture the direction into the milestone and move to requirements → roadmap.
