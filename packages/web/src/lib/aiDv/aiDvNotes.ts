// Phase 139 D-05: when an AI view is waiting for a filter / over the cap, say so on its answer (display-only)
// and offer a follow-up. Values are never echoed: only the display name, table label and column name.
import type { AiDvMaterializeResponse } from "@kinetica-bi/shared";
import type { DynamicViewRow } from "../../api/client";
import { useAiSessionStore } from "../../store/aiSessionStore";

const n = (x: number): string => x.toLocaleString("en-US");

export const AI_DV_COPY = {
  waiting: (name: string, base: string, limit: number) =>
    `"${name}" is waiting for a filter: ${base} has too many rows to build it unfiltered (limit ${n(limit)}).`,
  exceeds: (name: string, rows: number, limit: number) =>
    `"${name}" has too many rows (${n(rows)}; limit ${n(limit)}). Narrow the filters to show it.`,
  followDate: (base: string) => `Filter ${base} to the last 30 days`,
  followString: (base: string, col: string) => `Filter ${base} by ${col}`,
  followNone: (base: string) => `Narrow the filters on ${base}`,
} as const;

const notified = new Set<string>();

export function notifyAiDvStatus(
  row: DynamicViewRow,
  result: Extract<AiDvMaterializeResponse, { status: "over_threshold" }>,
): void {
  const ai = row.ai;
  if (row.id >= 0 || !ai) return;
  const turns = useAiSessionStore.getState().turns;
  let turnId: string | undefined;
  for (const t of turns) {
    if (t.entries.some((e) => e.result.status === "applied" && e.op?.op === "add_dynamic_view" && e.op.tempId === row.id)) turnId = t.id;
  }
  if (!turnId) return;
  const key = `${row.id}:${ai.gen}`;
  if (notified.has(key)) return;
  notified.add(key);
  const note =
    result.reason === "no_filter"
      ? AI_DV_COPY.waiting(row.name, ai.baseLabel, row.max_records)
      : AI_DV_COPY.exceeds(row.name, result.row_count, row.max_records);
  const sc = ai.suggestColumn;
  const follow = !sc
    ? AI_DV_COPY.followNone(ai.baseLabel)
    : sc.kind === "date"
      ? AI_DV_COPY.followDate(ai.baseLabel)
      : AI_DV_COPY.followString(ai.baseLabel, sc.name);
  const st = useAiSessionStore.getState();
  st.appendFilterNotes(turnId, [note]);
  st.appendFollowUps(turnId, [follow]);
}

export function __resetAiDvNotesForTest(): void {
  notified.clear();
}
