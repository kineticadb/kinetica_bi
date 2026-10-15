// STUB (red-first); replaced by the real implementation.
import type { ActiveFilter } from "../../store/filterStore";
import type { FilterSourceRef } from "../aiSession/types";

export type ZeroRowCheck = { source: FilterSourceRef; column: string; after: ActiveFilter; sourceLabel: string };
export type ZeroRowCheckInput = { turnId: string; epoch: number; checks: ZeroRowCheck[] };
export type ZeroRowDeps = { runSql?: (sql: string) => Promise<unknown>; timeoutMs?: number };
export async function checkZeroRowFilters(_input: ZeroRowCheckInput, _deps: ZeroRowDeps = {}): Promise<void> {}
export function readFirstCount(_payload: unknown): number | undefined {
  return undefined;
}
