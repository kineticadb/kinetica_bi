/**
 * lib/basemaps — basemap registry, per-theme default CSS, style presets, and
 * CARTO API-key wiring.
 *
 * Covers:
 *   1. Registry shape — one key-less OSM entry + the two CARTO entries
 *   2. Per-theme defaults are OSM (no key needed out of the box)
 *   3. basemapDefFor: known / unknown / legacy / undefined ids
 *   4. basemapDefaultCssFor / resolveBasemapCss / parseBasemapCss / basemapCssVars
 *   5. BASEMAP_CSS_PRESETS + matchBasemapCssPreset (the one-click style buttons)
 *   6. basemapTileUrl: OSM → undefined; CARTO → key appended only when supplied
 *   7. cartoApiKey / cartoApiKeyParam / isCartoKeyConfigured env reads
 *   8. basemapPickerLabel flags CARTO entries while no key is configured
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import {
  BASEMAPS,
  BASEMAP_LAYER_CLASS,
  BASEMAP_CSS_PRESETS,
  DEFAULT_BASEMAP_LIGHT,
  DEFAULT_BASEMAP_DARK,
  DARK_BASEMAP_CSS,
  LIGHT_GRAY_BASEMAP_CSS,
  NO_FILTER_BASEMAP_CSS,
  SUPPORTED_CSS_PROPERTIES,
  basemapDefFor,
  basemapDefaultCssFor,
  resolveBasemapCss,
  parseBasemapCss,
  basemapCssVars,
  basemapCssVarName,
  matchBasemapCssPreset,
  basemapTileUrl,
  basemapPickerLabel,
  cartoApiKey,
  cartoApiKeyParam,
  isCartoKeyConfigured,
} from "./basemaps";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("basemap registry", () => {
  it("exposes ONE key-less OSM entry plus the two CARTO entries", () => {
    expect(BASEMAPS.map((b) => b.id)).toEqual(["osm", "voyager", "dark"]);
    const osm = BASEMAPS.filter((b) => b.provider === "osm");
    expect(osm).toHaveLength(1);
    expect(osm[0].requiresApiKey).toBe(false);
    expect(osm[0].label).toBe("OpenStreetMap");
    expect(BASEMAPS.filter((b) => b.provider === "carto").every((b) => b.requiresApiKey)).toBe(true);
  });

  it("gives the single OSM entry a per-theme default CSS — plain light, dark dark", () => {
    const osm = basemapDefFor("osm");
    expect(osm.url).toBeUndefined();
    expect(osm.defaultCss.light).toBe("");
    expect(osm.defaultCss.dark).toBe(DARK_BASEMAP_CSS);
  });

  it("leaves the CARTO entries unstyled in both themes (already cartographed per theme)", () => {
    for (const id of ["voyager", "dark"]) {
      expect(basemapDefFor(id).defaultCss).toEqual({ light: "", dark: "" });
    }
  });

  it("defaults both app themes to the single OSM entry", () => {
    expect(DEFAULT_BASEMAP_LIGHT).toBe("osm");
    expect(DEFAULT_BASEMAP_DARK).toBe("osm");
    expect(basemapDefFor(DEFAULT_BASEMAP_LIGHT).requiresApiKey).toBe(false);
    expect(basemapDefFor(DEFAULT_BASEMAP_DARK).requiresApiKey).toBe(false);
  });

  it("names the OL container class used as the CSS-filter hook", () => {
    expect(BASEMAP_LAYER_CLASS).toBe("map-basemap-layer");
  });
});

describe("basemapDefFor", () => {
  it("resolves every registry id", () => {
    for (const b of BASEMAPS) {
      expect(basemapDefFor(b.id).id).toBe(b.id);
    }
  });

  it("falls back to the light default for unknown and undefined ids", () => {
    expect(basemapDefFor(undefined).id).toBe(DEFAULT_BASEMAP_LIGHT);
    expect(basemapDefFor("").id).toBe(DEFAULT_BASEMAP_LIGHT);
    expect(basemapDefFor("no-such-basemap").id).toBe(DEFAULT_BASEMAP_LIGHT);
  });

  it("degrades the retired osm-dark id to OSM, which is dark-filtered in dark mode anyway", () => {
    expect(basemapDefFor("osm-dark").id).toBe("osm");
    expect(basemapDefaultCssFor("osm-dark", "dark")).toBe(DARK_BASEMAP_CSS);
  });

  it("still resolves the legacy CARTO ids stored on existing widgets", () => {
    expect(basemapDefFor("voyager").provider).toBe("carto");
    expect(basemapDefFor("dark").provider).toBe("carto");
  });
});

describe("basemapDefaultCssFor", () => {
  it("returns the dark filter CSS only for OSM in dark mode", () => {
    expect(basemapDefaultCssFor("osm", "light")).toBe("");
    expect(basemapDefaultCssFor("osm", "dark")).toBe(DARK_BASEMAP_CSS);
    expect(basemapDefaultCssFor("voyager", "dark")).toBe("");
    expect(basemapDefaultCssFor("dark", "dark")).toBe("");
  });

  it("returns the light default's CSS for unknown ids", () => {
    expect(basemapDefaultCssFor("nope", "light")).toBe("");
    expect(basemapDefaultCssFor(undefined, "light")).toBe("");
  });

  it("ships a dark default that is a parseable filter declaration", () => {
    expect(parseBasemapCss(DARK_BASEMAP_CSS).filter).toContain("grayscale");
  });
});

describe("resolveBasemapCss", () => {
  it("prefers an operator override over the theme default", () => {
    expect(resolveBasemapCss("osm", "dark", "filter: sepia(1);")).toBe("filter: sepia(1);");
    expect(resolveBasemapCss("osm", "light", "opacity: 0.5;")).toBe("opacity: 0.5;");
  });

  it("falls back to the theme default when the override is absent or blank", () => {
    expect(resolveBasemapCss("osm", "dark", undefined)).toBe(DARK_BASEMAP_CSS);
    expect(resolveBasemapCss("osm", "dark", "")).toBe(DARK_BASEMAP_CSS);
    expect(resolveBasemapCss("osm", "dark", "   \n  ")).toBe(DARK_BASEMAP_CSS);
    expect(resolveBasemapCss("osm", "light", undefined)).toBe("");
  });

  it("lets `filter: none` override the dark default (blank would not)", () => {
    expect(resolveBasemapCss("osm", "dark", NO_FILTER_BASEMAP_CSS)).toBe(NO_FILTER_BASEMAP_CSS);
    expect(parseBasemapCss(resolveBasemapCss("osm", "dark", NO_FILTER_BASEMAP_CSS)).filter).toBe(
      "none",
    );
  });
});

describe("parseBasemapCss", () => {
  it("parses the supported declarations, with or without a trailing semicolon", () => {
    expect(parseBasemapCss("filter: grayscale(1); opacity: 0.6;")).toEqual({
      filter: "grayscale(1)",
      opacity: "0.6",
    });
    expect(parseBasemapCss("filter: invert(1)")).toEqual({ filter: "invert(1)" });
  });

  it("is tolerant of comments, blank declarations, casing and stray whitespace", () => {
    expect(parseBasemapCss("/* tuned for dark */  FILTER :  sepia(0.4) ;;  ")).toEqual({
      filter: "sepia(0.4)",
    });
  });

  it("returns nothing for empty, undefined or valueless input", () => {
    expect(parseBasemapCss(undefined)).toEqual({});
    expect(parseBasemapCss("")).toEqual({});
    expect(parseBasemapCss("filter:")).toEqual({});
    expect(parseBasemapCss("not-css-at-all")).toEqual({});
  });

  it("drops properties outside the supported allow-list", () => {
    expect(parseBasemapCss("background: red; display: none; filter: blur(2px);")).toEqual({
      filter: "blur(2px)",
    });
    expect(SUPPORTED_CSS_PROPERTIES).toEqual(["filter", "opacity"]);
  });

  it("rejects url() values so operator CSS cannot reach the network", () => {
    expect(parseBasemapCss('filter: url("https://example.test/f.svg#x");')).toEqual({});
    expect(parseBasemapCss("filter: URL(#local);")).toEqual({});
  });

  it("rejects declarations carrying braces (malformed / breakout-shaped input)", () => {
    expect(parseBasemapCss("filter: none } body { display: none;")).toEqual({});
  });
});

describe("basemapCssVars", () => {
  it("maps supported declarations onto the custom properties global.css reads", () => {
    expect(basemapCssVars("filter: grayscale(1); opacity: 0.5;")).toEqual({
      "--basemap-filter": "grayscale(1)",
      "--basemap-opacity": "0.5",
    });
  });

  it("omits absent properties so the stylesheet var() fallback applies", () => {
    expect(basemapCssVars("opacity: 0.25;")).toEqual({ "--basemap-opacity": "0.25" });
    expect(basemapCssVars("")).toEqual({});
    expect(basemapCssVars(undefined)).toEqual({});
    expect(basemapCssVars("background: red;")).toEqual({});
  });

  it("names custom properties consistently with basemapCssVarName", () => {
    expect(basemapCssVarName("filter")).toBe("--basemap-filter");
    expect(basemapCssVarName("opacity")).toBe("--basemap-opacity");
    expect(Object.keys(basemapCssVars(DARK_BASEMAP_CSS))).toEqual(["--basemap-filter"]);
  });
});

describe("basemap CSS presets", () => {
  it("offers Dark map / Light Gray Map / None with the documented filters", () => {
    expect(BASEMAP_CSS_PRESETS.map((p) => p.id)).toEqual(["dark-map", "light-gray-map", "none"]);
    expect(BASEMAP_CSS_PRESETS.map((p) => p.label)).toEqual([
      "Dark map",
      "Light Gray Map",
      "None",
    ]);
    expect(DARK_BASEMAP_CSS).toBe(
      "filter: grayscale(0.9) invert(1) brightness(0.95) contrast(0.85);",
    );
    expect(LIGHT_GRAY_BASEMAP_CSS).toBe("filter: grayscale(0.9) brightness(0.95) contrast(0.85);");
    expect(NO_FILTER_BASEMAP_CSS).toBe("filter: none;");
  });

  it("Light Gray Map is Dark map without the inversion", () => {
    expect(LIGHT_GRAY_BASEMAP_CSS).not.toContain("invert");
    expect(DARK_BASEMAP_CSS).toContain("invert(1)");
  });

  it("every preset parses to a filter the renderer can apply", () => {
    for (const preset of BASEMAP_CSS_PRESETS) {
      expect(basemapCssVars(preset.css)["--basemap-filter"]).toBeTruthy();
    }
  });

  it("the Dark map preset IS OSM's dark-theme default", () => {
    expect(BASEMAP_CSS_PRESETS[0].css).toBe(basemapDefaultCssFor("osm", "dark"));
  });
});

describe("matchBasemapCssPreset", () => {
  it("matches each preset's own CSS", () => {
    for (const preset of BASEMAP_CSS_PRESETS) {
      expect(matchBasemapCssPreset(preset.css)?.id).toBe(preset.id);
    }
  });

  it("matches regardless of formatting", () => {
    expect(matchBasemapCssPreset("filter:none")?.id).toBe("none");
    expect(
      matchBasemapCssPreset("FILTER:  GRAYSCALE(0.9)   BRIGHTNESS(0.95) CONTRAST(0.85) ;")?.id,
    ).toBe("light-gray-map");
  });

  it("treats CSS that applies nothing as None — the basemap does render unfiltered", () => {
    expect(matchBasemapCssPreset("")?.id).toBe("none");
    expect(matchBasemapCssPreset(undefined)?.id).toBe("none");
    expect(matchBasemapCssPreset("background: red;")?.id).toBe("none");
  });

  it("selects nothing for hand-written CSS outside the presets", () => {
    expect(matchBasemapCssPreset("filter: sepia(1);")).toBeNull();
    expect(matchBasemapCssPreset("opacity: 0.5;")).toBeNull();
    // A preset plus an extra declaration is no longer that preset.
    expect(matchBasemapCssPreset(DARK_BASEMAP_CSS + " opacity: 0.5;")).toBeNull();
  });

  it("resolves a blank override to the theme default — Dark map in dark, None in light", () => {
    // The panel matches on the EFFECTIVE css, which is what the field shows.
    expect(matchBasemapCssPreset(resolveBasemapCss("osm", "dark", undefined))?.id).toBe("dark-map");
    expect(matchBasemapCssPreset(resolveBasemapCss("osm", "light", undefined))?.id).toBe("none");
  });
});

describe("basemapTileUrl", () => {
  it("returns undefined for the OSM entry — OL owns that URL", () => {
    expect(basemapTileUrl(basemapDefFor("osm"), "k")).toBeUndefined();
  });

  it("returns the bare CARTO URL when no key is configured", () => {
    const url = basemapTileUrl(basemapDefFor("voyager"), null);
    expect(url).toBe("https://{a-c}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png");
    expect(url).not.toContain("api_key");
  });

  it("appends the key under the default api_key param", () => {
    expect(basemapTileUrl(basemapDefFor("dark"), "abc123")).toBe(
      "https://{a-c}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png?api_key=abc123",
    );
  });

  it("honours an overridden param name and url-encodes both parts", () => {
    expect(basemapTileUrl(basemapDefFor("dark"), "a b&c", "key")).toBe(
      "https://{a-c}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png?key=a%20b%26c",
    );
  });

  it("uses & when the template already carries a query string", () => {
    const def = { ...basemapDefFor("dark"), url: "https://x/{z}/{x}/{y}.png?scale=2" };
    expect(basemapTileUrl(def, "k")).toBe("https://x/{z}/{x}/{y}.png?scale=2&api_key=k");
  });
});

describe("CARTO key env reads", () => {
  it("reports no key by default", () => {
    vi.stubEnv("VITE_CARTO_API_KEY", "");
    expect(cartoApiKey()).toBeNull();
    expect(isCartoKeyConfigured()).toBe(false);
  });

  it("reads and trims a configured key", () => {
    vi.stubEnv("VITE_CARTO_API_KEY", "  abc123  ");
    expect(cartoApiKey()).toBe("abc123");
    expect(isCartoKeyConfigured()).toBe(true);
  });

  it("treats a whitespace-only key as unset", () => {
    vi.stubEnv("VITE_CARTO_API_KEY", "   ");
    expect(cartoApiKey()).toBeNull();
    expect(isCartoKeyConfigured()).toBe(false);
  });

  it("defaults the param name to api_key and allows an env override", () => {
    vi.stubEnv("VITE_CARTO_API_KEY_PARAM", "");
    expect(cartoApiKeyParam()).toBe("api_key");
    vi.stubEnv("VITE_CARTO_API_KEY_PARAM", "key");
    expect(cartoApiKeyParam()).toBe("key");
  });
});

describe("basemapPickerLabel", () => {
  it("flags CARTO entries only while no key is configured", () => {
    expect(basemapPickerLabel(basemapDefFor("voyager"), false)).toBe(
      "CartoDB Voyager (API key required)",
    );
    expect(basemapPickerLabel(basemapDefFor("voyager"), true)).toBe("CartoDB Voyager");
  });

  it("never flags the key-less OSM entry", () => {
    expect(basemapPickerLabel(basemapDefFor("osm"), false)).toBe("OpenStreetMap");
  });
});
