// Phase 135 (D-05..D-08, D-17): the ask request contract shared by the client (137) and the server.
// STRICT everywhere: there is deliberately no field that can carry a row value or a filter value
// (AIGOV-V20-02) - the snapshot is structure only.
import { z } from "zod";

/** 133-SPIKES S3 approved AI widget subset. */
export const AI_WIDGET_TYPES = ["bar", "line", "pie", "table", "bignumber", "records", "map"] as const;
export type AiWidgetType = (typeof AI_WIDGET_TYPES)[number];

export const ASK_REQUEST_MAX_BYTES = 65_536;

// Real ids are positive; session-temp ids are negative; 0 is never valid.
const SnapId = z.number().int().refine((n) => n !== 0, "id must not be 0");
const Name = z.string().max(200);

const SnapWidget = z
  .object({
    id: SnapId,
    type: z.string().min(1).max(50),
    title: Name,
    tableId: z.number().int().positive().optional(),
    layout: z
      .object({
        x: z.number().int().min(0).max(1000),
        y: z.number().int().min(0).max(1000),
        w: z.number().int().min(0).max(1000),
        h: z.number().int().min(0).max(1000),
      })
      .strict()
      .optional(),
    // CLOSED key set: a free-form record could smuggle customWhere / filter text past the contract.
    binding: z
      .object({
        metric: Name,
        aggregation: Name,
        dimension: Name,
        metricColumn: Name,
        groupByColumn: Name,
        groupByColumns: z.array(Name).max(20),
      })
      .partial()
      .strict()
      .optional(),
  })
  .strict();

const SnapLayer = z
  .object({
    id: SnapId,
    widgetId: SnapId,
    title: Name.optional(),
    tableId: z.number().int().positive().optional(),
    renderMode: z.string().max(50).optional(),
    visible: z.boolean().optional(),
  })
  .strict();

const SnapDv = z.object({ id: SnapId, name: Name }).strict();

// Filter values are viewer data; schema mode must never see them (AIGOV-V20-02). No value field, by design.
const SnapFilter = z
  .object({
    source: z.object({ kind: z.enum(["table", "dynamicView"]), id: SnapId }).strict(),
    column: Name,
    op: z.string().max(30),
  })
  .strict();

// D-17: the AI's answer text is included in history; treat it as untrusted.
export const AskTurnSchema = z
  .object({
    question: z.string().max(2000),
    answer: z.string().max(8000),
    changes: z
      .array(
        z
          .object({
            label: Name,
            status: z.enum(["applied", "skipped"]),
            reason: Name.optional(),
          })
          .strict(),
      )
      .max(30),
  })
  .strict();

export const AskRequestSchema = z
  .object({
    dashboardId: z.number().int().positive(),
    question: z.string().trim().min(1).max(2000),
    snapshot: z
      .object({
        widgets: z.array(SnapWidget).max(100),
        layers: z.array(SnapLayer).max(50),
        dynamicViews: z.array(SnapDv).max(20),
        filters: z.array(SnapFilter).max(50),
      })
      .strict(),
    turns: z.array(AskTurnSchema).max(50),
  })
  .strict();

export type AskRequest = z.infer<typeof AskRequestSchema>;
export type AskTurn = z.infer<typeof AskTurnSchema>;
