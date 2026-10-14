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
  widgetMeta: Object.freeze({}),
});
