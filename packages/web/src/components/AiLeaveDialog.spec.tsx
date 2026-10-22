import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useAiSessionStore, hasUnsavedAiChanges } from "../store/aiSessionStore";
import { baselineFixture, addWidgetOp } from "../test/aiSessionHarness";
import { requestLeave } from "../lib/aiLeaveGuard";
import { useAuthStore } from "../store/auth";
import { seedDesignerStore, seedAnalystStore } from "../test/seedAuthStore";
import AiLeaveDialog from "./AiLeaveDialog";

function dirty() {
  useAiSessionStore.getState().applyTurn({ prompt: "x", ops: [addWidgetOp(-1)] }, baselineFixture());
}

beforeEach(() => {
  useAiSessionStore.getState().reset();
  useAuthStore.setState({ status: "unauthenticated", user: null });
});

describe("AiLeaveDialog", () => {
  it("AIDLG-1: clean session renders nothing and proceeds", () => {
    render(<AiLeaveDialog />);
    const fn = vi.fn();
    act(() => requestLeave(fn));
    expect(fn).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("AIDLG-2: op-less turn renders no dialog", () => {
    useAiSessionStore.getState().applyTurn({ prompt: "x", ops: [{ op: "remove_widget", id: 99999 }] }, baselineFixture());
    render(<AiLeaveDialog />);
    const fn = vi.fn();
    act(() => requestLeave(fn));
    expect(fn).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("AIDLG-3: dirty shows labelled portalled dialog", () => {
    seedDesignerStore();
    dirty();
    render(<AiLeaveDialog />);
    const fn = vi.fn();
    act(() => requestLeave(fn));
    expect(fn).not.toHaveBeenCalled();
    const dlg = screen.getByRole("dialog", { name: "You have unsaved AI changes" });
    expect(dlg.closest(".modal-overlay")!.parentElement).toBe(document.body);
    // 141: Keep is live, so an editor is told to keep first
    expect(dlg.textContent).toContain("Keep them first if you want to save them.");
    expect(dlg.textContent).not.toMatch(/coming soon/i);
  });

  it("AIDLG-4: Stay closes, no proceed, turns intact", () => {
    dirty();
    render(<AiLeaveDialog />);
    const fn = vi.fn();
    act(() => requestLeave(fn));
    fireEvent.click(screen.getByRole("button", { name: "Stay" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(fn).not.toHaveBeenCalled();
    expect(useAiSessionStore.getState().turns).toHaveLength(1);
  });

  it("AIDLG-5: Discard resets before proceeding, once", () => {
    dirty();
    render(<AiLeaveDialog />);
    let dirtyInside: boolean | null = null;
    const fn = vi.fn(() => { dirtyInside = hasUnsavedAiChanges(); });
    act(() => requestLeave(fn));
    fireEvent.click(screen.getByRole("button", { name: "Discard and leave" }));
    expect(fn).toHaveBeenCalledTimes(1);
    expect(dirtyInside).toBe(false);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("AIDLG-6: Escape and backdrop click act as Stay", () => {
    dirty();
    render(<AiLeaveDialog />);
    const fn = vi.fn();
    act(() => requestLeave(fn));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    act(() => requestLeave(fn));
    fireEvent.click(document.querySelector(".modal-overlay")!);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(fn).not.toHaveBeenCalled();
    expect(useAiSessionStore.getState().turns).toHaveLength(1);
  });

  it("AIDLG-7: classes, initial focus, focus restore", () => {
    dirty();
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    render(<AiLeaveDialog />);
    act(() => requestLeave(() => {}));
    const stay = screen.getByRole("button", { name: "Stay" });
    const discard = screen.getByRole("button", { name: "Discard and leave" });
    expect(stay.className).toBe("btn-primary btn-sm");
    expect(discard.className).toBe("ghost-sm ghost-danger");
    expect(stay.parentElement!.classList.contains("ds-actions")).toBe(true);
    expect(discard.parentElement).toBe(stay.parentElement);
    expect(document.activeElement).toBe(stay);
    fireEvent.click(stay);
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it("AIDLG-8: non-editor gets the neutral copy (D-03)", () => {
    seedAnalystStore();
    dirty();
    render(<AiLeaveDialog />);
    act(() => requestLeave(() => {}));
    const dlg = screen.getByRole("dialog", { name: "You have unsaved AI changes" });
    expect(dlg.textContent).toContain("Leaving will discard the changes the AI made to this dashboard.");
    expect(dlg.textContent).not.toMatch(/Keep them first/);
  });
});
