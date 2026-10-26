// 137: pure builder for the POST /api/ai/ask body. Structure only - never row or filter values
// (AIGOV-V20-02). Filters are reported as source + column + operator names only. The binding key set is CLOSED: no other widget config key is ever copied.
import { layersOfMap, aiLayerColumnRefs, type AskRequest } from "@kinetica-bi/shared";
import type { WidgetDto, DashboardLayerDto } from "../../api/client";
import type { Turn, SavedChatItem } from "./types";

export type AskRect = { x: number; y: number; w: number; h: number };

const MAX_BODY_BYTES = 60_000; // under ASK_REQUEST_MAX_BYTES (65_536) with headroom
const RECENT_ANSWER_TURNS = 8;
const RECENT_ANSWER_CHARS = 1500;

const str = (v: unknown, max = 200): string | undefined => (typeof v === "string" ? v.slice(0, max) : undefined);
const clamp = (n: number) => Math.min(1000, Math.max(0, Math.round(n)));
const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);

function bindingOf(config: Record<string, unknown>, type: string): NonNullable<AskRequest["snapshot"]["widgets"][number]["binding"]> | undefined {
  const b: Record<string, unknown> = {};
  for (const k of ["metric", "aggregation", "dimension", "metricColumn", "groupByColumn", "sortField"] as const) {
    const v = str(config[k]);
    if (v !== undefined) b[k] = v;
  }
  // 142: a timeline's time column and first metric, in the model's vocabulary (names only)
  if (type === "timeline") {
    const t = str(config.timeCol);
    if (t) b.timeColumn = t;
    const m0 = Array.isArray(config.metrics) ? (config.metrics[0] as Record<string, unknown> | undefined) : undefined;
    if (m0 && typeof m0 === "object") {
      const col = str(m0.column);
      if (col && b.metric === undefined) b.metric = col;
      const agg = str(m0.aggregation);
      if (agg && b.aggregation === undefined) b.aggregation = agg.toLowerCase();
    }
  }
  if (Array.isArray(config.groupByColumns)) {
    b.groupByColumns = config.groupByColumns
      .filter((x): x is string => typeof x === "string")
      .slice(0, 20)
      .map((x) => x.slice(0, 200));
  }
  // 139: records columns (array, or a comma-separated string) - names only
  const rawCols = Array.isArray(config.columns)
    ? config.columns
    : typeof config.columns === "string"
      ? config.columns.split(",")
      : [];
  const cols = rawCols
    .filter((x): x is string => typeof x === "string")
    .map((x) => x.trim().slice(0, 200))
    .filter((x) => x.length > 0)
    .slice(0, 50);
  if (cols.length > 0) b.columns = cols;
  return Object.keys(b).length > 0 ? b : undefined;
}

/** Structural: ActiveFilter objects fit. The filter value is NEVER read. */
type SnapshotFilterLike = { column: string; operator?: string; dataType?: string };

function snapshotFilters(
  f: { filters: Readonly<Record<number, readonly SnapshotFilterLike[]>>; dvFilters: Readonly<Record<number, readonly SnapshotFilterLike[]>> } | undefined,
): AskRequest["snapshot"]["filters"] {
  if (!f) return [];
  const out: AskRequest["snapshot"]["filters"] = [];
  const add = (kind: "table" | "dynamicView", rec: Readonly<Record<number, readonly SnapshotFilterLike[]>>) => {
    for (const [k, list] of Object.entries(rec)) {
      const id = Number(k);
      if (!Number.isInteger(id) || (kind === "table" ? id <= 0 : id === 0)) continue;
      for (const x of list) {
        out.push({
          source: { kind, id },
          column: x.column.slice(0, 200),
          op: x.dataType === "null" ? "isNull" : (x.operator ?? "eq"),
        });
      }
    }
  };
  add("table", f.filters);
  add("dynamicView", f.dvFilters);
  return out.slice(0, 300);
}

export function buildAskSnapshot(input: {
  widgets: readonly WidgetDto[];
  layouts: Readonly<Record<number, AskRect>>;
  layers: readonly DashboardLayerDto[];
  // 139: only these whitelisted keys are read; a caller's extra fields (e.g. the spec, which holds filter values) are IGNORED.
  dynamicViews: readonly { id: number; name: string; baseTableId?: number; aggregated?: boolean; columns?: readonly { name: string; type: string }[] }[];
  filters?: {
    filters: Readonly<Record<number, readonly SnapshotFilterLike[]>>;
    dvFilters: Readonly<Record<number, readonly SnapshotFilterLike[]>>;
  };
}): AskRequest["snapshot"] {
  const widgets = input.widgets.slice(0, 100).map((w) => {
    const cfg = (w.config ?? {}) as Record<string, unknown>;
    const out: AskRequest["snapshot"]["widgets"][number] = { id: w.id, type: w.type, title: (w.title ?? "").slice(0, 200) };
    if (isInt(cfg.tableId) && cfg.tableId > 0) out.tableId = cfg.tableId;
    if (isInt(cfg.dynamicViewId) && cfg.dynamicViewId !== 0) out.dynamicViewId = cfg.dynamicViewId;
    const r = input.layouts[w.id];
    if (r) out.layout = { x: clamp(r.x), y: clamp(r.y), w: clamp(r.w), h: clamp(r.h) };
    const binding = bindingOf(cfg, w.type);
    if (binding) out.binding = binding;
    return out;
  });

  const maps = input.widgets.filter((w) => w.type === "map");
  const layers: AskRequest["snapshot"]["layers"] = [];
  for (const l of input.layers) {
    const host = maps.find((m) => layersOfMap(m, input.layers).some((x) => x.id === l.id));
    if (!host) continue;
    const cfg = (l.config ?? {}) as Record<string, unknown>;
    const out: AskRequest["snapshot"]["layers"][number] = { id: l.id, widgetId: host.id };
    const title = str(cfg.name) ?? str(cfg.title);
    if (title !== undefined) out.title = title;
    if (isInt(l.table_id) && l.table_id > 0) out.tableId = l.table_id;
    const rm = str(cfg.renderMode, 50);
    if (rm !== undefined) out.renderMode = rm;
    if (typeof cfg.visible === "boolean") out.visible = cfg.visible;
    const dvId = (l as { dynamic_view_id?: unknown }).dynamic_view_id;
    if (isInt(dvId) && dvId !== 0) out.dynamicViewId = dvId;
    const refs = aiLayerColumnRefs(cfg);
    if (refs.length) out.columns = refs.slice(0, 5);
    layers.push(out);
    if (layers.length >= 50) break;
  }

  return {
    widgets,
    layers,
    dynamicViews: input.dynamicViews.slice(0, 20).map((d) => {
      const out: AskRequest["snapshot"]["dynamicViews"][number] = { id: d.id, name: d.name.slice(0, 200) };
      if (isInt(d.baseTableId) && d.baseTableId > 0) out.baseTableId = d.baseTableId;
      if (typeof d.aggregated === "boolean") out.aggregated = d.aggregated;
      if (Array.isArray(d.columns)) {
        out.columns = d.columns.slice(0, 70).map((c) => ({ name: String(c.name).slice(0, 200), type: String(c.type).slice(0, 50) }));
      }
      return out;
    }),
    filters: snapshotFilters(input.filters),
  };
}

export function buildAskTurns(turns: readonly Turn[], cursor: number, saved: readonly SavedChatItem[] = []): AskRequest["turns"] {
  // 141 D-18: kept (saved) turns stay as provider history, ahead of the live turns; notes are display-only.
  const savedTurns = saved.flatMap((x) =>
    x.kind === "turn" ? [{ id: x.id, prompt: x.prompt, answer: x.answer, entries: [], createdAt: 0, ...(x.chat ? { chat: x.chat } : {}) } as Turn] : [],
  );
  const kept = [...savedTurns, ...turns.slice(0, cursor + 1)].filter((t) => !t.chat || t.chat.status === "ok");
  const firstRecent = Math.max(0, kept.length - RECENT_ANSWER_TURNS);
  return kept.map((t, i) => {
    const changes: AskRequest["turns"][number]["changes"] = [];
    for (const label of t.chat?.applied ?? []) changes.push({ label: label.slice(0, 200), status: "applied" });
    for (const s of t.chat?.skipped ?? []) {
      const reason = s.reasons[0];
      changes.push({
        label: s.label.slice(0, 200),
        status: "skipped",
        ...(reason !== undefined ? { reason: reason.slice(0, 200) } : {}),
      });
    }
    return {
      question: t.prompt.slice(0, 2000),
      answer: i >= firstRecent ? t.answer.slice(0, RECENT_ANSWER_CHARS) : "",
      changes: changes.slice(0, 30),
    };
  });
}

export function buildAskRequest(input: {
  dashboardId: number;
  question: string;
  snapshot: AskRequest["snapshot"];
  turns: readonly Turn[];
  cursor: number;
  removalApproved: boolean;
  savedTurns?: readonly SavedChatItem[];
}): AskRequest {
  const turns = buildAskTurns(input.turns, input.cursor, input.savedTurns).slice(-50);
  const make = (): AskRequest => ({
    dashboardId: input.dashboardId,
    question: input.question.trim().slice(0, 2000),
    snapshot: input.snapshot,
    turns,
    ...(input.removalApproved ? { approvals: { removeSaved: true } } : {}),
  });
  const enc = new TextEncoder();
  // Drop the OLDEST turn until the body fits under the cap.
  while (turns.length > 0 && enc.encode(JSON.stringify(make())).length >= MAX_BODY_BYTES) turns.shift();
  return make();
}
