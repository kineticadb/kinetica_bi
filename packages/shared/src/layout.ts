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
  timeline: { w: 18, h: 30 },
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

// Phase 142 (D-12): server-fixed bands for a generated dashboard. The AI Assistant sits in a 12-wide right column.
// Widths are deliberately rescaled from AI_DEFAULT_SIZE to fit the 24-column main area beside it.
export const GENERATE_MAIN_COLS = 24;
export const GENERATE_AI_RECT: GridRect = Object.freeze({ x: 24, y: 0, w: 12, h: 40 }) as GridRect;
const KPI_H = 14;
const MID_H = 30;
const MAP_H = 40;
const REC_H = 36;
const KPI_PER_ROW = 3;

export function placeGenerateBands(items: readonly { key: number; type: string }[]): Record<number, GridRect> {
  const out: Record<number, GridRect> = {};
  const kpis = items.filter((i) => i.type === "bignumber");
  const maps = items.filter((i) => i.type === "map");
  const records = items.filter((i) => i.type === "records");
  const rest = items.filter((i) => i.type !== "bignumber" && i.type !== "map" && i.type !== "records");
  // the time-trend slot (line or timeline) leads the middle band
  const isTrend = (t: string) => t === "line" || t === "timeline";
  const middle = [...rest.filter((i) => isTrend(i.type)), ...rest.filter((i) => !isTrend(i.type))];
  let y = 0;
  for (let s = 0; s < kpis.length; s += KPI_PER_ROW) {
    const chunk = kpis.slice(s, s + KPI_PER_ROW);
    const w = chunk.length === 1 ? 12 : Math.floor(GENERATE_MAIN_COLS / chunk.length);
    chunk.forEach((it, i) => { out[it.key] = { x: i * w, y, w, h: KPI_H }; });
    y += KPI_H;
  }
  for (let s = 0; s < middle.length; s += 2) {
    const pair = middle.slice(s, s + 2);
    pair.forEach((it, i) => {
      out[it.key] = pair.length === 1 ? { x: 0, y, w: GENERATE_MAIN_COLS, h: MID_H } : { x: i * 12, y, w: 12, h: MID_H };
    });
    y += MID_H;
  }
  for (const it of maps) {
    out[it.key] = { x: 0, y, w: GENERATE_MAIN_COLS, h: MAP_H };
    y += MAP_H;
  }
  let ry = Math.max(y, GENERATE_AI_RECT.y + GENERATE_AI_RECT.h);
  for (const it of records) {
    out[it.key] = { x: 0, y: ry, w: AI_GRID_COLS, h: REC_H };
    ry += REC_H;
  }
  return out;
}

// kbi-mcp: a whole dashboard built from Claude Desktop is laid out full width (no AI column) so that, when there
// are not too many charts, the KPIs, charts and map fit one screen. A grid row is 13px (rowHeight 5 + margin 8).
export const FIT_KPI_H = 10;
export const FIT_CHART_H = 22;
export const FIT_MAP_ALONE_H = 44;
export const FIT_RECORDS_H = 24;
/** About 730px: KPI band plus two chart rows, the part meant to show without scrolling. */
export const FIT_SCREEN_ROWS = 56;
const FIT_KPI_PER_ROW = 6;

/** Splits `cols` across `n` items in a row; the last item takes the remainder so the row is exactly full. */
function splitRow(n: number, cols: number): { x: number; w: number }[] {
  const w = Math.floor(cols / n);
  return Array.from({ length: n }, (_, i) => ({ x: i * w, w: i === n - 1 ? cols - i * w : w }));
}

export function placeFitBands(items: readonly { key: number; type: string }[]): Record<number, GridRect> {
  const out: Record<number, GridRect> = {};
  const kpis = items.filter((i) => i.type === "bignumber");
  const maps = items.filter((i) => i.type === "map");
  const records = items.filter((i) => i.type === "records");
  const rest = items.filter((i) => i.type !== "bignumber" && i.type !== "map" && i.type !== "records");
  const isTrend = (t: string) => t === "line" || t === "timeline";
  const charts = [...rest.filter((i) => isTrend(i.type)), ...rest.filter((i) => !isTrend(i.type))];

  let y = 0;
  for (let s = 0; s < kpis.length; s += FIT_KPI_PER_ROW) {
    const chunk = kpis.slice(s, s + FIT_KPI_PER_ROW);
    splitRow(chunk.length, AI_GRID_COLS).forEach((c, i) => { out[chunk[i].key] = { ...c, y, h: FIT_KPI_H }; });
    y += FIT_KPI_H;
  }

  // Charts fill rows; with a map, they pair up in the left half and the first map takes the right half beside them.
  const [sideMap, ...otherMaps] = maps;
  const chartCols = sideMap && charts.length > 0 ? AI_GRID_COLS / 2 : AI_GRID_COLS;
  const perRow = sideMap ? 2 : charts.length === 1 ? 1 : charts.length === 2 || charts.length === 4 ? 2 : 3;
  const top = y;
  for (let s = 0; s < charts.length; s += perRow) {
    const row = charts.slice(s, s + perRow);
    splitRow(row.length, chartCols).forEach((c, i) => { out[row[i].key] = { ...c, y, h: FIT_CHART_H }; });
    y += FIT_CHART_H;
  }
  if (sideMap) {
    if (charts.length > 0) {
      out[sideMap.key] = { x: chartCols, y: top, w: AI_GRID_COLS - chartCols, h: Math.max(y - top, 2 * FIT_CHART_H) };
      y = top + out[sideMap.key].h;
    } else {
      out[sideMap.key] = { x: 0, y, w: AI_GRID_COLS, h: FIT_MAP_ALONE_H };
      y += FIT_MAP_ALONE_H;
    }
  }
  for (const it of otherMaps) {
    out[it.key] = { x: 0, y, w: AI_GRID_COLS, h: FIT_MAP_ALONE_H };
    y += FIT_MAP_ALONE_H;
  }
  for (const it of records) {
    out[it.key] = { x: 0, y, w: AI_GRID_COLS, h: FIT_RECORDS_H };
    y += FIT_RECORDS_H;
  }
  return out;
}
