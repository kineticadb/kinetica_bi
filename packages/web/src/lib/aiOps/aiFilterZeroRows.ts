// 138 D-17: after an AI filter applies, ask the combination view how many rows survive. Zero rows still
// leaves the filter applied (exactly as a click would); the user just gets a chat note and a clear offer.
//
// The COUNT goes through runSql (user-credentialed /api/sql, like the records widget's COUNT) on the view the
// orchestrator already materialized. Nothing is sent to the AI provider and the SQL never carries a filter value.
// KNOWN LIMITATION (research Open Question 1): drawn map shapes fold into the TABLE combination hash, so the
// hash cannot be reproduced here; the check is skipped for table sources while any shape is drawn.
import { aiFilterSourceKey } from "@kinetica-bi/shared";
import { runSql } from "../../api/client";
import { useFilterStore, type ActiveFilter } from "../../store/filterStore";
import { useSpatialFilterStore } from "../../store/spatialFilterStore";
import { useFilterCombinationStore } from "../../store/filterCombinationStore";
import { useAiSessionStore } from "../../store/aiSessionStore";
import { stableComboHash } from "../stableComboHash";
import type { FilterSourceRef } from "../aiSession/types";
import { aiFilterKey, currentFilter } from "./aiFilterApplier";
import { AI_FILTER_COPY } from "./aiFilterCopy";

export type ZeroRowCheck = { source: FilterSourceRef; column: string; after: ActiveFilter; sourceLabel: string };
export type ZeroRowCheckInput = { turnId: string; epoch: number; checks: ZeroRowCheck[] };
export type ZeroRowDeps = { runSql?: (sql: string) => Promise<unknown>; timeoutMs?: number }; // default real runSql, 20000

const SAFE_VIEW = /^[A-Za-z0-9_.]+$/;

/** First value of the first data column; handles the columnar v1.0 shape and the older data_str wrapper. */
export function readFirstCount(payload: unknown): number | undefined {
  try {
    if (!payload || typeof payload !== "object") return undefined;
    let columnar = payload as Record<string, unknown>;
    if ("data_str" in columnar) {
      let d: unknown = columnar.data_str;
      if (typeof d === "string") d = JSON.parse(d);
      if (Array.isArray(d)) d = d[0];
      let enc = (d as Record<string, unknown> | undefined)?.json_encoded_response;
      if (typeof enc === "string") enc = JSON.parse(enc);
      if (!enc || typeof enc !== "object") return undefined;
      columnar = enc as Record<string, unknown>;
    }
    const meta = new Set(["column_headers", "column_datatypes", "has_more_records", "total_number_of_records"]);
    const key = Object.keys(columnar).find((k) => !meta.has(k));
    if (!key) return undefined;
    const col = columnar[key];
    if (!Array.isArray(col) || col.length === 0) return undefined;
    const n = Number(col[0]);
    return Number.isFinite(n) ? n : undefined;
  } catch {
    return undefined;
  }
}

function listFor(source: FilterSourceRef): ActiveFilter[] {
  const s = useFilterStore.getState();
  return (source.kind === "table" ? s.filters[source.id] : s.dvFilters[source.id]) ?? [];
}

async function checkSource(checks: ZeroRowCheck[], input: ZeroRowCheckInput, run: (sql: string) => Promise<unknown>, timeoutMs: number): Promise<void> {
  const source = checks[0].source;
  if (source.kind === "table" && useSpatialFilterStore.getState().shapes.length > 0) return;
  const stale = (): boolean =>
    useAiSessionStore.getState().epoch !== input.epoch ||
    checks.some((c) => aiFilterKey(currentFilter(c.source, c.column)) !== aiFilterKey(c.after));
  const hash = (): string => stableComboHash(source.kind === "table" ? "table" : "dv", source.id, listFor(source));

  const viewName = await new Promise<string | null>((resolve) => {
    let done = false;
    let unsub: () => void = () => {};
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (v: string | null) => {
      if (done) return;
      done = true;
      unsub();
      if (timer) clearTimeout(timer);
      resolve(v);
    };
    const probe = () => {
      if (stale()) return finish(null);
      const e = useFilterCombinationStore.getState().registry[hash()];
      if (e && !e.materializing && e.viewName !== "") finish(e.viewName);
    };
    unsub = useFilterCombinationStore.subscribe(probe);
    timer = setTimeout(() => finish(null), timeoutMs);
    probe();
  });
  if (!viewName || !SAFE_VIEW.test(viewName)) return;

  const n = readFirstCount(await run(`SELECT COUNT(*) AS n FROM ${viewName}`));
  if (stale()) return;
  if (n === 0) {
    useAiSessionStore
      .getState()
      .appendFilterNotes(
        input.turnId,
        [AI_FILTER_COPY.matchedNoRows(checks.map((c) => c.column).join(", "), checks[0].sourceLabel)],
        checks.map((c) => ({ source: c.source, column: c.column })),
      );
  }
}

export async function checkZeroRowFilters(input: ZeroRowCheckInput, deps: ZeroRowDeps = {}): Promise<void> {
  const run = deps.runSql ?? ((sql: string) => runSql(sql));
  const timeoutMs = deps.timeoutMs ?? 20000;
  const groups = new Map<string, ZeroRowCheck[]>();
  for (const c of input.checks) {
    const k = aiFilterSourceKey(c.source);
    groups.set(k, [...(groups.get(k) ?? []), c]);
  }
  await Promise.all(
    [...groups.values()].map((g) => checkSource(g, input, run, timeoutMs).catch(() => undefined)), // the filter stays applied either way
  );
}
