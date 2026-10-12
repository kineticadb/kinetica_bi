import { useMemo, useRef } from "react";
import type { SessionBaseline, TurnInput, TurnEntry } from "../lib/aiSession/types";
import { useAiSessionStore } from "../store/aiSessionStore";

/**
 * Baseline-bound session entry point shared by the dev harness (134-05) and the AI widget (137).
 * Stable identity; the baseline is read at call time so it is never stale.
 */
export function useAiSessionActions(getBaseline: () => SessionBaseline): {
  applyTurn(input: TurnInput): { turnId: string; entries: TurnEntry[] };
  setCursor(i: number): void;
  discard(): void;
} {
  const ref = useRef(getBaseline);
  ref.current = getBaseline;
  return useMemo(
    () => ({
      applyTurn: (input: TurnInput) => useAiSessionStore.getState().applyTurn(input, ref.current()),
      setCursor: (i: number) => useAiSessionStore.getState().setCursor(i, ref.current()),
      discard: () => useAiSessionStore.getState().reset(),
    }),
    [],
  );
}
