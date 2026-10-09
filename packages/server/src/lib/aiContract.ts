// Phase 133: the server's single import point for the shared AI contract (@kinetica-bi/shared). Phase 135's gateway validates every AI op through parseAiOp. Never import packages/shared by relative path.
export { AiOpSchema, parseAiOp, AI_OP_KINDS, AI_BLOCKED_CONFIG_KEYS, ALLOW_LIST_VERSION } from "@kinetica-bi/shared";
export type { AiOp, AiOpKind } from "@kinetica-bi/shared";
import { ALLOW_LIST_VERSION } from "@kinetica-bi/shared";
export const AI_CONTRACT_VERSION: string = ALLOW_LIST_VERSION;
