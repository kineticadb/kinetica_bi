// 138-06 Task 3: Discard restores filters to how they were before the AI (D-12).
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useFilterStore } from "../store/filterStore";
import { useAiSessionStore, setAiFilterSink } from "../store/aiSessionStore";
import { baselineFixture, applyFilterRaw } from "../test/aiSessionHarness";
import { installAiFilterEffects } from "../lib/aiOps/aiFilterEffects";
import { applyAiTurn } from "../lib/aiOps/applyAiTurn";

const order: string[] = [];
vi.mock("../lib/aiSession/askRunner", () => ({ cancelAsk: () => order.push(`cancel:${useAiSessionStore.getState().turns.length}`) }));
import AiDiscardDialog from "./AiDiscardDialog";

beforeEach(() => {
  order.length = 0;
  useFilterStore.getState().reset();
  useAiSessionStore.getState().reset();
  installAiFilterEffects();
});
afterEach(() => setAiFilterSink(null));

describe("AiDiscardDialog", () => {
  it("DISF-1: Discard restores the user's filter, empties the session, cancels first, closes once", () => {
    useFilterStore.getState().addFilter(5, { column: "payment_type", value: "Cash", dataType: "string", addedAt: 1 });
    applyAiTurn(
      { prompt: "q", answer: "x", ops: [applyFilterRaw({ kind: "table", id: 5 }, "payment_type", "Credit")] },
      baselineFixture(),
      { checkZeroRows: vi.fn() },
    );
    expect(useFilterStore.getState().filters[5][0].value).toBe("Credit");
    const onClose = vi.fn();
    render(<AiDiscardDialog onClose={onClose} />);
    fireEvent.click(screen.getAllByRole("button").find((b) => b.textContent === "Discard")!);
    expect(useFilterStore.getState().filters[5][0].value).toBe("Cash");
    expect(useAiSessionStore.getState().turns).toHaveLength(0);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["cancel:1"]);
  });
});
