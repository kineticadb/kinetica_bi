// Phase 134 session layer. In-memory only, never persisted (D-04).
//
// DESIGN DEVIATION (on purpose): milestone PITFALLS C7 prescribes a command pattern with
// inverse ops. This phase uses an op-log + cursor + pure fold instead (134-RESEARCH). The saved
// dashboard is never mutated, so revert/forward is "fold a different prefix" and Discard is
// "drop the log". D-01's inverse/snapshot data is satisfied by replayability; inverses would be
// dead code and a bug surface.
import type { AiOp, AiClarification, AskSkipped, AskQueryEntry, AiFilterSource, AiDvSpec, AiDvOutputColumn } from "@kinetica-bi/shared";
import type { WidgetDto, DashboardLayerDto } from "../../api/client";
import type { ActiveFilter } from "../../store/filterStore";

/** 139: an AI-created session dynamic view (folded from add_dynamic_view). Never persisted; Keep (141) saves it as a normal dv row. */
export type SessionDv = { id: number; name: string; spec: AiDvSpec; baseTableId: number; columns: AiDvOutputColumn[]; maxRecords?: number; aggregated: boolean };

export type FilterSourceRef = AiFilterSource;
/** 138: what one applied filter op changed in filterStore, per source+column. before/after are the exact store objects (identity matters to the reverse filter map). */
export type FilterDelta = { source: FilterSourceRef; column: string; before: ActiveFilter | null; after: ActiveFilter | null };
/** "table:5" -> filtered column names, read from filterStore at APPLY time (not ask time). */
export type CurrentFilterColumns = Readonly<Record<string, readonly string[]>>;

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
  | "table_not_on_dashboard"
  | "column_not_found"
  | "filter_cap"
  | "dynamic_view_rejected";
export type OpResult = { status: "applied" } | { status: "skipped"; reason: SkipReason; detail?: string };
export type TurnEntry = {
  raw: unknown;
  op: AiOp | null;
  result: OpResult;
  /** 138: on the entry (not a side map) so the 50-turn squash carries it. */
  filterDeltas?: FilterDelta[];
};
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
  queries?: AskQueryEntry[]; // 140 D-11: display only ("Ran N queries"); never sent to the provider
  filterNotes?: string[]; // display only, never sent to the provider
  emptyFilters?: { source: FilterSourceRef; column: string }[]; // D-17 "matched no rows" offers
};
export type Turn = { id: string; prompt: string; answer: string; entries: TurnEntry[]; createdAt: number; chat?: TurnChat };
export type TurnInput = { prompt: string; answer?: string; ops: readonly unknown[]; chat?: TurnChat; currentFilters?: CurrentFilterColumns };
export type SessionBaseline = {
  dashboardId: number;
  widgets: readonly WidgetDto[];
  layers: readonly DashboardLayerDto[];
  dynamicViewIds: readonly number[];
  /** Dashboard tables (136); absent = table checks skipped. */
  tables?: readonly { id: number; schema: string; name: string; columns: Record<string, string> }[];
  maxBarGroupBySeriesCap?: number;
  /** 138: saved dynamic view names, for answer wording. */
  dynamicViewNames?: Readonly<Record<number, string>>;
  /** 139: saved dv id -> source_table_id (rebind/repoint base). */
  dynamicViewSources?: Readonly<Record<number, number>>;
  /** 139: saved dv output columns (for SQL derivation of widgets bound to them). */
  dynamicViewColumns?: Readonly<Record<number, readonly { name: string; type: string }[]>>;
};
export type EvaluateOptions = { removalApproved?: boolean; currentFilters?: CurrentFilterColumns };
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
  /** 139: AI-created session views (never persisted). */
  addedDynamicViews: SessionDv[];
  /** 139: saved views removed for this session only (D-18). */
  removedDynamicViewIds: ReadonlySet<number>;
  /** 139: saved layers rebound/repointed this session (top-level fields). */
  layerBinding: Readonly<Record<number, { table_id: number | null; dynamic_view_id: number | null }>>;
};
export type SessionRect = { x: number; y: number; w: number; h: number };
