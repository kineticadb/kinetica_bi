/**
 * Phase 21 (POPUP-V14-04) — shared info-popup template rendering helper.
 *
 * CONSUMERS:
 *   - Phase 21 InfoPopup.tsx (src/components/charts/InfoPopup.tsx) — map click popup body.
 *   - Phase 23 Info Card renderer — info-card chart type.
 * Both use this single helper so the popup and the Info Card render IDENTICALLY for the
 * same (template, row, info_columns) tuple. Locked at .planning/STATE.md § "Key v1.4
 * Architecture Decisions" — "Both Phase 21 (popup) and Phase 23 (Info Card) must use the
 * same shared `renderInfoTemplate` helper so rendering is consistent."
 *
 * NO HTML SANITIZATION — locked at .planning/PROJECT.md § "Current Milestone: v1.4 Map
 * Info Popup" Key Decision: "Dashboard authors are privileged users (analogous to saved
 * SQL queries). Risk documented in PROJECT.md Key Decisions." DO NOT add a sanitizer
 * library (DOMPurify, sanitize-html, etc.). The caller will pass the returned `html`
 * string straight to React's `dangerouslySetInnerHTML`.
 *
 * Token substitution syntax: {column_name} — Tableau/Grafana convention. Literal
 * substitution only. No expressions, no escaping, no logic. Locked at
 * .planning/phases/21-map-click-popup/21-CONTEXT.md § Template rendering.
 *
 * info_columns lenient parse: when the JSON parse fails OR the parsed value is not a
 * non-empty array, the helper falls back to using all response columns (the `columns`
 * arg). This matches the Phase 19 schema lock: info_columns is a free-form TEXT field
 * with no DB-level shape validation.
 */

export type RenderResult =
  | { mode: "template"; html: string }
  | { mode: "kv"; pairs: { col: string; value: unknown }[] };

export type RenderInfoTemplateArgs = {
  /** Raw `info_template` from DashboardLayerDto. null → kv-mode fallback. */
  template: string | null;
  /** Response columns from POST /api/info/query response. Used as kv-mode fallback when info_columns is null/invalid. */
  columns: string[];
  /** A single row from POST /api/info/query response (Record<string, unknown>). */
  row: Record<string, unknown>;
  /** Raw `info_columns` JSON-array string from DashboardLayerDto. null → all-columns kv-mode. */
  infoColumns?: string | null;
  /** Optional value formatter for template-mode {column} substitution. (col, rawValue) => display string.
   *  Injected by the caller (InfoSelectionView) bound to layer.table_id — keeps this lib store-free.
   *  When omitted, substitution falls back to String(rawValue) (current behavior). */
  formatValue?: (col: string, value: unknown) => string;
};

export function renderInfoTemplate(args: RenderInfoTemplateArgs): RenderResult {
  // Template mode: non-null template (including empty string — author's choice) takes the
  // template branch. Caller maps null→"" before calling if they want "no template" to
  // mean kv-mode; this helper treats null as the kv-mode discriminator.
  if (args.template !== null) {
    const html = args.template.replace(/\{(\w+)\}/g, (_match, col: string) => {
      const v = args.row[col];
      // null and undefined both coerce to empty string (most user-facing rendering
      // wants "Alice" at "" rather than "Alice" at "null").
      if (v === null || v === undefined) return "";
      return args.formatValue ? args.formatValue(col, v) : String(v);
    });
    return { mode: "template", html };
  }

  // kv mode: resolve column list — info_columns array (when valid + non-empty), else
  // fall back to all response columns.
  let cols: string[] = args.columns;
  if (args.infoColumns) {
    try {
      const parsed = JSON.parse(args.infoColumns) as unknown;
      if (Array.isArray(parsed) && parsed.length > 0 &&
          parsed.every((c) => typeof c === "string")) {
        cols = parsed as string[];
      }
      // Empty array, non-array, mixed-type array → fall through to args.columns (locked).
    } catch {
      // JSON parse error → fall through to args.columns (locked).
    }
  }

  return {
    mode: "kv",
    pairs: cols.map((col) => ({ col, value: args.row[col] })),
  };
}
