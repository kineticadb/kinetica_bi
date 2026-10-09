// Phase 133 shim: the contract lives in packages/shared (@kinetica-bi/shared). Keep this path so existing importers are unchanged.
export {
  ALLOW_LIST_VERSION,
  AI_BLOCKED_CONFIG_KEYS,
  PERMANENTLY_BLOCKED_KEYS,
  getFieldLocation,
  splitLayerPatch,
  DATA_BINDING_KEYS,
  validateLayerSnapshot,
  validateActionPatch,
} from "@kinetica-bi/shared";
export type { FieldLocation } from "@kinetica-bi/shared";
