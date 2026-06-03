import { registerChartType, type ChartTypeDefinition } from "../registry";

/**
 * Phase 23 (CARD-V14-01): Info Card chart type definition.
 *
 * Card is a "popup mirrored in a widget" — locked design north star at
 * .planning/phases/23-info-card/23-CONTEXT.md § "Card identity & registry shape".
 *
 * No CustomConfigPanel — card has no per-widget configuration. The in-widget
 * dropdown (rendered by <InfoSelectionView />) is the user's only configuration
 * affordance. Empty fields, empty defaultConfig.
 *
 * supportsDrillDown: false — Phase 21 lock; info path is orthogonal to filter pipeline.
 * usesAggregation: false — card runs no SQL.
 */
const infoCard: ChartTypeDefinition = {
  type: "info-card",
  label: "Info Card",
  icon: "IC",
  fields: [],
  defaultConfig: {},
  usesAggregation: false,
  supportsDrillDown: false,
};

export default function register() {
  registerChartType(infoCard);
}
