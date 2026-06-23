// Frontend test setup. Loaded by vitest via setupFiles in vitest.config.ts.
// Loads jest-dom matchers, runs RTL cleanup between tests, clears storage.

import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

// ── CSS custom-property stub for jsdom ──────────────────────────────────────
// jsdom does not parse CSS files, so getComputedStyle returns "" for custom
// properties. Any code that reads CSS vars via getComputedStyle in a render hook
// (e.g. useChartAxisColors) will get empty strings without this stub.
// Provide Aurora dark-mode defaults so tests that check rendered attributes
// (e.g. stroke="…" on a highlighted calendar cell) get non-empty values.
// Individual specs may override this with vi.spyOn(globalThis, "getComputedStyle").
const CSS_VAR_DEFAULTS: Record<string, string> = {
  "--color-chart-grid": "#1a1830",
  "--color-chart-axis": "#6b6490",
  "--accent-2": "#38bdf8",
  "--accent": "#7f40ed",
  "--panel": "rgba(24,22,40,0.55)",
  "--border": "rgba(255,255,255,0.08)",
  "--text": "#ece9f6",
};
const _realGetComputedStyle = globalThis.getComputedStyle.bind(globalThis);
vi.stubGlobal(
  "getComputedStyle",
  (el: Element, pseudoElt?: string | null) => {
    const real = _realGetComputedStyle(el, pseudoElt);
    return new Proxy(real, {
      get(target, prop) {
        if (prop === "getPropertyValue") {
          return (name: string) => CSS_VAR_DEFAULTS[name.trim()] ?? "";
        }
        const val = (target as Record<string | symbol, unknown>)[prop];
        return typeof val === "function" ? val.bind(target) : val;
      },
    });
  },
);

// Activate the Zustand store-reset mock at __mocks__/zustand.ts.
// Without this, store mutations bleed across tests.
vi.mock("zustand");

afterEach(() => {
  cleanup();                    // unmount React trees between tests
  sessionStorage.clear();       // Phase 7 uses kbi_returnTo — must be clean per test
  localStorage.clear();         // defensive — no Phase 7 usage but standard hygiene
});
