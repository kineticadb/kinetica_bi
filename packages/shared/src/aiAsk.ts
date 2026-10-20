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
    dynamicViewId: SnapId.optional(),
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
        // 139: names only; a view's spec (which holds filter values) is never in the snapshot
        columns: z.array(Name).max(50),
        sortField: Name,
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
    dynamicViewId: SnapId.optional(),
    columns: z.array(Name).max(5).optional(), // spatial + value column names
  })
  .strict();

// 139: names/types only; a view's spec (which holds filter values) is never in the snapshot
const SnapDv = z
  .object({
    id: SnapId,
    name: Name,
    baseTableId: z.number().int().positive().optional(),
    aggregated: z.boolean().optional(),
    columns: z.array(z.object({ name: Name, type: z.string().max(50) }).strict()).max(70).optional(),
  })
  .strict();

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
        // 25 per source x tables + dynamic views; still names/operators only, never values
        filters: z.array(SnapFilter).max(300),
      })
      .strict(),
    turns: z.array(AskTurnSchema).max(50),
    // D-06: UX approval for removing saved entities; not a security boundary (edit rights enforced at Keep, 141).
    approvals: z.object({ removeSaved: z.boolean() }).strict().optional(),
  })
  .strict();

export type AskRequest = z.infer<typeof AskRequestSchema>;
export type AskTurn = z.infer<typeof AskTurnSchema>;

export const AiClarificationSchema = z
  .object({
    // choose_option (137 D-20): an ambiguous question; options come from the reply trailer
    kind: z.enum(["confirm_remove", "choose_map", "choose_option"]),
    question: z.string().max(300),
    options: z.array(z.object({ id: z.string().max(50), label: z.string().max(200) }).strict()).min(1).max(10),
  })
  .strict();
export type AiClarification = z.infer<typeof AiClarificationSchema>;

export const AI_FOLLOWUP_MAX = 3;
export const AI_FOLLOWUP_MAX_CHARS = 120;
export const AskSkippedSchema = z
  .object({ label: z.string().max(200), stage: z.string().max(50), reasons: z.array(z.string().max(500)).max(10) })
  .strict();
export const AskResultEventSchema = z
  .object({
    answerId: z.number().int(),
    text: z.string(),
    ops: z.array(z.unknown()),
    skipped: z.array(AskSkippedSchema),
    clarifications: z.array(AiClarificationSchema),
    followUps: z.array(z.string().min(1).max(AI_FOLLOWUP_MAX_CHARS)).max(AI_FOLLOWUP_MAX),
    applied: z.array(z.string().max(300)),
  })
  .strict();
export type AskResultEvent = z.infer<typeof AskResultEventSchema>;
export type AskSkipped = z.infer<typeof AskSkippedSchema>;
export type AskStreamEvent =
  | { event: "status"; data: { phase: "thinking" | "tool" | "waiting_provider"; label: string; seconds?: number } }
  | { event: "step"; data: { n: number; tool: string; label: string } }
  | { event: "result"; data: AskResultEvent }
  | { event: "error"; data: { code: string; message: string } }
  | { event: "done"; data: { answerId: number; outcome: string; steps: number } };
