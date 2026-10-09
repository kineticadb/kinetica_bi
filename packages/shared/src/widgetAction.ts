/**
 * Phase 58 Plan 01 — Serializable widget-action envelope.
 *
 * This is the MCP-future serializable envelope — the same shape a future AI/MCP
 * `inputSchema` produces. It carries NO closures or object references; every value
 * must survive a JSON.parse(JSON.stringify(...)) round-trip unchanged. The allow-list
 * in actionAllowList.ts is the binding contract that gates which fields may appear
 * inside configPatch.
 *
 * // INVARIANT: ACTION-ENGINE-NO-FILTER
 * Engine code (this module + router + store) NEVER imports filterStore symbols
 * (materializeFilter / dropFilterView / addFilter / setBulkFilters / filterVersion).
 * Enforced by static source-grep assertion in Plan 58-02.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Target kinds
// ---------------------------------------------------------------------------

export const TARGET_KINDS = ["widget", "layer", "dynamicView"] as const;

export const WidgetActionTargetSchema = z.object({
  kind: z.enum(TARGET_KINDS),
  id: z.number().int().positive(),
});

// ---------------------------------------------------------------------------
// Envelope schema
// ---------------------------------------------------------------------------

export const WidgetActionSchema = z.object({
  target: WidgetActionTargetSchema,
  configPatch: z.record(z.unknown()),
});

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------

export type WidgetActionTarget = z.infer<typeof WidgetActionTargetSchema>;
export type WidgetAction = z.infer<typeof WidgetActionSchema>;

// ---------------------------------------------------------------------------
// Typed result union — produced by the router (Plan 58-02)
// Discriminated on `status` so callers can narrow with a switch/if.
// ---------------------------------------------------------------------------

export type WidgetActionStatus = "applied" | "target_not_found" | "rejected";

export type WidgetActionResult =
  | { status: "applied"; target: WidgetActionTarget }
  | { status: "target_not_found"; target: WidgetActionTarget }
  | { status: "rejected"; target: WidgetActionTarget; reasons: string[] };
