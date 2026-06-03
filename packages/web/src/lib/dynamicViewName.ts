/**
 * Phase 33 (DV-V16-06): pure helper — frontend mirror of the server's deterministic
 * dynamic-view name composer. Byte-parity with `packages/server/src/lib/dynamicViewName.ts`.
 *
 * Shape (locked by 32-CONTEXT.md § D7):
 *   _kbi_dv_u<sanitizedUserId>_d<dashboardId>_<dynamicViewId>
 *
 * Pure / deterministic: same input always produces the same output.
 * No Date.now, no random, no environment reads.
 *
 * Established pure-lib mirror pattern (v1.4 `lib/mapInfoConfig.ts`, v1.5 `lib/spatialTargets.ts`):
 * when server and frontend need identical pure helpers, each side gets its own
 * `lib/X.ts` file. The sanitization rule is inlined (NOT imported from server-side)
 * so this frontend module is dependency-free and the parity contract is enforced
 * by tests, not by cross-tree imports.
 *
 * Sanitization rule mirrors `packages/server/src/lib/viewNaming.ts:sanitizeForViewName`:
 *   - Replace every char outside `[a-zA-Z0-9_]` with `_`
 *   - Truncate to 32 chars (V13-P-08 length budget — OIDC userIds can be long)
 *
 * Phase 33 ships this module dormant — no production consumer until Plan 33-03
 * wires lifecycle reset; first reader is Phase 35 renderer at FROM-swap.
 */

export type DynamicViewNameArgs = {
  userId: string;
  dashboardId: number;
  dynamicViewId: number;
};

/**
 * Sanitize a userId for safe inclusion in a Kinetica identifier.
 * Mirrors server-side `sanitizeForViewName`: replaces every non-alphanumeric-or-underscore
 * char with `_`, then truncates to 32 chars (V13-P-08 length budget).
 *
 * INTENTIONALLY INLINED (not exported) — frontend file is dependency-free; parity
 * is enforced by the spec's round-trip pairs, not by importing from the server tree.
 */
function sanitizeForViewName(userId: string): string {
  return userId.replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 32);
}

export function buildDynamicViewName(args: DynamicViewNameArgs): string {
  const u = sanitizeForViewName(args.userId);
  return `_kbi_dv_u${u}_d${args.dashboardId}_${args.dynamicViewId}`;
}
