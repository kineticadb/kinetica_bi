import { useMemo, useRef } from "react";
import type { SessionBaseline, TurnInput, TurnEntry } from "../lib/aiSession/types";
import { useAiSessionStore } from "../store/aiSessionStore";
import { applyAiTurn } from "../lib/aiOps/applyAiTurn";
import { installAiFilterEffects, discardAiSession } from "../lib/aiOps/aiFilterEffects";
import { installAiDvEffects } from "../lib/aiDv/aiDvLifecycle";

/**
 * Baseline-bound session entry point shared by the dev harness (134-05) and the AI widget (137).
 * Stable identity; the baseline is read at call time so it is never stale.
 * 138: applyTurn is the shared filter-aware path (applyAiTurn); the filter sink is installed once
 * (idempotent) so setCursor restores filters per column; discard restores filters too (D-12).
 */
export function useAiSessionActions(getBaseline: () => SessionBaseline): {
  applyTurn(input: TurnInput): { turnId: string; entries: TurnEntry[] };
  setCursor(i: number): void;
  discard(): void;
} {
  const ref = useRef(getBaseline);
  ref.current = getBaseline;
  return useMemo(
    () => {
      installAiFilterEffects();
      installAiDvEffects();
      return {
        applyTurn: (input: TurnInput) => applyAiTurn(input, ref.current()),
        setCursor: (i: number) => useAiSessionStore.getState().setCursor(i, ref.current()),
        discard: () => discardAiSession(),
      };
    },
    [],
  );
}
