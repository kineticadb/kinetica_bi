/**
 * Allow-list key -> renderer key translation (GAP-134-01).
 *
 * The widget allow-list (packages/shared/src/actionAllowList.ts) names fields in snake_case
 * (show_popup, show_scale_bar, show_fullscreen, page_size). Those names are the PERSISTED contract
 * of v1.11 radio options and the AI op schema, so they must NOT be renamed. The renderers, however,
 * read different keys (showScaleBar, showFullscreenButton, infoEnabled, pageSize). Without this
 * translation an overlay merged into widget.config under the snake keys is never read.
 *
 * Unmapped keys (e.g. includedLayerIds written by foldSession) pass through unchanged.
 */
export const WIDGET_OVERLAY_KEY_MAP: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  map: {
    show_scale_bar: "showScaleBar",
    show_fullscreen: "showFullscreenButton",
    show_popup: "infoEnabled",
  },
  records: { page_size: "pageSize" },
};

export function translateWidgetOverlay(
  widgetType: string,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const map = WIDGET_OVERLAY_KEY_MAP[widgetType];
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(patch)) {
    out[map?.[key] ?? key] = patch[key];
  }
  return out;
}
