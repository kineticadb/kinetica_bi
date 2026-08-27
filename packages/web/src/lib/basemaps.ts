/**
 * Basemap registry — the single source of truth for the map widget's base layers.
 *
 * Consumed by BOTH map surfaces so they can't drift:
 *   - MapChartRenderer.basemapSourceFor  → builds the OL source (+ API key)
 *   - MapConfigPanel                     → the light/dark basemap pickers
 *
 * ── Per-basemap CSS ────────────────────────────────────────────────────────
 * Each entry carries its own `defaultCss` — one CSS declaration block PER APP
 * THEME ("" = raw provider tiles, unstyled). MapChartRenderer passes
 * `className: BASEMAP_LAYER_CLASS` to the base TileLayer, which makes OL render
 * that layer into its OWN canvas container (ol/layer/Base `className` option)
 * instead of the shared canvas. global.css styles that container from CSS
 * custom properties, which the renderer sets on the widget's canvas wrapper — so
 * the declarations recolour ONLY the basemap, never the WMS data layers, drawn
 * shapes, or controls stacked above it.
 *
 * The operator can override the CSS per widget AND per theme
 * (`basemapCssLight` / `basemapCssDark` on the widget config); an absent or
 * blank override means "track that theme's default". Declarations are
 * allow-listed to `filter` and `opacity` (see SUPPORTED_CSS_PROPERTIES) and
 * forwarded as custom-property values, so operator CSS cannot escape the
 * basemap or reach the network.
 *
 * Do NOT mutate the layer container's own class list at runtime: OL reuses a
 * container only while `target.className === layer.getClassName()`
 * (ol/renderer/canvas/Layer.js useContainer), so an added class would make OL
 * throw the container away on the next frame. Styling hangs off OUR wrapper.
 *
 * ── CARTO API key (2026-08) ────────────────────────────────────────────────
 * basemaps.cartocdn.com now watermarks unauthenticated tiles ("API KEY
 * REQUIRED") and its raster PNG service is being retired in favour of vector.
 * A key is free within CARTO's fair-use limit (request at
 * carto.com/basemaps/apikey). Supply it via VITE_CARTO_API_KEY and it is
 * appended to CARTO tile URLs; without it the CARTO entries still work but
 * render watermarked, which is why the defaults are now OSM.
 */

export type BasemapId = "osm" | "voyager" | "dark";

/** App themes the map styles per — mirrors store/theme.ts's Theme. */
export type BasemapTheme = "light" | "dark";

/** A basemap's default CSS, one declaration block per app theme. */
export interface BasemapDefaultCss {
  light: string;
  dark: string;
}

export interface BasemapDef {
  id: BasemapId;
  /** Operator-facing label in the config panel's basemap pickers. */
  label: string;
  /** "osm" → ol/source/OSM (OL owns the URL, no key). "carto" → ol/source/XYZ at `url`. */
  provider: "osm" | "carto";
  /** XYZ tile template — set for provider "carto" only. */
  url?: string;
  /** Attribution HTML. Omitted for OSM so OL's built-in OSM attribution stands. */
  attributions?: string;
  /**
   * This basemap's default CSS PER APP THEME — the declaration block applied to
   * the isolated basemap canvas, and the value pre-filled into that theme's CSS
   * override field. "" = unstyled (raw provider tiles).
   *
   * Per-theme because one basemap serves both themes: plain OSM renders raw in
   * light mode and dark-filtered in dark mode. The CARTO basemaps are already
   * cartographed per theme, so they default to unstyled in both.
   */
  defaultCss: BasemapDefaultCss;
  /** True when the provider watermarks tiles unless a key is configured. */
  requiresApiKey: boolean;
}

const CARTO_ATTRIBUTION =
  "© <a href='https://carto.com/attributions'>CARTO</a> © <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap contributors</a>";

/**
 * Default CSS for the dark OSM entry — turns the free OSM raster into a
 * dark/near-greyscale base suited to the dark app theme (the CARTO Dark Matter
 * replacement). Also the value pre-filled into the dark-mode CSS field, so the
 * operator can tune it per widget.
 */
export const DARK_BASEMAP_CSS =
  "filter: grayscale(0.9) invert(1) brightness(0.95) contrast(0.85);";

/**
 * Light-gray preset — the same tone flattening as DARK_BASEMAP_CSS without the
 * inversion, i.e. a light grey basemap rather than a dark one.
 */
export const LIGHT_GRAY_BASEMAP_CSS = "filter: grayscale(0.9) brightness(0.95) contrast(0.85);";

/**
 * Explicitly unfiltered. NOT the same as a blank field: blank means "track the
 * selected basemap's default", so a dark basemap needs `filter: none` to render
 * raw provider tiles.
 */
export const NO_FILTER_BASEMAP_CSS = "filter: none;";

/**
 * One-click styles offered under each basemap CSS field, so an operator can
 * switch look without writing CSS. Selecting one writes its `css` into the
 * field — the text stays editable afterwards for fine-tuning.
 */
export interface BasemapCssPreset {
  id: "dark-map" | "light-gray-map" | "none";
  label: string;
  css: string;
}

export const BASEMAP_CSS_PRESETS: readonly BasemapCssPreset[] = [
  { id: "dark-map", label: "Dark map", css: DARK_BASEMAP_CSS },
  { id: "light-gray-map", label: "Light Gray Map", css: LIGHT_GRAY_BASEMAP_CSS },
  { id: "none", label: "None", css: NO_FILTER_BASEMAP_CSS },
] as const;

/** Class OL puts on the base layer's own canvas container (the CSS-filter hook). */
export const BASEMAP_LAYER_CLASS = "map-basemap-layer";

/**
 * Registry order = picker order. One free, key-less OSM entry — its look is a
 * per-theme CSS concern (default CSS + the operator's override), not a second
 * basemap.
 */
export const BASEMAPS: readonly BasemapDef[] = [
  {
    id: "osm",
    label: "OpenStreetMap",
    provider: "osm",
    defaultCss: { light: "", dark: DARK_BASEMAP_CSS },
    requiresApiKey: false,
  },
  {
    id: "voyager",
    label: "CartoDB Voyager",
    provider: "carto",
    url: "https://{a-c}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png",
    attributions: CARTO_ATTRIBUTION,
    defaultCss: { light: "", dark: "" },
    requiresApiKey: true,
  },
  {
    id: "dark",
    label: "CartoDB Dark Matter",
    provider: "carto",
    url: "https://{a-c}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
    attributions: CARTO_ATTRIBUTION,
    defaultCss: { light: "", dark: "" },
    requiresApiKey: true,
  },
] as const;

/**
 * Per-theme defaults for NEW map widgets (and for configs with no basemap at
 * all). Both themes use the single OSM entry — the dark look comes from that
 * entry's dark defaultCss, not from a separate basemap.
 */
export const DEFAULT_BASEMAP_LIGHT: BasemapId = "osm";
export const DEFAULT_BASEMAP_DARK: BasemapId = "osm";

/**
 * Resolve a (possibly unknown / legacy / undefined) basemap id to a definition.
 * Unknown ids fall back to the light default rather than rendering nothing.
 */
export function basemapDefFor(id: string | undefined): BasemapDef {
  return (
    BASEMAPS.find((b) => b.id === id) ??
    (BASEMAPS.find((b) => b.id === DEFAULT_BASEMAP_LIGHT) as BasemapDef)
  );
}

/** The selected basemap's default CSS for one app theme ("" = unstyled). */
export function basemapDefaultCssFor(id: string | undefined, theme: BasemapTheme): string {
  return basemapDefFor(id).defaultCss[theme];
}

/**
 * CSS properties an operator may set on the basemap. Deliberately narrow: these
 * are the two that meaningfully restyle a raster basemap, and global.css consumes
 * each as a `var()` so a bad value degrades to the property's initial value
 * instead of breaking the map.
 */
export const SUPPORTED_CSS_PROPERTIES = ["filter", "opacity"] as const;
export type SupportedCssProperty = (typeof SUPPORTED_CSS_PROPERTIES)[number];

/** Custom-property name global.css reads for a supported declaration. */
export function basemapCssVarName(prop: SupportedCssProperty): string {
  return `--basemap-${prop}`;
}

/**
 * Resolve the CSS to apply for one app theme: the operator's override for that
 * theme when it has content, else the basemap's default for that theme. A blank
 * override means "track the default" — to render an unfiltered basemap in dark
 * mode, write `filter: none;` rather than clearing the field.
 */
export function resolveBasemapCss(
  basemapId: string | undefined,
  theme: BasemapTheme,
  override: string | undefined,
): string {
  return override && override.trim() !== ""
    ? override
    : basemapDefaultCssFor(basemapId, theme);
}

/**
 * Parse a CSS declaration block into the supported subset.
 *
 * Tolerant of missing trailing semicolons, comments and blank declarations;
 * silently drops anything outside SUPPORTED_CSS_PROPERTIES. Values containing
 * `{`, `}` or `url(` are rejected — the first two can only come from malformed
 * input, and blocking `url()` keeps operator-authored CSS from issuing network
 * requests (an external SVG filter reference).
 */
export function parseBasemapCss(
  css: string | undefined,
): Partial<Record<SupportedCssProperty, string>> {
  const out: Partial<Record<SupportedCssProperty, string>> = {};
  if (!css) return out;
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, " ");
  for (const decl of withoutComments.split(";")) {
    const colon = decl.indexOf(":");
    if (colon === -1) continue;
    const prop = decl.slice(0, colon).trim().toLowerCase();
    const value = decl.slice(colon + 1).trim();
    if (!value) continue;
    if (/[{}]/.test(prop) || /[{}]/.test(value)) continue;
    if (/url\s*\(/i.test(value)) continue;
    if (!(SUPPORTED_CSS_PROPERTIES as readonly string[]).includes(prop)) continue;
    out[prop as SupportedCssProperty] = value;
  }
  return out;
}

/**
 * Custom-property map for the map canvas wrapper — the applied form of a CSS
 * declaration block. Absent properties fall back to global.css's `var()`
 * defaults (no filter, full opacity).
 */
export function basemapCssVars(css: string | undefined): Record<string, string> {
  const parsed = parseBasemapCss(css);
  const vars: Record<string, string> = {};
  for (const prop of SUPPORTED_CSS_PROPERTIES) {
    const value = parsed[prop];
    if (value !== undefined) vars[basemapCssVarName(prop)] = value;
  }
  return vars;
}

/**
 * Env-configured CARTO API key, or null when unset/blank.
 * Read lazily (not at module scope) so tests can stub the env per case.
 */
export function cartoApiKey(): string | null {
  const raw = import.meta.env.VITE_CARTO_API_KEY as string | undefined;
  return typeof raw === "string" && raw.trim() !== "" ? raw.trim() : null;
}

/**
 * Query-parameter name the key is passed under. Overridable via
 * VITE_CARTO_API_KEY_PARAM because CARTO's docs have shown both `api_key` and
 * `key` — this way a mismatch is a deploy-config fix, not a code change.
 */
export function cartoApiKeyParam(): string {
  const raw = import.meta.env.VITE_CARTO_API_KEY_PARAM as string | undefined;
  return typeof raw === "string" && raw.trim() !== "" ? raw.trim() : "api_key";
}

/** True when a CARTO key is configured — CARTO basemaps render unwatermarked. */
export function isCartoKeyConfigured(): boolean {
  return cartoApiKey() !== null;
}

/**
 * Tile URL for a basemap, with the API key appended when the provider needs one
 * and a key is supplied. Returns undefined for OSM (OL owns that URL).
 * Pure — the key/param are passed in, so this is unit-testable without env stubs.
 */
export function basemapTileUrl(
  def: BasemapDef,
  apiKey: string | null,
  keyParam: string = "api_key",
): string | undefined {
  if (!def.url) return undefined;
  if (!def.requiresApiKey || !apiKey) return def.url;
  const sep = def.url.includes("?") ? "&" : "?";
  return `${def.url}${sep}${encodeURIComponent(keyParam)}=${encodeURIComponent(apiKey)}`;
}

/**
 * Which preset (if any) a CSS block currently represents — drives the selected
 * state of the preset buttons. Compared on the PARSED declarations, so
 * formatting differences (`filter:none`, extra spaces, a stray unsupported
 * property) still match.
 *
 * CSS that applies nothing at all — blank, or only unsupported declarations —
 * matches "None", because the basemap does render unfiltered in that case. The
 * caller passes the EFFECTIVE css (override ?? theme default), so a blank
 * override in dark mode resolves to the dark default and matches "Dark map"
 * rather than "None".
 */
export function matchBasemapCssPreset(css: string | undefined): BasemapCssPreset | null {
  const normalize = (input: string | undefined): string => {
    const parsed = parseBasemapCss(input);
    const entries = Object.entries(parsed)
      .map(([k, v]) => [k, v.replace(/\s+/g, " ").trim().toLowerCase()])
      .sort(([a], [b]) => a.localeCompare(b));
    return JSON.stringify(entries);
  };
  const target = normalize(css);
  const none = BASEMAP_CSS_PRESETS.find((p) => p.id === "none") as BasemapCssPreset;
  // Nothing applied → unfiltered, which is what "None" means.
  if (target === normalize("")) return none;
  return BASEMAP_CSS_PRESETS.find((p) => normalize(p.css) === target) ?? null;
}

/**
 * Picker label — flags CARTO entries as needing a key when none is configured,
 * so the operator isn't left guessing why a chosen basemap is watermarked.
 */
export function basemapPickerLabel(def: BasemapDef, keyConfigured: boolean): string {
  return def.requiresApiKey && !keyConfigured ? `${def.label} (API key required)` : def.label;
}
