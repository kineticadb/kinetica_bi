/**
 * CustomCssEditor — CodeMirror CSS editor with debounced live draft injection.
 *
 * Mirrors DynamicViewsModal.tsx pattern:
 *   import CodeMirror, { oneDark } from "@uiw/react-codemirror"
 *   import { css } from "@codemirror/lang-css"
 *
 * Draft preview behavior:
 * - Typing calls onChange (updates draft.customCss in BrandingSettingsPage) immediately.
 * - After DEBOUNCE_MS (~400ms), writes to a SEPARATE <style id="kbi-brand-css-draft">
 *   element (textContent, never innerHTML). This is NOT kbi-custom-css (the saved CSS
 *   element owned by BrandStyleInjector — we never touch that here).
 * - useEffect cleanup removes kbi-brand-css-draft on unmount so leaving the page
 *   clears the draft preview.
 *
 * Branding-page exemption note:
 * The branding settings page itself is NOT specially scoped in the draft CSS —
 * the page header (Reset / Save) is positioned above the CSS editor in DOM order
 * and uses !important-safe ds-btn classes; the page root carries id="branding-admin-exempt"
 * as a marker for future Phase 84 exclusion logic. For now, Reset is the recovery
 * mechanism. (Flagged as CSS-V116-02 scope divergence, tracked for Phase 84.)
 *
 * strippedNotice:
 * After Save, BrandingSettingsPage computes whether the server-returned customCss
 * differs from the submitted value (server sanitizes via sanitizeCssPostcss).
 * When non-null, this prop displays a warning line below the editor.
 */
import { useEffect, useRef } from "react";
import CodeMirror, { oneDark } from "@uiw/react-codemirror";
import { css } from "@codemirror/lang-css";
import { useThemeStore } from "../../store/theme";

const DEBOUNCE_MS = 400;
const DRAFT_STYLE_ID = "kbi-brand-css-draft";

/** Create-or-reuse the draft style element (separate from kbi-custom-css). */
function getDraftStyleEl(): HTMLStyleElement {
  let el = document.getElementById(DRAFT_STYLE_ID) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement("style");
    el.id = DRAFT_STYLE_ID;
    document.head.appendChild(el);
  }
  return el;
}

interface Props {
  value: string;
  onChange: (css: string) => void;
  strippedNotice: string | null;
}

export function CustomCssEditor({ value, onChange, strippedNotice }: Props) {
  const theme = useThemeStore((s) => s.theme);
  const editorTheme = theme === "dark" ? oneDark : "light";

  // Stable ref for the debounce timer
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync value into the draft style element (debounced) on each value change.
  useEffect(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(() => {
      const el = getDraftStyleEl();
      // Use textContent (never innerHTML) — safe plain-text injection
      el.textContent = value;
    }, DEBOUNCE_MS);
  }, [value]);

  // Cleanup: remove draft element on unmount (clears draft preview on page leave).
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      document.getElementById(DRAFT_STYLE_ID)?.remove();
    };
  }, []);

  return (
    <div className="custom-css-editor">
      <CodeMirror
        value={value}
        onChange={onChange}
        extensions={[css()]}
        theme={editorTheme}
        minHeight="200px"
        maxHeight="400px"
        placeholder="/* Custom CSS — applies app-wide. Reset clears. */"
      />
      {strippedNotice && (
        <p className="custom-css-stripped-notice" role="alert">
          {strippedNotice}
        </p>
      )}
    </div>
  );
}
