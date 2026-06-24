import { useEffect } from "react";
import { useBrandStore } from "../store/brandStore";

/**
 * BrandStyleInjector — mounts a <style id="kbi-custom-css"> element in <head>
 * and keeps its textContent in sync with the active brand's customCss field.
 *
 * Uses textContent assignment (never unsafe element property) to block escape sequence injection.
 * The custom CSS was sanitized server-side by PostCSS AST before storage (Phase 81).
 * @scope wrapping is Phase 83 — NOT added here.
 *
 * Returns null (no visible DOM output). Safe to mount in all render branches
 * (loading, login, authenticated) so brand CSS is applied before auth.
 */
export function BrandStyleInjector() {
  const customCss = useBrandStore((s) => s.customCss);

  useEffect(() => {
    let el = document.getElementById("kbi-custom-css") as HTMLStyleElement | null;
    if (!el) {
      el = document.createElement("style");
      el.id = "kbi-custom-css";
      document.head.appendChild(el);
    }
    // textContent assignment — blocks </style> escape sequence injection
    el.textContent = customCss ?? "";
  }, [customCss]);

  return null;
}
