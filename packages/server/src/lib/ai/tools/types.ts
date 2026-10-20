// Phase 135: tool + gateway contracts. Tool results reach the model only as classified OutboundParts.
import type { z } from "zod/v4";
import type { AiClarification, AiOp } from "@kinetica-bi/shared";
import type { AiDataAccess } from "../../aiConfig";
import type { OutboundPart } from "../outbound";

export type GatewayStage = "shape" | "allow_list" | "permission" | "reference" | "live_schema" | "layout" | "clarification" | "cap";
/** Failure extras (ids/names only, never values): `refKey` = the bad reference (`col:<tableId>:<name>`, `table:<id>`,
 *  `ref:<kind>:<id>`); `slot` = what the op targets (`new:<tempId>`, `widget:<id>`, `layer:<id>`, `layout`);
 *  `label` = describeIntent of a parsed op (for the skipped change log); `clarification` = a question instead of an op. */
export type GatewayResult =
  | { ok: true; op: AiOp; label: string }
  | { ok: false; stage: GatewayStage; reasons: string[]; refKey?: string; slot?: string; label?: string; clarification?: AiClarification };

export type LiveColumn = { name: string; type?: string };
export type LiveTableInfo = { id: number; schema: string; name: string; description?: string; columns: LiveColumn[] };
export interface LiveSchemaPort {
  /** Probe AS THE USER. {ok:false} for unregistered, inaccessible, or any upstream failure - identical (never leak existence). Only SessionEndedError propagates. */
  describe(tableId: number): Promise<{ ok: true; table: LiveTableInfo } | { ok: false }>;
}

export type DashboardView = {
  // projected snapshot: schema/config class only, never values
  dashboardId: number;
  title?: string;
  widgets: {
    id: number;
    type: string;
    title: string;
    tableId?: number;
    dynamicViewId?: number;
    layout?: { x: number; y: number; w: number; h: number };
    binding?: Record<string, string | string[]>;
  }[];
  layers: { id: number; widgetId: number; title?: string; tableId?: number; renderMode?: string; visible?: boolean }[];
  dynamicViews: { id: number; name: string; baseTableId?: number; aggregated?: boolean; columns?: { name: string; type: string }[] }[];
  filters: { source: { kind: string; id: number }; column: string; op: string }[];
};

export type ToolContext = {
  username: string;
  dashboardId: number;
  dataAccess: AiDataAccess;
  dashboardView: () => DashboardView;
  dashboardTableIds: () => number[];
  registeredTables: () => { id: number; schema: string; name: string; description?: string }[];
  liveSchema: LiveSchemaPort;
};

export type ReadTool = {
  kind: "read";
  name: string;
  description: string;
  args: z.ZodObject<z.ZodRawShape>;
  run(args: unknown, ctx: ToolContext): Promise<{ parts: OutboundPart[]; isError?: boolean }>;
};
export type MutateTool = {
  kind: "mutate";
  name: string;
  description: string;
  args: z.ZodObject<z.ZodRawShape>;
  toOp(args: unknown): unknown; // raw AiOp candidate; the gateway runs parseAiOp
};
export type AiTool = ReadTool | MutateTool;
