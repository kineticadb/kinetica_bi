// Phase 133 shim: the contract lives in packages/shared (@kinetica-bi/shared). Keep this path so existing importers are unchanged.
export { TARGET_KINDS, WidgetActionTargetSchema, WidgetActionSchema } from "@kinetica-bi/shared";
export type {
  WidgetActionTarget,
  WidgetAction,
  WidgetActionStatus,
  WidgetActionResult,
} from "@kinetica-bi/shared";
