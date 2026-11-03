// 142 UAT: a null category (e.g. a LEFT join with no match) rendered as a blank tick and "null" in the tooltip.
// Display only: the data, sort order and click-to-filter keep the real value.
export const BLANK_CATEGORY_LABEL = "(blank)";

export function categoryLabel(v: unknown): string {
  if (v === null || v === undefined) return BLANK_CATEGORY_LABEL;
  const s = String(v);
  return s.trim() === "" ? BLANK_CATEGORY_LABEL : s;
}
