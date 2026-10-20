import type { SessionDerived } from "./types";

/**
 * Reserved widgetActionStore controlId for the AI contribution. AiRefIdSchema forbids 0, saved
 * ids are autoincrement > 0 and temp ids are negative, so 0 collides with nothing (a negative id
 * would collide with temp widget ids if an AI-added control widget ever dispatches).
 */
export const AI_SOURCE_ID = 0;
/** D-06 safety cap on retained turns. */
export const SESSION_TURN_CAP = 50;

export const EMPTY_DERIVED: SessionDerived = Object.freeze({
  addedWidgets: [],
  removedWidgetIds: new Set<number>(),
  addedLayers: [],
  removedLayerIds: new Set<number>(),
  contribution: { widget: {}, layer: {}, dynamicView: {} },
  appliedOpCount: 0,
  layout: Object.freeze({}),
  aiEditedWidgetIds: new Set<number>(),
  aiEditedLayerIds: new Set<number>(),
  aiLayerHostWidgetIds: new Set<number>(),
  widgetMeta: Object.freeze({}),
  addedDynamicViews: [],
  removedDynamicViewIds: new Set<number>(),
  layerBinding: Object.freeze({}),
});

/** 137: the AI Assistant widget type. Never in shared AI_WIDGET_TYPES (the AI cannot add it). */
export const AI_ASSISTANT_TYPE = "ai";
/** D-03: a newly added AI widget is 12 x 40 (inline chat from the start). */
export const AI_ASSISTANT_DEFAULT_SIZE = Object.freeze({ w: 12, h: 40 });
/** D-02: small-tile layout when under 12 columns OR under 24 rows (36-column grid, config.layout). */
export const AI_SMALL_TILE = Object.freeze({ minW: 12, minH: 24 });
export const isSmallAiTile = (r: { w: number; h: number }): boolean => r.w < AI_SMALL_TILE.minW || r.h < AI_SMALL_TILE.minH;
/** D-18: fading outline duration. */
export const AI_HIGHLIGHT_MS = 3000;
