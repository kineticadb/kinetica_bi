// Phase 136 (D-07, D-08): pure grid math for AI widget placement. No React, no store.
import type { AiWidgetType } from "./aiAsk";

export const AI_GRID_COLS = 36;
export const AI_MIN_W = 6;
export const AI_MIN_H = 6;
export const AI_MAX_H = 200;

export type GridRect = { x: number; y: number; w: number; h: number };

/** Starting values; tuned at the 136-12 human-verify checkpoint. */
export const AI_DEFAULT_SIZE: Record<AiWidgetType, { w: number; h: number }> = {
  bignumber: { w: 9, h: 14 },
  bar: { w: 18, h: 30 },
  line: { w: 18, h: 30 },
  pie: { w: 18, h: 30 },
  table: { w: 18, h: 36 },
  records: { w: 36, h: 36 },
  map: { w: 28, h: 45 },
};

/** Mirrors DashboardsPage getWidgetLayout fallback, per field. */
export function resolveRect(layout: Partial<GridRect> | undefined, index: number): GridRect {
  return {
    x: layout?.x ?? (index % 2) * 18,
    y: layout?.y ?? Math.floor(index / 2) * 24,
    w: layout?.w ?? 18,
    h: layout?.h ?? 24,
  };
}

export function rectsOverlap(a: GridRect, b: GridRect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** First-fit: scan y then x; never moves existing rects. Falls below everything when no gap fits. */
export function placeWidget(
  existing: readonly GridRect[],
  size: { w: number; h: number },
): GridRect & { below: boolean } {
  let bottom = 0;
  for (const r of existing) bottom = Math.max(bottom, r.y + r.h);
  for (let y = 0; y <= bottom; y++) {
    for (let x = 0; x <= AI_GRID_COLS - size.w; x++) {
      const cand = { x, y, w: size.w, h: size.h };
      if (!existing.some((e) => rectsOverlap(cand, e))) {
        return { ...cand, below: existing.length > 0 && y >= bottom };
      }
    }
  }
  return { x: 0, y: bottom, w: size.w, h: size.h, below: existing.length > 0 };
}

export function validateLayout(
  items: readonly ({ id: number } & GridRect)[],
): { valid: true } | { valid: false; reasons: string[] } {
  const reasons: string[] = [];
  for (const it of items) {
    const label = `widget ${it.id}`;
    if (![it.x, it.y, it.w, it.h].every((n) => Number.isInteger(n))) reasons.push(`${label}: rect values must be integers`);
    if (it.x < 0 || it.y < 0) reasons.push(`${label}: x and y must be >= 0`);
    if (it.w < AI_MIN_W) reasons.push(`${label}: width below minimum ${AI_MIN_W}`);
    if (it.h < AI_MIN_H) reasons.push(`${label}: height below minimum ${AI_MIN_H}`);
    if (it.h > AI_MAX_H) reasons.push(`${label}: height above maximum ${AI_MAX_H}`);
    if (it.x + it.w > AI_GRID_COLS) reasons.push(`${label}: extends beyond the ${AI_GRID_COLS}-column grid`);
  }
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      if (rectsOverlap(items[i], items[j])) reasons.push(`widgets ${items[i].id} and ${items[j].id} overlap`);
    }
  }
  return reasons.length > 0 ? { valid: false, reasons } : { valid: true };
}
