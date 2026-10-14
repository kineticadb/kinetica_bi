// Phase 134 session layer. In-memory only, never persisted (D-04).
//
// DESIGN DEVIATION (on purpose): milestone PITFALLS C7 prescribes a command pattern with
// inverse ops. This phase uses an op-log + cursor + pure fold instead (134-RESEARCH). The saved
// dashboard is never mutated, so revert/forward is "fold a different prefix" and Discard is
// "drop the log". D-01's inverse/snapshot data is satisfied by replayability; inverses would be
// dead code and a bug surface.
import type { AiOp, AiClarification, AskSkipped } from "@kinetica-bi/shared";
import type { WidgetDto, DashboardLayerDto } from "../../api/client";

export type SkipReason =
  | "invalid_op"
  | "target_not_found"
  | "duplicate_temp_id"
  | "patch_rejected"
  | "unsupported_in_134"
  | "needs_confirmation"
  | "config_rejected"
  | "unsupported_target"
  | "layout_rejected"
  | "table_not_on_dashboard";
export type OpResult = { status: "applied" } | { status: "skipped"; reason: SkipReason; detail?: string };
export type TurnEntry = { raw: unknown; op: AiOp | null; result: OpResult };
export type TurnChat = {
  status: "ok" | "error" | "cancelled";
  answerId?: number;
  followUps?: string[]; // server trailer; UI falls back to local templates when empty (D-20)
  clarifications?: AiClarification[];
  pickedChoice?: { clarificationIndex: number; optionId: string }; // D-14: greyed + ticked
  skipped?: AskSkipped[];
  applied?: string[];
  errorCode?: string;
  message?: string; // D-09 inline note: the server's exact text
  retryable?: boolean;
};
export type Turn = { id: string; prompt: string; answer: string; entries: TurnEntry[]; createdAt: number; chat?: TurnChat };
export type TurnInput = { prompt: string; answer?: string; ops: readonly unknown[]; chat?: TurnChat };
export type SessionBaseline = {
  dashboardId: number;
  widgets: readonly WidgetDto[];
  layers: readonly DashboardLayerDto[];
  dynamicViewIds: readonly number[];
  /** Dashboard tables (136); absent = table checks skipped. */
  tables?: readonly { id: number; schema: string; name: string; columns: Record<string, string> }[];
  maxBarGroupBySeriesCap?: number;
};
export type EvaluateOptions = { removalApproved?: boolean };
export type SessionWidgetMeta = { type?: string; title?: string; config?: Record<string, unknown> };
export type SessionContribution = {
  widget: Record<number, Record<string, unknown>>;
  layer: Record<number, Record<string, unknown>>;
  dynamicView: Record<number, Record<string, unknown>>;
};
export type SessionDerived = {
  addedWidgets: WidgetDto[];
  removedWidgetIds: ReadonlySet<number>;
  addedLayers: DashboardLayerDto[];
  removedLayerIds: ReadonlySet<number>;
  contribution: SessionContribution;
  appliedOpCount: number;
  layout: Readonly<Record<number, SessionRect>>;
  aiEditedWidgetIds: ReadonlySet<number>;
  aiEditedLayerIds: ReadonlySet<number>;
  /** 137 (136-12 UAT): saved, non-removed maps that show an AI-added/edited/removed layer. Drives the pill and nothing else; NOT counted in the bar (each change counts once, as the layer). */
  aiLayerHostWidgetIds: ReadonlySet<number>;
  widgetMeta: Readonly<Record<number, SessionWidgetMeta>>;
};
export type SessionRect = { x: number; y: number; w: number; h: number };
