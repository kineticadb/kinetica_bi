// Phase 143 (AIMCP-V20-08): a Claude Desktop handoff may remove saved content. The server only passes such a removal
// on after Claude called it with confirmed: true (the user approved it in chat), so the browser records the approval
// (approveRemoval) before folding the ops; otherwise the fold skips them as needs_confirmation.
import type { AiOp } from "@kinetica-bi/shared";

export function removesSavedContent(ops: readonly AiOp[]): boolean {
  return ops.some((o) => (o.op === "remove_widget" || o.op === "remove_layer" || o.op === "remove_dynamic_view") && o.id > 0);
}
