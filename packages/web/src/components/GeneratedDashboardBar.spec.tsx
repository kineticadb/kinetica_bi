import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const order: string[] = [];
let discardImpl: (id: number) => Promise<void> = async () => {};
vi.mock("../lib/aiSession/askRunner", () => ({ cancelAsk: () => order.push("cancel") }));
vi.mock("../lib/aiOps/aiFilterEffects", () => ({ discardAiSession: () => order.push("discardSession") }));
vi.mock("../api/client", () => ({
  discardGeneratedDashboard: (id: number) => {
    order.push(`server:${id}`);
    return discardImpl(id);
  },
}));
import { GeneratedPendingNote, GeneratedDiscardDialog } from "./GeneratedDashboardBar";

beforeEach(() => {
  order.length = 0;
  discardImpl = async () => {};
});

describe("GeneratedDashboardBar", () => {
  it("GENBAR-1: pending note text, button classes, onDiscard", () => {
    const fn = vi.fn();
    const { container } = render(<GeneratedPendingNote onDiscard={fn} />);
    const s = screen.getByRole("status");
    expect(s.className).toContain("ai-change-bar");
    expect(s.textContent).toContain(
      "This generated dashboard isn't kept yet. Ask the AI Assistant to build it, or discard it.",
    );
    const b = screen.getByRole("button", { name: "Discard dashboard" });
    expect(b.className).toBe("ghost-sm ghost-danger");
    expect(container.querySelector(".ds-actions")?.contains(b)).toBe(true);
    fireEvent.click(b);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("GENBAR-2: portalled dialog, copy, Cancel focused, Escape/Cancel only close", () => {
    const onClose = vi.fn();
    const onDiscarded = vi.fn();
    const { container } = render(<GeneratedDiscardDialog dashboardId={9} onClose={onClose} onDiscarded={onDiscarded} />);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    const d = screen.getByRole("dialog");
    expect(document.body.contains(d)).toBe(true);
    expect(d.textContent).toContain("Discard this dashboard?");
    expect(d.textContent).toContain(
      "It was generated and never kept. Discarding deletes it with its charts and AI views.",
    );
    const cancel = screen.getByRole("button", { name: "Cancel" });
    expect(cancel.className).toBe("btn-primary btn-sm");
    expect(document.activeElement).toBe(cancel);
    fireEvent.keyDown(d, { key: "Escape" });
    fireEvent.click(cancel);
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(onDiscarded).not.toHaveBeenCalled();
    expect(order).toEqual([]);
  });

  it("GENBAR-3: discard order, pending label, then onDiscarded", async () => {
    let resolve!: () => void;
    discardImpl = () => new Promise<void>((r) => (resolve = r));
    const onDiscarded = vi.fn();
    render(<GeneratedDiscardDialog dashboardId={9} onClose={vi.fn()} onDiscarded={onDiscarded} />);
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(order).toEqual(["cancel", "discardSession", "server:9"]);
    const pending = screen.getByRole("button", { name: "Discarding…" }) as HTMLButtonElement;
    expect(pending.disabled).toBe(true);
    expect(onDiscarded).not.toHaveBeenCalled();
    resolve();
    await waitFor(() => expect(onDiscarded).toHaveBeenCalledWith(9));
  });

  it("GENBAR-4: failure keeps dialog open with error and re-enables", async () => {
    discardImpl = async () => {
      throw new Error("boom");
    };
    const onDiscarded = vi.fn();
    render(<GeneratedDiscardDialog dashboardId={9} onClose={vi.fn()} onDiscarded={onDiscarded} />);
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    const err = await screen.findByRole("alert");
    expect(err.className).toBe("error");
    expect(err.textContent).toBe("Couldn't discard the dashboard. Try again.");
    expect(onDiscarded).not.toHaveBeenCalled();
    expect((screen.getByRole("button", { name: "Discard" }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(false);
  });
});
